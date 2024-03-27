# This is used for critical error messages at startup.  Use ctypes, since it's a core built-in
# module, and avoid unnecessary imports.  If this fails for some reason we don't have any
# fallback to talk to the user.

import ctypes, traceback
from contextlib import contextmanager

MB_OK = 0
MB_ICONERROR = 0x10
MB_SYSTEMMODAL = 0x1000

STD_INPUT_HANDLE = -10

def show_error_dialog(title, message):
    """
    Show a modal error dialog.

    This is used for fatal errors, usually at startup, when we don't have anywhere better
    to put them.
   
    """
    # This dialog sucks.  It's tiny (it probably had its sizing set some time during
    # Windows 3.0) so it wraps badly when displaying things like stack traces, and you
    # can't copy text directly out of the window (you can press ^C to copy the entire dialog,
    # but users don't know that).  But we need something simple and reliable.
    ctypes.windll.user32.MessageBoxW(None, message, title, MB_ICONERROR | MB_OK | MB_SYSTEMMODAL)

def _have_output_console():
    """
    Return true if we think we have a console window.

    If we have a console window, that means errors have somewhere to go to be
    seen.  If we don't, we should display fatal errors in a dialog.
    """
    try:
        return ctypes.windll.kernel32.GetStdHandle(STD_INPUT_HANDLE) != 0
    except Exception as e:
        # If this fails for some reason, assume we don't have a console so we'll
        # display fatal errors with a dialog.  Print the error anyway, in case
        # it has somewhere to go.
        import traceback
        traceback.print_exc()
        return False

def show_error_dialog_if_no_console(title, message):
    """
    Show an error dialog if we're not running inside a console.

    If we have no console because we're running as a background process without a console,
    show fatal startup errors in a dialog, since if they're just printed to the console they
    won't go anywhere.  Don't do this if we do have a console, since that means we're running
    in something like cmd probably during development, and popping up a dialog during testing
    is annoying.
    """
    if _have_output_console():
        return

    return show_error_dialog(title, message)

@contextmanager
def show_errors():
    """
    Run a block of code, showing a dialog if it throws an exception.

    This is used for top-level scripts when we don't yet have a terminal set up.
    """
    try:
        yield
    except Exception as e:
        error = traceback.format_exc()
        show_error_dialog_if_no_console('Error launching VView', f'{e}\n\n{error}')
        raise
