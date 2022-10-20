import asyncio, ctypes, atexit, logging, sys, os, threading, time, msvcrt, subprocess
import win32api, win32gui, win32con, win32gui_struct
from . import misc
from .vvterm import VVterm, VVtermEvent
from pathlib import Path

log = logging.getLogger(__name__)

class WindowsUI:
    """
    This manages the Windows tray icon and logging window.
    """
    @classmethod
    @property
    def get(cls):
        """
        Return the singleton.
        """
        if not hasattr(cls, '_singleton'):
            cls._singleton = cls()
        return cls._singleton

    def __init__(self):
        self.terminal = None
        self.tray_icon = None

    def create(self, shutdown):
        """
        Create the Windows UI.

        shutdown is a function to call to exit the application cleanly.
        """
        self.shutdown = shutdown
        self.create_log_terminal()
        self.create_tray_icon()

    def shutdown(self):
        if self.tray_icon is not None:
            self.tray_icon.shutdown()
            self.tray_icon = None

        if self.terminal is not None:
            self.terminal.shutdown()
            self.terminal = None

    def create_tray_icon(self):
        """
        Create the Windows tray icon.

        The asyncio event loop must be running, since it's used to post menu actions back to
        the main thread.
        """
        if self.tray_icon is not None:
            return

        tray_icon_menu = [
            ('Show log', self.show_log),
            ('Exit', self.exit),
        ]
        
        self.tray_icon = _TrayIcon()
        self.tray_icon.set_tray_menu_options(tray_icon_menu, on_click=self.on_tray_click)

    def create_log_terminal(self):
        """
        Create the terminal window for log output.

        The window is hidden by default, and can be displayed using the tray icon menu.
        """
        if self.tray_icon is not None:
            return

        self.terminal = _Terminal()
        self.terminal.create()

    async def show_log(self):
        """
        Show the logging window.
        """
        self.terminal.visible = True

    async def toggle_log(self):
        """
        Toggle the logging window.
        """
        self.terminal.visible = not self.terminal.visible

    async def on_tray_click(self):
        # Open a browser window to our UI.  Run this is a separate process, since it
        # might load VVbrowser and block.  We could do it in a thread, but this keeps
        # the browser windows separate from the server process.
        subprocess.Popen([sys.executable, '-m', 'vview.shell.default'])

    async def exit(self):
        self.shutdown('User request')

# win32gui has Shell_NotifyIcon, but it's years out of date and doesn't support
# NOTIFYICONDATA.guidItem, so we have to do this ourself.
from ctypes import wintypes
class TimeoutOrVersion(ctypes.Union):
    _fields_ = [
        ('uTimeout', wintypes.UINT),
        ('uVersion', wintypes.UINT),
    ]

class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [
        ('cbSize', wintypes.DWORD),
        ('hWnd', wintypes.HWND),
        ('uID', wintypes.UINT),
        ('uFlags', wintypes.UINT),
        ('uCallbackMessage', wintypes.UINT),
        ('hIcon', wintypes.HICON),
        ('szTip', wintypes.WCHAR*128),
        ('dwState', wintypes.DWORD),
        ('dwStateMask', wintypes.DWORD),
        ('szInfo', wintypes.WCHAR*256),
        ('TimeoutOrVersion', TimeoutOrVersion),
        ('szInfoTitle', wintypes.WCHAR*64),
        ('dwInfoFlags', wintypes.DWORD),
        ('guidItem', wintypes.CHAR*16),
        ('hBalloonIcon', wintypes.HICON),
    ]

shell32 = ctypes.WinDLL('shell32', use_last_error=True)
Shell_NotifyIcon = shell32.Shell_NotifyIconW
Shell_NotifyIcon.argtypes = (wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW))

class _TrayIcon:
    """
    Handle creating a tray icon and its context menu.
    """
    def __init__(self):
        self._instance = win32gui.GetModuleHandle(None)
        self._window_class_name = 'vview tray window'
        self.shutdown_window_message = win32con.WM_USER+0
        self.open_tray_message = win32con.WM_USER+1
        self.taskbar_created_message = win32gui.RegisterWindowMessage('TaskbarCreated')
        self.menu_options = []
        self.hwnd = None
        self.icon_created = False
        self.main_loop = asyncio.get_running_loop()

        # Register the window class.
        window_class = win32gui.WNDCLASS()
        window_class.lpszClassName = self._window_class_name
        window_class.hInstance = self._instance
        window_class.lpfnWndProc = self._threaded_wndproc
        self.window_class = win32gui.RegisterClass(window_class)

        # Start the window thread, and wait for self.hwnd to be available.  Make this a daemon thread,
        # since we don't want it to prevent the application from exiting.
        self._window_ready = threading.Event()
        self.thread = threading.Thread(target=self._window_thread, daemon=True)
        self.thread.start()
        self._window_ready.wait()
        del self._window_ready

        # Try to shut down even if we exit abnormally, so we do our best to not leave a tray icon
        # behind.  Windows should clean these up when processes exit, but it doesn't.
        atexit.register(self.atexit)

    def atexit(self):
        """
        Remove the tray icon if we're exiting without being shut down.
        """
        # We're in atexit, so we might be in any thread, including our own message thread.  It's
        # not safe to try to shut the thread down cleanly at this point, but since we use UUID
        # registration for the tray icon, we can still remove it.
        self._threaded_remove_tray_icon()

    def shutdown(self):
        """
        Shut down the window and tray icon.
        """
        atexit.unregister(self.shutdown)

        if self.hwnd is not None:
            # Ask the window thread to shut down.
            win32gui.PostMessage(self.hwnd, self.shutdown_window_message, 0, 0)

            # Wait for the window to close.  This should always exit quickly, but set a timeout to
            # make sure we don't get stuck here if something goes wrong, so we don't prevent shutdown.
            self.thread.join(timeout=1)
            self.hwnd = None

    def set_tray_menu_options(self, options, *, on_click):
        """
        Set the options shown in the tray menu.

        This doesn't currently update the menu if it's already open.
        """
        self.menu_options = options
        self.on_click = on_click

    def _window_thread(self):
        try:
            # Create the window.  This must be done on the same thread that runs the message loop.
            self.hwnd = win32gui.CreateWindow(self.window_class, self._window_class_name,
                win32con.WS_OVERLAPPED | win32con.WS_SYSMENU, # | win32con.WS_VISIBLE,
                0, 0, win32con.CW_USEDEFAULT, win32con.CW_USEDEFAULT,
                0, 0, self._instance, None)

            self._threaded_update_tray_icon()
        finally:
            # Let the main loop know that self.hwnd is ready.  Make sure that we always do
            # this even if an exception was thrown, so the main thread doesn't get stuck waiting.
            self._window_ready.set()

        # Run the message loop.  This will run until self.shutdown_window_message is sent.
        win32gui.PumpMessages()

    def _threaded_wndproc(self, hwnd, msg, wparam, lparam):
        match msg:
            case self.taskbar_created_message:
                self._threaded_update_tray_icon()
                return True

            case self.shutdown_window_message:
                # Another thread is asking us to shut down.
                win32gui.DestroyWindow(self.hwnd)
                return True

            case win32con.WM_DESTROY:
                # self._threaded_remove_tray_icon()

                # Shut down.  This will cause the event loop to exit.
                win32gui.PostQuitMessage(0)

                return True

            case self.open_tray_message:
                # The user interacted with the tray icon.
                return self._threaded_tray_message(hwnd, msg, wparam, lparam)

            case win32con.WM_COMMAND:
                # An option in the tray menu was selected.
                id = win32gui.LOWORD(wparam)
                self._threaded_execute_menu_option(id)
                return True

        return win32gui.DefWindowProc(hwnd, msg, wparam, lparam)

    def _get_icon(self):
        try:
            # Get the icon from VView.exe.
            vterm_path = Path(__file__) / '../../..' / 'bin' / 'VView.exe'
            vterm_path = vterm_path.resolve()

            # This win32gui binding has a bug: there's no way to say that you only want one of
            # the two icons.
            large_icons, small_icons = win32gui.ExtractIconEx(str(vterm_path), 0)
            hicon = large_icons[0] if large_icons else None
            return hicon
        except Exception as e:
            log.exception('Couldn\'t load icon')
            return None

    def _threaded_update_tray_icon(self):
        if not self.icon_created:
            self._threaded_remove_tray_icon()
            
        hicon = self._get_icon()

        # It would be nice to be able to use a UUID for the tray icon.  That way, we can remove
        # the icon without needing an hwnd, so it's safer to remove it from another thread, and
        # if we're terminated without being able to remove the tray icon, we can replace the existing
        # one, preventing the old Windows bug where tray icons accumulate since the taskbar fails
        # to clean up after closed applications.
        #
        # But, NIF_GUID is catastrophically broken: it associates the UUID with your application
        # path, and if the path changes, it fails with an "unspecified error" error.
        #
        # https://docs.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-notifyicondataa
        #
        # They tell you to generate a UUID at installation time and regenerate it any time the
        # application path changes (and if you have multiple entry points, you're out of luck).
        # That's insane and pointless and I'm not going to jump hoops like that just to display
        # an icon.  So, we do it the old-fashioned way.
        data = NOTIFYICONDATAW()
        data.cbSize = ctypes.sizeof(data)
        data.hWnd = self.hwnd
        data.uCallbackMessage = self.open_tray_message
        data.hIcon = hicon
        data.szTip = 'vview'
        data.TimeoutOrVersion.uVersion = 0
        data.uFlags = win32gui.NIF_ICON | win32gui.NIF_MESSAGE | win32gui.NIF_TIP

        if not Shell_NotifyIcon(win32gui.NIM_MODIFY, data):
            if not Shell_NotifyIcon(win32gui.NIM_ADD, data):
                error = ctypes.WinError(ctypes.get_last_error())
                log.warn('Couldn\'t create tray icon: ' + str(error))

        self.icon_created = True

    def _threaded_remove_tray_icon(self):
        """
        It's safe to call this from either the window thread or the main thread.
        """
        if self.hwnd is None:
            return

        # We might be in another thread, but we should still be able to remove the icon if we
        # still have access to the HWND.
        data = NOTIFYICONDATAW()
        data.cbSize = ctypes.sizeof(data)
        data.hWnd = self.hwnd
        Shell_NotifyIcon(win32gui.NIM_DELETE, data)

    def _threaded_tray_message(self, hwnd, msg, wparam, lparam):
        match lparam:
            case win32con.WM_LBUTTONDOWN:
                self._threaded_on_tray_click()
#            case win32con.WM_LBUTTONDBLCLK:
#                self._threaded_on_tray_double_click()
            case win32con.WM_RBUTTONUP:
                self._threaded_show_tray_menu()
            case win32con.WM_LBUTTONUP:
                pass

        return True
        
    def _threaded_show_tray_menu(self):
        menu = self._threaded_create_menu(self.menu_options)
        
        pos = win32gui.GetCursorPos()
        win32gui.SetForegroundWindow(self.hwnd)
        win32gui.TrackPopupMenu(menu, win32con.TPM_LEFTALIGN, pos[0], pos[1], 0, self.hwnd, None)
    
    def _threaded_create_menu(self, menu_options, *, next_menu_id=None):
        if next_menu_id is None:
            self.menu_actions_by_id = {}
            next_menu_id = 1023

        menu = win32gui.CreatePopupMenu()
        
        for option_text, option_action in reversed(menu_options):
            if callable(option_action):
                item, extras = win32gui_struct.PackMENUITEMINFO(text=option_text, hbmpItem=None, wID=next_menu_id)
                win32gui.InsertMenuItem(menu, 0, 1, item)
                self.menu_actions_by_id[next_menu_id] = option_action
                next_menu_id += 1
            else:
                # Create a submenu.
                submenu = self._threaded_create_menu(option_action, next_menu_id=next_menu_id)

                item, extras = win32gui_struct.PackMENUITEMINFO(text=option_text, hbmpItem=None, hSubMenu=submenu)
                win32gui.InsertMenuItem(menu, 0, 1, item)

        return menu

    def _threaded_execute_menu_option(self, id):
        # The user selected a menu option.  Queue it to run in the main thread.
        menu_action = self.menu_actions_by_id[id]      
        future = asyncio.run_coroutine_threadsafe(menu_action(), self.main_loop)
        try:
            future.result(timeout=5)
        except SystemExit as e:
            # exit() will raise SystemExit to trigger a shutdown.  Don't raise that through here
            # to our threaded WndProc.
            pass

    def _threaded_on_tray_click(self):
        future = asyncio.run_coroutine_threadsafe(self.on_click(), self.main_loop)
        future.result(timeout=5)

class _Terminal:
    def create(self):
        self._visible = False

        # Create the terminal window.  It'll be hidden until we call set_visible.
        self.vvterm = VVterm()
        if not self.vvterm.create():
            self.vvterm = None
            stdin, stdout = self._create_system_console()
            log.warn('Couldn\'t create console, using Windows console instead')
        else:
            stdin, stdout = self.vvterm.open_handles()
            self.event_task = asyncio.create_task(self.handle_events(), name='Terminal')

        # Make our terminal stdout and stderr if we didn't already have one.  If we were
        # started with another terminal, don't override it.
        if sys.stdout is None:
            sys.stdout = stdout
        if sys.stderr  is None:
            sys.stderr = stdout

        # Add a log handler that writes to the terminal.
        handler = logging.StreamHandler(stdout)
        misc.add_root_logging_handler(handler)

    def _create_system_console(self):
        """
        Open a regular Windows console.

        If we can't create the terminal window for some reason, this is used to
        fall back on a console window.  It's not very good (for example, closing
        it will kill the whole process), but it's better than nothing.
        
        We don't do anything fancy with this, it's just enough to let us see
        what's going on.
        """
        ctypes.windll.kernel32.AllocConsole()
        STD_OUTPUT_HANDLE = -11
        output_handle = ctypes.windll.kernel32.GetStdHandle(STD_OUTPUT_HANDLE)
        fd = msvcrt.open_osfhandle(output_handle, os.O_WRONLY)

        stdout = open(fd, 'w', encoding='utf-8')

        sys.stdout = stdout
        sys.stderr = stdout
        return stdout, stdout

    @property
    def visible(self):
        return self._visible
    
    @visible.setter
    def visible(self, value):
        self._visible = value
        if self.vvterm:
            self.vvterm.set_visible(value)

    def shutdown(self):
        if self.vvterm is None:
            return

        # Tell the terminal to exit.
        #
        # handle_events is currently waiting on vvterm.wait_for_event, which will return
        # and the next event will be VVtermEvent.Shutdown.  asyncio wants us to await self.event_task,
        # but shutdown shouldn't be async and we just want to discard the result.
        self.vvterm.shutdown()

    async def handle_events(self):
        """
        Receive events from the terminal window.
        """
        assert self.vvterm is not None

        try:
            while True:
                await self.vvterm.wait_for_event()

                # Read all available events.
                while True:
                    match self.vvterm.get_next_event():
                        case None:
                            # There are no more events waiting.
                            break

                        case VVtermEvent.Close | VVtermEvent.Minimized:
                            # If the user closes or minimizes the window, set it not visible, since we're
                            # minimizing to the tray.
                            self.visible = False
                        case VVtermEvent.Shutdown:
                            log.info('Terminal window shut down')
                            return

        except Exception as e:
            log.exception('Error in terminal event loop:')
            raise

def go():
    def test1(): print('1')
    def test2(): print('foo')

    menu_options = [
        ('test', test1),
        [
            'submenu', [
                ('test2', test2),
            ]
        ],
    ]
    
    ui = _TrayIcon()
    ui.set_tray_menu_options(menu_options)
    time.sleep(3.5)
    ui.shutdown()

if __name__ == '__main__':
    go()
