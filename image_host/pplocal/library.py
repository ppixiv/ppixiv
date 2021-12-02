# This implements indexing for file searching.
#
# We use a hybrid approach to searching.  The Windows index does a lot of the
# work.  Indexing very large directories can take a very long time, since we
# need to read each file to get metadata, and the index has already done most
# of that for us.
#
# However, it doesn't handle everything.  It doesn't give us any way to store
# metadata for directories or ZIPs, and it has limited support for videos.  We
# index these ourself.  This is much faster, since people usually have far fewer
# videos and directories than individual images.
#
# While we're running, we monitor our directory for changes and update the index
# automatically.  Searches merge results from our index and the Windows index.
#
# XXX: how can we detect if indexing is enabled on our directory

import asyncio, itertools, os, typing, time, stat, traceback, json, sys, heapq, natsort, random
from pathlib import Path
from pprint import pprint
from pathlib import Path, PurePosixPath

from .util import win32, monitor_changes, windows_search, misc
from . import metadata_storage
from .database.file_index import FileIndex
from .util.paths import open_path, PathBase

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
        'windows': 'ORDER BY System.FolderNameDisplay, System.ItemPathDisplay ASC',
        'entry': lambda entry: (not entry['is_directory'], entry['filesystem_name'].lower()),
        'index': 'ORDER BY is_directory DESC, filesystem_name ASC',
        'fs': lambda entry: (not entry.is_dir(), entry.name),
    },

    # A natural sort.  This also puts directories first, but sorts numbered files much better.
    # This isn't supported for searching, but it's mostly useful for viewing single directories.
    # This is the default sort for Library.list.
    'natural': {
        'fs': lambda entry: (not entry.is_dir(), *natsort.natsort_key(entry.name)),
    }
}

class Library:
    """
    Handle indexing and searching for a directory tree.

    This handles a single root directory.  To index multiple directories, create
    multiple libraries.
    """
    def __init__(self, data_dir):
        self.mounts = {}
        self.pending_file_updates = {}
        self.pending_directory_refreshes = set()
        self.refresh_event = misc.AsyncEvent()
        self.monitors = {}
        self._data_dir = data_dir

        # Open our database.
        dbpath = self.data_dir / 'index.sqlite'
        self.db = FileIndex(dbpath)

        self.update_pending_files_task = asyncio.create_task(self.update_pending_files(), name='LibraryUpdate')

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

        del self.mounts[name]
        await self.stop_monitoring(name)

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
        
        For example, if this is "images" pointing to "C:\SomeImages" and path is
        "C:\SomeImages\path\image.jpg", return "/images/path/image.jpg".

        Return None if path isn't inside this library.
        """
        for mount_name, mount_path in self.mounts.items():
            try:
                relative_path = path.relative_to(mount_path)
            except ValueError:
                continue

            return PurePosixPath('/' + mount_name) / relative_path
        return None

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
        XXX clear bookmarks that we don't find
        """
        if paths is None:
            paths = self.mounts
        else:
            paths = [Path(path) for path in paths]

        for path in paths.values():
            with self.db.connect() as db_conn:
                # Find all metadata files.
                for result in windows_search.search(paths=[str(path)], filename=metadata_storage.metadata_filename):
                    # Refresh just files with metadata.
                    path = open_path(result.path)

                    for path in metadata_storage.get_files_with_metadata(path):
                        try:
                            self.handle_update(path, action='refresh', db_conn=db_conn)
                        except FileNotFoundError as e:
                            print('Bookmarked file %s doesn\'t exist' % path)
                            continue


    async def refresh(self, *,
            path=None,
            recurse=True,
            progress: typing.Callable=None,
            _level=0,
            _call_progress_each=25000,
            _progress_counter=None):
        """
        Refresh the library.

        If path is specified, it must be a directory inside this library.  Only that path
        will be updated.  If path isn't inside our path, an exception will be raised.

        If progress is a function, it'll be called periodically with the number of files
        processed.
        """
        if path is None:
            for path in self.mounts.values():
                await self.refresh(path=path, recurse=recurse, progress=progress,
                    _call_progress_each=_call_progress_each, _progress_counter=_progress_counter)
            return

        assert isinstance(path, PathBase)
        path = path

        # Make sure path is inside this library.
        if self.get_mount_for_path(path) is None:
            print('Path %s isn\'t mounted' % path)
            return

        if progress is not None and _progress_counter is None:
            _progress_counter = [0]

        # Let other tasks run periodically.
        await asyncio.sleep(0)

        # Start a database transaction for this directory.  We don't reuse this for
        # the whole traversal, since that keeps the transaction open for too long and
        # blocks anything else from happening.
        directories = []
        with self.db.connect() as db_conn:
            # print('Refreshing: %s' % path)

            # Make a list of file IDs that were cached in this directory before we refreshed it.
            stale_file_paths = {os.fspath(entry['path']) for entry in self.db.search(paths=[str(path)], mode=self.db.SearchMode.Subdir)}

            # If this is the top-level directory, refresh it too unless it's our root.
            if _level == 0 and path in self.mounts.values():
                self.handle_update(path, action='refresh', db_conn=db_conn)

            for child in path.scandir():
                if progress is not None:
                    _progress_counter[0] += 1
                    if (_progress_counter[0] % _call_progress_each) == 0:
                        progress(_progress_counter[0])

                # Update this entry.
                self.handle_update(child, action='refresh', db_conn=db_conn)

                # Remove this path from stale_file_paths, so we know it's not stale.
                if child.path in stale_file_paths:
                    stale_file_paths.remove(os.fspath(child.path))

                # If this is a directory, queue its contents.
                if recurse and child.is_real_dir():
                    directories.append(child)

            # Delete any entries for files and directories inside this path that no longer
            # exist.  This will also remove file records recursively if this includes directories.
            if stale_file_paths:
                print('%i files were removed from %s' % (len(stale_file_paths), path))
                print(stale_file_paths)
                # XXX
                #self.db.delete_recursively(stale_file_paths, conn=db_conn)

        # Recurse to subdirectories.
        for file_path in directories:
            await self.refresh(path=file_path, recurse=True, progress=progress, _level=_level+1,
                _call_progress_each=_call_progress_each, _progress_counter=_progress_counter)

        # We're finishing.  Call progress() with the final count.
        if _level == 0 and progress:
            progress(_progress_counter[0])

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
        task = self.monitors.pop(mount)
        if task is not None:
            return

        path = self.mounts.get(mount)
        if path is None:
            raise ValueError('Mount doesn\'t exist: %s' % mount)

        task.cancel()
        await task

        print('Stopped monitoring: %s' % path)

    async def monitored_file_changed(self, path, old_path, action):
        path = open_path(path)
        self.handle_update(path=path, old_path=old_path, action=action)

    def handle_update(self, path, action, *, old_path=None, db_conn=None):
        """
        This is called to update a changed path.  This can be called during an explicit
        refresh, or from file monitoring.

        If db_conn isn't None, it's the database connection returned from this.db.begin()
        to use to store changes.  This allows batching our updates into a single transaction
        for performance.

        action is either a monitor_changes.FileAction, or 'refresh' if this is from our
        refresh.

        path may be a string.  We'll only convert it to a Path if necessary, since doing this
        for every file is slow.
        """
        assert isinstance(path, PathBase)
        
        # Ignore changes to metadata files.  We assume we're the only ones changing
        # these.  If we allow them to be edited externally, we'd need to figure out
        # a way to tell if changes we're seeing are ones we made, or else we'd trigger
        # refreshes endlessly.
        if path.name == metadata_storage.metadata_filename:
            return
        
        # If a path was renamed, rename them in the index.  This avoids needing to refresh
        # the whole tree when a directory is simply renamed.
        if action == monitor_changes.FileAction.FILE_ACTION_RENAMED:
            # Many applications write a temporary file and then rename it to the new file, which we'll see
            # as a bunch of writes to a file that we ignore, followed by a rename.  Only treat this as
            # a rename if we already knew about the original filename.
            if self.db.get(path=os.fspath(path), conn=db_conn) is not None:
                self.db.rename(old_path, path, conn=db_conn)
                return

            print('Treating rename as addition because the original filename isn\'t indexed: %s' % path)
            action = monitor_changes.FileAction.FILE_ACTION_ADDED
        
        # If the file was removed, delete it from the database.  If this is a directory, this
        # will remove everything underneath it.
        if action == monitor_changes.FileAction.FILE_ACTION_REMOVED:
            print('File removed: %s' % path)
            self.db.delete_recursively([path], conn=db_conn)
            return

        assert action in (monitor_changes.FileAction.FILE_ACTION_ADDED, monitor_changes.FileAction.FILE_ACTION_MODIFIED, 'refresh')

        # If we receive FILE_ACTION_ADDED for a directory, a directory was either created or
        # moved into our tree.  If an existing directory is moved in, we'll only receive this
        # one notification, so we need to refresh contents recursively.  This can be a long
        # task, so add it to pending_directory_refreshes and let the refresh task handle it.
        if path.is_real_dir() and action == monitor_changes.FileAction.FILE_ACTION_ADDED:
            print('Queued refresh for added directory: %s' % path)
            self.pending_directory_refreshes.add(path)
            self.refresh_event.set()
            return

        # Don't proactively index everything, or we'll aggressively scan every file.  Skip images
        # that can be found with Windows search.  Don't skip images with metadata (bookmarks).
        # Check has_metadata to short circuit this check early, so is_dir() doesn't read ZIP
        # directories unnecessarily.
        has_metadata = metadata_storage.has_file_metadata(path)
        if not has_metadata and not path.is_dir() and misc.file_type(path.name) == 'image':
            return

        # If this is a FileAction from file monitoring, queue the update.  We often get multiple
        # change notifications at once, so we queued these to avoid refreshing over and over.
        if action != 'refresh':
            # print('Queued update for modified file:', path, action)
            wait_for = 1
            self.pending_file_updates[path] = time.time() + wait_for
            self.refresh_event.set()
            return

        # Read the file to trigger a refresh.
        return self.get(path=path, conn=db_conn)

    async def update_pending_files(self):
        """
        This is a background task that watches for files added to pending_file_updates
        which need to be updated.
        """
        while True:
            try:
                # Periodically update the last update time here.  Only do this if we have
                # no pending updates.
                if not self.pending_file_updates and not self.pending_directory_refreshes:
                    self._touch_last_update_time()

                # See if there are any directory refreshes pending.  We can't use a quick
                # refresh here, since we often get here before Windows's indexing has caught
                # up.
                if self.pending_directory_refreshes:
                    path = self.pending_directory_refreshes.pop()
                    print('Refreshing new directory: %s' % path)
                    await self.refresh(path=path, recurse=True)
                    continue

                # See if there are any files in pending_file_updates which have been waiting long
                # enough.
                #
                # This could be done without iterating, but the number of entries that back up in
                # this list shouldn't be big enough for that to be needed.
                #
                # Note that pending_file_updates can contain directories.  A directory in
                # pending_directory_refreshes means a full refresh is needed, but if it's in
                # pending_file_updates, we're just refreshing the directory itself.
                now = time.time()
                paths_to_update = []
                min_time_to_update = 3600
                for path, update_at in self.pending_file_updates.items():
                    time_until_update = update_at - now
                    if time_until_update <= 0:
                        paths_to_update.append(path)
                    else:
                        min_time_to_update = min(min_time_to_update, time_until_update + 0.01)

                if not paths_to_update:
                    # There's nothing ready to update.  Wait for min_time_to_update to wait
                    # until a file is ready.
                    await self.refresh_event.wait(min_time_to_update)
                    self.refresh_event.clear()
                    continue

                # Remove the paths from pending_file_updates and update them.
                for path in paths_to_update:
                    del self.pending_file_updates[path]

                for path in paths_to_update:
                    print('Update modified file:', path)
                    self.get(path)

            except Exception as e:
                traceback.print_exc()
                await asyncio.sleep(1)

    def _touch_last_update_time(self, db_conn=None):
        """
        Update the last_update time to now.

        This is called periodically while we're running, so if we're shut down we can
        tell when we were last running.  This lets us optimize the initial index refresh.
        """
        now = time.time()
        with self.db.connect(db_conn) as db_conn:
            last = self.db.get_last_update_time(conn=db_conn)
            if now > last + 600:
                print('Updating last update time')
                self.db.set_last_update_time(now, conn=db_conn)

    def cache_file(self, path: os.PathLike, *, conn=None):
        # Create the appropriate entry type.
        if path.is_dir():
            entry = self._create_directory_record(path)
        else:
            entry = self._create_file_record(path)

        if entry is None:
            return None

        # If we weren't given metadata, read it now.  During batch refreshes
        # we'll always be given the metadata, since we're reading lots of files
        # that share the same data.
        file_metadata = metadata_storage.load_file_metadata(path)

        # Import bookmarks.
        entry['bookmarked'] = file_metadata.get('bookmarked', False)
        entry['bookmark_tags'] = file_metadata.get('bookmark_tags', '')

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

        if not title:
            title = path.name

        data = {
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
        }

        return data

    def _create_directory_record(self, path: os.PathLike):
        stat = path.stat()

        data = {
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

    def list(self,
        paths,
        *,
        sort_order='default',
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

        # Remove any paths that aren't mounted.
        paths = [path for path in paths if self.get_mount_for_path(path)]

        if sort_order == 'default':
            sort_order = 'natural'

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
        elif sort_order is not None and sort_orders.get(sort_order):
            order = sort_orders[sort_order]
            sorted_results = list(scandir_results)
            sorted_results.sort(key=order['fs'])

            # Convert back to an iterator.
            scandir_results = iter(sorted_results)

        results = []
        while True:
            # This will start a database transaction.  We'll only hold it until we finish
            # this batch, and commit it before yielding results, so we don't keep a write
            # lock during the yield.
            with self.db.connect(write=True) as conn:
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
                    entry = self.get(child, force_refresh=force_refresh, conn=conn)
                    if entry is not None:
                        results.append(entry)

                    # If we have a full batch, stop iterating and return it.
                    if len(results) >= batch_size:
                        break

            # If we exited the loop and have no results, we're at the end.
            if not len(results):
                break
            
            # Yield these results, then continue reading the iterator.
            yield results
            results = []
            
    def get_mountpoint_entries(self):
        """
        Return entries for each mountpoint.
        """
        results = []
        with self.db.connect() as conn:
            for mount_name, mount_path in self.mounts.items():
                entry = self.get(mount_path, conn=conn)
                assert entry is not None
                results.append(entry)
        return results

    def get(self, path, *, force_refresh=False, check_mtime=True, conn=None):
        """
        Return the entry for path.  If the path isn't cached, populate the cache entry.

        If force_refresh is true, always repopulate the cache entry.
        """
        entry = None
        if not force_refresh:
            entry = self.db.get(path=os.fspath(path), conn=conn)

        if entry is not None and check_mtime:
            # Check if cache is out of date.  If this is a ZIP, we're checking the mtime
            # of the ZIP itself, so we don't read the ZIP directory here.
            path_stat = path.filesystem_file.stat()
            if abs(entry['filesystem_mtime'] - path_stat.st_mtime) >= 1:
                # print('File cache out of date: %s' % path)
                entry = None

        if entry is None:
            # The file needs to be cached.  Check that the path is actually inside this
            # library.  For performance, we only do this here so we avoid the Path constructor
            # when it's not needed.  Up to here, it may be a DirEntry.
            if self.get_mount_for_path(path) is None:
                return

            entry = self.cache_file(path, conn=conn)

        if entry is None:
            return None

        # Convert these absolute paths back to Paths.
        self._convert_to_path(entry)

        return entry

    def _convert_to_path(self, entry):
        """
        FileIndex only deals with string paths.  Our API uses Path.  Convert paths
        in entry from strings to Path.
        """
        entry['path'] = Path(entry['path'])
        entry['parent'] = Path(entry['parent'])

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
        force_refresh=False,
        use_windows_search=True,
        sort_order='normal',
        batch_size=50,
        **search_options):
        if not paths:
            paths = self.mounts.values()

        assert paths

        if sort_order == 'default':
            sort_order = 'normal'

        sort_order_info = sort_orders.get(sort_order)

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

        # Don't use Windows search when searching bookmarks, since it doesn't know about them.
        if search_options.get('bookmarked') or search_options.get('bookmark_tags') is not None:
            use_windows_search = False

        # Create the Windows search.
        if use_windows_search:
            order = sort_order_info['windows'] if sort_order_info else None
            windows_search_iter = windows_search.search(paths=[str(path) for path in paths], order=order, timeout=windows_search_timeout, **search_options)
        else:
            windows_search_iter = []

        # Create the index search.
        #
        # This intentionally doesn't use the same connection as the Windows search
        # iterator, since this is read-only and we keep the connection running until
        # we've completely returned all results.
        order = sort_order_info['index'] if sort_order_info else None
        index_search_iter = self.db.search(paths=[str(path) for path in paths], conn=None, order=order, **search_options)

        # This is set while the iterate_windows_search iterator is being called, and unset between
        # batches.  It's always set when get_entry_from_result is called.
        windows_search_conn = None

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

                assert windows_search_conn is not None
                entry = self.get(open_path(Path(result.path)), force_refresh=force_refresh, conn=windows_search_conn)
                if entry is None:
                    return None

                # Not all search options are supported by Windows indexing.  For example, we
                # can search for GIFs, but we can't filter for animated GIFs.  Re-check the
                # entry to see if it matches the search.
                if not self.db.id_matches_search(entry['id'], conn=windows_search_conn, **search_options):
                    print('Discarded Windows search result that doesn\'t match: %s' % entry['path'])
                    return None

                self._convert_to_path(entry)
                return entry
            else:
                # print('Search result from database:', entry['id'], entry['filesystem_name'])
                if str(result['path']) in seen_paths:
                    return
                seen_paths.add(str(result['path']))

                self._convert_to_path(result)
                return result

        if shuffle:
            # If we're shuffling, read both iterators all the way through and shuffle them.
            # This is set up so we only run the search and don't call Library.get() at this
            # point, so we only run file caching for results as we return them.
            all_results = list(windows_search_iter) + list(index_search_iter)
            random.shuffle(all_results)

            def get_shuffled_results():
                for result in all_results:
                    yield get_entry_from_result(result)

            final_search = get_shuffled_results()
        else:
            # We now have our two generators to run the searches.  get_results_from_index and
            # get_results_from_search iterate through those and yield entries.
            def get_results_from_index():
                for result in index_search_iter:
                    yield get_entry_from_result(result)

            def get_results_from_search():
                for result in windows_search_iter:
                    yield get_entry_from_result(result)

            # Create the iterators for both searches.
            search_results_iter = get_results_from_search()
            index_results_iter = get_results_from_index()

            # If we're sorting, use heapq.merge to merge the two together.  Otherwise, just chain them.
            if sort_order_info:
                merge_key = sort_order_info['entry']
                final_search = heapq.merge(search_results_iter, index_results_iter, key=merge_key)
            else:
                final_search = itertools.chain(search_results_iter, index_results_iter)

        # Iterate over the final search, returning it in batches.
        results = []
        while True:
            # Open a connection while we're running the iterator.  This will remain open for
            # the duration of the batch, and be closed while we yield results.
            with self.db.connect(write=True) as connection:
                windows_search_conn = connection

                for entry in final_search:
                    if entry is None:
                        continue

                    # print('got entry', entry)
                    results.append(entry)

                    # If we have a full batch, stop iterating and return it.
                    if len(results) >= batch_size:
                        break
            
            windows_search_conn = None

            # If we exited the loop and have no results, we're at the end.
            if not len(results):
                return

            # Yield these results, then continue reading the iterator.
            yield results
            results = []

    def bookmark_edit(self, path, set_bookmark, tags=None):
        """
        Add, edit or delete a bookmark.

        Returns the updated index entry.
        """
        # Update the bookmark metadata file.
        file_metadata = metadata_storage.load_file_metadata(path)

        if set_bookmark:
            file_metadata['bookmarked'] = True
            if tags is not None:
                file_metadata['bookmark_tags'] = tags
        else:
            if 'bookmarked' in file_metadata: del file_metadata['bookmarked']
            if 'bookmark_tags' in file_metadata: del file_metadata['bookmark_tags']

        metadata_storage.save_file_metadata(path, file_metadata)

        # Update the file in the index.
        return self.cache_file(path)

    def get_all_bookmark_tags(self):
        return self.db.get_all_bookmark_tags()

async def test():
    # path = Path('e:/images')
    path = Path('f:/stuff/ppixiv/image_host/temp')
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
