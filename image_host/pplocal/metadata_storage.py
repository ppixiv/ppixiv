import json, os
from .util import win32

metadata_filename = '.ppixivbookmark.json.txt'

def load_directory_metadata(directory_path, filename=None):
    """
    Get stored metadata for files in path.  This currently only stores bookmarks.
    If no metadata is available, return an empty dictionary.

    If filename is set, return metadata for just that file.

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
        # return just the data for this file?
        # need it all to rewrite
        this_metadata_filename = os.fspath(directory_path) + "/" + metadata_filename
        with open(this_metadata_filename, 'rt', encoding='utf-8') as f:
            data = f.read()
            result = json.loads(data)
            result = result['data']
            if filename is not None:
                return result.get(filename, {})
            else:
                return result
    except FileNotFoundError:
        return { }
    except json.decoder.JSONDecodeError as e:
        print('Error reading metadata from %s: %s' % (directory_path, e))
        return { }

def save_directory_metadata(path, data):
    this_metadata_filename = os.fspath(path) + "/" + metadata_filename
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
    json_data = json.dumps(data, indent=4) + '\n'

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

def load_file_metadata(path):
    # If path is a directory, read the metadata file inside it.  If it's a file,
    # read the metadata file in the same directory.
    directory_path = path if path.is_dir() else path.parent
    filename = '.' if path.is_dir() else path.name

    metadata = load_directory_metadata(directory_path)
    return metadata.get(filename, {})

def save_file_metadata(path, data):
    directory_path = path if path.is_dir() else path.parent
    filename = '.' if path.is_dir() else path.name

    # Read the full metadata so we can replace this file.
    metadata = load_directory_metadata(directory_path)

    # If data is empty, remove this record.
    if not data:
        if filename in metadata:
            del metadata[filename]
    else:
        metadata[filename] = data

    save_directory_metadata(directory_path, metadata)
