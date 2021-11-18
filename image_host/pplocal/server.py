#!/usr/bin/python
import json, logging, traceback
from pprint import pprint

import aiohttp
from aiohttp import web
from aiohttp.web_fileresponse import FileResponse

from . import api, thumbs

@web.middleware
async def check_origin(request, handler):
    """
    Check the Origin header and add CORS headers.
    """
    origin = request.headers.get('Origin')
    if origin is not None and origin != 'https://www.pixiv.net':
        raise aiohttp.web.HTTPUnauthorized()

    resp = await handler(request)

    if origin:
        resp.headers['Access-Control-Allow-Origin'] = origin
        resp.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = '*'
        resp.headers['Access-Control-Expose-Headers'] = '*'
        resp.headers['Access-Control-Max-Age'] = '1000000'

    return resp

def create_handler_for_command(handler):
    async def handle(request):
        if request.method == 'OPTIONS':
            return web.Response(status=200)

        if request.method != 'POST':
            raise aiohttp.web.HTTPMethodNotAllowed(method=request.method, allowed_methods=('POST', 'OPTIONS'))

        data = await request.json()

        base_url = '%s://%s:%i' % (request.url.scheme, request.url.host, request.url.port)
        info = api.RequestInfo(data, base_url)

        try:
            result = await handler(info)
        except api.Error as e:
            result = e.data()
        except Exception as e:
            traceback.print_exception(e)
            result = { 'success': False, 'code': 'internal-error', 'message': 'Server error' }

        # Don't use web.JsonResponse.  It doesn't let us control JSON formatting
        # and gives really ugly JSON.
        data = json.dumps(result, indent=4, ensure_ascii=False) + '\n'
        return web.Response(body=data, content_type='application/json')

    return handle

# Serve file requests.
async def handle_file(request):
    illust_id = request.match_info['id']

    absolute_path = api.resolve_thumbnail_path(illust_id)
    if not absolute_path.is_file():
        raise aiohttp.web.HTTPNotFound()

    return FileResponse(absolute_path, headers={
        'Cache-Control': 'public, immutable',
    })

# logging.basicConfig(level=logging.DEBUG)

def go():
    app = web.Application(middlewares=(check_origin,))

    app.router.add_get('/file/{id:.+}', handle_file)
    app.router.add_get('/thumb/{id:.+}', thumbs.handle_thumb)

    # Add a handler for each API call.
    for command, func in api.handlers.items():
        handler = create_handler_for_command(func)
        app.router.add_view('/api' + command, handler)

    web.run_app(app, host='localhost', port=8235, print=None)
