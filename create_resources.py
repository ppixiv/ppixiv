import base64, collections, glob, json, os, sys
from StringIO import StringIO

def go():
    # Collect resources into an OrderedDict, so we always output data in the same order.
    # This prevents the output from changing.
    all_data = collections.OrderedDict()
    for fn in glob.glob('resources/*'):
        data = open(fn).read()
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
    sys.stdout.write(data)

go()
