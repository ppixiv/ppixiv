# This handles managing file archives, and mapping between IDs and archives.
from pathlib import Path, PurePosixPath
from pprint import pprint

from . import misc
from .file_index import FileIndex

_archives = {
}

indexes = { }

async def initialize():
    def progress_func(total):
        print(total)

    for name, path in _archives.items():
        index = FileIndex(name, name + '.sqlite', path)
        indexes[name] = index
        print('Initialize index: %s' % path)
        # XXX
        # await index.refresh(progress=progress_func)
        index.monitor()

# Given a folder: or file: ID, return the absolute path to the file or directory
# and the index it's in.  If the path isn't in an index, raise Error.
def resolve_path(path):
    path = PurePosixPath(path)
    if '..' in path.parts:
        raise misc.Error('invalid-request', 'Invalid request')

    archive_name, path = FileIndex.split_archive_name_and_path(path)
    index = indexes.get(archive_name)
    if index is None:
        raise misc.Error('not-found', 'Archive %s doesn\'t exist' % archive_name)

    return index.path / path, index
