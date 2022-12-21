// Mobile panning, fling and pinch zooming.

import DragHandler from 'vview/misc/drag-handler.js';
import FlingVelocity from 'vview/util/fling-velocity.js';
import { helpers } from 'vview/misc/helpers.js';

const FlingFriction = 7;
const FlingMinimumVelocity = 10;

export default class TouchScroller
{
    constructor({
        // The container to watch for pointer events on:
        container,

        // set_position({x, y})
        set_position,

        // { x, y } = get_position()
        get_position,

        // Zoom in or out by ratio, centered around the given position.
        adjust_zoom,

        // Return a FixedDOMRect for the bounds of the image.  The position we set can overscroll
        // out of this rect, but we'll bounce back in.  This can change over time, such as due to
        // the zoom level changing.
        get_bounds,

        // If the current zoom is outside the range the viewer wants, return the ratio from the
        // current zoom to the wanted zoom.  This is applied along with rubber banding.
        get_wanted_zoom,

        // Callbacks:
        onactive = () => { },                  oninactive = () => { },
        ondragstart = () => { },               ondragend = () => { },
        onanimationstart = () => { },          onanimationfinished = () => { },

        // An AbortSignal to shut down.
        signal,
    })
    {
        this.container = container;
        this.shutdown_signal = signal;
        this.options = {
            get_position,
            set_position,
            get_bounds,
            get_wanted_zoom,
            adjust_zoom,

            onactive,              oninactive,
            ondragstart,           ondragend,
            onanimationstart,      onanimationfinished,
        };

        this.velocity = {x: 0, y: 0};
        this.fling_velocity = new FlingVelocity();

        // This is null if we're inactive, "dragging" if the user is dragging, or "animating" if we're
        // flinging and rebounding.
        this._state = "idle";

        // Cancel any running fling if we're shut down while a fling is active.
        signal.addEventListener("abort", (e) => this.cancel_fling(), { once: true });

        this.dragger = new DragHandler({
            name: "TouchScroller",
            element: container,
            pinch: true,
            defer_delay_ms: 30,
            signal,

            confirm_drag: ({event}) => !helpers.should_ignore_horizontal_drag(event),
            ondragstart: (...args) => this._ondragstart(...args),
            ondrag: (...args) => this._ondrag(...args),
            ondragend: (...args) => this._ondragend(...args),
        });
    }

    get state() { return this._state; }

    // Cancel any drag immediately without starting a fling.
    cancel_drag()
    {
        if(this._state != "dragging")
            return;

        this.dragger.cancel_drag();
        this._set_state("idle");
    }

    // Set the current state: "idle", "dragging" or "animating", running the
    // appropriate callbacks.
    _set_state(state, args={})
    {
        if(state == this._state)
            return;

        // Transition back to active, ending whichever state we were in before.
        if(state != "idle"      && this._change_state("idle", "active")) this.options.onactive(args);
        if(state != "dragging"  && this._change_state("dragging", "active")) this.options.ondragend(args);
        if(state != "animating" && this._change_state("animating", "active")) this.options.onanimationfinished(args);

        // Transition into the new state, beginning the new state.
        if(state == "dragging"  && this._change_state("active", "dragging")) this.options.ondragstart(args);
        if(state == "animating" && this._change_state("active", "animating")) this.options.onanimationstart(args);
        if(state == "idle"      && this._change_state("active", "idle")) this.options.oninactive(args);
    }
    
    _change_state(old_state, new_state)
    {
        if(this._state != old_state)
            return false;

        // console.warn(`state change: ${old_state} -> ${new_state}`);
        this._state = new_state;

        // Don't call onstatechange for active, since it's just a transition between
        // other states.
        // if(new_state != "active")
        //    this.onstatechange();

        return true;
    }

    _ondragstart()
    {
        // If we were flinging, the user grabbed the fling and interrupted it.
        if(this._state == "animating")
            this.cancel_fling();

        this._set_state("dragging");

        // Kill any velocity when a drag starts.
        this.fling_velocity.reset();

        // If the image fits onscreen on one or the other axis, don't allow panning on
        // that axis.  This is the same as how our mouse panning works.  However, only
        // enable this at the start of a drag: if axes are unlocked at the start, don't
        // lock them as a result of pinch zooming.  Otherwise we'll start locking axes
        // in the middle of dragging due to zooms.
        let { width, height } = this.options.get_bounds();
        this.drag_axes_locked = [width < 0.001, height < 0.001];
        return true;
    }

    _ondrag({
        first,
        movementX, movementY,
        x, y,
        radius, previous_radius,
    })
    {
        if(this._state != "dragging")
            return;

        // Ignore the first pointer movement.
        if(first)
            return;

        // We're overscrolling if we're out of bounds on either axis, so apply drag to
        // the pan.
        let position = this.options.get_position();

        let bounds = this.options.get_bounds();
        let overscrollX = Math.max(bounds.left - position.x, position.x - bounds.right);
        let overscrollY = Math.max(bounds.top - position.y, position.y - bounds.bottom);
        if(overscrollX > 0) movementX *= Math.pow(this.overscroll_strength, overscrollX);
        if(overscrollY > 0) movementY *= Math.pow(this.overscroll_strength, overscrollY);

        // If movement is locked on either axis, zero it.
        if(this.drag_axes_locked[0])
            movementX = 0;
        if(this.drag_axes_locked[1])
            movementY = 0;

        // Apply the pan.
        this.options.set_position({ x: position.x - movementX, y: position.y - movementY});

        // Store this motion sample, so we can estimate fling velocity later.  This should be
        // affected by axis locking above.
        this.fling_velocity.add_sample({ x: -movementX, y: -movementY });

        // If we zoomed in and now have room to move on an axis that was locked before,
        // unlock it.  We won't lock it again until a new drag is started.
        if(bounds.width >= 0.001)
            this.drag_axes_locked[0] = false;
        if(bounds.height >= 0.001)
            this.drag_axes_locked[1] = false;

        // The zoom for this frame is the ratio of the change of the average distance from the
        // anchor, centered around the average touch position.
        if(previous_radius > 0)
        {
            let ratio = radius / previous_radius;
            this.options.adjust_zoom({ratio, centerX: x, centerY: y});
        }
    }

    _ondragend(e)
    {
        // The last touch was released.  If we were dragging, start flinging or rubber banding.
        if(this._state == "dragging")
            this.start_fling();
    }

    get overscroll_strength() { return 0.994; }

    // Switch from dragging to flinging.
    //
    // This can be called by the user to force a fling to begin, allowing this to be used
    // for smooth bouncing.  onanimationstart_options will be passed to onanimationstart
    // for convenience.
    start_fling({onanimationstart_options={}}={})
    {
        // We shouldn't already be flinging when this is called.
        if(this._state == "animating")
        {
            console.warn("Already animating");
            return;
        }

        // Don't start a fling if a drag is active.  this._state can be "dragging" if the drag
        // just ended and we're transitioning into "animating", but don't do this if we're called
        // while a drag is still active.  This happens the user double-clicks to zoom the image
        // while still dragging;
        if(this.dragger.is_dragging)
        {
            // console.log("Ignoring start_fling because a drag is still active");
            return;
        }

        // Set the initial velocity to the average recent speed of all touches.
        this.velocity = this.fling_velocity.current_velocity;

        this._set_state("animating", onanimationstart_options);

        console.assert(this.abort_fling == null);
        this.abort_fling = new AbortController();
        this._run_fling(this.abort_fling.signal);
    }

    // Handle a fling asynchronously.  Stop when the fling ends or signal is aborted.
    async _run_fling(signal)
    {
        let previous_time = Date.now() / 1000;
        while(this._state == "animating")
        {
            let success = await helpers.vsync({ signal });
            if(!success)
                return;

            let new_time = Date.now() / 1000;
            let duration = new_time - previous_time;
            previous_time = new_time;

            let movementX = this.velocity.x * duration;
            let movementY = this.velocity.y * duration;

            // Apply the velocity to the current position.
            let current_position = this.options.get_position();
            current_position.x += movementX;
            current_position.y += movementY;

            // Decay our velocity.
            let decay = Math.exp(-FlingFriction * duration);
            this.velocity.x *= decay;
            this.velocity.y *= decay;

            // If we're out of bounds, accelerate towards being in-bounds.  This simply moves us
            // towards being in-bounds based on how far we are from it, which gives the effect
            // of acceleration.
            let bounced = this.apply_position_bounce(duration, current_position);
            if(this.apply_zoom_bounce(duration))
                bounced = true;

            // Stop if our velocity has decayed and we're not rebounding.
            let total_velocity = Math.pow(Math.pow(this.velocity.x, 2) + Math.pow(this.velocity.y, 2), 0.5);
            if(!bounced && total_velocity < FlingMinimumVelocity)
                break;
        }

        // We've reached (near) zero velocity.  Clamp the velocity to 0.
        this.velocity = { x: 0, y: 0 };

        this.abort_fling = null;
        this._set_state("idle");
    }

    apply_zoom_bounce(duration)
    {
        // See if we want to bounce the zoom.  This is used to scale the viewer back up to
        // 1x if the image is zoomed lower than that.
        let { ratio, centerX, centerY } = this.options.get_wanted_zoom();
        if(Math.abs(1-ratio) < 0.001)
            return false;

        // While we're figuring out the speed, invert ratios less than 1 (zooming down) so
        // the ratios are linear.
        let inverted = ratio < 1;
        if(inverted)
            ratio = 1/ratio;

        // The speed we'll actually apply the zoom ratio.  If this is 2, we'll adjust the ratio
        // by 2x per second (or .5x when zooming down).  Scale this based on how far we have to
        // zoom, so zoom bounce decelerates similarly to position bounce.  Clamp the ratio we'll
        // apply based on the duration of this frame.
        let zoom_ratio_per_second = Math.pow(ratio, 10);
        let max_ratio_this_frame = Math.pow(zoom_ratio_per_second, duration);
        ratio = Math.min(ratio, max_ratio_this_frame);

        if(inverted)
            ratio = 1/ratio;

        // Zoom centered on the position bounds, which is normally the center of the image.
        this.options.adjust_zoom({ratio, centerX, centerY});

        return true;
    }

    // If we're out of bounds, push the position towards being in bounds.  Return true if
    // we were out of bounds.
    apply_position_bounce(duration, position)
    {
        let bounds = this.options.get_bounds();

        let factor = 0.025;

        // Bounce right:
        if(position.x < bounds.left)
        {
            let bounce_velocity = bounds.left - position.x;
            bounce_velocity *= factor;
            position.x += bounce_velocity * duration * 300;

            if(position.x >= bounds.left - 1)
                position.x = bounds.left;
        }

        // Bounce left:
        if(position.x > bounds.right)
        {
            let bounce_velocity = bounds.right - position.x;
            bounce_velocity *= factor;
            position.x += bounce_velocity * duration * 300;

            if(position.x <= bounds.right + 1)
                position.x = bounds.right;
        }

        // Bounce down:
        if(position.y < bounds.top)
        {
            let bounce_velocity = bounds.top - position.y;
            bounce_velocity *= factor;
            position.y += bounce_velocity * duration * 300;

            if(position.y >= bounds.top - 1)
                position.y = bounds.top;
        }

        // Bounce up:
        if(position.y > bounds.bottom)
        {
            let bounce_velocity = bounds.bottom - position.y;
            bounce_velocity *= factor;
            position.y += bounce_velocity * duration * 300;

            if(position.y <= bounds.bottom + 1)
                position.y = bounds.bottom;
        }

        this.options.set_position(position);

        // Return true if we're still out of bounds.
        return position.x < bounds.left ||
               position.y < bounds.top ||
               position.x > bounds.right ||
               position.y > bounds.bottom;
    }

    cancel_fling()
    {
        if(this._state != "animating")
            return;

        if(this.abort_fling)
        {
            this.abort_fling.abort();
            this.abort_fling = null;
        }

        this._set_state("idle");
    }
}
