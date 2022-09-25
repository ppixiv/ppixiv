from ..util import error_dialog

import subprocess, sys, webbrowser, urllib.parse, winreg, logging
from pathlib import Path

log = logging.getLogger(__name__)

# vview.shell.register registers this for file type associations.
# This is normally called through VView.exe.

def _application_path(name):
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, rf'Software\Microsoft\Windows\CurrentVersion\App Paths\{name}')
        return winreg.QueryValueEx(key, None)[0]
    except FileNotFoundError as e:
        return None

def _chrome_path():
    """
    Return the path to the Chrome executable.
    """
    return _application_path('chrome.exe')

def _firefox_path():
    """
    Return the path to the Firefox executable.
    """
    return _application_path('firefox.exe')

def open_top():
    """
    Open a default Vview window in a browser.
    """
    _open_url_path('')

def open_path(path):
    """
    Open path in a Vview browser window.
    """
    path = Path(path)
    url_path = str(path).replace('\\', '/')
    _open_url_path('open/' + url_path)
    
def _open_url_path(path):
    url = 'http://127.0.0.1:8235/' + urllib.parse.quote(path)

    # Don't use the webbrowser module.  The Windows implementation is an afterthought, and
    # the module should never have been added to the Python core library in its current state.
    if True:
        # Open directly with Chrome.
        chrome_path = _chrome_path()
        args = [
            chrome_path,

            # This isn't great (it doesn't remember window positions, etc.), but it seems like the
            # best we can do without a whole CEF setup (90MB+).  --window-size, etc. don't work
            # when a Chrome session is already running.
            '--app=%s' % url,
        ]
        subprocess.Popen(args)
    elif True:
        firefox_path = _firefox_path()
        args = [
            firefox_path,
            '-new-window',
            url,
        ]
        subprocess.Popen(args)
    else:
        webbrowser.open_new(url)
