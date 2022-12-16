"use strict";

// This is thrown when we disable creating blocked elements.
ppixiv.ElementDisabled = class extends Error
{
};

ppixiv.helpers = {
    blank_image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    xmlns: "http://www.w3.org/2000/svg",
    
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

    create_style: function(css, { id }={})
    {
        var style = document.realCreateElement("style");
        style.type = "text/css";
        if(id)
            style.id = id;
        style.textContent = css;
        return style;
    },

    get_icon_class_and_name: function(icon_name)
    {
        let [icon_set, name] = icon_name.split(":");
        if(name == null)
        {
            name = icon_set;
            icon_set = "mat";
        }

        let icon_class = "material-icons";
        if(icon_set == "ppixiv")
            icon_class = "ppixiv-icon";
        else if(icon_set == "mat")
            icon_class = "material-icons";

        return [icon_class, name];
    },

    // Create a font icon.  icon_name is an icon set and name, eg. "mat:lightbulb"
    // for material icons or "ppixiv:icon" for our icon set.  If no icon set is
    // specified, material icons is used.
    create_icon: function(icon_name, {
        as_element=false,
        classes=[],
        align=null,
        dataset={},
    }={})
    {
        let [icon_class, name] = helpers.get_icon_class_and_name(icon_name);

        let icon = document.createElement("span");
        icon.classList.add("font-icon");
        icon.classList.add(icon_class);
        icon.lang = "icon";
        icon.innerText = name;

        for(let className of classes)
            icon.classList.add(className);
        if(align != null)
            icon.style.verticalAlign = align;
        for(let [key, value] of Object.entries(dataset))
            icon.dataset[key] = value;

        if(as_element)
            return icon;
        else
            return icon.outerHTML;
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

    // If make_svg_unique is false, skip making SVG IDs unique.  This is a small optimization
    // for creating thumbs, which don't need this.
    create_from_template: function(type, {make_svg_unique=true}={})
    {
        var template;
        if(typeof(type) == "string")
            template = this.get_template(type);
        else
            template = type;

        var node = document.importNode(template.content, true).firstElementChild;
        
        if(make_svg_unique)
        {
            // Make all IDs in the template we just cloned unique.
            for(var svg of node.querySelectorAll("svg"))
                helpers.make_svg_ids_unique(svg);
        }
        
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

            // Import the cached node to make a copy, then replace the <ppixiv-inline> element
            // with it.
            let node = this.create_ppixiv_inline(src);
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

    // Create a general-purpose box link.
    create_box_link({
        label,
        link=null,
        classes="",
        icon=null,
        popup=null,

        // If set, this is an extra explanation line underneath the label.
        explanation=null,

        // By default, return HTML as text, which is used to add these into templates, which
        // is the more common usage.  If as_element is true, an element will be returned instead.
        as_element=false,

        // Helpers for screen_search:
        dataset={},
        data_type=null,
    })
    {
        if(!this._cached_box_link_template)
        {
            // We always create an anchor, even if we don't have a link.  Browsers just treat it as
            // a span when there's no href attribute.
            //
            // label-box encloses the icon and label, so they're aligned to each other with text spacing,
            // which is needed to get text to align with font icons.  The resulting box is then spaced as
            // a unit within box-link's flexbox.
            let html = `
                <a class=box-link>
                    <div class=label-box>
                        <span hidden class=icon></span>
                        <span hidden class=label></span>
                        <span hidden class=explanation></span>
                    </div>
                </a>
            `;

            this._cached_box_link_template = document.createElement("template");
            this._cached_box_link_template.innerHTML = html;
        }
        let node = helpers.create_from_template(this._cached_box_link_template);

        if(label != null)
        {
            node.querySelector(".label").hidden = false;
            node.querySelector(".label").innerText = label;
        }
        if(link)
            node.href = link;

        for(let className of classes || [])
            node.classList.add(className);

        if(popup)
        {
            node.classList.add("popup");
            node.dataset.popup = popup;
        }

        if(icon != null)
        {
            let [icon_class, icon_name] = helpers.get_icon_class_and_name(icon);
            let icon_element = node.querySelector(".icon");
            icon_element.classList.add(icon_class);
            icon_element.classList.add("font-icon");
            icon_element.hidden = false;
            icon_element.innerText = icon_name;
            icon_element.lang = "icon";
    
            // .with.text is set for icons that have text next to them, to enable padding
            // and spacing.
            if(label != null)
                icon_element.classList.add("with-text");
        }

        if(explanation != null)
        {
            let explanation_node = node.querySelector(".explanation");
            explanation_node.hidden = false;
            explanation_node.innerText = explanation;
        }

        if(data_type != null)
            node.dataset.type = data_type;
        for(let [key, value] of Object.entries(dataset))
            node.dataset[key] = value;

        if(as_element)
            return node;
        else
            return node.outerHTML;
    },

    create_ppixiv_inline(src)
    {
        // Parse this element if we haven't done so yet.
        if(!helpers._resource_cache[src])
        {
            // Find the resource.
            let resource = resources[src];
            if(resource == null)
            {
                console.error(`Unknown resource ${src}`);
                return null;
            }

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

        let node = helpers._resource_cache[src];
        return document.importNode(node, true);
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
                let new_value = value;
                
                // See if this is an ID reference.  We don't try to parse all valid URLs
                // here.  Handle url(#abcd) inside strings, and things like xlink:xref="#abcd".
                if((attr == "href" || attr == "xlink:href") && value.startsWith("#"))
                {
                    let old_id = value.substr(1);
                    let new_id = id_map[old_id];
                    if(new_id == null)
                    {
                        console.warn("Unmatched SVG ID:", old_id);
                        continue;
                    }

                    new_value = "#" + new_id;
                }

                var re = /url\(#.*?\)/;
                new_value = new_value.replace(re, (str) => {
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
    save_blob(blob, filename)
    {
        let blobUrl = URL.createObjectURL(blob);

        let a = document.createElement("a");
        a.hidden = true;
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
       
        a.click();

        // Clean up.
        //
        // If we revoke the URL now, or with a small timeout, Firefox sometimes just doesn't show
        // the save dialog, and there's no way to know when we can, so just use a large timeout.
        helpers.setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
            a.remove();
        }, 1000);
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

    // Binary search between start and end looking for target.  get_value(position) returns the
    // value at that position.
    binary_search(start, end, target, get_value, max_error=1)
    {
        let start_value = get_value(start);
        let end_value = get_value(end);

        // If end is before start, swap the ends.
        if(start_value > end_value)
        {
            [start, end] = [end, start];
            [start_value, end_value] = [end_value, start_value];
        }

        while(true)
        {
            let guess = (start + end) / 2;
            let value = get_value(guess);

            if(target > value)
            {
                start = guess;
                start_value = value;
            }
            else
            {
                end = guess;
                end_value = value;
            }

            if(Math.abs(start-end) < max_error)
                return guess;
        }          
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

    sleep(ms, { signal=null }={})
    {
        return new Promise((accept, reject) => {
            let timeout = null;
            let abort = () => {
                helpers.clearTimeout(timeout);
                reject("aborted");
            };
    
            if(signal != null)
                signal.addEventListener("abort", abort, { once: true });

            timeout = helpers.setTimeout(() => {
                if(signal)
                    signal.removeEventListener("abort", abort, { once: true });
                accept();
            }, ms);
        });
    },

    // Return a Promise with accept() and reject() available on the promise itself.
    //
    // This removes encapsulation, but is useful when using a promise like a one-shot
    // event where that isn't important.
    make_promise()
    {
        let accept, reject;
        let promise = new Promise((a, r) => {
            accept = a;
            reject = r;
        });
        promise.accept = accept;
        promise.reject = reject;
        return promise;
    },

    // Like Promise.all, but takes a dictionary of {key: promise}, returning a
    // dictionary of {key: result}.
    async await_map(map)
    {
        Promise.all(Object.values(map));

        let results = {};
        for(let [key, promise] of Object.entries(map))
            results[key] = await promise;
        return results;
    },

    // This is the same as Python's zip:
    //
    // for(let [a,b,c] of zip(array1, array2, array))
    zip: function*(...args)
    {
        let iters = [];
        for(let arg of args)
            iters.push(arg[Symbol.iterator]());
        
        while(1)
        {
            let values = [];
            for(let iter of iters)
            {
                let { value, done } = iter.next();
                if(done)
                    return;
                values.push(value);
            }

            yield values;
        }
    },

    // A simple wakeup event.
    WakeupEvent: class
    {
        constructor()
        {
            this._signal = new AbortController();
        }

        // Wait until a call to wake().
        async wait()
        {
            await this._signal.signal.wait();
        }

        // Wake all current waiters.
        wake()
        {
            this._signal.abort();
            this._signal = new AbortController();
        }
    },

    // setInterval using an AbortSignal to remove the interval.
    //
    // If call_immediately is true, call callback() now, rather than waiting
    // for the first interval.
    interval(callback, ms, signal, call_immediately=true)
    {
        if(signal && signal.aborted)
            return;

        let id = setInterval(callback, ms);

        if(signal)
        {
            // Clear the interval when the signal is aborted.
            signal.addEventListener("abort", () => {
                clearInterval(id);
            }, { once: true });
        }

        if(call_immediately)
            callback();
    },

    // A convenience wrapper for setTimeout:
    timer: class
    {
        constructor(func)
        {
            this.func = func;
        }
    
        run_func = () =>
        {
            this.func();
        }
    
        clear()
        {
            if(this.id == null)
                return;
    
            helpers.clearTimeout(this.id);
            this.id = null;
        }
    
        set(ms)
        {
            this.clear();
            this.id = helpers.setTimeout(this.run_func, ms);
        }
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

    wait_for_load(element)
    {
        return new Promise((accept, reject) => {
            element.addEventListener("load", () => {
                accept();
            }, { once: true });
        });
    },

    // Try to stop the underlying page from doing things (it just creates unnecessary network
    // requests and spams errors to the console), and undo damage to the environment that it
    // might have done before we were able to start.
    cleanup_environment: function()
    {
        if(ppixiv.native)
        {
            // We're running in a local environment and not on Pixiv, so we don't need to do
            // this stuff.  Just add stubs for the functions we'd set up here.
            helpers.fetch = window.fetch;
            helpers.setTimeout = window.setTimeout.bind(window);
            helpers.setInterval = window.setInterval.bind(window);
            helpers.clearTimeout = window.clearTimeout.bind(window);
            helpers.requestAnimationFrame = window.requestAnimationFrame.bind(window);
            helpers.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
            helpers.Image = window.Image;

            window.HTMLDocument.prototype.realCreateElement = window.HTMLDocument.prototype.createElement;
            return;
        }

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
        for(let key of ["onerror", "onunhandledrejection", "_send", "_time", "webpackJsonp", "touchJsonp"])
        {
            window[key] = null;

            // Use an empty setter instead of writable: false, so errors aren't triggered all the time.
            Object.defineProperty(window, key, {
                get: function() { return null; },
                set: function(value) { },
            });
        }

        // Try to unwrap functions that might have been wrapped by page scripts.
        function unwrap_func(obj, name, { ignore_missing=false }={})
        {
            // Both prototypes and instances might be wrapped.  If this is an instance, look
            // at the prototype to find the original.
            let orig_func = obj.__proto__ && obj.__proto__[name]? obj.__proto__[name]:obj[name];
            if(!orig_func)
            {
                if(!ignore_missing)
                    console.log("Couldn't find function to unwrap:", name);
                return;
            }

            if(!orig_func.__sentry_original__)
                return;

            while(orig_func.__sentry_original__)
                orig_func = orig_func.__sentry_original__;
            obj[name] = orig_func;
        }

        // Delete owned properties on an object.  This removes wrappers around class functions
        // like document.addEventListener, so it goes back to the browser implementation, and
        // freezes the object to prevent them from being added in the future.
        function delete_overrides(obj)
        {
            for(let prop of Object.getOwnPropertyNames(obj))
            {
                try {
                    delete obj[prop];
                } catch(e) {
                    // A couple properties like document.location are normal and can't be deleted.
                }
            }

            try {
                Object.freeze(obj);
            } catch(e) {
                console.error(`Error freezing ${obj}: ${e}`);
            }
        }

        try {
            unwrap_func(window, "fetch");
            unwrap_func(window, "setTimeout");
            unwrap_func(window, "setInterval");
            unwrap_func(window, "clearInterval");
            unwrap_func(window, "requestAnimationFrame");
            unwrap_func(window, "cancelAnimationFrame");
            unwrap_func(EventTarget.prototype, "addEventListener");
            unwrap_func(EventTarget.prototype, "removeEventListener");
            unwrap_func(XMLHttpRequest.prototype, "send");

            // We might get here before the mangling happens, which means it might happen
            // in the future.  Freeze the objects to prevent this.
            Object.freeze(EventTarget.prototype);

            // Delete wrappers on window.history set by the site, and freeze it so they can't
            // be added.
            delete_overrides(window.history);
            delete_overrides(window.document);

            // Pixiv wraps console.log, etc., which breaks all logging since it causes them to all
            // appear to come from the wrapper.  Remove these if they're present and try to prevent
            // it from happening later.
            for(let name of Object.keys(window.console))
                unwrap_func(console, name, { ignore_missing: true });
            Object.freeze(window.console);

            // Some Pixiv pages load jQuery and spam a bunch of error due to us stopping
            // their scripts.  Try to replace jQuery's exception hook with an empty one to
            // silence these.  This won't work if jQuery finishes loading after we do, but
            // that's not currently happening, so this is all we do for now.
            if("jQuery" in window)
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
            window.MessagePort.prototype.realPostMessage = window.MessagePort.prototype.postMessage;
            window.MessagePort.prototype.postMessage = (msg) => { };
        } catch(e) {
            console.error("Error disabling postMessage", e);
        }

        // Disable requestAnimationFrame.  This can also be used by the React scheduler.
        helpers.requestAnimationFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (func) => { };

        helpers.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
        window.cancelAnimationFrame = (id) => { };

        // Disable the page's timers.  This helps prevent things like GTM from running.
        helpers.setTimeout = window.setTimeout.bind(window);
        window.setTimeout = (f, ms) => { return -1; };

        helpers.setInterval = window.setInterval.bind(window);
        window.setInterval = (f, ms) => { return -1; };

        helpers.clearTimeout = window.clearTimeout.bind(window);
        window.clearTimeout = () => { };

        try {
            window.addEventListener = Window.prototype.addEventListener.bind(window);
            window.removeEventListener = Window.prototype.removeEventListener.bind(window);
        } catch(e) {
            // This fails on iOS.  That's OK, since Pixiv's mobile site doesn't mess
            // with these (and since we can't write to these, it wouldn't be able to either).
        }

        helpers.Image = window.Image;
        window.Image = function() { };

        // Replace window.fetch with a dummy to prevent some requests from happening.  Store it
        // in helpers.fetch so we can use it.
        helpers.fetch = window.fetch.bind(window);
        class dummy_fetch
        {
            sent() { return this; }
        };
        dummy_fetch.prototype.ok = true;
        window.fetch = function() { return new dummy_fetch(); };

        // We don't use XMLHttpRequest.  Disable it to make sure the page doesn't.
        window.XMLHttpRequest = function() { };

        // Similarly, prevent it from creating script and style elements.  Sometimes site scripts that
        // we can't disable keep running and do things like loading more scripts or adding stylesheets.
        // Use realCreateElement to bypass this.
        let origCreateElement = window.HTMLDocument.prototype.createElement;
        window.HTMLDocument.prototype.realCreateElement = window.HTMLDocument.prototype.createElement;
        window.HTMLDocument.prototype.createElement = function(type, options)
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
        window.addEventListener("error", (e) => {
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
    set_dataset: function(dataset, name, value)
    {
        if(value)
            dataset[name] = value;
        else
            delete dataset[name];
    },

    // Input elements have no way to tell when edits begin or end.  The input event tells
    // us when the user changes something, but it doesn't tell us when drags begin and end.
    // This is important for things like undo: you want to save undo the first time a slider
    // value changes during a drag, but not every time, or if the user clicks the slider but
    // doesn't actually move it.
    //
    // This adds events:
    //
    // editbegin
    // edit
    // editend
    //
    // edit events are always surrounded by editbegin and editend.  If the user makes multiple
    // edits in one action (eg. moving an input slider), they'll be sent in the same begin/end
    // block.
    //
    // This is only currently used for sliders, and doesn't handle things like keyboard navigation
    // since that gets overridden by other UI anyway.
    //
    // signal can be an AbortSignal to remove these event listeners.
    watch_edits: function(input, { signal }={})
    {
        let dragging = false;
        let inside_edit = false;
        input.addEventListener("mousedown", (e) => {
            if(e.button != 0 || dragging)
                return;
            dragging = true;
        }, { signal });

        input.addEventListener("mouseup", (e) => {
            if(e.button != 0 || !dragging)
                return;
            dragging = false;

            if(inside_edit)
            {
                inside_edit = false;
                input.dispatchEvent(new Event("editend"));
            }
        }, { signal });

        input.addEventListener("input", (e) => {
            // Send an editbegin event if we haven't yet.
            let send_editend = false;
            if(!inside_edit)
            {
                inside_edit = true;
                input.dispatchEvent(new Event("editbegin"));

                // If we're not dragging, this is an isolated edit, so send editend immediately.
                send_editend = !dragging;
            }

            // The edit event is like input, but surrounded by editbegin/editend.
            input.dispatchEvent(new Event("edit"));

            if(send_editend)
            {
                inside_edit = false;
                input.dispatchEvent(new Event("editend"));
            }
        }, { signal });
    },
    
    // Set node's height as a CSS variable.
    //
    // If target is null, the variable is set on the node itself.
    set_height_as_property(node, name, { target, signal }={})
    {
        if(target == null)
            target = node;
        let refresh_height = () =>
        {
            // Our height usually isn't an integer.  Round down, so we prefer to overlap backgrounds
            // with things like the video UI rather than leaving a gap.
            let {height} = node.getBoundingClientRect();
            target.style.setProperty(name, `${Math.floor(height)}px`);
        };
    
        let resize_observer = new ResizeObserver(() => refresh_height());
        resize_observer.observe(node);
        if(signal)
            signal.addEventListener("abort", () => resize_observer.disconnect());

        refresh_height();
    },

    // Force all external links to target=_blank.
    //
    // We do this on iOS to improve clicking links.  If we're running as a PWA on iOS, opening links will
    // cause the Safari UI to appear.  Setting target=_blank looks the same to the user, except it opens
    // it in a separate context, so closing the link will return to where we were.  If we don't do this,
    // the link will replace us instead, so we'll be restarted when the user returns.
    //
    // We currently only look at links when they're first added to the document and don't listen for
    // changes to href.
    force_target_blank()
    {
        if(!ppixiv.ios)
            return;

        function update_node(node)
        {
            if(node.querySelectorAll == null)
                return;

            for(let a of node.querySelectorAll("A:not([target])"))
            {
                if(a.href == "" || a.hasAttribute("target"))
                    continue;

                let url = new URL(a.href);
                if(url.origin == document.location.origin)
                    continue;

                a.setAttribute("target", "_blank");
            }
        }
        update_node(document.documentElement);

        let observer = new MutationObserver((mutations) => {
            for(let mutation of mutations)
            {
                for(let node of mutation.addedNodes)
                    update_node(node);
            }
        });
        observer.observe(document.documentElement, { subtree: true, childList: true });
    },
    
    // Work around iOS Safari weirdness.  If a drag from the left or right edge of the
    // screen causes browser navigation, the underlying window position jumps, which
    // causes us to see pointer movement that didn't actually happen.  If this happens
    // during a drag, it causes the drag to move horizontally by roughly the screen
    // width.
    should_ignore_horizontal_drag(event)
    {
        // If there are no other history entries, we don't need to do this, since browser back
        // can't trigger.
        if(!ppixiv.ios || window.history.length <= 1)
            return false;

        // Ignore this event if it's close to the left or right edge of the screen.
        let width = 25;
        return event.clientX < width || event.clientX > window.innerWidth - width;
    },

    // Return the value of a list of CSS expressions.  For example:
    //
    // get_css_values({ value1: "calc(var(--value) * 2)" });
    get_css_values(properties)
    {
        let div = document.createElement("div");

        let style = [];
        for(let [key, value] of Object.entries(properties))
            style += `--${key}:${value};\n`;
        div.style = style;

        // The div needs to be in the document for this to work.
        document.body.appendChild(div);
        let computed = getComputedStyle(div);
        let results = {};
        for(let key of Object.keys(properties))
            results[key] = computed.getPropertyValue(`--${key}`);
        div.remove();

        return results;
    },

    // Get the current safe area insets.
    get safe_area_insets()
    {
        let { left, top, right, bottom } = helpers.get_css_values({
            left: 'env(safe-area-inset-left)',
            top: 'env(safe-area-inset-top)',
            right: 'env(safe-area-inset-right)',
            bottom: 'env(safe-area-inset-bottom)',
        });

        left = parseInt(left ?? 0);
        top = parseInt(top ?? 0);
        right = parseInt(right ?? 0);
        bottom = parseInt(bottom ?? 0);
        return { left, top, right, bottom };
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
        // If seconds is negative, return a time in the future.
        let future = seconds < 0;
        if(future)
            seconds = -seconds;

        var to_plural = function(label, places, value)
        {
            var factor = Math.pow(10, places);
            var plural_value = Math.round(value * factor);
            if(plural_value > 1)
                label += "s";
                
            let result = value.toFixed(places) + " " + label;
            result += future? " from now":" ago";
            return result;
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

    format_seconds(total_seconds)
    {
        total_seconds = Math.floor(total_seconds);

        let result = "";
        let seconds = total_seconds % 60; total_seconds = Math.floor(total_seconds / 60);
        let minutes = total_seconds % 60; total_seconds = Math.floor(total_seconds / 60);
        let hours = total_seconds % 24;

        result = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        if(hours > 0)
        {
            // Pad minutes to two digits if we have hours.
            result = result.padStart(5, '0');

            result = hours + ":" + result;
        }

        return result;
    },

    // Return i rounded up to interval.
    round_up_to: function(i, interval)
    {
        return Math.floor((i+interval-1)/interval) * interval;
    },    

    get_extension: function(fn)
    {
        var parts = fn.split(".");
        return parts[parts.length-1];
    },

    save_scroll_position(scroller, save_relative_to)
    {
        return {
            original_scroll_top: scroller.scrollTop,
            original_offset_top: save_relative_to.offsetTop,
        };
    },

    restore_scroll_position(scroller, restore_relative_to, saved_position)
    {
        let scroll_top = saved_position.original_scroll_top;
        if(restore_relative_to)
        {
            let offset = restore_relative_to.offsetTop - saved_position.original_offset_top;
            scroll_top += offset;
        }

        // Don't write to scrollTop if it's not changing, since that breaks
        // scrolling on iOS.
        if(scroller.scrollTop != scroll_top)
            scroller.scrollTop = scroll_top;
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

    send_request: async function(options)
    {
        if(options == null)
            options = {};

        // Usually we'll use helpers.fetch, but fall back on window.fetch in case we haven't
        // called block_network_requests yet.  This happens if main_controller.setup needs
        // to fetch the page.
        let fetch = helpers.fetch || window.fetch;

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
    },

    // Send a request with the referer, cookie and CSRF token filled in.
    async send_pixiv_request({...options})
    {
        options.headers ??= {};

        // Only set x-csrf-token for requests to www.pixiv.net.  It's only needed for API
        // calls (not things like ugoira ZIPs), and the request will fail if we're in XHR
        // mode and set headers, since it'll trigger CORS.
        var hostname = new URL(options.url, ppixiv.plocation).hostname;
        if(hostname == "www.pixiv.net" && "global_data" in window)
        {
            options.headers["x-csrf-token"] = global_data.csrf_token;
            options.headers["x-user-id"] = global_data.user_id;
        }

        let result = await helpers.send_request(options);
        if(result == null)
            return null;

        // Return the requested type.  If we don't know the type, just return the
        // request promise itself.
        if(options.responseType == "json")
            return await result.json();

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

        var result = await helpers.send_pixiv_request({
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
    },

    _download_port: null,


    // GM.xmlHttpRequest is handled by the sandboxed side of the user script, which lives in
    // bootstrap.js.  Request a MessagePort which can be used to request GM.xmlHttpRequest
    // downloads.
    _get_xhr_server()
    {
        // If we already have a download port, return it.
        if(this._download_port != null)
            return this._download_port;

        return new Promise((accept, reject) => {
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
            let receive_message_port = (e) => {
                if(e.data.cmd != "download-setup")
                    return;

                window.removeEventListener("message", receive_message_port);
                helpers._download_port = e.ports[0];
                accept(e.ports[0]);
            };

            window.addEventListener("message", receive_message_port);
        });
    },

    // Download a Pixiv image using a GM.xmlHttpRequest server port retrieved
    // with _get_xhr_server.
    _download_using_xhr_server: function(server_port, url)
    {
        return new Promise((accept, reject) => {
            if(url == null)
            {
                reject(null);
                return;
            }

            // We use i-cf for image URLs, but we don't currently have this in @connect,
            // so we can't use that here.  Switch from i-cf back to the original URLs.
            url = new URL(url);
            if(url.hostname == "i-cf.pximg.net")
                url.hostname = "i.pximg.net";

            // Send a message to the (possibly sandboxed) top-level script to retrieve the image
            // with GM.xmlHttpRequest, giving it a message port to send the result back on.
            let { port1: server_response_port, port2: client_response_port } = new MessageChannel();

            client_response_port.onmessage = (e) => {
                client_response_port.close();
                
                if(e.data.success)
                    accept(e.data.response);
                else
                    reject(e.data.error);
            };

            server_port.realPostMessage({
                url: url.toString(),

                options: {
                    responseType: "arraybuffer",
                    headers: {
                        "Cache-Control": "max-age=360000",
                        Referer: "https://www.pixiv.net/",
                        Origin: "https://www.pixiv.net/",
                    },
                },
            }, [server_response_port]);
        });
    },

    // Download url, returning the data.
    //
    // This is only used to download Pixiv images to save to disk.  Pixiv doesn't have CORS
    // set up to give itself access to its own images, so we have to use GM.xmlHttpRequest to
    // do this.
    download_url: async function(url)
    {
        let server = await this._get_xhr_server();
        if(server == null)
            throw new Error("Downloading not available");

        return await this._download_using_xhr_server(server, url);
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

    // Load a URL as a document.
    async fetch_document(url, headers={}, options={})
    {
        return await helpers.send_pixiv_request({
            method: "GET",
            url: url,
            responseType: "document",
            cache: options.cache,
            headers,
            ...options,
        });
    },

    async hide_body_during_request(func)
    {
        // This hack tries to prevent the browser from flickering content in the wrong
        // place while switching to and from fullscreen by hiding content while it's changing.
        // There's no reliable way to tell when changing opacity has actually been displayed
        // since displaying frames isn't synchronized with toggling fullscreen, so we just
        // wait briefly based on testing.
        document.body.style.opacity = 0;
        let wait_promise = null;
        try {
            // Wait briefly for the opacity change to be drawn.
            let delay = 50;
            let start = Date.now();

            while(Date.now() - start < delay)
                await helpers.vsync();

            // Start entering or exiting fullscreen.
            wait_promise = func();

            start = Date.now();
            while(Date.now() - start < delay)
                await helpers.vsync();
        } finally {
            document.body.style.opacity = 1;
        }

        // Wait for requestFullscreen to finish after restoring opacity, so if it's waiting
        // to request permission we won't leave the window blank the whole time.  We'll just
        // flash black briefly.
        await wait_promise;
    },

    is_fullscreen()
    {
        // In VVbrowser, use our native interface.
        let vvbrowser = this._vvbrowser();
        if(vvbrowser)
            return vvbrowser.getFullscreen();

        if(document.fullscreenElement != null)
            return true;

        // Work around a dumb browser bug: document.fullscreen is false if fullscreen is set by something other
        // than the page, like pressing F11, making it a pain to adjust the UI for fullscreen.  Try to detect
        // this by checking if the window size matches the screen size.  This requires working around even more
        // ugliness:
        //
        // - We have to check innerWidth rather than outerWidth.  In fullscreen they should be the same since
        // there's no window frame, but in Chrome, the inner size is 16px larger than the outer size.
        // - innerWidth is scaled by devicePixelRatio, so we have to factor that out.  Since this leads to
        // fractional values, we also need to threshold the result.
        //
        // If only there was an API that could just tell us whether we're fullscreened.  Maybe it could be called
        // "document.fullscreen".  We can only dream...
        let window_width = window.innerWidth * devicePixelRatio;
        let window_height = window.innerHeight * devicePixelRatio;
        if(Math.abs(window_width - window.screen.width) < 2 && Math.abs(window_height - window.screen.height) < 2)
            return true;

        // In Firefox, outer size is correct, so check it too.  This makes us detect fullscreen if inner dimensions
        // are reduced by panels in fullscreen.
        if(window.outerWidth == window.screen.width && window.outerHeight == window.screen.height)
            return true;

        return false;
    },

    // Return true if the screen is small enough for us to treat this as a phone.
    //
    // This is used for things like switching dialogs from a floating style to a fullscreen
    // style.
    get is_phone()
    {
        // For now we just use an arbitrary threshold.
        return Math.min(window.innerWidth, window.innerHeight) < 500;
    },
    
    // If we're in VVbrowser, return the host object implemented in VVbrowserInterface.cpp.  Otherwise,
    // return null.
    _vvbrowser({sync=true}={})
    {
        if(sync)
            return window.chrome?.webview?.hostObjects?.sync?.vvbrowser;
        else
            return window.chrome?.webview?.hostObjects?.vvbrowser;
    },

    async toggle_fullscreen()
    {
        await helpers.hide_body_during_request(async() => {
            // If we're in VVbrowser:
            let vvbrowser = this._vvbrowser();
            if(vvbrowser)
            {
                vvbrowser.setFullscreen(!this.is_fullscreen());
                return;
            }

            // Otherwise, use the regular fullscreen API.
            if(this.is_fullscreen())
                document.exitFullscreen();
            else
                document.documentElement.requestFullscreen();
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
        recent_bookmark_tags.splice(100);
        helpers.set_recent_bookmark_tags(recent_bookmark_tags);
    },

    // Split a tag search into individual tags.
    split_search_tags(search)
    {
        // Replace full-width spaces with regular spaces.  Pixiv treats this as a delimiter.
        search = search.replace("　", " ");

        // Make sure there's a single space around parentheses, so parentheses are treated as their own item.
        // This makes it easier to translate tags inside parentheses, and style parentheses separately.
        search = search.replace(/ *([\(\)]) */g, " $1 ");

        // Remove repeated spaces.
        search = search.replace(/ +/g, " ");

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
    tags_contain_dot(tag_list)
    {
        if(tag_list == null)
            return false;

        for(let tag of tag_list)
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
        if(ppixiv.native)
            return;

        for(var a of root.querySelectorAll("A"))
        {
            var url = new URL(a.href, ppixiv.plocation);
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
    get_path_without_language(path)
    {
        if(/^\/..\//.exec(path))
            return path.substr(3);
        else        
            return path;
    },

    get_url_without_language: function(url)
    {
        url.pathname = helpers.get_path_without_language(url.pathname);
        return url;
    },

    // Return true if url1 and url2 are the same, ignoring any language prefix on the URLs.
    are_urls_equivalent(url1, url2)
    {
        if(url1 == null || url2 == null)
            return false;

        url1 = helpers.get_url_without_language(url1);
        url2 = helpers.get_url_without_language(url2);
        return url1.toString() == url2.toString();
    },

    // From a URL like "/en/tags/abcd", return "tags".
    get_page_type_from_url: function(url)
    {
        url = new URL(url);
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");
        return parts[1];
    },
    
    set_page_title: function(title)
    {
        let title_element = document.querySelector("title");
        if(title_element.textContent == title)
            return;

        // Work around a Chrome bug: changing the title by modifying textContent occasionally flickers
        // a default title.  It seems like it's first assigning "", triggering the default, and then
        // assigning the new value.  This becomes visible especially on high refresh-rate monitors.
        // Work around this by adding a new title element with the new text and then removing the old
        // one, which prevents this from happening.  This is easy to see by monitoring title change
        // messages in VVbrowser.
        let new_title = document.createElement("title");
        new_title.textContent = title;
        document.head.appendChild(new_title);
        title_element.remove();

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
    
    // Given a list of tags, return the URL to use to search for them.  This differs
    // depending on the current page.
    get_args_for_tag_search(tags, url)
    {
        url = helpers.get_url_without_language(url);

        let type = helpers.get_page_type_from_url(url);
        if(type == "tags")
        {
            // If we're on search already, just change the search tag, so we preserve other settings.
            // /tags/tag/artworks -> /tag/new tag/artworks
            let parts = url.pathname.split("/");
            parts[2] = encodeURIComponent(tags);
            url.pathname = parts.join("/");
        } else {
            // If we're not, change to search and remove the rest of the URL.
            url = new URL("/tags/" + encodeURIComponent(tags) + "/artworks#ppixiv", url);
        }
        
        // Don't include things like the current page in the URL.
        let args = data_source.get_canonical_url(url);
        return args;
    },
    
    // The inverse of get_args_for_tag_search:
    get_tag_search_from_args(url)
    {
        url = helpers.get_url_without_language(url);
        let type = helpers.get_page_type_from_url(url);
        if(type != "tags")
            return null;

        let parts = url.pathname.split("/");
        return decodeURIComponent(parts[2]);
    },

    // Watch for clicks on links inside node.  If a search link is clicked, add it to the
    // recent search list.
    add_clicks_to_search_history: function(node)
    {
        node.addEventListener("click", function(e) {
            if(e.defaultPrevented)
                return;
            if(e.target.tagName != "A" || !e.target.hasAttribute("href"))
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
            saved_search_tags.add(tag);
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

            // Note that we need to use e.key here and not e.code.  For enter presses
            // that are IME confirmations, e.code is still "Enter", but e.key is "Process",
            // which prevents it triggering this.
            if(e.key == "Enter")
                submit(e);
        });
    },

    // Return true if url is one of ours.
    is_ppixiv_url: function(url)
    {
        // If we're native, all URLs on this origin are ours.
        if(ppixiv.native)
            return new URL(url).origin == document.location.origin;
        else
            return url.hash.startsWith("#ppixiv");
    },

    get_hash_args: function(url)
    {
        if(!helpers.is_ppixiv_url(url))
            return { path: "", query: new URLSearchParams() };

        // The hash looks like:
        //
        // #ppixiv/a/b/c?foo&bar
        //
        // /a/b/c is the hash path.  foo&bar are the hash args.
        // Parse the hash of the current page as a path.  For example, if
        // the hash is #ppixiv/foo/bar?baz, parse it as /ppixiv/foo/bar?baz.
        // The pathname portion of this (with /ppixiv removed) is the hash path,
        // and the query portion is the hash args.
        //
        // If the hash is #ppixiv/abcd, the hash path is "/abcd".
        // Remove #ppixiv:
        let hash_path = url.hash;
        if(hash_path.startsWith("#ppixiv"))
            hash_path = hash_path.substr(7);
        else if(hash_path.startsWith("#"))
            hash_path = hash_path.substr(1);

        // See if we have hash args.
        let idx = hash_path.indexOf('?');
        let query = null;
        if(idx != -1)
        {
            query = hash_path.substr(idx+1);
            hash_path = hash_path.substr(0, idx);
        }

        // We encode spaces as + in the URL, but decodeURIComponent doesn't, so decode
        // that first.  Actual '+' is always escaped as %2B.
        hash_path = hash_path.replace(/\+/g, " ");
        hash_path = decodeURIComponent(hash_path);

        if(query == null)
            return { path: hash_path, query: new URLSearchParams() };
        else
            return { path: hash_path, query: new URLSearchParams(query) };
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
        let search_keys = Array.from(search.keys());
        search_keys.sort();

        var result = new URLSearchParams();
        for(var key of search_keys)
            result.set(key, search.get(key));
        return result;
    },

    args: class
    {
        constructor(url)
        {
            url = new URL(url, ppixiv.plocation);

            this.path = url.pathname;
            this.query = url.searchParams;
            let { path: hash_path, query: hash_query } = helpers.get_hash_args(url);
            this.hash = hash_query;
            this.hash_path = hash_path;

            // History state is only available when we come from the current history state,
            // since URLs don't have state.
            this.state = { };
        }

        // Return the args for the current page.
        static get location()
        {
            let result = new this(ppixiv.plocation);

            // Include history state as well.  Make a deep copy, so changing this doesn't
            // modify history.state.
            result.state = JSON.parse(JSON.stringify(ppixiv.phistory.state)) || { };

            return result;
        }

        get url()
        {
            let url = new URL(ppixiv.plocation);
            url.pathname = this.path;
            url.search = this.query.toString();

            // Set the hash portion of url to args, as a ppixiv url.
            //
            // For example, if this.hash_path is "a/b/c" and this.hash is { a: "1", b: "2" },
            // set the hash to #ppixiv/a/b/c?a=1&b=2.
            url.hash = ppixiv.native? "#":"#ppixiv";
            if(this.hash_path != "")
            {
                if(!this.hash_path.startsWith("/"))
                    url.hash += "/";
                url.hash += helpers.encodeURLHash(this.hash_path);
            }

            let hash_string = helpers.encodeHashParams(this.hash);
            if(hash_string != "")
                url.hash += "?" + hash_string;

            return url;
        }

        toString() { return this.url.toString(); }

        // Helpers to get and set arguments which can be in either the query,
        // the hash or the path.  Examples:
        //
        // get("page")        - get the query parameter "page"
        // get("#page")       - get the hash parameter "page"
        // get("/1")          - get the first path parameter
        // set("page", 10)    - set the query parameter "page" to "10"
        // set("#page", 10)   - set the hash parameter "page" to "10"
        // set("/1", 10)      - set the first path parameter to "10"
        // set("page", null)  - remove the query parameter "page"
        get(key)
        {
            let hash = key.startsWith("#");
            let path = key.startsWith("/");
            if(hash || path)
                key = key.substr(1);

            if(path)
                return this.get_pathname_segment(parseInt(key));

            let params = hash? this.hash:this.query;
            return params.get(key);
        }

        set(key, value)
        {
            let hash = key.startsWith("#");
            let path = key.startsWith("/");
            if(hash || path)
                key = key.substr(1);
                
            if(path)
            {
                this.set_pathname_segment(parseInt(key), value);
                return;
            }

            let params = hash? this.hash:this.query;
            if(value != null)
                params.set(key, value);
            else
                params.delete(key);
        }

        // Return the pathname segment with the given index.  If the path is "/abc/def", "abc" is
        // segment 0.  If idx is past the end, return null.
        get_pathname_segment(idx)
        {
            // The first pathname segment is always empty, since the path always starts with a slash.
            idx++;
            let parts = this.path.split("/");
            if(idx >= parts.length)
                return null;

            return decodeURIComponent(parts[idx]);
        }

        // Set the pathname segment with the given index.  If the path is "/abc/def", setting
        // segment 0 to "ghi" results in "/ghi/def".
        //
        // If idx is at the end, a new segment will be added.  If it's more than one beyond the
        // end a warning will be printed, since this usually shouldn't result in pathnames with
        // empty segments.  If value is null, remove the segment instead.
        set_pathname_segment(idx, value)
        {
            idx++;
            let parts = this.path.split("/");
            if(value != null)
            {
                value = encodeURIComponent(value);

                if(idx < parts.length)
                    parts[idx] = value;
                else if(idx == parts.length)
                    parts.push(value);
                else
                    console.warn(`Can't set pathname segment ${idx} to ${value} past the end: ${this.toString()}`);
            } else {
                if(idx == parts.length-1)
                    parts.pop();
                else if(idx < parts.length-1)
                    console.warn(`Can't remove pathname segment ${idx} in the middle: ${this.toString()}`);
            }

            this.path = parts.join("/");
        }
    },

    // Navigate to args, which can be a URL object or a helpers.args.
    navigate(args, {
        // If true, push the navigation onto browser history.  If false, replace the current
        // state.
        add_to_history=true,

        // popstate.navigationCause is set to this.  This allows event listeners to determine
        // what caused a navigation.  For browser forwards/back, this won't be present.
        cause="navigation",

        // We normally synthesize window.onpopstate, so listeners for navigation will see this
        // as a normal navigation.  If this is false, don't do this.
        send_popstate=true,
    }={})
    {
        if(args instanceof URL)
            args = new helpers.args(args);

        // Store the previous URL for comparison.  Normalize it with args, so comparing it with
        // toString() is reliable if the escaping is different, such as different %1E case or
        // not escaping spaces as +.
        let old_url = new ppixiv.helpers.args(ppixiv.plocation).toString();

        // Use the history state from args if it exists.
        let history_data = {
            ...args.state,
        };

        // If the state wouldn't change at all, don't set it, so we don't add junk to
        // history if the same link is clicked repeatedly.  Comparing state via JSON
        // is OK here since JS will maintain key order.  
        if(args.url.toString() == old_url && JSON.stringify(history_data) == JSON.stringify(history.state))
            return;

        // console.log("Changing state to", args.url.toString());
        if(add_to_history)
            ppixiv.phistory.pushState(history_data, "", args.url.toString());
        else
            ppixiv.phistory.replaceState(history_data, "", args.url.toString());

        // Chrome is broken.  After replacing state for a while, it starts logging
        //
        // "Throttling history state changes to prevent the browser from hanging."
        //
        // This is completely broken: it triggers with state changes no faster than the
        // user can move the mousewheel (much too sensitive), and it happens on replaceState
        // and not just pushState (which you should be able to call as fast as you want).
        //
        // People don't think things through.
        // console.log("Set URL to", ppixiv.plocation.toString(), add_to_history);

        if(ppixiv.plocation.toString() != old_url)
        {
            if(send_popstate)
            {
                // Browsers don't send onpopstate for history changes, but we want them, so
                // send a synthetic one.
                // console.log("Dispatching popstate:", ppixiv.plocation.toString());
                let event = new PopStateEvent("pp:popstate");

                // Set initialNavigation to true.  This indicates that this event is for a new
                // navigation, and not from browser forwards/back.
                event.navigationCause = cause;

                window.dispatchEvent(event);
            }

            // Always dispatch pp:statechange.  This differs from popstate (pp:popstate) in that it's
            // always sent for all state changes.  This is used when we have UI that wants to refresh
            // based on the current location, even if it's an in-place update for the same location where
            // we don't send popstate.
            window.dispatchEvent(new PopStateEvent("pp:statechange"));
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
    
    distance({x: x1, y: y1}, {x: x2, y: y2})
    {
        let distance = Math.pow(x1-x2, 2) + Math.pow(y1-y2, 2);
        return Math.pow(distance, 0.5);
    },

    // Scale x from [l1,h2] to [l2,h2].
    scale(x, l1, h1, l2, h2)
    {
        return (x - l1) * (h2 - l2) / (h1 - l1) + l2;
    },

    // Clamp value between min and max.
    clamp(value, min, max)
    {
        if(min > max)
            [min, max] = [max, min];
        return Math.min(Math.max(value, min), max);
    },

    // Scale x from [l1,h2] to [l2,h2], clamping to l2,h2.
    scale_clamp(x, l1, h1, l2, h2)
    {
        return helpers.clamp(helpers.scale(x, l1, h1, l2, h2), l2, h2);
    },

    // Return the first value in A that exists in B.
    find_first(A, B)
    {
        for(let value of A)
        {
            if(B.indexOf(value) != -1)
                return value;
        }
        return null;
    },
    
    // Return the last value in A that exists in B.
    find_last(A, B)
    {
        A = Array.from(A);
        A.reverse();

        for(let value of A)
        {
            if(B.indexOf(value) != -1)
                return value;
        }
        return null;
    },

    // pako/lib/zlib/crc32.js, MIT license: https://github.com/nodeca/pako/
    _crcTable: (() =>
    {
        let table = [];
        for(let n = 0; n < 256; n++)
        {
            let c = n;
            for(let k = 0; k < 8; k++)
            {
                c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
            }
            table[n] = c;
        }

        return table;
    })(),

    crc32(buf)
    {
        let crc = 0 ^ (-1);
        for(let i = 0; i < buf.length; i++)
            crc = (crc >>> 8) ^ ppixiv.helpers._crcTable[(crc ^ buf[i]) & 0xFF];
    
        return crc ^ (-1); // >>> 0;
    },
    
    // Return a promise that waits for the given event on node.
    wait_for_event(node, name, { abort_signal=null }={})
    {
        return new Promise((resolve, reject) => {
            if(abort_signal && abort_signal.aborted)
            {
                resolve(null);
                return;
            }

            let remove_listeners_signal = new AbortController();

            node.addEventListener(name, (e) => {
                remove_listeners_signal.abort();
                resolve(e);
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

    // Wait for any image in images to finish loading.  If images is empty, return
    // immediately.
    async wait_for_any_image_load(images, abort_signal)
    {
        let promises = [];
        for(let image of images)
        {
            if(image == null)
                continue;
            promises.push(helpers.wait_for_image_load(image, abort_signal));
        }

        if(promises.length == 0)
            return null;

        await Promise.race([...promises]);
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
                    helpers.cancelAnimationFrame(frame_id);
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

                frame_id = helpers.requestAnimationFrame(check);
            };
            check();
        });
    },

    // Wait up to ms for promise to complete.  If the promise completes, return its
    // result, otherwise return "timed-out".
    async await_with_timeout(promise, ms)
    {
        let sleep = new Promise((accept, reject) => {
            helpers.setTimeout(() => {
                accept("timed-out");
            }, ms);
        });

        // Wait for whichever finishes first.
        return await Promise.any([promise, sleep]);
    },

    wait_for_transitionend(node)
    {
        return new Promise((accept) => {
            // CSS transition events are a headache: you have to listen to both transitionend
            // and transitioncancel every time, and you always have to check if there's any
            // transition to trigger the event, which requires looking at the animation list.
            // They made this a lot more complicated than it needed to be.
            let animations = node.getAnimations();
            let transitions = animations.filter((anim) => anim instanceof CSSTransition);
            if(transitions.length == 0)
            {
                accept();
                return;
            }

            let abort = new AbortController();
            let finished = (e) => {
                // Ignore bubbling transition events.  There may be other nested things running
                // their own transitions, and we need to wait for just the node we asked for.
                if(e.target != node)
                    return;

                abort.abort();
                accept();
            };
            node.addEventListener("transitionend", finished, { signal: abort.signal });
            node.addEventListener("transitioncancel", finished, { signal: abort.signal });
        });
    },

    // Asynchronously wait for an animation frame.  Return true on success, or false if
    // aborted by signal.
    vsync({signal=null}={})
    {
        return new Promise((accept, reject) => {
            // The timestamp passed to the requestAnimationFrame callback is designed
            // incorrectly.  It gives the time callbacks started being called, which is
            // meaningless.  It should give the time in the future the current frame is
            // expected to be displayed, which is what you get from things like Android's
            // choreographer to allow precise frame timing.
            let id = null;
    
            let abort = () => {
                if(id != null)
                    helpers.cancelAnimationFrame(id);

                accept(false);
            };

            // Stop if we're already aborted.
            if(signal?.aborted)
            {
                abort();
                return;
            }
    
            id = helpers.requestAnimationFrame((time) => {
                if(signal)
                    signal.removeEventListener("abort", abort);
                accept(true);
            });

            if(signal)
                signal.addEventListener("abort", abort, { once: true });
        });
    },
    
    // Gradually slow down and stop the given CSS animation after a delay, resuming it
    // if the mouse is moved.
    stop_animation_after: class
    {
        constructor(animation, delay, duration, vertical)
        {
            this.animation = animation;
            this.delay = delay;
            this.duration = duration;
            this.vertical = vertical;
            this.abort = new AbortController();

            this.run();
        }

        async run()
        {
            // We'll keep the animation running as long as we've been active within the delay
            // period.
            let last_activity_at = Date.now() / 1000;
            let onmove = (e) => {
                last_activity_at = Date.now() / 1000;
            };

            window.addEventListener("mousemove", onmove, {
                passive: true,
            });

            try {
                // This is used for thumbnail animations.  We want the animation to end at a
                // natural place: at the top for vertical panning, or in the middle for horizontal
                // panning.
                //
                // Animations are async, so we can't control their speed precisely, but it's close
                // enough that we don't need to worry about it here.
                //
                // Both animations last 4 seconds.  At a multiple of 4 seconds, the vertical animation
                // is at the top and the horizontal animation is centered, which is where we want them
                // to finish.  The vertical animation's built-in deceleration is also at the end, so for
                // those we can simply stop the animation when it reaches a multiple of 4.
                //
                // Horizontal animations decelerate at the edges rather than at the end, so we need to
                // decelerate these by reducing playbackRate.

                // How long the deceleration lasts.  We don't need to decelerate vertical animations, so
                // use a small value for those.
                const duration = this.vertical? 0.001:0.3;

                // We want the animation to stop with currentTime equal to this:
                let stop_at_animation_time = null;
                while(1)
                {
                    let success = await helpers.vsync({signal: this.abort.signal});
                    if(!success)
                        break;

                    let now = Date.now() / 1000;
                    let stopping = now >= last_activity_at + this.delay;
                    if(!stopping)
                    {
                        // If the mouse has moved recently, set the animation to full speed.  We don't
                        // accelerate back to speed.
                        stop_at_animation_time = null;
                        this.animation.playbackRate = 1;
                        continue;
                    }

                    // We're stopping, since the mouse hasn't moved in a while.  Figure out when we want
                    // the animation to actually stop if we haven't already.
                    if(stop_at_animation_time == null)
                    {
                        stop_at_animation_time = this.animation.currentTime / 1000 + 0.0001;
                        stop_at_animation_time = Math.ceil(stop_at_animation_time / 4) * 4; // round up to next multiple of 4
                    }

                    let animation_time = this.animation.currentTime/1000;

                    // The amount of animation time left, ignoring playbackSpeed:
                    let animation_time_left = stop_at_animation_time - animation_time;
                    if(animation_time_left > duration)
                    {
                        this.animation.playbackRate = 1;
                        continue;
                    }

                    if(animation_time_left <= 0.001)
                    {
                        this.animation.playbackRate = 0;
                        continue;
                    }

                    // We want to decelerate smoothly, reaching a velocity of zero when animation_time_left
                    // reaches 0.  Just estimate it by decreasing the time left linearly.
                    this.animation.playbackRate = animation_time_left / duration;
                }
            } finally {
                window.removeEventListener("mousemove", onmove);
            }
        }

        // Stop affecting the animation and return it to full speed.
        shutdown()
        {
            this.abort.abort();

            this.animation.playbackRate = 1;
        }
    },

    // Based on the dimensions of the container and a desired pixel size of thumbnails,
    // figure out how many columns to display to bring us as close as possible to the
    // desired size.  Return the corresponding CSS style attributes.
    //
    // container is the containing block (eg. ul.thumbnails).
    make_thumbnail_sizing_style({
        container,
        min_padding,
        desired_size=300,
        ratio=null,
        max_columns=5,
    }={})
    {
        // The total pixel size we want each thumbnail to have:
        ratio ??= 1;

        let desired_pixels = desired_size*desired_size;

        // The container might have a fractional size, and clientWidth will round it, which is
        // wrong for us: if the container is 500.75 wide and we calculate a fit for 501, the result
        // won't actually fit.  Get the bounding box instead, which isn't rounded.
        // var container_width = container.parentNode.clientWidth;
        let container_width = Math.floor(container.parentNode.getBoundingClientRect().width);
        let padding = min_padding;
        
        let closest_error_to_desired_pixels = -1;
        let best_size = [0,0];
        let best_columns = 0;

        // Find the greatest number of columns we can fit in the available width.
        for(let columns = max_columns; columns >= 1; --columns)
        {
            // The amount of space in the container remaining for images, after subtracting
            // the padding around each image.  Padding is the flex gap, so this doesn't include
            // padding at the left and right edge.
            let remaining_width = container_width - padding*(columns-1);
            let max_width = remaining_width / columns;

            let max_height = max_width;
            if(ratio < 1)
                max_width *= ratio;
            else if(ratio > 1)
                max_height /= ratio;

            max_width = Math.floor(max_width);
            max_height = Math.floor(max_height);

            let pixels = max_width * max_height;
            let error = Math.abs(pixels - desired_pixels);
            if(closest_error_to_desired_pixels == -1 || error < closest_error_to_desired_pixels)
            {
                closest_error_to_desired_pixels = error;
                best_size = [max_width, max_height];
                best_columns = columns;
            }
        }

        let [thumb_width, thumb_height] = best_size;

        // If we want a smaller thumbnail size than we can reach within the max column
        // count, we won't have reached desired_pixels.  In this case, just clamp to it.
        // This will cause us to use too many columns, which we'll correct below with
        // container_width.
        //
        // On mobile, just allow the thumbnails to be bigger, so we prefer to fill the
        // screen and not waste screen space.
        if(!ppixiv.mobile && thumb_width * thumb_height > desired_pixels)
        {
            thumb_height = thumb_width = Math.round(Math.sqrt(desired_pixels));

            if(ratio < 1)
                thumb_width *= ratio;
            else if(ratio > 1)
                thumb_height /= ratio;
        }

        // Clamp the width of the container to the number of columns we expect.
        container_width = best_columns*thumb_width + (best_columns-1)*padding;
        return {columns: best_columns, padding, thumb_width, thumb_height, container_width};
    },

    // Given a list of manga info, return the aspect ratio to use to display them.
    // This can be passed as the "ratio" option to make_thumbnail_sizing_style.
    get_manga_aspect_ratio(manga_info)
    {
        // A lot of manga posts use the same resolution for all images, or just have
        // one or two exceptions for things like title pages.  If most images have
        // about the same aspect ratio, use it.
        let total = 0;
        for(let manga_page of manga_info)
            total += manga_page.width / manga_page.height;
        let average_aspect_ratio = total / manga_info.length;

        let illusts_far_from_average = 0;
        for(var manga_page of manga_info)
        {
            let ratio = manga_page.width / manga_page.height;
            if(Math.abs(average_aspect_ratio - ratio) > 0.1)
                illusts_far_from_average++;
        }

        // If we didn't find a common aspect ratio, just use square thumbs.
        if(illusts_far_from_average > 3)
            return 1;
        else
            return average_aspect_ratio;
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
    get_thumbnail_panning_direction(thumb, width, height, container_aspect_ratio)
    {
        // Disable panning if we don't have the image size.  Local directory thumbnails
        // don't tell us the dimensions in advance.
        if(width == null || height == null)
        {
            helpers.set_class(thumb, "vertical-panning", false);
            helpers.set_class(thumb, "horizontal-panning", false);
            return null;
        }

        var aspect_ratio = width / height;
        aspect_ratio /= container_aspect_ratio;
        var min_aspect_for_pan = 1.1;
        var max_aspect_for_pan = 4;
        if(aspect_ratio > (1/max_aspect_for_pan) && aspect_ratio < 1/min_aspect_for_pan)
            return "vertical";
        else if(aspect_ratio > min_aspect_for_pan && aspect_ratio < max_aspect_for_pan)
            return "horizontal";
        else
            return null;
    },

    create_thumbnail_animation(thumb, width, height, container_aspect_ratio)
    {
        if(ppixiv.mobile)
            return null;

        // Create the animation, or update it in-place if it already exists, probably due to the
        // window being resized.  total_time won't be updated when we do this.
        let direction = helpers.get_thumbnail_panning_direction(thumb, width, height, container_aspect_ratio);
        if(thumb.panAnimation != null || direction == null)
            return null;

        let keyframes = direction == "horizontal"?
        [
            // This starts in the middle, pans left, pauses, pans right, pauses, returns to the
            // middle, then pauses again.
            { offset: 0.0, easing: "ease-in-out", objectPosition: "left top" }, // left
            { offset: 0.4, easing: "ease-in-out", objectPosition: "right top" }, // pan right
            { offset: 0.5, easing: "ease-in-out", objectPosition: "right top" }, // pause
            { offset: 0.9, easing: "ease-in-out", objectPosition: "left top" }, // pan left
            { offset: 1.0, easing: "ease-in-out", objectPosition: "left top" }, // pause
        ]:
        [
            // This starts at the top, pans down, pauses, pans back up, then pauses again.
            { offset: 0.0, easing: "ease-in-out", objectPosition: "center top" },
            { offset: 0.4, easing: "ease-in-out", objectPosition: "center bottom" },
            { offset: 0.5, easing: "ease-in-out", objectPosition: "center bottom" },
            { offset: 0.9, easing: "ease-in-out", objectPosition: "center top" },
            { offset: 1.0, easing: "ease-in-out", objectPosition: "center top" },
        ];
    
        let animation = new Animation(new KeyframeEffect(thumb, keyframes, {
            duration: 4000,
            iterations: Infinity,
            
            // The full animation is 4 seconds, and we want to start 20% in, at the halfway
            // point of the first left-right pan, where the pan is exactly in the center where
            // we are before any animation.  This is different from vertical panning, since it
            // pans from the top, which is already where we start (top center).
            delay: direction == "horizontal"? -800:0,
        }));

        animation.id = direction == "horizontal"? "horizontal-pan":"vertical-pan";
        thumb.panAnimation = animation;

        return animation;
    },

    get_title_for_illust(illust_data)
    {
        if(illust_data == null)
            return null;

        let page_title = "";
    
        if(!helpers.is_media_id_local(illust_data.mediaId))
        {
            // For Pixiv images, use the username and title, and indicate if the image is bookmarked.
            // We don't show bookmarks in the title for local images, since it's less useful.
            if(illust_data.bookmarkData)
                page_title += "★";

            page_title += illust_data.userName + " - " + illust_data.illustTitle;
            return page_title;
        }
        else
        {
            // For local images, put the filename at the front, and the two parent directories after
            // it.  For example, "books/Book Name/001" will be displayed a "001 - books/Book Name".
            // This is consistent with the title we use in the search view.
            let {id} = helpers.parse_media_id(illust_data.mediaId);
            let name = helpers.get_path_suffix(id, 1, 0); // filename
            let parent = helpers.get_path_suffix(id, 2, 1); // parent directories
            page_title += `${name} - ${parent}`;
        }

        return page_title;
    },

    set_title(illust_data)
    {
        let page_title = helpers.get_title_for_illust(illust_data) ?? "Loading...";
        helpers.set_page_title(page_title);
    },

    set_icon({vview=false}={})
    {
        if(ppixiv.native || vview)
            helpers.set_page_icon(resources['resources/vview-icon.png']);
        else
            helpers.set_page_icon(resources['resources/regular-pixiv-icon.png']);
    },

    set_title_and_icon(illust_data)
    {
        helpers.set_title(illust_data)
        helpers.set_icon()
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

    // Split a "type:id" into its two parts.
    //
    // If there's no colon, this is a Pixiv illust ID, so set type to "illust".
    _split_id(id)
    {
        if(id == null)
            return { }

        let parts = id.split(":");
        let type = parts.length < 2?  "illust": parts[0];
        let actual_id = parts.length < 2? id: parts.splice(1).join(":"); // join the rest
        return {
            type: type,
            id: actual_id,
        }
    },

    // Encode a media ID.
    //
    // These represent single images, videos, etc. that we can view.  Examples:
    //
    // illust:1234-0          - The first page of Pixiv illust ID 1234
    // illust:1234-12         - Pixiv illust ID 1234, page 12.  Pages are zero-based.
    // user:1000              - Pixiv user 1000.
    // folder:/images         - A directory in the local API.
    // file:/images/image.jpg - A file in the local API.
    //
    // IDs with the local API are already in this format, and Pixiv illust IDs and pages are
    // converted to it.
    encode_media_id({type, id, page=null}={})
    {
        if(type == "illust")
        {
            if(page == null)
                page = 0;
            id  += "-" + page;
        }

        return type + ":" + id;
    },

    // Media IDs are parsed by the thousands, and this can have a small performance
    // impact.  Cache the results, so we only parse any given media ID once.
    _media_id_cache: new Map(),
    parse_media_id(media_id)
    {
        let cache = helpers._media_id_cache.get(media_id);
        if(cache == null)
        {
            cache = helpers._parse_media_id_inner(media_id);
            helpers._media_id_cache.set(media_id, cache);
        }

        // Return a new object and not the cache, since the returned value might be
        // modified.
        return { type: cache.type, id: cache.id, page: cache.page };
    },

    _parse_media_id_inner(media_id)
    {
        // If this isn't an illust, a media ID is the same as an illust ID.
        let { type, id } = helpers._split_id(media_id);
        if(type != "illust")
            return { type: type, id: id, page: 0 };

        // If there's no hyphen in the ID, it's also the same.
        if(media_id.indexOf("-") == -1)
            return { type: type, id: id, page: 0 };

        // Split out the page.
        let parts = id.split("-");
        let page = parts[1];
        page = parseInt(page);
        id = parts[0];
        
        return { type: type, id: id, page: page };
    },

    // Given a media ID, return the same media ID for the first page.
    //
    // Some things don't interact with pages, such as illust info loads, and
    // only store data with the ID of the first page.
    get_media_id_first_page(media_id)
    {
        return helpers.get_media_id_for_page(media_id, 0);
    },

    get_media_id_for_page(media_id, page=0)
    {
        if(media_id == null)
            return null;
            
        let id = helpers.parse_media_id(media_id);
        id.page = page;
        return helpers.encode_media_id(id);
    },

    // Convert a Pixiv illustration ID and page number to a media ID.
    illust_id_to_media_id(illust_id, page)
    {
        if(illust_id == null)
            return null;
            
        let { type, id } = helpers._split_id(illust_id);

        // Pages are only used for illusts.  For other types, the page should always
        // be null or 0, and we don't include it in the media ID.  If this is "*" for
        // slideshow staging, don't append a page number.
        if(type == "illust" && id != "*")
        {
            id += "-";
            id += page || 0;
        }
        else
        {
            console.assert(page == null || page == 0);
        }

        return type + ":" + id;
    },

    media_id_to_illust_id_and_page(media_id)
    {
        let { type, id, page } = helpers.parse_media_id(media_id);
        if(type != "illust")
            return [media_id, 0];
        
        return [id, page];
    },

    // Return true if media_id is an ID for the local API.
    is_media_id_local(media_id)
    {
        let { type } = helpers.parse_media_id(media_id);
        return type == "file" || type == "folder";
    },

    // Return the last count parts of path.
    get_path_suffix(path, count=2, remove_from_end=0, { remove_extension=true }={})
    {
        let parts = path.split('/');
        parts = parts.splice(0, parts.length - remove_from_end);
        parts = parts.splice(parts.length-count); // take the last count parts

        let result = parts.join("/");
        if(remove_extension)
            result = result.replace(/\.[a-z0-9]+$/i, '');

        return result;
    },

    encodeURLPart(regex, part)
    {
        return part.replace(regex, (c) => {
            // encodeURIComponent(sic) encodes non-ASCII characters.  We don't need to.
            let ord = c.charCodeAt(0);
            if(ord >= 128)
                return c;

            // Regular URL escaping wants to escape spaces as %20, which is silly since
            // it's such a common character in filenames.  Escape them as + instead, like
            // things like AWS do.  The escaping is different, but it's still a perfectly
            // valid URL.  Note that the API doesn't decode these, we only use it in the UI.
            if(c == " ")
                return "+";

            let hex = ord.toString(16).padStart('0', 2);
            return "%" + hex;
        });
    },

    // Both "encodeURI" and "encodeURIComponent" are wrong for encoding hashes.
    // The first doesn't escape ?, and the second escapes lots of things we
    // don't want to, like forward slash.
    encodeURLHash(hash)
    {
        return helpers.encodeURLPart(/[^A-Za-z0-9-_\.!~\*'()/:\[\]\^#=&]/g, hash);
    },

    // This one escapes keys in hash parameters.  This is the same as encodeURLHash,
    // except it also encodes = and &.
    encodeHashParam(param)
    {
        return helpers.encodeURLPart(/[^A-Za-z0-9-_\.!~\*'()/:\[\]\^#]/g, param);
    },

    // Encode a URLSearchParams for hash parameters.
    //
    // We can use URLSearchParams.toString(), but that escapes overaggressively and
    // gives us nasty, hard to read URLs.  There's no reason to escape forward slash
    // in query parameters.
    encodeHashParams(params)
    {
        let values = [];
        for(let key of params.keys())
        {
            let key_values = params.getAll(key);
            for(let value of key_values)
            {
                key = helpers.encodeHashParam(key);
                value = helpers.encodeHashParam(value);
                values.push(key + "=" + value);
            }
        }

        return values.join("&");
    },

    // Escape a string to use in a CSS selector.
    //
    // If we're searching for [data-filename='path'], we need to escape quotes in "path".
    escape_selector(s)
    {
        return s.replace(/['"]/g, (c) => {
            return "\\" + c;
        });
    },

    title_case(s)
    {
        let parts = [];
        for(let part of s.split(" "))
            parts.push(part.substr(0, 1).toUpperCase() + s.substr(1));
        return parts.join(" ");
    },

    // 1     -> 1
    // 1:2   -> 0.5
    // null  -> null
    // ""    -> null
    parse_ratio(value)
    {
        if(value == null || value == "")
            return null;
        if(value.indexOf == null)
            return value;

        let parts = value.split(":", 2);
        if(parts.length == 1)
        {
            return parseFloat(parts[0]);
        }
        else
        {
            let num = parseFloat(parts[0]);
            let den = parseFloat(parts[1]);
            return num/den;
        }
    },
    
    // Parse:
    // 1        -> [1,1]
    // 1...2    -> [1,2]
    // 1...     -> [1,null]
    // ...2     -> [null,2]
    // 1:2      -> [0.5, 0.5]
    // 1:2...2  -> [0.5, 2]
    // null     -> null
    parse_range(range)
    {
        if(range == null)
            return null;
            
        let parts = range.split("...");
        let min = helpers.parse_ratio(parts[0]);
        let max = helpers.parse_ratio(parts[1]);
        return [min, max];
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
        var url = new URL(url, ppixiv.plocation);
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

    // Return the canonical URL for an illust.  For most URLs this is
    // /artworks/12345.  If manga is true, return the manga viewer page.
    get_url_for_id(media_id, { manga=false}={})
    {
        let args = null;
        let [illust_id, page] = helpers.media_id_to_illust_id_and_page(media_id);

        if(helpers.is_media_id_local(media_id))
        {
            // URLs for local files are handled differently.
            args = helpers.args.location;
            local_api.get_args_for_id(media_id, args);
            args.hash.set("view", "illust");
        }
        else
        {
            args = new helpers.args("/", ppixiv.plocation);
            args.path  = `/artworks/${illust_id}`;

            if(manga)
                args.hash.set("manga", "1");
        }

        if(page != null && page > 0)
            args.hash.set("page", page+1);

        return args;
    },
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

        this.img.addEventListener("load", this.update_canvas);

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

    update_canvas = () =>
    {
        // The URL for the image we're rendering.  If the image isn't complete, use the blank image
        // URL instead, since we're just going to clear.
        let current_url = this.img.src;
        if(!this.img.complete)
            current_url = helpers.blank_image;

        if(current_url == this.current_url)
            return;

        helpers.set_class(this.canvas, "loaded", false);

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
        helpers.set_class(this.canvas, "loaded", true);
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
            helpers.clearTimeout(this.hover_timeout);
            this.hover_timeout = null;
        }

        this.real_hover_state = hovering;
        this.pending_hover = hovering;
        let delay = hovering? this.delay_enter:this.delay_exit;
        this.hover_timeout = helpers.setTimeout(() => {
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
        this.failed = false;
    }

    // Open the database, run func, then close the database.
    //
    // If you open a database with IndexedDB and then leave it open, like you would with
    // any other database, any attempts to add stores (which you can do seamlessly with
    // any other database) will permanently wedge the database.  We have to open it and
    // close it around every op.
    //
    // If the database can't be opened, func won't be called and null will be returned.
    async db_op(func)
    {
        // Stop early if we've already failed, so we don't log an error for each op.
        if(this.failed)
            return null;

        let db;
        try {
            db = await this.open_database();
        } catch(e) {
            console.log("Couldn't open database:", e);
            this.failed = true;
            return null;
        }
        
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
                reject(request.error);
            };
        });
    }

    get_store(db, mode="readwrite")
    {
        let transaction = db.transaction(this.store_name, mode);
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

    // Retrieve the values for a list of keys.  Return a dictionary of {key: value}.
    async multi_get(keys)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db, "readonly");

            let promises = [];
            for(let key of keys)
                promises.push(key_storage.async_store_get(store, key));
            return await Promise.all(promises);
        }) ?? {};
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

    async delete(key)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);
            return key_storage.await_request(store.delete(key));
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

// VirtualHistory is an implementation for document.location and window.history.  It
// does a couple things:
//
// It allows setting a temporary, virtual URL as the document location.  This is used
// by linked tabs to preview a URL without affecting browser history.
//
// Optionally, it can also replace browser history and navigation entirely.  This is
// used on mobile to work around some problems:
//
// - If there's any back or forwards history, it's impossible to disable the left and
// right swipe gesture for browser back and forwards, even if you're running as a PWA,
// and it's very easy to accidentally navigate back when you're trying to swipe up or
// down at the edge of the screen.  This eliminates them entirely on iOS.  (Android
// still has them, because Android's system gestures are broken.)
// - iOS has a limit of 100 replaceState calls in 30 seconds.  That doesn't make much
// sense, since it's trivial for a regular person navigating quickly to reach that in
// normal usage, and replaceState doesn't navigate the page so it shouldn't be limited
// at all.
// 
// We only enter this mode on mobile when we think we're running as a PWA without browser
// UI.  The main controller will handle intercepting clicks on links and redirecting them
// here.  If we're not doing this, this will only be used for virtual navigations.
ppixiv.VirtualHistory = class
{
    // If true, we're using this for all navigation and never using browser navigation.
    get permanent()
    {
        return ppixiv.mobile;
    }

    constructor()
    {
        this.virtual_url = null;

        // If we're in permanent mode, copy the browser state to our first history state.
        if(this.permanent)
        {
            this.history = [];
            this.history.push({
                url: new URL(window.location),
                state: window.history.state
            });

            // If we're permanent, we never expect to see popstate events coming from the
            // browser.  Listen for these and warn about them.
            window.addEventListener("popstate", (e) => {
                if(e.isTrusted)
                    console.warn("Unexpected popstate:", e);
            }, true);
        }

        // ppixiv.plocation can be accessed like document.location.
        Object.defineProperty(ppixiv, "plocation", {
            get: () => {
                // If we're not using a virtual location, return document.location.
                // Otherwise, return virtual_url.  Always return a copy of virtual_url,
                // since the caller can modify it and it should only change through
                // explicit history changes.
                if(this.virtual_url != null)
                    return new URL(this.virtual_url);

                if(!this.permanent)
                    return new URL(document.location);

                return new URL(this._latest_history.url);
            },
            set: (value) => {
                // We could support assigning ppixiv.plocation, but we always explicitly
                // pushState.  Just throw an exception if we get here accidentally.
                throw Error("Can't assign to ppixiv.plocation");

                /*
                if(this.virtual)
                {
                    // If we're virtual, replace the virtual URL.
                    this.virtual_url = new URL(value, this.virtual_url);
                    this.broadcast_popstate();
                    return;
                }

                if(!this.permanent)
                {
                    document.location = value;
                    return;
                }
                
                this.replaceState(null, "", value);
                this.broadcast_popstate();

                */
            },
        });
    }

    get virtual()
    {
        return this.virtual_url != null;
    }

    get _latest_history()
    {
        return this.history[this.history.length-1];
    }

    url_is_virtual(url)
    {
        // Push a virtual URL by putting #virtual=1 in the hash.
        let args = new helpers.args(url);
        return args.hash.get("virtual");
    }

    // Return the URL we'll go to if we go back.
    get previous_state_url()
    {
        if(this.history.length < 2)
            return null;

        return this.history[this.history.length-2].url;
    }

    get previous_state_args()
    {
        let url = this.previous_state_url;
        if(url == null)
            return null;

        return new helpers.args(url);
    }

    get length()
    {
        if(!this.permanent)
            return window.history.length;
        
        return this.history.length;
    }

    pushState(state, title, url)
    {
        url = new URL(url, document.location);

        let virtual = this.url_is_virtual(url);
        if(virtual)
        {
            // We don't support a history of virtual locations.  Once we're virtual, we
            // can only replaceState or back out to the real location.
            if(this.virtual_url)
                throw Error("Can't push a second virtual location");

            // Note that browsers don't dispatch popstate on pushState (which makes no sense at all),
            // so we don't here either to match.
            this.virtual_state = state;
            this.virtual_title = title;
            this.virtual_url = url;
            return;
        }

        // We're pushing a non-virtual location, so we're no longer virtual if we were before.
        this.virtual_url = null; 

        if(!this.permanent)
            return window.history.pushState(state, title, url);

        this.history.push({ state, url });

        this._update_browser_state();
    }

    replaceState(state, title, url)
    {
        url = new URL(url, document.location);
        let virtual = this.url_is_virtual(url);
        
        if(virtual)
        {
            // We can only replace a virtual location with a virtual location.  
            // We can't replace a real one with a virtual one, since we can't edit
            // history like that.
            if(this.virtual_url == null)
                throw Error("Can't replace a real history entry with a virtual one");

            this.virtual_url = url;
            return;
        }

        // If we're replacing a virtual location with a real one, pop the virtual location
        // and push the new state instead of replacing.  Otherwise, replace normally.
        if(this.virtual_url != null)
        {
            this.virtual_url = null;
            return this.pushState(state, title, url);
        }

        if(!this.permanent)
            return window.history.replaceState(state, title, url);

        this.history.pop();
        this.history.push({ state, url });
        this._update_browser_state();
    }

    get state()
    {
        if(this.virtual)
            return this.virtual_state;

        if(!this.permanent)
            return window.history.state;
        
        return this._latest_history.state;
    }

    set state(value)
    {
        if(this.virtual)
            this.virtual_state = value;

        if(!this.permanent)
            window.history.state = value;
        this._latest_history.state = value;
    }
    
    back()
    {
        // If we're backing out of a virtual URL, clear it to return to the real one.
        if(this.virtual_url)
        {
            this.virtual_url = null;
            this.broadcast_popstate({cause: "leaving-virtual"});
            return;
        }

        if(!this.permanent)
        {
            window.history.back();
            return;
        }


        if(this.history.length == 1)
            return;

        this.history.pop();
        this.broadcast_popstate();
        this._update_browser_state();
    }

    broadcast_popstate({cause}={})
    {
        let e = new PopStateEvent("pp:popstate");
        if(cause)
            e.navigationCause = cause;
        window.dispatchEvent(e);
    }

    // If we're permanent, we're not using the browser location ourself and we don't push
    // to browser history, but we do store the current URL and state, so the browser address
    // bar (if any) updates and we'll restore the latest state on reload if possible.
    _update_browser_state()
    {
        if(!this.permanent)
            return;

        try {
            window.history.replaceState(this.state, "", this._latest_history.url);
        } catch(e) {
            // iOS has a truly stupid bug: it thinks that casually flipping through pages more
            // than a few times per second (100 / 30 seconds) is something it should panic about,
            // and throws a SecurityError.
            console.log("Error setting browser history (ignored)", e);
        }
    }
};
ppixiv.phistory = new VirtualHistory;

ppixiv.PointerEventMovement = class
{
    constructor()
    {
        // If the browser supports movementX (everyone except for iOS Safari), this isn't
        // needed.
        if("movementX" in new PointerEvent("test"))
            return;

        this.last_pointer_positions = {};

        window.addEventListener("pointerdown", this.pointerdown, { capture: true });
        window.addEventListener("pointermove", this.pointerdown, { capture: true });
        window.addEventListener("pointerup", this.pointerup, { capture: true });
        window.addEventListener("pointercancel", this.pointerup, { capture: true });
    }

    pointerdown = (e) =>
    {
        // If this is the first event for this pointerId, store the current position.  Otherwise,
        // store the previous position.
        let previousX = this.last_pointer_positions[e.pointerId]?.x ?? e.screenX;
        let previousY = this.last_pointer_positions[e.pointerId]?.y ?? e.screenY;

        this.last_pointer_positions[e.pointerId] = { x: e.screenX, y: e.screenY };
        e.movementX = e.screenX - previousX;
        e.movementY = e.screenY - previousY;
    }

    pointerup = (e) =>
    {
        delete this.last_pointer_positions[e.pointerId];
        e.movementX = e.movementY = 0;
    }
}

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
    // The global handler is used to track button presses and mouse movement globally,
    // primarily to implement pointer_listener.check().

    // The latest mouse position seen by install_global_handler.
    static latest_mouse_page_position = [window.innerWidth/2, window.innerHeight/2];
    static latest_mouse_client_position = [window.innerWidth/2, window.innerHeight/2];
    static buttons = 0;
    static button_pointer_ids = new Map();
    static pointer_type = "mouse";
    static install_global_handler()
    {
        window.addEventListener("pointermove", (e) => {
            pointer_listener.latest_mouse_page_position = [e.pageX, e.pageY];
            pointer_listener.latest_mouse_client_position = [e.clientX, e.clientY];
            this.pointer_type = e.pointerType;
        }, { passive: true, capture: true });

        new pointer_listener({
            element: window,
            button_mask: 0xFFFF, // everything
            capture: true,
            callback: (e) => {
                if(e.pressed)
                {
                    pointer_listener.buttons |= 1 << e.mouseButton;
                    pointer_listener.button_pointer_ids.set(e.mouseButton, e.pointerId);
                }
                else
                {
                    pointer_listener.buttons &= ~(1 << e.mouseButton);
                    pointer_listener.button_pointer_ids.delete(e.mouseButton);
                }
            }
        });
    }

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
                    helpers.clearTimeout(this.block_contextmenu_timer);
            });
        }
        
        this.element.addEventListener("pointerdown", this.onpointerevent, this.event_options);
        this.element.addEventListener("simulatedpointerdown", this.onpointerevent, this.event_options);
    }

    // Register events that we only register while one or more buttons are pressed.
    //
    // We only register pointermove as needed, so we don't get called for every mouse
    // movement, and we only register pointerup as needed so we don't register a ton
    // of events on window.
    register_events_while_pressed(enable)
    {
        if(this.pointermove_registered)
            return;
        this.pointermove_registered = true;
        this.element.addEventListener("pointermove", this.onpointermove, this.event_options);

        // These need to go on window, so if a mouse button is pressed and that causes
        // the element to be hidden, we still get the pointerup.
        window.addEventListener("pointerup", this.onpointerevent, this.event_options);
        window.addEventListener("pointercancel", this.onpointerevent, this.event_options);
    }

    unregister_events_while_pressed(enable)
    {
        if(!this.pointermove_registered)
            return;
        this.pointermove_registered = false;
        this.element.removeEventListener("pointermove", this.onpointermove, this.event_options);
        window.removeEventListener("pointerup", this.onpointerevent, this.event_options);
        window.removeEventListener("pointercancel", this.onpointerevent, this.event_options);
    }

    button_changed(buttons, event)
    {
        // We need to register pointermove to see presses past the first.
        if(buttons)
            this.register_events_while_pressed();
        else
            this.unregister_events_while_pressed();

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
                    this.block_context_menu_until_release = true;

                // If this is a right-click release and the user prevented the event (or the corresponding
                // press earlier), block the context menu briefly.  There seems to be no other way to do
                // this: cancelling pointerdown or pointerup don't prevent actions like they should,
                // contextmenu happens afterwards, and there's no way to know if a contextmenu event
                // is coming other than waiting for an arbitrary amount of time.
                if(!is_pressed && (event.defaultPrevented || this.block_context_menu_until_release))
                {
                    this.block_context_menu_until_release = false;
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
        // Prevent oncontextmenu if RMB was pressed and cancelled, or if we're blocking
        // it after release.
        if(this.block_context_menu_until_release || this.blocking_context_menu_until_timer)
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
            helpers.clearTimeout(this.block_contextmenu_timer);
            this.block_contextmenu_timer = null;
        }

        this.block_contextmenu_timer = helpers.setTimeout(() => {
            this.block_contextmenu_timer = null;

            // console.log("Releasing context menu after timer");
            this.blocking_context_menu_until_timer = false;
        }, 50);
    }

    // Check if any buttons are pressed that were missed while the element wasn't visible.
    //
    // This can be used if the element becomes visible, and we want to see any presses
    // already happening that are over the element.
    //
    // This requires install_global_handler.
    check()
    {
        // If no buttons are pressed that this listener cares about, stop.
        if(!(this.button_mask & pointer_listener.buttons))
            return;

        // See if the cursor is over our element.
        let node_under_cursor = document.elementFromPoint(pointer_listener.latest_mouse_client_position[0], pointer_listener.latest_mouse_client_position[1]);
        if(node_under_cursor == null || !helpers.is_above(this.element, node_under_cursor))
            return;

        // Simulate a pointerdown on this element for each button that's down, so we can
        // send the corresponding pointerId for each button.
        for(let button = 0; button < 8; ++button)
        {
            // Skip this button if it's not down.
            let mask = 1 << button;
            if(!(mask & pointer_listener.buttons))
                continue;

            // Add this button's mask to the listener's last seen mask, so it only sees this
            // button being added.  This way, each button event is sent with the correct
            // pointerId.
            let new_button_mask = this.buttons_down;
            new_button_mask |= mask;
            let e = new MouseEvent("simulatedpointerdown", {
                buttons: new_button_mask,
                pageX: pointer_listener.latest_mouse_page_position[0],
                pageY: pointer_listener.latest_mouse_page_position[1],
                clientX: pointer_listener.latest_mouse_page_position[0],
                clientY: pointer_listener.latest_mouse_page_position[1],
                timestamp: performance.now(),
            });
            e.pointerId = pointer_listener.button_pointer_ids.get(button);

            this.element.dispatchEvent(e);
        }
    }
}

// ppixiv.pointer_listener is complicated because it deals with overlapping LMB and RMB
// presses, and a bunch of browser weirdness around context menus and other things that
// a lot of UI doesn't need.  touch_listener is a simpler interface that only listens for
// left-clicks and single touches.
//
// Unlike pointer_listener, this only sees initial presses, and won't see presses in
// pointermove.
ppixiv.touch_listener = class
{
    // callback(event) will be called each time buttons change.  The event will be the event
    // that actually triggered the state change, and can be preventDefaulted, etc.
    constructor({element, callback, signal, ...options}={})
    {
        this.element = element;
        this.pressed = 0;
        this.callback = callback;
        this.event_options = { };
        if(signal)
            this.event_options.signal = signal;

        this.element.addEventListener("pointerdown", this.onpointerevent, this.event_options);

        if(options.signal)
        {
            options.signal.addEventListener("abort", (e) => {
                this.unregister_events_while_pressed();
            });
        }
    }

    // Register events that we only register while one or more buttons are pressed.
    //
    // We only register pointermove as needed, so we don't get called for every mouse
    // movement, and we only register pointerup as needed so we don't register a ton
    // of events on window.
    register_events_while_pressed()
    {
        // These need to go on window, so if a mouse button is pressed and that causes
        // the element to be hidden, we still get the pointerup.
        window.addEventListener("pointerup", this.onpointerevent, { capture: true, ...this.event_options });
        window.addEventListener("pointercancel", this.onpointerevent, { capture: true, ...this.event_options });
        window.addEventListener("blur", this.onblur, this.event_options);
    }

    unregister_events_while_pressed()
    {
        window.removeEventListener("pointerup", this.onpointerevent, { capture: true, ...this.event_options });
        window.removeEventListener("pointercancel", this.onpointerevent, { capture: true, ...this.event_options });
        window.removeEventListener("blur", this.onblur, this.event_options);
    }

    onblur = (event) =>
    {
        if(!this.pressed_pointer_id)
            return;

        // Work around an iOS Safari bug: horizontal navigation drags don't always cancel pointer
        // events.  It sends pointerdown, but then never sends pointerup or pointercancel when it
        // takes over the drag, so it looks like the touch stays pressed forever.  This seems
        // to happen on forwards navigation but not back.
        //
        // If this happens, we get a blur event, so if we get a blur event and we were still pressed,
        // send an emulated pointercancel event to end the drag.
        console.warn("window.blur fired without a pointer event being cancelled, simulating it");
        this.onpointerevent(new PointerEvent("pointercancel", {
            pointerId: this.pressed_pointer_id,
            button: 0,
            buttons: 0,
        }));
    }

    onpointerevent = (event) =>
    {
        let { buttons } = event;
        let is_pressed = buttons & 1;

        // If we have a press already, ignore other inputs.
        if(this.pressed_pointer_id != null && event.pointerId != this.pressed_pointer_id)
            return;

        if(is_pressed == this.pressed)
            return;
        this.pressed = is_pressed;

        // We need to register pointermove to see presses past the first.
        if(is_pressed)
        {
            this.pressed_pointer_id = event.pointerId;
            this.register_events_while_pressed();
        }
        else
        {
            this.pressed_pointer_id = null;
            this.unregister_events_while_pressed();
        }

        // event.mouseButton is just for compatibility with pointer_listener.
        event.mouseButton = 0;
        event.pressed = is_pressed;
        this.callback(event);
        delete event.mouseButton;
        delete event.pressed;
    }
}

// This is like pointer_listener, but for watching for keys being held down.
// This isn't meant to be used for single key events.
ppixiv.global_key_listener = class
{
    static singleton = null;

    constructor()
    {
        ppixiv.global_key_listener.singleton = this;

        this.keys_pressed = new Set();
        this.listeners = new Map(); // by key
    
        // Listen to keydown on bubble, so we don't see key presses that were stopped
        // by the original target, but listen to keyup on capture.
        window.addEventListener("keydown", (e) => {
            if(this.keys_pressed.has(e.key))
                return;

            this.keys_pressed.add(e.key);
            this.call_listeners_for_key(e.key, true);
        });

        window.addEventListener("keyup", (e) => {
            if(!this.keys_pressed.has(e.key))
                return;

            this.keys_pressed.delete(e.key);
            this.call_listeners_for_key(e.key, false);
        }, true);

        window.addEventListener("blur", (e) => {
            this.release_all_keys();
        });

        // If the context menu is shown, release all keys, since browsers forget to send
        // keyup events when the context menu is open.
        window.addEventListener("contextmenu", async (e) => {
            // This is a pain.  We need to handle this event as late as possible, to let
            // all other handlers have a chance to preventDefault.  If we check it now,
            // contextmenu handlers (like blocking_context_menu_until_timer) can be registered
            // after us, and we won't see their preventDefault.
            //
            // This really wants an option for event listeners that causes it to be run after
            // other event handlers, but doesn't allow it to preventDefault, for event handlers
            // that specifically want to know if an event ended up being prevented.  But that
            // doesn't exist, so instead we just sleep to exit to the event loop, and look at
            // the event after it's completed.
            await helpers.sleep(0);
            if(e.defaultPrevented)
                return;

            this.release_all_keys();
        });
    }
    
    release_all_keys()
    {
        for(let key of this.keys_pressed)
            this.call_listeners_for_key(key, false);

        this.keys_pressed.clear();
    }

    get_listeners_for_key(key, { create=false }={})
    {
        if(!this.listeners.has(key))
        {
            if(!create)
                return [];
            this.listeners.set(key, new Set);
        }

        return this.listeners.get(key);
    }

    register_listener(key, listener)
    {
        let listeners_for_key = this.get_listeners_for_key(key, { create: true });
        listeners_for_key.add(listener);
        
        // If key is already pressed, run the callback.  Defer this so we don't call
        // it while the caller is still registering.
        helpers.setTimeout(() => {
            // Stop if the listener was unregistered before we got here.
            if(!this.get_listeners_for_key(key).has(listener))
                return;

            if(this.keys_pressed.has(key))
                listener.key_changed(true);
        }, 0);
    }

    unregister_listener(key, listener)
    {
        let listeners_for_key = this.get_listeners_for_key(key, { create: false });
        if(listeners_for_key)
            listeners_for_key.delete(listener);
    }

    call_listeners_for_key = (key, down) =>
    {
        let listeners_for_key = this.get_listeners_for_key(key, { create: false });
        if(listeners_for_key == null)
            return;

        for(let key_listener of listeners_for_key.values())
            key_listener.key_changed(down);
    };
}

ppixiv.key_listener = class
{
    constructor(key, callback, {signal=null}={})
    {
        this.callback = callback;
        this.pressed = false;

        ppixiv.global_key_listener.singleton.register_listener(key, this);

        if(signal)
        {
            signal.addEventListener("abort", (e) => {
                ppixiv.global_key_listener.singleton.unregister_listener(key, this);
            });
        }
    }

    key_changed = (pressed) =>
    {
        if(this.pressed == pressed)
            return;
        this.pressed = pressed;
        
        this.callback(pressed);
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

    // Store info about an image that we've loaded data for.
    add_info(image_data)
    {
        // Everyone else now uses image_data.illustId and image_data.media_id.  We
        // still just use .id  here, since this is only used for Pixiv images and it's
        // not worth a migration to change the primary key.
        /* image_data = {
            id: image_data.illustId,
            ...image_data,
        }
        */

        // Store one record per page.
        let pages = [];
        for(let page = 0; page < image_data.pageCount; ++page)
        {
            let illust_id = image_data.illustId;
            let media_id = helpers.illust_id_to_media_id(image_data.illustId, page);
            let url = image_data.mangaPages[page].urls.original;
            let parts = url.split(".");
            let ext = parts[parts.length-1];
    
            pages.push({
                illust_id_and_page: media_id,
                illust_id: illust_id,
                page: page,
                user_id: image_data.userId,
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

    async get_stored_record(media_id)
    {
        return this.db.db_op(async (db) => {
            let store = this.db.get_store(db);
            let record = await key_storage.async_store_get(store, media_id);
            if(record == null)
                return null;
            else
                return record.url;
        });
    }

    async guess_url(media_id)
    {
        // Guessed preloading is disabled if we're using an image size limit, since
        // it's too early to tell which image we'll end up using.
        if(settings.get("image_size_limit") != null)
            return null;

        // If this is a local URL, we always have the image URL and we don't need to guess.
        let { type, page } = helpers.parse_media_id(media_id);
        console.assert(type != "folder");
        if(type == "file")
        {
            let thumb = media_cache.get_media_info_sync(media_id, { full: false });
            if(thumb?.illustType == "video")
                return null;
            else
                return thumb?.mangaPages[page]?.urls?.original;
        }
    
        // If we already have illust info, use it.
        let illust_info = media_cache.get_media_info_sync(media_id);
        if(illust_info != null)
            return illust_info.mangaPages[page].urls.original;

        // If we've stored this URL, use it.
        let stored_url = await this.get_stored_record(media_id);
        if(stored_url != null)
            return stored_url;
        
        // Get thumbnail data.  We need the thumbnail URL to figure out the image URL.
        let thumb = media_cache.get_media_info_sync(media_id, { full: false });
        if(thumb == null)
            return null;

        // Don't bother guessing file types for animations.
        if(thumb.illustType == 2)
            return null;

        // Try to make a guess at the file type.
        let guessed_filetype = await this.guess_filetype_for_user_id(thumb.userId);
        if(guessed_filetype == null)
            return null;
    
        // Convert the thumbnail URL to the equivalent original URL:
        // https://i.pximg.net/c/540x540_70  /img-master/img/2021/01/01/01/00/02/12345678_p0_master1200.jpg
        // to
        // https://i.pximg.net             /img-original/img/2021/01/01/01/00/02/12345678_p0.jpg
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
    async guessed_url_incorrect(media_id)
    {
        // If this was a stored URL, remove it from the database.
        await this.db.multi_delete([media_id]);
    }
};

// Helpers for working with paths.
ppixiv.helpers.path = {
    // Return true if array begins with prefix.
    array_starts_with(array, prefix)
    {
        if(array.length < prefix.length)
            return false;

        for(let i = 0; i < prefix.length; ++i)
            if(array[i] != prefix[i])
                return false;
        return true;
    },

    is_relative_to(path, root)
    {
        let path_parts = path.split("/");
        let root_parts = root.split("/");
        return ppixiv.helpers.path.array_starts_with(path_parts, root_parts);
    },

    split_path(path)
    {
        // If the path ends with a slash, remove it.
        if(path.endsWith("/"))
            path = path.substr(0, path.length-1);

        let parts = path.split("/");
        return parts;
    },

    // Return absolute_path relative to relative_to.
    get_relative_path(relative_to, absolute_path)
    {
        console.assert(absolute_path.startsWith("/"));
        console.assert(relative_to.startsWith("/"));

        let path_parts = ppixiv.helpers.path.split_path(absolute_path);
        let root_parts = ppixiv.helpers.path.split_path(relative_to);

        // If absolute_path isn"t underneath relative_to, leave it alone.
        if(!ppixiv.helpers.path.array_starts_with(path_parts, root_parts))
            return absolute_path;

        let relative_parts = path_parts.splice(root_parts.length);
        return relative_parts.join("/");
    },

    // Append child to path.
    get_child(path, child)
    {
        // If child is absolute, leave it alone.
        if(child.startsWith("/"))
            return child;

        let path_parts = ppixiv.helpers.path.split_path(path);
        let child_parts = ppixiv.helpers.path.split_path(child);
        let combined = path_parts.concat(child_parts);
        return combined.join('/');
    },
};

ppixiv.FixedDOMRect = class extends DOMRect
{
    constructor(left, top, right, bottom)
    {
        super(left, top, right-left, bottom-top);
    }

    // Allow editing the rect as a pair of x1,y1/x2,y2 coordinates, which is more natural
    // than x,y and width,height.  x1 and y1 can be greater than x2 and y2 if the rect is
    // inverted (width or height are negative).
    get x1() { return this.x; }
    get y1() { return this.y; }
    get x2() { return this.x + this.width; }
    get y2() { return this.y + this.height; }
    set x1(value) { this.width += this.x - value; this.x = value; }
    set y1(value) { this.height += this.y - value; this.y = value; }
    set x2(value) { this.width = value - super.x; }
    set y2(value) { this.height = value - super.y; }

    get middleHorizontal() { return (super.right + super.left) / 2; }
    get middleVertical() { return (super.top + super.bottom) / 2; }

    // Return a new FixedDOMRect with the edges pushed outwards by value.
    extendOutwards(value)
    {
        return new FixedDOMRect(
            this.left - value,
            this.top - value,
            this.right + value,
            this.bottom + value
        )
    }

    // Crop this rect to fit within outer.
    cropTo(outer)
    {
        return new FixedDOMRect(
            helpers.clamp(this.x1, outer.x1, outer.x2),
            helpers.clamp(this.y1, outer.y1, outer.y2),
            helpers.clamp(this.x2, outer.x1, outer.x2),
            helpers.clamp(this.y2, outer.y1, outer.y2),
        );
    }
}

// Add:
//
// await controller.signal.wait()
//
// to wait for an AbortSignal to be aborted.
AbortSignal.prototype.wait = function()
{
    if(this.aborted)
        return;

    if(this._promise == null)
    {
        this._promise = new Promise((accept) => {
            this._promise_accept = accept;
        });

        this.addEventListener("abort", (e) => {
            this._promise_accept();
        }, { once: true });
    }
    return this._promise;
};

ppixiv.IncrementalTimer = class
{
    constructor()
    {
        this.entries = [];
        this.previous = performance.now();
    }

    touch()
    {
        let time = performance.now();
        let seconds = (time - this.previous);
        this.previous = time;
        this.entries.push(seconds);
    }

    get total()
    {
        let result = 0;
        for(let value of this.entries)
            result += value;
        return result;
    }

    toString()
    {
        let total = this.total;
        let seconds = [];
        for(let value of this.entries)
        {
            let percent = 100 * (value / total);
            seconds.push(Math.round(percent) + '%');
        }
        return `${total.toFixed(1)}ms: ${seconds.join(" ")}`;
    }
};

// This calculates the current velocity from recent motion.
ppixiv.FlingVelocity = class
{
    constructor({ sample_period=0.1 }={})
    {
        this.sample_period = sample_period;
        this.reset();
    }

    add_sample( {x=0,y=0}={} )
    {
        this.samples.push({
            delta: { x, y },
            time: Date.now()/1000,
        });

        this.purge();
    }

    // Delete samples older than sample_period.
    purge()
    {
        let delete_before = Date.now()/1000 - this.sample_period;
        while(this.samples.length && this.samples[0].time < delete_before)
            this.samples.shift();
    }

    // Delete all samples.
    reset()
    {
        this.samples = [];
    }

    // A helper to get current_distance and current_velocity in a direction: "up", "down", "left" or "right".
    get_movement_in_direction(direction)
    {
        let distance = this.current_distance;
        let velocity = this._get_velocity_from_current_distance(distance);
        switch(direction)
        {
        case "up":    return { distance: -distance.y, velocity: -velocity.y };
        case "down":  return { distance: +distance.y, velocity: +velocity.y };
        case "left":  return { distance: -distance.x, velocity: -velocity.x };
        case "right": return { distance: +distance.x, velocity: +velocity.x };
        default:
            throw new Error("Unknown direction:", direction);
        }
    }

    // Get the distance travelled within the sample period.
    get current_distance()
    {
        this.purge();

        if(this.samples.length == 0)
            return { x: 0, y: 0 };

        let total = [0,0];
        for(let sample of this.samples)
        {
            total[0] += sample.delta.x;
            total[1] += sample.delta.y;
        }

        return { x: total[0], y: total[1] };
    }

    // Get the average velocity.
    get current_velocity()
    {
        return this._get_velocity_from_current_distance(this.current_distance);
    }

    _get_velocity_from_current_distance(current_distance)
    {
        let { x, y } = current_distance;

        if(this.samples.length == 0)
            return { x: 0, y: 0 };

        let duration = Date.now()/1000 - this.samples[0].time;
        if( duration < 0.001 )
        {
            // console.error("no sample duration");
            return { x: 0, y: 0 };
        }

        x /= duration;
        y /= duration;
        return { x, y };
    }
}

// A helper for exponential backoff delays.
ppixiv.SafetyBackoffTimer = class
{
    constructor({
        // Reset the backoff after this much time elapses without requiring a backoff.
        reset_after=60,

        // The maximum backoff delay time, in seconds.
        max_backoff=30,

        // The exponent for backoff.  Each successive backup waits for exponent^error count.
        exponent=1.5,
    }={})
    {
        this.reset_after_ms = reset_after*1000;
        this.max_backoff_ms = max_backoff*1000;
        this.exponent = exponent;
        this.reset();
    }

    reset()
    {
        this.reset_at = Date.now() + this.reset_after_ms;
        this.backoff_count = 0;
    }

    async wait()
    {
        // If enough time has passed without a backoff, reset.
        if(Date.now() >= this.reset_at)
            this.reset();

        this.reset_at = Date.now() + this.reset_after_ms;
        this.backoff_count++;

        let delay_ms = Math.pow(this.exponent, this.backoff_count) * 1000;
        delay_ms = Math.min(delay_ms, this.max_backoff_ms);
        console.log("wait for", delay_ms);
        await helpers.sleep(delay_ms);
    }
};

// This is a wrapper to treat a classList as a set of flags that can be monitored.
//
// let flags = ClassFlags(element);
// flags.set("enabled", true);        // class="enabled"
// flags.set("selected", true);       // class="enabled selected"
// flags.set("enabled", false);       // class="selected"
//
// 
ppixiv.ClassFlags = class extends EventTarget
{
    // This class can be used on anything, but it's normally used on <html> for document-wide
    // flags.
    static get get()
    {
        if(this.singleton == null)
            this.singleton = new ppixiv.ClassFlags(document.documentElement);
        return this.singleton;
    }

    constructor(element)
    {
        super();
        
        this.element = element;

        // Use a MutationObserver, so we'll see changes whether they're made by us or something
        // else.
        let observer = new MutationObserver((mutations) => {
            // If we have multiple mutation records, we only need to process the first one, comparing
            // the first oldValue to the current value.
            let mutation = mutations[0];

            let old_classes = mutation.oldValue ?? "";
            let old_set = new Set(old_classes.split(" "));
            let new_set = this.element.classList;
            for(let name of new_set)
                if(!old_set.has(name))
                    this.broadcast(name, true);

            for(let name of old_set)
                if(!new_set.contains(name))
                    this.broadcast(name, false);
        });

        observer.observe(element, { attributeFilter: ["class"], attributeOldValue: true });
    }

    get(name) { return this.element.classList.contains(name); }
    
    set(name, value)
    {
        // Update the class.  The mutation observer will handle broadcasting the change.
        helpers.set_class(this.element, name, value);

        return true;
    }

    // Dispatch an event for a change to the given key.
    broadcast(name, value)
    {
        let e = new Event(name);
        e.value = value;
        this.dispatchEvent(e);
    }
};


// This keeps track of open UI that the user is interacting with which should
// prevent us from auto-advancing images in the slideshow.  This allows us to
// pause the slideshow or prevent it from advancing while the context menu or
// settings are open.
ppixiv.OpenWidgets = class extends EventTarget
{
    static get singleton()
    {
        if(this._singleton == null)
            this._singleton = new this;
        return this._singleton;
    }

    constructor()
    {
        super();

        this.open_widgets = new Set();

        this.event = new ppixiv.helpers.WakeupEvent();
    }

    // If true, there are no open widgets or dialogs that should prevent the image from
    // changing automatically.
    get empty()
    {
        return this.open_widgets.size == 0;
    }

    // A shortcut to add or remove a widget.
    set(widget, value)
    {
        if(value)
            this.add(widget);
        else
            this.remove(widget);
    }

    // We're also an event target, so you can register to find out when dialogs are opened
    // and closed.
    _broadcast_changed()
    {
        this.dispatchEvent(new Event("changed"));
    }

    // Add an open widget to the list.
    add(widget)
    {
        let was_empty = this.empty;
        this.open_widgets.add(widget);
        if(was_empty)
            this._broadcast_changed();
    }

    // Remove an open UI from the list, possibly waking up callers to wait_until_empty.
    async remove(widget)
    {
        if(!this.open_widgets.has(widget))
            return;

        this.open_widgets.delete(widget);

        if(this.event.size > 0)
            return;

        // Another widget might be added immediately after this one is removed, so don't wake
        // listeners immediately.  Yield to the event loop, and check after anything else on
        // the stack has finished.
        await helpers.sleep(0);

        // Let any listeners know that our empty status has changed.  Do this before checking
        // if we're empty, in case this causes somebody to open another dialog.
        this._broadcast_changed();

        if(this.event.size > 0)
            return;

        this.event.wake();
    }

    async wait_until_empty()
    {
        while(!this.empty)
            await this.event.wait();
    }

    // Return all open widgets.
    get_all()
    {
        return this.open_widgets;
    }
}

// Sometimes we have multiple DragHandlers which can act on the same touch, depending on
// pointer movement after the touch.  This tracks the active drags, and allows whichever
// drag activates first to cancel the others.
ppixiv.RunningDrags = class
{
    static drags = new Map();

    // Add an active dragger.  If cancel_others is called, oncancel() will be called to
    // cancel the drag.
    static add(dragger, oncancel)
    {
        // Sanity check: we should never add new drags to the list while another one is already
        // active.  It's redundant but OK for the active dragger to re-add itself.
        if(this._active_drag != null && this._active_drag != dragger)
        {
            console.log("Adding:", dragger);
            console.log("Active:", this._active_drag);

            throw new Error("Can't add a dragger while one is currently active");
        }

        this.drags.set(dragger, oncancel);
    }
    
    static remove(dragger)
    {
        this.drags.delete(dragger);
        if(dragger == this._active_drag)
            this._active_drag = null;

        if(this._active_drag && this.drags.size == 0)
            console.error("_active_drag wasn't cleared", dragger);
    }
    
    // A potential dragger is becoming active, so cancel all other draggers.  active_drag
    // is this dragger until it's removed.
    static cancel_others(active_dragger)
    {
        if(this._active_drag != null)
        {
            console.log("Dragger was active:", this._active_drag);
            throw new Error("Started a drag while another dragger was already active");
        }

        if(!this.drags.has(active_dragger))
        {
            console.log("active_dragger:", active_dragger);
            throw new Error("Active dragger isn't in the dragger list");
        }

        console.assert(this._active_drag == null);
        this._active_drag = active_dragger;

        for(let [dragger, cancel_drag] of this.drags.entries())
        {
            if(dragger === active_dragger)
                continue;

            // Tell the dragger which other dragger cancelled it.
            cancel_drag({dragger, other_dragger: active_dragger});
        }
    }

    // If a dragger is active, return it.
    static get active_drag()
    {
        return this._active_drag;
    }
}

// Basic low-level dragging.
//
// This currently handles simple single-touch drags.  It doesn't handle multitouch, so it's not
// used by TouchScroller.
ppixiv.DragHandler = class
{
    constructor({
        name="unnamed", // for diagnostics
        element,
        signal,

        // Called on the initial press before starting the drag.  If set, returns true if the drag
        // should begin or false if it should be ignored.
        onpointerdown,

        // This is called we were cancelled after onpointerdown by another dragger starting first.
        oncancelled,

        // Called when the drag starts, which is the first pointer movement after onpointerdown.
        // If false is returned, the drag is cancelled.  If this happens when deferred_start is true,
        // the drag won't be started and won't interrupt other drags.
        ondragstart = () => true,

        // ondrag({event, first})
        // first is true if this is the first pointer movement since this drag started.
        ondrag,

        // Called when the drag is released.
        ondragend,

        // Called when a touch that began a drag is released.  This is always called if
        // onpointerdown returned true, even if the drag never actually began.
        onpointerup,

        // If this returns true (the default), the drag will start on the first pointer movement.
        // If false, the drag will start immediately on pointerdown.
        deferred_start=() => true,
    }={})
    {
        this.name = name;
        this.element = element;
        this.captured_pointer_id = null;
        this.onpointerdown = onpointerdown;
        this.oncancelled = oncancelled;
        this.onpointerup = onpointerup;
        this.ondragstart = ondragstart;
        this.ondrag = ondrag;
        this.ondragend = ondragend;
        this.deferred_start = deferred_start;

        signal ??= (new AbortController().signal);

        this.pointer_listener = new ppixiv.touch_listener({
            element,
            signal,
            callback: this._pointerevent,
        });

        signal.addEventListener("abort", () => this.cancel_drag());
    }

    // If a drag is active, cancel it.
    cancel_drag()
    {
        this._stop_dragging({interactive: false});
    }

    _pointerevent = (e) =>
    {
        if(e.pressed && this.captured_pointer_id == null)
        {
            if(this.onpointerdown)
            {
                if(!this.onpointerdown({event: e}))
                    return;
            }

            this._start_dragging(e);
        } else {
            if(this.captured_pointer_id == null || e.pointerId != this.captured_pointer_id)
                return;

            this._stop_dragging({ interactive: true, cancel: e.type == "pointercancel" });
        }
    }

    // Return true if we think drags on element might trigger a scroll.  This doesn't
    // include the document.
    _is_element_inside_scroller(element)
    {
        let style = getComputedStyle(element);
        if(style.position === "fixed")
            return false;

        let excludeStaticParent = style.position === "absolute";
        while(element)
        {
            style = getComputedStyle(element);
            let scrollable = style.overflowX == "auto" || style.overflowX == "scroll" || 
                                style.overflowY == "auto" || style.overflowY == "scroll";

            // This is only used for testing scrolling on mobile.  If touch-action is none,
            // this won't be scrollable.  There are other values that won't scroll, but there
            // are a lot of settings and this is all we use.
            if(style.touchAction == "none")
                scrollable = false;                            

            if(scrollable && (!excludeStaticParent || style.position != "static"))
                return true;

            element = element.parentElement;
            if(element == null)
                break;

            // Stop if we've reached the document scroller.
            if(element == document.scrollingElement)
                break;
        }
    
        return false;
    }
    
    async _start_dragging(event)
    {
        // We shouldn't be starting a drag while one is already in progress.
        if(this.captured_pointer_id)
        {
            console.error("Unexpected start of drag");
            return;
        }

        // Don't start a new dragger while another one is active.
        if(ppixiv.RunningDrags.active_drag)
            return;

        this.captured_pointer_id = event.pointerId;
        window.addEventListener("pointermove", this._pointermove);
        this.first_pointer_movement = true;
        this.sent_ondragstart = false;

        ppixiv.RunningDrags.add(this, ({other_dragger}) => {
            this.cancel_drag();
            if(this.oncancelled)
                this.oncancelled({other_dragger});
        });

        // Ask the caller if we want to defer the start of the drag until the first pointer
        // movement.  If we don't, start it now, otherwise we'll start it in pointermove later.
        if(!this.deferred_start())
            this._commit_start_dragging({event});
    }

    // Actually start the drag.  This may happen immediately on pointerdown or on the first pointermove.
    // event is a PointerEvent, but may be either pointerdown or pointermove.
    async _commit_start_dragging({event})
    {
        if(this.sent_ondragstart)
            return;

        if(!this.ondragstart({event}))
        {
            this._stop_dragging();
            return;
        }

        this.sent_ondragstart = true;

        ppixiv.RunningDrags.cancel_others(this);
    }

    // A drag finished.  interactive is true if this is the user releasing it, or false
    // if we're shutting down during a drag.  See if we should transition the image or undo.
    // cancel is true if this is due to a pointercancel event.
    _stop_dragging({interactive=false, cancel=false}={})
    {
        if(this.captured_pointer_id == null)
            return;

        if(this.captured_pointer_id != null)
        {
            this.element.releasePointerCapture(this.captured_pointer_id);
            this.captured_pointer_id = null;
        }

        window.removeEventListener("pointermove", this._pointermove);

        ppixiv.RunningDrags.remove(this);

        // Only send ondragend if we sent ondragstart.
        if(this.sent_ondragstart)
        {
            this.sent_ondragstart = false;
            if(this.ondragend)
                this.ondragend({interactive, cancel});
        }

        // Always send onpointerup, even if there was no actual drag.
        if(this.onpointerup)
            this.onpointerup();
    }

    _pointermove = (event) =>
    {
        if(event.pointerId != this.captured_pointer_id)
            return;

        let first = this.first_pointer_movement;
        this.first_pointer_movement = false;
    
        // When we actually handle pointer movement, let IsolatedTapHandler know that this
        // press was handled by something.  This doesn't actually prevent any default behavior.
        event.preventDefault();

        // Call ondragstart the first time we see pointer movement after we begin the drag.  This
        // is when the drag actually starts.  We don't do movement thresholding here since iOS already
        // does it (whether we want it to or not).
        this._commit_start_dragging({event});
    
        // Only handle this as a drag input if we've started treating this as a drag.
        if(this.sent_ondragstart)
            this.ondrag({event, first});
    }
};

const FlingFriction = 10;
const FlingMinimumVelocity = 10;

// Mobile panning, fling and pinch zooming.
ppixiv.TouchScroller = class
{
    constructor({
        // The container to watch for pointer events on:
        container,

        // set_position({x, y})
        set_position,

        // { x, y } = get_position()
        get_position,

        // Zoom in or out by ratio, centered around the given position.
        adjust_zoom,

        // Return a FixedDOMRect for the bounds of the image.  The position we set can overscroll
        // out of this rect, but we'll bounce back in.  This can change over time, such as due to
        // the zoom level changing.
        get_bounds,

        // If the current zoom is outside the range the viewer wants, return the ratio from the
        // current zoom to the wanted zoom.  This is applied along with rubber banding.
        get_wanted_zoom,

        // Callbacks:
        onactive = () => { },                  oninactive = () => { },
        ondragstart = () => { },               ondragend = () => { },
        onanimationstart = () => { },          onanimationfinished = () => { },

        // An AbortSignal to shut down.
        signal,
    })
    {
        this.container = container;
        this.shutdown_signal = signal;
        this.options = {
            get_position,
            set_position,
            get_bounds,
            get_wanted_zoom,
            adjust_zoom,

            onactive,              oninactive,
            ondragstart,           ondragend,
            onanimationstart,      onanimationfinished,
        };

        this.velocity = {x: 0, y: 0};
        this.fling_velocity = new FlingVelocity();
        this.pointers = new Map();
        this._delaying_before_drag = false;

        // This is null if we're inactive, "dragging" if the user is dragging, or "animating" if we're
        // flinging and rebounding.
        this._state = "idle";

        // Note that we don't use pointer_listener for this.  It's meant for mouse events
        // and isn't optimized for multitouch.
        this.container.addEventListener("pointerdown", this.onpointerdown, { signal });

        // Cancel any running fling if we're shut down while a fling is active.
        signal.addEventListener("abort", (e) => {
            this.cancel_fling();
            this.cancel_drag();
        }, { once: true });
    }

    // Register events that we only need during a drag.
    _register_events()
    {
        window.addEventListener("pointermove", this.pointermove, { signal: this.shutdown_signal });        
        window.addEventListener("pointerup", this.onpointerup, { signal: this.shutdown_signal });
        window.addEventListener("pointercancel", this.onpointerup, { signal: this.shutdown_signal });
    }

    _unregister_events()
    {
        window.removeEventListener("pointermove", this.pointermove);
        window.removeEventListener("pointerup", this.onpointerup);
        window.removeEventListener("pointercancel", this.onpointerup);
    }

    // If we're delaying before a drag, cancel the drag_delay_timer and cancel the potential drag.
    cancel_pending_drag = () =>
    {
        this._delaying_before_drag = false;

        if(this.drag_delay_timer != null)
        {
            helpers.clearTimeout(this.drag_delay_timer);
            this.drag_delay_timer = null;
        }
    }

    onpointerdown = (e) =>
    {
        // Don't start a drag if one is already running.  Do continue if we're already dragging
        // and this is the start of a pinch.
        if(this._state != "dragging" && ppixiv.RunningDrags.active_drag)
            return;

        // If we were flinging, the user grabbed the fling and interrupted it.
        if(this._state == "animating")
            this.cancel_fling();

        if(this.pointers.size == 0 && helpers.should_ignore_horizontal_drag(e))
            return;

        // On iOS, we can do this to allow dragging with a large press without waiting for
        // the delay.  It's disabled for now since it might make the UI confusing.  It probably
        // would work better if we had access to haptics.
        /*
        if(this._state != "dragging" && e.width > 50)
        {
            this.cancel_pending_drag();
            ppixiv.RunningDrags.add(this, () => this.cancel_pending_drag());
            ppixiv.RunningDrags.cancel_others(this);
            this._set_state("dragging");
        }
        */

        if(this._state == "idle" && this._delaying_before_drag && this.pointers.size > 0)
        {
            // We were in _delaying_before_drag and a second tap started.  Cancel the delay and
            // start immediately for pinch zooming.
            this.cancel_pending_drag();
            this._set_state("dragging");
            ppixiv.RunningDrags.cancel_others(this);
        }
        else if(this._state != "dragging" && !this._delaying_before_drag)
        {
            // We can start the drag now.  Wait briefly to allow the other screen_illust draggers to
            // have a shot at them first, so they see quick flings and we see drags that have a slight
            // delay.
            this.total_movement_during_delay = [0,0];
            this.drag_delay_timer = helpers.setTimeout(() => {
                console.assert(this._state == "idle", `Expected to be idle, actually ${this._state}`);
                console.assert(this._delaying_before_drag, `Expected to be in _delaying_before_drag`);
                
                ppixiv.RunningDrags.cancel_others(this);
                this._delaying_before_drag = false;
                this._set_state("dragging");
            }, 30);

            this._delaying_before_drag = true;
        }

        ppixiv.RunningDrags.add(this, () => this.cancel_pending_drag());

        if(this.pointers.size == 0)
            this._register_events();

        this.pointers.set(e.pointerId, {
            x: e.clientX,
            y: e.clientY,

            // Pointer movements are thresholded: we don't get pointer movements until the
            // touch has moved some minimum amount, and all movement until then will be
            // bundled into the first pointermove event.  Ignore that first event, since it
            // makes drags look jerky.
            ignore_next_pointermove: true,
        });
        
        // Kill any velocity when a new touch happens.
        this.fling_velocity.reset();

        // If the image fits onscreen on one or the other axis, don't allow panning on
        // that axis.  This is the same as how our mouse panning works.  However, only
        // enable this at the start of a drag: if axes are unlocked at the start, don't
        // lock them as a result of pinch zooming.  Otherwise we'll start locking axes
        // in the middle of dragging due to zooms.
        let bounds = this.options.get_bounds();
        this.drag_axes_locked = [bounds.width < 0.001, bounds.height < 0.001];
    }

    // Set the current state: "idle", "dragging" or "animating", running the
    // appropriate callbacks.
    _set_state(state, args={})
    {
        if(state == this._state)
            return;

        // Debugging a case where we end up in idle, but we're still the active dragger and think
        // we have touches.
        if(state == "idle" && this.pointers.size > 0)
            console.warn("Invalid TouchScroller idle state");

        // Transition back to active, ending whichever state we were in before.
        if(state != "idle"      && this._change_state("idle", "active")) this.options.onactive(args);
        if(state != "dragging"  && this._change_state("dragging", "active")) this.options.ondragend(args);
        if(state != "animating" && this._change_state("animating", "active")) this.options.onanimationfinished(args);

        // Transition into the new state, beginning the new state.
        if(state == "dragging"  && this._change_state("active", "dragging")) this.options.ondragstart(args);
        if(state == "animating" && this._change_state("active", "animating")) this.options.onanimationstart(args);
        if(state == "idle"      && this._change_state("active", "idle")) this.options.oninactive(args);
    }
    
    _change_state(old_state, new_state)
    {
        if(this._state != old_state)
            return false;

        // console.warn(`state change: ${old_state} -> ${new_state}`);
        this._state = new_state;

        // Don't call onstatechange for active, since it's just a transition between
        // other states.
        // if(new_state != "active")
        //    this.onstatechange();

        return true;
    }

    // Cancel any drag immediately without starting a fling.
    cancel_drag()
    {
        if(this._state != "dragging")
            return;

        this._cancel_drag();
        this._set_state("idle");
    }

    // Like cancel_drag, but don't change our state.  This is used if we're changing from
    // dragging to animating, where we shouldn't return to idle in-between.
    _cancel_drag()
    {
        this.cancel_pending_drag();

        if(this._state != "dragging")
            return;

        this.pointers.clear();
        this._unregister_events();
        ppixiv.RunningDrags.remove(this);
    }

    // This also receives pointercancel.
    onpointerup = (e) =>
    {
        // Ignore touches we don't know about.
        if(!this.pointers.has(e.pointerId))
            return;

        this.pointers.delete(e.pointerId);

        // If there are more touches active, keep dragging.  If this is the last pointer released, apply
        // velocity to fling.
        if(this.pointers.size > 0)
            return;

        this._unregister_events();

        this.cancel_pending_drag();
        ppixiv.RunningDrags.remove(this);

        // The last touch was released.  If we were dragging, start flinging or rubber banding.
        if(this._state == "dragging")
            this.start_fling();
    }

    // Get the average position of all current touches.
    get pointer_center_pos()
    {
        let center_pos = {x: 0, y: 0};
        for(let {x, y} of this.pointers.values())
        {

            center_pos.x += x;
            center_pos.y += y;
        }
        center_pos.x /= this.pointers.size;
        center_pos.y /= this.pointers.size;
        return center_pos;
    }

    // Return the average distance of all current touches to the given position.
    pointer_distance_from(pos)
    {
        let result = 0;
        for(let {x, y} of this.pointers.values())
            result += helpers.distance(pos, {x,y});
        result /= this.pointers.size;
        return result;
    }

    pointermove = (e) =>
    {
        let pointer_info = this.pointers.get(e.pointerId);
        if(pointer_info == null)
            return;

        if(this._state != "dragging")
        {
            this.total_movement_during_delay[0] += Math.abs(e.movementX);
            this.total_movement_during_delay[1] += Math.abs(e.movementY);
            return;
        }

        // When we actually handle pointer movement, let IsolatedTapHandler know that this
        // press was handled by something.  This doesn't actually prevent any default behavior.
        e.preventDefault();

        // The center position and average distance at the start of the frame:
        let old_center_pos = this.pointer_center_pos;
        let old_average_distance_from_anchor = this.pointer_distance_from(old_center_pos);

        // Update this pointer.  This will update pointer_center_pos.
        pointer_info.x = e.clientX;
        pointer_info.y = e.clientY;

        // Ignore the first pointer movement.
        if(pointer_info.ignore_next_pointermove)
        {
            pointer_info.ignore_next_pointermove = false;
            return;
        }

        // The center position and average distance at the end of the frame:
        let new_center_pos = this.pointer_center_pos;
        let new_average_distance_from_anchor = this.pointer_distance_from(new_center_pos);

        // The average pointer movement across the frame:
        let movementX = new_center_pos.x - old_center_pos.x;
        let movementY = new_center_pos.y - old_center_pos.y;

        // We're overscrolling if we're out of bounds on either axis, so apply drag to
        // the pan.
        let position = this.options.get_position();

        let bounds = this.options.get_bounds();
        let overscrollX = Math.max(bounds.left - position.x, position.x - bounds.right);
        let overscrollY = Math.max(bounds.top - position.y, position.y - bounds.bottom);
        if(overscrollX > 0) movementX *= Math.pow(this.overscroll_strength, overscrollX);
        if(overscrollY > 0) movementY *= Math.pow(this.overscroll_strength, overscrollY);

        // If movement is locked on either axis, zero it.
        if(this.drag_axes_locked[0])
            movementX = 0;
        if(this.drag_axes_locked[1])
            movementY = 0;

        // Apply the pan.
        this.options.set_position({ x: position.x - movementX, y: position.y - movementY});

        // Store this motion sample, so we can estimate fling velocity later.  This should be
        // affected by axis locking above.
        this.fling_velocity.add_sample({ x: -movementX, y: -movementY });

        // If we zoomed in and now have room to move on an axis that was locked before,
        // unlock it.  We won't lock it again until a new drag is started.
        if(bounds.width >= 0.001)
            this.drag_axes_locked[0] = false;
        if(bounds.height >= 0.001)
            this.drag_axes_locked[1] = false;

        // The zoom for this frame is the ratio of the change of the average distance from the
        // anchor, centered around the average touch position.
        if(this.pointers.size > 1 && old_average_distance_from_anchor > 0)
        {
            let ratio = new_average_distance_from_anchor / old_average_distance_from_anchor;
            this.options.adjust_zoom({ratio, centerX: new_center_pos.x, centerY: new_center_pos.y});
        }
    }

    get overscroll_strength() { return 0.994; }

    // Switch from dragging to flinging.
    //
    // This can be called by the user to force a fling to begin, allowing this to be used
    // for smooth bouncing.  onanimationstart_options will be passed to onanimationstart
    // for convenience.
    start_fling({onanimationstart_options={}}={})
    {
        // We shouldn't already be flinging when this is called.
        if(this._state == "animating")
        {
            console.warn("Already animating");
            return;
        }

        // If we're being called externally and not from a drag, a drag might be in progress.
        // For regular flings after drags, we'll always have finished the drag, so this won't
        // do anything.  The internal _cancel_drag won't return us to idle, since we're about
        // to set animating.
        this._cancel_drag();

        // Set the initial velocity to the average recent speed of all touches.
        this.velocity = this.fling_velocity.current_velocity;

        this._set_state("animating", onanimationstart_options);

        console.assert(this.abort_fling == null);
        this.abort_fling = new AbortController();
        this.run_fling(this.abort_fling.signal);
    }

    cancel_fling()
    {
        if(this._state != "animating")
            return;

        if(this.abort_fling)
        {
            this.abort_fling.abort();
            this.abort_fling = null;
        }

        this._set_state("idle");
    }

    // Handle a fling asynchronously.  Stop when the fling ends or signal is aborted.
    async run_fling(signal)
    {
        let previous_time = Date.now() / 1000;
        while(this._state == "animating")
        {
            let success = await helpers.vsync({ signal });
            if(!success)
                return;

            let new_time = Date.now() / 1000;
            let duration = new_time - previous_time;
            previous_time = new_time;

            let movementX = this.velocity.x * duration;
            let movementY = this.velocity.y * duration;

            // Apply the velocity to the current position.
            let current_position = this.options.get_position();
            current_position.x += movementX;
            current_position.y += movementY;

            // Decay our velocity.
            let decay = Math.exp(-FlingFriction * duration);
            this.velocity.x *= decay;
            this.velocity.y *= decay;

            // If we're out of bounds, accelerate towards being in-bounds.  This simply moves us
            // towards being in-bounds based on how far we are from it, which gives the effect
            // of acceleration.
            let bounced = this.apply_position_bounce(duration, current_position);
            if(this.apply_zoom_bounce(duration))
                bounced = true;

            // Stop if our velocity has decayed and we're not rebounding.
            let total_velocity = Math.pow(Math.pow(this.velocity.x, 2) + Math.pow(this.velocity.y, 2), 0.5);
            if(!bounced && total_velocity < FlingMinimumVelocity)
                break;
        }

        // We've reached (near) zero velocity.  Clamp the velocity to 0.
        this.velocity = { x: 0, y: 0 };

        this.abort_fling = null;
        this._set_state("idle");
    }

    apply_zoom_bounce(duration)
    {
        // See if we want to bounce the zoom.  This is used to scale the viewer back up to
        // 1x if the image is zoomed lower than that.
        let { ratio, centerX, centerY } = this.options.get_wanted_zoom();
        if(Math.abs(1-ratio) < 0.001)
            return false;

        // While we're figuring out the speed, invert ratios less than 1 (zooming down) so
        // the ratios are linear.
        let inverted = ratio < 1;
        if(inverted)
            ratio = 1/ratio;

        // The speed we'll actually apply the zoom ratio.  If this is 2, we'll adjust the ratio
        // by 2x per second (or .5x when zooming down).  Scale this based on how far we have to
        // zoom, so zoom bounce decelerates similarly to position bounce.  Clamp the ratio we'll
        // apply based on the duration of this frame.
        let zoom_ratio_per_second = Math.pow(ratio, 10);
        let max_ratio_this_frame = Math.pow(zoom_ratio_per_second, duration);
        ratio = Math.min(ratio, max_ratio_this_frame);

        if(inverted)
            ratio = 1/ratio;

        // Zoom centered on the position bounds, which is normally the center of the image.
        this.options.adjust_zoom({ratio, centerX, centerY});

        return true;
    }
    // If we're out of bounds, push the position towards being in bounds.  Return true if
    // we were out of bounds.
    apply_position_bounce(duration, position)
    {
        let bounds = this.options.get_bounds();

        let factor = 0.025;

        // Bounce right:
        if(position.x < bounds.left)
        {
            let bounce_velocity = bounds.left - position.x;
            bounce_velocity *= factor;
            position.x += bounce_velocity * duration * 300;

            if(position.x >= bounds.left - 1)
                position.x = bounds.left;
        }

        // Bounce left:
        if(position.x > bounds.right)
        {
            let bounce_velocity = bounds.right - position.x;
            bounce_velocity *= factor;
            position.x += bounce_velocity * duration * 300;

            if(position.x <= bounds.right + 1)
                position.x = bounds.right;
        }

        // Bounce down:
        if(position.y < bounds.top)
        {
            let bounce_velocity = bounds.top - position.y;
            bounce_velocity *= factor;
            position.y += bounce_velocity * duration * 300;

            if(position.y >= bounds.top - 1)
                position.y = bounds.top;
        }

        // Bounce up:
        if(position.y > bounds.bottom)
        {
            let bounce_velocity = bounds.bottom - position.y;
            bounce_velocity *= factor;
            position.y += bounce_velocity * duration * 300;

            if(position.y <= bounds.bottom + 1)
                position.y = bounds.bottom;
        }

        this.options.set_position(position);

        // Return true if we're still out of bounds.
        return position.x < bounds.left ||
               position.y < bounds.top ||
               position.x > bounds.right ||
               position.y > bounds.bottom;
    }
}

// A simpler interface for allowing a widget to be dragged open or closed.
ppixiv.WidgetDragger = class
{
    constructor({
        name="widget-dragger", // for diagnostics

        // The node that will be animated by the drag.
        node,

        // An animation for each node.  If this is a function, it will be called each time a
        // drag starts.
        //
        // If this is null, a default empty animation is used, and only animated_property will
        // be animated.
        animations=null,

        // The node to listen for drags on:
        drag_node,

        // The drag distance the drag that corresponds to a full transition from closed to
        // open.  This can be a number, or a function that returns a number.
        size,

        animated_property=null,
        animated_property_inverted=false,

        // If set, this is an array of nodes inside the dragger, and clicks outside of this
        // list while visible will cause the dragger to hide.
        close_if_outside=null,

        // This is called before a drag starts.  If false is returned, the drag will be ignored.
        confirm_drag = () => true,

        // Callbacks
        //
        // onactive
        //     ondragstart <-> ondragend                    User dragging started or stopped
        //     onanimationstart <-> onanimationfinished     Animation such as a fling started or stopped
        //     onbeforeshown <-> onafterhidden              Visibility changed
        // oninactive
        onactive = () => { },                  oninactive = () => { },
        ondragstart = () => { },               ondragend = () => { },
        onanimationstart = () => { },          onanimationfinished = () => { },
        onbeforeshown = () => { },             onafterhidden = () => { },
        
        // This is called if we were cancelled by another dragger starting first.
        oncancelled,

        // This is called on any state change (the value of this.state has changed).
        onstatechange = () => { },

        // Whether the widget is initially visible.
        visible=false,

        // The drag direction that will open the widget: up, down, left or right.
        direction="down",

        // Animation properties.  These are the same for all animated nodes.
        duration=150,

        start_offset=0,
        end_offset=1,

        // If set, return true to handle the drag or false to ignore it.
        onpointerdown = () => true,
        onpointerup = () => null,
    }={})
    {
        this._visible = visible;
        this.nodes = node;
        this.onactive = onactive;                      this.oninactive = oninactive;
        this.ondragstart = ondragstart;                this.ondragend = ondragend;
        this.onanimationstart = onanimationstart;      this.onanimationfinished = onanimationfinished;
        this.onbeforeshown = onbeforeshown;            this.onafterhidden = onafterhidden;
        this.onstatechange = onstatechange;
        this.confirm_drag = confirm_drag;
        this.animations = animations;
        this.animated_property = animated_property;
        this.animated_property_inverted = animated_property_inverted;
        this.close_if_outside = close_if_outside;
        this.duration = duration;
        this.start_offset = start_offset;
        this.end_offset = end_offset;
        this._state = "idle";

        if(!(this.duration instanceof Function))
            this.duration = () => duration;

        if(direction != "up" && direction != "down" && direction != "left" && direction != "right")
            throw new Error(`Invalid drag direction: ${direction}`);

        let vertical = direction == "up" || direction == "down";
        let reversed = direction == "left" || direction == "up";

        // Create the velocity tracker used to detect flings.
        this.recent_pointer_movement = new ppixiv.FlingVelocity({ sample_period: 0.150 });

        // Create the velocity tracker for the speed the animated property is changing.
        this.recent_value_movement = new ppixiv.FlingVelocity({ sample_period: 0.150 });

        let property_start = animated_property_inverted? 1:0;
        let property_end = animated_property_inverted? 0:1;

        // Create the animation.
        this.drag_animation = new ppixiv.PropertyAnimation({
            node: this.nodes,
            property: this.animated_property,
            property_start,
            property_end,

            start_offset: this.start_offset,
            end_offset: this.end_offset,
    
            onanimationfinished: (anim) => {
                // Update visibility if the animation we finished put us at 0.
                if(anim.position < 0.00001)
                    this._set_visible(false);

                // If a drag was left active during the animation, cancel it before returning to idle.
                this.dragger.cancel_drag();

                // When an animation finishes normally, we're no longer doing anything, so
                // go back to inactive.
                this._set_state("idle");
            },

            onchange: ({value, old_value}) => {
                if(old_value == null)
                    return;

                let delta = Math.abs(value - old_value);
                this.recent_value_movement.add_sample({ x: delta });
            },
        });

        this.drag_animation.position = visible? 1:0;

        this.dragger = new ppixiv.DragHandler({
            name,
            element: drag_node,
            onpointerdown,
            onpointerup,
            oncancelled,

            ondragstart: (args) => {
                // If this is a horizontal dragger, see if we should ignore this drag because
                // it might trigger iOS navigation.
                if(!vertical && helpers.should_ignore_horizontal_drag(args.event))
                    return false;
                
                if(!this.confirm_drag(args))
                    return false;

                // Stop any running animation.
                this.drag_animation.stop();

                this.recent_pointer_movement.reset();

                this._set_state("dragging");

                // A drag is starting.  Send onbeforeshown if we weren't visible, since we
                // might be about to make the widget visible.
                this._set_visible(true);

                // Remember the position we started at.  This is only used so we can return to it if
                // the drag is cancelled.
                this.drag_started_at = this.position;

                return true;
            },

            ondrag: ({event, first}) => {
                // If we're animating, show() or hide() was called during a drag.  This doesn't stop
                // the drag, but we're in the animating state while this happens.  Since we saw another
                // drag movement, cancel the animation and return to dragging.
                if(this._state == "animating")
                {
                    console.log("animation interrupted by drag");
                    this.drag_animation.stop();
                    this._set_state("dragging");
                }

                // Drags should always be in the dragging state, and won't change state.
                console.assert(this._state == "dragging", this._state);

                this.recent_pointer_movement.add_sample({ x: event.movementX, y: event.movementY });

                // The first movement is thresholded by the browser, and counts towards fling velocity
                // but doesn't actually move the widget.
                if(first)
                    return;

                // If show() or hide() was called during a fling and the user dragged again, we're interrupting
                // the animation to continue the drag, so stop the drag.
                this.drag_animation.stop();

                let pos = this.drag_animation.position;
                let movement = vertical? event.movementY:event.movementX;
                if(reversed)
                    movement *= -1;

                let actual_size = size;
                if(actual_size instanceof Function)
                    actual_size = actual_size();

                pos += movement / actual_size;
                pos = helpers.clamp(pos, this.start_offset, this.end_offset);
                this.drag_animation.position = pos;
            },

            // When a drag ends, we'll always call either show() or hide(), which will either start
            // an animation or put us in the inactive state.
            ondragend: ({cancel}) => {
                // If the drag was cancelled, return to the open or close state we were in at the
                // start.  This is mostly important for ScreenIllustDragToExit, so a drag up on iOS
                // that triggers system navigation and cancels our drag undoes any small drag instead
                // of triggering an exit.
                if(cancel)
                {
                    if(this.drag_started_at > 0.5)
                        this.show();
                    else
                        this.hide();
                    return;
                }

                // See if there was a fling.
                let { velocity } = this.recent_pointer_movement.get_movement_in_direction(direction);

                let threshold = 150;
                if(velocity > threshold)
                    return this.show({ velocity });
                else if(velocity < -threshold)
                    return this.hide({ velocity: -velocity });

                // If there hasn't been a fling recently, open or close based on how far open we are.
                let open = this.drag_animation.position > 0.5;
                if(open)
                    this.show({ velocity });
                else
                    this.hide({ velocity: -velocity });
            },
        });
    }

    // Return the dragger state: "idle", "dragging" or "animating".  This can also be
    // "active" while we're transitioning between states.
    get state() { return this._state; }

    get visible()
    {
        return this._visible;
    }

    get position()
    {
        return this.drag_animation.position;
    }

    _set_visible(value)
    {
        if(this._visible == value)
            return;

        this._visible = value;
        if(this._visible)
            this.onbeforeshown();
        else
            this.onafterhidden();

        if(this.close_if_outside)
        {
            // Create or destroy the click_outside_listener.
            if(this._visible && this.clicked_outside_ui_listener == null)
            {
                this.clicked_outside_ui_listener = new click_outside_listener(this.close_if_outside, () => this.hide());
            }
            else if(!this._visible && this.clicked_outside_ui_listener != null)
            {
                this.clicked_outside_ui_listener.shutdown();
                this.clicked_outside_ui_listener = null;
            }
        }
    }

    // Stop any animations, and jump to the given position.
    set_position_without_transition(position=0)
    {
        this.drag_animation.stop();
        this.drag_animation.position = position;

        this._set_state("idle");
    }
    
    // Animate to the fully shown state.  If given, velocity is the drag speed that caused this.
    //
    // If a drag is in progress, it'll continue, and cancel the animation if it moves again.  The
    // drag will be cancelled if the animation completes.
    show({ easing=null }={})
    {
        this._animate_to({end_position: 1, easing});
    }

    // Animate to the completely hidden state.  If given, velocity is the drag speed that caused this.
    hide({ easing=null }={})
    {
        this._animate_to({end_position: 0, easing});
    }

    _animate_to({ end_position, easing=null }={})
    {
        // Stop if we're already in this state.
        if(this._state == "idle" && this.drag_animation.position == end_position)
            return;
    
        // If we're already animating towards this position, just let it continue.
        if(this._state == "animating" && this.drag_animation.animating_towards == end_position)
            return;

        // If we're animating to a visible state, mark ourselves visible.
        if(end_position > 0)
            this._set_visible(true);

        let duration = this.duration();

        // If no easing was specified, create an easing curve to match the current velocity
        // of the animated property.
        if(easing == null)
        {
            let property_velocity = this.recent_value_movement.current_velocity.x;
            let property_start = this.drag_animation.current_property_value;
            let property_end = this.drag_animation.property_value_for_position(end_position);
            // console.log("->", property_start, property_end, property_velocity);

            easing = ppixiv.Bezier2D.find_curve_for_velocity({
                distance: Math.abs(property_end - property_start),
                duration: duration / 1000, // in seconds
                target_velocity: Math.abs(property_velocity),
                return_object: true,
            });
        }

        let promise = this._animation_promise = this.drag_animation.play({end_position, easing, duration});
        this._animation_promise.then(() => {
            if(promise == this._animation_promise)
                this._animation_promise = null;
        });

        // Call this after starting the animation, so animation_playing and animating_to_shown
        // reflect the animation when onanimationstart is called.
        this._set_state("animating");
    }

    // Set the current state: "idle", "dragging" or "animating", running the
    // appropriate callbacks.
    _set_state(state, ...args)
    {
        if(state == this._state)
            return;

        // Transition back to active, ending whichever state we were in before.
        if(state != "idle"      && this._change_state("idle", "active")) this.onactive(...args);
        if(state != "dragging"  && this._change_state("dragging", "active")) this.ondragend(...args);
        if(state != "animating" && this._change_state("animating", "active")) this.onanimationfinished(...args);

        // Transition into the new state, beginning the new state.
        if(state == "dragging"  && this._change_state("active", "dragging")) this.ondragstart(...args);
        if(state == "animating" && this._change_state("active", "animating")) this.onanimationstart(...args);
        if(state == "idle"      && this._change_state("active", "idle")) this.oninactive(...args);
    }

    _change_state(old_state, new_state)
    {
        if(this._state != old_state)
            return false;

        // console.warn(`state change: ${old_state} -> ${new_state}`);
        this._state = new_state;

        // Don't call onstatechange for active, since it's just a transition between
        // other states.
        if(new_state != "active")
            this.onstatechange();

        return true;
    }

    toggle()
    {
        if(this.visible)
            this.hide();
        else
            this.show();
    }

    // Return true if an animation (not a drag) is currently running.
    get animation_playing()
    {
        return this._state == "animating";
    }

    // Return true if the current animation is towards being shown (show() was called),
    // or false if the current animation is towards being hidden (hide() was called).
    // If no animation is running, return false.
    get animating_to_shown()
    {
        if(this._state != "animating")
            return false;

        return this.drag_animation.animating_towards == 1;
    }
    
    // Return a promise that resolves when the current animation completes, or null if no animation
    // is running.
    get finished()
    {
        return this._animation_promise;
    }


    shutdown()
    {
        this.drag_animation.shutdown();
    }
}

class Quadratic
{
    constructor(X1, X2, X3, X4)
    {
        this.D = X1;
        this.C = 3.0 * (X2 - X1);
        this.B = 3.0 * (X3 - X2) - this.C;
        this.A = X4 - X1 - this.C - this.B;
    }

    evaluate(t)
    {
        // optimized (A * t*t*t) + (B * t*t) + (C * t) + D
        return ((this.A*t + this.B)*t + this.C)*t + this.D;
    }
}

// A simple bezier curve implementation matching cubic-bezier.
ppixiv.Bezier2D = class
{
    // Return a standard curve by name.
    static curve(name)
    {
        if(this._curves == null)
        {
            // Standard curves:
            this._curves = {
                "ease": new ppixiv.Bezier2D(0.25, 0.1, 0.25, 1.0),
                "linear": new ppixiv.Bezier2D(0.0, 0.0, 1.0, 1.0),
                "ease-in": new ppixiv.Bezier2D(0.42, 0, 1.0, 1.0),
                "ease-out": new ppixiv.Bezier2D(0, 0, 0.58, 1.0),
                "ease-in-out": new ppixiv.Bezier2D(0.42, 0, 0.58, 1.0),
            }
        }

        return this._curves[name];
    }

    constructor(a, b, c, d)
    {
        this.X = new Quadratic(0, a, c, 1);
        this.Y = new Quadratic(0, b, d, 1);
    }

    GetXSlope(t)
    {
        return 3*this.X.A*t*t + 2*this.X.B*t + this.X.C;
    }

    evaluate(x)
    {
        // The range to search:
        let x_start = this.X.D;
        let x_end = this.X.A + this.X.B + this.X.C + this.X.D;

        // Search for the curve position of x on the X curve.
        let t = helpers.scale(x, x_start, x_end, 0, 1);
        for(let i = 0; i < 100; ++i)
        {
            let guess = this.X.evaluate(t);
            let error = x-guess;
            if(Math.abs(error) < 0.0001)
                break;

            // Improve our guess based on the curve slope.
            let slope = this.GetXSlope(t);
            t += error / slope;
        }

        return this.Y.evaluate(t);
    }

    // Find a bezier curve that roughly matches a given velocity.
    //
    // This is used when we're responding to a fling with an animation, and we want the
    // animation (usually a page turn) to have the same velocity as the fling.  The end
    // of the curve is always an ease-out, and the beginning of the curve will ease depending
    // on the velocity.
    //
    // Returns a bezier-curve() string.
    static find_curve_for_velocity({
        // The desired velocity (usually in pixels/sec):
        target_velocity,

        // The distance the animation will be travelling (usually in pixels):
        distance,

        // The duration the animation will be, in milliseconds:
        duration,

        // If true, return a ppixiv.Bezier2D.  Otherwise, return a cubic-bezier string.
        return_object=false,
    }={})
    {
        // Do a simple search ac
        let best_error = null;
        let best_t = 0;
        for(let t = 0; t < 0.5; t += 0.05)
        {
            // We're searching from (0, 0.5, 0.5, 1), which eases in slowly: // https://cubic-bezier.com/#0,.5,.5,1
            // to (0.5, 0.5, 0.5, 1), which starts immediately: // https://cubic-bezier.com/#.5,0,.5,1
            //
            // This can be tweaked, but we don't want to start much slower than this, since it doesn't
            // make the curve appear to start slower, it just makes it appear to pause completely for
            // a while.
            let curve = new ppixiv.Bezier2D(t, 0.5-t, 0.5, 1);

            // Roughly estimate the velocity at the start of the curve by seeing how far we'd travel in the
            // first 60Hz frame.
            let sample_seconds = 1/60; // one "frame"
            let segment_distance = distance * curve.evaluate(sample_seconds / duration); // distance travelled in sample_seconds
            let actual_distance_per_second = segment_distance / sample_seconds; // distance travelled in one second at that speed

            let error = Math.abs(actual_distance_per_second - target_velocity);
            // console.log(`${actual_distance_per_second.toFixed(0)} from ${target_velocity.toFixed(0)}`);
            if(best_error == null || error < best_error)
            {
                best_error = error;
                best_t = t;
            }

            // console.log(`t ${t} segment ${segment} segment_distance ${segment_distance} actual_distance_per_second ${actual_distance_per_second}`);
        }

        if(return_object)
            return new ppixiv.Bezier2D(best_t, 0.5 - best_t, 0.45, 1.0);
        else
            return `cubic-bezier(${best_t}, ${0.5-best_t}, 0.45, 1)`;
    }
}

// Animate a single property on a node.
//
// This allows setting a property (usually a CSS --var), and animating it towards a given
// value.
//
// This doesn't use Animation.  They still don't work with CSS vars, and Animation has too
// many quirks to bother with for this.
ppixiv.PropertyAnimation = class
{
    constructor({
        // The node containing the property to animate.  This can be an array of multiple nodes,
        // which will all be set.
        node,
        property,

        // The position of the animation is always 0-1.  The property value is scaled to
        // this range:
        property_start=0,
        property_end=1,

        // If play() is called, this is called after the animation completes.
        onanimationfinished,

        // This is called when this.position changes, including during animations.
        onchange=() => { },
    }={})
    {
        if(!(node instanceof Array))
            node = [node];
        this.node = node;
        this.onanimationfinished = onanimationfinished;
        this.onchange = onchange;
        this.state = "stopped";
        this.property = property;
        this.property_start = property_start;
        this.property_end = property_end;
    }

    shutdown()
    {
        this.stop();
    }

    // When not animating, return the current offset.
    //
    // If an animation is running, this will return the static offset, ignoring the animation.
    get position()
    {
        // static_animation is scaled to 0-1.  Scale it back to the caller's range.
        return this._position;
    }

    // Set the current position.  If this is called while animating, the animation will be
    // stopped.
    set position(offset)
    {
        // We don't currently set the position while animating, so flag it as a bug for now.
        if(this.playing)
            throw new Error("Animation is running");

        this._set_position(offset);
    }

    _set_position(position)
    {
        let old_position = this._position;
        let old_value = this._property_value;
        this._position = position;

        let value = this._property_value = this.property_value_for_position(position);
        for(let node of this.node)
            node.style.setProperty(this.property, value);

        // Call onchange with the old and new values.  Note that old_value and old_position
        // are null on the first call.
        this.onchange({position, value, old_position, old_value});
    }

    // Return the value of the output property for the given 0-1 position.
    property_value_for_position(position)
    {
        return helpers.scale(position, 0, 1, this.property_start, this.property_end);
    }

    // Return the current value of the property.
    get current_property_value()
    {
        return this.property_value_for_position(this._position);
    }

    // Return true if an animation is active.
    get playing()
    {
        return this._playToken != null;
    }

    // Play the animation from the current position to end_position, replacing any running animation.
    async play({end_position=1, easing="ease-in-out", duration=300}={})
    {
        // This is just for convenience, so the caller can tell which way an animation is going.
        this.animating_towards = end_position;

        // Create a new token.  If another play() call takes over the animation or we're stopped, this
        // will change and we'll stop animating.
        let token = this._playToken = new Object();

        // Get the easing curve.
        let curve = easing instanceof ppixiv.Bezier2D? easing:ppixiv.Bezier2D.curve(easing);
        if(curve == null)
            throw new Error(`Unknown easing curve: ${easing}`);

        let start_position = this._position;
        let start_time = Date.now();
        while(1)
        {
            await helpers.vsync();

            // Stop if the animation state changed while we were async.
            if(token !== this._playToken)
                return;

            // The position through this animation, from 0 to 1:
            let offset = (Date.now() - start_time) / duration;
            offset = helpers.clamp(offset, 0, 1);

            // Apply easing.
            let offset_with_easing = curve.evaluate(offset);

            // Update the animation.
            let new_position = helpers.scale(offset_with_easing, 0, 1, start_position, end_position);
            this._set_position(new_position);

            if(offset == 1)
                break;
        }

        this.animating_towards = null;
        this._playToken = null;
        this.onanimationfinished(this);
    }

    // Stop the animation if it's running.
    stop()
    {
        // Clearing _playToken will stop any running play() loop.
        this._playToken = null;
    }
}

// Double-tap handling for screen_illust on mobile.
//
// This needs to get along gracefully with the image viewer's TouchScroller.  A touch and
// drag prevents a click event, but we do want to allow a single click to both drag and
// count towards a double-tap.  If your finger moves slightly while double-tapping it
// can start a drag, which we do want to happen, and that shouldn't prevent it from
// being part of a double-tap.
ppixiv.MobileDoubleTapHandler = class
{
    constructor({
        container,
        ondbltap,
        threshold_ms=250,
        signal=null,
    })
    {
        this.container = container;
        this.ondbltap = ondbltap;
        this.threshold_ms = threshold_ms;

        this.pointerdown_timestamp = -9999;
        this.pointerdown_position = { x: 0, y: 0 };
        this.watching_pointer_id = null;

        if(ppixiv.ios)
        {
            // iOS Safari has a bizarre bug: pointerdown events that also cause a dblclick
            // event sometimes don't trigger.  This only happens in iOS 16, only when running
            // as a PWA (not when in the browser), and only happens on about 50% of launches.
            // We have to use dblclick to get double-clicks.
            this.container.addEventListener("dblclick", (e) => {
                ondbltap(e);
            }, { signal });

            // Another bizarre bug: we also don't get these dblclick events unless at least
            // one dblclick listener exists on the document.  (This workaround doesn't help
            // pointer events.)  This doesn't make sense, since the existance of an event listener
            // that doesn't do anything is supposed to be undetectable.  Add one of these the first
            // time we're used, and don't use the AbortSignal since we don't want it to be removed.
            if(!ppixiv.MobileDoubleTapHandler.added_dblclick_workaround)
            {
                ppixiv.MobileDoubleTapHandler.added_dblclick_workaround = true;
                document.addEventListener("dblclick", (e) => { });
            }

            return;
        }

        this.container.addEventListener("pointerdown", this.pointerevent, { signal });
        window.addEventListener("pointerup", this.pointerevent, { signal });
        window.addEventListener("pointercancel", this.pointerevent, { signal });
    }

    pointerevent = (e) =>
    {
        // Ignore other presses while we're already watching one.
        if(this.watching_pointer_id != null && e.pointerId != this.watching_pointer_id)
            return;

        if(e.type == "pointerup" || e.type == "pointercancel")
        {
            this.watching_pointer_id = null;
            return;
        }

        this.watching_pointer_id = e.pointerId;

        let time_since_click = e.timeStamp - this.pointerdown_timestamp;
        let position = { x: e.screenX, y: e.screenY };
        let distance = helpers.distance(position, this.pointerdown_position);
        this.pointerdown_timestamp = e.timeStamp;
        this.pointerdown_position = position;

        // Check the double-click time and distance thresholds.
        if(time_since_click > this.threshold_ms)
            return;

        if(distance > 25*window.devicePixelRatio)
            return;

        this.pointerdown_timestamp = -9999;

        this.ondbltap(e);
    }
};

// Detect isolated taps: single taps that don't become double-taps or drags, or
// are handled by something else.  This is a common mobile UI, but there's no
// event for it.
//
// We watch for taps where we see the release and no other events for our duration.
// This means the press is released quickly (not a long press or one where the user
// hesitated intenting to drag), there wasn't another press to make it a double-tap,
// and where none of the events are handled by anything else.
//
// We have to make assumptions about how long the double-click delay is.  If we
// guess too short we'll signal when a double-click could actually still happen,
// and if we guess too long we'll be less responsive.  The delay should be adjusted
// depending on how much of a problem false positives are.  For displaying the
// illust menu this can be a bit lower, since it'll just display the menu which will
// be immediately hidden by the second tap.
//
// This doesn't currently detect if the tap was on something that had a default
// action, like a link, since we only use this for taps on the image view.
ppixiv.IsolatedTapHandler = class
{
    static handlers = new Set();

    // If any running IsolatedTapHandler saw a pointerdown and is about to run,
    // cancel it.  This can be used to prevent isolated taps in places where it's
    // hard to access a pointer event related to it.
    static prevent_taps()
    {
        for(let handler of ppixiv.IsolatedTapHandler.handlers)
        {
            handler._clear_presses();
        }
    }

    constructor({ node, callback, delay=350, signal=null }={})
    {
        signal ??= (new AbortController()).signal;
        this.signal = signal;

        this.node = node;
        this.callback = callback;
        this.last_pointer_down_at = -99999;
        this.delay = delay;
        this._timeout_id = -1;
        this._pressed = false;
        this._all_presses = new Set();

        ppixiv.IsolatedTapHandler.handlers.add(this);
        this.signal.addEventListener("abort", () => ppixiv.IsolatedTapHandler.handlers.delete(this));

        this._event_names_during_touch = ["pointerup", "pointercancel", "pointermove", "blur", "dblclick"];
        this.node.addEventListener("pointerdown", this._handle_event, { signal });
    }

    // Start listening to events that we only listen to during a press, since these have to go
    // on window.
    _register_events()
    {
        for(let type of this._event_names_during_touch)
            window.addEventListener(type, this._handle_event, { capture: true, signal: this.signal });
    }

    _unregister_events()
    {
        for(let type of this._event_names_during_touch)
            this.node.removeEventListener(type, this._handle_event, { capture: true });
    }

    _handle_event = (e) =>
    {
        if(e.type == "blur")
        {
            // iOS sometimes doesn't cancel events properly on gestures, so discard any press on
            // blur and clear our press list.
            this._clear_presses();
            return;
        }

        // Keep track of pointer events, since they forgot to include it on pointer events.
        // We won't know if there are multitouch events on other nodes.
        if(e.type == "pointerdown")
            this._all_presses.add(e.pointerId);
        else if(e.type == "pointerup" || e.type == "pointercancel")
            this._all_presses.delete(e.pointerId);

        // If we see pointer events for a different pointer, unqueue our event.
        if(this._pressed && e.pointerId != this._press_event.pointerId)
        {
            // console.log("Cancelling for multitouch");
            this._unqueue_event();
            return;
        }

        // Cancel if we see a dblclick.  This is important because iOS doesn't always send pointer
        // events for double-taps.
        if(e.type == "dblclick")
        {
            // console.log("Cancelling for dblclick");
            this._unqueue_event();
        }

        if(e.type == "pointercancel")
        {
            this._clear_presses();
            return;
        }

        if(e.type == "pointerdown")
        {
            // If this isn't the first touch on the element, ignore it.
            if(this._all_presses.size > 1)
            {
                // console.log("Ignoring press during multitouch");
                return;
            }

            // Start watching the other events.
            this._register_events();

            this._unqueue_event();

            let now = Date.now();
            let time_since_last_press = now - this.last_pointer_down_at;
            this.last_pointer_down_at = Date.now();
            if(time_since_last_press < this.delay)
            {
                // If we get a pointerdown quickly after another, this is just cancelling any queued
                // event that we started, since this means it isn't an isolated tap.
                // console.log("Cancelled");
                return;
            }

            // If this is a pointerdown and we haven't seen another pointerdown in at least
            // our delay, start a new potential press.
            // console.log("Starting pointer monitoring");
            this._check_events = [];
            this._pressed = true;
            
            // Keep the initial press event so we can pass it to the callback.
            this._press_event = e;

            this._queue_event();
        }

        // Any pointer movement cancels the tap.  Mobile browsers already threshold pointer movement,
        // so we don't need to do it.
        if(e.type == "pointermove")
        {
            this._unqueue_event();
            return;
        }

        if(e.type == "pointerup")
        {
            this._unregister_events();
            this._pressed = false;
        }

        // We need to know if any of these events are handled, even if they're in event handlers
        // that trigger after us.  Just keep a list of all of them and we'll check them when the
        // timer expires.
        this._check_events.push(e);
    }

    _clear_presses()
    {
        this._unqueue_event();
        this._all_presses.clear();
        this._pressed = false;
    }

    _queue_event = () =>
    {
        if(this._timeout_id != -1)
            return;

        this._timeout_id = helpers.setTimeout(() => {
            if(this.signal.aborted)
                return;

            this._timeout_id = -1;

            // If the press is still held, this isn't an isolated press.
            if(this._pressed)
            {
                // console.log("Held too long");
                return;
            }

            // If any pointer event for this press was cancelled, that means something handled
            // something about the press, so don't use it.
            for(let event of this._check_events)
            {
                if(event.defaultPrevented || event.cancelBubble)
                {
                    // console.log("Press was handled:", event);
                    return;
                }

                // If partially_handled is set, it means something was done with the event
                // that didn't want to cancel the event, but does want to prevent us from
                // treating it as an isolated tap.  For example, if click_outside_listener
                // triggers to close the viewer menu it won't prevent the event, but we don't
                // want it to be an isolated tap.
                if(event.partially_handled)
                {
                    // console.log("Press handled by click_outside_listener");
                    return;
                }
            }

            this.callback(this._press_event);
        }, this.delay);
    }

    _unqueue_event = () =>
    {
        if(this._timeout_id == -1)
            return;
        helpers.clearTimeout(this._timeout_id);
        this._timeout_id= -1;
    }
};

// DirectAnimation is an Animation where we manually run its clock instead of letting it
// happen async.
//
// This works around some problems with Chrome's implementation:
//
// - It always runs at the maximum possible refresh rate.  My main display is 280Hz freesync,
// which is nice for scrolling and mouse cursors and games, but it's a waste of resources to
// pan an image around at that speed.  Chrome doesn't give any way to control this.
// - It runs all windows at the maximum refresh rate of any attached monitor.  My secondary
// monitors are regular 60Hz, but Chrome runs animations on them at 280Hz too.  (This is a
// strange bug: the entire point of requestAnimationFrame is to sync to vsync, not to just
// wait for however long the browser thinks a frame is.)
// - Running animations at this framerate causes other problems, like hitches in thumbnail
// animations and videos in unrelated windows freezing.  (Is Chrome still only tested with
// 60Hz monitors?)
//
// Running the animation directly lets us control the framerate we actually update at.
//
// It also works around problems with iOS's implementation: pausing animations causes the
// playback time to jump backwards, instead of synchronizing with the async timer.  This
// causes DragImageChanger to jump around when drags are interrupted.
// 
// Running the animation directly is OK for us since the animation is usually the only thing
// going on, and we're not trying to use this to drive a bunch of random animations.  
//
// This only implements what we need to run slideshow animations and doesn't attempt to be a
// general drop-in replacement for Animation.  It'll cause JS to be run periodically instead of
// letting everything happen in the compositor, but that's much better than updating multiple
// windows at several times their actual framerate.
ppixiv.DirectAnimation = class
{
    constructor(effect, {
        // If false, framerate limiting is disabled.
        limit_framerate=true,
    }={})
    {
        this.limit_framerate = limit_framerate;

        // We should be able to just subclass Animation, and this works in Chrome, but iOS Safari
        // is broken and doesn't call overridden functions.
        this.animation = new Animation(effect);
        this._update_playstate("idle");
    }

    get effect() { return this.animation.effect; }

    _update_playstate(state)
    {
        if(state == this._playState)
            return;

        // If we're exiting finished, create a new finished promise.
        if(this.finished == null || this._playState == "finished")
        {
            this.finished = helpers.make_promise();

            // Catch this promise by default, so errors aren't logged to the console every time
            // an animation is cancelled.
            this.finished.catch((f) => true);
        }

        this._playState = state;
    }

    play()
    {
        if(this._playState == "running")
            return;

        this._update_playstate("running");
        this._playToken = new Object();
        this._runner = this._run_animation();
    }

    pause()
    {
        if(this._playState == "paused")
            return;

        this._update_playstate("paused");
        this._playToken = null;
        this._runner = null;
    }

    cancel()
    {
        this.pause();
        this.animation.cancel();
    }

    updatePlaybackRate(rate)
    {
        return this.animation.updatePlaybackRate(rate);
    }

    commitStyles()
    {
        this.animation.commitStyles();
    }

    commitStylesIfPossible()
    {
        try {
            this.commitStyles();
            return true;
        } catch(e) {
            console.error(e);
            return false;
        }        
    }

    get playState()
    {
        return this._playState;
    }

    get currentTime() { return this.animation.currentTime; }

    async _run_animation()
    {
        this.animation.currentTime = this.animation.currentTime;

        let token = this._playToken;
        let last_update = Date.now();

        // If no time has been set yet, the animation hasn't applied any styles.  Set the default
        // start time before going async, so we don't flash whatever the previous style was for a
        // frame before updating.
        if(this.animation.currentTime == null)
            this.animation.currentTime = 0;

        while(1)
        {
            let delta;
            while(1)
            {
                await helpers.vsync();

                // Stop if the animation state changed while we were async.
                if(token !== this._playToken)
                {
                    this.finished.reject(new DOMException("The animation was aborted", "AbortError"));
                    return;
                }

                let now = Date.now();
                delta = now - last_update;

                // If we're running faster than we want, wait another frame, giving a small error margin.
                // If targetFramerate is null, just run every frame.
                //
                // This is a workaround for Chrome.  Don't do this on mobile, since there's much more
                // rendering time jitter on mobile and this causes skips.
                if(this.limit_framerate && !ppixiv.mobile)
                {
                    let target_framerate = settings.get("slideshow_framerate");
                    if(target_framerate != null)
                    {
                        let target_delay = 1000/target_framerate;
                        if(delta*1.05 < target_delay)
                            continue;
                    }
                }
                
                last_update = now;
                break;
            }

            delta *= this.animation.playbackRate;

            let new_current_time = this.animation.currentTime + delta;

            // Clamp the time to the end (this may be infinity).
            let timing = this.animation.effect.getComputedTiming();
            let max_time = timing.duration*timing.iterations;
            let finished = new_current_time >= max_time;
            if(finished)
                new_current_time = max_time;

            // Update the animation.
            this.animation.currentTime = new_current_time;

            // If we reached the end, run onfinish and stop.  This will never happen if max_time
            // is infinity.
            if(finished)
            {
                this._update_playstate("finished");
                this.finished.accept();
                if(this.onfinish)
                    this.onfinish();
                break;
            }
        }
    }
}
