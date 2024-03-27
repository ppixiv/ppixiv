# This is a thin wrapper around Server.  This just has minimal top-level imports, so
# if Server fails to import, there's less of a chance of not being able to show an
# error dialog.
from ..util import error_dialog

def run():
    """
    Run the server, blocking until it's told to exit.  Return True when finished.

    If the server is already running somewhere else, return False.
    """
    from .server import Server

    with error_dialog.show_errors():
        return Server().main()

if __name__ == '__main__':
    run()
