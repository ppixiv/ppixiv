// A helper that holds all of the images that we display together.
import Widget from 'vview/widgets/widget.js';
import Viewer from 'vview/viewer/viewer.js';
import ImageEditor from 'vview/viewer/images/editing.js';
import ImageEditingOverlayContainer from 'vview/viewer/images/editing-overlay-container.js';
import Slideshow from 'vview/misc/slideshow.js';
import { helpers } from 'vview/ppixiv-imports.js';

class ImagesContainer extends Widget
{
    constructor({
        ...options
    })
    {
        super({...options, template: `
            <div class=inner-image-container>
                <img class="filtering displayed-image main-image" hidden>
                <img class="filtering displayed-image inpaint-image">
                <img class="filtering displayed-image low-res-preview" hidden>
            </div>
        `});

        this.main_img = this.container.querySelector(".main-image");
        this.inpaint_img = this.container.querySelector(".inpaint-image");
        this.preview_img = this.container.querySelector(".low-res-preview");

        // Set the images to blank, so they don't show as broken images until they're set up.
        this.set_image_urls(null, null, null);
    }

    shutdown()
    {
        // Clear the image URLs when we remove them, so any loads are cancelled.  This seems to
        // help Chrome with GC delays.
        if(this.main_img)
        {
            this.main_img.src = helpers.blank_image;
            this.main_img.remove();
            this.main_img = null;
        }

        if(this.preview_img)
        {
            this.preview_img.src = helpers.blank_image;
            this.preview_img.remove();
            this.preview_img = null;
        }

        super.shutdown();
    }

    set_image_urls(image_url, inpaint_url, preview_url)
    {
        this.image_src = image_url ?? helpers.blank_image;
        this.inpaint_src = inpaint_url ?? helpers.blank_image;
        this.preview_img.src = preview_url || helpers.blank_image;
    }

    // Set the image URLs.  If set to null, use a blank image instead so we don't trigger
    // load errors.
    get image_src() { return this.main_img.src; }
    set image_src(value) { this.main_img.src = value || helpers.blank_image; }
    get inpaint_src() { return this.inpaint_img.src; }
    set inpaint_src(value) { this.inpaint_img.src = value || helpers.blank_image; }

    get complete()
    {
        return this.main_img.complete && this.inpaint_img.complete;
    }

    decode()
    {
        return Promise.all([this.main_img.decode(), this.inpaint_img.decode()]);
    }

    get width() { return this.main_img.width; }
    get height() { return this.main_img.height; }
    get naturalWidth() { return this.main_img.naturalWidth; }
    get naturalHeight() { return this.main_img.naturalHeight; }

    get hide_inpaint() { return this.inpaint_img.style.opacity == 0; }
    set hide_inpaint(value)
    {
        this.inpaint_img.style.opacity = value? 0:1;
    }
}

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
export default class ViewerImages extends Viewer
{
    constructor({
        // If set, this is a function returning a promise which resolves when any transitions
        // are complete.  We'll wait until this resolves before switching to the full image to
        // reduce frame skips.
        wait_for_transitions=() => { },
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

        this._wait_for_transitions = wait_for_transitions;

        this._image_box = this.container.querySelector(".image-box");
        this._crop_box = this.container.querySelector(".crop-box");

        this._refresh_image = new ppixiv.SentinelGuard(this._refresh_image, this);

        this._original_width = 1;
        this._original_height = 1;
        this._cropped_size = null;
        this._ranPanAnimation = false;
        this._center_pos = [0, 0];
        this._drag_movement = [0,0];
        this._animations = { };

        // Restore the most recent zoom mode.
        if(ppixiv.mobile)
            this._zoom_level = 0;
        else
        {
            this.set_locked_zoom(ppixiv.settings.get("zoom-mode") == "locked");
            this._zoom_level = ppixiv.settings.get("zoom-level", "cover");
        }

        this._image_container = new ImagesContainer({ container: this._crop_box });
        this._editing_container = new ImageEditingOverlayContainer({
            container: this._crop_box,
        });

        // Use a ResizeObserver to update our size and position if the window size changes.
        let resize_observer = new ResizeObserver(this._onresize);
        resize_observer.observe(this.container);
        this.shutdown_signal.signal.addEventListener("abort", () => resize_observer.disconnect());

        this.container.addEventListener("dragstart", (e) => e.preventDefault(), this._signal);
        this.container.addEventListener("selectstart", (e) => e.preventDefault(), this._signal);

        // Start or stop panning if the user changes it while we're active, eg. by pressing ^P.
        ppixiv.settings.addEventListener("auto_pan", () => {
            // Allow the pan animation to start again when the auto_pan setting changes.
            this._ranPanAnimation = false;
            this._refresh_animation();
        }, this._signal);
        ppixiv.settings.addEventListener("slideshow_duration", this._refresh_animation_speed, this._signal);
        ppixiv.settings.addEventListener("auto_pan_duration", this._refresh_animation_speed, this._signal);

        // This is like pointermove, but received during quick view from the source tab.
        window.addEventListener("quickviewpointermove", this._quickviewpointermove, this._signal);

        // We pause changing to the next slideshow image UI widgets are open.  Check if we should continue
        // when the open widget list changes.
        ppixiv.OpenWidgets.singleton.addEventListener("changed", () => this._check_animation_finished(), this._signal);

        ppixiv.media_cache.addEventListener("mediamodified", ({media_id}) => this._media_info_modified({media_id}), this._signal);

        // Create the inpaint editor.
        if(!ppixiv.mobile)
        {
            this.image_editor = new ImageEditor({
                container: this.container,
                parent: this,
                overlay_container: this._editing_container,
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
        if(this.image_editor)
            this.image_editor.set_media_id(this.mediaId);

        // Refresh from whatever image info is already available.
        this._refresh_from_illust_data();

        // Load full info if it wasn't already loaded.
        await ppixiv.media_cache.get_media_info(this.mediaId);

        // Stop if we were shutdown while we were async.
        if(this.shutdown_signal.signal.aborted)
            return;

        // In case we only had preview info, refresh with the info we just loaded.
        this._refresh_from_illust_data();
    }

    // If media info changes, refresh in case any image URLs have changed.
    _media_info_modified({media_id})
    {
        if(media_id != this.mediaId)
            return;

        this._refresh_from_illust_data();
    }

    refresh()
    {
        this._refresh_from_illust_data();
    }

    // Update this._image with as much information as we have so far and refresh the image.
    _refresh_from_illust_data()
    {
        // See if full info is available.
        let illust_data = ppixiv.media_cache.get_media_info_sync(this.mediaId);
        let page = this._page;

        // If we don't have full data yet and this is the first page, see if we have partial
        // data.
        if(illust_data == null && page == 0)
            illust_data = ppixiv.media_cache.get_media_info_sync(this.mediaId, { full: false });

        // Stop if we don't have any info yet.
        if(illust_data == null)
            return;

        let image_info;
        if(!illust_data.full)
        {
            // If we only have partial info, we only have the preview URL, so we'll display that
            // until full info finishes loading.
            image_info = {
                preview_url: illust_data.previewUrls[0],
                width: illust_data.width,
                height: illust_data.height,
            };
        }
        else
        {
            let manga_page = illust_data.mangaPages[page];
            let { url, width, height } = ppixiv.media_cache.get_main_image_url(illust_data, page);
            image_info = {
                url,
                preview_url: manga_page.urls.small,
                inpaint_url: manga_page.urls.inpaint,
                width,
                height,
            };
        }

        let extra_data = ppixiv.media_cache.get_extra_data(illust_data, this.mediaId, page);
        image_info = {
            crop: extra_data?.crop,
            pan: extra_data?.pan,
            ...image_info,
        };

        this._refresh_image(image_info);
    }

    // Refresh the image from image_info.
    _refresh_image = async(signal, image_info) =>
    {
        let {
            url, preview_url, inpaint_url,
            width, height,

            // If set, this is a FixedDOMRect to crop the image to.
            crop,

            // If set, this is a pan created by PanEditor.
            pan
        } = image_info;

        // Disable cropping if the crop editor is active.
        if(this.image_editor?.editing_crop)
            crop = null;

        this._original_width = width;
        this._original_height = height;
        this._cropped_size = crop && crop.length == 4? new ppixiv.FixedDOMRect(crop[0], crop[1], crop[2], crop[3]):null;
        this._custom_animation = pan;

        // Set the size of the image box and crop.
        this._set_image_box_size();
        this._update_crop();

        // When quick view displays an image on mousedown, we want to see the mousedown too
        // now that we're displayed.
        if(this._pointer_listener)
            this._pointer_listener.check_missed_clicks();

        // Don't show low-res previews during slideshows.
        if(this._slideshowMode)
            preview_url = url;
        
        // If this is a local image, ask local_api whether we should use the preview image for quick
        // loading.  See should_preload_thumbs for details.
        if(!ppixiv.local_api.should_preload_thumbs(this.mediaId, preview_url))
            preview_url = null;

        // Set the image URLs.
        this._image_container.set_image_urls(url, inpaint_url, preview_url);

        // Set the initial zoom and image position if we haven't yet.
        if(!this._initial_position_set)
        {
            this._set_initial_image_position(this._shouldRestoreHistory);
            this._initial_position_set = true;
        }

        this._reposition();

        // If the main image is already displayed, the image was already displayed and we're just
        // refreshing.
        if(this._displayed_image == "main")
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
                await this._image_container.preview_img.decode();
            } catch(e) {
                // Ignore exceptions from aborts.
            }
        }
        signal.check();

        // Work around a Chrome quirk: even if an image is already decoded, calling img.decode()
        // will always delay and allow the page to update.  This means that if we add the preview
        // image, decode the main image, then display the main image, the preview image will
        // flicker for one frame, which is ugly.  Work around this: if the image is fully downloaded,
        // call decode() and see if it finishes quickly.  If it does, we'll skip the preview and just
        // show the final image.
        //
        // On mobile we'd prefer to show the preview image than to delay the image at all, to minimize
        // gaps in the scroller interface.
        let img_ready = false;
        let decode_promise = null;
        if(!ppixiv.mobile)
        {
            if(url != null && this._image_container.complete)
            {
                decode_promise = this._decode_img(this._image_container);

                // See if it finishes quickly.
                img_ready = await helpers.await_with_timeout(decode_promise, 50) != "timed-out";
            }
            signal.check();
        }

        // If the main image is already ready, show it.  Otherwise, show the preview image.
        this._displayed_image = img_ready? "main":"preview";

        // Let our caller know that we're showing something.
        this.ready.accept(true);

        // See if we have an animation to run.
        this._refresh_animation();

        // If the main image is already being displayed, we're done.
        if(this._displayed_image == "main")
        {
            // XXX: awkward special case
            this.pause_animation = false;
            return;
        }

        // If we don't have a main URL, stop here.  We only have the preview to display.
        if(url == null)
            return;

        // If we're in slideshow mode, we aren't using the preview image.  Pause the animation
        // until we actually display an image so it doesn't run while there's nothing visible.
        if(this._slideshowMode)
            this.pause_animation = true;

        // If the image isn't downloaded, load it now.  this._image_container.decode will do this
        // too, but it doesn't support AbortSignal.
        if(!this._image_container.complete)
        {
            let result = await helpers.wait_for_image_load(this._image_container.main_img, signal);
            if(result != null)
                return;

            signal.check();
        }

        // Wait for any transitions to complete before switching to the full image, so we don't
        // do it in the middle of transitions.  This helps prevent frame hitches on mobile.  On
        // desktop we may have already displayed the full image, but this is only important for
        // mobile.
        await this._wait_for_transitions();
        signal.check();

        // Decode the image asynchronously before adding it.  This is cleaner for large images,
        // since Chrome blocks the UI thread when setting up images.  The downside is it doesn't
        // allow incremental loading.
        //
        // If we already have decode_promise, we already started the decode, so just wait for that
        // to finish.
        if(!decode_promise)
            decode_promise = this._decode_img(this._image_container);
        await decode_promise;
        signal.check();

        // If we paused an animation, resume it.
        this.pause_animation = false;

        this._displayed_image = "main";
    }

    // Set whether the main image or preview image are visible.
    set _displayed_image(displayed_image)
    {
        this._image_container.main_img.hidden = displayed_image != "main";
        this._image_container.preview_img.hidden = displayed_image != "preview";
    }

    get _displayed_image()
    {
        if(!this._image_container.main_img.hidden)
            return "main";
        else if(!this._image_container.preview_img.hidden)
            return "preview";
        else
            return null;
    }

    async _decode_img(img)
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

    _remove_images()
    {
        this._cancel_saveToHistory();
    }

    get _page()
    {
        return helpers.parse_media_id(this.mediaId).page;
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

            let illust_data = await ppixiv.media_cache.get_media_info(this.mediaId, { full: false });
            if(illust_data == null)
                return;

            let new_page = e.code == "End"? illust_data.pageCount - 1:0;
            let new_media_id = helpers.get_media_id_for_page(this.mediaId, new_page);
            ppixiv.app.show_media(new_media_id);
            return;
        }
    }

    shutdown()
    {
        this._stop_animation();
        this._cancel_saveToHistory();
        
        this._refresh_image.abort();

        super.shutdown();
    }

    // Return "portrait" if the image is taller than the view, otherwise "landscape".
    get _relative_aspect()
    {
        // Figure out whether the image is relatively portrait or landscape compared to the view.
        let view_width = Math.max(this.view_width, 1); // might be 0 if we're hidden
        let view_height = Math.max(this.view_height, 1);
        return (view_width/this.cropped_size.width) > (view_height/this.cropped_size.height)? "portrait":"landscape";
    }

    _set_image_box_size()
    {
        this._image_box.style.width = Math.round(this.width) + "px";
        this._image_box.style.height = Math.round(this.height) + "px";
    }    

    _onresize = (e) =>
    {
        this._set_image_box_size();
        this._reposition();

        // If the window size changes while we have an animation running, update the animation.
        if(this._animations_running)
            this._refresh_animation();
    }

    // Enable or disable zoom lock.
    getLockedZoom()
    {
        return this._locked_zoom;
    }

    // Select between click-pan zooming and sticky, filled-screen zooming.
    set_locked_zoom(enable, { stop_animation=true }={})
    {
        // Zoom lock is always disabled on mobile.
        if(ppixiv.mobile)
            enable = false;

        if(stop_animation)
            this._stop_animation();

        this._locked_zoom = enable;
        ppixiv.settings.set("zoom-mode", enable? "locked":"normal");
        this._reposition();
    }

    // Relative zoom is applied on top of the main zoom.  At 0, no adjustment is applied.
    // Positive values zoom in and negative values zoom out.
    get_zoom_level()
    {
        return this._zoom_level;
    }

    set_zoom_level(value, { stop_animation=true }={})
    {
        if(stop_animation)
            this._stop_animation();

        this._zoom_level = value;
        if(!ppixiv.mobile)
            ppixiv.settings.set("zoom-level", this._zoom_level);

        this._reposition();
    }

    // Convert between zoom levels and zoom factors.
    //
    // The zoom factor is the actual amount we zoom the image by, relative to its
    // base size (this.width and this.height).  A zoom factor of 1 will fill the
    // view ("cover" mode).
    //
    // The zoom level is the user-facing exponential zoom, with a level of 0 fitting
    // the image inside the view ("contain" mode).
    zoom_level_to_zoom_factor(level)
    {
        // Convert from an exponential zoom level to a linear zoom factor.
        let linear = Math.pow(1.5, level);

        // If linear == 1 (level 0), we want the image to fit inside the view ("contain" mode),
        // but the image is actually scaled to cover the view.
        let factor = linear * this._image_to_contain_ratio / this._image_to_cover_ratio;
        return factor;
    }

    zoom_factor_to_zoom_level(factor)
    {
        // This is just the inverse of zoom_level_to_zoom_factor.
        if(factor < 0.00001)
        {
            console.error(`Invalid zoom factor ${factor}`);
            factor = 1;
        }
        
        factor /= this._image_to_contain_ratio / this._image_to_cover_ratio;
        return Math.log2(factor) / Math.log2(1.5);
    }

    // Get the effective zoom level, translating "cover" and "actual" to actual values.
    get _zoom_level_current()
    {
        if(!this.zoom_active)
            return 0;

        let level = this._zoom_level;
        if(level == "cover")
            return this._zoom_level_cover;
        else if(level == "actual")
            return this._zoom_level_actual;
        else
            return level;
    }

    // Return the active zoom ratio.  A zoom of 1x corresponds to "cover" zooming.
    get _zoom_factor_current()
    {
        return this.zoom_level_to_zoom_factor(this._zoom_level_current);
    }

    // The zoom factor for cover mode.
    get _zoom_factor_cover()
    {
        let result = Math.max(this.view_width/this.width, this.view_height/this.height) || 1;

        // If view_width/height is zero then we're hidden and have no size, so this zoom factor
        // isn't meaningful.  Just make sure we don't return 0.
        return result == 0? 1:result;
    }
    get _zoom_level_cover() { return this.zoom_factor_to_zoom_level(this._zoom_factor_cover); }

    get _zoom_factor_contain()
    {
        let result = Math.min(this.view_width/this.width, this.view_height/this.height) || 1;

        // If view_width/height is zero then we're hidden and have no size, so this zoom factor
        // isn't meaningful.  Just make sure we don't return 0.
        return result == 0? 1:result;
    }
    get _zoom_level_contain() { return this.zoom_factor_to_zoom_level(this._zoom_factor_contain); }

    // The zoom level for "actual" mode.  This inverts the base scaling.
    get _zoom_factor_actual() { return 1 / this._image_to_cover_ratio; }
    get _zoom_level_actual() { return this.zoom_factor_to_zoom_level(this._zoom_factor_actual); }

    // Zoom in or out.  If zoom_in is true, zoom in by one level, otherwise zoom out by one level.
    change_zoom(zoom_out, { stop_animation=true }={})
    {
        if(stop_animation)
            this._stop_animation();

        // zoom_level can be a number.  At 0 (default), we zoom to fit the image in the view.
        // Higher numbers zoom in, lower numbers zoom out.  Zoom levels are logarithmic.
        //
        // zoom_level can be "cover", which zooms to fill the view completely, so we only zoom on
        // one axis.
        //
        // zoom_level can also be "actual", which zooms the image to its natural size.
        //
        // These zoom levels have a natural ordering, which we use for incremental zooming.  Figure
        // out the zoom levels that correspond to "cover" and "actual".  This changes depending on the
        // image and view size.

        let cover_zoom_level = this._zoom_level_cover;
        let actual_zoom_level = this._zoom_level_actual;

        // Increase or decrease relative_zoom_level by snapping to the next or previous increment.
        // We're usually on a multiple of increment, moving from eg. 0.5 to 0.75, but if we're on
        // a non-increment value from a special zoom level, this puts us back on the zoom increment.
        let old_level = this._zoom_level_current;
        let new_level = old_level;

        let increment = 0.25;
        if(zoom_out)
            new_level = Math.floor((new_level - 0.001) / increment) * increment;
        else
            new_level = Math.ceil((new_level + 0.001) / increment) * increment;

        // If the amount crosses over one of the special zoom levels above, we select that instead.
        let crossed = function(old_value, new_value, threshold)
        {
            return (old_value < threshold && new_value > threshold) ||
                   (new_value < threshold && old_value > threshold);
        };
        if(crossed(old_level, new_level, cover_zoom_level))
        {
            // console.log("Selected cover zoom");
            new_level = "cover";
        }
        else if(crossed(old_level, new_level, actual_zoom_level))
        {
            // console.log("Selected actual zoom");
            new_level = "actual";
        }
        else
        {
            // Clamp relative zooming.  Do this here to make sure we can always select cover and actual
            // which aren't clamped, even if the image is very large or small.
            new_level = helpers.clamp(new_level, -8, +8);
        }

        this.set_zoom_level(new_level);
    }

    // Return the image coordinate at a given view coordinate.
    get_image_position(view_pos, {pos=null}={})
    {
        if(pos == null)
            pos = this.current_zoom_pos;

        return [
            pos[0] + (view_pos[0] - this.view_width/2)  / this.current_width,
            pos[1] + (view_pos[1] - this.view_height/2) / this.current_height,
        ];
    }

    // Return the view coordinate for the given image coordinate (the inverse of get_image_position).
    get_view_pos_from_image_pos(image_pos, {pos=null}={})
    {
        if(pos == null)
            pos = this.current_zoom_pos;
            
        return [
            (image_pos[0] - pos[0]) * this.current_width + this.view_width/2,
            (image_pos[1] - pos[1]) * this.current_height + this.view_height/2,
        ];
    }

    // Given a view position and a point on the image, return the center_pos needed
    // to align the point to that view position.
    get_center_for_image_position(view_pos, zoom_center)
    {
        return [
            -((view_pos[0] - this.view_width/2)  / this.current_width - zoom_center[0]),
            -((view_pos[1] - this.view_height/2) / this.current_height - zoom_center[1]),
        ];
    }

    // Given a view position and a point on the image, align the point to the view
    // position.  This has no effect when we're not zoomed.  _reposition() must be called
    // after changing this.
    set_image_position(view_pos, zoom_center)
    {
        this._center_pos = this.get_center_for_image_position(view_pos, zoom_center);
    }

    _quickviewpointermove = (e) =>
    {
        this._apply_pointer_movement({movementX: e.movementX, movementY: e.movementY, from_quick_view: true});
    }

    _apply_pointer_movement({movementX, movementY, from_quick_view=false}={})
    {
        this._stop_animation();

        // Apply mouse dragging.
        let x_offset = movementX;
        let y_offset = movementY;

        if(!from_quick_view)
        {
            // Flip movement if we're on a touchscreen, or if it's enabled by the user.  If this
            // is from quick view, the sender already did this.
            if(ppixiv.mobile || ppixiv.settings.get("invert-scrolling"))
            {
                x_offset *= -1;
                y_offset *= -1;
            }

            // Send pointer movements to linked tabs.  If we're inverting scrolling, this
            // is included here, so clients will scroll the same way regardless of their
            // local settings.
            ppixiv.send_image.send_mouse_movement_to_linked_tabs(x_offset, y_offset);
        }

        // This will make mouse dragging match the image exactly:
        x_offset /= this.current_width;
        y_offset /= this.current_height;

        // Scale movement by the zoom factor, so we move faster if we're zoomed
        // further in.
        let zoom_factor = this._zoom_factor_current;

        // This is a hack to keep the same panning sensitivity.  The sensitivity was based on
        // _zoom_factor_current being relative to "contain" mode, but it changed to "cover".
        // Adjust the panning speed so it's not affected by this change.
        zoom_factor /= this._image_to_contain_ratio / this._image_to_cover_ratio;

        x_offset *= zoom_factor;
        y_offset *= zoom_factor;

        this._center_pos[0] += x_offset;
        this._center_pos[1] += y_offset;

        this._reposition();
    }

    // Return true if zooming is active.
    get zoom_active()
    {
        return this._mouse_pressed || this.getLockedZoom();
    }

    // Return the ratio to scale from the image's natural dimensions to cover the view,
    // filling it in both dimensions and only overflowing on one axis.  We use this
    // as the underlying image size.
    get _image_to_cover_ratio()
    {
        let { view_width, view_height } = this;

        // In case we're hidden and have no width, make sure we don't return an invalid value.
        if(view_width == 0 || view_height == 0)
            return 1;

        return Math.max(view_width/this.cropped_size.width, view_height/this.cropped_size.height);
    }

    // Return the ratio to scale from the image's natural dimensions to contain it to the
    // screen, filling the screen on one axis and not overflowing either axis.
    get _image_to_contain_ratio()
    {
        let { view_width, view_height } = this;

        // In case we're hidden and have no width, make sure we don't return an invalid value.
        if(view_width == 0 || view_height == 0)
            return 1;

        return Math.min(view_width/this.cropped_size.width, view_height/this.cropped_size.height);
    }

    // Return the DOMRect of the cropped size of the image.  If we're not cropping, this
    // is the size of the image itself.
    get cropped_size()
    {
        if(this._cropped_size != null)
            return this._cropped_size;
        else
            return new ppixiv.FixedDOMRect(0, 0, this._original_width, this._original_height);
    }
    
    // Return the width and height of the image when at 1x zoom.
    get width() { return this.cropped_size.width * this._image_to_cover_ratio; }
    get height() { return this.cropped_size.height * this._image_to_cover_ratio; }

    // The actual size of the image with its current zoom.
    get current_width() { return this.width * this._zoom_factor_current; }
    get current_height() { return this.height * this._zoom_factor_current; }

    // The dimensions of the image viewport.  This can be 0 if the view is hidden.
    get view_width() { return this.container.offsetWidth || 1; }
    get view_height() { return this.container.offsetHeight || 1; }

    get current_zoom_pos()
    {
        if(this.zoom_active)
            return [this._center_pos[0], this._center_pos[1]];
        else
            return [0.5, 0.5];
    }

    // Convert [x,y] client coordinates to view coordinates.  This is for events, which
    // give us client coordinates.
    client_to_view_coords([x,y])
    {
        let { top, left } = this.container.getBoundingClientRect();
        x -= left;
        y -= top;
        return [x,y];
    }

    view_to_client_coords([x,y])
    {
        let { top, left } = this.container.getBoundingClientRect();
        x += left;
        y += top;
        return [x,y];
    }

    get view_position()
    {
        // Animations always take up the whole view.
        if(this._animations_running)
            return new ppixiv.FixedDOMRect(0, 0, this.view_width, this.view_height);

        let view_width = Math.max(this.view_width, 1);
        let view_height = Math.max(this.view_height, 1);

        let { zoom_pos } = this.get_current_actual_position();
        let top_left = this.get_view_pos_from_image_pos([0,0], { pos: zoom_pos });
        let bottom_right = this.get_view_pos_from_image_pos([1,1], { pos: zoom_pos });
        top_left = [
            helpers.clamp(top_left[0], 0, view_width), 
            helpers.clamp(top_left[1], 0, view_height),
        ];
        bottom_right = [
            helpers.clamp(bottom_right[0], 0, view_width), 
            helpers.clamp(bottom_right[1], 0, view_height),
        ];

        return new ppixiv.FixedDOMRect(
            top_left[0], top_left[1],
            bottom_right[0], bottom_right[1]);
    }

    _reposition({clamp_position=true}={})
    {
        if(this._image_container == null)
            return;

        // Stop if we're being called after being disabled, or if we have no container
        // (our parent has been removed and we're being shut down).
        if(this.container == null || this.view_width == 0)
            return;

        // Update the rounding box with the new position.
        this._update_rounding_box();

        // Stop if there's an animation active.
        if(this._animations_running)
            return;

        this.schedule_saveToHistory();

        let { zoom_pos, zoom_factor, image_position } = this.get_current_actual_position({clamp_position});

        // Save the clamped position to center_pos, so after dragging off of the left edge,
        // dragging to the right starts moving immediately and doesn't drag through the clamped
        // distance.
        this._center_pos = zoom_pos;
        
        this._image_box.style.transform = `translateX(${image_position.x}px) translateY(${image_position.y}px) scale(${zoom_factor})`;
    }

    // The rounding box is used when in notch mode to round the edge of the image.  This
    // rounds the edge of the image to match the rounded edge of the phone, and moves
    // inwards so the rounding follows the image.
    // 
    // The outer box applies the border-radius, and sets its top-left and bottom-right position
    // to match the position of the image in the view.  The inner box inverts the translation,
    // so the image's actual position stays the same.
    _update_rounding_box()
    {
        let rounded_box = this.querySelector(".rounded-box");
        let rounded_box_reposition = this.querySelector(".rounded-box-reposition");

        // This isn't used if we're not in notch mode.
        if(document.documentElement.dataset.fullscreenMode != "notch")
        {
            rounded_box.style.translate = "";
            rounded_box_reposition.style.translate = "";
            rounded_box.style.width = "";
            rounded_box.style.height = "";
            return;
        }

        let { view_width, view_height } = this;

        // Distance from the top-left of the view to the image:
        let top_left = this.get_view_pos_from_image_pos([0,0]);
        top_left[0] = Math.max(0, top_left[0]);
        top_left[1] = Math.max(0, top_left[1]);

        // Distance from the bottom-right of the view to the image:
        let bottom_right = this.get_view_pos_from_image_pos([1,1]);
        bottom_right[0] = view_width - bottom_right[0];
        bottom_right[1] = view_height - bottom_right[1];
        bottom_right[0] = Math.max(0, bottom_right[0]);
        bottom_right[1] = Math.max(0, bottom_right[1]);

        // If animations are running, just fill the screen, so we round at the very edges.  
        // We don't update the rounding box during animations (we'd have to update every frame),
        // but animations always fill the screen, so if animations are running, just fill the
        // screen, so we round at the very edges.  
        if(this._animations_running)
        {
            top_left = [0,0];
            bottom_right = [0,0];
        }

        rounded_box.style.translate = `${top_left[0]}px ${top_left[1]}px`;
        rounded_box_reposition.style.translate = `${-top_left[0]}px ${-top_left[1]}px`;

        // Set the size of the rounding box.
        let size = [
            view_width - top_left[0] - bottom_right[0],
            view_height - top_left[1] - bottom_right[1],
        ];

        rounded_box.style.width = `${size[0]}px`;
        rounded_box.style.height = `${size[1]}px`;

        // Reduce the amount of rounding if we're not using a lot of the screen.  For example,
        // if we're viewing a landscape image fit to a portrait screen and it only takes up
        // a small amount of the view, this will reduce the rounding so it's not too exaggerated.
        // It also gives the effect of the rounding scaling down if the image is pinch zoomed
        // very small.  This only takes effect if there's a significant amount of unused screen
        // space, so most of the time the rounding stays the same.
        let horiz = helpers.scale_clamp(size[0] / view_width,      .75, 0.35, 1, 0.25);
        let vert = helpers.scale_clamp(size[1] / view_height,      .75, 0.35, 1, 0.25);
        rounded_box.style.setProperty("--rounding-amount", Math.min(horiz, vert));
    }

    // Return the size and position of the image, given the current pan and zoom.
    // The returned zoom_pos is center_pos after any clamping was applied for the current
    // position.
    get_current_actual_position({
        zoom_pos=null,

        // If false, edge clamping won't be applied.
        clamp_position=true,
    }={})
    {
        // If the dimensions are empty then we aren't loaded.  Clamp it to 1 so the math
        // below doesn't break.
        let width = Math.max(this.width, 1);
        let height = Math.max(this.height, 1);
        let view_width = Math.max(this.view_width, 1);
        let view_height = Math.max(this.view_height, 1);

        let zoom_factor = this._zoom_factor_current;
        let zoomed_width = width * zoom_factor;
        let zoomed_height = height * zoom_factor;

        if(zoom_pos == null)
            zoom_pos = this.current_zoom_pos;

        // When we're zooming to fill the view, clamp panning so we always fill the view
        // and don't pan past the edge.
        if(clamp_position)
        {
            if(this.zoom_active && !ppixiv.settings.get("pan-past-edge"))
            {
                let top_left = this.get_image_position([0,0], { pos: zoom_pos }); // minimum position
                top_left[0] = Math.max(top_left[0], 0);
                top_left[1] = Math.max(top_left[1], 0);
                zoom_pos = this.get_center_for_image_position([0,0], top_left);

                let bottom_right = this.get_image_position([view_width,view_height], { pos: zoom_pos }); // maximum position
                bottom_right[0] = Math.min(bottom_right[0], 1);
                bottom_right[1] = Math.min(bottom_right[1], 1);
                zoom_pos = this.get_center_for_image_position([view_width,view_height], bottom_right);
            }

            // If we're narrower than the view, lock to the middle.
            //
            // Take the floor of these, so if we're covering a 1500x1200 window with a 1500x1200.2 image we
            // won't wiggle back and forth by one pixel.
            if(view_width >= Math.floor(zoomed_width))
                zoom_pos[0] = 0.5; // center horizontally
            if(view_height >= Math.floor(zoomed_height))
                zoom_pos[1] = 0.5; // center vertically
        }

        // current_zoom_pos is the position that should be centered in the view.  At
        // [0.5,0.5], the image is centered.
        let x = view_width/2 - zoom_pos[0]*zoomed_width;
        let y = view_height/2 - zoom_pos[1]*zoomed_height;

        // If the display is 1:1 to the image, make sure there's no subpixel offset.  Do this if
        // we're in "actual" zoom mode, or if we're in another zoom with the same effect, such as
        // if we're viewing a 1920x1080 image on a 1920x1080 screen and we're in "cover" mode.
        // If we're scaling the image at all due to zooming, allow it to be fractional to allow
        // smoother panning.
        let in_actual_zoom_mode = Math.abs(this._zoom_factor_current - this._zoom_factor_actual) < 0.001;
        if(in_actual_zoom_mode)
        {
            x = Math.round(x);
            y = Math.round(y);
        }

        return { zoom_pos, zoom_factor, image_position: {x,y} };
    }

    _update_crop()
    {
        helpers.set_class(this._image_box, "cropping", this._cropped_size != null);

        // If we're not cropping, just turn the crop box off entirely.
        if(this._cropped_size == null)
        {
            this._crop_box.style.width = "100%";
            this._crop_box.style.height = "100%";
            this._crop_box.style.transformOrigin = "0 0";
            this._crop_box.style.transform = "";
            return;
        }

        // Crop the image by scaling up crop_box to cut off the right and bottom,
        // then shifting left and up.  The size is relative to image_box, so this
        // doesn't actually increase the image size.
        let crop_width = this._cropped_size.width / this._original_width;
        let crop_height = this._cropped_size.height / this._original_height;
        let crop_left = this._cropped_size.left / this._original_width;
        let crop_top = this._cropped_size.top / this._original_height;
        this._crop_box.style.width = `${(1/crop_width)*100}%`;
        this._crop_box.style.height = `${(1/crop_height)*100}%`;
        this._crop_box.style.transformOrigin = "0 0";
        this._crop_box.style.transform = `translate(${-crop_left*100}%, ${-crop_top*100}%)`;
    }

    // Restore the pan and zoom state from history.
    //
    // restoreHistory is true if we're viewing an image that was in browser history and
    // we want to restore the pan/zoom position from history.
    //
    // If it's false, we're viewing a new image.  We'll reset the image position, or restore
    // it selectively if "return to top" is disabled (view_mode != "manga").
    _set_initial_image_position(restoreHistory)
    {
        // If we were animating, start animating again.
        let args = helpers.args.location;
        if(args.state.zoom?.animating)
            this._refresh_animation();

        if(restoreHistory && args.state.zoom?.zoom != null)
            this.set_zoom_level(args.state.zoom?.zoom);
        if(restoreHistory && args.state.zoom?.lock != null)
            this.set_locked_zoom(args.state.zoom?.lock, { stop_animation: false });

        // Similar to how we display thumbnails for portrait images starting at the top, default to the top
        // if we'll be panning vertically when in cover mode.
        let aspect = this._relative_aspect;
        let center_pos = [0.5, aspect == "portrait"? 0:0.5];

        // If history has a center position, restore it if we're restoring history.  Also, restore it
        // if we're not in "return to top" mode as long as the aspect ratios of the images are similar,
        // eg. we're going from a portait image to another portrait image.
        if(args.state.zoom != null)
        {
            let old_aspect = args.state.zoom?.relative_aspect;
            let return_to_top = ppixiv.settings.get("view_mode") == "manga";
            if(restoreHistory || (!return_to_top && aspect == old_aspect))
                center_pos = [...args.state.zoom?.pos];
        }

        this._center_pos = center_pos;
    }

    // Save the pan and zoom state to history.
    _saveToHistory = () =>
    {
        // Store the pan position at the center of the view.
        let args = helpers.args.location;
        args.state.zoom = {
            pos: this._center_pos,
            zoom: this.get_zoom_level(),
            lock: this.getLockedZoom(),
            relative_aspect: this._relative_aspect,
            animating: this._animations_running,
        };

        helpers.navigate(args, { add_to_history: false });
    }

    // Schedule _saveToHistory to run.  This is buffered so we don't call history.replaceState
    // too quickly.
    schedule_saveToHistory()
    {
        // If we're called repeatedly, allow the first timer to complete, so we save
        // periodically during drags or flings that are taking a long time to finish
        // rather than not saving at all.
        if(this._saveToHistory_id)
            return;

        this._saveToHistory_id = realSetTimeout(() => {
            this._saveToHistory_id = null;

            // Work around a Chrome bug: updating history causes the mouse cursor to become visible
            // for one frame, which causes it to flicker while panning around.  Updating history state
            // shouldn't affect the UI at all.  Work around this by just rescheduling the save if the
            // mouse is currently pressed.
            if(this._mouse_pressed)
            {
                this.schedule_saveToHistory();
                return;
            }

            this._saveToHistory();
        }, 250);
    }

    _cancel_saveToHistory()
    {
        if(this._saveToHistory_id != null)
        {
            realClearTimeout(this._saveToHistory_id);
            this._saveToHistory_id = null;
        }
    }

    _create_current_animation()
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

        // Sanity check: this.container should always have a size.  If this is 0, the container
        // isn't visible and we don't know anything about how big we are, so we can't set up
        // the slideshow.  This is this.view_width below.
        if(this.container.offsetHeight == 0)
            console.warn("Image container has no size");

        let slideshow = new Slideshow({
            // this.width/this.height are the size of the image at 1x zoom, which is to fit
            // onto the view.  Scale this up by zoom_factor_cover, so the slideshow's default
            // zoom level is to cover the view.
            width: this.width,
            height: this.height,
            container_width: this.view_width,
            container_height: this.view_height,
            mode: animationMode,

            // Don't zoom below "contain".
            minimum_zoom: this.zoom_level_to_zoom_factor(0),
        });

        // Create the animation.
        let animation = slideshow.getAnimation(this._custom_animation);

        return { animationMode, animation };
    }

    // Start a pan/zoom animation.  If it's already running, update it in place.
    _refresh_animation()
    {
        // Create the animation.
        let { animationMode, animation } = this._create_current_animation();
        if(animation == null)
        {
            this._stop_animation();
            return;
        }

        // In slideshow-hold, delay between each alternation to let the animation settle visually.
        //
        // The animation API makes this a pain, since it has no option to delay between alternations.
        // We have to add it as an offset at both ends of the animation, and then increase the duration
        // to compensate.
        let iteration_start = 0;
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
            // iteration_start = fraction;

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
        this._stop_animation();
    
        this._currentAnimationMode = animationMode;
        
        // Create the main animation.
        this._animations.main = new ppixiv.DirectAnimation(new KeyframeEffect(
            this._image_box,
            animation.keyframes,
            {
                // The actual duration is set by updatePlaybackRate.
                duration: 1000,
                fill: 'forwards',
                direction: animationMode == "loop"? "alternate":"normal",
                iterations: animationMode == "loop"? Infinity:1,
                iterationStart: iteration_start,
            }
        ));

        // Set the speed.  Setting it this way instead of with the duration lets us change it smoothly
        // if settings are changed.
        this._animations.main.updatePlaybackRate(1 / animation.duration);
        this._animations.main.onfinish = this._check_animation_finished;

        // If this animation wants a fade-in and a previous one isn't still playing, start it.
        // Note that we use Animation and not DirectAnimation for fades, since DirectAnimation won't
        // sleep during the long delay while they're not doing anything.
        if(animation.fadeIn > 0)
            this._animations.fadeIn = Slideshow.makeFadeIn(this._image_box, { duration: animation.fadeIn * 1000 });

        // Create the fade-out.
        if(animation.fadeOut > 0)
        {
            this._animations.fadeOut = Slideshow.makeFadeOut(this._image_box, {
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
        this._update_rounding_box();
    }

    _check_animation_finished = async(e) =>
    {
        if(this._animations.main?.playState != "finished")
            return;

        // If we're not in slideshow mode, just clean up the animation and stop.  We should
        // never get here in slideshow-hold.
        if(this._currentAnimationMode != "slideshow" || !this._onnextimage)
        {
            this._stop_animation();
            return;
        }

        // Don't move to the next image while the user has a popup open.  We'll return here when
        // dialogs are closed.
        if(!ppixiv.OpenWidgets.singleton.empty)
        {
            console.log("Deferring next image while UI is open");
            return;
        }

        // Tell the caller that we're ready for the next image.  Don't call stop_animation yet,
        // so we don't cancel opacity and cause the image to flash onscreen while the new one
        // is loading.  We'll stop if when onnextimage navigates.
        let { mediaId } = await this._onnextimage(this);

        // onnextimage normally navigates to the next slideshow image.  If it didn't, call
        // stop_animation so we clean up the animation and make it visible again if it's faded
        // out.  This typically only happens if we only have one image.
        if(mediaId == null)
        {
            console.log("The slideshow didn't have a new image.  Resetting the slideshow animation");
            this._stop_animation();
        }
    }

    // Update just the animation speed, so we can smoothly show changes to the animation
    // speed as the user changes it.
    _refresh_animation_speed = () =>
    {
        if(!this._animations_running)
            return;

        // Don't update keyframes, since changing the speed can change keyframes too,
        // which will jump when we set them.  Just update the playback rate.
        let { animation } = this._create_current_animation();
        this._animations.main.updatePlaybackRate(1 / animation.duration);
    }

    // If an animation is running, cancel it.
    //
    // keep_animations is a list of animations to leave running.  For example, ["fadeIn"] will leave
    // any fade-in animation alone.
    _stop_animation({
        keep_animations=[],
    }={})
    {
        // Only continue if we have a main animation.  If we don't have an animation, we don't
        // want to modify the zoom/pan position and there's nothing to stop.
        if(!this._animations.main)
            return false;

        // Commit the current state of the main animation so we can read where the image was.
        let applied_animations = true;
        try {
            for(let [name, animation] of Object.entries(this._animations))
            {
                if(keep_animations.indexOf(name) != -1)
                    continue;
                animation.commitStyles();
            }
        } catch {
            applied_animations = false;
        }

        // Cancel all animations.  We don't need to wait for animation.pending here.
        for(let [name, animation] of Object.entries(this._animations))
        {
            if(keep_animations.indexOf(name) != -1)
                continue;

            animation.cancel();
            delete this._animations[name];
        }

        // Make sure we don't leave the image faded out if we stopped while in the middle
        // of a fade.
        this._image_box.style.opacity = "";

        this._currentAnimationMode = null;

        if(!applied_animations)
        {
            // For some reason, commitStyles throws an exception if we're not visible, which happens
            // if we're shutting down.  In this case, just cancel the animations.
            return true;
        }

        // Pull out the transform and scale we were left on when the animation stopped.
        let matrix = new DOMMatrix(getComputedStyle(this._image_box).transform);
        let zoom_factor = matrix.a, left = matrix.e, top = matrix.f;
        let zoom_level = this.zoom_factor_to_zoom_level(zoom_factor);

        // Apply the current zoom and pan position.  If the zoom level is 0 then just disable
        // zoom, and use "cover" if the zoom level matches it.  The zoom we set here doesn't
        // have to be one that's selectable in the UI.  Be sure to set stop_animation, so these
        // set_locked_zoom, etc. calls don't recurse into here.
        this.set_locked_zoom(true, { stop_animation: false });
        if(Math.abs(zoom_level) < 0.001)
            this.set_locked_zoom(false, { stop_animation: false });
        else if(Math.abs(zoom_level - this._zoom_level_cover) < 0.01)
            this.set_zoom_level("cover", { stop_animation: false });
        else
            this.set_zoom_level(zoom_level, { stop_animation: false });

        // Set the image position to match where the animation left it.
        this.set_image_position([left, top], [0,0]);
    
        this._reposition();
        return true;
    }

    get _animations_running()
    {
        return this._animations.main != null;
    }

    set pause_animation(pause)
    {
        this._pause_animation = pause;
        this.refresh_animation_paused();
    }

    // The animation is paused if we're explicitly paused while loading, or if something is
    // open over the image and registered with OpenWidgets, like the context menu.
    refresh_animation_paused()
    {
        // Note that playbackRate is broken on iOS.
        for(let animation of Object.values(this._animations))
        {
            // If an animation is finished, don't restart it, or it'll rewind.
            if(this._pause_animation && animation.playState == "running")
                animation.pause();
            else if(!this._pause_animation && animation.playState == "paused")
                animation.play();
        }
    }

    // These zoom helpers are mostly for the popup menu.
    //
    // Toggle zooming, centering around the given view position, or the center of the
    // view if x and y are null.
    zoom_toggle({x, y})
    {
        this._stop_animation();

        if(x == null || y == null)
        {
            x = this.view_width / 2;
            y = this.view_height / 2;
        }

        let center = this.get_image_position([x, y]);
        this.set_locked_zoom(!this.getLockedZoom());
        this.set_image_position([x, y], center);
        this._reposition();
    }

    // Set the zoom level, keeping the given view position stationary if possible.
    zoom_set_level(level, {x, y})
    {
        this._stop_animation();

        // If the zoom level that's already selected is clicked and we're already zoomed,
        // just toggle zoom as if the toggle zoom button was pressed.
        if(this.get_zoom_level() == level && this.getLockedZoom())
        {
            this.set_locked_zoom(false);
            this._reposition();
            return;
        }

        let center = this.get_image_position([x, y]);
        
        // Each zoom button enables zoom lock, since otherwise changing the zoom level would
        // only have an effect when click-dragging, so it looks like the buttons don't do anything.
        this.set_zoom_level(level);
        this.set_locked_zoom(true);
        this.set_image_position([x, y], center);

        this._reposition();
    }

    // Zoom in or out, keeping x,y centered if possible.  If x and y are null, center around
    // the center of the view.
    zoom_adjust(down, {x, y})
    {
        this._stop_animation();

        if(x == null || y == null)
        {
            x = this.view_width / 2;
            y = this.view_height / 2;
        }
        
        let center = this.get_image_position([x, y]);

        // If mousewheel zooming is used while not zoomed, turn on zooming and set
        // a 1x zoom factor, so we zoom relative to the previously unzoomed image.
        if(!this.zoom_active)
        {
            this.set_zoom_level(0);
            this.set_locked_zoom(true);
        }

        let previous_zoom_level = this._zoom_level_current;
        this.change_zoom(down);

        // If the zoom level didn't change, try one more time.  For example, if cover mode
        // is equal to zoom level 2 and we just switched between them, we've changed zoom
        // modes but nothing will actually change, so we should skip to the next level.
        if(Math.abs(previous_zoom_level - this._zoom_level_current) < 0.01)
            this.change_zoom(down);

        // If we're selecting zoom level 0, turn off zoom lock and set the zoom level to cover.
        // That displays the same thing, since 0 zoom is the same as unzoomed, but clicking the
        // image will zoom to cover, which is more natural.
        if(this.get_zoom_level() == 0)
        {
            this.set_zoom_level("cover");
            this.set_locked_zoom(false);
        }

        this.set_image_position([x, y], center);
        this._reposition();        
    }
}