import os, stat, zipfile
from collections import namedtuple
from pathlib import Path, PurePosixPath
from datetime import datetime
from pprint import pprint

from .PathBase import PathBase


ZipPathInfo = namedtuple('ZipPathInfo', (
    'name', # The basename of the file
    'zip_path', # The original path of the file inside the ZIP, which is needed to open it
    'size',
    'is_dir',
    'mtime'))

class SharedZipFile:
    """
    This object is shared by all ZipPath instances on the same ZIP, and holds the opened
    ZIP and file directory.

    The ZIP isn't opened until zipfile or directory are accessed.
    """
    def __init__(self, path):
        self.path = path
        self._directory = None
        self._zip = None

    def _open_zip(self):
        if self._zip is not None:
            return

        self._zip = zipfile.ZipFile(self.path.open('rb'))

        # Create a directory hierarchy.
        directory = {}
        
        for entry in self._zip.infolist():
            filename = '/' / Path(entry.filename)

            time = datetime(*entry.date_time)
            entry = ZipPathInfo(filename.name, entry.filename, entry.file_size, entry.is_dir(), time)

            while True:
                # Add this path to its parent.
                parent = directory.setdefault(filename.parent, {})
                parent[filename.name] = entry

                # Move up the hierarchy to make sure all parent directories exist. If this
                # creates a directory entry, use this file's mtime as the directory's
                # mtime.  Stop if we've reached the root.
                parent = filename.parent
                if parent == filename:
                    break

                filename = parent
                entry = ZipPathInfo(str(filename.name), None, 0, True, entry.mtime)

        self._directory = directory

        return self._zip

    @property
    def zipfile(self):
        self._open_zip()
        return self._zip

    @property
    def directory(self):
        self._open_zip()
        return self._directory

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
        return self._path.name
        
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
    def suffix(self):
        return self._path.suffix

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
        
    def with_name(self, name):
        return ZipPath(shared_zip=self.zip, at=self._path.with_name(name))

    @property
    def filesystem_path(self):
        return Path(self.zip.path)

    @property
    def real_file(self):
        return None

    @property
    def filesystem_parent(self):
        return self.zip.path.parent

    def stat(self):
        entry = self._get_our_entry(required=True)
        mode = stat.S_IFDIR if entry.is_dir else stat.S_IFREG
        mtime = entry.mtime.timestamp()
        mtime_ns = int(mtime*1000000000)
        return os.stat_result((
            mode, 0, 0, 1, 0, 0, entry.size,
            mtime, mtime, mtime, # int atime, mtime, ctime
            mtime, mtime, mtime, # float atime, mtime, ctime
            mtime_ns, mtime_ns, mtime_ns, # atime_ns, mtime_ns, ctime_ns
        ))

    def iterdir(self):
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
        entry = self._get_our_entry(required=True)

        # Somehow, zipfile.Path.open supports the binary flag, but ZipFile.open doesn't
        # (it only opens in binary).  Meanwhile, asyncio.base_events refuses to work
        # with files that don't have "b" in the mode, which is really ugly behavior
        # since it takes a minor problem and turns it into a big one.  It should only
        # log a warning, not break the application.
        #
        # Work around this mess by overwriting the mode on the opened file.
        real_mode = mode
        mode = mode.replace('b', '')
            
        file = self.zip.zipfile.open(entry.zip_path, mode)
        file.mode = real_mode
        return file
