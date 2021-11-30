import copy, json, os
from .util import win32
from .util.paths import open_path

metadata_filename = '.ppixivbookmark.json.txt'

# A mapping from metadata filenames to their contents.
#
# Note that we always deep copy these objects before returning them to callers.
_metadata_cache = {}

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
    try:
        this_metadata_filename = os.fspath(directory_path / metadata_filename)
        result = _metadata_cache.get(this_metadata_filename)
        if result is not None:
            if return_copy:
                result = copy.deepcopy(result)
            return result

        with open(this_metadata_filename, 'rt', encoding='utf-8') as f:
            data = f.read()
            result = json.loads(data)
            result = result['data']
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
    this_metadata_filename = os.fspath(directory_path / metadata_filename)

    # If there's no data, delete the metadata file if it exists.
    if not data:
        try:
            os.unlink(this_metadata_filename)
        except FileNotFoundError:
            pass

        if this_metadata_filename in _metadata_cache:
            del _metadata_cache[this_metadata_filename]
        return

    _metadata_cache[this_metadata_filename] = copy.deepcopy(data)

    data = {
        'identifier': 'ppixivmetadatafile',
        'version': 1,
        'data': data,
    }
    json_data = json.dumps(data, indent=4, ensure_ascii=False) + '\n'

    # If the file is hidden, Windows won't let us overwrite it, which doesn't
    # make much sense.  We have to open it for writing (but not overwrite) and
    # unset the hidden bit.
    try:
        with open(this_metadata_filename, 'r+t', encoding='utf-8') as f:
            win32.set_file_hidden(f, hide=False)
    except FileNotFoundError:
        pass

    with open(this_metadata_filename, 'w+t', encoding='utf-8') as f:
        f.write(json_data)

        # Hide the file so we don't clutter the user's directory if possible.
        win32.set_file_hidden(f)

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
    directory_path, filename = _directory_path_for_file(path)

    directory_metadata = load_directory_metadata(directory_path, return_copy=return_copy)
    return directory_metadata.get(str(filename), {})

def has_file_metadata(path):
    """
    Return true if path has metadata.
    """
    return len(load_file_metadata(path, return_copy=False)) != 0

def save_file_metadata(path, data):
    directory_path, filename = _directory_path_for_file(path)

    # Read the full metadata so we can replace this file.
    directory_metadata = load_directory_metadata(directory_path)

    # If data is empty, remove this record.
    if not data:
        if str(filename) in directory_metadata:
            del directory_metadata[str(filename)]
    else:
        directory_metadata[str(filename)] = data

    save_directory_metadata(directory_path, directory_metadata)

def get_files_with_metadata(metadata_path):
    """
    Given the filename to a metadata file, return paths to the files the metadata
    file contains.
    """
    assert metadata_path.name == metadata_filename
    directory_path = metadata_path.parent
    directory_metadata = load_directory_metadata(directory_path)

    return [open_path(directory_path / filename) for filename in directory_metadata.keys()]

