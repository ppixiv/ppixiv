from ctypes import *
from ctypes.wintypes import *
import asyncio, sys, io, os, msvcrt, win32api, win32con, win32event, logging
from pathlib import Path
from enum import Enum

log = logging.getLogger(__name__)

class VVtermEvent(Enum):
    Close = 1
    Shutdown = 2
    Minimized = 3

class VVterm:
    """
    A low-level binding for VVterm.dll.  This allows creating and manipulating the terminal window,
    which is used for logging and diagnostics.

    Note that only one instance of this class is supported.
    """
    def __init__(self):
        self._events_handle = None
        self._display_handle = None
        self.dll = self._get_dll()

    def create(self):
        if not self.dll:
            return False
        
        self.dll.VVterm_Create()

        # Get the display and event handles.
        events_handle = HANDLE()
        display_handle = HANDLE()
        self.dll.VVterm_GetHandles(byref(events_handle), byref(display_handle))
        self._events_handle = events_handle.value
        self._display_handle = display_handle.value
        return True

    def _get_dll(self):
        # vview/util/vvterm.py -> bin/VVterm.dll
        # The source for this DLL is in bin.
        dll_path = Path(__file__) / '../../..' / 'bin' / 'VVterm.dll'
        dll_path = dll_path.resolve()
        try:
            dll = CDLL(str(dll_path))
        except FileNotFoundError:
            log.warn('VVTerm.dll not available')
            return None

        dll.VVterm_SetVisible.argtypes = (c_bool,)
        dll.VVterm_GetHandles.argtypes = (POINTER(HANDLE), POINTER(HANDLE))
        return dll

    def shutdown(self):
        """
        Shut down the terminal, closing the window.
        """
        self.dll.VVterm_Shutdown()

        # The handles are no longer valid.
        self._events_handle = None
        self._display_handle = None
        
    def set_visible(self, visible):
        self.dll.VVterm_SetVisible(visible)

    def get_display_handle(self):
        """
        Return a bidirectional pipe that can be used to read and write to the terminal window.

        Most of the time, open_handles() should be used instead.
        """
        return self._display_handle

    def open_handles(self):
        display_handle = self.get_display_handle()

        # We should be able to just return a read-write file pointing at our pipe, but some Python
        # limitations get in the way:
        #
        # - "Universal newlines" don't seem to work.  If newline is None, Python will perform an extra
        # blocking read block after a \r, causing newlines to be delayed by one input.  It seems like it's
        # waiting to see if the \r is followed by \n, but that doesn't make sense, and _PyIO_find_line_ending
        # says "The decoder ensures that \r\n are not split in two pieces": it assumes \r\n always comes in
        # the same read and shouldn't do this.  I'm not sure what's happening, but since we know newlines
        # are always \r, just set that for now.
        #
        # - It won't let you set different newlines for input and output.  Typically input newlines are
        # \r, but output newlines are \r\n, and it can't handle this.  It seems like they only thought of
        # having two separate files (stdin and stdout), which seems like an oversight.
        #
        # Work around this by duplicating the bidirectional handle and splitting it into a read and write
        # file.
        stdout_handle = win32api.DuplicateHandle(win32api.GetCurrentProcess(), display_handle, win32api.GetCurrentProcess(),
            0, 0, win32con.DUPLICATE_SAME_ACCESS)

        stdin_fd = msvcrt.open_osfhandle(display_handle, os.O_RDONLY)
        stdout_fd = msvcrt.open_osfhandle(stdout_handle.handle, os.O_WRONLY)

        stdin = io.open(stdin_fd, 'rt', buffering=1, encoding='utf-8', newline='\r')
        stdout = io.open(stdout_fd, 'wt', buffering=1, encoding='utf-8', newline='\r\n')

        # display_handle is just an int, but DuplicateHandle created a PyHANDLE, which will close the
        # handle when it's destroyed.  We don't want that since the handle is owned by stdout, so detach
        # the handle.
        stdout_handle.Detach()

        return stdin, stdout

    async def wait_for_event(self):
        """
        Wait until an event may be available from get_next_event.
        """
        # If we have no event handle, we're shut down and return immediately.  get_next_event()
        # will always return VVtermEvent.Shutdown when we're shut down, so the calling loop will
        # know to exit.
        if not self._events_handle:
            return

        try:
            def wait():
                win32event.WaitForSingleObject(self._events_handle, win32event.INFINITE)

            try:
                # Run WaitForSingleObject in a thread.
                #
                # This is racey, since we might close the handle before WaitForSingleObject starts.
                # asyncio should really handle this for us, but the only thing I can find is inside
                # IocpProactor.  In practice this probably won't matter, but asyncio really needs
                # better platform support.
                return await asyncio.to_thread(wait)
            except asyncio.CancelledError:
                # Signal the event to make sure wait() exits if we're cancelled.  It may be None if
                # we've been shut down.
                if self._events_handle is not None:
                    win32event.SetEvent(self._events_handle)
                raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise

    def get_next_event(self):
        """
        Return the next event from the terminal, if any.

        This is also used to progress internal I/O after wait_for_event returns, so it's normal
        for this to not return an event.
        """
        event = self.dll.VVTerm_GetNextEvent()
        if event == 0:
            return None
        return VVtermEvent(event)

async def go():
    """
    Test code for the terminal window.
    """
    VVterm.create()
    VVterm.set_visible(True)
    stdin, stdout = VVterm.open_handles()

#    stdin.readline()
#    sys.stdin = stdin
#    sys.stdout = stdout
#    print(stdin.read(1))
#    a = input()

    stdout.write('test\n')

    async def handle_events():
        while True:
            await VVterm.wait_for_event()

            # Read all available events.
            while True:
                match VVterm.get_next_event():
                    case None:
                        # There are no more events waiting.
                        break

                    case VVtermEvent.Close | VVTermVVtermEventEvent.Minimized:
                        # If the user closes or minimizes the window, set it not visible, since we're
                        # minimizing to the tray.
                        print('Terminal window closed')
                        VVterm.set_visible(False)
                    case VVtermEvent.Shutdown:
                        print('Terminal window shut down')
                        return

    await asyncio.create_task(handle_events(), name='VVterm')
    return

    while True:
        print("---")
        a = stdin.readline()
        print(len(a), a)
        print(', '.join('%x' % ord(c) for c in a))
        print("---")

if __name__ == '__main__':
    asyncio.run(go())
