#!/usr/bin/python
import asyncio, json, logging, traceback, urllib, time, io
from pprint import pprint
import urllib.parse

import aiohttp
from aiohttp import web
from aiohttp.abc import AbstractAccessLogger
from aiohttp.web_log import AccessLogger

from . import api, thumbs, ui, websockets
from ..util import misc
from .manager import Manager

log = logging.getLogger(__name__)

def _check_auth(request):
    auth = request.app['manager'].auth
    request['user'] = auth.get_guest()

    origin = request.headers.get('Origin') or request.headers.get('Referer')
    if origin:
        origin = urllib.parse.urlparse(origin)

    # Check if this request is from localhost.  Don't use request.host, since that comes
    # from the Host header.  If we were running behind a front-end server like nginx over
    # a local forwarding port, we'd need to check request.forwarded instead, since all
    # requests would be connections from localhost.
    sock = request.get_extra_info('socket')
    remote_addr = sock.getpeername()[0] if sock else None
    from_localhost = remote_addr == '127.0.0.1'

    # Allow unauthenticated requests on localhost if the origin is localhost, so we
    # always give access to the local UI.
    if from_localhost:
        if origin is None or origin.hostname == '127.0.0.1':
            log.debug('Request to localhost is admin')
            request['user'] = auth.get_local_user()
            request['is_localhost'] = True
            return

    # Allow unauthenticated requests to the authentication interface.
    if request.path == '/api/auth/login' or request.path == '/client/auth.html':
        log.debug('Request to login API is guest')
        request['user'] = auth.get_guest()
        return

    # Check if there's an authentication cookie.
    auth_token = request.cookies.get('auth_token')
    if auth_token is not None:
        user = auth.check_token(auth_token)
        if user is not None:
            log.debug(f'Request with token authed as {user.username}')
            request['user'] = user
            request['user_token'] = auth_token
            return

    log.debug('Unauthenticated request')
    request['user'] = auth.get_guest()

@web.middleware
async def auth_middleware(request, handler):
    # auth/login is the only API call we allow without any authentication.
    if request.path == '/api/auth/login':
        return await handler(request)

    _check_auth(request)

    # Allow the main page to load without authentication, as well as our static scripts and
    # resources.
    requires_auth = request.path != '/' and not request.path.startswith('/client/')
    if requires_auth and request['user'] is None:
        if request.path.startswith('/api/'):
            result = { 'success': False, 'code': 'access-denied', 'reason': 'Authentication required' }
            raise aiohttp.web.HTTPUnauthorized(body=json.dumps(result))
        else:
            raise aiohttp.web.HTTPUnauthorized()

    # Set a flag if a request has an origin of localhost, which means it's from the local UI
    # and not through Pixiv.  We only give access to /root to access non-mounted directories
    # for the local UI.  This is also limited to localhost, since any non-browser client can
    # set an arbitrary origin.
    origin = request.headers.get('Origin') or request.headers.get('Referer')
    if origin is not None and request.get('is_localhost'):
        origin_url = urllib.parse.urlparse(origin)
        request['is_local'] = origin_url.hostname == '127.0.0.1'
    else:
        request['is_local'] = False

    return await handler(request)

async def check_origin(request, response):
    """
    Add CORS headers.
    
    This is called after auth_middleware, which checks the origin.  We can't do that
    here, since we can't raise HTTP exceptions here.
    """
    origin = request.headers.get('Origin') or request.headers.get('Referer')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Accept, Cache-Control, If-None-Match, If-Modified-Since, Origin, Range, X-Requested-With'
        response.headers['Access-Control-Expose-Headers'] = '*'
        response.headers['Access-Control-Max-Age'] = '1000000'

def create_handler_for_command(handler):
    async def handle(request):
        if request.method == 'OPTIONS':
            return web.Response(status=200)

        if request.method != 'POST':
            raise aiohttp.web.HTTPMethodNotAllowed(method=request.method, allowed_methods=('POST', 'OPTIONS'))

        try:
            data = await request.json()
        except ValueError as e:
            return web.Response(status=400, body=f'Couldn\'t decode JSON request: {str(e)}\n')

        base_url = '%s://%s:%i' % (request.url.scheme, request.url.host, request.url.port)
        info = api.RequestInfo(request, data, base_url)

        try:
            result = await handler(info)
        except misc.Error as e:
            result = e.data()
        except Exception as e:
            traceback.print_exception(e)
            stack = traceback.format_exception(e)
            result = { 'success': False, 'code': 'internal-error', 'reason': str(e), 'stack': stack }

        # Don't use web.JsonResponse.  It doesn't let us control JSON formatting
        # and gives really ugly JSON.
        try:
            data = json.dumps(result, indent=4, ensure_ascii=False) + '\n'
        except TypeError as e:
            # Something in the result isn't serializable.
            print('Invalid response data:', e)
            pprint(result)

            result = { 'success': False, 'code': 'internal-error', 'reason': str(e) }
            data = json.dumps(result, indent=4, ensure_ascii=False) + '\n'

        data = data.encode('utf-8')
        data = io.BytesIO(data)

        # If this is an error, return 500 with the message in the status line.  This isn't
        # part of the API, it's just convenient for debugging.
        status = 200
        message = 'OK'
        if not result.get('success'):
            status = 401
            message = result.get('reason', 'Error message missing')
        return web.Response(body=data, status=status, reason=message, content_type='application/json')

    return handle

async def handle_unknown_api_call(info):
    name = info.request.match_info['name']
    return { 'success': False, 'code': 'invalid-request', 'reason': 'Invalid API: /api/%s' % name }

logging.basicConfig(level=logging.INFO)
logging.getLogger('vview').setLevel(logging.INFO)
logging.captureWarnings(True)

_running_requests = {}

# Work around some aiohttp weirdness.  For some reason, although it runs handlers
# in a task, it doesn't cancel the tasks on shutdown.  Apparently we're supposed
# to keep track of requests and cancel them ourselves.  This seems like the framework's
# job, I don't know why this is pushed onto the application.
#
# register_request_middleware registers running requests, and the shutdown_requests
# shutdown handler cancels them.  Setting this up is a bit messy since on_shutdown
# and middlewares are registered in completely different ways.
@web.middleware
async def register_request_middleware(request, handler):
    try:
        _running_requests[request.task] = request
        return await handler(request)
    finally:
        del _running_requests[request.task]

async def shutdown_requests(app):
    for task, request in dict(_running_requests).items():
        task.cancel()

async def setup(*, set_main_task=None):
    set_main_task()

    app = web.Application(middlewares=[register_request_middleware, auth_middleware])
    app.on_response_prepare.append(check_origin)
    app.on_shutdown.append(shutdown_requests)

    # Set up routes.
    app.router.add_get('/file/{type:[^:]+}:{path:.+}', thumbs.handle_file)
    app.router.add_get('/thumb/{type:[^:]+}:{path:.+}', thumbs.handle_thumb)
    app.router.add_get('/tree-thumb/{type:[^:]+}:{path:.+}', thumbs.handle_tree_thumb)
    app.router.add_get('/poster/{type:[^:]+}:{path:.+}', thumbs.handle_poster)
    app.router.add_get('/mjpeg-zip/{type:[^:]+}:{path:.+}', thumbs.handle_mjpeg)
    app.router.add_get('/inpaint/{type:[^:]+}:{path:.+}', thumbs.handle_inpaint)
    app.router.add_get('/open/{path:.+}', thumbs.handle_open)
    ui.add_routes(app.router)

    # Set up WebSockets.
    websockets.setup(app)

    # Add a handler for each API call.
    for command, func in api.handlers.items():
        handler = create_handler_for_command(func)
        app.router.add_view('/api' + command, handler)

    # Add a fallback for invalid /api calls.
    handler = create_handler_for_command(handle_unknown_api_call)
    app.router.add_view('/api/{name:.*}', handler)

    # Start our manager.
    manager = Manager(app)
    app['manager'] = manager
    await manager.init()

    return app

class AccessLogger(AbstractAccessLogger):
    """
    A more readable access log.
    """
    def __init__(self, *args):
        self.logger = logging.getLogger('vview.request')

    def log(self, request, response, duration) -> None:
        path = urllib.parse.unquote(request.path_qs)
        start_time = time.time() - duration
        message = '%f %i (%i): %s' % (start_time, response.status, response.body_length, path)

        # Log successful non-API requests at a lower level, so we don't spam for each
        # thumbnail request.
        if response.status == 200 and not path.startswith('/api/'):
            self.logger.debug(message)
        else:
            self.logger.info(message)

def run_server(*, set_main_task):
    web.run_app(setup(set_main_task=set_main_task),
        port=8235,
        print=None,
        access_log_format='%t "%r" %s %b',
        access_log_class=AccessLogger)

def run():
    misc.RunMainTask(run_server)

if __name__ == '__main__':
    run()
