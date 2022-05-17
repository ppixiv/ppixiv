# This handles serving the UI so it can be run independently.

import aiohttp, asyncio, json
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from ..util.paths import open_path
from ..build.build_ppixiv import Build
from ..build.source_files import source_files

root_dir = Path(__file__) / '..' / '..' / '..' # XXX gross
root_dir = root_dir.resolve()

# /client/js -> root/src
# /client/resources -> root/resources
# XXX: generate this for distribution so we don't need to require libsass
# /client/main.scss -> root/output/main.scss XXX: generate this

def handle_css(request):
    pass

def add_routes(router):
    router.add_get('/client/init.js', handle_source_files)
    router.add_get('/client/{path:.*\.css}', handle_css)
    router.add_get('/client/{path:.*}', handle_client)
    router.add_get('/', handle_root)

def handle_root(request):
    path = root_dir / 'resources/index.html'
    if not path.exists():
        raise aiohttp.web.HTTPNotFound()

    return aiohttp.web.FileResponse(path, headers={
        'Cache-Control': 'public, no-cache',
    })

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
    path = Path(path)

    cache_control = 'public, immutable'
    if path == Path('js/bootstrap_native.js'):
        # Don't cache bootstrap_native.js.  That's where the URL cache busting itself
        # actually happens, so we can't cache it or we'll have no way of refreshing it.
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

    response = aiohttp.web.FileResponse(path, headers={
        'Cache-Control': cache_control,
    })

    # mimetypes doesn't know about .scss.  Fill it in, so these URLs open normally.
    if path.suffix == '.scss':
        response.content_type = 'text/scss'

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

    