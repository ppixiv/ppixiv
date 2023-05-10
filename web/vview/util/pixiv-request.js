
// The CSRF token and user ID that Pixiv sends with its API calls.  csrfToken is an
// ancient holdover from before CORS and doesn't seem to actually be checked by the
// server, but we send it for consistency.
let requestInfo = {
    csrfToken: null,
    userId: null,
}

// Set the request info to use for future Pixiv API calls.
export function setPixivRequestInfo({csrfToken, userId})
{
    requestInfo.csrfToken = csrfToken;
    requestInfo.userId = userId;
}

export async function get(url, data, options)
{
    let params = createSearchParams(data);

    let query = params.toString();
    if(query != "")
        url += "?" + query;

    let result = await sendPixivRequest({
        method: "GET",
        url: url,
        responseType: "json",
        signal: options?.signal,
        cache: options?.cache,

        headers: {
            Accept: "application/json",
        },
    });

    // If the result isn't valid JSON, we'll get a null result.
    if(result == null)
        result = { error: true, message: "Invalid response" };

    return result;
}

function createSearchParams(data)
{
    let params = new URLSearchParams();
    for(let key in data)
    {
        // If this is an array, add each entry separately.  This is used by
        // /ajax/user/#/profile/illusts.
        let value = data[key];
        if(Array.isArray(value))
        {
            for(let item of value)
                params.append(key, item);
        }
        else
            params.append(key, value);
    }
    return params;
}

export async function post(url, data)
{
    let result = await sendPixivRequest({
        "method": "POST",
        "url": url,
        "responseType": "json",

        "data" :JSON.stringify(data),

        "headers": {
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
        },
    });        

    return result;
}

// Some API calls are form-encoded:
export async function rpcPost(url, data)
{
    let result = await sendPixivRequest({
        method: "POST",
        url: url,

        data: encodeQuery(data),
        responseType: "json",

        headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
    });

    return result;
}

function encodeQuery(data)
{
    let str = [];
    for(let key in data)
    {
        if(!data.hasOwnProperty(key))
            continue;

        str.push(encodeURIComponent(key) + "=" + encodeURIComponent(data[key]));
    }    
    return str.join("&");
}

// Send a request with the referer, cookie and CSRF token filled in.
export async function sendPixivRequest({...options})
{
    options.headers ??= {};

    // Only set x-csrf-token for requests to www.pixiv.net.  It's only needed for API
    // calls (not things like ugoira ZIPs), and the request will fail if we're in XHR
    // mode and set headers, since it'll trigger CORS.
    let hostname = new URL(options.url, window.location).hostname;
    if(hostname == "www.pixiv.net" && requestInfo.csrfToken)
    {
        options.headers["x-csrf-token"] = requestInfo.csrfToken;
        options.headers["x-user-id"] = requestInfo.userId;
    }

    let result = await sendRequest(options);
    if(result == null)
        return null;

    // Return the requested type.  If we don't know the type, just return the
    // request promise itself.
    if(options.responseType == "json")
    {
        // Pixiv sometimes returns HTML responses to API calls on error, for example if
        // bookmark_add.php is called to follow a user without specifying recaptcha_enterprise_score_token.
        try {
            return await result.json();
        } catch(e) {
            let message = `${result.status} ${result.statusText}`;
            console.log(`Couldn't parse API result for ${options.url}: ${message}`);
            return { error: true, message };
        }
    }

    if(options.responseType == "document")
    {
        let text = await result.text();
        return new DOMParser().parseFromString(text, 'text/html');
    }

    return result;
}

async function sendRequest(options)
{
    if(options == null)
        options = {};

    let data = { };
    data.method = options.method || "GET";
    data.signal = options.signal;
    data.cache = options.cache ?? "default";
    if(options.data)
        data.body = options.data 

    // Convert options.headers to a Headers object.
    if(options.headers)
    {
        let headers = new Headers();
        for(let key in options.headers)
            headers.append(key, options.headers[key]);
        data.headers = headers;
    }

    let fetch = window.realFetch ?? window.fetch;

    try {
        return await fetch(options.url, data);
    } catch(e) {
        // Don't log an error if we were intentionally aborted.
        if(data.signal && data.signal.aborted)
            return null;
            
        console.error("Error loading %s", options.url, e);
        if(options.data)
            console.error("Data:", options.data);
        return null;
    }
}

// Load a URL as a document.
export async function fetchDocument(url, headers={}, options={})
{
    return await this.sendPixivRequest({
        method: "GET",
        url: url,
        responseType: "document",
        cache: options.cache,
        headers,
        ...options,
    });
}
