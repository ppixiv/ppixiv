// Get and set values in localStorage.
//
// We don't use helpers.set_value/helpers.get_value since GreaseMonkey is inconsistent and changed
// these functions unnecessarily.  We could polyfill those with this, but that would cause
// the storage to change if those functions are restored.  Doing it this way also allows
// us to share settings if a user switches from GM to TM.
class settings
{
    static get_change_callback_list(key)
    {
        if(settings._callbacks == null)
            settings._callbacks = {};
        var callbacks = settings._callbacks[key];
        if(callbacks == null)
            callbacks = settings._callbacks[key] = new callback_list();
        return callbacks;
    }

    static get(key, default_value)
    {
        key = "_ppixiv_" + key;

        if(!(key in localStorage))
            return default_value;

        var result = localStorage[key];
        try {
            return JSON.parse(result);
        } catch(e) {
            // Recover from invalid values in localStorage.
            console.warn(e);
            console.log("Removing invalid setting:", result);
            delete localStorage.key;
            return default_value;
        }
    }

    static set(key, value)
    {
        // JSON.stringify incorrectly serializes undefined as "undefined", which isn't
        // valid JSON.  We shouldn't be doing this anyway.
        if(value === undefined)
            throw "Key can't be set to undefined: " + key;

        var setting_key = "_ppixiv_" + key;

        var value = JSON.stringify(value);
        localStorage[setting_key] = value;

        // Call change listeners for this key.
        settings.get_change_callback_list(key).call(key);
    }

    static register_change_callback(key, callback)
    {
        settings.get_change_callback_list(key).register(callback);
    }

    static unregister_change_callback(key, callback)
    {
        settings.get_change_callback_list(key).unregister(callback);
    }
}

var helpers = {
    get_value: function(key, default_value)
    {
        return settings.get(key, default_value);
    },

    set_value: function(key, value)
    {
        return settings.set(key, value);
    },

    // Preload an array of images.
    preload_images: function(images)
    {
        // We don't need to add the element to the document for the images to load, which means
        // we don't need to do a bunch of extra work to figure out when we can remove them.
        var preload = document.createElement("div");
        for(var i = 0; i < images.length; ++i)
        {
            var img = document.createElement("img");
            img.src = images[i];
            preload.appendChild(img);
        }
    },

    move_children: function(parent, new_parent)
    {
        for(var child = parent.firstChild; child; )
        {
            var next = child.nextSibling;
            new_parent.appendChild(child);
            child = next;
        }
    },
    
    remove_elements: function(parent)
    {
        for(var child = parent.firstChild; child; )
        {
            var next = child.nextElementSibling;
            parent.removeChild(child);
            child = next;
        }
    },

    // Return true if ancestor is one of descendant's parents, or if descendant is ancestor.
    is_above(ancestor, descendant)
    {
        var node = descendant;
        while(descendant != null && descendant != ancestor)
            descendant = descendant.parentNode;
        return descendant == ancestor;
    },

    create_style: function(css)
    {
        var style = document.createElement("style");
        style.textContent = css;
        return style;
    },

    create_from_template: function(type)
    {
        var template;
        if(typeof(type) == "string")
        {
            template = document.body.querySelector(type);
            if(template == null)
                throw "Missing template: " + type;
        }
        else
            template = type;

        var node = document.importNode(template.content, true).firstElementChild;

        // Make all IDs in the template we just cloned unique.
        for(var svg of node.querySelectorAll("svg"))
            helpers.make_svg_ids_unique(svg);

        return node;
    },

    // SVG has a big problem: it uses IDs to reference its internal assets, and that
    // breaks if you inline the same SVG more than once in a while.  Making them unique
    // at build time doesn't help, since they break again as soon as you clone a template.
    // This makes styling SVGs a nightmare, since you can only style inlined SVGs.
    //
    // <use> doesn't help, since that's just broken with masks and gradients entirely.
    // Broken for over a decade and nobody cares: https://bugzilla.mozilla.org/show_bug.cgi?id=353575
    //
    // This seems like a basic feature of SVG, and it's just broken.
    //
    // Work around it by making IDs within SVGs unique at runtime.  This is called whenever
    // we clone SVGs.
    _svg_id_sequence: 0,
    make_svg_ids_unique(svg)
    {
        let id_map = {};
        let idx = helpers._svg_id_sequence;

        // First, find all IDs in the SVG and change them to something unique.
        for(let def of svg.querySelectorAll("[id]"))
        {
            let old_id = def.id;
            let new_id = def.id + "_" + idx;
            idx++;
            id_map[old_id] = new_id;
            def.id = new_id;
        }

        // Search for all URL references within the SVG and point them at the new IDs.
        for(let node of svg.querySelectorAll("*"))
        {
            for(let attr of node.getAttributeNames())
            {
                let value = node.getAttribute(attr);
                
                // See if this is an ID reference.  We don't try to parse all valid URLs
                // here.
                var re = /url\(#.*?\)/;
                var new_value = value.replace(re, (str) => {
                    var re = /url\(#(.*)\)/;
                    var old_id = str.match(re)[1];
                    let new_id = id_map[old_id];
                    if(new_id == null)
                    {
                        console.warn("Unmatched SVG ID:", old_id);
                        return str;
                    }
                    // Replace the ID.
                    return "url(#" + new_id + ")";
                });

                node.setAttribute(attr, new_value);
            }
        }

        // Store the index, so the next call will start with the next value.
        helpers._svg_id_sequence = idx;
    },

    // Fetch a simple data resource, and call callback with the result.
    //
    // In principle this is just a simple XHR.  However, if we make two requests for the same
    // resource before the first one finishes, browsers tend to be a little dumb and make a
    // whole separate request, instead of waiting for the first to finish and then just serving
    // the second out of cache.  This causes duplicate requests when prefetching video ZIPs.
    // This works around that problem by returning the existing XHR if one is already in progress.
    _fetches: {},
    async fetch_resource(url, options)
    {
        if(options == null)
            options = {};

        // If there's an abort signal and it's already signalled, do nothing.
        if(options.signal && options.signal.aborted)
            throw "Aborted by signal";


        // If there's no ongoing fetch for this URL, create one.  Otherwise, we'll just wait
        // on the existing request.
        if(this._fetches[url] == null)
        {
            // options.signal may be an abort signal, but it only aborts this instance of the
            // request.  abort_actual_request is our internal signal to abort the actual request,
            // which we only do if every fetch for this request is aborted.
            var abort_actual_request = new AbortController();
            var request = helpers.send_pixiv_request({
                "method": "GET",
                "url": url,
                "responseType": "arraybuffer",

                "headers": {
                    "Accept": "application/json",
                },
                signal: abort_actual_request.signal,

                onprogress: function(e) {
                    for(var options of request.callers.slice())
                    {
                        try {
                            if(options.onprogress)
                                options.onprogress(e);
                        } catch(exc) {
                            console.error(exc);
                        }
                    }
                },
            });        
            request.abort_actual_request = abort_actual_request;
            this._fetches[url] = request;

            // Remember the number of times fetch_resource has been called on this URL.
            request.fetch_count = 0;
            request.callers = [];
            request.callers.push(options);
        }
        else
        {
            var request = this._fetches[url];
        }
        // Remember that another fetch was made for this resource.
        request.fetch_count++;

        // Override request.abort to reference count fetching, so we only cancel the load if
        // every caller cancels.
        request.callers.push(options);
        if(options.signal)
        {
            options.signal.addEventListener("abort", (e) => {
                // Remove this caller's callbacks, if any.
                if(options != null)
                {
                    var idx = request.callers.indexOf(options);
                    if(idx != -1)
                        request.callers.splice(idx, 1);
                }
                
                if(request.fetch_count == 0)
                {
                    console.error("Fetch was aborted more times than it was started:", url);
                    return;
                }

                request.fetch_count--;
                if(request.fetch_count > 0)
                    return;
                delete this._fetches[url];

                // Abort the underlying request.
                abort_actual_request.abort();
            });
        }

        try {
            return await request;
        } finally {
            delete helpers._fetches[url];
        }
    },

    // Prompt to save a blob to disk.  For some reason, the really basic FileSaver API disappeared from
    // the web.
    save_blob: function(blob, filename)
    {
        var blobUrl = URL.createObjectURL(blob);

        var a = document.createElement("a");
        a.hidden = true;
        document.body.appendChild(a);
        a.href = blobUrl;

        a.download = filename;
        
        a.click();

        // Clean up.
        //
        // If we revoke the URL now, or with a small timeout, Firefox sometimes just doesn't show
        // the save dialog, and there's no way to know when we can, so just use a large timeout.
        setTimeout(function() {
            window.URL.revokeObjectURL(blobUrl);
            a.parentNode.removeChild(a);
        }.bind(this), 1000);
    },

    // Return a Uint8Array containing a blank (black) image with the given dimensions and type.
    create_blank_image: function(image_type, width, height)
    {
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        var context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);

        var blank_frame = canvas.toDataURL(image_type, 1);
        if(!blank_frame.startsWith("data:" + image_type))
            throw "This browser doesn't support encoding " + image_type;

        var binary = atob(blank_frame.slice(13 + image_type.length));

        // This is completely stupid.  Why is there no good way to go from a data URL to an ArrayBuffer?
        var array = new Uint8Array(binary.length);
        for(var i = 0; i < binary.length; ++i)
            array[i] = binary.charCodeAt(i);
        return array;
    },

    // Stop the underlying page from sending XHR requests, since we're not going to display any
    // of it and it's just unneeded traffic.  For some dumb reason, Pixiv sends error reports by
    // creating an image, instead of using a normal API.  Override window.Image too to stop it
    // from sending error messages for this script.
    //
    // Firefox is now also bad and seems to have removed beforescriptexecute.  The Web is not
    // much of a dependable platform.
    block_network_requests: function()
    {
        RealXMLHttpRequest = window.XMLHttpRequest;        
        window.Image = function() { };

        dummy_fetch = function() { };
        dummy_fetch.prototype.ok = true;
        dummy_fetch.prototype.sent = function() { return this; }
        window.fetch = function() { return new dummy_fetch(); }

        window.XMLHttpRequest = function() { }
    },

    // Stop all scripts from running on the page.  This only works in Firefox.  This is a basic
    // thing for a userscript to want to do, why can't you do it in Chrome?
    block_all_scripts: function()
    {
        window.addEventListener("beforescriptexecute", function(e) {
            e.stopPropagation();
            e.preventDefault();
        }, true);
    },

    add_style: function(css)
    {
        var head = document.getElementsByTagName('head')[0];

        var style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = css;
        head.appendChild(style);
    },

    // Create a node from HTML.
    create_node: function(html)
    {
        var temp = document.createElement("div");
        temp.innerHTML = html;
        return temp.firstElementChild;
    },

    // Set or unset a class.
    set_class: function(element, className, enable)
    {
        if(element.classList.contains(className) == enable)
            return;

        if(enable)
            element.classList.add(className);
        else
            element.classList.remove(className);
    },

    date_to_string: function(date)
    {
        var date = new Date(date);
        var day = date.toLocaleDateString();
        var time = date.toLocaleTimeString();
        return day + " " + time;
    },

    age_to_string: function(seconds)
    {
        var to_plural = function(label, places, value)
        {
            var factor = Math.pow(10, places);
            var plural_value = Math.round(value * factor);
            if(plural_value > 1)
                label += "s";
            return value.toFixed(places) + " " + label;
        };
        if(seconds < 60)
            return to_plural("sec", 0, seconds);
        var minutes = seconds / 60;
        if(minutes < 60)
            return to_plural("min", 0, minutes);
        var hours = minutes / 60;
        if(hours < 24)
            return to_plural("hour", 0, hours);
        var days = hours / 24;
        if(days < 30)
            return to_plural("day", 0, days);
        var months = days / 30;
        if(months < 12)
            return to_plural("month", 0, months);
        var years = months / 12;
        return to_plural("year", 1, years);
    },

    get_extension: function(fn)
    {
        var parts = fn.split(".");
        return parts[parts.length-1];
    },

    encode_query: function(data) {
        var str = [];
        for (var key in data)
        {
            if(!data.hasOwnProperty(key))
                continue;
            str.push(encodeURIComponent(key) + "=" + encodeURIComponent(data[key]));
        }    
        return str.join("&");
    },

    // Sending requests in user scripts is a nightmare:
    // - In TamperMonkey you can simply use unsafeWindow.XMLHttpRequest.  However, in newer versions
    // of GreaseMonkey, the request will be sent, but event handlers (eg. load) will fail with a
    // permissions error.  (That doesn't make sense, since you can assign DOM events that way.)
    // - window.XMLHttpRequest will work, but won't make the request as the window, so it will
    // act like a cross-origin request.  We have to use GM_xmlHttpRequest/GM.XMLHttpRequest instead.
    // - But, we can't use that in TamperMonkey (at least in Chrome), since ArrayBuffer is incredibly
    // slow.  It seems to do its own slow buffer decoding: a 2 MB ArrayBuffer can take over half a
    // second to decode.  We need to use regular XHR with TamperMonkey.
    // - GM_xmlhttpRequest in GreaseMonkey doesn't send a referer by default, and we need to set it
    // manually.  (TamperMonkey does send a referer by default.)

    // send_request_gm: Send a request with GM_xmlhttpRequest.
    //
    // The returned object will have an abort method that might abort the request.
    // (TamperMonkey provides abort, but GreaseMonkey doesn't.)
    //
    // Only the following options are supported:
    //
    // - headers
    // - method
    // - data
    // - responseType
    // - onload
    // - onprogress
    //
    // The returned object will only have abort, which is a no-op in GM.
    //
    // onload will always be called (unless the request is aborted), so there's always just
    // one place to put cleanup handlers when a request finishes.
    //
    // onload will be called with only resp.response and not the full response object.  On
    // error, onload(null) will be called rather than onerror.
    //
    // We use a limited interface since we have two implementations of this, one using XHR (for TM)
    // and one using GM_xmlhttpRequest (for GM), and this prevents us from accidentally
    // using a field that's only implemented with GM_xmlhttpRequest and breaking TM.
    send_request_gm: function(options)
    {
        if(options == null)
            options = {};

        return new Promise((resolve, reject) => {
            if(options.signal && options.signal.aborted)
            {
                reject("Aborted by signal");
                return;
            }
            
            var req_options = {};
            for(var key of ["url", "headers", "method", "data", "responseType", "onload", "onprogress"])
            {
                if(!(key in options))
                    continue;

                // We'll override onload.
                if(key == "onload")
                {
                    req_options.real_onload = options.onload;
                    continue;
                }
                req_options[key] = options[key];
            }

            // Set the referer, or some requests will fail.
            var url = new URL(document.location);
            url.hash = "";
            req_options.headers["Referer"] = url.toString();

            req_options.onload = function(response)
            {
                resolve(response.response);
            };

            // When is this ever called?
            req_options.onerror = function(response)
            {
                console.log("Request failed:", response);
                reject(e);
            }        

            var actual_request = GM_xmlhttpRequest(req_options);

            if(options.signal)
            {
                options.signal.addEventListener("abort", (e) => {
                    console.log("Aborting XHR");

                    // actual_request is null with newer, broken versions of GM, in which case
                    // we only pretend to cancel the request.
                    if(actual_request != null)
                        actual_request.abort();

                    // Remove real_onload, so if we can't actually cancel the request, we still
                    // won't call onload, since the caller is no longer expecting it.
                    delete req_options.real_onload;

                    reject("Aborted by signal");
                });        
            }
        });        
    },

    // The same as send_request_gm, but with XHR.
    send_request_xhr: function(options)
    {
        if(options == null)
            options = {};

        return new Promise((resolve, reject) => {
            if(options.signal && options.signal.aborted)
            {
                reject("Aborted by signal");
                return;
            }
            
            let XMLHttpRequest = unsafeWindow.RealXMLHttpRequest || unsafeWindow.XMLHttpRequest;
            var xhr = new XMLHttpRequest();

            if(options.signal)
            {
                options.signal.addEventListener("abort", (e) => {
                    console.log("Aborting XHR");
                    xhr.abort();
                    reject("Aborted by signal");
                });        
            }

            xhr.open(options.method || "GET", options.url);

            if(options.headers)
            {
                for(var key in options.headers)
                    xhr.setRequestHeader(key, options.headers[key]);
            }
            
            if(options.responseType)
                xhr.responseType = options.responseType;

            xhr.addEventListener("load", (e) => {
                resolve(xhr.response);
            });
            xhr.addEventListener("error", (e) => {
                reject(e);
            });

            xhr.addEventListener("progress", function(e) {
                if(options.onprogress)
                {
                    try {
                        options.onprogress(e);
                    } catch(exc) {
                        console.error(exc);
                    }
                }
            });
            
            if(options.method == "POST")
                xhr.send(options.data);
            else
                xhr.send();
        });
    },

    async send_request(options)
    {
        // In GreaseMonkey, use send_request_gm.  Otherwise, use send_request_xhr.  If
        // GM_info.scriptHandler doesn't exist, assume we're in GreaseMonkey, since 
        // TamperMonkey always defines it.
        //
        // We also assume that if GM_info doesn't exist we're in GreaseMonkey, since it's
        // GM that has a nasty habit of removing APIs that people are using, so if that
        // happens we're probably in GM.
        var greasemonkey = true;
        try
        {
            greasemonkey = GM_info.scriptHandler == null || GM_info.scriptHandler == "Greasemonkey";
        } catch(e) {
            greasemonkey = true;
        }

        if(greasemonkey)
            return await helpers.send_request_gm(options);
        else
            return await helpers.send_request_xhr(options);
    },

    // Send a request with the referer, cookie and CSRF token filled in.
    async send_pixiv_request(options)
    {
        if(options.headers == null)
            options.headers = {};

        // Only set x-csrf-token for requests to www.pixiv.net.  It's only needed for API
        // calls (not things like ugoira ZIPs), and the request will fail if we're in XHR
        // mode and set headers, since it'll trigger CORS.
        var hostname = new URL(options.url, document.location).hostname;
        if(hostname == "www.pixiv.net" && "global_data" in window)
            options.headers["x-csrf-token"] = global_data.csrf_token;

        return await helpers.send_request(options);
    },

    // Why does Pixiv have 300 APIs?
    async rpc_post_request(url, data)
    {
        var result = await helpers.send_pixiv_request({
            "method": "POST",
            "url": url,

            "data": helpers.encode_query(data),
            "responseType": "json",

            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            },
        });

        console.log(result);
        if(result && result.error)
            throw "Error in XHR request (" + url + "): "+ result.message;

        return result;
    },

    async rpc_get_request(url, data, options)
    {
        if(options == null)
            options = {};

        var params = new URLSearchParams();
        for(var key in data)
            params.set(key, data[key]);
        var query = params.toString();
        if(query != "")
            url += "?" + query;
        
        var result = await helpers.send_pixiv_request({
            "method": "GET",
            "url": url,
            "responseType": "json",
            "signal": options.signal,

            "headers": {
                "Accept": "application/json",
            },
        });

        if(result.error)
            throw "Error in XHR request (" + url + "): "+ result.message;

        return result;
    },

    async post_request(url, data)
    {
        var result = await helpers.send_pixiv_request({
            "method": "POST",
            "url": url,
            "responseType": "json",

            "data" :JSON.stringify(data),

            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
            },
        });        

        if(result.error)
            throw "Error in XHR request (" + url + "): "+ result.message;

        return result;
    },

    async get_request(url, data, options)
    {
        var params = new URLSearchParams();
        for(var key in data)
            params.set(key, data[key]);
        var query = params.toString();
        if(query != "")
            url += "?" + query;

        if(options == null)
            options = {};

        var result = await helpers.send_pixiv_request({
            "method": "GET",
            "url": url,
            "responseType": "json",
            "signal": options.signal,

            "headers": {
                "Accept": "application/json",
            },
        });

        // If the result isn't valid JSON, we'll get a null result.
        if(result == null)
            result = { error: true, message: "Invalid response" };
        if(result.error)
            throw "Error in XHR request (" + url + "): "+ result.message;

        return result;
    },

    async post_form_request(url, params)
    {
        params.set("tt", global_data.csrf_token);
        
        var result = await helpers.send_pixiv_request({
            "method": "POST",
            "url": url,

            "data": params.toString(),

            "headers": {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        return result;
    },
    
    // Download all URLs in the list.  Call callback with an array containing one ArrayData for each URL.  If
    // any URL fails to download, call callback with null.
    //
    // I'm not sure if it's due to a bug in the userscript extension or because we need to specify a
    // header here, but this doesn't properly use cache and reloads the resources from scratch, which
    // is really annoying.  We can't read the images directly since they're on a different domain.
    //
    // We could start multiple requests to pipeline this better.  However, the usual case where we'd download
    // lots of images is downloading a group of images, and in that case we're already preloading them as
    // images, so it's probably redundant to do it here.
    download_urls: function(urls, callback)
    {
        // Make a copy.
        urls = urls.slice(0);

        var results = [];
        var start_next = function()
        {
            var url = urls.shift();
            if(url == null)
            {
                callback(results);
                return;
            }

            // FIXME: This caches in GreaseMonkey, but not in TamperMonkey.  Do we need to specify cache
            // headers or is TamperMonkey just broken?
            GM_xmlhttpRequest({
                "method": "GET",
                "url": url,
                "responseType": "arraybuffer",

                "headers": {
                    "Cache-Control": "max-age=360000",
                    "Referer": "https://www.pixiv.net/",
                    "Origin": "https://www.pixiv.net/",
                },

                onload: function(result) {
                    results.push(result.response);
                    start_next();
                }.bind(this),
            });
        };

        start_next();
    },

    // Load a page in an iframe, and call callback on the resulting document.
    // Remove the iframe when the callback returns.
    async load_data_in_iframe(url)
    {
        if(GM_info.scriptHandler == "Tampermonkey")
        {
            // If we're in Tampermonkey, we don't need any of the iframe hijinks and we can
            // simply make a request with responseType: document.  This is much cleaner than
            // the Greasemonkey workaround below.
            var result = await helpers.send_pixiv_request({
                "method": "GET",
                "url": url,
                "responseType": "document",
            });
            return result;
        }

        // The above won't work with Greasemonkey.  It returns a document we can't access,
        // raising exceptions if we try to access it.  Greasemonkey's sandboxing needs to
        // be shot into the sun.
        //
        // Instead, we load the document in a sandboxed iframe.  It'll still load resources
        // that we don't need (though they'll mostly load from cache), but it won't run
        // scripts.
        return new Promise((resolve, reject) => {
            var iframe = document.createElement("iframe");

            // Enable sandboxing, so scripts won't run in the iframe.  Set allow-same-origin, or
            // we won't be able to access it in contentDocument (which doesn't really make sense,
            // sandbox is for sandboxing the iframe, not us).
            iframe.sandbox = "allow-same-origin";
            iframe.src = url;
            iframe.hidden = true;
            document.body.appendChild(iframe);

            iframe.addEventListener("load", function(e) {
                try {
                    resolve(iframe.contentDocument);
                } finally {
                    // Remove the iframe.  For some reason, we have to do this after processing it.
                    setTimeout(() => {
                        document.body.removeChild(iframe);
                    }, 0);
                }
            });
        });
    },

    set_recent_bookmark_tags(tags)
    {
        helpers.set_value("recent-bookmark-tags", JSON.stringify(tags));
    },

    get_recent_bookmark_tags()
    {
        var recent_bookmark_tags = helpers.get_value("recent-bookmark-tags");
        if(recent_bookmark_tags == null)
            return [];
        return JSON.parse(recent_bookmark_tags);
    },

    // Move tag_list to the beginning of the recent tag list, and prune tags at the end.
    update_recent_bookmark_tags: function(tag_list)
    {
        // Move the tags we're using to the top of the recent bookmark tag list.
        var recent_bookmark_tags = helpers.get_recent_bookmark_tags();
        for(var i = 0; i < tag_list.length; ++i)
        {
            var tag = tag_list[i];
            var idx = recent_bookmark_tags.indexOf(tag_list[i]);
            if(idx != -1)
                recent_bookmark_tags.splice(idx, 1);
        }
        for(var i = 0; i < tag_list.length; ++i)
            recent_bookmark_tags.unshift(tag_list[i]);

        // Remove tags that haven't been used in a long time.
        recent_bookmark_tags.splice(20);
        helpers.set_recent_bookmark_tags(recent_bookmark_tags);
    },

    // Add tag to the recent search list, or move it to the front.
    add_recent_search_tag(tag)
    {
        if(this._disable_adding_search_tags)
            return;

        var recent_tags = helpers.get_value("recent-tag-searches") || [];
        var idx = recent_tags.indexOf(tag);
        if(idx != -1)
            recent_tags.splice(idx, 1);
        recent_tags.unshift(tag);

        // Trim the list.
        recent_tags.splice(50);
        helpers.set_value("recent-tag-searches", recent_tags);

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    },

    // This is a hack used by tag_search_box_widget to temporarily disable adding to history.
    disable_adding_search_tags(value)
    {
        this._disable_adding_search_tags = value;
    },

    remove_recent_search_tag(tag)
    {
        // Remove tag from the list.  There should normally only be one.
        var recent_tags = helpers.get_value("recent-tag-searches") || [];
        while(1)
        {
            var idx = recent_tags.indexOf(tag);
            if(idx == -1)
                break;
            recent_tags.splice(idx, 1);
        }
        helpers.set_value("recent-tag-searches", recent_tags);
        
        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    },

    // Split a tag search into individual tags.
    split_search_tags(search)
    {
        // Replace full-width spaces with regular spaces.  Pixiv treats this as a delimiter.
        search = search.replace("　", " ");
        return search.split(" ");
    },
    
    // If a tag has a modifier, return [modifier, tag].  -tag seems to be the only one, so
    // we return ["-", "tag"].
    split_tag_prefixes(tag)
    {
        if(tag[0] == "-")
            return ["-", tag.substr(1)];
        else
            return ["", tag];
    },

    // Find globalInitData in a document, evaluate it and return it.  If it can't be
    // found, return null.
    get_global_init_data(doc)
    {
        // Find a script element that sets globalInitData.  This is the only thing in
        // the page that we use.
        var init_element;
        for(var element of doc.querySelectorAll("script"))
        {
            if(element.innerText == null || element.innerText.indexOf("globalInitData") == -1)
                continue;

            init_element = element
            break;
        }

        if(init_element == null)
            return null;
       
        // This script assigns globalInitData.  Wrap it in a function to return it.
        init_script = init_element.innerText;
        init_script = "(function() { " + init_script + "; return globalInitData; })();";

        var data = eval(init_script);

        // globalInitData is frozen, which we don't want.  Deep copy the object to undo this.
        data = JSON.parse(JSON.stringify(data))
        
        return data;
    },

    // If this is an older page (currently everything except illustrations), the CSRF token,
    // etc. are stored on an object called "pixiv".  We aren't actually executing scripts, so
    // find the script block.
    get_pixiv_data(doc)
    {
        // Find all script elements that set pixiv.xxx.  There are two of these, and we need
        // both of them.
        var init_elements = [];
        for(var element of doc.querySelectorAll("script"))
        {
            if(element.innerText == null)
                continue;
            if(!element.innerText.match(/pixiv.*(token|id) = /))
                continue;

            init_elements.push(element);
        }

        if(init_elements.length < 1)
            return null;
        
        // Create a stub around the scripts to let them execute as if they're initializing the
        // original object.
        var init_script = "";
        init_script += "(function() {";
        init_script += "var pixiv = { config: {}, context: {}, user: {} }; ";
        for(var element of init_elements)
            init_script += element.innerText;
        init_script += "return pixiv;";
        init_script += "})();";
        return eval(init_script);
    },

    get_tags_from_illust_data(illust_data)
    {
        // illust_data might contain a list of dictionaries (data.tags.tags[].tag), or
        // a simple list (data.tags[]), depending on the source.
        if(illust_data.tags.tags == null)
            return illust_data.tags;

        var result = [];
        for(var tag_data of illust_data.tags.tags)
            result.push(tag_data.tag);
            
        return result;
    },

    // Return true if the given illust_data.tags contains the pixel art (ドット絵) tag.
    tags_contain_dot(illust_data)
    {
        var tags = helpers.get_tags_from_illust_data(illust_data);
        for(var tag of tags)
            if(tag.indexOf("ドット") != -1)
                return true;

        return false;
    },

    // Find all links to Pixiv pages, and set a #ppixiv anchor.
    //
    // This allows links to images in things like image descriptions to be loaded
    // internally without a page navigation.
    make_pixiv_links_internal(root)
    {
        for(var a of root.querySelectorAll("A"))
        {
            var url = new URL(a.href, document.location);
            if(url.hostname != "pixiv.net" && url.hostname != "www.pixiv.net" || url.hash != "")
                continue;

            url.hash = "#ppixiv";
            a.href = url.toString();
        }
    },

    fix_pixiv_links: function(root)
    {
        for(var a of root.querySelectorAll("A[target='_blank']"))
            a.target = "";

        for(var a of root.querySelectorAll("A"))
        {
            if(a.relList == null)
                a.rel += " noreferrer noopener"; // stupid Edge
            else
            {
                a.relList.add("noreferrer");
                a.relList.add("noopener");
            }
        }

        for(var a of root.querySelectorAll("A[href*='jump.php']"))
        {
            // These can either be /jump.php?url or /jump.php?url=url.
            var url = new URL(a.href);
            if(url.searchParams.has("url"))
                a.href = url.searchParams.get("url");
            else
            {
                var target = url.search.substr(1); // remove "?"
                target = decodeURIComponent(target);
                a.href = target;
            }
        }
    },

    // Some of Pixiv's URLs have languages prefixed and some don't.  Ignore these and remove
    // them to make them simpler to parse.
    get_url_without_language: function(url)
    {
        if(url == null)
            url = new URL(document.location);

        if(/\/..\//.exec(url.pathname))
            url.pathname = url.pathname.substr(3);
        
        return url;
    },
    
    set_page_title: function(title)
    {
        document.querySelector("title").textContent = title;
    },

    set_page_icon: function(url)
    {
        document.querySelector("link[rel='icon']").href = url;
    },

    // Watch for clicks on links inside node.  If a search link is clicked, add it to the
    // recent search list.
    add_clicks_to_search_history: function(node)
    {
        node.addEventListener("click", function(e) {
            if(e.defaultPrevented)
                return;
            if(e.target.tagName != "A")
                return;

            var url = new URL(e.target.href);
            if(url.pathname != "/search.php")
                return;

            var tag = url.searchParams.get("word");
            console.log("Adding to tag search history:", tag);
            helpers.add_recent_search_tag(tag);
        });
    },

    // Add a basic event handler for an input:
    //
    // - When enter is pressed, submit will be called.
    // - Event propagation will be stopped, so global hotkeys don't trigger.
    //
    // Note that other event handlers on the input will still be called.
    input_handler: function(input, submit)
    {
        input.addEventListener("keydown", function(e) {
            // Always stopPropagation, so inputs aren't handled by main input handling.
            e.stopPropagation();

            if(e.keyCode == 13) // enter
                submit(e);
        });
    },

    // Parse the hash portion of our URL.  For example,
    //
    // #ppixiv?a=1&b=2
    //
    // returns { a: "1", b: "2" }.
    //
    // If this isn't one of our URLs, return null.
    parse_hash: function(url)
    {
        var ppixiv_url = url.hash.startsWith("#ppixiv");
        if(!ppixiv_url)
            return null;
        
        // Parse the hash of the current page as a path.  For example, if
        // the hash is #ppixiv/foo/bar?baz, parse it as /ppixiv/foo/bar?baz.
        var adjusted_url = url.hash.replace(/#/, "/");
        return new URL(adjusted_url, url);
    },

    get_hash_args: function(url)
    {
        var hash_url = helpers.parse_hash(url);
        if(hash_url == null)
            return new unsafeWindow.URLSearchParams();

        var query = hash_url.search;
        if(!query.startsWith("?"))
            return new unsafeWindow.URLSearchParams();

        query = query.substr(1);

        // Use unsafeWindow.URLSearchParams to work around https://bugzilla.mozilla.org/show_bug.cgi?id=1414602.
        var params = new unsafeWindow.URLSearchParams(query);
        return params;
    },
    
    // Set the hash portion of url to args, as a ppixiv url.
    //
    // For example, given { a: "1", b: "2" }, set the hash to #ppixiv?a=1&b=2.
    set_hash_args: function(url, hash_params)
    {
        url.hash = "#ppixiv";

        var hash_string = hash_params.toString();
        if(hash_string != "")
            url.hash += "?" + hash_string;
    },

    // Given a URLSearchParams, return a new URLSearchParams with keys sorted alphabetically.
    sort_query_parameters(search)
    {
        var search_keys = unsafeWindow.Array.from(search.keys()); // GreaseMonkey encapsulation is bad
        search_keys.sort();

        var result = new URLSearchParams();
        for(var key of search_keys)
            result.set(key, search.get(key));
        return result;
    },

    // This is incremented whenever we navigate forwards, so we can tell in onpopstate
    // whether we're navigating forwards or backwards.
    current_history_state_index()
    {
        return (history.state && history.state.index != null)? history.state.index: 0;
    },

    get_args: function(url)
    {
        var url = new URL(url, document.location);
        return {
            path: url.pathname,
            query: url.searchParams,
            hash: helpers.get_hash_args(url),
        }
    },

    set_args(args, add_to_history, cause)
    {
        var url = new URL(document.location);
        url.pathname = args.path;
        url.search = args.query.toString();
        helpers.set_hash_args(url, args.hash);
        helpers.set_page_url(url, add_to_history, cause);
    },
    
    // Set document.href, either adding or replacing the current history state.
    //
    // window.onpopstate will be synthesized if the URL is changing.
    //
    // If cause is set, it'll be included in the popstate event as navigationCause.
    // This can be used in event listeners to determine what caused a navigation.
    // For browser forwards/back, this won't be present.
    set_page_url(url, add_to_history, cause)
    {
        var old_url = document.location.toString();

        // history.state.index is incremented whenever we navigate forwards, so we can
        // tell in onpopstate whether we're navigating forwards or backwards.
        var current_history_index = helpers.current_history_state_index();

        var new_history_index = current_history_index;
        if(add_to_history)
            new_history_index++;

        var history_data = {
            index: new_history_index
        };

        // console.log("Changing state to", url.toString());
        if(add_to_history)
            history.pushState(history_data, "", url.toString());
        else
            history.replaceState(history_data, "", url.toString());

        // Chrome is broken.  After replacing state for a while, it starts logging
        //
        // "Throttling history state changes to prevent the browser from hanging."
        //
        // This is completely broken: it triggers with state changes no faster than the
        // user can move the mousewheel (much too sensitive), and it happens on replaceState
        // and not just pushState (which you should be able to call as fast as you want).
        //
        // People don't think things through.
        console.log("Set URL to", document.location.toString(), add_to_history);

        if(document.location.toString() != old_url)
        {
            // Browsers don't send onpopstate for history changes, but we want them, so
            // send a synthetic one.
            // console.log("Dispatching popstate:", document.location.toString());
            var event = new PopStateEvent("popstate");

            // Set initialNavigation to true.  This indicates that this event is for a new
            // navigation, and not from browser forwards/back.
            event.navigationCause = cause;

            window.dispatchEvent(event);
        }
    },

    setup_popups(container, selectors)
    {
        var setup_popup = function(box)
        {
            box.addEventListener("mouseover", function(e) { helpers.set_class(box, "popup-visible", true); });
            box.addEventListener("mouseout", function(e) { helpers.set_class(box, "popup-visible", false); });
        }

        for(var selector of selectors)
        {
            var box = container.querySelector(selector);
            if(box == null)
            {
                console.warn("Couldn't find", selector);
                continue;
            }
            setup_popup(box);
        }
    },

    // Return the offset of element relative to an ancestor.
    get_relative_pos(element, ancestor)
    {
        var x = 0, y = 0;
        while(element != null && element != ancestor)
        {
            x += element.offsetLeft;
            y += element.offsetTop;
            // Advance through parents until we reach the offsetParent or the ancestor
            // that we're stopping at.  We do this rather than advancing to offsetParent,
            // in case ancestor isn't an offsetParent.
            var search_for = element.offsetParent;
            while(element != ancestor && element != search_for)
                element = element.parentNode;
        }
        return [x, y];
    },
    
    clamp(value, min, max)
    {
        return Math.min(Math.max(value, min), max);
    },

    // Return a promise that resolves when img finishes loading, or rejects if it
    // fails to load.
    wait_for_image_load(img, abort_signal)
    {
        return new Promise((resolve, reject) => {
            // Resolve immediately if the image is already loaded.
            if(img.complete)
            {
                resolve();
                return;
            }

            if(abort_signal && abort_signal.aborted)
            {
                reject("Aborted");
                return;
            }

            var onabort = (e) => {
                remove_listeners();
                reject("Aborted");
            };

            var onerror = (e) => {
                remove_listeners();
                reject("Load error");
            };

            var onload = (e) => {
                remove_listeners();
                resolve();
            };

            var remove_listeners = () => {
                img.removeEventListener("error", onerror);
                img.removeEventListener("load", onload);
                if(abort_signal)
                    abort_signal.addEventListener("abort", onabort);
            };

            img.addEventListener("error", onerror);
            img.addEventListener("load", onload);
            if(abort_signal)
                abort_signal.addEventListener("abort", onabort);
        });
    },

    // If image.decode is available, asynchronously decode url.
    async decode_image(url, abort_signal)
    {
        var img = document.createElement("img");
        img.src = url;

        var onabort = (e) => {
            // If we're aborted, set the image to a small PNG, which cancels the previous load
            // in Firefox and Chrome.
            img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
        };

        if(abort_signal)
            abort_signal.addEventListener("abort", onabort);
        
        try {
            await helpers.wait_for_image_load(img, abort_signal);
        } catch(e) {
            // Ignore load errors, since this is just a load optimization.
            // console.error("Ignoring error in decode:", e);
            return;
        } finally {
            // Remove the abort listener.
            if(abort_signal)
                abort_signal.removeEventListener("abort", onabort);
        }

        // If we finished by aborting, don't bother decoding the blank PNG we changed the
        // image to.
        if(abort_signal && abort_signal.aborted)
            return;
        
        if(HTMLImageElement.prototype.decode == null)
        {
            // If we don't have img.decode, fake it by drawing the image into an offscreen canvas
            // to force the browser to decode it.
            var canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;

            var context = canvas.getContext('2d');
            context.drawImage(img, 0, 0);
        }
        else
        {
            try {
                await img.decode();
            } catch(e) {
                // console.error("Ignoring error in decode:", e);
            }
        }
    },

    // Return a CSS style to specify thumbnail resolutions.
    //
    // Based on the dimensions of the container and a desired pixel size of thumbnails,
    // figure out how many columns to display to bring us as close as possible to the
    // desired size.
    //
    // container is the containing block (eg. ul.thumbnails).
    // top_selector is a CSS selector for the thumbnail block.  We should be able to
    // simply create a scoped stylesheet, but browsers don't understand the importance
    // of encapsulation.
    make_thumbnail_sizing_style(container, top_selector, options)
    {
        // The total pixel size we want each thumbnail to have:
        var desired_size = options.size || 300;
        var ratio = options.ratio || 1;
        var max_columns = options.max_columns || 5;

        var desired_pixels = desired_size*desired_size / window.devicePixelRatio;
        var container_width = container.parentNode.clientWidth;
        var padding = container_width / 100;
        padding = Math.min(padding, 10);
        padding = Math.round(padding);
        if(options.min_padding)
            padding = Math.max(padding, options.min_padding);
        
        var closest_error_to_desired_pixels = -1;
        var best_size = [0,0];
        var best_columns = 0;
        for(var columns = max_columns; columns >= 1; --columns)
        {
            // The amount of space in the container remaining for images, after subtracting
            // the padding around each image.
            var remaining_width = container_width - padding*columns*2;
            var max_width = remaining_width / columns;
            var max_height = max_width;
            if(ratio < 1)
                max_width *= ratio;
            else if(ratio > 1)
                max_height /= ratio;

            max_width = Math.floor(max_width);
            max_height = Math.floor(max_height);

            var pixels = max_width * max_height;
            var error = Math.abs(pixels - desired_pixels);
            if(closest_error_to_desired_pixels == -1 || error < closest_error_to_desired_pixels)
            {
                closest_error_to_desired_pixels = error;
                best_size = [max_width, max_height];
                best_columns = columns;
            }
        }

        max_width = best_size[0];
        max_height = best_size[1];

        // If we want a smaller thumbnail size than we can reach within the max column
        // count, we won't have reached desired_pixels.  In this case, just clamp to it.
        // This will cause us to use too many columns, which we'll correct below with
        // container_width.
        if(max_width * max_height > desired_pixels)
        {
            max_height = max_width = Math.round(Math.sqrt(desired_pixels));

            if(ratio < 1)
                max_width *= ratio;
            else if(ratio > 1)
                max_height /= ratio;
        }

        // Clamp the width of the container to the number of columns we expect.
        var container_width = max_columns * (max_width+padding*2);

        var css = 
            top_selector + " .thumbnail-link { " +
                "width: " + max_width + "px; " +
                "height: " + max_height + "px; " +
            "} " + 
            top_selector + " li.thumbnail-box { padding: " + padding + "px; }";
        if(container_width != null)
            css += top_selector + " > .thumbnails { max-width: " + container_width + "px; }";
        return css;
    },
    
    // If the aspect ratio is very narrow, don't use any panning, since it becomes too spastic.
    // If the aspect ratio is portrait, use vertical panning.
    // If the aspect ratio is landscape, use horizontal panning.
    //
    // If it's in between, don't pan at all, since we don't have anywhere to move and it can just
    // make the thumbnail jitter in place.
    //
    // Don't pan muted images.
    //
    // container_aspect_ratio is the aspect ratio of the box the thumbnail is in.  If the
    // thumb is in a 2:1 landscape box, we'll adjust the min and max aspect ratio accordingly.
    set_thumbnail_panning_direction(thumb, width, height, container_aspect_ratio)
    {
        var aspect_ratio = width / height;
        aspect_ratio /= container_aspect_ratio;
        var min_aspect_for_pan = 1.1;
        var max_aspect_for_pan = 4;
        var vertical_panning = aspect_ratio > (1/max_aspect_for_pan) && aspect_ratio < 1/min_aspect_for_pan;
        var horizontal_panning = aspect_ratio > min_aspect_for_pan && aspect_ratio < max_aspect_for_pan;
        helpers.set_class(thumb, "vertical-panning", vertical_panning);
        helpers.set_class(thumb, "horizontal-panning", horizontal_panning);
    },

    set_title(illust_data, user_data)
    {
        if(user_data == null && illust_data != null)
            user_data = illust_data.userInfo;

        if(illust_data == null)
        {
            helpers.set_page_title("Loading...");
            return;
        }

        var page_title = "";
        if(illust_data.bookmarkData)
            page_title += "★";

        page_title += user_data.name + " - " + illust_data.illustTitle;
        helpers.set_page_title(page_title);
    },

    set_icon(illust_data, user_data)
    {
        if(user_data == null && illust_data != null)
            user_data = illust_data.userInfo;

        helpers.set_page_icon(user_data && user_data.isFollowed? binary_data['favorited_icon.png']:binary_data['regular_pixiv_icon.png']);
    },

    set_title_and_icon(illust_data, user_data)
    {
        helpers.set_title(illust_data, user_data)
        helpers.set_icon(illust_data, user_data)
    },

    // Return 1 if the given keydown event should zoom in, -1 if it should zoom
    // out, or null if it's not a zoom keypress.
    is_zoom_hotkey(e)
    {
        if(!e.ctrlKey)
            return null;
        
        if(e.code == "NumpadAdd" || e.code == "Equal") /* = */
            return +1;
        if(e.code == "NumpadSubtract" || e.code == "Minus") /* - */ 
            return -1;
        return null;
    },

    // https://stackoverflow.com/questions/1255512/how-to-draw-a-rounded-rectangle-on-html-canvas/3368118#3368118
    /*
     * Draws a rounded rectangle using the current state of the canvas.
     * If you omit the last three params, it will draw a rectangle
     * outline with a 5 pixel border radius
     */
    draw_round_rect(ctx, x, y, width, height, radius)
    {
        if(typeof radius === 'undefined')
            radius = 5;
        if(typeof radius === 'number') {
            radius = {tl: radius, tr: radius, br: radius, bl: radius};
        } else {
            var defaultRadius = {tl: 0, tr: 0, br: 0, bl: 0};
            for(var side in defaultRadius)
                radius[side] = radius[side] || defaultRadius[side];
        }

        ctx.beginPath();
        ctx.moveTo(x + radius.tl, y);
        ctx.lineTo(x + width - radius.tr, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
        ctx.lineTo(x + width, y + height - radius.br);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
        ctx.lineTo(x + radius.bl, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
        ctx.lineTo(x, y + radius.tl);
        ctx.quadraticCurveTo(x, y, x + radius.tl, y);
        ctx.closePath();
    },

    // Helpers for IDs in the illustration list.
    //
    // Most things we show in thumbs are illustration IDs, and we pass them around normally.
    // If we need to show something else in a thumbnail, we encode it.  We can show a user
    // thumbnail by adding "user:12345" as an ID.
    //
    // Return the type of the ID.  If this is just a regular illustration ID, return "illust".
    // Otherwise, return the prefix ("user").
    id_type(id)
    {
        let parts = id.split(":");
        if(parts.length < 2)
            return "illust";
        else
            return parts[0];
    },

    // Return the real ID.  For example, for "user:12345", the actual ID is 12345.
    actual_id(id)
    {
        let parts = id.split(":");
        if(parts.length < 2)
            return id;
        else
            return parts[1];
    }
};

// Handle maintaining and calling a list of callbacks.
class callback_list
{
    constructor()
    {
        this.callbacks = [];
    }

    // Call all callbacks, passing all arguments to the callback.
    call()
    {
        for(var callback of this.callbacks.slice())
        {
            try {
                callback.apply(null, arguments);
            } catch(e) {
                console.error(e);
            }
        }
    }

    register(callback)
    {
        if(callback == null)
            throw "callback can't be null";

        if(this.callbacks.indexOf(callback) != -1)
            return;

        this.callbacks.push(callback);
    }

    unregister(callback)
    {
        if(callback == null)
            throw "callback can't be null";

        var idx = this.callbacks.indexOf(callback);
        if(idx == -1)
            return;

        this.callbacks.splice(idx, 1);
    }
}

// Listen to viewhidden on element and each of element's parents.
//
// When a view is hidden (eg. a top-level view or a UI popup), we send
// viewhidden to it so dropdowns, etc. inside it can close.
class view_hidden_listener
{
    static send_viewhidden(element)
    {
        var event = new Event("viewhidden", {
            bubbles: false
        });
        element.dispatchEvent(event);
    }

    constructor(element, callback)
    {
        this.onviewhidden = this.onviewhidden.bind(this);
        this.callback = callback;

        // There's no way to listen on events on any parent, so we have to add listeners
        // to each parent in the tree.
        this.listening_on_elements = [];
        while(element != null)
        {
            this.listening_on_elements.push(element);
            element.addEventListener("viewhidden", this.onviewhidden);

            element = element.parentNode;
        }
    }

    // Remove listeners.
    shutdown()
    {
        for(var element of this.listening_on_elements)
            element.removeEventListener("viewhidden", this.onviewhidden);
        this.listening_on_elements = [];
    }

    onviewhidden(e)
    {
        this.callback(e);
    }
};

// Filter an image to a canvas.
//
// When an image loads, draw it to a canvas of the same size, optionally applying filter
// effects.
//
// If base_filter is supplied, it's a filter to apply to the top copy of the image.
// If overlay(ctx, img) is supplied, it's a function to draw to the canvas.  This can
// be used to mask the top copy.
class image_canvas_filter
{
    constructor(img, canvas, base_filter, overlay)
    {
        this.img = img;
        this.canvas = canvas;
        this.base_filter = base_filter || "";
        this.overlay = overlay;
        this.ctx = this.canvas.getContext("2d");

        this.img.addEventListener("load", this.update_canvas.bind(this));

        // For some reason, browsers can't be bothered to implement onloadstart, a seemingly
        // fundamental progress event.  So, we have to use a mutation observer to tell when
        // the image is changed, to make sure we clear it as soon as the main image changes.
        this.observer = new MutationObserver((mutations) => {
            for(var mutation of mutations) {
                if(mutation.type == "attributes")
                {
                    if(mutation.attributeName == "src")
                    {
                        this.update_canvas();
                    }
                }
            }
        });

        this.observer.observe(this.img, { attributes: true });
        
        this.update_canvas();
    }

    clear()
    {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    update_canvas()
    {
        this.canvas.width = this.img.naturalWidth;
        this.canvas.height = this.img.naturalHeight;

        this.clear();

        // If the image is still loading, just clear any previous image from the canvas.
        if(!this.img.complete)
            return;

        // Draw the image onto the canvas.
        this.ctx.save();
        this.ctx.filter = this.base_filter;
        this.ctx.drawImage(this.img, 0, 0);
        this.ctx.restore();

        // Composite on top of the base image.
        this.ctx.save();

        if(this.overlay)
            this.overlay(this.ctx, this.img);

        this.ctx.restore();
        
        // Use destination-over to draw the image underneath the overlay we just drew.
        this.ctx.globalCompositeOperation = "destination-over";
        this.ctx.drawImage(this.img, 0, 0);
    }
}

// Add delays to hovering and unhovering.  The class "hover" will be set when the mouse
// is over the element (equivalent to the :hover selector), with a given delay before the
// state changes.
//
// This is used when hovering the top bar when in ui-on-hover mode, to delay the transition
// before the UI disappears.  transition-delay isn't useful for this, since it causes weird
// hitches when the mouse enters and leaves the area quickly.
class hover_with_delay
{
    constructor(element, delay_enter, delay_exit)
    {
        this.element = element;
        this.delay_enter = delay_enter * 1000.0;
        this.delay_exit = delay_exit * 1000.0;
        this.timer = -1;
        this.pending_hover = null;

        element.addEventListener("mouseenter", (e) => { this.real_hover_changed(true); });
        element.addEventListener("mouseleave", (e) => { this.real_hover_changed(false); });
    }

    real_hover_changed(hovering)
    {
        // If we already have this event queued, just let it continue.
        if(this.pending_hover != null && this.pending_hover == hovering)
            return;

        // If the opposite event is pending, cancel it.
        if(this.hover_timeout != null)
        {
            clearTimeout(this.hover_timeout);
            this.hover_timeout = null;
        }

        this.real_hover_state = hovering;
        this.pending_hover = hovering;
        let delay = hovering? this.delay_enter:this.delay_exit;
        this.hover_timeout = setTimeout(() => {
            this.pending_hover = null;
            this.hover_timeout = null;
            helpers.set_class(this.element, "hover", this.real_hover_state);
        }, delay);


    }
}

// Originally from https://gist.github.com/wilsonpage/01d2eb139959c79e0d9a
class key_storage
{
    constructor(name)
    {
        this.name = name;
        this.ready = new Promise((resolve, reject) => {
            var request = indexedDB.open("ppixiv");

            request.onupgradeneeded = e => {
                this.db = e.target.result;
                this.db.createObjectStore(this.name);
            };

            request.onsuccess = e => {
                this.db = e.target.result;
                resolve();
            };

            request.onerror = e => {
                this.db = e.target.result;
                reject(e);
            };
        });
    }

    getStore()
    {
        let transaction = this.db.transaction(this.name, "readwrite");
        return transaction.objectStore(this.name);
    }

    static async_store_get(store, key)
    {
        return new Promise((resolve, reject) => {
            var request = store.get(key);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = reject;
        });
    }

    async get(key, store)
    {
        await this.ready;
        return key_storage.async_store_get(this.getStore(), key);
    }

    // Given a list of keys, return known translations.  Tags that we don't have data for are null.
    async multi_get(keys)
    {
        await this.ready;
        let store = this.getStore();

        let promises = [];
        for(let key of keys)
            promises.push(key_storage.async_store_get(store, key));
        return await Promise.all(promises);
    }

    static async_store_set(store, key, value)
    {
        return new Promise((resolve, reject) => {
            var request = store.put(value, key);
            request.onsuccess = resolve;
            request.onerror = reject;
        });
    }
    
    async set(key, value)
    {
        await this.ready;
        return key_storage.async_store_set(this.getStore(), key, value);
    }

    // Internal helper: batch set all keys[n] to values[n].
    static async_store_multi_set(store, keys, values)
    {
        if(keys.length != values.length)
            throw "key and value arrays have different lengths";

        return new Promise((resolve, reject) => {
            // Only wait for onsuccess on the final put, for performance.
            for(let i = 0; i < keys.length; ++i)
            {
                var request = store.put(values[i], keys[i]);
                request.onerror = reject;
                if(i == keys.length - 1)
                    request.onsuccess = resolve;
            }
        });
    }

    // Given a dictionary, set all key/value pairs.
    async multi_set(data)
    {
        await this.ready;
        let store = this.getStore();

        let keys = Object.keys(data);
        let values = [];
        for(let key of keys)
            values.push(data[key]);

        await key_storage.async_store_multi_set(store, keys, values);
    }
}

