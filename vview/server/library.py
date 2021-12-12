# This implements indexing for file searching.
#
# Keyword searches use Windows's file indexing.  It avoids duplicating the
# indexing work and keeps what we're doing lightweight.
# 
# Files are cached in our database.  During initial scanning we search for
# bookmarked files by looking for our metadata files, and cache the files.
# These cache entries are unpopulated: they only have the data we can get from
# the file entry, plus any bookmarking data.  This allows us to do searches
# for bookmarked files, which Windows's search won't do, but we don't spend
# a lot of time reading files if the user has thousands of bookmarks.
#
# An unpopulated entry is a placeholder, created by _get_placeholder_entry.
# This can be stored in the database, or it can be created as a temporary
# entry from a Windows search result.  We populate entries as we return them,
# so if we're returning the first 50 results of 1000, we only spend time reading
# the 50 files we're returning.  The populated data is then cached in the database,
# replacing any unpopulated entry, so we only have to do this once per file.
#
# We don't proactively remove entries from the database if they're deleted from
# disk.  We only delete them if a search sees them and finds that the file no
# longer exists.  This usually happens when _get_entry checks the mtime of the file.
#
# A limitation of this is that we can't search on file metadata that we can't get
# from Windows search.
#
# Paths are stored in the database as strings, and entries internally stay that
# way.  We only convert paths to BasePath in public APIs (see _convert_to_path).
#
# XXX: how can we detect if indexing is enabled on our directory
# XXX: we shouldn't do a full refresh on changes, but not sure how to find out if
# indexing is up to date for a path in order to use quick refresh

import asyncio, collections, errno, itertools, os, time, traceback, json, heapq, natsort, random, math
from pprint import pprint
from pathlib import Path, PurePosixPath

from ..util import monitor_changes, windows_search, misc, inpainting
from . import metadata_storage
from ..database.file_index import FileIndex
from ..util.paths import open_path, PathBase
from ..util.misc import TransientWriteConnection

# Sort orders that we can use for listing and searching.
#
# Search sorts need to be handled in three places: our database, Windows search, and directly
# to allow us to merge the other two together.  The searches must match exactly, or merging
# will fail.
#
# Filesystem ("fs") sorts are used by Library.list, and sort BasePaths.  This lets us sort items
# before retrieving their entries.
sort_orders = {
    # Normal sorting puts directories first, then sorts by path.
    #
    # This is constrained by Windows search, which isn't very robust.  We want to sort directories
    # first, then use the path as a secondary search.
    #
    # Windows search won't do that.  It has System.FolderNameDisplay which is intended for
    # sorting directories first, but it's not implemented well.  It's the basename of the path
    # for directories, which makes it impossible to have secondary sorts.  It should be a boolean,
    # so it can be used as a partial sort.
    #
    # It does treat ZIPs as directories.  That's unexpected, but it's what we want, so we'll take
    # it.
    'normal': {
        'windows': [('System.FolderNameDisplay', 'DESC'), ('System.ItemPathDisplay', 'ASC')],
        'entry': lambda entry: (not entry['is_directory'], entry['filesystem_name'].lower()),
        'index': [('is_directory', 'DESC'), ('filesystem_name', 'ASC')],
        'fs': lambda entry: (not entry.is_dir(), entry.name),
    },

    # Creation time, older first.
    'ctime': {
        # Note that even though NTFS has subsecond ctimes, Windows indexing truncates them to
        # an integer.  Do the same thing when comparing from other sources to make sure they
        # sort the same way, otherwise merge sorts won't work properly.
        #
        # Using the path as a secondary sort to break ties to make sure the order is consistent
        # is also needed for the merge to work.
        'windows': [('System.DateCreated', 'ASC'), ('System.ItemPathDisplay', 'ASC')],
        'entry': lambda entry: (math.floor(entry['ctime']), entry['filesystem_name'].lower()),

        # SQLite doesn't have floor(), so do it with round() instead.
        'index': [('round(ctime - 0.5)', 'ASC'), ('filesystem_name', 'ASC')],
        'fs': lambda entry: (math.floor(entry.stat().st_ctime), entry.name),
    },

    # A natural sort.  This also puts directories first, but sorts numbered files much better.
    # This isn't supported for searching, but it's mostly useful for viewing single directories.
    # This is the default sort for Library.list.
    'natural': {
        'fs': lambda entry: (not entry.is_dir(), *natsort.natsort_key(entry.name)),
    }
}

def _get_sort(sort_order):
    """
    Return info for a sort order.

    This is in the same format as sort_orders above, except:

    - SQL orders are flattened to an ORDER BY clause.
    - A "reverse" key is added, which is true if sort_order begins with "-".
    - If reversed, SQL orders are inversed.
    """
    # If the sort order begins with '-', remove it and set the 'reversed' flag in
    # the results.
    reverse_order = sort_order.startswith('-')
    if reverse_order:
        sort_order = sort_order.lstrip('-')

    order = sort_orders.get(sort_order)
    if order is None:
        print('Unsupported sort order: %s' % sort_order)
        return None

    order = dict(order)
    order['reverse'] = reverse_order

    # If this sort order is reversed, reverse the SQL ORDER BY sorts.
    if reverse_order:
        for order_type in 'windows', 'index':
            if order_type not in order:
                continue

            new_order_by = []
            for field, asc_desc in order[order_type]:
                assert asc_desc in ('ASC', 'DESC'), asc_desc
                asc_desc = 'DESC' if asc_desc == 'ASC' else 'ASC'
                new_order_by.append((field, asc_desc))
            
            order[order_type] = new_order_by

    # Flatten the SQL orderings to ORDER BY clauses.
    for order_type in 'windows', 'index':
        if order_type not in order:
            continue

        order[order_type] = 'ORDER BY ' + ', '.join('%s %s' % (key, asc_desc) for key, asc_desc in order[order_type])

    return order

class Library:
    """
    Handle indexing and searching for a directory tree.

    This handles a single root directory.  To index multiple directories, create
    multiple libraries.
    """
    def __init__(self, data_dir):
        self.mounts = {}
        self.monitors = {}
        self._data_dir = data_dir

        # Open our database.
        dbpath = self.data_dir / 'index.sqlite'
        self.db = FileIndex(dbpath)

        # self.update_pending_files_task = asyncio.create_task(self.update_pending_files(), name='LibraryUpdate')

    def mount(self, path, name=None):
        path = open_path(path)
        if name is None:
            name = path.name

        assert name not in self.mounts
        self.mounts[name] = path

        self.monitor(name)

    async def unmount(self, name):
        if name not in self.mounts:
            print('unmount(%s): Path wasn\'t mounted' % name)
            return

        await self.stop_monitoring(name)
        del self.mounts[name]

    def shutdown(self):
        pass
    
    @property
    def data_dir(self):
        """
        Return the top directory we use for storing data related to this library.
        """
        return self._data_dir

    def get_public_path(self, path):
        r"""
        Given an absolute filesystem path inside this library, return the API path.
        
        For example, if the mount named "images" points to "C:\SomeImages" and path is
        "C:\SomeImages\path\image.jpg", return "/images/path/image.jpg".
        """
        for mount_name, mount_path in self.mounts.items():
            try:
                relative_path = path.relative_to(mount_path)
            except ValueError:
                continue

            return PurePosixPath('/' + mount_name) / relative_path

        return PurePosixPath('/root') / str(path).replace('\\', '/')

    def get_mount_for_path(self, path):
        for mount_name, mount_path in self.mounts.items():
            try:
                path.filesystem_path.relative_to(mount_path)
            except ValueError:
                continue

            return mount_name

        return None

    @classmethod
    def split_library_name_and_path(cls, path):
        """
        Given an id, eg. "file:/library/path1/path2/path3", return ('library', 'path1/path2/path3').
        """
        # The root doesn't correspond to an library.
        if path == '/':
            raise misc.Error('invalid-request', 'Invalid request')

        # The path is always absolute.
        if not str(path).startswith('/'):
            raise misc.Error('not-found', 'Path must begin with a /: %s' % path)

        # Split the library name from the path.
        library_name = path.parts[1]
        path = PurePosixPath('/'.join(path.parts[2:]))
        return library_name, path

    async def quick_refresh(self, paths=None):
        """
        Do a quick refresh of the library.

        This uses Windows Search to find directories with our metadata, and refreshes just
        those directories.

        This currently doesn't remove bookmarks from the database that no longer exist.
        """
        if paths is None:
            paths = self.mounts

        for path in paths.values():
            # XXX: don't hold the db open for the entire update
            with self.db.connect() as conn:
                # Find all metadata files.
                for result in windows_search.search(paths=[str(path)], filename=metadata_storage.metadata_filename):
                    path = open_path(result.path)
                    await self._refresh_metadata_file(path, conn=conn)

    async def refresh(self, *, paths=None):
        """
        Refresh the library.

        This does the same thing as quick_refresh, but scans the filesystem manually
        rather than using Windows search.
        """
        if paths is None:
            paths = self.mounts.values()

        refreshed = 0
        total_refresh = 0

        import queue
        pending_paths = queue.LifoQueue()
        for path in paths:
            pending_paths.put(path)
            total_refresh += 1

        # Use a transient write connection, so we can periodically release the connection.
        write_connection = TransientWriteConnection(self.db)

        while not pending_paths.empty():
            if total_refresh > 1 and (refreshed % 1000) == 0:
                print('Refreshing %i/%i (%i left)' % (refreshed, total_refresh, pending_paths.qsize()))

                # Periodically release the write lock.
                write_connection.commit()

            path = pending_paths.get()
            refreshed += 1

            # Make sure path is inside this library.
            if self.get_mount_for_path(path) is None:
                print('Path %s isn\'t mounted' % path)
                continue

            # Let other tasks run periodically.
            await asyncio.sleep(0)

            for child in path.scandir():
                if child.is_real_dir():
                    pending_paths.put(child)
                    total_refresh += 1
                elif child.name == metadata_storage.metadata_filename:
                    with write_connection as conn:
                        await self._refresh_metadata_file(child, conn=conn)

    async def _refresh_metadata_file(self, metadata_file, *, conn):
        assert metadata_file.name == metadata_storage.metadata_filename
                    
        # Refresh just files with metadata.
        for path in metadata_storage.get_files_with_metadata(metadata_file):
            try:
                # This file has metadata (usually a bookmark), so add it to the database.
                # We might be adding thousands of files here, so only add an unpopulated entry.
                # This imports bookmarrks, and any other metadata we stashed away in the
                # metadata files.
                self._get_entry(path=path, conn=conn, populate=False)
            except FileNotFoundError as e:
                print('Bookmarked file %s doesn\'t exist' % path)
                continue

    def monitor(self, mount):
        """
        Begin monitoring our directory for changes that need to be indexed.
        """
        if self.monitors.get(mount) is not None:
            return

        path = self.mounts.get(mount)
        if path is None:
            raise ValueError('Mount doesn\'t exist: %s' % mount)

        monitor = monitor_changes.MonitorChanges(path.path)
        task = asyncio.create_task(monitor.monitor_call(self.monitored_file_changed), name='MonitorChanges(%s)' % (mount))
        self.monitors[mount] = task
        print('Started monitoring: %s' % path)

    async def stop_monitoring(self, mount):
        """
        Stop monitoring for changes.
        """
        if mount not in self.monitors:
            return

        path = self.mounts.get(mount)
        if path is None:
            raise ValueError('Mount doesn\'t exist: %s' % mount)

        task = self.monitors.pop(mount)
        task.cancel()
        await task

        print('Stopped monitoring: %s' % path)

    async def monitored_file_changed(self, path, old_path, action):
        path = open_path(path)
        await self.handle_update(path=path, old_path=old_path, action=action)

    async def handle_update(self, path, action, *, old_path=None, db_conn=None):
        """
        This is called to update a changed path.  This can be called during an explicit
        refresh, or from file monitoring.

        If db_conn isn't None, it's the database connection returned from this.db.begin()
        to use to store changes.  This allows batching our updates into a single transaction
        for performance.

        path may be a string.  We'll only convert it to a Path if necessary, since doing this
        for every file is slow.
        """
        # If we receive FILE_ACTION_ADDED for a directory, a directory was either created or
        # moved into our tree.  Scan it for metadata files.  We can't use a quick refresh
        # here, since we often get here before Windows's indexing has caught up.
        if action == monitor_changes.FileAction.FILE_ACTION_ADDED:
            # We don't care about files being added, only directories.
            if not path.is_real_dir():
                return

            print('Refreshing added directory: %s' % path)
            await self.refresh(paths=[path])

    def _get_entry_from_path(self, path: os.PathLike, *, populate=True, extra_metadata=None):
        """
        Return an entry from a path.
        
        This creates a new entry from the file without accessing the database.  The
        entry isn't saved to the database.

        If populate is false, return a fast placeholder entry.  Otherwise, read the file to
        create a full entry.

        If extra_metadata is set, it can include metadata that the caller has available to
        populate fields, even if a placeholder is being returned:
        - width
        - height
        """
        if not path.exists():
            return None
            
        # Create the appropriate entry type.
        if not populate:
            entry = self._get_placeholder_entry(path)
        elif path.is_dir():
            entry = self._create_directory_record(path)
        else:
            entry = self._create_file_record(path)

        if entry is None:
            return None

        # Read file metadata.
        file_metadata = metadata_storage.load_file_metadata(path)

        # If additional metadata was provided, use it too.  This lets us use data from
        # windows_search.SearchDirEntry.
        if extra_metadata is not None:
            file_metadata = collections.ChainMap(file_metadata, extra_metadata)

        # If we have any extra metadata, add it.  For example, while _create_file_record
        # will read the width and height from the file, this allows us to include it
        # if we're returning a placeholder, but the dimensions are available from the
        # metadata file or from a Windows search result.
        #
        # Don't overwrite data that we got from the file directly.
        entry['bookmarked'] = file_metadata.get('bookmarked', False)
        entry['bookmark_tags'] = file_metadata.get('bookmark_tags', '')
        if 'width' not in entry:
            entry['width'] = file_metadata.get('width')
        if 'height' not in entry:
            entry['height'] = file_metadata.get('height')
        if 'aspect_ratio' not in entry:
            entry['aspect_ratio'] = (entry['width'] / entry['height']) if entry.get('height') else None
        entry['inpaint'] = json.dumps(file_metadata['inpaint']) if 'inpaint' in file_metadata else None
        entry['inpaint_id'] = file_metadata.get('inpaint_id')

        if 'inpaint_id' in file_metadata:
            # Only import inpaint_timestamp if we've actually created the inpaint file.
            # Otherwise, leave it unset until we create it, so the thumbnail URL will change
            # when it's created.
            inpaint_path = inpainting.get_inpaint_cache_path(entry['inpaint_id'], data_dir=self._data_dir)
            if inpaint_path.exists() and 'inpaint_timestamp' in file_metadata:
                entry['inpaint_timestamp'] = file_metadata['inpaint_timestamp']
        else:
                entry['inpaint_timestamp'] = 0

        return entry

    def cache_file(self, *args, **kwargs):
        """
        Create or update the index entry for a file.

        If populate is true, the file will be read and all data will be available.

        If populate is false, an unpopulated entry will be cached, which only has
        data we can extract from the path entry.  The entry will be populated the
        first time it's returned from search results.
        """
        entry = self._cache_file(*args, **kwargs)
        if entry is None:
            return None
        self._convert_to_path(entry)
        return entry

    # The only difference between cache_file and _cache_file is that cache_file is
    # public, so it returns path objects, and _cache_file is internal, so it leaves
    # paths as strings.
    def _cache_file(self, path: os.PathLike, *, populate=True, conn=None):
        entry = self._get_entry_from_path(path)
        if entry is None:
            return None

        self.db.add_record(entry, conn=conn)
        return entry

    def _create_file_record(self, path: os.PathLike):
        mime_type = misc.mime_type(os.fspath(path))
        if mime_type is None:
            # This file type isn't supported.
            return None
        
        stat = path.stat()

        # Open the file with all share modes active, so we don't lock the file and interfere
        # with the user working with the file.
        with path.open('rb', shared=True) as f:
            media_metadata = misc.read_metadata(f, mime_type)
        
        width = media_metadata.get('width')
        height = media_metadata.get('height')
        title = media_metadata.get('title', '')
        comment = media_metadata.get('comment', '')
        artist = media_metadata.get('artist', '')
        tags = media_metadata.get('tags', '')
        codec = media_metadata.get('codec', '')
        animation = media_metadata.get('animation', False)
        duration = media_metadata.get('duration')

        if not title:
            title = path.name

        data = {
            'populated': True,
            'path': os.fspath(path),
            'is_directory': False,
            'parent': str(Path(path).parent),
            'ctime': stat.st_ctime,
            'mtime': stat.st_mtime,
            'filesystem_name': path.name.lower(),
            'filesystem_mtime': path.filesystem_file.stat().st_mtime,
            'title': title,
            'mime_type': mime_type,
            'tags': tags,
            'comment': comment,
            'author': artist,
            'width': width,
            'height': height,
            'codec': codec,
            'animation': animation,
            'duration': duration,
        }

        return data

    def _create_directory_record(self, path: os.PathLike):
        stat = path.stat()

        data = {
            'populated': True,
            'path': os.fspath(path),
            'filesystem_name': path.filesystem_file.name.lower(),
            'is_directory': True,
            'parent': str(Path(path).parent),
            'ctime': stat.st_ctime,
            'mtime': stat.st_mtime,
            'filesystem_mtime': path.filesystem_file.stat().st_mtime,
            'title': path.name,
            'mime_type': 'application/folder',

            # We currently don't support these for directories:
            'tags': '',
            'comment': '',
            'author': '',
        }

        return data

    def _get_placeholder_entry(self, path: os.PathLike):
        """
        Return a placeholder entry.

        This is an unpopulated entry, which only contains data that we can get from a
        DirEntry.  This allows treating search results as entries and doing very fast
        matching against them, before actually doing any time-consuming file caching.

        XXX: store these in the db too during refreshes and only do the full populate later
        XXX: make sure cache_file includes bookmark_data
        """
        if path.is_dir():
            mime_type = 'application/folder'
        else:
            mime_type = misc.mime_type(os.fspath(path))
            if mime_type is None:
                # This file type isn't supported.
                return None

        stat = path.stat()
        return {
            'populated': False,
            'path': os.fspath(path),
            'filesystem_name': path.filesystem_file.name.lower(),
            'filesystem_mtime': path.filesystem_file.stat().st_mtime,
            'is_directory': path.is_dir(),
            'parent': str(Path(path).parent),
            'ctime': stat.st_ctime,
            'mtime': stat.st_mtime,
            'mime_type': mime_type,
            'title': '',
            'tags': '',
            'comment': '',
            'author': '',
        }

    def get(self, path):
        """
        Get the entry for a single file.
        """
        entry = self._get_entry(path)

        self._convert_to_path(entry)
        return entry

    def list(self,
        paths,
        *,
        sort_order='normal',
        force_refresh=False,
        include_files=True,
        include_dirs=True,
        batch_size=50,
    ):
        """
        Return all files inside each path non-recursively.
        """
        if not paths:
            paths = self.mounts.values()

        # The normal sort for directory listings is the natural sort.  Substitute it
        # here, so the caller doesn't need to figure it out.
        if sort_order == 'normal':
            sort_order = 'natural'
        elif sort_order == '-normal':
            sort_order = '-natural'

        # Run scandir for each path, and chain them together into a single iterator.
        iterators = []
        for path in paths:
            iterators.append(path.scandir())
        scandir_results = itertools.chain(*iterators)

        # If we have a sort order, read the full results and sort.  If we aren't sorting,
        # leave iter as an iterator so we'll read it incrementally.
        if sort_order == 'shuffle':
            scandir_results = list(scandir_results)
            random.shuffle(scandir_results)
            scandir_results = iter(scandir_results)
        elif sort_order is not None:
            sort_order_info = _get_sort(sort_order)
            if sort_order_info is not None:
                sorted_results = list(scandir_results)
                sorted_results.sort(key=sort_order_info['fs'], reverse=sort_order_info['reverse'])

                # Convert back to an iterator.
                scandir_results = iter(sorted_results)

        # Use TransientWriteConnection to commit the transaction during yields.
        write_connection = TransientWriteConnection(self.db)
        results = []
        for child in scandir_results:
            is_dir = child.is_dir()

            # Skip unsupported files.
            if not is_dir and misc.file_type(child.name) is None:
                continue

            if not include_dirs and is_dir:
                continue
            if not include_files and not is_dir:
                continue

            # Find the file in cache and cache it if needed.
            with write_connection as conn:
                entry = self._get_entry(child, force_refresh=force_refresh, conn=conn)
            if entry is None:
                continue

            self._convert_to_path(entry)
            results.append(entry)

            # If we have a full batch, stop iterating and return it.
            if len(results) >= batch_size:
                write_connection.commit()
                yield results
                results = []
            
        write_connection.commit()
        if results:
            yield results

    def get_mountpoint_entries(self):
        """
        Return entries for each mountpoint.
        """
        results = []
        with self.db.connect() as conn:
            for mount_name, mount_path in self.mounts.items():
                entry = self._get_entry(mount_path, conn=conn)
                assert entry is not None
                
                self._convert_to_path(entry)
                results.append(entry)
        return results

    def _entry_is_up_to_date(self, entry):
        """
        Check an entry against its file on disk to check that the file still
        exists, and the entry is up to date.  Return true if the entry is up-to-date,
        or false if the entry is stale or the file no longer exists.
        """
        # Check if cache is out of date.  If this is a ZIP, we're checking the mtime
        # of the ZIP itself, so we don't read the ZIP directory here.
        try:
            path = open_path(entry['path'])
            path_stat = path.filesystem_file.stat()
        except OSError as e:
            # The only common error is ENOENT, but treat any error as stale.
            if e.errno != errno.ENOENT:
                print('Error checking entry %s: %s' % (path.filesystem_file, str(e)))
            return False

        # The entry is stale if the timestamp of the file matches the timestamp on the entry.
        return abs(entry['filesystem_mtime'] - path_stat.st_mtime) < 1

    def _get_entry(self, path, *,
        # If true, ignore any cached data in the database and always load from the file.
        force_refresh=False,
        check_mtime=True,

        # If false and the file isn't cached, cache an unpopulated entry.
        populate=True,
        conn=None):
        """
        Return the entry for path.  If the path isn't cached, populate the cache entry.

        If force_refresh is true, always repopulate the cache entry.
        """
        entry = None
        if not force_refresh:
            entry = self.db.get(path=os.fspath(path), conn=conn)

        # If the entry isn't populated and we're populating, ignore the database entry, so
        # we'll populate it.
        if entry is not None and populate and not entry['populated']:
            entry = None

        if entry is not None and check_mtime:
            # Check if this entry exists on disk and is up to date.
            if not self._entry_is_up_to_date(entry):
                # Clear entry, so we'll re-cache it below.
                entry = None

        if entry is None:
            # The file needs to be cached.
            entry = self._cache_file(path, conn=conn, populate=populate)
            if entry is None:
                # The file doesn't exist on disk.  Delete any stale entries pointing at
                # it.
                # print('Path doesn\'t exist, purging any cached entries: %s' % path)
                self.db.delete_recursively([path], conn=conn)

        if entry is None:
            return None

        return entry

    def _convert_to_path(self, entry):
        """
        FileIndex only deals with string paths.  Our API uses BasePath.  Convert paths
        in entry from strings to BasePath.
        """
        entry['path'] = open_path(entry['path'])
        entry['parent'] = open_path(entry['parent'])

    # Searching is a bit tricky.  We have a few things we want to do:
    #
    # - Read both Windows Search and our index, returning results from both.
    # - Windows Search needs to be read incrementally, since it might be a very
    # large search.
    # - Yield data in batches.  Open a database connection while reading a batch,
    # so we save any new cached data in a single transaction, but don't keep the
    # transaction open while yielding, or we can hold a write lock indefinitely.
    # - If sorting is enabled, request sorted data from both Windows and our index,
    # and merge the two together as we go.
    #
    # See Library.list  for a simpler example of batching.
    #
    # We use separate database connections for windows_search and our index search.
    # The windows_search iterator can write to the database, so we need to close and
    # commit that connection when we yield results.  Our index search never writes to
    # the database (we're reading already cached entries), and we can't close the
    # read connection for db.search.
    #
    # Note that while we must match the sort order, it's normal for the two searches
    # to match differently, such as having different keyword matching.
    def search(self, *,
        paths=None,
        use_windows_search=True,
        use_index=True,
        sort_order='normal',
        batch_size=50,

        # If true, check that search results from the database actually exist on disk.
        verify_files=True,
        **search_options):
        if not paths:
            paths = self.mounts.values()

        assert paths

        sort_order_info = _get_sort(sort_order)

        # if the sort order is shuffle, disable sorting within the actual searches.
        shuffle = sort_order == 'shuffle'
        if shuffle:
            sort_order_info = None

        # A sort order needs these keys to be used with searching.
        if sort_order_info is not None:
            for key in ('entry', 'index', 'windows'):
                if key not in sort_order_info:
                    print(f'Sort "{sort_order}" not supported for searching')
                    sort_order_info = sort_orders['normal']
                    break

        # Normally, disable the timeout for the Windows search.  The search cursor is kept
        # between page loads and the user might take a long time before loading the next
        # page, and if we use a timeout, the query will time out while it waits.  Set a
        # timeout if shuffling is enabled, since we'll be reading the whole result set at
        # once and it might match tons of files.
        #
        # We don't actually want the request to get stuck if a request is made that takes
        # a very long time, but we don't have a way to cancel it currently.
        windows_search_timeout = 5 if shuffle else 0

        # Don't use Windows search when searching bookmarks.  Bookmarks are always indexed,
        # and the search doesn't help us with them.
        if search_options.get('bookmarked') or search_options.get('bookmark_tags') is not None:
            use_windows_search = False

        # Create the Windows search.
        if use_windows_search:
            order = sort_order_info['windows'] if sort_order_info else None
            windows_search_iter = windows_search.search(paths=[str(path) for path in paths], order=order, timeout=windows_search_timeout, **search_options)
        else:
            windows_search_iter = []

        # Create the index search.
        if use_index:
            order = sort_order_info['index'] if sort_order_info else None
            index_search_iter = self.db.search(paths=[str(path) for path in paths], order=order, **search_options)
        else:
            index_search_iter = []

        # This is only used for database writes, and is always disconnected before yielding
        # a block of results.
        write_connection = TransientWriteConnection(self.db)

        # We can get the same results from Windows search and our own index.  
        seen_paths = set()

        def get_entry_from_result(result):
            if result is windows_search.SearchTimeout:
                # This is just a signal that the Windows search timed out.  We only enable timeouts
                # for shuffled searches, in case they match tons of results.
                return None
            elif isinstance(result, windows_search.SearchDirEntry):
                # print('Search result from Windows:', result.path)
                if result.path in seen_paths:
                    return
                seen_paths.add(result.path)

                # Get a fast placeholder entry for this result.  This doesn't hit the database
                # or read the file.
                path = open_path(result.path)
                return self._get_entry_from_path(path, populate=False, extra_metadata=result.metadata)
            else:
                # print('Search result from database:', entry['id'], entry['filesystem_name'])
                if str(result['path']) in seen_paths:
                    return
                seen_paths.add(str(result['path']))

                return result

        if shuffle:
            # If we're shuffling, read both iterators all the way through and shuffle them.
            # This is set up so we only run the search and don't call Library.get() at this
            # point, so we only run file caching for results as we return them.
            all_results = list(windows_search_iter) + list(index_search_iter)
            random.shuffle(all_results)

            def get_shuffled_results():
                for result in all_results:
                    entry = get_entry_from_result(result)
                    if entry is not None:
                        yield entry

            final_search = get_shuffled_results()
        else:
            # We now have our two generators to run the searches.  get_results_from_index and
            # get_results_from_search iterate through those and yield entries.
            def get_results_from_index():
                for result in index_search_iter:
                    entry = get_entry_from_result(result)
                    if entry is not None:
                        yield entry

            def get_results_from_search():
                for result in windows_search_iter:
                    entry = get_entry_from_result(result)
                    if entry is not None:
                        yield entry

            # Create the iterators for both searches.
            search_results_iter = get_results_from_search()
            index_results_iter = get_results_from_index()

            # If we're sorting, use heapq.merge to merge the two together.  Otherwise, just chain them.
            if sort_order_info:
                final_search = heapq.merge(search_results_iter, index_results_iter, key=sort_order_info['entry'], reverse=sort_order_info['reverse'])
            else:
                final_search = itertools.chain(search_results_iter, index_results_iter)

        # Iterate over the final search, returning it in batches.
        results = []
        for entry in final_search:
            if entry is None:
                continue

            # If this entry isn't populated, populate it now.
            if not entry['populated']:
                with write_connection as connection:
                    # We have a subset of data in the unpopulated entry.  It'll always have the
                    # filename, keyword, etc., and it may or may not have file-specific data like
                    # width and height.  Do an early filter based on what information we have.
                    # If the user searched for width and we know the width already, we can discard
                    # the result now and not waste time reading the full entry.  This makes some
                    # searches a lot faster.
                    if not self.db.entry_matches_search(entry, conn=connection, incomplete=True, **search_options):
                        # print('Early discarded search result that doesn\'t match: %s' % entry['path'])
                        continue

                    # Load the full entry.
                    path = open_path(entry['path'])
                    entry = self._get_entry(path, conn=connection)
                    if entry is None:
                        continue

                    # If the search only had a placeholder, it wasn't able to check the complete
                    # search.  For example, Windows index searching doesn't know if a GIF is animated.
                    # Re-check the result now that we have a populated entry.
                    if not self.db.entry_matches_search(entry, conn=connection, **search_options):
                        print('Discarded search result that doesn\'t match: %s' % entry['path'])
                        continue

            # If we're verifying files, see if the file needs to be refreshed.
            if verify_files:
                # Check if this entry exists on disk and is up to date.
                if not self._entry_is_up_to_date(entry):
                    # The entry is stale or no longer exists, so refresh it.  If the file still
                    # exists we'll get the updated entry.
                    # The cached entry is out of date, so refresh or delete it.
                    print('Refreshing stale entry:', entry['path'],)
                    path = open_path(entry['path'])
                    with write_connection as connection:
                        entry = self._get_entry(path, force_refresh=True, conn=connection)

            if entry is None:
                continue

            self._convert_to_path(entry)
            results.append(entry)

            # If we have a full batch, stop iterating and return it.
            if len(results) >= batch_size:
                # Before yielding a block of results, close and commit our write connection.
                write_connection.commit()

                # Yield this block of results.
                yield results
                results = []

        # Yield any leftover results.
        if results:
            write_connection.commit()
            yield results

    def bookmark_edit(self, entry, set_bookmark, tags=None):
        """
        Add, edit or delete a bookmark.

        Returns the updated index entry.
        """
        # Update the bookmark metadata file.
        path = open_path(entry['path'])
        with metadata_storage.load_and_lock_file_metadata(path) as file_metadata:
            if set_bookmark:
                file_metadata['bookmarked'] = True
                print('updating tags', tags)
                if tags is not None:
                    file_metadata['bookmark_tags'] = tags

                # Cache some basic metadata too, so we have access to it in placeholder
                # data later.
                file_metadata['width'] = entry['width']
                file_metadata['height'] = entry['height']
            else:
                if 'bookmarked' in file_metadata: del file_metadata['bookmarked']
                if 'bookmark_tags' in file_metadata: del file_metadata['bookmark_tags']

                # Clear cached metadata too, so the metadata is empty after unbookmarking and the
                # metadata file can be deleted.
                if 'width' in file_metadata: del file_metadata['width']
                if 'height' in file_metadata: del file_metadata['height']

            metadata_storage.save_file_metadata(path, file_metadata)

        # Update the file in the index.
        return self._cache_file(path)

    def get_all_bookmark_tags(self):
        return self.db.get_all_bookmark_tags()

    def set_inpaint_data(self, entry, inpaint):
        path = open_path(entry['path'])
        with metadata_storage.load_and_lock_file_metadata(path) as file_metadata:
            if inpaint:
                file_metadata['inpaint'] = inpaint
                file_metadata['inpaint_id'] = inpainting.get_inpaint_id(path, inpaint)
                file_metadata['inpaint_timestamp'] = time.time()
            else:
                print('deleting inpaint')
                for key in ('inpaint', 'inpaint_id', 'inpaint_timestamp'):
                    if key in file_metadata:
                        file_metadata.pop(key)

            # Store the updated data.
            metadata_storage.save_file_metadata(path, file_metadata)

        # Update the file in the index.
        return self.cache_file(path)

    def get_all_bookmark_tags(self):
        return self.db.get_all_bookmark_tags()

async def test():
    # path = Path('e:/images')
    path = Path('f:/stuff/ppixiv/python/temp')
    library = Library('test', 'test.sqlite', path)

    def progress_func(total):
        print('Indexing progress:', total)

    from concurrent.futures import ThreadPoolExecutor
    executor = ThreadPoolExecutor()
    asyncio.get_event_loop().set_default_executor(executor)
    #await asyncio.get_event_loop().run_in_executor(None, index.refresh)

    s = time.time()
    await library.refresh(progress=progress_func)
    e = time.time()
    print('Index refresh took:', e-s)

    library.monitor()
    #for info in library.search(path=path, substr='a', include_files=False, include_dirs=True):
    #    print('result:', info)
    
    while True:
        await asyncio.sleep(0.5)

if __name__ == '__main__':
    asyncio.run(test())
