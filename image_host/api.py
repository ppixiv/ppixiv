import os, urllib, uuid, time, asyncio
from PIL import Image
from datetime import datetime, timezone
from pprint import pprint

# Get this from pywin32, not from adodbapi:
try:
    import adodbapi
except ImportError:
    adodbapi = None
    print('Windows search not available')

handlers = {}

# adodbapi seems to have no way to escape strings, and Search.CollatorDSO doesn't seem
# to support parameters at all.
def escape_sql(s):
    result = ''
    for c in s:
        if c == '\'' or c == '"' or c == '\\':
            result += "\\"
        result += c
    return result

def windows_search(top, substr, include_dirs=True, include_files=True):
    if adodbapi is None:
        return

    try:
        conn = adodbapi.connect('Provider=Search.CollatorDSO; Extended Properties="Application=Windows"')
    except Exception as e:
        print('Couldn\'t connect to search: %s' % str(e))
        return

    try:    
        where = []
        where.append("scope = '%s'" % escape_sql(top))
        where.append("CONTAINS(System.FileName, '%s')" % escape_sql(substr))

        if not include_dirs:
            where.append("System.Kind <> 'Folder'")
        if not include_files:
            where.append("System.Kind = 'Folder'")
        query = """
            SELECT System.ItemPathDisplay
            FROM SystemIndex 
            WHERE %(where)s
            ORDER BY System.ItemPathDisplay
        """ % {
            'where': ' AND '.join(where),
        }

        cursor = conn.cursor()
        cursor.execute(query)
        try:
            while True:
                row = cursor.fetchone()
                if row is None:
                    break

                path, = row
                yield path
        finally:
            cursor.close()
    finally:
        conn.close()

def test():
    for path in windows_search('e:/', '.gif', include_dirs=False):
        print(path)

# XXX
# test()

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

archives = {
}

def supported_filetype(path):
    _, ext = os.path.splitext(path)
    ext = ext.lower()
    return ext in ('.png', '.jpg', '.jpeg', '.bmp', '.gif')

class Error(Exception):
    def __init__(self, code, reason):
        self.code = code
        self.reason = reason
    def data(self):
        return {
            'success': False,
            'code': self.code,
            'reason': self.reason,
        }

# Resolve a filesystem path.  Our filesystem has a virtual top entry, which is
# a key in "archives", followed by a path inside it.
#
# Return None if the path isn't valid, such as if it contains "..".  This doesn't
# check if the file exists.
def resolve_path(illust_id):
    if not illust_id.startswith('local:'):
        raise Error('not-found', 'Image not found')

    id_path = illust_id[6:]

    # IDs never start with a slash.
    assert not id_path.startswith('/')

    return resolve_filesystem_path(id_path)

# This is the same as resolve_path, but doesn't include local: at the end.
# This is used for images.
def resolve_filesystem_path(id_path):
    path = id_path
    path = path.lstrip('/')
    if '/' not in path:
        raise Error('not-found', 'Path doesn\'t exist')

    if '..' in path.split('/'):
        raise Error('invalid-request', 'Invalid request')

    archive, path = path.split('/', 1)
    top_dir = archives.get(archive)
    if top_dir is None:
        raise Error('not-found', 'Archive %s doesn\'t exist' % archive)

    id_path = urllib.parse.quote(id_path, safe='/')
    return top_dir + '/' + path, id_path

class RequestInfo:
    def __init__(self, request, base_url):
        self.request = request
        self.base_url = base_url

def get_image_dimensions(path):
    try:
        image = Image.open(path)
    except OSError as e:
        # Skip non-images.
        return None

    return image.size

# Get info for illust_id.
#
# If include_manga_pages is true, return full info for manga pages.  We
# don't have a database or cache, so this can be slow.
#
# If for_manga is true, this is a recursive call when collecting manga pages.
def get_illust_info(illust_id, base_url, *, include_manga_pages=False, for_manga=False):
    """
    Return illust info.

    If illust_id points at a directory, detect if it can be viewed as a manga page.
    """
    # Info for an illust never ends with a slash.  Verify this to make sure this doesn't
    # start happening by accident.
    assert not illust_id.endswith('/')
    absolute_path, local_path = resolve_path(illust_id)

    if os.path.isdir(absolute_path):
        # If for_manga is true, then we're already reading an image inside a manga
        # post.  Don't do this recursively.
        if for_manga:
            raise Error('ignored', '')

        pages = []
        width = None
        height = None
        for page_file in os.scandir(absolute_path):
            # Ignore nested directories.
            if page_file.is_dir(follow_symlinks=False):
                continue

            if not supported_filetype(page_file.name):
                continue

            # If include_manga_pages is true, read full info for each page.  Otherwise,
            # only read one page to get a main width and height, so we don't read as much
            # data.
            if include_manga_pages:
                page_illust_id = illust_id + '/' + page_file.name
                page_info = get_illust_info(page_illust_id, base_url, for_manga=True)

                # We expect the nested illust to be a single image, since we set for_manga
                # to true.
                assert len(page_info['mangaPages']) == 1
                pages.append(page_info['mangaPages'][0])
                
                # Take the main width and height from the first image.
                if width is None:
                    width = page_info['mangaPages'][0]['width']
                    height = page_info['mangaPages'][0]['height']
            else:
                # Read illust info for this page.
                try:
                    remote_thumb_path = base_url + '/thumb/' + local_path + '/' + urllib.parse.quote(page_file.name)
                    remove_image_path = base_url + '/' + local_path + '/' + urllib.parse.quote(page_file.name)

                    # We expect the nested illust to be a single image, since we set allow_manga
                    # to false.
                    pages.append({
                        'urls': {
                            'original': remove_image_path,
                            'small': remote_thumb_path,
                        }
                    })

                    if width is None:
                        # width and height are the dimensions of the first page.
                        page_absolute_path = absolute_path + '/' + page_file.name
                        size = get_image_dimensions(page_absolute_path)
                        if size is not None:
                            width, height = size
                except Error as e:
                    continue

        # If this directory has no images, don't use it as a manga post.
        if not pages:
            raise Error('not-found', 'Image not found')

        # If we didn't get dimensions from any image, stop.
        if width is None:
            raise Error('not-found', 'Image not found')

        # Use the directory's mtime as the post time.
        mtime = os.stat(absolute_path).st_mtime
    else:
        # Ignore this file if it's not a supported file type.
        if not supported_filetype(local_path):
            raise Error('unsupported', 'Unsupported file type')

        remote_image_path = base_url + '/' + local_path
        remote_thumb_path = base_url + '/thumb/' + local_path

        size = get_image_dimensions(absolute_path)
        if size is None:
            raise Error('not-found', 'Image not found')

        width, height = size

        mtime = os.stat(absolute_path).st_mtime

        pages = [{
            'width': width,
            'height': height,
            'urls': {
                'original': remote_image_path,
                'small': remote_thumb_path,
            },
        }]

    modified = datetime.fromtimestamp(mtime, tz=timezone.utc)
    timestamp = modified.isoformat().replace('T', ' ')
    preview_urls = [page['urls']['small'] for page in pages]

    image_info = {
        'id': illust_id,
        'previewUrls': preview_urls,
        'illustType': 0, # image
        'illustTitle': os.path.basename(absolute_path),
        'userId': -1,
        'pageCount': len(pages),
        'bookmarkData': None,
        'createDate': timestamp,
        'width': width,
        'height': height,
        'mangaPages': pages,
        'userName': '',
        'illustComment': '',
        'tagList': [],
    }

    return image_info

@reg('/illust')
async def api_illust(info):
    illust_id = info.request['id']
    image_info = get_illust_info(illust_id, info.base_url, include_manga_pages=True)

    return {
        'success': True,
        'illust': image_info,
    }

# Values of api_list_results can be a dictionary, in which case they're a result
# cached from a previous call.  They can also be a function, which is called to
# retrieve the next page, which is used to continue previous searches.
from collections import OrderedDict
api_list_results = OrderedDict()

def cache_api_list_result(uuid, result):
    api_list_results[uuid] = result

    # Delete old cached entries.
    while len(api_list_results) > 10:
        key = list(api_list_results.keys())[0]
        del api_list_results[key]

@reg('/list')
async def api_list(info):
    page = info.request.get('next')
    result_generator = None
    this_page_uuid = None

    if page is not None:
        # Try to load the next page.
        result = api_list_results.get(page)

        # If page isn't in api_list_results then we don't have this result.  It
        # probably expired.  Continue and treat this as a new search.
        if result is not None:
            # If this is a dict, we have this result cached, so just return it.
            if isinstance(result, dict):
                return result
        
            # result is a generator stored from a previous call.
            result_generator = result
            this_page_uuid = page

    # If we're not continuing a search, create a new one and generate its UUID.
    if result_generator is None:
        result_generator = api_list_impl(info)
        this_page_uuid = str(uuid.uuid4())

    # Get the next page of results.  Run this in a thread.
    def run():
        return next(result_generator)
    next_results = await asyncio.to_thread(run)

    # Store this page's ID.
    next_results['this'] = this_page_uuid

    # If the search says that there's another page, create a UUID for it and
    # store its generator.  Otherwise, set next to null.
    if next_results.get('next'):
        next_page_uuid = str(uuid.uuid4())
        next_results['next'] = next_page_uuid
        cache_api_list_result(next_page_uuid, result_generator)
    else:
        next_results['next'] = None

    # Cache this page.  If this is a continued search, this will replace the
    # generator.
    cache_api_list_result(this_page_uuid, next_results)

    return next_results

def api_list_impl(info):
    try:
        illust_id = info.request['id']
    except KeyError:
        raise Error('invalid-request', 'Invalid request')

    # skip allows skipping results at the start.  This is usually not used, and we
    # resume a search by its UUID, but it can be used to approximately recover a search
    # if it's expired.  This is much slower than using the UUID, since we have to
    # iterate through all results up to that point.  This is only used when starting
    # a search and will be ignored if we're resuming.
    skip = int(info.request.get('skip', 0))
    search = info.request.get('search')

    # The root directory has no files.
    if illust_id == 'local:':
        yield {
            'success': True,
            'files': [],
        }
        return

    if not illust_id.endswith('/'):
        illust_id += '/'

    absolute_path, local_path = resolve_path(illust_id)

    # This API is only for listing directories and doesn't do anything with files.
    if os.path.isfile(absolute_path):
        raise Error('not-found', 'Path is a file')

    if not os.path.isdir(absolute_path):
        raise Error('not-found', 'Path doesn\'t exist')

    if not absolute_path.endswith('/'):
        absolute_path += '/'

    # If we're going to skip 10 results, include them in the offset.
    offset = skip
    file_info = []
    def flush(*, last):
        nonlocal offset, file_info

        # Update the offset, to allow resuming this search if it's lost from cache.
        # This is included in this result, since it's the value of skip to use to
        # continue after this result.
        offset += len(file_info)

        result = {
            'success': True,
            'next': not last,
            'offset': offset,
            'files': file_info,
        }
        file_info = []

        return result

    def _get_files(path):
        if search is not None:
            print('find', search)
            for file in windows_search(path, search):
                print(file)
                yield file
        else:
            for file in os.scandir(path):
                yield path + file.name

    print('illust_id', illust_id)
    print('absolute_path', absolute_path)
    _get_files(absolute_path)

    start_time = time.time()
    for file in _get_files(absolute_path):
        # file is a path inside absolute_path.  Get the path relative to absolute_path.
        file = os.path.relpath(file, absolute_path)
        assert '..' not in file
        this_illust_id = illust_id + file

        try:
            image_info = get_illust_info(this_illust_id, info.base_url, include_manga_pages=False)
            if skip:
                skip -= 1
                continue

            file_info.append(image_info)
        except Error as e:
            continue

        result_count = len(file_info)

        # Loading results may take a lot longer if we're on a network drive than if
        # we're local.  If we're taking a while, stop now and return what results we
        # have, so we start displaying results quickly.  Only do this if we have a minimum
        # number, so we don't return images one at a time if we're going very slowly for
        # some reason.
        time_spent = time.time() - start_time
        if result_count >= 100 or (result_count >= 20 and time_spent > 0.5):
            yield flush(last=False)

    yield flush(last=True)

# Return subdirectories of a path.
#
# For performance, this doesn't recurse into subdirectories to figure out which paths can be
# loaded as manga pages.  This is used for the sidebar navigation tree.
@reg('/dirs')
async def api_dirs(info):
    try:
        illust_id = info.request['id']
    except KeyError:
        raise Error('invalid-request', 'Invalid request')

    # If path is /, just return archives in dir_info.
    if illust_id == 'local:':
        return {
            'success': True,
            'subdirs': [{ 'name': 'local:%s' % archive} for archive in archives.keys()],
        }

    if not illust_id.endswith('/'):
        illust_id += '/'

    absolute_path, local_path = resolve_path(illust_id)

    # This API is only for listing directories and doesn't do anything with files.
    if os.path.isfile(absolute_path):
        raise Error('not-found', 'Path is a file')

    if not os.path.isdir(absolute_path):
        raise Error('not-found', 'Path doesn\'t exist')

    if not absolute_path.endswith('/'):
        absolute_path += '/'

    dir_info = []
    for file in os.scandir(absolute_path):
        this_illust_id = illust_id + file.name

        if not file.is_dir(follow_symlinks=False):
            continue

        dir_info.append({
            'name': this_illust_id,
        })

    return {
        'success': True,
        'subdirs': dir_info,
    }

@reg('/view')
async def api_illust(info):
    illust_id = info.request['id']
    absolute_path, local_path = resolve_path(illust_id)
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
