# This gives an interface to Windows Search, returning results similar to
# os.scandir.

import time, os, stat
from pathlib import Path
from pprint import pprint

# Get this from pywin32, not from adodbapi:
try:
    import adodbapi
except ImportError as e:
    adodbapi = None
    print('Windows search not available: %s' % e)

# adodbapi seems to have no way to escape strings, and Search.CollatorDSO doesn't seem
# to support parameters at all.
def escape_sql(s):
    result = ''
    for c in s:
        if c == '\'':
            result += "'"
        result += c
    return result

FILE_ATTRIBUTE_READONLY = 0x01
FILE_ATTRIBUTE_DIRECTORY = 0x10

class SearchDirEntryStat:
    """
    This is an os.stat_result for SearchDirEntry.

    We don't use os.stat_result itself, since we want to calculate a few fields
    on-demand to avoid overhead when they aren't used.
    """
    def __init__(self, data):
        self._data = data

        self.st_size = data['System.Size']
        self._st_atime = None
        self._st_ctime = None
        self._st_mtime = None

        # System.FileAttributes is WIN32_FIND_DATA.dwFileAttributes.  Convert
        # it to st_mode in the same way Python does.
        attr = data['System.FileAttributes']
        if attr & FILE_ATTRIBUTE_DIRECTORY:
            mode = stat.S_IFDIR | 0o111
        else:
            mode = stat.S_IFREG

        if attr & FILE_ATTRIBUTE_READONLY:
            mode |= 0o444
        else:
            mode |= 0o666

        self.st_mode = mode

    def __repr__(self):
        fields = []
        for field in ('st_mode', 'st_ino', 'st_dev', 'st_size', 'st_atime', 'st_mtime', 'st_ctime'):
            fields.append('%s=%s' % (field, getattr(self, field)))
        return f'SearchDirEntryStat({ ", ".join(fields) })'

    # These fields aren't available.
    @property
    def st_ino(self): return 0
    @property
    def st_nlink(self): return 1
    @property
    def st_uid(self): return 0
    @property
    def st_gid(self): return 0
        
    # The only related field is System.VolumeId, but that's not the same
    # as BY_HANDLE_FILE_INFORMATION.dwVolumeSerialNumber.
    @property
    def st_dev(self): return 0

    # adodbapi's parsing for these timestamps is pretty slow and is the overwhelming
    # bottleneck if we parse it for all files.  Since most callers don't use all of
    # these, parse them on demand.
    #
    # time.timezone converts these from local time to UTC.
    @property
    def st_atime(self):
        if self._st_atime is not None:
            return self._st_atime

        self._st_atime = self._data['System.DateAccessed'].timestamp() - time.timezone
        return self._st_atime

    @property
    def st_ctime(self):
        if self._st_ctime is not None:
            return self._st_ctime

        self._st_ctime = self._data['System.DateCreated'].timestamp() - time.timezone
        return self._st_ctime

    @property
    def st_mtime(self):
        if self._st_mtime is not None:
            return self._st_mtime

        self._st_mtime = self._data['System.DateModified'].timestamp() - time.timezone
        return self._st_mtime

class SearchDirEntry(os.PathLike):
    """
    A DirEntry-like class for search results.

    This doesn't implement follow_symlinks, but accepts the parameter for
    compatibility with DirEntry.
    """
    def __init__(self, data):
        self._data = data
        self._path = data['System.ItemPathDisplay']
        self._stat = None

    @property
    def path(self):
        return self._path

    @property
    def name(self):
        return os.path.basename(self._path)

    @property
    def inode(self):
        return None

    def is_dir(self, *, follow_symlinks=True):
        return self._data['System.ItemType'] == 'Directory'

    def is_file(self, *, follow_symlinks=True):
        return self._data['System.ItemType'] != 'Directory'

    @property
    def is_symlink(self):
        return False

    def stat(self, *, follow_symlinks=True):
        if self._stat is not None:
            return self._stat

        self._stat = SearchDirEntryStat(self._data)
        return self._stat

    @property
    def data(self):
        pass

    def __fspath__(self):
        return _path

    def __repr__(self):
        return 'SearchDirEntry(%s)' % self._path

def search(*,
        path=None,

        # If set, return only the file with this exact path.
        exact_path=None,

        # Filter for files with this exact basename:
        filename=None,

        substr=None,
        bookmarked=None,
        recurse=True,
        contents=None,
        media_type=None, # "images" or "videos"
        sort_results=True,
        include_files=True,
        include_dirs=True,
    ):
    if adodbapi is None:
        return

    try:
        conn = adodbapi.connect('Provider=Search.CollatorDSO; Extended Properties="Application=Windows"')
    except Exception as e:
        print('Couldn\'t connect to search: %s' % str(e))
        return

    select = [
        # These fields are required for SearchDirEntry.
        'System.ItemPathDisplay',
        'System.ItemType',
        'System.DateAccessed',
        'System.DateModified',
        'System.DateCreated',
        'System.FileAttributes',
        'System.Size',

        # The rest are optional.
        'System.Rating',
        'System.Image.HorizontalSize',
        'System.Image.VerticalSize',
        'System.Keywords',
        'System.ItemAuthors',
        'System.Title',
        'System.Comment',
        'System.MIMEType',
    ]

    where = []
    if path is not None:
        # If we're recursing, limit the search with scope.  If not, filter on
        # the parent directory.
        if recurse:
            where.append("scope = '%s'" % escape_sql(str(path)))
        else:
            where.append("directory = '%s'" % escape_sql(str(path)))

    if exact_path is not None:
        where.append("System.ItemPathDisplay = '%s'" % escape_sql(str(exact_path)))
    if contents:
        where.append("""CONTAINS(System.Search.Contents, '"%s"')""" % escape_sql(str(contents)))
    if filename is not None:
        where.append("System.FileName = '%s'" % escape_sql(str(filename)))
        
    # Add filters.
    if substr is not None:
        for word in substr.split(' '):
            # Note that the double-escaping is required to make substring searches
            # work.  '"file*"' will prefix match "file*", but 'file*' won't.  This
            # seems to be efficient at prefix and suffix matches.
            where.append("""CONTAINS(System.FileName, '"*%s*"')""" % escape_sql(word))

    if not include_files:
        where.append("System.ItemType = 'Directory'")
    if not include_dirs:
        where.append("System.ItemType != 'Directory'")

    if media_type == 'images':
        where.append("System.Kind = 'picture'")
    elif media_type == 'videos':
        where.append("System.Kind = 'video'")

    # where.append("(System.ItemType = 'Directory' OR System.Kind = 'picture' OR System.Kind = 'video')")

    # System.Rating is null for no rating, and 1, 25, 50, 75, 99 for 1, 2, 3, 4, 5
    # stars.  It's a bit weird, but we only use it for bookmarking.  Any image with 50 or
    # higher rating is considered bookmarked.
    if bookmarked:
        where.append("System.Rating >= 50")

    # If sorT_results is true, sort directories first, then alphabetical.  This is
    # useful but makes the search slower.
    order = ''
    if sort_results:
        order = "ORDER BY System.FolderNameDisplay, System.FileName ASC"

    query = f"""
        SELECT {', '.join(select)}
        FROM SystemIndex 
        WHERE {' AND '.join(where)}
        {order}
    """

    try:
        with conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                for row in cursor:
                    entry = SearchDirEntry(row)
                    yield entry

    except Exception as e:
        print('Windows search error:', e)

def test():
    path=Path(r'F:\stuff\ppixiv\image_host')
    for entry in search(path=path, contents='test'):
        if entry is None:
            continue

        print(entry.stat())
        st = os.stat(entry.path)
        # print(entry.is_file())
        # print(entry.is_dir())

if __name__ == '__main__':
    test()
