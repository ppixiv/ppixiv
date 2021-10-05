import base64, collections, glob, json, os, re, sys, subprocess, random
import sass
from pprint import pprint
from io import StringIO

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

def get_release_version():
    """
    Find "@version 1234" in src/header.js.
    """
    for line in open('src/header.js').readlines():
        m = re.match(r'// @version\s*(\d+)', line)
        if not m:
            continue

        return m.group(1)

    raise Exception('Couldn\'t find @version in src/header.js')

def is_git_dirty():
    """
    Return true if the working copy is dirty.
    """
    result = subprocess.run(['git', 'diff', '--quiet'])
    return result.returncode != 0

def get_git_tag():
    """
    Return the current git tag.
    """
    result = subprocess.run(['git', 'describe', '--tags', '--dirty'], capture_output=True)
    return result.stdout.strip().decode()

def get_release_version():
    """
    Figure out if the working copy is a release version.  If it is, return its release tag, eg. "r100".
    Otherwise, return None.
    """
    # The working copy is always clean for releases.
    if is_git_dirty():
        return None

    # The version in src/header.js (prefixed with 'r', eg. r100) will match the release tag for releases.
    release_version = 'r' + get_release_version()
    git_tag = get_git_tag()

    if release_version == git_Tag:
        return release_version

    return None

def go():
    # Check if this is a release build.
    release_version = get_release_version()

    output_file = sys.argv[1]

    # When we're building for development, the source map root is the local directory containing source
    # files.
    #
    # For releases, use the raw GitHub URL where the file will be on GitHub once the current tag is pushed.
    if release_version is None:
        # Handle Cygwin and Windows paths.
        cwd = os.getcwd()
        if cwd.startswith('/cygdrive/'):
            parts = cwd.split('/')
            cwd = '%s:/%s' % (parts[2], '/'.join(parts[3:]))

        source_map_root = 'file:///' + cwd
    else:
        source_map_root = 'https://raw.githubusercontent.com/ppixiv/ppixiv/' + release_version

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

go()
