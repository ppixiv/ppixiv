# This handles serving the UI so it can be run independently.

import aiohttp, asyncio, base64, glob, os, json, mimetypes
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import urllib.parse
from ..util import misc
from ..util.paths import open_path
from ..build.build_ppixiv import Build

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
    router.add_get('/vview/init.js', handle_init)
    router.add_get(r'/vview/{path:.*\.css}', handle_css)
    router.add_get('/vview/{path:.*}', handle_client)

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

def _get_path_timestamp_suffix(path):
    fs_path = root_dir / Path(path)
    mtime = fs_path.stat().st_mtime

    return f'?{mtime}'

def _get_modules(base_url):
    modules = Build.get_modules()

    # Replace the module path with the API path, and add a cache timestamp.
    for module_name, path in modules.items():
        url_path = '/' / PurePosixPath(module_name)
        url = urllib.parse.urljoin(str(base_url), url_path.as_posix())
        suffix = _get_path_timestamp_suffix(path)
        modules[module_name] = url + suffix

    return modules

def _get_resources(base_url):
    build = Build()

    results = {}
    for name, path in build.get_resource_list().items():
        suffix = _get_path_timestamp_suffix(path)

        # Replace the path to .CSS files with their source .SCSS.  They'll be
        # compiled by handle_css.
        if path.suffix == '.scss':
            name = PurePosixPath(name)
            name = name.with_suffix('.css')
            name = name.as_posix()

        url = urllib.parse.urljoin(str(base_url), name)
        results[name] = url + suffix

    return results

def handle_init(request):
    # The startup script is included with init data to simplify bootstrapping.
    startup_path = Path('web/vview/app-startup.js')
    with startup_path.open('rt', encoding='utf-8') as startup_file:
        startup_script = startup_file.read()

        # Add a source URL.
        url = urllib.parse.urljoin(str(request.url), startup_path.relative_to('web/vview').as_posix())
        startup_script += f'\n//# sourceURL={url}\n'

    init = {
        'modules': _get_modules(request.url),
        'resources': _get_resources(request.url),
        'startup': startup_script,
        'version': 'native',
    }
    source_files_json = json.dumps(init, indent=4) + '\n'

    return aiohttp.web.Response(body=source_files_json, headers={
        'Content-Type': 'application/json',

        # This is the one file we really don't want cached, since this is where we
        # trigger reloads for everything else if they're modified.
        'Cache-Control': 'no-store',
    })

_override_cache = None
def _resolve_path(request, path):
    """
    Resolve a path for a script or resource request.

    Normally, this is just a path relative to root_dir.  We also support overrides, which
    allow applying an overlay to add or replace files in the source tree.
    """
    global _override_cache
    if _override_cache is None:
        # Convert overrides to (src, dst) paths.
        path_overrides = request.app['server'].auth.data.get('overrides', [])
        _override_cache = []
        for src, dst in path_overrides.items():
            src = Path(src)
            dst = Path(dst)
            _override_cache.append((src, dst))

    path = Path(path)

    # See if the path is inside an override.
    for src, dst in _override_cache:
        if not path.is_relative_to(src):
            continue

        path_inside_src = path.relative_to(src)
        path_inside_dst = dst / path_inside_src
        if path_inside_dst.exists():
            return path_inside_dst

    # Resolve the path relative to the root directory normally.
    path = root_dir / path
    path = path.resolve()
    assert path.relative_to(root_dir)
    return path

def handle_client(request):
    path = request.match_info['path']
    as_data_url = 'data' in request.query
    path = Path(path)

    cache_control = 'public, immutable'
    if path in (Path('app-startup.js'), Path('startup/bootstrap.js')):
        # Don't cache these.  They're loaded before URL cache busting is available.
        cache_control = 'no-store'

    if path.parts[0] in ('resources', 'startup', 'local'):
        # (/vview)/resources/path -> /web/resources/path
        path = 'web' / path
    else:
        # (/vview)/path -> /web/vview/path
        path = 'web/vview' / path
    
    path = _resolve_path(request, path)

    path = open_path(path)
    if not path.exists():
        raise aiohttp.web.HTTPNotFound()

    headers = {
        'Cache-Control': cache_control,
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

def handle_css(request):
    path = request.match_info['path']

    path = Path(path)
    path = root_dir / 'web' / path
    path = path.with_suffix('.scss')
    path = path.resolve()
    assert path.relative_to(root_dir)

    path = open_path(path)
    if not path.exists():
        raise aiohttp.web.HTTPNotFound()

    # Check cache.
    mtime = path.stat().st_mtime
    if_modified_since = request.if_modified_since
    if if_modified_since is not None:
        modified_time = datetime.fromtimestamp(mtime, timezone.utc)
        modified_time = modified_time.replace(microsecond=0)

        if modified_time <= if_modified_since:
            raise aiohttp.web.HTTPNotModified()

    build = Build()

    # The source root for the CSS source map needs to be an absolute URL, since it might be
    # loaded into the user script and a relative domain will resolve to that domain instead
    # of ours.
    base_url = request.url.with_query('').with_path('/vview')
    data = build.build_css(path.path, embed_source_root=str(base_url))

    response = aiohttp.web.Response(body=data, headers={
        'Cache-Control': 'public, immutable',
        'Content-Type': 'text/css; charset=utf-8',
    })

    response.last_modified = mtime
    return response

    