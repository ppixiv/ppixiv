import ctypes, os, msvcrt, traceback, errno, json
from ctypes.wintypes import BYTE, DWORD

kernel32 = ctypes.windll.kernel32

CreateFileW = kernel32.CreateFileW
CloseHandle = kernel32.CloseHandle
CancelIoEx = kernel32.CancelIoEx

FILE_LIST_DIRECTORY = 1

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000

FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
FILE_SHARE_DELETE = 0x00000004
FILE_ATTRIBUTE_NORMAL = 0x80
FILE_FLAG_BACKUP_SEMANTICS    = 0x02000000
FILE_FLAG_RANDOM_ACCESS       = 0x10000000

CREATE_NEW = 1
CREATE_ALWAYS = 2
OPEN_EXISTING = 3
OPEN_ALWAYS = 4
TRUNCATE_EXISTING = 5

ERROR_OPERATION_ABORTED = 995

def open_shared(path, mode='r'):
    """
    Open a file with all FILE_SHARE flags enabled.  This lets us index and update
    files without locking them, so our background process doesn't interfere with the
    user.
    """
    # We always open in binary mode.
    open_mode = mode.replace('b', '')
    if open_mode == 'r':
        access = GENERIC_READ
        disposition = OPEN_EXISTING
    elif open_mode == 'r+':
        access = GENERIC_READ|GENERIC_WRITE
        disposition = OPEN_EXISTING
    elif open_mode == 'w':
        access = GENERIC_WRITE
        disposition = CREATE_ALWAYS
    elif open_mode == 'w+':
        access = GENERIC_READ|GENERIC_WRITE
        disposition = CREATE_ALWAYS

    handle = CreateFileW(
        str(path),
        access,

        # Don't lock the file in any way.  We're accessing files in the background
        # and we need to be sure not to interfere with whatever the user's doing with
        # them.
        FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,

        None, # lpSecurityAttributes
        disposition,
        FILE_ATTRIBUTE_NORMAL|FILE_FLAG_RANDOM_ACCESS,
        None)

    if handle == -1:
        raise ctypes.WinError()

    try:
        fd = msvcrt.open_osfhandle(handle, os.O_RDONLY)
    except:
        # If open_osfhandle throws an error, it didn't take ownership of the handle, so
        # close the handle.
        CloseHandle(handle)
        raise

    try:
        # XXX: Is there a way we can assign the filename to the resulting file, so
        # exceptions and f.name are still meaningful?
        return open(fd, mode)
    except:
        # If open() fails, close the FD, which will also close the handle.
        os.close(fd)
        raise

def read_directory_metadata(path: os.PathLike, metadata_filename):
    """
    If this is a directory, see if we've stored metadata in our NTFS
    stream.  This is the only way to associate data with a directory.
    """
    stream_filename = str(path) + ':' + metadata_filename

    try:
        # Open this file shared, since opening this file will prevent modifying
        # the directory.
        try:
            with open_shared(stream_filename) as f:
                json_data = f.read()
        except IOError as e:
            # It's normal for this to not exist.
            if e.errno != errno.ENOENT:
                raise

            # print('No directory metadata: %s' % path)
            return {}

        try:
            data = json.loads(json_data)
        except ValueError:
            print('Directory metadata invalid: %s', stream_filename)
            return {}

        if not isinstance(data, dict):
            print('Directory metadata invalid (not a dictionary): %s', stream_filename)
            return {}

        return data

    except Exception as e:
        print('Error reading directory metadata: %s', stream_filename)
        traceback.print_exc()
        return {}

def write_directory_metadata(path: os.PathLike, metadata_filename, data):
    """
    Save data to the given directory's metadata.
    """
    json_data = json.dumps(data, indent=4) + '\n'
    stream_filename = str(path) + ':' + metadata_filename
    with open_shared(stream_filename, mode='w') as f:
        f.write(json_data)
