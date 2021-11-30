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

    def is_real_dir(self):
        """
        This is like is_dir, but returns false if this is a ZIP.

        is_dir() treats ZIPs like directories, since they can be opened like one
        and treated transparently.  is_real_dir can be used to see if a path is a
        real filesystem directory.
        """
        return self.is_dir()

    def with_name(self, name): raise NotImplemented

    @property
    def real_file(self):
        """
        If this is an actual file on the filesystem, return its Path.  Otherwise,
        return None.
        """
        raise NotImplemented

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
        """
        raise NotImplemented

    def scandir(self):
        """
        Iterate over the files in this directory.
        """
        raise NotImplemented

    def open(self, mode='r', *, shared=True):
        """
        Open the file.  If shared is true, disable filesystem locking.
        """
        raise NotImplemented
