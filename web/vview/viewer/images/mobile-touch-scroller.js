// Mobile panning, fling and pinch zooming.

import DragHandler from 'vview/misc/drag-handler.js';
import FlingVelocity from 'vview/util/fling-velocity.js';
import Actor from 'vview/actors/actor.js';
import { helpers } from 'vview/misc/helpers.js';

const FlingFriction = 7;
const FlingMinimumVelocity = 10;

export default class TouchScroller extends Actor
{
    constructor({
        // The container to watch for pointer events on:
        container,

        // setPosition({x, y})
        setPosition,

        // { x, y } = getPosition()
        getPosition,

        // Zoom in or out by ratio, centered around the given position.
        adjustZoom,

        // Return a FixedDOMRect for the bounds of the image.  The position we set can overscroll
        // out of this rect, but we'll bounce back in.  This can change over time, such as due to
        // the zoom level changing.
        getBounds,

        // If the current zoom is outside the range the viewer wants, return the ratio from the
        // current zoom to the wanted zoom.  This is applied along with rubber banding.
        getWantedZoom,

        // Callbacks:
        onactive = () => { },                  oninactive = () => { },
        ondragstart = () => { },               ondragend = () => { },
        onanimationstart = () => { },          onanimationfinished = () => { },

        ...options
    })
    {
        super(options);

        this.root = container;
        this.options = {
            getPosition,
            setPosition,
            getBounds,
            getWantedZoom,
            adjustZoom,

            onactive,              oninactive,
            ondragstart,           ondragend,
            onanimationstart,      onanimationfinished,
        };

        this.velocity = {x: 0, y: 0};
        this._flingVelocity = new FlingVelocity();

        // This is null if we're inactive, "dragging" if the user is dragging, or "animating" if we're
        // flinging and rebounding.
        this._state = "idle";

        // Cancel any running fling if we're shut down while a fling is active.
        this.shutdownSignal.addEventListener("abort", (e) => this.cancelFling(), { once: true });

        this.dragger = new DragHandler({
            parent: this,
            name: "TouchScroller",
            element: container,
            pinch: true,
            deferDelayMs: 30,

            confirmDrag: ({event}) => !helpers.shouldIgnoreHorizontalDrag(event),
            ondragstart: (...args) => this._ondragstart(...args),
            ondrag: (...args) => this._ondrag(...args),
            ondragend: (...args) => this._ondragend(...args),
        });
    }

    get state() { return this._state; }

    // Cancel any drag immediately without starting a fling.
    cancelDrag()
    {
        if(this._state != "dragging")
            return;

        this.dragger.cancelDrag();
        this._setState("idle");
    }

    // Set the current state: "idle", "dragging" or "animating", running the
    // appropriate callbacks.
    _setState(state, args={})
    {
        if(state == this._state)
            return;

        // Transition back to active, ending whichever state we were in before.
        if(state != "idle"      && this._changeState("idle", "active")) this.options.onactive(args);
        if(state != "dragging"  && this._changeState("dragging", "active")) this.options.ondragend(args);
        if(state != "animating" && this._changeState("animating", "active")) this.options.onanimationfinished(args);

        // Transition into the new state, beginning the new state.
        if(state == "dragging"  && this._changeState("active", "dragging")) this.options.ondragstart(args);
        if(state == "animating" && this._changeState("active", "animating")) this.options.onanimationstart(args);
        if(state == "idle"      && this._changeState("active", "idle")) this.options.oninactive(args);
    }
    
    _changeState(oldState, newState)
    {
        if(this._state != oldState)
            return false;

        // console.warn(`state change: ${oldState} -> ${newState}`);
        this._state = newState;

        // Don't call onstatechange for active, since it's just a transition between
        // other states.
        // if(newState != "active")
        //    this.onstatechange();

        return true;
    }

    _ondragstart()
    {
        // If we were flinging, the user grabbed the fling and interrupted it.
        if(this._state == "animating")
            this.cancelFling();

        this._setState("dragging");

        // Kill any velocity when a drag starts.
        this._flingVelocity.reset();

        // If the image fits onscreen on one or the other axis, don't allow panning on
        // that axis.  This is the same as how our mouse panning works.  However, only
        // enable this at the start of a drag: if axes are unlocked at the start, don't
        // lock them as a result of pinch zooming.  Otherwise we'll start locking axes
        // in the middle of dragging due to zooms.
        let { width, height } = this.options.getBounds();
        this.dragAxesLocked = [width < 0.001, height < 0.001];
        return true;
    }

    _ondrag({
        first,
        movementX, movementY,
        x, y,
        radius, previousRadius,
    })
    {
        if(this._state != "dragging")
            return;

        // Ignore the first pointer movement.
        if(first)
            return;

        // We're overscrolling if we're out of bounds on either axis, so apply drag to
        // the pan.
        let position = this.options.getPosition();

        let bounds = this.options.getBounds();
        let overscrollX = Math.max(bounds.left - position.x, position.x - bounds.right);
        let overscrollY = Math.max(bounds.top - position.y, position.y - bounds.bottom);
        if(overscrollX > 0) movementX *= Math.pow(this.overscrollStrength, overscrollX);
        if(overscrollY > 0) movementY *= Math.pow(this.overscrollStrength, overscrollY);

        // If movement is locked on either axis, zero it.
        if(this.dragAxesLocked[0])
            movementX = 0;
        if(this.dragAxesLocked[1])
            movementY = 0;

        // Apply the pan.
        this.options.setPosition({ x: position.x - movementX, y: position.y - movementY});

        // Store this motion sample, so we can estimate fling velocity later.  This should be
        // affected by axis locking above.
        this._flingVelocity.addSample({ x: -movementX, y: -movementY });

        // If we zoomed in and now have room to move on an axis that was locked before,
        // unlock it.  We won't lock it again until a new drag is started.
        if(bounds.width >= 0.001)
            this.dragAxesLocked[0] = false;
        if(bounds.height >= 0.001)
            this.dragAxesLocked[1] = false;

        // The zoom for this frame is the ratio of the change of the average distance from the
        // anchor, centered around the average touch position.
        if(previousRadius > 0)
        {
            let ratio = radius / previousRadius;
            this.options.adjustZoom({ratio, centerX: x, centerY: y});
        }
    }

    _ondragend(e)
    {
        // The last touch was released.  If we were dragging, start flinging or rubber banding.
        if(this._state == "dragging")
            this.startFling();
    }

    get overscrollStrength() { return 0.994; }

    // Switch from dragging to flinging.
    //
    // This can be called by the user to force a fling to begin, allowing this to be used
    // for smooth bouncing.  onanimationstartOptions will be passed to onanimationstart
    // for convenience.
    startFling({onanimationstartOptions={}}={})
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
            // console.log("Ignoring startFling because a drag is still active");
            return;
        }

        // Set the initial velocity to the average recent speed of all touches.
        this.velocity = this._flingVelocity.currentVelocity;

        this._setState("animating", onanimationstartOptions);

        console.assert(this._abortFling == null);
        this._abortFling = new AbortController();
        this._runFling(this._abortFling.signal);
    }

    // Handle a fling asynchronously.  Stop when the fling ends or signal is aborted.
    async _runFling(signal)
    {
        let previousTime = Date.now() / 1000;
        while(this._state == "animating")
        {
            let success = await helpers.other.vsync({ signal });
            if(!success)
                return;

            let newTime = Date.now() / 1000;
            let duration = newTime - previousTime;
            previousTime = newTime;

            let movementX = this.velocity.x * duration;
            let movementY = this.velocity.y * duration;

            // Apply the velocity to the current position.
            let currentPosition = this.options.getPosition();
            currentPosition.x += movementX;
            currentPosition.y += movementY;

            // Decay our velocity.
            let decay = Math.exp(-FlingFriction * duration);
            this.velocity.x *= decay;
            this.velocity.y *= decay;

            // If we're out of bounds, accelerate towards being in-bounds.  This simply moves us
            // towards being in-bounds based on how far we are from it, which gives the effect
            // of acceleration.
            let bounced = this.applyPositionBounce(duration, currentPosition);
            if(this._applyZoomBounce(duration))
                bounced = true;

            // Stop if our velocity has decayed and we're not rebounding.
            let totalVelocity = Math.pow(Math.pow(this.velocity.x, 2) + Math.pow(this.velocity.y, 2), 0.5);
            if(!bounced && totalVelocity < FlingMinimumVelocity)
                break;
        }

        // We've reached (near) zero velocity.  Clamp the velocity to 0.
        this.velocity = { x: 0, y: 0 };

        this._abortFling = null;
        this._setState("idle");
    }

    _applyZoomBounce(duration)
    {
        // See if we want to bounce the zoom.  This is used to scale the viewer back up to
        // 1x if the image is zoomed lower than that.
        let { ratio, centerX, centerY } = this.options.getWantedZoom();
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
        let zoomRatioPerSecond = Math.pow(ratio, 10);
        let maxRatioThisFrame = Math.pow(zoomRatioPerSecond, duration);
        ratio = Math.min(ratio, maxRatioThisFrame);

        if(inverted)
            ratio = 1/ratio;

        // Zoom centered on the position bounds, which is normally the center of the image.
        this.options.adjustZoom({ratio, centerX, centerY});

        return true;
    }

    // If we're out of bounds, push the position towards being in bounds.  Return true if
    // we were out of bounds.
    applyPositionBounce(duration, position)
    {
        let bounds = this.options.getBounds();

        let factor = 0.025;

        // Bounce right:
        if(position.x < bounds.left)
        {
            let bounceVelocity = bounds.left - position.x;
            bounceVelocity *= factor;
            position.x += bounceVelocity * duration * 300;

            if(position.x >= bounds.left - 1)
                position.x = bounds.left;
        }

        // Bounce left:
        if(position.x > bounds.right)
        {
            let bounceVelocity = bounds.right - position.x;
            bounceVelocity *= factor;
            position.x += bounceVelocity * duration * 300;

            if(position.x <= bounds.right + 1)
                position.x = bounds.right;
        }

        // Bounce down:
        if(position.y < bounds.top)
        {
            let bounceVelocity = bounds.top - position.y;
            bounceVelocity *= factor;
            position.y += bounceVelocity * duration * 300;

            if(position.y >= bounds.top - 1)
                position.y = bounds.top;
        }

        // Bounce up:
        if(position.y > bounds.bottom)
        {
            let bounceVelocity = bounds.bottom - position.y;
            bounceVelocity *= factor;
            position.y += bounceVelocity * duration * 300;

            if(position.y <= bounds.bottom + 1)
                position.y = bounds.bottom;
        }

        this.options.setPosition(position);

        // Return true if we're still out of bounds.
        return position.x < bounds.left ||
               position.y < bounds.top ||
               position.x > bounds.right ||
               position.y > bounds.bottom;
    }

    cancelFling()
    {
        if(this._state != "animating")
            return;

        if(this._abortFling)
        {
            this._abortFling.abort();
            this._abortFling = null;
        }

        this._setState("idle");
    }
}
