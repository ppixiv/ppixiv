
// Double-tap handling for screen_illust on mobile.
//
// This needs to get along gracefully with the image viewer's TouchScroller.  A touch and
// drag prevents a click event, but we do want to allow a single click to both drag and
// count towards a double-tap.  If your finger moves slightly while double-tapping it
// can start a drag, which we do want to happen, and that shouldn't prevent it from
// being part of a double-tap.
import { helpers } from 'vview/misc/helpers.js';

// XXX: this can probably be removed

export default class MobileDoubleTapHandler
{
    constructor({
        container,
        ondbltap,
        threshold_ms=250,
        signal=null,
    })
    {
        this.container = container;
        this.ondbltap = ondbltap;
        this.threshold_ms = threshold_ms;

        this.pointerdown_timestamp = -9999;
        this.pointerdown_position = { x: 0, y: 0 };
        this.watching_pointer_id = null;

        if(ppixiv.ios)
        {
            // iOS Safari has a bizarre bug: pointerdown events that also cause a dblclick
            // event sometimes don't trigger.  This only happens in iOS 16, only when running
            // as a PWA (not when in the browser), and only happens on about 50% of launches.
            // We have to use dblclick to get double-clicks.
            this.container.addEventListener("dblclick", (e) => {
                ondbltap(e);
            }, { signal });

            // Another bizarre bug: we also don't get these dblclick events unless at least
            // one dblclick listener exists on the document.  (This workaround doesn't help
            // pointer events.)  This doesn't make sense, since the existance of an event listener
            // that doesn't do anything is supposed to be undetectable.  Add one of these the first
            // time we're used, and don't use the AbortSignal since we don't want it to be removed.
            if(!MobileDoubleTapHandler.added_dblclick_workaround)
            {
                MobileDoubleTapHandler.added_dblclick_workaround = true;
                document.addEventListener("dblclick", (e) => { });
            }

            return;
        }

        this.container.addEventListener("pointerdown", this.pointerevent, { signal });
        window.addEventListener("pointerup", this.pointerevent, { signal });
        window.addEventListener("pointercancel", this.pointerevent, { signal });
    }

    pointerevent = (e) =>
    {
        // Ignore other presses while we're already watching one.
        if(this.watching_pointer_id != null && e.pointerId != this.watching_pointer_id)
            return;

        if(e.type == "pointerup" || e.type == "pointercancel")
        {
            this.watching_pointer_id = null;
            return;
        }

        this.watching_pointer_id = e.pointerId;

        let time_since_click = e.timeStamp - this.pointerdown_timestamp;
        let position = { x: e.screenX, y: e.screenY };
        let distance = helpers.distance(position, this.pointerdown_position);
        this.pointerdown_timestamp = e.timeStamp;
        this.pointerdown_position = position;

        // Check the double-click time and distance thresholds.
        if(time_since_click > this.threshold_ms)
            return;

        if(distance > 25*window.devicePixelRatio)
            return;

        this.pointerdown_timestamp = -9999;

        this.ondbltap(e);
    }
};
