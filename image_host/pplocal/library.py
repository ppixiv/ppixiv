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
import asyncio, os, typing, time, stat, traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from pprint import pprint
from pathlib import Path, PurePosixPath

from .util import win32, monitor_changes, windows_search, misc
from .file_index import FileIndex

executor = ThreadPoolExecutor()

_library_paths = {
}

libraries = { }

class Library:
    """
    Handle indexing and searching for a directory tree.

    This handles a single root directory.  To index multiple directories, create
    multiple libraries.
    """
    ntfs_alt_stream_name = 'pplocal.json'

    @classmethod
    async def initialize(cls):
        for name, path in _library_paths.items():
            def progress_func(total):
                print('Indexing progress for %s: %i' % (path, total))

            library = Library(name, name + '.sqlite', path)
            libraries[name] = library
            print('Initializing library: %s' % path)
            library.monitor()

            # XXX
            start = time.time()
            await library.refresh(progress=progress_func)
            end = time.time()
            print('Indexing took %.2f seconds' % (end-start))

    @classmethod
    def resolve_path(cls, path):
        """
        Given a folder: or file: ID, return the absolute path to the file or directory
        and the library it's in.  If the path isn't in a library, raise Error.
        """
        path = PurePosixPath(path)
        if '..' in path.parts:
            raise misc.Error('invalid-request', 'Invalid request')

        library_name, path = Library.split_library_name_and_path(path)
        library = libraries.get(library_name)
        if library is None:
            raise misc.Error('not-found', 'Library %s doesn\'t exist' % library_name)

        return library.path / path, library

    @classmethod
    @property
    def all_libraries(cls):
        return libraries

    def __init__(self, library_name, dbpath, path: os.PathLike):
        path = path.resolve()
        self.library_name = library_name
        self.path = path
        self.monitor_changes = None
        self.db = FileIndex(dbpath)
        self.pending_file_updates = {}
        self.pending_directory_refreshes = set()
        self.update_pending_files_task = asyncio.create_task(self.update_pending_files())

    def __str__(self):
        return 'Library(%s: %s)' % (self.library_name, self.path)
        
    def get_relative_path(self, path):
        """
        Given an absolute filesystem path, return the path relative to this library.

        For example, if this is "images" pointing to "C:\SomeImages" and path is
        "C:\SomeImages\path\image.jpg", return "path/image.jpg".

        Return None if path isn't inside this library.
        """
        try:
            return path.relative_to(self.path)
        except ValueError:
            return None

    def get_public_path(self, path):
        """
        Given an absolute filesystem path inside this library, return the API path.
        
        For example, if this is "images" pointing to "C:\SomeImages" and path is
        "C:\SomeImages\path\image.jpg", return "/images/path/image.jpg".

        Return None if path isn't inside this library.
        """
        relative_path = self.get_relative_path(path)
        if relative_path is None:
            return None

        return PurePosixPath('/' + self.library_name) / relative_path

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
            path = self.path
        else:
            path = Path(path)

        # Make sure path is inside this library.
        path.relative_to(self.path)

        if progress is not None and _progress_counter is None:
            _progress_counter = [0]

        # Let other tasks run periodically.
        await asyncio.sleep(0)

        # Start a database transaction for this directory.  We don't reuse this for
        # the whole traversal, since that keeps the transaction open for too long and
        # blocks anything else from happening.
        directories = []
        with self.db.db_pool.get() as db_conn:
            # print('Refreshing: %s' % path)

            # Make a list of file IDs that were cached in this directory before we refreshed it.
            stale_file_paths = {entry['path'] for entry in self.db.search(path=str(path), recurse=False)}

            # If this is the top-level directory, refresh it too unless it's our root.
            if _level == 0 and path != self.path:
                self.handle_update(path, action='refresh', db_conn=db_conn)

            # Don't convert direntry.path to a Path here.  It's too slow.
            for direntry in os.scandir(path):
                if progress is not None:
                    _progress_counter[0] += 1
                    if (_progress_counter[0] % _call_progress_each) == 0:
                        progress(_progress_counter[0])

                # Update this entry.
                self.handle_update(direntry, action='refresh', db_conn=db_conn)

                # Remove this path from stale_file_paths, so we know it's not stale.
                if direntry.path in stale_file_paths:
                    stale_file_paths.remove(direntry.path)

                # If this is a directory, queue its contents.
                if recurse and direntry.is_dir(follow_symlinks=False):
                    directories.append((direntry.path, direntry))

            # Delete any entries for files and directories inside this path that no longer
            # exist.  This will also remove file records recursively if this includes directories.
            if stale_file_paths:
                print('%i files were removed from %s' % (len(stale_file_paths), path))
                self.db.delete_recursively(stale_file_paths, conn=db_conn)

        # Recurse to subdirectories.
        for file_path, direntry in directories:
            await self.refresh(path=file_path, recurse=True, progress=progress, _level=_level+1,
                _call_progress_each=_call_progress_each, _progress_counter=_progress_counter)

        # We're finishing.  Call progress() with the final count.
        if _level == 0 and progress:
            progress(_progress_counter[0])

    def monitor(self):
        """
        Begin monitoring our directory for changes that need to be indexed.
        """
        if self.monitor_changes is not None:
            return

        self.monitor_changes = monitor_changes.MonitorChanges(self.path)
        self.monitor_promise = asyncio.create_task(self.monitor_changes.monitor_call(self.monitored_file_changed))
        print('Started monitoring: %s' % self.path)

    def stop_monitoring(self):
        """
        Stop monitoring for changes.
        """
        if self.monitor_changes is None:
            return

        self.monitor_promise.cancel()
        self.monitor_promise = None
        self.monitor_changes = None
        print('Stopped monitoring: %s' % self.path)

    async def monitored_file_changed(self, path, old_path, action):
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
        # XXX: use st_ino to figure out directories being moved
        # XXX: store st_ino on the cache record? seems useful
        # would need the volume number too
#        path_stat = path.stat()
#        print('------>', path_stat.st_ino)
        # If a path was renamed, rename them in the index.  This avoids needing to refresh
        # the whole tree when a directory is simply renamed.
        if action == monitor_changes.FileAction.FILE_ACTION_RENAMED:
            self.db.rename(old_path, path, conn=db_conn)
            return

        # If the file was removed, delete it from the database.  If this is a directory, this
        # will remove everything underneath it.
        if action in (monitor_changes.FileAction.FILE_ACTION_REMOVED, monitor_changes.FileAction.FILE_ACTION_RENAMED_OLD_NAME):
            print('File removed: %s', path)
            self.db.delete_recursively([path], conn=db_conn)
            return

        # If we receive FILE_ACTION_ADDED for a directory, a directory was either created or
        # moved into our tree.  If an existing directory is moved in, we'll only receive this
        # one notification, so we need to refresh contents recursively.  This can be a long
        # task, so add it to pending_directory_refreshes and let the refresh task handle it.
        if path.is_dir() and action == monitor_changes.FileAction.FILE_ACTION_ADDED:
            print('Queued refresh for added directory: %s' % path)
            self.pending_directory_refreshes.add(path)
            return
        #metadata = win32.read_metadata(path, self.ntfs_alt_stream_name)

#        import msvcrt
#        if path.is_dir():
#            handle = win32.open_handle_shared(os.fspath(path), mode='r')
#            win32.query_object_basic_info(handle)
#            win32.CloseHandle(handle)

        #print(metadata)

        # Don't proactively index everything, or we'll aggressively scan every file.
        # If this is a file we expect Windows indexing to handle, ignore it.  We'll
        # populate it the next time it's viewed.
        if not path.is_dir() and misc.file_type(path.name) == 'image':
            return

        # If queue is true, queue the file to be updated.  This is true when we're updating
        # from file monitoring, since we often get multiple change notifications for the same
        # # file at once.
        # If this is a FileAction from file monitoring, queue the update.  We often get multiple
        # change notifications at once, so we queued these to avoid refreshing over and over.
        if action != 'refresh':
            print('Queued update for modified file:', path, action)
            self.pending_file_updates[path] = time.time()
            return

        # This is a direct refresh.  If this file is already cached and the mtime hasn't
        # changed, we don't need to re-index it.
        entry = self.db.get(path=os.fspath(path), conn=db_conn)

        path_stat = path.stat()
        if entry is not None and abs(entry['mtime'] - path_stat.st_mtime) < 1:
            # print('File already cached: %s' % path)
            return entry

        # print('Caching: %s' % os.fspath(path))
        return self.cache_file(path, db_conn=db_conn)

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

                # See if there are any directory refreshes pending.
                #
                #
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
                wait_for = 1
                now = time.time()
                for path, modified_at in self.pending_file_updates.items():
                    delta = now - modified_at
                    if delta >= wait_for:
                        del self.pending_file_updates[path]
                        break
                else:
                    # XXX: would be better to sleep with a wakeup, so we never wake up if nothing is happening
                    await asyncio.sleep(.25)
                    continue

                print('Update modified file:', path)
                self.cache_file(path)

            except Exception as e:
                traceback.print_exc()
                await asyncio.sleep(1)

    def _touch_last_update_time(self, db_conn=None):
        """
        Update the last_update time to now.

        This is called periodically while we're running, so if we're shut down we can
        tell when we were last running.  This lets us optimize the initial index refresh.
        """
        #print(self.get_last_update_time(conn=conn))
        #print(self.get_last_update_time(conn=conn))
        now = time.time()
        with self.db.db_pool.get(db_conn) as db_conn:
            last = self.db.get_last_update_time(conn=db_conn)
            # XXX higher
            if now > last + 60:
                print('Updating last update time')
                self.db.set_last_update_time(now, conn=db_conn)


    def cache_file(self, path: os.PathLike, *, db_conn=None):
#        metadata = win32.read_metadata(path, self.ntfs_alt_stream_name)
        if path.is_dir():
            entry = self._create_directory_record(path)
        else:
            entry = self._create_file_record(path)
#        print(path, metadata.get('bookmarked'))


        if entry is None:
            return None

        entry['bookmarked'] = False # XXX metadata.get('bookmarked', False)

        self.db.add_record(entry, conn=db_conn)

        return entry

    # We could also handle ZIPs here.  XXX
    def _create_file_record(self, path: os.PathLike):
        # pip install exif
        import exif

        mime_type = misc.mime_type(os.fspath(path))
        if mime_type is None:
            # This file type isn't supported.
            return None

        path = Path(path)

        # Call stat directly instead of using path.stat(), since we need the inode and it's
        # not present on path.stat() on Windows.  This is slower, but we're on a slow path
        # anyway.
        # XXX
        stat = os.stat(path)

        artist = ''
        tags = ''
        comment = ''
        title = path.name
        bookmarked = False

        # XXX: if we open the file
        if False and not path.is_dir():
            # Open the file with all share modes active, so we don't lock the file and interfere
            # with the user working with them.
            # XXX: test if the file is locked by another application, we should queue it and
            # retry later
            # XXX

            # bluh: ratings are in XMP, not EXIF
            # why is everything stupid

            # this works for JPEG (and TIFF, but who cares), but surely we can get this
            # without reading the whole file
            if mime_type == 'image/jpeg':
                try:
                    with win32.open_shared(path, 'rb') as f:
                        data = f.read()

                    exif_data = exif.Image(data)
                    artist = exif_data.artist
                    tags = exif_data.xp_keywords
                    comment = exif_data.xp_comment
                    title = exif_data.image_description

                except Exception as e:
                    print('exif failed:', path)


        if False:
            try:
                from PIL import Image, ExifTags
                img = Image.open(str(path))
                exif_dict = img._getexif()

                for tag, data in exif_dict.items():
                    tag_name = ExifTags.TAGS.get(tag)
                    if not tag_name:
                        continue
                    print(tag_name, tag)
                    if tag_name == 'ImageDescription':
                        print('desc:', data)
                
                # exif_dict['0th'][piexif.ImageIFD.ImageDescription] = exif_description.encode('utf-8')

                #exif_dict = piexif.load(str(path))
                #print('exif:', path)
                #pprint(exif_dict)
            except Exception as e:
                print('exif error:', path, e)

        data = {
            'path': str(path),
            'is_directory': False,
            'parent': str(path.parent),
            'ctime': stat.st_ctime,
            'mtime': stat.st_mtime,
            'inode': stat.st_ino,
            'volume_id': win32.get_volume_serial_number(path),
            'title': title,
            'type': mime_type,
            
            # We'll fill these in below if possible.
            'width': None,
            'height': None,

            # XXX
            'tags': tags,
            'comment': comment,
            'author': artist,
            'bookmarked': bookmarked,
        }

        size = misc.get_image_dimensions(path)
        if size is not None:
            data['width'] = size[0]
            data['height'] = size[1]

        return data

    # XXX: how can we prevent ourselves from refreshing from our own metadata changes
    # just remember that we've written to it?

    def _create_directory_record(self, path: os.PathLike):
        path = Path(path)

        stat = os.stat(path)

        data = {
            'path': str(path),
            'is_directory': True,
            'parent': str(path.parent),
            'ctime': stat.st_ctime,
            'mtime': stat.st_mtime,
            'inode': stat.st_ino,
            'volume_id': win32.get_volume_serial_number(path),
            'title': path.name,
            'type': 'application/folder',

            # We currently don't support these for directories:
            'tags': '',
            'comment': '',
            'author': '',
        }

        return data

    def _handled_by_windows_index(self, path, path_stat=None):
        """
        Return true if we support finding path from the Windows index.

        We only proactively index files that aren't handled by the Windows index.
        """
        if path_stat is None:
            path_stat = path.stat()

        # We always handle directories ourself.
        if stat.S_ISDIR(path_stat.st_mode):
            return False
            
        return misc.file_type(path) == 'image'

    def list_path(self, path, force_refresh=False, include_files=True, include_dirs=True):
        """
        Return all files inside path non-recursively.
        """
        # Stop if path isn't inside self.path.  The file isn't in this library.
        try:
            path.relative_to(self.path)
        except ValueError:
            return

        if not path.is_dir():
            return
        for direntry in os.scandir(path):
            is_dir = direntry.is_dir(follow_symlinks=False)

            # Skip unsupported files.
            if not is_dir and misc.file_type(direntry.name) is None:
                continue

            if not include_dirs and is_dir:
                continue
            if not include_files and not is_dir:
                continue

            file_path = Path(direntry.path)

            # Find the file in cache and cache it if needed.
            entry = self.get(file_path, force_refresh=force_refresh)
            if entry is not None:
                yield entry

    def get(self, path, *, force_refresh=False):
        """
        Return the entry for path.  If the path isn't cached, populate the cache entry.

        If force_refresh is true, always repopulate the cache entry.
        """
        # Stop if path isn't inside self.path.  The file isn't in this library.
        try:
            path.relative_to(self.path)
        except ValueError:
            return None

        # XXX: if we're coming from windows search, pass in the search result and populate
        # width and height from cache, etc. if possible
        # that only makes sense if it lets us avoid reading the file entirely
        entry = None
        if not force_refresh:
            entry = self.db.get(path=str(path))
        if entry is None:
            entry = self.cache_file(path)

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

    def search(self, *, path=None, substr=None, bookmarked=None, include_files=True, include_dirs=True, force_refresh=False, use_windows_search=True):
        if path is None:
            path = self.path

        search_options = { }
        if substr is not None: search_options['substr'] = substr
        if bookmarked: search_options['bookmarked'] = True

        # We can get results from the Windows search and our own index.  Keep track of
        # what we've returned, so we don't return the same file from both.
        seen_paths = set()
        if use_windows_search:
            # Check the Windows index.
            for result in windows_search.search(path=str(path), **search_options):
                entry = self.get(result['path'], force_refresh=force_refresh)
                seen_paths.add(entry['path'])
                yield entry

        # Search our library.
        for entry in self.db.search(path=str(path), **search_options, include_files=include_files, include_dirs=include_dirs):
            if entry['path'] in seen_paths:
                continue

            seen_paths.add(entry['path'])

            self._convert_to_path(entry)
            yield entry

async def test():
    # path = Path('e:/images')
    path = Path('f:/stuff/ppixiv/image_host/temp')
    library = Library('test', 'test.sqlite', path)

    def progress_func(total):
        print('Indexing progress:', total)

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
