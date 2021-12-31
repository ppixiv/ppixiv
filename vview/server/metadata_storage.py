import copy, json, os, threading
from contextlib import contextmanager
from ..util import win32
from ..util.paths import open_path
from pprint import pprint

metadata_filename = '.vview.txt'

# A mapping from metadata filenames to their contents.
#
# Note that we always deep copy these objects before returning them to callers.
_metadata_cache = {}

# This is held while accessing _metadata_cache or doing any operations on
# metadata files.
_metadata_lock = threading.RLock()

def load_directory_metadata(directory_path, return_copy=True):
    """
    Get stored metadata for files in path.  This currently only stores bookmarks.
    If no metadata is available, return an empty dictionary.

    This is a hidden file in the directory which stores metadata for all files
    in the directory, as well as the directory itself.  This has a bunch of
    advantages over putting the data in each file:

    - Every file format has its own way of storing metadata, and there are no
    robust libraries that handle all of them.
    - We don't have to modify the user's files, so there's no chance of us screwing
    up and causing data loss.
    - Opening each file during a refresh is extremely slow. It's much faster to
    have a single file that we only read once per directory scan.
    - We can use Windows Search to search this data if we format it properly.  Use
    a file extension that it indexes by default (we use .txt), and we can insert
    keywords in the file that we can search for.  Windows Search will index metadata
    for some file types, but it's hit-or-miss (it handles JPEGs much better than PNGs).
    """
    with _metadata_lock:
        return _load_directory_metadata_locked(directory_path, return_copy=return_copy)

def _load_directory_metadata_locked(directory_path, *, return_copy=True):
    try:
        this_metadata_filename = os.fspath(directory_path / metadata_filename)
        result = _metadata_cache.get(this_metadata_filename)
        if result is not None:
            if return_copy:
                result = copy.deepcopy(result)
            return result

        with open(this_metadata_filename, 'rt', encoding='utf-8') as f:
            data = f.read()
            try:
                result = json.loads(data)
            except ValueError as e:
                print('Metadata file %s is corrupt: %s' % (this_metadata_filename, str(e)))
                result = {}

            result = result.get('data', { })
            if not isinstance(result, dict):
                print('Metadata file %s is corrupt: data isn\'t a dictionary' % this_metadata_filename)
                result = { }

            _metadata_cache[this_metadata_filename] = result
            return result
    except FileNotFoundError:
        _metadata_cache[this_metadata_filename] = { }
        return { }
    except json.decoder.JSONDecodeError as e:
        print('Error reading metadata from %s: %s' % (this_metadata_filename, e))
        _metadata_cache[this_metadata_filename] = { }
        return { }

def save_directory_metadata(directory_path, data):
    with _metadata_lock:
        return _save_directory_metadata_locked(directory_path, data)

def _save_directory_metadata_locked(directory_path, data):
    this_metadata_filename = directory_path / metadata_filename
    this_metadata_filename = open_path(this_metadata_filename)

    # If there's no data, delete the metadata file if it exists.
    if not data:
        this_metadata_filename.unlink(missing_ok=True)

        if os.fspath(this_metadata_filename) in _metadata_cache:
            del _metadata_cache[os.fspath(this_metadata_filename)]
        return

    data = {
        'identifier': 'vviewmetadatafile',
        'version': 1,
        'data': data,
    }
    json_data = json.dumps(data, indent=4, ensure_ascii=False) + '\n'

    # Write the new metadata to a temporary file.
    temp_metadata_filename = this_metadata_filename.with_suffix('.temp')
    with open(temp_metadata_filename, 'w+t', encoding='utf-8') as f:
        f.write(json_data)

    # If the file is hidden, Windows won't let us overwrite it, which doesn't
    # make much sense.  We have to open it for writing (but not overwrite) and
    # unset the hidden bit.
    try:
        with this_metadata_filename.open('r+t', shared=False) as f:
            win32.set_file_hidden(f, hide=False)
    except FileNotFoundError:
        pass

    # Overwrite the metadata file with the new one.
    temp_metadata_filename.replace(this_metadata_filename)

    # Hide the file so we don't clutter the user's directory if possible.
    with this_metadata_filename.open('r+t', shared=False) as f:
        win32.set_file_hidden(f, hide=True)

    # Only update our cache once we've successfully written the new data.
    _metadata_cache[os.fspath(this_metadata_filename)] = copy.deepcopy(data.get('data', { }))

def _directory_path_for_file(path):
    """
    Given a path, return the directory its metadata file is in and the filename
    of the file inside it.
    """
    if path.real_file and path.is_dir():
        # If this is a directory on disk, put the metadata for the directory itself inside
        # the directory instead of in the parent directory.  Don't do this for ZIPs (which
        # are "directories" but we don't write files into them).
        directory_path = path
    else:
        # Put data about the file in the containing directory.
        directory_path = path.filesystem_parent

    filename = path.relative_to(directory_path)
    return directory_path, filename

def load_file_metadata(path, *, return_copy=True):
    """
    Return metadata for the given path.

    If metadata for the parent directory has already been loaded with
    load_directory_metadata, it can be specified with directory_metadata
    to avoid loading it repeatedly while scanning directories.
    """
    with _metadata_lock:
        return _load_file_metadata_locked(path, return_copy=return_copy)

@contextmanager
def load_and_lock_file_metadata(path):
    """
    Yield the metadata for path, locking all metadata until the context manager
    completes.

    This is used for writing metadata.  The caller should call save_file_metadata
    before exiting the context manager.
    """
    with _metadata_lock:
        result = _load_file_metadata_locked(path)
        yield result

def _load_file_metadata_locked(path, *, return_copy=True):
    directory_path, filename = _directory_path_for_file(path)
    directory_metadata = load_directory_metadata(directory_path, return_copy=return_copy)

    result = directory_metadata.get(str(filename), {})
    if not isinstance(result, dict):
        print('Metadata for %s is corrupt' % path)
        result = {}

    return result

def has_file_metadata(path):
    """
    Return true if path has metadata.
    """
    return len(load_file_metadata(path, return_copy=False)) != 0

def save_file_metadata(path, data):
    with _metadata_lock:
        return _save_file_metadata_locked(path, data)

def _save_file_metadata_locked(path, data):
    directory_path, filename = _directory_path_for_file(path)

    # Read the full metadata so we can replace this file.
    directory_metadata = load_directory_metadata(directory_path)

    # If data is empty, remove this record.
    if not data:
        if str(filename) in directory_metadata:
            del directory_metadata[str(filename)]
    else:
        directory_metadata[str(filename)] = data

    _save_directory_metadata_locked(directory_path, directory_metadata)

def get_files_with_metadata(metadata_path):
    """
    Given the filename to a metadata file, return paths to the files the metadata
    file contains.
    """
    assert metadata_path.name == metadata_filename
    directory_path = metadata_path.parent
    directory_metadata = load_directory_metadata(directory_path)

    return [open_path(directory_path / filename) for filename in directory_metadata.keys()]

