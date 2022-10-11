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

(async() =>
{
    // If this is an iframe, don't do anything, so if we're a debug environment for Pixiv we don't
    // try to load in Pixiv iframes.  Do run if we're in an iframe on another site, to allow
    // similar image iframes.
    if(window.location.hostname == "www.pixiv.net" && window.top != window.self)
        return;

    // Make sure that we're not loaded more than once.  This can happen if we're installed in
    // multiple script managers, or if the release and debug versions are enabled simultaneously.
    if(document.documentElement.dataset.ppixivLoaded)
    {
        console.error("ppixiv has been loaded twice.  Is it loaded in multiple script managers?");
        return;
    }

    document.documentElement.dataset.ppixivLoaded = "1";

    console.log("ppixiv native bootstrap");

    // native is true if we're running in our native environment, or false if we're running on
    // Pixiv.
    let native = location.hostname != "pixiv.net" && location.hostname != "www.pixiv.net";
    let ios = navigator.platform.indexOf('iPhone') != -1 || navigator.platform.indexOf('iPad') != -1;
    let android = navigator.userAgent.indexOf('Android') != -1;

    // Figure out our native server URL.
    //
    // If window.vviewURL is set, use it.  Otherwise, if we're running natively then the
    // server is the current URL.  Otherwise, fall back on localhost, which is used for
    // development when running on Pixiv.
    let root_url = window.vviewURL;
    root_url ??= native? window.location:"http://127.0.0.1:8235";

    // When we load into Pixiv with the regular loader (bootstrap.js), we're always loading
    // synchronously, since everything is packaged into the user script.  Here we're loading
    // for development and downloading the source files from the local server.  To make this
    // behave the same as the regular script, we need to load the files synchronously.  Otherwise,
    // the site will have a chance to start running, and it'll start setting up event handlers
    // and other things that we won't be able to remove.
    //
    // Browser developers assume that if they can't think of a use case for something, it doesn't
    // exist, and that they should life make difficult for anyone who needs to do something they
    // didn't think of.  As a result, they've intentionally made sync XHR hard to use: it won't
    // let us set responseType: blob for loading binary resources.  We work around this by requesting
    // a data URL from the local server instead.  It'll be loaded into a blob later in the same way
    // it is with the packaged script.
    //
    // We don't need to be sync if we're running natively, since we're not racing against a website
    // loading, so we switch back to normal async fetch if possible.  It avoids browsers screaming
    // bloody murder about sync XHR, and it loads a bit faster.
    //
    // We also don't do this if we're running on iOS.  It's very slow, and since the mobile site doesn't
    // do all the weird stuff the desktop site does, it's not as important.
    async function get(url, { as_url=false }={})
    {
        if(native || ios)
        {
            let result = await fetch(new URL(url, root_url));
            if(as_url)
            {
                let blob = await result.blob();
                return URL.createObjectURL(blob);
            }
            else
                return await result.text();
        }
        else
        {
            // If the caller wants a data URL, add data=1 to the URL.
            if(as_url)
            {
                let query = new URLSearchParams(url.search);
                query.set("data", "1");
                url = new URL(url);
                url.search = query.toString();
            }    
    
            let xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.send();
            
            return xhr.response;
        }
    }

    // init.js gives us the list of source and resource files to load.
    let result = await get(new URL("/client/init.js", root_url));
    let init = JSON.parse(result);

    // Fetch each source file.  Do this in parallel.
    let source_fetches = {};

    let resources = {};
    async function fetch_source(path)
    {
        // Load the source file.
        let url = new URL(path, root_url);
        let data = await get(url);
        if(data == null)
            return;

        // Add sourceURL to source files.  Remove the mtime query so it doesn't clutter logs.
        let source_url = new URL(url);
        source_url.search = "";
        data += "\n";
        data += `//` + `# sourceURL=${source_url}\n`; // split so browsers don't interpret this line as a sourceURL

        resources[path] = data;
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
        let binary = filename.endsWith(".png") || filename.endsWith(".woff");
        if((native && binary) || filename.endsWith(".scss"))
        {
            resources[path] = url;
            return;
        }

        // Other resources are loaded as text resources.  This is needed for SVG because we
        // sometimes need to preprocess them, so we can't just point at their URL.
        // let source_fetch = await fetch(url);
        let data = await get(url, { as_url: binary });
        if(data == null)
            return;

        if(binary)
        {
            // Load any binary resources into object URLs.
            resources[path] = data;
            return;
        }

        // Add sourceURL to source files.  Remove the mtime query so it doesn't clutter logs.
        let source_url = new URL(url);
        source_url.search = "";

        if(url.pathname.endsWith(".js"))
        {
            data += "\n";
            data += `//# sourceURL=${source_url}\n`; // split so browsers don't interpret this line as a sourceURL
        }

        resources[path] = data;
    }

    // Fetch each source file.  Do this in parallel.
    for(let path of init.source_files)
        source_fetches[path] = fetch_source(path);

    for(let [path, url] of Object.entries(init.resources))
        source_fetches[path] = load_resource(path, url);

    // Wait for all fetches to complete.
    await Promise.all(Object.values(source_fetches));

    // Create the environment.  This is the same object we start with in bootstrap.js when we're
    // running in a packaged user script.
    let env = {
        resources,
        version: 'native',
        native,
        ios,
        android,
        mobile: ios || android,
    };

    // If we're running natively or unsandboxed we can just set properties on window, but we do the
    // rest of setup the same way bootstrap.js does, so when this is used for userscript development
    // things work as similarly as possible to a release package.
    function run_script(source)
    {
        let script = document.createElement("script");
        script.textContent = source;
        document.documentElement.appendChild(script);
        script.remove();
    }

    // The environment becomes window.ppixiv.
    run_script(`window.ppixiv = ${JSON.stringify(env)}`);

    // Load each source file.
    for(let path of init.source_files)
    {
        let source = env.resources[path];
        if(!source)
        {
            console.error("Source file missing:", path);
            continue;
        }

        run_script(`with(ppixiv) { ${source} }`);
    }

    // Create the main controller.
    run_script(`ppixiv.main_controller = new ppixiv.MainController();`);
})();
