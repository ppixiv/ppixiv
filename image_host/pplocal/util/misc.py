# Helpers that don't have dependancies on our other modules.
import asyncio, concurrent, os, io, struct, os, threading, time
from contextlib import contextmanager
from PIL import Image, ExifTags
from pprint import pprint

from .video_metadata import mp4, mkv, gif

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
            'duration': data.get('duration'),

            # "animation" means we'll use the ZIP animation format for the file rather
            # than treat it as a video, since browsers don't support MJPEG.
            'animation': data.get('codec') == 'V_MJPEG',
        }

    if not mime_type.startswith('image/'):
        return { }

    # Use our own parser for GIFs, since PIL is slow at this.
    if mime_type == 'image/gif':
        data = gif.parse_gif_metadata(f).data
        return {
            'width': data['width'],
            'height': data['height'],
            'duration': data['duration'],
            'frame_durations': data['frame_durations'],
            'animation': len(data['frame_durations']) > 1,
        }

    result = { }

    try:
        img = Image.open(f)
    except IOError as e:
        print('Couldn\'t read metadata from %s: %s' % (f, e))
        return { }

    result['width'] = img.size[0]
    result['height'] = img.size[1]

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

class FixedZipPipe:
    """
    Work around two Python bugs:

    - os.pipe is badly broken on Windows.  They don't throw an exception
    on seek and always return 0 from tell(), which completely breaks ZipFile.
    It's a known bug and nobody seems to care that a core API is broken.

    It also returns EINVAL instead of EPIPE if the other side is closed, which
    is confusing.

    - If zipfile is given a non-seekable stream, it writes 0 as the file size
    in the local file header.  That's unavoidable if you're streaming data,
    but it makes no sense with writestr(), which receives the whole file at
    once.  It results in unstreamable ZIPs, and we need streamable ZIPs.
    We fix this by calling about_to_write_file with the file size right before
    writing the file, and then replacing the file size in the local file header
    on the next write() call.
    """
    def __init__(self, file):
        self.pos = 0
        self.file = file
        self.next_write_is_local_file_header = None

    def write(self, data):
        if self.next_write_is_local_file_header is not None:
            assert len(data) >= 26
            size = struct.pack('<L', self.next_write_is_local_file_header)
            data = data[0:22] + size + data[26:]

            self.next_write_is_local_file_header = None

        bytes = self.file.write(data)
        self.pos += bytes
    
    def tell(self):
        return self.pos

    def close(self):
        self.file.close()

    def __enter__(self):
        return self.file.__enter__()

    def __exit__(self, *args):
        return self.file.__exit__(*args)

    def flush(self):
        self.file.flush()

    def about_to_write_file(self, size):
        self.next_write_is_local_file_header = size
        pass

@contextmanager
def WriteZip(zip):
    """
    A fixed context handler for ZipFile.

    ZipFile's __exit__ doesn't check whether it's being called with an exception
    and blindly calls close(), which causes ugly chains of exceptions: a write
    throws an exception, then ZipFile tries to close the file during exception
    handling, which also throws an exception.

    We can't just not call close() on exception, or ZipFile does something else
    it shouldn't: it tries to write to the file in __del__.  That causes random
    writes to files and exceptions during GC later on.  Fix this by clearing its
    file on exception.
    """
    try:
        yield zip
        zip.close()
    except:
        zip.fp = None
        raise
