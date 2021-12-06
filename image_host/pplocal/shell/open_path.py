import sys, webbrowser, urllib.parse
from pathlib import Path

# pplocal.shell.register registers this for file type associations.
# This is normally called through VView.exe.

def open_path(path):
    """
    Open path in a browser using the local viewer API.
    """
    path = Path(path)
    if path.is_file() and path.suffix != '.zip':
        filename = path.name
        path = path.parent
    else:
        filename = None

    # If this is a media file, put the filename in file.  If this is a directory
    # or a ZIP, leave the whole path in the hash path.
    url_path = str(path).replace('\\', '/')
    url = 'http://127.0.0.1:8235/#ppixiv/root/' + urllib.parse.quote(url_path, safe='/: +')
    if filename:
        filename = urllib.parse.quote(filename)
        url += '?view=illust'
        url += '&file=' + filename

    url = url.replace('+', '%2B')
    url = url.replace(' ', '+')

    webbrowser.open(url)

def go():
    if len(sys.argv) < 2:
        print('No path specified')
        return

    open_path(sys.argv[1])

if __name__=='__main__':
    go()
