import asyncio, logging, traceback, os, sys, signal
from pprint import pprint
from pathlib import Path, PurePosixPath
from collections import OrderedDict, namedtuple

from .settings import Settings
from ..util import misc, win32, windows_ui
from ..util.paths import open_path, PathBase
from ..util.threaded_tasks import AsyncTask
from ..database.signature_db import SignatureDB
from .library import Library
from .api_server import APIServer

misc.config_logging()
log = logging.getLogger(__name__)

class Server:
    """
    The main top-level class for the background server application.
    """
    def main(self):
        """
        Run the application.  Return true if the application ran (and exited), or false if
        another instance of the application was already running.
        """
        # Take the server lock, so other instances of the server won't start and we can tell
        # that we're running.
        if not win32.take_server_lock():
            log.info('The server is already running')
            return False

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        self._main_task = self._main()
        self._main_task = loop.create_task(self._main_task)
        self._main_task.set_name('Server')

        # KeyboardInterrupt has a lot of problems (bad interactions with asyncio, breaks
        # thread.wait() in weird ways, etc.), so catch SIGINT and cancel cleanly.  
        def sigint(sig, sig_info):
            log.info('^C received')
            self.exit('^C')
        signal.signal(signal.SIGINT, sigint)

        try:
            # self._main will run until the application is ready to exit.
            loop.run_until_complete(self._main_task)
        except asyncio.CancelledError as e:
            # We're cancelled when self.exit() is called.  Don't propagate this to the caller.
            pass
        finally:
            # Shut down all tasks.
            while True:
                tasks = asyncio.all_tasks(loop)
                if not tasks:
                    break

                for task in tasks:
                    task.cancel()

                loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))

                for task in tasks:
                    if not task.cancelled() and task.exception() is not None:
                        loop.call_exception_handler({
                            'message': 'unhandled exception during asyncio.run() shutdown',
                            'exception': task.exception(),
                            'task': task,
                        })

            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()

        return True

    async def _main(self):
        """
        The main task.  Initialize the manager, loop until this task is cancelled, then
        shut down.
        """
        await self._init()

        try:
            while True:
                # ProactorEventLoop only checks for SIGINT when an event is handled, so if this
                # is raised, ^C becomes unresponsive.
                await asyncio.sleep(.1)
        finally:
            await self._shutdown()

    async def _init(self):
        self.api_list_results = OrderedDict()

        # Set up the Windows tray icon and terminal window.
        windows_ui.WindowsUI.get.create(self.exit)

        misc.fix_pil()

        # Figure out where to put our files.
        local_data = Path(os.getenv('LOCALAPPDATA'))
        data_dir = local_data / 'vview'
        
        data_dir = open_path(data_dir.resolve())
        self.data_dir = data_dir
        self.data_dir.mkdir()

        self.settings = Settings(self.data_dir / 'settings.json')
        self.library = Library(self.data_dir)
        self.sig_db = SignatureDB(self.data_dir / 'signatures.sqlite')

        # Start the API server.
        self.api_server = APIServer()
        await self.api_server.init(self)

        # The remaining tasks can take some time, but we don't need to wait for them, so
        # we run them asynchronously.
        #
        # Load the image signature database.
        load_index_task = self.sig_db.load_image_index()
        self.run_background_task(load_index_task, name=f'Signature db')

        # Initialize libraries.
        log.info('Initializing libraries...')

        for folder_info in self.settings.get_folders():
            name = folder_info['name']
            path = folder_info['path']

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
        self.run_background_task(refresh_task, name=f'Indexing {name}')

    async def _shutdown(self):
        log.info('Shutting down manager')

        await self.api_server.shutdown()

        for name in list(self.library.mounts.keys()):
            await self.library.unmount(name)
        
    def exit(self, reason='not specified'):
        """
        Exit the application.
        """
        # Ending the main task will exit the application.
        log.info(f'Manager exiting (reason: {reason})')
        self._main_task.cancel(reason)

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
        AsyncTask.run(func, name=name)

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

# Note that it's safer to start the server with vview.server.start_server, since it can
# display fatal errors more reliably.
if __name__ == '__main__':
    Server().main()
