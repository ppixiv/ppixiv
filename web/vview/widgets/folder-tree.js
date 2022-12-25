import Widget from 'vview/widgets/widget.js';
import LocalAPI from 'vview/misc/local-api.js';
import { helpers, SentinelGuard } from 'vview/misc/helpers.js';

class TreeWidget extends Widget
{
    constructor({
        addRoot=true,
        ...options})
    {
        super({...options, template: `
            <div class=tree>
                <div class=items>
                </div>
            </div>
        `});

        this._labelPopup = this.createTemplate({html: `
            <div class=tree-popup>
                <div class=label></div>
            </div>
        `});

        this._thumbPopup = this.createTemplate({html: `
            <div class=thumb-popup>
                <img class=img></div>
            </div>
        `});

        this.items = this.container.querySelector(".items");

        // Listen to illust changes so we can refresh nodes.
        ppixiv.mediaCache.addEventListener("mediamodified", this._mediaModified, { signal: this.shutdownSignal.signal });

        // Create the root item.  This is TreeWidgetItem or a subclass.
        if(addRoot)
        {
            let root = new TreeWidgetItem({
                parent: this,
                label: "root",
                root: true,
            });

            this.setRoot(root);
        }
    }

    _mediaModified = (e) =>
    {
        if(this.root == null)
            return;

        for(let node of Object.values(this.root.nodes))
        {
            if(node.illustChanged)
                node.illustChanged(e.mediaId);
        }
    }
    
    setRoot(root)
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
        root.expanded = "user";
    }

    setSelectedItem(item)
    {
        if(this.selectedItem == item)
            return;

        this.selectedItem = item;
        for(let node of this.container.querySelectorAll(".tree-item.selected"))
        {
            node.classList.remove("selected");

            // Collapse any automatically-expanded nodes that we're navigating out of, as
            // long as they're not an ancestor of the parent of the node we're expanding.
            // We don't need to keep the item itself expanded.
            node.widget._collapseAutoExpanded({untilAncestorOf: item?.parent});
        }

        if(item != null)
        {
            item.container.classList.add("selected");

            // If the item isn't visible, center it.
            //
            // Bizarrely, while there's a full options dict for scrollIntoView and you
            // can control horizontal and vertical scrolling separately, there's no "none"
            // option so you can scroll vertically and not horizontally.
            let scrollContainer = this.container;
            let label = item.container.querySelector(".label");

            let oldScrollLeft = scrollContainer.scrollLeft;

            label.scrollIntoView({ block: "nearest" });

            scrollContainer.scrollLeft = oldScrollLeft;
        }
    }

    // Update the hover popup.  This allows seeing the full label without needing
    // a horizontal scroller, and lets us display a quick thumbnail.
    setHover(item)
    {
        let img = this._thumbPopup.querySelector("img");

        if(item == null)
        {
            // Remove the hover, and clear the image so it doesn't flicker the next time
            // we display it.
            img.src = helpers.blankImage;
            this._labelPopup.remove();
            this._thumbPopup.remove();
            return;
        }

        let label = item.container.querySelector(".label");
        let {top, left, bottom, height} = label.getBoundingClientRect();

        // Set up thumbPopup.
        if(item.path)
        {
            let {right} = this.container.getBoundingClientRect();
            this._thumbPopup.style.left = `${right}px`;

            // If the label is above halfway down the screen, position the preview image
            // below it.  Otherwise, position it below.  This keeps the image from overlapping
            // the label.  We don't know the dimensions of the image here.
            let labelCenter = top + height/2;
            let belowMiddle = labelCenter > window.innerHeight/2;

            if(belowMiddle)
            {
                // Align the bottom of the image to the top of the label.
                this._thumbPopup.style.top = `${top - 20}px`;
                img.style.objectPosition = "left bottom";
                this._thumbPopup.style.transform = "translate(0, -100%)";
            } else {
                // Align the top of the image to the bottom of the label.
                this._thumbPopup.style.top = `${bottom+20}px`;
                img.style.objectPosition = "left top";
                this._thumbPopup.style.transform = "";
            }

            // Don't show a thumb for roots.  Searches don't have thumbnails, and it's not useful
            // for most others.
            img.hidden = item.isRoot;
            img.crossOriginMode = "use-credentials";
            if(!item.isRoot)
            {
                // Use /tree-thumb for these thumbnails.  They're the same as the regular thumbs,
                // but it won't give us a folder image if there's no thumb.
                let url = LocalAPI.localUrl;
                url.pathname = "tree-thumb/" + item.path;
                img.src = url;
                img.addEventListener("img", (e) => { console.log("error"); img.hidden = true; });
            }
            
            document.body.appendChild(this._thumbPopup);
        }

        // Set up labelPopup.
        {
            this._labelPopup.style.left = `${left}px`;
            this._labelPopup.style.top = `${top}px`;

            // Match the padding of the label.
            this._labelPopup.style.padding = getComputedStyle(label).padding;
            this._labelPopup.querySelector(".label").innerText = item.label;
            document.body.appendChild(this._labelPopup);
        }
    }
}

class TreeWidgetItem extends Widget
{
    // If root is true, this is the root item being created by a TreeWidget.  Our
    // parent is the TreeWidget and our container is TreeWidget.items.
    //
    // If root is false (all items created by the user) and parent is a TreeWidget, our
    // real parent is the TreeWidget's root item.  Otherwise, parent is always another
    // TreeWidgetItem.
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
        // If this isn't a root node and parent is a TreeWidget, use the TreeWidget's
        // root node as our parent instead of the tree widget itself.
        if(!root && parent instanceof TreeWidget)
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
        helpers.html.setClass(this.container, "top", !root && parent.root);
        helpers.html.setClass(this.container, "child", !root && !parent.root);

        this.items = this.container.querySelector(".items");
        this.expander = this.container.querySelector(".expander");
        this.isRoot = root;
        this._expandable = expandable;
        this._expanded = false;
        this._pending = pending;
        this._label = label;

        // Our root node:
        this.rootNode = root? this:this.parent.rootNode;

        // If we're the root node, the tree is our parent.  Otherwise, copy the tree from
        // our parent.
        this.tree = root? this.parent:this.parent.tree;

        this.expander.addEventListener("click", (e) => {
            this.expanded = this.expanded? false:"user";
        });

        let labelElement = this.container.querySelector(".label");
        labelElement.addEventListener("dblclick", this.ondblclick);

        labelElement.addEventListener("mousedown", (e) => {
            if(e.button != 0)
                    return;

            e.preventDefault();
            e.stopImmediatePropagation();

            this.select({user: true});
            this.onclick();
        }, { capture: true });

        labelElement.addEventListener("mouseover", (e) => {
            this.tree.setHover(this);
        }, {
            capture: false,
        });

        labelElement.addEventListener("mouseout", (e) => {
            this.tree.setHover(null);
        }, {
            capture: false,
        });

        this._refreshExpandMode();

        if(this.parent instanceof TreeWidgetItem)
        {
            this.parent._refreshExpandMode();
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

    // Expanded is false (collapsed), "auto" (expanded due to navigation), or user (expanded by the user).
    set expanded(value)
    {
        if(this._expanded == value)
            return;

        // If we're already expanded by the user, don't downgrade to automatically expanded.
        if(value == "auto" && this._expanded == "user")
            return;

        // Don't unexpand the root.
        if(!value && this.isRoot)
            return;

        this._expanded = value;

        // If we're pending, call onexpand the first time we're expanded so we can
        // be populated.  We'll stay pending and showing the hourglass until onexpand
        // completes.
        if(this._expanded)
            this._loadContents();

        this._refreshExpandMode();
    }
    
    async _loadContents()
    {
        // Stop if we're already loaded.
        if(!this._pending)
            return;

        if(this._loadPromise != null)
        {
            try {
                await this._loadPromise;
            } catch(e) {
                // The initial call to _loadContents will print the error.
            }
            return;
        }

        // Start a load if one isn't already running.
        // Start the load.
        this._loadPromise = this.onexpand();

        this._loadPromise.finally(() => {
            this.pending = false;
            this._loadPromise = null;
        });

        try {
            if(await this._loadPromise)
                return;
        } catch(e) {
            console.log("Error expanding", this, e);
        }

        // If onexpand() threw an exception or returned false, there was an error loading the
        // node.  Unexpand it rather than leaving it marked complete, so it can be retried.
        this._pending = true;
        this._expanded = false;
        this._refreshExpandMode();
    }

    set expandable(value)
    {
        if(this._expandable == value)
            return;
        this._expandable = value;
        this._refreshExpandMode();
    }

    set pending(value)
    {
        if(this._pending == value)
            return;
        this._pending = value;
        this._refreshExpandMode();
    }

    get expanded() { return this._expanded;}
    get expandable() { return this._expandable; }
    get pending() { return this._pending; }
    
    // Return an array of this node's child TreeWidgetItems.
    get childNodes()
    {
        let result = [];
        for(let child = this.items.firstElementChild; child != null; child = child.nextElementSibling)
            if(child.widget)
                result.push(child.widget);
        return result;
    }

    get displayedExpandMode()
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

    _refreshExpandMode()
    {
        this.expander.dataset.mode = this.displayedExpandMode;
        this.expander.dataset.pending = this._pending;
        this.items.hidden = !this._expanded || this._pending;
        helpers.html.setClass(this.container, "allow-content-visibility", this.displayedExpandMode != "expanded");
    }

    // user is true if the item is being selected by the user, so it shouldn't be automatically
    // collapsed, or false if it's being selected automatically.
    select({user=false}={})
    {
        this.tree.setSelectedItem(this);

        // If the user clicks an item, mark it as user-expanded if it was previously automatically
        // expanded.
        if(user)
            this._commitUserExpanded();
    }

    // Mark this item and all of its ancestors as expanded by the user.  This will prevent this tree
    // from being collapsed automatically when the user navigates away from it.
    _commitUserExpanded()
    {
        let widget = this;
        while(widget != null && !widget.isRoot)
        {
            if(widget.expanded)
                widget.expanded = "user";
            widget = widget.parent;
        }
    }

    // If this item was automatically expanded, collapse it, and repeat on our parent nodes.
    //
    // If untilAncestorOf is given, stop collapsing nodes if we reach an ancestor of that
    // node.  For example, if we're navigating from "a/b/c/d/e" and untilAncestorOf is
    // "a/b/f/g/h", we'll stop when we reach the shared ancestor, "a/b".  This prevents us
    // from collapsing nodes that the new selection will want expanded.
    _collapseAutoExpanded({untilAncestorOf}={})
    {
        // Make a set of ancestor nodes we'll stop at.
        let stopNodes = new Set();
        for(let node = untilAncestorOf; node != null; node = node.parent)
            stopNodes.add(node);

        let widget = this;
        while(widget != null && !widget.isRoot)
        {
            // Stop if we've reached a shared ancestor.
            if(stopNodes.has(widget))
                break;

            if(widget.expanded == "auto")
                widget.expanded = false;

            widget = widget.parent;
        }
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
        this.parent._refreshExpandMode();

        this.parent = null;
    }

    ondblclick = async(e) =>
    {
        e.preventDefault();
        e.stopImmediatePropagation();

        console.log("ondblclick");
        this.expanded = this.expanded? false:"user";

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
        await this._loadContents();

        // If there are any children that we just expanded, stop.
        if(this.childNodes.length != 0)
            return;

        // The dblclick should have set the data source to this entry.  Grab the
        // data source.
        let dataSource = ppixiv.app.currentDataSource;
        console.log("data source for double click:", dataSource);

        // Load the first page.  This will overlap with the search loading it, and
        // will wait on the same request.
        if(!dataSource.idList.isPageLoaded(1))
            await dataSource.loadPage(1);

        // Navigate to the first image on the first page.
        let mediaIds = dataSource.idList.mediaIdsByPage.get(1);
        console.log("files for double click:", mediaIds?.length);
        if(mediaIds != null)
            ppixiv.app.showMediaId(mediaIds[0], {addToHistory: true, source: "dblclick"});
    }
};

class LocalNavigationWidgetItem extends TreeWidgetItem
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
        let { id } = helpers.mediaId.parse(this.path);
        let isLibrary = id.indexOf("/", 1) == -1;
        if(!isLibrary)
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
    illustChanged(mediaId)
    {
        // Refresh if we're displaying the illust that changed.
        if(mediaId == this.path)
            this.refresh();
    }

    // In addition to the label, refresh the bookmark icon.
    refresh()
    {
        super.refresh();

        // Show or hide the bookmark icon.
        let info = ppixiv.mediaCache.getMediaInfoSync(this.path, { full: false });
        let bookmarked = info?.bookmarkData != null;
        this.container.querySelector(".button-bookmark").hidden = !bookmarked;

        // This is useful, but the pointless browser URL popup covering the UI is really annoying...
        /* if(this.path)
        {
            let label = this.container.querySelector(".label");
            let args = helpers.args.location;
            LocalAPI.getArgsForId(this.path, args);
            // label.href = args.url.toString();
        } */
    }

    async onexpand()
    {
        return await this.load();
    }

    onclick()
    {
        this.tree.showItem(this.path);
    }

    load()
    {
        if(this.loaded)
            return Promise.resolve(true);

        // If we're already loading this item, just let it complete.
        if(this._loadPromise)
            return this._loadPromise;

        this._loadPromise = this.loadInner();

        this._loadPromise.finally(() => {
            this._loadPromise = null;
        });

        return this._loadPromise;
    }

    async loadInner(item)
    {
        if(this.loaded)
            return true;
        this.loaded = true;

        let result = await ppixiv.mediaCache.localSearch(this.path, {
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

        for(let dir of result.results)
        {
            // Strip "folder:" off of the name, and use the basename of that as the label.
            let {type } = helpers.mediaId.parse(dir.mediaId);
            if(type != "folder")
                continue;
    
            let child = new LocalNavigationWidgetItem({
                parent: this,
                label: dir.illustTitle,
                path: dir.mediaId,
            });

            // Store ourself on the root node's node list.
            this.rootNode.nodes[child.path] = child;

            // If we're the root, expand our children as they load, so the default tree
            // isn't just one unexpanded library.
            if(this.path == "folder:/")
                child.expanded = "user";
        }

        return true;
    }
}

// A tree view for navigation with the local image API.
export default class LocalNavigationTreeWidget extends TreeWidget
{
    constructor({...options}={})
    {
        super({...options,
            addRoot: false,
        });

        this._loadPath = new SentinelGuard(this.loadPath, this);

        // Root LocalNavigationWidgetItems will be stored here when
        // set_data_source_search_options is called.  Until that happens, we have
        // no root.
        this.roots = {};

        window.addEventListener("pp:popstate", (e) => {
            this.setRootFromUrl();
            this.refreshSelection();
        });

        this.setRootFromUrl();

        // Display the initial selection.  Mark this as user-expanded, so it won't be automatically
        // collapsed.
        this.refreshSelection({ user: true });
    }

    // Choose a tree root for the current URL, creating one if needed.
    setRootFromUrl()
    {
        // Don't load a root if we're not currently on local search.
        let args = helpers.args.location;
        if(args.path != LocalAPI.path)
            return;

        if(this._root == null)
        {
            // Create this tree.
            this._root = new LocalNavigationWidgetItem({
                parent: this,
                label: "/",
                root: true,
                path: "folder:/",
            });
        }

        this.setRoot(this._root);
    }

    setRoot(root)
    {
        super.setRoot(root);
        
        // Make sure the new root is loaded.
        root.load();
    }

    // If a search is active, select its item.
    async refreshSelection({user=false}={})
    {
        if(this.root == null)
            return;

        // If we're not on a /local/ search, just deselect.
        let args = helpers.args.location;
        if(args.path != LocalAPI.path)
        {
            this.setSelectedItem(null);
            return;
        }

        // Load the path if possible and select it.
        let node = await this._loadPath({ args, user });
        if(node)
        {
           
            node.select({user});
            return;
        }
    }

    // Load and expand each component of path.  If user is true, the item is marked
    // user-expanded, otherwise automatically-expanded.
    //
    // This call is guarded, so if we're called again from another navigation,
    // we won't keep loading and changing the selection.
    async loadPath(signal, { args, user=false }={})
    {
        // Stop if we don't have a root yet.
        if(this.root == null)
            return;

        // Wait until the root is loaded, if needed.
        await this.root.load();
        signal.check();

        let mediaId = LocalAPI.getLocalIdFromArgs(args, { getFolder: true });
        let { id } = helpers.mediaId.parse(mediaId);

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
        let currentPath = "";
        let node = null;
        for(let part of parts)
        {
            // Append this path component to currentPath.
            if(currentPath == "")
                currentPath = "folder:/";
            else if(currentPath != "folder:/")
                currentPath += "/";
            currentPath += part;

            // If this directory exists in the tree, it'll be in nodes by now.
            node = this.root.nodes[currentPath];
            if(node == null)
            {
                // console.log("Path doesn't exist:", currentPath);
                continue;
            }

            // Expand the node.  This will trigger a load if needed.
            node.expanded = user? "user":"auto";

            // If the node is loading, wait for the load to finish.
            if(node._loadPromise)
                await node._loadPromise;
            signal.check();
        }

        return this.root.nodes[mediaId];
    }

    // Navigate to mediaId, which should be an entry in the current tree.
    showItem(mediaId)
    {
        let args = new helpers.args(ppixiv.plocation);
        LocalAPI.getArgsForId(mediaId, args);
        helpers.navigate(args);

        // Hide the hover thumbnail on click to get it out of the way.
        this.setHover(null);
    }
};
