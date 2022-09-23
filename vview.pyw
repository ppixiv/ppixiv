# Start the VView server.
#
# This is like running "python -m vview.server.server", but starts without a console
# window, and catches top-level errors to display them to the user.
def run():
    try:
        from vview.server import server
        server.run()
    except Exception as e:
        import traceback
        error = traceback.format_exc()

        from vview.util import error_dialog
        error_dialog.show_error_dialog('Error launching VView', 'An unexpected error occurred:\n\n' + error)
    
        raise
    
if __name__ == '__main__':
    run()
