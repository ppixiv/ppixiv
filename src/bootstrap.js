// This is the main entry point.
//
// There are three major modes of operation:
//
// - Running as a packaged user script (ppixiv).  env contains our packaged sources and
// other files, which are packaged by build_ppixiv.py into ppixiv.user.js.
// - Running standalone, loaded from index.html (vview).  env is null, and window.NativeLoader
// can be used to load it from the server.
// - Running as a debug user script (ppixiv-debug.user.js).  This works the same as standalone,
// but we're running in a user script and may be sandboxed.
async function Bootstrap(env)
{
    // If this is an iframe, don't do anything, so we don't try to load in Pixiv iframes.
    if(window.top != window.self)
        return;

    // Don't activate for things like sketch.pixiv.net.
    if(window.location.hostname.endsWith(".pixiv.net") && window.location.hostname != "www.pixiv.net")
        return;

    // If we're running in a user script and GM_info is available, log the script manager and
    // script manager version.
    try {
        console.log("ppixiv is running in", GM_info?.scriptHandler, GM_info?.version);
    } catch(e) {
    }

    // Make sure that we're not loaded more than once.  This can happen if we're installed in
    // multiple script managers, or if the release and debug versions are enabled simultaneously.
    if(document.documentElement.dataset.ppixivLoaded)
    {
        console.error("ppixiv has been loaded twice.  Is it loaded in multiple script managers?");
        return;
    }

    document.documentElement.dataset.ppixivLoaded = "1";

    // native is true if we're running in our native environment, or false if we're running on
    // Pixiv.
    let native = location.hostname != "pixiv.net" && location.hostname != "www.pixiv.net";
    let ios = navigator.platform.indexOf('iPhone') != -1 || navigator.platform.indexOf('iPad') != -1;
    let android = navigator.userAgent.indexOf('Android') != -1;

    // When running as a user script, env is packaged into the script.  If we don't have it, we're
    // either running natively for vview or in development mode for ppixiv, and we need to load it
    // from the local server.  Note that if env is set and we're running in the user script, NativeLoader
    // won't exist.
    if(env == null)
        env = await NativeLoader.load(native, ios);

    console.log(`${native? "vview":"ppixiv"} ${env.version} bootstrap`);

    // Create the environment.
    let ppixiv = {
        resources: env.resources,
        version: env.version,
        native,
        ios,
        android,
        mobile: ios || android,
    };

    let showed_error = false;
    function run_script(source, { path }={})
    {
        let script = document.createElement("script");

        // For some reason script.onerror isn't called, and we have to do this on window.onerror.
        let success = true;
        let onerror = (e) => {
            success = false;
            if(showed_error)
                return;
            showed_error = true;
            if(path) path = ' ' + path;
            alert(`Error loading ppixiv${path ?? ''}:\n\n${e.message}`);
        };

        // For now, don't use this on iOS.  For some reason this sometimes picks up random errors
        // from Pixiv that don't affect us and pops up an alert dialog.  It's not obvious why, since
        // inserting a script node shouldn't be causing other script nodes to be run synchronously.
        if(ios)
            onerror = null;

        window.addEventListener("error", onerror);
        script.textContent = source;
        document.documentElement.appendChild(script);
        window.removeEventListener("error", onerror);
        script.remove();

        return success;
    }

    // Create window.ppixiv.
    run_script(`window.ppixiv = ${JSON.stringify(ppixiv)}`, { path: "environment" });

    // Load each source file.
    for(let path of env.init.source_files)
    {
        let source = env.resources[path];
        if(!source)
        {
            console.error("Source file missing:", path);
            continue;
        }

        // Stop loading if a file fails to load.
        if(!run_script(`with(ppixiv) { ${source} }`, { path }))
            return;
    }

    // If we're running in a user script and we have access to GM.xmlHttpRequest, give access to
    // it to support saving image files to disk.  Since we may be sandboxed, we do this through
    // a MessagePort.  We have to send this to the page, since the page has no way to send messages
    // to us on its own.
    //
    // helpers.cleanup_environment disables postMessage.  If we're not sandboxed, we'll be affected
    // by this too, so save a copy of postMessage in the same way that it does.
    window.MessagePort.prototype.xhrServerPostMessage = window.MessagePort.prototype.postMessage;
    function create_xhr_handler()
    {
        let { port1: client_port, port2: server_port }  = new MessageChannel();
        window.postMessage({ cmd: "download-setup" }, "*", [client_port]);

        server_port.onmessage = (e) => {
            let response_port = e.ports[0];
            let { url } = e.data;

            console.log("GM.xmlHttpRequest request for:", url);

            // It's harmless for the site to gain access to GM.xmlHttpRequest, since we only @connect
            // to the site's own image host anyway.  But we might as well can check anyway:
            url = new URL(url);
            if(url.hostname != "i.pximg.net" && url.hostname != "i-cf.pximg.net")
            {
                response_port.xhrServerPostMessage({ success: false, error: `Unexpected ppdownload URL: ${url}` });
                return;
            }

            GM.xmlHttpRequest({
                ...e.data.options,

                // TamperMonkey takes a URL object, but ViolentMonkey throws an exception unless we
                // convert to a string.
                url: url.toString(),

                onload: (result) => response_port.xhrServerPostMessage({ success: true, response: result.response }),
                onerror: (e) => {
                    response_port.xhrServerPostMessage({ success: false, error: e.error });
                },
            });
        };
    }

    // Listen to requests from helpers._get_xhr_server.
    window.addEventListener("request-download-channel", (e) => {
        e.preventDefault();
        create_xhr_handler();
    });

    console.log(`${ppixiv.native? "vview":"ppixiv"} setup`);
    console.log("Browser:", navigator.userAgent);

    // Create the main controller.
    run_script(`new ppixiv.AppStartup();`, { path: "controller" });
}
