import asyncio, aiohttp, io, os
from datetime import datetime, timezone
from PIL import Image
from pathlib import Path

from . import api

resource_path = (Path(__file__) / '../../../resources').resolve()

async def handle_thumb(request):
    illust_id = request.match_info['id']

    absolute_path = api.resolve_thumbnail_path(illust_id)

    # If this returns a directory, an image couldn't be found to use as a thumbnail.
    if absolute_path is not None and absolute_path.is_dir():
        folder = resource_path / 'folder.svg'
        return aiohttp.web.FileResponse(folder, headers={
            'Cache-Control': 'public, immutable',
        })

    if absolute_path is None or not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    # Check cache before generating the thumbnail.
    mtime = os.stat(absolute_path).st_mtime
    if_modified_since = request.if_modified_since
    if if_modified_since is not None:
        modified_time = datetime.datetime.fromtimestamp(mtime, datetime.timezone.utc)
        modified_time = modified_time.replace(microsecond=0)

        if modified_time <= if_modified_since:
            raise aiohttp.web.HTTPNotModified()

    # Generate the thumbnail in a thread.
    f = io.BytesIO()
    def create_thumb():
        nonlocal f
        
        # Thumbnail the image.
        image = Image.open(absolute_path)
        image.thumbnail((500,500))

        # Convert to RGB, since we always send thumbnails as JPEG.
        if image.mode != 'RGB':
            image = image.convert('RGB')

        # Compress to JPEG.
        image.save(f, 'JPEG')
        f.seek(0)

    await asyncio.to_thread(create_thumb)

    # Fill in last-modified from the source file.
    timestamp = datetime.fromtimestamp(mtime, tz=timezone.utc)
    timestamp = timestamp.strftime('%a, %d %b %Y %H:%M:%S %Z')

    return aiohttp.web.Response(body=f, headers={
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, immutable',
        'Last-Modified': timestamp,
    })
