import aiohttp, json, logging, traceback, urllib, time, io
from aiohttp import web
from pprint import pprint
import urllib.parse

from . import api, thumbs, ui, websockets
from ..util import misc

log = logging.getLogger(__name__)

class APIServer:
    """
    Run and manage the HTTP server for the API.
    """
    async def init(self, server):
        self.server = server
        self.site = None
        self.runner = None
        self.running_requests = {}

        app = await self._create_app()

        # Create the aiohttp runner.
        self.runner = aiohttp.web_runner.AppRunner(app, access_log_class=misc.AccessLogger, keepalive_timeout=75)

        await self.runner.setup()

        port = 8235
        self.site = aiohttp.web_runner.TCPSite(self.runner, host=None, port=port, shutdown_timeout=1, backlog=128)
        await self.site.start()

    async def shutdown(self):
        """
        Stop the webserver.
        """
        if self.site is not None:
            await self.site.stop()
            self.site = None

        if self.runner is not None:
            await self.runner.cleanup()
            self.runner = None

    async def _create_app(self):
        """
        Create a web.Application for running our HTTP server.
        """
        app = web.Application(middlewares=[self.register_request_middleware, self.auth_middleware])

        # Store the server on the app so it can be accessed from requests.
        app['server'] = self.server

        app.on_response_prepare.append(self.check_origin)
        app.on_shutdown.append(self.shutdown_requests)

        # Set up routes.
        app.router.add_get('/file/{type:[^:]+}:{path:.+}', thumbs.handle_file)
        app.router.add_get('/thumb/{type:[^:]+}:{path:.+}', thumbs.handle_thumb)
        app.router.add_get('/tree-thumb/{type:[^:]+}:{path:.+}', thumbs.handle_tree_thumb)
        app.router.add_get('/poster/{type:[^:]+}:{path:.+}', thumbs.handle_poster)
        app.router.add_get('/mjpeg-zip/{type:[^:]+}:{path:.+}', thumbs.handle_mjpeg)
        app.router.add_get('/inpaint/{type:[^:]+}:{path:.+}', thumbs.handle_inpaint)
        app.router.add_get('/open/{path:.+}', thumbs.handle_open)

        # Set up WebSockets.
        websockets.setup(app)

        # Add UI routes.  Do this last, since it handles the fallback for top-level files.
        ui.add_routes(app.router)

        # Add a handler for each API call.
        for command, func in api.handlers.items():
            handler = self.create_handler_for_command(func)
            app.router.add_view('/api' + command, handler)

        # Add a fallback for invalid /api calls.
        handler = self.create_handler_for_command(self.handle_unknown_api_call)
        app.router.add_view('/api/{name:.*}', handler)

        return app

    @web.middleware
    async def register_request_middleware(self, request, handler):
        """
        Keep track of running requests, so we can cancel them on shutdown.
        """
        try:
            self.running_requests[request.task] = request
            return await handler(request)
        finally:
            del self.running_requests[request.task]

    async def shutdown_requests(self, app):
        """
        Shut down any running requests.
        """
        for task, request in dict(self.running_requests).items():
            task.cancel()

    async def handle_unknown_api_call(self, info):
        name = info.request.match_info['name']
        return { 'success': False, 'code': 'invalid-request', 'reason': 'Invalid API: /api/%s' % name }

    def create_handler_for_command(self, handler):
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
                log.exception('Error handling request')
                stack = traceback.format_exception(e)
                result = { 'success': False, 'code': 'internal-error', 'reason': str(e), 'stack': stack }

            # Don't use web.JsonResponse.  It doesn't let us control JSON formatting
            # and gives really ugly JSON.
            try:
                data = json.dumps(result, indent=4, ensure_ascii=False) + '\n'
            except TypeError as e:
                # Something in the result isn't serializable.
                log.warn('Invalid response data:', e)
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

    async def check_origin(self, request, response):
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
            response.headers['Vary'] = 'Origin, Referer'


    @web.middleware
    async def auth_middleware(self, request, handler):
        # auth/login is the only API call we allow without any authentication.
        if request.path == '/api/auth/login':
            return await handler(request)

        # If true, this request is local, either coming from our local UI or from the user accessing
        # us directly (no Origin header), so it's trusted and runs as admin.
        request['is_local'] =  self.is_trusted_local_request(request)

        # Set request['user']:
        self.check_auth(request)

        # Allow the main page to load without authentication, as well as our static scripts and
        # resources.
        requires_auth = request.path != '/' and not request.path.startswith('/client/')
        if requires_auth and request['user'] is None:
            if request.path.startswith('/api/'):
                result = { 'success': False, 'code': 'access-denied', 'reason': 'Authentication required' }
                raise aiohttp.web.HTTPUnauthorized(body=json.dumps(result))
            else:
                raise aiohttp.web.HTTPUnauthorized()

        return await handler(request)

    def is_trusted_local_request(self, request):
        """
        Return true if request is coming from localhost, and isn't coming from another site.
        """
        # Check if this request is from localhost.  Don't use request.host, since that comes
        # from the Host header.  If we were running behind a front-end server like nginx over
        # a local forwarding port, we'd need to check request.forwarded instead, since all
        # requests would be connections from localhost.
        sock = request.get_extra_info('socket')
        remote_addr = sock.getpeername()[0] if sock else None
        if remote_addr != '127.0.0.1':
            return False

        # Don't treat this as a local request if it's being made from another site the user
        # is viewing.
        origin = request.headers.get('Origin') or request.headers.get('Referer')
        if origin:
            origin = urllib.parse.urlparse(origin)
            if origin.hostname != '127.0.0.1':
                return False

        return True

    def check_auth(self, request):
        auth = self.server.auth
        request['user'] = auth.get_guest()

        # Allow unauthenticated requests on localhost if the origin is localhost, so we
        # always give access to the local UI.
        if request['is_local']:
            log.debug('Request to localhost is admin')
            request['user'] = auth.get_local_user()
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
