import asyncio, sys, os, importlib
from pathlib import Path

# VS Code gives ${path} for the path to the current file, and it lets you run
# a module, but it doesn't have ${module} to let you run the current file as
# a module.  Take a path and import it as a module to test things normally.
def go():
    target = Path(sys.argv[1]).resolve()
    top = Path(__file__).parent.parent.resolve()
    print(top)

    relative_path = list(target.relative_to(top).parts)
    relative_path[-1] = relative_path[-1].split('.')[0]
    assert relative_path[0] == 'vview'

    sys.path.append(str(Path(os.getcwd())))
    target = importlib.import_module('.'.join(relative_path))

    async def start():
        asyncio.get_event_loop().set_debug(True)
        await target.test()
    asyncio.run(start())

if __name__ == '__main__':
    go()
