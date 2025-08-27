# PIL is really slow at opening large WebP files when you only need metadata.

import io, os, struct, time
from pprint import pprint

from vview.util.tiff import get_xmp_metadata

# WebP notes:
# - RIFF container: "RIFF" <size> "WEBP"
# - Primary chunks: "VP8 " (lossy), "VP8L" (lossless), "VP8X" (extended features)
# - Animation signaled by VP8X feature bit 1<<1 or presence of "ANIM" chunk
# - Canvas size:
#       VP8X payload: [1 byte features][3 reserved][3B w-1][3B h-1] (little-endian 24-bit)
#       VP8  lossy:   parse first key frame header (0x9d 0x01 0x2a, then 2 LE for w, 2 LE for h; lower 14 bits each)
#       VP8L lossless: 5-byte signature 0x2f (?), width/height packed in 4 bytes (14 bits each) per spec
# - XMP metadata: "XMP " chunk (note trailing space), UTF-8 XML packet.

def _read_exact(f, n):
    b = f.read(n)
    if len(b) != n:
        raise EOFError('Unexpected EOF')
    return b

def _read_chunk_header(f):
    hdr = f.read(8)
    if len(hdr) < 8:
        return None, None
    fourcc, size = struct.unpack('<4sI', hdr)
    return fourcc, size

def _skip_pad(f, size):
    # Chunks are padded to even sizes
    if size % 2 == 1:
        f.seek(1, io.SEEK_CUR)

def _parse_vp8x(payload):
    # payload: 1 byte features, 3 reserved, then 3B w-1, 3B h-1
    if len(payload) < 10:
        return None
    features = payload[0]
    width_minus_1 = payload[4] | (payload[5] << 8) | (payload[6] << 16)
    height_minus_1 = payload[7] | (payload[8] << 8) | (payload[9] << 16)
    width = width_minus_1 + 1
    height = height_minus_1 + 1
    animation = bool(features & (1 << 1))
    return width, height, animation

def _parse_vp8_lossy_dim(payload):
    # Look for the keyframe start code 0x9d 0x01 0x2a at offset 3
    # Frame tag is 3 bytes; then the 3-byte start code, then 2 LE width, 2 LE height
    if len(payload) < 10:
        return None
    if payload[3:6] != b'\x9d\x01\x2a':
        return None
    w_raw = struct.unpack('<H', payload[6:8])[0]
    h_raw = struct.unpack('<H', payload[8:10])[0]
    width = w_raw & 0x3FFF   # 14 bits
    height = h_raw & 0x3FFF
    if width == 0 or height == 0:
        return None
    return width, height

def _parse_vp8l_lossless_dim(payload):
    # VP8L starts with 1 signature byte 0x2f, then 4 bytes with packed dims.
    # Layout (little endian 32-bit):
    # bits 0..13: width-1 (14 bits)
    # bit 14: unused
    # bits 15..28: height-1 (14 bits)
    # bit 29: unused
    # bits 30..31: version (should be 0)
    if len(payload) < 5:
        return None
    if payload[0] != 0x2f:
        return None
    packed = struct.unpack('<I', payload[1:5])[0]
    width = (packed & 0x3FFF) + 1
    height = ((packed >> 15) & 0x3FFF) + 1
    if width == 0 or height == 0:
        return None
    return width, height

def get_webp_metadata(f):
    """
    Return dict: {'width': int, 'height': int, 'animation': bool, 'comment': str}
    """
    # RIFF header
    riff = _read_exact(f, 12)
    if riff[:4] != b'RIFF' or riff[8:12] != b'WEBP':
        raise ValueError('Not a WebP (RIFF/WEBP) file')

    width = height = None
    animation = False
    comment = ''
    xmp = None

    # Walk chunks
    while True:
        fourcc, size = _read_chunk_header(f)
        if not fourcc:
            break
        data_start = f.tell()

        if fourcc == b'VP8X':
            payload = _read_exact(f, size)
            got = _parse_vp8x(payload)
            if got:
                w, h, anim_flag = got
                width = width or w
                height = height or h
                animation = animation or anim_flag

        elif fourcc == b'VP8 ':
            # Only read a small prefix—dimensions are near the start
            # Don’t pull the whole frame
            prefix = _read_exact(f, min(size, 64))
            dims = _parse_vp8_lossy_dim(prefix)
            if dims:
                w, h = dims
                width = width or w
                height = height or h
            # skip remainder if any
            if size > len(prefix):
                f.seek(size - len(prefix), io.SEEK_CUR)

        elif fourcc == b'VP8L':
            prefix = _read_exact(f, min(size, 64))
            dims = _parse_vp8l_lossless_dim(prefix)
            if dims:
                w, h = dims
                width = width or w
                height = height or h
            if size > len(prefix):
                f.seek(size - len(prefix), io.SEEK_CUR)

        elif fourcc == b'ANIM':
            animation = True
            f.seek(size, io.SEEK_CUR)

        elif fourcc == b'XMP ':
            # Grab XMP and try to pull a human-readable comment/description
            xmp = _read_exact(f, size)

        else:
            # Unused chunk for our purposes; skip
            f.seek(size, io.SEEK_CUR)

        _skip_pad(f, size)

        # Early exit if we already have everything
        if width is not None and height is not None and (comment or True) and animation in (True, False):
            # We still continue a bit if comment empty, but you can uncomment to bail early:
            # break
            pass

        # Safety: avoid infinite loop in corrupt files
        if f.tell() < data_start:  # shouldn’t happen
            break

    result = {
        'width': width,
        'height': height,
        'animation': animation,
        'comment': comment or ''
    }

    if xmp and not comment:
        get_xmp_metadata(xmp, result)

    return result
