// XXX
export class Args
{
    constructor(url)
    {
        if(url == null)
            throw ValueError("url must not be null");

        url = new URL(url, ppixiv.plocation);

        this.path = url.pathname;
        this.query = url.searchParams;
        let { path: hashPath, query: hash_query } = helpers.get_hash_args(url);
        this.hash = hash_query;
        this.hashPath = hashPath;

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
        // For example, if this.hashPath is "a/b/c" and this.hash is { a: "1", b: "2" },
        // set the hash to #ppixiv/a/b/c?a=1&b=2.
        url.hash = ppixiv.native? "#":"#ppixiv";
        if(this.hashPath != "")
        {
            if(!this.hashPath.startsWith("/"))
                url.hash += "/";
            url.hash += helpers.encodeURLHash(this.hashPath);
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
            return this.getPathnameSegment(parseInt(key));

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
    getPathnameSegment(idx)
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
}

export class helpers 
{
    // XXX: compat
    static args = Args;

    static blankImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    static xmlns = "http://www.w3.org/2000/svg";
    
    static remove_array_element(array, element)
    {
        let idx = array.indexOf(element);
        if(idx != -1)
            array.splice(idx, 1);
    }

    // Preload an array of images.
    static preloadImages(images)
    {
        // We don't need to add the element to the document for the images to load, which means
        // we don't need to do a bunch of extra work to figure out when we can remove them.
        let preload = document.createElement("div");
        for(let i = 0; i < images.length; ++i)
        {
            let img = document.createElement("img");
            img.src = images[i];
            preload.appendChild(img);
        }
    }

    static moveChildren(parent, new_parent)
    {
        for(let child = parent.firstChild; child; )
        {
            let next = child.nextSibling;
            new_parent.appendChild(child);
            child = next;
        }
    }
    
    static removeElements(parent)
    {
        while(parent.firstChild !== null)
            parent.firstChild.remove();
    }

    // Return true if ancestor is one of descendant's parents, or if descendant is ancestor.
    static isAbove(ancestor, descendant)
    {
        while(descendant != null && descendant != ancestor)
            descendant = descendant.parentNode;
        return descendant == ancestor;
    }

    static createStyle(css, { id }={})
    {
        let style = document.realCreateElement("style");
        style.type = "text/css";
        if(id)
            style.id = id;
        style.textContent = css;
        return style;
    }

    static get_icon_class_and_name(icon_name)
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
    }

    // Create a font icon.  icon_name is an icon set and name, eg. "mat:lightbulb"
    // for material icons or "ppixiv:icon" for our icon set.  If no icon set is
    // specified, material icons is used.
    static createIcon(icon_name, {
        asElement=false,
        classes=[],
        align=null,
        dataset={},
    }={})
    {
        let [icon_class, name] = this.get_icon_class_and_name(icon_name);

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

        if(asElement)
            return icon;
        else
            return icon.outerHTML;
    }

    static get_template(type)
    {
        let template = document.body.querySelector(type);
        if(template == null)
            throw "Missing template: " + type;

        // Replace any <ppixiv-inline> inlines on the template, and remember that
        // we've done this so we don't redo it every time the template is used.
        if(!template.dataset.replacedInlines)
        {
            template.dataset.replacedInlines = true;
            this.replaceInlines(template.content);
        }

        return template;
    }

    // If makeSVGUnique is false, skip making SVG IDs unique.  This is a small optimization
    // for creating thumbs, which don't need this.
    static createFromTemplate(type, {makeSVGUnique=true}={})
    {
        let template;
        if(typeof(type) == "string")
            template = this.get_template(type);
        else
            template = type;

        let node = document.importNode(template.content, true).firstElementChild;
        
        if(makeSVGUnique)
        {
            // Make all IDs in the template we just cloned unique.
            for(let svg of node.querySelectorAll("svg"))
                this.make_svg_ids_unique(svg);
        }
        
        return node;
    }

    // Find <ppixiv-inline> elements inside root, and replace them with elements
    // from resources:
    //
    // <ppixiv-inline src=image.svg></ppixiv-inline>
    //
    // Also replace <img src="ppixiv:name"> with resource text.  This is used for images.
    static _resource_cache = {};
    static replaceInlines(root)
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
            let node = this.createInlineIcon(src);
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
    }

    // Create a general-purpose box link.
    static createBoxLink({
        label,
        link=null,
        classes="",
        icon=null,
        popup=null,

        // If set, this is an extra explanation line underneath the label.
        explanation=null,

        // By default, return HTML as text, which is used to add these into templates, which
        // is the more common usage.  If asElement is true, an element will be returned instead.
        asElement=false,

        // Helpers for ScreenSearch:
        dataset={},
        dataType=null,
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
        let node = this.createFromTemplate(this._cached_box_link_template);

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
            let [icon_class, icon_name] = this.get_icon_class_and_name(icon);
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

        if(dataType != null)
            node.dataset.type = dataType;
        for(let [key, value] of Object.entries(dataset))
            node.dataset[key] = value;

        if(asElement)
            return node;
        else
            return node.outerHTML;
    }

    static createInlineIcon(src)
    {
        // Parse this element if we haven't done so yet.
        if(!this._resource_cache[src])
        {
            // Find the resource.
            let resource = ppixiv.resources[src];
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
            this._resource_cache[src] = node;
        }

        let node = this._resource_cache[src];
        return document.importNode(node, true);
    }

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
    static _svg_id_sequence = 0;
    static make_svg_ids_unique(svg)
    {
        let id_map = {};
        let idx = this._svg_id_sequence;

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

                let re = /url\(#.*?\)/;
                new_value = new_value.replace(re, (str) => {
                    let re = /url\(#(.*)\)/;
                    let old_id = str.match(re)[1];
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
        this._svg_id_sequence = idx;
    }

    // Prompt to save a blob to disk.  For some reason, the really basic FileSaver API disappeared from
    // the web.
    static saveBlob(blob, filename)
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
        realSetTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
            a.remove();
        }, 1000);
    }

    // Return a Uint8Array containing a blank (black) image with the given dimensions and type.
    static create_blank_image(image_type, width, height)
    {
        let canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        let context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);

        let blank_frame = canvas.toDataURL(image_type, 1);
        if(!blank_frame.startsWith("data:" + image_type))
            throw "This browser doesn't support encoding " + image_type;

        let binary = atob(blank_frame.slice(13 + image_type.length));

        // This is completely stupid.  Why is there no good way to go from a data URL to an ArrayBuffer?
        let array = new Uint8Array(binary.length);
        for(let i = 0; i < binary.length; ++i)
            array[i] = binary.charCodeAt(i);
        return array;
    }

    // Binary search between start and end looking for target.  get_value(position) returns the
    // value at that position.
    static binary_search(start, end, target, get_value, max_error=1)
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
    }

    static defer(func)
    {
        return Promise.resolve().then(() => {
            func();
        });
    }

    static sleep(ms, { signal=null }={})
    {
        return new Promise((accept, reject) => {
            let timeout = null;
            let abort = () => {
                realClearTimeout(timeout);
                reject("aborted");
            };
    
            if(signal != null)
                signal.addEventListener("abort", abort, { once: true });

            timeout = realSetTimeout(() => {
                if(signal)
                    signal.removeEventListener("abort", abort, { once: true });
                accept();
            }, ms);
        });
    }

    // Return a Promise with accept() and reject() available on the promise itself.
    //
    // This removes encapsulation, but is useful when using a promise like a one-shot
    // event where that isn't important.
    static makePromise()
    {
        let accept, reject;
        let promise = new Promise((a, r) => {
            accept = a;
            reject = r;
        });
        promise.accept = accept;
        promise.reject = reject;
        return promise;
    }

    // Like Promise.all, but takes a dictionary of {key: promise}, returning a
    // dictionary of {key: result}.
    static async awaitMap(map)
    {
        Promise.all(Object.values(map));

        let results = {};
        for(let [key, promise] of Object.entries(map))
            results[key] = await promise;
        return results;
    }

    // This is the same as Python's zip:
    //
    // for(let [a,b,c] of zip(array1, array2, array))
    static *zip(...args)
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
    }

    // setInterval using an AbortSignal to remove the interval.
    //
    // If call_immediately is true, call callback() now, rather than waiting
    // for the first interval.
    static interval(callback, ms, signal, call_immediately=true)
    {
        if(signal && signal.aborted)
            return;

        let id = realSetInterval(callback, ms);

        if(signal)
        {
            // Clear the interval when the signal is aborted.
            signal.addEventListener("abort", () => {
                realClearInterval(id);
            }, { once: true });
        }

        if(call_immediately)
            callback();
    }

    // Block until DOMContentLoaded.
    static waitForContentLoaded()
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
    }

    static wait_for_load(element)
    {
        return new Promise((accept, reject) => {
            element.addEventListener("load", () => {
                accept();
            }, { once: true });
        });
    }

    static addStyle(name, css)
    {
        let style = this.createStyle(css);
        style.id = name;
        document.querySelector("head").appendChild(style);
        return style;
    }

    // Create a node from HTML.
    static create_node(html)
    {
        let temp = document.createElement("div");
        temp.innerHTML = html;
        return temp.firstElementChild;
    }

    // Set or unset a class.
    static setClass(element, className, enable)
    {
        if(element.classList.contains(className) == enable)
            return;

        if(enable)
            element.classList.add(className);
        else
            element.classList.remove(className);
    }

    // dataset is another web API with nasty traps: if you assign false or null to
    // it, it assigns "false" or "null", which are true values.
    static setDataSet(dataset, name, value)
    {
        if(value)
            dataset[name] = value;
        else
            delete dataset[name];
    }

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
    static watchEdits(input, { signal }={})
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
    }
    
    // Set node's height as a CSS variable.
    //
    // If target is null, the variable is set on the node itself.
    static setHeightAsProperty(node, name, { target, signal }={})
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
    }

    // Force all external links to target=_blank.
    //
    // We do this on iOS to improve clicking links.  If we're running as a PWA on iOS, opening links will
    // cause the Safari UI to appear.  Setting target=_blank looks the same to the user, except it opens
    // it in a separate context, so closing the link will return to where we were.  If we don't do this,
    // the link will replace us instead, so we'll be restarted when the user returns.
    //
    // We currently only look at links when they're first added to the document and don't listen for
    // changes to href.
    static forceTargetBlank()
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
    }
    
    // Work around iOS Safari weirdness.  If a drag from the left or right edge of the
    // screen causes browser navigation, the underlying window position jumps, which
    // causes us to see pointer movement that didn't actually happen.  If this happens
    // during a drag, it causes the drag to move horizontally by roughly the screen
    // width.
    static shouldIgnoreHorizontalDrag(event)
    {
        // If there are no other history entries, we don't need to do this, since browser back
        // can't trigger.
        if(!ppixiv.ios || window.history.length <= 1)
            return false;

        // Ignore this event if it's close to the left or right edge of the screen.
        let width = 25;
        return event.clientX < width || event.clientX > window.innerWidth - width;
    }

    // Return the value of a list of CSS expressions.  For example:
    //
    // get_css_values({ value1: "calc(let(--value) * 2)" });
    static get_css_values(properties)
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
    }

    // Get the current safe area insets.
    static getSafeAreaInsets()
    {
        let { left, top, right, bottom } = this.get_css_values({
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
    }

    static date_to_string(date)
    {
        date = new Date(date);
        let day = date.toLocaleDateString();
        let time = date.toLocaleTimeString();
        return day + " " + time;
    }

    static age_to_string(seconds)
    {
        // If seconds is negative, return a time in the future.
        let future = seconds < 0;
        if(future)
            seconds = -seconds;

        function to_plural(label, places, value)
        {
            let factor = Math.pow(10, places);
            let plural_value = Math.round(value * factor);
            if(plural_value > 1)
                label += "s";
                
            let result = value.toFixed(places) + " " + label;
            result += future? " from now":" ago";
            return result;
        };
        if(seconds < 60)
            return to_plural("sec", 0, seconds);
        let minutes = seconds / 60;
        if(minutes < 60)
            return to_plural("min", 0, minutes);
        let hours = minutes / 60;
        if(hours < 24)
            return to_plural("hour", 0, hours);
        let days = hours / 24;
        if(days < 30)
            return to_plural("day", 0, days);
        let months = days / 30;
        if(months < 12)
            return to_plural("month", 0, months);
        let years = months / 12;
        return to_plural("year", 1, years);
    }

    static formatSeconds(total_seconds)
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
    }

    // Return i rounded up to interval.
    static round_up_to(i, interval)
    {
        return Math.floor((i+interval-1)/interval) * interval;
    }    

    static getExtension(fn)
    {
        let parts = fn.split(".");
        return parts[parts.length-1];
    }

    static saveScrollPosition(scroller, save_relative_to)
    {
        return {
            original_scroll_top: scroller.scrollTop,
            original_offset_top: save_relative_to.offsetTop,
        };
    }

    static restoreScrollPosition(scroller, restore_relative_to, saved_position)
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
    }
    
    static encode_query(data) {
        let str = [];
        for(let key in data)
        {
            if(!data.hasOwnProperty(key))
                continue;
            str.push(encodeURIComponent(key) + "=" + encodeURIComponent(data[key]));
        }    
        return str.join("&");
    }

    static async send_request(options)
    {
        if(options == null)
            options = {};

        // Usually we'll use helpers.fetch, but fall back on window.fetch in case we haven't
        // called block_network_requests yet.  This happens if App.setup needs to fetch the page.
        let fetch = window.realFetch ?? window.fetch;

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
    }

    // Send a request with the referer, cookie and CSRF token filled in.
    static async sendPixivRequest({...options})
    {
        options.headers ??= {};

        // Only set x-csrf-token for requests to www.pixiv.net.  It's only needed for API
        // calls (not things like ugoira ZIPs), and the request will fail if we're in XHR
        // mode and set headers, since it'll trigger CORS.
        let hostname = new URL(options.url, ppixiv.plocation).hostname;
        if(hostname == "www.pixiv.net" && ppixiv.pixivInfo)
        {
            options.headers["x-csrf-token"] = ppixiv.pixivInfo.csrfToken;
            options.headers["x-user-id"] = ppixiv.pixivInfo.user_id;
        }

        let result = await this.send_request(options);
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
    }

    // Why does Pixiv have 300 APIs?
    static async rpcPostRequest(url, data)
    {
        let result = await this.sendPixivRequest({
            "method": "POST",
            "url": url,

            "data": this.encode_query(data),
            "responseType": "json",

            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            },
        });

        return result;
    }

    static async rpcGetRequest(url, data, options)
    {
        if(options == null)
            options = {};

        let params = new URLSearchParams();
        for(let key in data)
            params.set(key, data[key]);
        let query = params.toString();
        if(query != "")
            url += "?" + query;
        
        let result = await this.sendPixivRequest({
            "method": "GET",
            "url": url,
            "responseType": "json",
            "signal": options.signal,

            "headers": {
                "Accept": "application/json",
            },
        });

        return result;
    }

    static async postRequest(url, data)
    {
        let result = await this.sendPixivRequest({
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

    static create_search_params(data)
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

    static async getRequest(url, data, options)
    {
        let params = this.create_search_params(data);

        let query = params.toString();
        if(query != "")
            url += "?" + query;

        let result = await this.sendPixivRequest({
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

    _download_port = null;

    // GM.xmlHttpRequest is handled by the sandboxed side of the user script, which lives in
    // bootstrap.js.  Request a MessagePort which can be used to request GM.xmlHttpRequest
    // downloads.
    static _get_xhr_server()
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
                this._download_port = e.ports[0];
                accept(e.ports[0]);
            };

            window.addEventListener("message", receive_message_port);
        });
    }

    // Download a Pixiv image using a GM.xmlHttpRequest server port retrieved
    // with _get_xhr_server.
    static _download_using_xhr_server(server_port, url)
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
    }

    // Download url, returning the data.
    //
    // This is only used to download Pixiv images to save to disk.  Pixiv doesn't have CORS
    // set up to give itself access to its own images, so we have to use GM.xmlHttpRequest to
    // do this.
    static async download_url(url)
    {
        let server = await this._get_xhr_server();
        if(server == null)
            throw new Error("Downloading not available");

        return await this._download_using_xhr_server(server, url);
    }

    static async downloadUrls(urls)
    {
        let results = [];
        for(let url of urls)
        {
            let result = await this.download_url(url);
            results.push(result);
        }

        return results;
    }

    // Load a URL as a document.
    static async fetchDocument(url, headers={}, options={})
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

    static async hide_body_during_request(func)
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
                await this.vsync();

            // Start entering or exiting fullscreen.
            wait_promise = func();

            start = Date.now();
            while(Date.now() - start < delay)
                await this.vsync();
        } finally {
            document.body.style.opacity = 1;
        }

        // Wait for requestFullscreen to finish after restoring opacity, so if it's waiting
        // to request permission we won't leave the window blank the whole time.  We'll just
        // flash black briefly.
        await wait_promise;
    }

    static is_fullscreen()
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
    }

    // Return true if the screen is small enough for us to treat this as a phone.
    //
    // This is used for things like switching dialogs from a floating style to a fullscreen
    // style.
    static is_phone()
    {
        // For now we just use an arbitrary threshold.
        return Math.min(window.innerWidth, window.innerHeight) < 500;
    }
    
    // If we're in VVbrowser, return the host object implemented in VVbrowserInterface.cpp.  Otherwise,
    // return null.
    static _vvbrowser({sync=true}={})
    {
        if(sync)
            return window.chrome?.webview?.hostObjects?.sync?.vvbrowser;
        else
            return window.chrome?.webview?.hostObjects?.vvbrowser;
    }

    static async toggleFullscreen()
    {
        await this.hide_body_during_request(async() => {
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
    }

    // Split a tag search into individual tags.
    static splitSearchTags(search)
    {
        // Replace full-width spaces with regular spaces.  Pixiv treats this as a delimiter.
        search = search.replace("　", " ");

        // Make sure there's a single space around parentheses, so parentheses are treated as their own item.
        // This makes it easier to translate tags inside parentheses, and style parentheses separately.
        search = search.replace(/ *([\(\)]) */g, " $1 ");

        // Remove repeated spaces.
        search = search.replace(/ +/g, " ");

        return search.split(" ");
    }
    
    // If a tag has a modifier, return [modifier, tag].  -tag seems to be the only one, so
    // we return ["-", "tag"].
    static splitTagPrefixes(tag)
    {
        if(tag[0] == "-")
            return ["-", tag.substr(1)];
        else
            return ["", tag];
    }

    // Return true if the given illust_data.tags contains the pixel art (ドット絵) tag.
    static tagsContainDot(tag_list)
    {
        if(tag_list == null)
            return false;

        for(let tag of tag_list)
            if(tag.indexOf("ドット") != -1)
                return true;

        return false;
    }

    // Find all links to Pixiv pages, and set a #ppixiv anchor.
    //
    // This allows links to images in things like image descriptions to be loaded
    // internally without a page navigation.
    static makePixivLinksInternal(root)
    {
        if(ppixiv.native)
            return;

        for(let a of root.querySelectorAll("A"))
        {
            let url = new URL(a.href, ppixiv.plocation);
            if(url.hostname != "pixiv.net" && url.hostname != "www.pixiv.net" || url.hash != "")
                continue;

            url.hash = "#ppixiv";
            a.href = url.toString();
        }
    }

    // Find the real link inside Pixiv's silly jump.php links.
    static fix_pixiv_link(link)
    {
        // These can either be /jump.php?url or /jump.php?url=url.
        let url = new URL(link);
        if(url.pathname != "/jump.php")
            return link;
        if(url.searchParams.has("url"))
            return url.searchParams.get("url");
        else
        {
            let target = url.search.substr(1); // remove "?"
            target = decodeURIComponent(target);
            return target;
        }
    }

    static fixPixivLinks(root)
    {
        for(let a of root.querySelectorAll("A[target='_blank']"))
            a.target = "";

        for(let a of root.querySelectorAll("A"))
        {
            if(a.relList == null)
                a.rel += " noreferrer noopener"; // stupid Edge
            else
            {
                a.relList.add("noreferrer");
                a.relList.add("noopener");
            }
        }

        for(let a of root.querySelectorAll("A[href*='jump.php']"))
            a.href = this.fix_pixiv_link(a.href);
    }

    // Some of Pixiv's URLs have languages prefixed and some don't.  Ignore these and remove
    // them to make them simpler to parse.
    static getPathWithoutLanguage(path)
    {
        if(/^\/..\//.exec(path))
            return path.substr(3);
        else        
            return path;
    }

    static getUrlWithoutLanguage(url)
    {
        url.pathname = this.getPathWithoutLanguage(url.pathname);
        return url;
    }

    // Return true if url1 and url2 are the same, ignoring any language prefix on the URLs.
    static areUrlsEquivalent(url1, url2)
    {
        if(url1 == null || url2 == null)
            return false;

        url1 = this.getUrlWithoutLanguage(url1);
        url2 = this.getUrlWithoutLanguage(url2);
        return url1.toString() == url2.toString();
    }

    // From a URL like "/en/tags/abcd", return "tags".
    static getPageTypeFromUrl(url)
    {
        url = new URL(url);
        url = this.getUrlWithoutLanguage(url);
        let parts = url.pathname.split("/");
        return parts[1];
    }
    
    static setPageTitle(title)
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
    }

    static setPageIcon(url)
    {
        document.querySelector("link[rel='icon']").href = url;
    }

    // Get the search tags from an "/en/tags/TAG" search URL.
    static getSearchTagsFromUrl(url)
    {
        url = this.getUrlWithoutLanguage(url);
        let parts = url.pathname.split("/");

        // ["", "tags", tag string, "search type"]
        let tags = parts[2] || "";
        return decodeURIComponent(tags);
    }
    
    // Given a list of tags, return the URL to use to search for them.  This differs
    // depending on the current page.
    static getArgsForTagSearch(tags, url)
    {
        url = this.getUrlWithoutLanguage(url);

        let type = helpers.getPageTypeFromUrl(url);
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
        let args = helpers.getCanonicalUrl(url);
        return args;
    }
    
    // The inverse of getArgsForTagSearch:
    static get_tag_search_from_args(url)
    {
        url = helpers.getUrlWithoutLanguage(url);
        let type = helpers.getPageTypeFromUrl(url);
        if(type != "tags")
            return null;

        let parts = url.pathname.split("/");
        return decodeURIComponent(parts[2]);
    }

    // Return a canonical URL for a data source.  If the canonical URL is the same,
    // the same instance of the data source should be used.
    //
    // A single data source is used eg. for a particular search and search flags.  If
    // flags are changed, such as changing filters, a new data source instance is created.
    // However, some parts of the URL don't cause a new data source to be used.  Return
    // a URL with all unrelated parts removed, and with query and hash parameters sorted
    // alphabetically.
    static getCanonicalUrl(url, {
        // The search page doesn't affect the data source.  Set this to false to leave it
        // in the URL anyway.
        removeSearchPage=true
    }={})
    {
        // Make a copy of the URL.
        url = new URL(url);

        // Remove /en from the URL if it's present.
        url = helpers.getUrlWithoutLanguage(url);

        let args = new helpers.args(url);

        // Remove parts of the URL that don't affect which data source instance is used.
        //
        // If p=1 is in the query, it's the page number, which doesn't affect the data source.
        if(removeSearchPage)
            args.query.delete("p");

        // The manga page doesn't affect the data source.
        args.hash.delete("page");

        // #view=thumbs controls which view is active.
        args.hash.delete("view");

        // illust_id in the hash is always just telling us which image within the current
        // data source to view.  data_sources.current_illust is different and is handled in
        // the subclass.
        args.hash.delete("illust_id");

        // These are for temp view and don't affect the data source.
        args.hash.delete("virtual");
        args.hash.delete("temp-view");

        // This is for overriding muting.
        args.hash.delete("view-muted");

        // Ignore filenames for local IDs.
        args.hash.delete("file");

        // slideshow is used by the viewer and doesn't affect the data source.
        args.hash.delete("slideshow");

        // Sort query and hash parameters.
        args.query = helpers.sort_query_parameters(args.query);
        args.hash = helpers.sort_query_parameters(args.hash);

        return args;
    }

    // Add a basic event handler for an input:
    //
    // - When enter is pressed, submit will be called.
    // - Event propagation will be stopped, so global hotkeys don't trigger.
    //
    // Note that other event handlers on the input will still be called.
    static inputHandler(input, submit)
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
    }

    // Return true if url is one of ours.
    static isPPixivUrl(url)
    {
        // If we're native, all URLs on this origin are ours.
        if(ppixiv.native)
            return new URL(url).origin == document.location.origin;
        else
            return url.hash.startsWith("#ppixiv");
    }

    static get_hash_args(url)
    {
        if(!helpers.isPPixivUrl(url))
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
        let hashPath = url.hash;
        if(hashPath.startsWith("#ppixiv"))
            hashPath = hashPath.substr(7);
        else if(hashPath.startsWith("#"))
            hashPath = hashPath.substr(1);

        // See if we have hash args.
        let idx = hashPath.indexOf('?');
        let query = null;
        if(idx != -1)
        {
            query = hashPath.substr(idx+1);
            hashPath = hashPath.substr(0, idx);
        }

        // We encode spaces as + in the URL, but decodeURIComponent doesn't, so decode
        // that first.  Actual '+' is always escaped as %2B.
        hashPath = hashPath.replace(/\+/g, " ");
        hashPath = decodeURIComponent(hashPath);

        if(query == null)
            return { path: hashPath, query: new URLSearchParams() };
        else
            return { path: hashPath, query: new URLSearchParams(query) };
    }
    
    // Replace the given field in the URL path.
    //
    // If the path is "/a/b/c/d", "a" is 0 and "d" is 4.
    static setPathPart(url, index, value)
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
    }

    static getPathPart(url, index, value)
    {
        // The path always begins with a slash, so the first entry in parts is always empty.
        // Skip it.
        index++;

        let parts = url.pathname.split("/");
        if(parts.length > 1 && parts[1].length == 2)
            index++;
        
        return parts[index] || "";
    }

    // Given a URLSearchParams, return a new URLSearchParams with keys sorted alphabetically.
    static sort_query_parameters(search)
    {
        let search_keys = Array.from(search.keys());
        search_keys.sort();

        let result = new URLSearchParams();
        for(let key of search_keys)
            result.set(key, search.get(key));
        return result;
    }

    // Navigate to args, which can be a URL object or a helpers.args.
    static navigate(args, {
        // If true, push the navigation onto browser history.  If false, replace the current
        // state.
        addToHistory=true,

        // popstate.navigationCause is set to this.  This allows event listeners to determine
        // what caused a navigation.  For browser forwards/back, this won't be present.
        cause="navigation",

        // We normally synthesize window.onpopstate, so listeners for navigation will see this
        // as a normal navigation.  If this is false, don't do this.
        sendPopstate=true,
    }={})
    {
        if(args instanceof URL)
            args = new helpers.args(args);

        // Store the previous URL for comparison.  Normalize it with args, so comparing it with
        // toString() is reliable if the escaping is different, such as different %1E case or
        // not escaping spaces as +.
        let old_url = new helpers.args(ppixiv.plocation).toString();

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
        if(addToHistory)
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
        // console.log("Set URL to", ppixiv.plocation.toString(), addToHistory);

        if(ppixiv.plocation.toString() != old_url)
        {
            if(sendPopstate)
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
    }

    static setup_popups(container, selectors)
    {
        function setup_popup(box)
        {
            box.addEventListener("mouseover", function(e) { helpers.setClass(box, "popup-visible", true); });
            box.addEventListener("mouseout", function(e) { helpers.setClass(box, "popup-visible", false); });
        }

        for(let selector of selectors)
        {
            let box = container.querySelector(selector);
            if(box == null)
            {
                console.warn("Couldn't find", selector);
                continue;
            }
            setup_popup(box);
        }
    }

    // Return the offset of element relative to an ancestor.
    static getRelativePosition(element, ancestor)
    {
        let x = 0, y = 0;
        while(element != null && element != ancestor)
        {
            x += element.offsetLeft;
            y += element.offsetTop;
            // Advance through parents until we reach the offsetParent or the ancestor
            // that we're stopping at.  We do this rather than advancing to offsetParent,
            // in case ancestor isn't an offsetParent.
            let search_for = element.offsetParent;
            while(element != ancestor && element != search_for)
                element = element.parentNode;
        }
        return [x, y];
    }
    
    static distance({x: x1, y: y1}, {x: x2, y: y2})
    {
        let distance = Math.pow(x1-x2, 2) + Math.pow(y1-y2, 2);
        return Math.pow(distance, 0.5);
    }

    // Scale x from [l1,h2] to [l2,h2].
    static scale(x, l1, h1, l2, h2)
    {
        return (x - l1) * (h2 - l2) / (h1 - l1) + l2;
    }

    // Clamp value between min and max.
    static clamp(value, min, max)
    {
        if(min > max)
            [min, max] = [max, min];
        return Math.min(Math.max(value, min), max);
    }

    // Scale x from [l1,h2] to [l2,h2], clamping to l2,h2.
    static scaleClamp(x, l1, h1, l2, h2)
    {
        return helpers.clamp(helpers.scale(x, l1, h1, l2, h2), l2, h2);
    }

    // Return the index (in B) of the first value in A that exists in B.
    static findFirstIdx(A, B)
    {
        for(let idx = 0; idx < A.length; ++idx)
        {
            let idx2 = B.indexOf(A[idx]);
            if(idx2 != -1)
                return idx2;
        }
        return -1;
    }
    
    // Return the index (in B) of the last value in A that exists in B.
    static findLastIdx(A, B)
    {
        for(let idx = A.length-1; idx >= 0; --idx)
        {
            let idx2 = B.indexOf(A[idx]);
            if(idx2 != -1)
                return idx2;
        }
        return -1;
    }

    // Return a promise that waits for the given event on node.
    static waitForEvent(node, name, { abort_signal=null }={})
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
                    img.src = helpers.blankImage;
                    remove_listeners_signal.abort();
                    resolve("aborted");
                }, { signal: remove_listeners_signal.signal });
            }
        });
    }

    // Return a promise that waits for img to load.
    //
    // If img loads successfully, resolve with null.  If abort_signal is aborted,
    // resolve with "aborted".  Otherwise, reject with "failed".  This never
    // rejects.
    //
    // If we're aborted, img.src will be set to helpers.blankImage.  Otherwise,
    // the image will load anyway.  This is a little invasive, but it's what we
    // need to do any time we have a cancellable image load, so we might as well
    // do it in one place.
    static waitForImageLoad(img, abort_signal)
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
                img.src = helpers.blankImage;
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
                    img.src = helpers.blankImage;
                    remove_listeners_signal.abort();
                    resolve("aborted");
                }, { signal: remove_listeners_signal.signal });
            }
        });
    }

    // Wait for any image in images to finish loading.  If images is empty, return
    // immediately.
    static async waitForAnyImageLoad(images, abort_signal)
    {
        let promises = [];
        for(let image of images)
        {
            if(image == null)
                continue;
            promises.push(helpers.waitForImageLoad(image, abort_signal));
        }

        if(promises.length == 0)
            return null;

        await Promise.race([...promises]);
    }

    // Wait until img.naturalWidth/naturalHeight are available.
    //
    // There's no event to tell us that img.naturalWidth/naturalHeight are
    // available, so we have to jump hoops.  Loop using requestAnimationFrame,
    // since this lets us check quickly at a rate that makes sense for the
    // user's system, and won't be throttled as badly as setTimeout.
    static async wait_for_image_dimensions(img, abort_signal)
    {
        return new Promise((resolve, reject) => {
            if(abort_signal && abort_signal.aborted)
                resolve(false);
            if(img.naturalWidth != 0)
                resolve(true);

            let frame_id = null;

            // If abort_signal is aborted, cancel our frame request.
            let abort = () => {
                abort_signal.removeEventListener("aborted", abort);
                if(frame_id != null)
                    realCancelAnimationFrame(frame_id);
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

                frame_id = realRequestAnimationFrame(check);
            };
            check();
        });
    }

    // Wait up to ms for promise to complete.  If the promise completes, return its
    // result, otherwise return "timed-out".
    static async awaitWithTimeout(promise, ms)
    {
        let sleep = new Promise((accept, reject) => {
            realSetTimeout(() => {
                accept("timed-out");
            }, ms);
        });

        // Wait for whichever finishes first.
        return await Promise.any([promise, sleep]);
    }

    // Asynchronously wait for an animation frame.  Return true on success, or false if
    // aborted by signal.
    static vsync({signal=null}={})
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
                    realCancelAnimationFrame(id);

                accept(false);
            };

            // Stop if we're already aborted.
            if(signal?.aborted)
            {
                abort();
                return;
            }
    
            id = realRequestAnimationFrame((time) => {
                if(signal)
                    signal.removeEventListener("abort", abort);
                accept(true);
            });

            if(signal)
                signal.addEventListener("abort", abort, { once: true });
        });
    }

    // Based on the dimensions of the container and a desired pixel size of thumbnails,
    // figure out how many columns to display to bring us as close as possible to the
    // desired size.  Return the corresponding CSS style attributes.
    //
    // container is the containing block (eg. ul.thumbnails).
    static makeThumbnailSizingStyle({
        container,
        minPadding,
        desiredSize=300,
        ratio=null,
        maxColumns=5,
    }={})
    {
        // The total pixel size we want each thumbnail to have:
        ratio ??= 1;

        let desiredPixels = desiredSize*desiredSize;

        // The container might have a fractional size, and clientWidth will round it, which is
        // wrong for us: if the container is 500.75 wide and we calculate a fit for 501, the result
        // won't actually fit.  Get the bounding box instead, which isn't rounded.
        // let containerWidth = container.parentNode.clientWidth;
        let containerWidth = Math.floor(container.parentNode.getBoundingClientRect().width);
        let padding = minPadding;
        
        let closestErrorToDesiredPixels = -1;
        let best_size = [0,0];
        let best_columns = 0;

        // Find the greatest number of columns we can fit in the available width.
        for(let columns = maxColumns; columns >= 1; --columns)
        {
            // The amount of space in the container remaining for images, after subtracting
            // the padding around each image.  Padding is the flex gap, so this doesn't include
            // padding at the left and right edge.
            let remainingWidth = containerWidth - padding*(columns-1);
            let maxWidth = remainingWidth / columns;

            let maxHeight = maxWidth;
            if(ratio < 1)
                maxWidth *= ratio;
            else if(ratio > 1)
                maxHeight /= ratio;

            maxWidth = Math.floor(maxWidth);
            maxHeight = Math.floor(maxHeight);

            let pixels = maxWidth * maxHeight;
            let error = Math.abs(pixels - desiredPixels);
            if(closestErrorToDesiredPixels == -1 || error < closestErrorToDesiredPixels)
            {
                closestErrorToDesiredPixels = error;
                best_size = [maxWidth, maxHeight];
                best_columns = columns;
            }
        }

        let [thumbWidth, thumbHeight] = best_size;

        // If we want a smaller thumbnail size than we can reach within the max column
        // count, we won't have reached desiredPixels.  In this case, just clamp to it.
        // This will cause us to use too many columns, which we'll correct below with
        // containerWidth.
        //
        // On mobile, just allow the thumbnails to be bigger, so we prefer to fill the
        // screen and not waste screen space.
        if(!ppixiv.mobile && thumbWidth * thumbHeight > desiredPixels)
        {
            thumbHeight = thumbWidth = Math.round(Math.sqrt(desiredPixels));

            if(ratio < 1)
                thumbWidth *= ratio;
            else if(ratio > 1)
                thumbHeight /= ratio;
        }

        // Clamp the width of the container to the number of columns we expect.
        containerWidth = best_columns*thumbWidth + (best_columns-1)*padding;
        return {columns: best_columns, padding, thumbWidth, thumbHeight, containerWidth};
    }
    
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
    static get_thumbnail_panning_direction(thumb, width, height, container_aspect_ratio)
    {
        // Disable panning if we don't have the image size.  Local directory thumbnails
        // don't tell us the dimensions in advance.
        if(width == null || height == null)
        {
            helpers.setClass(thumb, "vertical-panning", false);
            helpers.setClass(thumb, "horizontal-panning", false);
            return null;
        }

        let aspect_ratio = width / height;
        aspect_ratio /= container_aspect_ratio;
        let min_aspect_for_pan = 1.1;
        let max_aspect_for_pan = 4;
        if(aspect_ratio > (1/max_aspect_for_pan) && aspect_ratio < 1/min_aspect_for_pan)
            return "vertical";
        else if(aspect_ratio > min_aspect_for_pan && aspect_ratio < max_aspect_for_pan)
            return "horizontal";
        else
            return null;
    }

    static createThumbnailAnimation(thumb, width, height, container_aspect_ratio)
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
    }

    static get_title_for_illust(illust_data)
    {
        if(illust_data == null)
            return null;

        let page_title = "";
    
        if(!helpers.isMediaIdLocal(illust_data.mediaId))
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
            let {id} = helpers.parseMediaId(illust_data.mediaId);
            let name = helpers.getPathSuffix(id, 1, 0); // filename
            let parent = helpers.getPathSuffix(id, 2, 1); // parent directories
            page_title += `${name} - ${parent}`;
        }

        return page_title;
    }

    static set_title(illust_data)
    {
        let page_title = helpers.get_title_for_illust(illust_data) ?? "Loading...";
        helpers.setPageTitle(page_title);
    }

    static setIcon({vview=false}={})
    {
        if(ppixiv.native || vview)
            helpers.setPageIcon(ppixiv.resources['resources/vview-icon.png']);
        else
            helpers.setPageIcon(ppixiv.resources['resources/regular-pixiv-icon.png']);
    }

    static setTitleAndIcon(illust_data)
    {
        helpers.set_title(illust_data)
        helpers.setIcon()
    }

    // Return 1 if the given keydown event should zoom in, -1 if it should zoom
    // out, or null if it's not a zoom keypress.
    static isZoomHotkey(e)
    {
        if(!e.ctrlKey)
            return null;
        
        if(e.code == "NumpadAdd" || e.code == "Equal") /* = */
            return +1;
        if(e.code == "NumpadSubtract" || e.code == "Minus") /* - */ 
            return -1;
        return null;
    }

    // https://stackoverflow.com/questions/1255512/how-to-draw-a-rounded-rectangle-on-html-canvas/3368118#3368118
    /*
     * Draws a rounded rectangle using the current state of the canvas.
     * If you omit the last three params, it will draw a rectangle
     * outline with a 5 pixel border radius
     */
    static draw_round_rect(ctx, x, y, width, height, radius)
    {
        if(typeof radius === 'undefined')
            radius = 5;
        if(typeof radius === 'number') {
            radius = {tl: radius, tr: radius, br: radius, bl: radius};
        } else {
            let defaultRadius = {tl: 0, tr: 0, br: 0, bl: 0};
            for(let side in defaultRadius)
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
    }

    // Split a "type:id" into its two parts.
    //
    // If there's no colon, this is a Pixiv illust ID, so set type to "illust".
    static _split_id(id)
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
    }

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
    static encodeMediaId({type, id, page=null}={})
    {
        if(type == "illust")
        {
            if(page == null)
                page = 0;
            id  += "-" + page;
        }

        return type + ":" + id;
    }

    // Media IDs are parsed by the thousands, and this can have a small performance
    // impact.  Cache the results, so we only parse any given media ID once.
    static _mediaIdCache = new Map();
    static parseMediaId(mediaId)
    {
        let cache = this._mediaIdCache.get(mediaId);
        if(cache == null)
        {
            cache = this._parse_media_id_inner(mediaId);
            this._mediaIdCache.set(mediaId, cache);
        }

        // Return a new object and not the cache, since the returned value might be
        // modified.
        return { type: cache.type, id: cache.id, page: cache.page };
    }

    static _parse_media_id_inner(mediaId)
    {
        // If this isn't an illust, a media ID is the same as an illust ID.
        let { type, id } = this._split_id(mediaId);
        if(type != "illust")
            return { type: type, id: id, page: 0 };

        // If there's no hyphen in the ID, it's also the same.
        if(mediaId.indexOf("-") == -1)
            return { type: type, id: id, page: 0 };

        // Split out the page.
        let parts = id.split("-");
        let page = parts[1];
        page = parseInt(page);
        id = parts[0];
        
        return { type: type, id: id, page: page };
    }

    // Given a media ID, return the same media ID for the first page.
    //
    // Some things don't interact with pages, such as illust info loads, and
    // only store data with the ID of the first page.
    static getMediaIdFirstPage(mediaId)
    {
        return this.getMediaIdForPage(mediaId, 0);
    }

    static getMediaIdForPage(mediaId, page=0)
    {
        if(mediaId == null)
            return null;
            
        let id = helpers.parseMediaId(mediaId);
        id.page = page;
        return helpers.encodeMediaId(id);
    }

    // Convert a Pixiv illustration ID and page number to a media ID.
    static illustIdToMediaId(illust_id, page)
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
    }

    static mediaIdToIllustIdAndPage(mediaId)
    {
        let { type, id, page } = helpers.parseMediaId(mediaId);
        if(type != "illust")
            return [mediaId, 0];
        
        return [id, page];
    }

    // Return true if mediaId is an ID for the local API.
    static isMediaIdLocal(mediaId)
    {
        let { type } = helpers.parseMediaId(mediaId);
        return type == "file" || type == "folder";
    }

    // Return the last count parts of path.
    static getPathSuffix(path, count=2, remove_from_end=0, { remove_extension=true }={})
    {
        let parts = path.split('/');
        parts = parts.splice(0, parts.length - remove_from_end);
        parts = parts.splice(parts.length-count); // take the last count parts

        let result = parts.join("/");
        if(remove_extension)
            result = result.replace(/\.[a-z0-9]+$/i, '');

        return result;
    }

    static encodeURLPart(regex, part)
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
    }

    // Both "encodeURI" and "encodeURIComponent" are wrong for encoding hashes.
    // The first doesn't escape ?, and the second escapes lots of things we
    // don't want to, like forward slash.
    static encodeURLHash(hash)
    {
        return helpers.encodeURLPart(/[^A-Za-z0-9-_\.!~\*'()/:\[\]\^#=&]/g, hash);
    }

    // This one escapes keys in hash parameters.  This is the same as encodeURLHash,
    // except it also encodes = and &.
    static encodeHashParam(param)
    {
        return helpers.encodeURLPart(/[^A-Za-z0-9-_\.!~\*'()/:\[\]\^#]/g, param);
    }

    // Encode a URLSearchParams for hash parameters.
    //
    // We can use URLSearchParams.toString(), but that escapes overaggressively and
    // gives us nasty, hard to read URLs.  There's no reason to escape forward slash
    // in query parameters.
    static encodeHashParams(params)
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
    }

    // Escape a string to use in a CSS selector.
    //
    // If we're searching for [data-filename='path'], we need to escape quotes in "path".
    static escape_selector(s)
    {
        return s.replace(/['"]/g, (c) => {
            return "\\" + c;
        });
    }

    title_case(s)
    {
        let parts = [];
        for(let part of s.split(" "))
            parts.push(part.substr(0, 1).toUpperCase() + s.substr(1));
        return parts.join(" ");
    }

    // 1     -> 1
    // 1:2   -> 0.5
    // null  -> null
    // ""    -> null
    static parse_ratio(value)
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
    }
    
    // Parse:
    // 1        -> [1,1]
    // 1...2    -> [1,2]
    // 1...     -> [1,null]
    // ...2     -> [null,2]
    // 1:2      -> [0.5, 0.5]
    // 1:2...2  -> [0.5, 2]
    // null     -> null
    static parse_range(range)
    {
        if(range == null)
            return null;
            
        let parts = range.split("...");
        let min = helpers.parse_ratio(parts[0]);
        let max = helpers.parse_ratio(parts[1]);
        return [min, max];
    }

    // Generate a UUID.
    static createUuid()
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
    }

    static shuffleArray(array)
    {
        for(let idx = 0; idx < array.length; ++idx)
        {
            let swap_with = Math.floor(Math.random() * array.length);
            [array[idx], array[swap_with]] = [array[swap_with], array[idx]];
        }
    }

    static adjustImageUrlHostname(url)
    {
        if(url.hostname == "i.pximg.net")
            url.hostname = "i-cf.pximg.net";
    }

    // Given a low-res thumbnail URL from thumbnail data, return a high-res thumbnail URL.
    // If page isn't 0, return a URL for the given manga page.
    static get_high_res_thumbnail_url(url, page=0)
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
        url = new URL(url, ppixiv.plocation);
        let path = url.pathname;
        let re = /(\/c\/)([^\/]+)(.*)(square1200|master1200|custom1200).jpg/;
        let match = re.exec(path);
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

        this.adjustImageUrlHostname(url);

        return url.toString();
    }
}
    
// Gradually slow down and stop the given CSS animation after a delay, resuming it
// if the mouse is moved.
export class StopAnimationAfter
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
}

// Add delays to hovering and unhovering.  The class "hover" will be set when the mouse
// is over the element (equivalent to the :hover selector), with a given delay before the
// state changes.
//
// This is used when hovering the top bar when in ui-on-hover mode, to delay the transition
// before the UI disappears.  transition-delay isn't useful for this, since it causes weird
// hitches when the mouse enters and leaves the area quickly.
export class HoverWithDelay
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
            realClearTimeout(this.hover_timeout);
            this.hover_timeout = null;
        }

        this.real_hover_state = hovering;
        this.pending_hover = hovering;
        let delay = hovering? this.delay_enter:this.delay_exit;
        this.hover_timeout = realSetTimeout(() => {
            this.pending_hover = null;
            this.hover_timeout = null;
            helpers.setClass(this.element, "hover", this.real_hover_state);
        }, delay);
    }
}


// A simple wakeup event.
class WakeupEvent
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
};

// A convenience wrapper for setTimeout:
export class Timer
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

        realClearTimeout(this.id);
        this.id = null;
    }

    set(ms)
    {
        this.clear();
        this.id = realSetTimeout(this.run_func, ms);
    }
};
    
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
export class VirtualHistory
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
    get previousStateUrl()
    {
        if(this.history.length < 2)
            return null;

        return this.history[this.history.length-2].url;
    }

    get previous_state_args()
    {
        let url = this.previousStateUrl;
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

export class PointerEventMovement
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

// This is like pointer_listener, but for watching for keys being held down.
// This isn't meant to be used for single key events.
class GlobalKeyListener
{
    constructor()
    {
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
        realSetTimeout(() => {
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

export class KeyListener
{
    static singleton = null;
    constructor(key, callback, {signal=null}={})
    {
        if(KeyListener.singleton == null)
            KeyListener.singleton = new GlobalKeyListener();

        this.callback = callback;
        this.pressed = false;

        KeyListener.singleton.register_listener(key, this);

        if(signal)
        {
            signal.addEventListener("abort", (e) => {
                KeyListener.singleton.unregister_listener(key, this);
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

export function SentinelGuard(func, self)
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

export class FixedDOMRect extends DOMRect
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

// A helper for exponential backoff delays.
export class SafetyBackoffTimer
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
export class ClassFlags extends EventTarget
{
    // This class can be used on anything, but it's normally used on <html> for document-wide
    // flags.
    static get get()
    {
        if(this.singleton == null)
            this.singleton = new ClassFlags(document.documentElement);
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
        helpers.setClass(this.element, name, value);

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
export class OpenWidgets extends EventTarget
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

        this.event = new WakeupEvent();
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
