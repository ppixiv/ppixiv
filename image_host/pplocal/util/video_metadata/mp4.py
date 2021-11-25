# Extract simple metadata from MP4s.

import struct, os
from pprint import pprint

def _read_unpack(f, fmt):
    size = struct.calcsize(fmt)
    data = f.read(size)
    if len(data) < size:
        raise IOError('Unexpected end of file')

    return struct.unpack(fmt, data)

def _read_fixed(f):
    integer, fraction = _read_unpack(f, '>HH')
    return integer + fraction/0x10000

def _read_tag(f):
    return b''.join(_read_unpack(f, '4c'))

def _read_size(f, block_end):
    data = f.read(4)
    if len(data) < 4:
        return None

    size, = struct.unpack('>L', data)
    if size == 1:
        # 64-bit size:
        data = f.read(8)
        if len(data) < 8:
            return None

        size, = struct.unpack('>Q', data)
        size -= 8

        return size
    elif size == 0:
        return block_end - f.tell()
    else:
        return size

class parse_mp4_metadata:
    def __init__(self, f):
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(0, os.SEEK_SET)

        self.data = self.read_blocks(f, block_end=size)

    def udta_meta(self, f, this_block_end, path):
        # Find "hdlr" in the udta block.
        while f.tell() < this_block_end:
            tag = b''.join(_read_unpack(f, '4c'))
            if tag == b'hdlr':
                tag_path = path + b'/' + tag
                f.seek(-8, os.SEEK_CUR)
                return self.read_blocks(f, this_block_end, path)
        return { }

    def read_ilst(self, f, block_end):
        # Pull out metadata from ilst tags.
        ilst_size, = _read_unpack(f, '>L')
        ilst_tag = _read_tag(f)
        ilst_size -= 4
        if ilst_tag == b'data':
            ilst_type, _ = _read_unpack(f, '>LL')
            # THe rest of the tag is the data.
            remaining = block_end - f.tell()
            data = f.read(remaining)
            return data.decode('utf-8', errors='replace')

        return None

    def read_blocks(self, f, block_end, path=b''):
        result = { }
        for tag_path, this_block_end in self.iterate_blocks(f, block_end, path):
            if tag_path == b'/moov':
                # Just recurse into moov.
                result.update(self.read_blocks(f, this_block_end, tag_path))
            elif tag_path == b'/moov/trak':
                # Parse tracks.
                data = self.read_blocks(f, this_block_end, tag_path)

                # Only merge this if it's a video track.
                if data.get('video'):
                    result.update(data)
            elif tag_path == b'/moov/trak/mdia':
                # Read MDIA to figure out if this is a video track.
                result.update(self.read_blocks(f, this_block_end, tag_path))
            elif tag_path == b'/moov/trak/tkhd':
                result.update(self.tkhd(f))
            elif tag_path == b'/moov/trak/mdia/hdlr':
                # This tells us if this is a video track.  We can return once we see this, since
                # there's nothing else in mdia that we care about.
                result.update(self.hdlr(f))
            elif tag_path == b'/moov/udta':
                result.update(self.read_blocks(f, this_block_end, tag_path))
            elif tag_path == b'/moov/udta/meta':
                result.update(self.udta_meta(f, this_block_end, tag_path))
            elif tag_path == b'/moov/udta/meta/ilst':
                result.update(self.read_blocks(f, this_block_end, tag_path))
            elif tag_path.startswith(b'/moov/udta/meta/ilst/'):
                ilst_tag_path = 'tag/' + tag_path[-3:].decode('ascii', errors='replace')
                ilst_data = self.read_ilst(f, this_block_end)
                if ilst_data:
                    result[ilst_tag_path] = ilst_data

        return result

    def iterate_blocks(self, f, block_end, path=b''):
        block_start = f.tell()
        while f.tell() < block_end:
            this_block_start = f.tell()
            size = _read_size(f, block_end)
            if size is None:
                # Reached EOF.
                return

            this_block_end = this_block_start + size
            if this_block_end > block_end:
                # Block crosses EOF.
                return

            tag = _read_tag(f)
            tag_path = path + b'/' + tag

            # print('%08x' % f.tell(), tag_path, size)

            yield tag_path, this_block_end

            f.seek(this_block_end)

    # All we care about from hdlr is whether this is a video track.
    def hdlr(self, f):
        version, = _read_unpack(f, 'b')
        flags = _read_unpack(f, '3b')
        f.read(4) # padding
        handler_type = b''.join(_read_unpack(f, '4c'))
        return { 'video': handler_type == b'vide' }

    def tkhd(self, f):
        version, = _read_unpack(f, 'b')
        flags = _read_unpack(f, '3b')
        if version == 0:
            ctime, mtime, track_id, _, duration_ms = _read_unpack(f, '>IIIII')
        else:
            ctime, mtime, track_id, _, duration_ms = _read_unpack(f, '>QQIIQ')

        f.seek(8, os.SEEK_CUR)
        f.seek(8, os.SEEK_CUR)
        f.seek(9*4, os.SEEK_CUR) # matrix

        width = _read_fixed(f)
        height = _read_fixed(f)

        return {
            'duration': duration_ms / 1000,
            'width': int(width),
            'height': int(height),
        }

def parse(f):
    try:
        result = parse_mp4_metadata(f)
        return result.data
    except Exception as e:
        print('Error reading MP4 metadata from %s: %s' % (f, e))
        return { }

def test():
    with open('test.mp4', 'rb') as f:
        result = parse_mp4_metadata(f)
        pprint(result.data)

if __name__ == '__main__':
    test()
