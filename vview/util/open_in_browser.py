import subprocess, sys, os, webbrowser, urllib.parse, winreg, logging
from pathlib import Path
from . import misc
from ..util import error_dialog
from ..util.paths import open_path

log = logging.getLogger(__name__)

from ..server import metadata_storage

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

    # Try to get the dimensions if this is an image or video, so we can size the browser
    # window to fit the image.
    #
    # If this image was cropped, we want to use the crop size instead of the image size.
    # We're not running in the server when we get here, so we don't really want to access
    # the server database, and making a request to the server to ask for this adds some
    # complications (we might have just started the server and it might not be responding
    # to requests yet).  Instead, just pull it from the metadata file directly.
    width = None
    height = None

    if not path.is_dir():
        # Get the image dimensions.
        mime_type = misc.mime_type(path)

        with path.open('rb', shared=True) as f:
            media_metadata = misc.read_metadata(f, mime_type)

        if 'width' not in media_metadata or 'height' not in media_metadata:
            raise ValueError('Unrecognized image format')

        width = media_metadata.get('width')
        height = media_metadata.get('height')

        # See if we have a crop.  We still read the file above even if we're using the
        # crop resolution, so error handling is the same (we still check that the file
        # is readable).
        file_metadata = metadata_storage.load_file_metadata(path)
        crop = file_metadata.get('crop')
        if crop:
            width = crop[2] - crop[0]
            height = crop[3] - crop[1]

    path = Path(path)
    _open_url_path('open/' + path.as_posix(), width=width, height=height)

def _browser_profile_path():
    """
    Return the path for storing VVbrowser's user profile.
    """
    local_data = Path(os.getenv('LOCALAPPDATA'))
    data_dir = local_data / 'vview'
    return data_dir / 'browser'

def _open_url_path(path, **kwargs):
    url = 'http://localhost:8235/' + urllib.parse.quote(path)
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
