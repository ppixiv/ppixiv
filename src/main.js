"use strict";

// This handles high-level navigation and controlling the different views.
ppixiv.main_controller = class
{
    // This is called by bootstrap at startup.  Just create ourself.
    static launch() { new this; }

    static get singleton()
    {
        if(main_controller._singleton == null)
            throw "main_controller isn't created";

        return main_controller._singleton;
    }

    constructor()
    {
        if(main_controller._singleton != null)
            throw "main_controller is already created";
        main_controller._singleton = this;
        this.initial_setup();
    }

    async initial_setup()
    {
        // If this is an iframe, don't do anything.
        if(window.top != window.self)
            return;

        // Don't activate for things like sketch.pixiv.net.
        if(document.location.hostname != "www.pixiv.net")
            return;

        // If we're not active, just see if we need to add our button, and stop without messing
        // around with the page more than we need to.
        if(!page_manager.singleton().active)
        {
            console.log("ppixiv is currently disabled");
            await helpers.wait_for_content_loaded();
            this.setup_disabled_ui();
            return;
        }

        console.log("ppixiv setup");

        // Install polyfills.  Make sure we only do this if we're active, so we don't
        // inject polyfills into Pixiv when we're not active.
        install_polyfills();

        // Run cleanup_environment.  This will try to prevent the underlying page scripts from
        // making network requests or creating elements, and apply other irreversible cleanups
        // that we don't want to do before we know we're going to proceed.
        helpers.cleanup_environment();

        this.temporarily_hide_document();

        // Wait for DOMContentLoaded to continue.
        await helpers.wait_for_content_loaded();

        // Continue with full initialization.
        await this.setup();
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
        var observer = new MutationObserver((mutation_list) => {
            if(document.documentElement == null)
                return;
            observer.disconnect();

            document.documentElement.hidden = true;
        });

        observer.observe(document, { attributes: false, childList: true, subtree: true });
    };

    // When we're disabled, but available on the current page, add the button to enable us.
    setup_disabled_ui()
    {
        // On most pages, we show our button in the top corner to enable us on that page.  Clicking
        // it on a search page will switch to us on the same search.
        var disabled_ui = helpers.create_node(resources['resources/disabled.html']);
        helpers.replace_inlines(disabled_ui);

        // If we're on a page that we don't support, like the top page, rewrite the link to switch to
        // a page we do support.
        if(!page_manager.singleton().available())
            disabled_ui.querySelector("a").href = "/ranking.php?mode=daily#ppixiv";

        document.body.appendChild(disabled_ui);

        if(page_manager.singleton().available_for_url(document.location))
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
    };

    // Load Pixiv's global info from doc.  This can be the document, or a copy of the
    // document that we fetched separately.  Return true on success.
    load_global_info_from_document(doc)
    {
        // This format is used on at least /new_illust.php.
        let global_data = doc.querySelector("#meta-global-data");
        if(global_data != null)
            global_data = JSON.parse(global_data.getAttribute("content"));

        // This is the global "pixiv" object, which is used on older pages.
        let pixiv = helpers.get_pixiv_data(doc);

        // Discard any of these that have no login info.
        if(global_data && global_data.userData == null)
            global_data = null;
        if(pixiv && (pixiv.user == null || pixiv.user.id == null))
            pixiv = null;

        if(global_data == null && pixiv == null)
            return false;

        if(global_data != null)
        {
            this.init_global_data(global_data.token, global_data.userData.id, global_data.userData.premium,
                    global_data.mute, global_data.userData.adult);
        }
        else
        {
            this.init_global_data(pixiv.context.token, pixiv.user.id, pixiv.user.premium,
                    pixiv.user.mutes, pixiv.user.explicit);
        }

        return true;
    }

    // This is where the actual UI starts.
    async setup()
    {
        console.log("Controller setup");

        this.onkeydown = this.onkeydown.bind(this);
        this.redirect_event_to_view = this.redirect_event_to_view.bind(this);
        this.window_onclick_capture = this.window_onclick_capture.bind(this);
        this.window_onpopstate = this.window_onpopstate.bind(this);

        // Create the page manager.
        page_manager.singleton();

        // Run any one-time settings migrations.
        settings.migrate();

        // Pixiv scripts that use meta-global-data remove the element from the page after
        // it's parsed for some reason.  Try to get global info from document, and if it's
        // not there, re-fetch the page to get it.
        if(!this.load_global_info_from_document(document))
        {
            console.log("Reloading page to get init data");

            // Some Pixiv pages try to force cache expiry.  We really don't want that to happen
            // here, since we just want to grab the page we're on quickly.  Setting cache: force_cache
            // tells Chrome to give us the cached page even if it's expired.
            let result = await helpers.load_data_in_iframe(document.location.toString(), {
                cache: "force-cache",
            });

            console.log("Finished loading init data");
            if(!this.load_global_info_from_document(result))
            {
                // Stop if we don't have anything.  This can happen if we're not logged in.
                console.log("Couldn't find context data.  Are we logged in?");
                document.documentElement.hidden = false;
                return;
            }
        }

        // See if the page has preload data.  This sometimes contains illust and user info
        // that the page will display, which lets us avoid making a separate API call for it.
        let preload = document.querySelector("#meta-preload-data");
        if(preload != null)
        {
            preload = JSON.parse(preload.getAttribute("content"));
            
            for(var preload_user_id in preload.user)
                image_data.singleton().add_user_data(preload.user[preload_user_id]);
            for(var preload_illust_id in preload.illust)
                image_data.singleton().add_illust_data(preload.illust[preload_illust_id]);
        }

        window.addEventListener("click", this.window_onclick_capture);
        window.addEventListener("popstate", this.window_onpopstate);

        window.addEventListener("keyup", this.redirect_event_to_view, true);
        window.addEventListener("keydown", this.redirect_event_to_view, true);
        window.addEventListener("keypress", this.redirect_event_to_view, true);

        window.addEventListener("keydown", this.onkeydown);

        this.current_view_name = null;
        this.current_history_index = helpers.current_history_state_index();

        // If the URL hash doesn't start with #ppixiv, the page was loaded with the base Pixiv
        // URL, and we're active by default.  Add #ppixiv to the URL.  If we don't do this, we'll
        // still work, but none of the URLs we create will have #ppixiv, so we won't handle navigation
        // directly and the page will reload on every click.  Do this before we create any of our
        // UI, so our links inherit the hash.
        if(helpers.parse_hash(document.location) == null)
        {
            // Don't create a new history state.
            let newURL = new URL(document.location);
            newURL.hash = "#ppixiv";
            history.replaceState(null, "", newURL.toString());
        }
        
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
        helpers.add_style('body .noise-background { background-image: url("' + resources['resources/noise.png'] + '"); };');
        helpers.add_style('body.light .noise-background { background-image: url("' + resources['resources/noise-light.png'] + '"); };');
        
        // Add the main CSS style.
        helpers.add_style(resources['resources/main.css']);
       
        // Create the page from our HTML resource.
        document.body.insertAdjacentHTML("beforeend", resources['resources/main.html']);
        helpers.replace_inlines(document.body);

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
        
        // Create the illustration viewer.
        this.illust_view = new view_illust(this.container.querySelector(".view-illust-container"));

        this.views = {
            search: this.thumbnail_view,
            illust: this.illust_view,
            manga: this.manga_view,
        };

        // Create the data source for this page.
        this.set_current_data_source(html, "initialization");
    };

    window_onpopstate(e)
    {
        // A special case for the bookmarks data source.  It changes its page in the URL to mark
        // how far the user has scrolled.  We don't want this to trigger a data source change.
        if(this.temporarily_ignore_onpopstate)
        {
            console.log("Not navigating for internal page change");
            return;
        }

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
        // Remember what we were displaying before we start changing things.
        var old_view = this.views[this.current_view_name];
        var old_illust_id = old_view? old_view.displayed_illust_id:null;
        var old_illust_page = old_view? old_view.displayed_illust_page:null;

        // Get the current data source.  If we've already created it, this will just return
        // the same object and not create a new one.
        var data_source = await page_manager.singleton().create_data_source_for_url(document.location, html);

        // If the data source supports_start_page, and a link was clicked on a page that isn't currently
        // loaded, create a new data source.  If we're on page 5 of bookmarks and the user clicks a link
        // for page 1 (the main bookmarks navigation button) or page 10, the current data source can't
        // display that since we'd need to load every page in-between to keep pages contiguous, so we
        // just create a new data source.
        //
        // This doesn't work great for jumping to arbitrary pages (we don't handle scrolling to that page
        // very well), but it at least makes rewinding to the first page work.
        if(data_source == this.data_source && data_source.supports_start_page)
        {
            let args = helpers.get_args(document.location);
            let wanted_page = this.data_source.get_start_page(args);

            let lowest_page = data_source.id_list.get_lowest_loaded_page();
            let highest_page = data_source.id_list.get_highest_loaded_page();
            if(wanted_page < lowest_page || wanted_page > highest_page)
            {
                // This works the same as refresh_current_data_source above.
                console.log("Resetting data source to an unavailable page:", lowest_page, wanted_page, highest_page);
                data_source = await page_manager.singleton().create_data_source_for_url(document.location, null, true);
            }
        }

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
            this.illust_view.set_data_source(data_source);
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
            new_view_name = data_source.default_view;
        else
            new_view_name = args.hash.get("view");

        var illust_id = data_source.get_current_illust_id();
        var manga_page = args.hash.has("page")? parseInt(args.hash.get("page"))-1:0;

        // If we're on search, we don't care what image is current.  Clear illust_id so we
        // tell context_menu that we're not viewing anything, so it disables bookmarking.
        if(new_view_name == "search")
            illust_id = null;

        console.log("Loading data source.  View:", new_view_name, "Cause:", cause, "URL:", document.location.href);
        console.log("  Show image", illust_id, "page", manga_page);

        // Mark the current view.  Other code can watch for this to tell which view is
        // active.
        document.body.dataset.currentView = new_view_name;

        // Set the image before activating the view.  If we do this after activating it,
        // it'll start loading any previous image it was pointed at.  Don't do this in
        // search mode, or we'll start loading the default image.
        if(new_view_name == "illust")
            this.illust_view.show_image(illust_id, manga_page);
        else if(new_view_name == "manga")
            this.manga_view.shown_illust_id = illust_id;
 
        var new_view = this.views[new_view_name];

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
        }

        // If we're enabling the thumbnail, pulse the image that was just being viewed (or
        // loading to be viewed), to make it easier to find your place.
        if(new_view_name == "search" && old_illust_id != null)
            this.thumbnail_view.pulse_thumbnail(old_illust_id);
        
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
        // Only intercept regular left clicks.
        if(e.button != 0 || e.metaKey || e.ctrlKey || e.altKey)
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
            premium: premium,
        };

        // Set the .premium class on body if this is a premium account, to display features
        // that only work with premium.
        helpers.set_class(document.body, "premium", window.global_data.premium);

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

