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

    create_style: function(css)
    {
        var style = document.realCreateElement("style");
        style.type = "text/css";
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

        let template = document.createElement("template");
        template.innerHTML = html;
        let node = helpers.create_from_template(template);

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
        setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
            a.parentNode.removeChild(a);
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
                clearTimeout(timeout);
                reject("aborted");
            };
    
            if(signal != null)
                signal.addEventListener("abort", abort, { once: true });

            timeout = setTimeout(() => {
                if(signal)
                    signal.removeEventListener("abort", abort, { once: true });
                accept();
            }, ms);
        });
    },

    // setTimeout using an AbortSignal to remove the timer.
    timeout(callback, ms, signal)
    {
        if(signal && signal.aborted)
            return;

        let id = setTimeout(callback, ms);

        if(signal)
        {
            // Clear the interval when the signal is aborted.
            signal.addEventListener("abort", () => {
                clearTimeout(id);
            }, { once: true });
        }
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
    
            clearTimeout(this.id);
            this.id = null;
        }
    
        set(ms)
        {
            this.clear();
            this.id = setTimeout(this.run_func, ms);
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

    // Try to stop the underlying page from doing things (it just creates unnecessary network
    // requests and spams errors to the console), and undo damage to the environment that it
    // might have done before we were able to start.
    cleanup_environment: function()
    {
        if(ppixiv.native)
        {
            // We're running in a local environment and not on Pixiv, so we don't need to do
            // this stuff.  Just add stubs for the functions we'd set up here.
            helpers.fetch = unsafeWindow.fetch;
            window.HTMLDocument.prototype.realCreateElement = window.HTMLDocument.prototype.createElement;
            window.cloneInto = (data, window) =>
            {
                return data;
            }
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
            unwrap_func(unsafeWindow, "fetch");
            unwrap_func(unsafeWindow, "setTimeout");
            unwrap_func(unsafeWindow, "setInterval");
            unwrap_func(unsafeWindow, "clearInterval");
            unwrap_func(EventTarget.prototype, "addEventListener");
            unwrap_func(EventTarget.prototype, "removeEventListener");
            unwrap_func(XMLHttpRequest.prototype, "send");

            // We might get here before the mangling happens, which means it might happen
            // in the future.  Freeze the objects to prevent this.
            Object.freeze(EventTarget.prototype);

            // Delete wrappers on window.history set by the site, and freeze it so they can't
            // be added.
            delete_overrides(unsafeWindow.history);
            delete_overrides(unsafeWindow.document);

            // Remove Pixiv's wrappers from console.log, etc., and then apply our own to console.error
            // to silence its error spam.  This will cause all error messages out of console.error
            // to come from this line, which is usually terrible, but our logs come from window.console
            // and not unsafeWindow.console, so this doesn't affect us.
            for(let name of Object.keys(window.console))
                unwrap_func(console, name, { ignore_missing: true });
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
        ppixiv.clearInterval = unsafeWindow.clearInterval.bind(unsafeWindow);

        // Disable the page's timers.  This helps prevent things like GTM from running.
        unsafeWindow.setTimeout = (f, ms) => { return -1; };
        unsafeWindow.setInterval = (f, ms) => { return -1; };
        unsafeWindow.clearTimeout = () => { };

        try {
            window.addEventListener = Window.prototype.addEventListener.bind(unsafeWindow);
            window.removeEventListener = Window.prototype.removeEventListener.bind(unsafeWindow);
        } catch(e) {
            // This fails on iOS.  That's OK, since Pixiv's mobile site doesn't mess
            // with these (and since we can't write to these, it wouldn't be able to either).
        }

        // We have to use unsafeWindow.fetch in Firefox, since window.fetch is from a different
        // context and won't send requests with the site's origin, which breaks everything.  In
        // Chrome it doesn't matter.
        helpers.fetch = unsafeWindow.fetch.bind(unsafeWindow);
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

        // For Firefox, we need to clone data into the page context.  In Chrome this do nothing.
        if(window.cloneInto)
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

        // Pixiv returns completely different data when it thinks you're on mobile, and uses a completely
        // different set of APIs.  Set a fake desktop referer to prevent this from happening.
        if(ppixiv.ios)
            options.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.67 Safari/537.36';

        let result = await helpers.send_request(options);
        if(result == null)
            return null;

        // Return the requested type.  If we don't know the type, just return the
        // request promise itself.
        if(options.responseType == "json")
        {
            let json = await result.json();

            // In Firefox we need to use unsafeWindow.fetch, since window.fetch won't run
            // as the page to get the correct referer.  Work around secondary brain damage:
            // since it comes from the page it's in a wrapper object that we need to remove.
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

    toggle_fullscreen()
    {
        if(!document.fullscreenElement)
            document.documentElement.requestFullscreen();
        else
            document.exitFullscreen();
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

    // Add tag to the recent search list, or move it to the front.
    add_recent_search_tag(tag)
    {
        if(this._disable_adding_search_tags || !tag)
            return;

        var recent_tags = settings.get("recent-tag-searches") || [];
        var idx = recent_tags.indexOf(tag);
        if(idx != -1)
            recent_tags.splice(idx, 1);
        recent_tags.unshift(tag);

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
        if(ppixiv.native)
            return;

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
            return { path: "", query: new unsafeWindow.URLSearchParams() };

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

        // Use unsafeWindow.URLSearchParams to work around https://bugzilla.mozilla.org/show_bug.cgi?id=1414602.
        if(query == null)
            return { path: hash_path, query: new unsafeWindow.URLSearchParams() };
        else
            return { path: hash_path, query: new unsafeWindow.URLSearchParams(query) };
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

    args: class
    {
        constructor(url)
        {
            url = new URL(url, ppixiv.location);

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
        // segment 0.  If idx is past the end, return "".
        get_pathname_segment(idx)
        {
            // The first pathname segment is always empty, since the path always starts with a slash.
            idx++;
            let parts = this.path.split("/");
            let result = parts[idx];
            return result || "";
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

    // Set document.href, either adding or replacing the current history state.
    //
    // window.onpopstate will be synthesized if the URL is changing.
    //
    // If cause is set, it'll be included in the popstate event as navigationCause.
    // This can be used in event listeners to determine what caused a navigation.
    // For browser forwards/back, this won't be present.
    //
    // args can be a helpers.args object, or a URL object.
    set_page_url(args, add_to_history, cause, { send_popstate=true }={})
    {
        if(args instanceof URL)
            args = new helpers.args(args);

        var old_url = ppixiv.location.toString();

        // Use the history state from args if it exists.
        let history_data = {
            ...args.state,
        };

        // If the state wouldn't change at all, don't set it, so we don't add junk to
        // history if the same link is clicked repeatedly.  Comparing state via JSON
        // is OK here since JS will maintain key order.  
        if(args.url.toString() == old_url && JSON.stringify(history_data) == JSON.stringify(history.state))
            return;

        // history.state.index is incremented whenever we navigate forwards, so we can
        // tell in onpopstate whether we're navigating forwards or backwards.
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

        if(send_popstate && ppixiv.location.toString() != old_url)
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
    
    // Set node's maxHeight so it doesn't cross the bottom of the screen.
    set_max_height(node, { max_height=null, bottom_padding=0 }={})
    {
        let {top} = node.getBoundingClientRect(document.body);
        let height = window.innerHeight - top;

        // Add a bit of padding so it's not flush against the edge.
        height -= bottom_padding;
        
        if(max_height != null)
            height = Math.min(max_height, height);

        node.style.maxHeight = `${height}px`;
    },
    
    distance([x1,y1], [x2,y2])
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

    // Asynchronously wait for an animation frame.
    async vsync({signal=null}={})
    {
        return new Promise((accept, reject) => {
            // The timestamp passed to the requestAnimationFrame callback is designed
            // incorrectly.  It gives the time callbacks started being called, which is
            // meaningless.  It should give the time in the future the current frame is
            // expected to be displayed, which is what you get from things like Android's
            // choreographer to allow precise frame timing.
            let id = requestAnimationFrame((time) => {
                accept(time / 1000);
            });
    
            let abort = () => {
                cancelAnimationFrame(id);
                signal.removeEventListener("abort", abort);
                reject("aborted");
            };
    
            if(signal)
            {
                signal.addEventListener("abort", abort, { once: true });
            }
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
                    await helpers.vsync({signal: this.abort.signal});

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
            } catch(e) {
                // Swallow exceptions if shutdown() aborts us while we're waiting.
                if(e != "aborted")
                    throw e;
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
    make_thumbnail_sizing_style(container, options)
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

        return {columns: best_columns, padding, max_width, max_height, container_width};
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

    set_thumbnail_panning_direction(thumb, width, height, container_aspect_ratio)
    {
        let direction = helpers.get_thumbnail_panning_direction(thumb, width, height, container_aspect_ratio);
        helpers.set_class(thumb, "vertical-panning", direction == "vertical");
        helpers.set_class(thumb, "horizontal-panning", direction == "horizontal");
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

    parse_media_id(media_id)
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
        // be null or 0, and we don't include it in the media ID.
        if(type == "illust")
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
    get_path_suffix(path, count=2, remove_from_end=0)
    {
        let parts = path.split('/');
        parts = parts.splice(0, parts.length - remove_from_end);
        parts = parts.splice(parts.length-count); // take the last count parts
        return parts.join("/");
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
        return helpers.encodeURLPart(/[^A-Za-z0-9-_\.!~\*'()/:\[\]\^=&]/g, hash);
    },

    // This one escapes keys in hash parameters.  This is the same as encodeURLHash,
    // except it also encodes = and &.
    encodeHashParam(param)
    {
        return helpers.encodeURLPart(/[^A-Za-z0-9-_\.!~\*'()/:\[\]\^]/g, param);
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

    // Return the canonical URL for an illust.  For most URLs this is
    // /artworks/12345.
    get_url_for_id(media_id)
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
            args = new helpers.args("/", ppixiv.location);
            args.path  = `/artworks/${illust_id}`;
        }

        if(page != null && page > 1)
            args.query.set("page", page);

        return args;
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

    onviewhidden = (e) =>
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

    // Given a list of keys, return known translations.  Tags that we don't have data for are null.
    async multi_get(keys)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db, "readonly");

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
    // The global handler is used to track button presses and mouse movement globally,
    // primarily to implement pointer_listener.check().

    // The latest mouse position seen by install_global_handler.
    static latest_mouse_page_position = [window.innerWidth/2, window.innerHeight/2];
    static latest_mouse_screen_position = [window.innerWidth/2, window.innerHeight/2];
    static buttons = 0;
    static button_pointer_ids = new Map();
    static pointer_type = "mouse";
    static install_global_handler()
    {
        window.addEventListener("pointermove", (e) => {
            pointer_listener.latest_mouse_page_position = [e.pageX, e.pageY];
            pointer_listener.latest_mouse_screen_position = [e.clientX, e.clientY];
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
                    clearTimeout(this.block_contextmenu_timer);
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
        window.addEventListener("pointercancel", this.onpointerup, this.event_options);
    }

    unregister_events_while_pressed(enable)
    {
        if(!this.pointermove_registered)
            return;
        this.pointermove_registered = false;
        this.element.removeEventListener("pointermove", this.onpointermove, this.event_options);
        window.removeEventListener("pointerup", this.onpointerevent, this.event_options);
        window.removeEventListener("pointercancel", this.onpointerup, this.event_options);
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
            clearTimeout(this.block_contextmenu_timer);
            this.block_contextmenu_timer = null;
        }

        this.block_contextmenu_timer = setTimeout(() => {
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
        let node_under_cursor = document.elementFromPoint(pointer_listener.latest_mouse_screen_position[0], pointer_listener.latest_mouse_screen_position[1]);
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
        setTimeout(() => {
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
    add_info(image_info)
    {
        // Store one record per page.
        let pages = [];
        for(let page = 0; page < image_info.pageCount; ++page)
        {
            let illust_id = image_info.id;
            let media_id = helpers.illust_id_to_media_id(image_info.id, page);
            let url = image_info.mangaPages[page].urls.original;
            let parts = url.split(".");
            let ext = parts[parts.length-1];
    
            pages.push({
                illust_id_and_page: media_id,
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
        // If this is a local URL, we always have the image URL and we don't need to guess.
        let { type, page } = helpers.parse_media_id(media_id);
        console.assert(type != "folder");
        if(type == "file")
        {
            let thumb = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
            if(thumb?.illustType == "video")
                return null;
            else
                return thumb?.mangaPages[page]?.urls?.original;
        }
    
        // If we already have illust info, use it.
        let illust_info = image_data.singleton().get_media_info_sync(media_id);
        if(illust_info != null)
            return illust_info.mangaPages[page].urls.original;

        // If we've stored this URL, use it.
        let stored_url = await this.get_stored_record(media_id);
        if(stored_url != null)
            return stored_url;
        
        // Get thumbnail data.  We need the thumbnail URL to figure out the image URL.
        let thumb = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
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
    if(this._promise == null)
    {
        this._promise = new Promise((accept) => {
            this._promise_accept = accept;
        });

        this.addEventListener("abort", (e) => {
            console.log("done");
            this._promise_accept();
        }, { once: true });
    }
    return this._promise;
};
