# This handles serving the UI so it can be run independently.

import aiohttp, asyncio, base64, logging, os, json, mimetypes
from datetime import datetime, timezone
from pathlib import Path
from ..util import misc
from ..util.paths import open_path
from ..build.build_ppixiv import Build, BuildError

log = logging.getLogger(__name__)

root_dir = misc.root_dir()

# Work around a bug in the Python mimetypes module: it imports MIME types from
# the Windows registry, allowing them to override the built-in MIME types.  That's
# bad, because there's lot of crap in every Windows registry, which makes mimetypes
# behave unpredictably.  Because of this, we need to explicitly register the MIME
# types we use.  Python should import from the registry first (if at all, this is
# a source of nasty cross-system differences) so the built-in types take priority.
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/scss', '.scss')

def add_routes(router):
    router.add_get('/vview/app-bundle.js', handle_app_bundle)
    router.add_get('/vview/app-bundle.js.map', handle_app_bundle)

    # These directories are served directly.  /vview isn't loaded for most scripts,
    # which are loaded through the bundle, but some files are served directly, such
    # as bootstrap.js.
    router.add_get('/vview/{path:.*}', handle_file)
    router.add_get('/resources/{path:.*}', handle_file)
    router.add_get('/local/{path:.*}', handle_file)

    router.add_get('/', handle_resource('resources/index.html'))
    router.add_get('/similar', handle_resource('resources/index.html'))

    # Chrome asks for favicon.ico sometimes, such as when viewing an image directly.  Give
    # it a PNG instead.
    router.add_get('/favicon.ico', handle_resource('resources/vview-icon.png'))

def handle_resource(path):
    """
    Handle returning a specific file inside resources.
    """
    path = root_dir / 'web' / path

    def handle_file(request):
        if not path.exists():
            raise aiohttp.web.HTTPNotFound()

        return aiohttp.web.FileResponse(path, headers={
            'Cache-Control': 'public, no-cache',
        })

    return handle_file

# This handles both the app bundle and its source map.
def handle_app_bundle(request):
    send_sourcemap = request.filename = request.path.endswith('.map')

    build = Build()

    # Check cache.
    build_timestamp = build.get_build_timestamp()
    if_modified_since = request.if_modified_since
    if if_modified_since is not None:
        modified_time = datetime.fromtimestamp(build_timestamp, timezone.utc)
        modified_time = modified_time.replace(microsecond=0)

        if modified_time <= if_modified_since:
            raise aiohttp.web.HTTPNotModified()

    try:
        bundle = build.build_bundle(get_sourcemap=send_sourcemap)
    except BuildError as e:
        raise aiohttp.web.HTTPInternalServerError(reason=str(e))

    if not send_sourcemap:
        # If we're sending the app bundle (and not its source map), add the source map's
        # URL.  Use an absolute URL, so this works if we're loading the bundle with exec().
        source_map_url = request.url.with_path('/vview/app-bundle.js.map')
        bundle += f'\n//# sourceMappingURL={source_map_url}\n'

    response = aiohttp.web.Response(body=bundle, headers={
        'Content-Type': 'application/javascript; charset=UTF-8',

        # Cache for a long time, but revalidate often.  The app is loaded in a single
        # bundle, so this revalidation will only happen when the page is loaded and not
        # for every file.
        'Cache-Control': 'public, max-age=31536000, no-cache',
    })

    response.last_modified = build_timestamp

    return response

def _resolve_path(request, path):
    """
    Resolve a path for a script or resource request.

    Normally, this is just a path relative to root_dir.  We also support overrides, which
    allow applying an overlay to add or replace files in the source tree.
    """
    path = Path(path)

    # Resolve the path relative to the root directory normally.
    path = root_dir / path
    path = path.resolve()
    
    if not _is_path_access_allowed(request, path):
        log.info(f'Access denied to {path}.  If you want to allow this path, add it to permitted_paths in settings.json.')
        raise aiohttp.web.HTTPForbidden()
    
    return path

def _is_path_access_allowed(request, path):
    permitted_paths = request.app['server'].settings.data.get('permitted_paths', [])
    permitted_paths.append(root_dir)
    for permitted_path in permitted_paths:
        if path.is_relative_to(permitted_path):
            return True

    return False

def handle_file(request):
    path = request.path.lstrip('/')
    as_data_url = 'data' in request.query
    path = Path(path)

    path = Path('web') / path
    path = _resolve_path(request, path)

    path = open_path(path)
    if not path.exists():
        raise aiohttp.web.HTTPNotFound()

    headers = {
        'Cache-Control': 'public, max-age=31536000, no-cache',
    }
    
    with open(path, 'rb') as f:
        data = f.read()

    mime_type, encoding = mimetypes.guess_type(path.name)

    if as_data_url:
        data = base64.b64encode(data).decode('ascii')
        data = f'data:{mime_type};base64,' + data
        response = aiohttp.web.Response(body=data, headers=headers, charset='text/plain')
    else:
        # Bake a source URL into the response.  This is needed to prevent browsers from showing
        # query strings in the console log, which makes it hard to read.
        if mime_type == 'application/javascript':
            url = request.url.with_query('')
            data += b'\n//# sourceURL=%s\n' % str(url).encode('utf-8')

        response = aiohttp.web.Response(body=data, headers=headers, content_type=mime_type, charset=encoding)

    response.last_modified = os.stat(path).st_mtime
    return response
