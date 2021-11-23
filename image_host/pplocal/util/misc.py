# Helpers that don't have dependancies on our other modules.
import asyncio, os

# cv2 is used to get the dimensions of video files.  It ultimately just calls ffmpeg,
# but it's much faster than running ffprobe in a subprocess.  XXX: are there any usable
# direct ffmpeg bindings, cv2 is big and its video API is too basic to do anything else
# with
import cv2

from PIL import Image
from PIL.ExifTags import TAGS

image_types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
}

video_types = {
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/video/quicktime',
    '.3gp': 'video/video/3gpp', 
}

def file_type_from_ext(ext):
    if ext.lower() in image_types:
        return 'image'
    if ext.lower() in video_types:
        return 'video'
    return None

def mime_type_from_ext(ext, allow_unknown=False):
    ext = ext.lower()
    if ext in image_types:
        return image_types[ext]
    if ext in video_types:
        return video_types[ext]
    if allow_unknown:
        return 'application/octet-stream'
    else:
        return None

def _get_ext(path):
    # os.path.splitext is very slow for some reason, so we split the extension
    # ourself.
    path = str(path)
    parts = path.rsplit('.', 1)
    if len(parts) < 2:
        return 'None'
    return '.' + parts[1].lower()

def file_type(path):
    ext = _get_ext(path)
    return file_type_from_ext(ext)

def mime_type(path):
    ext = _get_ext(path)
    return mime_type_from_ext(ext)

def get_image_dimensions(path):
    filetype = file_type(path)
    # XXX: We get the wrong result here for videos that aren't 1:1, we need the DAR resolution
    # and this gives the pixel resolution.  CV2 isn't a good library for this, but haven't
    # found a good one
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

    # If this is a JPEG, see if this image is rotated by 90 or 270 degrees
    # and swap the dimensions if needed.  Don't do this for PNGs, since PIL
    # will load the whole image.
    if path.suffix.lower() in ('.jpg', '.jpeg'):
        exif = image.getexif()
        ORIENTATION = 0x112
        image_orientation = exif.get(ORIENTATION, 0)
        rotated = image_orientation >= 5
        if rotated:
            return image.size[1], image.size[0]

    return image.size

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

from PIL import Image, ExifTags
exif_tag_ids = { value: key for key, value in ExifTags.TAGS.items() }

def read_metadata(f, mime_type):
    """
    Parse basic metadata from a file.

    This is currently only implemented for JPEGs.
    """
    # PIL's parser for PNGs is very slow, so only support JPEG for now.
    if mime_type != 'image/jpeg':
        return { }

    img = Image.open(f)

    exif_dict = img._getexif()
    if exif_dict is None:
        exif_dict = { }

    result = { }
    def get_exif_string_tag(name, exif_name):
        data = exif_dict.get(exif_tag_ids[exif_name])
        if not data:
            return

        try:
            data = data.decode('UTF-16LE')
        except UnicodeDecodeError:
            return

        # These are null-terminated.
        data = data.rstrip('\u0000')
        result[name] = data

    get_exif_string_tag('title', 'XPTitle')
    get_exif_string_tag('comment', 'XPComment')
    get_exif_string_tag('artist', 'XPAuthor')
    get_exif_string_tag('tags', 'XPKeywords')

    # XPAuthor is semicolon separated.  Reformat this to comma-separated.
    if 'artist' in result:
        result['artist'] = ', '.join(result['artist'].split(';'))

    # Tags is semicolon-separated.  Reformat this to space-separated.
    if 'tags' in result:
        result['tags'] = ' '.join(result['tags'].split(';'))

    return result

class AsyncEvent:
    """
    A simple async implementation of threading.Event.
    """
    def __init__(self):
        self.waits = set()
        self._is_set = False

    @property
    def is_set(self):
        return self._is_set

    def set(self):
        self._is_set = True

        # Wake up all waiters.
        for future in self.waits:
            if not future.done():
                future.set_result(True)

    def clear(self):
        self._is_set = False

    async def wait(self, timeout=None):
        """
        Wait up to timeout to be woken up.  Return true if we were woken up,
        false if we timed out.
        """
        if self._is_set:
            return True

        future = asyncio.get_running_loop().create_future()

        self.waits.add(future)
        try:
            await asyncio.wait_for(future, timeout)
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            self.waits.remove(future)
