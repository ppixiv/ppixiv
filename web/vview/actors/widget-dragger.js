import PropertyAnimation from 'vview/actors/property-animation.js';
import Bezier2D from 'vview/util/bezier.js';
import FlingVelocity from 'vview/util/fling-velocity.js';
import DragHandler from 'vview/misc/drag-handler.js';
import ClickOutsideListener from 'vview/widgets/click-outside-listener.js';
import Actor from 'vview/actors/actor.js';
import { helpers } from 'vview/misc/helpers.js';

// A simpler interface for allowing a widget to be dragged open or closed.
export default class WidgetDragger extends Actor
{
    constructor({
        name="widget-dragger", // for diagnostics

        // The node that will be animated by the drag.
        nodes,

        // The node to listen for drags on:
        dragNode,

        // The drag distance the drag that corresponds to a full transition from closed to
        // open.  This can be a number, or a function that returns a number.
        size,

        animatedProperty=null,
        animatedPropertyInverted=false,

        // If set, this is an array of nodes inside the dragger, and clicks outside of this
        // list while visible will cause the dragger to hide.
        closeIfOutside=null,

        // This is called before a drag starts.  If false is returned, the drag will be ignored.
        confirmDrag = () => true,

        // Callbacks
        //
        // onactive
        //     ondragstart <-> ondragend                    User dragging started or stopped
        //     onanimationstart <-> onanimationfinished     Animation such as a fling started or stopped
        //     onbeforeshown <-> onafterhidden              Visibility changed
        // oninactive
        onactive = () => { },                  oninactive = () => { },
        ondragstart = () => { },               ondragend = () => { },
        onanimationstart = () => { },          onanimationfinished = () => { },
        onbeforeshown = () => { },             onafterhidden = () => { },
        
        // This is called if we were cancelled by another dragger starting first.
        oncancelled,

        // This is called on any state change (the value of this.state has changed).
        onstatechange = () => { },

        // Whether the widget is initially visible.
        visible=false,

        // The drag direction that will open the widget: up, down, left or right.
        direction="down",

        // Animation properties.  These are the same for all animated nodes.
        duration=150,

        startOffset=0,
        endOffset=1,

        ...options
    }={})
    {
        super(options);

        this._visible = visible;
        this.nodes = nodes;
        this.onactive = onactive;                      this.oninactive = oninactive;
        this.ondragstart = ondragstart;                this.ondragend = ondragend;
        this.onanimationstart = onanimationstart;      this.onanimationfinished = onanimationfinished;
        this.onbeforeshown = onbeforeshown;            this.onafterhidden = onafterhidden;
        this.onstatechange = onstatechange;
        this.confirmDrag = confirmDrag;
        this.animatedProperty = animatedProperty;
        this.animatedPropertyInverted = animatedPropertyInverted;
        this.closeIfOutside = closeIfOutside;
        this.duration = duration;
        this.startOffset = startOffset;
        this.endOffset = endOffset;
        this._state = "idle";
        this._runningNonInterruptibleAnimation = false;

        if(!(this.duration instanceof Function))
            this.duration = () => duration;

        if(direction != "up" && direction != "down" && direction != "left" && direction != "right")
            throw new Error(`Invalid drag direction: ${direction}`);

        let vertical = direction == "up" || direction == "down";
        let reversed = direction == "left" || direction == "up";

        // Create the velocity tracker used to detect flings.
        this._recentPointerMovement = new FlingVelocity({ samplePeriod: 0.150 });

        // Create the velocity tracker for the speed the animated property is changing.
        this._recentValueMovement = new FlingVelocity({ samplePeriod: 0.150 });

        let propertyStart = animatedPropertyInverted? 1:0;
        let propertyEnd = animatedPropertyInverted? 0:1;

        // Create the animation.
        this._dragAnimation = new PropertyAnimation({
            parent: this,
            node: this.nodes,
            property: this.animatedProperty,
            propertyStart,
            propertyEnd,

            startOffset: this.startOffset,
            endOffset: this.endOffset,
    
            onanimationfinished: (anim) => {
                // Update visibility if the animation we finished put us at 0.
                if(anim.position < 0.00001)
                    this._setVisible(false);

                // If a drag was left active during the animation, cancel it before returning to idle.
                this.dragger.cancelDrag();

                // When an animation finishes normally, we're no longer doing anything, so
                // go back to inactive.
                this._setState("idle");
            },

            onchange: ({value, oldValue}) => {
                if(oldValue == null)
                    return;

                let delta = Math.abs(value - oldValue);
                this._recentValueMovement.addSample({ x: delta });
            },
        });

        this._dragAnimation.position = visible? 1:0;

        this.dragger = new DragHandler({
            parent: this,
            name,
            element: dragNode,
            oncancelled,

            ondragstart: ({event}) => {
                // If this is a horizontal dragger, see if we should ignore this drag because
                // it might trigger iOS navigation.
                if(!vertical && helpers.shouldIgnoreHorizontalDrag(event))
                    return false;

                // Only accept this drag if the axis of the drag matches ours.
                let dragIsVertical = Math.abs(event.movementY) > Math.abs(event.movementX);
                if(vertical != dragIsVertical)
                    return false;

                let movement = vertical? event.movementY:event.movementX;
                if(reversed)
                    movement *= -1;

                // If the drag has nowhere to go in this direction, don't accept it, so other draggers
                // see it instead.
                let towardsShown = movement > 0;
                if(towardsShown && this.position == 1)
                    return false;
                if(!towardsShown && this.position == 0)
                    return false;

                if(this._runningNonInterruptibleAnimation)
                {
                    console.log("Not dragging because a non-interruptible animation is in progress");
                    return false;
                }

                if(!this.confirmDrag({event}))
                    return false;

                // Stop any running animation.
                this._dragAnimation.stop();

                this._recentPointerMovement.reset();

                this._setState("dragging");

                // A drag is starting.  Send onbeforeshown if we weren't visible, since we
                // might be about to make the widget visible.
                this._setVisible(true);

                // Remember the position we started at.  This is only used so we can return to it if
                // the drag is cancelled.
                this._dragStartedAt = this.position;

                return true;
            },

            ondrag: ({event, first}) => {
                if(this._runningNonInterruptibleAnimation)
                {
                    console.log("Not dragging because a non-interruptible animation is in progress");
                    return false;
                }

                // If we're animating, show() or hide() was called during a drag.  This doesn't stop
                // the drag, but we're in the animating state while this happens.  Since we saw another
                // drag movement, cancel the animation and return to dragging.
                if(this._state == "animating")
                {
                    console.log("animation interrupted by drag");
                    this._dragAnimation.stop();
                    this._setState("dragging");
                }

                if(this._state != "dragging")
                    this._logStateChanges(`Expected dragging, in ${this._state}`);

                // Drags should always be in the dragging state, and won't change state.
                console.assert(this._state == "dragging", this._state);

                this._recentPointerMovement.addSample({ x: event.movementX, y: event.movementY });

                // The first movement is thresholded by the browser, and counts towards fling velocity
                // but doesn't actually move the widget.
                if(first)
                    return;

                // If show() or hide() was called during a fling and the user dragged again, we're interrupting
                // the animation to continue the drag, so stop the drag.
                this._dragAnimation.stop();

                let pos = this._dragAnimation.position;
                let movement = vertical? event.movementY:event.movementX;
                if(reversed)
                    movement *= -1;

                let actualSize = size;
                if(actualSize instanceof Function)
                    actualSize = actualSize();

                pos += movement / actualSize;
                pos = helpers.math.clamp(pos, this.startOffset, this.endOffset);
                this._dragAnimation.position = pos;
            },

            // When a drag ends, we'll always call either show() or hide(), which will either start
            // an animation or put us in the inactive state.
            ondragend: ({cancel}) => {
                // If the drag was cancelled, return to the open or close state we were in at the
                // start.  This is mostly important for ScreenIllustDragToExit, so a drag up on iOS
                // that triggers system navigation and cancels our drag undoes any small drag instead
                // of triggering an exit.
                if(cancel)
                {
                    if(this._dragStartedAt > 0.5)
                        this.show();
                    else
                        this.hide();
                    return;
                }

                // See if there was a fling.
                let { velocity } = this._recentPointerMovement.getMovementInDirection(direction);

                let threshold = 150;
                if(velocity > threshold)
                    return this.show({ velocity });
                else if(velocity < -threshold)
                    return this.hide({ velocity: -velocity });

                // If there hasn't been a fling recently, open or close based on how far open we are.
                let open = this._dragAnimation.position > 0.5;
                if(open)
                    this.show({ velocity });
                else
                    this.hide({ velocity: -velocity });
            },
        });
    }

    // Return the dragger state: "idle", "dragging" or "animating".  This can also be
    // "active" while we're transitioning between states.
    get state() { return this._state; }

    get visible()
    {
        return this._visible;
    }

    get position()
    {
        return this._dragAnimation.position;
    }

    _setVisible(value)
    {
        if(this._visible == value)
            return;

        this._visible = value;
        if(this._visible)
            this.onbeforeshown();
        else
            this.onafterhidden();

        if(this.closeIfOutside)
        {
            // Create or destroy the ClickOutsideListener.
            if(this._visible && this._clickedOutsideListener == null)
            {
                this._clickedOutsideListener = new ClickOutsideListener(this.closeIfOutside, () => this.hide());
            }
            else if(!this._visible && this._clickedOutsideListener != null)
            {
                this._clickedOutsideListener.shutdown();
                this._clickedOutsideListener = null;
            }
        }
    }

    // Animate to the fully shown state.  If given, velocity is the drag speed that caused this.
    //
    // If a drag is in progress, it'll continue, and cancel the animation if it moves again.  The
    // drag will be cancelled if the animation completes.
    //
    // If transition is false, jump to the new state without animating.
    //
    // If interruptible is true, this animation can be stopped by the user dragging it.  If false,
    // drags will be ignored and the animation will always complete.
    show({ easing=null, transition=true, interruptible=true }={})
    {
        this._animateTo({endPosition: 1, easing, transition, interruptible});
    }

    // Animate to the completely hidden state.  If given, velocity is the drag speed that caused this.
    hide({ easing=null, transition=true, interruptible=true }={})
    {
        this._animateTo({endPosition: 0, easing, transition, interruptible});
    }

    _animateTo({ endPosition, easing=null, transition=true, interruptible=true }={})
    {
        if(this._runningNonInterruptibleAnimation)
        {
            console.log("Not running animation because a non-interruptible one is already in progress");
            return;
        }

        // If we don't want a transition, stop any animation and just jump to this position.
        if(!transition)
        {
            this._dragAnimation.stop();
            this._dragAnimation.position = endPosition;
            this._setVisible(endPosition > 0);
            this._setState("idle");
            return;
        }

        // Stop if we're already in this state.
        if(this._state == "idle" && this._dragAnimation.position == endPosition)
            return;
    
        // Remember if the animation is interruptible.
        this._runningNonInterruptibleAnimation = !interruptible;

        // If we're already animating towards this position, just let it continue.
        if(this._state == "animating" && this._dragAnimation.animatingTowards == endPosition)
            return;

        // If we're animating to a visible state, mark ourselves visible.
        if(endPosition > 0)
            this._setVisible(true);

        let duration = this.duration();

        // If no easing was specified, create an easing curve to match the current velocity
        // of the animated property.
        if(easing == null)
        {
            let propertyVelocity = this._recentValueMovement.currentVelocity.x;
            let propertyStart = this._dragAnimation.currentPropertyValue;
            let propertyEnd = this._dragAnimation.propertyValueForPosition(endPosition);
            // console.log("->", propertyStart, propertyEnd, propertyVelocity);

            easing = Bezier2D.findCurveForVelocity({
                distance: Math.abs(propertyEnd - propertyStart),
                duration,
                targetVelocity: Math.abs(propertyVelocity),
            }).curve;
        }

        let promise = this._animationPromise = this._dragAnimation.play({endPosition, easing, duration});
        this._animationPromise.then(() => {
            if(promise == this._animationPromise)
            {
                this._animationPromise = null;
                this._runningNonInterruptibleAnimation = false;
            }
        });

        // Call this after starting the animation, so isAnimationPlaying and isAnimatingToShown
        // reflect the animation when onanimationstart is called.
        this._setState("animating");
    }

    _recordStateChange(from, to)
    {
        // if(Actor.debugShutdown && !this._previousShutdownStack)
        // XXX
        {
            this._stateStacks ??= [];
            try {
                throw new Error();
            } catch(e) {
                this._stateStacks.push([from, to, e.stack]);
                let max = 10;
                if(this._stateStacks.length > max)
                    this._stateStacks.splice(this._stateStacks.length - max);
            }
        }
    }
    
    _logStateChanges(message)
    {
        if(!this._stateStacks)
            return;

        console.error("Error:", message);
        for(let [from, to, stack] of this._stateStacks)
        {
            console.log(`From ${from} to ${to}, stack:`);
            console.log(stack);
        }
    }

    // Set the current state: "idle", "dragging" or "animating", running the
    // appropriate callbacks.
    _setState(state, ...args)
    {
        if(state == this._state)
            return;

        // Transition back to active, ending whichever state we were in before.
        if(state != "idle"      && this._changeState("idle", "active")) this.onactive(...args);
        if(state != "dragging"  && this._changeState("dragging", "active")) this.ondragend(...args);
        if(state != "animating" && this._changeState("animating", "active")) this.onanimationfinished(...args);

        // Transition into the new state, beginning the new state.
        if(state == "dragging"  && this._changeState("active", "dragging")) this.ondragstart(...args);
        if(state == "animating" && this._changeState("active", "animating")) this.onanimationstart(...args);
        if(state == "idle"      && this._changeState("active", "idle")) this.oninactive(...args);
    }

    _changeState(oldState, newState)
    {
        if(this._state != oldState)
            return false;

        this._recordStateChange(this._state, newState);

        // console.warn(`state change: ${oldState} -> ${newState}`);
        this._state = newState;

        // Don't call onstatechange for active, since it's just a transition between
        // other states.
        if(newState != "active")
            this.onstatechange();

        return true;
    }

    toggle()
    {
        if(this.visible)
            this.hide();
        else
            this.show();
    }

    // Return true if an animation (not a drag) is currently running.
    get isAnimationPlaying()
    {
        return this._state == "animating";
    }

    // Return true if the current animation is towards being shown (show() was called),
    // or false if the current animation is towards being hidden (hide() was called).
    // If no animation is running, return false.
    get isAnimatingToShown()
    {
        if(this._state != "animating")
            return false;

        return this._dragAnimation.animatingTowards == 1;
    }
    
    // Return a promise that resolves when the current animation completes, or null if no animation
    // is running.
    get finished()
    {
        return this._animationPromise;
    }
}
