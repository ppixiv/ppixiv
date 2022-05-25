"use strict";

ppixiv.CropEditor = class extends ppixiv.widget
{
    constructor({
        // This is used for editing both cropping and safe zones, since they both just
        // pick a rectangular region.  mode is either "crop" or "safe-zone" to tell us
        // which one we are.
        mode,
        ...options})
    {
        super({...options, template: `
            <div>
                <!-- This node is removed and placed on top of the image.-->
                <div class=crop-editor-overlay>
                    <div class=crop-box data-crop=all>
                        <!-- A dimmer in each direction: -->
                        <div class="crop-dim handle" data-crop=topleft     style="width: 10000px; height: 10000px; right:  100%; bottom: 100%;"></div>
                        <div class="crop-dim handle" data-crop=top         style="width: 100%;    height: 10000px; bottom: 100%;"></div>
                        <div class="crop-dim handle" data-crop=topright    style="width: 10000px; height: 10000px; bottom: 100%; left: 100%;"></div>

                        <div class="crop-dim handle" data-crop=left        style="width: 10000px; height: 100%;    right:  100%;"></div>
                        <div class="crop-dim handle" data-crop=right       style="width: 10000px; height: 100%;    left:   100%;"></div>

                        <div class="crop-dim handle" data-crop=bottomleft  style="width: 10000px; height: 10000px; top:    100%; right: 100%"></div>
                        <div class="crop-dim handle" data-crop=bottom      style="width: 100%;    height: 10000px; top:    100%;"></div>
                        <div class="crop-dim handle" data-crop=bottomright style="width: 10000px; height: 10000px; top:    100%; left: 100%;"></div>

                        <!-- Hidden drag handles inside the drag region.  This makes sure there's something to
                            drag at the edge if the crop is flush with the edge of the image. -->
                        <div class="edge-handle handle" data-crop=top           style="width: 100%;   height: 5vh; top: 0;"></div>
                        <div class="edge-handle handle" data-crop=bottom        style="width: 100%;   height: 5vh; bottom: 0;"></div>
                        <div class="edge-handle handle" data-crop=left          style="width: 5vh;    height: 100%; left: 0;"></div>
                        <div class="edge-handle handle" data-crop=right         style="width: 5vh;    height: 100%; right: 0;"></div>

                        <!-- Make sure the corner handles are above the edge handles. -->
                        <div class="edge-handle handle" data-crop=topleft       style="width: 5vh;    height: 5vh; top: 0; left: 0;"></div>
                        <div class="edge-handle handle" data-crop=topright      style="width: 5vh;    height: 5vh; top: 0; right: 0;"></div>
                        <div class="edge-handle handle" data-crop=bottomleft    style="width: 5vh;    height: 5vh; bottom: 0; left: 0;"></div>
                        <div class="edge-handle handle" data-crop=bottomright   style="width: 5vh;    height: 5vh; bottom: 0; right: 0;"></div>
                    </div>
                </div>
            </div>
        `});

        this.mode = mode;
        this.shutdown_signal = new AbortController();
        this.width = 1;
        this.height = 1;

        this.editor_overlay = this.container.querySelector(".crop-editor-overlay");
        this.editor_overlay.remove();
        this.editor_overlay.slot = "crop-editor";
        this.current_crop = null;

        this.editor_overlay.addEventListener("dblclick", this.ondblclick, { signal: this.shutdown_signal.signal });

        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.editor_overlay,
            callback: this.pointerevent,
            signal: this.shutdown_signal.signal,
        });
        
        this.svg = this.editor_overlay.querySelector(".crop-box");
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
        e.preventDefault();
        e.stopPropagation();

        if(!e.pressed)
        {
            window.removeEventListener("pointermove", this.pointermove);
            return;
        }

        this.parent.save_undo();

        let clicked_handle;
        if(this.current_crop == null)
        {
            let {x,y} = this.get_point_from_click(e);
            this.current_crop = new FixedDOMRect(x, y, x, y);
            clicked_handle = "bottomright";
        }
        else
            clicked_handle = e.target.dataset.crop;

        // Which dimensions each handle moves:
        let drag_parts = {
            all: "move",
            topleft: ["top", "left"],
            top: ["top"],
            topright: ["top", "right"],
            left: ["left"],
            right: ["right"],
            bottomleft: ["bottom", "left"],
            bottom: ["bottom"],
            bottomright: ["bottom", "right"],
        }

        window.addEventListener("pointermove", this.pointermove);
        this.dragging = drag_parts[clicked_handle];
        this.drag_pos = [e.clientX, e.clientY];
        this.refresh();
    }

    get_point_from_click({clientX, clientY})
    {
        let {width, height, top, left} = this.editor_overlay.getBoundingClientRect();
        console.log("overlay size", width, height, this.width, this.height);
        let x = (clientX - left) / width * this.width;
        let y = (clientY - top) / height * this.height;
        return { x: x, y: y };
    }

    pointermove = (e) =>
    {
        // Get the delta in client coordinates.  Don't use movementX/movementY, since it's
        // in screen pixels and will be wrong if the browser is scaled.
        let delta_x = e.clientX - this.drag_pos[0];
        let delta_y = e.clientY - this.drag_pos[1];
        this.drag_pos = [e.clientX, e.clientY];

        // Scale movement from client coordinates to the size of the container.
        let {width, height} = this.editor_overlay.getBoundingClientRect();
        delta_x *= this.width / width;
        delta_y *= this.height / height;

        // Apply the drag.
        if(this.dragging == "move")
        {
            this.current_crop.x += delta_x;
            this.current_crop.y += delta_y;
            this.current_crop.x = Math.max(0, this.current_crop.x);
            this.current_crop.y = Math.max(0, this.current_crop.y);
            this.current_crop.x = Math.min(this.width - this.current_crop.width, this.current_crop.x);
            this.current_crop.y = Math.min(this.height - this.current_crop.height, this.current_crop.y);
        }
        else
        {
            for(let part of this.dragging)
            {
                let min_size = 1;
                switch(part)
                {
                case "left":
                    this.current_crop.left += Math.min(this.current_crop.width - min_size, delta_x);
                    break;
                case "top":
                    this.current_crop.top += Math.min(this.current_crop.height - min_size, delta_y);
                    break;
                case "right":
                    this.current_crop.right -= Math.min(this.current_crop.width - min_size, -delta_x);
                    break;
                case "bottom":
                    this.current_crop.bottom -= Math.min(this.current_crop.height - min_size, -delta_y);
                    break;
                }
            }

            // Clamp the crop to the image bounds.
            this.current_crop.left = Math.max(0, this.current_crop.left);
            this.current_crop.top = Math.max(0, this.current_crop.top);
            this.current_crop.right = Math.min(this.width, this.current_crop.right);
            this.current_crop.bottom = Math.min(this.height, this.current_crop.bottom);
        }

        this.refresh();
    }

    refresh()
    {
        let box = this.editor_overlay.querySelector(".crop-box");
        box.hidden = this.current_crop == null;
        if(this.current_crop == null)
            return;

        box.style.width = `${100 * this.current_crop.width / this.width}%`;
        box.style.height = `${100 * this.current_crop.height / this.height}%`;
        box.style.left = `${100 * this.current_crop.left / this.width}%`;
        box.style.top = `${100 * this.current_crop.top / this.height}%`;
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
        this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    
        if(replace_editor_data)
            this.set_state(extra_data[this.mode]);

        this.refresh();
    }

    set overlay_container(overlay_container)
    {
        console.assert(overlay_container instanceof ImageEditingOverlayContainer)
        if(this.editor_overlay.parentNode)
            this.editor_overlay.remove();
        overlay_container.appendChild(this.editor_overlay);
        this._overlay_container = overlay_container;
    }

    get_data_to_save()
    {
        // If there's no crop, save an empty array to clear it.
        let state = this.get_state();
        if(this.mode == "crop")
            return {
                crop: state,
            };
        else
            return {
                safe_zone: state,
            };
    }

    get_state()
    {
        if(this.current_crop == null)
            return null;
        return [
            Math.round(this.current_crop.left),
            Math.round(this.current_crop.top),
            Math.round(this.current_crop.right),
            Math.round(this.current_crop.bottom),
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
