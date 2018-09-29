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

        // catch_bind isn't available if we're not active, so we use bind here.
        this.dom_content_loaded = this.dom_content_loaded.bind(this);
        window.addEventListener("DOMContentLoaded", this.dom_content_loaded, true);

        if(!page_manager.singleton().active)
            return;

        // Do early setup.  This happens early in page loading, without waiting for DOMContentLoaded.
        // Unfortunately TamperMonkey doesn't correctly call us at the very start of the page in
        // Chrome, so this doesn't happen until some site scripts have had a chance to run.

        // Pixiv scripts run on DOMContentLoaded and load, whichever it sees first.  Add capturing
        // listeners on both of these and block propagation, so those won't be run.  This keeps most
        // of the site scripts from running underneath us.  Make sure this is registered after our
        // own DOMContentLoaded listener above, or it'll block ours too.
        var stop_event = function(e) {
            e.preventDefault();
            e.stopImmediatePropagation();
        };
        window.addEventListener("DOMContentLoaded", stop_event, true);
        window.addEventListener("load", stop_event, true);

        // Newer Pixiv pages run a bunch of stuff from deferred scripts, which install a bunch of
        // nastiness (like searching for installed polyfills--which we install--and adding wrappers
        // around them).  Break this by defining a webpackJsonp property that can't be set.  It
        // won't stop the page from running everything, but it keeps it from getting far enough
        // for the weirder scripts to run.
        Object.defineProperty(unsafeWindow, "webpackJsonp", {
            set(value) { }
        });
        
        // Install polyfills.  Make sure we only do this if we're active, so we don't
        // inject polyfills into Pixiv when we're not active.
        install_polyfills();

        // Try to prevent site scripts from running, since we don't need any of it.
        if(navigator.userAgent.indexOf("Firefox") != -1)
            helpers.block_all_scripts();

        this.temporarily_hide_document();
        helpers.block_network_requests();
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
            // If we're disabled and can be enabled on this page, add the button.
            if(page_manager.singleton().available())
                this.setup_disabled_ui();
            
            return;
        }

        // Create the main controller.
        main_controller.create_singleton();
    }

    // When we're disabled, but available on the current page, add the button to enable us.
    setup_disabled_ui()
    {
        // Create the activation button.
        var disabled_ui = helpers.create_node(resources['disabled.html']);
        helpers.add_style('.ppixiv-disabled-ui > a { background-image: url("' + binary_data['activate-icon.png'] + '"); };');
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

        main_controller._singleton = new main_controller();
    }

    static get singleton()
    {
        if(main_controller._singleton == null)
            throw "main_controller isn't created";

        return main_controller._singleton;
    }

    constructor()
    {
        // Some Pixiv pages set an onerror to report errors.  Disable it if it's there,
        // so it doesn't send errors caused by this script.  Remove _send and _time, which
        // also send logs.  Do this early.
        unsafeWindow.onerror = null;
        unsafeWindow._send = exportFunction(function() { }, unsafeWindow);
        unsafeWindow._time = exportFunction(function() { }, unsafeWindow);

        this.toggle_thumbnail_view = this.toggle_thumbnail_view.catch_bind(this);
        this.onkeydown = this.onkeydown.catch_bind(this);
        this.window_onclick_capture = this.window_onclick_capture.catch_bind(this);
        this.window_onpopstate = this.window_onpopstate.catch_bind(this);

        // Create the page manager.
        page_manager.singleton();

        this.setup();
    };

    setup()
    {
        // Try to init using globalInitData if possible.
        var data = helpers.get_global_init_data(document);
        if(data != null)
        {
            this.init_global_data(data.token, data.userData.id, data.premium && data.premium.popularSearch, data.mute);

            // If data is available, this is a newer page with globalInitData.
            // This can have one or more user and/or illust data, which we'll preload
            // so we don't need to fetch it later.
            for(var preload_illust_id in data.preload.illust)
                image_data.singleton().add_illust_data(data.preload.illust[preload_illust_id]);

            for(var preload_user_id in data.preload.user)
                image_data.singleton().add_user_data(data.preload.user[preload_user_id]);
        }
        else
        {
            // If that's not available, this should be an older page with the "pixiv" object.
            var pixiv = helpers.get_pixiv_data(document);
            if(pixiv == null)
            {
                // If we can't find either, either we're on a page we don't understand or we're
                // not logged in.  Stop and let the page run normally.
                console.log("Couldn't find context data.  Are we logged in?");
                document.documentElement.hidden = false;
                return;
            }
            this.init_global_data(pixiv.context.token, pixiv.user.id, pixiv.user.premium, pixiv.user.mutes);
        }

        console.log("Starting");

        window.addEventListener("click", this.window_onclick_capture, true);
        window.addEventListener("popstate", this.window_onpopstate);
        window.addEventListener("keydown", this.onkeydown);

        this.current_view = null;
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
        helpers.add_style('.refresh-icon:after { content: url("' + binary_data['refresh-icon.svg'] + '"); };');
        helpers.add_style('.heart-icon:after { content: url("' + binary_data['heart-icon.svg'] + '"); };');
        
        // Add the main CSS style.
        helpers.add_style(resources['main.css']);
       
        // Create the page from our HTML resource.
        this.container = document.body.appendChild(helpers.create_node(resources['main.html']));

        // Create the popup menu handler.
        this.context_menu = new main_context_menu(document.body);
        
        // Create the thumbnail view handler.
        this.thumbnail_view = new thumbnail_view(this.container.querySelector(".thumbnail-container"));

        // Create the manga page viewer.
        this.manga_view = new manga_thumbnail_viewer(this.container.querySelector(".manga-view-container"));
        
        // Create the main UI.
        this.ui = new main_ui(this, this.container.querySelector(".image-viewer-container"));

        this.views = {
            search: this.thumbnail_view,
            illust: this.ui,
            manga: this.manga_view,
        };

        // Create the data source for this page.
        this.set_current_data_source(html);
    };

    window_onpopstate(e)
    {
        console.log("History state changed.  initialNavigation:", e.navigationCause);

        // Set the current data source and state.
        this.set_current_data_source(null, e.navigationCause || "history");
    }

    // Create a data source for the current URL and activate it.
    //
    // This is called on startup, and in onpopstate where we might be changing data sources.
    //
    // If this is on startup, html is the HTML elements on the page to pass to the data source
    // to preload the first page.  On navigation, html is null.  If we navigate to a page that
    // can load the first page from the HTML page, we won't load the HTML and we'll just allow
    // the first page to load like any other page.
    set_current_data_source(html, cause)
    {
        console.log("Loading data source for", document.location.href);
        page_manager.singleton().create_data_source_for_url(document.location, html, this.set_enabled_view.catch_bind(this, cause));
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

    // Set either the image or thumbnail view as active.
    //
    // If initial_navigation is true, this is from the user triggering a navigation, eg.
    // clicking a link.  If it's false, it's from browser history navigation or the initial
    // load.
    set_enabled_view(cause, data_source)
    {
        // Backwards compatibility: if the URL has thumbs=0, remove it and replace it
        // with page=illust.
        var hash_args = helpers.get_hash_args(document.location);
        if(hash_args.has("thumbs"))
        {
            console.log("Removing thumbs=0 and replacing with view=illust");
            hash_args.delete("thumbs");
            hash_args.set("view", "illust");
            page_manager.singleton().set_args(null, hash_args, false);
            return;
        }
        
        this.set_data_source(data_source);
        if(data_source == null)
            return;

        var new_view = this.get_displayed_view_name;
        console.log("Enabling view:", new_view, "Navigation cause:", cause);

        // Mark the current view.  Other code can watch for this to tell which view is
        // active.
        document.body.dataset.currentView = new_view;

        // If we're going to activate the image view, set the image first.  If we do this
        // after activating it, it'll start loading any previous image it was pointed at.
        if(new_view == "illust")
            this._show_current_illust();
 
        // If we're changing between the image and thumbnail view, update the active view.
        var view_changing = new_view != this.current_view;
        if(view_changing)
        {
            this.current_view = new_view;

            for(var view_name in this.views)
            {
                var view = this.views[view_name];
                view.active = new_view == view_name;
                console.log(view_name);
            }
       
            // Dismiss any message when toggling between views.
            message_widget.singleton.hide();
        }
        
        // Are we navigating forwards or back?
        var new_history_index = helpers.current_history_state_index();
        var navigating_forwards = new_history_index > this.current_history_index;
        this.current_history_index = new_history_index;

        if(this.thumbnail_view.active)
        {
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
                this.thumbnail_view.scroll_to_top();
            }
            else if(navigating_forwards)
            {
                // On browser history forwards, try to restore the scroll position.
                console.log("Restore scroll position for forwards navigation");
                this.thumbnail_view.restore_scroll_position();
            }
            else
            {
                // If we're navigating backwards or toggling, and we're switching from the image UI to thumbnails,
                // try to scroll the thumbnail view to the image that was displayed.  Otherwise, tell
                // the thumbnail view to restore any scroll position saved in the data source.
                if(view_changing && this.ui.current_illust_id != -1 && this.thumbnail_view.active)
                    this.thumbnail_view.scroll_to_illust_id(this.ui.current_illust_id);
                else
                    this.thumbnail_view.restore_scroll_position();

                // If we're enabling the thumbnail, pulse the image that was just being viewed (or
                // loading to be viewed), to make it easier to find your place.
                if(view_changing && this.thumbnail_view.active)
                    this.thumbnail_view.pulse_thumbnail(this.ui.wanted_illust_id);
            }
        }
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        // If we were showing a message for the old data source, it might be persistent,
        // so clear it.
        message_widget.singleton.hide();
        
        this.data_source = data_source;
        this.show_data_source_specific_elements();
        this.ui.set_data_source(data_source);
        this.thumbnail_view.set_data_source(data_source);
        this.context_menu.set_data_source(data_source);
        
        // Load the current page for the data source.
        this.data_source.load_current_page(function() {
            this._show_current_illust();
        }.bind(this));
    }

    // Show the illust (and page if set) in the URL in the main viewer.  The data source
    // should already be set.
    _show_current_illust()
    {
        // The data source finished loading, so we know what image to display now.
        var show_illust_id = this.data_source.get_current_illust_id();

        // Get the manga page in this illust to show, if any.
        var hash_args = helpers.get_hash_args(document.location);
        var page = hash_args.get("page");
        if(page != null)
            page = parseInt(page);

        console.log("  Show image", show_illust_id, "page", page);
        this.ui.show_image(show_illust_id, page);
        this.manga_view.shown_illust_id = show_illust_id;
    }

    show_illust_id(illust_id, add_to_history)
    {
        // Sanity check:
        if(illust_id == null)
        {
            console.error("Invalid illust_id", illust_id);
            return;
        }
        console.log("show_illust_id:", illust_id, add_to_history);

        // Set the wanted illust_id in the URL, and disable the thumb view so we show
        // the image.  Do this in a single URL update, so we don't add multiple history
        // entries.
        var query_args = new URL(document.location).searchParams;
        var hash_args = helpers.get_hash_args(document.location);

        this._set_active_view_in_url(hash_args, "illust");

        // Remove any leftover page from the current illust.  We'll load the default.
        hash_args.delete("page");

        this.data_source.set_current_illust_id(illust_id, query_args, hash_args);
        page_manager.singleton().set_args(query_args, hash_args, add_to_history);        
    }

    show_manga_page(illust_id, page, add_to_history)
    {
        var query_args = new URL(document.location).searchParams;
        var hash_args = helpers.get_hash_args(document.location);

        // Update the URL to show illust_id on page, in illust mode.
        this._set_active_view_in_url(hash_args, "illust");
        this.data_source.set_current_illust_id(illust_id, query_args, hash_args);
        hash_args.set("page", page);

        // Set the URL.
        var url = new URL(document.location);
        url.search = query_args.toString();
        helpers.set_hash_args(url, hash_args);
        helpers.set_page_url(url, add_to_history);
    }

    // Return the name of the currently active view.
    get get_displayed_view_name()
    {
        // If thumbs is set in the hash, it's whether we're enabled.  Otherwise, use
        // the data source's default.
        var hash_args = helpers.get_hash_args(document.location);
        if(!hash_args.has("view"))
            return this.data_source.default_view;
        else
            return hash_args.get("view");
    }

    // Return the displayed view instance.
    get displayed_view()
    {
        var view_name = this.get_displayed_view_name;
        if(!(view_name in this.views))
            throw "Unknown view name " + view_name;

        return this.views[view_name];
    }

    _set_active_view_in_url(hash_args, view)
    {
        hash_args.set("view", view);
    }

    set_displayed_view_by_name(view, add_to_history, cause)
    {
        // Update the URL to mark whether thumbs are displayed.
        var hash_args = helpers.get_hash_args(document.location);
        this._set_active_view_in_url(hash_args, view);

        // Set the URL.  This will dispatch popstate, and we'll handle the state change there.
        // Update the thumbnail view.
        page_manager.singleton().set_args(null, hash_args, add_to_history, cause);
    }

    toggle_thumbnail_view(add_to_history)
    {
        var enabled = this.get_displayed_view_name == "search";
        console.log("enabled:", enabled);
        enabled = !enabled;
        this.set_displayed_view_by_name(enabled? "search":"illust", add_to_history, "toggle");
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

        if(!(e.target instanceof HTMLElement))
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

        // If this is a click inside a popup menu, close the menu before navigating.
        var open_popup = e.target.closest(".popup-visible");
        if(open_popup != null)
            open_popup.classList.remove("popup-visible");

        // If this is a thumbnail link, show the image.
        if(a.dataset.illustId != null)
        {
            if(a.dataset.pageIdx == null)
            {
                this.show_illust_id(a.dataset.illustId, true /* add to history */);
            }
            else
            {
                // If this is a manga page link, show the page.
                var page = parseInt(a.dataset.pageIdx);
                console.log("Show page", page);
                this.show_manga_page(a.dataset.illustId, page, true /* add to history */);
            }
            return;
        }

        // Navigate to the URL in-page.
        helpers.set_page_url(url, true /* add to history */, "navigation");
    }

    init_global_data(csrf_token, user_id, premium, mutes)
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
        };

        // Set the .premium class on body if this is a premium account, to display features
        // that only work with premium.
        //
        // It would make more sense to do this in main_ui, but user data comes in different
        // forms for different pages and it's simpler to just do it here.
        helpers.set_class(document.body, "premium", premium);
    };

    onkeydown(e)
    {
        if(e.keyCode == 27) // escape
        {
            e.preventDefault();
            e.stopPropagation();

            this.toggle_thumbnail_view();

            return;
        }

        // Let the view handle the input.
        var view = this.displayed_view;
        view.handle_onkeydown(e);
    }
};

new early_controller();

