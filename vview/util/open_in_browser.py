import subprocess, sys, os, webbrowser, urllib.parse, winreg, logging
from pathlib import Path
from . import misc
from ..util import error_dialog
from ..util.paths import open_path

log = logging.getLogger(__name__)

try:
    import VVbrowser
except ImportError as e:
    VVbrowser = None

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

def open_path_in_browser(path):
    """
    Open path in a Vview browser window.
    """
    path = open_path(path)

    # Try to get the dimensions if this is an image or video.
    width = None
    height = None
    mime_type = misc.mime_type(path)
    try:
        with path.open('rb', shared=True) as f:
            media_metadata = misc.read_metadata(f, mime_type)
            width = media_metadata['width']
            height = media_metadata['height']
    except IOError as e:
        print(e)
    
    path = Path(path)
    url_path = str(path).replace('\\', '/')
    _open_url_path('open/' + url_path, width=width, height=height)

def _browser_profile_path():
    """
    Return the path for storing VVbrowser's user profile.
    """
    local_data = Path(os.getenv('LOCALAPPDATA'))
    data_dir = local_data / 'vview'
    return data_dir / 'browser'

def _open_url_path(path, **kwargs):
    url = 'http://127.0.0.1:8235/' + urllib.parse.quote(path)
    _open_url(url, **kwargs)

def _open_url(url, width=None, height=None, fullscreen=True):
    """
    Open URL in a browser, using VVbrowser if available.

    If width and height are available, the window size will be scaled to fit an image of those dimensions.
    """
    # Try to use our own browser front-end.
    if VVbrowser is not None:
        browser_profile_dir = _browser_profile_path()

        # Note that this becomes the browser front-end window, and doesn't return until the
        # user closes the window.
        args = {
            'url': url,
            'fullscreen': fullscreen,
            'profile': str(browser_profile_dir),
        }

        if width is not None and height is not None:
            args['fitImageSize'] = (width, height)

        VVbrowser.open(**args)
        return

    # VVbrowser isn't available for some reason.  Fall back on a regular browser window.
    log.info('VVbrowser isn\'t available')

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
