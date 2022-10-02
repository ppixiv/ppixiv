# This module allows launching the server in another process if it's not already
# running.
#
# This is separate from server.py, since that file imports a lot and can take some
# time just to import (200-300ms), which is a waste of time if we're in a front-end
# process that won't be running the server itself.

import subprocess, sys
from ..util import win32

def fork_server():
    """
    If the server isn't already running, start it in a new process.

    This is used when we want to make sure the server is running before doing something
    that requires it, like opening a file association.  Note that this doesn't wait for
    the server to be ready to receive requests.
    """
    if win32.is_server_running():
        return

    # Run the module in a new process.
    process = subprocess.Popen([sys.executable, "-m", "vview.server.server"])
