"use strict";

// The main UI.  This handles creating the viewers and the global UI.
ppixiv.screen_illust = class extends ppixiv.screen
{
    constructor(options)
    {
        super({...options, template: `
            <div class="screen screen-illust-container">
                <!-- Mouse movement is detected inside mouse-hidden-box.  Anything outside of it will
                     be unaffected by mouse hiding. -->
                <div class="view-container mouse-hidden-box" data-context-menu-target></div>

                <div class=page-change-indicator data-icon=last-image>
                    <ppixiv-inline src="resources/last-page.svg"></ppixiv-inline>
                </div>

                <!-- The top-left hover UI is inserted here. -->
                <div class=ui>
                    <div class=hover-sphere>
                        <svg viewBox="0 0 1 1" preserveAspectRatio="none">
                            <circle class=hover-circle cx="0.5" cy="0.5" r=".5" fill-opacity="0" />
                        </svg>
                    </div>
                </div>
            </div>
        `});
        
        this.current_media_id = null;
        this.latest_navigation_direction_down = true;

        // Create a UI box and put it in its container.
        var ui_container = this.container.querySelector(".ui");
        this.ui = new image_ui({
            container: ui_container,
            parent: this,
        });
        
        user_cache.addEventListener("usermodified", this.refresh_ui, { signal: this.shutdown_signal.signal });        
        media_cache.addEventListener("mediamodified", this.refresh_ui, { signal: this.shutdown_signal.signal });
        settings.addEventListener("recent-bookmark-tags", this.refresh_ui, { signal: this.shutdown_signal.signal });

        this.view_container = this.container.querySelector(".view-container");

        // Remove the "flash" class when the page change indicator's animation finishes.
        let page_change_indicator = this.container.querySelector(".page-change-indicator");
        page_change_indicator.addEventListener("animationend", (e) => {
            page_change_indicator.classList.remove("flash");
        });

        // Desktop UI:
        if(!ppixiv.mobile)
        {
            // Show the corner UI on hover.
            this.ui.container.addEventListener("mouseenter", (e) => { this.hovering_over_box = true; this.refresh_overlay_ui_visibility(); });
            this.ui.container.addEventListener("mouseleave", (e) => { this.hovering_over_box = false; this.refresh_overlay_ui_visibility(); });
   
            let hover_circle = this.container.querySelector(".ui .hover-circle");
            hover_circle.addEventListener("mouseenter", (e) => { this.hovering_over_sphere = true; this.refresh_overlay_ui_visibility(); });
            hover_circle.addEventListener("mouseleave", (e) => { this.hovering_over_sphere = false; this.refresh_overlay_ui_visibility(); });
            settings.addEventListener("image_editing", () => { this.refresh_overlay_ui_visibility(); });
            settings.addEventListener("image_editing_mode", () => { this.refresh_overlay_ui_visibility(); });
            this.refresh_overlay_ui_visibility();
        
            // Fullscreen on double-click.
            this.view_container.addEventListener("dblclick", () => {
                helpers.toggle_fullscreen();
            });

            new hide_mouse_cursor_on_idle(this.container.querySelector(".mouse-hidden-box"));

            this.container.addEventListener("wheel", this.onwheel, { passive: false });
        }

        // Mobile UI:
        if(ppixiv.mobile)
        {
            this.mobile_illust_ui = new mobile_illust_ui({
                container: this.container,
            });

            // Navigate to the next or previous image on double-tap.
            this.double_tap_handler = new ppixiv.MobileDoubleTapHandler({
                container: this.view_container,
                signal: this.shutdown_signal.signal,
                ondbltap: (e) => {
                    let left = e.clientX < 100;
                    let right = e.clientX > this.container.offsetWidth - 100;
                    if(left || right)
                    {
                        if(this.mobile_illust_ui.shown)
                            this.mobile_illust_ui.hide();
                        else
                        {
                            this.mobile_illust_ui.show({side: left? "left":"right"});

                            // See the comments on this function for an explanation of this.  This is necessary
                            // so the tap that displays the menu doesn't also activate whatever becomes visible.
                            helpers.prevent_clicks_until_pointer_released(this.mobile_illust_ui.container, e.pointerId);
                        }
                    } else {
                        this.mobile_illust_ui.hide();

                        let right = e.clientX > window.innerWidth/2;
                        this.navigate_to_next(right);
                    }
                },
            });
        }

        this.set_active(false, { });
    }

    refresh_overlay_ui_visibility()
    {
        // Hide widgets inside the hover UI when it's hidden.
        let visible = this.hovering_over_box || this.hovering_over_sphere;

        // Don't show the hover UI while editing, since it can get in the way of trying to
        // click the image.
        let editing = settings.get("image_editing") && settings.get("image_editing_mode") != null;
        if(editing)
            visible = false;

        if(!visible)
            view_hidden_listener.send_viewhidden(this.ui.container);

        // Tell the image UI when it's visible.
        this.ui.visible = visible;

        // Hide the UI's container too when we're editing, so the hover boxes don't get in
        // the way.
        this.container.querySelector(".ui").hidden = editing || ppixiv.mobile;
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
        return this.view_container.hidden;
    }
    set _hide_image(value)
    {
        this.view_container.hidden = value;
    }
    
    async set_active(active, { media_id, data_source, restore_history })
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
            main_context_menu.get.set_media_id(null);

            if(this.mobile_illust_ui)
            {
                this.mobile_illust_ui.media_id = null;
                this.mobile_illust_ui.set_data_source(null);
            }

            this.stop_displaying_image();
            
            // We leave editing on when navigating between images, but turn it off when we exit to
            // the search.
            settings.set("image_editing_mode", null);

            return;
        }

        this.set_data_source(data_source);
        this.show_image(media_id, restore_history);
        
        // Focus the container, so it receives keyboard events like home/end.
        this.container.focus();
    }

    // Show an image.
    async show_image(media_id, restore_history) 
    {
        console.assert(media_id != null);

        helpers.set_class(document.body,  "force-ui", unsafeWindow.debug_show_ui);
        let [illust_id, manga_page] = helpers.media_id_to_illust_id_and_page(media_id);

        // If we previously set a pending navigation, this navigation overrides it.
        this.cancel_async_navigation();

        if(await this.load_first_image(media_id))
            return;

        // Remember that this is the image we want to be displaying.
        this.wanted_media_id = media_id;

        // If linked tabs are active, send this image.
        if(settings.get("linked_tabs_enabled"))
            ppixiv.send_image.send_image(media_id, settings.get("linked_tabs", []), "temp-view");

        // Get very basic illust info.  This is enough to tell which viewer to use, how
        // many pages it has, and whether it's muted.  This will always complete immediately
        // if we're coming from a search or anywhere else that will already have this info,
        // but it can block if we're loading from scratch.
        let early_illust_data = await media_cache.get_media_info(media_id, { full: false });

        // If we were deactivated while waiting for image info or the image we want to show has changed, stop.
        if(!this.active || this.wanted_media_id != media_id)
        {
            console.log("show_image: illust ID or page changed while async, stopping");
            return;
        }

        // If we didn't get illust info, the image has probably been deleted.
        if(early_illust_data == null)
        {
            let message = media_cache.get_illust_load_error(illust_id);
            message_widget.singleton.show(message);
            message_widget.singleton.clear_timer();
            return;
        }

        console.log(`Showing image ${media_id}`);

        helpers.set_title_and_icon(early_illust_data);
        
        // Tell the preloader about the current image.
        image_preloader.singleton.set_current_image(media_id);

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
        let is_first_image_displayed = this.current_media_id == null || this._hide_image;

        // Speculatively load the next image, which is what we'll show if you press page down, so
        // advancing through images is smoother.
        //
        // If we're not local, don't do this when showing the first image, since the most common
        // case is simply viewing a single image and then backing out to the search, so this avoids
        // doing extra loads every time you load a single illustration.
        if(!is_first_image_displayed || helpers.is_media_id_local(media_id))
        {
            // get_navigation may block to load more search results.  Run this async without
            // waiting for it.
            (async() => {
                let { media_id: new_media_id } =
                    await this.get_navigation(this.latest_navigation_direction_down);

                // Let image_preloader handle speculative loading.  If new_media_id is null,
                // we're telling it that we don't need to load anything.
                image_preloader.singleton.set_speculative_image(new_media_id);
            })();
        }

        // Finalize the new illust ID.
        this.current_media_id = media_id;
        this.current_user_id = early_illust_data.userId;
        this.ui.media_id = media_id;
        this.refresh_ui();

        // If the image has the ドット絵 tag, enable nearest neighbor filtering.
        helpers.set_class(document.body, "dot", helpers.tags_contain_dot(early_illust_data));

        // Dismiss any message when changing images.
        message_widget.singleton.hide();
       
        // Create the image viewer.
        let viewer_class;

        this.viewing_muted_image = this.view_muted;

        let { is_muted } = this.should_hide_muted_image(early_illust_data);
        if(is_muted)
            viewer_class = viewer_muted;
        else if(early_illust_data.illustType == 2)
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
            this.viewer = new viewer_class({
                container: this.view_container,
                manga_page_bar: this.ui.manga_page_bar,
            });
        }

        let slideshow = helpers.args.location.hash.get("slideshow") == "1";

        this.viewer.load(media_id, {
            restore_history: restore_history,
            slideshow: slideshow,
            onnextimage: async () => {
                if(!this._active)
                    return { };

                // The viewer wants to go to the next image, normally during slideshows.
                // Loop is true, so we loop back to the beginning of the search if we reach
                // the end in a slideshow.
                let skip_manga_pages = settings.get("slideshow_skips_manga");
                return await this.navigate_to_next(1, { loop: true, flash_at_end: false, skip_manga_pages });
            },
        });

        // If the viewer was hidden, unhide it now that the new one is set up.
        this._hide_image = false;

        this.viewer.active = this._active;

        // Refresh the UI now that we have a new viewer.
        this.refresh_ui();
    }

    // If we're loading "*", it's a placeholder saying to view the first search result.
    // This allows viewing shuffled results.  This can be a Pixiv illust ID of *, or
    // a local ID with a filename of *.  Load the initial data source page if it's not
    // already loaded, and navigate to the first result.
    async load_first_image(media_id)
    {
        if(helpers.is_media_id_local(media_id))
        {
            let args = helpers.args.location;
            local_api.get_args_for_id(media_id, args);
            if(args.hash.get("file") != "*")
                return false;
        }
        else if(helpers.parse_media_id(media_id).id != "*")
            return false;

        // This will load results if needed, skip folders so we only pick images, and return
        // the first ID.
        let new_media_id = await this.data_source.get_or_load_neighboring_media_id(null, true);
        if(new_media_id == null)
        {
            message_widget.singleton.show("Couldn't find an image to view");
            return true;
        }

        main_controller.singleton.show_media(new_media_id, {
            add_to_history: false,
        });
        return true;
    }

    // Reeturn true if we're allowing a muted image to be displayed, because the user
    // clicked to override it in the mute view.
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
    
    // Remove the old viewer, if any.
    remove_viewer()
    {
        if(this.viewer != null)
        {
            this.viewer.shutdown();
            this.viewer.container.remove();
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
        this.remove_viewer();

        this.wanted_media_id = null;
        this.current_media_id = null;

        this.refresh_ui();

        // Tell the preloader that we're not displaying an image anymore.
        image_preloader.singleton.set_current_image(null);
        image_preloader.singleton.set_speculative_image(null);

        // If remote quick view is active, cancel it if we leave the image.
        if(settings.get("linked_tabs_enabled"))
        {
            ppixiv.send_image.send_message({
                message: "send-image",
                action: "cancel",
                to: settings.get("linked_tabs", []),
            });
        }
    }

    data_source_updated = () =>
    {
        this.refresh_ui();
    }

    get active()
    {
        return this._active;
    }

    // Refresh the UI for the current image.
    refresh_ui = (e) =>
    {
        // Don't refresh if the thumbnail view is active.  We're not visible, and we'll just
        // step over its page title, etc.
        if(!this._active)
            return;
        
        // Tell the UI which page is being viewed.
        this.ui.media_id = this.current_media_id;

        // Tell the context menu which user is being viewed.
        main_context_menu.get.user_id = this.current_user_id;
        main_context_menu.get.set_media_id(this.current_media_id);

        if(this.mobile_illust_ui)
        {
            this.mobile_illust_ui.user_id = this.current_user_id;
            this.mobile_illust_ui.media_id = this.current_media_id;
            this.mobile_illust_ui.set_data_source(this.data_source);
            if(this.viewer)
                this.mobile_illust_ui.set_bottom_reservation(this.viewer.bottom_reservation);
        }

        // Update the disable UI button to point at the current image's illustration page.
        var disable_button = this.container.querySelector(".disable-ui-button");
        let [illust_id] = helpers.media_id_to_illust_id_and_page(this.current_media_id);
        disable_button.href = `/artworks/${illust_id}#no-ppixiv`;

        // If we're not showing an image yet, hide the UI and don't try to update it.
        helpers.set_class(this.container.querySelector(".ui"), "disabled", this.current_media_id == null);

        if(this.current_media_id == null)
            return;

        this.ui.refresh();

        // Tell the view that illust data changed.
        if(this.viewer?.illust_data_changed)
            this.viewer.illust_data_changed();
    }

    onwheel = (e) =>
    {
        if(!this._active)
            return;        

        // Don't intercept wheel scrolling over the description box.
        if(e.target.closest(".description") != null)
            return;

        var down = e.deltaY > 0;
        this.navigate_to_next(down, { skip_manga_pages: e.shiftKey });
    }

    get displayed_media_id()
    {
        return this.wanted_media_id;
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
        switch(e.key)
        {
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
            e.preventDefault();
            e.stopPropagation();

            this.navigate_to_next(false, { skip_manga_pages: e.shiftKey });
            break;

        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
            e.preventDefault();
            e.stopPropagation();

            this.navigate_to_next(true, { skip_manga_pages: e.shiftKey });
            break;
        }
    }

    // Get the media_id and page navigating down (or up) will go to.
    //
    // This may trigger loading the next page of search results, if we've reached the end.
    async get_navigation(down, { skip_manga_pages=false, loop=false }={})
    {
        // Check if we're just changing pages within the same manga post.
        // If we have a target media_id, move relative to it.  Otherwise, move relative to the
        // displayed image.  This way, if we navigate repeatedly before a previous navigation
        // finishes, we'll keep moving rather than waiting for each navigation to complete.
        let navigate_from_media_id = this.wanted_media_id;
        if(navigate_from_media_id == null)
            navigate_from_media_id = this.current_media_id;

        // Get the next (or previous) illustration after the current one.  This will be null if we've
        // reached the end of the list.
        let new_media_id = await this.data_source.get_or_load_neighboring_media_id(navigate_from_media_id, down, { skip_manga_pages: skip_manga_pages });

        // If we're at the end and we're looping, go to the first (or last) image.
        if(new_media_id == null && loop)
        {
            new_media_id = down? this.data_source.id_list.get_first_id():this.data_source.id_list.get_last_id();

            // If we only have one image, don't loop.  We won't actually navigate so things
            // don't quite work (navigating to the same media ID won't trigger a navigation
            // at all), and it's not very useful.
            if(new_media_id == navigate_from_media_id)
            {
                console.log("Not looping since we only have one media ID");
                return { };
            }
        }
    
        if(new_media_id == null)
            return { };

        // If we're moving backwards and not skipping manga pages, we want to go to the last page
        // on the new image.  Load image info to get the page count.
        let page = 0;
        if(!down && !skip_manga_pages)
        {
            let new_page_info = await media_cache.get_media_info(new_media_id, { full: false });
            page = new_page_info.pageCount - 1;
        }

        return { media_id: new_media_id };
    }

    // Navigate to the next or previous image.
    //
    // If skip_manga_pages is true, jump past any manga pages in the current illustration.  If
    // this is true and we're navigating backwards, we'll also jump to the first manga page
    // instead of the last.
    async navigate_to_next(down, { skip_manga_pages=false, loop=false, flash_at_end=true }={})
    {
        // Remember whether we're navigating forwards or backwards, for preloading.
        this.latest_navigation_direction_down = down;

        this.cancel_async_navigation();

        let pending_navigation = this.pending_navigation = new Object();

        // See if we should change the manga page.  This may block if it needs to load
        // the next page of search results.
        let { media_id: new_media_id } = await this.get_navigation(down, {
            skip_manga_pages: skip_manga_pages,
            loop: loop,
        });
    
        // If we didn't get a page, we're at the end of the search results.  Flash the
        // indicator to show we've reached the end and stop.
        if(new_media_id == null)
        {
            console.log("Reached the end of the list");
            if(flash_at_end)
                this.flash_end_indicator(down, "last-image");
            return { reached_end: true };
        }

        // If this.pending_navigation is no longer the same as pending_navigation, we navigated since
        // we requested this load and this navigation is stale, so stop.
        if(this.pending_navigation != pending_navigation)
        {
            console.error("Aborting stale navigation");
            return { stale: true };
        }

        this.pending_navigation = null;

        // Go to the new illustration.
        main_controller.singleton.show_media(new_media_id);
        return { media_id: new_media_id };
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

