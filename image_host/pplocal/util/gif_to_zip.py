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

import asyncio, json, sys, zipfile, os, queue
from PIL import Image
from io import BytesIO
from .misc import DataStream
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

async def create_ugoira(file, frame_durations):
    """
    Create the ZIP, pushing the ZIP data into the given SynchronousQueueTask.
    """
    output_queue = queue.Queue()

    img = Image.open(file)

    # Create the ZIP.
    output_stream = DataStream(output_queue)
    zip = zipfile.ZipFile(output_stream, 'w')

    try:
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
        zip.writestr('metadata.json', metadata, compress_type=zipfile.ZIP_STORED)
        output_stream.fix_file_size(len(metadata))
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

            zip.writestr('%06i.jpg' % frame_no, frame, compress_type=zipfile.ZIP_STORED)
            output_stream.fix_file_size(len(frame))

            # Flush the frame that was just written to the ZIP.
            while not output_queue.empty():
                data = output_queue.get()
                yield data

        zip.close()

    finally:
        # Always close the zip even on exception, or zipfile will close it when it's
        # GC'd, which can make a mess during error handling.
        zip.close()

    # Flush the end of the file.
    while not output_queue.empty():
        data = output_queue.get()
        yield data

async def test():
    output_stream = BytesIO()
    with open('testing.gif', 'rb') as file:
        frame_durations = get_frame_durations(file)
        async for data in create_ugoira(file, frame_durations):
            print('...', len(data))

#    buf = output_stream.getbuffer()
#    with open('foo.zip', 'wb') as f:
#        f.write(buf)

if __name__ == '__main__':
    asyncio.run(test())
