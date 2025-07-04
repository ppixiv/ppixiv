// Basic low-level dragging.
//
// This currently handles simple single-touch drags.  It doesn't handle multitouch, so it's not
// used by TouchScroller.
import Actor from '/vview/actors/actor.js';
import TouchListener from '/vview/actors/touch-listener.js';
import { helpers } from '/vview/misc/helpers.js';
import { DRAG_THRESHOLD } from '/vview/misc/constants.js';

export default class DragHandler extends Actor
{
    constructor({
        name="unnamed", // for diagnostics
        element,
        signal,

        // Called on the initial press before starting the drag.  If set, returns true if the drag
        // should begin or false if it should be ignored.
        confirmDrag=({event}) => true,

        // This is called if we were cancelled after confirmDrag by another dragger starting first.
        oncancelled,

        // Called if a click is confirmed with confirmDrag but released or cancelled without actually
        // starting a drag.  This is useful as an alternative to onclick, since click events are still
        // sent after drags end.
        onReleasedWithoutDrag=({interactive, cancel}) => true,

        // Called when the drag starts, which is the first pointer movement after confirmDrag.
        // If false is returned, the drag is cancelled.  If this happens when deferredStart is true,
        // the drag won't be started and won't interrupt other drags.
        //
        // If the drag is starting due to deferDelayMs, event is null because it's not starting
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
        deferredStart=() => true,

        // If we're deferring the start of the drag, this is the minimum delay we need to see before
        // pointer movements.  We'll ignore the drag if we see movement before this, and start the
        // drag as soon as this period elapses.
        deferDelayMs=null,

        ...options
    }={})
    {
        super(options);

        this.name = name;
        this.element = element;
        this.pointers = new Map();
        this.confirmDrag = confirmDrag;
        this.onReleasedWithoutDrag = onReleasedWithoutDrag;
        this.oncancelled = oncancelled;
        this.ondragstart = ondragstart;
        this.ondrag = ondrag;
        this.ondragend = ondragend;
        this.pinch = pinch;
        this.deferredStart = deferredStart;
        this.deferDelayMs = deferDelayMs;

        this._dragStarted = false;
        this._dragDelayTimer = null;
        this._totalMovement = [0, 0];

        signal ??= (new AbortController().signal);

        this._touchListener = new TouchListener({
            parent: this,
            element,
            multi: true,
            callback: this._pointerevent,
        });

        signal.addEventListener("abort", () => this.cancelDrag());
    }

    shutdown()
    {
        RunningDrags.remove(this);
        super.shutdown();
    }

    _pointerevent = (e) =>
    {
        // Ignore presses while another dragger is active.
        if(RunningDrags.activeDrag && RunningDrags.activeDrag != this)
            return;

        if(e.pressed)
        {
            if(this.pointers.size == 0)
            {
                if(!this.confirmDrag({event: e}))
                    return;
            }

            this._startDragging(e);
        } else {
            if(!this.pointers.has(e.pointerId))
                return;

            this.pointers.delete(e.pointerId);

            // If this was the last pointer, end the drag.
            if(this.pointers.size == 0)
                this._stopDragging({ interactive: true, cancel: e.type == "pointercancel" });
        }
    }

    async _startDragging(event)
    {
        this.pointers.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,

            // Pointer movements are thresholded: we don't get pointer movements until the
            // touch has moved some minimum amount, and all movement until then will be
            // bundled into the first pointermove event.  Ignore that first event, since it
            // makes drags look jerky.
            ignoreNextPointermove: true,
        });

        if(this.pinch && this._dragDelayTimer != null && this.pointers.size > 1)
        {
            // We were in deferDelayMs and a second tap started.  Cancel the delay and
            // start immediately for pinch zooming.
            // console.log("Starting deferred drag due to multitouch");
            realClearTimeout(this._dragDelayTimer);
            this._dragDelayTimer = null;
            this._commitStartDragging({event: null});
        }

        if(this.pointers.size > 1)
            return;

        window.addEventListener("pointermove", this._pointermove, this._signal);
        this._dragStarted = false;
        this._totalMovement = [0, 0];

        RunningDrags.add(this, ({otherDragger}) => {
            this.cancelDrag();
            if(this.oncancelled)
                this.oncancelled({otherDragger});
        });

        // Ask the caller if we want to defer the start of the drag until the first pointer
        // movement.  If we don't, start it now, otherwise we'll start it in pointermove later.
        if(!this.deferredStart())
            this._commitStartDragging({event});
        else if(this.deferDelayMs != null)
        {
            // We're deferring the drag.  Start a timer to stop deferring after a timeout.
            this._dragDelayTimer = realSetTimeout(() => {
                this._dragDelayTimer = null;
                
                this._commitStartDragging({event: null});
            }, this.deferDelayMs);
        }
    }

    // Actually start the drag.  This may happen immediately on pointerdown or on the first pointermove.
    // event is a PointerEvent, but may be either pointerdown or pointermove.
    async _commitStartDragging({event})
    {
        if(this._dragStarted)
            return;

        if(!this.ondragstart({event}))
        {
            this._stopDragging();
            return;
        }

        this._dragStarted = true;
        RunningDrags.cancelOtherDrags(this);
    }

    // Return true if a drag is active.
    get isDragging() { return this._dragStarted; }

    // If a drag is active, cancel it.
    cancelDrag()
    {
        this._stopDragging({interactive: false});
    }

    // Stop any active or potential drag.
    // 
    // interactive is true if this is the user releasing it, or false if we're shutting
    // down during a drag.  cancel is true if this is due to a pointercancel event.
    _stopDragging({interactive=false, cancel=false}={})
    {
        this.pointers.clear();

        window.removeEventListener("pointermove", this._pointermove);

        RunningDrags.remove(this);

        if(this._dragDelayTimer != null)
        {
            realClearTimeout(this._dragDelayTimer);
            this._dragDelayTimer = null;
        }
        
        // Only send ondragend if we sent ondragstart.
        if(this._dragStarted)
        {
            this._dragStarted = false;
            if(this.ondragend)
                this.ondragend({interactive, cancel});
        }
        else
            this.onReleasedWithoutDrag({interactive, cancel});
    }

    _pointermove = (event) =>
    {
        let pointerInfo = this.pointers.get(event.pointerId);
        if(pointerInfo == null)
            return;

        // iOS thresholds movement, but browsers on Android don't, so we need to do it ourselves.
        this._totalMovement[0] += event.movementX;
        this._totalMovement[1] += event.movementY;
        if(ppixiv.android)
        {
            // Ignore movement until we accumulate the movement threshold.
            let totalDistance = Math.sqrt(this._totalMovement[0] * this._totalMovement[0] + this._totalMovement[1] * this._totalMovement[1]);
            if(totalDistance < DRAG_THRESHOLD)
                return;
        }

        if(this.deferDelayMs != null && this._dragDelayTimer != null)
        {
            // We saw a pointer movement during the drag delay.  Ignore this drag.
            this.cancelDrag();
            return;
        }
        
        // Call ondragstart the first time we see pointer movement after we begin the drag.  This
        // is when the drag actually starts.  We don't do movement thresholding here since iOS already
        // does it (whether we want it to or not).
        this._commitStartDragging({event});
    
        // Only handle this as a drag input if we've started treating this as a drag.
        if(!this._dragStarted)
            return;

        // When we actually handle pointer movement, let IsolatedTapHandler know that this
        // press was handled by something.  This doesn't actually prevent any default behavior.
        event.preventDefault();

        let info = {
            event,
            first: pointerInfo.ignoreNextPointermove,
        };

        pointerInfo.ignoreNextPointermove = false;

        // In pinch is enabled, add pinch info.
        if(this.pinch)
        {
            // The center position and average distance at the start of the frame:
            let previousCenterPos = this._pointerCenterPos;
            let previousRadius = this._pointerDistanceFrom(previousCenterPos);

            // Update this pointer.  This will update _pointerCenterPos.
            pointerInfo.x = event.clientX;
            pointerInfo.y = event.clientY;

            // The center position and average distance at the end of the frame:
            let { x, y } = this._pointerCenterPos;
            let radius = this._pointerDistanceFrom({ x, y });

            // The average pointer movement across the frame:
            let movementX = x - previousCenterPos.x;
            let movementY = y - previousCenterPos.y;

            info = {
                ...info,

                // The average position and movement of all touches:
                x, y, movementX, movementY,
                radius, previousRadius,
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
                previousRadius: 0,
            }
        }

        this.ondrag(info);
    }

    // Get the average position of all current touches.
    get _pointerCenterPos()
    {
        let centerPos = {x: 0, y: 0};
        for(let {x, y} of this.pointers.values())
        {

            centerPos.x += x;
            centerPos.y += y;
        }
        centerPos.x /= this.pointers.size;
        centerPos.y /= this.pointers.size;
        return centerPos;
    }

    // Return the average distance of all current touches to the given position.
    _pointerDistanceFrom(pos)
    {
        let result = 0;
        for(let {x, y} of this.pointers.values())
            result += helpers.math.distance(pos, {x,y});
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

    // Add an active dragger.  If cancelOtherDrags is called, oncancel() will be called to
    // cancel the drag.
    static add(dragger, oncancel)
    {
        // Sanity check: we should never add new drags to the list while another one is already
        // active.  It's redundant but OK for the active dragger to re-add itself.
        if(this._activeDrag != null && this._activeDrag != dragger)
        {
            console.log("Adding:", dragger);
            console.log("Active:", this._activeDrag);

            throw new Error("Can't add a dragger while one is currently active");
        }

        this.drags.set(dragger, oncancel);
    }
    
    static remove(dragger)
    {
        this.drags.delete(dragger);
        if(dragger == this._activeDrag)
            this._activeDrag = null;

        if(this._activeDrag && this.drags.size == 0)
            console.error("_activeDrag wasn't cleared", dragger);
    }
    
    // A potential dragger is becoming active, so cancel all other draggers.  activeDrag
    // is this dragger until it's removed.
    static cancelOtherDrags(activeDraggers)
    {
        if(this._activeDrag != null)
        {
            console.log("Dragger was active:", this._activeDrag);
            throw new Error("Started a drag while another dragger was already active");
        }

        if(!this.drags.has(activeDraggers))
        {
            console.log("activeDraggers:", activeDraggers);
            throw new Error("Active dragger isn't in the dragger list");
        }

        console.assert(this._activeDrag == null);
        this._activeDrag = activeDraggers;

        for(let [dragger, cancelDrag] of this.drags.entries())
        {
            if(dragger === activeDraggers)
                continue;

            // Tell the dragger which other dragger cancelled it.
            cancelDrag({dragger, otherDragger: activeDraggers});
        }
    }

    // If a dragger is active, return it.
    static get activeDrag()
    {
        return this._activeDrag;
    }
}
