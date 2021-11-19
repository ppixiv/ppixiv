import subprocess, piexif

# This handles extracting a frame from videos for thumbnails and posters.
#
# Is there a lightweight way of doing this?  FFmpeg is enormous and has
# nasty licensing.
ffmpeg = './ffmpeg/bin/ffmpeg'

def extract_frame(input_file, output_file, seek_seconds, exif_description=None):
    result = subprocess.call([
        ffmpeg,
        '-y',
        '-hide_banner',
        '-ss', str(seek_seconds),
        '-noaccurate_seek',
        '-loglevel', 'error',
        '-an', # disable audio
        '-i', input_file,
        '-frames:v', '1',
        # '-vf', 'scale=iw*0.5:ih*0.5',
        '-pix_fmt', 'yuvj420p',
        output_file,
    ])

    # If the file is shorter than seek_seconds, ffmpeg will return success and just
    # not create the file.
    if result != 0 or not output_file.is_file():
        return False

    # Set the file's EXIF description.
    if exif_description is not None:
        exif_dict = piexif.load(str(output_file))
        exif_dict['0th'][piexif.ImageIFD.ImageDescription] = exif_description.encode('utf-8')
        exif_bytes = piexif.dump(exif_dict)
        piexif.insert(exif_bytes, str(output_file))

    return True

if __name__ == '__main__':
    extract_frame('test.mp4', 'test1.jpg', seek_seconds=10, exif_description='description')
