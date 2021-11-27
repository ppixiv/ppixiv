# Helpers that don't have dependancies on our other modules.
import asyncio, os, io, struct
from PIL import Image, ExifTags
from pprint import pprint

from .video_metadata import mp4, mkv

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

exif_tag_ids = { value: key for key, value in ExifTags.TAGS.items() }

def read_metadata(f, mime_type):
    """
    Parse basic metadata from a file.

    This is currently only implemented for JPEGs.
    """
    if mime_type.startswith('video/'):
        if mime_type == 'video/mp4':
            data = mp4.parse(f)
        elif mime_type in ('video/webm', 'video/x-matroska'):
            data = mkv.parse(f)
        else:
            return { }

        return {
            'width': data.get('width'),
            'height': data.get('height'),
            'title': data.get('tag/nam') or '',
            'comment': data.get('tag/cmt') or '',
            'artist': data.get('tag/ART') or '',
            'tags': '',
            'codec': data.get('codec'),

            # "animation" means we'll use the ZIP animation format for the file rather
            # than treat it as a video, since browsers don't support MJPEG.
            'animation': data.get('codec') == 'V_MJPEG',
        }

    if not mime_type.startswith('image/'):
        return { }

    result = { }

    try:
        img = Image.open(f)
    except IOError as e:
        print('Couldn\'t read metadata from %s: %s' % (f, e))
        return { }

    result['width'] = img.size[0]
    result['height'] = img.size[1]

    # If this is a GIF, remember that it's an animation.
    if mime_type == 'image/gif':
        result['animation'] = img.is_animated

    # PIL's parser for PNGs is very slow, so only support metadata from JPEG for now.
    if mime_type == 'image/jpeg':
        exif_dict = img._getexif()
        if exif_dict is None:
            exif_dict = { }

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

        # See if this image is rotated by 90 or 270 degrees and swap the dimensions
        # if needed.
        exif = img.getexif()
        ORIENTATION = 0x112
        image_orientation = exif.get(ORIENTATION, 0)
        rotated = image_orientation >= 5
        if rotated:
            result['width'], result['height'] = result['height'], result['width']

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

class DataStream:
    """
    A dummy stream to receive data from zipfile and push it into a queue.
    """
    def __init__(self, queue):
        self.queue = queue
        self.data = io.BytesIO()

    def write(self, data):
        self.data.write(data)
        return len(data)

    def fix_file_size(self, file_size):
        """
        Work around a Python bug.  If zipfile is given a non-seekable stream, it
        writes 0 as the file size in the local file header.  That's unavoidable
        if you're streaming data in, but it makes no sense when you give it the
        whole file at once, and results in creating ZIPs which are unstreamable.
        We require streamable ZIPs, so we have to fix the header.

        This is called after writing each file, so the local file header for the
        latest file is at the beginning of self.data.
        """
        with self.data.getbuffer() as buffer:
            struct.pack_into('<L', buffer, 22, file_size)

        # Flush the file, so the next file starts at the beginning of self.data
        # so we can find it for the next call.
        self.flush()

    def flush(self):
        self.queue.put(self.data.getvalue())
        self.data.seek(0)
        self.data.truncate()
