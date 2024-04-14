# This is a helper to build VView from source.
#
# Prerequisites:
# - Python 3.10 for Windows.  (Newer versions may work, but this is the current testing
# version.)
# - Visual Studio 2019.


# Only use modules that are included by default in Windows Python, so we don't need extra
# setup steps for this.
import argparse, os, sys, urllib, tempfile, subprocess, shutil, ctypes
from pathlib import Path
from urllib import request
from zipfile import ZipFile
from . import util
from .util import BuildError

class VViewBuild:
    def build_all(self):
        parser = argparse.ArgumentParser()
        parser.add_argument('--output', action='store', default='bin')
        args = parser.parse_args()

        # The top of the tree:
        self.top_dir = Path(__file__).parent.parent.parent.resolve()

        # The binary directory where we'll output the build.  This is always directly underneath top_dir.
        self.bin_dir = self.top_dir / args.output

        # VVpython.exe will be here once we build it:
        self.vvpython = self.bin_dir / 'VVpython'

        # A directory to store things like downloaded files.
        self.temp_dir = Path(tempfile.gettempdir()) / 'vview-build'

        print(f'Output directory: {self.bin_dir}')

        try:
            if not self.check_environment():
                return

            self.temp_dir.mkdir(parents=True, exist_ok=True)

            self.download_sass()
            self.download_embedded_python()
            self.download_ffmpeg()
            self.download_upscaler()
            self.build_native()
            self.check_native()
            self.install_pip()
            self.install_python_deps()
        except BuildError as e:
            print(str(e))

    def check_environment(self):
        """
        Do some initial sanity checks.
        """
        # Make sure we're running in Python for Windows and not Cygwin's Python, since we
        # want to be running in the same copy of Python that we'll actually be building with.
        if sys.platform == 'cygwin':
            raise BuildError('Run this with Windows Python, not Cygwin Python')

        if sys.version_info.major < 3:
            raise BuildError('Python 3 or newer is required')

        if sys.version_info.minor < 10:
            # Print a warning, but don't stop because of this.
            print('Python 3.10 or newer is recommended')

        # Check that we can locate Visual Studio.
        self.find_msbuild()

        # Check that we're not already running.  If we're running the files we're trying
        # to build may be locked.
        if self.vview_running():
            raise BuildError('VView is running')

        return True

    def vview_running(self):
        """
        Return true if VView is running.
        """
        # This is a simplified version of win32.is_server_running.  We don't want to
        # import vview modules from here.
        _server_lock_name = 'vview-server-lock'
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        EVENT_MODIFY_STATE = 0x0002
        handle = kernel32.OpenEventW(EVENT_MODIFY_STATE, False, _server_lock_name)

        if handle != 0:
            # We were able to open the event, so there's a server running.
            kernel32.CloseHandle(handle)
            return True
        else:
            return False

    def download_embedded_python(self):
        """
        Download a matching embedded version of Python, and extract it into bin/Python.

        These URLs look like:

        https://www.python.org/ftp/python/3.10.7/python-3.10.7-embed-amd64.zip

        This is the embedded version of Python that we'll actually use.
        """
        version = f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}'
        url = f'https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip'
        output_file = util.download_file(url)

        # Extract the ZIP into bin/Python.
        python_embed_dir = self.bin_dir / 'Python'            
        print(f'Extracting Python to {python_embed_dir}')

        zipfile = ZipFile(output_file)

        # Extract files to their correct locations:
        for file in zipfile.infolist():
            if file.is_dir():
                continue
            
            name = Path(file.filename)

            if name.suffix in ('.dll',):
                # DLLs go into the top-level bin_dir.
                output_dir = self.bin_dir
            elif name.suffix in ('.pyd', '.zip', '.txt'):
                # .txt is included for LICENSE.txt.
                output_dir = python_embed_dir
            else:
                # Be sure to not include ._pth, since there's a _pth file in the archive that
                # shouldn't be there at all.
                print('Ignore:', name)
                continue

            output_dir.mkdir(parents=True, exist_ok=True)
            output_file = output_dir / name
            with zipfile.open(file, 'r') as input_file:
                with output_file.open('wb') as output_file:
                    shutil.copyfileobj(input_file, output_file)

    def download_ffmpeg(self):
        """
        Download an FFmpeg prebuilt into bin/ffmpeg.
        """
        # We pick an arbitrary version from the BtbN repository.
        # TODO: it would be better to use the -shared version and dynamically link to it, since it's
        # much smaller, but currently we shell out to it
        # https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2021-11-30-12-21
        # https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2021-11-30-12-21/ffmpeg-N-104704-ge22dff43e7-win64-lgpl-shared.zip
        url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2024-03-21-12-56/ffmpeg-N-114298-g97d2990ea6-win64-lgpl-shared.zip'
        output_file = util.download_file(url)

        # Extract FFmpeg.
        #
        # This is a bit annoying, since these ZIPs are incorrect: everything inside them is in
        # an extra top-level directory.  That's the convention for TARs, not ZIPs.
        ffmpeg_embed_dir = self.bin_dir / 'FFmpeg'
        print(f'Extracting FFmpeg to {ffmpeg_embed_dir}')

        zipfile = ZipFile(output_file)
        first_path_component = None
        for file in zipfile.infolist():
            if file.is_dir():
                continue
            
            name = Path(file.filename)
            if len(name.parts) == 1:
                raise BuildError(f'Unexpected path in FFmpeg archive: {file.filename}')

            if first_path_component is None:
                first_path_component = name.parts[0]
            elif name.parts[0] != first_path_component:
                raise BuildError(f'Unexpected path in FFmpeg archive: {file.filename}')
            name = name.relative_to(first_path_component)

            # Skip directories that we know we don't need.  We only need bin/* and the license.
            if name.is_relative_to('doc') or name.is_relative_to('include') or name.is_relative_to('lib'):
                continue

            output_file = ffmpeg_embed_dir / name
            output_file.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.open(file, 'r') as input_file:
                with output_file.open('wb') as output_file:
                    shutil.copyfileobj(input_file, output_file)

    def download_sass(self):
        """
        Download a dart-sass prebuilt into bin/dart-sass.
        """
        output_dir = self.bin_dir / 'dart-sass'
        util.download_sass(output_dir)

    def download_esbuild(self):
        """
        Download an esbuild prebuilt into bin/esbuild.
        """
        output_dir = self.bin_dir / 'esbuild'
        util.download_esbuild(output_dir)

    def download_upscaler(self):
        url = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip'
        output_file = util.download_file(url)
        print(output_file)

        output_dir = self.bin_dir / 'upscaler'

        # This ZIP has a bunch of stuff we don't want: a One Piece clip (???) and a bunch of
        # gigantic resampler models that don't work.  Just extract what we need, which is a
        # fraction of the size of the ZIP.
        zipfile = ZipFile(output_file)
        for filename in (
            'realesrgan-ncnn-vulkan.exe',
            'vcomp140.dll',
            'models/realesr-animevideov3-x2.bin',
            'models/realesr-animevideov3-x2.param',
            'models/realesr-animevideov3-x3.bin',
            'models/realesr-animevideov3-x3.param',
            'models/realesr-animevideov3-x4.bin',
            'models/realesr-animevideov3-x4.param',
        ):
            input_file = filename
            output_file = output_dir / filename
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with zipfile.open(input_file, 'r') as input_file:
                with output_file.open('wb') as output_file:
                    shutil.copyfileobj(input_file, output_file)

        # The build ZIP doesn't have the license.  Grab it from the repository.
        license_url = 'https://raw.githubusercontent.com/xinntao/Real-ESRGAN/v0.2.5.0/LICENSE'
        license_file = util.download_file(license_url, filename='ESRGAN license.txt')
        shutil.copyfile(license_file, output_dir / 'LICENSE.txt')

    def find_msbuild(self):
        """
        Return the path to MSBuild.exe in Visual Studio 2019 or newer.
        """
        # To get the path to VS, Microsoft wants us to use "vswhere", but there's no way
        # to find where *that* is.  They apparently expect you to just hardcode the path.
        # Why can't you just get the installation path from the registry like a normal
        # program?
        root = os.environ.get("ProgramFiles(x86)") or os.environ.get("ProgramFiles")
        root = Path(root)
        if not root:
            raise BuildError(f'Couldn\'t find vswhere.exe.  Is Visual Studio installed?')

        vswhere = root / 'Microsoft Visual Studio' / 'Installer' / 'vswhere.exe'
        if not vswhere.exists():
            raise BuildError(f'Couldn\'t find vswhere.exe (looked in: {vswhere})')

        try:
            path = subprocess.check_output([
                vswhere,
                # Gross:
                '-latest',
                '-version', '[16,]',  # At least VS 2019
                '-prerelease',
                '-requiresAny',
                '-property', 'installationPath',
                '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                '-products', '*',
            ]).decode(encoding='mbcs', errors='strict').strip()
        except Exception as e:
            raise BuildError(f'vswhere.exe error: {e}')

        path = Path(path)
        path = path / 'MSBuild' / 'Current' / 'Bin' / 'MSBuild.exe'
        if not path.is_file():
            raise BuildError(f'Couldn\'t locate Visual Studio 2019 or newer')

        return path

    def build_native(self):
        """
        Build native/VView.sln.

        This creates our own binaries in bin.
        """
        print('')
        print('--- Building')
        print('')

        msbuild = self.find_msbuild()
        python_path = sys.prefix

        # Restore NuGet packages.  We should be able to do this in the same build as below, but new packages
        # don't actually have their include paths added to the build until the next execution.
        result = subprocess.run([
            msbuild,
            r'native\VView.sln',
            '-property:RestorePackagesConfig=true',
            '-t:Restore',
            '-verbosity:minimal',
        ])

        # The "OutputDir" property sets the directory the build will output to.  The variables look
        # like:
        #
        # TopDir        $(SolutionDir)..\$(OutputDir)\
        # OutputDir     bin
        # BinDir        $(TopDir)\$(OutputDir)\
        # 
        # We override OutputDir to the path we've been told to build into, though this is usually just
        # left at "bin", which is the same as the default set in SharedProperties.props.
        #
        # PythonPath tells the build where to find Python headers and libraries.  We get it from our own sys.prefix.
        # This can also be set in SharedProperties.props for building in VS.
        output_dir = self.bin_dir.name
        result = subprocess.run([
            msbuild,
            r'native\VView.sln',
            # '-t:Clean',
            '-t:Build',
            '-verbosity:minimal',
            '-maxCpuCount',
            f'-property:OutputDir={output_dir}',
            f'-property:PythonPath={python_path}',
        ])

        if result.returncode != 0:
            raise BuildError('Native build failed')

    def check_native(self):
        """
        We've built our binaries.  Check that VVpython.exe actually works.  It can't do
        much yet since we haven't installed dependancies, but we should be able to run basic
        code.
        """
        print(self.vvpython)
        result = subprocess.run(stdout=subprocess.PIPE, args=[
            self.vvpython,
            '-c',
            'import sys; print(sys.path)',
        ])

        if result.returncode != 0:
            raise BuildError('Testing VVpython.exe failed')

        result = eval(result.stdout)
        # print(result)

    def install_pip(self):
        """
        Install PIP into our new environment.

        We need PIP to install the rest of our dependancies.  It would be nicer to install it
        into a separate directory than site-packages, since we don't want to include it in
        distributions (it's big and unneeded).
        """
        # See if PIP is already installed in the environment.
        result = subprocess.run(args=[self.vvpython, '-c', 'import pip'], stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            print('')
            print('PIP already installed')
            print('')
            return

        print('--- Installing PIP')
        print('')

        # Download get-pip.py.
        url = f'https://bootstrap.pypa.io/get-pip.py'
        get_pip = util.download_file(url)

        result = subprocess.run(args=[
            self.vvpython,
            get_pip,
            '--no-warn-script-location',
        ])

        if result.returncode != 0:
            raise BuildError('Installing PIP into embedded environment failed')

    def install_python_deps(self):
        """
        Now that PIP is installed, use it to install the rest of our Python dependancies.
        """
        print('--- Installing Python dependancies')
        print('')
        result = subprocess.run(args=[
            self.vvpython,
            '-m',
            'pip', 'install',
            '--quiet',
            '--no-warn-script-location',
            '--requirement', 'vview/requirements.txt',
        ])

        # Work around a nasty trap: pywin32 has an LGPL module hidden inside it, even
        # though it claims to be PSL-2.  We don't use this module, so just delete it
        # wholesale.
        adodbapi_dir = self.bin_dir / 'Python/Lib/site-packages/adodbapi'
        if adodbapi_dir.exists():
            shutil.rmtree(adodbapi_dir)

if __name__=='__main__':
    VViewBuild().build_all()

