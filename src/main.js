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
        try {
            // GM_info isn't a property on window in all script managers, so we can't check it
            // safely with window.GM_info?.scriptHandler.  Instead, try to check it and catch
            // the exception if GM_info isn't there for some reason.
            if(!ppixiv.native && GM_info?.scriptHandler == "Greasemonkey")
            {
                console.info("ppixiv doesn't work with GreaseMonkey.  GreaseMonkey hasn't been updated in a long time, try TamperMonkey instead.");
                return;
            }
        } catch(e) {
            console.error(e);
        }

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
        console.log("ppixiv controller setup");

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

        helpers.set_class(document.documentElement, "mobile", ppixiv.mobile);
        helpers.set_class(document.documentElement, "ios", ppixiv.ios);
        helpers.set_class(document.documentElement, "android", ppixiv.android);

        // On mobile, disable long press opening the context menu and starting drags.
        if(ppixiv.mobile)
        {
            window.addEventListener("contextmenu", (e) => { e.preventDefault(); });
            window.addEventListener("dragstart", (e) => { e.preventDefault(); });
        }

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

        // If the URL hash doesn't start with #ppixiv, the page was loaded with the base Pixiv
        // URL, and we're active by default.  Add #ppixiv to the URL.  If we don't do this, we'll
        // still work, but none of the URLs we create will have #ppixiv, so we won't handle navigation
        // directly and the page will reload on every click.  Do this before we create any of our
        // UI, so our links inherit the hash.
        if(!ppixiv.native && !helpers.is_ppixiv_url(ppixiv.location))
        {
            // Don't create a new history state.
            let newURL = new URL(ppixiv.location);
            newURL.hash = "#ppixiv";
            history.replaceState(null, "", newURL.toString());
        }
        
        // Don't restore the scroll position.  We handle this ourself.
        window.history.scrollRestoration = "manual";  // not ppixiv.history
       
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
        html.location = ppixiv.location;

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
        {
            let link = document.realCreateElement("link");
            link.href = resources['resources/main.scss'];
            link.rel = "stylesheet";
            document.querySelector("head").appendChild(link);

            // Wait for the stylesheet to actually load before continuing.  This is quick, but if we
            // continue before it's ready, we can flash unstyled content or have other weird nondeterministic
            // problems.
            await helpers.wait_for_load(link);
        }

        // If we're running natively, index.html included an initial stylesheet to set the background
        // color.  Remove it now that we have our real stylesheet.
        let initial_stylesheet = document.querySelector("#initial-style");
        if(initial_stylesheet)
            initial_stylesheet.remove();
       
        // Create the shared title and page icon.
        document.head.appendChild(document.createElement("title"));
        var document_icon = document.head.appendChild(document.createElement("link"));
        document_icon.setAttribute("rel", "icon");

        helpers.add_clicks_to_search_history(document.body);
         
        this.container = document.body;

        // Create the popup menu handler.
        this.context_menu = new main_context_menu({container: document.body});
        this.link_this_tab_popup = new link_this_tab_popup();
        this.send_here_popup = new send_here_popup();
        this.send_image_popup = new send_image_popup();

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
        console.log("Refreshing data source for", ppixiv.location.toString());
        page_manager.singleton().create_data_source_for_url(ppixiv.location, {force: true, remove_search_page});

        // Screens store their scroll position in args.state.scroll.  On refresh, clear it
        // so we scroll to the top when we refresh.
        let args = helpers.args.location;
        delete args.state.scroll;
        helpers.set_page_url(args, false, "refresh-data-source", { send_popstate: false });

        await this.set_current_data_source("refresh");
    }

    // Create a data source for the current URL and activate it.
    //
    // This is called on startup, and in onpopstate where we might be changing data sources.
    async set_current_data_source(cause)
    {
        // Remember what we were displaying before we start changing things.
        var old_screen = this.screens[this.current_screen_name];
        var old_media_id = old_screen? old_screen.displayed_media_id:null;

        // Get the data source for the current URL.
        let data_source = page_manager.singleton().create_data_source_for_url(ppixiv.location);

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

        // If we're changing between screens, update the active screen.
        let screen_changing = new_screen != old_screen;

        // Dismiss any message when toggling between screens.
        if(screen_changing)
            message_widget.singleton.hide();

        // Make sure we deactivate the old screen before activating the new one.
        if(old_screen != null && old_screen != new_screen)
            await old_screen.set_active(false, { });

        if(old_screen != new_screen)
        {
            let e = new Event("screenchanged");
            e.newScreen = new_screen_name;
            window.dispatchEvent(e);
        }

        if(new_screen != null)
        {
            // Restore state from history if this is an initial load (which may be
            // restoring a tab), for browser forward/back, or if we're exiting from
            // quick view (which is like browser back).  This causes the pan/zoom state
            // to be restored.
            let restore_history = cause == "initialization" || cause == "history" || cause == "leaving-virtual";

            await new_screen.set_active(true, {
                data_source: data_source,
                media_id: media_id,

                // Let the screen know what ID we were previously viewing, if any.
                old_media_id: old_media_id,
                restore_history: restore_history,
            });
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
    show_media(media_id, {add_to_history=false, source="", ...options}={})
    {
        let args = this.get_media_url(media_id, options);
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

    navigate_out()
    {
        if(!this.navigate_out_enabled)
            return;
            
        let media_id = this.data_source.get_current_media_id(helpers.args.location);
        if(media_id == null)
            return;

        let args = helpers.get_url_for_id(media_id, { manga: true });
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
        let url = new unsafeWindow.URL(a.href, document.href);
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

        // Navigate to the URL in-page.
        helpers.set_page_url(url, true /* add to history */, "navigation");
    }

    async load_global_data_async()
    {
        console.assert(!ppixiv.native);

        // Doing this sync works better, because it 
        console.log("Reloading page to get init data");

        // /local is used as a placeholder path for the local API, and it's a 404
        // on the actual page.  It doesn't have global data, so load some other arbitrary
        // page to get it.
        let url = document.location;
        if(url.pathname.startsWith('/local'))
            url = new URL("/discovery", url);

        // Some Pixiv pages try to force cache expiry.  We really don't want that to happen
        // here, since we just want to grab the page we're on quickly.  Setting cache: force_cache
        // tells Chrome to give us the cached page even if it's expired.
        let result = await helpers.fetch_document(url.toString(), {
            cache: "force-cache",
        });

        console.log("Finished loading init data");
        if(this.load_global_info_from_document(result))
            return true;

        // The user is probably not logged in.  If this happens on this code path, we
        // can't restore the page.
        console.log("Couldn't find context data.  Are we logged in?");
        this.show_logout_message(true);

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

    onkeydown = (e) =>
    {
        // Ignore keypresses if we haven't set up the screen yet.
        let screen = this.displayed_screen;
        if(screen == null)
            return;

        // If a popup is open, leave inputs alone and don't process hotkeys.
        if(document.body.dataset.popupOpen)
            return;

        if(e.key == "Escape")
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

        this.refresh_disabled_ui(disabled_ui);

        document.body.appendChild(disabled_ui);

        // Newer Pixiv pages update the URL without navigating, so refresh our button with the current
        // URL.  We should be able to do this in popstate, but that API has a design error: it isn't
        // called on pushState, only on user navigation, so there's no way to tell when the URL changes.
        // This results in the URL changing when it's clicked, but that's better than going to the wrong
        // page.
        disabled_ui.addEventListener("focus", (e) => { this.refresh_disabled_ui(disabled_ui); }, true);
        window.addEventListener("popstate", (e) => { this.refresh_disabled_ui(disabled_ui); }, true);

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

    refresh_disabled_ui(disabled_ui)
    {
        // If we're on a page that we don't support, like the top page, rewrite the link to switch to
        // a page we do support.  Otherwise, replace the hash with #ppixiv.
        console.log(ppixiv.location.toString());
        if(page_manager.singleton().available_for_url(ppixiv.location))
        {
            let url = ppixiv.location;
            url.hash = "#ppixiv";
            disabled_ui.querySelector("a").href = url;
        }
        else
            disabled_ui.querySelector("a").href = "/ranking.php?mode=daily#ppixiv";
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

        let enabled = args.hash.get("slideshow") == "1";
        if(enabled)
            args.hash.delete("slideshow");
        else
            args.hash.set("slideshow", "1");

        // If we're on the illust view this replaces the current URL since it's just a
        // settings change, otherwise this is a navigation.
        helpers.set_page_url(args, !viewing_illust, "toggle slideshow");
    }
};

