# This handles serving the UI so it can be run independently.

import aiohttp, asyncio, json
import sass
from pathlib import Path, PurePosixPath
from .util.paths import open_path
from .source_files import source_files

root_dir = Path(__file__) / '..' / '..' / '..' # XXX gross
root_dir = root_dir.resolve()

# /client/js -> root/src
# /client/resources -> root/resources
# /client/binary-resources.js -> output/resources.js
# XXX: generate this for distribution so we don't need to require libsass
# /client/main.scss -> root/output/main.scss XXX: generate this

# XXX: hash for cache expiration
def handle_css(request):
    pass

def add_routes(router):
    router.add_get('/client/source-files.js', handle_source_files)
    router.add_get('/client/{path:.*}', handle_client)
    router.add_get('/', handle_root)

def handle_root(request):
    path = root_dir / 'resources/index.html'
    if not path.exists():
        raise aiohttp.web.HTTPNotFound()

    return aiohttp.web.FileResponse(path, headers={
        'Cache-Control': 'public, no-cache',
    })

def get_source_files():
    # Map src/path -> /client/js/path
    results = []
    for path in source_files:
        path = PurePosixPath(path)
        path = path.relative_to(PurePosixPath('src'))
        path = '/client/js' / path
        results.append(str(path))

    # Add binary-resources, which isn't in the source file list.
    results.append("/client/binary-resources.js")
    return results

def handle_source_files(request):
    sources = get_source_files()
    source_files_json = json.dumps(sources, indent=4) + '\n'

    return aiohttp.web.Response(body=source_files_json, headers={
        'Content-Type': 'application/json',
    })

def handle_client(request):
    path = request.match_info['path']
    path = Path(path)

    if path.parts[0] == 'js':
        path = Path(*path.parts[1:])
        path = 'src' / path
        print(path)
    elif str(path) == 'binary-resources.js':
        # XXX: generate this server-side
        path = Path('output/resources.js')
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

    return aiohttp.web.FileResponse(path, headers={
        'Cache-Control': 'public, immutable',
    })
