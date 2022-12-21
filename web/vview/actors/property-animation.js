// Animate a single property on a node.
//
// This allows setting a property (usually a CSS --var), and animating it towards a given
// value.
//
// This doesn't use Animation.  They still don't work with CSS vars, and Animation has too
// many quirks to bother with for this.

import Bezier2D from 'vview/util/bezier.js';
import { helpers } from 'vview/misc/helpers.js';

export default class PropertyAnimation
{
    constructor({
        // The node containing the property to animate.  This can be an array of multiple nodes,
        // which will all be set.
        node,
        property,

        // The position of the animation is always 0-1.  The property value is scaled to
        // this range:
        property_start=0,
        property_end=1,

        // If play() is called, this is called after the animation completes.
        onanimationfinished,

        // This is called when this.position changes, including during animations.
        onchange=() => { },
    }={})
    {
        if(!(node instanceof Array))
            node = [node];
        this.node = node;
        this.onanimationfinished = onanimationfinished;
        this.onchange = onchange;
        this.state = "stopped";
        this.property = property;
        this.property_start = property_start;
        this.property_end = property_end;
    }

    shutdown()
    {
        this.stop();
    }

    // When not animating, return the current offset.
    //
    // If an animation is running, this will return the static offset, ignoring the animation.
    get position()
    {
        // static_animation is scaled to 0-1.  Scale it back to the caller's range.
        return this._position;
    }

    // Set the current position.  If this is called while animating, the animation will be
    // stopped.
    set position(offset)
    {
        // We don't currently set the position while animating, so flag it as a bug for now.
        if(this.playing)
            throw new Error("Animation is running");

        this._set_position(offset);
    }

    _set_position(position)
    {
        let old_position = this._position;
        let old_value = this._property_value;
        this._position = position;

        let value = this._property_value = this.property_value_for_position(position);
        for(let node of this.node)
            node.style.setProperty(this.property, value);

        // Call onchange with the old and new values.  Note that old_value and old_position
        // are null on the first call.
        this.onchange({position, value, old_position, old_value});
    }

    // Return the value of the output property for the given 0-1 position.
    property_value_for_position(position)
    {
        return helpers.scale(position, 0, 1, this.property_start, this.property_end);
    }

    // Return the current value of the property.
    get current_property_value()
    {
        return this.property_value_for_position(this._position);
    }

    // Return true if an animation is active.
    get playing()
    {
        return this._playToken != null;
    }

    // Play the animation from the current position to end_position, replacing any running animation.
    async play({end_position=1, easing="ease-in-out", duration=300}={})
    {
        // This is just for convenience, so the caller can tell which way an animation is going.
        this.animating_towards = end_position;

        // Create a new token.  If another play() call takes over the animation or we're stopped, this
        // will change and we'll stop animating.
        let token = this._playToken = new Object();

        // Get the easing curve.
        let curve = easing instanceof Bezier2D? easing:Bezier2D.curve(easing);
        if(curve == null)
            throw new Error(`Unknown easing curve: ${easing}`);

        let start_position = this._position;
        let start_time = Date.now();
        while(1)
        {
            await helpers.vsync();

            // Stop if the animation state changed while we were async.
            if(token !== this._playToken)
                return;

            // The position through this animation, from 0 to 1:
            let offset = (Date.now() - start_time) / duration;
            offset = helpers.clamp(offset, 0, 1);

            // Apply easing.
            let offset_with_easing = curve.evaluate(offset);

            // Update the animation.  Snap to the start and end positions to remove rounding error.
            let new_position = helpers.scale(offset_with_easing, 0, 1, start_position, end_position);
            if(Math.abs(new_position - start_position) < 0.00001) new_position = start_position;
            if(Math.abs(new_position - end_position) < 0.00001) new_position = end_position;
            this._set_position(new_position);

            if(offset == 1)
                break;
        }

        this.animating_towards = null;
        this._playToken = null;
        this.onanimationfinished(this);
    }

    // Stop the animation if it's running.
    stop()
    {
        // Clearing _playToken will stop any running play() loop.
        this._playToken = null;
    }
}
