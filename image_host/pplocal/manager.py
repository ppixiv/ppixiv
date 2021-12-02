import asyncio, os, time
from pathlib import Path, PurePosixPath
from collections import OrderedDict, namedtuple

from .util import misc
from .util.paths import open_path
from .library import Library

_library_paths = {
}

class Manager:
    """
    This class can be accessed as request.app['manager'].
    """
    def __init__(self, app):
        self.app = app
        self.api_list_results = OrderedDict()

        # Figure out where to put our files.  We can put it in AppData for a regular
        # installation, but it's convenient to have it in a local directory for
        # development.
        local_data = False
        if local_data:
            # Get AppData/Local.
            local_data = Path(os.getenv('LOCALAPPDATA'))
            data_dir = local_data / 'ppixiv'
        else:
            data_dir = Path(os.path.dirname(__file__)) / '../data'
        
        self._data_dir = data_dir.resolve()
        self._data_dir.mkdir(parents=True, exist_ok=True)

        self.library = Library(self._data_dir)

        app.on_shutdown.append(self.shutdown)

    async def shutdown(self, app):
        print('Shutting down')
        for name in list(self.library.mounts.keys()):
            await self.library.unmount(name)
        
    async def init(self):
        print('Initializing libraries...')

        for name, path in _library_paths.items():
            path = Path(path)
            path = path.resolve()
            if not path.exists():
                print('Library path doesn\'t exist: %s', str(path))
                continue

            if not path.is_dir():
                print('Library path isn\'t a directory: %s', str(path))
                continue

            def progress_func(total):
                print('Indexing progress for %s: %i' % (path, total))

            self.library.mount(path, name)

            print('Initializing library: %s' % path)

            # Run a quick refresh at startup.
            start = time.time()
            await self.library.quick_refresh()
            # await library.refresh(progress=progress_func)
            end = time.time()
            print('Indexing took %.2f seconds' % (end-start))

    def resolve_path(self, relative_path):
        """
        Given a folder: or file: ID, return the absolute path to the file or directory
        and the library it's in.  If the path isn't in a library, raise Error.
        """
        relative_path = PurePosixPath(relative_path)
        if '..' in relative_path.parts:
            raise misc.Error('invalid-request', 'Invalid request')

        library_name, path_inside_library = Library.split_library_name_and_path(relative_path)
        mount = self.library.mounts.get(library_name)
        if mount is None:
            raise misc.Error('not-found', 'Library %s doesn\'t exist' % library_name)

        path = Path(mount) / path_inside_library
        path = open_path(path)

        return path, self.library
    
    # Values of api_list_results can be a dictionary, in which case they're a result
    # cached from a previous call.  They can also be a function, which is called to
    # retrieve the next page, which is used to continue previous searches.
    cached_result = namedtuple('cached_result', ('result', 'prev_uuid', 'next_offset'))
    def cache_api_list_result(self, uuid, cached_result):
        self.api_list_results[uuid] = cached_result
        
        # Delete old cached entries.
        # XXX: we can keep more cached results than this, but we should expire
        # old active requests after a while so we don't keep searches open forever
        uuids = list(self.api_list_results.keys())
        max_cache_entries = 25
        uuids = uuids[:-max_cache_entries]
        for erase_uuid in uuids:
            assert erase_uuid != uuid
            self.api_list_cache_erase(erase_uuid)

    def get_api_list_result(self, uuid):
        if uuid is None:
            return None

        return self.api_list_results.get(uuid, None)

    def api_list_cache_erase(self, uuid):
        """
        Remove the given cache page from the cache.  If the cache entry is a generator
        for continuing a search, it will be closed and GeneratorExit will be raised inside
        it.
        """
        result = self.api_list_results.get(uuid, None)
        if result is None:
            return

        del self.api_list_results[uuid]

        if hasattr(result.result, 'send'):
            result.result.close()

    def clear_api_list_cache(self):
        """
        Clear the api/list cache.
        """
        # If any of these are generators, close them to shut them down cleanly.
        uuids = self.api_list_results.keys()
        for uuid in uuids:
            self.api_list_cache_erase(uuid)

        assert len(self.api_list_results) == 0

