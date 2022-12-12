"use strict";

// The main UI.  This handles creating the viewers and the global UI.
ppixiv.screen_illust = class extends ppixiv.screen
{
    constructor(options)
    {
        super({...options, template: `
            <div inert class="screen screen-illust-container">
                <!-- This holds our views: the current view, and the neighbor view if we're transitioning
                     between them. -->
                <div class="view-container mouse-hidden-box" data-context-menu-target></div>

                <div class=page-change-indicator data-icon=last-image>
                    <ppixiv-inline src="resources/last-page.svg"></ppixiv-inline>
                </div>

                <!-- The top-left hover UI is inserted here. -->
                <div class=ui>
                </div>

                <div class=fade-search></div>
            </div>
        `});
        
        this.current_media_id = null;
        this.latest_navigation_direction_down = true;

        // Create a UI box and put it in its container.
        var ui_container = this.container.querySelector(".ui");
        this.ui = new image_ui({ container: ui_container });
        
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
            // Create this before mobile_illust_ui so its drag handler is registered first.
            // This makes image change drags take priority over opening the menu.
            this.drag_image_changer = new DragImageChanger({ parent: this });

            this.mobile_illust_ui = new mobile_illust_ui({
                container: this.container,
                transition_target: this.container,
            });

            // Toggle zoom on double-tap.
            this.double_tap_handler = new ppixiv.MobileDoubleTapHandler({
                container: this.view_container,
                signal: this.shutdown_signal.signal,
                ondbltap: (e) => this.viewer.toggle_zoom(e),
            });

            new IsolatedTapHandler({
                node: this.view_container,
                callback: (e) => {
                    this.mobile_illust_ui.show();
                },
            });
        }

        // This handles transitioning between this and the search view.
        this.drag_to_exit = new ScreenIllustDragToExit({ parent: this });

        this.deactivate();
    }

    set_data_source(data_source)
    {
        if(data_source == this.data_source)
            return;

        if(this.data_source != null)
        {
            this.data_source.removeEventListener("updated", this.data_source_updated);
            this.data_source = null;
        }

        this.data_source = data_source;
        this.ui.data_source = data_source;

        if(this.data_source != null)
        {
            this.data_source.addEventListener("updated", this.data_source_updated);

            this.refresh_ui();
        }
    }

    async activate({ media_id, restore_history })
    {
        let was_active = this._active;
        this._active = true;

        super.activate();

        // If we have a viewer, tell it if we're active.
        if(this.viewer != null)
            this.viewer.active = true;

        // If we have a drag handler for mobile, cancel any drag or animation in progress
        // if the image changes externally or if we're deactivated.
        if(this.drag_image_changer)
            this.drag_image_changer.stop();

        this.show_image(media_id, { restore_history, initial: !was_active });

        // Tell the dragger to transition us in.
        if(this.drag_to_exit)
            this.drag_to_exit.activate();

        // Focus the container, so it receives keyboard events like home/end.
        this.container.focus();
    }

    deactivate()
    {
        super.deactivate();
        this._active = false;

        // If we have a viewer, tell it if we're active.
        if(this.viewer != null)
            this.viewer.active = false;

        // If we have a drag handler for mobile, cancel any drag or animation in progress
        // if the image changes externally or if we're deactivated.
        if(this.drag_image_changer)
            this.drag_image_changer.stop();

        this.cancel_async_navigation();

        // Stop showing the user in the context menu, and stop showing the current page.
        if(main_controller.context_menu)
            main_controller.context_menu.set_media_id(null);

        if(this.mobile_illust_ui)
        {
            this.mobile_illust_ui.media_id = null;
            this.mobile_illust_ui.set_data_source(null);
        }

        // Tell the dragger to transition us out.
        if(this.drag_to_exit)
            this.drag_to_exit.deactivate();

        this.cleanup_image();
        
        // We leave editing on when navigating between images, but turn it off when we exit to
        // the search.
        settings.set("image_editing_mode", null);
    }

    // Remove the viewer if we no longer want to be displaying it.
    cleanup_image()
    {
        if(this._active)
            return;

        // Don't remove the viewer if it's still being shown in the exit animation.
        if(this.drag_to_exit?.is_animating)
            return;

        this.remove_viewer();

        this.wanted_media_id = null;
        this.current_media_id = null;

        this.refresh_ui();

        // Tell the preloader that we're not displaying an image anymore.  This prevents the next
        // image displayed from triggering speculative loading, which we don't want to do when
        // clicking an image in the thumbnail view.
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
            
            onnextimage: async (finished_viewer) => {
                if(!this._active)
                    return { };

                // Ignore this if this isn't the active viewer.  This can happen if we advance a slideshow
                // right as the user navigated to a different image, especially with mobile transitions.
                if(finished_viewer != this.viewer)
                {
                    console.log("onnextimage from viewer that isn't active");
                    return { };
                }                

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
    async show_image(media_id, { restore_history=false, initial=false }={})
    {
        console.assert(media_id != null);

        // If we previously set a pending navigation, this navigation overrides it.
        this.cancel_async_navigation();

        // Remember that this is the image we want to be displaying.  Do this before going
        // async, so everything knows what we're trying to display immediately.
        this.wanted_media_id = media_id;

        if(await this.load_first_image(media_id))
            return;

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

        // Make sure the dragger isn't active, since changing main viewers while a drag is active
        // would cause confusing behavior.
        if(this.drag_image_changer)
            this.drag_image_changer.stop();

        // If we weren't given a viewer to use, create one.
        let new_viewer = this.create_viewer({
            early_illust_data,
            media_id,
            restore_history,
        });

        this.show_image_viewer({ new_viewer, initial });
    }

    // Show a viewer.
    //
    // If initial is first, this is the first image we're displaying after becoming visible,
    // usually from clicking a search result.  If it's false, we were already active and are
    // just changing images.
    show_image_viewer({ new_viewer=null, initial=false }={})
    {
        if(new_viewer == this.viewer)
            return;

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

        // Make sure the URL points to this image.
        let args = main_controller.get_media_url(media_id);
        helpers.navigate(args, { add_to_history: false, send_popstate: false });

        // Speculatively load the next image, which is what we'll show if you press page down, so
        // advancing through images is smoother.
        //
        // If we're not local, don't do this when showing the first image, since the most common
        // case is simply viewing a single image and then backing out to the search, so this avoids
        // doing extra loads every time you load a single illustration.
        if(!initial || helpers.is_media_id_local(media_id))
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

        // If we're not animating so we know the search page isn't visible, try to scroll the
        // search page to the image we're viewing, so it's ready if we start a transition to it.
        if(this.drag_to_exit)
            this.drag_to_exit.showing_new_image();

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

        // If we already had a viewer, hide the new one until the new one is ready to be displayed.
        // We'll make it visible below at the same time the old viewer is removed, so we don't show
        // both at the same time.
        if(this.old_viewer)
            this.viewer.visible = false;

        this.viewer.ready.finally(async() => {
            // Await once in case this is called synchronously.
            await helpers.sleep(0);

            // Allow this to be called multiple times.
            if(this.old_viewer == null)
                return;

            // The new viewer is displaying an image, so we can remove the old viewer now.
            //
            // If this isn't the main viewer anymore, another one was created and replaced this one
            // (the old viewer check above), so don't do anything.
            if(this.viewer !== new_viewer || old_viewer !== this.old_viewer)
                return;

            this.viewer.visible = true;
            this.old_viewer.shutdown();
            this.old_viewer = null;
        });

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

        if(this.old_viewer != null)
        {
            this.old_viewer.shutdown();
            this.old_viewer = null;
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
        if(main_controller.context_menu)
        {
            main_controller.context_menu.user_id = this.current_user_id;
            main_controller.context_menu.set_media_id(this.current_media_id);
        }

        if(this.mobile_illust_ui)
        {
            this.mobile_illust_ui.user_id = this.current_user_id;
            this.mobile_illust_ui.media_id = this.current_media_id;
            this.mobile_illust_ui.set_data_source(this.data_source);
        }

        // Update the disable UI button to point at the current image's illustration page.
        var disable_button = this.container.querySelector(".disable-ui-button");
        let [illust_id] = helpers.media_id_to_illust_id_and_page(this.current_media_id);
        disable_button.href = `/artworks/${illust_id}#no-ppixiv`;

        if(this.current_media_id == null)
            return;

        this.ui.refresh();
    }

    onwheel = (e) =>
    {
        if(!this._active)
            return;        

        let down = e.deltaY > 0;
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
        this.recent_pointer_movement = new ppixiv.FlingVelocity({
            sample_period: 0.150,
        });

        // The amount we've dragged.  This is relative to the main image, so it doesn't need to
        // be adjusted when we add or remove viewers.
        this.drag_distance = 0;

        // A list of viewers that we're dragging between.  This always includes the main viewer
        // which is owned by the screen.
        this.viewers = [];
        this.adding_viewer = false;
        this.animations = null;

        // Once we reach the top and bottom edge, this is set to the minimum and maximum value
        // of this.drag_distance.
        this.bounds = [null, null];

        this.dragger = new ppixiv.DragHandler({
            name: "image-changer",
            element: this.container,
            onpointerdown: ({event}) => {
                // Stop if there's no image, if the screen wasn't able to load one.
                if(this.main_viewer == null)
                    return false;

                if(helpers.should_ignore_horizontal_drag(event))
                    return false;

                return true;
            },

            ondragstart: (args) => this.ondragstart(args),
            ondrag: (args) => this.ondrag(args),
            ondragend: (args) => this.ondragend(args),
            deferred_start: () => {
                // If an animation is running, disable deferring drags, so grabbing the dragger will
                // stop the animation.  Otherwise, defer drags until the first pointermove (the normal
                // behavior).
                return this.animations == null && this.drag_distance == 0;
            },
        });
    }

    // Get the distance between one viewer and the next.
    get viewer_distance()
    {
        return this.parent.view_container.offsetWidth + this.image_gap;
    }

    // Return the additional space between viewers.
    get image_gap()
    {
        return 25;
    }

    get container() { return this.parent.container; }

    // The main viewer is the one active in the screen.  this.drag_distance is relative to
    // it, and it's always in this.viewers during drags.
    get main_viewer() { return this.parent.viewer; }

    // The image changed externally or the screen is becoming inactive, so stop any drags and animations.
    stop()
    {
        this.dragger.cancel_drag();
        this.cancel_animation();
    }

    ondragstart({event})
    {
        // If we aren't grabbing a running drag, only start if the initial movement was vertical.
        if(this.animations == null && this.drag_distance == 0 && Math.abs(event.movementY) > Math.abs(event.movementX))
            return false;

        // Close the menu bar if it's open when a drag starts.
        if(this.parent.mobile_illust_ui)
            this.parent.mobile_illust_ui.hide();

        this.drag_distance = 0;
        this.recent_pointer_movement.reset();
        this.bounds = [null, null];

        if(this.animations == null)
        {
            // We weren't animating, so this is a new drag.  Start the list off with the main viewer.
            this.viewers = [this.main_viewer];
            return true;
        }

        // Another drag started while the previous drag's transition was still happening.
        // Stop the animation, and set the drag_distance to where the animation was stopped.
        this.cancel_animation();
        return true;
    }

    // If an animation is running, cancel it.
    cancel_animation()
    {
        if(!this.animations)
            return;

        let animations = this.animations;
        this.animations = null;

        // Pause the animations, and wait until the pause completes.
        for(let animation of animations)
            animation.pause();

        // If a drag is active, set drag_distance to the Y position of the main viewer to match
        // the drag to where the animation was.
        if(this.drag_distance != null && this.main_viewer)
        {
            let main_transform = new DOMMatrix(getComputedStyle(this.main_viewer.container).transform);
            this.drag_distance = main_transform.e; // X translation
            this.refresh_drag_position();
        }

        // Remove the animations.
        for(let animation of animations)
            animation.cancel();
    }

    ondrag({event, first})
    {
        let x = event.movementX;
        this.recent_pointer_movement.add_sample({ x });

        // If we're past the end, apply friction to indicate it.  This uses stronger overscroll
        // friction to make it distinct from regular image panning overscroll.
        let overscroll = 1;
        if(this.bounds[0] != null && this.drag_distance > this.bounds[0])
        {
            let distance = Math.abs(this.bounds[0] - this.drag_distance);
            overscroll = Math.pow(0.97, distance);
        }

        if(this.bounds[1] != null && this.drag_distance < this.bounds[1])
        {
            let distance = Math.abs(this.bounds[1] - this.drag_distance);
            overscroll = Math.pow(0.97, distance);
        }
        x *= overscroll;

        // The first pointer input after a touch may be thresholded by the OS trying to filter
        // out slight pointer movements that aren't meant to be drags.  This causes the very
        // first movement to contain a big jump on iOS, causing drags to jump.  Count this movement
        // towards fling sampling, but skip it for the visual drag.
        if(!first)
            this.drag_distance += x;
        this.add_viewers_if_needed();
        this.refresh_drag_position();
    }

    get_viewer_x(viewer_index)
    {
        // This offset from the main viewer.  Viewers above are negative and below
        // are positive.
        let relative_idx = viewer_index - this.main_viewer_index;

        let x = this.viewer_distance * relative_idx;
        x += this.drag_distance;
        return x;
    }

    // Update the positions of all viewers during a drag.
    refresh_drag_position()
    {
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            let x = this.get_viewer_x(idx);
            viewer.container.style.transform = `translateX(${x}px)`;
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

        // The main viewer should always be in the list during drags.
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
        let top_viewer_bottom = this.get_viewer_x(-1) + this.viewer_distance;
        let down = null;
        if(top_viewer_bottom > drag_threshold)
            down = false;

        // The top edge of the bottommost viewer.
        let bottom_viewer_top = this.get_viewer_x(this.viewers.length) - this.image_gap;
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
            // There's nothing in this direction, so remember that this is the boundary.  Once we
            // do this, overscroll will activate in this direction.
            if(down)
                this.bounds[1] = this.viewer_distance * (this.viewers.length - 1 - this.main_viewer_index);
            else
                this.bounds[0] = this.viewer_distance * (0 - this.main_viewer_index);

            return;
        }

        let viewer = this.parent.create_viewer({
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
        // this.viewers changed and stop.
        this.adding_viewer = false;
    }

    // Get the viewer index that we'd want to go to if the user released the drag now.
    // This may be past the end of the current viewer list.
    current_drag_target()
    {
        // If the user flung horizontally, move relative to the main viewer.
        let recent_velocity = this.recent_pointer_movement.current_velocity.x;
        let threshold = 200;
        if(Math.abs(recent_velocity) > threshold)
        {
            if(recent_velocity > threshold)
                return this.main_viewer_index - 1;
            else if(recent_velocity < -threshold)
                return this.main_viewer_index + 1;
        }

        // There hasn't been a fling recently, so land on the viewer which is closest to
        // the middle of the screen.  If the screen is dragged down several times quickly
        // and we're animating to an offscreen main viewer, and the user stops the
        // animation in the middle, this stops us on a nearby image instead of continuing
        // to where we were going before.
        let closest_viewer_index = 0;
        let closest_viewer_distance = 999999;
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let x = this.get_viewer_x(idx);
            let center = x + window.innerWidth/2;
            let distance = Math.abs((window.innerWidth / 2) - center);
            if(distance < closest_viewer_distance)
            {
                closest_viewer_distance = distance;
                closest_viewer_index = idx;
            }
        }

        return closest_viewer_index;
    }

    // A drag finished.  See if we should transition the image or undo.
    //
    // interactive is true if this is the user releasing it, or false if we're shutting
    // down during a drag.  cancel is true if this was a cancelled pointer event.
    async ondragend({interactive, cancel}={})
    {
        let dragged_to_viewer = null;
        if(interactive && !cancel)
        {
            let target_viewer_index = this.current_drag_target();
            if(target_viewer_index >= 0 && target_viewer_index < this.viewers.length)
                dragged_to_viewer = this.viewers[target_viewer_index];
        }

        // If we start a fling from this release, this is the velocity we'll try to match.
        let recent_velocity = this.recent_pointer_movement.current_velocity.x;

        this.recent_pointer_movement.reset();

        // If this isn't interactive, we're just shutting down, so remove viewers without
        // animating.
        if(!interactive)
        {
            this.drag_distance = 0;
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
            this.parent.take_viewer();

            // Make our neighboring viewer primary.
            this.parent.show_image_viewer({ new_viewer: dragged_to_viewer });
        }

        let duration = 400;
        let animations = [];

        let main_viewer_index = this.main_viewer_index;
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            // This offset from the main viewer.  Viewers above are negative and below
            // are positive.
            let this_idx = idx - main_viewer_index;

            // The animation starts at the current translateX.
            let start_x = new DOMMatrix(getComputedStyle(viewer.container).transform).e;
            //let start_x = this.get_viewer_x(idx);

            // Animate everything to their default positions relative to the main image.
            let end_x = this.viewer_distance * this_idx;

            // Estimate a curve to match the fling.
            let easing = ppixiv.Bezier2D.find_curve_for_velocity({
                distance: Math.abs(end_x - start_x),
                duration: duration / 1000, // in seconds
                target_velocity: Math.abs(recent_velocity),
            });

            // If we're panning left but the user dragged right (or vice versa), that usually means we
            // dragged past the end into overscroll, and all we're doing is moving back in bounds.  Ignore
            // the drag velocity since it isn't related to our speed.
            if((end_x > start_x) != (recent_velocity > 0))
                easing = "ease-out";

            let animation = new ppixiv.DirectAnimation(new KeyframeEffect(viewer.container, [
                { transform: viewer.container.style.transform },
                { transform: `translateX(${end_x}px)` },
            ], {
                duration,
                fill: "forwards",
                easing,
            }));
            animation.play();
            animations.push(animation);
        }

        this.drag_distance = 0;

        this.animations = animations;

        let animations_finished = Promise.all(animations.map((animation) => animation.finished));

        try {
            // Wait for the animations to complete.
            await animations_finished;
        } catch(e) {
            // If this fails, it should be from ondragstart cancelling the animations due to a
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

// This handles dragging up from the top of the screen to return to the search on mobile.
class ScreenIllustDragToExit
{
    constructor({parent})
    {
        this.parent = parent;

        this.dragger = new WidgetDragger({
            name: "drag-to-exit",
            node: [
                this.parent.container,
                this.parent.querySelector(".fade-search"),
            ],
            drag_node: this.parent.container,
            size: () => this._drag_distance,

            animated_property: "--illust-hidden",
            animated_property_inverted: true,

            // We're hidden until set_active makes us visible.
            visible: false,
            direction: "down", // down to make visible, up to hide
            duration: () => {
                return settings.get("animations_enabled")? 200:0;
            },
            size: 500,
            onpointerdown: ({event}) => {
                // Don't do anything if the screen isn't active.
                return this.parent._active && ppixiv.mobile;
            },
            ondragstart: ({event}) => {
                return Math.abs(event.movementY) > Math.abs(event.movementX);
            },
            onafterhidden: () => {
                // The drag finished.  If the screen is still active, exit the illust screen and go
                // back to the search screen.  If the screen is already inactive then we're animating
                // a navigation that has already happened (browser back).
                if(this.parent._active)
                {
                    let args = new helpers.args(this.parent.data_source.search_url.toString());
                    main_controller.navigate_from_image_to_search(args);
                }
            },
            onanimationfinished: () => {
                // See if we want to remove the viewer now that the animation has finished.
                this.parent.cleanup_image();

                // Scroll the search view to the current image when we're not animating.
                this.showing_new_image();
            },
            onanimationstart: () => {
                // Close the menu bar if it's open when a drag starts.
                if(this.parent.mobile_illust_ui)
                    this.parent.mobile_illust_ui.hide();

                this._config_animation();
            },
        });
    }

    get _drag_distance()
    {
        return document.documentElement.clientHeight * .25;
    }

    _config_animation()
    {
        // In case the image wasn't available when we tried to scroll to it, try again now.
        // Either this will scroll to the image and we can use its position, or we know it
        // isn't in the list.  Only do this if we're completely visible (eg. we're hiding
        // and not showing), not if the scroll would be visible.
        if(this.dragger.position == 1 && this.parent.active)
            main_controller.scroll_search_to_media_id(this.parent.data_source, this.parent.wanted_media_id);

        // Set properties for the animation.
        let x = 0, y = 0;

        // Try to position the animation to move towards the search thumbnail.
        let scale = 0.5;
        let rect = this._animation_target_rect;
        if(rect)
        {
            // Shift up and left to put the center of the screen at 0x0:
            x = -this.parent.container.offsetWidth/2;
            y = -this.parent.container.offsetHeight/2;

            // Then right and down to center it on the thumb:
            x += rect.x + rect.width/2;
            y += rect.y + rect.height/2;
        
            // Compare the screen size to the thumbnail size to figure out a rough scale, so if
            // thumbnails are very big or small we'll generally scale to a similar size.
            let width_ratio = rect.width / window.innerWidth;
            let height_ratio = rect.height / window.innerHeight;
            scale = (width_ratio + height_ratio) / 2;
        }

        this.parent.container.style.setProperty("--animation-x", `${x}px`);
        this.parent.container.style.setProperty("--animation-y", `${y}px`);
        this.parent.container.style.setProperty("--animation-scale", scale);
    }

    // Return the rect we'll want to transition towards, if known.
    get _animation_target_rect()
    {
        if(this.parent.wanted_media_id == null)
            return null;

        return main_controller.get_rect_for_media_id(this.parent.wanted_media_id);
    }

    // The screen was set active or inactive.
    activate()
    {
        // Run the show animation if we're not shown, or if we're currently hiding.
        if(!this.dragger.visible || !this.dragger.animating_to_shown)
            this.dragger.show();
    }

    deactivate()
    {
        if(this.dragger.visible)
            this.dragger.hide();
    }

    get is_animating()
    {
        return this.dragger.animation_playing;
    }

    showing_new_image()
    {
        if(this.is_animating || !this.parent.active)
            return;

        // We finished animating and we're showing the image.  Set the search view to show
        // where we'll be if we start transitioning back, so it's ready if the back transition
        // starts.  We don't want to wait for the gesture to do this, since it's harder to get
        // it set up in time.  We can do this safely since we're the active screen.
        //
        // Our data source should match where we'll navigate to in navigate_to_search
        main_controller.scroll_search_to_media_id(this.parent.data_source, this.parent.wanted_media_id);
    }
}
