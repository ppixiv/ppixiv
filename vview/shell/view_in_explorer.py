from ..util import error_dialog

# This is a helper to allow us to open local directories in File Explorer from
# the page.  This is registered as the "vviewinexplorer" URL scheme by pplocal.shell.register.
#
# Note that the vviewinexplorer scheme is also handled by VVbrowser, so the
# custom URL scheme isn't needed there.
def show_in_explorer():
    import subprocess, sys, urllib.parse

    # Parse the URL.  It looks like:
    #
    # vviewinexplorer://c:/path/to/file
    # vviewinexplorer:////10.0.0.1/share/path
    path = str(sys.argv[1])
    url = urllib.parse.urlparse(path)
    path = url.netloc + urllib.parse.unquote(url.path)

    # # Explorer is the only program in Windows that thinks directory separators
    # have to be backslashes, so replace them.
    path = path.replace('/', '\\')

    # Show the file with /select, which will display the file in its parent.
    proc = subprocess.Popen([
        'explorer.exe',
        '/select,',
        path,
    ])

if __name__=='__main__':
    with error_dialog.show_errors():
        show_in_explorer()
