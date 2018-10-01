#!/usr/bin/python
import os, subprocess, sys

# This builds a user script that imports each filename directly from the build
# tree.  This can be used during development: you can edit files and refresh a
# page without having to build the script or install it.

def go():
    cwd = os.getcwd()

    # I only run this in Cygwin.  This would need adjustment for native Python.
    # /cygdrive/c/...
    assert cwd.startswith('/cygdrive/')
    cwd = cwd[len('/cygdrive/'):]
    assert cwd[1] == '/'
    cwd = 'file:///' + cwd[0] + ':' + cwd[1:] + '/'

    lines = open('src/header.js').readlines()

    def add_requires():
        # Get the list of files in the order the build script appends them.
        all_files = subprocess.check_output(['make', '--no-print-directory', 'get_all_files'])
        files = [f.strip() for f in all_files.split(' ')]

        # Don't add the header, since we add it to this script below.
        assert files[0] == 'src/header.js'
        files = files[1:]

        # Don't add the footer.  It just ends the (function() {})() encapsulation,
        # which we remove.
        assert files[-1] == 'src/footer.js'
        files = files[:-1]

        for fn in files:
            line = '// @require   ' + cwd + fn
            output.append(line)

    output = []
    for line in lines:
        line = line.strip()

        if line.startswith('// @name '):
            output.append('// @name ppixiv-debug')
            continue

        if line == '// ==/UserScript==':
            add_requires()

        # Remove the encapsulation.
        if line == '(function() {':
            continue

        output.append(line)

    output = '\r\n'.join(output)
    output_file = sys.argv[1]
    open(output_file, 'w+').write(output)

go()
