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
        this.pointerdown = this.pointerdown.bind(this);
        this.pointerup = this.pointerup.bind(this);
        this.pointermove = this.pointermove.bind(this);
        this.block_event = this.block_event.bind(this);
        this.window_blur = this.window_blur.bind(this);

        this._zoom_level = 0;

        // The caller can set this to a function to be called if the user clicks the image without
        // dragging.
        this.clicked_without_scrolling = null;

        this.original_width = 1;
        this.original_height = 1;

        this.zoom_pos = [0, 0];

        settings.set_per_session("zoom-mode");
        settings.set_per_session("zoom-level");

        // Restore the most recent zoom mode.  We assume that there's only one of these on screen.
        this.locked_zoom = settings.get("zoom-mode") == "locked";
        this._zoom_level = settings.get("zoom-level", "cover");
    }

    set_new_image(img, secondary_img, width, height)
    {
        if(this.img != null)
        {
            // Don't call this.disable, so we don't exit zoom.
            this._remove_events();
            this.img.remove();
        }

        this.img = img;
        this.secondary_img = secondary_img;
        this.original_width = width;
        this.original_height = height;

        if(this.img == null)
            return;

        this._add_events();

        // If we've never set an image position, do it now.
        if(!this.set_initial_image_position)
        {
            // Similar to how we display thumbnails for portrait images starting at the top, default to the top
            // if we'll be panning vertically when in cover mode.  This is based on how the image fits into the
            // browser window instead of the actual aspect ratio.
            // let aspect_ratio = this.original_width / this.original_height;
            // let portrait = aspect_ratio < 0.9;
            let screen_width = Math.max(this.container_width, 1); // might be 0 if we're hidden
            let screen_height = Math.max(this.container_height, 1);
            let portrait = (screen_width/this.original_width) > (screen_height/this.original_height);
            
            this.set_initial_image_position = true;
            this.set_image_position(
                    [this.container_width * 0.5, this.container_height * 0.5],
                    [this.width * 0.5, this.height * (portrait? 0:0.5)]);
        }

        this.reposition();
    }

    block_event(e)
    {
        e.preventDefault();
    }

    enable()
    {
        this._add_events();
    }

    _add_events()
    {
        var target = this.img.parentNode;
        this.event_target = target;
        window.addEventListener("blur", this.window_blur);
        window.addEventListener("resize", this.onresize, true);
        target.addEventListener("pointerdown", this.pointerdown);
        target.addEventListener("pointerup", this.pointerup);
        target.addEventListener("pointercancel", this.pointerup);
        target.addEventListener("dragstart", this.block_event);
        target.addEventListener("selectstart", this.block_event);

        target.style.userSelect = "none";
        target.style.MozUserSelect = "none";
    }

    _remove_events()
    {
        if(this.event_target)
        {
            var target = this.event_target;
            this.event_target = null;
            target.removeEventListener("pointerdown", this.pointerdown);
            target.removeEventListener("pointerup", this.pointerup);
            target.removeEventListener("pointercancel", this.pointerup);
            target.removeEventListener("dragstart", this.block_event);
            target.removeEventListener("selectstart", this.block_event);
            target.style.userSelect = "none";
            target.style.MozUserSelect = "";
        }

        window.removeEventListener("blur", this.window_blur);
        window.removeEventListener("resize", this.onresize, true);
    }

    disable()
    {
        this.stop_dragging();
        this._remove_events();
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
        console.log("set", value);
        this.reposition();
    }

    // Get the effective zoom level, translating "cover" and "fill" to actual values.
    get _zoom_level_value()
    {
        let level = this._zoom_level;
        if(level == "cover")
            return this._zoom_level_cover;
        else if(level == "actual")
            return this._zoom_level_actual;
        else
            return level;
    }
    
    // Return the zoom factor applied by relative zoom.
    get relative_zoom_factor()
    {
        return Math.pow(1.5, this._zoom_level_value);
    }

    // The zoom level for cover mode:
    get _zoom_level_cover()
    {
        let screen_width = this.container_width;
        let screen_height = this.container_height;
        let cover_zoom_ratio = Math.max(screen_width/this.width, screen_height/this.height);

        // Convert from a linear zoom ratio to the exponential zoom ratio.
        return Math.log2(cover_zoom_ratio) / Math.log2(1.5);
    }

    // The zoom level for "actual" mode:
    get _zoom_level_actual()
    {
        let actual_zoom_ratio = 1 / this._image_to_screen_ratio;

        // Convert from a linear zoom ratio to the exponential zoom ratio.
        return Math.log2(actual_zoom_ratio) / Math.log2(1.5);
    }

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
        let old_level = this._zoom_level_value;
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
            console.log("Selected cover zoom");
            new_level = "cover";
        }
        else if(crossed(old_level, new_level, actual_zoom_level))
        {
            console.log("Selected actual zoom");
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

    // Return the active zoom ratio.
    get _effective_zoom_level()
    {
        if(!this.zoom_active)
            return 1;

        return this.relative_zoom_factor;
    }

    // Given a screen position, return the normalized position relative to the image.
    // (0,0) is the top-left of the image and (1,1) is the bottom-right.
    get_image_position(screen_pos)
    {
        // zoom_pos shifts the image around in screen space.
        var zoom_center = [0,0];
        if(this.zoom_active)
        {
            zoom_center[0] -= this.zoom_pos[0];
            zoom_center[1] -= this.zoom_pos[1];
        }
        zoom_center[0] += screen_pos[0];
        zoom_center[1] += screen_pos[1];

        // Offset by the base screen position we're in when not zoomed (centered).
        let screen_width = this.container_width;
        let screen_height = this.container_height;
        zoom_center[0] -= (screen_width - this.width) / 2;
        zoom_center[1] -= (screen_height - this.height) / 2;

        // Scale from the current zoom level to the effective size.
        var zoom_level = this._effective_zoom_level;
        zoom_center[0] /= zoom_level;
        zoom_center[1] /= zoom_level;
        
        return zoom_center;
    }

    // Given a screen position and a point on the image, align the point to the screen
    // position.  This has no effect when we're not zoomed.
    set_image_position(screen_pos, zoom_center)
    {
        if(!this.zoom_active)
            return;

        // This just does the inverse of get_image_position.
        zoom_center = [zoom_center[0], zoom_center[1]];

        var zoom_level = this._effective_zoom_level;
        zoom_center[0] *= zoom_level;
        zoom_center[1] *= zoom_level;

        // make this relative to zoom_pos, since that's what we need to set it back to below
        let screen_width = this.container_width;
        let screen_height = this.container_height;
        zoom_center[0] += (screen_width - this.width) / 2;
        zoom_center[1] += (screen_height - this.height) / 2;

        zoom_center[0] -= screen_pos[0];
        zoom_center[1] -= screen_pos[1];

        this.zoom_pos = [-zoom_center[0], -zoom_center[1]];

        this.reposition();
    }

    pointerdown(e)
    {
        if(e.button != 0)
            return;

        // We only want clicks on the image, or on the container backing the image, not other
        // elements inside the container.
        if(e.target != this.img && e.target != this.img.parentNode)
            return;

        this.event_target.style.cursor = "none";

        // Don't show the UI if the mouse hovers over it while dragging.
        document.body.classList.add("hide-ui");

        if(!this._locked_zoom)
            var zoom_center_percent = this.get_image_position([e.pageX, e.pageY]);

        this._mouse_pressed = true;
        this.dragged_while_zoomed = false;

        this.captured_pointer_id = e.pointerId;
        this.img.setPointerCapture(this.captured_pointer_id);

        // If this is a click-zoom, align the zoom to the point on the image that
        // was clicked.
        if(!this._locked_zoom)
            this.set_image_position([e.pageX, e.pageY], zoom_center_percent);

        this.reposition();

        // Only listen to pointermove while we're dragging.
        this.event_target.addEventListener("pointermove", this.pointermove);
    }

    pointerup(e)
    {
        if(this.captured_pointer_id == null || e.pointerId != this.captured_pointer_id)
            return;

        if(!this._mouse_pressed)
            return;

        // Tell hide_mouse_cursor_on_idle that the mouse cursor should be hidden, even though the
        // cursor may have just been moved.  This prevents the cursor from appearing briefly and
        // disappearing every time a zoom is released.
        window.dispatchEvent(new Event("hide-cursor-immediately"));
        
        this.stop_dragging();
    }

    stop_dragging()
    {
        if(this.event_target != null)
        {
            this.event_target.removeEventListener("pointermove", this.pointermove);
            this.event_target.style.cursor = "";
        }

        if(this.captured_pointer_id != null)
        {
            // Firefox has broken pointer capture, and will throw an exception when we call releasePointerCapture
            // on a valid captured pointer ID.  There doesn't seem to be much we can do about this, so just swallow
            // the exception.
            try {
                this.img.releasePointerCapture(this.captured_pointer_id);
            } catch(e) {
                console.error("releasePointerCapture", e);
            }
            this.captured_pointer_id = null;
        }
        
        document.body.classList.remove("hide-ui");
        
        this._mouse_pressed = false;
        this.reposition();
        
        if(!this.dragged_while_zoomed && this.clicked_without_scrolling)
            this.clicked_without_scrolling();
    }

    pointermove(e)
    {
        if(!this._mouse_pressed)
            return;

        // If button 1 isn't pressed, treat this as a pointerup.  (The pointer events API
        // is really poorly designed in its handling of multiple button presses.)
        if((e.buttons & 1) == 0)
        {
            this.pointerup(e);
            return;
        }

        this.dragged_while_zoomed = true;

        // Apply mouse dragging.
        var x_offset = e.movementX;
        var y_offset = e.movementY;

        if(settings.get("invert-scrolling"))
        {
            x_offset *= -1;
            y_offset *= -1;
        }
       
        // Scale movement by the zoom level.
        var zoom_level = this._effective_zoom_level;
        this.zoom_pos[0] += x_offset * -1 * zoom_level;
        this.zoom_pos[1] += y_offset * -1 * zoom_level;

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

    // The dimensions of the image viewport.  This can be 0 if the view is hidden.
    get container_width() { return this.img.parentNode.offsetWidth; }
    get container_height() { return this.img.parentNode.offsetHeight; }

    reposition()
    {
        if(this.img == null)
            return;

        // Stop if we're being called after being disabled.
        if(this.img.parentNode == null)
            return;

        let screen_width = this.container_width;
        let screen_height = this.container_height;
        var width = this.width;
        var height = this.height;

        // If the dimensions are empty then we aren't loaded.  Stop now, so the math
        // below doesn't break.
        if(width == 0 || height == 0 || screen_width == 0 || screen_height == 0)
            return;

        // Normally (when unzoomed), the image is centered.
        var left = (screen_width - width) / 2;
        var top = (screen_height - height) / 2;

        if(this.zoom_active)
        {
            // Shift by the zoom position.
            left += this.zoom_pos[0];
            top += this.zoom_pos[1];

            // Apply the zoom.
            var zoom_level = this._effective_zoom_level;
            height *= zoom_level;
            width *= zoom_level;

            if(!settings.get("pan-past-edge"))
            {
                // When we're zooming to fill the screen, clamp panning to the screen, so we always fill the
                // screen and don't pan past the edge.  If we're narrower than the screen, lock to center.
                let orig_top = top;
                if(screen_height < height)
                    top  = helpers.clamp(top, -(height - screen_height), 0); // clamp to the top and bottom
                else
                    top  = -(height - screen_height) / 2; // center vertically

                let orig_left = left;
                if(screen_width < width)
                    left = helpers.clamp(left, -(width - screen_width), 0); // clamp to the left and right
                else
                    left = -(width - screen_width) / 2; // center horizontally

                // Apply any clamping we did to the position to zoom_pos too, so if you move the
                // mouse far beyond the edge, you don't have to move it all the way back before we
                // start panning again.
                this.zoom_pos[0] += left - orig_left;
                this.zoom_pos[1] += top - orig_top;
            }
        }

        left = Math.round(left);
        top = Math.round(top);
        width = Math.round(width);
        height = Math.round(height);
        this.img.style.width = width + "px";
        this.img.style.height = height + "px";
        this.img.style.position = "absolute";

        // We can either use CSS positioning or transforms.  Transforms used to be a lot
        // faster, but today it doesn't matter.  However, with CSS positioning we run into
        // weird Firefox compositing bugs that cause the image to disappear after zooming
        // and opening the context menu.  That's hard to pin down, but since it doesn't happen
        // with translate, let's just use that.
        // this.img.style.left = left + "px";
        // this.img.style.top = top + "px";
        this.img.style.transform = "translate(" + left + "px, " + top + "px)";
        this.img.style.right = "auto";
        this.img.style.bottom = "auto";

        // If we have a secondary (preview) image, put it in the same place as the main image.
        if(this.secondary_img)
        {
            this.secondary_img.style.width = width + "px";
            this.secondary_img.style.height = height + "px";
            this.secondary_img.style.position = "absolute";
            this.secondary_img.style.left = left + "px";
            this.secondary_img.style.top = top + "px";
            this.secondary_img.style.right = "auto";
            this.secondary_img.style.bottom = "auto";
        }
    }
}

