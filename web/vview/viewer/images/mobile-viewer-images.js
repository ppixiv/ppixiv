import ViewerImages from 'vview/viewer/images/viewer-images.js';
import TouchScroller from 'vview/viewer/images/mobile-touch-scroller.js';
import { FixedDOMRect } from 'vview/misc/helpers.js';

// This subclass implements our touchscreen pan/zoom UI.
export default class ViewerImagesMobile extends ViewerImages
{
    constructor({...options})
    {
        super(options);

        this.container.addEventListener("pointerdown", (e) => {
            if(this._slideshowMode || !this._animations_running)
                return;

            // Taps during panning animations stop the animation.  Mark them as partially
            // handled, so they don't also trigger IsolatedTapHandler and open the menu.
            // Do this here instead of in onactive below, so this happens even if the touch
            // isn't long enough to activate TouchScroller.
            e.partially_handled = true;
        });
    
        this.touch_scroller = new TouchScroller({
            ...this._signal,
            container: this.container,

            onactive: () => {
                // Stop pan animations if the touch scroller becomes active.
                if(!this._slideshowMode)
                    this._stop_animation();
            },

            // Return the current position in client coordinates.
            get_position: () => {
                // We're about to start touch dragging, so stop any running pan.  Don't stop slideshows.
                if(!this._slideshowMode)
                    this._stop_animation();

                let x = this._center_pos[0] * this.current_width;
                let y = this._center_pos[1] * this.current_height;

                // Convert from view coordinates to screen coordinates.
                [x,y] = this.view_to_client_coords([x,y]);

                return { x, y };
            },

            // Set the current position in client coordinates.
            set_position: ({x, y}) =>
            {
                if(this._slideshowMode)
                    return;

                this._stop_animation();

                [x,y] = this.client_to_view_coords([x,y]);

                x /= this.current_width;
                y /= this.current_height;

                this._center_pos[0] = x;
                this._center_pos[1] = y;
                this._reposition();
            },

            // Zoom by the given factor, centered around the given client position.
            adjust_zoom: ({ratio, centerX, centerY}) =>
            {
                if(this._slideshowMode)
                    return;

                this._stop_animation();

                let [viewX,viewY] = this.client_to_view_coords([centerX,centerY]);

                // Store the position of the anchor before zooming, so we can restore it below.
                let center = this.get_image_position([viewX, viewY]);

                // Apply the new zoom.  Snap to 0 if we're very close, since it won't reach it exactly.
                let new_factor = this._zoom_factor_current * ratio;

                let new_level = this.zoom_factor_to_zoom_level(new_factor);
                if(Math.abs(new_level) < 0.005)
                    new_level = 0;
                this._zoom_level = new_level;

                // Restore the center position.
                this.set_image_position([viewX, viewY], center);

                this._reposition();
            },

            onanimationfinished: () => {
                // We could do this to save the current zoom level, since we didn't use it during the
                // fling, but for now we don't save the zoom level on mobile anyway.
                // this.set_zoom_level(this._zoom_level);
            },

            // Return the bounding box of where we want the position to stay.
            get_bounds: () =>
            {
                // Get the position that the image would normally be snapped to if it was in the
                // far top-left or bottom-right.
                let top_left = this.get_current_actual_position({zoom_pos: [0,0]}).zoom_pos;
                let bottom_right = this.get_current_actual_position({zoom_pos: [1,1]}).zoom_pos;

                // If move_to_target is true, we're animating for a double-tap zoom and we want to
                // center on this.target_zoom_center.  Adjust the target position so the image is still
                // clamped to the edge of the screen, and use that as both corners, so it's the only
                // place we can go.
                if(this.move_to_target)
                {
                    top_left = this.get_current_actual_position({zoom_pos: this.target_zoom_center}).zoom_pos;
                    bottom_right = [...top_left]; // copy
                }

                // Scale to view coordinates.
                top_left[0] *= this.current_width;
                top_left[1] *= this.current_height;
                bottom_right[0] *= this.current_width;
                bottom_right[1] *= this.current_height;

                // Convert to client coords.
                top_left = this.view_to_client_coords(top_left);
                bottom_right = this.view_to_client_coords(bottom_right);

                return new FixedDOMRect(top_left[0], top_left[1], bottom_right[0], bottom_right[1]);
            },

            // When a fling starts (this includes releasing drags, even without a fling), decide
            // on the zoom factor we want to bounce to.
            onanimationstart: ({target_factor=null, target_image_pos=null, move_to_target=false}={}) =>
            {
                this.move_to_target = move_to_target;

                // If we were given an explicit zoom factor to zoom to, use it.  This happens
                // if we start the zoom in toggle_zoom.
                if(target_factor != null)
                {
                    this.target_zoom_factor = target_factor;
                    this.target_zoom_center = target_image_pos;
                    return;
                }

                // Zoom relative to the center of the image.
                this.target_zoom_center = [0.5, 0.5];

                // If we're smaller than contain, always zoom up to contain.  Also snap to contain
                // if we're slightly over, so we don't zoom to cover if cover and contain are nearby
                // and we're very close to contain.  Don't give this much of a threshold, since it's
                // always easy to zoom to contain (just zoom out a bunch).
                //
                // Snap to cover if we're close to it.
                //
                // Otherwise, zoom to current, which is a no-op and will leave the zoom alone.
                let zoom_factor_cover = this._zoom_factor_cover;
                let zoom_factor_current = this._zoom_factor_current;
                if(this._zoom_factor_current < this._zoom_factor_contain + 0.01)
                    this.target_zoom_factor = this._zoom_factor_contain;
                else if(Math.abs(zoom_factor_cover - zoom_factor_current) < 0.15)
                    this.target_zoom_factor = this._zoom_factor_cover;
                else
                    this.target_zoom_factor = this._zoom_factor_current;
            },

            onanimationfinished: () =>
            {
                // If we enabled moving towards a target position, disable it when the animation finishes.
                this.move_to_target = false;
            },

            // We don't want to zoom under zoom factor 1x.  Return the zoom ratio needed to bring
            // the current zoom factor back up to 1x.  For example, if the zoom factor is currently
            // 0.5, return 2.
            get_wanted_zoom: () =>
            {
                // this.target_zoom_center is in image coordinates.  Return screen coordinates.
                let [viewX, viewY] = this.get_view_pos_from_image_pos(this.target_zoom_center);
                let [centerX, centerY] = this.view_to_client_coords([viewX, viewY]);

                // ratio is the ratio we want to be applied relative to to the current zoom.
                return {
                    ratio: this.target_zoom_factor / this._zoom_factor_current,
                    centerX,
                    centerY,
                };
            },
        });
    }

    toggle_zoom(e)
    {
        if(this._slideshowMode)
            return;

        // Stop any animation first, so we adjust the zoom relative to the level we finalize
        // the animation to.
        this._stop_animation();

        // Make sure touch_scroller isn't animating.
        this.touch_scroller.cancel_fling();

        // Toggle between fit (zoom level 0) and cover.  If cover and fit are close together,
        // zoom to a higher factor instead of cover.  This way we zoom to cover when it makes
        // sense, since it's a nicer zoom level to pan around in, but we use a higher level
        // if cover isn't enough of a zoom.  First, figure out the zoom level we'll use if
        // we zoom in.
        let zoom_in_level;
        let zoom_out_level = 0;
        let cover_zoom_ratio = 1 / this.zoom_level_to_zoom_factor(0);
        if(cover_zoom_ratio > 1.5)
            zoom_in_level = this._zoom_level_cover;
        else
        {
            let scaled_zoom_factor = this._zoom_factor_cover*2;
            let scaled_zoom_level = this.zoom_factor_to_zoom_level(scaled_zoom_factor);
            zoom_in_level = scaled_zoom_level;
        }

        // Zoom to whichever one is further away from the current zoom.
        let current_zoom_level = this.get_zoom_level();
        let zoom_distance_in = Math.abs(current_zoom_level - zoom_in_level);
        let zoom_distance_out = Math.abs(current_zoom_level - zoom_out_level);

        let level = zoom_distance_in > zoom_distance_out? zoom_in_level:zoom_out_level;
        let target_factor = this.zoom_level_to_zoom_factor(level);

        // Our "screen" positions are relative to our container and not actually the
        // screen, but mouse events are relative to the screen.
        let view_pos = this.client_to_view_coords([e.clientX, e.clientY]);
        let target_image_pos = this.get_image_position(view_pos);

        this.touch_scroller.start_fling({
            onanimationstart_options: {
                target_factor,
                target_image_pos,

                // Set move_to_target so we'll center on this position too.
                move_to_target: true,
            }
        });
    }

    _reposition({clamp_position=true, ...options}={})
    {
        // Don't clamp the view position if we're repositioned while the touch scroller
        // is active.  It handles overscroll and is allowed to go out of bounds.
        if(this.touch_scroller.state != "idle")
            clamp_position = false;

        return super._reposition({clamp_position, ...options});
    }

    // The mobile UI is always in locked zoom mode.
    getLockedZoom() { return true; }
    set_locked_zoom(enable) { }
}
