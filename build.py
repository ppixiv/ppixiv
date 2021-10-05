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
    'build/resources.js',
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

def do_replacement(line):
    m = re.match(r'^(\s*)### *inline:([^\s]+)\s*$', line)
    if m is None:
        return None
    resource_filename = m.group(2)
    inline_data = open('inline-resources/%s' % resource_filename, 'r').read()
    return inline_data

def replace_placeholders(data):
    # Expand inline placeholders to the contents of files in inline-resources:
    #
    # <!-- #inline:filename -->
    #
    # These must be on a line by themselves.
    data = data.split('\n')

    for idx, line in enumerate(data):
        replaced_data = do_replacement(line)
        if replaced_data is not None:
            data[idx] = replaced_data

    return '\n'.join(data)

def get_git_tag():
    """
    Return the current git tag.
    """
    result = subprocess.run(['git', 'describe', '--tags', '--dirty'], capture_output=True)
    return result.stdout.strip().decode()

class Build(object):
    github_root = 'https://raw.githubusercontent.com/ppixiv/ppixiv/'
    environment_filename = 'build/environment.js'

    def build(self):
        # If the working copy isn't clean, this isn't a release.
        result = subprocess.run(['git', 'diff', '--quiet'])
        self.is_release = result.returncode == 0
        if self.is_release:
            self.git_tag = get_git_tag()

        self.build_resources()
        self.build_dist()
        self.create_debug_script()

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

        # Handle Cygwin and Windows paths.
        cwd = os.getcwd()
        if cwd.startswith('/cygdrive/'):
            parts = cwd.split('/')
            cwd = '%s:/%s' % (parts[2], '/'.join(parts[3:]))

        return 'file:///' + cwd

    def build_resources(self):
        """
        Compile files in resource/ and inline-resource/ into build/resource.js that we can include as
        a source file.

        These are base64-encoded and not easily read in the output file.  We should only use this for
        markup and images and not scripts, since we don't want to obfuscate code in the output.
        """
        output_file = 'build/resources.js'

        source_map_root = self.get_source_root_url()

        # Collect resources into an OrderedDict, so we always output data in the same order.
        # This prevents the output from changing.
        all_data = collections.OrderedDict()

        for fn in glob.glob('resources/*'):
            _, ext = os.path.splitext(fn)

            if ext in ('.css', '.scss'):
                data = sass.compile(filename=fn, source_comments=True, source_map_embed=True, source_map_root=source_map_root)
            else:
                data = open(fn).read()
                if fn == 'resources/main.html':
                    data = replace_placeholders(data)

            all_data[os.path.basename(fn)] = data

        # Output a JavaScript file containing the data.
        output = StringIO()
        output.write('this.resources = \n')
        output.write(json.dumps(all_data, indent=4))
        output.write(';\n')
        
        # Encode binary resources to data URLs.
        binary_data = collections.OrderedDict()
        mime_types = {
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
        }
        for fn in glob.glob('binary/*'):
            data = open(fn, 'rb').read()

            ext = os.path.splitext(fn)[1]
            mime_type = mime_types.get(ext, 'application/octet-stream')

            encoded_data = 'data:%s;base64,%s' % (mime_type, base64.b64encode(data).decode('ascii'))
            binary_data[os.path.basename(fn)] = encoded_data

        output.write('this.binary_data = \n')
        output.write(json.dumps(binary_data, indent=4))
        output.write(';\n')

        # I build this in Cygwin, which means all of the text files are CRLF, but Python
        # thinks it's on a LF system.  Manually convert newlines to CRLF, so the file we
        # output has matching newlines to the rest of the source, or else the final output
        # file will have mixed newlines.
        output.seek(0)
        data = output.getvalue().replace('\n', '\r\n')
        open(output_file, 'w+').write(data)

    def get_header(self, for_debug, files=[]):
        result = []
        with open('src/header.js', 'rt') as input_file:
            for line in input_file.readlines():
                line = line.strip()

                # Change the name of the testing script so it can be distinguished in the script dropdown.
                if line.startswith('// @name ') and for_debug:
                    line += ' (testing)'

                result.append(line)

        if for_debug:
            # Add the GM_getResourceText permission.  Only the debug build uses this.  It
            # isn't added to the base permissions since it might prompt people for permission.
            # (There's no reason at all for this to even be a special permission.)
            result.append('// @grant       GM_getResourceText')

            root = self.get_source_root_url()

            if files:
                result.append('//')

            result.append('// @require   %s/src/bootstrap.js' % root)

            for fn in files:
                include_line = '// @resource  %s   %s/%s' % (fn, root, fn)
                result.append(include_line)

        # Add @version.
        if for_debug:
            version = 'testing'
        else:
            version = get_git_tag()

            # Version tags look like "r100".  Remove the "r" from the @version.
            assert version.startswith('r')
            version = version[1:]

        result.append('// @version     %s' % version)

        result.append('// ==/UserScript==')

        return '\n'.join(result)

    def build_dist(self):
        """
        Build the final build/ppixiv.user.js script.

        # XXX: can we load the distributed script in a similar way, is it too messy to
        # include source in strings
        # - would mean loading is identical in production as testing, which is useful
        # - means we'd have correct filenames in logs
        # - could link to github pages in sourceURL
        """
        with open('build/ppixiv.user.js', 'w+t') as output_file:
            header = self.get_header(for_debug=False)
            output_file.write(header)

            # Encapsulate the script.
            output_file.write('(function() {\n')

            for fn in source_files:
                with open(fn, 'rt') as input_file:
                    data = input_file.read()
                    output_file.write(data)

            output_file.write('})();')

    def create_debug_script(self):
        cwd = os.getcwd()

        # I only run this in Cygwin.  This would need adjustment for native Python.
        # /cygdrive/c/...
        assert cwd.startswith('/cygdrive/')
        cwd = cwd[len('/cygdrive/'):]
        assert cwd[1] == '/'
        cwd = 'file:///' + cwd[0] + ':' + cwd[1:] + '/'

        # Include build/environment.js in @resources.  Don't include it in source_files.
        lines = []
        files = [self.environment_filename] + source_files

        header = self.get_header(for_debug=True, files=files)
        lines.append(header)

        # Output the environment file for bootstrap.js.
        environment = {
            'source_files': source_files,
            'source_root': self.get_source_root_url(),
        }

        with open(self.environment_filename, 'w+t') as f:
            f.write(json.dumps(environment, indent=4) + '\n')

        output = []
        for line in lines:
            line = line.strip()

            if line == '### permissions':
                # Add the GM_getResourceText permission.  We don't need this for the production
                # build, but the debug build uses it.
                output.append('// @grant       GM_getResourceText')

                output.append('// @require   %s/src/bootstrap.js' % cwd)

                for fn in files:
                    include_line = '// @resource  %s   %s' % (fn, cwd + fn)
                    output.append(include_line)

            output.append(line)

        output = '\r\n'.join(output)
        output_file = 'build/ppixiv-debug.user.js'
        open(output_file, 'w+').write(output)

def go():
    Build().build()

go()
