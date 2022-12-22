import ViewerImages from 'vview/viewer/images/viewer-images.js';
import PointerListener from 'vview/actors/pointer-listener.js';
import { TrackMouseMovement } from 'vview/util/hide-mouse-cursor-on-idle.js';
import { ClassFlags } from 'vview/misc/helpers.js';

// This subclass implements our desktop pan/zoom UI.
export default class ViewerImagesDesktop extends ViewerImages
{
    constructor({...options})
    {
        super(options);
 
        window.addEventListener("blur", (e) => this.stopDragging(), this._signal);

        this._pointerListener = new PointerListener({
            element: this.container,
            buttonMask: 1,
            signal: this.shutdownSignal.signal,
            callback: this._pointerevent,
        });
    }

    _pointerevent = (e) =>
    {
        if(e.mouseButton != 0 || this._slideshowMode)
            return;

        if(e.pressed && this.capturedPointerId == null)
        {
            e.preventDefault();

            this.container.style.cursor = "none";

            // Don't show the UI if the mouse hovers over it while dragging.
            ClassFlags.get.set("hide-ui", true);

            // Stop animating if this is a real click.  If it's a carried-over click during quick
            // view, don't stop animating until we see a drag.
            if(e.type != "simulatedpointerdown")
                this._stopAnimation();

            let zoomCenterPos;
            if(!this.getLockedZoom())
                zoomCenterPos = this.getImagePosition([e.clientX, e.clientY]);

            // If this is a simulated press event, the button was pressed on the previous page,
            // probably due to quick view.  Don't zoom from this press, but do listen to pointermove,
            // so sendMouseMovementToLinkedTabs is still called.
            let allowZoom = true;
            if(e.type == "simulatedpointerdown" && !this.getLockedZoom())
                allowZoom = false;

            if(allowZoom)
                this._mouse_pressed = true;

            this._dragMovement = [0,0];

            this.capturedPointerId = e.pointerId;
            this.container.setPointerCapture(this.capturedPointerId);
            this.container.addEventListener("lostpointercapture", this._lostPointerCapture, this._signal);

            // If this is a click-zoom, align the zoom to the point on the image that
            // was clicked.
            if(!this.getLockedZoom())
                this.setImagePosition([e.clientX, e.clientY], zoomCenterPos);

            this._reposition();

            // Only listen to pointermove while we're dragging.
            this.container.addEventListener("pointermove", this._pointermove, this._signal);
        } else {
            if(this.capturedPointerId == null || e.pointerId != this.capturedPointerId)
                return;

            // Tell HideMouseCursorOnIdle that the mouse cursor should be hidden, even though the
            // cursor may have just been moved.  This prevents the cursor from appearing briefly and
            // disappearing every time a zoom is released.
            TrackMouseMovement.singleton.simulate_inactivity();
           
            this.stopDragging();
        }
    }

    shutdown()
    {
        // Note that we need to avoid writing to browser history once shutdown() is called.
        ClassFlags.get.set("hide-ui", false);
        super.shutdown();
    }

    stopDragging()
    {
        // Save our history state on mouseup.
        this._saveToHistory();
           
        if(this.container != null)
        {
            this.container.removeEventListener("pointermove", this._pointermove);
            this.container.style.cursor = "";
        }

        if(this.capturedPointerId != null)
        {
            this.container.releasePointerCapture(this.capturedPointerId);
            this.capturedPointerId = null;
        }
       
        this.container.removeEventListener("lostpointercapture", this._lostPointerCapture);

        ClassFlags.get.set("hide-ui", false);
        
        this._mouse_pressed = false;
        this._reposition();
    }

    // If we lose pointer capture, clear the captured pointer_id.
    _lostPointerCapture = (e) =>
    {
        if(e.pointerId == this.capturedPointerId)
            this.capturedPointerId = null;
    }

    _pointermove = (e) =>
    {
        // Ignore pointermove events where the pointer didn't move, so we don't cancel
        // panning prematurely.  Who designed an API where an event named "pointermove"
        // is used for button presses?
        if(e.movementX == 0 && e.movementY == 0)
            return;

        // If we're animating, only start dragging after we pass a drag threshold, so we
        // don't cancel the animation in quick view.  These thresholds match Windows's
        // default SM_CXDRAG/SM_CYDRAG behavior.
        let { movementX, movementY } = e;

        // Unscale by devicePixelRatio, or movement will be faster if the browser is zoomed in.
        if(devicePixelRatio != null)
        {
            movementX /= devicePixelRatio;
            movementY /= devicePixelRatio;
        }

        this._dragMovement[0] += movementX;
        this._dragMovement[1] += movementY;
        if(this._animationsRunning && this._dragMovement[0] < 4 && this._dragMovement[1] < 4)
            return;

        this.applyPointerMovement({movementX, movementY});
    }
}
