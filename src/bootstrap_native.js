// This is the main entry point when we're running natively (not on Pixiv), and
// is loaded by index.html.  It's similar to bootstrap.js, but for native and debug
// launches.
//
// It can also be used for loading ppixiv (when running on Pixiv) by pointing a
// user script at it.  This is useful for debugging and makes it easier to quickly
// reload changes.  The debug user script (ppixiv-debug.user.js) can also be used
// for this, but that only works with script managers that support loading from the
// filesystem (only TamperMonkey does this, and only in Chrome), it needs to be
// updated manually if files are added to the build, and it can't update SCSS.

let _load_source_file = function(__pixiv, __source) {
    const ppixiv = __pixiv;
    with(ppixiv)
    {
        return eval(__source);
    }
};

(async() =>
{
    console.log("ppixiv bootstrap");

    // In a development build, our source and binary assets are in @resources, and we need
    // to pull them out into an environment manually.
    let env = {};

    // If we're not running on Pixiv, set env.native to indicate that we're in our native
    // environment.
    env.native = window.location.hostname != "pixiv.net" && window.location.hostname != "www.pixiv.net";
    env.resources = {};

    // If we're running natively, the scripts are on the same root path we're on, and we can
    // just resolve URLs relatively.  If we're on Pixiv then we need to load scripts from the
    // native server instead.
    let root_url = env.native? window.location:"http://127.0.0.1:8235";

    // init.js gives us the list of source and resource files to load.
    let result = await fetch(new URL("/client/init.js", root_url));
    let init = await result.json();

    // Fetch each source file.  Do this in parallel.
    let source_fetches = {};
    for(let path of init.source_files)
    {
        // Load the source file.
        let url = new URL(path, root_url);
        source_fetches[path] = fetch(url);
    }

    for(let [path, url] of Object.entries(init.resources))
    {
        url = new URL(url, root_url);

        // Just load binary resources and CSS as URLs.  This lets them be cached normally.
        // It also make CSS source maps work when running the script on Pixiv but hosting
        // it on a local server, which doesn't work if we load the stylesheet as text.
        let filename = (new URL(path, root_url)).pathname;
        if(filename.endsWith(".png") || filename.endsWith(".scss"))
        {
            env.resources[path] = url;
            continue;
        }

        // Other resources are loaded as text resources.  This is needed for SVG because we
        // sometimes need to preprocess them, so we can't just point at their URL.
        source_fetches[path] = fetch(url);
    }

    // Wait for all fetches to complete.
    await Promise.all(Object.values(source_fetches));

    for(let [path, source_fetch] of Object.entries(source_fetches))
    {
        source_fetch = await source_fetch;
        let data = await source_fetch.text();
        if(data == null)
            continue

        // Add sourceURL to source files.  Remove the mtime query so it doesn't clutter logs.
        let url = new URL(source_fetch.url);
        url.search = "";

        if(url.pathname.endsWith(".js"))
        {
            data += "\n";
            data += `//# sourceURL=${url}\n`;
        }

        env.resources[path] = data;
    }

    // Load each source file.
    for(let path of init.source_files)
    {
        let source = env.resources[path];
        if(!source)
        {
            console.error("Source file missing:", path);
            continue;
        }

        _load_source_file(env, source);
    }

    // If we're running natively, set unsafeWindow like a user script would have.
    if(env.native)
        window.unsafeWindow = window;
    window.ppixiv = env;

    // Create the main controller.
    env.main_controller.launch();
})();
