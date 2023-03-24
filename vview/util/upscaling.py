# Run 2x and 4x upscales using the ESRGAN upscaler.

import asyncio, time, os, logging, random, shutil, subprocess, uuid
from pathlib import Path
from PIL import Image
from pprint import pprint
from vview.util import misc, win32
from ..util.paths import open_path
from ..util.tiff import remove_photoshop_tiff_data

log = logging.getLogger(__name__)

_upscaler = './bin/upscaler/realesrgan-ncnn-vulkan'

# Keep track of running upscales we're generating, and if we get a second request for
# one that's already running, just wait for it to finish so we don't run the same one twice.
_upscale_jobs = {}

_lock = asyncio.Lock()

async def create_upscale_for_entry(entry, ratio=2):
    if ratio not in (2,3,4):
        ratio = 2

    input_file = entry['path']
    containing_file = input_file.filesystem_path

    # Normally, cache files are placed in .upscales alongside the file.  If the file
    # is a ZIP, this will be alongside the ZIP.
    output_path = containing_file.parent / '.upscales'

    if not input_file.real_file:
        # This is a file inside a ZIP.  If this is C:/Images/File.zip/Path/Image.jpg,
        # save the output to C:/images/.upscale/File.zip/Path/Image.jpg.
        relative = input_file.relative_to(containing_file)
        output_path = output_path / relative.parent

    if not output_path.exists():
        output_path.mkdir()
        win32.set_path_hidden(output_path)

    output_name = input_file.name

    # Most rescales are 2x.  Tack a prefix on other rescales.
    if ratio != 2:
        output_name = f'{ratio}x ${output_name}'

    output_file = output_path / output_name

    try:
        return await _create_upscale_or_wait(input_file, output_file=output_file, ratio=ratio)
    except Exception:
        log.exception('Error generating upscale')
        return None, ''

async def _create_upscale_or_wait(*args, output_file, **kwargs):
    # If this is already being generated, just wait for that task to finish.
    if output_file in _upscale_jobs:
        # Just wait for it to finish.
        log.info(f'Upscale {output_file} is already being generated, waiting for it')
        existing_task = _upscale_jobs[output_file]
        return await existing_task

    # Run the upscale.
    task = _create_upscale(*args, **kwargs, output_file=output_file)
    task = asyncio.create_task(task, name='Upscaling')
    _upscale_jobs[output_file] = task

    try:
        await task
    finally:
        # Remove the job from the list, and signal anyone waiting for it.
        del _upscale_jobs[output_file]

    return output_file, 'image/jpeg'

async def _create_upscale(input_file, *, output_file, ratio):
    """
    Create the upscale for input_file.  Return (filename, mime_type).
    """
    # If the output file already exists, use it if the timestamp matches.  If the
    # timestamps are different, regenerate it.
    if output_file.exists():
        input_stat = input_file.stat()
        output_stat = output_file.stat()
        if input_stat.st_mtime == output_stat.st_mtime:
            return

    # Reencode the image we're upscaling to an RGB BMP.  The upscaler isn't very robust
    # at handling various files and file paths, so this lets us give it a simple, controlled
    # input that won't confuse it.  Bake any transparency (it doesn't handle transparency)
    # and convert to RGB.
    input_temp_file = misc.get_temporary_path('.bmp')

    with input_file.open('rb') as f:
        f = remove_photoshop_tiff_data(f)
        image = Image.open(f)
        image.load()
        
        if image.mode != 'RGB':
            image = image.convert('RGB')

        with input_temp_file.open('w+b') as output:
            image.save(output, format='bmp')

    tempdir = Path(os.environ['TEMP'])
    output_temp = f'vview-temp-{uuid.uuid4()}{input_file.suffix}'
    output_temp_file = Path(tempdir) / output_temp

    try:
        # This is a GPU upscaler.  Only process one image at a time, so we don't spam GPU jobs
        # if the client tries to load too aggressively.  Doing it here allows the above check
        # to complete without blocking if the image is already cached.
        async with _lock:
            assert ratio in (2,3,4)
            result = await _run_upscale([
                _upscaler,
                '-s', str(ratio),
                '-i', str(input_temp_file),
                '-o', str(output_temp_file),
            ])

        if result != 0:
            raise Exception('Error upscaling image')

        # The upscaler doesn't return a result code.
        if not output_temp_file.exists():
            raise Exception('Error upscaling image (no file generated)')

        shutil.copyfile(output_temp_file, output_file)
    finally:
        # Clean up.
        input_temp_file.unlink(missing_ok=True)
        output_temp_file.unlink(missing_ok=True)

    # Set the cache file's timestamp to match the input file, so we can tell if the input
    # file changes.
    st = input_file.stat()
    os.utime(output_file, (st.st_atime, st.st_mtime))

async def _run_upscale(args):
    # Use DETACHED_PROCESS so a console window isn't created.
    DETACHED_PROCESS = 0x00000008
    process = await asyncio.create_subprocess_exec(*args,
        stdin=subprocess.DEVNULL,
        creationflags=DETACHED_PROCESS)

    return await misc.wait_or_kill_process(process)
