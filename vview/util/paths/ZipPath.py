import os, shutil, stat, tempfile, uuid, zipfile
from collections import namedtuple
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
from contextlib import contextmanager
from pprint import pprint

from .PathBase import PathBase


ZipPathInfo = namedtuple('ZipPathInfo', (
    # The basename of the file:
    'name',

    # The ZipInfo object for this file, or None for directories.  This allows us
    # to open files without ZipFile re-parsing the central directory each time.
    'zipinfo',

    # The original path of the file inside the ZIP, which is needed to open it.
    # This is None for directories.
    'zip_path',
    'size',
    'is_dir',
    'timestamp'))

_root = Path('/')

class SharedZipFile:
    """
    This object is shared by all ZipPath instances on the same ZIP, and holds the opened
    ZIP and file directory.

    The ZIP isn't opened until zipfile or directory are accessed.
    """
    def __init__(self, path):
        self.path = path
        self._directory = None
        self._cached_root_entry = None
        self._cached_zipfile = None

    # We have to jump some monkey patching hoops to get ZipFile to work the way we want.
    #
    # - We're inside Path-like objects.  We want to be able to open files from inside the
    # ZIP from them.  However, the caller isn't expected to close those, so they shouldn't
    # keep the file open by themselves.  Only explicitly opening the ZIP or a file inside
    # the ZIP should open the file, since those do get closed explicitly.
    # - We often need to open the ZIP to get the directory, eg. if somebody calls is_file
    # on something inside the ZIP, then close it and reopen it later if the caller then
    # opens the file.  This is easy to do efficiently: keep the ZIP index entry around,
    # so you don't have to parse the ZIP again when you reopen it.  However, ZipFile doesn't
    # do this: you can pass a ZipInfo to open(), but it'll still re-parse the directory
    # over and over every time you reopen it.  It should only do it on demand.
    #
    # Work around this by keeping a single ZipFile object around.  When we need to close the
    # file, set ZipFile.fp to None, and when we reopen it, set it back to the file.
    #
    # Also, opened files inside ZIPs are independant of the ZIP itself.  If we return one
    # from open_file, clear ZipFile.fp so they don't share files, and patch ZipExtFile.close
    # to close the file.
    #
    # This gives us filesystem access that isn't threadsafe, but at least keeps opened
    # files independant and avoids continually re-parsing the ZIP.  This is enough of a
    # mess that it's probably worth forking off ZipFile and refactoring it.
    def zipfile(self, shared=True):
        """
        Return an opened ZipFile.  The caller should close it when finished.
        """
        file = self.path.open('rb', shared=shared)

        # If we've never opened the ZIP before, create the ZipFile.  Otherwise,
        # point it at our file.
        if self._cached_zipfile is None:
            try:
                self._cached_zipfile = zipfile.ZipFile(file)
            except:
                file.close()
                raise
        else:
            self._cached_zipfile.fp = file

        # Patch ZipFile.close to close the file.
        orig_close = self._cached_zipfile.close
        def close():
            if self._cached_zipfile.fp is not None:
                self._cached_zipfile.fp.close()
                self._cached_zipfile.fp = None

            orig_close()
        self._cached_zipfile.close = close

        return self._cached_zipfile

    def open_file(self, zipinfo, mode, shared=True):
        """
        Open a file given its ZipInfo.
        """
        # Somehow, zipfile.Path.open supports the binary flag, but ZipFile.open doesn't
        # (it only opens in binary).  Meanwhile, asyncio.base_events refuses to work
        # with files that don't have "b" in the mode, which is really ugly behavior
        # since it takes a minor problem and turns it into a big one.  It should only
        # log a warning, not break the application.
        #
        # Work around this mess by overwriting the mode on the opened file.
        real_mode = mode
        mode = mode.replace('b', '')

        zipfile = self.zipfile(shared=shared)
        file = zipfile.open(zipinfo, mode)

        if file is None:
            zipfile.close()
            return

        # Steal the file from zipfile, and patch ZipExtFile to close it.
        assert zipfile.fp is not None
        assert zipfile.fp is file._fileobj._file
        zipfile.fp = None

        # Patch ZipExtFile.close to close the file.
        orig_close = file.close
        def close():
            if file._fileobj._file is not None:
                file._fileobj._file.close()
                file._fileobj._file = None

            orig_close()
        file.close = close

        file.mode = real_mode
        return file

    @property
    def directory(self):
        """
        Return the ZIP directory.  This will open and read the ZIP the first time
        it's called.
        """
        if self._directory is not None:
            return self._directory

        with self.zipfile() as zip:
            infolist = list(zip.infolist())

        # Create a directory hierarchy.
        directory = {}

        # Add the entry for the root of the ZIP.  This would be added below, this
        # just makes sure the directory entry for the root is the same as root_entry.
        directory[_root.parent] = {_root.name: self.root_entry}

        for entry in infolist:
            filename = '/' / Path(entry.filename)

            try:
                time = datetime(*entry.date_time)
            except ValueError:
                # Fall back on the ZIP's filesystem timestamp if a file has an invalid timestamp.
                time = self.root_entry.timestamp
            entry = ZipPathInfo(filename.name, entry, entry.filename, entry.file_size, entry.is_dir(), time)

            while True:
                # Add this path to its parent.
                parent = directory.setdefault(filename.parent, {})

                # If the file already exists, we've reached a parent directory that we've
                # already created, so we can stop.
                if filename.name in parent:
                    break

                parent[filename.name] = entry

                # Move up the hierarchy to make sure all parent directories exist. If this
                # creates a directory entry, use this file's timestamp as the directory's
                # timestamp.  Stop if we've reached the root.
                parent = filename.parent
                if parent == filename:
                    break

                filename = parent
                entry = ZipPathInfo(str(filename.name), None, None, 0, True, entry.timestamp)

        self._directory = directory
        return self._directory

    @property
    def root_entry(self):
        """
        Return the ZipPathInfo for the root directory of the ZIP.
        """
        if self._cached_root_entry is None:
            # Use the ZIP's ctime as the root's timestamp.
            ctime = self.path.stat().st_birthtime
            timestamp = datetime.fromtimestamp(ctime, tz=timezone.utc)
            self._cached_root_entry = ZipPathInfo('', None, None, 0, True, timestamp)

        return self._cached_root_entry

class ZipPath(PathBase):
    """
    A Path implementation for zips.

    zipfile.Path isn't really usable for virtual filesystem paths, since it doesn't
    behave the same way.  For example, it returns false if you ask it if "/" exists,
    it has no path.stat(), and while the root directory is "/", files inside the ZIP
    usually don't start with a slash.  It's a mess.
    """
    def __init__(self, *, shared_zip, at='/'):
        self.zip = shared_zip
        self._path = Path(at)
        self._root_entry = None

    @classmethod
    def open_zip(cls, path):
        shared_zip = SharedZipFile(path)
        return cls(shared_zip=shared_zip)

    @property
    def path(self):
        # self._path is an absolute path within the ZIP.  Make it relative to / before
        # concatenating it with the ZIP path so it appends to the ZIP path rather than
        # treating it like an absolute path.
        return self.zip.path / self._path.relative_to('/')

    def __str__(self):
        return str(self.path)

    def __hash__(self):
        return hash(str(self))

    def __eq__(self, rhs):
        if not isinstance(rhs, ZipPath):
            return False

        return self.zip.path == rhs.zip.path and self._path == rhs._path

    @property
    def name(self):
        """
        Return the basename of the path.
        """
        # Make sure that the root of the ZIP returns the name of the ZIP itself.
        return self.path.name
        
    def __fspath__(self):
        """
        The fspath for a file inside a ZIP treats the ZIP like a parent directory.  It
        can be passed to ZipPath.open_zip() later to open the file.
        """
        return os.fspath(self.path)

    def __truediv__(self, name):
        return ZipPath(shared_zip=self.zip, at=self._path / name)

    def exists(self):
        return self._get_our_entry() is not None

    @property
    def parent(self):
        return ZipPath(shared_zip=self.zip, at=self._path.parent)

    @property
    def suffix(self):
        return self._path.suffix
        
    @property
    def stem(self):
        return self._path.stem

    @property
    def parts(self):
        return self._path.parts

    def is_file(self):
        entry = self._get_our_entry()
        if entry is None:
            return False
        return not entry.is_dir

    def is_dir(self):
        entry = self._get_our_entry()
        if entry is None:
            return False
        return entry.is_dir

    def is_real_dir(self):
        # ZIPs and files inside ZIPS are never real filesystem directories.
        # The root directory corresponds to the file on disk.
        return False

    def with_name(self, name):
        return ZipPath(shared_zip=self.zip, at=self._path.with_name(name))

    def with_suffix(self, name):
        return ZipPath(shared_zip=self.zip, at=self._path.with_suffix(name))

    def with_stem(self, stem):
        return ZipPath(shared_zip=self.zip, at=self._path.with_stem(name))

    @property
    def filesystem_path(self):
        return Path(self.zip.path)

    @property
    def filesystem_file(self):
        return self.zip.path

    @property
    def real_file(self):
        return None

    @property
    def filesystem_parent(self):
        return self.zip.path.parent

    def stat(self):
        entry = self._get_our_entry(required=True)
        mode = stat.S_IFDIR if entry.is_dir else stat.S_IFREG
        timestamp = entry.timestamp.timestamp()
        timestamp_ns = int(timestamp*1000000000)
        return os.stat_result((
            mode, 0, 0, 1, 0, 0, entry.size,
            timestamp, timestamp, timestamp, # int atime, mtime, ctime
            timestamp, timestamp, timestamp, # float atime, mtime, ctime
            timestamp_ns, timestamp_ns, timestamp_ns, # atime_ns, mtime_ns, ctime_ns,
            timestamp, timestamp, # birthtime, birthtime_ns
        ))

    def scandir(self):
        entry = self.zip.directory.get(self._path)
        if entry is None:
            return

        for file in entry.keys():
            # The root directory is represented as a file in the root directory named "".
            # Don't include this as a file inside the root directory.
            if file == '':
                continue

            yield ZipPath(shared_zip=self.zip, at=self._path / file)

    def _get_our_entry(self, required=False):
        """
        Return the SharedZipFile directory entry for this file, or None if it
        doesn't exist.
        """
        # If this is the root, it's the ZIP itself.  Return this directly, so we can
        # handle queries about the root directory without opening and parsing the file.
        # For example, is_dir() should return True without spending time parsing the file.
        if self._path == _root:
            return self.zip.root_entry

        parent_path = self._path.parent
        parent_entry = self.zip.directory.get(parent_path)
        if parent_entry is None:
            if required:
                raise FileNotFoundError('File not found: %s' % self._path)
            return None

        result = parent_entry.get(self._path.name)
        if result is None and required:
            raise FileNotFoundError('File not found: %s' % self._path)
        return result

    def open(self, mode='r', *, shared=True):
        """
        Open a file in the ZIP.
        """
        # ZipFile supports this, but we don't use it and the patching going on
        # in open_file probably won't work.
        if 'w' in mode:
            raise IOError('Writing not supported for ZIPs')

        if self.is_dir():
            raise IsADirectoryError('Is a directory: %s' % self._path)

        entry = self._get_our_entry(required=True)
        if entry is None:
            raise FileNotFoundError('File not found: %s' % self._path)

        return self.zip.open_file(entry.zipinfo, mode, shared=shared)

    def unlink(self, missing_ok=True):
        raise OSError('Deleting files inside ZIPs not supported')
        
    def rename(self, target):
        raise OSError('Renaming files inside ZIPs not supported')

    def replace(self, target):
        raise OSError('Renaming files inside ZIPs not supported')

    @contextmanager
    def extract_file(self):
        temp_filename = f'vview-temp-{uuid.uuid4()}{self.suffix}'
        temp_file = Path(tempfile.gettempdir()) / temp_filename

        # Copy the file out.
        with self.open('rb') as src:
            with temp_file.open('wb') as dst:
                shutil.copyfileobj(src, dst)

        try:
            # Sync the temporary file's mtime to the input file's.
            st = self.stat()
            os.utime(temp_file, (st.st_atime, st.st_mtime))

            yield temp_file
        finally:
            temp_file.unlink(missing_ok=True)
