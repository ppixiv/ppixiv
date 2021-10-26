"use strict";

// This handles high-level navigation and controlling the different screens.
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

    // This is where the actual UI starts.
    async setup()
    {
        console.log("ppixiv controller setup");

        this.onkeydown = this.onkeydown.bind(this);
        this.redirect_event_to_screen = this.redirect_event_to_screen.bind(this);
        this.window_onclick_capture = this.window_onclick_capture.bind(this);
        this.window_onpopstate = this.window_onpopstate.bind(this);

        // Create the page manager.
        page_manager.singleton();

        // Run any one-time settings migrations.
        settings.migrate();

        // Migrate the translation database.  We don't need to wait for this.
        update_translation_storage.run();

        // Pixiv scripts that use meta-global-data remove the element from the page after
        // it's parsed for some reason.  Try to get global info from document, and if it's
        // not there, re-fetch the page to get it.
        if(!this.load_global_info_from_document(document))
        {
            if(!await this.load_global_data_async())
                return;
        }

        // Set the .premium class on body if this is a premium account, to display features
        // that only work with premium.
        helpers.set_class(document.body, "premium", window.global_data.premium);

        // These are used to hide buttons that the user has disabled.
        helpers.set_class(document.body, "hide-r18", !window.global_data.include_r18);
        helpers.set_class(document.body, "hide-r18g", !window.global_data.include_r18g);

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

        window.addEventListener("keyup", this.redirect_event_to_screen, true);
        window.addEventListener("keydown", this.redirect_event_to_screen, true);
        window.addEventListener("keypress", this.redirect_event_to_screen, true);

        window.addEventListener("keydown", this.onkeydown);

        this.current_screen_name = null;
        this.current_history_index = helpers.current_history_state_index();

        // If the URL hash doesn't start with #ppixiv, the page was loaded with the base Pixiv
        // URL, and we're active by default.  Add #ppixiv to the URL.  If we don't do this, we'll
        // still work, but none of the URLs we create will have #ppixiv, so we won't handle navigation
        // directly and the page will reload on every click.  Do this before we create any of our
        // UI, so our links inherit the hash.
        if(helpers.parse_hash(ppixiv.location) == null)
        {
            // Don't create a new history state.
            let newURL = new URL(ppixiv.location);
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
        html.location = ppixiv.location;

        // Now that we've cleared the document, we can unhide it.
        document.documentElement.hidden = false;

        // Add binary resources as CSS styles.
        helpers.add_style("noise-background", `body .noise-background { background-image: url("${resources['resources/noise.png']}"); };`);
        helpers.add_style("light-noise-background", `body.light .noise-background { background-image: url("${resources['resources/noise-light.png']}"); };`);
        
        // Add the main CSS style.
        helpers.add_style("main", resources['resources/main.css']);
       
        // Load image resources into blobs.
        await this.load_resource_blobs();

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
        this.context_menu = new main_context_menu({container: document.body});
        
        // Create the main progress bar.
        this.progress_bar = new progress_bar(this.container.querySelector(".loading-progress-bar"));
        
        // Create the screens.
        this.screen_search = new screen_search({ container: this.container.querySelector(".screen-search-container") });
        this.screen_illust = new screen_illust({ container: this.container.querySelector(".screen-illust-container") });
        this.screen_manga = new screen_manga({ container: this.container.querySelector(".screen-manga-container") });

        SendImage.init();

        this.screens = {
            search: this.screen_search,
            illust: this.screen_illust,
            manga: this.screen_manga,
        };

        // Create the data source for this page.
        this.set_current_data_source("initialization");
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
        this.set_current_data_source(e.navigationCause || "history");
    }

    async refresh_current_data_source()
    {
        if(this.data_source == null)
            return;

        // Create a new data source for the same URL, replacing the previous one.
        // This returns the data source, but just call set_current_data_source so
        // we load the new one.
        console.log("Refreshing data source for", ppixiv.location.toString());
        page_manager.singleton().create_data_source_for_url(ppixiv.location, true);
        await this.set_current_data_source("refresh");
    }

    // Create a data source for the current URL and activate it.
    //
    // This is called on startup, and in onpopstate where we might be changing data sources.
    async set_current_data_source(cause)
    {
        // Remember what we were displaying before we start changing things.
        var old_screen = this.screens[this.current_screen_name];
        var old_illust_id = old_screen? old_screen.displayed_illust_id:null;
        var old_illust_page = old_screen? old_screen.displayed_illust_page:null;

        // Get the current data source.  If we've already created it, this will just return
        // the same object and not create a new one.
        let data_source = page_manager.singleton().create_data_source_for_url(ppixiv.location);

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
            let args = helpers.args.location;
            let wanted_page = this.data_source.get_start_page(args);

            // Don't create a new data source if no pages are loaded, which can happen if
            // we're loaded viewing an illust.  We can start from any page.
            let lowest_page = data_source.id_list.get_lowest_loaded_page();
            let highest_page = data_source.id_list.get_highest_loaded_page();
            if(data_source.id_list.any_pages_loaded && (wanted_page < lowest_page || wanted_page > highest_page))
            {
                // This works the same as refresh_current_data_source above.
                console.log("Resetting data source to an unavailable page:", lowest_page, wanted_page, highest_page);
                data_source = page_manager.singleton().create_data_source_for_url(ppixiv.location, true);
            }
        }

        // If the data source is changing, set it up.
        if(this.data_source != data_source)
        {
            if(this.data_source != null)
            {
                // Shut down the old data source.
                this.data_source.shutdown();

                // If the old data source was transient, discard it.
                if(this.data_source.transient)
                    page_manager.singleton().discard_data_source(this.data_source);
            }

            // If we were showing a message for the old data source, it might be persistent,
            // so clear it.
            message_widget.singleton.hide();
            
            this.data_source = data_source;
            this.show_data_source_specific_elements();
            this.context_menu.set_data_source(data_source);
            
            if(this.data_source != null)
                this.data_source.startup();
        }

        // Figure out which screen to display.
        var new_screen_name;
        let args = helpers.args.location;
        if(!args.hash.has("view"))
            new_screen_name = data_source.default_screen;
        else
            new_screen_name = args.hash.get("view");

        var illust_id = data_source.get_current_illust_id();
        var manga_page = args.hash.has("page")? parseInt(args.hash.get("page"))-1:0;

        // If we're on search, we don't care what image is current.  Clear illust_id so we
        // tell context_menu that we're not viewing anything, so it disables bookmarking.
        if(new_screen_name == "search")
            illust_id = null;

        console.log("Loading data source.  Screen:", new_screen_name, "Cause:", cause, "URL:", ppixiv.location.href);

        // Mark the current screen.  Other code can watch for this to tell which view is
        // active.
        document.body.dataset.currentView = new_screen_name;

        let new_screen = this.screens[new_screen_name];

        this.context_menu.illust_id = illust_id;
        
        this.current_screen_name = new_screen_name;

        // If we're changing between screens, update the active screen.
        let screen_changing = new_screen != old_screen;

        // Make sure we deactivate the old screen before activating the new one.
        if(old_screen != null && old_screen != new_screen)
            await old_screen.set_active(false, { });

        if(new_screen != null)
        {
            // Restore state from history if this is an initial load (which may be
            // restoring a tab), for browser forward/back, or if we're exiting from
            // quick view (which is like browser back).  This causes the pan/zoom state
            // to be restored.
            let restore_history = cause == "initialization" || cause == "history" || cause == "leaving-virtual";

            await new_screen.set_active(true, {
                data_source: data_source,
                illust_id: illust_id,
                page: manga_page,
                navigation_cause: cause,
                restore_history: restore_history,
            });
        }

        // Dismiss any message when toggling between screens.
        if(screen_changing)
            message_widget.singleton.hide();

        // If we're enabling the thumbnail, pulse the image that was just being viewed (or
        // loading to be viewed), to make it easier to find your place.
        if(new_screen_name == "search" && old_illust_id != null)
            this.screen_search.pulse_thumbnail(old_illust_id);
        
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
            // console.log("Scroll to top for new search");
            new_screen.scroll_to_top();
        }
        else if(cause == "leaving-virtual")
        {
            // We're backing out of a virtual URL used for quick view.  Don't change the scroll position.
            new_screen.restore_scroll_position();
        }
        else if(navigating_forwards)
        {
            // On browser history forwards, try to restore the scroll position.
            // console.log("Restore scroll position for forwards navigation");
            new_screen.restore_scroll_position();
        }
        else if(screen_changing && old_illust_id != null)
        {
            // If we're navigating backwards or toggling, and we're switching from the image UI to thumbnails,
            // try to scroll the search screen to the image that was displayed.  Otherwise, tell
            // it to restore any scroll position saved in the data source.
            // console.log("Scroll to", old_illust_id, old_illust_page);
            new_screen.scroll_to_illust_id(old_illust_id, old_illust_page);
        }
        else
        {
            new_screen.restore_scroll_position();
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
    show_illust(illust_id, {page, add_to_history=false, screen="illust", quick_view=false, source=""}={})
    {
        console.assert(illust_id != null, "Invalid illust_id", illust_id);

        let args = helpers.args.location;

        // If something else is navigating us in the middle of quick-view, such as changing
        // the page with the mousewheel, let SendImage handle it.  It'll treat it as a quick
        // view and we'll end up back here with quick_view true.  Don't do this if this is
        // already coming from quick view.
        if(args.hash.has("quick-view") && !quick_view && source != "quick-view")
        {
            console.log("Illust change during quick view");
            SendImage.illust_change_during_quick_view(illust_id, page);
            return;
        }

        // Update the URL to display this illust_id.  This stays on the same data source,
        // so displaying an illust won't cause a search to be made in the background or
        // have other side-effects.
        this._set_active_screen_in_url(args, screen);
        this.data_source.set_current_illust_id(illust_id, args);

        // Remove any leftover page from the current illust.  We'll load the default.
        if(page == null)
            args.hash.delete("page");
        else
            args.hash.set("page", page + 1);

        if(quick_view)
        {
            args.hash.set("virtual", "1");
            args.hash.set("quick-view", "1");
        }
        else
        {
            args.hash.delete("virtual");
            args.hash.delete("quick-view");
        }

        helpers.set_page_url(args, add_to_history, "navigation");
    }

    // Return the displayed screen instance.
    get displayed_screen()
    {
        for(let screen_name in this.screens)
        {
            var screen = this.screens[screen_name];
            if(screen.active)
                return screen;
        }        

        return null;
    }

    _set_active_screen_in_url(args, screen)
    {
        args.hash.set("view", screen);

        // If we're going to the search or manga page, remove the page.
        // If we're going to the manga page, remove just the page.
        if(screen == "search" || screen == "manga")
            args.hash.delete("page");
        if(screen == "search")
            args.hash.delete("illust_id");
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
    get navigate_out_label()
    {
        let target = this.displayed_screen?.navigate_out_target;
        switch(target)
        {
        case "manga": return "page list";
        case "search": return "search";
        default: return null;
        }
    }

    navigate_out()
    {
        let new_page = this.displayed_screen?.navigate_out_target;
        if(new_page == null)
            return;

        // If the user clicks "return to search" while on data_sources.current_illust, go somewhere
        // else instead, since that viewer never has any search results.
        if(new_page == "search" && this.data_source instanceof data_sources.current_illust)
        {
            let args = new helpers.args("/bookmark_new_illust.php#ppixiv", ppixiv.location);
            helpers.set_page_url(args, true /* add_to_history */, "out");
            return;
        }

        // Update the URL to mark whether thumbs are displayed.
        let args = helpers.args.location;
        this._set_active_screen_in_url(args, new_page);
        helpers.set_page_url(args, true /* add_to_history */, "out");
    }

    // This captures clicks at the window level, allowing us to override them.
    //
    // When the user left clicks on a link that also goes into one of our screens,
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
            let args = new helpers.args(a.href);
            var page = args.hash.has("page")? parseInt(args.hash.get("page"))-1: null;
            let screen = args.hash.has("view")? args.hash.get("view"):"illust";
            this.show_illust(illust_id, {
                screen: screen,
                page: page,
                add_to_history: true
            });
            
            return;
        }

        // Navigate to the URL in-page.
        helpers.set_page_url(url, true /* add to history */, "navigation");
    }

    async load_global_data_async()
    {
        // Doing this sync works better, because it 
        console.log("Reloading page to get init data");

        // Some Pixiv pages try to force cache expiry.  We really don't want that to happen
        // here, since we just want to grab the page we're on quickly.  Setting cache: force_cache
        // tells Chrome to give us the cached page even if it's expired.
        let result = await helpers.load_data_in_iframe(document.location.toString(), {
            cache: "force-cache",
        });

        console.log("Finished loading init data");
        if(this.load_global_info_from_document(result))
            return true;

        // The user is probably not logged in.  If this happens on this code path, we
        // can't restore the page.
        console.log("Couldn't find context data.  Are we logged in?");
        this.show_logout_message(true);
        return false;
    }

    // Load Pixiv's global info from doc.  This can be the document, or a copy of the
    // document that we fetched separately.  Return true on success.
    load_global_info_from_document(doc)
    {
        // Stop if we already have this.
        if(window.global_data)
            return true;
            
        // This format is used on at least /new_illust.php.
        let global_data = doc.querySelector("#meta-global-data");
        if(global_data != null)
            global_data = JSON.parse(global_data.getAttribute("content"));

        // This is the global "pixiv" object, which is used on older pages.
        let pixiv = helpers.get_pixiv_data(doc);

        // Hack: don't use this object if we're on /history.php.  It has both of these, and
        // this object doesn't actually have all info, but its presence will prevent us from
        // falling back and loading meta-global-data if needed.
        if(document.location.pathname == "/history.php")
            pixiv = null;

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
    };

    // Redirect keyboard events that didn't go into the active screen.
    redirect_event_to_screen(e)
    {
        let screen = this.displayed_screen;
        if(screen == null)
            return;

        // If a popup is open, leave inputs alone.
        if(document.body.dataset.popupOpen)
            return;

        // If the keyboard input didn't go to an element inside the screen, redirect
        // it to the screen's container.
        var target = e.target;
        // If the event is going to an element inside the screen already, just let it continue.
        if(helpers.is_above(screen.container, e.target))
            return;

        // Clone the event and redispatch it to the screen's container.
        var e2 = new e.constructor(e.type, e);
        if(!screen.container.dispatchEvent(e2))
        {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
    }

    onkeydown(e)
    {
        // Ignore keypresses if we haven't set up the screen yet.
        let screen = this.displayed_screen;
        if(screen == null)
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
       
        // Let the screen handle the input.
        screen.handle_onkeydown(e);
    }

    // Return the illust_id and page or user_id of the image under element.  This can
    // be an image in the search screen, or a page in the manga screen.
    //
    // If element is an illustration and also has the user ID attached, both the user ID
    // and illust ID will be returned.
    get_illust_at_element(element)
    {
        let result = { };
        if(element == null)
            return result;

        // Illustration search results have both the illust ID and the user ID on it.
        let illust_element = element.closest("[data-illust-id]");
        if(illust_element)
        {
            result.illust_id = parseInt(illust_element.dataset.illustId);

            // If no page is present, set page to null rather than page 0.  This distinguishes image
            // search results which don't refer to a specific page from the manga page display.  Don't
            // use -1 for this, since that's used in some places to mean the last page.
            result.page = illust_element.dataset.pageIdx == null? null:parseInt(illust_element.dataset.pageIdx);
        }

        let user_element = element.closest("[data-user-id]");
        if(user_element)
            result.user_id = parseInt(user_element.dataset.userId);

        return result;
    }

    // Load binary resources into blobs, so we don't copy images into every
    // place they're used.
    async load_resource_blobs()
    {
        for(let [name, dataURL] of Object.entries(ppixiv.resources))
        {
            if(!dataURL.startsWith || !dataURL.startsWith("data:"))
                continue;

            let result = await fetch(dataURL);
            let blob = await result.blob(); 

            let blobURL = URL.createObjectURL(blob);
            ppixiv.resources[name] = blobURL;
        }
    }

    show_logout_message(force)
    {
        // Unless forced, don't show the message if we've already shown it recently.
        // A session might last for weeks, so we don't want to force it to only be shown
        // once, but we don't want to show it repeatedly.
        let last_shown = window.sessionStorage.showed_logout_message || 0;
        let time_since_shown = Date.now() - last_shown;
        let hours_since_shown = time_since_shown / (60*60*1000);
        if(!force && hours_since_shown < 6)
            return;

        window.sessionStorage.showed_logout_message = Date.now();

        alert("Please log in to use ppixiv.");
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
    async setup_disabled_ui(logged_out=false)
    {
        // Wait for DOMContentLoaded for body.
        await helpers.wait_for_content_loaded();

        // On most pages, we show our button in the top corner to enable us on that page.  Clicking
        // it on a search page will switch to us on the same search.
        var disabled_ui = helpers.create_node(resources['resources/disabled.html']);
        helpers.replace_inlines(disabled_ui);

        // If we're on a page that we don't support, like the top page, rewrite the link to switch to
        // a page we do support.
        if(!page_manager.singleton().available_for_url(ppixiv.location))
            disabled_ui.querySelector("a").href = "/ranking.php?mode=daily#ppixiv";

        document.body.appendChild(disabled_ui);

        if(page_manager.singleton().available_for_url(ppixiv.location))
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

        // If we're showing this and we know we're logged out, show a message on click.
        // This doesn't work if we would be inactive anyway, since we don't know whether
        // we're logged in, so the user may need to click the button twice before actually
        // seeing this message.
        if(logged_out)
        {
            disabled_ui.querySelector("a").addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                this.show_logout_message(true);
            });
        }
    };
};

