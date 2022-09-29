import asyncio, logging, os, time
from pathlib import Path, PurePosixPath
from collections import OrderedDict, namedtuple

from .auth import Auth
from ..util import misc
from ..util.paths import open_path, PathBase
from ..util.threaded_tasks import AsyncTaskQueue
from ..database.signature_db import SignatureDB
from .library import Library

log = logging.getLogger(__name__)

class Manager:
    """
    This class can be accessed as request.app['manager'].
    """
    def __init__(self, app):
        self.app = app
        self.api_list_results = OrderedDict()
        self.task_queue = AsyncTaskQueue()

        # Figure out where to put our files.
        local_data = Path(os.getenv('LOCALAPPDATA'))
        data_dir = local_data / 'vview'
        
        data_dir = open_path(data_dir.resolve())
        self.data_dir = data_dir
        self.data_dir.mkdir()

        self.auth = Auth(self.data_dir / 'settings.json')
        self.library = Library(self.data_dir)
        self.sig_db = SignatureDB(self.data_dir / 'signatures.sqlite')
        self.sig_db.load_image_index()

        app.on_shutdown.append(self.shutdown)

    async def shutdown(self, app):
        log.info('Shutting down manager')

        await self.task_queue.shutdown()

        for name in list(self.library.mounts.keys()):
            await self.library.unmount(name)
        
    async def init(self):
        log.info('Initializing libraries...')
        for folder in self.auth.data.get('folders', []):
            name = folder.get('name')
            path = folder.get('path')

            path = Path(path)
            path = path.resolve()
            if not path.exists():
                log.warn('Library path doesn\'t exist: %s', str(path))
                continue

            if not path.is_dir():
                log.warn('Library path isn\'t a directory: %s', str(path))
                continue

            self.library.mount(path, name)

            # Run a quick refresh at startup.  This can still take a few seconds for larger
            # libraries, so run this in a task to allow requests to start being handled immediately.
            refresh_task = self.library.quick_refresh()
            self.run_background_task(refresh_task, name=f'Indexing {path}')

    def resolve_path(self, relative_path):
        """
        Given a folder: or file: ID, return the absolute path to the file or directory
        and the library it's in.  If the path isn't in a library, raise Error.
        """
        relative_path = PurePosixPath(relative_path)
        if '..' in relative_path.parts:
            raise misc.Error('invalid-request', 'Invalid request')

        library_name, path_inside_library = Library.split_library_name_and_path(relative_path)
        if library_name == 'root':
            path = Path(str(path_inside_library))
        else:
            mount = self.library.mounts.get(library_name)
            if mount is None:
                raise misc.Error('not-found', 'Library %s doesn\'t exist' % library_name)
            path = Path(mount) / path_inside_library
        path = open_path(path)

        return path

    def run_background_task(self, func, *, name=None):
        """
        Run a background task.
        """
        return self.task_queue.run_task(func, name=name)

    # Values of api_list_results can be a dictionary, in which case they're a result
    # cached from a previous call.  They can also be a function, which is called to
    # retrieve the next page, which is used to continue previous searches.
    cached_result = namedtuple('cached_result', ('result', 'prev_uuid', 'next_offset'))
    def cache_api_list_result(self, uuid, cached_result):
        self.api_list_results[uuid] = cached_result
        
        # Delete old cached entries.
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

    def check_path(self, path, request, throw=False):
        """
        Return true if path should be accessible to the current request.
        If throw is true, raise an API exception.
        """
        # If path isn't in a mounted directory, only allow access for the local UI.
        # Otherwise, we'd be giving Pixiv full access to the filesystem.
        if self.library.get_mount_for_path(path):
            return True

        if not request['is_local']:
            log.warn('Not allowing access for non-local request: %s', path)
            if throw:
                raise misc.Error('not-found', 'File not in library')
            else:
                return False

        return True
