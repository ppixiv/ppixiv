#!/usr/bin/env python
import sys
from ...extern import mkvparse

import sys
import binascii
import datetime

# This is thrown from 
class _ShortCircuitParsing(Exception): pass

class MatroskaUser(mkvparse.MatroskaHandler):      
    def __init__(self):
        self.data = { }
        self.got_track_info = False
        self.got_segment_info = False

    def tracks_available(self):
        for track in self.tracks.values():
            if track['type'] != 'video':
                continue

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
            from pprint import pprint

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

    def frame(self, track_id, timestamp, data, more_laced_frames, duration, keyframe, invisible, discardable):
        addstr=""
        if duration:
            addstr="dur=%.6f"%duration
        if keyframe: addstr+=" key"
        if invisible: addstr+=" invis"
        if discardable: addstr+=" disc"
        print("Frame for %d ts=%.06f l=%d %s len=%d data=%s..." %
                (track_id, timestamp, more_laced_frames, addstr, len(data), binascii.hexlify(data[0:10])))

def parse(f):
    try:
        result = MatroskaUser()
        try:
            mkvparse.mkvparse(f, result)
        except _ShortCircuitParsing:
            pass

        return result.data
    except Exception as e:
        print('Error reading MKV metadata from %s: %s' % (f, e))
        return { }

if __name__ == '__main__':
    result = MatroskaUser()
    with open('testing.mkv', 'rb') as f:
        result = parse(f)
        print(result)
