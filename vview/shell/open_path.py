import logging
from ..util import open_in_browser

log = logging.getLogger(__name__)

# vview.shell.register registers this for file type associations.
# This is normally called through VView.exe.
def go():
    if len(sys.argv) < 2:
        log.info('No path specified')
        return

    open_in_browser.open_path(sys.argv[1])

if __name__=='__main__':
    go()
