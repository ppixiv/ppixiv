// This is the entry point when running as a user script.
//
// A regular, production build will have all of our scripts and resources bundled together,
// and they'll be passed to us as env.  A development script can instead pass a development
// server URL for us to fetch the environment from.
//
// When running natively for vview, app-startup.js is launched directly and this isn't used.
async function Bootstrap({env, rootUrl}={})
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

    // If we're running in a user script and we have access to GM.xmlHttpRequest, give access to
    // it to support saving image files to disk.  Since we may be sandboxed, we do this through
    // a MessagePort.  We have to send this to the page, since the page has no way to send messages
    // to us on its own.
    //
    // helpers.cleanup_environment disables postMessage.  If we're not sandboxed, we'll be affected
    // by this too, so save a copy of postMessage in the same way that it does.
    window.MessagePort.prototype.xhrServerPostMessage = window.MessagePort.prototype.postMessage;
    function createXhrHandler()
    {
        let { port1: clientPort, port2: serverPort }  = new MessageChannel();
        window.postMessage({ cmd: "download-setup" }, "*", [clientPort]);

        serverPort.onmessage = (e) => {
            let responsePort = e.ports[0];
            let { url } = e.data;

            console.log("GM.xmlHttpRequest request for:", url);

            // It's harmless for the site to gain access to GM.xmlHttpRequest, since we only @connect
            // to the site's own image host anyway.  But we might as well can check anyway:
            url = new URL(url);
            if(url.hostname != "i.pximg.net" && url.hostname != "i-cf.pximg.net")
            {
                responsePort.xhrServerPostMessage({ success: false, error: `Unexpected ppdownload URL: ${url}` });
                return;
            }

            GM.xmlHttpRequest({
                ...e.data.options,

                // TamperMonkey takes a URL object, but ViolentMonkey throws an exception unless we
                // convert to a string.
                url: url.toString(),

                onload: (result) => responsePort.xhrServerPostMessage({ success: true, response: result.response }),
                onerror: (e) => {
                    responsePort.xhrServerPostMessage({ success: false, error: e.error });
                },
            });
        };
    }

    // Listen to requests from helpers._get_xhr_server.
    window.addEventListener("request-download-channel", (e) => {
        e.preventDefault();
        createXhrHandler();
    });

    function runScript(source)
    {
        let script = document.createElement("script");
        script.textContent = source;
        document.documentElement.appendChild(script);
        script.remove();
    }

    // When running as a user script, env is packaged into the script.  If we don't have it, we're
    // either running natively for vview or in development mode for ppixiv, and we need to load it
    // from rootUrl.
    if(env == null)
    {
        if(rootUrl == null)
        {
            alert("Unexpected error: no environment or root URL");
            return;
        }

        // Use sync XHR to try to mimic the regular environment as closely as possible, so we avoid
        // going async and letting page scripts run.
        let url = new URL("/web/init.js", rootUrl);
        let xhr = new XMLHttpRequest();
        xhr.open("GET", url, false);
        xhr.send();
        let result = xhr.response;

        env = JSON.parse(result);
    }

    // Run AppStartup, passing it the environment we loaded.  Make sure its script contents are on
    // the first line of the script node so sourceURL lines up.
    let { startup } = env;
    delete env.startup;

    runScript(`${startup}
        new AppStartup(${JSON.stringify({ env }) });
    `);
}
