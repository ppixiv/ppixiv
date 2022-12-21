import { helpers } from 'vview/ppixiv-imports.js';

// This handles dragging up from the top of the screen to return to the search on mobile.
export default class MobileImageDismiss
{
    constructor({parent})
    {
        this.parent = parent;

        this.dragger = new ppixiv.WidgetDragger({
            name: "drag-to-exit",
            node: [
                this.parent.container,
                this.parent.querySelector(".fade-search"),
            ],
            drag_node: this.parent.container,
            size: () => this._dragDistance,

            animated_property: "--illust-hidden",
            animated_property_inverted: true,

            // We're hidden until set_active makes us visible.
            visible: false,
            direction: "down", // down to make visible, up to hide
            duration: () => {
                return ppixiv.settings.get("animations_enabled")? 250:0;
            },
            size: 500,
            confirm_drag: ({event}) => {
                // Don't do anything if the screen isn't active.
                if(!this.parent._active || !ppixiv.mobile)
                    return false;

                return Math.abs(event.movementY) > Math.abs(event.movementX);
            },

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
                        let args = new helpers.args(this.parent.data_source.search_url.toString());
                        ppixiv.app.navigate_from_image_to_search(args);
                    }

                    // See if we want to remove the viewer now that the animation has finished.
                    this.parent.cleanupImage();
                }
            },
        });
    }

    get _dragDistance()
    {
        return document.documentElement.clientHeight * .25;
    }

    _configAnimation()
    {
        // In case the image wasn't available when we tried to scroll to it, try again now.
        // Either this will scroll to the image and we can use its position, or we know it
        // isn't in the list.
        this.scrollSearchToThumbnail();

        // If the view container is hidden, it may have transforms from the previous transition.
        // Unset the animation properties so this doesn't affect our calculations here.
        this.parent.container.style.setProperty("--animation-x", `0px`);
        this.parent.container.style.setProperty("--animation-y", `0px`);
        this.parent.container.style.setProperty("--animation-scale", "1");

        // This gives us the portion of the viewer which actually contains an image.  We'll
        // transition that region, so empty space is ignored by the transition.  If the viewer
        // doesn't implement this, just use the view bounds.
        let viewPosition = this.parent.viewer?.viewPosition;
        if(viewPosition)
        {
            // Move the view position to where the view actually is on the screen.
            let { left, top } = this.parent.viewer.container.getBoundingClientRect();
            viewPosition.x += left;
            viewPosition.y += top;
        }
        viewPosition ??= this.parent.container.getBoundingClientRect();

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
            let y =  (window.innerHeight - height) / 2;
            thumbRect = new ppixiv.FixedDOMRect(x, y, x + width, y + height);
        }

        let { x, y, width, height } = viewPosition;
        let scale = Math.max(thumbRect.width / width, thumbRect.height / height);

        // Shift the center of the image to 0x0:
        let animation_x = -(x + width/2) * scale;
        let animation_y = -(y + height/2) * scale;

        // Align to the center of the thumb.
        animation_x += thumbRect.x + thumbRect.width / 2;
        animation_y += thumbRect.y + thumbRect.height / 2;

        this.parent.container.style.setProperty("--animation-x", `${animation_x}px`);
        this.parent.container.style.setProperty("--animation-y", `${animation_y}px`);
        this.parent.container.style.setProperty("--animation-scale", scale);
    }

    // Return the rect we'll want to transition towards, if known.
    get _animationTargetRect()
    {
        if(this.parent._wantedMediaId == null)
            return null;

        return ppixiv.app.getRectForMediaId(this.parent._wantedMediaId);
    }

    // The screen was set active or inactive.
    activate()
    {
        // Run the show animation if we're not shown, or if we're currently hiding.
        if(!this.dragger.visible || !this.dragger.animating_to_shown)
            this.dragger.show();
    }

    deactivate()
    {
        if(this.dragger.visible)
            this.dragger.hide();
    }

    get isAnimating()
    {
        return this.dragger.animation_playing;
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

        ppixiv.app.scrollSearchToMediaId(this.parent.data_source, this.parent._wantedMediaId);
    }
}