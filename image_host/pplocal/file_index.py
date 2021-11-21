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
import asyncio, errno, os, typing, time, stat, traceback, json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from pprint import pprint
from pathlib import Path, PurePosixPath

from .util import win32, monitor_changes, windows_search, misc
from .file_index_storage import IndexDatabase

class RefreshProgress:
    total = 0

executor = ThreadPoolExecutor()

class FileIndex:
    """
    Handle indexing for a directory tree.

    This handles a single root directory.  To index multiple directories, create
    multiple indexes.
    """
    ntfs_alt_stream_name = 'pplocal.json'

    def __init__(self, archive_name, dbpath, path: os.PathLike):
        path = path.resolve()
        self.archive_name = archive_name
        self.path = path
        self.monitor_changes = None
        self.db = IndexDatabase(dbpath)
        self.pending_file_updates = {}
        self.update_pending_files_task = asyncio.create_task(self.update_pending_files())

    def get_relative_path(self, path):
        """
        Given an absolute filesystem path, return the path relative to this index.

        For example, if this is "images" pointing to "C:\SomeImages" and path is
        "C:\SomeImages\path\image.jpg", return "path/image.jpg".

        Return None if path isn't inside this index.
        """
        try:
            return path.relative_to(self.path)
        except ValueError:
            return None

    def get_public_path(self, path):
        """
        Given an absolute filesystem path inside this index, return the API path.
        
        For example, if this is "images" pointing to "C:\SomeImages" and path is
        "C:\SomeImages\path\image.jpg", return "/images/path/image.jpg".

        Return None if path isn't inside this index.
        """
        relative_path = self.get_relative_path(path)
        if relative_path is None:
            return None

        return PurePosixPath('/' + self.archive_name) / relative_path

    @classmethod
    def split_archive_name_and_path(cls, path):
        """
        Given an id, eg. "file:/archive/path1/path2/path3", return ('archive', 'path1/path2/path3').
        """
        # The root doesn't correspond to an index.
        if path == '/':
            raise misc.Error('invalid-request', 'Invalid request')

        # The path is always absolute.
        if not str(path).startswith('/'):
            raise misc.Error('not-found', 'Path must begin with a /: %s' % path)

        # Split the archive name from the path.
        archive_name = path.parts[1]
        path = PurePosixPath('/'.join(path.parts[2:]))
        return archive_name, path

    async def refresh(self, *,
            path=None,
            recurse=True,
            progress: typing.Callable=None,
            _level=0,
            _call_progress_each=25000,
            _progress_counter=None,
            _db_conn=None):
        """
        Refresh the index.

        If path is specified, it must be a directory inside this index.  Only that path
        will be updated.  If path isn't inside our path, an exception will be raised.

        If progress is a function, it'll be called periodically with the number of files
        processed.
        """
        if path is None:
            path = self.path

        # Make sure path is inside this index.
        path.relative_to(self.path)

        if progress is not None and _progress_counter is None:
            _progress_counter = [0]

        # Let other tasks run periodically.
        await asyncio.sleep(0)

        # Start a database transaction.  We'll use it for the whole update.
        with self.db.db_pool.get(_db_conn) as _db_conn:
            for direntry in os.scandir(path):
                if progress is not None:
                    _progress_counter[0] += 1
                    if (_progress_counter[0] % _call_progress_each) == 0:
                        progress(_progress_counter[0])

                file_path = path / direntry.name
                self.handle_update(file_path, monitor_changes.FileAction.FILE_ACTION_ADDED, direntry=direntry, db_conn=_db_conn)

                if direntry.is_dir(follow_symlinks=False):
                    if recurse:
                        await self.refresh(path=file_path, recurse=True, progress=progress, _level=_level+1,
                            _call_progress_each=_call_progress_each, _progress_counter=_progress_counter,
                            _db_conn=_db_conn)
                    continue

            # We're finishing.  Call progress() with the final count.
            if _level == 0 and progress:
                progress(_progress_counter[0])

    def monitor(self):
        if self.monitor_changes is not None:
            return

        self.monitor_changes = monitor_changes.MonitorChanges(self.path)
        self.monitor_promise = asyncio.create_task(self.monitor_changes.monitor_call(self.monitored_file_changed))
        print('Started monitoring: %s' % self.path)

    def stop_monitoring(self):
        if self.monitor_changes is None:
            return

        self.monitor_promise.cancel()
        self.monitor_promise = None
        self.monitor_changes = None
        print('Stopped monitoring: %s' % self.path)

    async def monitored_file_changed(self, path, action):
        self.handle_update(path, action, queue=True)

    def handle_update(self, path: os.PathLike, action, *, direntry: os.DirEntry=None, db_conn=None, queue=False):
        """
        This is called to update a changed path.  This can be called during an explicit
        refresh, or from file monitoring.

        If entry isn't None, it's a DirEntry from os.scandir.  This can be used to speed
        up the update.  This is None when updating from monitoring.

        If db_conn isn't None, it's the database connection returned from this.db.begin()
        to use to store changes.  This allows batching our updates into a single transaction
        for performance.
        """
        if action in (monitor_changes.FileAction.FILE_ACTION_REMOVED, monitor_changes.FileAction.FILE_ACTION_RENAMED_OLD_NAME):
            # The file was removed.
            self.db.delete_record(path=str(path), conn=db_conn)
            return
        print('go', path)

        # Don't proactively monitor everything, or we'll aggressively scan every file.
        # If this is a file we expect Windows indexing to handle, just remove our cache
        # entry.  We'll populate it the next time it's viewed.
        if self.handled_by_windows_index(path):
            self.db.delete_record(path=str(path), conn=db_conn)
            return

        # If queue is true, queue the file to be updated.  This is true when we're updating
        # from file monitoring, since we often get multiple change notifications for the same
        # # file at once.
        # XXX: how do we detect when the file is no longer locked, so it isn't still being
        # written
        if queue:
            print('Queued update for modified file:', path, action)
            self.pending_file_updates[path] = time.time()
        else:
            self.cache_file(path, direntry=direntry, db_conn=db_conn)

    async def update_pending_files(self):
        while True:
            try:
                # See if there are any files in pending_file_updates which have been waiting long
                # enough.
                #
                # This could be done without iterating, but the number of entries that back up in
                # this list shouldn't be big enough for that to be needed.
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

    def handled_by_windows_index(self, path):
        """
        Return true if we support finding path from the Windows index.

        We only proactively index files that aren't handled by the Windows index.
        """
        # We always handle directories ourself.
        # XXX
        return False
        if path.is_dir():
            return False
            
        return misc.file_type(path) == 'image'

    def cache_file(self, path: os.PathLike, *, direntry: os.DirEntry=None, db_conn=None):

        #if not path.is_dir():
            #print('Skipped directory', path)
            #continue

            # Open the file with all share modes active, so we don't lock the file and interfere
            # with the user working with them.
            # XXX: test if the file is locked by another application, we should queue it and
            # retry later
            # XXX
            #with win32.open_shared(path) as f:
            #    print('f', f)
            #    print(os.stat(f.fileno()))
            #    #self.cache_file(path)



        # If we have a DirEntry, use it for stat().  Otherwise, get it from the file.
        if direntry is None:
            path_stat = path.stat()
        else:
            path_stat = direntry.stat()

        # We could also handle ZIPs here.  XXX
        is_directory = stat.S_ISDIR(path_stat.st_mode)
        if is_directory:
            entry = self._create_directory_record(path, stat=path_stat)
        else:
            entry = self._create_file_record(path, stat=path_stat)

        if entry is not None:
            self.db.add_record(entry, conn=db_conn)
        return entry

    def _create_file_record(self, path: os.PathLike, stat):
        import piexif

        if False:
            try:
                from PIL import Image, ExifTags
                import PIL
                print(PIL.__path__)
                img = Image.open(str(path))
                exif_dict = img._getexif()

                print('------->', exif_dict)
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

        _, ext = os.path.splitext(path)
        mime_type = misc.mime_type_from_ext(ext)
        data = {
            'path': str(path),
            'is_directory': False,
            'parent': str(path.parent),
            'ctime': stat.st_ctime,
            'mtime': stat.st_mtime,
            'title': path.name,
            'type': mime_type,
            
            # We'll fill these in below if possible.
            'width': None,
            'height': None,

            # XXX
            'tags': '',
            'comment': '',
            'author': '',
            'bookmarked': False,
        }

        size = misc.get_image_dimensions(path)
        if size is not None:
            data['width'] = size[0]
            data['height'] = size[1]

        return data

    def _alt_stream_path(self, path: os.PathLike):
        return str(path) + ':' + self.ntfs_alt_stream_name

    # XXX: how can we prevent ourselves from refreshing from our own metadata changes
    # just remember that we've written to it?

    def _create_directory_record(self, path: os.PathLike, stat):
        directory_metadata = win32.read_directory_metadata(path, self.ntfs_alt_stream_name)
        directory_metadata.get('bookmarked')

        data = {
            'path': str(path),
            'is_directory': True,
            'parent': str(path.parent),
            'ctime': stat.st_ctime,
            'mtime': stat.st_mtime,
            'title': path.name,
            'type': 'application/folder',

            # This is filled in below.
            'width': None,
            'height': None,

            # We currently don't support these for directories:
            'tags': '',
            'comment': '',
            'author': '',

            # XXX
            'bookmarked': directory_metadata.get('bookmarked', False),
        }

        # Find the first image and use that as the thumbnail.
        thumbnail_file = None
        for idx, file in enumerate(os.scandir(path)):
            if idx > 10:
                # In case this is a huge directory with no images, don't look too far.
                # If there are this many non-images, it's probably not an image directory
                # anyway.
                break

            file = path / file

            # Ignore nested directories.
            if file.is_dir():
                continue

            # XXX: handle videos
            if misc.file_type(file.name) is None:
                continue

            thumbnail_file = file
            break
        
        if thumbnail_file is not None:
            # Cache the dimensions of the thumbnail.
            size = misc.get_image_dimensions(thumbnail_file)
            if size is not None:
                data['width'] = size[0]
                data['height'] = size[1]
                data['directory_thumbnail_path'] = str(thumbnail_file)

        return data

    def list_path(self, path, force_refresh=False):
        """
        Return all files inside path non-recursively.
        """
        # Stop if path isn't inside self.path.  The file isn't in this archive.
        try:
            path.relative_to(self.path)
        except ValueError:
            return

        if not path.is_dir():
            return

        for direntry in os.scandir(path):
            file_path = path / direntry

            # Find the file in cache and cache it if needed.
            entry = self.get(file_path, force_refresh=force_refresh)
            if entry is not None:
                yield entry

    def get(self, path, *, force_refresh=False):
        """
        Return the entry for path.  If the path isn't cached, populate the cache entry.

        If force_refresh is true, always repopulate the cache entry.
        """
        # Stop if path isn't inside self.path.  The file isn't in this archive.
        try:
            path.relative_to(self.path)
        except ValueError:
            return None

        # XXX: if we're coming from windows search, pass in the search result and populate
        # width and height from cache, etc. if possible
        entry = None
        if not force_refresh:
            entry = self.db.get(path=str(path))
        if entry is None:
            entry = self.cache_file(path)

        if entry is None:
            return None

        # Convert these absolute paths back to Paths.
        entry['path'] = Path(entry['path'])
        entry['parent'] = Path(entry['parent'])

        return entry

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

        # Search our index.
        for entry in self.db.search(path=str(path), **search_options, include_files=include_files, include_dirs=include_dirs):
            if entry['path'] in seen_paths:
                continue

            seen_paths.add(entry['path'])
            yield entry

async def test():
    # path = Path('e:/images')
    path = Path('f:/stuff/ppixiv/image_host/f')
    index = FileIndex('test', 'test.sqlite', path)

    def progress_func(total):
        print('Indexing progress:', total)

    asyncio.get_event_loop().set_default_executor(executor)
    #await asyncio.get_event_loop().run_in_executor(None, index.refresh)

    s = time.time()
    await index.refresh(progress=progress_func)
    e = time.time()
    print('Index refresh took:', e-s)

    index.monitor()
    for info in index.search(path=path, substr='a', include_files=False, include_dirs=True):
        print('result:', info)
    
    while True:
        await asyncio.sleep(0.5)

if __name__ == '__main__':
    asyncio.run(test())
