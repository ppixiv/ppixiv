#!/usr/bin/python
import json, logging, traceback
from pprint import pprint

import aiohttp
from aiohttp import web

from . import api, thumbs
from .util import misc
from .library import Library

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
        info = api.RequestInfo(request, data, base_url)

        try:
            result = await handler(info)
        except misc.Error as e:
            result = e.data()
        except Exception as e:
            traceback.print_exception(e)
            stack = traceback.format_exception(e)
            result = { 'success': False, 'code': 'internal-error', 'message': str(e), 'stack': stack }

        # Don't use web.JsonResponse.  It doesn't let us control JSON formatting
        # and gives really ugly JSON.
        data = json.dumps(result, indent=4, ensure_ascii=False) + '\n'

        # If this is an error, return 500 with the message in the status line.  This isn't
        # part of the API, it's just convenient for debugging.
        status = 200
        message = 'OK'
        if not result.get('success'):
            status = 500
            message = result.get('message')
        return web.Response(body=data, status=status, reason=message, content_type='application/json')

    return handle

# logging.basicConfig(level=logging.DEBUG)

async def setup():
    app = web.Application(middlewares=(check_origin,))

    app.router.add_get('/file/{type:[^:]+}:{path:.+}', thumbs.handle_file)
    app.router.add_get('/thumb/{type:[^:]+}:{path:.+}', thumbs.handle_thumb)
    app.router.add_get('/tree-thumb/{type:[^:]+}:{path:.+}', thumbs.handle_tree_thumb)
    app.router.add_get('/poster/{type:[^:]+}:{path:.+}', thumbs.handle_poster)

    # Add a handler for each API call.
    for command, func in api.handlers.items():
        handler = create_handler_for_command(func)
        app.router.add_view('/api' + command, handler)

    print('Initializing libraries...')
    await Library.initialize() 

    return app

def go():
    web.run_app(setup(), host='localhost', port=8235, print=None)
