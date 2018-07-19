import base64, collections, glob, json, os, sys

def go():
    # Collect resources into an OrderedDict, so we always output data in the same order.
    # This prevents the output from changing.
    all_data = collections.OrderedDict()
    for fn in glob.glob('resources/*'):
        data = open(fn).read()
        all_data[os.path.basename(fn)] = data

    # Output a JavaScript file containing the data.
    sys.stdout.write('var resources = \n')
    sys.stdout.write(json.dumps(all_data, indent=4))
    sys.stdout.write(';\n')
    
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

    sys.stdout.write('var binary_data = \n')
    sys.stdout.write(json.dumps(binary_data, indent=4))
    sys.stdout.write(';\n')

go()
