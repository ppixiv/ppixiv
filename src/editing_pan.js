"use strict";

// This allows editing simple pan animations, to give finer control over slideshows.

ppixiv.PanEditor = class extends ppixiv.widget
{
    constructor(options)
    {
        super({...options, template: `
            <div class=pan-editor>
                <!-- This node is removed and placed on top of the image.-->
                <div class=pan-editor-overlay>
                    <div class=pan-editor-crop-region>
                        <ppixiv-inline class="handle" src="resources/pan-editor-marker.svg"></ppixiv-inline>
                        <div class=monitor-preview-box><div class=box></div></div>
                    </div>
                </div>

                <div class="image-editor-button-row box-button-row">
                    ${ helpers.create_box_link({popup: "Edit start", icon: "first_page", classes: ["edit-start-button"] }) }
                    ${ helpers.create_box_link({popup: "Swap start and end", icon: "swap_horiz", classes: ["swap-button"] }) }
                    ${ helpers.create_box_link({popup: "Edit end", icon: "last_page", classes: ["edit-end-button"] }) }
                    ${ helpers.create_box_link({popup: "Edit anchor", icon: "anchor", classes: ["edit-anchor"] }) }

                    <div class="box-link popup" data-popup="Zoom">
                        <span class="icon material-icons">zoom_in</span>
                        <input class=zoom-slider type=range min=5 max=200>
                    </div>

                    <div class="box-link popup aspect-ratio-slider" data-popup="Aspect ratio">
                        <span class="icon material-icons">panorama</span>
                        <input class=zoom-slider type=range min=0 max=2 style="width: 70px;">
                    </div>

                    ${ helpers.create_box_link({popup: "Clear animation", icon: "delete", classes: ["reset-button"] }) }
                </div>
            </div>
        `});

        this.shutdown_signal = new AbortController();

        this.width = this.height = 100;
        this.dragging = false;
        this.drag_start = null;
        this.anchor = new FixedDOMRect(0.5, 0.5, 0.5, 0.5);

        this.aspect_ratios = [
            [1920, 1080],
            [1920, 1200],
            [1080, 1920],
        ]

        // is_set is false if we've had no edits and we're displaying the defaults, or true if we
        // have data that can be saved.
        this.is_set = false;
        this.zoom_level = [1,1]; // start, end
        this.displayed_aspect_ratio = 0;

        this.editing = "start"; // "start" or "end"
        this.editing_anchor = false;

        this.ui = this.container.querySelector(".image-editor-button-row");
        this.monitor_preview_box = this.container.querySelector(".monitor-preview-box");

        // Remove .pan-editor-overlay.  It's inserted into the image overlay when we
        // have one, so it pans and zooms with the image.
        this.editor_overlay = this.container.querySelector(".pan-editor-overlay");
        this.editor_crop_region = this.container.querySelector(".pan-editor-crop-region");
        this.editor_overlay.remove();
        this.editor_overlay.slot = "crop-editor"; // XXX merge these
        this.handle = this.editor_overlay.querySelector(".handle");

        // The real zoom value is the amount the image will be zoomed onscreen: if it's set
        // to 2, the image is twice as big.  The zoom slider is inverted: a slider value of
        // 1/2 gives a zoom of 2.  This makes the zoom slider scale the size of the monitor
        // box linearly and feels more natural.
        this.zoom_slider = this.ui.querySelector(".zoom-slider");

        // Use watch_edits to save undo at the start of inputs being dragged.
        helpers.watch_edits(this.zoom_slider, { signal: this.shutdown_signal.signal });
        this.zoom_slider.addEventListener("editbegin", (e) => { this.parent.save_undo(); this.is_set = true; });
        this.zoom_slider.addEventListener("edit", (e) => {
            // console.log(e);
            let value = parseInt(this.zoom_slider.value) / 100;
            value = 1 / value;
            this.zoom_level[this.editing_index] = value;
            this.refresh();
        });

        // The preview size slider changes the monitor aspect ratio that we're previewing.
        this.aspect_ratio_slider = this.ui.querySelector(".aspect-ratio-slider input");
        this.aspect_ratio_slider.addEventListener("input", (e) => {
            this.displayed_aspect_ratio = parseInt(this.aspect_ratio_slider.value);
            this.refresh();
        });

        this.ui.querySelector(".edit-start-button").addEventListener("click", (e) => { this.editing = "start"; this.refresh(); });
        this.ui.querySelector(".edit-end-button").addEventListener("click", (e) => { this.editing = "end"; this.refresh(); });
        this.ui.querySelector(".edit-anchor").addEventListener("click", (e) => { this.editing_anchor = !this.editing_anchor; this.refresh(); });
        this.ui.querySelector(".reset-button").addEventListener("click", (e) => { this.clear(); });
        this.ui.querySelector(".swap-button").addEventListener("click", (e) => { this.swap(); });

        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.editor_overlay,
            callback: this.pointerevent,
            signal: this.shutdown_signal.signal,
        });

        // Prevent fullscreening if a UI element is double-clicked.
        this.editor_overlay.addEventListener("dblclick", this.ondblclick, { signal: this.shutdown_signal.signal });
    }

    // Return 0 if we're editing the start point, or 1 if we're editing the end point.
    get editing_index()
    {
        return this.editing == "start"? 0:1;
    }

    // This is called when the ImageEditingOverlayContainer changes.
    set overlay_container(overlay_container)
    {
        console.assert(overlay_container instanceof ImageEditingOverlayContainer);
        if(this.editor_overlay.parentNode)
            this.editor_overlay.remove();
        overlay_container.appendChild(this.editor_overlay);
        this._overlay_container = overlay_container;
    }

    clear()
    {
        if(!this.is_set)
            return;

        this.parent.save_undo();
        this.set_state(null);
    }

    // Swap the start and end points.
    swap()
    {
        this.parent.save_undo();
        this.is_set = true;
        this.rect = new FixedDOMRect(this.rect.x2, this.rect.y2, this.rect.x1,this.rect.y1);
        this.anchor = new FixedDOMRect(this.anchor.x2, this.anchor.y2, this.anchor.x1, this.anchor.y1);
        this.zoom_level = [this.zoom_level[1], this.zoom_level[0]];
        this.refresh();
    }

    get preview_size()
    {
        return this.aspect_ratios[this.displayed_aspect_ratio];
    }

    refresh()
    {
        super.refresh();
        if(!this.visible)
            return;

        let zoom = this.zoom_level[this.editing_index];
        this.zoom_slider.value = 1 / zoom * 100;
        
        helpers.set_class(this.ui.querySelector(".edit-start-button"), "selected", this.editing == "start");
        helpers.set_class(this.ui.querySelector(".edit-end-button"), "selected", this.editing == "end");
        helpers.set_class(this.ui.querySelector(".edit-anchor"), "selected", this.editing_anchor);
        this.aspect_ratio_slider.value = this.displayed_aspect_ratio;
        this.ui.querySelector(".aspect-ratio-slider").dataset.popup = `Previewing ${this.preview_size[0]}x${this.preview_size[1]}`;

        this.refresh_zoom_preview();
        this.refresh_center();
    }

    // Refresh the position of the center handle.
    refresh_center()
    {
        let { x, y } = this.editing == "start"? { x: this.rect.x1, y: this.rect.y1 }: { x: this.rect.x2, y: this.rect.y2 };
        x *= this.width;
        y *= this.height;
        this.handle.querySelector(".crosshair").setAttribute("transform", `translate(${x} ${y})`);
    }

    visibility_changed()
    {
        super.visibility_changed();
        this.editor_overlay.hidden = !this.visible;
        this.ui.hidden = !this.visible;
        if(this.visible)
            this.refresh();
    }

    set_illust_data({replace_editor_data, extra_data, width, height})
    {
        // Match the size of the image.
        this.width = width;
        this.height = height;

        // Handling crops and pans together is tricky.  The pan values are relative to the cropped
        // area: panning to 0.5x0.5 always goes to the center of the crop region, not the original
        // image.  But, these editors are all positioned and scaled relative to the original image.
        // This editor wants to be relative to the crop, so we scale and shift our own area relative
        // to the crop if there is one.
        if(extra_data?.crop)
        {
            let crop = new FixedDOMRect(extra_data.crop[0], extra_data.crop[1], extra_data.crop[2], extra_data.crop[3]);
            this.width = crop.width;
            this.height = crop.height;

            this.editor_crop_region.style.width = `${100 * crop.width / width}%`;
            this.editor_crop_region.style.height = `${100 * crop.height / height}%`;
            this.editor_crop_region.style.top = `${100 * crop.top / height}%`;
            this.editor_crop_region.style.left = `${100 * crop.left / width}%`;
        }
        else
        {
            this.editor_crop_region.style.width = this.editor_crop_region.style.height = ``;
            this.editor_crop_region.style.top = this.editor_crop_region.style.left = ``;
        }

        this.handle.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);

        if(replace_editor_data)
            this.set_state(extra_data?.pan);

        this.refresh();
    }

    get_data_to_save()
    {
        return { pan: this.get_state() };
    }

    async after_save(illust)
    {
        // Update the illust info.
        //
        // This updates image_data directly, since we don't currently have a path for
        // updating illust data after it's already loaded.
        local_api.adjust_illust_info(illust);
        image_data.singleton().image_data[illust.id] = illust;
        image_data.singleton().call_illust_modified_callbacks(illust.id);

        return true;
    }

    // Return data for saving.
    get_state({force=false}={})
    {
        if(!force && !this.is_set)
            return null;

        // These are stored as unit values, so we don't need to know the image dimensions to
        // set them up.
        let result = {
            x1: this.rect.x1,
            y1: this.rect.y1,
            x2: this.rect.x2,
            y2: this.rect.y2,
            start_zoom: this.zoom_level[0],
            end_zoom: this.zoom_level[1],
        };

        // Only include the anchor if it's been changed from the default.
        if(Math.abs(this.anchor.x1 - 0.5) > 0.001 ||
           Math.abs(this.anchor.y1 - 0.5) > 0.001 ||
           Math.abs(this.anchor.x2 - 0.5) > 0.001 ||
           Math.abs(this.anchor.y2 - 0.5) > 0.001)
        {
            result.anchor = {
                left: this.anchor.x1,
                top: this.anchor.y1,
                right: this.anchor.x2,
                bottom: this.anchor.y2,
            };
        }

        return result;
    }

    set_state(data)
    {
        this.is_set = data != null;
        this.anchor = new FixedDOMRect(0.5, 0.5, 0.5, 0.5);
        if(data == null)
        {
            this.rect = new FixedDOMRect(0, 0, 1, 1);
            this.zoom_level = [1,1];
        }
        else
        {
            this.rect = new FixedDOMRect(data.x1, data.y1, data.x2, data.y2);
            if(data.anchor)
                this.anchor = new FixedDOMRect(data.anchor.left, data.anchor.top, data.anchor.right, data.anchor.bottom);
            this.zoom_level = [data.start_zoom, data.end_zoom];
        }

        this.refresh();
    }

    get_current_slideshow()
    {
        // this.height/this.width is the size of the image.  Scale it to cover preview_width/preview_height,
        // as if we're on_click_viewer displaying it.  If the animation tells us to scale to 1x, it wants
        // to cover the screen.
        let [preview_width, preview_height] = this.preview_size;
        let scale_ratio = Math.max(preview_width/this.width, preview_height/this.height);
        let scaled_width = this.width * scale_ratio, scaled_height = this.height * scale_ratio;

        // The minimum zoom is the zoom that will fit the image onscreen.  This also matches on_click_viewer.
        let cover_ratio = Math.min(preview_width/scaled_width, preview_height/scaled_height);

        let slideshow = new ppixiv.slideshow({
            width: scaled_width,
            height: scaled_height,
            container_width: preview_width,
            container_height: preview_height,

            // The minimum zoom level to allow:
            minimum_zoom: cover_ratio,
    
            // If true, we're being used for slideshow mode, otherwise auto-pan mode.
            slideshow_enabled: false,
        });

        // Get the animation that we'd currently save, and load it as a slideshow.
        let pan_animation = this.get_state({force: true});
        let animation = slideshow.get_animation_from_pan(pan_animation);
        return { animation, scaled_width, scaled_height, preview_width, preview_height };
    }

    // Refresh the position and size of the monitor preview box.
    refresh_zoom_preview()
    {
        // Instead of moving the image around inside the monitor, scale the box to the size
        // of the preview "monitor", and scale/translate it around to show how the image would
        // fit inside it.
        let { animation, scaled_width, scaled_height, preview_width, preview_height } = this.get_current_slideshow();
        let pan = animation.pan[this.editing_index];
    
        let box = this.monitor_preview_box.querySelector(".box");
        box.style.width = `${100 * preview_width / scaled_width}%`;
        box.style.height = `${100 * preview_height / scaled_height}%`;

        let tx = 100 * -pan.computed_tx / scaled_width;
        let ty = 100 * -pan.computed_ty / scaled_height;

        // Apply the zoom by scaling the box's parent.  Scaling inside style.transform makes this simpler,
        // but makes things like outlines ugly.
        this.monitor_preview_box.style.width = `${100 / pan.computed_zoom}%`;
        this.monitor_preview_box.style.height = `${100 / pan.computed_zoom}%`;
        this.monitor_preview_box.style.transform = `
            translateX(${tx}%)
            translateY(${ty}%)
        `;
    }

    pointerevent = (e) =>
    {
        if(e.pressed)
        {
            e.preventDefault();
            e.stopPropagation();

            this.dragging = true;
            this.drag_saved_undo = false;
            this.drag_pos = [e.clientX, e.clientY];
            window.addEventListener("pointermove", this.pointermove_drag_point);
    
            return;
        }
        else if(this.dragging != -1 && !e.pressed)
        {
            // We stopped dragging.
            this.dragging = false;
            window.removeEventListener("pointermove", this.pointermove_drag_point);
        }
    }

    // Convert a click from client coordinates to image coordinates.
    get_point_from_click({clientX, clientY})
    {
        let {width, height, top, left} = this.editor_overlay.getBoundingClientRect();
        let x = (clientX - left) / width * this.width;
        let y = (clientY - top) / height * this.height;
        return { x: x, y: y };
    }

    pointermove_drag_point = (e) =>
    {
        // Save undo for this drag if we haven't yet.
        if(!this.drag_saved_undo)
        {
            this.parent.save_undo();
            this.drag_saved_undo = true;
        }

        // Get the delta in client coordinates.  Don't use movementX/movementY, since it's
        // in screen pixels and will be wrong if the browser is scaled.
        let delta_x = e.clientX - this.drag_pos[0];
        let delta_y = e.clientY - this.drag_pos[1];
        this.drag_pos = [e.clientX, e.clientY];

        // Scale movement from client coordinates to the size of the container.
        let {width, height} = this.editor_crop_region.getBoundingClientRect();
        delta_x /= width;
        delta_y /= height;

        // Check if we're editing the pan position or the anchor.
        let editing_anchor = this.editing_anchor;
        if(e.ctrlKey)
            editing_anchor = !editing_anchor;

        if(editing_anchor)
        {
            let { animation, scaled_width, scaled_height, preview_width, preview_height } = this.get_current_slideshow();
            let pan = animation.pan[this.editing_index];

            // If we add 1 to anchor.x1, we'll move the anchor one screen width to the right.
            // Scale this to the monitor preview that's currently visible.  This makes the speed
            // of dragging the anchor point match the current display.
            //
            // Moving the anchor will also move the view, so we also adjust the view position by
            // the same amount below.  This cancels out the movement of the anchor, so the display
            // position is stationary as we move the anchor.
            let monitor_width = (preview_width / scaled_width) / pan.computed_zoom;
            let monitor_height = (preview_height / scaled_height) / pan.computed_zoom;
            if(this.editing == "start")
            {
                this.anchor.x1 += delta_x / monitor_width;
                this.anchor.y1 += delta_y / monitor_height;
            } else {
                this.anchor.x2 += delta_x / monitor_width;
                this.anchor.y2 += delta_y / monitor_height;
            }
        }

        // Drag the rect.
        let rect = new FixedDOMRect(this.rect.x1, this.rect.y1, this.rect.x2, this.rect.y2);
        if(this.editing == "start")
        {
            rect.x1 += delta_x;
            rect.y1 += delta_y;
        } else {
            rect.x2 += delta_x;
            rect.y2 += delta_y;
        }

        this.rect = rect;

        this.is_set = true;
        this.refresh();
    }
}
