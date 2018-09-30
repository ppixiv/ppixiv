var helpers = {
    // Get and set values in localStorage.
    //
    // We don't use helpers.set_value/helpers.get_value since GreaseMonkey is inconsistent and changed
    // these functions unnecessarily.  We could polyfill those with this, but that would cause
    // the storage to change if those functions are restored.  Doing it this way also allows
    // us to share settings if a user switches from GM to TM.
    get_value: function(key, default_value)
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
    },

    set_value: function(key, value)
    {
        key = "_ppixiv_" + key;

        var value = JSON.stringify(value);
        localStorage[key] = value;
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
            template = document.body.querySelector(type);
        else
            template = type;
        return template.firstElementChild.cloneNode(true);
    },

    // Fetch a simple data resource, and call callback with the result.
    //
    // In principle this is just a simple XHR.  However, if we make two requests for the same
    // resource before the first one finishes, browsers tend to be a little dumb and make a
    // whole separate request, instead of waiting for the first to finish and then just serving
    // the second out of cache.  This causes duplicate requests when prefetching video ZIPs.
    // This works around that problem by returning the existing XHR if one is already in progress.
    _fetches: {},
    fetch_resource: function(url, options)
    {
        if(this._fetches[url])
        {
            var request = this._fetches[url];

            // Remember that another fetch was made for this resource.
            request.fetch_count++;

            if(options != null)
                request.callers.push(options);

            return request;
        }

        var request = helpers.send_pixiv_request({
            "method": "GET",
            "url": url,
            "responseType": "arraybuffer",

            "headers": {
                "Accept": "application/json",
            },
            onload: function(data) {
                // Once the request finishes, future requests can be done normally and should be served
                // out of cache.
                delete helpers._fetches[url];

                // Call onloads.
                for(var options of request.callers.slice())
                {
                    try {
                        if(options.onload)
                            options.onload(data);
                    } catch(exc) {
                        console.error(exc);
                    }
                }
            },

            onerror: function(e) {
                console.error("Fetch failed");
                for(var options of request.callers.slice())
                {
                    try {
                        if(options.onerror)
                            options.onerror(e);
                    } catch(exc) {
                        console.error(exc);
                    }
                }
            },

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

        // Remember the number of times fetch_resource has been called on this URL.
        request.fetch_count = 1;
        request.callers = [];
        request.callers.push(options);

        this._fetches[url] = request;

        // Override request.abort to reference count fetching, so we only cancel the load if
        // every caller cancels.
        //
        // Note that this means you'll still receive events if the fetch isn't actually
        // cancelled, so you should unregister event listeners if that's important.
        var original_abort = request.abort;
        request.abort = function()
        {
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

            original_abort.call(request);
        };

        return request;
    },

    // For some reason, only the mode=manga page actually has URLs to each page.  Avoid
    // having to load an extra page by deriving it from the first page's URL, which looks
    // like:
    //
    // https://i.pximg.net/img-original/img/1234/12/12/12/12/12/12345678_p0.jpg
    //
    // Replace _p0 at the end with the page number.
    //
    // We can't tell the size of each image this way.
    get_url_for_page: function(illust_data, page, key)
    {
        var url = illust_data.urls[key];
        var match = /^(http.*)(_p)(0)(.*)/.exec(url);
        if(match == null)
        {
            console.error("Couldn't parse URL: " + url);
            return "";
        }
        return match[1] + match[2] + page.toString() + match[4];
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

    fetch_ugoira_metadata: function(illust_id, callback)
    {
        var url = "/ajax/illust/" + illust_id + "/ugoira_meta";
        return helpers.get_request(url, {}, callback);
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
    send_request_gm: function(user_options)
    {
        var options = {};
        for(var key of ["url", "headers", "method", "data", "responseType", "onload", "onprogress"])
        {
            if(!(key in user_options))
                continue;

            // We'll override onload.
            if(key == "onload")
            {
                options.real_onload = user_options.onload;
                continue;
            }
            options[key] = user_options[key];
        }

        // Set the referer, or some requests will fail.
        var url = new URL(document.location);
        url.hash = "";
        options.headers["Referer"] = url.toString();

        options.onload = function(response)
        {
            if(options.real_onload)
            {
                try {
                    options.real_onload(response.response);
                } catch(e) {
                    console.error(e);
                }
            }
        };

        // When is this ever called?
        options.onerror = function(response)
        {
            console.log("Request failed:", response);
            if(options.real_onload)
            {
                try {
                    options.real_onload(null);
                } catch(e) {
                    console.error(e);
                }
            }
        }        

        var actual_request = GM_xmlhttpRequest(options);

        return {
            abort: function()
            {
                // actual_request is null with newer, broken versions of GM, in which case
                // we only pretend to cancel the request.
                if(actual_request != null)
                    actual_request.abort();

                // Remove real_onload, so if we can't actually cancel the request, we still
                // won't call onload, since the caller is no longer expecting it.
                delete options.real_onload;
            },
        };
    },

    // The same as send_request_gm, but with XHR.
    send_request_xhr: function(options)
    {
        var xhr = new RealXMLHttpRequest();        
        xhr.open(options.method || "GET", options.url);

        if(options.headers)
        {
            for(var key in options.headers)
                xhr.setRequestHeader(key, options.headers[key]);
        }
        
        if(options.responseType)
            xhr.responseType = options.responseType;

        xhr.addEventListener("load", function(e) {
            if(options.onload)
            {
                try {
                    options.onload(xhr.response);
                } catch(exc) {
                    console.error(exc);
                }
            }
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

        return {
            abort: function()
            {
                console.log("cancel");
                xhr.abort();
            },
        };
    },

    send_request: function(options)
    {
        // In GreaseMonkey, use send_request_gm.  Otherwise, use send_request_xhr.  If
        // GM_info.scriptHandler doesn't exist, assume we're in GreaseMonkey, since 
        // TamperMonkey always defines it.
        //
        // (e also assume that if GM_info doesn't exist we're in GreaseMonkey, since it's
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
            return helpers.send_request_gm(options);
        else
            return helpers.send_request_xhr(options);
    },

    // Send a request with the referer, cookie and CSRF token filled in.
    send_pixiv_request: function(options)
    {
        if(options.headers == null)
            options.headers = {};

        // Only set x-csrf-token for requests to www.pixiv.net.  It's only needed for API
        // calls (not things like ugoira ZIPs), and the request will fail if we're in XHR
        // mode and set headers, since it'll trigger CORS.
        var hostname = new URL(options.url, document.location).hostname;
        if(hostname == "www.pixiv.net")
            options.headers["x-csrf-token"] = global_data.csrf_token;

        return helpers.send_request(options);
    },

    // Why does Pixiv have 3 APIs?
    rpc_post_request: function(url, data, callback)
    {
        return helpers.send_pixiv_request({
            "method": "POST",
            "url": url,

            "data": helpers.encode_query(data),
            "responseType": "json",

            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            },
            onload: function(data) {
                if(data && data.error)
                    console.error("Error in XHR request (" + url + "):", data.message)

                if(callback)
                    callback(data);
            },

            onerror: function(e) {
                console.error("Fetch failed");
                if(callback)
                    callback({"error": true, "message": "XHR error"});
            },
        });        
    },

    rpc_get_request: function(url, data, callback)
    {
        var params = new URLSearchParams();
        for(var key in data)
            params.set(key, data[key]);
        var query = params.toString();
        if(query != "")
            url += "?" + query;
        
        return helpers.send_pixiv_request({
            "method": "GET",
            "url": url,
            "responseType": "json",

            "headers": {
                "Accept": "application/json",
            },

            onload: function(data) {
                if(data && data.error)
                    console.error("Error in XHR request (" + url + "):", data.message)

                if(callback)
                    callback(data);
            },

            onerror: function(result) {
                console.error("Fetch failed");
                if(callback)
                    callback({"error": true, "message": "XHR error"});
            },
        });
    },

    post_request: function(url, data, callback)
    {
        return helpers.send_pixiv_request({
            "method": "POST",
            "url": url,
            "responseType": "json",

            "data" :JSON.stringify(data),

            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
            },
            onload: function(data) {
                if(data && data.error)
                    console.error("Error in XHR request (" + url + "):", data.message)

                if(callback)
                    callback(data);
            },

            onerror: function(e) {
                console.error("Fetch failed");
                if(callback)
                    callback({"error": true, "message": "XHR error"});
            },
        });        
    },

    get_request: function(url, data, callback)
    {
        var params = new URLSearchParams();
        for(var key in data)
            params.set(key, data[key]);
        var query = params.toString();
        if(query != "")
            url += "?" + query;

        return helpers.send_pixiv_request({
            "method": "GET",
            "url": url,
            "responseType": "json",

            "headers": {
                "Accept": "application/json",
            },
            onload: function(data) {
                if(data && data.error)
                    console.error("Error in XHR request (" + url + "):", data.message)

                if(callback)
                    callback(data);
            },

            onerror: function(e) {
                console.error("Fetch failed");
                if(callback)
                    callback({"error": true, "message": "XHR error"});
            },
        });        
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
    load_data_in_iframe: function(url, callback)
    {
        if(GM_info.scriptHandler == "Tampermonkey")
        {
            // If we're in Tampermonkey, we don't need any of the iframe hijinks and we can
            // simply make a request with responseType: document.  This is much cleaner than
            // the Greasemonkey workaround below.
            helpers.send_pixiv_request({
                "method": "GET",
                "url": url,
                "responseType": "document",

                onload: function(data) {
                    callback(data);
                },
            });
            return;
        }

        // The above won't work with Greasemonkey.  It returns a document we can't access,
        // raising exceptions if we try to access it.  Greasemonkey's sandboxing needs to
        // be shot into the sun.
        //
        // Instead, we load the document in a sandboxed iframe.  It'll still load resources
        // that we don't need (though they'll mostly load from cache), but it won't run
        // scripts.
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
                callback(iframe.contentDocument);
            } catch(e) {
                // GM error logs don't make it to the console for some reason.
                console.error(e);
            } finally {
                // Remove the iframe.  For some reason, we have to do this after processing it.
                document.body.removeChild(iframe);
            }
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
            a.relList.add("noreferrer");
            a.relList.add("noopener");
        }

        for(var a of root.querySelectorAll("A[href*='jump.php']"))
        {
            var url = new URL(a.href);
            var target = url.search.substr(1); // remove "?"
            target = decodeURIComponent(target);
            a.href = target;
        }
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
        console.error("Set URL to", document.location.toString(), add_to_history);

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

    // If image.decode is available, asynchronously decode url.
    decode_image(url)
    {
        if(HTMLImageElement.prototype.decode == null)
            return;
        
        var img = document.createElement("img");
        img.src = url;

        img.decode().then(() => { }).catch((e) => { });
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
        var min_aspect_for_pan = 1.1 * container_aspect_ratio;
        var max_aspect_for_pan = 4 * container_aspect_ratio;
        var vertical_panning = aspect_ratio > (1/max_aspect_for_pan) && aspect_ratio < 1/min_aspect_for_pan;
        var horizontal_panning = aspect_ratio > min_aspect_for_pan && aspect_ratio < max_aspect_for_pan;
        helpers.set_class(thumb, "vertical-panning", vertical_panning);
        helpers.set_class(thumb, "horizontal-panning", horizontal_panning);
    },

    set_title_and_icon(illust_data)
    {
        var user_data = illust_data? illust_data.userInfo:null;
        helpers.set_page_icon(user_data && user_data.isFollowed? binary_data['favorited_icon.png']:binary_data['regular_pixiv_icon.png']);
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


