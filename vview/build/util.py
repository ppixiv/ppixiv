# Helpers used by build_ppixiv and build_vview.

import argparse, os, sys, urllib, tempfile, subprocess, shutil, ctypes
from pathlib import Path
from urllib import request
from zipfile import ZipFile

_temp_dir = Path(tempfile.gettempdir()) / 'vview-build'


def download_file(url, filename=None):
    """
    Download url to our local temporary directory and return its path.
    """
    _temp_dir.mkdir(parents=True, exist_ok=True)

    if filename is None:
        filename = urllib.parse.urlparse(url).path
        filename = os.path.basename(filename)

    output_file = _temp_dir / filename

    # Stop if we already have the file.  We assume the file is valid, and that the filename
    # is unique so the contents of the URL won't change.
    if output_file.exists():
        print(f'Already exists: {output_file}')
        return output_file

    output_temp = output_file.with_suffix('.temp')

    print(f'Downloading: {url}')
    try:
        with output_temp.open('w+b') as output:
            with request.urlopen(url) as req:
                # Store req.length to work around a weird bug: req.length returns the number of bytes
                # remaining instead of the length of the result.
                expected_size = req.length
                while True:
                    data = req.read(1024*1024)
                    output.write(data)
                    print(f'\rDownloading {output.tell()} / {expected_size}...', end='', flush=True)
                    if not data:
                        break

                if output.tell() != expected_size:
                    raise BuildError(f'Incomplete file (expected {expected_size}, got {output.tell()})')

        # Rename the file to its final filename.
        output_temp.rename(output_file)
        return output_file
    except urllib.error.HTTPError as e:
        raise BuildError(f'Error downloading {url}: {e.reason}')
    finally:
        # We probably left ourself on a "downloading" line, so move off of it.
        print('')

        # Clean up the temp file if we didn't rename it.
        output_temp.unlink(missing_ok=True)
