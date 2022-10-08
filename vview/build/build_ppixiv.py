import argparse, base64, collections, errno, glob, hashlib, json, io, os, re, sys, subprocess
from pathlib import Path
import sass
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
        parser.add_argument('--deploy', '-d', action='store_true', default=False)
        parser.add_argument('--latest', '-l', action='store_true', default=False)
        args = parser.parse_args()

        # This is a release if it has a tag and the working copy is clean.
        result = subprocess.run(['git', 'describe', '--tags', '--match=r*', '--exact-match'], capture_output=True)
        is_tagged = result.returncode == 0

        result = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], capture_output=True)
        is_clean = len(result.stdout) == 0

        is_release = is_tagged and is_clean

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

        cls().build_with_settings(is_release=is_release, git_tag=git_tag, deploy=args.deploy, latest=args.latest)

    def build_with_settings(self, *, is_release=False, git_tag='devel', deploy=False, latest=False):
        self.is_release = is_release
        self.git_tag = git_tag
        self.distribution_url = f'{self.distribution_root}/builds/{get_git_tag()}'

        self.resources = self.build_resources()
        self.build_release()
        self.build_debug()
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
            copy_file('output/ppixiv-main.user.js', 'beta', output_filename='ppixiv.user.js')
            return

        # Copy files for this version into https://ppixiv.org/builds/r1234.
        version = get_git_tag()
        for filename in ('ppixiv.user.js', 'ppixiv-main.user.js', 'main.scss.map'):
            copy_file(f'output/{filename}', f'builds/{version}')

        # Update the beta to point to this build.  Since we've deployed a tag for this, we can
        # use the loader for this.
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

        # Add the URL where the above script will be available.
        main_url = f'{self.distribution_url}/ppixiv-main.user.js'
        result.append(f'// @require     {main_url}#sha256={sha256}')
        result.append(f'// ==/UserScript==')

        data = '\n'.join(result) + '\n'
        data = data.encode('utf-8')
        with open(output_loader_file, 'w+b') as output_file:
            output_file.write(data)

    def build_debug(self):
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

    window.vviewURL = "http://127.0.0.1:8235";

    let xhr = new XMLHttpRequest();
    xhr.open("GET", `${window.vviewURL}/client/js/bootstrap_native.js`, false);
    xhr.send();
    eval(xhr.responseText);
})();
        ''')

        lines = '\n'.join(result) + '\n'

        with open(output_file, 'w+t', encoding='utf-8', newline='\n') as f:
            f.write(lines)

    def get_local_root_url(self):
        """
        Return the file:/// path containing local source.

        This is only used for development builds.
        """
        # Handle Cygwin and Windows paths.
        cwd = os.getcwd()
        if cwd.startswith('/cygdrive/'): # /cygdrive/c/path
            parts = cwd.split('/')
            cwd = '%s:/%s' % (parts[2], '/'.join(parts[3:]))
        elif cwd.startswith('/'): # /c/path
            parts = cwd.split('/')
            cwd = '%s:/%s' % (parts[1], '/'.join(parts[2:]))

        return 'file:///%s' % cwd

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

    def build_css(self, path, source_map_embed=False, embed_source_root=None):
        # This API's a bit annoying: we have to omit these parameters entirely and not
        # set them to None if we want an embedded source map.
        kwargs = { }

        if not source_map_embed:
            kwargs['source_map_root'] = self.get_source_root_url()
            kwargs['source_map_filename'] = 'dummy' # or else it doesn't give us a source map
            kwargs['omit_source_map_url'] = True
        else:
            kwargs['source_map_root'] = embed_source_root

        results = sass.compile(filename=str(path),
                source_comments=False,
                source_map_embed=source_map_embed,
                **kwargs)

        # Also, it has a variable number of results depending on whether it's returning
        # a source map or not.
        if source_map_embed:
            data, source_map = results, None
        else:
            data, source_map = results
        return data, source_map

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
                data, source_map = self.build_css(path)

                # Output the source map separately.
                source_map_filename = f'{os.path.basename(fn)}.map'
                source_map_path = f'output/{source_map_filename}'
                with open(source_map_path, 'w+t', encoding='utf-8', newline='\n') as f:
                    f.write(source_map)

                # In release, point to the distribution path for the source map.  For development, just
                # point to the source map on the local filesystem.
                if self.is_release:
                    url = f'{self.distribution_url}/{source_map_filename}'
                else:
                    url = f'{self.get_local_root_url()}/{source_map_path}'

                data += "\n/*# sourceMappingURL=%s */" % url
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
        result.append('const ppixiv = this;\n')

        result.append('with(this) {\n')
        result.append(f'ppixiv.version = "{self.get_release_version()}";')
        result.append('ppixiv.resources = {};\n')

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

        # Add the list of source files to resources, so bootstrap.js knows what to load.
        setup = {
            'source_files': source_files,
        }
        output_resources['setup.js'] = json.dumps(setup, indent=4) + '\n'

        for fn, data in output_resources.items():
            data = '''ppixiv.resources["%s"] = %s;''' % (fn, data)
            result.append(data)

        # Add the bootstrap code directly.
        bootstrap = open('src/bootstrap.js', 'rt', encoding='utf-8').read()
        result.append(bootstrap)

        result.append('}\n')
        result.append('}).call({});\n')

        return '\n'.join(result) + '\n'

if __name__=='__main__':
    Build().build()

