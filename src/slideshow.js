// This handles the nitty slideshow logic for on_click_viewer.
ppixiv.slideshow = class
{
    constructor({
        // The size of the image being displayed:
        width, height,

        // The size of the window:
        container_width, container_height,

        // The minimum zoom level to allow:
        minimum_zoom,

        // If true, we're being used for slideshow mode, otherwise auto-pan mode.
        slideshow_enabled,
    })
    {
        this.width = width;
        this.height = height;
        this.container_width = container_width;
        this.container_height = container_height;
        this.minimum_zoom = minimum_zoom;
        this.slideshow_enabled = slideshow_enabled;
    }

    // Return some parameters that are used by linear animation getters below.
    _get_parameters()
    {
        // The target duration of the animation:
        let pan_duration = this.slideshow_enabled?
            ppixiv.settings.get("slideshow_duration"):
            ppixiv.settings.get("auto_pan_duration");

        let ease;
        if(this.slideshow_enabled)
        {
            // In slideshow mode, we always fade through black, so we don't need any easing on the
            // transition.
            ease = "linear";
        }
        else
        {
            // There's no fading in auto-pan mode.  Use an ease-out transition, so we start
            // quickly and decelerate at the end.  We're jumping from another image anyway
            // so an ease-in doesn't seem needed.
            //
            // A standard ease-out is (0, 0, 0.58, 1).  We can change the strength of the effect
            // by changing the third value, becoming completely linear when it reaches 1.  Reduce
            // the ease-out effect as the duration gets longer, since longer animations don't need
            // the ease-out as much (they're already slow), so we have more even motion.
            let factor = helpers.scale_clamp(pan_duration, 5, 15, 0.58, 1);
            ease = `cubic-bezier(0.0, 0.0, ${factor}, 1.0)`;
        }

        // Max speed sets how fast the image is allowed to move.  If it's 0.5, the image shouldn't
        // scroll more half a screen per second, and the duration will be increased if needed to slow
        // it down.  This keeps the animation from being too fast for very tall and wide images.
        //
        // Scale the max speed based on the duration.  With a 5-second duration, allow the image
        // to move half a screen per second.  With a 15-second duration, slow it down to no more
        // than a quarter screen per second.
        let max_speed = helpers.scale(pan_duration, 5, 15, 0.5, 0.25);
        max_speed = helpers.clamp(max_speed, 0.25, 0.5);

        return { ease, pan_duration, max_speed };
    }

    // Create the default animation.
    get_default_animation()
    {
        let animation = this.get_default_pan();
        animation = this.prepare_animation(animation);

        // If the animation didn't go anywhere, the visible area's aspect ratio very closely
        // matches the screen's, so there's nowhere to pan.  Use a pull-in animation instead.
        // We don't currently use this in pan mode, because zooming the image when in pan mode
        // and controlling multiple tabs can be annoying.
        if(animation.total_travel > 0.05 || !this.slideshow_enabled)
            return animation;

        console.log(`Slideshow: pan animation had nowhere to move, using a pull-in instead (total_travel ${animation.total_travel})`);
        return this.prepare_animation(this.get_pull_in());
    }

    // Load a saved animation created with PanEditor.
    get_animation_from_pan(pan)
    {
        let { ease, pan_duration, max_speed } = this._get_parameters();
        let animation;
        if(this.slideshow_enabled)
        {
            animation = {
                // XXX: short fade-in doesn't work with faster slideshows
                fade_in: 2.5,
                fade_out: .5,
    
                pan: [{
                    x: pan.x1, y: pan.y1, zoom: pan.start_zoom ?? 1,
                    anchor_x: pan.anchor?.left ?? 0.5,
                    anchor_y: pan.anchor?.top ?? 0.5,
                    max_speed: true,
                    speed: max_speed,
                    duration: pan_duration,
                    ease,
                }, {
                    // This half-second delay partially overlaps the fade.
                    x: pan.x2, y: pan.y2, zoom: pan.end_zoom ?? 1,
                    anchor_x: pan.anchor?.right ?? 0.5,
                    anchor_y: pan.anchor?.bottom ?? 0.5,
                }],
            };
        }
        else
        {
            animation = {
                pan: [{
                    x: pan.x1, y: pan.y1, zoom: pan.start_zoom ?? 1,
                    anchor_x: pan.anchor?.left ?? 0.5,
                    anchor_y: pan.anchor?.top ?? 0.5,
                    max_speed: true,
                    speed: max_speed,
                    duration: pan_duration,
                    ease,
                }, {
                    x: pan.x2, y: pan.y2, zoom: pan.end_zoom ?? 2,
                    anchor_x: pan.anchor?.right ?? 0.5,
                    anchor_y: pan.anchor?.bottom ?? 0.5,
                    duration: 2,
                }],
            };
        }
        
        return this.prepare_animation(animation);
    }

    // This is like the thumbnail animation, which gives a reasonable default for both landscape
    // and portrait animations.
    get_default_pan()
    {
        let { ease, pan_duration, max_speed } = this._get_parameters();
        if(this.slideshow_enabled)
        {
            // In slideshow mode, both pan and fade.
            return {
                fade_in: 1,
                fade_out: 1,
    
                pan: [{
                    // This half-second delay partially overlaps the fade.
                    x: 0, y: 0, zoom: 1,
                    duration: 0.5,
                }, {
                    x: 0, y: 0, zoom: 1,
                    max_speed: true,
                    speed: max_speed,
                    duration: pan_duration,
                    ease,
                }, {
                    // This half-second delay partially overlaps the fade.
                    x: 1, y: 1, zoom: 1,
                    duration: 1.0,
                }, {
                    x: 1, y: 1, zoom: 1,
                }],
            };
        }
        else
        {
            // In auto-pan mode, just pan without fading the image out at the end.
            return {
                pan: [{
                    x: 0, y: 0, zoom: 1,
                    max_speed: true,
                    speed: max_speed,
                    duration: pan_duration,
                    ease,
                }, {
                    x: 1, y: 1, zoom: 1,
                    duration: 2,
                }],
            };
        }
    }

    // Return a basic pull-in animation.
    get_pull_in()
    {
        let { pan_duration, ease } = this._get_parameters();

        // Only fade in slideshow, not auto-pan.
        const fade_time = this.slideshow_enabled? 1:0;

        // This zooms from "contain" to a slight zoom over "cover".
        return {
            fade_in: fade_time,
            fade_out: fade_time,

            pan: [{
                x: 0.5, y: 0.0, zoom: 0,
                duration: pan_duration,
                ease,
            }, {
                x: 0.5, y: 0.0, zoom: 1.2,
            }],
        };
    }

    // Prepare an animation.  This figures out the actual translate and scale for each
    // keyframe, and the total duration.  The results depend on the image and window
    // size.
    prepare_animation(animation)
    {
        // Make a deep copy before modifying it.
        animation = JSON.parse(JSON.stringify(animation));

        let screen_width = this.container_width;
        let screen_height = this.container_height;

        animation.default_width = this.width;
        animation.default_height = this.height;

        // Don't let the zoom go below the original 1:1 size.  This allows panning to 1:1
        // by setting zoom to 0.  There's no inherent max zoom.
        let minimum_zoom = this.minimum_zoom;
        let maximum_zoom = 999;

        // Calculate the scale and translate for each point.
        for(let point of animation.pan)
        {
            let zoom = helpers.clamp(point.zoom, minimum_zoom, maximum_zoom);

            // The screen size the image will have:
            let zoomed_width = animation.default_width * zoom;
            let zoomed_height = animation.default_height * zoom;

            // The top-left and bottom-right corners we're allowed to display of the image.
            // By default, clamp to the edge of the image.  These are in screen space coordinates.
            let min_x = 0, min_y = 0;
            let max_x = zoomed_width - screen_width, max_y = zoomed_height - screen_height;

            // Initially, the image will be aligned to the top-left of the screen.  Shift right and
            // down to align the anchor the origin.  This is usually the center of the image.
            let { anchor_x=0.5, anchor_y=0.5 } = point;
            let move_x = screen_width * anchor_x;
            let move_y = screen_height * anchor_y;

            // Then shift up and left to center the point:
            move_x -= point.x*zoomed_width;
            move_y -= point.y*zoomed_height;

            // Clamp to the minimum and maximum translation.
            // move_x and move_y are negative to move the image up and left.  Clamp this so it never
            // moves right/down, and doesn't move the bottom-right corner of the image past the edge
            // of the screen.
            move_x = Math.max(-max_x, Math.min(move_x, -min_x));
            move_y = Math.max(-max_y, Math.min(move_y, -min_y));
    
            // If the image isn't filling the screen on either axis, center it.  This only applies at
            // keyframes (we won't always be centered while animating).
            if(zoomed_width < screen_width)
                move_x = (screen_width - zoomed_width) / 2;
            if(zoomed_height < screen_height)
                move_y = (screen_height - zoomed_height) / 2;

            point.computed_zoom = zoom;
            point.computed_tx = move_x;
            point.computed_ty = move_y;
        }

        // Calculate the duration for keyframes that specify a speed.
        //
        // If max_speed is true, speed is a cap.  We'll move at the specified duration or
        // the duration based on speed, whichever is longer.
        for(let idx = 0; idx < animation.pan.length - 1; ++idx)
        {
            let p0 = animation.pan[idx+0];
            let p1 = animation.pan[idx+1];
            if(p0.speed == null)
                continue;

            // speed is relative to the screen size, so it's not tied too tightly to the resolution
            // of the window.  The "size" of the window depends on which way we're moving: if we're moving
            // horizontally we only care about the horizontal size, and if we're moving diagonally, weight
            // the two.  This way, the speed is relative to the screen size in the direction we're moving.
            // If it's 0.5 and we're only moving horizontally, we'll move half a screen width per second.
            let distance_x = Math.abs(p0.computed_tx - p1.computed_tx);
            let distance_y = Math.abs(p0.computed_ty - p1.computed_ty);
            if(distance_x == 0 && distance_y == 0)
            {
                // We're not moving at all.  If the animation is based on speed, just set a small duration
                // to avoid division by zero.
                p0.actual_speed = 0;                    
                if(p0.duration == null)
                    p0.duration = 0.1;
                continue;
            }

            let distance_ratio = distance_y / (distance_x + distance_y); // 0 = horizontal only, 1 = vertical only
            let screen_size = (screen_height * distance_ratio) + (screen_width * (1-distance_ratio));

            // The screen distance we're moving:
            let distance_in_pixels = helpers.distance([p0.computed_tx, p0.computed_ty], [p1.computed_tx, p1.computed_ty]);

            // pixels_per_second is the speed we'll move at the given speed.  Note that this ignores
            // easing, and we'll actually move faster or slower than this during the transition.
            let speed = Math.max(p0.speed, 0.01);
            let pixels_per_second = speed * screen_size;
            let duration = distance_in_pixels / pixels_per_second;
            if(p0.max_speed)
                p0.duration = Math.max(p0.duration, duration);
            else
                p0.duration = duration;

            // Reverse it to get the actual speed we ended up with.
            let actual_pixels_per_second = distance_in_pixels / p0.duration;
            p0.actual_speed =  actual_pixels_per_second / screen_size;
        }

        // Calculate the total duration.  The last point doesn't have a duration.
        let total_time = 0;
        for(let point of animation.pan.slice(0, animation.pan.length-1))
            total_time += point.duration;
        animation.total_time = Math.max(total_time, 0.01);

        // For convenience, calculate total distance the animation travelled.
        animation.total_travel = 0;
        for(let point of animation.pan)
        {
            if(point.actual_speed == null)
                continue;

            animation.total_travel += point.actual_speed * point.duration;
        }

        return animation;        
    }
}
