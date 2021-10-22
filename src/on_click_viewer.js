"use strict";

// View img fullscreen.  Clicking the image will zoom it to its original size and scroll
// it around.
//
// The image is always zoomed a fixed amount from its fullscreen size.  This is generally
// more usable than doing things like zooming based on the native resolution.
ppixiv.on_click_viewer = class
{
    constructor()
    {
        this.onresize = this.onresize.bind(this);
        this.pointermove = this.pointermove.bind(this);
        this.block_event = this.block_event.bind(this);
        this.window_blur = this.window_blur.bind(this);

        this.original_width = 1;
        this.original_height = 1;

        this.center_pos = [0, 0];

        // Restore the most recent zoom mode.  We assume that there's only one of these on screen.
        this.locked_zoom = settings.get("zoom-mode") == "locked";
        this._zoom_level = settings.get("zoom-level", "cover");
    }

    set_new_image(url, preview_url, image_container, width, height)
    {
        this.disable(false /* !stop_drag */);

        this.image_container = image_container;
        this.original_width = width;
        this.original_height = height;

        this.img = document.createElement("img");
        this.img.src = url? url:helpers.blank_image;
        this.img.className = "filtering";
        image_container.appendChild(this.img);

        // Create the low-res preview.  This loads the thumbnail underneath the main image.  Don't set the
        // "filtering" class, since using point sampling for the thumbnail doesn't make sense.  If preview_url
        // is null, just use a blank image.
        this.preview_img = document.createElement("img");
        this.preview_img.src = preview_url? preview_url:helpers.blank_image;
        this.preview_img.classList.add("low-res-preview");
        image_container.appendChild(this.preview_img);

        // The secondary image holds the low-res preview image that's shown underneath the loading image.
        // It just follows the main image around and shouldn't receive input events.
        this.preview_img.style.pointerEvents = "none";

        // When the image finishes loading, remove the preview image, to prevent artifacts with
        // transparent images.  Keep a reference to preview_img, so we don't need to worry about
        // it changing.  on_click_viewer will still have a reference to it, but it won't do anything.
        //
        // Don't do this if url is null.  Leave the preview up and don't switch over to the blank
        // image.
        let preview_image = this.preview_img;
        if(url != null)
        {
            this.img.addEventListener("load", (e) => {
                preview_image.remove();
            });
        }

        this._add_events();
        this.reset_position();
        this.reposition();
    }

    disable(stop_drag=true)
    {
        if(stop_drag)
            this.stop_dragging();

        this._remove_events();
        this.cancel_save_to_history();

        if(this.img)
        {
            this.img.remove();
            this.img = null;
        }

        if(this.preview_img)
        {
            this.preview_img.remove();
            this.preview_img = null;
        }
    }

    // Set the pan position to the default for this image.
    reset_position()
    {
        // Figure out whether the image is relatively portrait or landscape compared to the screen.
        let screen_width = Math.max(this.container_width, 1); // might be 0 if we're hidden
        let screen_height = Math.max(this.container_height, 1);
        let aspect = (screen_width/this.original_width) > (screen_height/this.original_height)? "portrait":"landscape";

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
        if(this.set_initial_image_position && aspect != this.initial_image_position_aspect)
            this.set_initial_image_position = false;

        if(this.set_initial_image_position)
            return;

        this.set_initial_image_position = true;
        this.initial_image_position_aspect = aspect;
    
        // Similar to how we display thumbnails for portrait images starting at the top, default to the top
        // if we'll be panning vertically when in cover mode.
        let zoom_center = [0.5, aspect == "portrait"? 0:0.5];
        this.center_pos = zoom_center;
    }

    block_event(e)
    {
        e.preventDefault();
    }

    _add_events()
    {
        this._remove_events();

        this.event_abort = new AbortController();

        window.addEventListener("blur", this.window_blur, { signal: this.event_abort.signal });
        window.addEventListener("resize", this.onresize, { signal: this.event_abort.signal, capture: true });
        this.image_container.addEventListener("dragstart", this.block_event, { signal: this.event_abort.signal });
        this.image_container.addEventListener("selectstart", this.block_event, { signal: this.event_abort.signal });

        new ppixiv.pointer_listener({
            element: this.image_container,
            button_mask: 1,
            signal: this.event_abort.signal,
            callback: this.pointerevent,
        });

        // This is like pointermove, but received during quick view from the source tab.
        window.addEventListener("quickviewpointermove", this.quick_view_pointermove, { signal: this.event_abort.signal });

        this.image_container.style.userSelect = "none";
        this.image_container.style.MozUserSelect = "none";
    }

    _remove_events()
    {
        if(this.event_abort)
        {
            this.event_abort.abort();
            this.event_abort = null;
        }

        if(this.image_container)
        {
            this.image_container.style.userSelect = "none";
            this.image_container.style.MozUserSelect = "";
        }
    }

    onresize(e)
    {
        this.reposition();
    }

    window_blur(e)
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
    // return zoom_pos, so this just converts screen coords to unit
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
        if(e.mouseButton != 0)
            return;

        if(e.pressed)
        {
            // We only want clicks on the image, or on the container backing the image, not other
            // elements inside the container.
            if(e.target != this.img && e.target != this.image_container)
                return;

            this.image_container.style.cursor = "none";

            // Don't show the UI if the mouse hovers over it while dragging.
            document.body.classList.add("hide-ui");

            if(!this._locked_zoom)
                var zoom_center_pos = this.get_image_position([e.pageX, e.pageY]);

            this._mouse_pressed = true;
            this.dragged_while_zoomed = false;

            this.captured_pointer_id = e.pointerId;
            this.img.setPointerCapture(this.captured_pointer_id);

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

            if(!this._mouse_pressed)
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
        if(this.image_container != null)
        {
            this.image_container.removeEventListener("pointermove", this.pointermove);
            this.image_container.style.cursor = "";
        }

        if(this.captured_pointer_id != null)
        {
            this.img.releasePointerCapture(this.captured_pointer_id);
            this.captured_pointer_id = null;
        }
        
        document.body.classList.remove("hide-ui");
        
        this._mouse_pressed = false;
        this.reposition();
    }

    pointermove(e)
    {
        if(!this._mouse_pressed)
            return;

        this.dragged_while_zoomed = true;

        this.apply_pointer_movement({movementX: e.movementX, movementY: e.movementY});
    }

    quick_view_pointermove = (e) =>
    {
        this.apply_pointer_movement({movementX: e.movementX, movementY: e.movementY});
    }

    apply_pointer_movement({movementX, movementY})
    {
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

        return Math.min(screen_width/this.original_width, screen_height/this.original_height);
    }
    
    // Return the width and height of the image when at 1x zoom.
    get width() { return this.original_width * this._image_to_screen_ratio; }
    get height() { return this.original_height * this._image_to_screen_ratio; }

    // The actual size of the image with its current zoom.
    get onscreen_width() { return this.width * this._zoom_factor_current; }
    get onscreen_height() { return this.height * this._zoom_factor_current; }

    // The dimensions of the image viewport.  This can be 0 if the view is hidden.
    get container_width() { return this.image_container.offsetWidth || 0; }
    get container_height() { return this.image_container.offsetHeight || 0; }

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
    
        // Normally (when unzoomed), the image is centered.
        let [x, y] = this.current_zoom_pos;

        this.img.style.width = this.width + "px";
        this.img.style.height = this.height + "px";
        this.img.style.position = "absolute";

        // We can either use CSS positioning or transforms.  Transforms used to be a lot
        // faster, but today it doesn't matter.  However, with CSS positioning we run into
        // weird Firefox compositing bugs that cause the image to disappear after zooming
        // and opening the context menu.  That's hard to pin down, but since it doesn't happen
        // with translate, let's just use that.
        this.img.style.transformOrigin = "0 0";
        this.img.style.transform = 
            `translate(${screen_width/2}px, ${screen_height/2}px) ` +
            `scale(${zoom_factor}) ` +
            `translate(${-this.width * x}px, ${-this.height * y}px) ` +
        ``;
        this.img.style.right = "auto";
        this.img.style.bottom = "auto";

        // If we have a secondary (preview) image, put it in the same place as the main image.
        if(this.preview_img)
        {
            this.preview_img.style.width = this.width + "px";
            this.preview_img.style.height = this.height + "px";
            this.preview_img.style.position = "absolute";
            this.preview_img.style.right = "auto";
            this.preview_img.style.bottom = "auto";
            this.preview_img.style.transformOrigin = "0 0";
            this.preview_img.style.transform = this.img.style.transform;
        }

        // Store the effective zoom in our tab info.  This is in a format that makes it easy
        // to replicate the zoom in other UIs.  Send this as extra data in the tab info.  This
        // data isn't sent in realtime, since it would spam broadcasts as we zoom.  It's just
        // sent when we lose focus.
        let top_left = this.get_image_position([0,0]);
        let current_zoom_desc = {
            left: -top_left[0] * this.onscreen_width / screen_width, // convert from image size to fraction of screen size
            top: -top_left[1] * this.onscreen_height / screen_height,
            width: zoom_factor * width / screen_width,
            height: zoom_factor * height / screen_height,
        };
        SendImage.set_extra_data("illust_screen_pos", current_zoom_desc, true);
    }

    // Restore the pan and zoom state from history.
    restore_from_history = () =>
    {
        let args = helpers.args.location;
        if(args.state.zoom == null)
            return;

        this.zoom_level = args.state.zoom?.zoom;
        this.locked_zoom = args.state.zoom?.lock;
        this.center_pos = [...args.state.zoom?.pos];
        this.reposition();

        this.set_initial_image_position = true;
    }

    // Save the pan and zoom state to history.
    save_to_history = () =>
    {
        this.save_to_history_id = null;

        // Store the pan position at the center of the screen.
        let args = helpers.args.location;
        let screen_pos = [this.container_width / 2, this.container_height / 2];
        args.state.zoom = {
            pos: this.center_pos,
            zoom: this.zoom_level,
            lock: this.locked_zoom,
        };

        helpers.set_page_url(args, false /* add_to_history */);
    }

    // Schedule save_to_history to run.  This is buffered so we don't call history.replaceState
    // too quickly.
    schedule_save_to_history()
    {
        this.cancel_save_to_history();
        this.save_to_history_id = setTimeout(this.save_to_history, 250);
    }

    cancel_save_to_history()
    {
        if(this.save_to_history_id != null)
        {
            clearTimeout(this.save_to_history_id);
            this.save_to_history_id = null;
        }
    }
}

