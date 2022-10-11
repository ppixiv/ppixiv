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

    function run_script(source)
    {
        let script = document.createElement("script");
        script.textContent = source;
        document.documentElement.appendChild(script);
        script.remove();
    }

    // Create window.ppixiv.
    run_script(`window.ppixiv = ${JSON.stringify(ppixiv)}`);

    // Load each source file.
    for(let path of env.init.source_files)
    {
        let source = env.resources[path];
        if(!source)
        {
            console.error("Source file missing:", path);
            continue;
        }

        run_script(`with(ppixiv) { ${source} }`);
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

    // Create the main controller.
    run_script(`ppixiv.main_controller = new ppixiv.MainController();`);
}
