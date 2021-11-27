import json, os
from .util import win32

metadata_filename = '.ppixivbookmark.json.txt'

def load_directory_metadata(path):
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
        directory_path = path.filesystem_parent
        this_metadata_filename = os.fspath(directory_path / metadata_filename)

        with open(this_metadata_filename, 'rt', encoding='utf-8') as f:
            data = f.read()
            result = json.loads(data)
            result = result['data']
            return result
    except FileNotFoundError:
        return { }
    except json.decoder.JSONDecodeError as e:
        print('Error reading metadata from %s: %s' % (this_metadata_filename, e))
        return { }

def save_directory_metadata(path, data):
    directory_path = path.filesystem_parent
    this_metadata_filename = os.fspath(directory_path / metadata_filename)

    # If there's no data, delete the metadata file if it exists.
    if not data:
        try:
            os.unlink(this_metadata_filename)
        except FileNotFoundError:
            pass
        return
    
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

def load_file_metadata(path, *, directory_metadata=None):
    """
    Return metadata for the given path.

    If metadata for the parent directory has already been loaded with
    load_directory_metadata, it can be specified with directory_metadata
    to avoid loading it repeatedly while scanning directories.
    """
    filename = path.relative_to(path.filesystem_parent)

    if directory_metadata is None:
        directory_metadata = load_directory_metadata(path)
    return directory_metadata.get(str(filename), {})

def save_file_metadata(path, data, *, directory_metadata=None):
    filename = path.relative_to(path.filesystem_parent)

    # Read the full metadata so we can replace this file.
    if directory_metadata is None:
        directory_metadata = load_directory_metadata(path)

    # If data is empty, remove this record.
    if not data:
        if str(filename) in directory_metadata:
            del directory_metadata[str(filename)]
    else:
        directory_metadata[str(filename)] = data

    save_directory_metadata(path, directory_metadata)
