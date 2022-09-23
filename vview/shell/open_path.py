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

def open_path(path):
    """
    Open path in a browser using the local viewer API.
    """
    path = Path(path)
    url_path = str(path).replace('\\', '/')
    url = 'http://127.0.0.1:8235/open/' + urllib.parse.quote(url_path)

    # Don't use the webbrowser module.  The Windows implementation is an afterthought, and
    # the module should never have been added to the Python core library in its current state.
    if True:
        # Open directly with Chrome.  This lets us open in a new window.  It would be nicer to open without
        # browser chrome, but Chrome won't do that unless we open in a separate profile, which is worse.
        chrome_path = _chrome_path()
        args = [
            chrome_path,
            '--new-window',
            url,
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

def go():
    if len(sys.argv) < 2:
        log.info('No path specified')
        return

    open_path(sys.argv[1])

if __name__=='__main__':
    go()
