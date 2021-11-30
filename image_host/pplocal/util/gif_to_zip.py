# This converts an MJPEG MKV to a ZIP of JPEGs and duration data, which is
# the format that Pixiv animations use.
#
# We save those animations to this format when exporting them, and this is used
# to allow playing the resulting file in browsers, since browsers don't support
# MJPEG.
#
# Pixiv has a separate API call to retrieve the duration metadata.  We only
# have the duration list after we finish doing this.  To avoid needing to cache
# this data from it being split into two calls, we stash the metadata in a file
# in the ZIP instead.

import asyncio, json, sys, zipfile, os
from PIL import Image
from io import BytesIO
from .misc import FixedZipPipe
from pprint import pprint

class NotAnimatedError(ValueError): pass

def get_frame_durations(file):
    """
    Return an array of each frame duration in the given file.  Durations are
    in milliseconds.

    If the file isn't an animated GIF, raise an exception.
    """
    pos = file.tell()

    img = Image.open(file)
    if img.n_frames <= 1:
        raise NotAnimatedError()

    frame_durations = []
    for frame_no in range(img.n_frames):
        img.seek(frame_no)
        duration = img.info['duration']
        frame_durations.append(duration)

    # Return to the original file position.
    file.seek(pos)

    return frame_durations

def _create_ugoira(file, output_file, frame_durations):
    # Be sure that we always close output_file, or the request will deadlock.
    with output_file:
        img = Image.open(file)

        # Create the ZIP.
        zip = zipfile.ZipFile(output_file, 'w')
        with zip:
            # Add the metadata file.
            frame_delays = []
            for frame_no, duration in enumerate(frame_durations):
                # Match browser behavior for frames that have delays that are too low.
                if duration < 20:
                    duration = 100

                frame_delays.append({
                    'file': '%06i.jpg' % frame_no,
                    'delay': duration,
                })

            metadata = json.dumps(frame_delays, indent=4).encode('utf-8')
            output_file.about_to_write_file(len(metadata))
            zip.writestr('metadata.json', metadata, compress_type=zipfile.ZIP_STORED)
            img = Image.open(file)

            # If there's a transparency index, use PNG so we can preserve transparency.
            transparent = img.info.get('transparency', -1) != -1

            # Add each file.
            for frame_no in range(img.n_frames):
                img.seek(frame_no)
                frame = img

                buffer = BytesIO()
                if transparent:
                    frame.save(buffer, 'PNG')
                else:
                    frame = frame.convert('RGB')
                    frame.save(buffer, 'JPEG')
                frame = buffer.getvalue()

                output_file.about_to_write_file(len(frame))
                zip.writestr('%06i.jpg' % frame_no, frame, compress_type=zipfile.ZIP_STORED)

def create_ugoira(file, frame_durations):
    readfd, writefd = os.pipe()
    read = os.fdopen(readfd, 'rb', buffering=0)
    write = os.fdopen(writefd, 'wb', buffering=1024*256)

    write = FixedZipPipe(write)

    promise = asyncio.to_thread(_create_ugoira, file, write, frame_durations)
    promise = asyncio.create_task(promise)
    return read, promise
