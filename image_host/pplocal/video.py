import subprocess
import asyncio

# This handles extracting a frame from videos for thumbnails and posters.
#
# Is there a lightweight way of doing this?  FFmpeg is enormous and has
# nasty licensing.
#
# XXX: we should run this as an async that can kill ffmpeg when cancelled
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
    result = await process.wait()
    print(result)

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
