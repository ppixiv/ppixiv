import WidgetDragger from '/vview/actors/widget-dragger.js';
import Actor from '/vview/actors/actor.js';
import { helpers, FixedDOMRect } from '/vview/misc/helpers.js';

// This handles dragging up from the top of the screen to return to the search on mobile.
export default class MobileImageDismiss extends Actor
{
    constructor({parent})
    {
        super({parent});

        this.dragger = new WidgetDragger({
            parent: this,
            name: "drag-to-exit",
            nodes: [
                this.parent.root,
                this.parent.querySelector(".fade-search"),
            ],
            dragNode: this.parent.root,
            size: () => this._dragDistance,

            animatedProperty: "--illust-hidden",
            animatedPropertyInverted: true,

            // We're hidden until setActive makes us visible.
            visible: false,
            direction: "up", // up to make visible, up to down
            duration: () => {
                return ppixiv.settings.get("animations_enabled")? 250:0;
            },

            // Don't do anything if the screen isn't active.
            confirmDrag: ({event}) => this.parent._active && ppixiv.mobile,
            onactive: () => {
                // Close the menu bar if it's open when a drag starts.
                if(this.parent.mobileIllustUi)
                    this.parent.mobileIllustUi.hide();

                this._configAnimation();
            },

            oninactive: () => {
                if(this.dragger.visible)
                {
                    // Scroll the search view to the current image when we're not animating.
                    this.scrollSearchToThumbnail();
                }
                else
                {
                    // We're no longer visible.  If the screen is still active, complete the navigation
                    // back to the search screen.  If the screen is already inactive then we're animating
                    // a navigation that has already happened (browser back).
                    if(this.parent._active)
                    {
                        let args = new helpers.args(this.parent.dataSource.searchUrl.toString());
                        ppixiv.app.navigateFromIllustToSearch(args);
                    }

                    // See if we want to remove the viewer now that the animation has finished.
                    this.parent.cleanupImage();
                }
            },
        });
    }

    get _dragDistance()
    {
        return document.documentElement.clientHeight * .5;
    }

    _configAnimation()
    {
        // If the view container is hidden, it may have transforms from the previous transition.
        // Unset the animation properties so this doesn't affect our calculations here.
        this.parent.root.style.setProperty("--animation-x", `0px`);
        this.parent.root.style.setProperty("--animation-y", `0px`);
        this.parent.root.style.setProperty("--animation-scale", "1");

        // This gives us the portion of the viewer which actually contains an image.  We'll
        // transition that region, so empty space is ignored by the transition.  If the viewer
        // doesn't implement this, just use the view bounds.
        let viewPosition = this.parent.viewer?.viewPosition;
        if(viewPosition)
        {
            // Move the view position to where the view actually is on the screen.
            let { left, top } = this.parent.viewer.root.getBoundingClientRect();
            viewPosition.x += left;
            viewPosition.y += top;
        }
        viewPosition ??= this.parent.root.getBoundingClientRect();

        // Try to position the animation to move towards the search thumbnail.
        let thumbRect = this._animationTargetRect;
        if(thumbRect)
        {
            // If the thumbnail is offscreen, ignore it.
            let center_y = thumbRect.top + thumbRect.height/2;
            if(center_y < 0 || center_y > window.innerHeight)
                thumbRect = null;
        }

        if(thumbRect == null)
        {
            // If we don't know where the thumbnail is, use a rect in the middle of the screen.
            let width = viewPosition.width * 0.75;
            let height = viewPosition.height * 0.75;
            let x = (window.innerWidth - width) / 2;
            let y = (window.innerHeight - height) / 2;
            thumbRect = new FixedDOMRect(x, y, x + width, y + height);
        }

        let { x, y, width, height } = viewPosition;
        let scale = Math.max(thumbRect.width / width, thumbRect.height / height);

        // Shift the center of the image to 0x0:
        let animationX = -(x + width/2) * scale;
        let animationY = -(y + height/2) * scale;

        // Align to the center of the thumb.
        animationX += thumbRect.x + thumbRect.width / 2;
        animationY += thumbRect.y + thumbRect.height / 2;

        this.parent.root.style.setProperty("--animation-x", `${animationX}px`);
        this.parent.root.style.setProperty("--animation-y", `${animationY}px`);
        this.parent.root.style.setProperty("--animation-scale", scale);
    }

    // Return the rect we'll want to transition towards, if known.
    get _animationTargetRect()
    {
        return ppixiv.app.getRectForMediaId(this.parent._wantedMediaId);
    }

    // The screen was set active or inactive.
    activate({cause})
    {
        // Run the show animation if we're not shown, or if we're currently hiding.
        if(!this.dragger.visible || !this.dragger.isAnimatingToShown)
        {
            // Skip the animation if this is a new page load rather than a transition from
            // something else.
            let transition = cause != "initialization";
            this.dragger.show({transition});

            // If we're transitioning scrollSearchToThumbnail will be called when the transition
            // finishes.  That won't happen if we're not transitioning, so do it now.
            if(!transition)
                this.scrollSearchToThumbnail();
        }
    }

    deactivate()
    {
        if(this.dragger.visible)
            this.dragger.hide();
    }

    get isAnimating()
    {
        return this.dragger.isAnimationPlaying;
    }

    // Return a promise that resolves when there's no animation running, or null if
    // no animation is active.
    get waitForAnimationsPromise()
    {
        return this.dragger.finished;
    }

    // Scroll the thumbnail onscreen in the search view if the search isn't currently visible.
    scrollSearchToThumbnail()
    {
        if(this.isAnimating || !this.parent.active || this.dragger.position < 1)
            return;

        ppixiv.app.scrollSearchToMediaId(this.parent.dataSource, this.parent._wantedMediaId);
    }
}
