# Helpers used by build_ppixiv and build_vview.

import os, sys, urllib, tempfile, subprocess, shutil, gzip, contextlib, platform
from pathlib import Path
from urllib import request
from zipfile import ZipFile
from tarfile import TarFile

_temp_dir = Path(tempfile.gettempdir()) / 'vview-build'

class BuildError(Exception): pass

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

@contextlib.contextmanager
def _open_zip_or_tar(path):
    """
    Open path as a ZipFile or TarFile.

    This is to work around the dart-sass prebuilts having different archive formats
    on each platform.
    """
    if path.suffix == '.zip':
        yield ZipFile(path, mode='r')
        return

    if path.suffix != '.gz':
        raise Exception(f'Unrecognized archive format: {path}')

    # .tar.gz:
    with gzip.open(path, 'r') as f:
        tar = TarFile(fileobj=f, mode='r')

        # Monkey patch TarFile.open into the object to work around it being inconsistent
        # with ZipFile.
        def _open(path, mode):
            return tar.extractfile(path)
        tar.open = _open

        yield tar

def download_sass(output_path):
    """
    Download a dart-sass prebuilt into output_path.
    """
    # Do a quick check to see if all of the files already exist.
    exe_suffix = '.exe' if sys.platform == 'win32' else ''
    files = (f'dart{exe_suffix}', 'sass.snapshot', 'LICENSE')
    all_files_exist = all((output_path / filename).exists() for filename in files)
    if all_files_exist:
        return

    # Download a SASS prebuilt for this platform.
    arch = f'{sys.platform}-{platform.machine()}'
    paths = {
        'win32-AMD64': 'windows-x64.zip',
        'linux-x86_64': 'linux-x64.tar.gz',
        'darwin-arm64': 'macos-arm64.tar.gz',
        'darwin-x86_64': 'macos-x64.tar.gz',
    }
    suffix = paths[arch]
    url = f'https://github.com/sass/dart-sass/releases/download/1.68.0/dart-sass-1.68.0-{suffix}'
    output_file = download_file(url)

    # Just extract the files we need and flatten the file tree.
    output_path.mkdir(parents=True, exist_ok=True)
    print(f'Extracting dart-sass to {output_path}')

    with _open_zip_or_tar(output_file) as archive:
        for filename in files:
            input_filename = 'dart-sass/src/' + filename
            output_filename = output_path / filename
            with archive.open(input_filename, 'r') as input_file:
                with output_filename.open('wb') as output_file:
                    shutil.copyfileobj(input_file, output_file)

                # For LInux, just mark all files executable.
                os.chmod(output_filename, 0o755)
