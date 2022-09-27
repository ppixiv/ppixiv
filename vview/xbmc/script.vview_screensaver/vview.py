import ctypes, msvcrt, os, sys, subprocess, threading, time, winreg, traceback
import xbmc, xbmcaddon, xbmcgui
from pathlib import Path

# ctypes stuff:
EnumWindows = ctypes.windll.user32.EnumWindows
EnumWindowsProc = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))

GWL_STYLE = -16
GWL_EXSTYLE = -20
SW_SHOWNOACTIVATE = 4        
SW_MINIMIZE = 6
WS_VISIBLE = 0x10000000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_LAYERED = 0x00080000
HWND_TOP = 0
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040

def open_console():
    # XBMC's documentation sucks and I can't find anything about where stdout goes, so
    # just open a console.
    ctypes.windll.kernel32.AllocConsole()

    STD_OUTPUT_HANDLE = -11
    output_handle = ctypes.windll.kernel32.GetStdHandle(STD_OUTPUT_HANDLE)
    fd = msvcrt.open_osfhandle(output_handle, os.O_WRONLY)

    output = open(fd, 'w', encoding='utf-8')
    sys.stdout = output
    sys.stderr = output

def get_pid_for_window(hwnd):
    pid = ctypes.c_ulong()
    result = ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if result == 0:
        return -1
    else:
        return pid.value

class ChromeWindow:
    def __init__(self):
        self.lock = threading.Lock()
        self.event = threading.Event()
        self.process = None
        self.thread = None

    def find_chrome_window(self):
        chrome_hwnd = None

        def callback(hwnd, unused):
            nonlocal chrome_hwnd

            # Ignore windows for processes other than our Chrome instance.
            pid = get_pid_for_window(hwnd)
            if pid != self.process.pid:
                return True

            style = ctypes.windll.user32.GetWindowLongA(hwnd, GWL_STYLE)
            if not (style & WS_VISIBLE):
                return True

            chrome_hwnd = hwnd

        EnumWindows(EnumWindowsProc(callback), None)
        return chrome_hwnd

    def __del__(self):
        if self.process is None:
            return

        print('Chrome was never shut down')
        self.close()

    def _chrome_path(self):
        """
        Return the path to the Chrome executable.
        """
        try:
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')
            path = winreg.QueryValueEx(key, 'Path')[0]
            return path + r'\Chrome.exe'
        except FileNotFoundError as e:
            return None

    def _chrome_profile_path(self):
        """
        Return the path to store our Chrome profile.
        """
        local_data = Path(os.getenv('LOCALAPPDATA'))
        return local_data / 'vview' / 'chrome'

    def start(self):
        try:
            chrome_path = self._chrome_path()
            if chrome_path is None:
                print('Couldn\'t locate Chrome')
                return False

            # Start Chrome minimized.
            si = subprocess.STARTUPINFO(dwFlags=subprocess.STARTF_USESHOWWINDOW, wShowWindow=SW_MINIMIZE)
            profile_path = self._chrome_profile_path()
            profile_path.mkdir(parents=True, exist_ok=True)
            
            # XXX
            url = 'http://10.0.0.9:8235/#/?order=shuffle&file=*&slideshow=1&view=illust'
        
            self.process = subprocess.Popen([
                chrome_path,

                # We need to run this as a separate profile, or it'll just open a tab in the existing window.
                '--user-data-dir=' + str(profile_path),

                '--kiosk',
                url,
            ], startupinfo=si)
        except Exception as e:
            # XXX: show an error
            print('Couldn\'t launch Chrome: %s' % str(e))
            return False

        self.thread = threading.Thread(target=self._start_inner)
        self.thread.start()
        return True

    def _start_inner(self):
        # Wait briefly for the window to load.  Chrome opens an ugly blinding white window when it
        # starts, and we don't want to display it until that's gone.  This event is signalled if we're
        # dismissed while still waiting.
        self.event.wait(1)

        # Search for the Chrome process.  This looks for a visible window owned by the process we
        # just started, and won't find other random Chrome windows.
        start_time = time.time()
        while time.time() < start_time + 1 and not self.event.is_set():
            with self.lock:
                if self.process is None:
                    return

                chrome_hwnd = self.find_chrome_window()
                if chrome_hwnd is not None:
                    break
            time.sleep(0.1)
        else:
            if not self.event.is_set():
                print('Couldn\'t find Chrome window')
            return

        # Show the window without activating it, and put it on top.  This puts it on top of Kodi,
        # but it doesn't actually have input focus, so we still receive input to exit the screensaver.
        ctypes.windll.user32.ShowWindow(chrome_hwnd, SW_SHOWNOACTIVATE)
        ctypes.windll.user32.SetWindowPos(chrome_hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE|SWP_SHOWWINDOW)

        # Adjust the window flags so the window doesn't receive mouse input.  Otherwise,
        # we won't get them and the screensaver won't exit on mouse movement.
        cur_style = ctypes.windll.user32.GetWindowLongA(chrome_hwnd, GWL_EXSTYLE)
        ctypes.windll.user32.SetWindowLongA(chrome_hwnd, GWL_EXSTYLE, cur_style | WS_EX_TRANSPARENT | WS_EX_LAYERED)

    def close(self):
        with self.lock:
            # Set the event to tell the thread to exit if it's still waiting.
            self.event.set()
            if self.thread is not None:
                self.thread.join()
            
            if self.process is not None:
                try:
                    self.process.kill()
                except Exception as e:
                    print('Couldn\'t kill %s: %s' % (self.process, str(e)))

                self.process.wait()
                self.process = None

class ScreensaverDeactivationMonitor(xbmc.Monitor):
    def __init__(self, close):
        self.close = close

    def onScreensaverDeactivated(self):
        self.close()

    def onAbortRequested(self):
        self.close()

class ChromeScreensaver:
    def __init__(self):
        self.chrome_window = None
        self.gui_window = None

    def start(self):
        try:
            # Start this early, so we don't miss notifications.
            monitor = ScreensaverDeactivationMonitor(self.close)
            
            # Check that Kodi is in the foreground.  It'll start the screensaver when not focused,
            # since it assumes it's displaying something in its own window, and if we don't check this
            # then we'll launch Chrome while we're in the background.
            window = ctypes.windll.user32.GetForegroundWindow()
            pid = get_pid_for_window(window)
            if pid != os.getpid():
                print('Not starting Chrome while in the background')
                return

            self.chrome_window = ChromeWindow()
            self.chrome_window.start()

            # Create a blank dialogw.
            addon = xbmcaddon.Addon('script.vview_screensaver')
            
            self.gui_window = xbmcgui.WindowDialog()
            black = Path(addon.getAddonInfo('path')) / 'black.png'
            image = xbmcgui.ControlImage(0, 0, 1280, 720, str(black))
            self.gui_window.addControl(image)

            self.gui_window.doModal()
        finally:
            # Make sure we always shut down the Chrome window.
            self.close()

    def close(self):
        if self.chrome_window is not None:
            self.chrome_window.close()
            self.chrome_window = None
        if self.gui_window is not None:
            self.gui_window.close()
            self.gui_window = None

def go():
    try:
        # open_console()
        
        screensaver = ChromeScreensaver()
        screensaver.start()
    except BaseException as e:
        traceback.print_exc()
        raise

if __name__ == '__main__':
    go()

