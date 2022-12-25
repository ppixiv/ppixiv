// Gradually slow down and stop the given CSS animation after a delay, resuming it
// if the mouse is moved.

import { helpers } from 'vview/misc/helpers.js';

export default class StopAnimationAfter
{
    constructor(animation, delay, duration, vertical)
    {
        this.animation = animation;
        this.delay = delay;
        this.duration = duration;
        this.vertical = vertical;
        this.abort = new AbortController();

        this.run();
    }

    async run()
    {
        // We'll keep the animation running as long as we've been active within the delay
        // period.
        let last_activity_at = Date.now() / 1000;
        let onmove = (e) => {
            last_activity_at = Date.now() / 1000;
        };

        window.addEventListener("mousemove", onmove, {
            passive: true,
        });

        try {
            // This is used for thumbnail animations.  We want the animation to end at a
            // natural place: at the top for vertical panning, or in the middle for horizontal
            // panning.
            //
            // Animations are async, so we can't control their speed precisely, but it's close
            // enough that we don't need to worry about it here.
            //
            // Both animations last 4 seconds.  At a multiple of 4 seconds, the vertical animation
            // is at the top and the horizontal animation is centered, which is where we want them
            // to finish.  The vertical animation's built-in deceleration is also at the end, so for
            // those we can simply stop the animation when it reaches a multiple of 4.
            //
            // Horizontal animations decelerate at the edges rather than at the end, so we need to
            // decelerate these by reducing playbackRate.

            // How long the deceleration lasts.  We don't need to decelerate vertical animations, so
            // use a small value for those.
            const duration = this.vertical? 0.001:0.3;

            // We want the animation to stop with currentTime equal to this:
            let stop_at_animation_time = null;
            while(1)
            {
                let success = await helpers.vsync({signal: this.abort.signal});
                if(!success)
                    break;

                let now = Date.now() / 1000;
                let stopping = now >= last_activity_at + this.delay;
                if(!stopping)
                {
                    // If the mouse has moved recently, set the animation to full speed.  We don't
                    // accelerate back to speed.
                    stop_at_animation_time = null;
                    this.animation.playbackRate = 1;
                    continue;
                }

                // We're stopping, since the mouse hasn't moved in a while.  Figure out when we want
                // the animation to actually stop if we haven't already.
                if(stop_at_animation_time == null)
                {
                    stop_at_animation_time = this.animation.currentTime / 1000 + 0.0001;
                    stop_at_animation_time = Math.ceil(stop_at_animation_time / 4) * 4; // round up to next multiple of 4
                }

                let animation_time = this.animation.currentTime/1000;

                // The amount of animation time left, ignoring playbackSpeed:
                let animation_time_left = stop_at_animation_time - animation_time;
                if(animation_time_left > duration)
                {
                    this.animation.playbackRate = 1;
                    continue;
                }

                if(animation_time_left <= 0.001)
                {
                    this.animation.playbackRate = 0;
                    continue;
                }

                // We want to decelerate smoothly, reaching a velocity of zero when animation_time_left
                // reaches 0.  Just estimate it by decreasing the time left linearly.
                this.animation.playbackRate = animation_time_left / duration;
            }
        } finally {
            window.removeEventListener("mousemove", onmove);
        }
    }

    // Stop affecting the animation and return it to full speed.
    shutdown()
    {
        this.abort.abort();

        this.animation.playbackRate = 1;
    }
}
