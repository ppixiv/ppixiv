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

import io, json, sys, zipfile, struct, os
from io import BytesIO
from .synchronous_queue_task import SynchronousQueueTask
from ..extern import mkvparse
from pprint import pprint

class ExportMJPEG(mkvparse.MatroskaHandler):      
    def __init__(self, frame_callback):
        self.width = None
        self.height = None
        self.track_id = None
        self.frame_callback = frame_callback

    def tracks_available(self):
        for track_id, track in self.tracks.items():
            if track['type'] != 'video':
                continue
            self.track_id = track_id

            codec = track.get('CodecID')
            if codec is not None:
                if codec[1] != 'V_MJPEG':
                    raise Exception('Not an MJPEG')

            video = track.get('Video')
            track_idx, track_info = video
            track_info = dict(track_info)

            width = track_info.get('DisplayWidth')
            if width is None:
                width = track_info.get('PixelWidth')
            if width is not None:
                self.width = width[1]

            height = track_info.get('DisplayHeight')
            if height is None:
                height = track_info.get('PixelHeight')
            if height is not None:
                self.height = height[1]

    def frame(self, track_id, timestamp, data, more_laced_frames, duration, keyframe, invisible, discardable):
        if track_id != self.track_id:
            return
        
        self.frame_callback(data, timestamp)

def get_frame_durations(file):
    """
    Return an array of each frame duration in the given file.  Durations are
    in milliseconds.
    """
    pos = file.tell()

    frame_durations = []
    last_frame_timestamp = None
    def collect_timestamps(frame, timestamp):
        timestamp = round(timestamp*1000)

        nonlocal last_frame_timestamp
        if last_frame_timestamp is not None:
            duration = timestamp - last_frame_timestamp
            frame_durations.append(duration)
        last_frame_timestamp = timestamp

    result = ExportMJPEG(frame_callback=collect_timestamps)
    mkvparse.mkvparse(file, result)

    # We don't have durations from the frame or a file duration.  ugoira_downloader_mjpeg
    # duplicates the last frame with a zero duration to give the last frame its
    # duration so seamless looping works.  Just match that here so everything round-trips
    # cleanly.
    frame_durations.append(0)

    # Return to the original file position.
    file.seek(pos)

    return frame_durations

# A dummy stream to receive data from zipfile and push it into a queue.
class _DataStream:
    def __init__(self, queue):
        self.queue = queue
        self.data = io.BytesIO()

    def write(self, data):
        self.data.write(data)
        return len(data)

    def fix_file_size(self, file_size):
        """
        Work around a Python bug.  If zipfile is given a non-seekable stream, it
        writes 0 as the file size in the local file header.  That's unavoidable
        if you're streaming data in, but it makes no sense when you give it the
        whole file at once, and results in creating ZIPs which are unstreamable.
        We require streamable ZIPs, so we have to fix the header.

        This is called after writing each file, so the local file header for the
        latest file is at the beginning of self.data.
        """
        with self.data.getbuffer() as buffer:
            struct.pack_into('<L', buffer, 22, file_size)

        # Flush the file, so the next file starts at the beginning of self.data
        # so we can find it for the next call.
        self.flush()

    def flush(self):
        self.queue.put(self.data.getvalue())
        self.data.seek(0)
        self.data.truncate()

def _create_ugoira_into_queue(file, queue, frame_durations):
    """
    Create the ZIP, pushing the ZIP data into the given SynchronousQueueTask.
    """

    # Create the ZIP.
    output_stream = _DataStream(queue)
    zip = zipfile.ZipFile(output_stream, 'w')

    try:
        # Add the metadata file.
        frame_delays = []
        for frame_no, duration in enumerate(frame_durations):
            frame_delays.append({
                'file': '%06i.jpg' % frame_no,
                'delay': duration,
            })

        metadata = json.dumps(frame_delays, indent=4).encode('utf-8')
        zip.writestr('metadata.json', metadata, compress_type=zipfile.ZIP_STORED)
        output_stream.fix_file_size(len(metadata))

        # Add each file.
        frame_no = 0
        def retrieve_frame(frame, timestamp):
            nonlocal frame_no
            zip.writestr('%06i.jpg' % frame_no, frame, compress_type=zipfile.ZIP_STORED)
            output_stream.fix_file_size(len(frame))
            frame_no += 1

        result = ExportMJPEG(frame_callback=retrieve_frame)
        mkvparse.mkvparse(file, result)
    finally:
        # Always close the zip even on exception, or zipfile will close it when it's
        # GC'd, which can make a mess during error handling.
        zip.close()
    
async def create_ugoira(file, frame_durations):
    # SynchronousQueueTask runs _create_ugoira_into_queue in a thread.
    queue = SynchronousQueueTask(maxsize=1)
    queue.run(_create_ugoira_into_queue, file, queue, frame_durations)

    try:
        while True:
            # Wait for data.
            data = await queue.get()
            if data is None:
                break

            # Yield this block for output.
            yield data
    finally:
        # Make sure the task is shut down.
        await queue.cancel()

async def test():
    output_stream = BytesIO()
    with open('testing.mkv', 'rb') as file:
        frame_durations = get_frame_durations(file)
        async for data in create_ugoira(file):
            print('...', len(data))

#    buf = output_stream.getbuffer()
#    with open('foo.zip', 'wb') as f:
#        f.write(buf)

if __name__ == '__main__':
    asyncio.run(test())
