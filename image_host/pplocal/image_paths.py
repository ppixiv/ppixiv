# This handles managing file archives, and mapping between IDs and archives.
import os
from pathlib import Path, PurePosixPath

from . import misc

archives = {
}

image_types = ('.png', '.jpg', '.jpeg', '.bmp', '.gif')
video_types = ('.webm', '.mp4', '.m4v', '.mkv', '.mov', '.3gp', )

def file_type(path):
    _, ext = os.path.splitext(path)
    ext = ext.lower()
    if ext in image_types:
        return 'image'
    if ext in video_types:
        return 'video'
    return None

# Given an ID, return the ID without the type prefix.
def get_base_path(illust_id):
    if illust_id.startswith('file:'):
        id_path = illust_id[5:]
    elif illust_id.startswith('folder:'):
        id_path = illust_id[7:]
    else:
        raise misc.Error('not-found', 'Invalid ID "%s"' % illust_id)

    return PurePosixPath(id_path)

# Given a folder: or file: ID, return the absolute path to the file or directory.
# If it isn't valid, raise Error.
#
# For performance, this doesn't check if the file exists.
def resolve_path(illust_id, dir_only=False):
    path = get_base_path(illust_id)

    # The root doesn't correspond to a filesystem path.
    if str(path) == '/':
        raise misc.Error('invalid-request', 'Invalid request')

    # Split the archive name from the path.
    archive = path.parts[1]
    path = PurePosixPath('/'.join(path.parts[2:]))

    if path.anchor:
        raise misc.Error('invalid-request', 'Invalid request')

    top_dir = archives.get(archive)
    if top_dir is None:
        raise misc.Error('not-found', 'Archive %s doesn\'t exist' % archive)
    result = top_dir / path

    if '..' in result.parts:
        raise misc.Error('invalid-request', 'Invalid request')

    if dir_only:
        # This API is only for listing directories and doesn't do anything with files.
        if result.is_file():
            raise misc.Error('not-found', 'Path is a file')

        if not result.is_dir():
            raise misc.Error('not-found', 'Path doesn\'t exist')

    return result

def resolve_thumbnail_path(illust_id):
    """
    Return the local path to the file to use as the thumbnail for illust_id.

    If illust_id is a local: file, return the file.  If it's a directory, return
    the first image in the directory.  If there's no image to use, return None.
    """
    absolute_path = resolve_path(illust_id)
    if not illust_id.startswith('folder:'):
        return absolute_path

    # Find the first image and use that as the thumbnail.
    for idx, file in enumerate(os.scandir(absolute_path)):
        if idx > 50:
            # In case this is a huge directory with no images, don't look too far.
            # If there are this many non-images, it's probably not an image directory
            # anyway.
            break

        # Ignore nested directories.
        if file.is_dir(follow_symlinks=False):
            continue

        # XXX: handle videos
        if file_type(file.name) is None:
            continue

        return absolute_path / file.name

    return absolute_path
