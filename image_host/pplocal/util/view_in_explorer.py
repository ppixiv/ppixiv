#!/usr/bin/python
import subprocess, sys, ctypes, re, tempfile, urllib.parse
from pathlib import Path

def register_scheme():
    # Generate a .reg file to register ourself as the handler for the "viewinexplorer"
    # scheme.
    python_path = '"' + sys.executable + '"'
    script_path = Path(sys.argv[0]).resolve()
    script_path = '"' + str(script_path) + '"'

    # If this is being run as python.exe, make sure we register pythonw.exe instead,
    # so it doesn't flash a window every time it runs.
    python_path = re.sub('Python.exe', 'pythonw.exe', python_path, flags=re.IGNORECASE)
    
    args = [python_path, script_path, '"%1"']
    args = [re.sub(r'([\\"])', r'\\\1', arg) for arg in args]

    executable = f'{python_path} {script_path} "%1"'
    data = f"""\ufeffWindows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\Classes\\viewinexplorer]
@="viewinexplorer"
"URL Protocol"=""
"Content Type"="application/view-in-explorer"

[HKEY_CURRENT_USER\\Software\\Classes\\viewinexplorer\\shell\\open\\command]
@="{' '.join(args)}"
"""
    path = tempfile.gettempdir() + '\\register.reg'
    with open(path, 'w+t', encoding='utf-8') as f:
        f.write(data)

    # This needs to run elevated.
    #
    # We can't tell when this has finished, so it's hard to clean up the temporary
    # file.
    regedit_args = ['regedit', '/S', path]
    ctypes.windll.shell32.ShellExecuteW(None, "runas", 'regedit', " ".join(regedit_args[1:]), None, 1)

# This is a helper to allow us to open local directories in File Explorer from
# the page.  This must be registered as the "viewinexplorer" URL scheme.
def show_in_explorer():
    # Parse the URL.  It looks like:
    #
    # viewinexplorer:///c:/path/to/file
    path = str(sys.argv[1])
    url = urllib.parse.urlparse(path)
    path = urllib.parse.unquote(url.path)

    # Remove the leading slash, and since Explorer is the only program in Windows
    # that thinks directory separators have to be backslashes, replace them.
    path = path[1:].replace('/', '\\')

    # Show the file with /select, which will display the file in its parent.
    proc = subprocess.Popen([
        'explorer.exe',
        '/select,',
        path,
    ])

def go():
    # If we were run with no arguments, we weren't run by the protocol handler.
    # Assume it's the user wanting to register us.
    if len(sys.argv) == 1:
        register_scheme()
    else:
        show_in_explorer()

#if __name__ == '__main__':
#    go()
