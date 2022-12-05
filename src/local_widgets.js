"use strict";

// Widgets only used for local file navigation.

ppixiv.tree_widget = class extends ppixiv.widget
{
    constructor({
        add_root=true,
        ...options})
    {
        super({...options, template: `
            <div class=tree>
                <div class=items>
                </div>
            </div>
        `});

        this.label_popup = this.create_template({html: `
            <div class=tree-popup>
                <div class=label></div>
            </div>
        `});

        this.thumb_popup = this.create_template({html: `
            <div class=thumb-popup>
                <img class=img></div>
            </div>
        `});

        this.items = this.container.querySelector(".items");

        // Listen to illust changes so we can refresh nodes.
        media_cache.addEventListener("mediamodified", this.illust_modified, { signal: this.shutdown_signal.signal });

        // Create the root item.  This is tree_widget_item or a subclass.
        if(add_root)
        {
            let root = new ppixiv.tree_widget_item({
                parent: this,
                label: "root",
                root: true,
            });

            this.set_root(root);
        }
    }

    illust_modified = (e) =>
    {
        if(this.root == null)
            return;

        for(let node of Object.values(this.root.nodes))
        {
            if(node.illust_changed)
                node.illust_changed(e.media_id);
        }
    }
    
    // Given an element, return the tree_widget_item label it's inside, if any.
    get_widget_from_element(element)
    {
        let label = element.closest(".tree-item > .self > .label");
        if(label == null)
            return null;

        let item = label.closest(".tree-item");
        return item.widget;
    }

    set_root(root)
    {
        if(this.root == root)
            return;

        // If we have another root, remove it from this.items.
        if(this.root)
        {
            this.root.container.remove();
            this.root = null;
        }

        this.root = root;

        // Add the new root to this.items.
        if(root.container.parentNode != this.items)
        {
            console.assert(root.parentNode == null);
            this.items.appendChild(root.container);
        }

        // Root nodes are always expanded.
        root.expanded = true;
    }

    set_selected_item(item)
    {
        if(this.selected_item == item)
            return;

        this.selected_item = item;
        for(let node of this.container.querySelectorAll(".tree-item.selected"))
            node.classList.remove("selected");

        if(item != null)
        {
            item.container.classList.add("selected");

            // If the item isn't visible, center it.
            //
            // Bizarrely, while there's a full options dict for scrollIntoView and you
            // can control horizontal and vertical scrolling separately, there's no "none"
            // option so you can scroll vertically and not horizontally.
            let scroll_container = this.container;
            let label = item.container.querySelector(".label");

            let old_scroll_left = scroll_container.scrollLeft;

            label.scrollIntoView({ block: "nearest" });

            scroll_container.scrollLeft = old_scroll_left;
        }
    }

    // Update the hover popup.  This allows seeing the full label without needing
    // a horizontal scroller, and lets us display a quick thumbnail.
    set_hover(item)
    {
        let img = this.thumb_popup.querySelector("img");

        if(item == null)
        {
            // Remove the hover, and clear the image so it doesn't flicker the next time
            // we display it.
            img.src = helpers.blank_image;
            this.label_popup.remove();
            this.thumb_popup.remove();
            return;
        }

        let label = item.container.querySelector(".label");
        let {top, left, bottom, height} = label.getBoundingClientRect();

        // Set up thumb_popup.
        if(item.path)
        {
            let {right} = this.container.getBoundingClientRect();
            this.thumb_popup.style.left = `${right}px`;

            // If the label is above halfway down the screen, position the preview image
            // below it.  Otherwise, position it below.  This keeps the image from overlapping
            // the label.  We don't know the dimensions of the image here.
            let label_center = top + height/2;
            let below_middle = label_center > window.innerHeight/2;

            if(below_middle)
            {
                // Align the bottom of the image to the top of the label.
                this.thumb_popup.style.top = `${top - 20}px`;
                img.style.objectPosition = "left bottom";
                this.thumb_popup.style.transform = "translate(0, -100%)";
            } else {
                // Align the top of the image to the bottom of the label.
                this.thumb_popup.style.top = `${bottom+20}px`;
                img.style.objectPosition = "left top";
                this.thumb_popup.style.transform = "";
            }

            // Don't show a thumb for roots.  Searches don't have thumbnails, and it's not useful
            // for most others.
            img.hidden = item.is_root;
            img.crossOriginMode = "use-credentials";
            if(!item.is_root)
            {
                // Use /tree-thumb for these thumbnails.  They're the same as the regular thumbs,
                // but it won't give us a folder image if there's no thumb.
                let url = local_api.local_url;
                url.pathname = "tree-thumb/" + item.path;
                img.src = url;
                img.addEventListener("img", (e) => { console.log("error"); img.hidden = true; });
            }
            
            document.body.appendChild(this.thumb_popup);
        }

        // Set up label_popup.
        {
            this.label_popup.style.left = `${left}px`;
            this.label_popup.style.top = `${top}px`;

            // Match the padding of the label.
            this.label_popup.style.padding = getComputedStyle(label).padding;
            this.label_popup.querySelector(".label").innerText = item.label;
            document.body.appendChild(this.label_popup);
        }
    }
}

ppixiv.tree_widget_item = class extends ppixiv.widget
{
    // If root is true, this is the root item being created by a tree_widget.  Our
    // parent is the tree_widget and our container is tree_widget.items.
    //
    // If root is false (all items created by the user) and parent is a tree_widget, our
    // real parent is the tree_widget's root item.  Otherwise, parent is always another
    // tree_widget_item.
    constructor({
        parent,
        label,

        root=false,

        // If true, this item might have children.  The first time the user expands
        // it, onexpand() will be called to populate it.
        pending=false,
        expandable=false,
        ...options
    }={})
    {
        // If this isn't a root node and parent is a tree_widget, use the tree_widget's
        // root node as our parent instead of the tree widget itself.
        if(!root && parent instanceof ppixiv.tree_widget)
            parent = parent.root;

        super({...options,
            // The container is our parent node's item list.
            container: parent.items,
            template: `
            <div class=tree-item data-context-menu-target>
                <div class=self tabindex=1>
                    <div class=expander data-mode="loading">
                        <span class="expander-button expand">▶</span>
                        <span class="expander-button loading">⌛</span>
                        <span class="expander-button none"></span>
                    </div>

                    <div class="button-bookmark public enabled bookmarked" hidden>
                        <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                    </div>
                    <div class=label></div>
                </div>

                <div class=items></div>
            </div>
        `});

        // If this is the root node, hide .self, and add .root so our children
        // aren't indented.
        if(root)
        {
            this.container.querySelector(".self").hidden = true;
            this.container.classList.add("root");
        }

        // If our parent is the root node, we're a top-level node.
        helpers.set_class(this.container, "top", !root && parent.root);
        helpers.set_class(this.container, "child", !root && !parent.root);

        this.items = this.container.querySelector(".items");
        this.expander = this.container.querySelector(".expander");
        this.expand_mode = "expandable";
        this.is_root = root;
        this._expandable = expandable;
        this._expanded = false;
        this._pending = pending;
        this._label = label;

        // Our root node:
        this.root_node = root? this:this.parent.root_node;

        // If we're the root node, the tree is our parent.  Otherwise, copy the tree from
        // our parent.
        this.tree = root? this.parent:this.parent.tree;

        this.expander.addEventListener("click", (e) => {
            this.expanded = !this.expanded;
        });

        let label_element = this.container.querySelector(".label");
        label_element.addEventListener("dblclick", this.ondblclick);

        label_element.addEventListener("mousedown", (e) => {
            if(e.button != 0)
                    return;

            e.preventDefault();
            e.stopImmediatePropagation();

            this.select();
            this.onclick();
        }, { capture: true });

        label_element.addEventListener("mouseover", (e) => {
            this.tree.set_hover(this);
        }, {
            capture: false,
        });

        label_element.addEventListener("mouseout", (e) => {
            this.tree.set_hover(null);
        }, {
            capture: false,
        });

        this.refresh_expand_mode();

        if(this.parent instanceof ppixiv.tree_widget_item)
        {
            this.parent.refresh_expand_mode();
        }

        // Refresh the label.
        this.refresh();
    }

    get label() { return this._label; }

    refresh()
    {
        let label = this.container.querySelector(".label");
        label.innerText = this.label;
    }

    // This is called if pending is set to true the first time the node is expanded.
    // Return true on success, or false to re-collapse the node on error.
    async onexpand() { return true; }

    // This is called when the item is clicked.
    onclick() { }

    set expanded(value)
    {
        if(this._expanded == value)
            return;

        // Don't unexpand the root.
        if(!value && this.is_root)
            return;

        this._expanded = value;

        // If we're pending, call onexpand the first time we're expanded so we can
        // be populated.  We'll stay pending and showing the hourglass until onexpand
        // completes.
        if(this._expanded)
            this.load_contents();

        this.refresh_expand_mode();
    }
    
    async load_contents()
    {
        // Stop if we're already loaded.
        if(!this._pending)
            return;

        if(this.load_promise != null)
        {
            try {
                await this.load_promise;
            } catch(e) {
                // The initial call to load_contents will print the error.
            }
            return;
        }

        // Start a load if one isn't already running.
        // Start the load.
        this.load_promise = this.onexpand();

        this.load_promise.finally(() => {
            this.pending = false;
            this.load_promise = null;
        });

        try {
            if(await this.load_promise)
                return;
        } catch(e) {
            console.log("Error expanding", this, e);
        }

        // If onexpand() threw an exception or returned false, there was an error loading the
        // node.  Unexpand it rather than leaving it marked complete, so it can be retried.
        this._pending = true;
        this._expanded = false;
        this.refresh_expand_mode();
    }

    set expandable(value)
    {
        if(this._expandable == value)
            return;
        this._expandable = value;
        this.refresh_expand_mode();
    }

    set pending(value)
    {
        if(this._pending == value)
            return;
        this._pending = value;
        this.refresh_expand_mode();
    }

    get expanded() { return this._expanded;}
    get expandable() { return this._expandable; }
    get pending() { return this._pending; }
    
    // Return an array of this node's child tree_widget_items.
    get child_nodes()
    {
        let result = [];
        for(let child = this.items.firstElementChild; child != null; child = child.nextElementSibling)
            if(child.widget)
                result.push(child.widget);
        return result;
    }

    get displayed_expand_mode()
    {
        // If we're not pending and we have no children, show "none".
        if(!this._pending && this.items.firstElementChild == null)
            return "none";

        // If we're expanded and pending, show "loading".  We're waiting for onexpand
        // to finish loading and unset pending.
        if(this.expanded)
            return this._pending? "loading":"expanded";

        return "expandable";
    }

    refresh_expand_mode()
    {
        this.expander.dataset.mode = this.displayed_expand_mode;
        this.expander.dataset.pending = this._pending;
        this.items.hidden = !this._expanded || this._pending;
        helpers.set_class(this.container, "allow-content-visibility", this.displayed_expand_mode != "expanded");
    }

    select()
    {
        this.tree.set_selected_item(this);
    }

    focus()
    {
        this.container.querySelector(".self").focus();
    }

    remove()
    {
        if(this.parent == null)
            return;

        this.parent.items.remove(this.container);

        // Refresh the parent in case we're the last child.
        this.parent.refresh_expand_mode();

        this.parent = null;
    }

    ondblclick = async(e) =>
    {
        e.preventDefault();
        e.stopImmediatePropagation();

        console.log("ondblclick");
        this.expanded = !this.expanded;

        // Double-clicking the tree expands the node.  It also causes it to be viewed due
        // to the initial single-click.  However, if you double-click a directory that's
        // full of images, the natural thing for it to do is to view the first image.  If
        // we don't do that, every time you view a directory you have to click it in the
        // tree, then click the first image in the search.
        //
        // Try to do this intelligently.  If the directory we're loading is almost all images,
        // navigate to the first image.  Otherwise, just let the click leave us viewing the
        // directory.  This way, double-clicking a directory that has a bunch of other directories
        // in it will just expand the node, but double-clicking a directory which is a collection
        // of images will view the images.
        //
        // If we do this, we'll do both navigations: first to the directory and then to the image.
        // That's useful, so if we display the image but you really did want the directory view,
        // you can just back out once.
        //
        // Wait for contents to be loaded so we can see if there are any children.
        console.log("loading on dblclick");
        await this.load_contents();

        // If there are any children that we just expanded, stop.
        console.log("loaded, length:", this.child_nodes.length);
        if(this.child_nodes.length != 0)
            return;

        // The dblclick should have set the data source to this entry.  Grab the
        // data source.
        let data_source = main_controller.data_source;
        console.log("data source for double click:", data_source);

        // Load the first page.  This will overlap with the search loading it, and
        // will wait on the same request.
        if(!data_source.id_list.is_page_loaded(1))
            await data_source.load_page(1);

        // Navigate to the first image on the first page.
        let media_ids = data_source.id_list.media_ids_by_page.get(1);
        console.log("files for double click:", media_ids?.length);
        if(media_ids != null)
            main_controller.show_media(media_ids[0], {add_to_history: true, source: "dblclick"});
    }
};

class local_navigation_widget_item extends ppixiv.tree_widget_item
{
    constructor({path, ...options}={})
    {
        super({...options,
            expandable: true,
            pending: true,
        });

        this.options = options;
        this.path = path;

        // Set the ID on the item to let the popup menu know what it is.  Don't do
        // this for top-level libraries ("folder:/images"), since they can't be
        // bookmarked.
        let { id } = helpers.parse_media_id(this.path);
        let is_library = id.indexOf("/", 1) == -1;
        if(!is_library)
            this.container.dataset.mediaId = this.path;

        if(options.root)
        {
            // As we load nodes in this tree, we'll index them by ID here.
            this.nodes = {};
            this.nodes[path] = this;
        }
    }

    // This is called by the tree when an illust changes to let us refresh, so we don't need
    // to register an illust change callback for every node.
    illust_changed(media_id)
    {
        // Refresh if we're displaying the illust that changed.
        if(media_id == this.path)
            this.refresh();
    }

    // In addition to the label, refresh the bookmark icon.
    refresh()
    {
        super.refresh();

        // Show or hide the bookmark icon.
        let info = media_cache.get_media_info_sync(this.path, { full: false });
        let bookmarked = info?.bookmarkData != null;
        this.container.querySelector(".button-bookmark").hidden = !bookmarked;

        // This is useful, but the pointless browser URL popup covering the UI is really annoying...
        /* if(this.path)
        {
            let label = this.container.querySelector(".label");
            let args = helpers.args.location;
            local_api.get_args_for_id(this.path, args);
            // label.href = args.url.toString();
        } */
    }

    async onexpand()
    {
        return await this.load();
    }

    onclick()
    {
        this.tree.show_item(this.path);
    }

    load()
    {
        if(this.loaded)
            return Promise.resolve(true);

        // If we're already loading this item, just let it complete.
        if(this.load_promise)
            return this.load_promise;

        this.load_promise = this.load_inner();

        this.load_promise.then((success) => {
            if(!success)
                return;
                
            // Refresh the selection in case this loaded the search we're currently on.
            this.tree.refresh_selection();
        });

        this.load_promise.finally(() => {
            this.load_promise = null;
        });

        return this.load_promise;
    }

    async load_inner(item)
    {
        if(this.loaded)
            return true;
        this.loaded = true;

        let result = await local_api.list(this.path, {
            id: this.path,

            // This tells the server to only include directories.  It's much faster, since
            // it doesn't need to scan images for metadata, and it disables pagination and gives
            // us all results at once.
            directories_only: true,
        });

        if(!result.success)
        {
            this.loaded = false;
            return false;
        }

        // If this is the top-level item, this is a list of archives.  If we have only one
        // archive, populate the top level with the top leve of the archive instead, so we
        // don't have an expander with just one item.
        // Not sure this is worth it.  It adds special cases elsewhere, since it makes the
        // tree structure different (local_navigation_widget.load_path is broken, etc).
        /*
        if(this.path == "folder:/" && result.results.length == 1)
        {
            // Top-level items are always folders.
            console.assert(result.results[0].mediaId.startsWith("folder:/"));
            this.path = result.results[0].mediaID;
            return await this.load_inner();
        }
        */

        for(let dir of result.results)
        {
            // Strip "folder:" off of the name, and use the basename of that as the label.
            let {type } = helpers.parse_media_id(dir.mediaId);
            if(type != "folder")
                continue;
    
            let child = new local_navigation_widget_item({
                parent: this,
                label: dir.illustTitle,
                path: dir.mediaId,
            });

            // Store ourself on the root node's node list.
            this.root_node.nodes[child.path] = child;

            // If we're the root, expand our children as they load, so the default tree
            // isn't just one unexpanded library.
            if(this.path == "folder:/")
                child.expanded = true;
        }

        return true;
    }
}

// A tree view for navigation with the local image API.
// XXX: keyboard navigation?
ppixiv.local_navigation_widget = class extends ppixiv.tree_widget
{
    constructor({...options}={})
    {
        super({...options,
            add_root: false,
        });

        this.load_path = new SentinelGuard(this.load_path, this);

        // Root local_navigation_widget_items will be stored here when
        // set_data_source_search_options is called.  Until that happens, we have
        // no root.
        this.roots = {};

        window.addEventListener("pp:popstate", (e) => {
            this.set_root_from_url();
            this.refresh_selection();
        });

        this.set_root_from_url();
        this.refresh_selection();
    }

    // Choose a tree root for the current URL, creating one if needed.
    set_root_from_url()
    {
        // Don't load a root if we're not currently on local search.
        let args = helpers.args.location;
        if(args.path != local_api.path)
            return;

        if(this._root == null)
        {
            // Create this tree.
            this._root = new local_navigation_widget_item({
                parent: this,
                label: "/",
                root: true,
                path: "folder:/",
            });
        }

        this.set_root(this._root);
    }

    set_root(root)
    {
        super.set_root(root);
        
        // Make sure the new root is loaded.
        root.load();
    }

    // If a search is active, select its item.
    async refresh_selection()
    {
        if(this.root == null)
            return;

        // If we're not on a /local/ search, just deselect.
        let args = helpers.args.location;
        if(args.path != local_api.path)
        {
            this.set_selected_item(null);
            return;
        }

        // Load the path if possible and select it.
        let node = await this.load_path(args);
        if(node)
        {
            node.select();
            return;
        }
    }

    // Load and expand each component of path.
    //
    // This call is guarded, so if we're called again from another navigation,
    // we won't keep loading and changing the selection.
    async load_path(signal, args)
    {
        // Stop if we don't have a root yet.
        if(this.root == null)
            return;

        // Wait until the root is loaded, if needed.
        await this.root.load();
        signal.check();

        let media_id = local_api.get_local_id_from_args(args, { get_folder: true });
        let { id } = helpers.parse_media_id(media_id);

        // Split apart the path.
        let parts = id.split("/");

        // Discard the last component.  We only need to load the directory containing the
        // path, not the directory itself.
        parts.splice(parts.length-1, 1);

        // Incrementally load each directory component.
        //
        // Note that if we're showing a search, items at the top of the tree will be from
        // random places further down the filesystem.  We can do the same thing here: if
        // we're trying to load /a/b/c/d/e and the search node points to /a/b/c, we skip
        // /a and /a/b which aren't in the tree and start loading from there.
        let current_path = "";
        let node = null;
        for(let part of parts)
        {
            // Append this path component to current_path.
            if(current_path == "")
                current_path = "folder:/";
            else if(current_path != "folder:/")
                current_path += "/";
            current_path += part;

            // If this directory exists in the tree, it'll be in nodes by now.
            node = this.root.nodes[current_path];
            if(node == null)
            {
                // console.log("Path doesn't exist:", current_path);
                continue;
            }

            // Expand the node.  This will trigger a load if needed.
            node.expanded = true;

            // If the node is loading, wait for the load to finish.
            if(node.load_promise)
                await node.load_promise;
            signal.check();
        }

        return this.root.nodes[media_id];
    }

    // Navigate to media_id, which should be an entry in the current tree.
    show_item(media_id)
    {
        let args = new helpers.args(ppixiv.plocation);
        local_api.get_args_for_id(media_id, args);
        helpers.navigate(args);

        // Hide the hover thumbnail on click to get it out of the way.
        this.set_hover(null);
    }
};

function remove_recent_local_search(search)
{
    // Remove tag from the list.  There should normally only be one.
    var recent_tags = settings.get("local_searches") || [];
    while(1)
    {
        var idx = recent_tags.indexOf(search);
        if(idx == -1)
            break;
        recent_tags.splice(idx, 1);
    }
    settings.set("local_searches", recent_tags);
    window.dispatchEvent(new Event("recent-local-searches-changed"));
}


// local_search_box_widget and local_search_dropdown_widget are dumb copy-pastes
// of tag_search_box_widget and tag_search_dropdown_widget.  They're simpler and
// much less used, and it didn't seem worth creating a shared base class for these.
ppixiv.local_search_box_widget = class extends ppixiv.widget
{
    constructor({...options})
    {
        super(options);

        this.input_element = this.container.querySelector(".input-field-container > input");

        this.dropdown_widget = new local_search_dropdown_widget({
            container: this.container,
            input_element: this.container,
            focus_parent: this.container,
        });

        this.input_element.addEventListener("keydown", (e) => {
            // Exit the search box if escape is pressed.
            if(e.key == "Escape")
            {
                this.input_element.blur();
                this.dropdown_widget.hide();
            }
        });

        this.input_element.addEventListener("focus", this.input_onfocus);
        this.input_element.addEventListener("submit", this.submit_search);
        this.clear_search_button = this.container.querySelector(".clear-local-search-button");
        this.clear_search_button.addEventListener("click", (e) => {
            this.input_element.value = "";
            this.input_element.dispatchEvent(new Event("submit"));
        });
        this.container.querySelector(".submit-local-search-button").addEventListener("click", (e) => {
            this.input_element.dispatchEvent(new Event("submit"));
        });

        this.input_element.addEventListener("input", (e) => {
            this.refresh_clear_button_visibility();
        });

        // Search submission:
        helpers.input_handler(this.input_element, this.submit_search);

        // Hide the dropdowns on navigation.
        new view_hidden_listener(this.input_element, (e) => {
            this.dropdown_widget.hide();
        });
        
        window.addEventListener("pp:popstate", (e) => { this.refresh_from_location(); });
        this.refresh_from_location();
        this.refresh_clear_button_visibility();
    }

    // SEt the text box from the current URL.
    refresh_from_location()
    {
        let args = helpers.args.location;
        this.input_element.value = args.hash.get("search") || "";
        this.refresh_clear_button_visibility();
    }

    refresh_clear_button_visibility()
    {
        this.clear_search_button.hidden = this.input_element.value == "";
    }

    // Show the dropdown when the input is focused.  Hide it when the input is both
    // unfocused and this.container isn't being hovered.  This way, the input focus
    // can leave the input box to manipulate the dropdown without it being hidden,
    // but we don't rely on hovering to keep the dropdown open.
    input_onfocus = (e) =>
    {
        this.input_focused = true;
        this.dropdown_widget.show();
    }

    submit_search = (e) =>
    {
        let tags = this.input_element.value;
        local_api.navigate_to_tag_search(tags);

        // If we're submitting by pressing enter on an input element, unfocus it and
        // close any widgets inside it (tag dropdowns).
        if(e.target instanceof HTMLInputElement)
        {
            e.target.blur();
            view_hidden_listener.send_viewhidden(e.target);
        }
    }
}

ppixiv.local_search_dropdown_widget = class extends ppixiv.widget
{
    constructor({input_element, focus_parent, ...options})
    {
        super({...options, template: `
            <div class=search-history>
                <div class=input-dropdown>
                    <div class="input-dropdown-contents input-dropdown-list">
                        <!-- template-tag-dropdown-entry instances will be added here. -->
                    </div>
                </div>
            </div>
        `});

        this.input_element = input_element;

        // While we're open, we'll close if the user clicks outside focus_parent.
        this.focus_parent = focus_parent;

        // Refresh the dropdown when the search history changes.
        window.addEventListener("recent-local-searches-changed", this.populate_dropdown);

        this.container.addEventListener("click", this.dropdown_onclick);

        // input-dropdown is resizable.  Save the size when the user drags it.
        this.input_dropdown = this.container.querySelector(".input-dropdown-list");

        // Restore input-dropdown's width.
        let refresh_dropdown_width = () => {
            let width = settings.get("tag-dropdown-width", "400");
            width = parseInt(width);
            this.container.style.setProperty('--width', `${width}px`);
        };

        let observer = new MutationObserver((mutations) => {
            // resize sets the width.  Use this instead of offsetWidth, since offsetWidth sometimes reads
            // as 0 here.
            settings.set("tag-dropdown-width", this.input_dropdown.style.width);
        });
        observer.observe(this.input_dropdown, { attributes: true });

        // Restore input-dropdown's width.
        refresh_dropdown_width();

        this.shown = false;
        this.container.hidden = true;

        // Sometimes the popup closes when searches are clicked and sometimes they're not.  Make sure
        // we always close on navigation.
        this.container.addEventListener("click", (e) => {
            if(e.defaultPrevented)
                return;
            let a = e.target.closest("A");
            if(a == null)
                return;

            this.input_element.blur();
            this.hide();
        });
    }

    // Hide if the user clicks outside us.
    window_onclick = (e) =>
    {
        if(helpers.is_above(this.focus_parent, e.target))
            return;

        this.hide();
    }

    dropdown_onclick = (e) =>
    {
        var remove_entry = e.target.closest(".remove-history-entry");
        if(remove_entry != null)
        {
            // Clicked X to remove a tag from history.
            e.stopPropagation();
            e.preventDefault();

            let tag = e.target.closest(".entry").dataset.tag;
            remove_recent_local_search(tag);
            return;
        }

        // Close the dropdown if the user clicks a tag (but not when clicking
        // remove-history-entry).
        if(e.target.closest(".tag"))
            this.hide();
    }

    show()
    {
        if(this.shown)
            return;
        this.shown = true;

        // Fill in the dropdown before displaying it.
        this.populate_dropdown();

        this.container.hidden = false;

        window.addEventListener("click", this.window_onclick, true);
        helpers.set_max_height(this.input_dropdown);
    }

    hide()
    {
        if(!this.shown)
            return;
        this.shown = false;

        this.container.hidden = true;
        window.removeEventListener("click", this.window_onclick, true);

        // Make sure the input isn't focused.
        this.input_element.blur();
    }

    create_entry(search)
    {
        let entry = this.create_template({name: "tag-dropdown-entry", html: `
            <a class=entry href=#>
                <span class=search></span>
                <span class="right-side-buttons">
                    <span class="remove-history-entry right-side-button keep-menu-open">X</span>
                </span>
            </a>
        `});
        entry.dataset.tag = search;

        let span = document.createElement("span");
        span.innerText = search;

        entry.querySelector(".search").appendChild(span);

        let args = new helpers.args("/", ppixiv.plocation);
        args.path = local_api.path;
        args.hash_path = "/";
        args.hash.set("search", search);
        entry.href = args.url;
        return entry;
    }

    // Populate the tag dropdown.
    populate_dropdown = () =>
    {
        let tag_searches = settings.get("local_searches") || [];
        tag_searches.sort();

        let list = this.container.querySelector(".input-dropdown-list");
        helpers.remove_elements(list);

        for(let tag of tag_searches)
        {
            var entry = this.create_entry(tag);
            entry.classList.add("history");
            list.appendChild(entry);
        }
    }
}

// A button to show an image in Explorer.
//
// This requires view_in_explorer.pyw be set up.
ppixiv.view_in_explorer_widget = class extends ppixiv.illust_widget
{
    constructor({...options})
    {
        super({...options});

        this.enabled = false;

        // Ignore clicks on the button if it's disabled.
        this.container.addEventListener("click", (e) => {
            if(this.enabled)
                return;

            e.preventDefault();
            e.stopPropagation();
        });
    }

    refresh_internal({ media_id, media_info })
    {
        // Hide the button if we're not on a local image.
        this.container.closest(".button-container").hidden = !helpers.is_media_id_local(media_id);
        
        let path = media_info?.localPath;
        this.enabled = media_info?.localPath != null;
        helpers.set_class(this.container.querySelector("A.button"), "enabled", this.enabled);
        if(path == null)
            return;

        path = path.replace(/\\/g, "/");

        // We have to work around some extreme jankiness in the URL API.  If we create our
        // URL directly and then try to fill in the pathname, it won't let us change it.  We
        // have to create a file URL, fill in the pathname, then replace the scheme after
        // converting to a string.  Web!
        let url = new URL("file:///");
        url.pathname = path;
        url = url.toString();
        url = url.replace("file:", "vviewinexplorer:")

        let a = this.container.querySelector("A.local-link");
        a.href = url;

        // Set the popup for the type of ID.
        let { type } = helpers.parse_media_id(media_id);
        let popup = type == "file"? "View file in Explorer":"View folder in Explorer";
        a.dataset.popup = popup;
    }
}
