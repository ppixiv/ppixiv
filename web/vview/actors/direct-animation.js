// DirectAnimation is an Animation where we manually run its clock instead of letting it
// happen async.
//
// This works around some problems with Chrome's implementation:
//
// - It always runs at the maximum possible refresh rate.  My main display is 280Hz freesync,
// which is nice for scrolling and mouse cursors and games, but it's a waste of resources to
// pan an image around at that speed.  Chrome doesn't give any way to control this.
// - It runs all windows at the maximum refresh rate of any attached monitor.  My secondary
// monitors are regular 60Hz, but Chrome runs animations on them at 280Hz too.  (This is a
// strange bug: the entire point of requestAnimationFrame is to sync to vsync, not to just
// wait for however long the browser thinks a frame is.)
// - Running animations at this framerate causes other problems, like hitches in thumbnail
// animations and videos in unrelated windows freezing.  (Is Chrome still only tested with
// 60Hz monitors?)
//
// Running the animation directly lets us control the framerate we actually update at.
//
// It also works around problems with iOS's implementation: pausing animations causes the
// playback time to jump backwards, instead of synchronizing with the async timer.  This
// causes DragImageChanger to jump around when drags are interrupted.
// 
// Running the animation directly is OK for us since the animation is usually the only thing
// going on, and we're not trying to use this to drive a bunch of random animations.  
//
// This only implements what we need to run slideshow animations and doesn't attempt to be a
// general drop-in replacement for Animation.  It'll cause JS to be run periodically instead of
// letting everything happen in the compositor, but that's much better than updating multiple
// windows at several times their actual framerate.

import { helpers } from 'vview/misc/helpers.js';

export default class DirectAnimation
{
    constructor(effect, {
        // If false, framerate limiting is disabled.
        limit_framerate=true,
    }={})
    {
        this.limit_framerate = limit_framerate;

        // We should be able to just subclass Animation, and this works in Chrome, but iOS Safari
        // is broken and doesn't call overridden functions.
        this.animation = new Animation(effect);
        this._update_playstate("idle");
    }

    get effect() { return this.animation.effect; }

    _update_playstate(state)
    {
        if(state == this._playState)
            return;

        // If we're exiting finished, create a new finished promise.
        if(this.finished == null || this._playState == "finished")
        {
            this.finished = helpers.make_promise();

            // Catch this promise by default, so errors aren't logged to the console every time
            // an animation is cancelled.
            this.finished.catch((f) => true);
        }

        this._playState = state;
    }

    play()
    {
        if(this._playState == "running")
            return;

        this._update_playstate("running");
        this._playToken = new Object();
        this._runner = this._run_animation();
    }

    pause()
    {
        if(this._playState == "paused")
            return;

        this._update_playstate("paused");
        this._playToken = null;
        this._runner = null;
    }

    cancel()
    {
        this.pause();
        this.animation.cancel();
    }

    updatePlaybackRate(rate)
    {
        return this.animation.updatePlaybackRate(rate);
    }

    commitStyles()
    {
        this.animation.commitStyles();
    }

    commitStylesIfPossible()
    {
        try {
            this.commitStyles();
            return true;
        } catch(e) {
            console.error(e);
            return false;
        }        
    }

    get playState()
    {
        return this._playState;
    }

    get currentTime() { return this.animation.currentTime; }

    async _run_animation()
    {
        this.animation.currentTime = this.animation.currentTime;

        let token = this._playToken;
        let last_update = Date.now();

        // If no time has been set yet, the animation hasn't applied any styles.  Set the default
        // start time before going async, so we don't flash whatever the previous style was for a
        // frame before updating.
        if(this.animation.currentTime == null)
            this.animation.currentTime = 0;

        while(1)
        {
            let delta;
            while(1)
            {
                await helpers.vsync();

                // Stop if the animation state changed while we were async.
                if(token !== this._playToken)
                {
                    this.finished.reject(new DOMException("The animation was aborted", "AbortError"));
                    return;
                }

                let now = Date.now();
                delta = now - last_update;

                // If we're running faster than we want, wait another frame, giving a small error margin.
                // If targetFramerate is null, just run every frame.
                //
                // This is a workaround for Chrome.  Don't do this on mobile, since there's much more
                // rendering time jitter on mobile and this causes skips.
                if(this.limit_framerate && !ppixiv.mobile)
                {
                    let target_framerate = ppixiv.settings.get("slideshow_framerate");
                    if(target_framerate != null)
                    {
                        let target_delay = 1000/target_framerate;
                        if(delta*1.05 < target_delay)
                            continue;
                    }
                }
                
                last_update = now;
                break;
            }

            delta *= this.animation.playbackRate;

            let new_current_time = this.animation.currentTime + delta;

            // Clamp the time to the end (this may be infinity).
            let timing = this.animation.effect.getComputedTiming();
            let max_time = timing.duration*timing.iterations;
            let finished = new_current_time >= max_time;
            if(finished)
                new_current_time = max_time;

            // Update the animation.
            this.animation.currentTime = new_current_time;

            // If we reached the end, run onfinish and stop.  This will never happen if max_time
            // is infinity.
            if(finished)
            {
                this._update_playstate("finished");
                this.finished.accept();
                if(this.onfinish)
                    this.onfinish();
                break;
            }
        }
    }
}
