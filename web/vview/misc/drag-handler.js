// Basic low-level dragging.
//
// This currently handles simple single-touch drags.  It doesn't handle multitouch, so it's not
// used by TouchScroller.
import { helpers } from 'vview/misc/helpers.js';
import TouchListener from 'vview/actors/touch-listener.js';

export default class DragHandler
{
    constructor({
        name="unnamed", // for diagnostics
        element,
        signal,

        // Called on the initial press before starting the drag.  If set, returns true if the drag
        // should begin or false if it should be ignored.
        confirm_drag=({event}) => true,

        // This is called if we were cancelled after confirm_drag by another dragger starting first.
        oncancelled,

        // Called when the drag starts, which is the first pointer movement after confirm_drag.
        // If false is returned, the drag is cancelled.  If this happens when deferred_start is true,
        // the drag won't be started and won't interrupt other drags.
        //
        // If the drag is starting due to defer_delay_ms, event is null because it's not starting
        // as the result of a pointer event.
        ondragstart = ({event}) => true,

        // ondrag({event, first})
        // first is true if this is the first pointer movement since this drag started.
        ondrag,

        // Called when the drag is released.
        ondragend,

        // True if the caller is using this dragger for pinch gestures.
        pinch=false,

        // If this returns true (the default), the drag will start on the first pointer movement.
        // If false, the drag will start immediately on pointerdown.
        deferred_start=() => true,

        // If we're deferring the start of the drag, this is the minimum delay we need to see before
        // pointer movements.  We'll ignore the drag if we see movement before this, and start the
        // drag as soon as this period elapses.
        defer_delay_ms=null,
    }={})
    {
        this.name = name;
        this.element = element;
        this.pointers = new Map();
        this.confirm_drag = confirm_drag;
        this.oncancelled = oncancelled;
        this.ondragstart = ondragstart;
        this.ondrag = ondrag;
        this.ondragend = ondragend;
        this.pinch = pinch;
        this.deferred_start = deferred_start;
        this.defer_delay_ms = defer_delay_ms;

        this._drag_started = false;
        this.drag_delay_timer = null;

        signal ??= (new AbortController().signal);

        this._touch_listener = new TouchListener({
            element,
            signal,
            multi: true,
            callback: this._pointerevent,
        });

        signal.addEventListener("abort", () => this.cancel_drag());
    }

    _pointerevent = (e) =>
    {
        // Ignore presses while another dragger is active.
        if(RunningDrags.active_drag && RunningDrags.active_drag != this)
            return;

        if(e.pressed)
        {
            if(this.pointers.size == 0)
            {
                if(!this.confirm_drag({event: e}))
                    return;
            }

            this._start_dragging(e);
        } else {
            if(!this.pointers.has(e.pointerId))
                return;

            this.pointers.delete(e.pointerId);

            // If this was the last pointer, end the drag.
            if(this.pointers.size == 0)
                this._stop_dragging({ interactive: true, cancel: e.type == "pointercancel" });
        }
    }

    async _start_dragging(event)
    {
        this.pointers.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,

            // Pointer movements are thresholded: we don't get pointer movements until the
            // touch has moved some minimum amount, and all movement until then will be
            // bundled into the first pointermove event.  Ignore that first event, since it
            // makes drags look jerky.
            ignore_next_pointermove: true,
        });

        if(this.pinch && this.drag_delay_timer != null && this.pointers.size > 1)
        {
            // We were in _delaying_before_drag and a second tap started.  Cancel the delay and
            // start immediately for pinch zooming.
            // console.log("Starting deferred drag due to multitouch");
            realClearTimeout(this.drag_delay_timer);
            this.drag_delay_timer = null;
            this._commit_start_dragging({event: null});
        }

        if(this.pointers.size > 1)
            return;

        window.addEventListener("pointermove", this._pointermove, this._signal);
        this._drag_started = false;

        RunningDrags.add(this, ({other_dragger}) => {
            this.cancel_drag();
            if(this.oncancelled)
                this.oncancelled({other_dragger});
        });

        // Ask the caller if we want to defer the start of the drag until the first pointer
        // movement.  If we don't, start it now, otherwise we'll start it in pointermove later.
        if(!this.deferred_start())
            this._commit_start_dragging({event});
        else if(this.defer_delay_ms != null)
        {
            // We're deferring the drag.  Start a timer to stop deferring after a timeout.
            this.drag_delay_timer = realSetTimeout(() => {
                this.drag_delay_timer = null;
                
                this._commit_start_dragging({event: null});
            }, this.defer_delay_ms);
        }
    }

    // Actually start the drag.  This may happen immediately on pointerdown or on the first pointermove.
    // event is a PointerEvent, but may be either pointerdown or pointermove.
    async _commit_start_dragging({event})
    {
        if(this._drag_started)
            return;

        if(!this.ondragstart({event}))
        {
            this._stop_dragging();
            return;
        }

        this._drag_started = true;
        RunningDrags.cancel_others(this);
    }

    // Return true if a drag is active.
    get is_dragging() { return this._drag_started; }

    // If a drag is active, cancel it.
    cancel_drag()
    {
        this._stop_dragging({interactive: false});
    }

    // Stop any active or potential drag.
    // 
    // interactive is true if this is the user releasing it, or false if we're shutting
    // down during a drag.  cancel is true if this is due to a pointercancel event.
    _stop_dragging({interactive=false, cancel=false}={})
    {
        this.pointers.clear();

        window.removeEventListener("pointermove", this._pointermove);

        RunningDrags.remove(this);

        if(this.drag_delay_timer != null)
        {
            realClearTimeout(this.drag_delay_timer);
            this.drag_delay_timer = null;
        }
        
        // Only send ondragend if we sent ondragstart.
        if(this._drag_started)
        {
            this._drag_started = false;
            if(this.ondragend)
                this.ondragend({interactive, cancel});
        }
    }

    _pointermove = (event) =>
    {
        let pointer_info = this.pointers.get(event.pointerId);
        if(pointer_info == null)
            return;

        // On iOS, we can do this to allow dragging with a large press without waiting for
        // the delay.  It's disabled for now since it might make the UI confusing.  It probably
        // would work better if we had access to haptics.
        /*
        if(this.defer_delay_ms && this.drag_delay_timer != null && e.width > 50)
        {
            realClearTimeout(this.drag_delay_timer);
            this.drag_delay_timer = null;
            this._commit_start_dragging({event: null});
        }
        */

        if(this.defer_delay_ms != null && this.drag_delay_timer != null)
        {
            // We saw a pointer movement during the drag delay.  Ignore this drag.
            this.cancel_drag();
            return;
        }
        
        // Call ondragstart the first time we see pointer movement after we begin the drag.  This
        // is when the drag actually starts.  We don't do movement thresholding here since iOS already
        // does it (whether we want it to or not).
        this._commit_start_dragging({event});
    
        // Only handle this as a drag input if we've started treating this as a drag.
        if(!this._drag_started)
            return;

        // When we actually handle pointer movement, let IsolatedTapHandler know that this
        // press was handled by something.  This doesn't actually prevent any default behavior.
        event.preventDefault();

        let info = {
            event,
            first: pointer_info.ignore_next_pointermove,
        };

        pointer_info.ignore_next_pointermove = false;

        // In pinch is enabled, add pinch info.
        if(this.pinch)
        {
            // The center position and average distance at the start of the frame:
            let previous_center_pos = this._pointer_center_pos;
            let previous_radius = this._pointer_distance_from(previous_center_pos);

            // Update this pointer.  This will update _pointer_center_pos.
            pointer_info.x = event.clientX;
            pointer_info.y = event.clientY;

            // The center position and average distance at the end of the frame:
            let { x, y } = this._pointer_center_pos;
            let radius = this._pointer_distance_from({ x, y });

            // The average pointer movement across the frame:
            let movementX = x - previous_center_pos.x;
            let movementY = y - previous_center_pos.y;

            info = {
                ...info,

                // The average position and movement of all touches:
                x, y, movementX, movementY,
                radius, previous_radius,
            };
        }
        else
        {
            info = {
                ...info,

                // When not in pinch (multitouch) mode, we only have one touch.  Use its position.
                movementX: event.movementX,
                movementY: event.movementY,
                x: event.clientX,
                y: event.clientY,
                radius: 0,
                previous_radius: 0,
            }
        }

        this.ondrag(info);
    }

    // Get the average position of all current touches.
    get _pointer_center_pos()
    {
        let center_pos = {x: 0, y: 0};
        for(let {x, y} of this.pointers.values())
        {

            center_pos.x += x;
            center_pos.y += y;
        }
        center_pos.x /= this.pointers.size;
        center_pos.y /= this.pointers.size;
        return center_pos;
    }

    // Return the average distance of all current touches to the given position.
    _pointer_distance_from(pos)
    {
        let result = 0;
        for(let {x, y} of this.pointers.values())
            result += helpers.distance(pos, {x,y});
        result /= this.pointers.size;
        return result;
    }    
};

// Sometimes we have multiple DragHandlers which can act on the same touch, depending on
// pointer movement after the touch.  This tracks the active drags, and allows whichever
// drag activates first to cancel the others.
class RunningDrags
{
    static drags = new Map();

    // Add an active dragger.  If cancel_others is called, oncancel() will be called to
    // cancel the drag.
    static add(dragger, oncancel)
    {
        // Sanity check: we should never add new drags to the list while another one is already
        // active.  It's redundant but OK for the active dragger to re-add itself.
        if(this._active_drag != null && this._active_drag != dragger)
        {
            console.log("Adding:", dragger);
            console.log("Active:", this._active_drag);

            throw new Error("Can't add a dragger while one is currently active");
        }

        this.drags.set(dragger, oncancel);
    }
    
    static remove(dragger)
    {
        this.drags.delete(dragger);
        if(dragger == this._active_drag)
            this._active_drag = null;

        if(this._active_drag && this.drags.size == 0)
            console.error("_active_drag wasn't cleared", dragger);
    }
    
    // A potential dragger is becoming active, so cancel all other draggers.  active_drag
    // is this dragger until it's removed.
    static cancel_others(active_dragger)
    {
        if(this._active_drag != null)
        {
            console.log("Dragger was active:", this._active_drag);
            throw new Error("Started a drag while another dragger was already active");
        }

        if(!this.drags.has(active_dragger))
        {
            console.log("active_dragger:", active_dragger);
            throw new Error("Active dragger isn't in the dragger list");
        }

        console.assert(this._active_drag == null);
        this._active_drag = active_dragger;

        for(let [dragger, cancel_drag] of this.drags.entries())
        {
            if(dragger === active_dragger)
                continue;

            // Tell the dragger which other dragger cancelled it.
            cancel_drag({dragger, other_dragger: active_dragger});
        }
    }

    // If a dragger is active, return it.
    static get active_drag()
    {
        return this._active_drag;
    }
}
