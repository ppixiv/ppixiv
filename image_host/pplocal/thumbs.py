import asyncio, aiohttp, io, os, math, hashlib
from aiohttp.web_fileresponse import FileResponse
from datetime import datetime, timezone
from PIL import Image
from pathlib import Path
from shutil import copyfile

from . import video, image_paths

resource_path = (Path(__file__) / '../../../resources').resolve()

data_dir = Path(os.path.dirname(__file__)) / '../data'
data_dir = data_dir.resolve()

poster_dir = data_dir / 'video-posters'
video_thumb_dir = data_dir / 'video-thumb'

poster_dir.mkdir(parents=True, exist_ok=True)
video_thumb_dir.mkdir(parents=True, exist_ok=True)

def create_thumb(path):
    # Thumbnail the image.
    #
    # Don't use PIL's built-in behavior of clamping the size.  It works poorly for
    # very wide images.  If an image is 5000x1000 and we thumbnail to a max of 500x500,
    # it'll result in a 500x100 image, which is unusable.  Instead, use a maximum
    # pixel count.
    image = Image.open(path)

    total_pixels = image.size[0]*image.size[1]
    max_thumbnail_pixels = 400*400
    ratio = max_thumbnail_pixels / total_pixels
    ratio = math.pow(ratio, 0.5)
    new_size = int(image.size[0] * ratio), int(image.size[1] * ratio)
    image.thumbnail(new_size)

    # Convert to RGB, since we always send thumbnails as JPEG.
    if image.mode != 'RGB':
        image = image.convert('RGB')

    # Compress to JPEG.
    f = io.BytesIO()
    image.save(f, 'JPEG', quality=70)
    f.seek(0)
    return f

def get_video_cache_filename(path):
    path_utf8 = str(path).encode('utf-8')
    path_hash = hashlib.sha1(path_utf8).hexdigest()
    return '%s.jpg' % path_hash

def get_poster_path(path):
    # Use a hash of the path to cache the extracted frame.
    cache_filename = get_video_cache_filename(path)
    poster_dir.mkdir(parents=True, exist_ok=True)
    return poster_dir / cache_filename

def get_thumbnail_path(path):
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
def create_video_poster(illust_id, path):
    """
    Extract a poster from a video file and return the path to the poster.
    """
    poster_path = get_poster_path(path)
    if poster_path.exists():
        return poster_path

    if not video.extract_frame(path, poster_path, seek_seconds=0, exif_description=illust_id):
        # If the first frame fails, we can't get anything from this video.
        raise aiohttp.web.HTTPUnsupportedMediaType()

    return poster_path

def _extract_video_thumbnail_frame(illust_id, path):
    """
    Extract the frame to be used for the thumbnail from a video file and return its path.

    This will also cache the video poster if it's needed to create the poster.
    """
    thumb_path = get_thumbnail_path(path)
    if thumb_path.exists():
        return thumb_path

    if video.extract_frame(path, thumb_path, seek_seconds=10, exif_description=illust_id):
        return thumb_path

    # If we couldn't extract a frame later on, the video may not be that long.
    # Extract the thumbnail if we haven't already, and just use that.
    create_video_poster(illust_id, path)

    poster_path = get_poster_path(path)
    copyfile(poster_path, thumb_path)
    return thumb_path

def threaded_create_thumb(illust_id, absolute_path, poster):
    filetype = image_paths.file_type(absolute_path)
    if filetype == 'video':
        if poster:
            file = create_video_poster(illust_id, absolute_path)
            return file.read_bytes()
        else:
            thumb_path = _extract_video_thumbnail_frame(illust_id, absolute_path)

            # Create the thumbnail in the same way we create image thumbs.
            return create_thumb(thumb_path)
    else:
        return create_thumb(absolute_path)

# Handle:
# /thumb/{illust_id}
# /poster/{illust_id} (for videos only)
async def handle_poster(request):
    return await handle_thumb(request, poster=True)

async def handle_thumb(request, poster=False):
    illust_id = request.match_info['id']

    absolute_path = image_paths.resolve_thumbnail_path(illust_id)

    # If this returns a directory, an image couldn't be found to use as a thumbnail.
    if absolute_path is not None and absolute_path.is_dir():
        folder = resource_path / 'folder.svg'
        return aiohttp.web.FileResponse(folder, headers={
            'Cache-Control': 'public, immutable',
        })

    if absolute_path is None or not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    # Check cache before generating the thumbnail.
    mtime = os.stat(absolute_path).st_mtime
    if_modified_since = request.if_modified_since
    if if_modified_since is not None:
        modified_time = datetime.fromtimestamp(mtime, timezone.utc)
        modified_time = modified_time.replace(microsecond=0)

        if modified_time <= if_modified_since:
            raise aiohttp.web.HTTPNotModified()

    if image_paths.file_type(absolute_path) is None:
        raise aiohttp.web.HTTPNotFound()

    # Generate the thumbnail in a thread.
    f = await asyncio.to_thread(threaded_create_thumb, illust_id, absolute_path, poster)

    # Fill in last-modified from the source file.
    timestamp = datetime.fromtimestamp(mtime, tz=timezone.utc)
    timestamp = timestamp.strftime('%a, %d %b %Y %H:%M:%S %Z')

    return aiohttp.web.Response(body=f, headers={
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, immutable',
        'Last-Modified': timestamp,
    })

# Serve direct file requests.
async def handle_file(request):
    illust_id = request.match_info['id']

    absolute_path = image_paths.resolve_thumbnail_path(illust_id)
    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    return FileResponse(absolute_path, headers={
        'Cache-Control': 'public, immutable',
    })
