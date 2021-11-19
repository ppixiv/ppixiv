import os, urllib, uuid, time, asyncio
from PIL import Image
from datetime import datetime, timezone
from pprint import pprint
from collections import OrderedDict, namedtuple
from pathlib import Path, PurePosixPath

# cv2 is used to get the dimensions of video files.  It ultimately just calls ffmpeg,
# but it's much faster than running ffprobe in a subprocess.  XXX: are there any usable
# direct ffmpeg bindings, cv2 is big and its video API is too basic to do anything else
# with
import cv2

from . import windows_search, misc, image_paths

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
    def __init__(self, request, base_url):
        self.request = request
        self.base_url = base_url

def get_image_dimensions(path):
    filetype = image_paths.file_type(path)
    if filetype == 'video':
        video = cv2.VideoCapture(str(path))
        height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
        width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH))
        return width, height

    try:
        image = Image.open(path)
    except OSError as e:
        # Skip non-images.
        return None

    return image.size

def get_dir_info(illust_id):
    absolute_path = image_paths.resolve_path(illust_id)
    if not os.path.isdir(absolute_path):
        raise misc.Error('not-found', 'Not a directory')

    # Use the directory's mtime as the post time.
    mtime = os.stat(absolute_path).st_mtime

    modified = datetime.fromtimestamp(mtime, tz=timezone.utc)
    timestamp = modified.isoformat().replace('T', ' ')

    image_info = {
        'id': illust_id,
        'createDate': timestamp,
    }

    return image_info

# Get info for illust_id.
def get_illust_info(illust_id, base_url):
    """
    Return illust info.

    If illust_id points at a directory, detect if it can be viewed as a manga page.
    """

    assert illust_id.startswith('file:')

    # Info for an illust never ends with a slash.  Verify this to make sure this doesn't
    # start happening by accident.
    assert not illust_id.endswith('/')
    absolute_path = image_paths.resolve_path(illust_id)

    # Ignore this file if it's not a supported file type.
    filetype = image_paths.file_type(illust_id)
    if filetype is None:
        raise misc.Error('unsupported', 'Unsupported file type')

    remote_image_path = base_url + '/file/' + urllib.parse.quote(illust_id, safe='/')
    remote_thumb_path = base_url + '/thumb/' + urllib.parse.quote(illust_id, safe='/')
    remote_poster_path = base_url + '/poster/' + urllib.parse.quote(illust_id, safe='/')

    # Get the image dimensions.
    size = get_image_dimensions(absolute_path)
    if size is None:
        raise misc.Error('unsupported', 'Unsupported file type')

    mtime = os.stat(absolute_path).st_mtime

    pages = [{
        'width': size[0],
        'height': size[1],
        'urls': {
            'original': remote_image_path,
            'small': remote_thumb_path,
        },
    }]

    # If this is a video, add the poster path.
    if filetype == 'video':
        pages[0]['urls']['poster'] = remote_poster_path

    modified = datetime.fromtimestamp(mtime, tz=timezone.utc)
    timestamp = modified.isoformat().replace('T', ' ')
    preview_urls = [page['urls']['small'] for page in pages]

    image_info = {
        'id': illust_id,
        'previewUrls': preview_urls,

        # Pixiv uses 0 for images, 1 for manga and 2 for their janky MJPEG format.
        # We use a string "video" for videos instead of assigning another number.  It's
        # more meaningful, and we're unlikely to collide if they decide to add additional
        # illustTypes.
        'illustType': 0 if filetype == 'image' else 'video',
        'illustTitle': os.path.basename(absolute_path),
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
@reg('/illust')
async def api_illust(info):
    illust_id = info.request['id']
    image_info = get_illust_info(illust_id, info.base_url)

    return {
        'success': True,
        'illust': image_info,
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
@reg('/list')
async def api_list(info):
    """
    /list returns files and folders inside a folder.

    If "search" is provided, a recursive filename search will be performed.
    This requires Windows indexing.
    """
    # page is the UUID of the page we want to load.  skip is the offset from the beginning
    # of the search of the page, which is only used if we can't load page.  It can't be used
    # to seek from page.
    page = info.request.get('page')

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
        skip = int(info.request.get('skip', 0))

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
    try:
        illust_id = info.request['id']
    except KeyError:
        raise misc.Error('invalid-request', 'Invalid request')

    assert illust_id.startswith('folder:')

    search = info.request.get('search')
    limit = int(info.request.get('limit', 50))

    # If true, this request is for the tree sidebar.  Don't include files, so we can scan
    # more quickly, and return all results instead of paginating.
    directories_only = int(info.request.get('directories_only', False))

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

    # Yield (filename, is_dir) for this search.
    def _get_files():
        if search is None:
            # The root directory contains each archive path.
            if illust_id == 'folder:/':
                for archive in image_paths.archives.keys():
                    yield Path(illust_id) / archive, True
                return

            path = image_paths.resolve_path(illust_id, dir_only=True)
            for path in os.scandir(path):
                yield Path(illust_id) / path.name, path.is_dir(follow_symlinks=False)

            return

        # Make a list of directories to search.
        paths_to_search = []

        if illust_id == 'folder:/':
            for name, archive in image_paths.archives.items():
                paths_to_search.append(('folder:/' + name, archive))
        else:
            absolute_path = image_paths.resolve_path(illust_id, dir_only=True)
            paths_to_search.append((illust_id, absolute_path))

        for this_illust_id, path in paths_to_search:
            for file, is_dir in windows_search.search(path, search, include_files=not directories_only):
                # file is an absolute path.  Get the relative path.
                file = Path(file).relative_to(path)
                yield this_illust_id / file, is_dir

    for this_illust_id, is_dir in _get_files():
        assert '..' not in this_illust_id.parts
        this_illust_id = this_illust_id.as_posix()

        try:
            if is_dir:
                entry = get_dir_info(this_illust_id)
            elif not directories_only:
                # Replace folder: with file:.
                this_illust_id = set_scheme(this_illust_id, 'file')

                entry = get_illust_info(this_illust_id, info.base_url)
            else:
                continue
        except misc.Error as e:
            continue

        file_info.append(entry)

        if not directories_only and len(file_info) >= limit:
            yield flush(last=False)

    while True:
        yield flush(last=True)

@reg('/view')
async def api_illust(info):
    illust_id = info.request['id']
    absolute_path = image_paths.resolve_path(illust_id)
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
