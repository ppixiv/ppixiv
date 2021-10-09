#!/usr/bin/python3

import base64, collections, glob, json, os, re, sys, subprocess, random
import sass
from pprint import pprint
from io import StringIO

# This builds a user script that imports each filename directly from the build
# tree.  This can be used during development: you can edit files and refresh a
# page without having to build the script or install it.

# Source files will be loaded in the order they're listed.
source_files = [
    'src/actions.js',
    'src/muting.js',
    'src/crc32.js',
    'src/helpers.js',
    'src/fix_chrome_clicks.js',
    'src/widgets.js',
    'src/menu_option.js',
    'src/main_context_menu.js',
    'src/create_zip.js',
    'src/data_sources.js',
    'src/encode_mkv.js',
    'src/hide_mouse_cursor_on_idle.js',
    'src/image_data.js',
    'src/on_click_viewer.js',
    'src/polyfills.js',
    'src/progress_bar.js',
    'src/seek_bar.js',
    'src/struct.js',
    'src/ugoira_downloader_mjpeg.js',
    'src/viewer.js',
    'src/viewer_images.js',
    'src/viewer_muted.js',
    'src/viewer_ugoira.js',
    'src/zip_image_player.js',
    'src/view.js',
    'src/view_illust.js',
    'src/view_search.js',
    'src/view_manga.js',
    'src/image_ui.js',
    'src/tag_search_dropdown_widget.js',
    'src/tag_translations.js',
    'src/thumbnail_data.js',
    'src/manga_thumbnail_widget.js',
    'src/page_manager.js',
    'src/remove_link_interstitial.js',
    'src/image_preloading.js',
    'src/whats_new.js',
    'src/main.js',
]

def get_git_tag():
    """
    Return the current git tag.
    """
    result = subprocess.run(['git', 'describe', '--tags', '--dirty'], capture_output=True)
    return result.stdout.strip().decode()

class Build(object):
    github_root = 'https://raw.githubusercontent.com/ppixiv/ppixiv/'
    setup_filename = 'build/setup.js'
    debug_resources_path = 'build/resources.js'

    def build(self):
        # If the working copy isn't clean, this isn't a release.
        result = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], capture_output=True)
        is_clean = len(result.stdout) == 0
        self.is_release = is_clean

        if len(sys.argv) > 1 and sys.argv[1] == '--release':
            self.is_release = True

        if self.is_release:
            self.git_tag = get_git_tag()

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

        return 'file:///' + cwd

    def get_source_root_url(self):
        """
        Return the URL used in sourceURL and source map URLs.
        """
        # When we're building for development, the source map root is the local directory containing source
        # files.
        #
        # For releases, use the raw GitHub URL where the file will be on GitHub once the current tag is pushed.
        if self.is_release:
            return self.github_root + self.git_tag
        else:
            return self.get_local_root_url()

    def create_environment(self):
        print('Building: %s' % self.setup_filename)

        # Output the environment file for bootstrap.js.
        environment = {
            'source_files': source_files,
        }

        # The debug bootstrap code wants to know the local source path so it can add sourceURL.
        # This doesn't need to be included in release builds.
        if not self.is_release:
            environment['source_root'] = self.get_source_root_url()

        with open(self.setup_filename, 'w+t') as f:
            f.write(json.dumps(environment, indent=4) + '\n')

    def build_resources(self):
        """
        Compile files in resource/ and inline-resource/ into build/resource.js that we can include as
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
            _, ext = os.path.splitext(fn)

            if ext in ('.css', '.scss'):
                data, source_map = sass.compile(filename=fn,
                        source_comments=True,
                        source_map_embed=False,
                        source_map_filename='dummy', # or else it doesn't give us a source map
                        omit_source_map_url=True)

                # We could include source maps in release builds, but we'd need to figure out
                # somewhere to put them, like a secondary GH repo.  It might be worth doing for
                # source files, so we can get more useful bug reports, but TamperMonkey doesn't
                # make that easy...
                if not self.is_release:
                    # Write out the source map.  Chrome does allow us to reference file:/// URLs in
                    # source map URLs.
                    source_map_filename = 'build/%s.map' % os.path.basename(fn)
                    with open(source_map_filename, 'w+t') as f:
                        f.write(source_map)

                    # We can embed the source map, but the stylesheet one is pretty big (larger than the
                    # stylesheet itself).
                    # encoded_source_map = base64.b64encode(source_map.encode()).decode('ascii')
                    # url = 'data:application/json;base64,%s' % encoded_source_map
                    url = self.get_source_root_url() + '/' + source_map_filename
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
                data = open(fn).read()

            # JSON makes these text resources hard to read.  Instead, put them in backticks, escaping
            # the contents.
            escaped_data = re.sub(r'''([`$])''', r'\\\1', data)
            encoded_data = "`" + escaped_data + "`"
            resources[fn] = encoded_data

        # In release builds, resources are added to this.resources in the same way as source.
        #
        # In debug builds, we write them to a file that we can include with @resources, so we
        # can update them without having to change the debug script.  Write build/resources.js
        # for when we're in debug mode.
        with open(self.debug_resources_path, 'w+t') as f:
            for fn, data in resources.items():
                f.write('this.resources["%s"] = %s;\n' % (fn, data))

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
        with open('src/header.js', 'rt') as input_file:
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

            result.append('with(this) {\n')
            result.append('this.resources = {};\n')

            output_resources = collections.OrderedDict()

            # Add resources.  These are already encoded as JavaScript strings, including quotes
            # around the string), so just add them directly.
            for fn, data in self.resources.items():
                output_resources[fn] = data

            for fn in all_resources:
                with open(fn, 'rt') as input_file:
                    script = input_file.read()

                    # Wrap source files in a function, so we can load them when we're ready in bootstrap.js.
                    if fn in source_files:
                        script = '''() => {\n%s\n};\n''' % script

                    output_resources[fn] = script

            for fn, data in output_resources.items():
                data = '''this.resources["%s"] = %s;''' % (fn, data)
                result.append(data)

            # Add the bootstrap code directly.
            bootstrap = open('src/bootstrap.js', 'rt').read()
            result.append(bootstrap)

            result.append('}\n')
            result.append('}).call({});\n')

        return '\n'.join(result) + '\n'

    def build_release(self):
        """
        Build the final build/ppixiv.user.js script.
        """
        output_file = 'build/ppixiv.user.js'
        print('Building: %s' % output_file)
        with open(output_file, 'w+t') as output_file:
            header = self.build_output(for_debug=False)
            output_file.write(header)

    def build_debug(self):
        output_file = 'build/ppixiv-debug.user.js'
        print('Building: %s' % output_file)

        cwd = os.getcwd()

        # I only run this in Cygwin.  This would need adjustment for native Python.
        # /cygdrive/c/...
        assert cwd.startswith('/cygdrive/')
        cwd = cwd[len('/cygdrive/'):]
        assert cwd[1] == '/'
        cwd = 'file:///' + cwd[0] + ':' + cwd[1:] + '/'

        lines = self.build_output(for_debug=True)

        with open(output_file, 'w+t') as f:
            f.write(lines)

Build().build()
