// Drag navigation for swiping between images on mobile.

import DragHandler from 'vview/misc/drag-handler.js';
import Bezier2D from 'vview/util/bezier.js';
import FlingVelocity from 'vview/util/fling-velocity.js';
import DirectAnimation from 'vview/actors/direct-animation.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DragImageChanger
{
    constructor({parent})
    {
        this.parent = parent;
        this.recentPointerMovement = new FlingVelocity({
            samplePeriod: 0.150,
        });

        // The amount we've dragged.  This is relative to the main image, so it doesn't need to
        // be adjusted when we add or remove viewers.
        this.dragDistance = 0;

        // A list of viewers that we're dragging between.  This always includes the main viewer
        // which is owned by the screen.
        this.viewers = [];
        this.animations = null;

        // Once we reach the left and right edge, this is set to the minimum and maximum value
        // of this.dragDistance.
        this.bounds = [null, null];

        this.dragger = new DragHandler({
            name: "image-changer",
            element: this.parent.root,
            confirmDrag: ({event}) => {
                // Stop if there's no image, if the screen wasn't able to load one.
                if(this.mainViewer == null)
                    return false;

                if(helpers.shouldIgnoreHorizontalDrag(event))
                    return false;

                return true;
            },

            ondragstart: (args) => this.ondragstart(args),
            ondrag: (args) => this.ondrag(args),
            ondragend: (args) => this.ondragend(args),
            deferredStart: () => {
                // If an animation is running, disable deferring drags, so grabbing the dragger will
                // stop the animation.  Otherwise, defer drags until the first pointermove (the normal
                // behavior).
                return this.animations == null && this.dragDistance == 0;
            },
        });
    }

    // Get the distance between one viewer and the next.
    get viewerDistance()
    {
        return this.parent.viewContainer.offsetWidth + this.imageGap;
    }

    // Return the additional space between viewers.
    get imageGap()
    {
        return 25;
    }

    // The main viewer is the one active in the screen.  this.dragDistance is relative to
    // it, and it's always in this.viewers during drags.
    get mainViewer() { return this.parent.viewer; }

    // The image changed externally or the screen is becoming inactive, so stop any drags and animations.
    stop()
    {
        this.dragger.cancelDrag();
        this.cancelAnimation();
    }

    ondragstart({event})
    {
        // If we aren't grabbing a running drag, only start if the initial movement was horizontal.
        if(this.animations == null && this.dragDistance == 0 && Math.abs(event.movementY) > Math.abs(event.movementX))
            return false;

        this.dragDistance = 0;
        this.recentPointerMovement.reset();
        this.bounds = [null, null];

        if(this.animations == null)
        {
            // We weren't animating, so this is a new drag.  Start the list off with the main viewer.
            this.viewers = [this.mainViewer];
            return true;
        }

        // Another drag started while the previous drag's transition was still happening.
        // Stop the animation, and set the drag distance to where the animation was stopped.
        this.cancelAnimation();
        return true;
    }

    // If an animation is running, cancel it.
    cancelAnimation()
    {
        if(!this.animations)
            return;

        let animations = this.animations;
        this.animations = null;

        // Pause the animations, and wait until the pause completes.
        for(let animation of animations)
            animation.pause();

        // If a drag is active, set drag distance to the X position of the main viewer to match
        // the drag to where the animation was.
        if(this.dragDistance != null && this.mainViewer)
        {
            let mainTransform = new DOMMatrix(getComputedStyle(this.mainViewer.root).transform);
            this.dragDistance = mainTransform.e; // X translation
            this.refreshDragPosition();
        }

        // Remove the animations.
        for(let animation of animations)
            animation.cancel();
    }

    ondrag({event, first})
    {
        let x = event.movementX;
        this.recentPointerMovement.addSample({ x });

        // If we're past the end, apply friction to indicate it.  This uses stronger overscroll
        // friction to make it distinct from regular image panning overscroll.
        let overscroll = 1;
        if(this.bounds[0] != null && this.dragDistance > this.bounds[0])
        {
            let distance = Math.abs(this.bounds[0] - this.dragDistance);
            overscroll = Math.pow(0.97, distance);
        }

        if(this.bounds[1] != null && this.dragDistance < this.bounds[1])
        {
            let distance = Math.abs(this.bounds[1] - this.dragDistance);
            overscroll = Math.pow(0.97, distance);
        }
        x *= overscroll;

        // The first pointer input after a touch may be thresholded by the OS trying to filter
        // out slight pointer movements that aren't meant to be drags.  This causes the very
        // first movement to contain a big jump on iOS, causing drags to jump.  Count this movement
        // towards fling sampling, but skip it for the visual drag.
        if(!first)
            this.dragDistance += x;
        this._addViewersIfNeeded();
        this.refreshDragPosition();
    }

    getViewerX(viewerIndex)
    {
        // This offset from the main viewer.  Viewers above are negative and below
        // are positive.
        let relativeIdx = viewerIndex - this.mainViewerIndex;

        let x = this.viewerDistance * relativeIdx;
        x += this.dragDistance;
        return x;
    }

    // Update the positions of all viewers during a drag.
    refreshDragPosition()
    {
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            let x = this.getViewerX(idx);
            viewer.root.style.transform = `translateX(${x}px)`;
            viewer.visible = true;
        }
    }

    // Return the index of the main viewer in this.viewers.
    get mainViewerIndex()
    {
        return this._findViewerIndex(this.mainViewer);
    }

    _findViewerIndex(viewer)
    {
        let index = this.viewers.indexOf(viewer);
        if(index == -1)
        {
            console.error("Viewer is missing");
            return 0;
        }

        return index;
    }

    // Add a new viewer if we've dragged far enough to need one.
    async _addViewersIfNeeded()
    {
        let dragThreshold = 5;

        // See if we need to add another viewer in either direction.
        //
        // The right edge of the leftmost viewer, including the gap between images.  If this is
        // 0, it's just above the screen.
        let leftViewerEdge = this.getViewerX(-1) + this.viewerDistance;
        let addForwards = null;
        if(leftViewerEdge > dragThreshold)
            addForwards = false;

        // The left edge of the rightmost viewer.
        let rightViewerEdge = this.getViewerX(this.viewers.length) - this.imageGap;
        if(rightViewerEdge < window.innerWidth - dragThreshold)
            addForwards = true;

        // If the user drags multiple times quickly, the drag target may be past the end.
        // Add a viewer for it as soon as it's been dragged to, even though it may be well
        // off-screen, so we're able to transition to it.
        let targetViewerIndex = this.currentDragTarget();
        if(targetViewerIndex < 0)
            addForwards = false;
        else if(targetViewerIndex >= this.viewers.length)
            addForwards = true;

        // Stop if we're not adding a viewer.
        if(addForwards == null)
            return;

        // The viewer ID we're adding next to:
        let neighborViewer = this.viewers[addForwards? this.viewers.length-1:0];
        let neighborMediaId = neighborViewer.mediaId;

        let { mediaId, earlyIllustData, cancelled } = await this._createViewer(addForwards, neighborMediaId);
        if(cancelled)
        {
            // The viewer list changed while we were loading, or another call to _addViewersIfNeeded
            // was made.
            return;
        }

        if(mediaId == null)
        {
            // There's nothing in this direction, so remember that this is the boundary.  Once we
            // do this, overscroll will activate in this direction.
            if(addForwards)
                this.bounds[1] = this.viewerDistance * (this.viewers.length - 1 - this.mainViewerIndex);
            else
                this.bounds[0] = this.viewerDistance * (0 - this.mainViewerIndex);

            return;
        }

        let viewer = this.parent.createViewer({
            earlyIllustData,
            mediaId,
        });

        // Hide the viewer until after we set the transform, or iOS sometimes flickers it in
        // its initial position.
        viewer.visible = false;

        // Insert the new viewer.
        this.viewers.splice(addForwards? this.viewers.length:0, 0, viewer);

        // Set the initial position.
        this.refreshDragPosition();        
    }

    // Create a new viewer relative to the given media ID, and look up its media info.
    // Return { mediaId, mediaInfo }.
    //
    // If the viewer list changes or another call is made before this completes, discard
    // the result and return { cancelled: true }.
    async _createViewer(addForwards, neighborMediaId)
    {
        let viewers = this.viewers;
        let sentinel = this.addingViewer = new Object();

        try {
            // Get the next or previous media ID.
            let mediaId = await this.parent.getNavigation(addForwards, { navigateFromMediaId: neighborMediaId });
            if(mediaId == null)
                return { }

            let earlyIllustData = await ppixiv.mediaCache.getMediaInfo(mediaId, { full: false });
            return { mediaId, earlyIllustData };
        } finally {
            let cancelled = sentinel != this.addingViewer;
            if(sentinel == this.addingViewer)
                this.addingViewer = null;

            // Cancel if the viewer list changed while we were loading.
            if(this.viewers !== viewers)
                cancelled = true;

            // If we were cancelled, discard our return value.
            if(cancelled)
                return { cancelled: true };
        }
    }

    removeViewers()
    {
        // Shut down viewers.  Leave the main one alone, since it's owned by the screen.
        for(let viewer of this.viewers)
        {
            if(viewer != this.mainViewer)
                viewer.shutdown();
        }
        this.viewers = [];
    }

    // Get the viewer index that we'd want to go to if the user released the drag now.
    // This may be past the end of the current viewer list.
    currentDragTarget()
    {
        // If the user flung horizontally, move relative to the main viewer.
        let recentVelocity = this.recentPointerMovement.currentVelocity.x;
        let threshold = 200;
        if(Math.abs(recentVelocity) > threshold)
        {
            if(recentVelocity > threshold)
                return this.mainViewerIndex - 1;
            else if(recentVelocity < -threshold)
                return this.mainViewerIndex + 1;
        }

        // There hasn't been a fling recently, so land on the viewer which is closest to
        // the middle of the screen.  If the screen is dragged down several times quickly
        // and we're animating to an offscreen main viewer, and the user stops the
        // animation in the middle, this stops us on a nearby image instead of continuing
        // to where we were going before.
        let closestViewreIndex = 0;
        let closestViewerDistance = 999999;
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let x = this.getViewerX(idx);
            let center = x + window.innerWidth/2;
            let distance = Math.abs((window.innerWidth / 2) - center);
            if(distance < closestViewerDistance)
            {
                closestViewerDistance = distance;
                closestViewreIndex = idx;
            }
        }

        return closestViewreIndex;
    }

    // A drag finished.  See if we should transition the image or undo.
    //
    // interactive is true if this is the user releasing it, or false if we're shutting
    // down during a drag.  cancel is true if this was a cancelled pointer event.
    async ondragend({interactive, cancel}={})
    {
        let draggedToViewer = null;
        if(interactive && !cancel)
        {
            let targetViewerIndex = this.currentDragTarget();
            if(targetViewerIndex >= 0 && targetViewerIndex < this.viewers.length)
                draggedToViewer = this.viewers[targetViewerIndex];
        }

        // If we start a fling from this release, this is the velocity we'll try to match.
        let recentVelocity = this.recentPointerMovement.currentVelocity.x;

        this.recentPointerMovement.reset();

        // If this isn't interactive, we're just shutting down, so remove viewers without
        // animating.
        if(!interactive)
        {
            this.dragDistance = 0;
            this.cancelAnimation();
            this.removeViewers();
            return;
        }

        // The image was released interactively.  If we're not transitioning to a new
        // image, transition back to normal.
        if(draggedToViewer)
        {
            // Set latestNavigationDirectionDown to true if we're navigating forwards or false
            // if we're navigating backwards.  This is a hint for speculative loading.
            let oldMainIndex = this.mainViewerIndex;
            let newMainIndex = this._findViewerIndex(draggedToViewer);
            this.parent.latestNavigationDirectionDown = newMainIndex > oldMainIndex;

            // The drag was released and we're selecting draggedToViewer.  Make it active immediately,
            // without waiting for the animation to complete.  This lets the UI update quickly, and
            // makes it easier to handle quickly dragging multiple times.  We keep our viewer list until
            // the animation finishes.
            //
            // Take the main viewer to turn it into a preview.  It's in this.viewers, and this prevents
            // the screen from shutting it down when we activate the new viewer.
            this.parent.takeViewer();

            // Make our neighboring viewer primary.
            this.parent.showImageViewer({ newViewer: draggedToViewer });

            // Update the page URL to point to this viewer.
            let args = ppixiv.app.getMediaURL(draggedToViewer.mediaId);
            helpers.navigate(args, { addToHistory: false, sendPopstate: false });
        }

        let duration = 400;
        let animations = [];

        let mainViewerIndex = this.mainViewerIndex;
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            // This offset from the main viewer.  Viewers above are negative and below
            // are positive.
            let thisIdxd = idx - mainViewerIndex;

            // The animation starts at the current translateX.
            let startX = new DOMMatrix(getComputedStyle(viewer.root).transform).e;
            //let startX = this.getViewerX(idx);

            // Animate everything to their default positions relative to the main image.
            let endX = this.viewerDistance * thisIdxd;

            // Estimate a curve to match the fling.
            let easing = Bezier2D.findCurveForVelocity({
                distance: Math.abs(endX - startX),
                duration: duration / 1000, // in seconds
                targetVelocity: Math.abs(recentVelocity),
            });

            // If we're panning left but the user dragged right (or vice versa), that usually means we
            // dragged past the end into overscroll, and all we're doing is moving back in bounds.  Ignore
            // the drag velocity since it isn't related to our speed.
            if((endX > startX) != (recentVelocity > 0))
                easing = "ease-out";

            let animation = new DirectAnimation(new KeyframeEffect(viewer.root, [
                { transform: viewer.root.style.transform },
                { transform: `translateX(${endX}px)` },
            ], {
                duration,
                fill: "forwards",
                easing,
            }));
            animation.play();
            animations.push(animation);
        }

        this.dragDistance = 0;

        this.animations = animations;

        let animationsFinished = Promise.all(animations.map((animation) => animation.finished));

        try {
            // Wait for the animations to complete.
            await animationsFinished;
        } catch(e) {
            // If this fails, it should be from ondragstart cancelling the animations due to a
            // new touch.
            // console.error(e);
            return;
        }

        console.assert(this.animations === animations);
        this.animations = null;

        for(let animation of animations)
        {
            animation.commitStylesIfPossible();
            animation.cancel();
        }

        this.removeViewers();
    }
};
