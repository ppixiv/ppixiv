import sys, webbrowser, urllib.parse
from pathlib import Path

# vview.shell.register registers this for file type associations.
# This is normally called through VView.exe.

def open_path(path):
    """
    Open path in a browser using the local viewer API.
    """
    path = Path(path)
    url_path = str(path).replace('\\', '/')
    url = 'http://127.0.0.1:8235/open/' + urllib.parse.quote(url_path)
    webbrowser.open(url)

def go():
    if len(sys.argv) < 2:
        print('No path specified')
        return

    open_path(sys.argv[1])

if __name__=='__main__':
    go()
