"use strict";

ppixiv.CropEditor = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({...options, template: `
            <div>
                <!-- This node is removed and placed on top of the image.-->
                <div class="editor-overlay crop-editor-overlay">
                    <div class=crop-box>
                        <!-- Middle section for the outline on top of the others: -->
                        <div class=handle data-crop=all></div>

                        <!-- A dimmer in each direction: -->
                        <div class=handle data-crop=top></div>
                        <div class=handle data-crop=left></div>
                        <div class=handle data-crop=right></div>
                        <div class=handle data-crop=bottom></div>

                        <!-- Make sure the corner handles are above the edge handles. -->
                        <div class=handle data-crop=topleft></div>
                        <div class=handle data-crop=topright></div>
                        <div class=handle data-crop=bottomleft></div>
                        <div class=handle data-crop=bottomright></div>
                    </div>
                </div>
            </div>
        `});

        this.shutdown_signal = new AbortController();
        this.width = 1;
        this.height = 1;

        this.editor_overlay = this.container.querySelector(".crop-editor-overlay");
        this.editor_overlay.remove();
        this.current_crop = null;

        this.editor_overlay.addEventListener("dblclick", this.ondblclick, { signal: this.shutdown_signal.signal });

        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.editor_overlay,
            callback: this.pointerevent,
            signal: this.shutdown_signal.signal,
        });
        
        this.box = this.editor_overlay.querySelector(".crop-box");

        this.refresh();
    }

    // Clear the crop on double-click.
    ondblclick = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();
        this.parent.save_undo();
        this.current_crop = null;
        this.refresh();
    }

    pointerevent = (e) =>
    {
        if(!e.pressed)
        {
            e.preventDefault();
            e.stopPropagation();

            window.removeEventListener("pointermove", this.pointermove);

            // If the crop was inverted, fix it up now.
            this.current_crop = this.effective_crop;
            return;
        }

        let clicked_handle = null;
        if(this.current_crop == null)
        {
            let {x,y} = this.client_to_container_pos({ x: e.clientX, y: e.clientY });
            this.current_crop = new FixedDOMRect(x, y, x, y);
            clicked_handle = "bottomright";
        }
        else
            clicked_handle = e.target.dataset.crop;
        if(clicked_handle == null)
            return;

        e.preventDefault();
        e.stopPropagation();
        this.parent.save_undo();

        // Which dimensions each handle moves:
        let drag_parts = {
            all: "move",
            topleft: {y: "y1", x: "x1"},
            top: {y: "y1"},
            topright: {y: "y1", x: "x2"},
            left: {x: "x1"},
            right: {x: "x2"},
            bottomleft: {y: "y2", x: "x1"},
            bottom: { y: "y2" },
            bottomright: { x: "x2", y: "y2" },
        }

        window.addEventListener("pointermove", this.pointermove);
        this.dragging = drag_parts[clicked_handle];
        this.drag_pos = this.client_to_container_pos({ x: e.clientX, y: e.clientY });
        this.refresh();
    }

    client_to_container_pos({x, y})
    {
        let {width, height, top, left} = this.editor_overlay.getBoundingClientRect();
        x -= left;
        y -= top;

        // Scale movement from client coordinates to the size of the container.
        x *= this.width / width;
        y *= this.height / height;
        return {x, y};
    }

    pointermove = (e) =>
    {
        // Get the delta in client coordinates.  Don't use movementX/movementY, since it's
        // in screen pixels and will be wrong if the browser is scaled.
        let pos = this.client_to_container_pos({ x: e.clientX, y: e.clientY });
        let delta = { x: pos.x - this.drag_pos.x, y: pos.y - this.drag_pos.y };
        this.drag_pos = pos;

        // Apply the drag.
        if(this.dragging == "move")
        {
            this.current_crop.x += delta.x;
            this.current_crop.y += delta.y;

            this.current_crop.x = Math.max(0, this.current_crop.x);
            this.current_crop.y = Math.max(0, this.current_crop.y);
            this.current_crop.x = Math.min(this.width - this.current_crop.width, this.current_crop.x);
            this.current_crop.y = Math.min(this.height - this.current_crop.height, this.current_crop.y);
        }
        else
        {
            let dragging = this.dragging;
            if(dragging.x != null)
                this.current_crop[dragging.x] += delta.x;
            if(dragging.y != null)
                this.current_crop[dragging.y] += delta.y;
        }

        this.refresh();
    }

    // Return the current crop.  If we're dragging, clean up the rectangle, making sure it
    // has a minimum size and isn't inverted.
    get effective_crop()
    {
        // If we're not dragging, just return the current crop rectangle.
        if(this.dragging == null)
            return this.current_crop;

        let crop = new FixedDOMRect(
            this.current_crop.x1,
            this.current_crop.y1,
            this.current_crop.x2,
            this.current_crop.y2,
        );

        // Keep the rect from being too small.  If the width is too small, push the horizontal
        // edge we're dragging away from the other side.
        if(this.dragging != "move")
        {
            let opposites = {
                x1: "x2",
                x2: "x1",
                y1: "y2",
                y2: "y1",
            }

            let min_size = 5;
            if(this.dragging.x != null && Math.abs(crop.width) < min_size)
            {
                let opposite_x = opposites[this.dragging.x];
                if(crop[this.dragging.x] < crop[opposite_x])
                    crop[this.dragging.x] = crop[opposite_x] - min_size;
                else
                    crop[this.dragging.x] = crop[opposite_x] + min_size;
            }

            if(this.dragging.y != null && Math.abs(crop.height) < min_size)
            {
                let opposite_y = opposites[this.dragging.y];
                if(crop[this.dragging.y] < crop[opposite_y])
                    crop[this.dragging.y] = crop[opposite_y] - min_size;
                else
                    crop[this.dragging.y] = crop[opposite_y] + min_size;
            }            
        }

        // If we've dragged across the opposite edge, flip the sides back around.
        crop = new FixedDOMRect(crop.left, crop.top, crop.right, crop.bottom);

        // Clamp to the image bounds.
        crop = new FixedDOMRect(
            Math.max(crop.left, 0),
            Math.max(crop.top, 0),
            Math.min(crop.right, this.width),
            Math.min(crop.bottom, this.height),
        );

        return crop;
    }

    refresh()
    {
        let box = this.editor_overlay.querySelector(".crop-box");
        box.hidden = this.current_crop == null;
        if(this.current_crop == null)
            return;

        let crop = this.effective_crop;
        box.style.width = `${100 * crop.width / this.width}%`;
        box.style.height = `${100 * crop.height / this.height}%`;
        box.style.left = `${100 * crop.left / this.width}%`;
        box.style.top = `${100 * crop.top / this.height}%`;
    }

    shutdown()
    {
        // Signal shutdown_signal to remove event listeners.
        console.assert(this.shutdown_signal != null);
        this.shutdown_signal.abort();
        this.shutdown_signal = null;
    }

    set_illust_data({replace_editor_data, extra_data, width, height})
    {
        if(extra_data == null)
            return;

        this.width = width;
        this.height = height;
        this.box.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    
        if(replace_editor_data)
            this.set_state(extra_data.crop);

        this.refresh();
    }

    set overlay_container(overlay_container)
    {
        console.assert(overlay_container instanceof ImageEditingOverlayContainer);
        if(this.editor_overlay.parentNode)
            this.editor_overlay.remove();

        overlay_container.crop_editor_overlay = this.editor_overlay;
        this._overlay_container = overlay_container;
    }

    get_data_to_save()
    {
        // If there's no crop, save an empty array to clear it.
        let state = this.get_state();
        return {
            crop: state,
        };
    }
    
    async after_save(media_info)
    {
        // Disable cropping after saving, so the crop is visible.
        settings.set("image_editing_mode", null);
    }

    get_state()
    {
        if(this.current_crop == null)
            return null;

        let crop = this.effective_crop;
        return [
            Math.round(crop.left),
            Math.round(crop.top),
            Math.round(crop.right),
            Math.round(crop.bottom),
        ]
    }

    set_state(crop)
    {
        if(crop == null)
            this.current_crop = null;
        else
            this.current_crop = new FixedDOMRect(crop[0], crop[1], crop[2], crop[3]);
        this.refresh();
    }

    visibility_changed()
    {
        super.visibility_changed();
        this.editor_overlay.hidden = !this.visible;
    }
}
