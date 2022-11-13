import argparse, base64, collections, errno, glob, hashlib, json, io, os, random, re, sys, string, subprocess, tempfile
from pathlib import Path
from pprint import pprint

# This builds a user script that imports each filename directly from the build
# tree.  This can be used during development: you can edit files and refresh a
# page without having to build the script or install it.

# Source files will be loaded in the order they're listed.
from .source_files import source_files

_git_tag = None
def get_git_tag():
    """
    Return the current git tag.
    """
    global _git_tag
    if _git_tag is not None:
        return _git_tag
        
    result = subprocess.run(['git', 'describe', '--tags', '--dirty', '--match=r*'], capture_output=True)
    _git_tag = result.stdout.strip().decode()
    return _git_tag

def to_javascript_string(s):
    """
    Return s as a JavaScript string.
    """
    escaped = re.sub(r'''([`$\\])''', r'\\\1', s)

    # This is a hopefully temporary workaround for "Stay" to stop it from stripping our
    # comments by replacing "//" in source code strings with "/\\x2f":
    #
    # https://github.com/shenruisi/Stay/issues/60
    escaped = escaped.replace('//', '/\\x2f')
    return '`%s`' % escaped

class Build(object):
    # Source maps will point to here:
    github_root = 'https://raw.githubusercontent.com/ppixiv/ppixiv/'

    # Info for deployment.  If you're just building locally, these won't be used.
    deploy_s3_bucket = 'ppixiv'
    distribution_root = f'https://ppixiv.org'

    @classmethod
    def build(cls):
        parser = argparse.ArgumentParser()
        parser.add_argument('--deploy', '-d', action='store_true', default=False, help='Deploy a release version')
        parser.add_argument('--latest', '-l', action='store_true', default=False, help='Point latest at this version')
        parser.add_argument('--url', '-u', action='store', default=None, help='Location of the debug server for ppixiv-debug')
        args = parser.parse_args()

        # This is a release if it has a tag and the working copy is clean.
        result = subprocess.run(['git', 'describe', '--tags', '--match=r*', '--exact-match'], capture_output=True)
        is_tagged = result.returncode == 0

        result = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], capture_output=True)
        is_clean = len(result.stdout) == 0

        is_release = is_tagged and is_clean
        debug_server_url = None

        if len(sys.argv) > 1 and sys.argv[1] == '--release':
            is_release = True

        if is_release:
            git_tag = get_git_tag()
        else:
            git_tag = None

        if is_release:
            print('Release build: %s' % git_tag)
        else:
            reason = []
            if not is_clean:
                reason.append('working copy dirty')
            if not is_tagged:
                reason.append('no tag')
            print('Development build: %s' % ', '.join(reason))

        try:
            os.makedirs('output')
        except OSError as e:
            # Why is os.makedirs "create all directories, but explode if the last one already
            # exists"?
            if e.errno != errno.EEXIST:
                raise

        cls().build_with_settings(is_release=is_release, git_tag=git_tag, deploy=args.deploy, latest=args.latest,
            debug_server_url=args.url)

    def build_with_settings(self, *, is_release=False, git_tag='devel', deploy=False, latest=False, debug_server_url='http://127.0.0.1:8235'):
        self.is_release = is_release
        self.git_tag = git_tag
        self.distribution_url = f'{self.distribution_root}/builds/{get_git_tag()}'

        self.resources = self.build_resources()
        self.build_release()
        self.build_debug(debug_server_url)
        if deploy:
            self.deploy(latest=latest)

    def deploy(self, latest=False):
        """
        Deploy the distribution to the website.
        """
        def copy_file(source, path, output_filename=None):
            if output_filename is None:
                output_filename = os.path.basename(source)
            subprocess.check_call([
                'aws', 's3', 'cp',
                '--acl', 'public-read',
                source,
                f's3://{self.deploy_s3_bucket}/{path}/{output_filename}',
            ])

        if not self.is_release:
            # If we're deploying a dirty build, just copy the full build to https://ppixiv.org/beta
            # for quick testing.  Don't clutter the build directory with "r123-dirty" builds.
            print('Deploying beta only')
            copy_file('output/ppixiv.user.js', 'beta')
            copy_file('output/ppixiv-main.user.js', 'beta')
            return

        # Copy files for this version into https://ppixiv.org/builds/r1234.
        version = get_git_tag()
        for filename in ('ppixiv.user.js', 'ppixiv-main.user.js'):
            copy_file(f'output/{filename}', f'builds/{version}')

        # Update the beta to point to this build.
        copy_file('output/ppixiv.user.js', 'beta')

        if latest:
            # Copy the loader to https://ppixiv.org/latest:
            copy_file('output/ppixiv.user.js', 'latest')

    def build_release(self):
        """
        Build the final output/ppixiv.user.js script.
        """
        # Generate the main script.  This can be installed directly, or loaded by the
        # loader script.
        output_file = 'output/ppixiv-main.user.js'
        print('Building: %s' % output_file)

        data = self.build_output()
        data = data.encode('utf-8')
        sha256 = hashlib.sha256(data).hexdigest()

        with open(output_file, 'w+b') as output_file:
            output_file.write(data)

        # Generate the loader script.  This is intended for use on GreasyFork so we can update
        # the script without pushing a 1.5MB update each time, and so we won't eventually run
        # into the 2MB size limit.
        output_loader_file = 'output/ppixiv.user.js'
        print('Building: %s' % output_loader_file)
        result = self.build_header(for_debug=False)

        # Add the URL where the above script will be available.  If this is a release, it'll be
        # in the regular distribution directory with the release in the URL.  If this is a debug
        # build, we only keep the latest version around in /beta.
        if self.is_release:
            main_url = f'{self.distribution_url}/ppixiv-main.user.js'
        else:
            main_url = f'{self.distribution_root}/beta/ppixiv-main.user.js'

        result.append(f'// @require     {main_url}#sha256={sha256}')
        result.append(f'// ==/UserScript==')

        # Add a dummy statement.  Greasy Fork complains about "contains no executable code" if there's
        # nothing in the top-level script, since it doesn't understand that all of our code is in a
        # @require.
        result.append('(() => {})();')

        data = '\n'.join(result) + '\n'
        data = data.encode('utf-8')
        with open(output_loader_file, 'w+b') as output_file:
            output_file.write(data)

    def build_debug(self, debug_server_url):
        output_file = 'output/ppixiv-debug.user.js'
        print('Building: %s' % output_file)

        result = self.build_header(for_debug=True)
        result.append(f'// ==/UserScript==')

        # Add the loading code for debug builds, which just runs bootstrap_native.js.
        result.append('''
// Load and run the bootstrap script.  Note that we don't do this with @require, since TamperMonkey caches
// requires overly aggressively, ignoring server cache headers.  Use sync XHR so we don't allow the site
// to continue loading while we're setting up.
(() => {
    // If this is an iframe, don't do anything.
    if(window.top != window.self)
        return;

    window.vviewURL = %(url)s;

    // Load NativeLoader.
    let xhr = new XMLHttpRequest();
    xhr.open("GET", `${window.vviewURL}/client/js/bootstrap_native.js`, false);
    xhr.send();
    eval(xhr.responseText);

    xhr = new XMLHttpRequest();
    xhr.open("GET", `${window.vviewURL}/client/js/bootstrap.js`, false);
    xhr.send();
    eval(xhr.responseText);

    Bootstrap(null, NativeLoader);
})();
        ''' % { 'url': json.dumps(debug_server_url) })

        lines = '\n'.join(result) + '\n'

        with open(output_file, 'w+t', encoding='utf-8', newline='\n') as f:
            f.write(lines)

    @property
    def root(self):
        return Path(os.getcwd())

    def get_local_root_url(self):
        """
        Return the file:/// path containing local source.

        This is only used for development builds.
        """
        return self.root.as_uri()

    def get_source_root_url(self, filetype='source'):
        """
        Return the URL to the top of the source tree, which source maps point to.
        
        This is used in used in sourceURL, and the URLs source maps point to.  In development,
        this is a file: URL pointing to the local source tree.  For releases, this points to
        the tag on GitHub for this release.
        """
        if self.is_release:
            return self.github_root + self.git_tag
        else:
            return self.get_local_root_url()

    def get_resource_list(self):
        results = collections.OrderedDict()
        files = list(glob.glob('resources/*'))
        files.sort()
        for path in files:
            name = path.replace('\\', '/')
            _, ext = os.path.splitext(name)
            results[name] = Path(path)

        return results

    def _make_temp_path(self):
        """
        Create a reasonably unique filename for a temporary file.

        tempfile insists on creating the file and doesn't give us a way to simply generate
        a filename, which is what's needed when we're passing a filename to a subprocess.
        """
        fn = ''.join(random.choice(string.ascii_lowercase) for _ in range(10))
        return Path(tempfile.gettempdir()) / ('vview-' + fn)

    def build_css(self, path, embed_source_root=None):
        if embed_source_root is None:
            embed_source_root = self.get_source_root_url()

        path = path.resolve()

        # The path to dart-sass:
        dart_path = self.root / 'bin' / 'dart-sass'
        dart_exe = dart_path / 'dart.exe'
        sass = dart_path / 'sass.snapshot'

        # If dart-sass doesn't exist in bin/dart-sass, it probably hasn't been downloaded.  Run
        # vview.build.build_vview first at least once to download it.
        if not dart_exe.exists():
            raise Exception(f'dart-sass not found in {dart_path}')

        output_css = self._make_temp_path().with_suffix('.css')
        output_map = output_css.with_suffix('.css.map')

        # Run dart-sass.  We have to output to temporary files instead of reading stdout,
        # since it doesn't give any way to output the CSS and source map separately that way.
        dart_args = [
            dart_exe, sass,
        ]

        result = subprocess.run(dart_args + [
            '--no-embed-source-map',
            str(path),
            str(output_css),
        ], capture_output=True)

        if result.returncode:
            # Errors from dart are printed to stderr, but errors from SASS itself go to
            # stdout.
            output = result.stderr.decode("utf-8").strip()
            if not output:
                output=result.stdout.decode("utf-8").strip()

            raise Exception(f'Error building {path}: {output}')

        # Read the temporary files, then clean them up.
        with open(output_css, 'rt', encoding='utf-8') as f:
            data = f.read()

        with open(output_map, 'rt', encoding='utf-8') as f:
            source_map = f.read()

        output_css.unlink()
        output_map.unlink()

        # dart-sass doesn't let us tell it the source root.  They expect us to decode it and
        # fix it ourself.  It's pretty obnoxious to have to jump a bunch of hoops because they
        # couldn't be bothered to just let us pass in a URL and tell it where the top path is.
        #
        # We expect all CSS files to be inside the top directory, eg:
        #
        # file:///c:/files/ppixiv/resources/main.scss
        #
        # Map these so they're relative to the root, and set sourceRoot to embed_source_root.
        source_map = json.loads(source_map)
        expected_wrong_url = self.get_local_root_url()
        if not expected_wrong_url.endswith('/'):
            expected_wrong_url += '/'

        def fix_url(url):
            if not url.startswith(expected_wrong_url):
                raise Exception(f'Expected CSS source map path {url} to be inside {expected_wrong_url}')
            return url[len(expected_wrong_url):]
        
        source_map['sources'] = [fix_url(url) for url in source_map['sources']]
        source_map['sourceRoot'] = embed_source_root

        # Fix the filename, so it doesn't contain the temporary filename.
        source_map['file'] = Path(path).relative_to(self.root).as_posix()

        # Reserialize the source map.
        source_map = json.dumps(source_map, indent=0)

        # Compounding the above problem: if you tell it not to embed the source map, it appends
        # the sourceMappingURL, and there's no way to tell it not to, so we have to find it and
        # strip it off.
        lines = data.split('\n')
        assert lines[-2].startswith('/*# sourceMappingURL')
        assert lines[-1] == ''
        lines[-2:-1] = []
        data = '\n'.join(lines)

        # Embed our fixed source map.
        encoded_source_map = base64.b64encode(source_map.encode('utf-8')).decode('ascii')
        data += '/*# sourceMappingURL=data:application/json;base64,%s */' % encoded_source_map

        return data

    def build_resources(self):
        """
        Build all resources, returning a dictionary of resource names to data.
        """
        # Collect resources into an OrderedDict, so we always output data in the same order.
        # This prevents the output from changing.
        resources = collections.OrderedDict()

        for fn, path in self.get_resource_list().items():
            fn = fn.replace('\\', '/')
            ext = path.suffix
            if ext == '.scss':
                data = self.build_css(path)
            elif ext in ('.png', '.woff'):
                mime_types = {
                    '.png': 'image/png',
                    '.woff': 'font/woff',
                }

                data = open(fn, 'rb').read()

                ext = os.path.splitext(fn)[1]
                mime_type = mime_types.get(ext, 'application/octet-stream')

                data = 'data:%s;base64,%s' % (mime_type, base64.b64encode(data).decode('ascii'))
            else:
                data = open(fn, 'rt', encoding='utf-8').read()

            # JSON makes these text resources hard to read.  Instead, put them in backticks, escaping
            # the contents.
            resources[fn] = to_javascript_string(data)

        return resources

    def build_header(self, for_debug):
        result = []
        with open('src/header.js', 'rt', encoding='utf-8') as input_file:
            for line in input_file.readlines():
                line = line.strip()

                # Change the name of the testing script so it can be distinguished in the script dropdown.
                if line.startswith('// @name ') and for_debug:
                    line += ' (testing)'

                result.append(line)

        # Add @version.
        if for_debug:
            version = 'testing'
        else:
            version = self.get_release_version()
            
        result.append('// @version     %s' % version)

        return result

    def get_release_version(self):
        version = get_git_tag()

        # Release tags look like "r100".  Remove the "r" from the @version.
        assert version.startswith('r')
        version = version[1:]

        return version

    def build_output(self):
        result = self.build_header(for_debug=False)
        result.append(f'// ==/UserScript==')

        # All resources that we include in the script.
        all_resources = list(source_files)

        # Encapsulate the script.
        result.append('(function() {\n')

        result.append('let env = {};')
        result.append(f'env.version = "{self.get_release_version()}";')
        result.append('env.resources = {};\n')

        # Add the list of source files to resources, so bootstrap.js knows what to load.
        init = {
            'source_files': source_files,
        }
        result.append(f'env.init = {json.dumps(init, indent=4)};\n')

        output_resources = collections.OrderedDict()

        # Add resources.  These are already encoded as JavaScript strings, including quotes
        # around the string), so just add them directly.
        for fn, data in self.resources.items():
            output_resources[fn] = data

        for fn in all_resources:
            with open(fn, 'rt', encoding='utf-8') as input_file:
                script = input_file.read()

                # Wrap source files in a function, so we can load them when we're ready in bootstrap.js.
                if fn in source_files:
                    script += '\n//# sourceURL=%s/%s\n' % (self.get_source_root_url(), fn)
                    script = to_javascript_string(script)

                output_resources[fn] = script

        # Output resources.  We do it this way instead of just putting everything in a dictionary
        # and JSON-encoding the dictionary so that source files are output in a readable format.  If
        # we JSON-encode them, they'll end up on one long line with JSON newline escapes instead.
        for fn, data in output_resources.items():
            data = '''env.resources["%s"] = %s;''' % (fn, data)
            result.append(data)

        # Add the bootstrap code directly.
        bootstrap = open('src/bootstrap.js', 'rt', encoding='utf-8').read()
        result.append(bootstrap)
        result.append('Bootstrap(env);\n')

        result.append('})();\n')

        return '\n'.join(result) + '\n'

if __name__=='__main__':
    Build().build()

