import logging, sys
from ...extern import mkvparse

log = logging.getLogger(__name__)

class _ShortCircuitParsing(Exception): pass

class MatroskaHandler(mkvparse.MatroskaHandler):      
    def __init__(self):
        self.data = { }
        self.got_track_info = False
        self.got_segment_info = False

    def tracks_available(self):
        for track in self.tracks.values():
            if track['type'] != 'video':
                continue
            codec = track.get('CodecID')
            if codec is not None:
                self.data['codec'] = codec[1]

            video = track.get('Video')
            track_idx, track_info = video
            track_info = dict(track_info)

            width = track_info.get('DisplayWidth')
            if width is None:
                width = track_info.get('PixelWidth')
            if width is not None:
                self.data['width'] = width[1]

            height = track_info.get('DisplayHeight')
            if height is None:
                height = track_info.get('PixelHeight')
            if height is not None:
                self.data['height'] = height[1]

            self.got_track_info = True
            self.check_termination()

    def segment_info_available(self):
        segments = dict(self.segment_info)
        duration = segments.get('Duration')
        if duration is not None:
            self.data['duration'] = duration[1] / 1000

        title = segments.get('Title')
        if title is not None:
            self.data['title'] = title[1]

        self.got_segment_info = True
        self.check_termination()

    def check_termination(self):
        """
        mkvparse spends a long time parsing every frame of the video, but we only
        care about some global metadata.  Throw _ShortCircuitParsing to escape from
        parsing once we have what we need.
        """
        if self.got_track_info and self.got_segment_info:
            raise _ShortCircuitParsing()

def parse(f):
    try:
        result = MatroskaHandler()
        try:
            mkvparse.mkvparse(f, result)
        except _ShortCircuitParsing:
            pass

        return result.data
    except Exception as e:
        log.exception('Error reading MKV metadata from %s' % f)
        return { }

if __name__ == '__main__':
    with open('testing.mkv', 'rb') as f:
        result = parse(f)
        print(result)
