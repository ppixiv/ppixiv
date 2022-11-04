"use strict";

// The main UI.  This handles creating the viewers and the global UI.
ppixiv.screen_illust = class extends ppixiv.screen
{
    constructor(options)
    {
        super({...options, visible: false, template: `
            <div class="screen screen-illust-container">
                <!-- This holds our views: the current view, and the neighbor view if we're transitioning
                     between them. -->
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
        
        // Make sure the hover UI isn't shown on mobile.
        if(ppixiv.mobile)
            ui_container.hidden = true;

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

            this.drag_image_changer = new DragImageChanger({ parent: this });
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
        this.visible = active;

        // If we have a viewer, tell it if we're active.
        if(this.viewer != null)
            this.viewer.active = this._active;

        // If we have a drag handler for mobile, cancel any drag or animation in progress
        // if the image changes externally or if we're deactivated.
        if(this.drag_image_changer)
            this.drag_image_changer.stop();

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
        this.show_image(media_id, { restore_history });
        
        // Focus the container, so it receives keyboard events like home/end.
        this.container.focus();
    }

    // Create a viewer for media_id and begin loading it asynchronously.
    create_viewer({ media_id, early_illust_data, ...options }={})
    {
        let viewer_class;

        let is_muted = early_illust_data && this.should_hide_muted_image(early_illust_data).is_muted;
        let is_error = early_illust_data == null;
        if(is_muted)
        {
            viewer_class = viewer_error;
        }
        else if(is_error)
        {
            viewer_class = viewer_error;
            options = { ...options, error: media_cache.get_media_load_error(media_id) };
        }
        else if(early_illust_data.illustType == 2)
            viewer_class = viewer_ugoira;
        else if(early_illust_data.illustType == "video")
            viewer_class = viewer_video;
        else
            viewer_class = viewer_images;

        let slideshow = helpers.args.location.hash.get("slideshow");
        let new_viewer = new viewer_class({
            media_id,
            container: this.view_container,
            slideshow,
            manga_page_bar: this.ui.manga_page_bar,
            onnextimage: async () => {
                if(!this._active)
                    return { };

                // The viewer wants to go to the next image, normally during slideshows.
                let manga = settings.get("slideshow_skips_manga")? "skip-to-first":"normal";
                return await this.navigate_to_next(1, { flash_at_end: false, manga });
            },
            ...options,
        });
        
        new_viewer.load();

        return new_viewer;
    }

    // Show a media ID.
    async show_image(media_id, { restore_history=false }={})
    {
        console.assert(media_id != null);

        // If we previously set a pending navigation, this navigation overrides it.
        this.cancel_async_navigation();

        if(await this.load_first_image(media_id))
            return;

        // Remember that this is the image we want to be displaying.
        this.wanted_media_id = media_id;

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

        // If we weren't given a viewer to use, create one.
        let new_viewer = this.create_viewer({
            early_illust_data,
            media_id,
            restore_history,
        });

        this.show_image_viewer({ new_viewer });
    }

    // Show a viewer.
    show_image_viewer({ new_viewer=null }={})
    {
        helpers.set_class(document.body,  "force-ui", window.debug_show_ui);

        let media_id = new_viewer.media_id;
        console.log(`Showing image ${media_id}`);

        // Dismiss any message when changing images.
        if(this.current_media_id != media_id)
            message_widget.singleton.hide();

        this.wanted_media_id = media_id;
        this.current_media_id = media_id;

        // This should always be available, because the caller always looks up media info
        // in order to create the viewer, which means we don't have to go async here.  If
        // this returns null, it should always mean we're viewing an image's error page.
        let early_illust_data = media_cache.get_media_info_sync(media_id, { full: false });
        helpers.set_title_and_icon(early_illust_data);

        // If the image has the ドット絵 tag, enable nearest neighbor filtering.
        helpers.set_class(document.body, "dot", helpers.tags_contain_dot(early_illust_data?.tagList));

        // If linked tabs are active, send this image.
        if(settings.get("linked_tabs_enabled"))
            ppixiv.send_image.send_image(media_id, settings.get("linked_tabs", []), "temp-view");

        // Tell the preloader about the current image.
        image_preloader.singleton.set_current_image(media_id);

        // This is the first image we're displaying if we previously had no illust ID, or
        // if we were hidden.
        let is_first_image_displayed = this.current_media_id == null || this._hide_image;

        // Make sure the URL points to this image.
        let args = main_controller.get_media_url(media_id);
        helpers.navigate(args, { add_to_history: false, send_popstate: false });

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
                let new_media_id = await this.get_navigation(this.latest_navigation_direction_down);

                // Let image_preloader handle speculative loading.  If new_media_id is null,
                // we're telling it that we don't need to load anything.
                image_preloader.singleton.set_speculative_image(new_media_id);
            })();
        }

        this.current_user_id = early_illust_data?.userId;
        this.refresh_ui();

        // If we already have an old viewer, then we loaded an image, and then navigated again before
        // the new image was displayed.  Discard the new image and keep the old one, since it's what's
        // being displayed.
        if(this.old_viewer && this.viewer)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }
        else
            this.old_viewer = this.viewer;

        this.viewer = new_viewer;

        let old_viewer = this.old_viewer;
        this.viewer.ready.finally(async() => {
            // Await once in case this is called synchronously.
            await helpers.sleep(0);

            // Allow this to be called multiple times.
            if(this.old_viewer == null)
                return;

            // The new viewer is displaying an image, so we can remove the old viewer now.
            //
            // If we're not the main viewer anymor, another one was created.  We'll do this when
            // its onready is called.
            if(this.viewer !== new_viewer || old_viewer !== this.old_viewer)
                return;

            this.old_viewer.shutdown();
            this.old_viewer = null;
        });

        // If the viewer was hidden, unhide it now that the new one is set up.
        this._hide_image = false;

        this.viewer.active = this._active;

        // Refresh the UI now that we have a new viewer.
        this.refresh_ui();
    }

    // Take the current viewer out of the screen.  It'll still be active and in the document.
    // This is used by DragImageChanger to change the current viewer into a preview viewer.
    take_viewer()
    {
        let viewer = this.viewer;
        this.viewer = null;
        return viewer;
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

        main_controller.show_media(new_media_id, {
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
    }

    onwheel = (e) =>
    {
        if(!this._active)
            return;        

        // Don't intercept wheel scrolling over the description box.
        if(e.target.closest(".description") != null)
            return;

        var down = e.deltaY > 0;
        this.navigate_to_next(down, { manga: e.shiftKey? "skip-to-first":"normal" });
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

            this.navigate_to_next(false, { manga: e.shiftKey? "skip-to-first":"normal" });
            break;

        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
            e.preventDefault();
            e.stopPropagation();

            this.navigate_to_next(true, { manga: e.shiftKey? "skip-to-first":"normal" });
            break;
        }
    }

    // Get the media_id and page navigating down (or up) will go to.
    //
    // This may trigger loading the next page of search results, if we've reached the end.
    async get_navigation(down, { navigate_from_media_id=null, manga="normal", loop=false }={})
    {
        // Check if we're just changing pages within the same manga post.
        // If we have a target media_id, move relative to it.  Otherwise, move relative to the
        // displayed image.  This way, if we navigate repeatedly before a previous navigation
        // finishes, we'll keep moving rather than waiting for each navigation to complete.
        navigate_from_media_id ??= this.wanted_media_id;
        navigate_from_media_id ??= this.current_media_id;

        // Get the next (or previous) illustration after the current one.
        if(!loop)
            return await this.data_source.get_or_load_neighboring_media_id(navigate_from_media_id, down, { manga });

        let media_id = await this.data_source.get_neighboring_media_id_with_loop(navigate_from_media_id, down, { manga });

        // If we only have one image, don't loop.  We won't actually navigate so things
        // don't quite work, since navigating to the same media ID won't trigger a navigation.
        if(media_id == navigate_from_media_id)
        {
            console.log("Not looping since we only have one media ID");
            return null;
        }

        return media_id;
    }

    // Navigate to the next or previous image.
    //
    // manga is a manga skip mode.  See illust_id_list.get_neighboring_media_id.
    async navigate_to_next(down, { manga="normal", flash_at_end=true }={})
    {
        // Loop if we're in slideshow mode, otherwise stop when we reach the end.
        let loop = helpers.args.location.hash.get("slideshow") != null;

        // If we're viewing an error page, always skip manga pages.
        if(manga == "normal" && this.viewer instanceof viewer_error)
            manga = "skip-past";

        // Remember whether we're navigating forwards or backwards, for preloading.
        this.latest_navigation_direction_down = down;

        this.cancel_async_navigation();

        let pending_navigation = this.pending_navigation = new Object();

        // See if we should change the manga page.  This may block if it needs to load
        // the next page of search results.
        let new_media_id = await this.get_navigation(down, { manga, loop });
    
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
        main_controller.show_media(new_media_id);
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


// Handle mobile image switching.
//
// We switch images by dragging vertically across the edge of the screen.  This mimics
// iOS's task switching by dragging at the bottom.
//
// This is easier to implement than trying to drag past the edge of the image, since videos
// don't use touch dragging.  It also works better than swiping from the edge of the screen,
// since both iOS and Android have problems that make that impossible.
class DragImageChanger
{
    constructor({parent})
    {
        this.parent = parent;
        this.shutdown_signal = new AbortController();
        this.captured_pointer_id = null;

        // The amount we've dragged.  This is relative to the main image, so it doesn't need to
        // be adjusted when we add or remove viewers.
        this.drag_distance = null;

        // The amount of actual drag since a drag started.  This can be reset separately from
        // drag_distance.
        this.relative_drag_distance = null;
        
        // A list of viewers that we're dragging between.  This always includes the main viewer
        // which is owned by the screen.
        this.viewers = [];
        this.adding_viewer = false;
        this.image_gap = 25;
        this.animations = null;

        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.container,
            button_mask: 1,
            signal: this.shutdown_signal.signal,
            callback: this.pointerevent,
            capture: true,
        });
    }

    get container() { return this.parent.container; }

    // The main viewer is the one active in the screen.  this.drag_distance is relative to
    // it, and it's always in this.viewers during drags.
    get main_viewer() { return this.parent.viewer; }

    shutdown()
    {
        this.stop_dragging();
        this.shutdown_signal.abort();
    }

    // The image changed externally or the screen is becoming inactive, so stop any drags and animations.
    stop()
    {
        this.stop_dragging();
    }

    pointerevent = (e) =>
    {
        if(e.mouseButton != 0)
            return;

        if(e.pressed && this.captured_pointer_id == null)
        {
            // Stop if this press isn't near the edge.
            let edge_threshold = 50;
            let at_edge = e.clientX < edge_threshold || e.clientX > window.innerWidth - edge_threshold;
            if(!at_edge)
                return;

            // Claim the click, so it isn't handled by the viewer.
            // guh: simulatedpointerdown
            e.preventDefault();
            e.stopPropagation();

            this.start_dragging(e);
        } else {
            if(this.captured_pointer_id == null || e.pointerId != this.captured_pointer_id)
                return;

            this.stop_dragging({ interactive: true });
        }
    }

    async start_dragging(e)
    {
        this.captured_pointer_id = e.pointerId;
        this.container.setPointerCapture(this.captured_pointer_id);
        this.container.addEventListener("pointermove", this.pointermove);
        this.container.addEventListener("lostpointercapture", this.lost_pointer_capture);
        this.drag_distance = 0;
        this.relative_drag_distance = 0;

        if(this.animations == null)
        {
            // We weren't animating, so this is a new drag.  Start the list off with the main viewer.
            this.viewers = [this.main_viewer];
            return;
        }

        // Another drag started while the previous drag's transition was still happening.
        // Stop the animation, and set the drag_distance to where the animation was stopped.
        await this.cancel_animation();
    }

    // If an animation is running, cancel it.
    async cancel_animation()
    {
        if(!this.animations)
            return;

        let animations = this.animations;
        this.animations = null;

        // Pause the animations, and wait until the pause completes.
        for(let animation of animations)
            animation.pause();
        await Promise.all(animations.map((animation) => animation.ready));

        // If a drag is active, set drag_distance to the Y position of the main viewer to match
        // the drag to where the animation was.
        if(this.drag_distance != null && this.main_viewer)
        {
            let main_transform = new DOMMatrix(getComputedStyle(this.main_viewer.container).transform);
            this.drag_distance = main_transform.f;
            this.refresh_drag_position();
        }

        // Remove the animations.
        for(let animation of animations)
            animation.cancel();
    }

    // Treat lost pointer capture as the pointer being released.
    lost_pointer_capture = (e) =>
    {
        if(e.pointerId != this.captured_pointer_id)
            return;

        this.stop_dragging({interactive: true});
    }

    pointermove = (e) =>
    {
        if(e.pointerId != this.captured_pointer_id)
            return;

        this.drag_distance += e.movementY;
        this.relative_drag_distance += e.movementY;
        this.add_viewers_if_needed();
        this.refresh_drag_position();
    }

    get_viewer_y(viewer_index)
    {
        // This offset from the main viewer.  Viewers above are negative and below
        // are positive.
        let relative_idx = viewer_index - this.main_viewer_index;

        let y = (window.innerHeight + this.image_gap) * relative_idx;
        y += this.drag_distance;
        return y;
    }

    // Update the positions of all viewers during a drag.
    refresh_drag_position()
    {
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            let y = this.get_viewer_y(idx);
            viewer.container.style.transform = `translateY(${y}px)`;
            viewer.visible = true;
        }
    }

    // Return the index of the main viewer in this.viewers.
    get main_viewer_index()
    {
        let index = 0;
        let main_viewer = this.main_viewer;
        for(let viewer of this.viewers)
        {
            if(viewer == main_viewer)
                return index;
            index++;
        }
        console.error("Main viewer is missing");
        return 0;
    }

    // Add a new viewer if we've dragged far enough to need one.
    async add_viewers_if_needed()
    {
        // If we're already adding a viewer, don't try to add another until it finishes.
        if(this.adding_viewer)
            return;

        let drag_threshold = 5;

        // See if we need to add another viewer in either direction.
        //
        // The bottom edge of the topmost viewer, including the gap between images.  If this is
        // 0, it's just above the screen.
        let top_viewer_bottom = this.get_viewer_y(-1) + window.innerHeight + this.image_gap;
        let down = null;
        if(top_viewer_bottom > drag_threshold)
            down = false;

        // The top edge of the bottommost viewer.
        let bottom_viewer_top = this.get_viewer_y(this.viewers.length) - + this.image_gap;
        if(bottom_viewer_top < window.innerHeight - drag_threshold)
            down = true;

        // If the user drags multiple times quickly, the drag target may be past the end.
        // Add a viewer for it as soon as it's been dragged to, even though it may be well
        // off-screen, so we're able to transition to it.
        let target_viewer_index = this.current_drag_target();
        if(target_viewer_index < 0)
            down = false;
        else if(target_viewer_index >= this.viewers.length)
            down = true;

        // Stop if we're not adding a viewer.
        if(down == null)
            return;

        // Capture the viewers list, so we always work with this list if this.viewers gets reset
        // while we're loading.
        let viewers = this.viewers;

        // The viewer ID we're adding next to:
        let neighbor_viewer = viewers[down? viewers.length-1:0];
        let neighbor_media_id = neighbor_viewer.media_id;

        this.adding_viewer = true;
        let media_id, early_illust_data;
        try {
            // Get the next or previous media ID.
            media_id = await this.parent.get_navigation(down, { navigate_from_media_id: neighbor_media_id });
            if(media_id != null)
                early_illust_data = await media_cache.get_media_info(media_id, { full: false });
        } finally {
            // Stop if the viewer list changed while we were loading.
            if(this.viewers !== viewers)
                return;
        }

        this.adding_viewer = false;

        if(media_id == null)
        {
            console.log("No navigation in direction", down);
            // XXX: feedback that there's nothing here
            return;
        }

        let viewer = await this.parent.create_viewer({
            early_illust_data,
            media_id,
        });

        // Hide the viewer until after we set the transform, or iOS sometimes flickers it in
        // its initial position.
        viewer.visible = false;

        // Insert the new viewer.
        viewers.splice(down? viewers.length:0, 0, viewer);

        // Set the initial position.
        this.refresh_drag_position();        
    }

    remove_viewers()
    {
        // Shut down viewers.  Leave the main one alone, since it's owned by the screen.
        for(let viewer of this.viewers)
        {
            if(viewer != this.main_viewer)
                viewer.shutdown();
        }
        this.viewers = [];

        // Clear adding_viewer.  If an add_viewers_if_needed call is running, it'll see that
        // this.viewers changed and stop
        this.adding_viewer = false;
    }

    // Get the viewer index that we'd want to go to if the user released the drag now.
    // This may be past the end of the current viewer list.
    current_drag_target()
    {
        let target_viewer_index = this.main_viewer_index;
        let threshold = 50;
        if(this.relative_drag_distance > threshold)
            target_viewer_index--;
        else if(this.relative_drag_distance < -threshold)
            target_viewer_index++;
        return target_viewer_index;
    }

    // A drag finished.  interactive is true if this is the user releasing it, or false
    // if we're shutting down during a drag.  See if we should transition the image or undo.
    async stop_dragging({interactive=false}={})
    {
        if(this.captured_pointer_id != null)
        {
            this.container.releasePointerCapture(this.captured_pointer_id);
            this.captured_pointer_id = null;
        }
    
        this.container.removeEventListener("pointermove", this.pointermove);
        this.container.removeEventListener("lostpointercapture", this.lost_pointer_capture);

        let dragged_to_viewer = null;
        if(interactive)
        {
            let target_viewer_index = this.current_drag_target();
            if(target_viewer_index >= 0 && target_viewer_index < this.viewers.length)
                dragged_to_viewer = this.viewers[target_viewer_index];
            else
                console.log("beyond end");
        }

        this.drag_distance = 0;
        this.relative_drag_distance = 0;

        // If this isn't interactive, we're just shutting down, so remove viewers without
        // animating.
        if(!interactive)
        {
            this.cancel_animation();
            this.remove_viewers();
            return;
        }

        // The image was released interactively.  If we're not transitioning to a new
        // image, transition back to normal.
        if(dragged_to_viewer)
        {
            // The drag was released and we're selecting dragged_to_viewer.  Make it active immediately,
            // without waiting for the animation to complete.  This lets the UI update quickly, and
            // makes it easier to handle quickly dragging multiple times.  We keep our viewer list until
            // the animation finishes.
            //
            // Take the main viewer to turn it into a preview.  It's in this.viewers, and this prevents
            // the screen from shutting it down when we activate the new viewer.
            let viewer = this.parent.take_viewer();

            // Make our neighboring viewer primary.
            this.parent.show_image_viewer({ new_viewer: dragged_to_viewer });
        }

        let duration = 250;
        let animations = [];

        let main_viewer_index = this.main_viewer_index;
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            // This offset from the main viewer.  Viewers above are negative and below
            // are positive.
            let this_idx = idx - main_viewer_index;

            // Animate everything to their default positions relative to the main image.
            let y = (window.innerHeight + this.image_gap) * this_idx;

            let animation = new ppixiv.DirectAnimation(new KeyframeEffect(viewer.container, [
                { transform: viewer.container.style.transform },
                { transform: `translateY(${y}px)` },
            ], {
                duration,
                fill: "forwards",
                easing: "ease-out",
            }));
            animation.play();
            animations.push(animation);
        }

        this.animations = animations;

        let animations_finished = Promise.all(animations.map((animation) => animation.finished));

        try {
            // Wait for the animations to complete.
            await animations_finished;
        } catch(e) {
            // If this fails, it should be from start_dragging cancelling the animations due to a
            // new touch.
            // console.error(e);
            return;
        }

        console.assert(this.animations === animations);
        this.animations = null;

        for(let animation of animations)
        {
            animation.commitStylesIfPossible();
            animation.cancel();
        }

        this.remove_viewers();
    }
};
