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

    async function fetch_source(path)
    {
        // Load the source file.
        let url = new URL(path, root_url);
        let source_fetch = await fetch(url);

        let data = await source_fetch.text();
        if(data == null)
            return;

        // Add sourceURL to source files.  Remove the mtime query so it doesn't clutter logs.
        let source_url = new URL(source_fetch.url);
        source_url.search = "";
        data += "\n";
        data += `//# sourceURL=${url}\n`;

        env.resources[path] = data;
    }

    async function load_resource(path, url)
    {
        url = new URL(url, root_url);

        // Just load binary resources and CSS as URLs.  This lets them be cached normally.
        // It also make CSS source maps work when running the script on Pixiv but hosting
        // it on a local server, which doesn't work if we load the stylesheet as text.
        //
        // If we're not native (we're running on Pixiv), don't do this for PNGs, since Chrome
        // spams the console with mixed content warnings that weren't thought out very well.
        // (Why is it warning about insecure connections to localhost?)
        let filename = (new URL(path, root_url)).pathname;
        if((env.native && filename.endsWith(".png")) || filename.endsWith(".scss"))
        {
            env.resources[path] = url;
            return;
        }

        // Other resources are loaded as text resources.  This is needed for SVG because we
        // sometimes need to preprocess them, so we can't just point at their URL.
        let source_fetch = await fetch(url);

        if(path.endsWith(".png"))
        {
            // Load any binary resources into object URLs.
            let blob = await source_fetch.blob();
            if(blob == null)
                return;

            env.resources[path] = URL.createObjectURL(blob);
            return;
        }

        let data = await source_fetch.text();
        if(data == null)
            return;

        // Add sourceURL to source files.  Remove the mtime query so it doesn't clutter logs.
        let source_url = new URL(url);
        source_url.search = "";

        if(url.pathname.endsWith(".js"))
        {
            data += "\n";
            data += `//# sourceURL=${source_url}\n`;
        }

        env.resources[path] = data;
    }

    // Fetch each source file.  Do this in parallel.
    for(let path of init.source_files)
        source_fetches[path] = fetch_source(path);

    for(let [path, url] of Object.entries(init.resources))
        source_fetches[path] = load_resource(path, url);

    // Wait for all fetches to complete.
    await Promise.all(Object.values(source_fetches));

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
