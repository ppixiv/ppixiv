import base64, collections, errno, glob, json, os, re, sys, subprocess
import sass
from pprint import pprint

# This builds a user script that imports each filename directly from the build
# tree.  This can be used during development: you can edit files and refresh a
# page without having to build the script or install it.

# Source files will be loaded in the order they're listed.
from .source_files import source_files

def get_git_tag():
    """
    Return the current git tag.
    """
    result = subprocess.run(['git', 'describe', '--tags', '--dirty', '--match=r*'], capture_output=True)
    return result.stdout.strip().decode()

def to_javascript_string(s):
    """
    Return s as a JavaScript string.
    """
    escaped = re.sub(r'''([`$\\])''', r'\\\1', s)
    return '`%s`' % escaped

class Build(object):
    github_root = 'https://raw.githubusercontent.com/ppixiv/ppixiv/'
    setup_filename = 'output/setup.js'
    debug_resources_path = 'output/resources.js'

    def build(self):
        # This is a release if it has a tag and the working copy is clean.
        result = subprocess.run(['git', 'describe', '--tags', '--match=r*', '--exact-match'], capture_output=True)
        is_tagged = result.returncode == 0

        result = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], capture_output=True)
        is_clean = len(result.stdout) == 0

        self.is_release = is_tagged and is_clean

        if len(sys.argv) > 1 and sys.argv[1] == '--release':
            self.is_release = True

        if self.is_release:
            self.git_tag = get_git_tag()

        if self.is_release:
            print('Release build: %s' % self.git_tag)
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

        self.create_environment()
        self.resources = self.build_resources()
        self.build_release()
        self.build_debug()

    def get_local_root_url(self):
        """
        Return the file:/// path containing local source.

        This is only used for development builds.
        """
        # Handle Cygwin and Windows paths.
        cwd = os.getcwd()
        if cwd.startswith('/cygdrive/'):
            parts = cwd.split('/')
            cwd = '%s:/%s' % (parts[2], '/'.join(parts[3:]))

        return 'file:///%s/' % cwd

    def get_source_root_url(self):
        """
        Return the URL used in sourceURL and source map URLs.
        """
        # When we're building for development, the source map root is the local directory containing source
        # files.
        #
        # For releases, use the raw GitHub URL where the file will be on GitHub once the current tag is pushed.
        if self.is_release:
            return self.github_root + self.git_tag + '/'
        else:
            return self.get_local_root_url()

    def create_environment(self):
        print('Building: %s' % self.setup_filename)

        # Output the environment file for bootstrap.js.
        environment = {
            'source_files': source_files,
        }


        with open(self.setup_filename, 'w+t', encoding='utf-8') as f:
            f.write(json.dumps(environment, indent=4) + '\n')

    def build_resources(self):
        """
        Compile files in resource/ and inline-resource/ into output/resource.js that we can include as
        a source file.

        These are base64-encoded and not easily read in the output file.  We should only use this for
        markup and images and not scripts, since we don't want to obfuscate code in the output.
        """
        print('Building: %s' % self.debug_resources_path)

        source_map_root = self.get_source_root_url()

        # Collect resources into an OrderedDict, so we always output data in the same order.
        # This prevents the output from changing.
        resources = collections.OrderedDict()

        for fn in glob.glob('resources/*'):
            fn = fn.replace('\\', '/')
            _, ext = os.path.splitext(fn)

            if ext in ('.css', '.scss'):
                data, source_map = sass.compile(filename=fn,
                        source_comments=True,
                        source_map_embed=False,
                        source_map_root=source_map_root,
                        source_map_filename='dummy', # or else it doesn't give us a source map
                        omit_source_map_url=True)

                # Write out the source map.  Chrome does allow us to reference file:/// URLs in
                # source map URLs.
                source_map_filename = 'output/%s.map' % os.path.basename(fn)
                with open(source_map_filename, 'w+t', encoding='utf-8') as f:
                    f.write(source_map)

                # We can embed the source map, but the stylesheet one is pretty big (larger than the
                # stylesheet itself).
                # encoded_source_map = base64.b64encode(source_map.encode()).decode('ascii')
                # url = 'data:application/json;base64,%s' % encoded_source_map
                url = self.get_source_root_url() + source_map_filename
                data += "\n/*# sourceMappingURL=%s */" % url
            elif ext in ('.png', ):
                mime_types = {
                    '.png': 'image/png',
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

        # In release builds, resources are added to ppixiv.resources in the same way as source.
        #
        # In debug builds, we write them to a file that we can include with @resources, so we
        # can update them without having to change the debug script.  Write output/resources.js
        # for when we're in debug mode.
        with open(self.debug_resources_path, 'w+t', encoding='utf-8') as f:
            for fn, data in resources.items():
                f.write('ppixiv.resources["%s"] = %s;\n' % (fn, data))

        return resources

    def build_output(self, for_debug):
        # All resources that we include in the script.
        all_resources = list(source_files)

        # Include setup.js in resources.  It's JSON data and not a source file, so it's not
        # included in source_files.
        all_resources = [self.setup_filename] + all_resources

        # In debug builds, add resources.js to the resource list.
        if for_debug:
            all_resources.append(self.debug_resources_path)

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
            version = get_git_tag()

            # Version tags look like "r100".  Remove the "r" from the @version.
            assert version.startswith('r')
            version = version[1:]
        result.append('// @version     %s' % version)

        if for_debug:
            # Add the GM_getResourceText permission.  Only the debug build uses this.  It
            # isn't added to the base permissions since it might prompt people for permission.
            # (There's no reason at all for this to even be a special permission.)
            result.append('// @grant       GM_getResourceText')

            root = self.get_local_root_url()

            result.append('//')
            result.append('// @require   %s/src/bootstrap.js' % root)

            for fn in all_resources:
                include_line = '// @resource  %s   %s/%s' % (fn, root, fn)
                result.append(include_line)

        result.append('// ==/UserScript==')

        if not for_debug:
            # Encapsulate the script.
            result.append('(function() {\n')
            result.append('const ppixiv = this;\n')

            result.append('with(this) {\n')
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
                        script += '\n//# sourceURL=%s%s\n' % (self.get_source_root_url(), fn)
                        script = to_javascript_string(script)

                    output_resources[fn] = script

            for fn, data in output_resources.items():
                data = '''ppixiv.resources["%s"] = %s;''' % (fn, data)
                result.append(data)

            # Add the bootstrap code directly.
            bootstrap = open('src/bootstrap.js', 'rt', encoding='utf-8').read()
            result.append(bootstrap)

            result.append('}\n')
            result.append('}).call({});\n')

        return '\n'.join(result) + '\n'

    def build_release(self):
        """
        Build the final output/ppixiv.user.js script.
        """
        output_file = 'output/ppixiv.user.js'
        print('Building: %s' % output_file)
        with open(output_file, 'w+t', encoding='utf-8') as output_file:
            header = self.build_output(for_debug=False)
            output_file.write(header)

    def build_debug(self):
        output_file = 'output/ppixiv-debug.user.js'
        print('Building: %s' % output_file)

        lines = self.build_output(for_debug=True)

        with open(output_file, 'w+t', encoding='utf-8') as f:
            f.write(lines)

if __name__=='__main__':
    Build().build()
