import ctypes, os, msvcrt, traceback, errno, json, logging
from ctypes import wintypes

log = logging.getLogger(__name__)

kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)

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

def open_handle_shared(path, mode='r'):
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
        # \\?\ enables long filename support.
        '\\\\?\\' + str(path),
        access,

        # Don't lock the file in any way.  We're accessing files in the background
        # and we need to be sure not to interfere with whatever the user's doing with
        # them.
        FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,

        None, # lpSecurityAttributes
        disposition,
        FILE_ATTRIBUTE_NORMAL|FILE_FLAG_RANDOM_ACCESS|FILE_FLAG_BACKUP_SEMANTICS,
        None)

    if handle == -1:
        raise ctypes.WinError(ctypes.get_last_error())
    return handle

def open_shared(path, mode='r', encoding=None):
    """
    Open a file with all FILE_SHARE flags enabled.  This lets us index and update
    files without locking them, so our background process doesn't interfere with the
    user.
    """
    handle = open_handle_shared(path, mode)

    try:
        fd = msvcrt.open_osfhandle(handle, os.O_RDONLY)
    except:
        # If open_osfhandle throws an error, it didn't take ownership of the handle, so
        # close the handle.
        CloseHandle(handle)
        raise

    try:
        return open(fd, mode, encoding=encoding)
    except:
        # If open() fails, close the FD, which will also close the handle.
        os.close(fd)
        raise

def read_metadata(path: os.PathLike, metadata_filename):
    """
    If this is a directory, see if we've stored metadata in our NTFS
    stream.  This is the only way to associate data with a directory.
    """
    stream_filename = os.fspath(path) + ':' + metadata_filename

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

            # log.error('No directory metadata: %s' % path)
            return {}

        try:
            data = json.loads(json_data)
        except ValueError:
            log.error('Directory metadata invalid: %s', stream_filename)
            return {}

        if not isinstance(data, dict):
            log.error('Directory metadata invalid (not a dictionary): %s', stream_filename)
            return {}

        return data

    except Exception as e:
        log.exception('Error reading directory metadata: %s', stream_filename)
        return {}

def write_metadata(path: os.PathLike, metadata_filename, data):
    """
    Save data to the given directory's metadata.
    """
    json_data = json.dumps(data, indent=4) + '\n'
    stream_filename = str(path) + ':' + metadata_filename
    with open_shared(stream_filename, mode='w') as f:
        f.write(json_data)

kernel32.GetVolumeInformationW.argtypes = \
    wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD, wintypes.LPDWORD, \
    wintypes.LPDWORD, wintypes.LPDWORD, wintypes.LPWSTR, wintypes.DWORD
kernel32.GetVolumeInformationW.restype = wintypes.BOOL

_volume_id_cache = {}
def get_volume_serial_number(root):
    """
    Get the serial number for a drive.
    """
    if not root.is_absolute():
        raise OSError('Path %s is not absolute' % root)

    if root in _volume_id_cache:
        return _volume_id_cache[root]

    root = root.drive + '\\'
    serial_number = wintypes.DWORD()
    result = kernel32.GetVolumeInformationW(root, None, 0, ctypes.byref(serial_number), None, None, None, 0)
    if not result:
        log.warn('Couldn\'t get volume ID for %s: %s' % (str(root), ctypes.WinError(ctypes.get_last_error())))
        return None

    _volume_id_cache[root] = serial_number.value
    return serial_number.value

class FILE_BASIC_INFO(ctypes.Structure):
    _fields_ = [
        ('CreationTime', wintypes.LARGE_INTEGER),
        ('LastAccessTime', wintypes.LARGE_INTEGER),
        ('LastWriteTime', wintypes.LARGE_INTEGER),
        ('ChangeTime', wintypes.LARGE_INTEGER),
        ('FileAttributes', wintypes.DWORD),
    ]

SetFileInformationByHandle = kernel32.SetFileInformationByHandle
GetFileInformationByHandleEx = kernel32.GetFileInformationByHandleEx

FileBasicInfo = 0
FILE_ATTRIBUTE_HIDDEN = 2

def go():
    from pathlib import Path
    serial = get_volume_serial_number(Path('c:\\'))
    log.info(serial)

def set_file_hidden(file, hide=True):
    """
    Show or hide a file.

    This sets or clears the FILE_ATTRIBUTE_HIDDEN file attribute.  The file must
    be open for writing.
    """
    # For some reason, Windows won't let us open a file for overwrite when its
    # hidden bit is set.
    info = FILE_BASIC_INFO()
    handle = msvcrt.get_osfhandle(file.fileno())
    if not GetFileInformationByHandleEx(handle, FileBasicInfo, ctypes.byref(info), ctypes.sizeof(info)):
        raise ctypes.WinError(ctypes.get_last_error())

    original_attributes = info.FileAttributes
    if hide:
        info.FileAttributes |= FILE_ATTRIBUTE_HIDDEN
    else:
        info.FileAttributes &= ~FILE_ATTRIBUTE_HIDDEN

    if info.FileAttributes == original_attributes:
        return

    if not SetFileInformationByHandle(handle, FileBasicInfo, ctypes.byref(info), ctypes.sizeof(info)):
        raise ctypes.WinError(ctypes.get_last_error())

_server_lock_handle = None
_server_lock_name = 'vview-server-lock'

EVENT_MODIFY_STATE = 0x0002
ERROR_FILE_NOT_FOUND = 2
ERROR_ALREADY_EXISTS = 0xB7

def take_server_lock():
    """
    Open the server lock, claiming ourself as the server until we exit.  Return true if
    we successfully took the lock, or false if the lock was already taken.
    """
    global _server_lock_handle
    if _server_lock_handle is not None:
        # We're already locked.
        return True

    _server_lock_handle = kernel32.CreateEventExW(None, _server_lock_name, 0, EVENT_MODIFY_STATE)
    if _server_lock_handle == 0:
        # We don't expect this to fail.
        log.warn('Unable to create server lock: %s' %  ctypes.WinError(ctypes.get_last_error()))
        return False

    # If the event already existed, it's not ours, so we didn't get the lock, and we shouldn't
    # keep it open.
    already_exists = ctypes.get_last_error() == ERROR_ALREADY_EXISTS
    if already_exists:
        kernel32.CloseHandle(_server_lock_handle)
        _server_lock_handle = None
    
    return not already_exists

def is_server_running():
    """
    Return true if the server is running (either in this process or somewhere else).
    """
    if _server_lock_handle is not None:
        # We are the server.
        return True

    # Test if the server is running by trying to open the event.  We expect this to fail,
    # and we're just checking which error we get.
    handle = kernel32.OpenEventW(EVENT_MODIFY_STATE, False, _server_lock_name)

    if handle != 0:
        # We were able to open the event, so there's a server running.  We don't actually do
        # anything with the event currently, so just close it.
        kernel32.CloseHandle(handle)
        return True

    # We expect ERROR_FILE_NOT_FOUND if there's no server with the event open.
    # We don't expect other errors.
    error = ctypes.get_last_error()
    if error != ERROR_FILE_NOT_FOUND:
        log.warn('Unable to check server lock: %s' %  ctypes.WinError(ctypes.get_last_error()))

    return False
    
def go():
    with open('test.txt', 'r+b') as f:
        set_file_hidden(f, hide=False)


if __name__ == '__main__':
    go()