var helpers = {
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
        var template = document.body.querySelector(type);
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
            onload: function(e) {
                // Once the request finishes, future requests can be done normally and should be served
                // out of cache.
                delete helpers._fetches[url];

                // Call onloads.
                for(var options of request.callers.slice())
                {
                    try {
                        if(options.onload)
                            options.onload(e);
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

        if(request == null)
        {
            request = {};
            request.abort = function() { }
        }

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
            console.log("done");
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

    // Send a request withi GM_xmlhttpRequest.
    //
    // The referer, cookie and CSRF token will be filled in automatically.
    //
    // The returned object will have an abort method that might abort the request.
    // (TamperMonkey provides abort, but GreaseMonkey doesn't.)
    //
    // Note that options will be modified.
    send_pixiv_request: function(options)
    {
        if(options.headers == null)
            options.headers = {};

        options.headers["Cookie"] = document.cookie;
        options.headers["x-csrf-token"] = global_data.csrf_token;

        // Use the page URL with the hash removed.
        var url = new URL(document.location);
        url.hash = "";
        options.headers["Referer"] = url.toString();

        var request = GM_xmlhttpRequest(options);
        if(request == null)
        {
            request = {
                abort: function() { },
            };
        }

        return request;
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
            onload: function(result) {
                var data = result.response;
                if(data.error)
                    console.error("Error in XHR request:", data.message)

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

            onload: function(result) {
                var data = result.response;
                if(data.error)
                    console.error("Error in XHR request:", data.message)

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
            onload: function(result) {
                var data = result.response;
                console.log(data);
                if(data.error)
                    console.error("Error in XHR request:", data.message)

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
            onload: function(result) {
                var data = result.response;
                if(data.error)
                    console.error("Error in XHR request:", data.message)

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
        GM_setValue("recent-bookmark-tags", JSON.stringify(tags));
    },

    get_recent_bookmark_tags()
    {
        var recent_bookmark_tags = GM_getValue("recent-bookmark-tags");
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
        var recent_tags = GM_getValue("recent-tag-searches") || [];
        var idx = recent_tags.indexOf(tag);
        if(idx != -1)
            recent_tags.splice(idx, 1);
        recent_tags.unshift(tag);

        // Trim the list.
        recent_tags.splice(50);
        GM_setValue("recent-tag-searches", recent_tags);

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    },

    remove_recent_search_tag(tag)
    {
        // Remove tag from the list.  There should normally only be one.
        var recent_tags = GM_getValue("recent-tag-searches") || [];
        while(1)
        {
            var idx = recent_tags.indexOf(tag);
            if(idx == -1)
                break;
            recent_tags.splice(idx, 1);
        }
        GM_setValue("recent-tag-searches", recent_tags);
        
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

        if(init_elements.length != 2)
            return null;
        
        // Create a stub around the scripts to let them execute as if they're initializing the
        // original object.
        var init_script = "";
        init_script += "(function() {";
        init_script += "var pixiv = { config: {}, context: {}, user: {} }; ";
        init_script += init_elements[0].innerText;
        init_script += init_elements[1].innerText;
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

    fix_pixiv_links: function(root)
    {
        for(var a of root.querySelectorAll("A[target='_blank']"))
            a.target = "";

        for(var a of root.querySelectorAll("A[href*='jump.php']"))
        {
            a.relList.add("noreferrer");            
            var url = new URL(a.href);
            var target = url.search.substr(1); // remove ?
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
};

