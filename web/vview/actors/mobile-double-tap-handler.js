
// Double-tap handling for ScreenIllust on mobile.
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
        thresholdMs=250,
        signal=null,
    })
    {
        this.container = container;
        this.ondbltap = ondbltap;
        this.thresholdMs = thresholdMs;

        this._pointerdownTimestamp = -9999;
        this._pointerdownPosition = { x: 0, y: 0 };
        this._watchingPointerId = null;

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
            if(!MobileDoubleTapHandler.addedDblclickWorkaround)
            {
                MobileDoubleTapHandler.addedDblclickWorkaround = true;
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
        if(this._watchingPointerId != null && e.pointerId != this._watchingPointerId)
            return;

        if(e.type == "pointerup" || e.type == "pointercancel")
        {
            this._watchingPointerId = null;
            return;
        }

        this._watchingPointerId = e.pointerId;

        let timeSinceClick = e.timeStamp - this._pointerdownTimestamp;
        let position = { x: e.screenX, y: e.screenY };
        let distance = helpers.math.distance(position, this._pointerdownPosition);
        this._pointerdownTimestamp = e.timeStamp;
        this._pointerdownPosition = position;

        // Check the double-click time and distance thresholds.
        if(timeSinceClick > this.thresholdMs)
            return;

        if(distance > 25*window.devicePixelRatio)
            return;

        this._pointerdownTimestamp = -9999;

        this.ondbltap(e);
    }
}
