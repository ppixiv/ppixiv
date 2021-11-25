#!/usr/bin/python
import sys
from pplocal.util import view_in_explorer

def go():
    # If we were run with no arguments, we weren't run by the protocol handler.
    # Assume it's the user wanting to register us.
    if len(sys.argv) == 1:
        view_in_explorer.register_scheme()
    else:
        view_in_explorer.show_in_explorer()

if __name__ == '__main__':
    go()
