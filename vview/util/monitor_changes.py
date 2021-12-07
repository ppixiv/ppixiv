import asyncio, ctypes, os, traceback
from pathlib import Path
from ctypes.wintypes import BYTE, DWORD
kernel32 = ctypes.windll.kernel32

from . import win32

ReadDirectoryChangesW = kernel32.ReadDirectoryChangesW

FILE_NOTIFY_CHANGE_FILE_NAME = 0x00000001
FILE_NOTIFY_CHANGE_DIR_NAME = 0x00000002
FILE_NOTIFY_CHANGE_ATTRIBUTES = 0x00000004
FILE_NOTIFY_CHANGE_SIZE = 0x00000008
FILE_NOTIFY_CHANGE_LAST_WRITE = 0x00000010
FILE_NOTIFY_CHANGE_LAST_ACCESS = 0x00000020
FILE_NOTIFY_CHANGE_CREATION = 0x00000040
FILE_NOTIFY_CHANGE_SECURITY = 0x00000100

from enum import Enum
class FileAction(Enum):
    FILE_ACTION_ADDED = 1
    FILE_ACTION_REMOVED = 2
    FILE_ACTION_MODIFIED = 3

    # These two are combined into FILE_ACTION_RENAMED, so they're never returned directly.  
    FILE_ACTION_RENAMED_OLD_NAME = 4
    FILE_ACTION_RENAMED_NEW_NAME = 5
    FILE_ACTION_RENAMED = 1000

class FileNotifyInformation(ctypes.Structure):
    _fields_ = [
        ('NextEntryOffset', DWORD),
        ('Action', DWORD),
        ('FileNameLength', DWORD),
        # ('FileName', BYTE),
    ]

class MonitorChanges:
    def __init__(self, path: os.PathLike, *, buffer_size=1024*128):
        self.path = path
        self.buffer_size = buffer_size

        self.handle = win32.CreateFileW(
                # \\?\ enables long filename support.
                '\\\\?\\' + str(path),
                win32.FILE_LIST_DIRECTORY,
                win32.FILE_SHARE_READ|win32.FILE_SHARE_WRITE|win32.FILE_SHARE_DELETE,
                None, # lpSecurityAttributes
                win32.OPEN_EXISTING, # dwCreationDisposition
                win32.FILE_FLAG_BACKUP_SEMANTICS,
                None)

        if self.handle == -1:
            raise ctypes.WinError(ctypes.get_last_error())

    def __del__(self):
        self.close()

    async def monitor_call(self, func, *args, **kwargs):
        async for (path, old_path), action in self.monitor(*args, **kwargs):
            try:
                await func(path, old_path, action)
            except Exception as e:
                print('Error monitoring %s' % self.path)
                traceback.print_exc()

    # Yield changes to the directory.
    #
    # To stop monitoring, call close() or cancel the coroutine.
    async def monitor(self, watch_subtree=True):
        # Open the directory if it's closed.  If we're called and cancelled we'll close the file
        # handle, 
        # If we're not monitoring, open the directory.
        changes = \
            FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME | FILE_NOTIFY_CHANGE_ATTRIBUTES | \
            FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_CREATION

        # Allocate the buffer locally.  This isn't reused, so if we're cancelled and a
        # ReadDirectoryChangesW call stays running briefly, we won't make another call
        # on the same buffer.
        change_buffer = (BYTE * self.buffer_size)()

        while True:
            # Run ReadDirectoryChangesW in a thread so it doesn't block the event loop.
            try:
                await asyncio.to_thread(self._read_changes, watch_subtree, changes, change_buffer)
            except asyncio.CancelledError as e:
                # If we're cancelled, call CancelIoEx to cancel ReadDirectoryChangesW which is
                # still running in the thread.  We should wait after doing that for it to return,
                # but I'm not sure how to do that with asyncio.  The handle stays open and we can
                # be called again until close() is called.
                win32.CancelIoEx(self.handle, None)
                return
            except OSError as e:
                if e.winerror == win32.ERROR_OPERATION_ABORTED:
                    # We were aborted by a call to close().
                    return

                if e.winerror == 87:
                    # ERROR_INVALID_FUNCTION means this path doesn't support monitoring.
                    # The most common cause is probably that it's an SMB mount that doesn't
                    # support it.
                    print('File monitoring not supported on volume: %s' % self.path)
                else:
                    print('Error monitoring %s: %s' % (self.path, e.strerror))

                return

            # Yield all results.
            offset = 0
            rename_old_path = None
            while True:
                entry = FileNotifyInformation.from_buffer(change_buffer, offset)

                filename_ptr = ctypes.byref(change_buffer, offset + ctypes.sizeof(FileNotifyInformation))
                filename = ctypes.wstring_at(filename_ptr, entry.FileNameLength // 2)

                path = self.path / filename
                action = FileAction(entry.Action)

                # RENAMED_OLD_NAME and RENAMED_NEW_NAME are normally received in pairs.
                # Pair them back up and return them as a single event.
                if action == FileAction.FILE_ACTION_RENAMED_OLD_NAME:
                    rename_old_path = path
                elif action == FileAction.FILE_ACTION_RENAMED_NEW_NAME:
                    if rename_old_path is None:
                        print('Received FILE_ACTION_RENAMED_NEW_NAME without FILE_ACTION_RENAMED_OLD_NAME')
                    else:
                        yield (path, rename_old_path), FileAction.FILE_ACTION_RENAMED
                        rename_old_path = None
                else:
                    rename_old_path = None

                    yield (path, None), FileAction(action)

                # NextEntryOffset is 0 for the last item.
                if entry.NextEntryOffset == 0:
                    break

                offset += entry.NextEntryOffset

    def _read_changes(self, watch_subtree, changes, change_buffer):
        bytes_returned = DWORD()
        result = ReadDirectoryChangesW(
            self.handle, # hDirectory
            change_buffer, # lpBuffer
            len(change_buffer), # nBufferLength
            watch_subtree, # bWatchSubtree,
            changes,
            ctypes.pointer(bytes_returned), # lpBytesReturned
            None, #  lpOverlapped
            None, # lpCompletionRoutine
        )

        if not result:
            raise ctypes.WinError()

        return bytes_returned

    def close(self):
        if not self.handle:
            return

        # CancelIoEx will cause any running call to ReadDirectoryChangesW to return
        # with ERROR_OPERATION_ABORTED.
        win32.CancelIoEx(self.handle, None)

        win32.CloseHandle(self.handle)
        self.handle = None

async def go():
    monitor = MonitorChanges(Path('f:/'))

    async def changes(path, old_path, action):
        print('...', path, old_path, action)
    monitor_promise = monitor.monitor_call(changes)
    monitor_task = asyncio.create_task(monitor_promise)

    await monitor_task

if __name__ == '__main__':
    asyncio.run(go())
