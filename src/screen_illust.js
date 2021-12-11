"use strict";

// The main UI.  This handles creating the viewers and the global UI.
ppixiv.screen_illust = class extends ppixiv.screen
{
    constructor(options)
    {
        super(options);
        
        this.onwheel = this.onwheel.bind(this);
        this.refresh_ui = this.refresh_ui.bind(this);
        this.data_source_updated = this.data_source_updated.bind(this);

        this.current_illust_id = null;
        this.latest_navigation_direction_down = true;

        this.progress_bar = main_controller.singleton.progress_bar;

        // Create a UI box and put it in its container.
        var ui_container = this.container.querySelector(".ui");
        this.ui = new image_ui({
            container: ui_container,
            parent: this,
            progress_bar: this.progress_bar,
        });
        
        var ui_box = this.ui.container;

        var ui_visibility_changed = () => {
            // Hide the dropdown tag widget when the hover UI is hidden.
            let visible = ui_box.classList.contains("hovering-over-box") || ui_box.classList.contains("hovering-over-sphere");
            if(!visible)
            {
                this.ui.bookmark_tag_widget.visible = false; // XXX remove
                view_hidden_listener.send_viewhidden(ui_box);
            }

            // Tell the image UI when it's visible.
            this.ui.visible = visible;
        };
        ui_box.addEventListener("mouseenter", (e) => { helpers.set_class(ui_box, "hovering-over-box", true); ui_visibility_changed(); });
        ui_box.addEventListener("mouseleave", (e) => { helpers.set_class(ui_box, "hovering-over-box", false); ui_visibility_changed(); });

        var hover_circle = this.container.querySelector(".ui .hover-circle");
        hover_circle.addEventListener("mouseenter", (e) => { helpers.set_class(ui_box, "hovering-over-sphere", true); ui_visibility_changed(); });
        hover_circle.addEventListener("mouseleave", (e) => { helpers.set_class(ui_box, "hovering-over-sphere", false); ui_visibility_changed(); });

        image_data.singleton().user_modified_callbacks.register(this.refresh_ui);
        image_data.singleton().illust_modified_callbacks.register(this.refresh_ui);
        settings.register_change_callback("recent-bookmark-tags", this.refresh_ui);

        this.image_container = this.container.querySelector(".image-container");

        // Fullscreen on double-click.
        this.image_container.addEventListener("dblclick", () => {
            helpers.toggle_fullscreen();
        });

        // Remove the "flash" class when the page change indicator's animation finishes.
        let page_change_indicator = this.container.querySelector(".page-change-indicator");
        page_change_indicator.addEventListener("animationend", (e) => {
            page_change_indicator.classList.remove("flash");
        });

        new hide_mouse_cursor_on_idle(this.container.querySelector(".mouse-hidden-box"));

        // this.manga_thumbnails = new manga_thumbnail_widget({ container: this.container });

        this.container.addEventListener("wheel", this.onwheel, { passive: false });

        // A bar showing how far along in an image sequence we are:
        this.manga_page_bar = new progress_bar(this.container.querySelector(".ui-box")).controller();

        // Create the video UI, which includes the viewer_ugoira seek bar.
        this.video_ui = new ppixiv.video_ui({
            container: this.container.querySelector(".video-ui-container"),
            parent: this,
        });
        new hide_seek_bar(this.container.querySelector(".video-ui-container"));

        this.set_active(false, { });
        this.flashed_page_change = false;
    }

    set_data_source(data_source)
    {
        if(data_source == this.data_source)
            return;

        if(this.data_source != null)
        {
            this.data_source.remove_update_listener(this.data_source_updated);
            this.data_source = null;
        }

        this.data_source = data_source;
        this.ui.data_source = data_source;

        if(this.data_source != null)
        {
            this.data_source.add_update_listener(this.data_source_updated);

            this.refresh_ui();
        }
    }

    get _hide_image()
    {
        return this.image_container.hidden;
    }
    set _hide_image(value)
    {
        this.image_container.hidden = value;
    }
    
    async set_active(active, { illust_id, page, data_source, restore_history })
    {
        this._active = active;
        await super.set_active(active);

        // If we have a viewer, tell it if we're active.
        if(this.viewer != null)
            this.viewer.active = this._active;

        if(!active)
        {
            this.cancel_async_navigation();

            // Remove any image we're displaying, so if we show another image later, we
            // won't show the previous image while the new one's data loads.
            if(this.viewer != null)
                this._hide_image = true;

            // Stop showing the user in the context menu, and stop showing the current page.
            main_context_menu.get.set_illust(null, null);

            this.flashed_page_change = false;

            this.stop_displaying_image();
            
            return;
        }

        this.set_data_source(data_source);
        this.show_image(illust_id, page, restore_history);
    }

    // Show an image.  If manga_page is -1, show the last page.
    async show_image(illust_id, manga_page, restore_history)
    {
        console.assert(illust_id != null);

        helpers.set_class(document.body,  "force-ui", unsafeWindow.debug_show_ui);

        // Reset the manga page change indicator when we change images.
        this.flashed_page_change = false;

        // If we previously set a pending navigation, this navigation overrides it.
        this.cancel_async_navigation();

        // Remember that this is the image we want to be displaying.
        this.wanted_illust_id = illust_id;
        this.wanted_illust_page = manga_page;

        // If remote quick view is active, send this image.  Only do this if we have
        // focus, since if we don't have focus, we're probably receiving this from another
        // tab.
        if(settings.get("linked_tabs_enabled"))
            SendImage.send_image(illust_id, manga_page, settings.get("linked_tabs", []), "temp-view");

        // Get very basic illust info.  This is enough to tell which viewer to use, how
        // many pages it has, and whether it's muted.  This will always complete immediately
        // if we're coming from a search or anywhere else that will already have this info,
        // but it can block if we're loading from scratch.
        let early_illust_data = await thumbnail_data.singleton().get_or_load_illust_data(illust_id);

        // If we were deactivated while waiting for image info or the image we want to show has changed, stop.
        if(!this.active || this.wanted_illust_id != illust_id || this.wanted_illust_page != manga_page)
        {
            console.log("show_image: illust ID or page changed while async, stopping");
            return;
        }

        // If we didn't get illust info, the image has probably been deleted.
        if(early_illust_data == null)
        {
            let message = image_data.singleton().get_illust_load_error(illust_id);
            message_widget.singleton.show(message);
            message_widget.singleton.clear_timer();
            return;
        }

        // If manga_page is -1, update wanted_illust_page with the last page now that we know
        // what it is.
        if(manga_page == -1)
            manga_page = early_illust_data.pageCount - 1;
        else
            manga_page = helpers.clamp(manga_page, 0, early_illust_data.pageCount-1);
        this.wanted_illust_page = manga_page;

        // If this image is already loaded, just make sure it's not hidden.
        if( this.wanted_illust_id == this.current_illust_id && 
            this.wanted_illust_page == this.viewer.page &&
            this.viewer != null && 
            this.hiding_muted_image == this.view_muted && // view-muted not changing
            !this._hide_image)
        {
            console.log(`illust ${illust_id} page ${this.wanted_illust_page} is already displayed`);
            return;
        }

        console.log(`Showing image ${illust_id} page ${manga_page}`);

        helpers.set_title_and_icon(early_illust_data);
        
        // Tell the preloader about the current image.
        image_preloader.singleton.set_current_image(illust_id, manga_page);

        // If we adjusted the page, update the URL.  Allow "page" to be 1 or not present for
        // page 1.
        var args = helpers.args.location;
        var wanted_page_arg = early_illust_data.pageCount > 1? (manga_page + 1):1;
        let current_page_arg = args.hash.get("page") || "1";
        if(current_page_arg != wanted_page_arg)
        {
            if(wanted_page_arg != null)
                args.hash.set("page", wanted_page_arg);
            else
                args.hash.delete("page");

            console.log("Updating URL with page number:", args.hash.toString());
            helpers.set_page_url(args, false /* add_to_history */);
        }

        // This is the first image we're displaying if we previously had no illust ID, or
        // if we were hidden.
        let is_first_image_displayed = this.current_illust_id == -1 || this._hide_image;

        // Speculatively load the next image, which is what we'll show if you press page down, so
        // advancing through images is smoother.
        //
        // We don't do this when showing the first image, since the most common case is simply
        // viewing a single image and not navigating to any others, so this avoids making
        // speculative loads every time you load a single illustration.
        if(!is_first_image_displayed)
        {
            // get_navigation may block to load more search results.  Run this async without
            // waiting for it.
            (async() => {
                let { illust_id: new_illust_id, page: new_page } =
                    await this.get_navigation(this.latest_navigation_direction_down);

                // Let image_preloader handle speculative loading.  If preload_illust_id is null,
                // we're telling it that we don't need to load anything.
                image_preloader.singleton.set_speculative_image(new_illust_id, new_page);
            })();
        }

        // If the illust ID isn't changing, just update the viewed page.
        if(illust_id == this.current_illust_id && this.viewer != null && this.viewer.page != this.wanted_illust_page)
        {
            console.log("Image ID not changed, setting page", this.wanted_illust_page, "of image", this.current_illust_id);
            this._hide_image = false;
            this.viewer.page = this.wanted_illust_page;
            if(this.manga_thumbnails)
                this.manga_thumbnails.current_page_changed(manga_page);
            this.refresh_ui();

            return;
        }

        // Finalize the new illust ID.
        this.current_illust_id = illust_id;
        this.current_user_id = early_illust_data.userId;
        this.viewing_manga = early_illust_data.pageCount > 1; // for navigate_out_target
        this.ui.illust_id = illust_id;
        this.refresh_ui();

        if(this.update_mute(early_illust_data))
            return;

        // If the image has the ドット絵 tag, enable nearest neighbor filtering.
        helpers.set_class(document.body, "dot", helpers.tags_contain_dot(early_illust_data));

        // Dismiss any message when changing images.
        message_widget.singleton.hide();
       
        // Create the image viewer.
        let viewer_class;
        if(early_illust_data.illustType == 2)
            viewer_class = viewer_ugoira;
        else if(early_illust_data.illustType == "video")
            viewer_class = viewer_video;
        else
            viewer_class = viewer_images;

        // If we already have a viewer, only recreate it if we need a different type.
        // Reusing the same viewer when switching images helps prevent flicker.
        if(this.viewer && !(this.viewer instanceof viewer_class))
            this.remove_viewer();

        if(this.viewer == null)
        {
            let image_container = this.image_container;
            this.viewer = new viewer_class({
                contents: image_container,
                manga_page_bar: this.manga_page_bar,
                video_ui: this.video_ui,
            });
        }

        this.viewer.load(illust_id, manga_page, {
            restore_history: restore_history,
        });

        // If the viewer was hidden, unhide it now that the new one is set up.
        this._hide_image = false;

        this.viewer.active = this._active;

        // Refresh the UI now that we have a new viewer.
        this.refresh_ui();
    }

    get view_muted()
    {
        return helpers.args.location.hash.get("view-muted") == "1";
    }

    should_hide_muted_image(early_illust_data)
    {
        let muted_tag = muting.singleton.any_tag_muted(early_illust_data.tagList);
        let muted_user = muting.singleton.is_muted_user_id(early_illust_data.userId);
        if(this.view_muted || (!muted_tag && !muted_user))
            return { is_muted: false };

        return { is_muted: true, muted_tag: muted_tag, muted_user: muted_user };
    }

    update_mute(early_illust_data)
    {
        // Check if this post is muted.
        let { is_muted } = this.should_hide_muted_image(early_illust_data);
        this.hiding_muted_image = this.view_muted;
        if(!is_muted)
            return false;
    
        // Tell the thumbnail view about the image.  If the image is muted, disable thumbs.
        if(this.manga_thumbnails)
            this.manga_thumbnails.set_illust_info(null);

        // If the image is muted, load a dummy viewer.
        this.remove_viewer();
        this.viewer = new viewer_muted({
            contents: this.image_container,
            illust_id: this.current_illust_id,
        });
        this._hide_image = false;
        return true;
    }
    
    // Remove the old viewer, if any.
    remove_viewer()
    {
        if(this.viewer != null)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }
    }

    // If we started navigating to a new image and were delayed to load data (either to load
    // the image or to load a new page), cancel it and stay where we are.
    cancel_async_navigation()
    {
        // If we previously set a pending navigation, this navigation overrides it.
        if(this.pending_navigation == null)
            return;

        console.info("Cancelling async navigation");
        this.pending_navigation = null;
    }

    // Stop displaying any image (and cancel any wanted navigation), putting us back
    // to where we were before displaying any images.
    //
    // This will also prevent the next image displayed from triggering speculative
    // loading, which we don't want to do when clicking an image in the thumbnail
    // view.
    stop_displaying_image()
    {
        if(this.viewer != null)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }

        if(this.manga_thumbnails)
            this.manga_thumbnails.set_illust_info(null);
        
        this.wanted_illust_id = null;
        this.current_illust_id = null;

        this.wanted_illust_page = 0;
        this.current_illust_id = null;
        this.refresh_ui();

        // Tell the preloader that we're not displaying an image anymore.
        image_preloader.singleton.set_current_image(null, null);
        image_preloader.singleton.set_speculative_image(null, null);

        // If remote quick view is active, cancel it if we leave the image.
        SendImage.send_message({
            message: "send-image",
            action: "cancel",
            to: settings.get("linked_tabs", []),
        });
    }

    data_source_updated()
    {
        this.refresh_ui();
    }

    get active()
    {
        return this._active;
    }

    // Refresh the UI for the current image.
    refresh_ui()
    {
        // Don't refresh if the thumbnail view is active.  We're not visible, and we'll just
        // step over its page title, etc.
        if(!this._active)
            return;
        
        // Tell the UI which page is being viewed.
        let illust_id = this.current_illust_id;
        let page = this.viewer != null? this.viewer.page:0;
        this.ui.set_displayed_page_info(page);

        // Tell the context menu which user is being viewed.
        main_context_menu.get.user_id = this.current_user_id;
        main_context_menu.get.set_illust(illust_id, page);

        // Update the disable UI button to point at the current image's illustration page.
        var disable_button = this.container.querySelector(".disable-ui-button");
        disable_button.href = "/artworks/" + illust_id + "#no-ppixiv";

        // If we're not showing an image yet, hide the UI and don't try to update it.
        helpers.set_class(this.container.querySelector(".ui"), "disabled", illust_id == -1);

        if(illust_id == -1)
            return;

        this.ui.refresh();

        // Tell the view that illust data changed.
        if(this.viewer?.illust_data_changed)
            this.viewer.illust_data_changed();
    }

    onwheel(e)
    {
        if(!this._active)
            return;        

        // Don't intercept wheel scrolling over the description box.
        if(e.target.closest(".description") != null)
            return;

        var down = e.deltaY > 0;
        this.move(down, e.shiftKey /* skip_manga_pages */);
    }

    get displayed_illust_id()
    {
        return this.wanted_illust_id;        
    }

    get displayed_illust_page()
    {
        return this.wanted_illust_page;
    }

    get navigate_out_target()
    {
        // If we're viewing a manga post, exit to the manga page view instead of the search.
        if(this.viewing_manga)
            return "manga";
        else
            return "search";
    }

    handle_onkeydown(e)
    {
        // Let the viewer handle the input first.
        if(this.viewer && this.viewer.onkeydown)
        {
            this.viewer.onkeydown(e);
            if(e.defaultPrevented)
                return;
        }

        this.ui.handle_onkeydown(e);
        if(e.defaultPrevented)
            return;
        
        if(e.ctrlKey || e.altKey || e.metaKey)
            return;

        switch(e.keyCode)
        {
        case 37: // left
        case 38: // up
        case 33: // pgup
            e.preventDefault();
            e.stopPropagation();

            this.move(false, e.shiftKey /* skip_manga_pages */);
            break;

        case 39: // right
        case 40: // down
        case 34: // pgdn
            e.preventDefault();
            e.stopPropagation();

            this.move(true, e.shiftKey /* skip_manga_pages */);
            break;
        }
    }

    // Get the illust_id and page navigating down (or up) will go to.
    //
    // This may trigger loading the next page of search results, if we've reached the end.
    async get_navigation(down, { skip_manga_pages=false, }={})
    {
        // Check if we're just changing pages within the same manga post.
        let leaving_manga_post = false;
        if(!skip_manga_pages && this.wanted_illust_id != null)
        {
            // Using early_illust_data here means we can handle page navigation earlier, if
            // the user navigates before we have full illust info.
            let early_illust_data = await thumbnail_data.singleton().get_or_load_illust_data(this.wanted_illust_id);
            let num_pages = early_illust_data.pageCount;
            if(num_pages > 1)
            {
                var old_page = this.displayed_illust_page;
                var new_page = old_page + (down? +1:-1);
                new_page = Math.max(0, Math.min(num_pages - 1, new_page));
                if(new_page != old_page)
                    return { illust_id: this.wanted_illust_id, page: new_page };

                // If the page didn't change, we reached the end of the manga post.
                leaving_manga_post = true;
            }
        }

        // If we have a target illust_id, move relative to it.  Otherwise, move relative to the
        // displayed image.  This way, if we navigate repeatedly before a previous navigation
        // finishes, we'll keep moving rather than waiting for each navigation to complete.
        var navigate_from_illust_id = this.wanted_illust_id;
        if(navigate_from_illust_id == null)
            navigate_from_illust_id = this.current_illust_id;

        // Get the next (or previous) illustration after the current one.  This will be null if we've
        // reached the end of the list, or if it requires loading the next page of search results.
        var new_illust_id = this.data_source.id_list.get_neighboring_illust_id(navigate_from_illust_id, down);
        if(new_illust_id == null)
        {
            // We didn't have the new illustration, so we may need to load another page of search results.
            // Find the page the current illustration is on.
            let next_page = this.data_source.id_list.get_page_for_neighboring_illust(navigate_from_illust_id, down);

            // If we can't find the next page, then the current image isn't actually loaded in
            // the current search results.  This can happen if the page is reloaded: we'll show
            // the previous image, but we won't have the results loaded (and the results may have
            // changed).  Just jump to the first image in the results so we get back to a place
            // we can navigate from.
            //
            // Note that we use id_list.get_first_id rather than get_current_illust_id, which is
            // just the image we're already on.
            if(next_page == null)
            {
                // We should normally know which page the illustration we're currently viewing is on.
                console.log("Don't know the next page for illust", navigate_from_illust_id);
                new_illust_id = this.data_source.id_list.get_first_id();
                if(new_illust_id != null)
                    return { illust_id: new_illust_id };

                return { };
            }
            console.log("Loaded the next page of results:", next_page);

            // The page shouldn't already be loaded.  Double-check to help prevent bugs that might
            // spam the server requesting the same page over and over.
            if(this.data_source.id_list.is_page_loaded(next_page))
            {
                console.error("Page", next_page, "is already loaded");
                return { };
            }

            // Ask the data source to load it.
            let new_page_loaded = this.data_source.load_page(next_page, { cause: "illust navigation" });

            // Wait for results.
            new_page_loaded = await new_page_loaded;

            if(new_page_loaded)
            {
                // Now that we've loaded data, try to find the new image again.
                new_illust_id = this.data_source.id_list.get_neighboring_illust_id(navigate_from_illust_id, down);
            }

            console.log("Retrying navigation after data load");
        }

        let page = down || skip_manga_pages? 0:-1;
        return { illust_id: new_illust_id, page: page, leaving_manga_post: leaving_manga_post };
    }

    // Navigate to the next or previous image.
    //
    // If skip_manga_pages is true, jump past any manga pages in the current illustration.  If
    // this is true and we're navigating backwards, we'll also jump to the first manga page
    // instead of the last.
    async move(down, skip_manga_pages)
    {
        // Remember whether we're navigating forwards or backwards, for preloading.
        this.latest_navigation_direction_down = down;

        this.cancel_async_navigation();

        let pending_navigation = this.pending_navigation = new Object();

        // See if we should change the manga page.  This may block if it needs to load
        // the next page of search results.
        let { illust_id: new_illust_id, page, end, leaving_manga_post } = await this.get_navigation(down, {
            skip_manga_pages: skip_manga_pages,
        });
    
        // If we didn't get a page, we're at the end of the search results.  Flash the
        // indicator to show we've reached the end and stop.
        if(new_illust_id == null)
        {
            console.log("Reached the end of the list");
            this.flash_end_indicator(down, "last-image");
            return { illust_id: null, page: null, end: true };
        }

        // If this.pending_navigation is no longer the same as pending_navigation, we navigated since
        // we requested this load and this navigation is stale, so stop.
        if(this.pending_navigation != pending_navigation)
        {
            console.error("Aborting stale navigation");
            return { stale: true };
        }

        this.pending_navigation = null;

        // If we didn't get a page, we're at the end of the search results.  Flash the
        // indicator to show we've reached the end and stop.
        if(end)
        {
            console.log("Reached the end of the list");
            this.flash_end_indicator(down, "last-image");
            return;
        }

        // If we're confirming leaving a manga post, do that now.  This is done after we load the
        // new page of search results if needed, so we know whether we've actually reached the end
        // and should show the end indicator above instead.
        if(leaving_manga_post && !this.flashed_page_change && 0)
        {
            this.flashed_page_change = true;
            this.flash_end_indicator(down, "last-page");

            // Start preloading the next image, so we load faster if the user scrolls again to go
            // to the next image.
            if(new_illust_id != null)
                image_data.singleton().get_image_info(new_illust_id);
            return;
        }

        // Go to the new illustration if we have one.
        if(new_illust_id != null)
            main_controller.singleton.show_illust(new_illust_id, { page: page });
    }

    flash_end_indicator(down, icon)
    {
        let indicator = this.container.querySelector(".page-change-indicator");
        indicator.dataset.icon = icon;
        indicator.dataset.side = down? "right":"left";
        indicator.classList.remove("flash");

        // Call getAnimations() so the animation is removed immediately:
        indicator.getAnimations();

        indicator.classList.add("flash");
    }
}

