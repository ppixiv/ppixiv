# Convert animated WebPs to ugoira ZIP format, so we can provide a full
# video UI for them.

import asyncio, errno, json, os, threading, zipfile
from typing import BinaryIO
from io import BytesIO
from .misc import FixedZipPipe, WriteZip
from pprint import pprint
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageSequence

from .misc import FixedZipPipe, WriteZip

def _read_exact(f: BinaryIO, n: int) -> bytes:
    b = f.read(n)
    if len(b) != n:
        raise EOFError('Unexpected end of file')
    return b

def _u32le(b: bytes) -> int:
    return int.from_bytes(b, 'little', signed=False)

def _u24le(b: bytes) -> int:
    # 3-byte little-endian
    return b[0] | (b[1] << 8) | (b[2] << 16)

def _read_fourcc(f: BinaryIO) -> str:
    return _read_exact(f, 4).decode('ascii', errors='strict')

def get_frame_durations(file):
    """
    Extract per-frame durations (ms) from an animated WebP.

    PIL won't give us this info unless we actually decode frame data.  We need
    it in advance, so we have to do this ourselves.
    """
    pos = file.tell()

    try:
        # ---- RIFF/WEBP header ----
        if _read_fourcc(file) != 'RIFF':
            raise ValueError('Not a RIFF file')

        file_size = _u32le(_read_exact(file, 4))  # total size from offset 8
        if _read_fourcc(file) != 'WEBP':
            raise ValueError('Not a WEBP RIFF form')

        durations = []

        # Stream chunks until EOF or we've consumed file_size bytes.
        # We start at absolute offset 12; end at 8 + file_size.
        end_pos = 8 + file_size  # spec's definition of 'File Size' range. :contentReference[oaicite:2]{index=2}

        while file.tell() < end_pos:
            # Read next chunk header: FourCC + Size
            try:
                fourcc = _read_fourcc(file)
            except EOFError:
                break
            size = _u32le(_read_exact(file, 4))

            if fourcc == 'ANMF':
                # ANMF payload starts with:
                #  3 bytes: Frame X
                #  3 bytes: Frame Y
                #  3 bytes: Frame Width Minus One
                #  3 bytes: Frame Height Minus One
                #  3 bytes: Frame Duration (ms)
                #  1 byte : flags (6 reserved bits, B, D)
                # Then: Frame Data (nested chunks), size = chunk_size - 16. :contentReference[oaicite:3]{index=3}
                header = _read_exact(file, 16)
                duration = _u24le(header[12:15])
                durations.append(duration)

                # Skip the rest of the ANMF payload (frame data + any unknown chunks)
                remaining = size - 16
                if remaining > 0:
                    file.seek(remaining, 1)
            else:
                # Not ANMF: just skip payload
                file.seek(size, 1)

            # Skip RIFF padding byte if size is odd
            if size & 1:
                file.seek(1, 1)

        return durations
    finally:
        file.seek(pos)

def _compress_image(rgb_image):
    out = BytesIO()
    rgb_image.save(
        out,
        format="WEBP",
        method=1,
    )
    return out.getvalue()

def _create_ugoira(file, output_file, frame_durations):
    try:
        with output_file:
            zipf = zipfile.ZipFile(output_file, 'w')
            with WriteZip(zipf) as z:
                # ---------- metadata.json first ----------
                frame_delays = [
                    {'file': f'{idx:06d}.webp', 'delay': int(duration)}
                    for idx, duration in enumerate(frame_durations)
                ]
                metadata = json.dumps(frame_delays, indent=4).encode('utf-8')
                output_file.about_to_write_file(len(metadata))
                z.writestr('metadata.json', metadata, compress_type=zipfile.ZIP_STORED)

                # ---------- set up WebP decode & encode pipeline ----------
                im = Image.open(file)
                if getattr(im, 'is_animated', False) is not True or im.format != 'WEBP':
                    raise Exception('Not an animated WebP')

                # Thread pool for image encodes.
                threads = max(1, (os.cpu_count() or 4))
                executor = ThreadPoolExecutor(max_workers=threads)
                max_queued = threading.Semaphore(threads * 2)

                # Keep futures by frame index so we can write strictly in order.
                pending = {}
                next_to_write = 0

                def write_output_frame(fut):
                    nonlocal next_to_write

                    image_bytes = fut.result()
                    filename = f'{next_to_write:06d}.webp'
                    output_file.about_to_write_file(len(image_bytes))
                    z.writestr(filename, image_bytes, compress_type=zipfile.ZIP_STORED)
                    next_to_write += 1
                    output_file.flush()

                # Decode linearly; this keeps WebP access strictly forward-only.
                for idx, frame in enumerate(ImageSequence.Iterator(im)):
                    # Limit how many frames we queue in advance.
                    max_queued.acquire()

                    # ImageSequence decodes in-place, so make a copy.
                    frame = frame.copy()
                    fut = executor.submit(_compress_image, frame)
                    fut.add_done_callback(lambda _: max_queued.release())
                    pending[idx] = fut

                    # Write any completed consecutive frames.
                    while next_to_write in pending and pending[next_to_write].done():
                        fut = pending.pop(next_to_write)
                        write_output_frame(fut)

                # Finish the remaining frames in order.
                while pending:
                    fut = pending.pop(next_to_write)
                    write_output_frame(fut)

                executor.shutdown(wait=True)

    except OSError as e:
        # We'll get EPIPE if the other side of the pipe is closed because the connection
        # was closed.  Don't raise these as errors.
        if e.errno in (errno.EPIPE, errno.EINVAL):
            pass
        else:
            raise

async def create_ugoira(file, frame_durations):
    """
    Start the streaming export in a background thread and return (read_pipe, task).
    """
    readfd, writefd = os.pipe()
    read = os.fdopen(readfd, 'rb', buffering=0)
    write = os.fdopen(writefd, 'wb', buffering=1024 * 256)

    write = FixedZipPipe(write)

    promise = asyncio.to_thread(
        _create_ugoira, file, write, frame_durations
    )
    promise = asyncio.create_task(promise, name='WEBP-to-ZIP')
    return read, promise
