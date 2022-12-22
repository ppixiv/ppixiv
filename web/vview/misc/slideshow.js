// This handles the nitty slideshow logic for ViewerImages.
//
// Slideshows can be represented as pans, which is the data editing_pan edits
// and that we save to images.  This data is resolution and aspect-ratio independant,
// so it can be applied to different images and used generically.
//
// Slideshows are built into animations using getAnimation, which converts it
// to an animation based on the image's aspect ratio, the screen's aspect ratio,
// the desired speed, etc.
import { helpers } from 'vview/misc/helpers.js';

export default class Slideshow
{
    constructor({
        // The size of the image being displayed:
        width, height,

        // The size of the window:
        containerWidth, containerHeight,

        // The minimum zoom level to allow:
        minimumZoom,

        // One of "slideshow", "loop" or "auto-pan".
        mode,

        // The slideshow is normally clamped to the window.  This can be disabled by the
        // editor.
        clampToWindow=true,
    })
    {
        this.width = width;
        this.height = height;
        this.containerWidth = containerWidth;
        this.containerHeight = containerHeight;
        this.minimumZoom = minimumZoom;
        this.mode = mode;
        this.clampToWindow = clampToWindow;
    }

    // Create the default animation.
    getDefaultAnimation()
    {
        if(this.mode == "slideshow")
        {
            let slideshow_default = ppixiv.settings.get("slideshow_default", "pan");
            if(slideshow_default == "contain")
                return this.getAnimation(Slideshow.pans.stationary);
            else    
                return this.getAnimation(Slideshow.pans.default_slideshow);
        }

        // Choose whether to use the horizontal or vertical depending on how the image fits the screen.
        // panRatio is < 1 if the image can pan vertically and > 1 if it can pan horizontally.
        let imageAspectRatio = this.width / this.height;
        let containerAspectRatio = this.containerWidth / this.containerHeight;
        let panRatio = imageAspectRatio / containerAspectRatio;

        // If the image can move horizontally in the display, use the horizontal pan.  Don't use it
        // if panRatio is too close to 1 (the image fits the screen), since it doesn't zoom and will
        // be stationary.
        let horizontal = panRatio > 1.1;
        if(containerAspectRatio < 1)
        {
            // If the monitor and image are both portrait, the portrait animation usually looks better,
            // even if the image is less portrait than the monitor and panRatio is > 1.  Use a higher
            // threshold for portrait monitors so we prefer the portrait animation, even if it cuts off
            // some of the image.
            horizontal = panRatio > 1.5;
        }

        let template = horizontal? 
            Slideshow.pans.default_slideshow_hold_landscape:
            Slideshow.pans.default_slideshow_hold_portrait;

        return this.getAnimation(template);
    }

    static pans =
    {
        // Zoom from the bottom-left to the top-right, with a slight zoom-in at the beginning.
        // For most images, either the horizontal or vertical part of the pan is usually dominant
        // and the other goes away, depending on the aspect ratio.  The zoom keeps the animation
        // from being completely linear.  We don't move all the way to the top, since for many
        // portrait images that's too far and causes us to pan past the face, fading away while
        // looking at the background.
        //
        // This gives a visually interesting slideshow that works well for most images, and isn't
        // very sensitive to aspect ratio and usually does something reasonable whether the image
        // or monitor are in landscape or portrait.
        default_slideshow: Object.freeze({
            start_zoom: 1.25,
            end_zoom: 1,
            x1: 0,    y1: 1,
            x2: 1,    y2: 0.1,
        }),

        // The default animations for slideshow-hold mode.  If the image can move vertically,
        // use a vertical pan with a slight zoom.  Otherwise, use a horizontal pan with no zoom.
        default_slideshow_hold_portrait: Object.freeze({
            start_zoom: 1.10,
            end_zoom: 1.00,
            x1: 0.5,    y1: 0.1,
            x2: 0.5,    y2: 1.0,
        }),

        default_slideshow_hold_landscape: Object.freeze({
            x1: 0,     y1: 0.5,
            x2: 1,     y2: 0.5,
        }),

        // Display the image statically without panning.
        stationary: Object.freeze({
            start_zoom: 0,
            end_zoom: 0,
            x1: 0.5, y1: 0,
            x2: 0.5, y2: 0,
        }),
    }

    // Load a saved animation from a description, which is either created with PanEditor or
    // programmatically here.  If pan is null, return the default animation for the current
    // mode.
    getAnimation(pan)
    {
        if(pan == null)
            return this.getDefaultAnimation();

        // The target duration of the animation:
        let duration = 
            (this.mode == "slideshow" || this.mode == "loop")? ppixiv.settings.get("slideshow_duration"):
            ppixiv.settings.get("auto_pan_duration");

        // If we're viewing a very wide or tall image, such as a 1:20 manga strip, it's useful
        // to clamp the speed of the animation.  If this is a 3-second pan, the image would
        // fly past too quickly to see.  To adjust for this, we set a maximum speed based on
        // the duration.
        //
        // Scale the max speed based on the duration.  With a 5-second duration or less, allow the
        // image to move half a screen per second.  At 15 seconds or more, slow it down to no more
        // than a quarter screen per second.
        //
        // This usually only has an effect for exceptionally wide images.  Most of the time the
        // maximum speed ends up being much lower than the actual speed, and we use the duration
        // as-is.
        let maxSpeed = helpers.scaleClamp(duration, 5, 15, 0.5, 0.25);

        let animationData = {
            duration, maxSpeed,

            pan: [{
                x: pan.x1, y: pan.y1, zoom: pan.start_zoom ?? 1,
                anchor_x: pan.anchor?.left ?? 0.5,
                anchor_y: pan.anchor?.top ?? 0.5,
            }, {
                x: pan.x2, y: pan.y2, zoom: pan.end_zoom ?? 1,
                anchor_x: pan.anchor?.right ?? 0.5,
                anchor_y: pan.anchor?.bottom ?? 0.5,
            }],
        };
        
        let animation = this._prepareAnimation(animationData);

        // Decide how to ease this animation.
        if(this.mode == "slideshow")
        {
            // In slideshow mode, we always fade through black, so we don't need any easing on the
            // transition.
            animation.ease = "linear";
        }
        else if(this.mode == "auto-pan")
        {
            // There's no fading in auto-pan mode.  Use an ease-out transition, so we start
            // quickly and decelerate at the end.  We're jumping from another image anyway
            // so an ease-in doesn't seem needed.
            //
            // A standard ease-out is (0, 0, 0.58, 1).  We can change the strength of the effect
            // by changing the third value, becoming completely linear when it reaches 1.  Reduce
            // the ease-out effect as the duration gets longer, since longer animations don't need
            // the ease-out as much (they're already slow), so we have more even motion.
            let factor = helpers.scaleClamp(animation.duration, 5, 15, 0.58, 1);
            animation.ease = `cubic-bezier(0.0, 0.0, ${factor}, 1.0)`;
        }
        else if(this.mode == "loop")
        {
            // Similar to auto-pan, but using an ease-in-out transition instead, and we always keep
            // some easing around even for very long animations.
            let factor = helpers.scaleClamp(animation.duration, 5, 15, 0.58, 0.90);
            animation.ease = `cubic-bezier(${1-factor}, 0.0, ${factor}, 1.0)`;
        }        

        // Choose a fade duration.  This needs to be quicker if the slideshow is very brief.
        animation.fadeIn = this.mode == "loop" || this.mode == "slideshow"? Math.min(duration * 0.1, 2.5):0;
        animation.fadeOut = this.mode == "slideshow"? Math.min(duration * 0.1, 2.5):0;
        
        // If the animation is shorter than the total fade, remove the fade.
        if(animation.fadeIn + animation.fadeOut > animation.duration)
            animation.fadeIn = animation.fadeOut = 0;

        // For convenience, create KeyframeEffect data.
        let points = [];
        for(let point of animation.pan)
            points.push(`translateX(${point.tx}px) translateY(${point.ty}px) scale(${point.scale})`);

        animation.keyframes = [
            {
                transform: points[0],
                easing: animation.ease ?? "ease-out",
            }, {
                transform: points[1],
            }
        ];
    
        return animation;
    }

    // Prepare an animation.  This figures out the actual translate and scale for each
    // keyframe, and the total duration.  The results depend on the image and window
    // size.
    _prepareAnimation(animation)
    {
        // Calculate the scale and translate for each point.
        let pan = [];
        for(let point of animation.pan)
        {
            // Don't let the zoom level go below this.minimumZoom.  This is usually the zoom
            // level where the image covers the screen, and going lower would leave part of
            // the screen blank.
            let scale = Math.max(point.zoom, this.minimumZoom);

            // The screen size the image will have:
            let zoomedWidth = this.width * scale;
            let zoomedHeight = this.height * scale;

            // Initially, the image will be aligned to the top-left of the screen.  Shift right and
            // down to align the anchor the origin.  This is usually the center of the image.
            let { anchor_x=0.5, anchor_y=0.5 } = point;
            let tx = this.containerWidth * anchor_x;
            let ty = this.containerHeight * anchor_y;

            // Then shift up and left to center the point:
            tx -= point.x*zoomedWidth;
            ty -= point.y*zoomedHeight;

            if(this.clampToWindow)
            {
                // Clamp the translation to keep the image in the window.  This is inverted, since
                // tx and ty are transitions and not the image position.
                let maxX = zoomedWidth - this.containerWidth,
                    maxY = zoomedHeight - this.containerHeight;
                tx = helpers.clamp(tx, 0, -maxX);
                ty = helpers.clamp(ty, 0, -maxY);

                // If the image isn't filling the screen on either axis, center it.  This only applies at
                // keyframes (we won't always be centered while animating).
                if(zoomedWidth < this.containerWidth)
                    tx = (this.containerWidth - zoomedWidth) / 2;
                if(zoomedHeight < this.containerHeight)
                    ty = (this.containerHeight - zoomedHeight) / 2;
            }

            pan.push({ tx, ty, zoomedWidth, zoomedHeight, scale });
        }

        // speed is relative to the screen size, so it's not tied too tightly to the resolution
        // of the window.  A speed of 1 means we want one diagonal screen size per second.
        //
        // The animation might be translating, or it might be anchored to one corner and just zooming.  Treat
        // movement speed as the maximum distance any corner is moving.  For example, if we're anchored
        // in the top-left corner and zooming, the top-left corner is stationary, but the bottom-right
        // corner is moving.  Use the maximum amount any individual corner is moving as the speed.
        let corners = [];
        for(let idx = 0; idx < 2; ++idx)
        {
            // The bounds of the image at each corner:
            corners.push([
                { x: -pan[idx].tx,                         y: -pan[idx].ty },
                { x: -pan[idx].tx,                         y: -pan[idx].ty + pan[idx].zoomedHeight },
                { x: -pan[idx].tx + pan[idx].zoomedWidth, y: -pan[idx].ty },
                { x: -pan[idx].tx + pan[idx].zoomedWidth, y: -pan[idx].ty + pan[idx].zoomedHeight },
            ]);
        }

        let distanceInPixels = 0;
        for(let corner = 0; corner < 4; ++corner)
        {
            let distance = helpers.distance(corners[0][corner], corners[1][corner]);
            distanceInPixels = Math.max(distanceInPixels, distance);
        }

        // The diagonal size of the screen is what our speed is relative to.
        let screenSize = helpers.distance({x: 0, y: 0}, { x: this.containerHeight, y: this.containerWidth });

        // Calculate the duration for keyframes that specify a speed.
        let duration = animation.duration;
        if(animation.maxSpeed != null)
        {
            // pixelsPerSecond is the speed we'll move at the given speed.  Note that this ignores
            // easing, and we'll actually move faster or slower than this during the transition.
            let speed = Math.max(animation.maxSpeed, 0.01);
            let pixelsPerSecond = speed * screenSize;
            let adjustedDuration = distanceInPixels / pixelsPerSecond;

            // If both speed and a duration were specified, use whichever is slower.
            duration = Math.max(animation.duration, adjustedDuration);

            // If we set the speed to 0, then we're not moving at all.  Set a small duration
            // to avoid division by zero.
            if(duration == 0)
                duration = 0.1;
        }

        return {
            pan,
            duration,
        };
    }

    static makeFadeIn(target, options)
    {
        return new Animation(new KeyframeEffect(
            target, [
                { opacity: 0, offset: 0 },
                { opacity: 1, offset: 1 },
            ], {
                fill: 'forwards',
                ...options
            }
        ));
    }

    static makeFadeOut(target, options)
    {
        return new Animation(new KeyframeEffect(
            target, [
                { opacity: 1, offset: 0 },
                { opacity: 0, offset: 1 },
            ], {
                fill: 'forwards',
                ...options
            }
        ));
    }
}
