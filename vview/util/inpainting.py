import asyncio, cairo, time, uuid, os, json, hashlib, traceback, math
import PIL
from PIL import Image, ImageFilter
from io import BytesIO
from pathlib import Path
from pprint import pprint

from . import video

class InpaintError(Exception): pass
class DataError(InpaintError): pass

def draw(actions, width, height, dilate=0):
    original_width = width
    original_height = height

    output_settings = {
        'blur_mask': 0,
        'downscale': 1,
        'max_resolution': 1500,
    }

    # Align to 4, since PIL won't let us specify the stride
    width = (width + 3) & ~3

    surface = cairo.ImageSurface(cairo.FORMAT_A8, width, height)
    ctx = cairo.Context(surface)

    ctx.set_line_cap(cairo.LineCap.ROUND)
    ctx.set_line_join(cairo.LineCap.ROUND)

    for action in actions:
        if not isinstance(action, dict):
            raise DataError('Invalid inpaint data')
            
        cmd = action.get('action', '')
        match cmd:
            case 'settings':
                # This is just a setting for how much we blur at the end.  We don't blur in the middle of drawing
                # or allow changing it per stroke.
                output_settings['blur_mask'] = action.get('blur', 0)
                output_settings['downscale'] = action.get('downscale', 1)
                output_settings['max_resolution'] = action.get('max_resolution', 800)

            case 'line':
                thickness = action.get('thickness', 1)
                thickness += dilate
                ctx.set_line_width(thickness)

                segments = action.get('line', [])
                start_pos = segments[0]
                ctx.move_to(start_pos[0], start_pos[1])

                for point in segments[1:]:
                    ctx.line_to(point[0], point[1])

                ctx.stroke()
            case _:
                print('Unknown action:', cmd)

    # Convert to a PIL image.
    img = PIL.Image.frombuffer('L', (surface.get_width(), surface.get_height()), surface.get_data())

    # If we padded to align to 4, crop back to the source size.
    img = img.crop((0, 0, original_width, original_height))

    return img, output_settings

class tm:
    def __init__(self):
        self.t = time.time()
        self.total = 0
    def go(self, text):
        now = time.time()
        delta = now - self.t
        self.total += delta
        self.t = now
        print('%30s %.3f %.3f' % (text, delta, self.total))

async def _create_correction(source_image, lines):
    s = tm()
    # We'll need to load the source file eventually, so do it now to catch any errors early.
    source_image.load()

    s.go('load')

    # Draw the inpaint mask.
    mask, output_settings = draw(lines, source_image.size[0], source_image.size[1])

    # The removelogo filter can take a long time if the image is very high-resolution, and
    # often there's no point in running the filter at full resolution.  It's creating a
    # blurry inpaint anyway.  Set a target resolution and scale the image down to that for inpainting.
    target_size = 600 # output_settings['max_resolution']
    target_ratio = target_size / max(source_image.size)
    target_ratio = min(target_ratio, 1) # only if smaller
    target_size = (int(source_image.size[0] * target_ratio), int(source_image.size[1] * target_ratio))

    downscaled_source_image = source_image
    downscaled_mask = mask
    if target_ratio < 1:
        downscaled_source_image = downscaled_source_image.resize(target_size, reducing_gap=2)
        downscaled_mask = downscaled_mask.resize(target_size, reducing_gap=2)
        s.go('pre-downscale')

    # Save the mask for ffmpeg.
    downscaled_mask.save('mask.bmp', format='bmp')
    s.go('save mask')

    # Pipe the image to ffmpeg as a BMP.  This allows us to send embedded images, and avoids
    # having FFmpeg decompress PNGs a second time.
    source_bmp = BytesIO()
    downscaled_source_image.save(source_bmp, format='bmp')
    s.go('save downscaled image')

    source_bmp.seek(0)
    stdin = video.pipe_to_process(source_bmp)

    # Write the output to a file.  It would be better to stream this, but asyncio is
    # a pain and I don't feel like fighting with it right now.
    tempdir = Path(os.environ['TEMP'])
    temp_filename = 'vview-temp-%s.bmp' % str(uuid.uuid4())
    temp_file = Path(tempdir) / temp_filename

    result = await video.run_ffmpeg([
        '-hide_banner',
        '-y',
        '-i', '-',
        '-vf', "removelogo=f=mask.bmp",
        '-c:v', 'bmp',
        '-f', 'image2pipe',
        str(temp_file),
        '-loglevel', 'error',
    ], stdin=stdin)
    if result != 0:
        raise Exception('Error running FFmpeg to create correction image')
    s.go('ffmpeg')

    try:
        with temp_file.open('rb') as result:
            # Read the result.
            image = Image.open(result, formats=('bmp',))
            image.load()
    finally:
        temp_file.unlink()
    s.go('load result')

    # Rescale the inpaint back to the source size.
    image = image.resize(source_image.size, resample=Image.BILINEAR)
    
    s.go('resize back')

    # Apply any blurring to the mask.  Don't blur the mask we give to FFmpeg.

    # If we downsampled for inpainting, blur the inpaint proportionally to
    # the downscale to get rid of rescaling artifacts.  It's blurry anyway,
    # this just gives a cleaner blur.  If we downscaled to 0.5, blur with a
    # radius of 2.
    image = image.filter(filter=ImageFilter.BoxBlur(1 / target_ratio))

    s.go('target_ratio blur')

    if output_settings['blur_mask'] > 0:
        # Any pixels fully masked should remain fully masked after blurring.  If we simply
        # blur, the edge of the mask will expand bidirectionally, and previously masked pixels
        # will become visible.  Avoid this by dilating the mask first to expand it.  PIL's
        # MaxFilter is really slow, so we just draw the mask again with a higher thickness.
        # Set the
        # dilate radius to twice the blur radius.  Also, MaxFilter only accepts an odd radius.
        dilate_radius = math.ceil(output_settings['blur_mask'] * 2)
        mask, _ = draw(lines, source_image.size[0], source_image.size[1], dilate=dilate_radius)
        s.go('dilate')

        # Use a box blur instead of a gaussian blur, since the number of pixels blurred is
        # more accurate.
        mask = mask.filter(filter=ImageFilter.BoxBlur(output_settings['blur_mask']))
        s.go('blur')

    if output_settings['downscale'] > 1:
        # Downscale and restore the patch if requested.
        post_downscale_size = (int(source_image.size[0] / output_settings['downscale']), int(source_image.size[1] / output_settings['downscale']))
        image = image.resize(post_downscale_size, reducing_gap=2)
        s.go('post-downscale')

        # Resize back to the original size, to match the source image.
        image = image.resize(source_image.size, resample=Image.NEAREST)
        s.go('final resize ' + str(image.size))

    # Replace the alpha channel on the corrected image with the mask.  Don't use paste(mask) for
    # this, for some reason it seems to result in premultiplied alpha when everything else is
    # expecting straight alpha.  Do this after resampling, so the mask stays full resolution.
    image.putalpha(mask)
    s.go('putalpha')

    # putalpha just puts alpha, which means the RGB channels still have data for completely
    # transparent pixels.  This will be saved to PNGs, which makes them huge.  Fix this by
    # alpha compositing the mask onto a blank image, which will clear transparent pixels.
    image2 = Image.new('RGBA', mask.size)
    image2 = Image.alpha_composite(image2, image)
    s.go('alpha_composite')

    return image2

def get_inpaint_id(input_file, lines):
    # Use the inpaint data as a hash for the filename to save.
    lines_json = str(input_file) + json.dumps(lines)
    return hashlib.sha1(lines_json.encode('utf-8')).hexdigest()

# We only save the patch to cache.  It's usually tiny, so it takes less storage
# and compresses/decompresses very quickly.  The client reads it separately and
# comps it onto the image.  This allows it to turn the patch on and off client-side.
async def create_inpaint(input_file, lines, *, patch_filename):
    """
    Create the inpaint file for input_file.  Return (filename, image, mime_type) for
    the inpaint file.

    If the file already exists, it won't be recreated, and image will be None.  We
    won't load it here, since we don't need it.
    """
    patch_filename.parent.mkdir()
    if patch_filename.exists():
        return patch_filename, None, 'image/png'

    with input_file.open('rb') as image_file:
        # Open the source image.
        source_image = Image.open(image_file)
        patch_image = await create_inpaint_patch(source_image, lines)

    with patch_filename.open('w+b') as output:
        patch_image.save(output, 'png')

    return patch_filename, patch_image, 'image/png'

async def create_inpaint_patch(source_image, lines):
    """
    Create an inpaint corrective image.

    input_file is a BasePath of the image to correct.
    lines is an array of corrections to apply.

    If output_patch is supplied, a patch image will be written.
    """
    # Create the corrected image.
    return await _create_correction(source_image, lines)

def get_inpaint_path_for_entry(entry, manager):
    inpaint_id = entry.get('inpaint_id')
    if inpaint_id is None:
        return None

    return get_inpaint_cache_path(inpaint_id, data_dir=manager.data_dir)

def get_inpaint_cache_path(inpaint_id, *, data_dir):
    cache_dir = data_dir / 'inpaint'
    return cache_dir / Path(inpaint_id + '.png')

async def create_inpaint_for_entry(entry, manager):
    """
    """
    # Get the inpaint data from the file's extra metadata.
    inpaint = entry.get('inpaint')
    if not inpaint:
        return None, None, ''

    inpaint = json.loads(inpaint)

    # Create the inpaint cache directory if it doesn't exist.
    cache_dir = manager.data_dir / 'inpaint'
    cache_dir.mkdir()
    
    try:
        patch_filename = get_inpaint_path_for_entry(entry, manager)
        return await create_inpaint_or_wait(entry['path'], inpaint, patch_filename=patch_filename)
    except Exception:
        # Don't let errors with inpainting prevent us from doing anything with the image.
        print('Error generating inpaint')
        traceback.print_exc()
        return None, None, ''

def apply_inpaint(source_image, inpaint_image):
    """
    Apply an inpaint image to a source image.

    This can be called from a thread.
    """
    try:
        original_mode = source_image.mode
        source_image = source_image.convert('RGBA')
        source_image = Image.alpha_composite(source_image, inpaint_image)

        # Convert the image back to its original mode, so if we started with RGB, we
        # return to RGB.
        return source_image.convert(original_mode)
    except Exception:
        # Don't let errors with inpainting prevent us from doing anything with the image.
        print('Error applying inpaint')
        traceback.print_exc()
        return source_image

# Creating these can take some time, and there are cases where we might get a couple
# requests for the same one at once.  Keep track of inpaints we're generating, and if
# we get a second request for one that's already running, just wait for it to finish
# so we don't run the same one twice.
_inpaint_jobs = {}

async def create_inpaint_or_wait(*args, patch_filename, **kwargs):
    # If this inpaint is already being generated, just wait for that task to finish.
    if patch_filename in _inpaint_jobs:
        # Just wait for it to finish.
        print(f'Inpaint {patch_filename} is already being generated, waiting for it')
        existing_task = _inpaint_jobs[patch_filename]
        return await existing_task

    # Run the inpaint.
    task = create_inpaint(*args, **kwargs, patch_filename=patch_filename)
    task = asyncio.create_task(task)
    _inpaint_jobs[patch_filename] = task

    try:
        return await task
    finally:
        # Remove the inpaint from the list, and signal anyone waiting for it.
        del _inpaint_jobs[patch_filename]

async def go():
    lines = [
        { 'action': 'line', 'thickness': 15, 'segments': [[100,100], [200,200], [200,300]], }
        #{ 'action': 'settings', 'blur': 2 },
    ]

    source = Image.open('test.png')
    mask = await create_inpaint_patch(source, lines)
    mask.save('test-mask.png')

if __name__ == '__main__':
    asyncio.run(go())
