"use strict";

// View img fullscreen.  Clicking the image will zoom it to its original size and scroll
// it around.
//
// The image is always zoomed a fixed amount from its fullscreen size.  This is generally
// more usable than doing things like zooming based on the native resolution.
ppixiv.on_click_viewer = class
{
    constructor({container, onviewcontainerchange})
    {
        this.set_new_image = new SentinelGuard(this.set_new_image, this);
        this.image_container = container;

        // The image box is the container that we translate and scale.
        this.image_box = document.createElement("div");
        this.image_box.classList.add("image-box");
        this.image_box.style.position = "relative";
        this.image_box.style.transformOrigin = "0 0";
        this.image_box.style.right = "auto";
        this.image_box.style.bottom = "auto";
        this.image_container.appendChild(this.image_box);

        // The crop box is only used when cropping an image, and otherwise just holds
        // the image.
        this.crop_box = document.createElement("div");
        this.crop_box.classList.add("crop-box");
        this.crop_box.style.position = "relative";
        this.crop_box.style.width = "100%";
        this.crop_box.style.height = "100%";
        this.image_box.appendChild(this.crop_box);

        this.onviewcontainerchange = onviewcontainerchange;
        this.media_id = null;
        this.original_width = 1;
        this.original_height = 1;
        this._cropped_size = null;

        this.center_pos = [0, 0];
        this.drag_movement = [0,0];

        // Restore the most recent zoom mode.  We assume that there's only one of these on screen.
        this.locked_zoom = settings.get("zoom-mode") == "locked";
        this._zoom_level = settings.get("zoom-level", "cover");

        // This is aborted when we shut down to remove listeners.
        this.event_shutdown = new AbortController();

        window.addEventListener("blur", this.window_blur, { signal: this.event_shutdown.signal });
        window.addEventListener("resize", this.onresize, { signal: this.event_shutdown.signal, capture: true });
        this.image_container.addEventListener("dragstart", this.block_event, { signal: this.event_shutdown.signal });
        this.image_container.addEventListener("selectstart", this.block_event, { signal: this.event_shutdown.signal });

        // Start or stop panning if the user changes it while we're active, eg. by pressing ^P.
        settings.changes.addEventListener("auto_pan", this.refresh_autopan.bind(this), { signal: this.event_shutdown.signal });
        
        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.image_container,
            button_mask: 1,
            signal: this.event_shutdown.signal,
            callback: this.pointerevent,
        });

        // This is like pointermove, but received during quick view from the source tab.
        window.addEventListener("quickviewpointermove", this.quickviewpointermove, { signal: this.event_shutdown.signal });
    }

    // Return the URL or preview URL being displayed.
    get displaying_url()
    {
        let url = this.img?.src;
        return url == helpers.blank_image? null:url;
    }
    
    get displaying_preview_url()
    {
        let url = this.preview_img?.src;
        return url == helpers.blank_image? null:url;
    }

    // Load the given illust and page.
    set_new_image = async(signal, {
        media_id,
        url, preview_url, inpaint_url,
        width, height,

        // "history" to restore from history, "auto" to set automatically, or null to
        // leave the position alone.
        restore_position,

        // This callback will be run once an image has actually been displayed.
        ondisplayed,

        // If true, we're in slideshow mode.  We'll always start an animation, and image
        // navigation will be disabled.
        slideshow=false,

        // If we're animating, this will be called when the animation finishes.
        onnextimage=null,

        // If set, this is a FixedDOMRect to crop the image to.
        crop=null,

        // If set, this is a FixedDOMRect of the safe zone for slideshow mode.
        safe_zone=null,
    }={}) =>
    {
        // When quick view displays an image on mousedown, we want to see the mousedown too
        // now that we're displayed.
        this.pointer_listener.check();

        // A special case is when we have no images at all.  This happens when navigating
        // to a manga page and we don't have illust info yet, so we don't know anything about
        // the page.
        if(url == null && preview_url == null)
        {
            this.remove_images();
            return;
        }

        // Don't show low-res previews during slideshows.
        if(slideshow)
            preview_url = url;
        
        // Don't restore the position if we're displaying the same image, so we don't interrupt
        // the user interacting with the image.
        if(media_id == this.media_id)
            restore_position = null;

        let img = document.createElement("img");
        img.src = url? url:helpers.blank_image;
        img.className = "filtering";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.position = "absolute";

        // Wrap the image in an ImageEditingOverlayContainer.  This acts like an image as far
        // as we're concerned.
        let inpaint_container = new ImageEditingOverlayContainer();
        inpaint_container.set_image_urls(url, inpaint_url);
        img = inpaint_container;

        // Create the low-res preview.  This loads the thumbnail underneath the main image.  Don't set the
        // "filtering" class, since using point sampling for the thumbnail doesn't make sense.  If preview_url
        // is null, just use a blank image.
        let preview_img = document.createElement("img");
        preview_img.src = preview_url? preview_url:helpers.blank_image;
        preview_img.classList.add("low-res-preview");
        preview_img.style.pointerEvents = "none";
        preview_img.style.width = "100%";
        preview_img.style.height = "100%";
        preview_img.style.position = "absolute";

        // Get the new image ready before removing the old one, to avoid flashing a black
        // screen while the new image decodes.  This will finish quickly if the preview image
        // is preloaded.
        //
        // We have to work around an API limitation: there's no way to abort decode().  If
        // a couple decode() calls from previous navigations are still running, this decode can
        // be queued, even though it's a tiny image and would finish instantly.  If a previous
        // decode is still running, skip this and prefer to just add the image.  It causes us
        // to flash a blank screen when navigating quickly, but image switching is more responsive.
        //
        // If width and height are null, always do this so we can get the image dimensions.
        if(!this.decoding)
        {
            try {
                await preview_img.decode();

                if(width == null)
                {
                    width = preview_img.naturalWidth;
                    height = preview_img.naturalHeight;
                }
            } catch(e) {
                // Ignore exceptions from aborts.
            }
        }
        signal.check();

        // Work around a Chrome quirk: even if an image is already decoded, calling img.decode()
        // will always delay and allow the page to update.  This means that if we add the preview
        // image, decode the main image, then display the main image, the preview image will
        // flicker for one frame, which is ugly.  Work around this: if the image is fully downloaded,
        // call decode() and see if it finishes quickly.  If it does, we'll skip the preview and just
        // show the final image.
        let img_ready = false;
        let decode_promise = null;
        if(url != null && img && img.complete)
        {
            decode_promise = this.decode_img(img);

            // See if it finishes quickly.
            img_ready = await helpers.await_with_timeout(decode_promise, 50) != "timed-out";
        }
        signal.check();

        // We're ready to finalize the new URLs by removing the old images and setting the
        // new ones.  This is where displaying_url and displaying_preview_url change.
        // If we're displaying the same image, don't remove the animation if one is running.
        this.remove_images({remove_animation: !this.animation_enabled || media_id != this.media_id});
        this.media_id = media_id;
        this.original_width = width;
        this.original_height = height;
        this._cropped_size = crop && crop.length == 4? new FixedDOMRect(crop[0], crop[1], crop[2], crop[3]):null;
        this._safe_zone = safe_zone && safe_zone.length == 4? new FixedDOMRect(safe_zone[0], safe_zone[1], safe_zone[2], safe_zone[3]):null;        
        this.img = img;
        this.preview_img = preview_img;
        this.onnextimage = onnextimage;

        // Make sure safe_zone fits inside the crop.
        if(this._cropped_size && this._safe_zone)
            this._safe_zone = this._safe_zone.cropTo(this._cropped_size);

        this.crop_box.appendChild(img);
        this.crop_box.appendChild(preview_img);

        this.update_crop();

        // Only show the preview image until we're ready to show the main image.
        img.hidden = true;
        preview_img.hidden = true;

        // If the main image is already ready, show it.  Otherwise, show the preview image.
        if(img_ready)
            this.img.hidden = false;
        else
            this.preview_img.hidden = false;

        // Restore history or set the initial position, then call reposition() to apply it
        // and do any clamping.  Do this atomically with updating the images, so the caller
        // knows that restore_position happens when displaying_url changes.  Also do this if
        // we already have animations running, so we update the slideshow/panning if the mode
        // changes.
        if(restore_position == "auto" || this.slideshow_enabled || this.animations != null)
            this.reset_position();
        else if(restore_position == "history")
            this.restore_from_history();

        // If we're in slideshow mode, we aren't using the preview image.  Pause the animation
        // until we actually display it so it doesn't run while there's nothing visible.
        if(this.slideshow_enabled)
            this._pause_animation = true;

        this.reposition();

        // We've changed the view container, so call onviewcontainerchange.
        if(this.onviewcontainerchange)
            this.onviewcontainerchange(img);

        // Let the caller know that we've displayed an image.  (We actually haven't since that
        // happens just below, but this is only used to let viewer_images know that history
        // has been restored.)
        if(ondisplayed)
            ondisplayed();

        // If we added the main image, we're done.
        if(img_ready)
        {
            this._pause_animation = false;
            return;
        }

        // If we don't have a main URL, stop here.  We only have the preview to display.
        if(url == null)
            return;

        // If the image isn't downloaded, load it now.  img.decode will do this too, but it
        // doesn't support AbortSignal.
        if(!img.complete)
        {
            let result = await helpers.wait_for_image_load(img, signal);
            if(result != null)
                return;

            signal.check();
        }

        // Decode the image asynchronously before adding it.  This is cleaner for large images,
        // since Chrome blocks the UI thread when setting up images.  The downside is it doesn't
        // allow incremental loading.
        //
        // If we already have decode_promise, we already started the decode, so just wait for that
        // to finish.
        if(!decode_promise)
            decode_promise = this.decode_img(img);
        await decode_promise;
        signal.check();

        // If we paused an animation, resume it.
        this._pause_animation = false;

        this.img.hidden = false;
        this.preview_img.hidden = true;
    }

    async decode_img(img)
    {
        this.decoding = true;
        try {
            await img.decode();
        } catch(e) {
            // Ignore exceptions from aborts.
        } finally {
            this.decoding = false;
        }
    }

    remove_images({remove_animation=true}={})
    {
        this.cancel_save_to_history();
        this.media_id = null;

        // Clear the image URLs when we remove them, so any loads are cancelled.  This seems to
        // help Chrome with GC delays.
        if(this.img)
        {
            this.img.src = helpers.blank_image;
            this.img.remove();
            this.img = null;
        }

        if(this.preview_img)
        {
            this.preview_img.src = helpers.blank_image;
            this.preview_img.remove();
            this.preview_img = null;
        }

        if(remove_animation)
            this.stop_animation();
    }

    shutdown()
    {
        this.stop_dragging();
        this.remove_images();
        
        if(this.image_box)
        {
            this.image_box.remove();
            this.image_box = null;
        }

        this.event_shutdown.abort();
        this.set_new_image.abort();
        this.image_container = null;
    }

    // Return "portrait" if the image is taller than the screen, otherwise "landscape".
    get relative_aspect()
    {
        // Figure out whether the image is relatively portrait or landscape compared to the screen.
        let screen_width = Math.max(this.container_width, 1); // might be 0 if we're hidden
        let screen_height = Math.max(this.container_height, 1);
        return (screen_width/this.cropped_size.width) > (screen_height/this.cropped_size.height)? "portrait":"landscape";
    }

    // Set the pan position to the default for this image, or start the selected animation.
    reset_position()
    {
        // See if we want to play an animation instead.
        this.refresh_autopan();
        if(this.animations != null)
            return;

        // Illustration viewing mode:
        //
        // If this.set_initial_image_position is true, then we're changing pages in the same illustration
        // and already have a position.  If the images are similar, it's useful to keep the same position,
        // so you can alternate between variants of an image and have them stay in place.  However, if
        // they're very different, this just leaves the display in a weird place.
        //
        // Try to guess.  If we have a position already, only replace it if the aspect ratio mode is
        // the same.  If we're going from portrait to portrait leave the position alone, but if we're
        // going from portrait to landscape, reset it.
        //
        // Note that we'll come here twice when loading most images: once using the preview image and
        // then again with the real image.  It's important that we not mess with the zoom position on
        // the second call.
        let aspect = this.relative_aspect;
        if(this.set_initial_image_position && aspect != this.initial_image_position_aspect)
            this.set_initial_image_position = false;

        // If view_mode is "manga", always reset to the top.  It's better for reading top-to-bottom
        // than preserving the pan position.
        if(settings.get("view_mode") == "manga")
            this.set_initial_image_position = false;
            
        if(this.set_initial_image_position)
            return;

        this.set_initial_image_position = true;
        this.initial_image_position_aspect = aspect;
    
        if(this._safe_zone)
        {
            // Use the safe zone as a default position.
            let safe_zone = this.unit_safe_zone;

            // The unit size of one screen height at the current zoom level:
            let zoomed_screen_height = this.container_height / this.onscreen_height;
            if(safe_zone.height <= zoomed_screen_height)
            {
                // The safe zone fits onscreen, so just center it.
                this.center_pos = [safe_zone.middleHorizontal, safe_zone.middleVertical];
            }
            else
            {
                // The safe zone doesn't fit onscreen at the current zoom level.  Align the top
                // of the screen to the top of the safe zone.
                this.center_pos = [safe_zone.middleHorizontal, safe_zone.top + zoomed_screen_height * 0.5];
            }
        }
        else
        {
            // Similar to how we display thumbnails for portrait images starting at the top, default to the top
            // if we'll be panning vertically when in cover mode.
            let zoom_center = [0.5, aspect == "portrait"? 0:0.5];
            this.center_pos = zoom_center;
        }
    }

    block_event = (e) =>
    {
        e.preventDefault();
    }

    onresize = (e) =>
    {
        this.reposition();

        if(this.animations)
            this.refresh_autopan();
    }

    window_blur = (e) =>
    {
        this.stop_dragging();
    }

    // Enable or disable zoom lock.
    get locked_zoom()
    {
        return this._locked_zoom;
    }

    // Select between click-pan zooming and sticky, filled-screen zooming.
    set locked_zoom(enable)
    {
        this._locked_zoom = enable;
        settings.set("zoom-mode", enable? "locked":"normal");
        this.reposition();
    }

    // Relative zoom is applied on top of the main zoom.  At 0, no adjustment is applied.
    // Positive values zoom in and negative values zoom out.
    get zoom_level()
    {
        return this._zoom_level;
    }

    set zoom_level(value)
    {
        this._zoom_level = value;
        settings.set("zoom-level", this._zoom_level);
        this.reposition();
    }
    
    // A zoom level is the exponential ratio the user sees, and the zoom
    // factor is just the multiplier.
    zoom_level_to_zoom_factor(level) { return Math.pow(1.5, level); }
    zoom_factor_to_zoom_level(factor) { return Math.log2(factor) / Math.log2(1.5); }

    // Get the effective zoom level, translating "cover" and "actual" to actual values.
    get _zoom_level_current()
    {
        if(!this.zoom_active)
            return 0;

        let level = this._zoom_level;
        if(level == "cover")
            return this._zoom_level_cover;
        else if(level == "actual")
            return this._zoom_level_actual;
        else
            return level;
    }

    // Return the active zoom ratio.  A zoom of 1x corresponds to "contain" zooming.
    get _zoom_factor_current()
    {
        if(!this.zoom_active)
            return 1;
        return this.zoom_level_to_zoom_factor(this._zoom_level_current);
    }

    // The zoom factor for cover mode:
    get _zoom_factor_cover() { return Math.max(this.container_width/this.width, this.container_height/this.height); }
    get _zoom_level_cover() { return this.zoom_factor_to_zoom_level(this._zoom_factor_cover); }

    // The zoom level for "actual" mode:
    get _zoom_factor_actual() { return 1 / this._image_to_screen_ratio; }
    get _zoom_level_actual() { return this.zoom_factor_to_zoom_level(this._zoom_factor_actual); }

    // Zoom in or out.  If zoom_in is true, zoom in by one level, otherwise zoom out by one level.
    change_zoom(zoom_out)
    {
        this.stop_animation();

        // zoom_level can be a number.  At 0 (default), we zoom to fit the image in the screen.
        // Higher numbers zoom in, lower numbers zoom out.  Zoom levels are logarithmic.
        //
        // zoom_level can be "cover", which zooms to fill the screen completely, so we only zoom on
        // one axis.
        //
        // zoom_level can also be "actual", which zooms the image to its natural size.
        //
        // These zoom levels have a natural ordering, which we use for incremental zooming.  Figure
        // out the zoom levels that correspond to "cover" and "actual".  This changes depending on the
        // image and screen size.

        let cover_zoom_level = this._zoom_level_cover;
        let actual_zoom_level = this._zoom_level_actual;

        // Increase or decrease relative_zoom_level by snapping to the next or previous increment.
        // We're usually on a multiple of increment, moving from eg. 0.5 to 0.75, but if we're on
        // a non-increment value from a special zoom level, this puts us back on the zoom increment.
        let old_level = this._zoom_level_current;
        let new_level = old_level;

        let increment = 0.25;
        if(zoom_out)
            new_level = Math.floor((new_level - 0.001) / increment) * increment;
        else
            new_level = Math.ceil((new_level + 0.001) / increment) * increment;

        // If the amount crosses over one of the special zoom levels above, we select that instead.
        let crossed = function(old_value, new_value, threshold)
        {
            return (old_value < threshold && new_value > threshold) ||
                   (new_value < threshold && old_value > threshold);
        };
        if(crossed(old_level, new_level, cover_zoom_level))
        {
            // console.log("Selected cover zoom");
            new_level = "cover";
        }
        else if(crossed(old_level, new_level, actual_zoom_level))
        {
            // console.log("Selected actual zoom");
            new_level = "actual";
        }
        else
        {
            // Clamp relative zooming.  Do this here to make sure we can always select cover and actual
            // which aren't clamped, even if the image is very large or small.
            new_level = helpers.clamp(new_level, -8, +8);
        }

        this.zoom_level = new_level;
    }

    // Return the image coordinate at a given screen coordinate.
    get_image_position(screen_pos)
    {
        let pos = this.current_zoom_pos;

        return [
            pos[0] + (screen_pos[0] - this.container_width/2)  / this.onscreen_width,
            pos[1] + (screen_pos[1] - this.container_height/2) / this.onscreen_height,
        ];
    }

    // Given a screen position and a point on the image, align the point to the screen
    // position.  This has no effect when we're not zoomed.
    set_image_position(screen_pos, zoom_center, draw=true)
    {
        this.center_pos = [
            -((screen_pos[0] - this.container_width/2)  / this.onscreen_width - zoom_center[0]),
            -((screen_pos[1] - this.container_height/2) / this.onscreen_height - zoom_center[1]),
        ];

        if(draw)
            this.reposition();
    }

    pointerevent = (e) =>
    {
        if(e.mouseButton != 0 || this.slideshow_enabled)
            return;

        if(e.pressed)
        {
            e.preventDefault();

            this.image_container.style.cursor = "none";

            // Don't show the UI if the mouse hovers over it while dragging.
            document.body.classList.add("hide-ui");

            // Stop animating if this is a real click.  If it's a carried-over click during quick
            // view, don't stop animating until we see a drag.
            if(e.type != "simulatedpointerdown")
                this.stop_animation();

            if(!this._locked_zoom)
                var zoom_center_pos = this.get_image_position([e.pageX, e.pageY]);

            // If this is a simulated press event, the button was pressed on the previous page,
            // probably due to quick view.  Don't zoom from this press, but do listen to pointermove,
            // so send_mouse_movement_to_linked_tabs is still called.
            let allow_zoom = true;
            if(e.type == "simulatedpointerdown" && !this._locked_zoom)
                allow_zoom = false;

            if(allow_zoom)
                this._mouse_pressed = true;

            this.drag_movement = [0,0];

            this.captured_pointer_id = e.pointerId;
            this.image_container.setPointerCapture(this.captured_pointer_id);

            // If this is a click-zoom, align the zoom to the point on the image that
            // was clicked.
            if(!this._locked_zoom)
                this.set_image_position([e.pageX, e.pageY], zoom_center_pos);

            this.reposition();

            // Only listen to pointermove while we're dragging.
            this.image_container.addEventListener("pointermove", this.pointermove);
        } else {
            if(this.captured_pointer_id == null || e.pointerId != this.captured_pointer_id)
                return;

            // Tell hide_mouse_cursor_on_idle that the mouse cursor should be hidden, even though the
            // cursor may have just been moved.  This prevents the cursor from appearing briefly and
            // disappearing every time a zoom is released.
            track_mouse_movement.singleton.simulate_inactivity();
            
            this.stop_dragging();
        }
    }

    stop_dragging()
    {
        // Save our history state on mouseup.
        this.save_to_history();
            
        if(this.image_container != null)
        {
            this.image_container.removeEventListener("pointermove", this.pointermove);
            this.image_container.style.cursor = "";
        }

        if(this.captured_pointer_id != null)
        {
            this.image_container.releasePointerCapture(this.captured_pointer_id);
            this.captured_pointer_id = null;
        }
        
        document.body.classList.remove("hide-ui");
        
        this._mouse_pressed = false;
        this.reposition();
    }

    pointermove = (e) =>
    {
        // If we're animating, only start dragging after we pass a drag threshold, so we
        // don't cancel the animation in quick view.  These thresholds match Windows's
        // default SM_CXDRAG/SM_CYDRAG behavior.
        this.drag_movement[0] += e.movementX;
        this.drag_movement[1] += e.movementY;
        if(this.animations && this.drag_movement[0] < 4 && this.drag_movement[1] < 4)
            return;

        this.apply_pointer_movement({movementX: e.movementX, movementY: e.movementY});
    }

    quickviewpointermove = (e) =>
    {
        this.apply_pointer_movement({movementX: e.movementX, movementY: e.movementY});
    }

    apply_pointer_movement({movementX, movementY})
    {
        this.stop_animation();

        // Send pointer movements to linked tabs.
        SendImage.send_mouse_movement_to_linked_tabs(movementX, movementY);

        // Apply mouse dragging.
        let x_offset = movementX;
        let y_offset = movementY;

        if(settings.get("invert-scrolling"))
        {
            x_offset *= -1;
            y_offset *= -1;
        }

        // This will make mouse dragging match the image exactly:
        x_offset /= this.onscreen_width;
        y_offset /= this.onscreen_height;

        // Scale movement by the zoom factor, so we move faster if we're zoomed
        // further in.
        let zoom_factor = this._zoom_factor_current;
        x_offset *= zoom_factor;
        y_offset *= zoom_factor;

        this.center_pos[0] += x_offset;
        this.center_pos[1] += y_offset;

        this.reposition();
    }

    // Return true if zooming is active.
    get zoom_active()
    {
        return this._mouse_pressed || this._locked_zoom;
    }

    get _image_to_screen_ratio()
    {
        let screen_width = this.container_width;
        let screen_height = this.container_height;

        // In case we're hidden and have no width, make sure we don't return an invalid value.
        if(screen_width == 0 || screen_height == 0)
            return 1;

        return Math.min(screen_width/this.cropped_size.width, screen_height/this.cropped_size.height);
    }

    // Return the DOMRect of the cropped size of the image.  If we're not cropping, this
    // is the size of the image itself.
    get cropped_size()
    {
        if(this._cropped_size != null)
            return this._cropped_size;
        else
            return new FixedDOMRect(0, 0, this.original_width, this.original_height);
    }
    
    // Return the width and height of the image when at 1x zoom.
    get width() { return this.cropped_size.width * this._image_to_screen_ratio; }
    get height() { return this.cropped_size.height * this._image_to_screen_ratio; }

    // The actual size of the image with its current zoom.
    get onscreen_width() { return this.width * this._zoom_factor_current; }
    get onscreen_height() { return this.height * this._zoom_factor_current; }

    // The dimensions of the image viewport.  This can be 0 if the view is hidden.
    get container_width() { return this.image_container.offsetWidth || 0; }
    get container_height() { return this.image_container.offsetHeight || 0; }

    // If the image has a safe zone, return it in unit coordinates relative to the cropped image.
    get unit_safe_zone()
    {
        if(this._safe_zone == null)
            return null;

        let cropped_size = this.cropped_size;
            
        let left = helpers.scale(this._safe_zone.left, cropped_size.left, cropped_size.right, 0, 1);
        let right = helpers.scale(this._safe_zone.right, cropped_size.left, cropped_size.right, 0, 1);
        let top = helpers.scale(this._safe_zone.top, cropped_size.top, cropped_size.bottom, 0, 1);
        let bottom = helpers.scale(this._safe_zone.bottom, cropped_size.top, cropped_size.bottom, 0, 1);

        return new FixedDOMRect(
            left, top, right, bottom
        );
    }

    get current_zoom_pos()
    {
        if(this.zoom_active)
            return this.center_pos;
        else
            return [0.5, 0.5];
    }

    reposition()
    {
        if(this.img == null)
            return;

        // Stop if we're being called after being disabled.
        if(this.image_container == null)
            return;

        // Stop if there's an animation active.
        if(this.animations != null)
            return;

        this.schedule_save_to_history();

        let screen_width = this.container_width;
        let screen_height = this.container_height;
        var width = this.width;
        var height = this.height;

        // If the dimensions are empty then we aren't loaded.  Stop now, so the math
        // below doesn't break.
        if(width == 0 || height == 0 || screen_width == 0 || screen_height == 0)
            return;

        // When we're zooming to fill the screen, clamp panning to the screen, so we always fill the
        // screen and don't pan past the edge.
        if(this.zoom_active && !settings.get("pan-past-edge"))
        {
            let top_left = this.get_image_position([0,0]);
            top_left[0] = Math.max(top_left[0], 0);
            top_left[1] = Math.max(top_left[1], 0);
            this.set_image_position([0,0], top_left, false);
    
            let bottom_right = this.get_image_position([screen_width,screen_height]);
            bottom_right[0] = Math.min(bottom_right[0], 1);
            bottom_right[1] = Math.min(bottom_right[1], 1);
            this.set_image_position([screen_width,screen_height], bottom_right, false);
        }

        let zoom_factor = this._zoom_factor_current;
        let zoomed_width = width * zoom_factor;
        let zoomed_height = height * zoom_factor;

        // If we're narrower than the screen, lock to the middle.
        if(screen_width >= zoomed_width)
            this.center_pos[0] = 0.5; // center horizontally
        if(screen_height >= zoomed_height)
            this.center_pos[1] = 0.5; // center vertically

        let x = screen_width/2;
        let y = screen_height/2;
        
        // current_zoom_pos is the position that should be centered on screen.  At
        // [0.5,0.5], the image is centered.
        let [pos_x, pos_y] = this.current_zoom_pos;
        x -= pos_x * zoomed_width;
        y -= pos_y * zoomed_height;

        // Only shift by integer amounts.  This only matters when at 1:1, so there's
        // no subpixel offset.
        x = Math.round(x);
        y = Math.round(y);
        
        this.image_box.style.width = Math.round(zoomed_width) + "px";
        this.image_box.style.height = Math.round(zoomed_height) + "px";
        this.image_box.style.transform = `translate(${x}px, ${y}px)`;
    }

    update_crop()
    {
        helpers.set_class(this.image_box, "cropping", this._cropped_size != null);

        // If we're not cropping, just turn the crop box off entirely.
        if(this._cropped_size == null)
        {
            this.crop_box.style.width = "100%";
            this.crop_box.style.height = "100%";
            this.crop_box.style.transformOrigin = "0 0";
            this.crop_box.style.transform = "";
            return;
        }

        // Crop the image by scaling up crop_box to cut off the right and bottom,
        // then shifting left and up.  The size is relative to image_box, so this
        // doesn't actually increase the image size.
        let crop_width = this._cropped_size.width / this.original_width;
        let crop_height = this._cropped_size.height / this.original_height;
        let crop_left = this._cropped_size.left / this.original_width;
        let crop_top = this._cropped_size.top / this.original_height;
        this.crop_box.style.width = `${(1/crop_width)*100}%`;
        this.crop_box.style.height = `${(1/crop_height)*100}%`;
        this.crop_box.style.transformOrigin = "0 0";
        this.crop_box.style.transform = `translate(${-crop_left*100}%, ${-crop_top*100}%)`;
    }

    // Restore the pan and zoom state from history.
    restore_from_history()
    {
        let args = helpers.args.location;
        if(args.state.zoom == null)
        {
            this.reset_position();
            return;
        }

        // If we were animating, start animating again.
        if(args.state.zoom.animating)
            this.refresh_autopan();

        this.zoom_level = args.state.zoom?.zoom;
        this.locked_zoom = args.state.zoom?.lock;
        this.center_pos = [...args.state.zoom?.pos];
        this.set_initial_image_position = true;
        this.initial_image_position_aspect = null;
        this.reposition();

        this.set_initial_image_position = true;
    }

    // Save the pan and zoom state to history.
    save_to_history = () =>
    {
        // Store the pan position at the center of the screen.
        let args = helpers.args.location;
        args.state.zoom = {
            pos: this.center_pos,
            zoom: this.zoom_level,
            lock: this.locked_zoom,
            animating: this.animations != null,
        };

        helpers.set_page_url(args, false /* add_to_history */);
    }

    // Schedule save_to_history to run.  This is buffered so we don't call history.replaceState
    // too quickly.
    schedule_save_to_history()
    {
        this.cancel_save_to_history();
        this.save_to_history_id = setTimeout(() => {
            this.save_to_history_id = null;
            this.save_to_history();
        }, 250);
    }

    cancel_save_to_history()
    {
        if(this.save_to_history_id != null)
        {
            clearTimeout(this.save_to_history_id);
            this.save_to_history_id = null;
        }
    }

    // Start a pan/zoom animation.  If it's already running, update it in place.
    refresh_autopan()
    {
        if(!this.animation_enabled)
        {
            this.stop_animation();
            return;
        }

        // If we were already animating for slideshow and we're now panning instead or
        // vice versa, stop the animation so we start the new type.
        if(this.animation_enabled_for_slideshow != this.slideshow_enabled)
            this.stop_animation();
        this.animation_enabled_for_slideshow = this.slideshow_enabled;

        let slideshow = new ppixiv.slideshow({
            // this.width/this.height are the size of the image at 1x zoom, which is to fit
            // onto the screen.  Scale this up by zoom_factor_cover, so the slideshow's default
            // zoom level is to cover the screen.
            width: this.width * this._zoom_factor_cover,
            height: this.height * this._zoom_factor_cover,
            container_width: this.container_width,
            container_height: this.container_height,
            unit_safe_zone: this.unit_safe_zone,
            slideshow_enabled: this.slideshow_enabled,

            // Set the minimum zoom to 1 / cover, so the smallest zoom it allows brings the image
            // back to fit onscreen, and we don't go any smaller than that.
            minimum_zoom: 1 / this._zoom_factor_cover,
        });

        // Try to create a vertical or horizontal pan.
        let animation = slideshow.get_default_animation();
        this.run_animation(animation);
    }

    // animation must be prepared with prepare_animation first.
    run_animation(animation)
    {
        // If we're not updating an already-running animation, set up the image for animating.
        if(this.animation == null)
        {
            // Opacity from fades is applied when the animation stops, so the image doesn't reappear
            // while the next image is loading.  If there's an opacity left over from the previous
            // image, remove it now.
            this.image_box.style.opacity = "";

            this.image_box.style.width = Math.round(animation.default_width) + "px";
            this.image_box.style.height = Math.round(animation.default_height) + "px";
        }

        let keyframes = [];
        let current_time = 0;
        for(let point of animation.pan)
        {
            let keyframe = {
                transform: `translateX(${point.computed_tx}px) translateY(${point.computed_ty}px) scale(${point.computed_zoom})`,
                easing: point.ease ?? "ease-out",
                offset: current_time / animation.total_time,
            };

            keyframes.push(keyframe);
            current_time += point.duration;
        }

        // Create the animation, or update it in-place if it already exists, probably due to the
        // window being resized.  total_time won't be updated when we do this.
        if(this.animations == null)
        {
            let main_animation = new Animation(new KeyframeEffect(
                this.image_box,
                keyframes,
                {
                    duration: animation.total_time * 1000,
                    fill: 'forwards',
                }
            ));

            // Create a separate animation for fade-in and fade-out.
            let fade_keyframes = [{
            }];

            let fade_duration = animation.fade_in + animation.fade_out;
            if(fade_duration > 0 && fade_duration <= animation.total_time)
            {
                fade_keyframes = [{
                    opacity: 0,
                }, {
                    opacity: 1,
                    easing: "linear",
                    offset: animation.fade_in / animation.total_time,
                }, {
                    opacity: 1,
                    offset: 1 - (animation.fade_out / animation.total_time),
                }, {
                    opacity: 0,
                    offset: 1,
                }];
            }

            let fade_animation = new Animation(new KeyframeEffect(
                this.image_box, fade_keyframes, {
                    duration: animation.total_time * 1000,
                    fill: 'forwards',
                }
            ));
            
            this.animations = [main_animation, fade_animation];

            // Commit and remove the animation when it finishes, so the history state remembers that
            // we were no longer animating.  This way, viewing an image in a linked tab and then removing
            // it doesn't restart a long-finished animation.  We only pay attention to the main animation
            // for this and ignore the fade.
            this.animations[0].onfinish = (e) => {
                this.stop_animation();
                if(this.slideshow_enabled && this.onnextimage)
                    this.onnextimage();
            };

            for(let animation of this.animations)
                animation.play();
        } else {
            this.animations[0].effect.setKeyframes(keyframes);
        }
    }

    // If a pan animation is running, cancel it.
    //
    // Animation is separate from pan and zoom, and any interaction with pan and zoom will
    // cancel the animation.
    stop_animation()
    {
        if(this.animations == null)
            return;

        // Commit the current state of the main animation so we can read where the image was.
        // This also commits the opacity, so if we're ending one image to display another the
        // image won't flash on screen.
        let applied_animations = true;
        try {
            for(let animation of this.animations)
                animation.commitStyles();
        } catch {
            applied_animations = false;

        }
        // Cancel all animations.  We don't need to wait for animation.pending here.
        for(let animation of this.animations)
            animation.cancel();

        this.animations = null;

        if(!applied_animations)
        {
            // For some reason, commitStyles throws an exception if we're not visible, which happens
            // if we're shutting down.  In this case, just cancel the animations.
            return;
        }

        // In case the animation was fading while it was cancelled, make sure opacity is reset.
        // There's a slight transition on opacity, which both prevents it from popping in suddenly
        // and helps prevent images from flashing onscreen if we immediately remove it to display
        // something else.
        this.image_box.style.opacity = "";

        // Figure out the zoom factor the animation left us with.  The zoom factor is 1 if
        // the image width equals this.width.
        let { width, left, top } = this.image_box.getBoundingClientRect();
        let zoom_factor = width / this.width;
        let zoom_level = this.zoom_factor_to_zoom_level(zoom_factor);

        // Apply the current zoom and pan position.  If zoom_factor is 1x then just disable
        // zoom, and use "cover" if the zoom level matches it.  The zoom we set here doesn't
        // have to be one that's selectable in the UI.
        this.locked_zoom = true;
        if(Math.abs(zoom_factor - 1) < 0.01)
            this.locked_zoom = false;
        else if(Math.abs(zoom_level - this._zoom_level_cover) < 0.01)
            this.zoom_level = "cover";
        else
            this.zoom_level = zoom_level;

        // Set the image position to match where the animation left it.
        this.set_image_position([left, top], [0,0], false);
    
        this.reposition();
    }

    // Return true if we want to be animating.
    get animation_enabled()
    {
        if(ppixiv.settings.get("auto_pan"))
            return true;
        return this.slideshow_enabled;
    }

    get slideshow_enabled()
    {
        return helpers.args.location.hash.get("slideshow") == "1";
    }

    set _pause_animation(pause)
    {
        if(this.animations == null)
            return;

        for(let animation of this.animations)
            animation.updatePlaybackRate(pause? 0:1);
    }
}

