import asyncio, aiohttp, io, os, math, hashlib, base64, logging, urllib.parse
from aiohttp.web_fileresponse import FileResponse
from datetime import datetime, timezone
from PIL import Image
from pathlib import Path, PurePosixPath
from shutil import copyfile

from ..util import misc, mjpeg_mkv_to_zip, gif_to_zip, inpainting, upscaling, video
from ..util.paths import open_path
from ..util.tiff import remove_photoshop_tiff_data

log = logging.getLogger(__name__)

resource_path = (Path(__file__) / '../../../resources').resolve()
blank_image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')

max_thumbnail_pixels = 500*500

def _check_access(request, absolute_path):
    """
    Check if the calling user has access to the given path.
    """
    # To check access, we need to load file info.  Doing this will cause it to be
    # populated into the database.  As an optimization, skip this entirely if we
    # have no tag restrictions (eg. we're admin), so we don't force every thumbnail
    # to be populated.  If we have tag restrictions then we're normally only loading
    # files that are already populated anyway, since we're only returning bookmarks.
    user = request['user']
    if user.is_admin or user.tag_list is None:
        # log.info('Skipping access check because there are no restrictions')
        return

    entry = request.app['server'].library.get(absolute_path)

    # Check that the user has access to this file.
    user.check_image_access(entry, api=False)

# Serve direct file requests.
async def handle_file(request):
    path = request.match_info['path']
    convert_images = request.query.get('convert_images', '1') != '0'

    absolute_path = request.app['server'].resolve_path(path)
    _check_access(request, absolute_path)

    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    mime_type = misc.mime_type_from_ext(absolute_path.suffix)

    # If this is an image and not a browser image format, convert it for browser viewing.
    browser_image_types = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp']
    if convert_images and mime_type.startswith('image') and mime_type not in browser_image_types:
        return await _handle_browser_conversion(request)
    
    response = FileResponse(absolute_path, headers={
        'Cache-Control': 'public, immutable',
        'Content-Type': mime_type,
    })

    # Work around aiohttp: instead of using the path you give it, it creates a Path initialized
    # with it.  This causes it to create a WindowsPath instead of using the ZipPath objects we
    # actually told it to use.  This used to work fine, but more recent versions of aiohttp no
    # longer understand that they might be given a file that isn't a regular filesystem path.
    response._path = absolute_path

    return response

def _bake_exif_rotation(image, exif):
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
        log.warn('Unexpected EXIF orientation: %i' % image_orientation)
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

async def create_thumb(*args, **kwargs):
    """
    Push creating thumbs into a thread, since it does a bunch of CPU-bound work that
    isn't built on asyncs.  It'll release the GIL and allow other work happen.
    """
    return await asyncio.to_thread(threaded_create_thumb, *args, **kwargs)

def threaded_create_thumb(request, path, *, inpaint_path=None):
    # Thumbnail the image.
    #
    # Don't use PIL's built-in behavior of clamping the size.  It works poorly for
    # very wide images.  If an image is 5000x1000 and we thumbnail to a max of 500x500,
    # it'll result in a 500x100 image, which is unusable.  Instead, use a maximum
    # pixel count.
    with path.open('rb') as f:
        try:
            f = remove_photoshop_tiff_data(f)
            image = Image.open(f)

            # Read EXIF data, so we can bake rotations into the final image.  This might
            # need to read the data from the file, so do it while we still have the file
            # open.
            #
            # Do this before calling load() to work around a PIL inconsistency.  Some loaders
            # like JPEG load EXIF data on load() and getexif() can be called at any time, but
            # ones that don't (like TIFF) will fail if getexif() is called after load().
            try:
                exif = image.getexif()
            except SyntaxError:
                # PIL throws SyntaxError if it doesn't understand something about EXIF tags.
                # Don't let this prevent us from creating a thumbnail.
                exif = {}

            image.load()
        except Exception as e:
            log.warn('Couldn\'t read %s to create thumbnail: %s' % (path, e))
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
            except Exception as e:
                # Just log errors for these, don't fail the request.
                log.warn('Couldn\'t read inpaint %s for thumbnail: %s' % (path, e))

    total_pixels = image.size[0]*image.size[1]
    ratio = max_thumbnail_pixels / total_pixels
    ratio = math.pow(ratio, 0.5)
    new_size = int(image.size[0] * ratio), int(image.size[1] * ratio)

    try:
        image.thumbnail(new_size)
    except OSError as e:
        log.warn('Couldn\'t create thumbnail for %s: %s' % (path, str(e)))
        raise aiohttp.web.HTTPUnsupportedMediaType()

    # If the image has EXIF rotations, bake them into the thumbnail.
    image = _bake_exif_rotation(image, exif)

    # Save this image's signature.  This will resize the image itself, so we do this
    # on the already resized image so it has less resizing to do.
    request.app['server'].sig_db.save_image_signature(path, image)

    # If the image is transparent, save it as PNG.  Otherwise, save it as JPEG.
    if _image_is_transparent(image):
        file_type = 'PNG'
        mime_type = 'image/png'
    else:
        file_type = 'JPEG'
        mime_type = 'image/jpeg'
        if image.mode not in ('RGB', 'L', 'CMYK'):
            image = image.convert('RGB')
    
    # Compress the image.  If the source image had an ICC profile, copy it too.
    #
    # Work around PIL weirdness: PNGs return a string for icc_profile instead of bytes,
    # which causes an exception in JpegImagePlugin.  Just ignore these.
    icc_profile = image.info.get('icc_profile')
    if not isinstance(icc_profile, bytes):
        icc_profile = None

    f = io.BytesIO()
    image.save(f, file_type, quality=70, icc_profile=icc_profile)
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
async def _create_video_poster(media_id, path, data_dir):
    """
    Extract a poster from a video file and return the path to the poster.
    """
    poster_path = _get_poster_path(path, data_dir)
    if poster_path.exists():
        return poster_path, 'image/jpeg'

    if not await video.extract_frame(path, poster_path, seek_seconds=0, exif_description=media_id):
        # If the first frame fails, we can't get anything from this video.
        raise aiohttp.web.HTTPUnsupportedMediaType()

    return poster_path, 'image/jpeg'

async def _extract_video_thumbnail_frame(media_id, path, data_dir):
    """
    Extract the frame to be used for the thumbnail from a video file and return its path.

    This will also cache the video poster if it's needed to create the thumbnail.
    """
    thumb_path = _get_thumbnail_path(path, data_dir)
    if thumb_path.exists():
        return thumb_path

    if await video.extract_frame(path, thumb_path, seek_seconds=10, exif_description=media_id):
        return thumb_path

    # If we couldn't extract a frame later on, the video may not be that long.
    # Extract the thumbnail if we haven't already, and just use that.
    await _create_video_poster(media_id, path, data_dir)

    poster_path = _get_poster_path(path, data_dir)
    copyfile(poster_path, thumb_path)
    return thumb_path

def _find_directory_thumbnail(path):
    """
    Find the first image in a directory to use as the thumbnail.
    """
    # Try to find a file in the directory itself.  If we don't find one, but we do find some ZIPs,
    # check for images inside the ZIPs, so we can give a thumbnail for directories that only contain
    # image archives.
    zips = []
    for idx, file in enumerate(path.scandir()):
        if idx > 100:
            # In case this is a huge directory with no images, don't look too far.
            # If there are this many non-images, it's probably not an image directory
            # anyway.
            break

        if file.suffix.lower() == '.zip':
            zips.append(file)
            continue

        # Ignore nested directories.
        if file.is_dir():
            continue

        if misc.file_type(file.name) is not None:
            return file

    # Only check a couple ZIPs, so we don't scan lots of them if this isn't an image directory.
    for zip_path in zips[0:2]:
        path = open_path(zip_path)
        for idx, file in enumerate(path.scandir()):
            if misc.file_type(file.name) is not None:
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
    absolute_path = request.app['server'].resolve_path(path)
    _check_access(request, absolute_path)
    if not request.app['server'].check_path(absolute_path, request, throw=False):
        raise aiohttp.web.HTTPNotFound()
    
    # If this is a directory, look for an image inside it to display.
    if absolute_path.is_dir():
        absolute_path = _find_directory_thumbnail(absolute_path)
        if absolute_path is None:
            if mode == 'thumb':
                # The directory exists, but we don't have an image to use as a thumbnail.
                raise aiohttp.web.HTTPFound('/vview/resources/folder.svg')
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

    data_dir = request.app['server'].library.data_dir

    entry = request.app['server'].library.get(absolute_path)
    if entry is None:
        raise aiohttp.web.HTTPNotFound()

    # Generate the thumbnail in a thread.
    filetype = misc.file_type(str(absolute_path))
    if filetype == 'video':
        if mode =='poster':
            file, mime_type = await _create_video_poster(path, absolute_path, data_dir)
            thumbnail_file = file.read_bytes()
        else:
            thumb_path = await _extract_video_thumbnail_frame(path, absolute_path, data_dir)

            # Create the thumbnail in the same way we create image thumbs.
            thumbnail_file, mime_type = await create_thumb(request, thumb_path)
    else:
        inpaint_path = inpainting.get_inpaint_path_for_entry(entry, request.app['server'])
        thumbnail_file, mime_type = await create_thumb(request, absolute_path, inpaint_path=inpaint_path)

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
    absolute_path = request.app['server'].resolve_path(path)
    if not request.app['server'].check_path(absolute_path, request, throw=False):
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
        if mime_type in ('video/x-matroska', 'video/webm'):
            # Get frame durations.  This is where we expect an exception to be thrown if
            # the file isn't an MJPEG, so we do this before creating our response.
            frame_durations = mjpeg_mkv_to_zip.get_frame_durations(f)
            output_file, task = await mjpeg_mkv_to_zip.create_ugoira(f, frame_durations)
        elif mime_type == 'image/gif':
            frame_durations = gif_to_zip.get_frame_durations(f)
            output_file, task = gif_to_zip.create_ugoira(f, frame_durations)
        else:
            raise aiohttp.web.HTTPNotFound(f'Thumbnails not supported for {mime_type}')

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
    absolute_path = request.app['server'].resolve_path(path)
    if not request.app['server'].check_path(absolute_path, request, throw=False):
        raise aiohttp.web.HTTPNotFound()
    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    entry = request.app['server'].library.get(absolute_path)
    if entry is None:
        raise aiohttp.web.HTTPNotFound()

    if not entry.get('inpaint'):
        raise aiohttp.web.HTTPNotFound()

    inpaint_path, inpaint_image, mime_type = await inpainting.create_inpaint_for_entry(entry, request.app['server'])
    if inpaint_path is None:
        # Generating the inpaint failed.
        raise aiohttp.web.HTTPInternalServerError()

    return FileResponse(inpaint_path, headers={
        'Cache-Control': 'public, immutable',
        'Content-Type': mime_type,
    })

async def handle_upscale(request):
    path = request.match_info['path']
    ratio = int(request.query.get('ratio', 2))
    absolute_path = request.app['server'].resolve_path(path)
    _check_access(request, absolute_path)

    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    entry = request.app['server'].library.get(absolute_path)
    if entry is None:
        raise aiohttp.web.HTTPNotFound()

    # The resized image and the original image have the same timestamp, so we can check
    # the client's cache timestamp even if we don't have the cached upscale anymore.
    mtime = absolute_path.stat().st_mtime
    if_modified_since = request.if_modified_since
    if if_modified_since is not None:
        modified_time = datetime.fromtimestamp(mtime, timezone.utc)
        modified_time = modified_time.replace(microsecond=0)

        if modified_time <= if_modified_since:
            raise aiohttp.web.HTTPNotModified()

    upscale_path, mime_type = await upscaling.create_upscale_for_entry(entry, ratio=ratio)
    if upscale_path is None:
        raise aiohttp.web.HTTPInternalServerError()

    return FileResponse(upscale_path, headers={
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
    path = PurePosixPath(request.app['server'].library.get_public_path(absolute_path))

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

async def _handle_browser_conversion(request):
    path = request.match_info['path']
    absolute_path = request.app['server'].resolve_path(path)
    
    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    # Check cache before converting the image.
    mtime = absolute_path.stat().st_mtime
    if_modified_since = request.if_modified_since
    if if_modified_since is not None:
        modified_time = datetime.fromtimestamp(mtime, timezone.utc)
        modified_time = modified_time.replace(microsecond=0)

        if modified_time <= if_modified_since:
            raise aiohttp.web.HTTPNotModified()

    if misc.file_type(os.fspath(absolute_path)) is None:
        raise aiohttp.web.HTTPNotFound()

    # Generate the image in a thread.
    converted_file, mime_type = await _convert_to_browser_image(absolute_path)
    if converted_file is None:
        raise aiohttp.web.HTTPNotFound()

    response = aiohttp.web.Response(body=converted_file, headers={
        'Content-Type': mime_type,
        'Cache-Control': 'public, immutable',
    })

    # Fill in last-modified from the source file.
    response.last_modified = mtime
    return response

async def _convert_to_browser_image(absolute_path):
    return await asyncio.to_thread(_threaded_convert_to_browser_image, absolute_path)

def _threaded_convert_to_browser_image(path):
    """
    Convert an image to one that browsers can read, to allow viewing images like TIFFs.

    This is a little tricky.  We don't want to spend too much time compressing the image,
    since we're sending to a browser on the same machine, and the browser is just going
    to spend more time decompressing it.

    We could send it completely uncompressed.  If we do that, we'd want to tell the browser
    to not cache (or set a short cache period), so it doesn't waste space caching uncompressed
    images.  However, there's no good browser format for uncompressed RGBA images.
    
    PNG has no uncompressed mode and is still pretty slow with a 0 compression level.
    RGBA BMPs aren't really supported anywhere.

    Lossless WebP is slow, even if it's set to the fastest compression level.  This is a
    design mistake: the fastest lossless method should just be passing through uncompressed
    data, so you can use the decoder support with zero compression overhead.

    Instead, we use lossy WebP on a fast method.  It's about twice as fast as lossless WebP
    in its fastest mode and 20% faster than PNG in compress_level=0.

    For RGB images, we just use JPEG.  It's 10x faster than WebP.
    """
    with path.open('rb') as f:
        f = remove_photoshop_tiff_data(f)
        try:
            image = Image.open(f)
            image.load()
        except Exception as e:
            log.warn('Couldn\'t read %s to convert for viewing: %s' % (path, e))
            return None, None

    options = {}
    if _image_is_transparent(image):
        file_type = 'WEBP'
        mime_type = 'image/webp'
    else:
        file_type = 'JPEG'
        mime_type = 'image/jpeg'
        options = {
            'subsampling': '4:4:4',
        }
        if image.mode not in ('RGB', 'L', 'CMYK'):
            image = image.convert('RGB')
    
    # Compress the image.  If the source image had an ICC profile, copy it too.
    icc_profile = image.info.get('icc_profile')
    if not isinstance(icc_profile, bytes):
        icc_profile = None

    f = io.BytesIO()
    image.save(f, file_type, quality=95, method=0, icc_profile=icc_profile, **options)
    f.seek(0)
    return f, mime_type
