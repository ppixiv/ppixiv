from ..util import error_dialog

# This is run by VView.exe by default if no arguments are provided.  This is the entry
# point if it's run directly or via the start menu.  Start the server if it's not running,
# and open ourself in a window.
def go():
    import time
    from ..util import win32
    from ..util import open_in_browser
    from ..server.launch_server import fork_server

    # open_top will open a browser window.  If fork_server needs to start the server it won't
    # be ready immediately.  For now we rely on browsers retrying failed connections, so we can
    # open the browser window immediately.
    fork_server()
    open_in_browser.open_top()
    
if __name__=='__main__':
    with error_dialog.show_errors():
        go()
