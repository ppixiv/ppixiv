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

import asyncio, errno, json, sys, zipfile, os
from PIL import Image
from io import BytesIO
from .misc import FixedZipPipe, WriteZip
from .video_metadata import gif
from pprint import pprint

class NotAnimatedError(ValueError): pass

def get_frame_durations(file):
    """
    Return an array of each frame duration in the given file.  Durations are
    in milliseconds.

    If the file isn't an animated GIF, raise an exception.
    """
    pos = file.tell()
    data = gif.parse_gif_metadata(file).data
    file.seek(pos)

    frame_durations = data['frame_durations']
    if len(frame_durations) <= 1:
        raise NotAnimatedError()
    return frame_durations

def _create_ugoira(file, output_file, frame_durations):
    # For some reason, PIL's GIF implementation seeks the file, which is catastrophically
    # slow when it's inside a compressed file.  Work around this by reading the file into
    # memory.
    file = BytesIO(file.read())

    try:
        # Be sure that we always close output_file, or the request will deadlock.
        with output_file:
            img = Image.open(file)

            # Create the ZIP.
            zip = zipfile.ZipFile(output_file, 'w')
            with WriteZip(zip):
                # Add the metadata file.
                frame_delays = []
                for frame_no, duration in enumerate(frame_durations):
                    frame_delays.append({
                        'file': '%06i.jpg' % frame_no,
                        'delay': duration,
                    })

                metadata = json.dumps(frame_delays, indent=4).encode('utf-8')
                output_file.about_to_write_file(len(metadata))
                zip.writestr('metadata.json', metadata, compress_type=zipfile.ZIP_STORED)
                img = Image.open(file)

                # Add each file.  Don't read img.img.n_frames, since it's slow and makes us
                # take longer to start playing.
                for frame_no in range(len(frame_durations)):
                    img.seek(frame_no)
                    frame = img
                    frame.load()

                    # If this frame has transparency, use PNG.  Otherwise, use JPEG.  JPEG compresses
                    # much faster than PNG and this helps make sure we can keep up with the video.
                    # This is done on a frame-by-frame basis because there's no way to know in advance
                    # whether a GIF uses transparency except checking each frame for the transparency
                    # index, and this avoids having to make an extra slow pass over the image first.
                    frame_is_transparent = False
                    if img.mode == 'P':
                        # See if this frame is transparent.
                        transparency_index = img.info.get('transparency', -1)
                        if transparency_index != -1:
                            used_colors = { color[1] for color in img.getcolors() }
                            frame_is_transparent = transparency_index in used_colors

                    buffer = BytesIO()
                    if frame_is_transparent:
                        frame.save(buffer, 'PNG')
                        ext = 'png'
                    else:
                        frame = frame.convert('RGB')
                        frame.save(buffer, 'JPEG')
                        ext = 'jpg'
                    frame = buffer.getvalue()

                    output_file.about_to_write_file(len(frame))
                    zip.writestr('%06i.%s' % (frame_no, ext), frame, compress_type=zipfile.ZIP_STORED)

                    # Flush each frame, so they don't sit in the buffer.
                    output_file.flush()

    except OSError as e:
        # We'll get EPIPE if the other side of the pipe is closed because the connection
        # was closed.  Don't raise these as errors.
        if e.errno in (errno.EPIPE, errno.EINVAL):
            pass
        else:
            raise

def create_ugoira(file, frame_durations):
    readfd, writefd = os.pipe()
    read = os.fdopen(readfd, 'rb', buffering=0)
    write = os.fdopen(writefd, 'wb', buffering=1024*256)

    write = FixedZipPipe(write)

    promise = asyncio.to_thread(_create_ugoira, file, write, frame_durations)
    promise = asyncio.create_task(promise, name='GIF-to-ZIP')
    return read, promise
