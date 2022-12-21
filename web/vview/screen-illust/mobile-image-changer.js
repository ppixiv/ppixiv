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
        this.recent_pointer_movement = new FlingVelocity({
            sample_period: 0.150,
        });

        // The amount we've dragged.  This is relative to the main image, so it doesn't need to
        // be adjusted when we add or remove viewers.
        this.drag_distance = 0;

        // A list of viewers that we're dragging between.  This always includes the main viewer
        // which is owned by the screen.
        this.viewers = [];
        this.addingViewer = false;
        this.animations = null;

        // Once we reach the left and right edge, this is set to the minimum and maximum value
        // of this.drag_distance.
        this.bounds = [null, null];

        this.dragger = new DragHandler({
            name: "image-changer",
            element: this.container,
            confirm_drag: ({event}) => {
                // Stop if there's no image, if the screen wasn't able to load one.
                if(this.mainViewer == null)
                    return false;

                if(helpers.should_ignore_horizontal_drag(event))
                    return false;

                return true;
            },

            ondragstart: (args) => this.ondragstart(args),
            ondrag: (args) => this.ondrag(args),
            ondragend: (args) => this.ondragend(args),
            deferred_start: () => {
                // If an animation is running, disable deferring drags, so grabbing the dragger will
                // stop the animation.  Otherwise, defer drags until the first pointermove (the normal
                // behavior).
                return this.animations == null && this.drag_distance == 0;
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

    get container() { return this.parent.container; }

    // The main viewer is the one active in the screen.  this.drag_distance is relative to
    // it, and it's always in this.viewers during drags.
    get mainViewer() { return this.parent.viewer; }

    // The image changed externally or the screen is becoming inactive, so stop any drags and animations.
    stop()
    {
        this.dragger.cancel_drag();
        this.cancelAnimation();
    }

    ondragstart({event})
    {
        // If we aren't grabbing a running drag, only start if the initial movement was horizontal.
        if(this.animations == null && this.drag_distance == 0 && Math.abs(event.movementY) > Math.abs(event.movementX))
            return false;

        this.drag_distance = 0;
        this.recent_pointer_movement.reset();
        this.bounds = [null, null];

        if(this.animations == null)
        {
            // We weren't animating, so this is a new drag.  Start the list off with the main viewer.
            this.viewers = [this.mainViewer];
            return true;
        }

        // Another drag started while the previous drag's transition was still happening.
        // Stop the animation, and set the drag_distance to where the animation was stopped.
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

        // If a drag is active, set drag_distance to the X position of the main viewer to match
        // the drag to where the animation was.
        if(this.drag_distance != null && this.mainViewer)
        {
            let main_transform = new DOMMatrix(getComputedStyle(this.mainViewer.container).transform);
            this.drag_distance = main_transform.e; // X translation
            this.refreshDragPosition();
        }

        // Remove the animations.
        for(let animation of animations)
            animation.cancel();
    }

    ondrag({event, first})
    {
        let x = event.movementX;
        this.recent_pointer_movement.add_sample({ x });

        // If we're past the end, apply friction to indicate it.  This uses stronger overscroll
        // friction to make it distinct from regular image panning overscroll.
        let overscroll = 1;
        if(this.bounds[0] != null && this.drag_distance > this.bounds[0])
        {
            let distance = Math.abs(this.bounds[0] - this.drag_distance);
            overscroll = Math.pow(0.97, distance);
        }

        if(this.bounds[1] != null && this.drag_distance < this.bounds[1])
        {
            let distance = Math.abs(this.bounds[1] - this.drag_distance);
            overscroll = Math.pow(0.97, distance);
        }
        x *= overscroll;

        // The first pointer input after a touch may be thresholded by the OS trying to filter
        // out slight pointer movements that aren't meant to be drags.  This causes the very
        // first movement to contain a big jump on iOS, causing drags to jump.  Count this movement
        // towards fling sampling, but skip it for the visual drag.
        if(!first)
            this.drag_distance += x;
        this._addViewersIfNeeded();
        this.refreshDragPosition();
    }

    getViewerX(viewer_index)
    {
        // This offset from the main viewer.  Viewers above are negative and below
        // are positive.
        let relative_idx = viewer_index - this.mainViewerIndex;

        let x = this.viewerDistance * relative_idx;
        x += this.drag_distance;
        return x;
    }

    // Update the positions of all viewers during a drag.
    refreshDragPosition()
    {
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            let x = this.getViewerX(idx);
            viewer.container.style.transform = `translateX(${x}px)`;
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
        // If we're already adding a viewer, don't try to add another until it finishes.
        if(this.addingViewer)
            return;

        let drag_threshold = 5;

        // See if we need to add another viewer in either direction.
        //
        // The right edge of the leftmost viewer, including the gap between images.  If this is
        // 0, it's just above the screen.
        let left_viewer_edge = this.getViewerX(-1) + this.viewerDistance;
        let add_forwards = null;
        if(left_viewer_edge > drag_threshold)
            add_forwards = false;

        // The left edge of the rightmost viewer.
        let right_viewer_edge = this.getViewerX(this.viewers.length) - this.imageGap;
        if(right_viewer_edge < window.innerWidth - drag_threshold)
            add_forwards = true;

        // If the user drags multiple times quickly, the drag target may be past the end.
        // Add a viewer for it as soon as it's been dragged to, even though it may be well
        // off-screen, so we're able to transition to it.
        let target_viewer_index = this.currentDragTarget();
        if(target_viewer_index < 0)
            add_forwards = false;
        else if(target_viewer_index >= this.viewers.length)
            add_forwards = true;

        // Stop if we're not adding a viewer.
        if(add_forwards == null)
            return;

        // Capture the viewers list, so we always work with this list if this.viewers gets reset
        // while we're loading.
        let viewers = this.viewers;

        // The viewer ID we're adding next to:
        let neighborViewer = viewers[add_forwards? viewers.length-1:0];
        let neighborMediaId = neighborViewer.mediaId;

        this.addingViewer = true;
        let mediaId, earlyIllustData;
        try {
            // Get the next or previous media ID.
            mediaId = await this.parent.getNavigation(add_forwards, { navigate_from_media_id: neighborMediaId });
            if(mediaId != null)
                earlyIllustData = await ppixiv.media_cache.get_media_info(mediaId, { full: false });
        } finally {
            // Stop if the viewer list changed while we were loading.
            if(this.viewers !== viewers)
                return;
        }

        this.addingViewer = false;

        if(mediaId == null)
        {
            // There's nothing in this direction, so remember that this is the boundary.  Once we
            // do this, overscroll will activate in this direction.
            if(add_forwards)
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
        viewers.splice(add_forwards? viewers.length:0, 0, viewer);

        // Set the initial position.
        this.refreshDragPosition();        
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

        // Clear addingViewer.  If an _addViewersIfNeeded call is running, it'll see that
        // this.viewers changed and stop.
        this.addingViewer = false;
    }

    // Get the viewer index that we'd want to go to if the user released the drag now.
    // This may be past the end of the current viewer list.
    currentDragTarget()
    {
        // If the user flung horizontally, move relative to the main viewer.
        let recent_velocity = this.recent_pointer_movement.current_velocity.x;
        let threshold = 200;
        if(Math.abs(recent_velocity) > threshold)
        {
            if(recent_velocity > threshold)
                return this.mainViewerIndex - 1;
            else if(recent_velocity < -threshold)
                return this.mainViewerIndex + 1;
        }

        // There hasn't been a fling recently, so land on the viewer which is closest to
        // the middle of the screen.  If the screen is dragged down several times quickly
        // and we're animating to an offscreen main viewer, and the user stops the
        // animation in the middle, this stops us on a nearby image instead of continuing
        // to where we were going before.
        let closest_viewer_index = 0;
        let closest_viewer_distance = 999999;
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let x = this.getViewerX(idx);
            let center = x + window.innerWidth/2;
            let distance = Math.abs((window.innerWidth / 2) - center);
            if(distance < closest_viewer_distance)
            {
                closest_viewer_distance = distance;
                closest_viewer_index = idx;
            }
        }

        return closest_viewer_index;
    }

    // A drag finished.  See if we should transition the image or undo.
    //
    // interactive is true if this is the user releasing it, or false if we're shutting
    // down during a drag.  cancel is true if this was a cancelled pointer event.
    async ondragend({interactive, cancel}={})
    {
        let dragged_to_viewer = null;
        if(interactive && !cancel)
        {
            let target_viewer_index = this.currentDragTarget();
            if(target_viewer_index >= 0 && target_viewer_index < this.viewers.length)
                dragged_to_viewer = this.viewers[target_viewer_index];
        }

        // If we start a fling from this release, this is the velocity we'll try to match.
        let recent_velocity = this.recent_pointer_movement.current_velocity.x;

        this.recent_pointer_movement.reset();

        // If this isn't interactive, we're just shutting down, so remove viewers without
        // animating.
        if(!interactive)
        {
            this.drag_distance = 0;
            this.cancelAnimation();
            this.removeViewers();
            return;
        }

        // The image was released interactively.  If we're not transitioning to a new
        // image, transition back to normal.
        if(dragged_to_viewer)
        {
            // Set latestNavigationDirectionDown to true if we're navigating forwards or false
            // if we're navigating backwards.  This is a hint for speculative loading.
            let old_main_index = this.mainViewerIndex;
            let new_main_index = this._findViewerIndex(dragged_to_viewer);
            this.parent.latestNavigationDirectionDown = new_main_index > old_main_index;

            // The drag was released and we're selecting dragged_to_viewer.  Make it active immediately,
            // without waiting for the animation to complete.  This lets the UI update quickly, and
            // makes it easier to handle quickly dragging multiple times.  We keep our viewer list until
            // the animation finishes.
            //
            // Take the main viewer to turn it into a preview.  It's in this.viewers, and this prevents
            // the screen from shutting it down when we activate the new viewer.
            this.parent.takeViewer();

            // Make our neighboring viewer primary.
            this.parent.showImageViewer({ newViewer: dragged_to_viewer });
        }

        let duration = 400;
        let animations = [];

        let mainViewerIndex = this.mainViewerIndex;
        for(let idx = 0; idx < this.viewers.length; ++idx)
        {
            let viewer = this.viewers[idx];

            // This offset from the main viewer.  Viewers above are negative and below
            // are positive.
            let this_idx = idx - mainViewerIndex;

            // The animation starts at the current translateX.
            let start_x = new DOMMatrix(getComputedStyle(viewer.container).transform).e;
            //let start_x = this.getViewerX(idx);

            // Animate everything to their default positions relative to the main image.
            let end_x = this.viewerDistance * this_idx;

            // Estimate a curve to match the fling.
            let easing = Bezier2D.find_curve_for_velocity({
                distance: Math.abs(end_x - start_x),
                duration: duration / 1000, // in seconds
                target_velocity: Math.abs(recent_velocity),
            });

            // If we're panning left but the user dragged right (or vice versa), that usually means we
            // dragged past the end into overscroll, and all we're doing is moving back in bounds.  Ignore
            // the drag velocity since it isn't related to our speed.
            if((end_x > start_x) != (recent_velocity > 0))
                easing = "ease-out";

            let animation = new DirectAnimation(new KeyframeEffect(viewer.container, [
                { transform: viewer.container.style.transform },
                { transform: `translateX(${end_x}px)` },
            ], {
                duration,
                fill: "forwards",
                easing,
            }));
            animation.play();
            animations.push(animation);
        }

        this.drag_distance = 0;

        this.animations = animations;

        let animations_finished = Promise.all(animations.map((animation) => animation.finished));

        try {
            // Wait for the animations to complete.
            await animations_finished;
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
