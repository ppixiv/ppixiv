# Helpers that don't have dependancies on our other modules.
import asyncio, concurrent, os, io, struct, os, threading, time, traceback, sys, queue
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

class RunMainTask:
    """
    Run the main async task.

    asyncio is unreliable with KeyboardInterrupt.  However, KeyboardInterrupt
    shouldn't be used anyway.  It's much more reliable to just cancel the main
    task and never raise KeyboardInterrupt inside it.
    
    This runs the main task in a thread, so it doesn't see KeyboardInterrupt,
    and cancels it on interrupt.

    main() will be called with a set_main_task keyword argument, which should
    be called from within the main task that should be cancelled on interrupt.
    """
    def __init__(self, main):
        self._main = main
        self._task_finished = threading.Event()
        self._main_loop = None
        self._main_task = None

        self._thread = threading.Thread(target=self._run, name='main')
        self._thread.start()

        interrupt_count = 0
        last_interrupt_at = 0
        while self._thread.is_alive():
            try:
                # XXX: classic Python problem, join() blocks KeyboardInterrupt
                if self._thread.join(.1):
                    break
            except KeyboardInterrupt:
                if time.time() - last_interrupt_at > 5:
                    interrupt_count = 0

                interrupt_count += 1
                last_interrupt_at = time.time()
                if interrupt_count >= 3:
                    # The user hit ^C a few times and we haven't exited, so force the issue.
                    print('Exiting')
                    os._exit(0)
                
                self._cancel_main_task()

    def _cancel_main_task(self):
        if self._main_task is None:
            print('No main task to cancel')
            return
        assert self._main_loop is not None

        print('Shutting down...')
        future = asyncio.run_coroutine_threadsafe(self._do_cancel_main_task(), self._main_loop)

        try:
            # Wait for _do_cancel_main_task to complete.  This doesn't mean the task has finished.
            future.result(timeout=5)
            return
        except concurrent.futures.TimeoutError:
            # This should never happen.
            print('Shutdown timed out')

        this_thread_id = threading.current_thread().ident
        frames = sys._current_frames()
        for thread in threading.enumerate():
            thread_id = thread.ident
            if thread_id == this_thread_id:
                continue

            if not thread.is_alive():
                continue
            
            print(f'Thread {thread_id}: {thread.name}')
            thread_frames = frames.get(thread_id)
            if thread_frames:
                traceback.print_stack(thread_frames, limit=4)
            print('')

        del frames

        if False:
            for task in asyncio.all_tasks(self._main_loop):
                print(task)
                print('stack:')
                task.print_stack()
                print('')

    async def _do_cancel_main_task(self):
        self._main_task.cancel()

    def _run(self):
        try:
            self._main(set_main_task=self.set_main_task)
        except asyncio.CancelledError as e:
            # XXX: signal the main thread that we've finished
            return
        finally:
            self._task_finished.set()

    def set_main_task(self):
        self._main_loop = asyncio.get_running_loop()
        self._main_task = asyncio.current_task()

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

        print('Warning: TransientWriteConnection wasn\'t closed')

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

class ThreadedQueue:
    """
    Run an iterator in a thread.  The results are queued, and can be retrieved with
    an iterator.

    This is used to run searches on a thread, and allow them to complete even if
    they return more results than we'll return in one page.
    """
    def __init__(self, iterator):
        self.results = queue.Queue()
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
        finally:
            self.results.put(None)

    def __iter__(self):
        return self
    
    def __next__(self):
        # If the queue has been discarded, we've already stopped.
        if self.results is None:
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
    """
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
