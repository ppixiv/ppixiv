
// If we're running as a user script, we may have access to GM.xmlHttpRequest.  This is
// sandboxed and exposed using a download port.  The server side of this is inside
// bootstrap.js.
let _downloadPort = null;

// Return a promise which resolves to the download MessagePort.
function _getDownloadServer()
{
    // If we already have a download port, return it.
    if(_downloadPort != null)
        return _downloadPort;

    _downloadPort = new Promise((accept, reject) => {
        // Send request-download-channel to window to ask the user script to send us the
        // GM.xmlHttpRequest message port.  If this is handled and we can expect a response,
        // the event will be cancelled.
        let e = new Event("request-download-channel", { cancelable: true });
        if(window.dispatchEvent(e))
        {
            reject("GM.xmlHttpRequest isn't available");
            return;
        }

        // The MessagePort will be returned as a message posted to the window.
        let receiveMessagePort = (e) => {
            if(e.data.cmd != "download-setup")
                return;

            window.removeEventListener("message", receiveMessagePort);
            _downloadPort = e.ports[0];
            accept(e.ports[0]);
        };

        window.addEventListener("message", receiveMessagePort);
    });
    return _downloadPort;
}

// Download a Pixiv image using a GM.xmlHttpRequest server port retrieved
// with _getDownloadServer.
function _downloadUsingServer(serverPort, { url, ...args })
{
    return new Promise((accept, reject) => {
        if(url == null)
        {
            reject(null);
            return;
        }

        url = new URL(url);

        // Send a message to the sandbox to retrieve the image with GM.xmlHttpRequest, giving
        // it a message port to send the result back on.
        let { port1: serverResponsePort, port2: clientResponsePort } = new MessageChannel();

        clientResponsePort.onmessage = (e) => {
            clientResponsePort.close();
            
            if(e.data.success)
                accept(e.data.response);
            else
                reject(e.data.error);
        };

        serverPort.realPostMessage({
            url: url.toString(),
            ...args,
        }, [serverResponsePort]);
    });
}

// Download url, returning the data.
//
// This is only used to download Pixiv images to save to disk.  Pixiv doesn't have CORS
// set up to give itself access to its own images, so we have to use GM.xmlHttpRequest to
// do this.
export async function downloadPixivImage(url)
{
    let server = await _getDownloadServer();
    if(server == null)
        throw new Error("Downloading not available");

    return await _downloadUsingServer(server, {
        url,
        headers: {
            "Cache-Control": "max-age=360000",
            Referer: "https://www.pixiv.net/",
            Origin: "https://www.pixiv.net/",
        },
    });
}

export async function downloadPixivImages(urls)
{
    let results = [];
    for(let url of urls)
    {
        let result = await downloadPixivImage(url);
        results.push(result);
    }

    return results;
}

// Make a direct request to the download server.
export async function sendRequest(args)
{
    let server = await _getDownloadServer();
    if(server == null)
        throw new Error("Downloading not available");

    return await _downloadUsingServer(server, args);
}
