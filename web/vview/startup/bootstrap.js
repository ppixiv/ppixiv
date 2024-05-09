// This is the entry point when running as a user script.  bundle is the packaged
// app bundle.  We'll run the app bundle in the page context.
//
// When running natively for vview, app-startup.js is launched directly and this isn't used.
async function Bootstrap({bundle}={})
{
    // If this is an iframe, don't do anything, so we don't try to load in Pixiv iframes.
    if(window.top != window.self)
        return;

    // Don't activate for things like sketch.pixiv.net.
    if(window.location.hostname.endsWith(".pixiv.net") && window.location.hostname != "www.pixiv.net")
        return;

    // Some script managers define this on window, some as a local, and some not at all.
    let info = typeof GM_info != "undefined"? GM_info:null;

    console.log(`ppixiv is running in ${info?.scriptHandler} ${info?.version}`);

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
            let {
                url,
                method="GET",
                formData,
                responseType="arraybuffer",
                headers=null,
            } = e.data;

            // console.log("GM.xmlHttpRequest request for:", url);

            // If we were given a FormData in the form of an object, convert it to a
            // FormData.  For some reason FormData objects themselves can't be sent
            // over a MessagePort.
            let data = null;
            if(formData)
            {
                data = new FormData();
                for(let [key, value] of Object.entries(formData))
                {
                    // The value might be a blob or an ArrayBuffer.  Convert it to a blob.
                    //
                    // A bug in Firefox and/or FireMonkey causes the ArrayBuffer to be from the
                    // page context instead of the script context, which breaks "value instanceof ArrayBuffer".
                    // We can just not check, since constructing a blob from a blob doesn't hurt
                    // anything.
                    value = new Blob([value]);
                
                    data.append(key, value);
                }
            }
        
            // Some script managers don't implement @connect and let user scripts access anything.
            // Check the hostnames we give access to in case the script manager isn't.
            url = new URL(url);
            let allowedHosts = [
                "i.pximg.net", "i-cf.pximg.net", "cotrans.touhou.ai"
            ];
            let anyMatches = false;
            for(let host of allowedHosts)
                if(url.hostname.endsWith(host))
                    anyMatches = true;

            if(!anyMatches)
            {
                responsePort.xhrServerPostMessage({ success: false, error: `Unexpected ppdownload URL: ${url}` });
                return;
            }

            GM.xmlHttpRequest({
                method, headers,
                responseType,

                // TamperMonkey takes a URL object, but ViolentMonkey throws an exception unless we
                // convert to a string.
                url: url.toString(),
                data,

                onload: (result) => {
                    let success = result.status < 400;
                    let error = `HTTP ${result.status}`;
                    let { response } = result;

                    // If the response is an ArrayBuffer, add it to the transfer list so we don't
                    // make a copy.
                    let transfer = [];
                    if(response instanceof ArrayBuffer)
                        transfer.push(response);

                    responsePort.xhrServerPostMessage({ success, error, response }, transfer);
                },

                // This API is broken and doesn't actually include any information about the error.
                onerror: (e) => {
                    responsePort.xhrServerPostMessage({ success: false, error: "Request error" });
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

    runScript(bundle);
}

// This script is executed by eval(), so this expression is its return value.
Bootstrap;