#!/usr/bin/bash -e
# This is only used for convenience during development.  To install normally, just load:
# https://s3.amazonaws.com/ppixiv/ppixiv.user.js
#
# Put the directory containing the user script in this file.  This only works with GM,
# with TamperMonkey you have to manually copy the file in every time.
OUTDIR=`cat userdir`

# If we're in Cygwin, resolve any Windows paths.
if which cygpath 1>/dev/null 2>&2; then
    OUTDIR=`cygpath $OUTDIR`
fi

# Find the path to the user script.
OUTPATH=`ls $OUTDIR/*.user.js`
echo $OUTPATH
cp "$1" "$OUTPATH"

