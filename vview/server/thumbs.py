import asyncio, aiohttp, io, os, math, hashlib, base64, urllib.parse
from aiohttp.web_fileresponse import FileResponse
from datetime import datetime, timezone
from PIL import Image
from pathlib import Path, PurePosixPath
from shutil import copyfile

from ..util import misc, mjpeg_mkv_to_zip, gif_to_zip, inpainting, video
from ..util.paths import open_path

resource_path = (Path(__file__) / '../../../resources').resolve()
blank_image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')

max_thumbnail_pixels = 500*500

# Serve direct file requests.
async def handle_file(request):
    path = request.match_info['path']
    absolute_path = request.app['manager'].resolve_path(path)
    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    mime_type = misc.mime_type_from_ext(absolute_path.suffix)
    return FileResponse(absolute_path, headers={
        'Cache-Control': 'public, immutable',
        'Content-Type': mime_type,
    })

def _bake_exif_rotation(image):
    exif = image.getexif()
    ORIENTATION = 0x112
    image_orientation = exif.get(ORIENTATION, 0)
    if image_orientation <= 1:
        return image

    flip_mode = [
        None, # 0: no change
        None, # 1: no change
        Image.FLIP_LEFT_RIGHT, # 2
        Image.ROTATE_180, # 3
        Image.FLIP_TOP_BOTTOM, # 4
        Image.TRANSPOSE, # 5
        Image.ROTATE_270, # 6
        Image.TRANSVERSE, # 7
        Image.ROTATE_90, # 6
    ]

    if image_orientation >= len(flip_mode):
        print('Unexpected EXIF orientation: %i' % image_orientation)
        return image

    return image.transpose(flip_mode[image_orientation])

def _image_is_transparent(img):
    if img.mode == 'P':
        return img.info.get('transparency', -1) != -1
    elif img.mode == 'RGBA':
        extrema = img.getextrema()
        if extrema[3][0] < 255:
            return True
    else:
        return False

def threaded_create_thumb(path, inpaint_path=None):
    # Thumbnail the image.
    #
    # Don't use PIL's built-in behavior of clamping the size.  It works poorly for
    # very wide images.  If an image is 5000x1000 and we thumbnail to a max of 500x500,
    # it'll result in a 500x100 image, which is unusable.  Instead, use a maximum
    # pixel count.
    with path.open('rb') as f:
        try:
            image = Image.open(f)
            image.load()
        except OSError as e:
            print('Couldn\'t read %s to create thumbnail: %s' % (path, e))
            return None, None

    # See if we have an inpaint image that we can apply.  We never create these in
    # response to a thumbnail request, since it's too slow to do in bulk, but use them
    # if they already exist.  Applying them to thumbnails prevents the un-painted
    # image from flashing onscreen whenever we're using thumbnails for quick previews.
    if inpaint_path is not None and inpaint_path.exists():
        with inpaint_path.open('rb') as f:
            try:
                inpaint = Image.open(f)
                image = inpainting.apply_inpaint(image, inpaint)
            except OSError as e:
                # Just log errors for these, don't fail the request.
                print('Couldn\'t read inpaint %s for thumbnail: %s' % (path, e))

    total_pixels = image.size[0]*image.size[1]
    ratio = max_thumbnail_pixels / total_pixels
    ratio = math.pow(ratio, 0.5)
    new_size = int(image.size[0] * ratio), int(image.size[1] * ratio)

    try:
        image.thumbnail(new_size)
    except OSError as e:
        print('Couldn\'t create thumbnail for %s: %s' % (path, str(e)))
        raise aiohttp.web.HTTPUnsupportedMediaType()

    # If the image has EXIF rotations, bake them into the thumbnail.
    image = _bake_exif_rotation(image)

    # If the image is transparent, save it as PNG.  Otherwise, save it as JPEG.
    if _image_is_transparent(image):
        file_type = 'PNG'
        mime_type = 'image/png'
    else:
        file_type = 'JPEG'
        mime_type = 'image/jpeg'
        if image.mode not in ('RGB', 'L'):
            image = image.convert('RGB')
    
    # Compress the image.  If the source image had an ICC profile, copy it too.
    f = io.BytesIO()
    image.save(f, file_type, quality=70, icc_profile=image.info.get('icc_profile'))
    f.seek(0)
    return f, mime_type

def get_video_cache_filename(path):
    path_utf8 = str(path).encode('utf-8')
    path_hash = hashlib.sha1(path_utf8).hexdigest()
    return '%s.jpg' % path_hash

def _get_poster_path(path, data_dir):
    poster_dir = data_dir / 'video-posters'
    poster_dir.mkdir(parents=True, exist_ok=True)

    # Use a hash of the path to cache the extracted frame.
    cache_filename = get_video_cache_filename(path)
    poster_dir.mkdir(parents=True, exist_ok=True)
    return poster_dir / cache_filename

def _get_thumbnail_path(path, data_dir):
    video_thumb_dir = data_dir / 'video-thumb'
    video_thumb_dir.mkdir(parents=True, exist_ok=True)

    # Use a hash of the path to cache the extracted frame.
    cache_filename = get_video_cache_filename(path)
    video_thumb_dir.mkdir(parents=True, exist_ok=True)
    return video_thumb_dir / cache_filename

# Extract images from videos.  The ID is stored in the EXIF description so we can
# identify them later.
#
# The poster image is the first frame.  This is used as the poster image for video
# elements.
#
# The first frame is often blank due to fade-ins and doesn't make a good thumbnail,
# so extract a frame a few seconds in to use as the thumb.  If that fails, it may be
# a very short video, so use the poster image instead.
async def _create_video_poster(illust_id, path, data_dir):
    """
    Extract a poster from a video file and return the path to the poster.
    """
    poster_path = _get_poster_path(path, data_dir)
    if poster_path.exists():
        return poster_path, 'image/jpeg'

    if not await video.extract_frame(path, poster_path, seek_seconds=0, exif_description=illust_id):
        # If the first frame fails, we can't get anything from this video.
        raise aiohttp.web.HTTPUnsupportedMediaType()

    return poster_path, 'image/jpeg'

async def _extract_video_thumbnail_frame(illust_id, path, data_dir):
    """
    Extract the frame to be used for the thumbnail from a video file and return its path.

    This will also cache the video poster if it's needed to create the poster.
    """
    thumb_path = _get_thumbnail_path(path, data_dir)
    if thumb_path.exists():
        return thumb_path

    if await video.extract_frame(path, thumb_path, seek_seconds=10, exif_description=illust_id):
        return thumb_path

    # If we couldn't extract a frame later on, the video may not be that long.
    # Extract the thumbnail if we haven't already, and just use that.
    await _create_video_poster(illust_id, path, data_dir)

    poster_path = _get_poster_path(path, data_dir)
    copyfile(poster_path, thumb_path)
    return thumb_path

async def create_video_thumb(illust_id, absolute_path, mode, *, data_dir):
    if mode =='poster':
        file, mime_type = await _create_video_poster(illust_id, absolute_path, data_dir)
        return file.read_bytes(), mime_type
    else:
        thumb_path = await _extract_video_thumbnail_frame(illust_id, absolute_path, data_dir)

        # Create the thumbnail in the same way we create image thumbs.
        return await asyncio.to_thread(threaded_create_thumb, thumb_path)

async def create_thumb(illust_id, absolute_path, *, inpaint_path=None):
    return await asyncio.to_thread(threaded_create_thumb, absolute_path, inpaint_path=inpaint_path)

def _find_directory_thumbnail(path):
    """
    Find the first image in a directory to use as the thumbnail.
    """
    for idx, file in enumerate(path.scandir()):
        if idx > 10:
            # In case this is a huge directory with no images, don't look too far.
            # If there are this many non-images, it's probably not an image directory
            # anyway.
            break

        # Ignore nested directories.
        if file.is_dir():
            continue

        if misc.file_type(file.name) is None:
            continue

        return file

    return None

# Handle:
# /thumb/{id}
# /poster/{id} (for videos only)
async def handle_poster(request):
    return await handle_thumb(request, mode='poster')
async def handle_tree_thumb(request):
    return await handle_thumb(request, mode='tree-thumb')

async def handle_thumb(request, mode='thumb'):
    path = request.match_info['path']
    absolute_path = request.app['manager'].resolve_path(path)
    if not request.app['manager'].check_path(absolute_path, request, throw=False):
        raise aiohttp.web.HTTPNotFound()
    
    # If this is a directory, look for an image inside it to display.
    if absolute_path.is_dir():
        absolute_path = _find_directory_thumbnail(absolute_path)
        if absolute_path is None:
            if mode == 'thumb':
                # The directory exists, but we don't have an image to use as a thumbnail.
                folder = resource_path / 'folder.svg'
                return aiohttp.web.FileResponse(folder, headers={
                    'Cache-Control': 'public, immutable',
                })
            elif mode == 'tree-thumb':
                # This is a thumbnail used when hovering over the sidebar.  If we don't have a
                # thumbnail, return an empty image instead of the folder image.
                return aiohttp.web.Response(body=blank_image, headers={
                    'Content-Type': 'image/png',
                })

    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    # Check cache before generating the thumbnail.
    mtime = absolute_path.stat().st_mtime
    if_modified_since = request.if_modified_since
    if if_modified_since is not None:
        modified_time = datetime.fromtimestamp(mtime, timezone.utc)
        modified_time = modified_time.replace(microsecond=0)

        if modified_time <= if_modified_since:
            raise aiohttp.web.HTTPNotModified()

    if misc.file_type(os.fspath(absolute_path)) is None:
        raise aiohttp.web.HTTPNotFound()

    data_dir = request.app['manager'].library.data_dir

    # Generate the thumbnail in a thread.
    filetype = misc.file_type(str(absolute_path))
    if filetype == 'video':
        thumbnail_file, mime_type = await create_video_thumb(path, absolute_path, mode, data_dir=data_dir)
    else:
        entry = request.app['manager'].library.get(absolute_path)
        if entry is None:
            raise aiohttp.web.HTTPNotFound()

        inpaint_path = inpainting.get_inpaint_path_for_entry(entry, request.app['manager'])
        thumbnail_file, mime_type = await create_thumb(path, absolute_path, inpaint_path=inpaint_path)
    if thumbnail_file is None:
        raise aiohttp.web.HTTPNotFound()

    response = aiohttp.web.Response(body=thumbnail_file, headers={
        'Content-Type': mime_type,
        'Cache-Control': 'public, immutable',
    })

    # Fill in last-modified from the source file.
    response.last_modified = mtime
    return response

async def handle_mjpeg(request):
    """
    Handle /mjpeg-zip requests.
    """
    path = request.match_info['path']
    absolute_path = request.app['manager'].resolve_path(path)
    if not request.app['manager'].check_path(absolute_path, request, throw=False):
        raise aiohttp.web.HTTPNotFound()

    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    # Check cache.
    mtime = absolute_path.stat().st_mtime
    if_modified_since = request.if_modified_since
    if if_modified_since is not None:
        modified_time = datetime.fromtimestamp(mtime, timezone.utc)
        modified_time = modified_time.replace(microsecond=0)

        if modified_time <= if_modified_since:
            raise aiohttp.web.HTTPNotModified()

    mime_type = misc.mime_type_from_ext(absolute_path.suffix)

    with absolute_path.open('rb') as f:
        # We can convert MJPEG MKVs and GIFs to animation ZIPs.
        if mime_type == 'video/x-matroska':
            # Get frame durations.  This is where we expect an exception to be thrown if
            # the file isn't an MJPEG, so we do this before creating our response.
            frame_durations = mjpeg_mkv_to_zip.get_frame_durations(f)
            output_file, task = await mjpeg_mkv_to_zip.create_ugoira(f, frame_durations)
        elif mime_type == 'image/gif':
            frame_durations = gif_to_zip.get_frame_durations(f)
            output_file, task = gif_to_zip.create_ugoira(f, frame_durations)

        response = aiohttp.web.Response(status=200, headers={
            'Content-Type': 'application/zip',
            'Cache-Control': 'public, immutable',
        })
        response.last_modified = mtime
        response.enable_chunked_encoding()
        await response.prepare(request)
        response.body = output_file

        try:
            await response.write_eof()
        finally:
            # Wait for the thread that's writing the file to exit.  If the connection
            # is being cancelled then output_file will be closed by Response, which will
            # also cause the thread to exit.
            await task
        
        return response

async def handle_inpaint(request):
    path = request.match_info['path']
    absolute_path = request.app['manager'].resolve_path(path)
    if not request.app['manager'].check_path(absolute_path, request, throw=False):
        raise aiohttp.web.HTTPNotFound()
    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    entry = request.app['manager'].library.get(absolute_path)
    if entry is None:
        raise aiohttp.web.HTTPNotFound()

    if not entry.get('inpaint'):
        raise aiohttp.web.HTTPNotFound()

    inpaint_path, inpaint_image, mime_type = await inpainting.create_inpaint_for_entry(entry, request.app['manager'])
    if inpaint_path is None:
        # Generating the inpaint failed.
        raise aiohttp.web.HTTPInternalServerError()

    return FileResponse(inpaint_path, headers={
        'Cache-Control': 'public, immutable',
        'Content-Type': mime_type,
    })

async def handle_open(request):
    """
    Redirect an absolute filesystem path to view it.
    """
    # Note that we don't manager.check_path here.  This isn't loaded from the UI so
    # it has no referer or origin, and it just redirects to another page.
    absolute_path = open_path(request.match_info['path'])
    if not absolute_path.exists():
        raise aiohttp.web.HTTPNotFound()

    # Get the illust ID for this file or directory.
    path = PurePosixPath(request.app['manager'].library.get_public_path(absolute_path))

    # If the underlying path is a file, separate the filename.
    if absolute_path.is_file() and absolute_path.suffix != '.zip':
        filename = path.name
        path = path.parent
    else:
        filename = None

    url = '/#' + urllib.parse.quote(str(path), safe='/: +')
    if filename:
        filename = urllib.parse.quote(filename)
        url += '?view=illust'
        url += '&file=' + filename

    url = url.replace('+', '%2B')
    url = url.replace(' ', '+')

    # HTTPFound reformats our URL incorrectly (why is it modifying our URL at all?), so
    # replace its location URL with the one we want.
    resp = aiohttp.web.HTTPFound(location='http://unused')
    resp.headers['Location'] = url
    raise resp
