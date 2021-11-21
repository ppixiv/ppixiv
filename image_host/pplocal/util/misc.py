# Helpers that don't have dependancies on our other modules.
import os

# cv2 is used to get the dimensions of video files.  It ultimately just calls ffmpeg,
# but it's much faster than running ffprobe in a subprocess.  XXX: are there any usable
# direct ffmpeg bindings, cv2 is big and its video API is too basic to do anything else
# with
import cv2

from PIL import Image

image_types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
}

video_types = {
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/video/quicktime',
    '.3gp': 'video/video/3gpp', 
}

def file_type_from_ext(ext):
    if ext in image_types:
        return 'image'
    if ext in video_types:
        return 'video'
    return None

def mime_type_from_ext(ext):
    ext = ext.lower()
    if ext in image_types:
        return image_types[ext]
    if ext in video_types:
        return video_types[ext]
    return 'application/octet-stream'

def file_type(path):
    _, ext = os.path.splitext(path)
    ext = ext.lower()
    return file_type_from_ext(ext)

def get_image_dimensions(path):
    filetype = file_type(path)
    if filetype == 'video':
        video = cv2.VideoCapture(str(path))
        height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
        width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH))
        return width, height

    try:
        image = Image.open(path)
    except OSError as e:
        # Skip non-images.
        return None

    return image.size

class Error(Exception):
    def __init__(self, code, reason):
        self.code = code
        self.reason = reason
    def data(self):
        return {
            'success': False,
            'code': self.code,
            'reason': self.reason,
        }
