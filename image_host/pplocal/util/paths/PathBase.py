
class PathBase:
    """
    A base class which wraps the various path APIs to make them more consistent.

    Python has a bunch of related but painfully inconsistent APIs.
    """
    @property
    def path(self):
        raise NotImplemented

    @property
    def name(self):
        """
        Return the basename of the path.
        """
        raise NotImplemented

    # These are the same as on Path.
    def __fspath__(self): raise NotImplemented
    def __truediv__(self, name): raise NotImplemented
    def exists(self): raise NotImplemented

    def relative_to(self, path):
        return self.path.relative_to(path)

    @property
    def parent(self):
        """
        Return this file's parent.  If this is a ZIP, this will traverse out of the
        ZIP into the containing filesystem.
        """
        return self.path.parent

    @property
    def suffix(self): raise NotImplemented

    @property
    def parts(self): return self.path.parts

    def is_file(self): raise NotImplemented
    def is_dir(self): raise NotImplemented

    def with_name(self, name): raise NotImplemented

    @property
    def filesystem_path(self):
        """
        Return a Path object for the file on disk containing this file.

        For regular paths, this is the same as path.  For ZIPs, this is the ZIP.
        """
        raise NotImplemented

    @property
    def filesystem_parent(self):
        """
        Return the directory metadata for this path is stored in.

        For filesystem files, this is the parent directory.  For filesystem directories,
        it's the directory itself.  For files inside ZIPs, it's the directory the ZIP
        is contained in.
        """
        raise NotImplemented

    def stat(self):
        """
        Return stat_result.

        If a DirEntry is available, that stat will be returned to avoid extra file I/O.
        If a complete stat is required, see direct_stat().
        """
        raise NotImplemented

    def direct_stat(self):
        """
        Return the most complete stat_result available.

        This ignores DirEntry and makes an os.stat() call if required.
        """
        raise NotImplemented

    def iterdir(self):
        """
        Iterate over the files in this directory.
        """
        raise NotImplemented

    def open(self, mode='r', *, shared=True):
        """
        Open the file without taking filesystem locks.
        """
        raise NotImplemented
