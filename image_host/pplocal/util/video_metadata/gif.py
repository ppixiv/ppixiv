# Extract simple metadata from GIFs.
#
# If all you want to know is the duration of each frame, PIL is painfully slow.  it
# seems to decompress the entire file.  So, do it ourselves.

import struct, os
from pprint import pprint

def _read_unpack(f, fmt):
    size = struct.calcsize(fmt)
    data = f.read(size)
    if len(data) < size:
        raise IOError('Unexpected end of file')

    return struct.unpack(fmt, data)

class parse_gif_metadata:
    def __init__(self, f):
        self.frame_durations = []

        width, height = self.parse_header(f)
        self.parse_blocks(f)

        self.data = {
            'width': width,
            'height': height,
            'duration': sum(self.frame_durations) / 1000,
            'frame_durations': self.frame_durations,
        }

    def parse_header(self, f):
        signature = b''.join(_read_unpack(f, 'ccc'))
        if signature != b'GIF':
            raise OSError('Unrecognized file')

        version = _read_unpack(f, 'ccc')
        width, height = _read_unpack(f, '<HH')

        flags, = _read_unpack(f, 'B')
        has_global_color_table =  flags & 0b10000000
        color_resolution       = (flags & 0b01110000) >> 4
        sorted                 = (flags & 0b00001000) >> 3
        color_table_size       = (flags & 0b00000111)

        background_color, pixel_aspect_ratio = _read_unpack(f, '<bb')
        if has_global_color_table:
            color_table_bytes = 1 << (color_table_size + 1)
            f.seek(color_table_bytes * 3, os.SEEK_CUR)

        return width, height

    def parse_blocks(self, f):
        while True:
            block_type, = _read_unpack(f, '<c')
            match block_type:
                case b'!':
                    self.parse_extension_block(f)
                case b',':
                    self.skip_image(f)
                case b';':
                    return
                case _:
                    raise OSError('Unknown block type: %02x' % ord(block_type))

    def parse_extension_block(self, f):
        extension_block_type, = _read_unpack(f, 'B')
        match extension_block_type:
            case 0xF9:
                # Graphics Control Extension
                size, = _read_unpack(f, 'B')
                if size < 4:
                    raise OSError('GIF parse error')

                data = f.read(size)

                flags, duration, transparency_index = struct.unpack('BBB', data[0:3])
                self.frame_durations.append(duration)

                # reserved              = flags & 0b11100000
                # disposal_method       = flags & 0b00011100
                # user_input            = flags & 0b00000010
                # has_transparent_color = flags & 0b00000001

                f.read(1) # end of block

                # Match browser behavior for frames that have delays that are too low.
                # This also matches the check in gif_to_zip.
                if duration < 20:
                    duration = 100

            case 0x01:
                header_size, = _read_unpack(f, 'B')
                f.seek(header_size, os.SEEK_CUR)
                self.skip_sub_blocks(f)

            case 0xFF:
                header_size, = _read_unpack(f, 'B')
                f.seek(header_size, os.SEEK_CUR)
                self.skip_sub_blocks(f)

            case _:
                self.skip_sub_blocks(f)

    def skip_sub_blocks(self, f):
        while True:
            size, = _read_unpack(f, 'B')
            if size == 0:
                break

            f.seek(size, os.SEEK_CUR)

    def skip_image(self, f):
        left, top, width, height, flags, codesize = _read_unpack(f, '<HHHHBB')

        has_local_color_table   = flags & 0b10000000
        # interlaced            = flags & 0b01000000
        # sorted                = flags & 0b00100000
        # reserved              = flags & 0b00011000
        local_color_table_size  = flags & 0b00000111

        # Skip the local color table, if any.
        if has_local_color_table:
            color_table_bytes = 1 << (local_color_table_size + 1)
            f.seek(color_table_bytes * 3, os.SEEK_CUR)

        self.skip_sub_blocks(f)

def parse(f):
    try:
        result = parse_gif_metadata(f)
        return result.data
    except Exception as e:
        print('Error reading GIF metadata from %s: %s' % (f, e))
        return { }

def test():
    with open('test.gif', 'rb') as f:
        result = parse_gif_metadata(f)
        pprint(result.data)

if __name__ == '__main__':
    test()
