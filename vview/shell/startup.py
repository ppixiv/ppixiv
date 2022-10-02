# Run via:
#
# VView -m vview.shell.startup
#
# This is run on startup if we're configured to run on launch, and we start the server
# if it's not already running.  This is like default.py, but we don't open a browser window.
from ..util import error_dialog

def go():
    from ..server.launch_server import fork_server
    fork_server()

if __name__=='__main__':
    with error_dialog.show_errors():
        go()
