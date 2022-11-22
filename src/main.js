"use strict";

// This handles high-level navigation and controlling the different screens.
ppixiv.MainController = class
{
    constructor()
    {
        this.initial_setup();
    }

    async initial_setup()
    {
        console.log(`${ppixiv.native? "vview":"ppixiv"} setup`);
        console.log("Browser:", navigator.userAgent);

        // "Stay" for iOS leaves a <script> node containing ourself in the document.  Remove it for
        // consistency with other script managers.
        for(let node of document.querySelectorAll("script[id *= 'Stay']"))
            node.remove();

        // If we're not active, just see if we need to add our button, and stop without messing
        // around with the page more than we need to.
        if(!page_manager.singleton().active)
        {
            console.log("ppixiv is currently disabled");
            await helpers.wait_for_content_loaded();
            this.setup_disabled_ui();
            return;
        }

        // Run cleanup_environment.  This will try to prevent the underlying page scripts from
        // making network requests or creating elements, and apply other irreversible cleanups
        // that we don't want to do before we know we're going to proceed.
        helpers.cleanup_environment();

        // Install polyfills.  Make sure we only do this if we're active, so we don't
        // inject polyfills into Pixiv when we're not active.
        install_polyfills();

        if(!ppixiv.native)
            this.temporarily_hide_document();

        // Wait for DOMContentLoaded to continue.
        await helpers.wait_for_content_loaded();

        // Continue with full initialization.
        await this.setup();
    }

    // This is where the actual UI starts.
    async setup()
    {
        console.log(`${ppixiv.native? "vview":"ppixiv"} controller setup`);

        // Create singletons.
        ppixiv.settings = new ppixiv.Settings();
        ppixiv.media_cache = new ppixiv.MediaCache();
        ppixiv.user_cache = new ppixiv.UserCache();
        ppixiv.send_image = new ppixiv.SendImage();
        
        // Create the page manager.
        page_manager.singleton();

        // Run any one-time settings migrations.
        settings.migrate();

        // Set up the pointer_listener singleton.
        pointer_listener.install_global_handler();
        new ppixiv.global_key_listener;

        // Set up iOS movementX/movementY handling.
        ppixiv.PointerEventMovement.get;

        // If enabled, cache local info which tells us what we have access to.
        await local_api.load_local_info();

        // If login is required to do anything, no API calls will succeed.  Stop now and
        // just redirect to login.  This is only for the local API.
        if(local_api.local_info.enabled && local_api.local_info.login_required)
        {
            local_api.redirect_to_login();
            return;
        }

        // If we're running natively, set the initial URL.
        await local_api.set_initial_url();

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

        // These are used to hide UI when running native or not native.
        helpers.set_class(document.body, "native", ppixiv.native);
        helpers.set_class(document.body, "pixiv", !ppixiv.native);

        // These are used to hide buttons that the user has disabled.
        helpers.set_class(document.body, "hide-r18", !window.global_data.include_r18);
        helpers.set_class(document.body, "hide-r18g", !window.global_data.include_r18g);

        this.set_device_properties();
        settings.addEventListener("avoid-statusbar", this.set_device_properties);
        window.addEventListener("orientationchange", this.set_device_properties);
        new ResizeObserver(this.set_device_properties).observe(document.documentElement);

        // On mobile, disable long press opening the context menu and starting drags.
        if(ppixiv.mobile)
        {
            window.addEventListener("contextmenu", (e) => { e.preventDefault(); });
            window.addEventListener("dragstart", (e) => { e.preventDefault(); });
        }

        if(ppixiv.mobile)
            helpers.force_target_blank();

        // See if the page has preload data.  This sometimes contains illust and user info
        // that the page will display, which lets us avoid making a separate API call for it.
        let preload = document.querySelector("#meta-preload-data");
        if(preload != null)
        {
            preload = JSON.parse(preload.getAttribute("content"));
            for(var preload_user_id in preload.user)
                user_cache.add_user_data(preload.user[preload_user_id]);
            for(var preload_illust_id in preload.illust)
                media_cache.add_media_info_full(preload.illust[preload_illust_id]);
        }

        window.addEventListener("click", this.window_onclick_capture);
        window.addEventListener("popstate", this.window_onpopstate);

        window.addEventListener("keyup", this.redirect_event_to_screen, true);
        window.addEventListener("keydown", this.redirect_event_to_screen, true);
        window.addEventListener("keypress", this.redirect_event_to_screen, true);

        window.addEventListener("keydown", this.onkeydown);

        let refresh_focus = () => { helpers.set_class(document.body, "focused", document.hasFocus()); };
        window.addEventListener("focus", refresh_focus);
        window.addEventListener("blur", refresh_focus);
        refresh_focus();

        this.current_screen_name = null;

        // Update the initial URL.
        if(!ppixiv.native)
        {
            let newURL = new URL(ppixiv.plocation);

            // If we're on the top Pixiv page, we're active by default but this isn't actually a
            // supported page.  Rewrite the path to point to our default view.
            if(page_manager.singleton().is_top_url)
                newURL = page_manager.singleton().fallback_url;

            // If the URL hash doesn't start with #ppixiv, the page was loaded with the base Pixiv
            // URL, and we're active by default.  Add #ppixiv to the URL.  If we don't do this, we'll
            // still work, but none of the URLs we create will have #ppixiv, so we won't handle navigation
            // directly and the page will reload on every click.  Do this before we create any of our
            // UI, so our links inherit the hash.
            if(!helpers.is_ppixiv_url(newURL))
            {
                // Don't create a new history state.
                newURL.hash = "#ppixiv";
            }

            phistory.replaceState(null, "", newURL.toString());
        }
        
        // Don't restore the scroll position.  We handle this ourself.
        window.history.scrollRestoration = "manual";  // not ppixiv.phistory
       
        // If we're running on Pixiv, remove Pixiv's content from the page and move it into a
        // dummy document.
        let html = document.createElement("document");
        if(!ppixiv.native)
        {
            helpers.move_children(document.head, html);
            helpers.move_children(document.body, html);
        }

        // Copy the location to the document copy, so the data source can tell where
        // it came from.
        html.location = ppixiv.plocation;

        // Now that we've cleared the document, we can unhide it.
        document.documentElement.hidden = false;

        // Load image resources into blobs.
        await this.load_resource_blobs();

        // Add the blobs for binary resources as CSS variables.
        helpers.add_style("image-styles", `
            html {
                --dark-noise: url("${resources['resources/noise.png']}");
            }
        `);

        // Load our icon font.  var() doesn't work for font-face src, so we have to do
        // this manually.
        document.head.appendChild(helpers.create_style(`
            @font-face {
                font-family: 'ppixiv';
                src: url(${resources['resources/ppixiv.woff']}) format('woff');
                font-weight: normal;
                font-style: normal;
                font-display: block;
            }
        `));

        // Add the main stylesheet.
        let main_stylesheet = resources['resources/main.scss'];
        document.head.appendChild(helpers.create_style(main_stylesheet, { id: "main" }));

        // If we're running natively, index.html included an initial stylesheet to set the background
        // color.  Remove it now that we have our real stylesheet.
        let initial_stylesheet = document.querySelector("#initial-style");
        if(initial_stylesheet)
            initial_stylesheet.remove();
       
        // Create the shared title.  This is set by helpers.set_page_title.
        if(document.querySelector("title") == null)
            document.head.appendChild(document.createElement("title"));
        
        // Create the shared page icon.  This is set by set_page_icon.
        let document_icon = document.head.appendChild(document.createElement("link"));
        document_icon.setAttribute("rel", "icon");

        helpers.add_clicks_to_search_history(document.body);
         
        this.container = document.body;

        // Handle enabling and disabling top-level scrolling.
        this.refresh_main_scroll();
        OpenWidgets.singleton.addEventListener("changed", this.refresh_main_scroll);

        // Create the popup menu handler.
        this.context_menu = new main_context_menu({container: document.body});
        link_this_tab_popup.setup();
        send_here_popup.setup();

        // Create the main progress bar.
        this.progress_bar = new progress_bar({ container: this.container });
        
        // Create the screens.
        this.screen_search = new screen_search({ container: document.body });
        this.screen_illust = new screen_illust({ container: document.body });

        this.screens = {
            search: this.screen_search,
            illust: this.screen_illust,
        };

        // Create the data source for this page.
        this.set_current_data_source("initialization");
    };

    window_onpopstate = (e) =>
    {
        // Set the current data source and state.
        this.set_current_data_source(e.navigationCause || "history");
    }

    async refresh_current_data_source({remove_search_page=false}={})
    {
        if(this.data_source == null)
            return;

        // Create a new data source for the same URL, replacing the previous one.
        // This returns the data source, but just call set_current_data_source so
        // we load the new one.
        console.log("Refreshing data source for", ppixiv.plocation.toString());
        page_manager.singleton().create_data_source_for_url(ppixiv.plocation, {force: true, remove_search_page});

        // Screens store their scroll position in args.state.scroll.  On refresh, clear it
        // so we scroll to the top when we refresh.
        let args = helpers.args.location;
        delete args.state.scroll;
        helpers.navigate(args, { add_to_history: false, cause: "refresh-data-source", send_popstate: false });

        await this.set_current_data_source("refresh");
    }

    set_device_properties = () =>
    {
        helpers.set_class(document.documentElement, "mobile", ppixiv.mobile);
        helpers.set_class(document.documentElement, "ios", ppixiv.ios);
        helpers.set_class(document.documentElement, "android", ppixiv.android);
        helpers.set_class(document.documentElement, "phone", helpers.is_phone);
        document.documentElement.dataset.orientation = window.orientation ?? "0";

        // Set the fullscreen mode.  See the device styling rules in main.scss for more
        // info.
        //
        // Try to figure out if we're on a device with a notch.  There's no way to query this,
        // and if we're on an iPhone we can't even directly query which model it is, so we have
        // to guess.  For iPhones, assume that we have a notch if we have a bottom inset, since
        // all current iPhones with a notch also have a bottom inset for the ugly pointless white
        // line at the bottom of the screen.
        //
        // - When in Safari in top navigation bar mode, the bottom bar isn't reported as a safe area,
        // even though content goes under it.  This is probably due to the UI that appears based on
        // scrolling.  In this mode, we don't need to avoid a notch when in portrait since we're not
        // overlapping it, but we won't enter rounded mode either, so we'll have a round bottom and
        // square top.
        let notch = false;
        let insets = helpers.safe_area_insets;
        if(ppixiv.ios && navigator.platform.indexOf('iPhone') != -1)
        {
            notch = insets.bottom > 0;

            // Work around an iOS bug: when running in Safari (not as a PWA) in landscape with the
            // toolbar hidden, the content always overlaps the navigation line, but it doesn't report
            // it in the safe area.  This causes us to not detect notch mode.  It does report the notch
            // safe area on the left or right, and incorrectly reports a matching safe area on the right
            // (there's nothing there to need a safe area), so check for this as a special case.
            if(!navigator.standalone && (insets.left > 20 && insets.right == insets.left))
                notch = true;
        }

        // Set the fullscreen mode.
        if(notch)
            document.documentElement.dataset.fullscreenMode = "notch";
        else if(settings.get("avoid-statusbar"))
            document.documentElement.dataset.fullscreenMode = "safe-area";
        else
            document.documentElement.dataset.fullscreenMode = "none";
    }

    // Create a data source for the current URL and activate it.
    //
    // This is called on startup, and in onpopstate where we might be changing data sources.
    async set_current_data_source(cause)
    {
        // If we're called again before a previous call finishes, let the previous call
        // finish first.
        let token = this._set_current_data_source_token = new Object();

        // Wait for any other running set_current_data_source calls to finish.
        while(this._set_current_data_source_promise != null)
            await this._set_current_data_source_promise;

        // If token doesn't match anymore, another call was made, so ignore this call.
        if(token !== this._set_current_data_source_token)
            return;

        let promise = this._set_current_data_source_promise = this._set_current_data_source(cause);
        promise.finally(() => {
            if(promise == this._set_current_data_source_promise)
                this._set_current_data_source_promise = null;
        });
        return promise;
    }

    async _set_current_data_source(cause)
    {
        // Remember what we were displaying before we start changing things.
        var old_screen = this.screens[this.current_screen_name];
        var old_media_id = old_screen? old_screen.displayed_media_id:null;

        // Get the data source for the current URL.
        let data_source = page_manager.singleton().create_data_source_for_url(ppixiv.plocation);

        // Figure out which screen to display.
        var new_screen_name;
        let args = helpers.args.location;
        if(!args.hash.has("view"))
            new_screen_name = data_source.default_screen;
        else
            new_screen_name = args.hash.get("view");

        // If the data source is changing, set it up.
        if(this.data_source != data_source)
        {
            console.log("New data source.  Screen:", new_screen_name, "Cause:", cause);

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
        else
            console.log("Same data source.  Screen:", new_screen_name, "Cause:", cause);

        // Update the media ID with the current manga page, if any.
        let media_id = data_source.get_current_media_id(args);
        let page = args.hash.has("page")? parseInt(args.hash.get("page"))-1:0;
        media_id = helpers.get_media_id_for_page(media_id, page);

        // If we're on search, we don't care what image is current.  Clear media_id so we
        // tell context_menu that we're not viewing anything, so it disables bookmarking.
        if(new_screen_name == "search")
            media_id = null;

        // Mark the current screen.  Other code can watch for this to tell which view is
        // active.
        document.documentElement.dataset.currentView = new_screen_name;

        let new_screen = this.screens[new_screen_name];

        this.context_menu.set_media_id(media_id);
        
        this.current_screen_name = new_screen_name;

        if(new_screen != old_screen)
        {
            // Dismiss any message when changing screens.
            message_widget.singleton.hide();

            let e = new Event("screenchanged");
            e.newScreen = new_screen_name;
            window.dispatchEvent(e);
        }

        if(new_screen != null)
        {
            new_screen.set_data_source(data_source);

            // Restore state from history if this is an initial load (which may be
            // restoring a tab), for browser forward/back, or if we're exiting from
            // quick view (which is like browser back).  This causes the pan/zoom state
            // to be restored.
            let restore_history = cause == "initialization" || cause == "history" || cause == "leaving-virtual";

            await new_screen.activate({
                media_id,
                old_media_id,
                restore_history,
            });
        }

        // Deactivate the old screen.
        if(old_screen != null && old_screen != new_screen)
            old_screen.deactivate();

        this.refresh_main_scroll();
    }

    get_rect_for_media_id(media_id)
    {
        return this.screen_search.get_rect_for_media_id(media_id);
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

    // Return the URL to display a media ID.
    get_media_url(media_id, {screen="illust", temp_view=false}={})
    {
        console.assert(media_id != null, "Invalid illust_id", media_id);

        let args = helpers.args.location;

        // Check if this is a local ID.
        if(helpers.is_media_id_local(media_id))
        {
            // If we're told to show a folder: ID, always go to the search page, not the illust page.
            if(helpers.parse_media_id(media_id).type == "folder")
                screen = "search";
        }

        let old_media_id = this.data_source.get_current_media_id(args);
        let [old_illust_id] = helpers.media_id_to_illust_id_and_page(old_media_id);

        // Update the URL to display this media_id.  This stays on the same data source,
        // so displaying an illust won't cause a search to be made in the background or
        // have other side-effects.
        this._set_active_screen_in_url(args, screen);
        this.data_source.set_current_media_id(media_id, args);

        // Remove any leftover page from the current illust.  We'll load the default.
        let [illust_id, page] = helpers.media_id_to_illust_id_and_page(media_id);
        if(page == null)
            args.hash.delete("page");
        else
            args.hash.set("page", page + 1);

        if(temp_view)
        {
            args.hash.set("virtual", "1");
            args.hash.set("temp-view", "1");
        }
        else
        {
            args.hash.delete("virtual");
            args.hash.delete("temp-view");
        }

        // If we were viewing a muted image and we're navigating away from it, remove view-muted so
        // we're muting images again.  Don't do this if we're navigating between pages of the same post.
        if(illust_id != old_illust_id)
            args.hash.delete("view-muted");

        return args;
    }
    
    // Show an illustration by ID.
    //
    // This actually just sets the history URL.  We'll do the rest of the work in popstate.
    show_media(media_id, {add_to_history=false, ...options}={})
    {
        let args = this.get_media_url(media_id, options);
        helpers.navigate(args, { add_to_history });
    }

    // Return the displayed screen instance or name.
    get_displayed_screen({name=false}={})
    {
        for(let screen_name in this.screens)
        {
            var screen = this.screens[screen_name];
            if(screen.active)
                return name? screen_name:screen;
        }        

        return null;
    }

    _set_active_screen_in_url(args, screen)
    {
        // If this is the default, just remove it.
        if(screen == this.data_source.default_screen)
            args.hash.delete("view");
        else
            args.hash.set("view", screen);

        // If we're going to the search screen, remove the page and illust ID.
        if(screen == "search")
        {
            args.hash.delete("page");
            args.hash.delete("illust_id");
        }

        // If we're going somewhere other than illust, remove zoom state, so
        // it's not still around the next time we view an image.
        if(screen != "illust")
            delete args.state.zoom;
    }

    get navigate_out_enabled()
    {
        if(this.current_screen_name != "illust" || this.data_source == null)
            return false;

        let media_id = this.data_source.get_current_media_id(helpers.args.location);
        if(media_id == null)
            return false;
            
        let info = media_cache.get_media_info_sync(media_id, { full: false });
        if(info == null)
            return false;

        return info.pageCount > 1;
    }

    // Navigate from an illust view for a manga page to the manga view for that post.
    navigate_out()
    {
        if(!this.navigate_out_enabled)
            return;
            
        let media_id = this.data_source.get_current_media_id(helpers.args.location);
        if(media_id == null)
            return;

        let args = helpers.get_url_for_id(media_id, { manga: true });
        this.navigate_from_image_to_search(args);
    }

    // This is called by screen_illust when it wants screen_search to try to display a
    // media ID in a data source, so it's ready for a transition to start.  This only
    // has an effect if search isn't already active.
    scroll_search_to_media_id(data_source, media_id)
    {
        if(this.current_screen_name == "search")
            return;

        this.screen_search.set_data_source(data_source);
        this.screen_search.scroll_to_media_id(media_id);
    }

    // Navigate to args.
    //
    // This is called when the illust view wants to pop itself and return to a search
    // instead of pushing a search in front of it.  If args is the previous history state,
    // we'll just go back to it, otherwise we'll replace the current state.  This is only
    // used when permanent navigation is enabled, otherwise we can't see what the previous
    // state was.
    navigate_from_image_to_search(args)
    {
        // If phistory.permanent isn't active, just navigate normally.  This is only used
        // on mobile.
        if(!ppixiv.phistory.permanent)
        {
            helpers.navigate(args);
            return;
        }

        let previous_url = ppixiv.phistory.previous_state_url;
        let same_url = helpers.are_urls_equivalent(previous_url, args.url);
        if(same_url)
        {
            console.log("Navigated search is last in history, going there instead");
            ppixiv.phistory.back();
        }
        else
        {
            helpers.navigate(args, { add_to_history: false });
        }
    }

    // This captures clicks at the window level, allowing us to override them.
    //
    // When the user left clicks on a link that also goes into one of our screens,
    // rather than loading a new page, we just set up a new data source, so we
    // don't have to do a full navigation.
    //
    // This only affects left clicks (middle clicks into a new tab still behave
    // normally).
    //
    // This also handles redirecting navigation to ppixiv.VirtualHistory on iOS.
    window_onclick_capture = (e) =>
    {
        // Only intercept regular left clicks.
        if(e.button != 0 || e.metaKey || e.ctrlKey || e.altKey)
            return;

        if(!(e.target instanceof Element))
            return;

        // We're taking the place of the default behavior.  If somebody called preventDefault(),
        // stop.
        if(e.defaultPrevented)
            return;

        // Look up from the target for a link.
        var a = e.target.closest("A");
        if(a == null || !a.hasAttribute("href"))
            return;

        // If this isn't a #ppixiv URL, let it run normally.
        let url = new URL(a.href, document.href);
        if(!helpers.is_ppixiv_url(url))
            return;

        // Stop all handling for this link.
        e.preventDefault();
        e.stopImmediatePropagation();

        // If this is a link to an image (usually /artworks/#), navigate to the image directly.
        // This way, we actually use the URL for the illustration on this data source instead of
        // switching to /artworks.  This also applies to local image IDs, but not folders.
        url = helpers.get_url_without_language(url);
        let illust = this.get_illust_at_element(a);
        if(illust?.media_id)
        {
            let media_id = illust.media_id;
            let args = new helpers.args(a.href);
            let screen = args.hash.has("view")? args.hash.get("view"):"illust";
            this.show_media(media_id, {
                screen: screen,
                add_to_history: true
            });
            
            return;
        }

        helpers.navigate(url);
    }

    // This is called if we're on a page that didn't give us init data.  We'll load it from
    // a page that does.
    async load_global_data_async()
    {
        console.assert(!ppixiv.native);

        console.log("Reloading page to get init data");

        // Use the requests page to get init data.  This is handy since it works even if the
        // site thinks we're mobile, so it still works if we're testing with DevTools set to
        // mobile mode.
        let result = await helpers.fetch_document("/request");

        console.log("Finished loading init data");
        if(this.load_global_info_from_document(result))
            return true;

        // The user is probably not logged in.  If this happens on this code path, we
        // can't restore the page.
        console.log("Couldn't find context data.  Are we logged in?");
        this.show_logged_out_message(true);

        // Redirect to no-ppixiv, to reload the page disabled so we don't leave the user
        // on a blank page.  If this is a page where Pixiv itself requires a login (which
        // is most of them), the initial page request will redirect to the login page before
        // we launch, but we can get here for a few pages.
        let disabled_url = new URL(document.location);
        if(disabled_url.hash != "#no-ppixiv")
        {
            disabled_url.hash = "#no-ppixiv";
            document.location = disabled_url.toString();
        }

        return false;
    }

    // Load Pixiv's global info from doc.  This can be the document, or a copy of the
    // document that we fetched separately.  Return true on success.
    load_global_info_from_document(doc)
    {
        // When running locally, just load stub data, since this isn't used.
        if(ppixiv.native)
        {
            this.init_global_data("no token", "no id", true, [], 2);
            return true;
        }

        // Stop if we already have this.
        if(window.global_data)
            return true;
            
        // This format is used on at least /new_illust.php.
        let global_data = doc.querySelector("#meta-global-data");
        if(global_data != null)
            global_data = JSON.parse(global_data.getAttribute("content"));
        else
        {
            // And another one.  This one's used on /request.
            global_data = doc.querySelector("script#__NEXT_DATA__");
            if(global_data != null)
            {
                global_data = JSON.parse(global_data.innerText);
                global_data = global_data.props.pageProps;
            }
        }

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
                    global_data.mute, global_data.userData.xRestrict);
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
        muting.singleton.pixiv_muted_tags = muted_tags;
        muting.singleton.pixiv_muted_user_ids = muted_user_ids;

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
    redirect_event_to_screen = (e) =>
    {
        let screen = this.get_displayed_screen();
        if(screen == null)
            return;

        // If a dialog is open, leave inputs alone.
        if(ppixiv.dialog_widget.active_dialogs.length > 0)
            return;

        // If the event is going to an element inside the screen already, just let it continue.
        if(helpers.is_above(screen.container, e.target))
            return;

        // If the keyboard input didn't go to an element inside the screen, redirect
        // it to the screen's container.
        var e2 = new e.constructor(e.type, e);
        if(!screen.container.dispatchEvent(e2))
        {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
    }

    onkeydown = (e) =>
    {
        // Ignore keypresses if we haven't set up the screen yet.
        let screen = this.get_displayed_screen();
        if(screen == null)
            return;

        // If a dialog is open, leave inputs alone and don't process hotkeys.
        if(ppixiv.dialog_widget.active_dialogs.length > 0)
            return;

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

        // Illustration search results have both the media ID and the user ID on it.
        let media_element = element.closest("[data-media-id]");
        if(media_element)
            result.media_id = media_element.dataset.mediaId;

        let user_element = element.closest("[data-user-id]");
        if(user_element)
            result.user_id = user_element.dataset.userId;

        return result;
    }

    // Load binary resources into blobs, so we don't copy images into every
    // place they're used.
    async load_resource_blobs()
    {
        // Load data URLs into blobs.
        for(let [name, dataURL] of Object.entries(ppixiv.resources))
        {
            if(!dataURL.startsWith || !dataURL.startsWith("data:"))
                continue;

            let result = await helpers.fetch(dataURL);
            let blob = await result.blob(); 

            let blobURL = URL.createObjectURL(blob);
            ppixiv.resources[name] = blobURL;
        }
    }

    show_logged_out_message(force)
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

        this.refresh_disabled_ui(disabled_ui);

        document.body.appendChild(disabled_ui);

        // Newer Pixiv pages update the URL without navigating, so refresh our button with the current
        // URL.  We should be able to do this in popstate, but that API has a design error: it isn't
        // called on pushState, only on user navigation, so there's no way to tell when the URL changes.
        // This results in the URL changing when it's clicked, but that's better than going to the wrong
        // page.
        disabled_ui.addEventListener("focus", (e) => { this.refresh_disabled_ui(disabled_ui); }, true);
        window.addEventListener("popstate", (e) => { this.refresh_disabled_ui(disabled_ui); }, true);

        if(page_manager.singleton().available_for_url(ppixiv.plocation))
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

                this.show_logged_out_message(true);
            });
        }
    };

    refresh_disabled_ui(disabled_ui)
    {
        // If we're on a page that we don't support, like the top page, rewrite the link to switch to
        // a page we do support.  Otherwise, replace the hash with #ppixiv.
        console.log(ppixiv.plocation.toString());
        if(page_manager.singleton().available_for_url(ppixiv.plocation))
        {
            let url = ppixiv.plocation;
            url.hash = "#ppixiv";
            disabled_ui.querySelector("a").href = url;
        }
        else
            disabled_ui.querySelector("a").href = page_manager.singleton().fallback_url;
    }

    // When viewing an image, toggle the slideshow on or off.
    toggle_slideshow()
    {
        // Add or remove slideshow=1 from the hash.  If we're not on the illust view, use
        // the URL of the image the user clicked, otherwise modify the current URL.
        let args = helpers.args.location;
        let viewing_illust = this.current_screen_name == "illust";
        if(viewing_illust)
            args = helpers.args.location;
        else
            args = this.get_media_url(this.media_id);

        let enabled = args.hash.get("slideshow") == "1"; // not hold
        if(enabled)
            args.hash.delete("slideshow");
        else
            args.hash.set("slideshow", "1");

        // If we're on the illust view this replaces the current URL since it's just a
        // settings change, otherwise this is a navigation.
        helpers.navigate(args, { add_to_history: !viewing_illust, cause: "toggle slideshow" });
    }

    get slideshow_mode()
    {
        return helpers.args.location.hash.get("slideshow");
    }

    loop_slideshow()
    {
        if(this.current_screen_name != "illust")
            return;

        let args = helpers.args.location;
        let enabled = args.hash.get("slideshow") == "loop";
        if(enabled)
            args.hash.delete("slideshow");
        else
            args.hash.set("slideshow", "loop");
    
        helpers.navigate(args, { add_to_history: false, cause: "loop" });
    }

    // Return the URL args to display a slideshow from the current page.
    //
    // This is usually used from a search, and displays a slideshow for the current
    // search.  It can also be called while on an illust from slideshow_staging_dialog.
    get slideshow_url()
    {
        let data_source = this.data_source;
        if(data_source == null)
            return null;

        // For local images, set file=*.  For Pixiv, set the media ID to *.  Leave it alone
        // if we're on the manga view and just add slideshow=1.
        let args = helpers.args.location;
        if(data_source.name == "vview")
            args.hash.set("file", "*");
        else if(data_source.name != "manga")
            data_source.set_current_media_id("*", args);

        args.hash.set("slideshow", "1");
        args.hash.set("view", "illust");
        return args;
    }

    // ENable or disable scrolling on the document.
    //
    // The image is overlaid on top of the search, and we need to explicitly disable scrolling while
    // it's visible, or mousewheel scrolling, touch scrolling, etc. can cause the document to scroll
    // while it's not visible.
    //
    // This also handles disabling scrolling while a dialog is open.
    //
    // See also Dialog._update_block_touch_scrolling for an extra special case needed to prevent
    // scrolling on iOS.
    refresh_main_scroll = () =>
    {
        let top_dialog = ppixiv.dialog_widget.top_dialog;
        let enable_scrolling = this.current_screen_name == "search" && top_dialog == null;
        // console.log("Scrolling enabled:", enable_scrolling);
        helpers.set_class(document.documentElement, "disable-scrolling", !enable_scrolling);
    }
};

