import os, urllib, uuid, time, asyncio, json, traceback
from datetime import datetime, timezone
from pprint import pprint
from collections import defaultdict
from pathlib import PurePosixPath

from ..util import misc, inpainting

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

class RequestInfo:
    def __init__(self, request, data, base_url):
        self.request = request
        self.data = data
        self.base_url = base_url
        self.manager = request.app['manager']

# Get info for illust_id.
def get_illust_info(info, entry, base_url):
    """
    Return illust info.
    """
    # Check if this access is allowed.
    if not info.manager.check_path(entry['path'], info.request):
        return None
    
    public_path = info.manager.library.get_public_path(entry['path'])

    illust_id = '%s:%s' % ('folder' if entry['is_directory'] else 'file', public_path)
    is_animation = entry.get('animation')

    # The timestamp to use for URLs affected only by the image time:
    image_timestamp = entry['mtime']

    # The timestamp to use for URLs affected by image time, as well as any inpainting
    # edits:
    image_timestamp_with_inpaint = image_timestamp 
    image_timestamp_with_inpaint += entry.get('inpaint_timestamp', 0)

    # The URLs that this file might have:
    remote_image_path = base_url + '/file/' + urllib.parse.quote(illust_id, safe='/:')
    remote_thumb_path = f'{base_url}/thumb/{urllib.parse.quote(illust_id, safe="/:")}?{image_timestamp_with_inpaint}'
    remote_poster_path = base_url + '/poster/' + urllib.parse.quote(illust_id, safe='/:')
    remote_mjpeg_path = base_url + '/mjpeg-zip/' + urllib.parse.quote(illust_id, safe='/:')

    if is_animation:
        # For MJPEGs, use the poster as the "original" image.  The video is retrieved
        # with mjpeg-zip.
        remote_image_path = remote_poster_path

    if entry['is_directory']:
        # Directories return a subset of file info.
        #
        # Use the directory's ctime as the post time.
        ctime = entry['ctime']
        timestamp = datetime.fromtimestamp(ctime, tz=timezone.utc).isoformat()

        # If this is a ZIP, remove the extension from the title.
        title = os.path.basename(illust_id)
        if title.lower().endswith('.zip'):
            title = title[:-4]

        image_info = {
            'id': illust_id,
            'localPath': str(entry['path']),
            'illustTitle': title,
            'createDate': timestamp,
            'bookmarkData': _bookmark_data(entry),
            'previewUrls': [remote_thumb_path],
            'userId': -1,
            'tagList': [],
        }

        return image_info

    filetype = misc.file_type_from_ext(entry['path'].suffix)
    if filetype is None:
        return None

    # Get the image dimensions.
    size = entry['width'], entry['height']
    ctime = entry['ctime']

    urls = {
        'original': remote_image_path,
        'small': remote_thumb_path,
    }

    # If this is a video, add the poster path.
    if filetype == 'video':
        urls['poster'] = remote_poster_path

    # If this is an MJPEG, return the path to the transformed ZIP.
    if is_animation:
        urls['mjpeg_zip'] = remote_mjpeg_path

    timestamp = datetime.fromtimestamp(ctime, tz=timezone.utc).isoformat()
    preview_urls = [urls['small']]
    tags = entry['tags'].split()

    image_info = {
        'id': illust_id,
        'localPath': str(entry['path']),
        'previewUrls': preview_urls,

        # Pixiv uses 0 for images, 1 for manga and 2 for their janky MJPEG format.
        # We use a string "video" for videos instead of assigning another number.  It's
        # more meaningful, and we're unlikely to collide if they decide to add additional
        # illustTypes.
        'illustType': 2 if is_animation else 0 if filetype == 'image' else 'video',
        'illustTitle': entry['title'],

        # We use -1 to indicate no user instead of null.  Pixiv user and illust IDs can
        # be treated as strings or ints, so using null is awkward.
        'userId': -1,
        'bookmarkData': _bookmark_data(entry),
        'createDate': timestamp,
        'urls': urls,
        'width': size[0],
        'height': size[1],
        'userName': entry['author'],
        'illustComment': entry['comment'],
        'tagList': tags,
        'duration': entry['duration'],
    }

    # Add the inpaint info if this image has one.
    if entry.get('inpaint'):
        image_info['inpaint'] = json.loads(entry['inpaint'])
        urls['inpaint'] = f'{base_url}/inpaint/{urllib.parse.quote(illust_id, safe="/:")}?{image_timestamp_with_inpaint}'
        image_info['inpaint_generated'] = entry['inpaint_timestamp'] != 0

    if entry.get('crop'):
        image_info['crop'] = json.loads(entry['crop'])

    return image_info

def _bookmark_data(entry):
    """
    We encode bookmark info in a similar way to Pixiv to make it simpler to work
    with them both in the UI.
    """
    if not entry.get('bookmarked'):
        return None

    return {
        'tags': entry['bookmark_tags'].split(),
        'private': False,
    }

@reg('/bookmark/add/{type:[^:]+}:{path:.+}')
async def api_bookmark_add(info):
    """
    Add a bookmark.  If a bookmark already exists, it will be edited and not replaced.
    """
    path = PurePosixPath(info.request.match_info['path'])

    tags = info.data.get('tags', None)
    if tags is not None:
        tags = ' '.join(tags)

    # Look up the path.
    absolute_path = info.manager.resolve_path(path)
    info.manager.check_path(absolute_path, info.request, throw=True)

    entry = info.manager.library.get(absolute_path)
    entry = info.manager.library.bookmark_edit(entry, set_bookmark=True, tags=tags)
    return { 'success': True, 'bookmark': _bookmark_data(entry) }

@reg('/bookmark/delete/{type:[^:]+}:{path:.+}')
async def api_bookmark_delete(info):
    """
    Delete a bookmark by ID.
    """
    path = PurePosixPath(info.request.match_info['path'])
    
    # Look up the path.
    absolute_path = info.manager.resolve_path(path)
    info.manager.check_path(absolute_path, info.request, throw=True)
    entry = info.manager.library.get(absolute_path)
    info.manager.library.bookmark_edit(entry, set_bookmark=False)

    return { 'success': True }

@reg('/bookmark/tags')
async def api_bookmark_tags(info):
    """
    Return a dictionary of the user's bookmark tags and the number of
    bookmarks for each tag.
    """
    results = defaultdict(int)
    for key, count in info.manager.library.get_all_bookmark_tags().items():
        results[key] += count

    return {
        'success': True,
        'tags': results,
    }

# Return info about a single file.
@reg('/illust/{type:[^:]+}:{path:.+}')
async def api_illust(info):
    path = PurePosixPath(info.request.match_info['path'])
    absolute_path = info.manager.resolve_path(path)
    generate_inpaint = info.data.get('generate_inpaint', True)

    entry = info.manager.library.get(absolute_path)
    if entry is None:
        raise misc.Error('not-found', 'File not in library')

    illust_info = get_illust_info(info, entry, info.base_url)
    if illust_info is None:
        raise misc.Error('not-found', 'File not in library')

    if generate_inpaint:
        # We don't generate inpaints when viewing thumbs, since it would take too long.
        # Generate it if it doesn't exist when image data is requested, since that's when
        # the user is viewing a single image.  This only matters if the cached data has been
        # deleted.
        await inpainting.create_inpaint_for_entry(entry, info.manager)

        # Re-cache the file, so inpaint_timestamp is updated.  It's only imported if the
        # inpaint file exists.
        info.manager.library.get(absolute_path, force_refresh=True)

    return {
        'success': True,
        'illust': illust_info,
    }

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
    cache = info.manager.get_api_list_result(page)

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
                # The only time api_list_impl will stop iterating is if it's cancelled.
                # This shouldn't happen in the middle of an API call that's using it.
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
        res = info.manager.cached_result(result=next_results, prev_uuid=prev_page_uuid, next_offset=offset)
        info.manager.cache_api_list_result(this_page_uuid, res)

        # If the search says that there's another page, create a UUID for it and
        # store the request generator.
        if next_results.get('next'):
            next_results['pages']['next'] = str(uuid.uuid4())

            res = info.manager.cached_result(result=result_generator, prev_uuid=this_page_uuid, next_offset=offset)
            info.manager.cache_api_list_result(next_results['pages']['next'], res)

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
    def get_range_parameter(name):
        value = info.data.get(name, None)
        if value is None:
            return None
        
        if isinstance(value, (int, float)):
            return [value, value]
        
        if isinstance(value, list):
            if len(value) != 2:
                print('Invalid search parameter for %s: %s' % (name, value))
                return None

            return [value[0], value[1]]
        else:
            return None

    # Regular search options:
    search_options = {
        'substr': info.data.get('search'),
        'bookmarked': info.data.get('bookmarked', None),
        'bookmark_tags': info.data.get('bookmark_tags', None),
        'media_type': info.data.get('media_type', None),
        'total_pixels': get_range_parameter('total_pixels'),
        'aspect_ratio': get_range_parameter('aspect_ratio'),
    }

    sort_order = info.data.get('order', 'normal')
    if not sort_order:
        sort_order = 'normal'

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
            'path': str(info.manager.library.get_public_path(path)),
        }

        file_info = []
        return result

    # If we're not searching and listing the root, just list the libraries.
    if not search_options and str(path) == '/':
        for entry in info.manager.library.get_mountpoint_entries():
            illust_info = get_illust_info(info, entry, info.base_url)
            if illust_info is None:
                continue

            file_info.append(illust_info)

        yield flush(last=True)
        return

    # Make a list of paths to search.
    paths_to_search = None
    if str(path) != '/':
        absolute_path = info.manager.resolve_path(path)
        paths_to_search = [absolute_path]

    if search_options:
        entry_iterator = info.manager.library.search(paths=paths_to_search, include_files=not directories_only, sort_order=sort_order, **search_options)
    else:
        # We have no search, so just list the contents of the directory.
        entry_iterator = info.manager.library.list(paths=paths_to_search, include_files=not directories_only, sort_order=sort_order)

    # This receives blocks of results.  Convert it to the API format and yield the whole
    # block.
    for entries in entry_iterator:
        for entry in entries:
            illust_info = get_illust_info(info, entry, info.base_url)
            if illust_info is not None:
                file_info.append(illust_info)
        
        # If we're listing directories only, wait until we have all results.
        if not directories_only and file_info:
            yield flush(last=False)

    while True:
        yield flush(last=True)

# Save nondestructive edits for an image.
@reg('/set-image-edits/{type:[^:]+}:{path:.+}')
async def api_edit_inpainting(info):
    path = PurePosixPath(info.request.match_info['path'])
    absolute_path = info.manager.resolve_path(path)

    entry = info.manager.library.get(absolute_path)
    if entry is None:
        raise misc.Error('not-found', 'File not in library')

    inpaint = info.data.get('inpaint', None)
    crop = info.data.get('crop', None)

    # Save the new inpaint data.  This won't actually generate the inpaint image.
    entry = info.manager.library.set_image_edits(entry, inpaint=inpaint, crop=crop)

    if inpaint is not None:
        # Generate the inpaint image now.
        await inpainting.create_inpaint_for_entry(entry, info.manager)

        # Re-cache the file, so inpaint_timestamp is updated with the new inpaint image's tinestamp.
        entry = info.manager.library.get(absolute_path, force_refresh=True)

    illust_info = get_illust_info(info, entry, info.base_url)

    return {
        'success': True,
        'illust': illust_info,
    }
