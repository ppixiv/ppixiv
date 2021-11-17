#!/usr/bin/python
import datetime, email.utils, io, json, os, asyncio, logging
from pprint import pprint
from PIL import Image
from datetime import datetime, timezone

import aiohttp
from aiohttp import web

import api

class RequestHandler:
    @staticmethod
    def list(self, request):
        pass

def handle_request(command, request, request_url):
    endpoint = api.handlers.get(command)
    if not endpoint:
        return { 'success': False, 'reason': 'Unknown command' }

    info = api.RequestInfo(request, request_url)
    return endpoint(info)

def check_cache(headers, current_mtime):
    # If there's an If-Modified-Since header, parse it.
    modified_since_header = headers.get("If-Modified-Since")
    if modified_since_header is None:
        return False

    try:
        modified_since = email.utils.parsedate_to_datetime(modified_since_header)
    except:
        return False

    mtime = datetime.datetime.fromtimestamp(current_mtime, datetime.timezone.utc)
    mtime = mtime.replace(microsecond=0)

    return mtime <= modified_since

routes = web.RouteTableDef()

@routes.get('/thumb/{path:.+}')
async def handle_thumb(request):
    path = request.match_info['path']

    absolute_path, id_path = api.resolve_filesystem_path(path)
    if not os.path.isfile(absolute_path):
        raise aiohttp.web.HTTPNotFound()

    # Check cache before generating the thumbnail.
    mtime = os.stat(absolute_path).st_mtime
    if check_cache(request.headers, mtime):
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

    return web.Response(body=f, headers={
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, immutable',
        'Last-Modified': timestamp,
    })

def create_handler_for_command(command, routes):
    handler = api.handlers[command]

    @routes.view('/api' + command)
    async def handle(request):
        origin = request.headers.get('Origin')
        if origin is not None and origin != 'https://www.pixiv.net':
            raise aiohttp.web.HTTPUnauthorized()

        headers = { }
        if origin:
            headers['Access-Control-Allow-Origin'] = origin
            headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
            headers['Access-Control-Allow-Headers'] = '*'
            headers['Access-Control-Expose-Headers'] = '*'
            headers['Access-Control-Max-Age'] = '1000000'

        if request.method == 'OPTIONS':
            return web.Response(status=200, headers=headers)

        if request.method != 'POST':
            raise aiohttp.web.HTTPMethodNotAllowed(method=request.method, allowed_methods=('POST', 'OPTIONS'))

        data = await request.json()
        base_url = '%s://%s:%i' % (request.url.scheme, request.url.host, request.url.port)
        info = api.RequestInfo(data, base_url)

        try:
            result = await handler(info)
        except api.Error as e:
            result = e.data()

        data = json.dumps(result, indent=4) + '\n'
        return web.Response(body=data, headers=headers, content_type='application/json')

# Add a handler for each API call.
for command in api.handlers.keys():
    create_handler_for_command(command, routes)

# logging.basicConfig(level=logging.DEBUG)

def go():
    app = web.Application()
    for key, path in api.archives.items():
        app.router.add_static('/' + key, path)

    app.add_routes(routes)

    web.run_app(app, host='localhost', port=8235)

go()
