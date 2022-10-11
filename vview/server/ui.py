# This handles serving the UI so it can be run independently.

import aiohttp, asyncio, base64, os, json, mimetypes
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from ..util import misc
from ..util.paths import open_path
from ..build.build_ppixiv import Build
from ..build.source_files import source_files

root_dir = Path(__file__) / '..' / '..' / '..' # XXX gross
root_dir = root_dir.resolve()

# Work around a bug in the Python mimetypes module: it imports MIME types from
# the Windows registry, allowing them to override the built-in MIME types.  That's
# bad, because there's lot of crap in every Windows registry, which makes mimetypes
# behave unpredictably.  Because of this, we need to explicitly register the MIME
# types we use.  Python should import from the registry first (if at all, this is
# a source of nasty cross-system differences) so the built-in types take priority.
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/scss', '.scss')

def add_routes(router):
    router.add_get('/client/init.js', handle_source_files)
    router.add_get('/client/{path:.*\.css}', handle_css)
    router.add_get('/client/{path:.*}', handle_client)

    router.add_get('/', handle_resource('resources/index.html'))

    # Chrome asks for favicon.ico sometimes, such as when viewing an image directly.  Give
    # it a PNG instead.
    router.add_get('/favicon.ico', handle_resource('resources/vview-icon.png'))

def handle_resource(path):
    """
    Handle returning a specific file inside resources.
    """
    path = root_dir / path

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

def get_source_files():
    # Map src/path -> /client/js/path
    results = []
    files = list(source_files)
    # files.append()
    for path in files:
        path = PurePosixPath(path)
        suffix = _get_path_timestamp_suffix(path)

        path = path.relative_to(PurePosixPath('src'))
        path = '/client/js' / path
        results.append(str(path) + suffix)

    return results

def get_resources():
    build = Build()

    results = {}
    for name, path in build.get_resource_list().items():
        suffix = _get_path_timestamp_suffix(path)

        # Replace the path to .CSS files with their source .SCSS.  They'll be
        # compiled by handle_css.
        if path.suffix == '.scss':
            path = path.with_suffix('.css')

        url = PurePosixPath('/client') / PurePosixPath(path)
        results[name] = url.as_posix() + suffix

    return results

def handle_source_files(request):
    init = {
        'source_files': get_source_files(),
        'resources': get_resources(),
    }
    source_files_json = json.dumps(init, indent=4) + '\n'

    return aiohttp.web.Response(body=source_files_json, headers={
        'Content-Type': 'application/json',

        # This is the one file we really don't want cached, since this is where we
        # trigger reloads for everything else if they're modified.
        'Cache-Control': 'no-store',
    })

def handle_client(request):
    path = request.match_info['path']
    as_data_url = 'data' in request.query
    path = Path(path)

    cache_control = 'public, immutable'
    if path in (Path('js/bootstrap.js'), Path('js/bootstrap_native.js')):
        # Don't cache these.  They're loaded before URL cache busting is available.
        cache_control = 'no-store'

    if path.parts[0] == 'js':
        path = Path(*path.parts[1:])
        path = 'src' / path
    elif path.parts[0] == 'resources':
        # OK
        pass
    else:
        raise aiohttp.web.HTTPNotFound()
    
    path = root_dir / path
    path = path.resolve()
    assert path.relative_to(root_dir)

    path = open_path(path)
    if not path.exists():
        raise aiohttp.web.HTTPNotFound()

    headers = {
        'Cache-Control': cache_control,
    }
    
    if as_data_url:
        with open(path, 'rb') as f:
            data = f.read()
            
        mime_type = misc.mime_type(path.name) or 'application/octet-stream'
        data = base64.b64encode(data).decode('ascii')
        data = f'data:{mime_type};base64,' + data
        headers['Content-Type'] = 'text/plain'
        response = aiohttp.web.Response(body=data, headers=headers)
        response.last_modified = os.stat(path).st_mtime
    else:
        response = aiohttp.web.FileResponse(path, headers=headers)

    return response

def handle_css(request):
    path = request.match_info['path']

    path = Path(path)
    path = root_dir / path
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
    data, source_map = build.build_css(path, source_map_embed=True, embed_source_root='/client')

    response = aiohttp.web.Response(body=data, headers={
        'Cache-Control': 'public, immutable',
        'Content-Type': 'text/css; charset=utf-8',
    })

    response.last_modified = mtime
    return response

    