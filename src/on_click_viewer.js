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

        this._zoom_levels = [null, 2, 4, 8];

        // The caller can set this to a function to be called if the user clicks the image without
        // dragging.
        this.clicked_without_scrolling = null;

        this.width = 1;
        this.height = 1;

        this.img = img;
        this.img.style.width = "auto";
        this.img.style.height = "100%";

        this.enable();

        this.zoom_center = [0.5, 0];
        this.zoom_pos = [0,0];
        this._zoom_level = helpers.get_value("zoom-level", 1);
        console.log("set zoom level", this._zoom_level);

        // Restore the most recent zoom mode.  We assume that there's only one of these on screen.
        this.locked_zoom = helpers.get_value("zoom-mode") != "normal";
    }

    image_changed()
    {
        // In locked zoom, reset the zoom center to the top-center when the image changes.
        if(this._locked_zoom)
        {
            this.zoom_center = [0.5, 0];
            this.reposition();
        }

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

        if(this._locked_zoom)
            this.zoom_pos = [0,0];
        
        this.reposition();
    }

    // Set the zoom factor for lock zoom mode.  At 1x, the image is scaled to fill the screen
    // in both dimensions.
    get locked_zoom_factor()
    {
        return this._zoom_level;
    }

    set locked_zoom_factor(value)
    {
        this._zoom_level = value;
        this.reposition();
    }

    get zoom_level()
    {
        return this._zoom_level;
    }
    
    // Increase or decrease the zoom level.  This won't select zoom 0 (screen fill),
    // and if we're in zoom level 0 it'll always move to 1.
    set zoom_level(value)
    {
        if(this._zoom_level == value)
            return;
        this._zoom_level = helpers.clamp(value, 0, this._zoom_levels.length - 1);

        // Save the new zoom level.
        console.log("store", this._zoom_level);
        helpers.set_value("zoom-level", this._zoom_level);
        
        this.reposition();
    }
    /*
    change_zoom_level(up)
    {
        this._zoom_level += up? 1:-1;
        this._zoom_level = helpers.clamp(this._zoom_level, 1, this._zoom_levels.length - 1);
        this.reposition();
    }

    set_fill_zoom_level()
    {
        this._zoom_level = 0;
        this.reposition();
    }
    */

    // Return the zoom level, or null if we're filling the screen.
    get _selected_zoom_level()
    {
        return this._zoom_levels[this._zoom_level];
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

        this.zoomed = true;
        this.dragged_while_zoomed = false;

        if(this.using_pointer_events)
        {
            this.captured_pointer_id = e.pointerId;
            this.img.setPointerCapture(this.captured_pointer_id);
        }
        else if(this.event_target.setCapture)
            this.event_target.setCapture(true);

        // Clicking with sticky zoom just enables dragging.  It doesn't affect the
        // actual zoom.
        if(!this._locked_zoom)
        {
            // Set the zoom position to the top-left.
            this.set_zoom_center(e.clientX, e.clientY);
            this.zoom_pos = [0,0];
        }

        this.reposition();

        // Only listen to mousemove while we're dragging.
        this.event_target.addEventListener(this.using_pointer_events? "pointermove":"mousemove", this.mousemove);
    }

    // Set the center point of the zoom based on a click position.
    //
    // This is only used externally in locked zoom mode, to position the zoom after activating
    // it.  It's only used internally when unlocked.
    //
    // This must be called *before* setting locked_zoom, since we need to look at the image
    // size and setting locked_zoom will zoom the image.
    set_zoom_center(x, y)
    {
        // The size of the image being clicked:
        var img_rect = this.img.getBoundingClientRect();
        var displayed_width = img_rect.right - img_rect.left;
        var displayed_height = img_rect.bottom - img_rect.top;

        // The offset of the click in pixels relative to the image:
        var distance_from_img = [x - img_rect.left, y - img_rect.top];

        // The normalized position clicked in the image (0-1).
        // This adjusts the initial position, so the position clicked stays stationary.
        this.zoom_center = [distance_from_img[0] / displayed_width, distance_from_img[1] / displayed_height];

        this.reposition();
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
        
        this.zoom_pos[0] += x_offset * -3;
        this.zoom_pos[1] += y_offset * -3;

        this.reposition();
    }

    reposition()
    {
        // Stop if we're being called after being disabled.
        if(this.img.parentNode == null)
            return;

        var screen_width = this.img.parentNode.offsetWidth;
        var screen_height = this.img.parentNode.offsetHeight;
        var width = this.width;
        var height = this.height;

        // The ratio to scale the image to fit the screen:
        var zoom_ratio = Math.min(screen_width/width, screen_height/height);
        this.zoom_ratio = zoom_ratio;

        height *= this.zoom_ratio;
        width *= this.zoom_ratio;

        // Normally (when unzoomed), the image is centered.
        var left = Math.round((screen_width - width) / 2);
        var top = Math.round((screen_height - height) / 2);
        var zoomed = this.zoomed || this._locked_zoom;
        if(zoomed) {
            // A zoom level of null fills the image to the screen.
            var zoom_level = this._selected_zoom_level;
            if(zoom_level == null)
                zoom_level = Math.max(screen_width/width, screen_height/height);

            // left is the position of the left side of the image.  We're going to scale around zoom_center,
            // so shift by zoom_center in the unzoomed coordinate space.  If zoom_center[0] is .5, shift
            // the image left by half of its unzoomed width.
            left += this.zoom_center[0] * width;
            top += this.zoom_center[1] * height;

            // Apply the zoom.
            this.zoom_ratio *= zoom_level;
            height *= zoom_level;
            width *= zoom_level;

            // Undo zoom centering in the new coordinate space.
            left -= this.zoom_center[0] * width;
            top -= this.zoom_center[1] * height;
            
            // Apply the position.
            left += this.zoom_pos[0];
            top += this.zoom_pos[1];

            if(this._selected_zoom_level == null)
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
        this.img.style.width = width + "px";
        this.img.style.height = height + "px";
        this.img.style.position = "absolute";
        this.img.style.left = left + "px";
        this.img.style.top = top + "px";
        this.img.style.right = "auto";
        this.img.style.bottom = "auto";
    }
}

