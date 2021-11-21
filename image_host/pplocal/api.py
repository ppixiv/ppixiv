import os, urllib, uuid, time, asyncio
from datetime import datetime, timezone
from pprint import pprint
from collections import OrderedDict, namedtuple
from pathlib import Path, PurePosixPath

from . import image_paths
from .util import misc

handlers = {}

def set_scheme(illust_id, type):
    """
    Set the type of illust_id.

    file: points to an image, and folder: points to a directory.
    """
    assert type in ('folder', 'file')
    assert ':' in illust_id

    rest = illust_id.split(':', 1)[1]
    return '%s:%s' % (type, rest)

def reg(command):
    def wrapper(func):
        handlers[command] = func
        return func
    return wrapper

# We generate thumbnails on demand every time they're requested, without caching
# them.  We only have one client (the local user), so we rely on the browser caching
# for us.
#
# TODO:
# parallelizing reading image dimensions should speed it up when over a network connection
# editing archives
# mkv/mp4 support
# gif -> mkv/mp4

class RequestInfo:
    def __init__(self, request, data, base_url):
        self.request = request
        self.data = data
        self.base_url = base_url

# Get info for illust_id.
def get_illust_info(index, entry, base_url):
    """
    Return illust info.
    """
    if entry['is_directory']:
        # Use the directory's ctime as the post time.
        ctime = entry['ctime']
        timestamp = datetime.fromtimestamp(ctime, tz=timezone.utc).isoformat()

        image_info = {
            'id': 'folder:%s' % index.get_public_path(entry['path']),
            'local_path': str(entry['path']),
            'createDate': timestamp,
            'width': entry['width'],
            'height': entry['height'],
        }

        return image_info

    illust_id = 'file:%s' % index.get_public_path(entry['path'])

    remote_image_path = base_url + '/file/' + urllib.parse.quote(illust_id, safe='/:')
    remote_thumb_path = base_url + '/thumb/' + urllib.parse.quote(illust_id, safe='/:')
    remote_poster_path = base_url + '/poster/' + urllib.parse.quote(illust_id, safe='/:')

    # Get the image dimensions.
    size = entry['width'], entry['height']
    # XXX misc.get_image_dimensions(absolute_path)
    # if size is None:
    #     raise misc.Error('unsupported', 'Unsupported file type')

    ctime = entry['ctime']

    pages = [{
        'width': size[0],
        'height': size[1],
        'urls': {
            'original': remote_image_path,
            'small': remote_thumb_path,
        },
    }]

    # If this is a video, add the poster path.
    filetype = misc.file_type_from_ext(entry['path'].suffix)
    if filetype == 'video':
        pages[0]['urls']['poster'] = remote_poster_path

    timestamp = datetime.fromtimestamp(ctime, tz=timezone.utc).isoformat()
    preview_urls = [page['urls']['small'] for page in pages]

    image_info = {
        'id': illust_id,
        'local_path': str(entry['path']),
        'previewUrls': preview_urls,

        # Pixiv uses 0 for images, 1 for manga and 2 for their janky MJPEG format.
        # We use a string "video" for videos instead of assigning another number.  It's
        # more meaningful, and we're unlikely to collide if they decide to add additional
        # illustTypes.
        'illustType': 0 if filetype == 'image' else 'video',
        'illustTitle': entry['path'].name,
        'userId': -1,
        'pageCount': len(pages),
        'bookmarkData': None,
        'createDate': timestamp,
        'width': size[0],
        'height': size[1],
        'mangaPages': pages,
        'userName': '',
        'illustComment': '',
        'tagList': [],
    }

    return image_info

# Return info about a single file.
@reg('/illust/{type:[^:]+}:{path:.+}')
async def api_illust(info):
    path = PurePosixPath(info.request.match_info['path'])
    absolute_path, index = image_paths.resolve_path(path)

    entry = index.get(absolute_path)
    if entry is None:
        raise misc.Error('not-found', 'File not in index')

    entry = get_illust_info(index, entry, info.base_url)

    return {
        'success': True,
        'illust': entry,
    }

# Values of api_list_results can be a dictionary, in which case they're a result
# cached from a previous call.  They can also be a function, which is called to
# retrieve the next page, which is used to continue previous searches.
api_list_results = OrderedDict()

cached_result = namedtuple('cached_result', ('result', 'prev_uuid', 'next_offset'))
def cache_api_list_result(uuid, cached_result):
    api_list_results[uuid] = cached_result

    # Delete old cached entries.
    while len(api_list_results) > 10:
        key = list(api_list_results.keys())[0]
        del api_list_results[key]

# XXX: expire old active requests after a while so we don't keep searches open forever
@reg('/list/{type:[^:]+}:{path:.+}')
async def api_list(info):
    """
    /list returns files and folders inside a folder.

    If "search" is provided, a recursive filename search will be performed.
    This requires Windows indexing.
    """
    # page is the UUID of the page we want to load.  skip is the offset from the beginning
    # of the search of the page, which is only used if we can't load page.  It can't be used
    # to seek from page.
    page = info.data.get('page')

    # Try to load this page.
    cache = api_list_results.get(page, None) if page is not None else None

    # If we found the page and it's a dictionary, it's a cached result.  Just return it.
    if cache is not None and isinstance(cache.result, dict):
        return cache.result

    # If page isn't in api_list_results then we don't have this result.  It
    # probably expired.  Continue and treat this as a new search.
    if cache is not None:
        # We're resuming a previous search.
        this_page_uuid = page
        prev_page_uuid = cache.prev_uuid
        offset = cache.next_offset
        skip = 0
        result_generator = cache.result
    else:
        # We don't have a previous search, so start a new one.  Create a UUID for
        # this page.
        this_page_uuid = str(uuid.uuid4())
        prev_page_uuid = None
        offset = 0
        skip = int(info.data.get('skip', 0))

        # Start the request.
        result_generator = api_list_impl(info)

    # When we're just reading the next page of results from a continued search,
    # skip is 0 and we'll just load a single page.  We'll only loop here if we're
    # skipping ahead to restart a search.
    while True:
        # Get the next page of results.  Run this in a thread.
        def run():
            try:
                return next(result_generator)
            except StopIteration:
                # The API results should never raise StopIteration.
                assert False

        next_results = await asyncio.to_thread(run)

        # Store this page's IDs.
        next_results['pages'] = {
            'this': this_page_uuid,
            'prev': prev_page_uuid,
            'next': None,
        }

        next_results['offset'] = offset
        next_results['next_offset'] = offset + len(next_results['results'])

        # Update offset for the next page.
        offset += len(next_results['results'])

        # Cache this page.  If this is a continued search, this will replace the
        # generator.
        res = cached_result(result=next_results, prev_uuid=prev_page_uuid, next_offset=offset)
        cache_api_list_result(this_page_uuid, res)

        # If the search says that there's another page, create a UUID for it and
        # store the request generator.
        if next_results.get('next'):
            next_results['pages']['next'] = str(uuid.uuid4())

            res = cached_result(result=result_generator, prev_uuid=this_page_uuid, next_offset=offset)
            cache_api_list_result(next_results['pages']['next'], res)

        # Update skip for the number of results we've seen.  Only skip whole pages: if you
        # skip 50 results and the first two pages have 40 results each, we'll skip the
        # first page and return the second.
        skip -= len(next_results['results'])

        prev_page_uuid = next_results['pages']['this']
        this_page_uuid = next_results['pages']['next']

        # If we've read far enough, or if there aren't any more pages, stop.
        if skip < 0 or next_results['pages']['next'] is None:
            break

    return next_results

# A paginated request generator continually yields the next page of results
# as a { 'results': [...] } dictionary.  When there are no more results, continually
# yield empty results.
#
# If another page may be available, the 'next' key on the dictionary is true.  If it's
# false or not present, the request will end.
def api_list_impl(info):
    path = PurePosixPath(info.request.match_info['path'])
    limit = int(info.data.get('limit', 50))

    search_options = {
        'substr': info.data.get('search'),
        'bookmarked': info.data.get('bookmarked', None),
    }

    # Remove null values from search_options, so it only contains search filters we're
    # actually using.
    for key in list(search_options.keys()):
        if search_options[key] is None:
            del search_options[key]

    # If true, this request is for the tree sidebar.  Don't include files, so we can scan
    # more quickly, and return all results instead of paginating.
    directories_only = int(info.data.get('directories_only', False))

    file_info = []
    def flush(*, last):
        nonlocal file_info

        result = {
            'success': True,
            'next': not last,
            'results': file_info,
        }

        file_info = []
        return result

    # If we're not searching and listing the root, just list the archives.  This
    # is a special case since it doesn't come from the filesystem.
    if not search_options and str(path) == '/':
        for index in image_paths.indexes.values():
            image_info = {
                'id': 'folder:%s' % index.get_public_path(index.path),
                'local_path': str(index.path),
                'createDate': datetime.utcfromtimestamp(0).isoformat(),
            }
            file_info.append(image_info)

        yield flush(last=True)
        return

    # Make a list of archives to search.
    archives_to_search = []
    if str(path) == '/':
        # Search all indexes.
        absolute_path = None
        archives_to_search = list(image_paths.indexes.values())
    else:
        absolute_path, index = image_paths.resolve_path(path)
        archives_to_search.append(index)

    # Yield (filename, is_dir) for this search.
    def _get_files():
        # Search each archive.  Archives usually don't overlap and will short-circuit
        # if the path doesn't match.
        for index in archives_to_search:
            if search_options:
                for entry in index.search(path=absolute_path, include_files=not directories_only, **search_options):
                    yield index, entry
            else:
                # We have no search, so just list the contents of the directory.
                for entry in index.list_path(absolute_path):
                    yield index, entry

    for index, entry in _get_files():
        is_dir = bool(entry['is_directory'])
        if directories_only and not is_dir:
            continue
        
        entry = get_illust_info(index, entry, info.base_url)
        file_info.append(entry)

        if not directories_only and len(file_info) >= limit:
            yield flush(last=False)

    while True:
        yield flush(last=True)

@reg('/view/{type:[^:]+}:{path:.+}')
async def api_illust(info):
    path = PurePosixPath(info.request.match_info['path'])
    absolute_path, index = image_paths.resolve_path(path)
    print(absolute_path)

    # XXX
    if False:
        import subprocess
        if os.path.isdir(absolute_path):
            os.startfile(absolute_path)
        else:
            # Work around a Microsoft programmer being braindamaged: everything else in Windows
            # supports forward slashes in paths, but Explorer is hardcoded to only work with backslashes.
            # The main application used for navigating files in Windows doesn't know how to parse
            # pathnames.
            absolute_path = absolute_path.replace('/', '\\')

            #path = os.path.dirname(absolute_path)
            #file = os.path.basename(absolute_path)
            print('->', absolute_path)

            si = subprocess.STARTUPINFO(dwFlags=subprocess.STARTF_USESHOWWINDOW, wShowWindow=1)
    #        si.dwFlags = subprocess.STARTF_USESHOWWINDOW

            proc = subprocess.Popen([
                'explorer.exe',
                '/select,',
                absolute_path,
            ],
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
            startupinfo=si)
            print(dir(proc))
            print(proc.pid)

        # os.startfile(absolute_path)

    return {
        'success': True,
    }
