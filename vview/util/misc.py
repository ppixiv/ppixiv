# Helpers that don't have dependancies on our other modules.
import asyncio, concurrent, os, io, struct, logging, os, re, tempfile, threading, time, traceback, sys, queue, uuid
from contextlib import contextmanager
from pathlib import Path
from PIL import Image, ImageFile, ExifTags
from pprint import pprint
import urllib.parse

from ..util.paths import open_path
from ..util.tiff import get_tiff_metadata
from .video_metadata import mp4, mkv, gif

log = logging.getLogger(__name__)

image_types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
}

video_types = {
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/video/quicktime',
    '.3gp': 'video/video/3gpp', 
}

# Work around PIL not being able to open PNGs with truncated ICCP profiles.  This is a bug
# in PIL, since these files work everywhere else.
ImageFile.LOAD_TRUNCATED_IMAGES = True

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

def ignore_file(path):
    """
    Return true if path should be hidden from the UI.

    This only lists files in file listings.  It's not a security check and can be
    bypassed by accessing the file directly.
    """
    # Skip files inside upscale cache directories.
    parts = path.parts
    if '.upscales' in parts:
        return True

    is_dir = path.is_dir()
    if not is_dir and mime_type_from_ext(path.suffix) is None:
        return True

    return False

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

_temp_path = Path(tempfile.gettempdir()) / 'vview-temp'

def get_temporary_path(ext='.bin'):
    """
    Reteurn a FilesystemPath to a temporary file.

    This is just a unique filesystem path.  The file won't be opened or created and
    this doesn't handle deleting the file.
    """
    _temp_path.mkdir(exist_ok=True)

    temp_filename = f'vview-temp-{uuid.uuid4()}{ext}'
    input_temp_file = _temp_path / temp_filename
    return open_path(input_temp_file)

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

def root_dir():
    """
    Return the installation root.
    """
    # top/vview/util/misc.py -> top
    path = Path(__file__) / '..' / '..' / '..'
    path = path.resolve()
    return path
    
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

    # Use our faster implementation to get metadata from TIFFs.
    if mime_type == 'image/tiff':
        return get_tiff_metadata(f)

    result = { }

    try:
        img = Image.open(f)
    except Exception as e: # should be IOError, but the WebP decoder sometimes fails with RuntimeError
        log.error('Couldn\'t read metadata from %s: %s' % (f, e))
        return { }

    result['width'] = img.size[0]
    result['height'] = img.size[1]
    result['comment'] = img.info.get('parameters') or img.info.get('Description') or ''

    # PIL's parser for PNGs is very slow, so only support metadata from JPEG for now.
    if mime_type == 'image/jpeg' and hasattr(img, '_getexif'):
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

async def wait_or_kill_process(process):
    """
    Wait for process to finish.  On exception (especially cancellation), kill the
    process.
    """
    try:
        return await process.wait()
    except:
        try:
            process.kill()
        except ProcessLookupError:
            pass

        await process.wait()
        raise

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

class TransientWriteConnection:
    """
    This is a convenience wrapper for opening and closing database connections.

    We often run searches, which can perform writes to the database, then yield to
    the caller.  When we do that, we might not be resumed for a long time, and we
    need to be sure not to keep a write transaction pending.  However, we don't
    want to open a new transaction for every write.

    TransientWriteConnection is used as a context manager, and opens a connection
    on demand.  The connection remains open when the context manager exits.  To
    close the connection, call commit().  The connection will be committed and
    closed, and will be reopened the next time it's used.
    """
    def __init__(self, db):
        self.db = db
        self.in_use = False
        self.connection = None
        self.connection_ctx = None

    def __enter__(self):
        assert not self.in_use
        self.in_use = True

        if self.connection is None:
            # Open a connection.  Note that db.connect() is a context manager, and we need
            # to keep a reference to it, both so we can call __exit__ when we're done and because
            # if it's GC'd, the context manager will be exited prematurely.
            self.connection_ctx = self.db.connect(write=False)
            try:
                self.connection = self.connection_ctx.__enter__()
            except:
                self.in_use = False
                self.connection_ctx = None
                raise

        return self.connection

    def __exit__(self, type, value, traceback):
        assert self.in_use
        self.in_use = False

        # If the context manager closes without an exception, don't commit the connection.
        if type is None:
            return

        # Pass exceptions to the connection to roll back and release the connection.
        ctx = self.connection_ctx
        self.connection = None
        self.connection_ctx = None

        # Pass exceptions to the self.connection context manager, so it'll roll
        # back the transaction and shut down.
        ctx.__exit__(type, value, traceback)

    def commit(self):
        assert not self.in_use

        if self.connection is None:
            return

        ctx = self.connection_ctx
        self.connection_ctx = None
        self.connection = None

        ctx.__exit__(None, None, None)

    def __del__(self):
        if not self.in_use:
            return

        log.warn('TransientWriteConnection wasn\'t closed')

class WithBuilder:
    """
    Build an SQL WITH statement for a list of rows.

    builder = WithBuilder('id', 'name', table_name='names')
    builder.add_row(1, 'Name1')
    builder.add_row(2, 'Name2')

    params = []
    builder.get_params(params)
    with_statement = builder.get()
    """
    def __init__(self, *fields, table_name):
        self.table_name = table_name
        self.fields = fields
        self.rows = []

    def add_row(self, *row):
        assert len(row) == len(self.fields)
        self.rows.append(row)

    def get_params(self, params):
        for row in self.rows:
            params.extend(row)

    def get(self):
        """
        Return the WITH statement, eg.

        files(id, name) AS (VALUES (?, ?), (?, ?))

        This doesn't include "WITH" itself, since these are normally combined.
        """
        # It seems to be impossible to have a WITH statement with no values, which
        # is a pain.
        if not self.rows:
            self.add_row([None] * len(self.fields))

        # Placeholder for one row, eg. '(?, ?)'
        row_placeholder = ['?'] * len(self.fields)
        row_placeholder = f"({', '.join(row_placeholder)})"

        # Placeholder for all rows, eg. '(?, ?), (?, ?), (?, ?)'
        all_row_placeholders = [row_placeholder] * len(self.rows)
        all_row_placeholders = ', '.join(all_row_placeholders)

        return f"""
            {self.table_name} ({', '.join(self.fields)})
            AS (VALUES {all_row_placeholders})
        """

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

_cancelledByCancelTask = object()
class CancelTask:
    """
    Implement another of the things asyncio makes a pain: run a synchronous block of code
    that can be cancelled as a task from the event loop.

    A task will be created representing the block.  If that task is cancelled, cancel() will
    be called.  The block itself isn't running inside the task, the task only exists so it
    can be cancelled to allow clean shutdown.

    Note that cancel() will be called from main_event_loop and won't be in the same thread
    as the block.  If the block finishes before the task is cancelled, oncancel() won't be
    called, even if the block throws an exception.

    cancel = False
    def cancel():
        cancel = True
    with CancelTask(oncancel=cancel, event_loop=main_event_loop):
        while not cancelled:
            sleep(1)
    """
    def __init__(self, *, oncancel, event_loop):
        self.oncancel = oncancel
        self._event_loop = event_loop
        self._loop_task = None

    def __enter__(self):
        # Why is there no way to find out if we're in a loop without it throwing
        # an exception if we aren't?
        try:
            current_loop = asyncio.get_running_loop()
        except:
            current_loop = None

        # Calling run_coroutine_threadsafe and waiting on the result will deadlock if we're already
        # in the event loop.  If we're in an event loop then we don't actually need to do anything,
        # since the task is async already.
        if current_loop is not None:
            return

        asyncio.run_coroutine_threadsafe(self._start_loop(), self._event_loop)

    def __exit__(self, exc_type, exc_value, traceback):
        # If we have no _loop_task, we're running in an event loop and __enter__ didn't
        # do anything.
        if self._loop_task is None:
            return

        # Run _stop_loop() in the event loop to exit our task, and wait for it to complete
        # so the block doesn't continue until we know oncancel() isn't being called.
        task = asyncio.run_coroutine_threadsafe(self._stop_loop(), self._event_loop)

        # Work around a nasty asyncio bug: if the loop is closed before the coroutine finishes,
        # the future never completes and result() deadlocks.  It should resolve with an exception
        # if the loop is closed, but it doesn't do that.  We have to work around this by using a
        # small timeout and repeatedly checking if the loop is closed.
        while not self._event_loop.is_closed():
            try:
                task.result(0.5)
                break
            except concurrent.futures.TimeoutError:
                # Keep trying.
                pass

    async def _start_loop(self):
        self._loop_task = asyncio.create_task(self._wait_for_cancellation())
        self._loop_task.set_name('CancelTask')

    async def _stop_loop(self):
        # The block is exiting normally.  If _wait_for_cancellation wasn't cancelled externally,
        # cancel it now.
        self._loop_task.cancel(_cancelledByCancelTask)

        # Wait for the task to exit.  This cleans up the task, and guarantees that if
        # oncancel is called, we don't finish the block until it completes.
        try:
            await self._loop_task
        except asyncio.CancelledError as e:
            # This will always raise CancelledError.
            pass

    async def _wait_for_cancellation(self):
        try:
            # Wait until we're cancelled, either as a global task or by __exit__.
            while True:
                await asyncio.sleep(1000)
        except asyncio.CancelledError as e:
            # We always exit by being cancelled.  If we were cancelled by __exit__ above,
            # the cancel() argument will be _cancelledByCancelTask, which means we're
            # exiting the block and shouldn't call oncancel.
            exited_normally = len(e.args) > 0 and e.args[0] == _cancelledByCancelTask

            if not exited_normally:
                self.oncancel()

            raise

class ThreadedQueue:
    """
    Run an iterator in a thread.  The results are queued, and can be retrieved with
    an iterator.

    This is used to run searches on a thread, and allow them to complete even if
    they return more results than we'll return in one page.
    """
    def __init__(self, iterator):
        self.results = queue.Queue()
        self.exception = None
        self.iterator = iterator
        self.cancel = threading.Event()

        self.thread = threading.Thread(target=self._read_results)
        self.thread.start()

    def _read_results(self):
        try:
            for result in self.iterator:
                if self.cancel.is_set():
                    break

                if result is None:
                    continue

                self.results.put(result)
        except Exception as e:
            # If the iterator throws an exception, store it.  We'll raise it to the
            # caller after the queue is empty.
            self.exception = e
        finally:
            self.results.put(None)

    def __iter__(self):
        return self
    
    def __next__(self):
        # If the queue has been discarded, we've already stopped.
        if self.results is None:
            # If an exception was raised while iterating, raise it now that the
            # queue is empty.
            if self.exception is not None:
                e = self.exception
                self.exception = None
                raise e

            raise StopIteration

        result = self.results.get()
        if result is None:
            self._join_thread()
            raise StopIteration

        return result

    def cancel(self):
        """
        Cancel the task, and block is true until the generator has stopped.

        The iterator will receive GeneratorExit the next time it yields a value.
        """
        self.cancel.set()
        self._join_thread()

    def _join_thread(self):
        self.thread.join()
        self.results = None

import unicodedata
def split_keywords(s):
    r"""
    Split s into search keywords.

    A split like re.findall(r'\w+') has some problems: it includes underscores,
    which shouldn't be part of keywords, and it batches numbers with letters, which
    isn't wanted.  For some reason it's hard to get regex to do this (why can't
    you say [\w^\d] to say "\w minus \d"?), so do it ourself.
    """
    result = []
    current_word = ''
    current_category = None
    for c in s:
        category = unicodedata.category(c)[0]
        # If the category changes, flush the current word.
        if category != current_category:
            current_category = category
            if current_word:
                result.append(current_word)
                current_word = ''

        # Only add letters and numbers.
        if category not in ('L', 'N'):
            continue
        current_word += c

    if current_word:
        result.append(current_word)
    return result

def remove_file_extension(fn):
    """
    Remove the extension from fn for display.

    >>> remove_file_extension('file.jpg')
    'file'
    >>> remove_file_extension('file.r00')
    'file'
    >>> remove_file_extension('file no. 1.txt')
    'file no. 1'
    """
    return re.sub(r'\.[a-z0-9]+$', '', fn, flags=re.IGNORECASE)

class reverse_order_str(str):
    """
    A string that sorts in inverse order.
    """
    def __lt__(self, rhs):
        return not super().__lt__(rhs)

def config_logging():
    # Add a logging factory to make some extra tags available for logging.
    old_factory = logging.getLogRecordFactory()

    def record_factory(*args, **kwargs):
        record = old_factory(*args, **kwargs)

        # Add logTime, which is relativeCreated in seconds instead of milliseconds.
        record.logTime = record.relativeCreated / 1000.0

        # If we're logging while inside a task, make the name of the task available for logging.
        #
        # asyncio assumes that you always know whether you're running in a task already and should
        # never ask about the task if you're not in one, but we don't since we're inside a generic
        # logger.
        try:
            task = asyncio.current_task()
        except RuntimeError:
            task = None

        if task is None:
            record.task_name = ''
        else:
            record.task_name = task.get_name()

        return record
        
    logging.setLogRecordFactory(record_factory)

    # basicConfig doesn't let us give it a log filter, and it also breaks if sys.stderr
    # is None, which it is in windowed applications, so we just set up logging ourself.
    logging.root.setLevel(logging.INFO)
    logging.captureWarnings(True)

    if sys.stderr is not None:
        stdout_handler = logging.StreamHandler()
        add_root_logging_handler(logging.StreamHandler())

    logging.getLogger('vview').setLevel(logging.INFO)

def add_root_logging_handler(handler):
    """
    Add a logging handler to the root logger.

    This is needed so we can add our formatter and filter in one place.  The logging module has
    a hierarchy of loggers and handlers, but every handler has its own format and filters and
    you can't simply set them once on the root logger.
    """
    formatter = logging.Formatter('%(task_name)20s %(logTime)8.3f %(levelname)8s:%(name)-30s: %(message)s')
    handler.setFormatter(formatter)
    handler.addFilter(log_filter)
    logging.root.addHandler(handler)

def log_filter(log_record):
    # Ignore "Cannot write to closing transport" exceptions that asyncio floods our
    # logs with.  https://github.com/aio-libs/aiohttp/issues/5182 https://github.com/aio-libs/aiohttp/issues/5766
    if log_record.exc_info is not None and isinstance(log_record.exc_info, tuple):
        exc_class, exc, exc_tb = log_record.exc_info
        if isinstance(exc, ConnectionResetError) and \
            exc.args == ('Cannot write to closing transport',):
            return False

    return True

import aiohttp
class AccessLogger(aiohttp.abc.AbstractAccessLogger):
    """
    A more readable access log.
    """
    def __init__(self, level, fmt):
        self.logger = logging.getLogger('vview.request')

    def log(self, request, response, duration):
        # Our APIs use POST for data, and the only thing that typically goes in the query is cache
        # timestamps, which are just extra noise in logs, so we only log the path.
        path = urllib.parse.unquote(request.path)
        message = ''
        level = self.logger.info
        if isinstance(response, aiohttp.web.FileResponse) or request.path.startswith('/thumb/') or request.path.startswith('/vview/resources/'):
            # This is a file being served directly from disk.  This also includes thumbs and
            # CSS, which don't come directly from disk but are logged like files.
            message += 'File: '
            if response.status == 200:
                level = self.logger.debug
        elif response.headers.get('Content-Type') == 'application/json':
            message += 'API:  '
            if response.status != 200:
                message += '(%i): ' % response.status
        else:
            message += 'Other:  '
        message += path

        # Log successful non-API requests at a lower level, so we don't spam for each
        # thumbnail request.
        level(message)

def fix_pil():
    """
    Disable PIL's broken "could be decompression bomb" check.  It prevents opening files even
    if you're just trying to get metadata and not decompressing anything, the limit is too
    low and breaks real files, and there's no way to configure it when opening a file, you
    can only change it globally by editing this constant.
    """
    Image.MAX_IMAGE_PIXELS = None
