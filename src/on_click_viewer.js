// View img fullscreen.  Clicking the image will zoom it to its original size and scroll
// it around.
//
// The image is always zoomed a fixed amount from its fullscreen size.  This is generally
// more usable than doing things like zooming based on the native resolution.
class on_click_viewer
{
    constructor(img)
    {
        this.onresize = this.onresize.bind(this);
        this.mousedown = this.mousedown.catch_bind(this);
        this.mouseup = this.mouseup.bind(this);
        this.mousemove = this.mousemove.bind(this);
        this.block_event = this.block_event.bind(this);
        this.window_blur = this.window_blur.bind(this);

        this._zoom_levels = [null, 2, 4, 8, 1];
        this._relative_zoom_level = 0;

        // Observe changes to img.src.
        this.src_observer = new MutationObserver(function(mutation_list) {
            for(var mutation of mutation_list) {
                if(mutation.attributeName == "src")
                {
                    console.log("observer calling image_changed");
                    this.image_changed();
                    break;
                }
            }
        }.bind(this));

        this.src_observer.observe(img, { attributes: true });
        
        // The caller can set this to a function to be called if the user clicks the image without
        // dragging.
        this.clicked_without_scrolling = null;

        this.width = 1;
        this.height = 1;

        this.img = img;
        this.img.style.width = "auto";
        this.img.style.height = "100%";

        this.enable();

        this.zoom_pos = [0.5, 0];
        this._zoom_level = helpers.get_value("zoom-level", 1);

        // Restore the most recent zoom mode.  We assume that there's only one of these on screen.
        this.locked_zoom = helpers.get_value("zoom-mode") != "normal";
        this._relative_zoom_level = helpers.get_value("zoom-level-relative") || 0;
    }

    // The current manga page has changed.
    //
    // This isn't called when switching from one full illustration to another, since a new
    // on_click_viewer will be created instead.
    image_changed()
    {
        if(this.watch_for_size_available)
        {
            clearInterval(this.watch_for_size_available);
            this.watch_for_size_available = null;
        }

        // Hide the image until we have the size, so it doesn't flicker for one frame in the
        // wrong place.
        this.img.style.display = "none";

        // We need to know the new natural size of the image, but in a huge web API oversight,
        // there's no event for that.  We don't want to wait for onload, since we want to know
        // as soon as it's changed, so we'll set a timer and check periodically until we see
        // a change.
        //
        // However, if we're changing from one image to another, there's no way to know when
        // naturalWidth is updated.  Work around this by loading the image in a second img and
        // watching that instead.  The browser will still only load the image once.
        var dummy_img = document.createElement("img");
        dummy_img.src = this.img.src;

        var image_ready = function() {
            if(dummy_img.naturalWidth == 0)
                return;
            // Store the size.  We can't use the values on this.img, since Firefox sometimes updates
            // them at different times.  (That seems like a bug, since browsers are never supposed to
            // expose internal race conditions to scripts.)
            this.width = dummy_img.naturalWidth;
            this.height = dummy_img.naturalHeight;

            // If we've never set an image position, do it now.
            if(!this.set_initial_image_position)
            {
                this.set_initial_image_position = true;
                this.set_image_position(
                        this.img.parentNode.offsetWidth / 2,
                        0,
                        [0.5, 0]);
            }


            if(this.watch_for_size_available)
                clearInterval(this.watch_for_size_available);
            this.watch_for_size_available = null;

            this.reposition();

            this.img.style.display = "block";
        }.bind(this);

        // If the image is already loaded out of cache, it's ready now.  Checking this now
        // reduces flicker between images.
        if(dummy_img.naturalWidth != 0)
            image_ready();
        else
            this.watch_for_size_available = setInterval(image_ready, 10);
    }

    block_event(e)
    {
        e.preventDefault();
    }

    enable()
    {
        var target = this.img.parentNode;
        this.event_target = target;
        window.addEventListener("blur", this.window_blur);
        window.addEventListener("resize", this.onresize, true);
        target.addEventListener(this.using_pointer_events? "pointerdown":"mousedown", this.mousedown);
        target.addEventListener(this.using_pointer_events? "pointerup":"mouseup", this.mouseup);
        target.addEventListener("dragstart", this.block_event);
        target.addEventListener("selectstart", this.block_event);

        target.style.userSelect = "none";
        target.style.MozUserSelect = "none";
    }

    disable()
    {
        if(this.img.parentNode == null)
        {
            console.log("Viewer already disabled");
            return;
        }

        this.stop_dragging();

        this.img.parentNode.removeChild(this.img);

        if(this.watch_for_size_available)
        {
            clearInterval(this.watch_for_size_available);
            this.watch_for_size_available = null;
        }

        if(this.event_target)
        {
            var target = this.event_target;
            this.event_target = null;
            target.removeEventListener(this.using_pointer_events? "pointerdown":"mousedown", this.mousedown);
            target.removeEventListener(this.using_pointer_events? "pointerup":"mouseup", this.mouseup);
            target.removeEventListener("dragstart", this.block_event);
            target.removeEventListener("selectstart", this.block_event);
            target.style.userSelect = "none";
            target.style.MozUserSelect = "";
        }

        window.removeEventListener("blur", this.window_blur);
        window.removeEventListener("resize", this.onresize, true);
    }

    // If pointer events are available, we'll use them to hide the cursor during
    // grabs.  Otherwise, we'll use regular mouse events and setCapture.
    get using_pointer_events()
    {
        return "onpointerdown" in HTMLElement.prototype;
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
        helpers.set_value("zoom-mode", enable? "locked":"normal");
        this.reposition();
    }

    get zoom_level()
    {
        return this._zoom_level;
    }

    // Set the main zoom level.
    set zoom_level(value)
    {
        if(this._zoom_level == value)
            return;
        this._zoom_level = helpers.clamp(value, 0, this._zoom_levels.length - 1);

        // Save the new zoom level.
        helpers.set_value("zoom-level", this._zoom_level);
        
        this.reposition();
    }

    // Relative zoom is applied on top of the main zoom.  At 0, no adjustment is applied.
    // Positive values zoom in and negative values zoom out.
    get relative_zoom_level()
    {
        return this._relative_zoom_level;
    }

    set relative_zoom_level(value)
    {
        value = helpers.clamp(value, -8, +8);

        this._relative_zoom_level = value;
        helpers.set_value("zoom-level-relative", this._relative_zoom_level);
        this.reposition();
    }
    
    // Return the zoom factor applied by relative zoom.
    get relative_zoom_factor()
    {
        return Math.pow(1.5, this._relative_zoom_level);
    }

    // Return the active zoom ratio.
    //
    // This is the main and relative zooms combined.
    get _effective_zoom_level()
    {
        if(!this.zoom_active)
            return 1;

        var ratio = this._zoom_levels[this._zoom_level];

        // The null entry is for screen fill zooming.
        if(ratio == null)
        {
            var screen_width = this.img.parentNode.offsetWidth;
            var screen_height = this.img.parentNode.offsetHeight;
            ratio = Math.max(screen_width/this._effective_width, screen_height/this._effective_height);
        }

        ratio *= this.relative_zoom_factor;

        return ratio;
    }

    // Given a screen position, return the normalized position relative to the image.
    // (0,0) is the top-left of the image and (1,1) is the bottom-right.  If x is null,
    // return the center of the screen.
    get_image_position(x, y)
    {
        if(x == null)
        {
            x = this.img.parentNode.offsetWidth / 2;
            y = this.img.parentNode.offsetHeight / 2;
        }

        // zoom_pos shifts the image around in screen space.
        var zoom_center = [0,0];
        if(this.zoom_active)
        {
            zoom_center[0] -= this.zoom_pos[0];
            zoom_center[1] -= this.zoom_pos[1];
        }
        zoom_center[0] += x;
        zoom_center[1] += y;

        // Offset by the base screen position we're in when not zoomed (centered).
        var screen_width = this.img.parentNode.offsetWidth;
        var screen_height = this.img.parentNode.offsetHeight;
        zoom_center[0] -= (screen_width - this._effective_width) / 2;
        zoom_center[1] -= (screen_height - this._effective_height) / 2;

        // Scale from the current zoom level to 0-1.
        var zoom_level = this._effective_zoom_level;
        zoom_center[0] /= this._effective_width * zoom_level;
        zoom_center[1] /= this._effective_height * zoom_level;

        return zoom_center;
    }

    // Given a screen position and a point on the image, align the point to the screen
    // position.  This has no effect when we're not zoomed.
    set_image_position(x, y, zoom_center)
    {
        if(!this.zoom_active)
            return;

        if(x == null)
        {
            x = this.img.parentNode.offsetWidth / 2;
            y = this.img.parentNode.offsetHeight / 2;
        }

        // This just does the inverse of get_image_position.
        zoom_center = [zoom_center[0], zoom_center[1]];

        var zoom_level = this._effective_zoom_level;
        zoom_center[0] *= this._effective_width * zoom_level;
        zoom_center[1] *= this._effective_height * zoom_level;

        // make this relative to zoom_pos, since that's what we need to set it back to below
        var screen_width = this.img.parentNode.offsetWidth;
        var screen_height = this.img.parentNode.offsetHeight;
        zoom_center[0] += (screen_width - this._effective_width) / 2;
        zoom_center[1] += (screen_height - this._effective_height) / 2;

        zoom_center[0] -= x;
        zoom_center[1] -= y;

        this.zoom_pos[0] = -zoom_center[0];
        this.zoom_pos[1] = -zoom_center[1];

        this.reposition();
    }

    mousedown(e)
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
            var zoom_center_percent = this.get_image_position(e.pageX, e.pageY);            

        this.zoomed = true;
        this.dragged_while_zoomed = false;

        if(this.using_pointer_events)
        {
            this.captured_pointer_id = e.pointerId;
            this.img.setPointerCapture(this.captured_pointer_id);
        }
        else if(this.event_target.setCapture)
            this.event_target.setCapture(true);

        // If this is a click-zoom, align the zoom to the point on the image that
        // was clicked.
        if(!this._locked_zoom)
            this.set_image_position(e.pageX, e.pageY, zoom_center_percent);

        this.reposition();

        // Only listen to mousemove while we're dragging.
        this.event_target.addEventListener(this.using_pointer_events? "pointermove":"mousemove", this.mousemove);
    }

    mouseup(e)
    {
        if(e.button != 0)
            return;

        if(!this.zoomed)
            return;

        // Tell hide_mouse_cursor_on_idle that the mouse cursor should be hidden, even though the
        // cursor may have just been moved.  This prevents the cursor from appearing briefly and
        // disappearing every time a zoom is released.
        window.dispatchEvent(new Event("hide-cursor-immediately"));
        
        this.stop_dragging();
    }

    stop_dragging()
    {
        this.event_target.removeEventListener(this.using_pointer_events? "pointermove":"mousemove", this.mousemove);

        if(this.using_pointer_events && this.captured_pointer_id != null)
        {
            this.img.releasePointerCapture(this.captured_pointer_id);
            this.captured_pointer_id = null;
        }
        else if(document.releaseCapture)
            document.releaseCapture();
        
        document.body.classList.remove("hide-ui");
        
        this.event_target.style.cursor = "";
        this.zoomed = false;
        this.reposition();
        
        if(!this.dragged_while_zoomed && this.clicked_without_scrolling)
            this.clicked_without_scrolling();
    }

    mousemove(e)
    {
        if(!this.zoomed)
            return;

        this.dragged_while_zoomed = true;

        // Apply mouse dragging.
        var x_offset = e.movementX;
        var y_offset = e.movementY;
       
        // zoom_pos is normalized to 0-1.  Scale movement by the dimensions of the
        // image.
        var width = this.width;
        var height = this.height;
        this.zoom_pos[0] += x_offset * -3 * this._effective_width / width;
        this.zoom_pos[1] += y_offset * -3 * this._effective_height / height;

        this.reposition();
    }

    // Return true if zooming is active.
    get zoom_active()
    {
        return this.zoomed || this._locked_zoom;
    }

    get _image_to_screen_ratio()
    {
        var screen_width = this.img.parentNode.offsetWidth;
        var screen_height = this.img.parentNode.offsetHeight;

        // In case we're hidden and have no width, make sure we don't return an invalid value.
        if(screen_width == 0 || screen_height == 0)
            return 1;

        return Math.min(screen_width/this.width, screen_height/this.height);
    }
    
    get _effective_width()
    {
        return this.width * this._image_to_screen_ratio;
    }
    get _effective_height()
    {
        return this.height * this._image_to_screen_ratio;
    }

    reposition()
    {
        // Stop if we're being called after being disabled.
        if(this.img.parentNode == null)
            return;

        var screen_width = this.img.parentNode.offsetWidth;
        var screen_height = this.img.parentNode.offsetHeight;
        var width = this._effective_width;
        var height = this._effective_height;

        // If the dimensions are empty then we aren't loaded.  Stop now, so the math
        // below doesn't break.
        if(width == 0 || height == 0 || this.img.parentNode.offsetWidth == 0 || this.img.parentNode.offsetHeight == 0)
            return;

        // Normally (when unzoomed), the image is centered.
        var left = (screen_width - width) / 2;
        var top = (screen_height - height) / 2;

        if(this.zoom_active) {
            // Shift by the zoom position.
            left += this.zoom_pos[0];
            top += this.zoom_pos[1];

            // Apply the zoom.
            var zoom_level = this._effective_zoom_level;
            height *= zoom_level;
            width *= zoom_level;

            if(this._zoom_levels[this._zoom_level] == null)
            {
                // When we're zooming to fill the screen, clamp panning to the screen, so we always fill the
                // screen and don't pan past the edge.  If we're narrower than the screen, lock to center.
                var orig_top = top, orig_left = left;
                if(screen_height < height)
                    top  = helpers.clamp(top, -(height - screen_height), 0); // clamp to the top and bottom
                else
                    top  = -(height - screen_height) / 2; // center vertically
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
        this.img.style.left = left + "px";
        this.img.style.top = top + "px";
        this.img.style.right = "auto";
        this.img.style.bottom = "auto";
    }
}

