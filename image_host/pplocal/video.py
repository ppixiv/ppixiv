import subprocess
import asyncio

# This handles extracting a frame from videos for thumbnails and posters,
# and extracting the display resolution of videos.
#
# Is there a lightweight way of doing this?  FFmpeg is enormous and has
# nasty licensing.  We only need to support WebM and MP4, since those are
# the only formats that browsers will display anyway.
ffmpeg = './ffmpeg/bin/ffmpeg'

async def extract_frame(input_file, output_file, seek_seconds, exif_description=None):
    process = await asyncio.create_subprocess_exec(ffmpeg,
        '-y',
        '-hide_banner',
        '-ss', str(seek_seconds),
        '-noaccurate_seek',
        '-loglevel', 'error',
        '-an', # disable audio
        '-i', input_file,
        '-frames:v', '1',
        '-pix_fmt', 'yuvj420p',
        output_file,
    )
    try:
        result = await process.wait()
    except:
        # create_subprocess_exec doesn't kill the process on cancellation.  Make
        # sure it goes away.
        process.kill()
        raise

    result = await process.wait()

    # If the file is shorter than seek_seconds, ffmpeg will return success and just
    # not create the file.
    if result != 0 or not output_file.is_file():
        return False

    # Set the file's EXIF description.
    if False and exif_description is not None:
        import exif
        with open(output_file, 'rb') as f:
            data = f.read()

        print('----------')
        exif_dict = exif.Image(data)
        exif_dict.set('image_description', '漢字') #exif_description)

        data = exif_dict.get_file()

        with open(output_file, 'wb') as f:
            f.write(data)

    return True
