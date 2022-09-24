from ..util import error_dialog

# vview.shell.register registers this for file type associations.
# This is normally called through VView.exe.
def go():
    import logging, sys
    from ..util import open_in_browser

    log = logging.getLogger(__name__)

    if len(sys.argv) < 2:
        log.info('No path specified')
        return

    open_in_browser.open_path(sys.argv[1])

if __name__=='__main__':
    with error_dialog.show_errors():
        go()
