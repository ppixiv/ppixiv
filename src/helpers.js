"use strict";

// This is thrown when an XHR request fails.
ppixiv.APIError = class extends Error
{
    constructor(message, url)
    {
        super(message);
        this.url = url;
    }
};

// This is thrown when we disable creating blocked elements.
ppixiv.ElementDisabled = class extends Error
{
};

ppixiv.helpers = {
    blank_image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    
    remove_array_element: function(array, element)
    {
        let idx = array.indexOf(element);
        if(idx != -1)
            array.splice(idx, 1);
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
        while(parent.firstChild !== null)
            parent.firstChild.remove();
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
        var style = document.realCreateElement("style");
        style.type = "text/css";
        style.textContent = css;
        return style;
    },

    get_template: function(type)
    {
        let template = document.body.querySelector(type);
        if(template == null)
            throw "Missing template: " + type;

        // Replace any <ppixiv-inline> inlines on the template, and remember that
        // we've done this so we don't redo it every time the template is used.
        if(!template.dataset.replacedInlines)
        {
            template.dataset.replacedInlines = true;
            helpers.replace_inlines(template.content);
        }

        return template;
    },

    create_from_template: function(type)
    {
        var template;
        if(typeof(type) == "string")
            template = this.get_template(type);
        else
            template = type;

        var node = document.importNode(template.content, true).firstElementChild;
        
        // Make all IDs in the template we just cloned unique.
        for(var svg of node.querySelectorAll("svg"))
            helpers.make_svg_ids_unique(svg);

        return node;
    },

    // Find <ppixiv-inline> elements inside root, and replace them with elements
    // from resources:
    //
    // <ppixiv-inline src=image.svg></ppixiv-inline>
    //
    // Also replace <img src="ppixiv:name"> with resource text.  This is used for images.
    _resource_cache: {},
    replace_inlines(root)
    {
        for(let element of root.querySelectorAll("img"))
        {
            let src = element.getAttribute("src");
            if(!src || !src.startsWith("ppixiv:"))
                continue;

            let name = src.substr(7);
            let resource = ppixiv.resources[name];
            if(resource == null)
            {
                console.error("Unknown resource \"" + name + "\" in", element);
                continue;
            }
            element.setAttribute("src", resource);

            // Put the original URL on the element for diagnostics.
            element.dataset.originalUrl = src;
        }

        for(let element of root.querySelectorAll("ppixiv-inline"))
        {
            let src = element.getAttribute("src");

            // Find the resource.
            let resource = resources[src];
            if(resource == null)
            {
                console.error("Unknown resource \"" + src + "\" in", element);
                continue;
            }

            // Parse this element if we haven't done so yet.
            // If we haven't parsed this 
            if(!helpers._resource_cache[src])
            {
                // resource is HTML.  Parse it by adding it to a <div>.
                let div = document.createElement("div");
                div.innerHTML = resource;
                let node = div.firstElementChild;
                node.remove();

                // Stash the source path on the node.  This is just for debugging to make
                // it easy to tell where things came from.
                node.dataset.ppixivResource = src;

                // Cache the result, so we don't re-parse the node every time we create one.
                helpers._resource_cache[src] = node;
            }

            // Import the cached node to make a copy, then replace the <ppixiv-inline> element
            // with it.
            let node = helpers._resource_cache[src];
            node = document.importNode(node, true);
            element.replaceWith(node);

            // Copy attributes from the <ppixiv-inline> node to the newly created node which
            // is replacing it.  This can be used for simple things, like setting the id.
            for(let attr of element.attributes)
            {
                if(attr.name == "src")
                    continue;

                if(node.hasAttribute(attr.name))
                {
                    console.error("Node", node, "already has attribute", attr);
                    continue;
                }

                node.setAttribute(attr.name, attr.value);
            }
        }
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
                // here.  Handle url(#abcd) inside strings, and things like xlink:xref="#abcd".
                if(attr == "xlink:href" && value.startsWith("#"))
                {
                    let old_id = value.substr(1);
                    let new_id = id_map[old_id];
                    if(new_id == null)
                    {
                        console.warn("Unmatched SVG ID:", old_id);
                        continue;
                    }

                    value = "#" + new_id;
                }

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

                if(new_value != value)
                    node.setAttribute(attr, new_value);
            }
        }

        // Store the index, so the next call will start with the next value.
        helpers._svg_id_sequence = idx;
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

    // Run func from the event loop.
    //
    // This is like setTimeout(func, 0), but avoids problems with setTimeout
    // throttling.
    yield(func)
    {
        return Promise.resolve().then(() => {
            func();
        });
    },

    sleep(ms)
    {
        return new Promise((accept, reject) => {
            setTimeout(() => {
                accept();
            }, ms);
        });
    },

    // Block until DOMContentLoaded.
    wait_for_content_loaded: function()
    {
        return new Promise((accept, reject) => {
            if(document.readyState != "loading")
            {
                accept();
                return;
            }

            window.addEventListener("DOMContentLoaded", (e) => {
                accept();
            }, {
                capture: true,
                once: true,
            });
        });
    },

    // Try to stop the underlying page from doing things (it just creates unnecessary network
    // requests and spams errors to the console), and undo damage to the environment that it
    // might have done before we were able to start.
    cleanup_environment: function()
    {
        // Newer Pixiv pages run a bunch of stuff from deferred scripts, which install a bunch of
        // nastiness (like searching for installed polyfills--which we install--and adding wrappers
        // around them).  Break this by defining a webpackJsonp property that can't be set.  It
        // won't stop the page from running everything, but it keeps it from getting far enough
        // for the weirder scripts to run.
        //
        // Also, some Pixiv pages set an onerror to report errors.  Disable it if it's there,
        // so it doesn't send errors caused by this script.  Remove _send and _time, which
        // also send logs.  It might have already been set (TamperMonkey in Chrome doesn't
        // implement run-at: document-start correctly), so clear it if it's there.
        for(let key of ["onerror", "onunhandledrejection", "_send", "_time", "webpackJsonp"])
        {
            unsafeWindow[key] = null;

            // Use an empty setter instead of writable: false, so errors aren't triggered all the time.
            Object.defineProperty(unsafeWindow, key, {
                get: exportFunction(function() { return null; }, unsafeWindow),
                set: exportFunction(function(value) { }, unsafeWindow),
            });
        }

        // Try to unwrap functions that might have been wrapped by page scripts.
        function unwrap_func(obj, name)
        {
            // Both prototypes and instances might be wrapped.  If this is an instance, look
            // at the prototype to find the original.
            let orig_func = obj.__proto__[name]? obj.__proto__[name]:obj[name];
            if(!orig_func)
            {
                console.log("Couldn't find function to unwrap:", name);
                return;
            }

            if(!orig_func.__sentry_original__)
                return;

            while(orig_func.__sentry_original__)
                orig_func = orig_func.__sentry_original__;
            obj[name] = orig_func;
        }        

        try {
            unwrap_func(document, "addEventListener");
            unwrap_func(document, "removeEventListener");
            unwrap_func(unsafeWindow, "fetch");
            unwrap_func(unsafeWindow, "setTimeout");
            unwrap_func(unsafeWindow, "setInterval");
            unwrap_func(EventTarget.prototype, "addEventListener");
            unwrap_func(EventTarget.prototype, "removeEventListener");
            unwrap_func(XMLHttpRequest.prototype, "send");

            // We might get here before the mangling happens, which means it might happen
            // in the future.  Freeze the objects to prevent this.
            Object.freeze(EventTarget.prototype);

            // Remove Pixiv's wrappers from console.log, etc., and then apply our own to console.error
            // to silence its error spam.  This will cause all error messages out of console.error
            // to come from this line, which is usually terrible, but our logs come from window.console
            // and not unsafeWindow.console, so this doesn't affect us.
            for(let func in window.console)
                unsafeWindow.console[func] = window.console[func];
            Object.freeze(unsafeWindow.console);

            // Some Pixiv pages load jQuery and spam a bunch of error due to us stopping
            // their scripts.  Try to replace jQuery's exception hook with an empty one to
            // silence these.  This won't work if jQuery finishes loading after we do, but
            // that's not currently happening, so this is all we do for now.
            if("jQuery" in unsafeWindow)
                jQuery.Deferred.exceptionHook = () => { };
        } catch(e) {
            console.error("Error unwrapping environment", e);
        }

        // Try to kill the React scheduler that Pixiv uses.  It uses a MessageChannel to run itself,
        // so we can disable it by disabling MessagePort.postmessage.  This seems to happen early
        // enough to prevent the first scheduler post from happening.
        //
        // Store the real postMessage, so we can still use it ourself.
        try {
            unsafeWindow.MessagePort.prototype.realPostMessage = unsafeWindow.MessagePort.prototype.postMessage;
            unsafeWindow.MessagePort.prototype.postMessage = (msg) => { };
        } catch(e) {
            console.error("Error disabling postMessage", e);
        }

        // TamperMonkey reimplements setTimeout, etc. for some reason, which is slower
        // than the real versions.  Grab them instead.
        ppixiv.setTimeout = unsafeWindow.setTimeout.bind(unsafeWindow);
        ppixiv.setInterval = unsafeWindow.setInterval.bind(unsafeWindow);
        ppixiv.clearTimeout = unsafeWindow.clearTimeout.bind(unsafeWindow);

        // Disable the page's timers.  This helps prevent things like GTM from running.
        unsafeWindow.setTimeout = (f, ms) => { return -1; };
        unsafeWindow.setInterval = (f, ms) => { return -1; };
        unsafeWindow.clearTimeout = () => { };

        window.addEventListener = Window.prototype.addEventListener.bind(unsafeWindow);
        window.removeEventListener = Window.prototype.removeEventListener.bind(unsafeWindow);
        
        // Try to freeze the document.  This works in Chrome but not Firefox.
        try {
            Object.freeze(document);
        } catch(e) {
            console.error("Error unwrapping environment", e);
        }

        // We have to use unsafeWindow.fetch in Firefox, since window.fetch is from a different
        // context and won't send requests with the site's origin, which breaks everything.  In
        // Chrome it doesn't matter.
        helpers.fetch = unsafeWindow.fetch;
        unsafeWindow.Image = exportFunction(function() { }, unsafeWindow);

        // Replace window.fetch with a dummy to prevent some requests from happening.
        class dummy_fetch
        {
            sent() { return this; }
        };
        dummy_fetch.prototype.ok = true;
        unsafeWindow.fetch = exportFunction(function() { return new dummy_fetch(); }, unsafeWindow);

        unsafeWindow.XMLHttpRequest = exportFunction(function() { }, exportFunction);

        // Similarly, prevent it from creating script and style elements.  Sometimes site scripts that
        // we can't disable keep running and do things like loading more scripts or adding stylesheets.
        // Use realCreateElement to bypass this.
        let origCreateElement = unsafeWindow.HTMLDocument.prototype.createElement;
        unsafeWindow.HTMLDocument.prototype.realCreateElement = unsafeWindow.HTMLDocument.prototype.createElement;
        unsafeWindow.HTMLDocument.prototype.createElement = function(type, options)
        {
            // Prevent the underlying site from creating new script and style elements.
            if(type == "script" || type == "style")
            {
                // console.warn("Disabling createElement " + type);
                throw new ElementDisabled("Element disabled");
            }
            return origCreateElement.apply(this, arguments);
        };

        // Catch and discard ElementDisabled.
        //
        // This is crazy: the error event doesn't actually receive the unhandled exception.
        // We have to examine the message to guess whether an error is ours.
        unsafeWindow.addEventListener("error", (e) => {
            if(e.message && e.message.indexOf("Element disabled") == -1)
                return;

            e.preventDefault();
            e.stopPropagation();
        }, true);

        // We have to hit things with a hammer to get Pixiv's scripts to stop running, which
        // causes a lot of errors.  Silence all errors that have a stack within Pixiv's sources,
        // as well as any errors from ElementDisabled.
        window.addEventListener("error", (e) => {
            let silence_error = false;
            if(e.filename && e.filename.indexOf("s.pximg.net") != -1)
                silence_error = true;

            if(silence_error)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
        }, true);

        window.addEventListener("unhandledrejection", (e) => {
            let silence_error = false;
            if(e.reason && e.reason.stack && e.reason.stack.indexOf("s.pximg.net") != -1)
                silence_error = true;
            if(e.reason && e.reason.message == "Element disabled")
                silence_error = true;

            if(silence_error)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
        }, true);
    },
    
    add_style: function(name, css)
    {
        let style = helpers.create_style(css);
        style.id = name;
        document.querySelector("head").appendChild(style);
        return style;
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

    // dataset is another web API with nasty traps: if you assign false or null to
    // it, it assigns "false" or "null", which are true values.
    set_dataset: function(dataset, name, enable)
    {
        if(enable)
            dataset[name] = 1;
        else
            delete dataset[name];
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

    send_request: function(options)
    {
        if(options == null)
            options = {};

        // Usually we'll use helpers.fetch, but fall back on window.fetch in case we haven't
        // called block_network_requests yet.  This happens if main_controller.setup needs
        // to fetch the page.
        let fetch = helpers.fetch || window.fetch;

        let data = { };

        // For Firefox, we need to clone data into the page context.  In Chrome this do nothing.
        data = cloneInto(data, window);

        data.method = options.method || "GET";
        data.signal = options.signal;
        data.cache = options.cache;
        if(options.data)
            data.body = cloneInto(options.data, window); 

        // Convert options.headers to a Headers object.  For Firefox, this has to be
        // unsafeWindow.Headers.
        if(options.headers)
        {
            let headers = new unsafeWindow.Headers();
            for(let key in options.headers)
                headers.append(key, options.headers[key]);
            data.headers = headers;
        }

        return fetch(options.url, data);
    },

    // Send a request with the referer, cookie and CSRF token filled in.
    async send_pixiv_request(options)
    {
        if(options.headers == null)
            options.headers = {};

        // Only set x-csrf-token for requests to www.pixiv.net.  It's only needed for API
        // calls (not things like ugoira ZIPs), and the request will fail if we're in XHR
        // mode and set headers, since it'll trigger CORS.
        var hostname = new URL(options.url, ppixiv.location).hostname;
        if(hostname == "www.pixiv.net" && "global_data" in window)
        {
            options.headers["x-csrf-token"] = global_data.csrf_token;
            options.headers["x-user-id"] = global_data.user_id;
        }

        let result = await helpers.send_request(options);

        // Return the requested type.  If we don't know the type, just return the
        // request promise itself.
        if(options.responseType == "json")
        {
            let json = await result.json();

            // In Firefox we need to use unsafeWindow.fetch, since window.fetch won't run
            // as the page to get the correct referer.  Work around secondary brain damage:
            // since it comes from the apge it's in a wrapper object that we need to remove.
            // We shouldn't be seeing Firefox wrapper behavior at all.  It's there to
            // protect the user from us, not us from the page.
            if(json.wrappedJSObject)
                json = json.wrappedJSObject;

            return json;
        }

        if(options.responseType == "document")
        {
            let text = await result.text();
            return new DOMParser().parseFromString(text, 'text/html');
        }

        return result;
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

        return result;
    },

    create_search_params(data)
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
    },

    async get_request(url, data, options)
    {
        let params = this.create_search_params(data);

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

        return result;
    },

    download_url: async function(url)
    {
        return new Promise((accept, reject) => {
            if(url == null)
            {
                accept(null);
                return;
            }

            // We use i-cf for image URLs, but we don't currently have this in @connect,
            // so we can't use that here.  Switch from i-cf back to the original URLs.
            url = new URL(url);
            if(url.hostname == "i-cf.pximg.net")
                url.hostname = "i.pximg.net";

            GM_xmlhttpRequest({
                "method": "GET",
                "url": url,
                "responseType": "arraybuffer",

                "headers": {
                    "Cache-Control": "max-age=360000",
                    "Referer": "https://www.pixiv.net/",
                    "Origin": "https://www.pixiv.net/",
                },

                onload: (result) => {
                    accept(result.response);
                },
                onerror: (e) => {
                    reject(e);
                },
            });
        });
    },

    download_urls: async function(urls)
    {
        let results = [];
        for(let url of urls)
        {
            let result = await helpers.download_url(url);
            results.push(result);
        }

        return results;
    },

    // Load a page in an iframe, and call callback on the resulting document.
    // Remove the iframe when the callback returns.
    async load_data_in_iframe(url, options={})
    {
        // If we're in Tampermonkey, we don't need any of the iframe hijinks and we can
        // simply make a request with responseType: document.  This is much cleaner than
        // the Greasemonkey workaround below.
        return await helpers.send_pixiv_request({
            method: "GET",
            url: url,
            responseType: "document",
            cache: options.cache,
        });
    },

    set_recent_bookmark_tags(tags)
    {
        settings.set("recent-bookmark-tags", JSON.stringify(tags));
    },

    get_recent_bookmark_tags()
    {
        var recent_bookmark_tags = settings.get("recent-bookmark-tags");
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

        var recent_tags = settings.get("recent-tag-searches") || [];
        var idx = recent_tags.indexOf(tag);
        if(idx != -1)
            recent_tags.splice(idx, 1);
        recent_tags.unshift(tag);

        // Trim the list.
        recent_tags.splice(50);
        settings.set("recent-tag-searches", recent_tags);

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
        var recent_tags = settings.get("recent-tag-searches") || [];
        while(1)
        {
            var idx = recent_tags.indexOf(tag);
            if(idx == -1)
                break;
            recent_tags.splice(idx, 1);
        }
        settings.set("recent-tag-searches", recent_tags);
        
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

    // Return true if the given illust_data.tags contains the pixel art (ドット絵) tag.
    tags_contain_dot(illust_data)
    {
        for(let tag of illust_data.tagList)
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
            var url = new URL(a.href, ppixiv.location);
            if(url.hostname != "pixiv.net" && url.hostname != "www.pixiv.net" || url.hash != "")
                continue;

            url.hash = "#ppixiv";
            a.href = url.toString();
        }
    },

    // Find the real link inside Pixiv's silly jump.php links.
    fix_pixiv_link: function(link)
    {
        // These can either be /jump.php?url or /jump.php?url=url.
        let url = new URL(link);
        if(url.pathname != "/jump.php")
            return link;
        if(url.searchParams.has("url"))
            return url.searchParams.get("url");
        else
        {
            var target = url.search.substr(1); // remove "?"
            target = decodeURIComponent(target);
            return target;
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
            a.href = helpers.fix_pixiv_link(a.href);
    },

    // Some of Pixiv's URLs have languages prefixed and some don't.  Ignore these and remove
    // them to make them simpler to parse.
    get_url_without_language: function(url)
    {
        if(/^\/..\//.exec(url.pathname))
            url.pathname = url.pathname.substr(3);
        
        return url;
    },

    // From a URL like "/en/tags/abcd", return "tags".
    get_page_type_from_url: function(url)
    {
        url = new unsafeWindow.URL(url);
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");
        return parts[1];
    },
    
    set_page_title: function(title)
    {
        let title_element = document.querySelector("title");
        if(title_element.textContent == title)
            return;

        title_element.textContent = title;
        document.dispatchEvent(new Event("windowtitlechanged"));
    },

    set_page_icon: function(url)
    {
        document.querySelector("link[rel='icon']").href = url;
    },

    // Get the search tags from an "/en/tags/TAG" search URL.
    _get_search_tags_from_url: function(url)
    {
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");

        // ["", "tags", tag string, "search type"]
        let tags = parts[2] || "";
        return decodeURIComponent(tags);
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

            // Only look at "/tags/TAG" URLs.
            var url = new URL(e.target.href);
            url = helpers.get_url_without_language(url);

            let parts = url.pathname.split("/");
            let first_part = parts[1];
            if(first_part != "tags")
                return;

            let tag = helpers._get_search_tags_from_url(url);
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
    
    // Replace the given field in the URL path.
    //
    // If the path is "/a/b/c/d", "a" is 0 and "d" is 4.
    set_path_part: function(url, index, value)
    {
        url = new URL(url);

        // Split the path, and extend it if needed.
        let parts = url.pathname.split("/");

        // The path always begins with a slash, so the first entry in parts is always empty.
        // Skip it.
        index++;
        
        // Hack: If this URL has a language prefixed, like "/en/users", add 1 to the index.  This way
        // the caller doesn't need to check, since URLs can have these or omit them.
        if(parts.length > 1 && parts[1].length == 2)
            index++;
        
        // Extend the path if needed.
        while(parts.length < index)
            parts.push("");

        parts[index] = value;

        // If the value is empty and this was the last path component, remove it.  This way, we
        // remove the trailing slash from "/users/12345/".
        if(value == "" && parts.length == index+1)
            parts = parts.slice(0, index);

        url.pathname = parts.join("/");
        return url;
    },

    get_path_part: function(url, index, value)
    {
        // The path always begins with a slash, so the first entry in parts is always empty.
        // Skip it.
        index++;

        let parts = url.pathname.split("/");
        if(parts.length > 1 && parts[1].length == 2)
            index++;
        
        return parts[index] || "";
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

    args: class
    {
        constructor(url)
        {
            url = new URL(url, ppixiv.location);

            this.path = url.pathname;
            this.query = url.searchParams;
            this.hash = helpers.get_hash_args(url);

            // History state is only available when we come from the current history state,
            // since URLs don't have state.
            this.state = { };
        }

        // Return the args for the current page.
        static get location()
        {
            let result = new this(ppixiv.location);

            // Include history state as well.  Make a deep copy, so changing this doesn't
            // modify history.state.
            result.state = JSON.parse(JSON.stringify(history.state)) || { };

            return result;
        }

        get url()
        {
            let url = new URL(ppixiv.location);
            url.pathname = this.path;
            url.search = this.query.toString();

            // Set the hash portion of url to args, as a ppixiv url.
            //
            // For example, given { a: "1", b: "2" }, set the hash to #ppixiv?a=1&b=2.
            url.hash = "#ppixiv";

            let hash_string = this.hash.toString();
            if(hash_string != "")
                url.hash += "?" + hash_string;

            return url;
        }
    },

    // Set document.href, either adding or replacing the current history state.
    //
    // window.onpopstate will be synthesized if the URL is changing.
    //
    // If cause is set, it'll be included in the popstate event as navigationCause.
    // This can be used in event listeners to determine what caused a navigation.
    // For browser forwards/back, this won't be present.
    //
    // args can be a helpers.args object, or a URL object.
    set_page_url(args, add_to_history, cause)
    {
        if(args instanceof URL)
            args = new helpers.args(args);

        var old_url = ppixiv.location.toString();

        // If the state wouldn't change at all, don't set it, so we don't add junk to
        // history if the same link is clicked repeatedly.  Comparing state via JSON
        // is OK here since JS will maintain key order.
        if(args.url.toString() == old_url && JSON.stringify(args.state) == JSON.stringify(history.state))
            return;

        // Use the history state from args if it exists.
        let history_data = {
            ...args.state
        };

        // history.state.index is incremented whenever we navigate forwards, so we can
        // tell in onpopstate whether we're navigating forwards or backwards.
        history_data.index = helpers.current_history_state_index();
        if(add_to_history)
            history_data.index++;

        // console.log("Changing state to", args.url.toString());
        if(add_to_history)
            ppixiv.history.pushState(history_data, "", args.url.toString());
        else
            ppixiv.history.replaceState(history_data, "", args.url.toString());

        // Chrome is broken.  After replacing state for a while, it starts logging
        //
        // "Throttling history state changes to prevent the browser from hanging."
        //
        // This is completely broken: it triggers with state changes no faster than the
        // user can move the mousewheel (much too sensitive), and it happens on replaceState
        // and not just pushState (which you should be able to call as fast as you want).
        //
        // People don't think things through.
        // console.log("Set URL to", ppixiv.location.toString(), add_to_history);

        if(ppixiv.location.toString() != old_url)
        {
            // Browsers don't send onpopstate for history changes, but we want them, so
            // send a synthetic one.
            // console.log("Dispatching popstate:", ppixiv.location.toString());
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

    distance([x1,y1], [x2,y2])
    {
        let distance = Math.pow(x1-x2, 2) + Math.pow(y1-y2, 2);
        return Math.pow(distance, 0.5);
    },
    
    // Return a promise that waits for img to load.
    //
    // If img loads successfully, resolve with null.  If abort_signal is aborted,
    // resolve with "aborted".  Otherwise, reject with "failed".  This never
    // rejects.
    //
    // If we're aborted, img.src will be set to helpers.blank_image.  Otherwise,
    // the image will load anyway.  This is a little invasive, but it's what we
    // need to do any time we have a cancellable image load, so we might as well
    // do it in one place.
    wait_for_image_load(img, abort_signal)
    {
        return new Promise((resolve, reject) => {
            let src = img.src;

            // Resolve immediately if the image is already loaded.
            if(img.complete)
            {
                resolve(null);
                return;
            }

            if(abort_signal && abort_signal.aborted)
            {
                img.src = helpers.blank_image;
                resolve("aborted");
                return;
            }

            // Cancelling this controller will remove all of our event listeners.
            let remove_listeners_signal = new AbortController();

            img.addEventListener("error", (e) => {
                // We kept a reference to src in case in changes, so this log should
                // always point to the right URL.
                console.log("Error loading image:", src);
                remove_listeners_signal.abort();
                resolve("failed");
            }, { signal: remove_listeners_signal.signal });

            img.addEventListener("load", (e) => {
                remove_listeners_signal.abort();
                resolve(null);
            }, { signal: remove_listeners_signal.signal });

            if(abort_signal)
            {
                abort_signal.addEventListener("abort",(e) => {
                    img.src = helpers.blank_image;
                    remove_listeners_signal.abort();
                    resolve("aborted");
                }, { signal: remove_listeners_signal.signal });
            }
        });
    },

    // Wait until img.naturalWidth/naturalHeight are available.
    //
    // There's no event to tell us that img.naturalWidth/naturalHeight are
    // available, so we have to jump hoops.  Loop using requestAnimationFrame,
    // since this lets us check quickly at a rate that makes sense for the
    // user's system, and won't be throttled as badly as setTimeout.
    async wait_for_image_dimensions(img, abort_signal)
    {
        return new Promise((resolve, reject) => {
            let src = img.src;

            if(abort_signal && abort_signal.aborted)
                resolve(false);
            if(img.naturalWidth != 0)
                resolve(true);

            let frame_id = null;

            // If abort_signal is aborted, cancel our frame request.
            let abort = () => {
                abort_signal.removeEventListener("aborted", abort);
                if(frame_id != null)
                    cancelAnimationFrame(frame_id);
                resolve(false);
            };
            if(abort_signal)
                abort_signal.addEventListener("aborted", abort);

            let check = () => {
                if(img.naturalWidth != 0)
                {
                    resolve(true);
                    if(abort_signal)
                        abort_signal.removeEventListener("aborted", abort);
                    return;
                }

                frame_id = requestAnimationFrame(check);
            };
            check();
        });
    },

    // Wait up to ms for promise to complete.  If the promise completes, return its
    // result, otherwise return "timed-out".
    async await_with_timeout(promise, ms)
    {
        let sleep = new Promise((accept, reject) => {
            setTimeout(() => {
                accept("timed-out");
            }, ms);
        });

        // Wait for whichever finishes first.
        return await Promise.any([promise, sleep]);
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

        var css = `
            ${top_selector} .thumbnail-inner { 
                width: ${max_width}px;
                height: ${max_height}px;
                contain-intrinsic-size: ${max_width}px ${max_height}px;
            }
            ${top_selector} .thumbnails { gap: ${padding}px; }
            ${top_selector} .last-viewed-image-marker { 
                width: ${max_width/4}px;
            }
        `;
        if(container_width != null)
            css += `${top_selector} > .thumbnails { max-width: ${container_width}px; }`;
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

    set_title(illust_data)
    {
        if(illust_data == null)
        {
            helpers.set_page_title("Loading...");
            return;
        }

        var page_title = "";
        if(illust_data.bookmarkData)
            page_title += "★";

        page_title += illust_data.userName + " - " + illust_data.illustTitle;
        helpers.set_page_title(page_title);
    },

    set_icon(illust_data)
    {
        helpers.set_page_icon(resources['resources/regular-pixiv-icon.png']);
    },

    set_title_and_icon(illust_data)
    {
        helpers.set_title(illust_data)
        helpers.set_icon(illust_data)
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
    // Return the type of the ID and the underlying illust or user ID.
    parse_id(id)
    {
        let parts = id.split(":");
        let type = parts.length < 2?  "illust": parts[0];
        let actual_id = parts.length < 2? id: parts[1];
        return {
            type: type,
            id: actual_id,
        }
    },

    // Generate a UUID.
    create_uuid()
    {
        let data = new Uint8Array(32);
        crypto.getRandomValues(data);

        // variant 1
        data[8] &= 0b00111111;
        data[8] |= 0b10000000;

        // version 4
        data[6] &= 0b00001111;
        data[6] |= 4 << 4;

        let result = "";
        for(let i = 0; i < 4; ++i) result += data[i].toString(16).padStart(2, "0");
        result += "-";
        for(let i = 4; i < 6; ++i) result += data[i].toString(16).padStart(2, "0");
        result += "-";
        for(let i = 6; i < 8; ++i) result += data[i].toString(16).padStart(2, "0");
        result += "-";
        for(let i = 8; i < 10; ++i) result += data[i].toString(16).padStart(2, "0");
        result += "-";
        for(let i = 10; i < 16; ++i) result += data[i].toString(16).padStart(2, "0");
        return result;
    },

    shuffle_array(array)
    {
        for(let idx = 0; idx < array.length; ++idx)
        {
            let swap_with = Math.floor(Math.random() * array.length);
            [array[idx], array[swap_with]] = [array[swap_with], array[idx]];
        }
    },

    adjust_image_url_hostname(url)
    {
        if(url.hostname == "i.pximg.net")
            url.hostname = "i-cf.pximg.net";
    },

    // Given a low-res thumbnail URL from thumbnail data, return a high-res thumbnail URL.
    // If page isn't 0, return a URL for the given manga page.
    get_high_res_thumbnail_url(url, page=0)
    {
        // Some random results on the user recommendations page also return this:
        //
        // /c/540x540_70/custom-thumb/img/.../12345678_custom1200.jpg
        //
        // Replace /custom-thumb/' with /img-master/ first, since it makes matching below simpler.
        url = url.replace("/custom-thumb/", "/img-master/");

        // path should look like
        //
        // /c/250x250_80_a2/img-master/img/.../12345678_square1200.jpg
        //
        // where 250x250_80_a2 is the resolution and probably JPEG quality.  We want
        // the higher-res thumbnail (which is "small" in the full image data), which
        // looks like:
        //
        // /c/540x540_70/img-master/img/.../12345678_master1200.jpg
        //
        // The resolution field is changed, and "square1200" is changed to "master1200".
        var url = new URL(url, ppixiv.location);
        var path = url.pathname;
        var re = /(\/c\/)([^\/]+)(.*)(square1200|master1200|custom1200).jpg/;
        var match = re.exec(path);
        if(match == null)
        {
            console.warn("Couldn't parse thumbnail URL:", path);
            return url.toString();
        }

        url.pathname = match[1] + "540x540_70" + match[3] + "master1200.jpg";

        if(page != 0)
        {
            // Manga URLs end with:
            //
            // /c/540x540_70/custom-thumb/img/.../12345678_p0_master1200.jpg
            //
            // p0 is the page number.
            url.pathname = url.pathname.replace("_p0_master1200", "_p" + page + "_master1200");
        }

        this.adjust_image_url_hostname(url);

        return url.toString();
    },
};

// Handle maintaining and calling a list of callbacks.
ppixiv.callback_list = class
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
ppixiv.view_hidden_listener = class
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
ppixiv.image_canvas_filter = class
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
        this.current_url = helpers.blank_image;
    }

    update_canvas()
    {
        // The URL for the image we're rendering.  If the image isn't complete, use the blank image
        // URL instead, since we're just going to clear.
        let current_url = this.img.src;
        if(!this.img.complete)
            current_url = helpers.blank_image;

        if(current_url == this.current_url)
            return;
        
        this.canvas.width = this.img.naturalWidth;
        this.canvas.height = this.img.naturalHeight;
        this.clear();

        this.current_url = current_url;

        // If we're rendering the blank image (or an incomplete image), stop.
        if(current_url == helpers.blank_image)
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
ppixiv.hover_with_delay = class
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
ppixiv.key_storage = class
{
    constructor(store_name, {db_upgrade=null, version=1}={})
    {
        this.db_name = store_name;
        this.db_upgrade = db_upgrade;
        this.store_name = store_name;
        this.version = version;
    }

    // Open the database, run func, then close the database.
    //
    // If you open a database with IndexedDB and then leave it open, like you would with
    // any other database, any attempts to add stores (which you can do seamlessly with
    // any other database) will permanently wedge the database.  We have to open it and
    // close it around every op.
    async db_op(func)
    {
        let db = await this.open_database();
        try {
            return await func(db);
        } finally {
            db.close();
        }
    }

    async get_db_version()
    {
        let dbs = await indexedDB.databases();
        for(let db of dbs)
        {
            if(db.name == this.db_name)
                return db.version;
        }

        return 0;
    }

    open_database()
    {
        return new Promise((resolve, reject) => {
            let request = indexedDB.open(this.db_name, this.version);

            // If this happens, another tab has the database open.
            request.onblocked = e => {
                console.error("Database blocked:", e);
            };

            request.onupgradeneeded = e => {
                // If we have a db_upgrade function, let it handle the upgrade.  Otherwise, we're
                // just creating the initial database and we're not doing anything special with it.
                let db = e.target.result;
                if(this.db_upgrade)
                    this.db_upgrade(e);
                else
                    db.createObjectStore(this.store_name);
            };

            request.onsuccess = e => {
                let db = e.target.result;
                resolve(db);
            };

            request.onerror = e => {
                console.log(`Error opening database: ${request.error}`);
                reject(e);
            };
        });
    }

    get_store(db)
    {
        let transaction = db.transaction(this.store_name, "readwrite");
        return transaction.objectStore(this.store_name);
    }

    static await_request(request)
    {
        return new Promise((resolve, reject) => {
            let abort = new AbortController;
            request.addEventListener("success", (e) => {
                abort.abort();
                resolve(request.result);
            }, { signal: abort.signal });

            request.addEventListener("error", (e) => {
                abort.abort();
                reject(request.result);
            }, { signal: abort.signal });
        });        
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
        return await this.db_op(async (db) => {
            return await key_storage.async_store_get(this.get_store(db), key);
        });
    }

    // Given a list of keys, return known translations.  Tags that we don't have data for are null.
    async multi_get(keys)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);

            let promises = [];
            for(let key of keys)
                promises.push(key_storage.async_store_get(store, key));
            return await Promise.all(promises);
        });
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
        return await this.db_op(async (db) => {
            return key_storage.async_store_set(this.get_store(db), key, value);
        });
    }

    // Given a dictionary, set all key/value pairs.
    async multi_set(data)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);

            let promises = [];
            for(let [key, value] of Object.entries(data))
            {
                let request = store.put(value, key);
                promises.push(key_storage.await_request(request));
            }
            await Promise.all(promises);
        });
    }

    async multi_set_values(data)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);
            let promises = [];
            for(let item of data)
            {
                let request = store.put(item);
                promises.push(key_storage.await_request(request));
            }
            return Promise.all(promises);
        });
    }

    // Delete a list of keys.
    async multi_delete(keys)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);
            let promises = [];
            for(let key of keys)
            {
                let request = store.delete(key);
                promises.push(key_storage.await_request(request));
            }
            return Promise.all(promises);
        });
    }

    // Delete all keys.
    async clear()
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);
            await store.clear();
        });
    }
}

ppixiv.SaveScrollPosition = class
{
    constructor(node)
    {
        this.node = node;
        this.child = null;
        this.original_scroll_top = this.node.scrollTop;
    }

    // Instead of saving the top-level scroll position, store the scroll position of a given child.
    save_relative_to(child)
    {
        this.child = child;
        this.original_offset_top = child.offsetTop;
    }

    restore()
    {
        let scroll_top = this.original_scroll_top;
        if(this.child)
        {
            let offset = this.child.offsetTop - this.original_offset_top;
            scroll_top += offset;
        }
        this.node.scrollTop = scroll_top;
    }
};

// VirtualHistory is a wrapper for document.location and window.history to allow
// setting a virtual, temporary document location.  These are ppixiv.location and
// ppixiv.history, and have roughly the same interface.
//
// This can be used to preview another page without changing browser history, and
// works around a really painful problem with the history API: while history.pushState
// and replaceState are sync, history.back() is async.  That makes it very hard to
// work with reliably.
ppixiv.VirtualHistory = class
{
    constructor()
    {
        this.virtual_url = null;

        // ppixiv.location can be accessed like document.location.
        Object.defineProperty(ppixiv, "location", {
            get: () => {
                // If we're not using a virtual location, return document.location.
                // Otherwise, return virtual_url.  Always return a copy of virtual_url,
                // since the caller can modify it and it should only change through
                // explicit history changes.
                if(this.virtual_url == null)
                    return new URL(document.location);
                else
                    return new URL(this.virtual_url);
            },
            set: (value) => {
                // We could support assigning ppixiv.location, but we always explicitly
                // pushState.  Just throw an exception if we get here accidentally.
                throw Error("Can't assign to ppixiv.location");

                /*
                if(!this.virtual)
                {
                    document.location = value;
                    return;
                }

                // If we're virtual, replace the virtual URL.
                this.virtual_url = new URL(value, this.virtual_url);
                this.broadcastPopstate();
                */
            },
        });
    }

    get virtual()
    {
        return this.virtual_url != null;
    }

    url_is_virtual(url)
    {
        // Push a virtual URL by putting #virtual=1 in the hash.
        let args = new helpers.args(url);
        return args.hash.get("virtual");
    }

    pushState(data, title, url)
    {
        url = new URL(url, document.location);
        let virtual = this.url_is_virtual(url);
        
        // We don't support a history of virtual locations.  Once we're virtual, we
        // can only replaceState or back out to the real location.
        if(virtual && this.virtual_url)
            throw Error("Can't push a second virtual location");

        // If we're not pushing a virtual location, just use a real one.
        if(!virtual)
        {
            this.virtual_url = null; // no longer virtual
            return window.history.pushState(data, title, url);
        }
        
        // Note that browsers don't dispatch popstate on pushState (which makes no sense at all),
        // so we don't here either to match.
        this.virtual_data = data;
        this.virtual_title = title;
        this.virtual_url = url;
    }

    replaceState(data, title, url)
    {
        url = new URL(url, document.location);
        let virtual = this.url_is_virtual(url);
        
        if(!virtual)
        {
            // If we're replacing a virtual location with a real one, pop the virtual location
            // and push the new state instead of replacing.  Otherwise, replace normally.
            if(this.virtual_url != null)
            {
                this.virtual_url = null;
                return window.history.pushState(data, title, url);
            }
            else
            {
                return window.history.replaceState(data, title, url);
            }
        }

        // We can only replace a virtual location with a virtual location.  
        // We can't replace a real one with a virtual one, since we can't edit
        // history like that.
        if(this.virtual_url == null)
            throw Error("Can't replace a real history entry with a virtual one");

        this.virtual_url = url;
    }

    get state()
    {
        if(this.virtual)
            return this.virtual_data;

        // Use unsafeWindow.history instead of window.history to avoid unnecessary
        // TamperMonkey wrappers.
        return unsafeWindow.history.state;
    }

    set state(value)
    {
        if(this.virtual)
            this.virtual_data = value;
        else
            unsafeWindow.history.state = value;
    }
    
    back()
    {
        // If we're backing out of a virtual URL, clear it to return to the real one.
        if(this.virtual_url)
        {
            this.virtual_url = null;
            this.broadcastPopstate();
        }
        else
        {
            window.history.back();
        }
    }

    broadcastPopstate()
    {
        let e = new PopStateEvent("popstate");
        e.navigationCause = "leaving-virtual";
        window.dispatchEvent(e);
    }
};
ppixiv.history = new VirtualHistory;

// The pointer API is sadistically awful.  Only the first pointer press is sent by pointerdown.
// To get others, you have to register pointermove and get spammed with all mouse movement.
// You have to register pointermove when a button is pressed in order to see other buttons
// without keeping a pointermove event running all the time.  You also have to use e.buttons
// instead of e.button, because pointermove doesn't tell you what buttons changed, making e.button
// meaningless.
//
// Who designed this?  This isn't some ancient IE6 legacy API.  How do you screw up a mouse
// event API this badly?
ppixiv.pointer_listener = class
{
    // callback(event) will be called each time buttons change.  The event will be the event
    // that actually triggered the state change, and can be preventDefaulted, etc.
    //
    // To disable, include {signal: AbortSignal} in options.
    constructor({element, callback, button_mask=1, ...options}={})
    {
        this.element = element;
        this.button_mask = button_mask;
        this.pointermove_registered = false;
        this.buttons_down = 0;
        this.callback = callback;
        this.event_options = options;

        let handling_right_click = (button_mask & 2) != 0;
        this.blocking_context_menu_until_timer = false;
        if(handling_right_click)
            window.addEventListener("contextmenu", this.oncontextmenu, this.event_options);

        if(options.signal)
        {
            options.signal.addEventListener("abort", (e) => {
                // If we have a block_contextmenu_timer timer running when we're cancelled, remove it.
                if(this.block_contextmenu_timer != null)
                    clearTimeout(this.block_contextmenu_timer);
            });
        }
        
        this.element.addEventListener("pointerdown", this.onpointerevent, this.event_options);
        this.element.addEventListener("pointerup", this.onpointerevent, this.event_options);
        this.element.addEventListener("pointercancel", this.onpointerup, this.event_options);
    }

    register_mousemove(enable)
    {
        if(this.pointermove_registered)
            return;
        this.pointermove_registered = true;
        this.element.addEventListener("pointermove", this.onpointermove, this.event_options);
    }

    unregister_mousemove(enable)
    {
        if(!this.pointermove_registered)
            return;
        this.pointermove_registered = false;
        this.element.removeEventListener("pointermove", this.onpointermove, { ...this.event_options });
    }

    button_changed(buttons, event)
    {
        // We need to register pointermove to see presses past the first.
        if(buttons)
            this.register_mousemove();
        else
            this.unregister_mousemove();

        let old_buttons_down = this.buttons_down;
        this.buttons_down = buttons;
        for(let button = 0; button < 5; ++button)
        {
            let mask = 1 << button;

            // Ignore this if it's not a button change for a button in our mask.
            if(!(mask & this.button_mask))
                continue;
            let was_pressed = old_buttons_down & mask;
            let is_pressed = this.buttons_down & mask;

            if(was_pressed == is_pressed)
                continue;

            // Pass the button in event.mouseButton, and whether it was pressed or released in event.pressed.
            // Don't use e.button, since it's in a different order than e.buttons.
            event.mouseButton = button;
            event.pressed = is_pressed;
            this.callback(event);

            // Remove event.mouseButton so it doesn't appear for unrelated event listeners.
            delete event.mouseButton;
            delete event.pressed;

            // Right-click handling
            if(button == 1)
            {
                // If this is a right-click press and the user prevented the event, block the context
                // menu when this button is released.
                if(is_pressed && event.defaultPrevented)
                    this.block_context_menu_on_release = true;

                // If this is a right-click release and the user prevented the event (or the corresponding
                // press earlier), block the context menu briefly.  There seems to be no other way to do
                // this: cancelling pointerdown or pointerup don't prevent actions like they should,
                // contextmenu happens afterwards, and there's no way to know if a contextmenu event
                // is coming other than waiting for an arbitrary amount of time.
                if(!is_pressed && (event.defaultPrevented || this.block_context_menu_on_release))
                {
                    this.block_context_menu_on_release = false;
                    this.block_context_menu_until_timer();
                }
            }
        }

    }

    onpointerevent = (e) =>
    {
        this.button_changed(e.buttons, e);
    }

    onpointermove = (e) =>
    {
        // Short-circuit processing pointermove if button is -1, which means it's just
        // a move (the only thing this event should even be used for).
        if(e.button == -1)
            return;

        this.button_changed(e.buttons, e);
    }

    oncontextmenu = (e) =>
    {
        if(this.blocking_context_menu_until_timer)
        {
            // console.log("stop context menu (waiting for timer)");
            e.preventDefault();
            e.stopPropagation();
        }
    }        

    // Block contextmenu for a while.
    block_context_menu_until_timer()
    {
        // console.log("Waiting for timer before releasing context menu");

        this.blocking_context_menu_until_timer = true;
        if(this.block_contextmenu_timer != null)
        {
            clearTimeout(this.block_contextmenu_timer);
            this.block_contextmenu_timer = null;
        }

        this.block_contextmenu_timer = setTimeout(() => {
            this.block_contextmenu_timer = null;

            // console.log("Releasing context menu after timer");
            this.blocking_context_menu_until_timer = false;
        }, 50);
    }
}


// This is an attempt to make it easier to handle a common problem with
// asyncs: checking whether what we're doing should continue after awaiting.
// The wrapped function will be passed an AbortSignal.  It can be used normally
// for aborting async calls.  It also has signal.cancel(), which will throw
// SentinelAborted if another call to the guarded function has been made.
class SentinelAborted extends Error { };

ppixiv.SentinelGuard = function(func, self)
{
    if(self)
        func = func.bind(self);
    let sentinel = null;

    let abort = () =>
    {
        // Abort the current sentinel.
        if(sentinel)
        {
            sentinel.abort();
            sentinel = null;
        }
    };

    async function wrapped(...args)
    {
        // If another call is running, abort it.
        abort();

        sentinel = new AbortController();
        let our_sentinel = sentinel;
        let signal = sentinel.signal;
        signal.check = () =>
        {
            // If we're signalled, another guarded function was started, so this one should abort.
            if(our_sentinel.signal.aborted)
                throw new SentinelAborted;
        };

        try {
            return await func(signal, ...args);
        } catch(e) {
            if(!(e instanceof SentinelAborted))
                throw e;
            
            // console.warn("Guarded function cancelled");
            return null;
        } finally {
            if(our_sentinel === sentinel)
                sentinel = null;
        }
    };

    wrapped.abort = abort;

    return wrapped;
};

// Try to guess the full URL for an image from its preview image and user ID.
//
// The most annoying thing about Pixiv's API is that thumbnail info doesn't include
// image URLs.  This means you have to wait for image data to load before you can
// start loading the image at all, and the API call to get image data often takes
// as long as the image load itself.  This makes loading images take much longer
// than it needs to.
//
// We can mostly guess the image URL from the thumbnail URL, but we don't know the
// extension.  Try to guess.  Keep track of which formats we've seen from each user
// as we see them.  If we've seen a few posts from a user and they have a consistent
// file type, guess that the user always uses that format.
//
// This tries to let us start loading images earlier, without causing a ton of 404s
// from wrong guesses.
ppixiv.guess_image_url = class
{
    static _singleton = null;
    static get get()
    {
        if(!this._singleton)
            this._singleton = new this();
        return this._singleton;
    }

    constructor()
    {
        this.db = new key_storage("ppixiv-file-types", { db_upgrade: this.db_upgrade });
    }

    db_upgrade = (e) =>
    {
        let db = e.target.result;
        let store = db.createObjectStore("ppixiv-file-types", {
            keyPath: "illust_id_and_page",
        });

        // This index lets us look up the number of entries for a given user and filetype
        // quickly.
        //
        // page is included in this so we can limit the search to just page 1.  This is so
        // a single 100-page post doesn't overwhelm every other post a user makes: we only
        // use page 1 when guessing a user's preferred file type.
        store.createIndex("user_id_and_filetype", ["user_id", "page", "ext"]);
    }

    // Use the illust ID and page together as the primary key.
    get_key(illust_id, page)
    {
        return `${illust_id}_${page}`;
    }

    // Store info about an image that we've loaded data for.
    add_info(image_info)
    {
        let illust_id = image_info.id;

        // Store one record per page.
        let pages = [];
        for(let page = 0; page < image_info.pageCount; ++page)
        {
            let url = image_info.mangaPages[page].urls.original;
            let parts = url.split(".");
            let ext = parts[parts.length-1];
    
            pages.push({
                illust_id_and_page: this.get_key(illust_id, page),
                illust_id: illust_id,
                page: page,
                user_id: image_info.userId,
                url: url,
                ext: ext,
            });
        }

        // We don't need to wait for this to finish, but return the promise in case
        // the caller wants to.
        return this.db.multi_set_values(pages);
    }

    // Return the number of images by the given user that have the given file type,
    // eg. "jpg".
    //
    // We have a dedicated index for this, so retrieving the count is fast.
    async get_filetype_count_for_user(store, user_id, filetype)
    {
        let index = store.index("user_id_and_filetype");
        let query = IDBKeyRange.only([user_id, 0 /* page */, filetype]);
        return await key_storage.await_request(index.count(query));
    }

    // Try to guess the user's preferred file type.  Returns "jpg", "png" or null.
    guess_filetype_for_user_id(user_id)
    {
        return this.db.db_op(async (db) => {
            let store = this.db.get_store(db);

            // Get the number of posts by this user with both file types.
            let jpg = await this.get_filetype_count_for_user(store, user_id, "jpg");
            let png = await this.get_filetype_count_for_user(store, user_id, "png");

            // Wait until we've seen a few images from this user before we start guessing.
            if(jpg+png < 3)
                return null;

            // If a user's posts are at least 90% one file type, use that type.
            let jpg_fraction = jpg / (jpg+png);
            if(jpg_fraction > 0.9)
            {
                console.debug(`User ${user_id} posts mostly JPEGs`);
                return "jpg";
            }
            else if(jpg_fraction < 0.1)
            {
                console.debug(`User ${user_id} posts mostly PNGs`);
                return "png";
            }
            else
            {
                console.debug(`Not guessing file types for ${user_id} due to too much variance`);
                return null;
            }
        });
    }

    async get_stored_record(illust_id, page)
    {
        return this.db.db_op(async (db) => {
            let key = this.get_key(illust_id, page);
            let store = this.db.get_store(db);
            let record = await key_storage.async_store_get(store, key);
            if(record == null)
                return null;
            else
                return record.url;
        });
    }

    async guess_url(illust_id, page)
    {
        // If we already have illust info, use it.
        let illust_info = image_data.singleton().get_image_info_sync(illust_id);
        if(illust_info != null)
            return illust_info.mangaPages[page].urls.original;

        // If we've stored this URL, use it.
        let stored_url = await this.get_stored_record(illust_id, page);
        if(stored_url != null)
            return stored_url;
        
        // Get thumbnail data.  We need the thumbnail URL to figure out the image URL.
        let thumb = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        if(thumb == null)
            return null;

        // Try to make a guess at the file type.
        let guessed_filetype = await this.guess_filetype_for_user_id(thumb.userId);
        if(guessed_filetype == null)
            return null;
    
        // Convert the thumbnail URL to the equivalent original URL:
        // https://i.pximg.net             /img-original/img/2021/01/01/01/00/02/12345678_p0.jpg
        // https://i.pximg.net/c/540x540_70  /img-master/img/2021/01/01/01/00/02/12345678_p0_master1200.jpg      
        let url = thumb.previewUrls[page];
        url = url.replace("/c/540x540_70/", "/");
        url = url.replace("/img-master/", "/img-original/");
        url = url.replace("_master1200.", ".");
        url = url.replace(/jpg$/, guessed_filetype);
        return url;
    }

    // This is called if a guessed preload fails to load.  This either means we
    // guessed wrong, or if we came from a cached URL in the database, that the
    // user reuploaded the image with a different file type.
    async guessed_url_incorrect(illust_id, page)
    {
        // If this was a stored URL, remove it from the database.
        let key = this.get_key(illust_id, page);
        await this.db.multi_delete([key]);
    }
};
