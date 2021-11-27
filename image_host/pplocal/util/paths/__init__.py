from .FilesystemPath import FilesystemPath

def open(path, open_zips=True):
    # If open_zips is true, see if this is a ZIP.  Do a quick check to see if ".zip"
    # is in the filename at all to avoid doing this when it definitely can't be a ZIP path.
    if open_zips and '.zip' in str(path).lower():
        # Try to open the file as a ZIP.  If this fails, create the path normally.
        zip = FilesystemPath._open_zip(path)
        if zip is not None:
            return zip

    return FilesystemPath(path)

