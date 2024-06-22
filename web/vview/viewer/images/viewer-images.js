import Widget from '/vview/widgets/widget.js';
import Viewer from '/vview/viewer/viewer.js';
import ImageEditor from '/vview/viewer/images/editing.js';
import ImageEditingOverlayContainer from '/vview/viewer/images/editing-overlay-container.js';
import Slideshow from '/vview/misc/slideshow.js';
import LocalAPI from '/vview/misc/local-api.js';
import DirectAnimation from '/vview/actors/direct-animation.js';
import { helpers, FixedDOMRect, OpenWidgets, GuardedRunner } from '/vview/misc/helpers.js';

// This is the viewer for static images.
//
// The base class for the main low-level image viewer.  This handles loading images,
// and the mechanics for zoom and pan.  The actual zoom and pan UI is handled by the
// desktop and mobile subclasses.
//
// We use two coordinate systems:
//
// - Image coordinates are unit coordinates, with 0x0 in the top-left and 1x1 in the bottom-right.
// - View coordinates, with 0x0 in the top-left of the view.  On desktop, this is usually
// the same as the window, but it doesn't have to be (on mobile it may be adjusted to avoid
// the statusbar).
//
// All sizing is relative to the view, so for most things we only need to know the aspect ratio
// of the image and not its resolution.  This allows us to start viewing a thumbnail and then
// transition cleanly into viewing the full-size size when we only know the thumbnail's resolution.
export default class ViewerImages extends Viewer
{
    constructor({
        // If set, this is a function returning a promise which resolves when any transitions
        // are complete.  We'll wait until this resolves before switching to the full image to
        // reduce frame skips.
        waitForTransitions=() => { },
        ...options
    })
    {
        super({...options, template: `
            <div class="viewer viewer-images">
                <div class=rounded-box>
                    <div class=rounded-box-reposition>
                        <div class=image-box>
                            <div class=crop-box></div>
                        </div>
                    </div>
                </div>
            </div>
        `});

        this._waitForTransitions = waitForTransitions;

        this._imageBox = this.root.querySelector(".image-box");
        this._cropBox = this.root.querySelector(".crop-box");

        this._refreshImageRunner = new GuardedRunner(this._signal);

        this._imageAspectRatio = 1;

        // The size of the real image, or null if we don't know it yet.
        this._actualWidth = null;
        this._actualHeight = null;
        this._ranPanAnimation = false;
        this._centerPos = [0, 0];
        this._dragMovement = [0,0];
        this._animations = { };

        // Restore the most recent zoom mode.
        let enabled = ppixiv.settings.get("zoom-mode") == "locked";
        let level = ppixiv.settings.get("zoom-level", "cover");
        this.setZoom({ enabled, level });

        this._imageContainer = new ImagesContainer({ container: this._cropBox });
        this._editingContainer = new ImageEditingOverlayContainer({
            container: this._cropBox,
        });

        // Use a ResizeObserver to update our size and position if the window size changes.
        let resizeObserver = new ResizeObserver(this._onresize);
        resizeObserver.observe(this.root);
        this.shutdownSignal.addEventListener("abort", () => resizeObserver.disconnect());

        this.root.addEventListener("dragstart", (e) => {
            if(!e.shiftKey)
                e.preventDefault();
        }, this._signal);
        this.root.addEventListener("selectstart", (e) => e.preventDefault(), this._signal);

        // Start or stop panning if the user changes it while we're active, eg. by pressing ^P.
        ppixiv.settings.addEventListener("auto_pan", () => {
            // Allow the pan animation to start again when the auto_pan setting changes.
            this._ranPanAnimation = false;
            this._refreshAnimation();
        }, this._signal);
        ppixiv.settings.addEventListener("slideshow_duration", this._refreshAnimationSpeed, this._signal);
        ppixiv.settings.addEventListener("auto_pan_duration", this._refreshAnimationSpeed, this._signal);

        // This is like pointermove, but received during quick view from the source tab.
        window.addEventListener("quickviewpointermove", this._quickviewpointermove, this._signal);

        // We pause changing to the next slideshow image UI widgets are open.  Check if we should continue
        // when the open widget list changes.
        OpenWidgets.singleton.addEventListener("changed", () => this._checkAnimationFinished(), this._signal);

        ppixiv.mediaCache.addEventListener("mediamodified", ({mediaId}) => this._mediaInfoModified({mediaId}), this._signal);
        ppixiv.settings.addEventListener("upscaling", () => this._refreshFromMediaInfo(), this._signal);
        ppixiv.imageTranslations.addEventListener("translation-urls-changed", () => this._refreshFromMediaInfo(), this._signal);

        // Create the inpaint editor.
        if(!ppixiv.mobile)
        {
            this._imageEditor = new ImageEditor({
                container: this.root,
                parent: this,
                overlayContainer: this._editingContainer,
                onvisibilitychanged: () => { this.refresh(); }, // refresh when crop editing is changed
            });
        }
    }

    async load()
    {
        let {
            // If true, restore the pan/zoom position from history.  If false, reset the position
            // for a new image.
            restoreHistory=false,

            // If set, we're in slideshow mode.  We'll always start an animation, and image
            // navigation will be disabled.  This can be null, "slideshow", or "loop".
            slideshow=false,
            onnextimage=null,
        } = this.options;

        this._shouldRestoreHistory = restoreHistory;
        this._slideshowMode = slideshow;
        this._onnextimage = onnextimage;

        // Tell the inpaint editor about the image.
        if(this._imageEditor)
            this._imageEditor.setMediaId(this.mediaId);

        // Refresh from whatever image info is already available.
        this._refreshFromMediaInfo();

        // Load full info if it wasn't already loaded.
        await ppixiv.mediaCache.getMediaInfo(this.mediaId);

        // Stop if we were shutdown while we were async.
        if(this.shutdownSignal.aborted)
            return;

        // In case we only had preview info, refresh with the info we just loaded.
        this._refreshFromMediaInfo();
    }

    // If media info changes, refresh in case any image URLs have changed.
    _mediaInfoModified({mediaId})
    {
        if(mediaId != this.mediaId)
            return;

        this._refreshFromMediaInfo();
    }

    refresh()
    {
        this._refreshFromMediaInfo();
    }

    // Update this._image with as much information as we have so far and refresh the image.
    _refreshFromMediaInfo()
    {
        let imageInfo = this._getCurrentMediaInfo();
        if(imageInfo == null)
            return;

        let { mediaInfo } = imageInfo;

        // If width is null, we only have the aspect ratio and not the actual size.
        let haveActualResolution = imageInfo.width != null;

        // If we're in "actual" zoom, we can't display anything until we have the real image
        // resolution.
        if(this.zoomActive && this._zoomLevel == "actual" && !haveActualResolution)
            return;

        // Get the pan and crop.
        let { pan, crop } = ppixiv.mediaCache.getExtraData(mediaInfo, this.mediaId);

        // Cropping is saved based on the real resolution, so if we have cropping, don't display
        // anything until we know the actual resolution.
        if(crop && !haveActualResolution)
            return;

        // Update any custom pan created by PanEditor.
        this._custom_animation = pan;

        // Disable cropping if the crop editor is active.
        if(this._imageEditor?.editingCrop)
            crop = null;

        let croppedSize = crop && crop.length == 4? new FixedDOMRect(crop[0], crop[1], crop[2], crop[3]):null;

        // If this is the real image size and not the thumbnail, store it.  Once we have this, "actual"
        // zoom mode is available.
        if(imageInfo.width != null)
        {
            this._actualWidth = imageInfo.width;
            this._actualHeight = imageInfo.height;
        }

        // Set _imageAspectRatio.  Use the crop size if we have one, otherwise the aspect ratio
        // we got from imageInfo.
        this._imageAspectRatio = imageInfo.aspectRatio;
        if(croppedSize)
            this._imageAspectRatio = croppedSize.width / croppedSize.height; 

        // Set the size of the crop box.
        this._updateCrop(croppedSize);

        // Set the size of the image box and crop.
        this._setImageBoxSize();

        // Set the initial zoom and image position if we haven't yet.
        if(!this._initialPositionSet)
        {
            this._setInitialImagePosition(this._shouldRestoreHistory);
            this._initialPositionSet = true;
        }

        this._reposition();

        // Start refreshing the image with this data.
        let { url, previewUrl, inpaintUrl } = imageInfo;

        // Get the translation overlay URL if we have one.
        let translationUrl = ppixiv.imageTranslations.getTranslationUrl(this.mediaId);
        
        this._refreshImageRunner.call(this._refreshImage.bind(this), { url, previewUrl, translationUrl, inpaintUrl });
    }

    // Return what we know of:
    //
    // { mediaInfo, url, previewUrl, inpaintUrl, aspectRatio, width, height }
    _getCurrentMediaInfo()
    {
        // See if full info is available.
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(this.mediaId);
        let page = helpers.mediaId.parse(this.mediaId).page;
        if(mediaInfo != null)
        {
            let mangaPage = mediaInfo.mangaPages[page];
            let { url, width, height } = mediaInfo.getMainImageUrl(page);
            return {
                mediaInfo, width, height,
                url,
                previewUrl: mangaPage.urls.small,
                inpaintUrl: mangaPage.urls.inpaint,
                aspectRatio: width / height,
            };
        }

        // We don't have full data yet, so see if we have partial data.
        mediaInfo = ppixiv.mediaCache.getMediaInfoSync(this.mediaId, { full: false });
        if(mediaInfo == null)
            return null;

        // Partial info has the image resolution and preview URL for the first page.
        let previewUrl = mediaInfo.previewUrls[page];
        if(page == 0)
        {
            let { width, height } = mediaInfo;
            return {
                mediaInfo, width, height,
                previewUrl,
                aspectRatio: width / height,
            };
        }

        // For other pages, see if we have the aspect ratio in ExtraCache.  If we're in "actual" zoom
        // then we need the actual resolution, so we can't display anything until it's available.
        let aspectRatio = ppixiv.extraCache.getMediaAspectRatioSync(this.mediaId);
        if(aspectRatio == null)
            return null;

        return {
            mediaInfo,
            previewUrl,
            aspectRatio,
        };
    }

    // Update this._cropBox to reflect the current crop.
    _updateCrop(croppedSize)
    {
        helpers.html.setClass(this._imageBox, "cropping", croppedSize != null);

        // If we're not cropping, just turn the crop box off entirely.
        if(croppedSize == null)
        {
            this._cropBox.style.width = "100%";
            this._cropBox.style.height = "100%";
            this._cropBox.style.transformOrigin = "0 0";
            this._cropBox.style.transform = "";
            return;
        }

        // We should always have the real image dimensions if we're displaying a cropped image.
        console.assert(this._actualWidth != null);

        // Crop the image by scaling up cropBox to cut off the right and bottom,
        // then shifting left and up.  The size is relative to imageBox, so this
        // doesn't actually increase the image size.
        let cropWidth = croppedSize.width / this._actualWidth;
        let cropHeight = croppedSize.height / this._actualHeight;
        let cropLeft = croppedSize.left / this._actualWidth;
        let cropTop = croppedSize.top / this._actualHeight;
        this._cropBox.style.width = `${(1/cropWidth)*100}%`;
        this._cropBox.style.height = `${(1/cropHeight)*100}%`;
        this._cropBox.style.transformOrigin = "0 0";
        this._cropBox.style.transform = `translate(${-cropLeft*100}%, ${-cropTop*100}%)`;
    }

    // Refresh the image from imageInfo.
    async _refreshImage({ url, previewUrl, translationUrl, inpaintUrl, signal })
    {
        // When quick view displays an image on mousedown, we want to see the mousedown too
        // now that we're displayed.
        if(this._pointerListener)
            this._pointerListener.checkMissedClicks();

        // Don't show low-res previews during slideshows.
        if(this._slideshowMode)
            previewUrl = url;
        
        // If this is a local image, ask LocalAPI whether we should use the preview image for quick
        // loading.  See shouldPreloadThumbs for details.
        if(!LocalAPI.shouldPreloadThumbs(this.mediaId, previewUrl))
            previewUrl = null;

        // Set the image URLs.
        this._imageContainer.setImageUrls({ imageUrl: url, previewUrl, translationUrl, inpaintUrl });

        // If the main image is already displayed, the image was already displayed and we're just
        // refreshing.
        if(this._imageContainer.displayedImage == "main")
            return;

        // Wait until the preview image (if we have one) is ready.  This will finish quickly
        // if it's preloaded.
        //
        // We have to work around an API limitation: there's no way to abort decode().  If
        // a couple decode() calls from previous navigations are still running, this decode can
        // be queued, even though it's a tiny image and would finish instantly.  If a previous
        // decode is still running, skip this and prefer to just add the image.  It causes us
        // to flash a blank screen when navigating quickly, but image switching is more responsive.
        if(!ViewerImages.decoding)
        {
            try {
                await this._imageContainer.previewImage.decode();
            } catch(e) {
                // Ignore exceptions from aborts.
            }
        }
        signal.throwIfAborted();

        // Work around a Chrome quirk: even if an image is already decoded, calling img.decode()
        // will always delay and allow the page to update.  This means that if we add the preview
        // image, decode the main image, then display the main image, the preview image will
        // flicker for one frame, which is ugly.  Work around this: if the image is fully downloaded,
        // call decode() and see if it finishes quickly.  If it does, we'll skip the preview and just
        // show the final image.
        //
        // On mobile we'd prefer to show the preview image than to delay the image at all, to minimize
        // gaps in the scroller interface.
        let imageReady = false;
        let decodePromise = null;
        if(!ppixiv.mobile)
        {
            if(url != null && this._imageContainer.complete)
            {
                decodePromise = this._decodeImage(this._imageContainer);

                // See if it finishes quickly.
                imageReady = await helpers.other.awaitWithTimeout(decodePromise, 50) != "timed-out";
            }
            signal.throwIfAborted();
        }

        // If the main image is already ready, show it.  Otherwise, show the preview image.
        this._imageContainer.displayedImage = imageReady? "main":"preview";

        // Let our caller know that we're showing something.
        this.ready.accept(true);

        // See if we have an animation to run.
        this._refreshAnimation();

        // If the main image is already being displayed, we're done.
        if(this._imageContainer.displayedImage == "main")
        {
            // XXX: awkward special case
            this.pauseAnimation = false;
            return;
        }

        // If we don't have a main URL, stop here.  We only have the preview to display.
        if(url == null)
            return;

        // If we're in slideshow mode, we aren't using the preview image.  Pause the animation
        // until we actually display an image so it doesn't run while there's nothing visible.
        if(this._slideshowMode)
            this.pauseAnimation = true;

        // If the image isn't downloaded, load it now.  this._imageContainer.decode will do this
        // too, but it doesn't support AbortSignal.
        if(!this._imageContainer.complete)
        {
            // Don't pass our abort signal to waitForImageLoad, since it'll clear the image on
            // cancellation.  We don't want that here, since it'll interfere if we're just refreshing
            // and we'll clear the image ourselves when we're actually shut down.
            let result = await helpers.other.waitForImageLoad(this._imageContainer.mainImage);
            if(result != null)
                return;

            signal.throwIfAborted();
        }

        // Wait for any transitions to complete before switching to the full image, so we don't
        // do it in the middle of transitions.  This helps prevent frame hitches on mobile.  On
        // desktop we may have already displayed the full image, but this is only important for
        // mobile.
        await this._waitForTransitions();
        signal.throwIfAborted();

        // Decode the image asynchronously before adding it.  This is cleaner for large images,
        // since Chrome blocks the UI thread when setting up images.  The downside is it doesn't
        // allow incremental loading.
        //
        // If we already have decodePromise, we already started the decode, so just wait for that
        // to finish.
        if(!decodePromise)
            decodePromise = this._decodeImage(this._imageContainer);
        await decodePromise;
        signal.throwIfAborted();

        // If we paused an animation, resume it.
        this.pauseAnimation = false;

        this._imageContainer.displayedImage = "main";
    }

    async _decodeImage(img)
    {
        // This is used to prevent requesting multiple large image decodes if they're
        // taking a while to finish.  This is stored on the class, so it's shared across
        // viewers.
        ViewerImages.decoding = true;
        try {
            await img.decode();
        } catch(e) {
            // Ignore exceptions from aborts.
        } finally {
            ViewerImages.decoding = false;
        }
    }

    _removeImages()
    {
        this._cancelSaveToHistory();
    }

    onkeydown = async(e) =>
    {
        if(e.ctrlKey || e.altKey || e.metaKey)
            return;
        
        switch(e.code)
        {
        case "Home":
        case "End":
            e.stopPropagation();
            e.preventDefault();

            let mediaInfo = await ppixiv.mediaCache.getMediaInfo(this.mediaId, { full: false });
            if(mediaInfo == null)
                return;

            let newPage = e.code == "End"? mediaInfo.pageCount - 1:0;
            let newMediaId = helpers.mediaId.getMediaIdForPage(this.mediaId, newPage);
            ppixiv.app.showMediaId(newMediaId);
            return;
        }
    }

    shutdown()
    {
        this._stopAnimation({ shuttingDown: true });
        this._cancelSaveToHistory();
        
        super.shutdown();
    }

    // Return "portrait" if the image is taller than the view, otherwise "landscape".
    get _relativeAspect()
    {
        // Figure out whether the image is relatively portrait or landscape compared to the view.
        let viewWidth = Math.max(this.viewWidth, 1); // might be 0 if we're hidden
        let viewHeight = Math.max(this.viewHeight, 1);
        let viewAspectRatio = viewWidth / viewHeight;
        return viewAspectRatio > this._imageAspectRatio? "portrait":"landscape";
    }

    _setImageBoxSize()
    {
        this._imageBox.style.width = Math.round(this.width) + "px";
        this._imageBox.style.height = Math.round(this.height) + "px";
    }    

    _onresize = (e) =>
    {
        // Ignore resizes if we aren't displaying anything yet.
        if(this._imageContainer.displayedImage == null)
            return;

        this._setImageBoxSize();
        this._reposition();

        // If the window size changes while we have an animation running, update the animation.
        if(this._animationsRunning)
            this._refreshAnimation();
    }

    // Enable or disable zoom lock.
    getLockedZoom()
    {
        return this._lockedZoom;
    }

    // Set the zoom level and whether zooming is enabled.  If zooming is disabled, we still
    // remember the zoom level but display as if we're in "contain" mode.
    setZoom({ enabled=null, level=null, stopAnimation=true }={})
    {
        if(stopAnimation)
            this._stopAnimation();

        if(enabled != null)
        {
            // Zoom lock is always enabled on mobile.
            if(ppixiv.mobile)
                enabled = true;

            this._lockedZoom = enabled;
            ppixiv.settings.set("zoom-mode", enabled? "locked":"normal");
        }

        if(level != null)
        {
            this._zoomLevel = level;
            ppixiv.settings.set("zoom-level", level);
        }

        this._reposition();
    }

    // Relative zoom is applied on top of the main zoom.  At 0, no adjustment is applied.
    // Positive values zoom in and negative values zoom out.
    getZoomLevel()
    {
        return this._zoomLevel;
    }

    // Convert between zoom levels and zoom factors.
    //
    // The zoom factor is the actual amount we zoom the image by, relative to its
    // base size (this.width and this.height).  A zoom factor of 1 will fill the
    // view ("cover" mode).
    //
    // The zoom level is the user-facing exponential zoom, with a level of 0 fitting
    // the image inside the view ("contain" mode).
    zoomLevelToZoomFactor(level)
    {
        // Convert from an exponential zoom level to a linear zoom factor.
        let linear = Math.pow(1.5, level);

        // A factor of 1 is "cover" mode.  Scale linear so linear == 1 results in "contain".
        return linear * this.containToCoverRatio;
    }

    zoomFactorToZoomLevel(factor)
    {
        // This is just the inverse of zoomLevelToZoomFactor.
        if(factor < 0.00001)
        {
            console.error(`Invalid zoom factor ${factor}`);
            factor = 1;
        }
        
        factor /= this.containToCoverRatio;
        return Math.log2(factor) / Math.log2(1.5);
    }

    // Get the effective zoom level.  If zoom isn't active, the effective zoom level is 0
    // (zoom factor 1).
    get _zoomLevelEffective()
    {
        if(!this.zoomActive)
            return 0;
        else
            return this._zoomLevelCurrent;
    }

    // Return the active zoom ratio.  A zoom of 1x corresponds to "cover" zooming.
    get _zoomFactorEffective()
    {
        return this.zoomLevelToZoomFactor(this._zoomLevelEffective);
    }

    // Get this._zoomLevel with translating "cover" and "actual" translated to actual values.
    get _zoomLevelCurrent()
    {
        let level = this._zoomLevel;
        if(level == "cover")
            return this._zoomLevelCover;
        else if(level == "actual")
            return this._zoomLevelActual;
        else
            return level;
    }

    get _zoomFactorCurrent()
    {
        return this.zoomLevelToZoomFactor(this._zoomLevelCurrent);
    }

    // The zoom factor for cover mode.
    get _zoomFactorCover()
    {
        let result = Math.max(this.viewWidth/this.width, this.viewHeight/this.height) || 1;

        // If viewWidth/height is zero then we're hidden and have no size, so this zoom factor
        // isn't meaningful.  Just make sure we don't return 0.
        return result == 0? 1:result;
    }
    get _zoomLevelCover() { return this.zoomFactorToZoomLevel(this._zoomFactorCover); }

    get _zoomFactorContain()
    {
        let result = Math.min(this.viewWidth/this.width, this.viewHeight/this.height) || 1;

        // If viewWidth/height is zero then we're hidden and have no size, so this zoom factor
        // isn't meaningful.  Just make sure we don't return 0.
        return result == 0? 1:result;
    }
    get _zoomLevelContain() { return this.zoomFactorToZoomLevel(this._zoomFactorContain); }

    // The zoom factor for "actual" zoom.
    //
    // If we don't know the image dimensions yet, return 1.  The caller should check _actualZoomAvailable
    // if needed.
    get _zoomFactorActual()
    {
        if(this._actualWidth == null)
            return 1;
        else
            return this._actualWidth / this.width;
    }
    get _zoomLevelActual() { return this.zoomFactorToZoomLevel(this._zoomFactorActual); }
    get _actualZoomAvailable() { return this._actualWidth != null; }

    // Zoom in or out.  If zoom_in is true, zoom in by one level, otherwise zoom out by one level.
    changeZoom(zoomOut, { stopAnimation=true }={})
    {
        if(stopAnimation)
            this._stopAnimation();

        // zoomLevel can be a number.  At 0 (default), we zoom to fit the image in the view.
        // Higher numbers zoom in, lower numbers zoom out.  Zoom levels are logarithmic.
        //
        // zoomLevel can be "cover", which zooms to fill the view completely, so we only zoom on
        // one axis.
        //
        // zoomLevel can also be "actual", which zooms the image to its natural size.
        //
        // These zoom levels have a natural ordering, which we use for incremental zooming.  Figure
        // out the zoom levels that correspond to "cover" and "actual".  This changes depending on the
        // image and view size.

        // Increase or decrease relative_zoom_level by snapping to the next or previous increment.
        // We're usually on a multiple of increment, moving from eg. 0.5 to 0.75, but if we're on
        // a non-increment value from a special zoom level, this puts us back on the zoom increment.
        let oldLevel = this._zoomLevelEffective;
        let newLevel = oldLevel;

        let increment = 0.25;
        if(zoomOut)
            newLevel = Math.floor((newLevel - 0.001) / increment) * increment;
        else
            newLevel = Math.ceil((newLevel + 0.001) / increment) * increment;

        // If the amount crosses over one of the special zoom levels above, we select that instead.
        let crossed = function(oldValue, newValue, threshold)
        {
            return (oldValue < threshold && newValue > threshold) ||
                   (newValue < threshold && oldValue > threshold);
        };
        if(crossed(oldLevel, newLevel, this._zoomLevelCover))
        {
            console.log("Selected cover zoom");
            newLevel = "cover";
        }
        else if(this._actualZoomAvailable && crossed(oldLevel, newLevel, this._zoomLevelActual))
        {
            console.log("Selected actual zoom");
            newLevel = "actual";
        }
        else
        {
            // Clamp relative zooming.  Do this here to make sure we can always select cover and actual
            // which aren't clamped, even if the image is very large or small.
            newLevel = helpers.math.clamp(newLevel, -8, +8);
        }

        this.setZoom({ level: newLevel });
    }

    // Return the image coordinate at a given view coordinate.
    getImagePosition(viewPos, {pos=null}={})
    {
        if(pos == null)
            pos = this._currentZoomPos;

        return [
            pos[0] + (viewPos[0] - this.viewWidth/2)  / this.currentWidth,
            pos[1] + (viewPos[1] - this.viewHeight/2) / this.currentHeight,
        ];
    }

    // Return the view coordinate for the given image coordinate (the inverse of getImagePosition).
    getViewPosFromImagePos(imagePos, {pos=null}={})
    {
        if(pos == null)
            pos = this._currentZoomPos;
            
        return [
            (imagePos[0] - pos[0]) * this.currentWidth + this.viewWidth/2,
            (imagePos[1] - pos[1]) * this.currentHeight + this.viewHeight/2,
        ];
    }

    // Given a view position and a point on the image, return the centerPos needed
    // to align the point to that view position.
    getCenterForImagePosition(viewPos, zoomCenter)
    {
        return [
            -((viewPos[0] - this.viewWidth/2)  / this.currentWidth - zoomCenter[0]),
            -((viewPos[1] - this.viewHeight/2) / this.currentHeight - zoomCenter[1]),
        ];
    }

    // Given a view position and a point on the image, align the point to the view
    // position.  This has no effect when we're not zoomed.  _reposition() must be called
    // after changing this.
    setImagePosition(viewPos, zoomCenter)
    {
        this._centerPos = this.getCenterForImagePosition(viewPos, zoomCenter);
    }

    _quickviewpointermove = (e) =>
    {
        this.applyPointerMovement({movementX: e.movementX, movementY: e.movementY, fromQuickView: true});
    }

    applyPointerMovement({movementX, movementY, fromQuickView=false}={})
    {
        this._stopAnimation();

        // Apply mouse dragging.
        let xOffset = movementX;
        let yOffset = movementY;

        if(!fromQuickView)
        {
            // Flip movement if we're on a touchscreen, or if it's enabled by the user.  If this
            // is from quick view, the sender already did this.
            if(ppixiv.mobile || ppixiv.settings.get("invert-scrolling"))
            {
                xOffset *= -1;
                yOffset *= -1;
            }

            // Send pointer movements to linked tabs.  If we're inverting scrolling, this
            // is included here, so clients will scroll the same way regardless of their
            // local settings.
            ppixiv.sendImage.sendMouseMovementToLinkedTabs(xOffset, yOffset);
        }

        // This will make mouse dragging match the image exactly:
        xOffset /= this.currentWidth;
        yOffset /= this.currentHeight;

        // Scale movement by the zoom factor, so we move faster if we're zoomed
        // further in.
        let zoomFactor = this._zoomFactorEffective;

        // This is a hack to keep the same panning sensitivity.  The sensitivity was based on
        // _zoomFactorEffective being relative to "contain" mode, but it changed to "cover".
        // Adjust the panning speed so it's not affected by this change.
        zoomFactor /= this.containToCoverRatio;

        xOffset *= zoomFactor;
        yOffset *= zoomFactor;

        this._centerPos[0] += xOffset;
        this._centerPos[1] += yOffset;

        this._reposition();
    }

    // Return true if zooming is active.
    get zoomActive()
    {
        return this._mousePressed || this.getLockedZoom();
    }

    // Return the ratio to scale from the image's natural dimensions to cover the view,
    // filling it in both dimensions and only overflowing on one axis.  This is zoom factor 1.
    //
    // The base dimensions of the image are (this._imageAspectRatio, 1), so we only need
    // the aspect ratio and not the dimensions.  Use this.width and this.height to get dimensions
    // that are easier to work with.
    get _imageToCoverRatio()
    {
        let { viewWidth, viewHeight } = this;

        // In case we're hidden and have no width, make sure we don't return an invalid value.
        if(viewWidth == 0 || viewHeight == 0)
            return 1;

        return Math.max(viewWidth/this._imageAspectRatio, viewHeight);
    }

    // Return the ratio to scale from the image's natural dimensions to contain it to the
    // screen, filling the screen on one axis and not overflowing either axis.
    get _imageToContainRatio()
    {
        let { viewWidth, viewHeight } = this;

        // In case we're hidden and have no width, make sure we don't return an invalid value.
        if(viewWidth == 0 || viewHeight == 0)
            return 1;

        return Math.min(viewWidth/this._imageAspectRatio, viewHeight);
    }

    // Return the ratio from "contain" (fit the image in the view) to "cover" (cover the entire
    // view).
    get containToCoverRatio()
    {
        return this._imageToContainRatio / this._imageToCoverRatio;
    }

    // Return the width and height of the image when at zoom factor 1.
    get width() { return this._imageToCoverRatio * this._imageAspectRatio; }
    get height() { return this._imageToCoverRatio; }

    // The actual size of the image with its current zoom.
    get currentWidth() { return this.width * this._zoomFactorEffective; }
    get currentHeight() { return this.height * this._zoomFactorEffective; }

    // The dimensions of the image viewport.  This can be 0 if the view is hidden.
    get viewWidth() { return this.root.offsetWidth || 1; }
    get viewHeight() { return this.root.offsetHeight || 1; }

    get _currentZoomPos()
    {
        if(this.zoomActive)
            return [this._centerPos[0], this._centerPos[1]];
        else
            return [0.5, 0.5];
    }

    // Convert [x,y] client coordinates to view coordinates.  This is for events, which
    // give us client coordinates.
    clientToViewCoords([x,y])
    {
        let { top, left } = this.root.getBoundingClientRect();
        x -= left;
        y -= top;
        return [x,y];
    }

    viewToClientCoords([x,y])
    {
        let { top, left } = this.root.getBoundingClientRect();
        x += left;
        y += top;
        return [x,y];
    }

    get viewPosition()
    {
        // Animations always take up the whole view.
        if(this._animationsRunning)
            return new FixedDOMRect(0, 0, this.viewWidth, this.viewHeight);

        let viewWidth = Math.max(this.viewWidth, 1);
        let viewHeight = Math.max(this.viewHeight, 1);

        let { zoomPos } = this.getCurrentActualPosition();
        let topLeft = this.getViewPosFromImagePos([0,0], { pos: zoomPos });
        let bottomRight = this.getViewPosFromImagePos([1,1], { pos: zoomPos });
        topLeft = [
            helpers.math.clamp(topLeft[0], 0, viewWidth), 
            helpers.math.clamp(topLeft[1], 0, viewHeight),
        ];
        bottomRight = [
            helpers.math.clamp(bottomRight[0], 0, viewWidth), 
            helpers.math.clamp(bottomRight[1], 0, viewHeight),
        ];

        return new FixedDOMRect(
            topLeft[0], topLeft[1],
            bottomRight[0], bottomRight[1]);
    }

    _reposition({clampPosition=true}={})
    {
        if(this._imageContainer == null || !this._initialPositionSet)
            return;

        // Stop if we're being called after being disabled, or if we have no container
        // (our parent has been removed and we're being shut down).
        if(this.root == null || this.viewWidth == 0)
            return;

        // Update the rounding box with the new position.
        this._updateRoundingBox();

        // Stop if there's an animation active.
        if(this._animationsRunning)
            return;

        this._scheduleSaveToHistory();

        let { zoomPos, zoomFactor, imagePosition } = this.getCurrentActualPosition({clampPosition});

        // Save the clamped position to centerPos, so after dragging off of the left edge,
        // dragging to the right starts moving immediately and doesn't drag through the clamped
        // distance.
        this._centerPos = zoomPos;
        
        this._imageBox.style.transform = `translateX(${imagePosition.x}px) translateY(${imagePosition.y}px) scale(${zoomFactor})`;
    }

    // The rounding box is used when in notch mode to round the edge of the image.  This
    // rounds the edge of the image to match the rounded edge of the phone, and moves
    // inwards so the rounding follows the image.
    // 
    // The outer box applies the border-radius, and sets its top-left and bottom-right position
    // to match the position of the image in the view.  The inner box inverts the translation,
    // so the image's actual position stays the same.
    _updateRoundingBox()
    {
        let roundedBox = this.querySelector(".rounded-box");
        let roundedBoxReposition = this.querySelector(".rounded-box-reposition");

        // This isn't used if we're not in notch mode.
        if(document.documentElement.dataset.displayMode != "notch")
        {
            roundedBox.style.translate = "";
            roundedBoxReposition.style.translate = "";
            roundedBox.style.width = "";
            roundedBox.style.height = "";
            return;
        }

        let { viewWidth, viewHeight } = this;

        // Distance from the top-left of the view to the image:
        let topLeft = this.getViewPosFromImagePos([0,0]);
        topLeft[0] = Math.max(0, topLeft[0]);
        topLeft[1] = Math.max(0, topLeft[1]);

        // Distance from the bottom-right of the view to the image:
        let bottomRight = this.getViewPosFromImagePos([1,1]);
        bottomRight[0] = viewWidth - bottomRight[0];
        bottomRight[1] = viewHeight - bottomRight[1];
        bottomRight[0] = Math.max(0, bottomRight[0]);
        bottomRight[1] = Math.max(0, bottomRight[1]);

        // If animations are running, just fill the screen, so we round at the very edges.  
        // We don't update the rounding box during animations (we'd have to update every frame),
        // but animations always fill the screen, so if animations are running, just fill the
        // screen, so we round at the very edges.  
        if(this._animationsRunning)
        {
            topLeft = [0,0];
            bottomRight = [0,0];
        }

        roundedBox.style.translate = `${topLeft[0]}px ${topLeft[1]}px`;
        roundedBoxReposition.style.translate = `${-topLeft[0]}px ${-topLeft[1]}px`;

        // Set the size of the rounding box.
        let size = [
            viewWidth - topLeft[0] - bottomRight[0],
            viewHeight - topLeft[1] - bottomRight[1],
        ];

        roundedBox.style.width = `${size[0]}px`;
        roundedBox.style.height = `${size[1]}px`;

        // Reduce the amount of rounding if we're not using a lot of the screen.  For example,
        // if we're viewing a landscape image fit to a portrait screen and it only takes up
        // a small amount of the view, this will reduce the rounding so it's not too exaggerated.
        // It also gives the effect of the rounding scaling down if the image is pinch zoomed
        // very small.  This only takes effect if there's a significant amount of unused screen
        // space, so most of the time the rounding stays the same.
        let horiz = helpers.math.scaleClamp(size[0] / viewWidth,      .75, 0.35, 1, 0.25);
        let vert = helpers.math.scaleClamp(size[1] / viewHeight,      .75, 0.35, 1, 0.25);
        roundedBox.style.setProperty("--rounding-amount", Math.min(horiz, vert));
    }

    // Return the size and position of the image, given the current pan and zoom.
    // The returned zoomPos is centerPos after any clamping was applied for the current
    // position.
    getCurrentActualPosition({
        zoomPos=null,

        // If false, edge clamping won't be applied.
        clampPosition=true,
    }={})
    {
        // If the dimensions are empty then we aren't loaded.  Clamp it to 1 so the math
        // below doesn't break.
        let width = Math.max(this.width, 1);
        let height = Math.max(this.height, 1);
        let viewWidth = Math.max(this.viewWidth, 1);
        let viewHeight = Math.max(this.viewHeight, 1);

        let zoomFactor = this._zoomFactorEffective;
        let zoomedWidth = width * zoomFactor;
        let zoomedHeight = height * zoomFactor;

        if(zoomPos == null)
            zoomPos = this._currentZoomPos;

        // Make sure we don't modify the caller's value.
        zoomPos = [...zoomPos];

        // When we're zooming to fill the view, clamp panning so we always fill the view
        // and don't pan past the edge.
        if(clampPosition)
        {
            if(this.zoomActive && !ppixiv.settings.get("pan-past-edge"))
            {
                let topLeft = this.getImagePosition([0,0], { pos: zoomPos }); // minimum position
                topLeft[0] = Math.max(topLeft[0], 0);
                topLeft[1] = Math.max(topLeft[1], 0);
                zoomPos = this.getCenterForImagePosition([0,0], topLeft);

                let bottomRight = this.getImagePosition([viewWidth,viewHeight], { pos: zoomPos }); // maximum position
                bottomRight[0] = Math.min(bottomRight[0], 1);
                bottomRight[1] = Math.min(bottomRight[1], 1);
                zoomPos = this.getCenterForImagePosition([viewWidth,viewHeight], bottomRight);
            }

            // If we're narrower than the view, lock to the middle.
            //
            // Take the floor of these, so if we're covering a 1500x1200 window with a 1500x1200.2 image we
            // won't wiggle back and forth by one pixel.
            if(viewWidth >= Math.floor(zoomedWidth))
                zoomPos[0] = 0.5; // center horizontally
            if(viewHeight >= Math.floor(zoomedHeight))
                zoomPos[1] = 0.5; // center vertically
        }

        // _currentZoomPos is the position that should be centered in the view.  At
        // [0.5,0.5], the image is centered.
        let x = viewWidth/2 - zoomPos[0]*zoomedWidth;
        let y = viewHeight/2 - zoomPos[1]*zoomedHeight;

        // If the display is 1:1 to the image, make sure there's no subpixel offset.  Do this if
        // we're in "actual" zoom mode, or if we're in another zoom with the same effect, such as
        // if we're viewing a 1920x1080 image on a 1920x1080 screen and we're in "cover" mode.
        // If we're scaling the image at all due to zooming, allow it to be fractional to allow
        // smoother panning.
        let inActualZoomMode = this._actualZoomAvailable && Math.abs(this._zoomFactorEffective - this._zoomFactorActual) < 0.001;
        if(inActualZoomMode)
        {
            x = Math.round(x);
            y = Math.round(y);
        }

        return { zoomPos, zoomFactor, imagePosition: {x,y} };
    }

    // Restore the pan and zoom state from history.
    //
    // restoreHistory is true if we're viewing an image that was in browser history and
    // we want to restore the pan/zoom position from history.
    //
    // If it's false, we're viewing a new image.  We'll reset the image position, or restore
    // it selectively if "return to top" is disabled (view_mode != "manga").
    _setInitialImagePosition(restoreHistory)
    {
        // If we were animating, start animating again.
        let args = helpers.args.location;
        if(args.state.zoom?.animating)
            this._refreshAnimation();

        if(restoreHistory)
        {
            let level = args.state.zoom?.zoom;
            let enabled = args.state.zoom?.lock;
            this.setZoom({ level, enabled, stopAnimation: false });
        }
        
        // Similar to how we display thumbnails for portrait images starting at the top, default to the top
        // if we'll be panning vertically when in cover mode.
        let aspect = this._relativeAspect;
        let centerPos = [0.5, aspect == "portrait"? 0:0.5];

        // If history has a center position, restore it if we're restoring history.  Also, restore it
        // if we're not in "return to top" mode as long as the aspect ratios of the images are similar,
        // eg. we're going from a portait image to another portrait image.
        if(args.state.zoom != null)
        {
            let oldAspect = args.state.zoom?.relativeAspect;
            let returnToTop = ppixiv.settings.get("view_mode") == "manga";
            if(restoreHistory || (!returnToTop && aspect == oldAspect))
                centerPos = [...args.state.zoom?.pos];
        }

        this._centerPos = centerPos;
    }

    // Save the pan and zoom state to history.
    _saveToHistory = () =>
    {
        // Store the pan position at the center of the view.
        let args = helpers.args.location;
        args.state.zoom = {
            pos: this._centerPos,
            zoom: this.getZoomLevel(),
            lock: this.getLockedZoom(),
            relativeAspect: this._relativeAspect,
            animating: this._animationsRunning,
        };

        helpers.navigate(args, { addToHistory: false });
    }

    // Schedule _saveToHistory to run.  This is buffered so we don't call history.replaceState
    // too quickly.
    _scheduleSaveToHistory()
    {
        // If we're called repeatedly, allow the first timer to complete, so we save
        // periodically during drags or flings that are taking a long time to finish
        // rather than not saving at all.
        if(this._saveToHistoryId)
            return;

        this._saveToHistoryId = realSetTimeout(() => {
            this._saveToHistoryId = null;

            // Work around a Chrome bug: updating history causes the mouse cursor to become visible
            // for one frame, which causes it to flicker while panning around.  Updating history state
            // shouldn't affect the UI at all.  Work around this by just rescheduling the save if the
            // mouse is currently pressed.
            if(this._mousePressed)
            {
                this._scheduleSaveToHistory();
                return;
            }

            this._saveToHistory();
        }, 250);
    }

    _cancelSaveToHistory()
    {
        if(this._saveToHistoryId != null)
        {
            realClearTimeout(this._saveToHistoryId);
            this._saveToHistoryId = null;
        }
    }

    _createCurrentAnimation()
    {
        // Decide which animation mode to use.
        let animationMode;
        if(this._slideshowMode == "loop")
            animationMode = "loop";
        else if(this._slideshowMode != null)
            animationMode = "slideshow";
        else if(ppixiv.settings.get("auto_pan"))
            animationMode = "auto-pan";
        else
            return { };

        // Sanity check: this.root should always have a size.  If this is 0, the container
        // isn't visible and we don't know anything about how big we are, so we can't set up
        // the slideshow.  This is this.viewWidth below.
        if(this.root.offsetHeight == 0)
            console.warn("Image container has no size");

        let slideshow = new Slideshow({
            // this.width/this.height are the size of the image at 1x zoom, which is to fit
            // onto the view.  Scale this up by zoomFactorCover, so the slideshow's default
            // zoom level is to cover the view.
            width: this.width,
            height: this.height,
            containerWidth: this.viewWidth,
            containerHeight: this.viewHeight,
            mode: animationMode,

            // Don't zoom below "contain".
            minimumZoom: this.zoomLevelToZoomFactor(0),
        });

        // Create the animation.
        let animation = slideshow.getAnimation(this._custom_animation);

        // If the viewer is created for a mobile drag, skip the fade-in, so it doesn't fade in
        // while dragging.
        if(this.options.displayedByDrag)
            animation.fadeIn = 0;

        return { animationMode, animation };
    }

    // Start a pan/zoom animation.  If it's already running, update it in place.
    _refreshAnimation()
    {
        // Create the animation.
        let { animationMode, animation } = this._createCurrentAnimation();
        if(animation == null)
        {
            this._stopAnimation();
            return;
        }

        // In slideshow-hold, delay between each alternation to let the animation settle visually.
        //
        // The animation API makes this a pain, since it has no option to delay between alternations.
        // We have to add it as an offset at both ends of the animation, and then increase the duration
        // to compensate.
        let iterationStart = 0;
        if(animationMode == "loop")
        {
            // To add a 1 second delay to both ends of the alternation, add 0.5 seconds of delay
            // to both ends (the delay will be doubled by the alternation), and increase the
            // total length by 1 second.
            let delay = 1;
            animation.duration += delay;
            let fraction = (delay*0.5) / animation.duration;

            // We can set iterationStart to skip the delay the first time through.  For now we don't
            // do this, so we pause at the start after the fade-in.
            // iterationStart = fraction;

            animation.keyframes = [
                { ...animation.keyframes[0], offset: 0 },
                { ...animation.keyframes[0], offset: fraction },
                { ...animation.keyframes[1], offset: 1-fraction },
                { ...animation.keyframes[1], offset: 1 },
            ]
        }
    
        // If the mode isn't changing, just update the existing animation in place, so we
        // update the animation if the window is resized.
        if(this._currentAnimationMode == animationMode)
        {
            // On iOS leave the animation alone, since modifying animations while they're
            // running is broken on iOS and just cause the animation to freeze, and restarting
            // the animation when we regain focus looks ugly.
            if(ppixiv.ios)
                return;

            this._animations.main.effect.setKeyframes(animation.keyframes);
            this._animations.main.updatePlaybackRate(1 / animation.duration);
            return;
        }

        // If we're in pan mode and we've already run the pan animation for this image, don't
        // start it again.
        if(animationMode == "auto-pan")
        {
            if(this._ranPanAnimation)
                return;

            this._ranPanAnimation = true;
        }

        // Stop the previous animations.
        this._stopAnimation();
    
        this._currentAnimationMode = animationMode;
        
        // Create the main animation.
        this._animations.main = new DirectAnimation(new KeyframeEffect(
            this._imageBox,
            animation.keyframes,
            {
                // The actual duration is set by updatePlaybackRate.
                duration: 1000,
                fill: 'forwards',
                direction: animationMode == "loop"? "alternate":"normal",
                iterations: animationMode == "loop"? Infinity:1,
                iterationStart,
            }
        ));

        // Set the speed.  Setting it this way instead of with the duration lets us change it smoothly
        // if settings are changed.
        this._animations.main.updatePlaybackRate(1 / animation.duration);
        this._animations.main.onfinish = this._checkAnimationFinished;

        // If this animation wants a fade-in and a previous one isn't still playing, start it.
        // Note that we use Animation and not DirectAnimation for fades, since DirectAnimation won't
        // sleep during the long delay while they're not doing anything.
        if(animation.fadeIn > 0)
            this._animations.fadeIn = Slideshow.makeFadeIn(this._imageBox, { duration: animation.fadeIn * 1000 });

        // Create the fade-out.
        if(animation.fadeOut > 0)
        {
            this._animations.fadeOut = Slideshow.makeFadeOut(this._imageBox, {
                duration: animation.fadeIn * 1000,
                delay: (animation.duration - animation.fadeOut) * 1000,
            });
        }

        // Start the animations.  If any animation is finished, it was inherited from a
        // previous animation, so don't call play() since that'll restart it.
        for(let animation of Object.values(this._animations))
        {
            if(animation.playState != "finished")
                animation.play();
        }

        // Make sure the rounding box is disabled during the animation.
        this._updateRoundingBox();
    }

    _checkAnimationFinished = async(e) =>
    {
        if(this._animations.main?.playState != "finished")
            return;

        // If we're not in slideshow mode, just clean up the animation and stop.  We should
        // never get here in slideshow-hold.
        if(this._currentAnimationMode != "slideshow" || !this._onnextimage)
        {
            this._stopAnimation();
            return;
        }

        // Don't move to the next image while the user has a popup open.  We'll return here when
        // dialogs are closed.
        if(!OpenWidgets.singleton.empty)
        {
            console.log("Deferring next image while UI is open");
            return;
        }

        // Tell the caller that we're ready for the next image.  Don't call stopAnimation yet,
        // so we don't cancel opacity and cause the image to flash onscreen while the new one
        // is loading.  We'll stop if when onnextimage navigates.
        let { mediaId } = await this._onnextimage(this);

        // onnextimage normally navigates to the next slideshow image.  If it didn't, call
        // stopAnimation so we clean up the animation and make it visible again if it's faded
        // out.  This typically only happens if we only have one image.
        if(mediaId == null)
        {
            console.log("The slideshow didn't have a new image.  Resetting the slideshow animation");
            this._stopAnimation();
        }
    }

    // Update just the animation speed, so we can smoothly show changes to the animation
    // speed as the user changes it.
    _refreshAnimationSpeed = () =>
    {
        if(!this._animationsRunning)
            return;

        // Don't update keyframes, since changing the speed can change keyframes too,
        // which will jump when we set them.  Just update the playback rate.
        let { animation } = this._createCurrentAnimation();
        this._animations.main.updatePlaybackRate(1 / animation.duration);
    }

    // If an animation is running, cancel it.
    //
    // keepAnimations is a list of animations to leave running.  For example, ["fadeIn"] will leave
    // any fade-in animation alone.
    _stopAnimation({
        keepAnimations=[],

        // If true, just shut down the animation.  If false, the zoom level will be set to match
        // where the animation left off, which is used when exiting from pan mode.
        shuttingDown=false,
    }={})
    {
        // Only continue if we have a main animation.  If we don't have an animation, we don't
        // want to modify the zoom/pan position and there's nothing to stop.
        if(!this._animations.main)
            return false;

        // Commit the current state of the main animation so we can read where the image was.
        let appliedAnimations = true;
        try {
            for(let [name, animation] of Object.entries(this._animations))
            {
                if(keepAnimations.indexOf(name) != -1)
                    continue;
                animation.commitStyles();
            }
        } catch {
            appliedAnimations = false;
        }

        // Cancel all animations.  We don't need to wait for animation.pending here.
        for(let [name, animation] of Object.entries(this._animations))
        {
            if(keepAnimations.indexOf(name) != -1)
                continue;

            animation.cancel();
            delete this._animations[name];
        }

        // Make sure we don't leave the image faded out if we stopped while in the middle
        // of a fade.
        this._imageBox.style.opacity = "";

        this._currentAnimationMode = null;

        if(!appliedAnimations)
        {
            // For some reason, commitStyles throws an exception if we're not visible, which happens
            // if we're shutting down.  In this case, just cancel the animations.
            return true;
        }

        // Pull out the transform and scale we were left on when the animation stopped.
        let matrix = new DOMMatrix(getComputedStyle(this._imageBox).transform);
        let zoomFactor = matrix.a, left = matrix.e, top = matrix.f;
        let zoomLevel = this.zoomFactorToZoomLevel(zoomFactor);

        // If we're shutting down, all we need to do is clean up the animation.  Make sure we don't
        // change the saved zoom mode, since another viewer may already be active.
        if(shuttingDown)
            return;

        // Apply the current zoom and pan position.  If the zoom level is 0 then just disable
        // zoom, and use "cover" if the zoom level matches it.  The zoom we set here doesn't
        // have to be one that's selectable in the UI.  Be sure to set stopAnimation, so these
        // setZoom, etc. calls don't recurse into here.
        if(Math.abs(zoomLevel) < 0.001)
            this.setZoom({ enabled: false, stopAnimation: false });
        else if(Math.abs(zoomLevel - this._zoomLevelCover) < 0.01)
            this.setZoom({ enabled: true, level: "cover", stopAnimation: false });
        else
            this.setZoom({ enabled: true, level: zoomLevel, stopAnimation: false });

        // Set the image position to match where the animation left it.
        this.setImagePosition([left, top], [0,0]);
    
        this._reposition();
        return true;
    }

    get _animationsRunning()
    {
        return this._animations.main != null;
    }

    set pauseAnimation(pause)
    {
        this._pauseAnimation = pause;
        this.refreshAnimationPaused();
    }

    // The animation is paused if we're explicitly paused while loading, or if something is
    // open over the image and registered with OpenWidgets, like the context menu.
    refreshAnimationPaused()
    {
        // Note that playbackRate is broken on iOS.
        for(let animation of Object.values(this._animations))
        {
            // If an animation is finished, don't restart it, or it'll rewind.
            if(this._pauseAnimation && animation.playState == "running")
                animation.pause();
            else if(!this._pauseAnimation && animation.playState == "paused")
                animation.play();
        }
    }

    // These zoom helpers are mostly for the popup menu.
    //
    // Toggle zooming, centering around the given view position, or the center of the
    // view if x and y are null.
    zoomToggle({x, y}={})
    {
        if(this._slideshowMode)
            return;

        this._stopAnimation();

        if(x == null || y == null)
        {
            x = this.viewWidth / 2;
            y = this.viewHeight / 2;
        }

        let center = this.getImagePosition([x, y]);
        this.setZoom({ enabled: !this.getLockedZoom() });
        this.setImagePosition([x, y], center);
        this._reposition();
    }

    // Set the zoom level, keeping the given view position stationary if possible.
    zoomSetLevel(level, {x, y})
    {
        if(this._slideshowMode)
            return;

        // Ignore requests for actual zooming if we don't know the actual image size yet.
        if(level == "actual" && this._actualWidth == null)
        {
            console.log("Can't display actual zoom yet");
            return;
        }
        
        this._stopAnimation();

        // If the zoom level that's already selected is clicked and we're already zoomed,
        // just toggle zoom as if the toggle zoom button was pressed.
        if(this.getZoomLevel() == level && this.getLockedZoom())
        {
            this.setZoom({ enabled: false });
            this._reposition();
            return;
        }

        let center = this.getImagePosition([x, y]);
        
        // Each zoom button enables zoom lock, since otherwise changing the zoom level would
        // only have an effect when click-dragging, so it looks like the buttons don't do anything.
        this.setZoom({ enabled: true, level });
        this.setImagePosition([x, y], center);

        this._reposition();
    }

    // Zoom in or out, keeping x,y centered if possible.  If x and y are null, center around
    // the center of the view.
    zoomAdjust(down, {x, y})
    {
        if(this._slideshowMode)
            return;

        this._stopAnimation();

        if(x == null || y == null)
        {
            x = this.viewWidth / 2;
            y = this.viewHeight / 2;
        }
        
        let center = this.getImagePosition([x, y]);

        // If mousewheel zooming is used while not zoomed, turn on zooming and set
        // a 1x zoom factor, so we zoom relative to the previously unzoomed image.
        if(!this.zoomActive)
            this.setZoom({ enabled: true, level: 0 });

        let oldZoomLevel = this._zoomLevelEffective;
        this.changeZoom(down);
        let newZoomLevel = this._zoomLevelEffective;

        // If the zoom level didn't change, try one more time.  For example, if cover mode
        // is equal to zoom level 2 and we just switched between them, we've changed zoom
        // modes but nothing will actually change, so we should skip to the next level.
        if(Math.abs(oldZoomLevel - newZoomLevel) < 0.01)
            this.changeZoom(down);

        // If we're selecting zoom level 0 (contain), set the zoom level to cover and turn
        // off zoom lock.  That displays the same thing, but clicking the image will zoom
        // to cover, which is more natural.
        if(this.getZoomLevel() == 0)
            this.setZoom({ enabled: false, level: "cover" });

        this.setImagePosition([x, y], center);
        this._reposition();        
    }
}

// A helper that holds all of the images that we display together.
//
// Beware of a Firefox bug: if we set the image to helpers.other.blankImage to prevent it
// from being shown as a broken image initially, image.decode() breaks and always resolves
// immediately for the new image.
class ImagesContainer extends Widget
{
    constructor({
        ...options
    })
    {
        super({...options, template: `
            <div class=inner-image-container>
                <img class="filtering displayed-image main-image" hidden>
                <img class="filtering displayed-image translation-image" hidden>
                <img class="filtering displayed-image inpaint-image" hidden>
                <img class="filtering displayed-image low-res-preview" hidden>
            </div>
        `});

        this.mainImage = this.root.querySelector(".main-image");
        this.inpaintImage = this.root.querySelector(".inpaint-image");
        this.translationImage = this.root.querySelector(".translation-image");
        this.previewImage = this.root.querySelector(".low-res-preview");

        // Set these images to high-priority to try to encourage the browser to queue
        // them ahead of thumbnails that might be loading in the background.
        this.mainImage.fetchPriority = "high";
        this.inpaintImage.fetchPriority = "high";
        this.translationImage.fetchPriority = "high";
        this.previewImage.fetchPriority = "high";
    }

    shutdown()
    {
        // Clear the image URLs when we remove them, so any loads are cancelled.  This seems to
        // help Chrome with GC delays.
        if(this.mainImage)
        {
            this.mainImage.src = helpers.other.blankImage;
            this.mainImage.remove();
            this.mainImage = null;
        }

        if(this.previewImage)
        {
            this.previewImage.src = helpers.other.blankImage;
            this.previewImage.remove();
            this.previewImage = null;
        }

        super.shutdown();
    }

    setImageUrls({ imageUrl, inpaintUrl, translationUrl, previewUrl })
    {
        // Work around an ancient legacy browser mess: img.src is "" by default (no image), but if
        // you set it back to "", it ends up being resolved as an empty URL and getting set to window.location,
        // and causing bogus network requests and errors.  We have to manually remove the attribute
        // instead to work around this.
        function setImageSource(img, src)
        {
            if(src)
                img.src = src;
            else
                img.removeAttribute("src");
        }

        setImageSource(this.mainImage, imageUrl);
        setImageSource(this.inpaintImage, inpaintUrl);
        setImageSource(this.translationImage, translationUrl);        
        setImageSource(this.previewImage, previewUrl);

        this._refreshInpaintVisibility();
    }

    get complete()
    {
        return this.mainImage.complete && this.inpaintImage.complete && this.translationImage.complete;
    }

    decode()
    {
        let promises = [];
        if(this.mainImage.src)
            promises.push(this.mainImage.decode());
        if(this.inpaintImage.src)
            promises.push(this.inpaintImage.decode());
        if(this.translationImage.src)
            promises.push(this.translationImage.decode());
        return Promise.all(promises);
    }

    // Set whether the main image or preview image are visible.
    set displayedImage(displayedImage)
    {
        this.mainImage.hidden = displayedImage != "main";
        this.previewImage.hidden = displayedImage != "preview";
        this._refreshInpaintVisibility();
    }

    get displayedImage()
    {
        if(!this.mainImage.hidden)
            return "main";
        else if(!this.previewImage.hidden)
            return "preview";
        else
            return null;
    }

    // inpaintImage and translationImage are visible when the main image is, but only if they have an image.
    _refreshInpaintVisibility()
    {
        this.inpaintImage.hidden = this.mainImage.hidden || !this.inpaintImage.src;
        this.translationImage.hidden = this.mainImage.hidden || !this.translationImage.src;
    }

    get width() { return this.mainImage.width; }
    get height() { return this.mainImage.height; }
    get naturalWidth() { return this.mainImage.naturalWidth; }
    get naturalHeight() { return this.mainImage.naturalHeight; }

    get hideInpaint() { return this.inpaintImage.style.opacity == 0; }
    set hideInpaint(value)
    {
        this.inpaintImage.style.opacity = value? 0:1;
    }
}
