# This is a thin wrapper around Server.  This just has minimal top-level imports, so
# if Server fails to import, there's less of a chance of not being able to show an
# error dialog.
import traceback
from ..util import error_dialog

def run():
    """
    Run the server, blocking until it's told to exit.  Return True when finished.

    If the server is already running somewhere else, return False.
    """
    from .server import Server

    try:
        return Server.run()
    except Exception as e:
        # Show fatal errors in a dialog if we don't have a console.
        error = traceback.format_exc()
        error_dialog.show_error_dialog_if_no_console('Error launching VView', 'An unexpected error occurred:\n\n' + error)
        raise

if __name__ == '__main__':
    run()
