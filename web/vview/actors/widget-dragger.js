import PropertyAnimation from 'vview/actors/property-animation.js';
import Bezier2D from 'vview/util/bezier.js';
import FlingVelocity from 'vview/util/fling-velocity.js';
import DragHandler from 'vview/misc/drag-handler.js';
import { helpers } from 'vview/misc/helpers.js';

// A simpler interface for allowing a widget to be dragged open or closed.
export default class WidgetDragger
{
    constructor({
        name="widget-dragger", // for diagnostics

        // The node that will be animated by the drag.
        node,

        // An animation for each node.  If this is a function, it will be called each time a
        // drag starts.
        //
        // If this is null, a default empty animation is used, and only animated_property will
        // be animated.
        animations=null,

        // The node to listen for drags on:
        drag_node,

        // The drag distance the drag that corresponds to a full transition from closed to
        // open.  This can be a number, or a function that returns a number.
        size,

        animated_property=null,
        animated_property_inverted=false,

        // If set, this is an array of nodes inside the dragger, and clicks outside of this
        // list while visible will cause the dragger to hide.
        close_if_outside=null,

        // This is called before a drag starts.  If false is returned, the drag will be ignored.
        confirm_drag = () => true,

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

        start_offset=0,
        end_offset=1,
    }={})
    {
        this._visible = visible;
        this.nodes = node;
        this.onactive = onactive;                      this.oninactive = oninactive;
        this.ondragstart = ondragstart;                this.ondragend = ondragend;
        this.onanimationstart = onanimationstart;      this.onanimationfinished = onanimationfinished;
        this.onbeforeshown = onbeforeshown;            this.onafterhidden = onafterhidden;
        this.onstatechange = onstatechange;
        this.confirm_drag = confirm_drag;
        this.animations = animations;
        this.animated_property = animated_property;
        this.animated_property_inverted = animated_property_inverted;
        this.close_if_outside = close_if_outside;
        this.duration = duration;
        this.start_offset = start_offset;
        this.end_offset = end_offset;
        this._state = "idle";

        if(!(this.duration instanceof Function))
            this.duration = () => duration;

        if(direction != "up" && direction != "down" && direction != "left" && direction != "right")
            throw new Error(`Invalid drag direction: ${direction}`);

        let vertical = direction == "up" || direction == "down";
        let reversed = direction == "left" || direction == "up";

        // Create the velocity tracker used to detect flings.
        this.recent_pointer_movement = new FlingVelocity({ samplePeriod: 0.150 });

        // Create the velocity tracker for the speed the animated property is changing.
        this.recent_value_movement = new FlingVelocity({ samplePeriod: 0.150 });

        let property_start = animated_property_inverted? 1:0;
        let property_end = animated_property_inverted? 0:1;

        // Create the animation.
        this.drag_animation = new PropertyAnimation({
            node: this.nodes,
            property: this.animated_property,
            property_start,
            property_end,

            start_offset: this.start_offset,
            end_offset: this.end_offset,
    
            onanimationfinished: (anim) => {
                // Update visibility if the animation we finished put us at 0.
                if(anim.position < 0.00001)
                    this._set_visible(false);

                // If a drag was left active during the animation, cancel it before returning to idle.
                this.dragger.cancel_drag();

                // When an animation finishes normally, we're no longer doing anything, so
                // go back to inactive.
                this._set_state("idle");
            },

            onchange: ({value, old_value}) => {
                if(old_value == null)
                    return;

                let delta = Math.abs(value - old_value);
                this.recent_value_movement.addSample({ x: delta });
            },
        });

        this.drag_animation.position = visible? 1:0;

        this.dragger = new DragHandler({
            name,
            element: drag_node,
            oncancelled,

            ondragstart: (args) => {
                // If this is a horizontal dragger, see if we should ignore this drag because
                // it might trigger iOS navigation.
                if(!vertical && helpers.should_ignore_horizontal_drag(args.event))
                    return false;
                
                if(!this.confirm_drag(args))
                    return false;

                // Stop any running animation.
                this.drag_animation.stop();

                this.recent_pointer_movement.reset();

                this._set_state("dragging");

                // A drag is starting.  Send onbeforeshown if we weren't visible, since we
                // might be about to make the widget visible.
                this._set_visible(true);

                // Remember the position we started at.  This is only used so we can return to it if
                // the drag is cancelled.
                this.drag_started_at = this.position;

                return true;
            },

            ondrag: ({event, first}) => {
                // If we're animating, show() or hide() was called during a drag.  This doesn't stop
                // the drag, but we're in the animating state while this happens.  Since we saw another
                // drag movement, cancel the animation and return to dragging.
                if(this._state == "animating")
                {
                    console.log("animation interrupted by drag");
                    this.drag_animation.stop();
                    this._set_state("dragging");
                }

                if(this._state != "dragging")
                    this._log_state_changes(`Expected dragging, in ${this._state}`);

                // Drags should always be in the dragging state, and won't change state.
                console.assert(this._state == "dragging", this._state);

                this.recent_pointer_movement.addSample({ x: event.movementX, y: event.movementY });

                // The first movement is thresholded by the browser, and counts towards fling velocity
                // but doesn't actually move the widget.
                if(first)
                    return;

                // If show() or hide() was called during a fling and the user dragged again, we're interrupting
                // the animation to continue the drag, so stop the drag.
                this.drag_animation.stop();

                let pos = this.drag_animation.position;
                let movement = vertical? event.movementY:event.movementX;
                if(reversed)
                    movement *= -1;

                let actual_size = size;
                if(actual_size instanceof Function)
                    actual_size = actual_size();

                pos += movement / actual_size;
                pos = helpers.clamp(pos, this.start_offset, this.end_offset);
                this.drag_animation.position = pos;
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
                    if(this.drag_started_at > 0.5)
                        this.show();
                    else
                        this.hide();
                    return;
                }

                // See if there was a fling.
                let { velocity } = this.recent_pointer_movement.getMovementInDirection(direction);

                let threshold = 150;
                if(velocity > threshold)
                    return this.show({ velocity });
                else if(velocity < -threshold)
                    return this.hide({ velocity: -velocity });

                // If there hasn't been a fling recently, open or close based on how far open we are.
                let open = this.drag_animation.position > 0.5;
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
        return this.drag_animation.position;
    }

    _set_visible(value)
    {
        if(this._visible == value)
            return;

        this._visible = value;
        if(this._visible)
            this.onbeforeshown();
        else
            this.onafterhidden();

        if(this.close_if_outside)
        {
            // Create or destroy the click_outside_listener.
            if(this._visible && this.clicked_outside_ui_listener == null)
            {
                this.clicked_outside_ui_listener = new click_outside_listener(this.close_if_outside, () => this.hide());
            }
            else if(!this._visible && this.clicked_outside_ui_listener != null)
            {
                this.clicked_outside_ui_listener.shutdown();
                this.clicked_outside_ui_listener = null;
            }
        }
    }

    // Stop any animations, and jump to the given position.
    set_position_without_transition(position=0)
    {
        this.drag_animation.stop();
        this.drag_animation.position = position;

        this._set_state("idle");
    }
    
    // Animate to the fully shown state.  If given, velocity is the drag speed that caused this.
    //
    // If a drag is in progress, it'll continue, and cancel the animation if it moves again.  The
    // drag will be cancelled if the animation completes.
    show({ easing=null }={})
    {
        this._animate_to({end_position: 1, easing});
    }

    // Animate to the completely hidden state.  If given, velocity is the drag speed that caused this.
    hide({ easing=null }={})
    {
        this._animate_to({end_position: 0, easing});
    }

    _animate_to({ end_position, easing=null }={})
    {
        // Stop if we're already in this state.
        if(this._state == "idle" && this.drag_animation.position == end_position)
            return;
    
        // If we're already animating towards this position, just let it continue.
        if(this._state == "animating" && this.drag_animation.animating_towards == end_position)
            return;

        // If we're animating to a visible state, mark ourselves visible.
        if(end_position > 0)
            this._set_visible(true);

        let duration = this.duration();

        // If no easing was specified, create an easing curve to match the current velocity
        // of the animated property.
        if(easing == null)
        {
            let property_velocity = this.recent_value_movement.currentVelocity.x;
            let property_start = this.drag_animation.current_property_value;
            let property_end = this.drag_animation.property_value_for_position(end_position);
            // console.log("->", property_start, property_end, property_velocity);

            easing = Bezier2D.find_curve_for_velocity({
                distance: Math.abs(property_end - property_start),
                duration: duration / 1000, // in seconds
                target_velocity: Math.abs(property_velocity),
                return_object: true,
            });
        }

        let promise = this._animation_promise = this.drag_animation.play({end_position, easing, duration});
        this._animation_promise.then(() => {
            if(promise == this._animation_promise)
                this._animation_promise = null;
        });

        // Call this after starting the animation, so animation_playing and animating_to_shown
        // reflect the animation when onanimationstart is called.
        this._set_state("animating");
    }

    _record_state_change(from, to)
    {
        // if(Actor.debug_shutdown && !this._previous_shutdown_stack)
        // XXX
        {
            this._state_stacks ??= [];
            try {
                throw new Error();
            } catch(e) {
                this._state_stacks.push([from, to, e.stack]);
                let max = 10;
                if(this._state_stacks.length > max)
                    this._state_stacks.splice(this._state_stacks.length - max);
            }
        }
    }
    
    _log_state_changes(message)
    {
        if(!this._state_stacks)
            return;

        console.error("Error:", message);
        for(let [from, to, stack] of this._state_stacks)
        {
            console.log(`From ${from} to ${to}, stack:`);
            console.log(stack);
        }
    }

    // Set the current state: "idle", "dragging" or "animating", running the
    // appropriate callbacks.
    _set_state(state, ...args)
    {
        if(state == this._state)
            return;

        // Transition back to active, ending whichever state we were in before.
        if(state != "idle"      && this._change_state("idle", "active")) this.onactive(...args);
        if(state != "dragging"  && this._change_state("dragging", "active")) this.ondragend(...args);
        if(state != "animating" && this._change_state("animating", "active")) this.onanimationfinished(...args);

        // Transition into the new state, beginning the new state.
        if(state == "dragging"  && this._change_state("active", "dragging")) this.ondragstart(...args);
        if(state == "animating" && this._change_state("active", "animating")) this.onanimationstart(...args);
        if(state == "idle"      && this._change_state("active", "idle")) this.oninactive(...args);
    }

    _change_state(old_state, new_state)
    {
        if(this._state != old_state)
            return false;

        this._record_state_change(this._state, new_state);

        // console.warn(`state change: ${old_state} -> ${new_state}`);
        this._state = new_state;

        // Don't call onstatechange for active, since it's just a transition between
        // other states.
        if(new_state != "active")
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
    get animation_playing()
    {
        return this._state == "animating";
    }

    // Return true if the current animation is towards being shown (show() was called),
    // or false if the current animation is towards being hidden (hide() was called).
    // If no animation is running, return false.
    get animating_to_shown()
    {
        if(this._state != "animating")
            return false;

        return this.drag_animation.animating_towards == 1;
    }
    
    // Return a promise that resolves when the current animation completes, or null if no animation
    // is running.
    get finished()
    {
        return this._animation_promise;
    }


    shutdown()
    {
        this.drag_animation.shutdown();
    }
}
