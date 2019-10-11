var debug_show_ui = false;

// This runs first and sets everything else up.
class early_controller
{
    constructor()
    {
        // Early initialization.  This happens before anything on the page is loaded, since
        // this script runs at document-start.
        //
        // If this is an iframe, don't do anything.  This may be a helper iframe loaded by
        // load_data_in_iframe, in which case the main page will do the work.
        if(window.top != window.self)
            return;

        // Don't activate for things like sketch.pixiv.net.
        if(document.location.hostname != "www.pixiv.net")
            return;

        console.log("ppixiv setup");

        // catch_bind isn't available if we're not active, so we use bind here.
        this.dom_content_loaded = this.dom_content_loaded.bind(this);
        if(document.readyState == "loading")
            window.addEventListener("DOMContentLoaded", this.dom_content_loaded, true);
        else
            setTimeout(this.dom_content_loaded, 0);

        if(!page_manager.singleton().active)
            return;

        // Do early setup.  This happens early in page loading, without waiting for DOMContentLoaded.
        // Unfortunately TamperMonkey doesn't correctly call us at the very start of the page in
        // Chrome, so this doesn't happen until some site scripts have had a chance to run.

        // Pixiv scripts run on DOMContentLoaded and load, whichever it sees first.  Add capturing
        // listeners on both of these and block propagation, so those won't be run.  This keeps most
        // of the site scripts from running underneath us.  Make sure this is registered after our
        // own DOMContentLoaded listener above, or it'll block ours too.
        //
        // This doesn't always work in Chrome.  TamperMonkey often runs user scripts very late,
        // even after DOMContentLoaded has already been sent, even in run-at: document-start.
        var stop_event = function(e) {
            e.preventDefault();
            e.stopImmediatePropagation();
        };
        if(document.readyState == "loading")
            window.addEventListener("DOMContentLoaded", stop_event, true);
        window.addEventListener("load", stop_event, true);

        // Install polyfills.  Make sure we only do this if we're active, so we don't
        // inject polyfills into Pixiv when we're not active.
        install_polyfills();

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
        for(var key of ["onerror", "_send", "_time", "webpackJsonp"])
        {
            unsafeWindow[key] = null;
            Object.defineProperty(unsafeWindow, key, { define: exportFunction(function(value) { }, unsafeWindow) });
        }

        // Try to prevent site scripts from running, since we don't need any of it.
        if(navigator.userAgent.indexOf("Firefox") != -1)
            helpers.block_all_scripts();

        this.temporarily_hide_document();
    }

    dom_content_loaded(e)
    {
        try {
            this.setup();
        } catch(e) {
            // GM error logs don't make it to the console for some reason.
            console.log(e);
        }
    }

    temporarily_hide_document()
    {
        if(document.documentElement != null)
        {
            document.documentElement.hidden = true;
            return;
        }

        // At this point, none of the document has loaded, and document.body and
        // document.documentElement don't exist yet, so we can't hide it.  However,
        // we want to hide the document as soon as it's added, so we don't flash
        // the original page before we have a chance to replace it.  Use a mutationObserver
        // to detect the document being created.
        var observer = new MutationObserver(function(mutation_list) {
            if(document.documentElement == null)
                return;
            observer.disconnect();

            document.documentElement.hidden = true;
        });

        observer.observe(document, { attributes: false, childList: true, subtree: true });
    };
 

    // This is called on DOMContentLoaded (whether we're active or not).
    setup()
    {
        // If we're not active, stop without doing anything and leave the page alone.
        if(!page_manager.singleton().active)
        {
            // If we're disabled and can be enabled on this page, add our button.
            this.setup_disabled_ui();

            if(page_manager.singleton().available())
            {
                // Remember that we're disabled in this tab.  This way, clicking the "return
                // to Pixiv" button will remember that we're disabled.  We do this on page load
                // rather than when the button is clicked so this works when middle-clicking
                // the button to open a regular Pixiv page in a tab.
                //
                // Only do this if we're available and disabled, which means the user disabled us.
                // If we wouldn't be available on this page at all, don't store it.
                page_manager.singleton().store_ppixiv_disabled(true);
            }
            
            return;
        }

        // Create the main controller.
        main_controller.create_singleton();

    }

    // When we're disabled, but available on the current page, add the button to enable us.
    setup_disabled_ui()
    {
        // On most pages, we show our button in the top corner to enable us on that page.  Clicking
        // it on a search page will switch to us on the same search.
        var disabled_ui = helpers.create_node(resources['disabled.html']);
        helpers.add_style('.ppixiv-disabled-ui > a { background-image: url("' + binary_data['activate-icon.png'] + '"); };');

        // If we're on a page that we don't support, like the top page, rewrite the link to switch to
        // a page we do support.
        if(!page_manager.singleton().available())
            disabled_ui.querySelector("a").href = "/ranking.php?mode=daily#ppixiv";

        document.body.appendChild(disabled_ui);
    };
}

// This handles high-level navigation and controlling the different views.
class main_controller
{
    // We explicitly create this singleton rather than doing it on the first call to
    // singleton(), so it's explicit when it's created.
    static create_singleton()
    {
        if(main_controller._singleton != null)
            throw "main_controller is already created";

        new main_controller();
    }

    static get singleton()
    {
        if(main_controller._singleton == null)
            throw "main_controller isn't created";

        return main_controller._singleton;
    }

    constructor()
    {
        main_controller._singleton = this;

        this.onkeydown = this.onkeydown.catch_bind(this);
        this.redirect_event_to_view = this.redirect_event_to_view.catch_bind(this);
        this.window_onclick_capture = this.window_onclick_capture.catch_bind(this);
        this.window_onpopstate = this.window_onpopstate.catch_bind(this);

        // Create the page manager.
        page_manager.singleton();

        this.setup();
    };

    setup()
    {
        // Try to init using globalInitData if possible.  data.userData is null if the user is logged out.
        var data = helpers.get_global_init_data(document);
        if(data && data.userData == null)
            data = null;

        // This is the global "pixiv" object, which is used on older pages.
        var pixiv = helpers.get_pixiv_data(document);
        if(pixiv && (pixiv.user == null || pixiv.user.id == null))
            pixiv = null;

        // If we don't have either of these (or we're logged out), stop and let the regular page display.
        // It may be a page we don't support.
        if(data == null && pixiv == null)
        {
            console.log("Couldn't find context data.  Are we logged in?");
            document.documentElement.hidden = false;
            return;
        }

        console.log("Starting");

        // We know that we have enough info to continue, so we can do this now.
        //
        // Try to prevent the underlying page from making requests.  It would be better to do this
        // earlier, in early_controller's constructor, but we don't know for sure whether we'll be
        // able to continue at that point, and we don't want to do this if we aren't.  This used to
        // matter more, but since browsers are bad and don't reliably allow user scripts to run early
        // anymore, this wouldn't prevent all early network requests anyway.
        //
        // This needs to be done before calling anything else, or our internal network requests
        // won't work.
        helpers.block_network_requests();

        if(data != null)
        {
            this.init_global_data(data.token, data.userData.id, data.premium && data.premium.popularSearch, data.mute, data.userData.xRestrict);

            // If data is available, this is a newer page with globalInitData.
            // This can have one or more user and/or illust data, which we'll preload
            // so we don't need to fetch it later.
            //
            // Preload users before illusts.  Otherwise, adding the illust will cause image_data
            // to fetch user info to fill it in.
            for(var preload_user_id in data.preload.user)
                image_data.singleton().add_user_data(data.preload.user[preload_user_id]);
            for(var preload_illust_id in data.preload.illust)
                image_data.singleton().add_illust_data(data.preload.illust[preload_illust_id]);
        }
        else
        {
            this.init_global_data(pixiv.context.token, pixiv.user.id, pixiv.user.premium, pixiv.user.mutes, pixiv.user.explicit);
        }

        window.addEventListener("click", this.window_onclick_capture);
        window.addEventListener("popstate", this.window_onpopstate);

        window.addEventListener("keyup", this.redirect_event_to_view, true);
        window.addEventListener("keydown", this.redirect_event_to_view, true);
        window.addEventListener("keypress", this.redirect_event_to_view, true);

        window.addEventListener("keydown", this.onkeydown);

        this.current_view_name = null;
        this.current_history_index = helpers.current_history_state_index();

        // Don't restore the scroll position.
        //
        // If we browser back to a search page and we were scrolled ten pages down, scroll
        // restoration will try to scroll down to it incrementally, causing us to load all
        // data in the search from the top all the way down to where we were.  This can cause
        // us to spam the server with dozens of requests.  This happens on F5 refresh, which
        // isn't useful (if you're refreshing a search page, you want to see new results anyway),
        // and recommendations pages are different every time anyway.
        //
        // This won't affect browser back from an image to the enclosing search.
        history.scrollRestoration = "manual";    
       
        // Remove everything from the page and move it into a dummy document.
        var html = document.createElement("document");
        helpers.move_children(document.head, html);
        helpers.move_children(document.body, html);

        // Copy the location to the document copy, so the data source can tell where
        // it came from.
        html.location = document.location;

        // Now that we've cleared the document, we can unhide it.
        document.documentElement.hidden = false;

        // Add binary resources as CSS styles.
        helpers.add_style('body .noise-background { background-image: url("' + binary_data['noise.png'] + '"); };');
        helpers.add_style('body.light .noise-background { background-image: url("' + binary_data['noise-light.png'] + '"); };');
        helpers.add_style('.ugoira-icon { background-image: url("' + binary_data['play-button.svg'] + '"); };');
        helpers.add_style('.page-icon { background-image: url("' + binary_data['page-icon.png'] + '"); };');
        
        // Add the main CSS style.
        helpers.add_style(resources['main.css']);
       
        // Create the page from our HTML resource.
        document.body.insertAdjacentHTML("beforeend", resources['main.html']);

        // Create the shared title and page icon.
        document.head.appendChild(document.createElement("title"));
        var document_icon = document.head.appendChild(document.createElement("link"));
        document_icon.setAttribute("rel", "icon");

        helpers.add_clicks_to_search_history(document.body);
         
        this.container = document.body;

        // Create the popup menu handler.
        this.context_menu = new main_context_menu(document.body);
        
        // Create the main progress bar.
        this.progress_bar = new progress_bar(this.container.querySelector(".loading-progress-bar"));
        
        // Create the thumbnail view handler.
        this.thumbnail_view = new view_search(this.container.querySelector(".view-search-container"));

        // Create the manga page viewer.
        this.manga_view = new view_manga(this.container.querySelector(".view-manga-container"));
        
        // Create the main UI.
        this.ui = new view_illust(this.container.querySelector(".view-illust-container"));

        this.views = {
            search: this.thumbnail_view,
            illust: this.ui,
            manga: this.manga_view,
        };

        // Create the data source for this page.
        this.set_current_data_source(html, "initialization");
    };

    window_onpopstate(e)
    {
        // Set the current data source and state.
        this.set_current_data_source(null, e.navigationCause || "history");
    }

    async refresh_current_data_source()
    {
        if(this.data_source == null)
            return;

        // Create a new data source for the same URL, replacing the previous one.
        // This returns the data source, but just call set_current_data_source so
        // we load the new one.
        console.log("Refreshing data source for", document.location.toString());
        await page_manager.singleton().create_data_source_for_url(document.location, null, true);
        await this.set_current_data_source(null, "refresh");
    }

    // Create a data source for the current URL and activate it.
    //
    // This is called on startup, and in onpopstate where we might be changing data sources.
    //
    // If this is on startup, html is the HTML elements on the page to pass to the data source
    // to preload the first page.  On navigation, html is null.  If we navigate to a page that
    // can load the first page from the HTML page, we won't load the HTML and we'll just allow
    // the first page to load like any other page.
    async set_current_data_source(html, cause)
    {
        // Get the current data source.  If we've already created it, this will just return
        // the same object and not create a new one.
        var data_source = await page_manager.singleton().create_data_source_for_url(document.location, html);

        // If the data source is changing, set it.
        if(this.data_source != data_source)
        {
            // Shut down the old data source.
            if(this.data_source != null)
                this.data_source.shutdown();

            // If we were showing a message for the old data source, it might be persistent,
            // so clear it.
            message_widget.singleton.hide();
            
            this.data_source = data_source;
            this.show_data_source_specific_elements();
            this.ui.set_data_source(data_source);
            this.thumbnail_view.set_data_source(data_source);
            this.context_menu.set_data_source(data_source);
            
            if(this.data_source != null)
                this.data_source.startup();
        }

        if(data_source == null)
            return;

        // Figure out which view to display.
        var new_view_name;
        var args = helpers.get_args(document.location);
        if(!args.hash.has("view"))
            new_view_name = this.data_source.default_view;
        else
            new_view_name = args.hash.get("view");

        var args = helpers.get_args(document.location);
        var illust_id = data_source.get_current_illust_id();
        var manga_page = args.hash.has("page")? parseInt(args.hash.get("page"))-1:null;

        // If we're on search, we don't care what image is current.  Clear illust_id so we
        // tell context_menu that we're not viewing anything, so it disables bookmarking.
        if(new_view_name == "search")
            illust_id = null;

        // if illust_id is set, need the image data to know whether to show manga pages
        // or the illust
        console.log("Loading data source.  View:", new_view_name, "Cause:", cause, "URL:", document.location.href);
        // Get the manga page in this illust to show, if any.
        console.log("  Show image", illust_id, "page", manga_page);

        // Mark the current view.  Other code can watch for this to tell which view is
        // active.
        document.body.dataset.currentView = new_view_name;

        // Set the image before activating the view.  If we do this after activating it,
        // it'll start loading any previous image it was pointed at.  Don't do this in
        // search mode, or we'll start loading the default image.
        if(new_view_name == "illust")
            this.ui.show_image(illust_id, manga_page);
        else if(new_view_name == "manga")
            this.manga_view.shown_illust_id = illust_id;
 
        var new_view = this.views[new_view_name];
        var old_view = this.views[this.current_view_name];
        var old_illust_id = old_view? old_view.displayed_illust_id:null;
        var old_illust_page = old_view? old_view.displayed_illust_page:null;

        // main_context_menu uses this to see which view is active.
        document.body.dataset.currentView = new_view_name;

        this.context_menu.illust_id = illust_id;
        
        // If we're changing between views, update the active view.
        var view_changing = new_view != old_view;
        if(view_changing)
        {
            this.current_view_name = new_view_name;

            // Make sure we deactivate the old view before activating the new one.
            if(old_view != null)
                old_view.active = false;
            if(new_view != null)
                new_view.active = true;
       
            // Dismiss any message when toggling between views.
            message_widget.singleton.hide();

            // If we're enabling the thumbnail, pulse the image that was just being viewed (or
            // loading to be viewed), to make it easier to find your place.
            if(new_view_name == "search" && old_illust_id != null)
                this.thumbnail_view.pulse_thumbnail(old_illust_id);
        }
        
        // Are we navigating forwards or back?
        var new_history_index = helpers.current_history_state_index();
        var navigating_forwards = cause == "history" && new_history_index > this.current_history_index;
        this.current_history_index = new_history_index;

        // Handle scrolling for the new state.
        //
        // We could do this better with history.state (storing each state's scroll position would
        // allow it to restore across browser sessions, and if the same data source is multiple
        // places in history).  Unfortunately there's no way to update history.state without
        // calling history.replaceState, which is slow and causes jitter.  history.state being
        // read-only is a design bug in the history API.
        if(cause == "navigation")
        {
            // If this is an initial navigation, eg. from a user clicking a link to a search, always
            // scroll to the top.  If this data source exists previously in history, we don't want to
            // restore the scroll position from back then.
            console.log("Scroll to top for new search");
            new_view.scroll_to_top();
        }
        else if(navigating_forwards)
        {
            // On browser history forwards, try to restore the scroll position.
            console.log("Restore scroll position for forwards navigation");
            new_view.restore_scroll_position();
        }
        else if(view_changing && old_illust_id != null)
        {
            // If we're navigating backwards or toggling, and we're switching from the image UI to thumbnails,
            // try to scroll the thumbnail view to the image that was displayed.  Otherwise, tell
            // the thumbnail view to restore any scroll position saved in the data source.
            console.log("Scroll to", old_illust_id, old_illust_page);
            new_view.scroll_to_illust_id(old_illust_id, old_illust_page);
        }
        else
        {
            new_view.restore_scroll_position();
        }
    }

    show_data_source_specific_elements()
    {
        // Show UI elements with this data source in their data-datasource attribute.
        var data_source_name = this.data_source.name;
        for(var node of this.container.querySelectorAll(".data-source-specific[data-datasource]"))
        {
            var data_sources = node.dataset.datasource.split(" ");
            var show_element = data_sources.indexOf(data_source_name) != -1;
            node.hidden = !show_element;
        }
    }

    // Show an illustration by ID.
    //
    // This actually just sets the history URL.  We'll do the rest of the work in popstate.
    show_illust(illust_id, options)
    {
        if(options == null)
            options = {};

        var manga_page = options.manga_page != null? options.manga_page:null;
        var add_to_history = options.add_to_history || false;
        var view = options.view || "illust";

        // Sanity check:
        if(illust_id == null)
        {
            console.error("Invalid illust_id", illust_id);
            return;
        }

        // Set the wanted illust_id in the URL, and disable the thumb view so we show
        // the image.  Do this in a single URL update, so we don't add multiple history
        // entries.
        var args = helpers.get_args(document.location);

        this._set_active_view_in_url(args.hash, view);
        this.data_source.set_current_illust_id(illust_id, args);

        // Remove any leftover page from the current illust.  We'll load the default.
        if(manga_page == null)
            args.hash.delete("page");
        else
            args.hash.set("page", manga_page + 1);

        helpers.set_args(args, add_to_history, "navigation");
    }

    // Return the displayed view instance.
    get displayed_view()
    {
        for(var view_name in this.views)
        {
            var view = this.views[view_name];
            if(view.active)
                return view;
        }        

        return null;
    }

    _set_active_view_in_url(hash_args, view)
    {
        hash_args.set("view", view);
    }

    set_displayed_view_by_name(view, add_to_history, cause)
    {
        // Update the URL to mark whether thumbs are displayed.
        var args = helpers.get_args(document.location);
        this._set_active_view_in_url(args.hash, view);
        helpers.set_args(args, add_to_history, cause);
    }

    // Navigate out.
    //
    // This navigates from the illust page to the manga page (for multi-page posts) or search, and
    // from the manga page to search.
    //
    // This is similar to browser back, but allows moving up to the search even for new tabs.  It
    // would be better for this to integrate with browser history (just browser back if browser back
    // is where we're going), but for some reason you can't view history state entries even if they're
    // on the same page, so there's no way to tell where History.back() would take us.
    _get_navigate_out_target()
    {
        var new_page = null;
        var view = this.displayed_view;

        // This gets called by the popup menu when it's created before we have any view.
        if(view == null)
            return [null, null];

        if(view == this.views.manga)
        {
            return ["search", "search"];
        }
        else if(view == this.views.illust)
        {
            var page_count = view.current_illust_data != null? view.current_illust_data.pageCount:1;
            if(page_count > 1)
                return ["manga", "page list"];
            else
                return ["search", "search"];
        }
        else
            return [null, null];
    }
    get navigate_out_label()
    {
        var target = this._get_navigate_out_target();
        return target[1];
    }
    navigate_out()
    {
        var target = this._get_navigate_out_target();
        var new_page = target[0];
        if(new_page != null)
            this.set_displayed_view_by_name(new_page, true /*add_to_history*/, "out");
    }

    // This captures clicks at the window level, allowing us to override them.
    //
    // When the user left clicks on a link that also goes into one of our views,
    // rather than loading a new page, we just set up a new data source, so we
    // don't have to do a full navigation.
    //
    // This only affects left clicks (middle clicks into a new tab still behave
    // normally).
    window_onclick_capture(e)
    {
        // Only intercept left clicks.
        if(e.button != 0)
            return;

        if(!(e.target instanceof Element))
            return;

        // Look up from the target for a link.
        var a = e.target.closest("A");
        if(a == null)
            return;

        // If this isn't a #ppixiv URL, let it run normally.
        var url = new URL(a.href, document.href);
        var is_ppixiv_url = helpers.parse_hash(url) != null;
        if(!is_ppixiv_url)
            return;

        // Stop all handling for this link.
        e.preventDefault();
        e.stopImmediatePropagation();

        // Search links to images always go to /artworks/#, but if they're clicked in-page we
        // want to stay on the same search and just show the image, so handle them directly.
        var url = new unsafeWindow.URL(url);
        url = helpers.get_url_without_language(url);
        if(url.pathname.startsWith("/artworks/"))
        {
            let parts = url.pathname.split("/");
            let illust_id = parts[2];
            var args = helpers.get_args(a.href);
            var page = args.hash.has("page")? parseInt(args.hash.get("page"))-1: null;
            var view = args.hash.has("view")? args.hash.get("view"):"illust";
            this.show_illust(illust_id, {
                view: view,
                manga_page: page,
                add_to_history: true
            });
            
            return;
        }

        // Navigate to the URL in-page.
        helpers.set_page_url(url, true /* add to history */, "navigation");
    }

    init_global_data(csrf_token, user_id, premium, mutes, content_mode)
    {
        var muted_tags = [];
        var muted_user_ids = [];
        for(var mute of mutes)
        {
            if(mute.type == 0)
                muted_tags.push(mute.value);
            else if(mute.type == 1)
                muted_user_ids.push(mute.value);
        }
        muting.singleton.set_muted_tags(muted_tags);
        muting.singleton.set_muted_user_ids(muted_user_ids);

        window.global_data = {
            // Store the token for XHR requests.
            csrf_token: csrf_token,
            user_id: user_id,
            include_r18: content_mode >= 1,
            include_r18g: content_mode >= 2,
        };

        // Set the .premium class on body if this is a premium account, to display features
        // that only work with premium.
        helpers.set_class(document.body, "premium", premium);

        // These are used to hide buttons that the user has disabled.
        helpers.set_class(document.body, "hide-r18", !window.global_data.include_r18);
        helpers.set_class(document.body, "hide-r18g", !window.global_data.include_r18g);
    };

    // Redirect keyboard events that didn't go into the active view.
    redirect_event_to_view(e)
    {
        var view = this.displayed_view;
        if(view == null)
            return;

        // If a popup is open, leave inputs alone.
        if(document.body.dataset.popupOpen)
            return;

        // If the keyboard input didn't go to an element inside the view, redirect
        // it to the view's container.
        var target = e.target;
        // If the event is going to an element inside the view already, just let it continue.
        if(helpers.is_above(view.container, e.target))
            return;

        // Clone the event and redispatch it to the view's container.
        var e2 = new e.constructor(e.type, e);
        if(!view.container.dispatchEvent(e2))
        {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
    }

    onkeydown(e)
    {
        // Ignore keypresses if we haven't set up the view yet.
        var view = this.displayed_view;
        if(view == null)
            return;

        // If a popup is open, leave inputs alone and don't process hotkeys.
        if(document.body.dataset.popupOpen)
            return;

        if(e.keyCode == 27) // escape
        {
            e.preventDefault();
            e.stopPropagation();

            this.navigate_out();

            return;
        }
       
        // Let the view handle the input.
        view.handle_onkeydown(e);
    }
};

new early_controller();

