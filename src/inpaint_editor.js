"use strict";

let xmlns = "http://www.w3.org/2000/svg";

// The inpaint editor has two parts: InpaintEditor, for hovering UI elements, and
// InpaintEditorOverlay, which sits on top of the editor and scales with it.  Most of
// the work happens in InpaintEditorOverlay, and it stores all state, undo, etc.
ppixiv.InpaintEditor = class extends ppixiv.illust_widget
{
    static singleton = null;
    constructor(options)
    {
        super({...options, template: `
            <div class=inpaint-editor>
                <div class="inpaint-editor-buttons box-button-row">
                    <div class="box-link save-inpaint" style="position: relative">
                        Save
                        <div class=spinner hidden>
                            <span style="" class="material-icons spin">refresh</span>
                        </div>
                    </div>
                    <div class="box-link view-inpaint">View</div>
                    <div class="box-link create-lines">Create lines</div>

                    <div class="inpaint-line-width-box box-link">
                        <span>Thickness</span>
                        <input class=inpaint-line-width type=range min=1 max=50>
                        <div class="save-default-thickness popup" data-popup="Set as default">
                            <div class="material-icons" style="display: block;">push_pin</div>
                        </div>
                    </div>
                    <div class=box-link>
                        <span>Downscale</span>
                        <input class=inpaint-downscale type=range min=1 max=20>

                        <div class="save-default-downscale popup" data-popup="Set as default">
                            <div class="material-icons" style="display: block;">push_pin</div>
                        </div>
                    </div>
                    <div class=box-link>
                        <span>Soften edges</span>
                        <input class=inpaint-blur type=range min=0 max=5>

                        <div class="save-default-soften popup" data-popup="Set as default">
                            <div class="material-icons" style="display: block;">push_pin</div>
                        </div>
                    </div>
                </div>


            </div>
        `});

        this.shutdown_signal = new AbortController();

        // There should only be one of these at a time.
        console.assert(ppixiv.InpaintEditor.singleton == null);
        ppixiv.InpaintEditor.singleton = this;

        // Prevent fullscreen doubleclicks on UI buttons.
        this.container.addEventListener("dblclick", (e) => {
            e.stopPropagation();
        });

        this.create_lines_button = this.container.querySelector(".create-lines");
        this.create_lines_button.addEventListener("click", (e) => {
            this.editor.create_lines = !this.editor.create_lines;
        });

        // Update the selected line's thickness when the thickness slider changes.
        this.line_width_slider = this.container.querySelector(".inpaint-line-width");
        this.line_width_slider_box = this.container.querySelector(".inpaint-line-width-box");
        this.line_width_slider.addEventListener("input", (e) => {
            if(this.editor.selected_line == null)
                return;
            this.editor.selected_line.thickness = parseInt(this.line_width_slider.value);
        });
        this.line_width_slider.value = settings.get("inpaint_default_thickness", 10);

        // Hide the inpaint while dragging the thickness slider.
        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.line_width_slider,
            callback: (e) => {
                this._inpaint_container.hide_inpaint = e.pressed;
            },
        });

        this.downscale_slider = this.container.querySelector(".inpaint-downscale");
        this.downscale_slider.addEventListener("change", (e) => {
            this.editor.downscale_ratio = parseFloat(this.downscale_slider.value);
        }, { signal: this.shutdown_signal.signal });

        this.blur_slider = this.container.querySelector(".inpaint-blur");
        this.blur_slider.addEventListener("change", (e) => {
            this.editor.blur = parseFloat(this.blur_slider.value);
        }, { signal: this.shutdown_signal.signal });
        
        let save_inpaint = this.container.querySelector(".save-inpaint");
        save_inpaint.addEventListener("click", async (e) => {
            let spinner = save_inpaint.querySelector(".spinner");
            spinner.hidden = false;
            try {
                await this.inpaint_container.editor.save();
            } finally {
                spinner.hidden = true;
            }
        }, { signal: this.shutdown_signal.signal });

        let view_inpaint_button = this.container.querySelector(".view-inpaint");
        this.pointer_listener = new ppixiv.pointer_listener({
            element: view_inpaint_button,
            callback: (e) => {
                this.visible = !e.pressed;
            },
            signal: this.shutdown_signal.signal,
        });

        // "Save default" buttons:
        this.container.querySelector(".save-default-thickness").addEventListener("click", (e) => {
            let value = parseInt(this.line_width_slider.value);
            settings.set("inpaint_default_thickness", value);
            console.log("Saved default line thickness:", value);
        }, { signal: this.shutdown_signal.signal });

        this.container.querySelector(".save-default-downscale").addEventListener("click", (e) => {
            let value = parseFloat(this.downscale_slider.value);
            settings.set("inpaint_default_downscale", value);
            console.log("Saved default downscale:", value);
        }, { signal: this.shutdown_signal.signal });

        this.container.querySelector(".save-default-soften").addEventListener("click", (e) => {
            let value = parseFloat(this.blur_slider.value);
            settings.set("inpaint_default_blur", value);
            console.log("Saved default blur:", value);
        }, { signal: this.shutdown_signal.signal });

        this.visible = settings.get("inpaint_editing", false);
    }

    shutdown()
    {
        console.assert(this.shutdown_signal != null);
        this.shutdown_signal.abort();
        this.shutdown_signal = null;
        ppixiv.InpaintEditor.singleton = null;

        this.container.remove();
    }
    
    // When an InpaintImageContainer is created, it calls this so we know about it.  When
    // it's done, this is called with null.
    set inpaint_container(inpaint_container)
    {
        this._inpaint_container = inpaint_container;
        this.editor = inpaint_container?.editor;
        this.refresh();

        if(this._inpaint_container == null)
            return;

        // Sync up the editor's visibility with ours.
        this.refresh_editor_visibility();
        this.editor.set_illust_id(this.illust_id);
    }
    get inpaint_container() { return this._inpaint_container; }

    async refresh_internal({ illust_id, illust_data })
    {
        // Scale the thickness slider to the size of the image.
        let size = illust_data? Math.min(illust_data.width, illust_data.height):50;
        this.line_width_slider.max = size / 25;
    }

    refresh()
    {
        super.refresh();

        if(this.editor)
        {
            helpers.set_class(this.create_lines_button, "selected", this.editor.create_lines);

            // this.line_width_slider.disabled = this.editor.selected_line == null;
            // helpers.set_class(this.line_width_slider_box, "disabled", this.line_width_slider.disabled);

            if(this.editor.selected_line)
                this.line_width_slider.value = this.editor.selected_line.thickness;
            this.downscale_slider.value = this.editor.downscale_ratio;
            this.blur_slider.value = this.editor.blur;

            helpers.set_class(this.container.querySelector(".save-inpaint"), "dirty", this.editor.dirty);
        }
    }

    // Pass the illust ID to the overlay too.
    set_illust_id(illust_id)
    {
        super.set_illust_id(illust_id);

        if(this.editor != null)
            this.editor.set_illust_id(illust_id)
    }

    update_menu(menu_container)
    {
        let create = menu_container.querySelector(".edit-inpaint");
        helpers.set_class(create, "enabled", true);
        helpers.set_class(create, "selected", this.editor?.create_lines);
    }

    visibility_changed()
    {
        super.visibility_changed();
        this.refresh_editor_visibility();
        settings.set("inpaint_editing", this.visible);
    }

    refresh_editor_visibility()
    {
        if(this.editor)
            this.editor.visible = this.visible;
    }
}

ppixiv.InpaintEditorOverlay = class extends ppixiv.illust_widget
{
    constructor({inpaint_image_container, ...options})
    {
        super({...options, template: `
            <div class=inpaint-editor-overlay>
                <svg class=inpaint-container width=100% height=100% viewBox="0 0 1 1">
                </svg>
            </div>
        `});
        
        this.pointermove_drag_point = this.pointermove_drag_point.bind(this);

        // The InpaintImageContainer.  We have access to this so we can show and hide
        // the inpaint.
        this.inpaint_image_container = inpaint_image_container;

        this.width = 100;
        this.height = 100;
        this.lines = [];
        this._downscale_ratio = 1;
        this._blur = 0;
        this._dirty = false;
        this.undo_stack = [];

        this.dragging_segment_point = -1;
        this.drag_start = null;
        this.selected_line_idx = -1;

        this.svg = this.container.querySelector(".inpaint-container");
        this.editing_illust_id = null;

        this.create_lines = settings.get("inpaint_create_lines", false);
    }

    async refresh_internal({ illust_id, illust_data })
    {
        // If the illust ID hasn't changed, don't reimport data from illust_data.  Just
        // import it once when illust_id is set so we don't erase edits.
        if(illust_id == this.editing_illust_id)
            return;

        this.undo_stack = [];
        this.redo_stack = [];
        this.editing_illust_id = illust_id;
        this.clear();

        if(illust_data == null)
            return;

        // Match the size of the image.
        this.set_size(illust_data.width, illust_data.height);

        this.set_inpaint_data(illust_data.inpaint);

        // If there's no data at all, load the user's defaults.
        if(illust_data.inpaint == null)
        {
            this.downscale_ratio = settings.get("inpaint_default_downscale", 1);
            this.blur = settings.get("inpaint_default_blur", 0);
        }

        // We just loaded, so clear dirty.
        this.dirty = false;
    }

    async save()
    {
        let result = await local_api.local_post_request(`/api/edit-inpainting/${this.illust_id}`, {
            inpaint: this.get_inpaint_data({for_saving: true}),
        });

        if(!result.success)
        {
            console.error("Error saving inpaint:", result);
            return;
        }

        this.dirty = false;

        let illust = result.illust;
        if(illust.urls.inpaint)
        {
            // Saving the new inpaint data will change the inpaint URL.  It'll be generated the first
            // time it's fetched, which can take a little while.  Fetch it before updating image
            // data, so it's already generated when viewer_images updates with the new URL.
            // Otherwise, we'll be stuck looking at the low-res preview while it generates.
            let img = new Image();
            img.src = illust.urls.inpaint;
            await helpers.wait_for_image_load(img);
        }

        // Update the illust info.  The new info has the data we just saved, as well
        // as updated image URLs that include the new inpaint.
        //
        // This updates image_data directly, since we don't currently have a path for
        // updating illust data after it's already loaded..
        local_api.adjust_illust_info(illust);
        image_data.singleton().image_data[illust.id] = illust;
        image_data.singleton().call_illust_modified_callbacks(illust.id);

        // Update the thumbnail URL, so the new image shows up in search results and the
        // load preview.
        thumbnail_data.singleton().update_illust_data(illust.id, {
            previewUrls: [illust.urls.small],
        });
    }

    // Return inpaint data for saving.
    //
    // If for_saving is true, return data to send to the server.  This clears the
    // data entirely if there are no lines, so the inpaint data is removed entirely.
    // Otherwise, returns the full state, which is used for things like undo.
    get_inpaint_data({for_saving=false}={})
    {
        if(for_saving && this.lines.length == 0)
            return [];

        let result = [];

        let settings = { }
        if(this._downscale_ratio != 1)
            settings.downscale = this._downscale_ratio;
        if(this.blur != 0)
            settings.blur = this.blur;
        if(Object.keys(settings).length > 0)
        {
            settings.action = "settings";
            result.push(settings);
        }

        for(let line of this.lines)
        {
            let segments = [];
            for(let segment of line.segments)
                segments.push([segment[0], segment[1]]);
                
            let entry = {
                action: "line",
                thickness: line.thickness,
                line: segments,
            };
            result.push(entry);
        }

        return result;
    }

    // Replace the inpaint data.
    set_inpaint_data(inpaint)
    {
        this.clear();

        // Each entry looks like:
        //
        // [action: "settings", blur: 10, downscale: 2}
        // {action: "line", thickness: 10, line: [[1,1], [2,2], [3,3], [4,4], ...]}
        for(let part of inpaint || [])
        {
            let cmd = part.action;
            switch(cmd)
            {
            case "settings":
                if(part.downscale)
                    this.downscale_ratio = parseFloat(part.downscale);
                if(part.blur)
                    this.blur = parseFloat(part.blur);
                break;
            case "line":
                let line = this.add_line();
                if(part.thickness)
                    line.thickness = part.thickness;
    
                for(let point of part.line || [])
                    line.add_point({x: point[0], y: point[1]});
                break;

            default:
                console.error("Unknown inpaint command:", cmd);
                break;
            }
        }

        ppixiv.InpaintEditor.singleton.refresh();
    }

    get downscale_ratio() { return this._downscale_ratio; }
    set downscale_ratio(value)
    {
        if(this._downscale_ratio == value)
            return;

        this.save_undo();
        this._downscale_ratio = value;
    
        // Tell the InpaintEditor to refresh the slider.
        ppixiv.InpaintEditor.singleton.refresh();
    }

    get blur() { return this._blur; }
    set blur(value)
    {
        if(this._blur == value)
            return;

        this.save_undo();
        this._blur = value;
    
        // Tell the InpaintEditor to refresh the slider.
        ppixiv.InpaintEditor.singleton.refresh();
    }

    clear()
    {
        while(this.lines.length)
            this.remove_line(this.lines[0]);
        this._downscale_ratio = 1;
        this._blur = 0;
    }

    start()
    {
        if(this.shutdown_signal)
            return;

        this.shutdown_signal = new AbortController();
        this.onmousehover = this.onmousehover.bind(this);

        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.container,
            callback: this.pointerevent.bind(this),
            signal: this.shutdown_signal.signal,
        });

        // This is a pain.  We want to handle clicks when modifier buttons are pressed, and
        // let them through otherwise so panning works.  Every other event system lets you
        // handle or not handle a mouse event and have it fall through if you don't handle
        // it, but CSS won't.  Work around this by watching for our modifier keys and setting
        // pointer-events: none as needed.
        this.ctrl_pressed = false;
        for(let modifier of ["Control", "Alt", "Shift"])
        {
            new ppixiv.key_listener(modifier, (pressed) => {
                this.ctrl_pressed = pressed;
                this.refresh_pointer_events();
            }, {
                signal: this.shutdown_signal.signal
            });
        }

        window.addEventListener("keypress", (e) => {
            if(e.code == "KeyZ" && e.ctrlKey)
            {
                console.log("undo");
                e.stopPropagation();
                e.preventDefault();
                this.undo();
            }

            if(e.code == "KeyY" && e.ctrlKey)
            {
                console.log("redo");
                e.stopPropagation();
                e.preventDefault();
                this.redo();
            }
        }, { signal: this.shutdown_signal.signal });

        // Prevent fullscreening if a UI element is double-clicked.
        this.container.addEventListener("dblclick", this.ondblclick.bind(this), { signal: this.shutdown_signal.signal });

        this.container.addEventListener("mouseover", this.onmousehover, { signal: this.shutdown_signal.signal });

        this.refresh_pointer_events();
    }

    onmousehover(e)
    {
        let over = e.target.closest(".inpaint-line, .inpaint-handle") != null;
        this.inpaint_image_container.hide_inpaint = over;

        // While we think we're hovering, add a mouseover listener to window, so we catch
        // all mouseover events that tell us we're no longer hovering.  If we don't do this,
        // we won't see any event if the element that's being hovered is removed from the
        // document while it's being hovered.
        if(over)
            window.addEventListener("mouseover", this.onmousehover, { signal: this.shutdown_signal.signal });
        else
            window.removeEventListener("mouseover", this.onmousehover, { signal: this.shutdown_signal.signal });
    }

    // Store the current data as an undo state.
    save_undo()
    {
        this.undo_stack.push(this.get_inpaint_data());
        this.redo_stack = [];

        // Anything that adds to the undo stack causes us to be dirty.
        this.dirty = true;
    }

    get dirty() { return this._dirty; }
    set dirty(value)
    {
        if(this._dirty == value)
            return;

        this._dirty = value;
        ppixiv.InpaintEditor.singleton.refresh();
    }

    // Revert to the previous undo state, if any.
    undo()
    {
        if(this.undo_stack.length == 0)
            return;

        this.redo_stack.push(this.get_inpaint_data());
        this.set_inpaint_data(this.undo_stack.pop());

        // If we were adding a line, we just undid the first point, so end it.
        this.adding_line = null;
    }

    // Redo the last undo.
    redo()
    {
        if(this.redo_stack.length == 0)
            return;

        this.undo_stack.push(this.get_inpaint_data());
        this.set_inpaint_data(this.redo_stack.pop());
    }

    get create_lines() { return this._create_lines; }
    set create_lines(value)
    {
        if(this._create_lines == value)
            return;

        this._create_lines = value;
        settings.set("inpaint_create_lines", this.create_lines);

        this.refresh_pointer_events();

        // If we're turning quick line creation off and we have an incomplete line,
        // delete it.
        if(!this._create_lines && this.adding_line)
        {
            this.remove_line(this.adding_line);
            this.adding_line = null;
        }

        ppixiv.InpaintEditor.singleton.refresh();
    }

    refresh_pointer_events()
    {
        if(this.ctrl_pressed || this._create_lines)
            this.container.style.pointerEvents = "auto";
        else
            this.container.style.pointerEvents = "none";
    }

    get_control_point_from_element(node)
    {
        let inpaint_segment = node.closest(".inpaint-segment")?.widget;
        let control_point = node.closest("[data-type='control-point']");
        let inpaint_line = node.closest(".inpaint-line");
        if(inpaint_segment == null)
            return { };

        let control_point_idx = control_point? parseInt(control_point.dataset.idx):-1;
        let inpaint_line_idx = inpaint_line? parseInt(inpaint_line.dataset.idx):-1;

        // If we're on an inpaint segment we should always have a point or line.  If we
        // don't for some reason, ignore the segment too.
        if(control_point_idx == -1 && inpaint_line_idx == -1)
            inpaint_segment = null;

        return { inpaint_segment: inpaint_segment, control_point_idx: control_point_idx, inpaint_line_idx: inpaint_line_idx };
    }
    
    pointerevent(e)
    {
        let { x, y } = this.get_point_from_click(e);
        let { inpaint_segment, control_point_idx, inpaint_line_idx } = this.get_control_point_from_element(e.target);
        this.selected_line = inpaint_segment;

        // Check if we're in the middle of adding a line.  Don't do this if the
        // same point was clicked (fall through and allow moving the point).
        if(e.pressed && this.adding_line != null && (inpaint_segment == null || inpaint_segment != this.adding_line))
        {
            e.preventDefault();
            e.stopPropagation();

            if(inpaint_segment == this.adding_line)
            {
                console.log("stop");
                return;
            }
            this.save_undo();

            // If another segment was clicked while adding a line, connect to that line.
            if(inpaint_segment && control_point_idx != -1)
            {
                // We can only connect to the beginning or end.  Connect to whichever end is
                // closer to the point thta was clicked.
                let point_idx = 0;
                if(control_point_idx >= inpaint_segment.segments.length/2)
                    point_idx = inpaint_segment.segments.length;

                let point = this.adding_line.segments[0];
                this.remove_line(this.adding_line);

                this.adding_line = null;
                inpaint_segment.add_point({x: point[0], y: point[1], at: point_idx});
                return;
            }

            this.adding_line.add_point({x: x, y: y});
            this.adding_line = null;

            return;
        }

        if(e.pressed && inpaint_segment)
        {
            e.preventDefault();
            e.stopPropagation();

            this.save_undo();
            
            // If shift is held, clicking a line segment inserts a point.  Otherwise, it
            // drags the whole segment.
            if(control_point_idx == -1 && e.shiftKey)
            {
                let { x, y } = this.get_point_from_click(e);
                console.log("add at", inpaint_line_idx);

                control_point_idx = inpaint_segment.add_point({x: x, y: y, at: inpaint_line_idx});
            }

            this.dragging_segment = inpaint_segment;
            this.dragging_segment_point = control_point_idx;

            this.drag_pos = [e.clientX, e.clientY];

            window.addEventListener("pointermove", this.pointermove_drag_point);
            return;
        }
        else if(this.dragging_segment)
        {
            // We released dragging a segment.
            this.dragging_segment_point = -1;
            window.removeEventListener("pointermove", this.pointermove_drag_point);
        }

        // If we're in create line mode, create points on click.
        if(e.pressed && this._create_lines)
        {
            e.preventDefault();
            e.stopPropagation();
            
            this.save_undo();

            this.adding_line = this.add_line();
            this.adding_line.thickness = settings.get("inpaint_default_thickness", 10);
            this.adding_line.add_point({x: x, y: y});
        }
    }

    // Convert a click from client coordinates to image coordinates.
    get_point_from_click({clientX, clientY})
    {
        let {width, height, top, left} = this.container.getBoundingClientRect();
        let x = (clientX - left) / width * this.width;
        let y = (clientY - top) / height * this.height;
        return { x: x, y: y };
    }

    ondblclick(e)
    {
        // Block double-clicks to stop screen_illust from toggling fullscreen.
        e.stopPropagation();

        // Delete segments and points on double-click.
        let { inpaint_segment, control_point_idx } = this.get_control_point_from_element(e.target);
        if(inpaint_segment)
        {
            this.save_undo();

            if(control_point_idx == -1)
                this.remove_line(inpaint_segment);
            else
            {
                inpaint_segment.remove_point(control_point_idx);

                // If only one point is left, delete the segment.
                if(inpaint_segment.segments.length < 2)
                    this.remove_line(inpaint_segment);
            }
        }
    }

    pointermove_drag_point(e)
    {
        // Get the delta in client coordinates.  Don't use movementX/movementY, since it's
        // in screen pixels and will be wrong if the browser is scaled.
        let delta_x = e.clientX - this.drag_pos[0];
        let delta_y = e.clientY - this.drag_pos[1];
        this.drag_pos = [e.clientX, e.clientY];

        // Scale movement from client coordinates to the size of the container.
        let {width, height} = this.container.getBoundingClientRect();
        delta_x *= this.width / width;
        delta_y *= this.height / height;

        // Update the control points we're editing.  If dragging_segment_point is -1, update
        // the whole segment, otherwise update just that control point.
        let segments = this.dragging_segment.segments;
        for(let idx = 0; idx < segments.length; ++idx)
        {
            if(this.dragging_segment_point != -1 && this.dragging_segment_point != idx)
                continue;

            let segment = segments[idx];
            segment[0] += delta_x;
            segment[1] += delta_y;

            // Clamp the position so it doesn't go offscreen.
            segment[0] = helpers.clamp(segment[0], 0, this.width);
            segment[1] = helpers.clamp(segment[1], 0, this.height);
        }

        this.dragging_segment.update_segment();
    }

    stop()
    {
        // Clear lines when shutting down so we remove their event listeners.
        this.clear();

        if(this.shutdown_signal)
        {
            // Signal shutdown_signal to remove event listeners.
            this.shutdown_signal.abort();
            this.shutdown_signal = null;
        }
    }

    add_line()
    {
        let line = new LineEditorSegment({
            parent: this,
            container: this.svg,
        });

        this.lines.push(line);
        this.refresh_lines();
        return line;
    }

    remove_line(line)
    {
        line.container.remove();

        let idx = this.lines.indexOf(line);
        console.assert(idx != -1);
        
        // Deselect the line if it's selected.
        if(this.selected_line_idx == idx)
            this.selected_line = null;
        if(this.adding_line == line)
            this.adding_line = null;

        this.lines.splice(idx, 1);
        this.refresh_lines();
    }

    set selected_line(line)
    {
        if(line == null)
            this.selected_line_idx = -1;
        else
            this.selected_line_idx = this.lines.indexOf(line);

        this.refresh_lines();
        ppixiv.InpaintEditor.singleton.refresh();
    }

    get selected_line()
    {
        if(this.selected_line_idx == -1)
            return null;
        return this.lines[this.selected_line_idx];
    }

    refresh_lines()
    {
        for(let idx = 0; idx < this.lines.length; ++idx)
        {
            let line = this.lines[idx];
            if(idx == this.selected_line_idx)
                line.container.classList.add("selected");
            else
                line.container.classList.remove("selected");
        }
    }

    set_size(width, height)
    {
        this.width = width;
        this.height = height;
        this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    }
}

ppixiv.LineEditorSegment = class extends ppixiv.widget
{
    constructor({container, ...options})
    {
        // Templates don't work, because it doesn't create the <g> as an SVG
        // element.  Is there a way to make that work?
        let contents = document.createElementNS(xmlns, "g");
        contents.setAttribute("class", "inpaint-segment");
        container.appendChild(contents);

        super({...options, contents: contents});

        this.edit_points = [];
        this._thickness = 15;
        this.segments = [];

        this.segment_lines = [];

        this.create_edit_points();
    }

    get thickness() { return this._thickness; }
    set thickness(value) {
        this._thickness = value;
        this.create_edit_points();
    }

    add_point({x, y, at=-1})
    {
        let new_segment = [x, y];
        if(at == -1)
            at = this.segments.length;
        this.segments.splice(at, 0, new_segment);
        this.create_edit_points();
        return at;
    }

    remove_point(idx)
    {
        console.assert(idx < this.segments.length);
        this.segments.splice(idx, 1);
        this.create_edit_points();
    }

    create_edit_point()
    {
        let point = document.createElementNS(xmlns, "ellipse");
        point.setAttribute("class", "inpaint-handle");
        point.setAttribute("cx", "100");
        point.setAttribute("cy", "100");
        point.setAttribute("rx", "10");
        point.setAttribute("ry", "10");
        return point;
    }

    create_edit_points()
    {
        for(let line of this.segment_lines)
            line.remove();
        for(let point of this.edit_points)
            point.remove();

        this.segment_lines = [];
        this.edit_points = [];

        if(!this.polyline)
        {
            this.polyline = document.createElementNS(xmlns, "polyline");
            this.polyline.setAttribute("class", "inpaint-line");
            this.container.appendChild(this.polyline);
        }

        if(0)
        for(let idx = 0; idx < this.segments.length-1; ++idx)
        {
            // Use a rect for the lines.  It doesn't join as cleanly as a polyline,
            // but it lets us set both the fill and the stroke.
            let line = document.createElementNS(xmlns, "rect");
            line.setAttribute("class", "inpaint-line");
            line.dataset.idx = idx;

            this.container.appendChild(line);
            this.segment_lines.push(line);
        }

        for(let idx = 0; idx < this.segments.length; ++idx)
        {
            let point = this.create_edit_point();
            point.dataset.type = "control-point";
            point.dataset.idx = idx;
            this.edit_points.push(point);
            this.container.appendChild(point);
        }
        
        this.update_segment();
    }

    // Update the line and control points when they've moved.  If segments have been added
    // or deleted, call create_segments instead.
    update_segment()
    {
        let points = [];
        for(let point of this.segments)
            points.push(`${point[0]},${point[1]}`);

        this.polyline.setAttribute("points", points.join(" "));
        this.polyline.setAttribute("stroke-width", this._thickness);

        if(0)
        for(let idx = 0; idx < this.segments.length-1; ++idx)
        {
            let line = this.segment_lines[idx];
            let p0 = this.segments[idx];
            let p1 = this.segments[idx+1];

            let length = Math.pow(p0[0]-p1[0], 2) + Math.pow(p0[1]-p1[1],2);
            length = Math.sqrt(length);

            let angle = Math.atan2(p1[1]-p0[1], p1[0]-p0[0]) * 180 / Math.PI;
            line.setAttribute("transform", `translate(${p0[0]}, ${p0[1]}) rotate(${angle}, 0, 0) translate(0 ${-this._thickness/2})`);
            line.setAttribute("x", 0);
            line.setAttribute("y", 0);
            line.setAttribute("rx", this._thickness/4);
            line.setAttribute("width", length);
            line.setAttribute("height", this._thickness);
        }

/*        let points = [];
        for(let segment of this.segments)
            points.push(`${segment[0]},${segment[1]}`);

        points = points.join(" ");
        this.line.setAttribute("points", points);
*/
        for(let idx = 0; idx < this.segments.length; ++idx)
        {
            let segment = this.segments[idx];
            let edit_point = this.edit_points[idx];
            edit_point.setAttribute("cx", segment[0]);
            edit_point.setAttribute("cy", segment[1]);

            let radius = this._thickness / 2;
            radius = Math.max(radius, 25);
            edit_point.setAttribute("rx", radius);
            edit_point.setAttribute("ry", radius);
        }
    }
}

// This is a custom element that roughly emulates an HTMLImageElement, but contains two
// overlaid images instead of one to overlay the inpaint, and holds the InpaintEditorOverlay.
// Load and error events are dispatched, and the image is considered loaded or complete when
// both of its images are loaded or complete.  This allows on_click_viewer to display inpainting
// and the inpaint editor without needing to know much about it, so we can avoid complicating
// the viewer.
ppixiv.InpaintImageContainer = class extends HTMLElement
{
    static get observedAttributes() { return ["src", "src2"]; }

    constructor()
    {
        super();

        this._onload = this._onload.bind(this);
        this._onerror = this._onerror.bind(this);

        this.attachShadow({mode: "open"});

        let container = document.createElement("div");
        container.setAttribute("class", "container");
        this.shadowRoot.append(container);

        this._img1 = document.createElement("img");
        this._img1.dataset.img = "main-image";
        this._img2 = document.createElement("img");
        this._img2.dataset.img = "inpaint-image";

        for(let img of [this._img1, this._img2])
        {
            img.classList.add("filtering");
            img.addEventListener("load", this._onload);
            img.addEventListener("error", this._onerror);
            container.appendChild(img);
        }

        let slot = document.createElement("slot");
        slot.name = "inpaint-editor";
        container.append(slot);

        let style = document.createElement("style");
        style.textContent = `
            .container, .container > * {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
            }
        `;
        this.shadowRoot.append(style);

        this.attributeChangedCallback("src", null, this.getAttribute("src"));
        this.attributeChangedCallback("src2", null, this.getAttribute("src2"));

        // Create the InpaintEditorOverlay.  This has the actual line editing UI
        // that gets overlaid on top of the image.  
        this.editor = new ppixiv.InpaintEditorOverlay({
            container: this.container,
            inpaint_image_container: this,
        });
        this.editor.container.slot = "inpaint-editor";
        this.appendChild(this.editor.container);
    }

    set_image_urls(image_url, inpaint_url)
    {
        this.src = image_url;
        this.src2 = inpaint_url;
    }

    _onload(e)
    {
        // Dispatch loaded on ourself if both images are loaded.
        if(this.complete)
            this.dispatchEvent(new Event("load"));
    }

    _onerror(e)
    {
        this.dispatchEvent(new Event("error"));
    }

    // Set the image URLs.  If set to null, use a blank image instead so we don't trigger
    // load errors.
    get src() { return this.getAttribute("src"); }
    set src(value) { this.setAttribute("src", value || helpers.blank_image); }
    get src2() { return this.getAttribute("src2"); }
    set src2(value) { this.setAttribute("src2", value || helpers.blank_image); }

    get complete()
    {
        return this._img1.complete && this._img2.complete;
    }

    decode()
    {
        return Promise.all([this._img1.decode(), this._img2.decode()]);
    }

    attributeChangedCallback(name, oldValue, newValue)
    {
        if(name == "src")
            this._img1.src = newValue;
        if(name == "src2")
            this._img2.src = newValue;
    }

    connectedCallback()
    {
        if(!this.isConnected)
            return;

        this.editor.start();

        // There should always be an InpaintEditor active when we're added to a document.
        // Make us the active container.
        ppixiv.InpaintEditor.singleton.inpaint_container = this;
    }

    disconnectedCallback(x)
    {
        this.editor.stop();

        if(ppixiv.InpaintEditor.singleton.inpaint_container == this)
            ppixiv.InpaintEditor.singleton.inpaint_container = null;
    }

    get width() { return this._img1.width; }
    get height() { return this._img1.height; }
    get naturalWidth() { return this._img1.naturalWidth; }
    get naturalHeight() { return this._img1.naturalHeight; }

    get hide_inpaint() { return this._img2.style.opacity == 0; }
    set hide_inpaint(value)
    {
        this._img2.style.opacity = value? 0:1;
    }
}

customElements.define("inpaint-image-container", ppixiv.InpaintImageContainer);
