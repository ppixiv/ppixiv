import time
from pathlib import Path, PurePosixPath
from collections import OrderedDict, namedtuple

from .util import misc
from .library import Library

_library_paths = {
}

class Manager:
    """
    This class can be accessed as request.app['manager'].
    """
    def __init__(self, app):
        self.app = app
        self.libraries = {}
        self.api_list_results = OrderedDict()

        app.on_shutdown.append(self.shutdown)

    async def shutdown(self, app):
        print('Shutting down')
        for library in self.libraries.values():
            library.stop_monitoring()
        
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

            library = Library(name, path)
            self.libraries[name] = library
            print('Initializing library: %s' % path)
            library.monitor()

            # Run a quick refresh at startup.
            start = time.time()
            await library.quick_refresh()
            # await library.refresh(progress=progress_func)
            end = time.time()
            print('Indexing took %.2f seconds' % (end-start))

    @property
    def all_libraries(self):
        return self.libraries.values()

    def resolve_path(self, path):
        """
        Given a folder: or file: ID, return the absolute path to the file or directory
        and the library it's in.  If the path isn't in a library, raise Error.
        """
        path = PurePosixPath(path)
        if '..' in path.parts:
            raise misc.Error('invalid-request', 'Invalid request')

        library_name, path = Library.split_library_name_and_path(path)
        library = self.libraries.get(library_name)
        if library is None:
            raise misc.Error('not-found', 'Library %s doesn\'t exist' % library_name)

        return library.path / path, library
    
    # Values of api_list_results can be a dictionary, in which case they're a result
    # cached from a previous call.  They can also be a function, which is called to
    # retrieve the next page, which is used to continue previous searches.
    cached_result = namedtuple('cached_result', ('result', 'prev_uuid', 'next_offset'))
    def cache_api_list_result(self, uuid, cached_result):
        self.api_list_results[uuid] = cached_result
        
        # Delete old cached entries.
        # XXX: we can keep more cached results than this, but we should expire
        # old active requests after a while so we don't keep searches open forever
        # XXX: let windows searches complete and just queue them, so the cursor doesn't
        # stay open
        uuids = list(self.api_list_results.keys())
        max_cache_entries = 10
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

