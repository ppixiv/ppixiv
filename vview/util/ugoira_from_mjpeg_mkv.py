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

import asyncio, errno, io, json, sys, zipfile, struct, os
from io import BytesIO
from ..extern import mkvparse
from .misc import FixedZipPipe, WriteZip
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

def _create_ugoira(file, output_file, frame_durations):
    # Be sure that we always close output_file, or the request will deadlock.
    try:
        with output_file:
            zip = zipfile.ZipFile(output_file, 'w')
            with WriteZip(zip) as zip:
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

                # Add each file.
                frame_no = 0
                def retrieve_frame(frame, timestamp):
                    nonlocal frame_no
                    output_file.about_to_write_file(len(frame))
                    zip.writestr('%06i.jpg' % frame_no, frame, compress_type=zipfile.ZIP_STORED)
                    frame_no += 1

                result = ExportMJPEG(frame_callback=retrieve_frame)
                mkvparse.mkvparse(file, result)

                # Flush each frame, so they don't sit in the buffer.
                output_file.flush()

    except OSError as e:
        # We'll get EPIPE if the other side of the pipe is closed because the connection
        # was closed.  Don't raise these as errors.
        if e.errno in (errno.EPIPE, errno.EINVAL):
            pass
        else:
            raise

async def create_ugoira(file, frame_durations):
    readfd, writefd = os.pipe()
    read = os.fdopen(readfd, 'rb', buffering=0)
    write = os.fdopen(writefd, 'wb', buffering=1024*256)

    write = FixedZipPipe(write)

    promise = asyncio.to_thread(_create_ugoira, file, write, frame_durations)
    promise = asyncio.create_task(promise, name='MKV-to-ZIP')
    return read, promise
