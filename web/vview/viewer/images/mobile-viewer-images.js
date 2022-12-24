import ViewerImages from 'vview/viewer/images/viewer-images.js';
import TouchScroller from 'vview/viewer/images/mobile-touch-scroller.js';
import { FixedDOMRect } from 'vview/misc/helpers.js';

// This subclass implements our touchscreen pan/zoom UI.
export default class ViewerImagesMobile extends ViewerImages
{
    constructor({...options})
    {
        super(options);

        this.container.addEventListener("pointerdown", (e) => {
            if(this._slideshowMode || !this._animationsRunning)
                return;

            // Taps during panning animations stop the animation.  Mark them as partially
            // handled, so they don't also trigger IsolatedTapHandler and open the menu.
            // Do this here instead of in onactive below, so this happens even if the touch
            // isn't long enough to activate TouchScroller.
            e.partiallyHandled = true;
        });
    
        this._touchScroller = new TouchScroller({
            ...this._signal,
            container: this.container,

            onactive: () => {
                // Stop pan animations if the touch scroller becomes active.
                if(!this._slideshowMode)
                    this._stopAnimation();
            },

            // Return the current position in client coordinates.
            getPosition: () => {
                // We're about to start touch dragging, so stop any running pan.  Don't stop slideshows.
                if(!this._slideshowMode)
                    this._stopAnimation();

                let x = this._centerPos[0] * this.currentWidth;
                let y = this._centerPos[1] * this.currentHeight;

                // Convert from view coordinates to screen coordinates.
                [x,y] = this.viewToClientCoords([x,y]);

                return { x, y };
            },

            // Set the current position in client coordinates.
            setPosition: ({x, y}) =>
            {
                if(this._slideshowMode)
                    return;

                this._stopAnimation();

                [x,y] = this.clientToViewCoords([x,y]);

                x /= this.currentWidth;
                y /= this.currentHeight;

                this._centerPos[0] = x;
                this._centerPos[1] = y;
                this._reposition();
            },

            // Zoom by the given factor, centered around the given client position.
            adjustZoom: ({ratio, centerX, centerY}) =>
            {
                if(this._slideshowMode)
                    return;

                this._stopAnimation();

                let [viewX,viewY] = this.clientToViewCoords([centerX,centerY]);

                // Store the position of the anchor before zooming, so we can restore it below.
                let center = this.getImagePosition([viewX, viewY]);

                // Apply the new zoom.  Snap to 0 if we're very close, since it won't reach it exactly.
                let newFactor = this._zoomFactorCurrent * ratio;

                let newLevel = this.zoomFactorToZoomLevel(newFactor);
                if(Math.abs(newLevel) < 0.005)
                    newLevel = 0;
                this._zoomLevel = newLevel;

                // Restore the center position.
                this.setImagePosition([viewX, viewY], center);

                this._reposition();
            },

            onanimationfinished: () => {
                // We could do this to save the current zoom level, since we didn't use it during the
                // fling, but for now we don't save the zoom level on mobile anyway.
                // this.setZoomLevel(this._zoomLevel);
            },

            // Return the bounding box of where we want the position to stay.
            getBounds: () =>
            {
                // Get the position that the image would normally be snapped to if it was in the
                // far top-left or bottom-right.
                let topLeft = this.getCurrentActualPosition({zoomPos: [0,0]}).zoomPos;
                let bottomRight = this.getCurrentActualPosition({zoomPos: [1,1]}).zoomPos;

                // If moveToTarget is true, we're animating for a double-tap zoom and we want to
                // center on this.targetZoomCenter.  Adjust the target position so the image is still
                // clamped to the edge of the screen, and use that as both corners, so it's the only
                // place we can go.
                if(this.moveToTarget)
                {
                    topLeft = this.getCurrentActualPosition({zoomPos: this.targetZoomCenter}).zoomPos;
                    bottomRight = [...topLeft]; // copy
                }

                // Scale to view coordinates.
                topLeft[0] *= this.currentWidth;
                topLeft[1] *= this.currentHeight;
                bottomRight[0] *= this.currentWidth;
                bottomRight[1] *= this.currentHeight;

                // Convert to client coords.
                topLeft = this.viewToClientCoords(topLeft);
                bottomRight = this.viewToClientCoords(bottomRight);

                return new FixedDOMRect(topLeft[0], topLeft[1], bottomRight[0], bottomRight[1]);
            },

            // When a fling starts (this includes releasing drags, even without a fling), decide
            // on the zoom factor we want to bounce to.
            onanimationstart: ({touchFactor=null, targetImagePos=null, moveToTarget=false}={}) =>
            {
                this.moveToTarget = moveToTarget;

                // If we were given an explicit zoom factor to zoom to, use it.  This happens
                // if we start the zoom in toggleZoom.
                if(touchFactor != null)
                {
                    this.targetZoomFactor = touchFactor;
                    this.targetZoomCenter = targetImagePos;
                    return;
                }

                // Zoom relative to the center of the image.
                this.targetZoomCenter = [0.5, 0.5];

                // If we're smaller than contain, always zoom up to contain.  Also snap to contain
                // if we're slightly over, so we don't zoom to cover if cover and contain are nearby
                // and we're very close to contain.  Don't give this much of a threshold, since it's
                // always easy to zoom to contain (just zoom out a bunch).
                //
                // Snap to cover if we're close to it.
                //
                // Otherwise, zoom to current, which is a no-op and will leave the zoom alone.
                let zoomFactorCover = this._zoomFactorCover;
                let zoomFactorCurrent = this._zoomFactorCurrent;
                if(this._zoomFactorCurrent < this._zoomFactorContain + 0.01)
                    this.targetZoomFactor = this._zoomFactorContain;
                else if(Math.abs(zoomFactorCover - zoomFactorCurrent) < 0.15)
                    this.targetZoomFactor = this._zoomFactorCover;
                else
                    this.targetZoomFactor = this._zoomFactorCurrent;
            },

            onanimationfinished: () =>
            {
                // If we enabled moving towards a target position, disable it when the animation finishes.
                this.moveToTarget = false;
            },

            // We don't want to zoom under zoom factor 1x.  Return the zoom ratio needed to bring
            // the current zoom factor back up to 1x.  For example, if the zoom factor is currently
            // 0.5, return 2.
            getWantedZoom: () =>
            {
                // this.targetZoomCenter is in image coordinates.  Return screen coordinates.
                let [viewX, viewY] = this.getViewPosFromImagePos(this.targetZoomCenter);
                let [centerX, centerY] = this.viewToClientCoords([viewX, viewY]);

                // ratio is the ratio we want to be applied relative to to the current zoom.
                return {
                    ratio: this.targetZoomFactor / this._zoomFactorCurrent,
                    centerX,
                    centerY,
                };
            },
        });
    }

    toggleZoom(e)
    {
        if(this._slideshowMode)
            return;

        // Stop any animation first, so we adjust the zoom relative to the level we finalize
        // the animation to.
        this._stopAnimation();

        // Make sure TouchSScroller isn't animating.
        this._touchScroller.cancelFling();

        // Toggle between fit (zoom level 0) and cover.  If cover and fit are close together,
        // zoom to a higher factor instead of cover.  This way we zoom to cover when it makes
        // sense, since it's a nicer zoom level to pan around in, but we use a higher level
        // if cover isn't enough of a zoom.  First, figure out the zoom level we'll use if
        // we zoom in.
        let zoomInLevel;
        let zoomOutLevel = 0;
        let coverZoomRatio = 1 / this.zoomLevelToZoomFactor(0);
        if(coverZoomRatio > 1.5)
            zoomInLevel = this._zoomLevelCover;
        else
        {
            let scaledZoomFactor = this._zoomFactorCover*2;
            let scaledZoomLevel = this.zoomFactorToZoomLevel(scaledZoomFactor);
            zoomInLevel = scaledZoomLevel;
        }

        // Zoom to whichever one is further away from the current zoom.
        let currentZoomLevel = this.getZoomLevel();
        let zoomDistanceIn = Math.abs(currentZoomLevel - zoomInLevel);
        let zoomDistanceOut = Math.abs(currentZoomLevel - zoomOutLevel);

        let level = zoomDistanceIn > zoomDistanceOut? zoomInLevel:zoomOutLevel;
        let touchFactor = this.zoomLevelToZoomFactor(level);

        // Our "screen" positions are relative to our container and not actually the
        // screen, but mouse events are relative to the screen.
        let viewPos = this.clientToViewCoords([e.clientX, e.clientY]);
        let targetImagePos = this.getImagePosition(viewPos);

        this._touchScroller.startFling({
            onanimationstartOptions: {
                touchFactor,
                targetImagePos,

                // Set moveToTarget so we'll center on this position too.
                moveToTarget: true,
            }
        });
    }

    _reposition({clampPosition=true, ...options}={})
    {
        // Don't clamp the view position if we're repositioned while the touch scroller
        // is active.  It handles overscroll and is allowed to go out of bounds.
        if(this._touchScroller.state != "idle")
            clampPosition = false;

        return super._reposition({clampPosition, ...options});
    }

    // The mobile UI is always in locked zoom mode.
    getLockedZoom() { return true; }
    setLockedZoom(enable) { }
}
