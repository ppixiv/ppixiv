import base64, collections, glob, json, os, re, sys
from StringIO import StringIO

def do_replacement(line):
    m = re.match(r'^(\s*)<!-- *#inline:([^ ]+) *-->\s*$', line)
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

def go():
    output_file = sys.argv[1]

    # Collect resources into an OrderedDict, so we always output data in the same order.
    # This prevents the output from changing.
    all_data = collections.OrderedDict()
    for fn in glob.glob('resources/*'):
        data = open(fn).read()
        if fn == 'resources/main.html':
            data = replace_placeholders(data)

        all_data[os.path.basename(fn)] = data

    # Output a JavaScript file containing the data.
    output = StringIO()
    output.write('var resources = \n')
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

        encoded_data = 'data:%s;base64,%s' % (mime_type, base64.b64encode(data))
        binary_data[os.path.basename(fn)] = encoded_data

    output.write('var binary_data = \n')
    output.write(json.dumps(binary_data, indent=4))
    output.write(';\n')

    # I build this in Cygwin, which means all of the text files are CRLF, but Python
    # thinks it's on a LF system.  Manually convert newlines to CRLF, so the file we
    # output has matching newlines to the rest of the source, or else the final output
    # file will have mixed newlines.
    output.seek(0)
    data = output.buf.replace('\n', '\r\n')
    open(output_file, 'w+').write(data)

go()
