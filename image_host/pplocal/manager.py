import time
from pathlib import Path, PurePosixPath

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

        app.on_shutdown.append(self.shutdown)

    async def shutdown(self, app):
        print('Shutting down')
        for library in self.libraries.values():
            library.stop_monitoring()
        
    async def init(self):
        print('Initializing libraries...')

        for name, path in _library_paths.items():
            def progress_func(total):
                print('Indexing progress for %s: %i' % (path, total))

            library = Library(name, name + '.sqlite', path)
            self.libraries[name] = library
            print('Initializing library: %s' % path)
            library.monitor()

            # XXX
            start = time.time()
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
