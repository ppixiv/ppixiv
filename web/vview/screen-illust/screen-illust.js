import { helpers } from 'vview/ppixiv-imports.js';

// The main UI.  This handles creating the viewers and the global UI.
export default class ScreenIllust extends ppixiv.screen
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
        
        this.currentMediaId = null;
        this.latestNavigationDirectionDown = true;

        // Create a UI box and put it in its container.
        let uiContainer = this.container.querySelector(".ui");
        this.ui = new ppixiv.image_ui({ container: uiContainer });
        
        // Make sure the hover UI isn't shown on mobile.
        if(ppixiv.mobile)
            uiContainer.hidden = true;

        ppixiv.user_cache.addEventListener("usermodified", this.refreshUi, { signal: this.shutdown_signal.signal });        
        ppixiv.media_cache.addEventListener("mediamodified", this.refreshUi, { signal: this.shutdown_signal.signal });
        ppixiv.settings.addEventListener("recent-bookmark-tags", this.refreshUi, { signal: this.shutdown_signal.signal });

        this.viewContainer = this.container.querySelector(".view-container");

        // Remove the "flash" class when the page change indicator's animation finishes.
        let pageChangeIndicator = this.container.querySelector(".page-change-indicator");
        pageChangeIndicator.addEventListener("animationend", (e) => {
            pageChangeIndicator.classList.remove("flash");
        });

        // Desktop UI:
        if(!ppixiv.mobile)
        {
            // Fullscreen on double-click.
            this.viewContainer.addEventListener("dblclick", () => {
                helpers.toggle_fullscreen();
            });

            new ppixiv.HideMouseCursorOnIdle(this.container.querySelector(".mouse-hidden-box"));

            this.container.addEventListener("wheel", this.onwheel, { passive: false });
        }

        // Mobile UI:
        if(ppixiv.mobile)
        {
            // Create this before mobileIllustUi so its drag handler is registered first.
            // This makes image change drags take priority over opening the menu.
            this.dragImageChanger = new DragImageChanger({ parent: this });

            this.mobileIllustUi = new ppixiv.mobile_illust_ui({
                container: this.container,
                transition_target: this.container,
            });

            // Toggle zoom on double-tap.
            this.doubleTapHandler = new ppixiv.MobileDoubleTapHandler({
                container: this.viewContainer,
                signal: this.shutdown_signal.signal,
                ondbltap: (e) => this.viewer.toggle_zoom(e),
            });

            new ppixiv.IsolatedTapHandler({
                node: this.viewContainer,
                callback: (e) => {
                    // Show or hide the menu on isolated taps.  Note that most of the time, hiding
                    // will happen in mobileIllustUi's oncancelled handler, when a press triggers
                    // another scroller (usually TouchScroller).  But, we also handle it here as a
                    // fallback in case that doesn't happen, such as if we're on a video.
                    this.mobileIllustUi.toggle();
                },
            });
        }

        // This handles transitioning between this and the search view.
        this.dragToExit = new ScreenIllustDragToExit({ parent: this });

        this.deactivate();
    }

    setDataSource(data_source)
    {
        if(data_source == this.data_source)
            return;

        if(this.data_source != null)
        {
            this.data_source.removeEventListener("updated", this.dataSourceUpdated);
            this.data_source = null;
        }

        this.data_source = data_source;
        this.ui.data_source = data_source;

        if(this.data_source != null)
        {
            this.data_source.addEventListener("updated", this.dataSourceUpdated);

            this.refreshUi();
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
        if(this.dragImageChanger)
            this.dragImageChanger.stop();

        await this.showImage(media_id, { restore_history, initial: !was_active });

        // Tell the dragger to transition us in.
        if(this.dragToExit)
            this.dragToExit.activate();
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
        if(this.dragImageChanger)
            this.dragImageChanger.stop();

        this.cancelAsyncNavigation();

        if(this.mobileIllustUi)
        {
            this.mobileIllustUi.media_id = null;
            this.mobileIllustUi.set_data_source(null);
        }

        // Tell the dragger to transition us out.
        if(this.dragToExit)
            this.dragToExit.deactivate();

        this.cleanupImage();
        
        // We leave editing on when navigating between images, but turn it off when we exit to
        // the search.
        ppixiv.settings.set("image_editing_mode", null);
    }

    // Remove the viewer if we no longer want to be displaying it.
    cleanupImage()
    {
        if(this._active)
            return;

        // Don't remove the viewer if it's still being shown in the exit animation.
        if(this.dragToExit?.isAnimating)
            return;

        this.removeViewer();

        this.wanted_media_id = null;
        this.currentMediaId = null;

        this.refreshUi();

        // Tell the preloader that we're not displaying an image anymore.  This prevents the next
        // image displayed from triggering speculative loading, which we don't want to do when
        // clicking an image in the thumbnail view.
        ppixiv.image_preloader.singleton.set_current_image(null);
        ppixiv.image_preloader.singleton.set_speculative_image(null);

        // If remote quick view is active, cancel it if we leave the image.
        if(ppixiv.settings.get("linked_tabs_enabled"))
        {
            ppixiv.send_image.send_message({
                message: "send-image",
                action: "cancel",
                to: ppixiv.settings.get("linked_tabs", []),
            });
        }
    }

    // Create a viewer for media_id and begin loading it asynchronously.
    createViewer({ media_id, early_illust_data, ...options }={})
    {
        let viewerClass;

        let isMuted = early_illust_data && this.shouldHideMutedImage(early_illust_data).isMuted;
        let isError = early_illust_data == null;
        if(isMuted)
        {
            viewerClass = viewer_error;
        }
        else if(isError)
        {
            viewerClass = viewer_error;
            options = { ...options, error: ppixiv.media_cache.get_media_load_error(media_id) };
        }
        else if(early_illust_data.illustType == 2)
            viewerClass = viewer_ugoira;
        else if(early_illust_data.illustType == "video")
            viewerClass = viewer_video;
        else
            viewerClass = ppixiv.mobile? ppixiv.viewer_images_mobile:ppixiv.viewer_images_desktop;

        let slideshow = helpers.args.location.hash.get("slideshow");
        let newViewer = new viewerClass({
            media_id,
            container: this.viewContainer,
            slideshow,
            
            wait_for_transitions: () => {
                return this.dragToExit?.waitForAnimationsPromise;
            },

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
                let manga = ppixiv.settings.get("slideshow_skips_manga")? "skip-to-first":"normal";
                return await this.navigateToNext(1, { flash_at_end: false, manga });
            },
            ...options,
        });
        
        newViewer.load();

        return newViewer;
    }

    // Show a media ID.
    async showImage(media_id, { restore_history=false, initial=false }={})
    {
        console.assert(media_id != null);

        // If we previously set a pending navigation, this navigation overrides it.
        this.cancelAsyncNavigation();

        // Remember that this is the image we want to be displaying.  Do this before going
        // async, so everything knows what we're trying to display immediately.
        this.wanted_media_id = media_id;

        if(await this.loadFirstImage(media_id))
            return;

        // Get very basic illust info.  This is enough to tell which viewer to use, how
        // many pages it has, and whether it's muted.  This will always complete immediately
        // if we're coming from a search or anywhere else that will already have this info,
        // but it can block if we're loading from scratch.
        let early_illust_data = await ppixiv.media_cache.get_media_info(media_id, { full: false });

        // If we were deactivated while waiting for image info or the image we want to show has changed, stop.
        if(!this.active || this.wanted_media_id != media_id)
        {
            console.log("showImage: illust ID or page changed while async, stopping");
            return;
        }

        // Make sure the dragger isn't active, since changing main viewers while a drag is active
        // would cause confusing behavior.
        if(this.dragImageChanger)
            this.dragImageChanger.stop();

        // If we weren't given a viewer to use, create one.
        let newViewer = this.createViewer({
            early_illust_data,
            media_id,
            restore_history,
        });

        this.showImageViewer({ newViewer, initial });
    }

    // Show a viewer.
    //
    // If initial is first, this is the first image we're displaying after becoming visible,
    // usually from clicking a search result.  If it's false, we were already active and are
    // just changing images.
    showImageViewer({ newViewer=null, initial=false }={})
    {
        if(newViewer == this.viewer)
            return;

        helpers.set_class(document.body,  "force-ui", window.debug_show_ui);

        let media_id = newViewer.media_id;

        // Dismiss any message when changing images.
        if(this.currentMediaId != media_id)
            ppixiv.message_widget.singleton.hide();

        this.wanted_media_id = media_id;
        this.currentMediaId = media_id;

        // This should always be available, because the caller always looks up media info
        // in order to create the viewer, which means we don't have to go async here.  If
        // this returns null, it should always mean we're viewing an image's error page.
        let early_illust_data = ppixiv.media_cache.get_media_info_sync(media_id, { full: false });
        helpers.set_title_and_icon(early_illust_data);

        // If the image has the ドット絵 tag, enable nearest neighbor filtering.
        helpers.set_class(document.body, "dot", helpers.tags_contain_dot(early_illust_data?.tagList));

        // If linked tabs are active, send this image.
        if(ppixiv.settings.get("linked_tabs_enabled"))
            ppixiv.send_image.send_image(media_id, ppixiv.settings.get("linked_tabs", []), "temp-view");

        // Tell the preloader about the current image.
        ppixiv.image_preloader.singleton.set_current_image(media_id);

        // Make sure the URL points to this image.
        let args = ppixiv.app.getMediaURL(media_id);
        helpers.navigate(args, { add_to_history: false, send_popstate: false });

        // Speculatively load the next image, which is what we'll show if you press page down, so
        // advancing through images is smoother.
        //
        // If we're not local, don't do this when showing the first image, since the most common
        // case is simply viewing a single image and then backing out to the search, so this avoids
        // doing extra loads every time you load a single illustration.
        if(!initial || helpers.is_media_id_local(media_id))
        {
            // getNavigation may block to load more search results.  Run this async without
            // waiting for it.
            (async() => {
                let newMediaId = await this.getNavigation(this.latestNavigationDirectionDown);

                // Let image_preloader handle speculative loading.  If newMediaId is null,
                // we're telling it that we don't need to load anything.
                ppixiv.image_preloader.singleton.set_speculative_image(newMediaId);
            })();
        }

        this.current_user_id = early_illust_data?.userId;
        this.refreshUi();

        // If we're not animating so we know the search page isn't visible, try to scroll the
        // search page to the image we're viewing, so it's ready if we start a transition to it.
        if(this.dragToExit)
            this.dragToExit.scrollSearchToThumbnail();

        // If we already have an old viewer, then we loaded an image, and then navigated again before
        // the new image was displayed.  Discard the new image and keep the old one, since it's what's
        // being displayed.
        if(this.oldViewer && this.viewer)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }
        else
            this.oldViewer = this.viewer;

        this.viewer = newViewer;

        let oldViewer = this.oldViewer;

        // If we already had a viewer, hide the new one until the new one is ready to be displayed.
        // We'll make it visible below at the same time the old viewer is removed, so we don't show
        // both at the same time.
        if(this.oldViewer)
            this.viewer.visible = false;

        this.viewer.ready.finally(async() => {
            // Await once in case this is called synchronously.
            await helpers.sleep(0);

            // Allow this to be called multiple times.
            if(this.oldViewer == null)
                return;

            // The new viewer is displaying an image, so we can remove the old viewer now.
            //
            // If this isn't the main viewer anymore, another one was created and replaced this one
            // (the old viewer check above), so don't do anything.
            if(this.viewer !== newViewer || oldViewer !== this.oldViewer)
                return;

            this.viewer.visible = true;
            this.oldViewer.shutdown();
            this.oldViewer = null;
        });

        this.viewer.active = this._active;

        // Refresh the UI now that we have a new viewer.
        this.refreshUi();
    }

    // Take the current viewer out of the screen.  It'll still be active and in the document.
    // This is used by DragImageChanger to change the current viewer into a preview viewer.
    takeViewer()
    {
        let viewer = this.viewer;
        this.viewer = null;
        return viewer;
    }

    // If we're loading "*", it's a placeholder saying to view the first search result.
    // This allows viewing shuffled results.  This can be a Pixiv illust ID of *, or
    // a local ID with a filename of *.  Load the initial data source page if it's not
    // already loaded, and navigate to the first result.
    async loadFirstImage(media_id)
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
        let newMediaId = await this.data_source.get_or_load_neighboring_media_id(null, true);
        if(newMediaId == null)
        {
            ppixiv.message_widget.singleton.show("Couldn't find an image to view");
            return true;
        }

        ppixiv.app.show_media(newMediaId, {
            add_to_history: false,
        });
        return true;
    }

    // Return true if we're allowing a muted image to be displayed, because the user
    // clicked to override it in the mute view.
    get viewMuted()
    {
        return helpers.args.location.hash.get("view-muted") == "1";
    }

    shouldHideMutedImage(early_illust_data)
    {
        let muted_tag = ppixiv.muting.singleton.any_tag_muted(early_illust_data.tagList);
        let muted_user = ppixiv.muting.singleton.is_muted_user_id(early_illust_data.userId);
        if(this.viewMuted || (!muted_tag && !muted_user))
            return { isMuted: false };

        return { isMuted: true, muted_tag: muted_tag, muted_user: muted_user };
    }
    
    // Remove the old viewer, if any.
    removeViewer()
    {
        if(this.viewer != null)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }

        if(this.oldViewer != null)
        {
            this.oldViewer.shutdown();
            this.oldViewer = null;
        }
    }

    // If we started navigating to a new image and were delayed to load data (either to load
    // the image or to load a new page), cancel it and stay where we are.
    cancelAsyncNavigation()
    {
        // If we previously set a pending navigation, this navigation overrides it.
        if(this.pending_navigation == null)
            return;

        console.info("Cancelling async navigation");
        this.pending_navigation = null;
    }

    dataSourceUpdated = () =>
    {
        this.refreshUi();
    }

    get active()
    {
        return this._active;
    }

    // Refresh the UI for the current image.
    refreshUi = (e) =>
    {
        // Don't refresh if the thumbnail view is active.  We're not visible, and we'll just
        // step over its page title, etc.
        if(!this._active)
            return;
        
        // Tell the UI which page is being viewed.
        this.ui.media_id = this.currentMediaId;

        if(this.mobileIllustUi)
        {
            this.mobileIllustUi.user_id = this.current_user_id;
            this.mobileIllustUi.media_id = this.currentMediaId;
            this.mobileIllustUi.set_data_source(this.data_source);
        }

        // Update the disable UI button to point at the current image's illustration page.
        var disable_button = this.container.querySelector(".disable-ui-button");
        let [illust_id] = helpers.media_id_to_illust_id_and_page(this.currentMediaId);
        disable_button.href = `/artworks/${illust_id}#no-ppixiv`;

        if(this.currentMediaId == null)
            return;

        this.ui.refresh();
    }

    onwheel = (e) =>
    {
        if(!this._active)
            return;        

        let down = e.deltaY > 0;
        this.navigateToNext(down, { manga: e.shiftKey? "skip-to-first":"normal" });
    }

    get displayedMediaId()
    {
        return this.wanted_media_id;
    }

    handleKeydown(e)
    {
        // Let the viewer handle the input first.
        if(this.viewer && this.viewer.onkeydown)
        {
            this.viewer.onkeydown(e);
            if(e.defaultPrevented)
                return;
        }

        this.ui.handleKeydown(e);
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

            this.navigateToNext(false, { manga: e.shiftKey? "skip-to-first":"normal" });
            break;

        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
            e.preventDefault();
            e.stopPropagation();

            this.navigateToNext(true, { manga: e.shiftKey? "skip-to-first":"normal" });
            break;
        }
    }

    // Get the media_id and page navigating down (or up) will go to.
    //
    // This may trigger loading the next page of search results, if we've reached the end.
    async getNavigation(down, { navigate_from_media_id=null, manga="normal", loop=false }={})
    {
        // Check if we're just changing pages within the same manga post.
        // If we have a target media_id, move relative to it.  Otherwise, move relative to the
        // displayed image.  This way, if we navigate repeatedly before a previous navigation
        // finishes, we'll keep moving rather than waiting for each navigation to complete.
        navigate_from_media_id ??= this.wanted_media_id;
        navigate_from_media_id ??= this.currentMediaId;

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
    async navigateToNext(down, { manga="normal", flash_at_end=true }={})
    {
        // Loop if we're in slideshow mode, otherwise stop when we reach the end.
        let loop = helpers.args.location.hash.get("slideshow") != null;

        // If we're viewing an error page, always skip manga pages.
        if(manga == "normal" && this.viewer instanceof viewer_error)
            manga = "skip-past";

        // Remember whether we're navigating forwards or backwards, for preloading.
        this.latestNavigationDirectionDown = down;

        this.cancelAsyncNavigation();

        let pending_navigation = this.pending_navigation = new Object();

        // See if we should change the manga page.  This may block if it needs to load
        // the next page of search results.
        let newMediaId = await this.getNavigation(down, { manga, loop });
    
        // If we didn't get a page, we're at the end of the search results.  Flash the
        // indicator to show we've reached the end and stop.
        if(newMediaId == null)
        {
            console.log("Reached the end of the list");
            if(flash_at_end)
                this.flashEndIndicator(down, "last-image");
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
        ppixiv.app.show_media(newMediaId);
        return { media_id: newMediaId };
    }

    flashEndIndicator(down, icon)
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

        // Once we reach the left and right edge, this is set to the minimum and maximum value
        // of this.drag_distance.
        this.bounds = [null, null];

        this.dragger = new ppixiv.DragHandler({
            name: "image-changer",
            element: this.container,
            confirm_drag: ({event}) => {
                // Stop if there's no image, if the screen wasn't able to load one.
                if(this.mainViewer == null)
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
    get viewerDistance()
    {
        return this.parent.viewContainer.offsetWidth + this.image_gap;
    }

    // Return the additional space between viewers.
    get image_gap()
    {
        return 25;
    }

    get container() { return this.parent.container; }

    // The main viewer is the one active in the screen.  this.drag_distance is relative to
    // it, and it's always in this.viewers during drags.
    get mainViewer() { return this.parent.viewer; }

    // The image changed externally or the screen is becoming inactive, so stop any drags and animations.
    stop()
    {
        this.dragger.cancel_drag();
        this.cancelAnimation();
    }

    ondragstart({event})
    {
        // If we aren't grabbing a running drag, only start if the initial movement was horizontal.
        if(this.animations == null && this.drag_distance == 0 && Math.abs(event.movementY) > Math.abs(event.movementX))
            return false;

        this.drag_distance = 0;
        this.recent_pointer_movement.reset();
        this.bounds = [null, null];

        if(this.animations == null)
        {
            // We weren't animating, so this is a new drag.  Start the list off with the main viewer.
            this.viewers = [this.mainViewer];
            return true;
        }

        // Another drag started while the previous drag's transition was still happening.
        // Stop the animation, and set the drag_distance to where the animation was stopped.
        this.cancelAnimation();
        return true;
    }

    // If an animation is running, cancel it.
    cancelAnimation()
    {
        if(!this.animations)
            return;

        let animations = this.animations;
        this.animations = null;

        // Pause the animations, and wait until the pause completes.
        for(let animation of animations)
            animation.pause();

        // If a drag is active, set drag_distance to the X position of the main viewer to match
        // the drag to where the animation was.
        if(this.drag_distance != null && this.mainViewer)
        {
            let main_transform = new DOMMatrix(getComputedStyle(this.mainViewer.container).transform);
            this.drag_distance = main_transform.e; // X translation
            this.refreshDragPosition();
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
        this._addViewersIfNeeded();
        this.refreshDragPosition();
    }

    getViewerX(viewer_index)
    {
        // This offset from the main viewer.  Viewers above are negative and below
        // are positive.
        let relative_idx = viewer_index - this.mainViewerIndex;

        let x = this.viewerDistance * relative_idx;
        x += this.drag_distance;
        return x;
    }

    // Update the positions of all viewers during a drag.
    refreshDragPosition()
    {
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            let x = this.getViewerX(idx);
            viewer.container.style.transform = `translateX(${x}px)`;
            viewer.visible = true;
        }
    }

    // Return the index of the main viewer in this.viewers.
    get mainViewerIndex()
    {
        return this._findViewerIndex(this.mainViewer);
    }

    _findViewerIndex(viewer)
    {
        let index = this.viewers.indexOf(viewer);
        if(index == -1)
        {
            console.error("Viewer is missing");
            return 0;
        }

        return index;
    }

    // Add a new viewer if we've dragged far enough to need one.
    async _addViewersIfNeeded()
    {
        // If we're already adding a viewer, don't try to add another until it finishes.
        if(this.adding_viewer)
            return;

        let drag_threshold = 5;

        // See if we need to add another viewer in either direction.
        //
        // The right edge of the leftmost viewer, including the gap between images.  If this is
        // 0, it's just above the screen.
        let left_viewer_edge = this.getViewerX(-1) + this.viewerDistance;
        let add_forwards = null;
        if(left_viewer_edge > drag_threshold)
            add_forwards = false;

        // The left edge of the rightmost viewer.
        let right_viewer_edge = this.getViewerX(this.viewers.length) - this.image_gap;
        if(right_viewer_edge < window.innerWidth - drag_threshold)
            add_forwards = true;

        // If the user drags multiple times quickly, the drag target may be past the end.
        // Add a viewer for it as soon as it's been dragged to, even though it may be well
        // off-screen, so we're able to transition to it.
        let target_viewer_index = this.currentDragTarget();
        if(target_viewer_index < 0)
            add_forwards = false;
        else if(target_viewer_index >= this.viewers.length)
            add_forwards = true;

        // Stop if we're not adding a viewer.
        if(add_forwards == null)
            return;

        // Capture the viewers list, so we always work with this list if this.viewers gets reset
        // while we're loading.
        let viewers = this.viewers;

        // The viewer ID we're adding next to:
        let neighbor_viewer = viewers[add_forwards? viewers.length-1:0];
        let neighbor_media_id = neighbor_viewer.media_id;

        this.adding_viewer = true;
        let media_id, early_illust_data;
        try {
            // Get the next or previous media ID.
            media_id = await this.parent.getNavigation(add_forwards, { navigate_from_media_id: neighbor_media_id });
            if(media_id != null)
                early_illust_data = await ppixiv.media_cache.get_media_info(media_id, { full: false });
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
            if(add_forwards)
                this.bounds[1] = this.viewerDistance * (this.viewers.length - 1 - this.mainViewerIndex);
            else
                this.bounds[0] = this.viewerDistance * (0 - this.mainViewerIndex);

            return;
        }

        let viewer = this.parent.createViewer({
            early_illust_data,
            media_id,
        });

        // Hide the viewer until after we set the transform, or iOS sometimes flickers it in
        // its initial position.
        viewer.visible = false;

        // Insert the new viewer.
        viewers.splice(add_forwards? viewers.length:0, 0, viewer);

        // Set the initial position.
        this.refreshDragPosition();        
    }

    removeViewers()
    {
        // Shut down viewers.  Leave the main one alone, since it's owned by the screen.
        for(let viewer of this.viewers)
        {
            if(viewer != this.mainViewer)
                viewer.shutdown();
        }
        this.viewers = [];

        // Clear adding_viewer.  If an _addViewersIfNeeded call is running, it'll see that
        // this.viewers changed and stop.
        this.adding_viewer = false;
    }

    // Get the viewer index that we'd want to go to if the user released the drag now.
    // This may be past the end of the current viewer list.
    currentDragTarget()
    {
        // If the user flung horizontally, move relative to the main viewer.
        let recent_velocity = this.recent_pointer_movement.current_velocity.x;
        let threshold = 200;
        if(Math.abs(recent_velocity) > threshold)
        {
            if(recent_velocity > threshold)
                return this.mainViewerIndex - 1;
            else if(recent_velocity < -threshold)
                return this.mainViewerIndex + 1;
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
            let x = this.getViewerX(idx);
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
            let target_viewer_index = this.currentDragTarget();
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
            this.cancelAnimation();
            this.removeViewers();
            return;
        }

        // The image was released interactively.  If we're not transitioning to a new
        // image, transition back to normal.
        if(dragged_to_viewer)
        {
            // Set latestNavigationDirectionDown to true if we're navigating forwards or false
            // if we're navigating backwards.  This is a hint for speculative loading.
            let old_main_index = this.mainViewerIndex;
            let new_main_index = this._findViewerIndex(dragged_to_viewer);
            this.parent.latestNavigationDirectionDown = new_main_index > old_main_index;

            // The drag was released and we're selecting dragged_to_viewer.  Make it active immediately,
            // without waiting for the animation to complete.  This lets the UI update quickly, and
            // makes it easier to handle quickly dragging multiple times.  We keep our viewer list until
            // the animation finishes.
            //
            // Take the main viewer to turn it into a preview.  It's in this.viewers, and this prevents
            // the screen from shutting it down when we activate the new viewer.
            this.parent.takeViewer();

            // Make our neighboring viewer primary.
            this.parent.showImageViewer({ newViewer: dragged_to_viewer });
        }

        let duration = 400;
        let animations = [];

        let mainViewerIndex = this.mainViewerIndex;
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            // This offset from the main viewer.  Viewers above are negative and below
            // are positive.
            let this_idx = idx - mainViewerIndex;

            // The animation starts at the current translateX.
            let start_x = new DOMMatrix(getComputedStyle(viewer.container).transform).e;
            //let start_x = this.getViewerX(idx);

            // Animate everything to their default positions relative to the main image.
            let end_x = this.viewerDistance * this_idx;

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

        this.removeViewers();
    }
};

// This handles dragging up from the top of the screen to return to the search on mobile.
class ScreenIllustDragToExit
{
    constructor({parent})
    {
        this.parent = parent;

        this.dragger = new ppixiv.WidgetDragger({
            name: "drag-to-exit",
            node: [
                this.parent.container,
                this.parent.querySelector(".fade-search"),
            ],
            drag_node: this.parent.container,
            size: () => this._dragDistance,

            animated_property: "--illust-hidden",
            animated_property_inverted: true,

            // We're hidden until set_active makes us visible.
            visible: false,
            direction: "down", // down to make visible, up to hide
            duration: () => {
                return ppixiv.settings.get("animations_enabled")? 250:0;
            },
            size: 500,
            confirm_drag: ({event}) => {
                // Don't do anything if the screen isn't active.
                if(!this.parent._active || !ppixiv.mobile)
                    return false;

                return Math.abs(event.movementY) > Math.abs(event.movementX);
            },

            onactive: () => {
                // Close the menu bar if it's open when a drag starts.
                if(this.parent.mobileIllustUi)
                    this.parent.mobileIllustUi.hide();

                this._configAnimation();
            },

            oninactive: () => {
                if(this.dragger.visible)
                {
                    // Scroll the search view to the current image when we're not animating.
                    this.scrollSearchToThumbnail();
                }
                else
                {
                    // We're no longer visible.  If the screen is still active, complete the navigation
                    // back to the search screen.  If the screen is already inactive then we're animating
                    // a navigation that has already happened (browser back).
                    if(this.parent._active)
                    {
                        let args = new helpers.args(this.parent.data_source.search_url.toString());
                        ppixiv.app.navigate_from_image_to_search(args);
                    }

                    // See if we want to remove the viewer now that the animation has finished.
                    this.parent.cleanupImage();
                }
            },
        });
    }

    get _dragDistance()
    {
        return document.documentElement.clientHeight * .25;
    }

    _configAnimation()
    {
        // In case the image wasn't available when we tried to scroll to it, try again now.
        // Either this will scroll to the image and we can use its position, or we know it
        // isn't in the list.
        this.scrollSearchToThumbnail();

        // If the view container is hidden, it may have transforms from the previous transition.
        // Unset the animation properties so this doesn't affect our calculations here.
        this.parent.container.style.setProperty("--animation-x", `0px`);
        this.parent.container.style.setProperty("--animation-y", `0px`);
        this.parent.container.style.setProperty("--animation-scale", "1");

        // This gives us the portion of the viewer which actually contains an image.  We'll
        // transition that region, so empty space is ignored by the transition.  If the viewer
        // doesn't implement this, just use the view bounds.
        let view_position = this.parent.viewer?.view_position;
        if(view_position)
        {
            // Move the view position to where the view actually is on the screen.
            let { left, top } = this.parent.viewer.container.getBoundingClientRect();
            view_position.x += left;
            view_position.y += top;
        }
        view_position ??= this.parent.container.getBoundingClientRect();

        // Try to position the animation to move towards the search thumbnail.
        let thumb_rect = this._animationTargetRect;
        if(thumb_rect)
        {
            // If the thumbnail is offscreen, ignore it.
            let center_y = thumb_rect.top + thumb_rect.height/2;
            if(center_y < 0 || center_y > window.innerHeight)
                thumb_rect = null;
        }

        if(thumb_rect == null)
        {
            // If we don't know where the thumbnail is, use a rect in the middle of the screen.
            let width = view_position.width * 0.75;
            let height = view_position.height * 0.75;
            let x = (window.innerWidth - width) / 2;
            let y =  (window.innerHeight - height) / 2;
            thumb_rect = new ppixiv.FixedDOMRect(x, y, x + width, y + height);
        }

        let { x, y, width, height } = view_position;
        let scale = Math.max(thumb_rect.width / width, thumb_rect.height / height);

        // Shift the center of the image to 0x0:
        let animation_x = -(x + width/2) * scale;
        let animation_y = -(y + height/2) * scale;

        // Align to the center of the thumb.
        animation_x += thumb_rect.x + thumb_rect.width / 2;
        animation_y += thumb_rect.y + thumb_rect.height / 2;

        this.parent.container.style.setProperty("--animation-x", `${animation_x}px`);
        this.parent.container.style.setProperty("--animation-y", `${animation_y}px`);
        this.parent.container.style.setProperty("--animation-scale", scale);
    }

    // Return the rect we'll want to transition towards, if known.
    get _animationTargetRect()
    {
        if(this.parent.wanted_media_id == null)
            return null;

        return ppixiv.app.getRectForMediaId(this.parent.wanted_media_id);
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

    get isAnimating()
    {
        return this.dragger.animation_playing;
    }

    // Return a promise that resolves when there's no animation running, or null if
    // no animation is active.
    get waitForAnimationsPromise()
    {
        return this.dragger.finished;
    }

    // Scroll the thumbnail onscreen in the search view if the search isn't currently visible.
    scrollSearchToThumbnail()
    {
        if(this.isAnimating || !this.parent.active || this.dragger.position < 1)
            return;

        ppixiv.app.scroll_search_to_media_id(this.parent.data_source, this.parent.wanted_media_id);
    }
}
