"use strict";

ppixiv.ImageEditor = class extends ppixiv.illust_widget
{
    constructor({
        // The ImageEditingOverlayContainer, which holds editor UI that goes inside the
        // image box.
        overlay_container,
        onvisibilitychanged,
        ...options
    })
    {
        super({...options,
            template: `
            <div class=image-editor>
                <div class="image-editor-buttons top">
                    <div class="image-editor-button-row box-button-row left">
                        ${ helpers.create_box_link({icon: "undo",     popup: "Undo",          classes: ["undo", "popup-bottom"] }) }
                        ${ helpers.create_box_link({icon: "redo",     popup: "Redo",          classes: ["redo", "popup-bottom"] }) }
                    </div>
                    <div class="image-editor-button-row box-button-row center ">
                        ${ helpers.create_box_link({icon: "save",     popup: "Save",          classes: ["save-edits", "popup-bottom"] }) }
                        ${ helpers.create_box_link({icon: "refresh",  popup: "Saving...",     classes: ["spinner"] }) }
                        ${ helpers.create_box_link({icon: "crop",     popup: "Crop",          classes: ["show-crop", "popup-bottom"] }) }
                        ${ helpers.create_box_link({icon: "wallpaper",popup:  "Edit panning", classes: ["show-pan", "popup-bottom"] }) }
                        ${ helpers.create_box_link({icon: "brush",    popup: "Inpainting",    classes: ["show-inpaint", "popup-bottom"], dataset: { popupSide: "center" } }) }
                    </div>
                    <div class="image-editor-button-row box-button-row right">
                        ${ helpers.create_box_link({icon: "close",    popup: "Stop editing",  classes: ["close-editor", "popup-bottom"], dataset: { popupSide: "left" } }) }
                    </div>
                </div>
            </div>
        `});

        this.container.querySelector(".spinner").hidden = true;

        let crop_editor = new ppixiv.CropEditor({
            container: this.container,
            parent: this,
            mode: "crop",
        });

        let pan_editor = new ppixiv.PanEditor({
            container: this.container,
            parent: this,
        });

        let inpaint_editor = new ppixiv.InpaintEditor({
            container: this.container,
            parent: this,
        });

        this.editors = {
            inpaint: inpaint_editor,
            crop: crop_editor,
            pan: pan_editor,
        };

        this.onvisibilitychanged = onvisibilitychanged;
        this._dirty = false;
        this.editing_media_id = null;
        this.undo_stack = [];
        this.redo_stack = [];

        this.top_button_row = this.container.querySelector(".image-editor-buttons.top");

        this.show_crop = this.container.querySelector(".show-crop");
        this.show_crop.addEventListener("click", (e) => {
            e.stopPropagation();

            this.active_editor_name = this.active_editor_name == "crop"? null:"crop";
        });

        this.show_pan = this.container.querySelector(".show-pan");
        this.show_pan.addEventListener("click", (e) => {
            e.stopPropagation();

            this.active_editor_name = this.active_editor_name == "pan"? null:"pan";
        });

        this.show_inpaint = this.container.querySelector(".show-inpaint");
        this.show_inpaint.hidden = true;
        this.show_inpaint.addEventListener("click", (e) => {
            e.stopPropagation();

            this.active_editor_name = this.active_editor_name == "inpaint"? null:"inpaint";
        });

        this.overlay_container = overlay_container;

        OpenWidgets.singleton.addEventListener("changed", this.refresh_temporarily_hidden, { signal: this.shutdown_signal.signal });

        window.addEventListener("keydown", (e) => {
            if(!this.visible)
                return;

            if(e.code == "KeyC" && e.ctrlKey)
            {
                // It's tricky to figure out if there's something the user might be trying to copy.
                // See if there's a text selection.  This requires that anything that might have
                // a selection disable selection with user-select: none while it's hidden, so the
                // selection doesn't stick around while it's not visible, but that's generally
                // a good idea anyway.
                if(getSelection().toString() != "")
                {
                    console.log("Not copying editor because text is selected");
                    return;
                }

                e.preventDefault();
                e.stopPropagation();
                this.copy();
            }
            else if(e.code == "KeyV" && e.ctrlKey)
            {
                e.preventDefault();
                e.stopPropagation();
                this.paste();
            }
        }, { signal: this.shutdown_signal.signal });

        // Refresh when these settings change.
        for(let setting of ["image_editing", "image_editing_mode"])
            settings.changes.addEventListener(setting, () => {
                this.refresh();

                // Let our parent know that we may have changed editor visibility, since this
                // affects whether image cropping is active.
                this.onvisibilitychanged();
            }, { signal: this.shutdown_signal.signal });

        // Stop propagation of pointerdown at the container, so clicks inside the UI don't
        // move the image.
        this.container.addEventListener("pointerdown", (e) => { e.stopPropagation(); });

        // Prevent fullscreen doubleclicks on UI buttons.
        this.container.addEventListener("dblclick", (e) => {
            e.stopPropagation();
        });

        this.save_edits = this.container.querySelector(".save-edits");
        this.save_edits.addEventListener("click", async (e) => {
            e.stopPropagation();
            this.save();
        }, { signal: this.shutdown_signal.signal });

        this.close_editor = this.container.querySelector(".close-editor");
        this.close_editor.addEventListener("click", async (e) => {
            e.stopPropagation();
            settings.set("image_editing", null);
            settings.set("image_editing_mode", null);
        }, { signal: this.shutdown_signal.signal });

        this.undo_button = this.container.querySelector(".undo");
        this.redo_button = this.container.querySelector(".redo");
        this.undo_button.addEventListener("click", async (e) => {
            e.stopPropagation();
            this.undo();            
        }, { signal: this.shutdown_signal.signal });
        this.redo_button.addEventListener("click", async (e) => {
            e.stopPropagation();
            this.redo();            
        }, { signal: this.shutdown_signal.signal });

        // Hotkeys:
        window.addEventListener("keydown", (e) => {
            if(e.code == "KeyS" && e.ctrlKey)
            {
                e.stopPropagation();
                e.preventDefault();
                this.save();
            }

            if(e.code == "KeyZ" && e.ctrlKey)
            {
                e.stopPropagation();
                e.preventDefault();
                this.undo();
            }

            if(e.code == "KeyY" && e.ctrlKey)
            {
                e.stopPropagation();
                e.preventDefault();
                this.redo();
            }
        }, { signal: this.shutdown_signal.signal });
    }

    // Return true if the crop editor is active.
    get editing_crop()
    {
        return settings.get("image_editing", false) && this.active_editor_name == "crop";
    }

    shutdown()
    {
        for(let editor of Object.values(this.editors))
            editor.shutdown();

        super.shutdown();
    }

    refresh_temporarily_hidden = () =>
    {
        // Hide while the UI is open.  This is only needed on mobile, where our buttons
        // overlap the hover UI.
        let hidden = ppixiv.mobile && !OpenWidgets.singleton.empty;
        helpers.set_class(this.container, "temporarily-hidden", hidden);
    }

    visibility_changed()
    {
        settings.set("image_editing", this.visible);

        // Refresh to update editor visibility.
        this.refresh();

        this.onvisibilitychanged();

        super.visibility_changed();
    }

    // In principle we could refresh from thumbnail data if this is the first manga page, since
    // all we need is the image dimensions.  However, the editing container is only displayed
    // by on_click_viewer after we have full image data anyway since it's treated as part of the
    // main image, so we won't be displayed until then anyway.
    async refresh_internal({ media_id, media_info })
    {
        // We can get the media ID before we have media_info.  Ignore it until we have both.
        if(media_info == null)
            media_id = null;

        let editor_is_open = this.open_editor != null;
        let media_id_changing = media_id != this.editing_media_id;

        this.editing_media_id = media_id;

        // Only tell the editor to replace its own data if we're changing images, or the
        // editor is closed.  If the editor is open and we're not changing images, don't
        // clobber ongoing edits.
        let replace_editor_data = media_id_changing || !editor_is_open;

        // For local images, editing data is simply stored as a field on the illust data, which
        // we can save to the server.
        //
        // For Pixiv images, we store editing data locally in IndexedDB.  All pages are stored on
        // the data for the first page, as an extraData dictionary with page media IDs as keys.
        //
        // Pull out the dictionary containing editing data for this image to give to the editor.
        let { width, height } = ppixiv.media_cache.get_dimensions(media_info, media_id);
        let extra_data = ppixiv.media_cache.get_extra_data(media_info, media_id);

        // Give the editors the new illust data.
        for(let editor of Object.values(this.editors))
            editor.set_illust_data({ media_id, extra_data, width, height, replace_editor_data });

        // If no editor is open, make sure the undo stack is cleared and clear dirty.
        if(!editor_is_open)
        {
            // Otherwise, just make sure the undo stack is cleared.
            this.undo_stack = [];
            this.redo_stack = [];
            this.dirty = false;
        }

        this.refresh_temporarily_hidden();
    }

    get open_editor()
    {
        for(let editor of Object.values(this.editors))
        {
            if(editor.visible)
                return editor;
        }

        return null;
    }

    // This is called when the ImageEditingOverlayContainer changes.
    set overlay_container(overlay_container)
    {
        this.current_overlay_container = overlay_container;
        for(let editor of Object.values(this.editors))
            editor.overlay_container = overlay_container;
    }

    refresh()
    {
        super.refresh();

        this.visible = settings.get("image_editing", false);
        helpers.set_class(this.save_edits, "dirty", this.dirty);

        let is_local = helpers.is_media_id_local(this.media_id);
        if(this.media_id != null)
            this.show_inpaint.hidden = !is_local;

        let showing_crop = this.active_editor_name == "crop" && this.visible;
        this.editors.crop.visible = showing_crop;
        helpers.set_class(this.show_crop, "selected", showing_crop);

        let showing_pan = this.active_editor_name == "pan" && this.visible;
        this.editors.pan.visible = showing_pan;
        helpers.set_class(this.show_pan, "selected", showing_pan);

        let showing_inpaint = is_local && this.active_editor_name == "inpaint" && this.visible;
        this.editors.inpaint.visible = showing_inpaint;
        helpers.set_class(this.show_inpaint, "selected", showing_inpaint);

        helpers.set_class(this.undo_button, "disabled", this.undo_stack.length == 0);
        helpers.set_class(this.redo_button, "disabled", this.redo_stack.length == 0);

        // Hide the undo buttons in the top-left when no editor is active, since it overlaps the hover
        // UI.  Undo doesn't handle changes across editors well currently anyway.
        this.top_button_row.querySelector(".left").hidden = this.active_editor_name == null;

        // Disable hiding the mouse cursor when editing is enabled.  This also prevents
        // the top button row from being hidden.
        if(showing_crop || showing_inpaint)
            hide_mouse_cursor_on_idle.disable_all("image-editing");
        else
            hide_mouse_cursor_on_idle.enable_all("image-editing");
    }

    // Store the current data as an undo state.
    save_undo()
    {
        this.undo_stack.push(this.get_state());
        this.redo_stack = [];

        // Anything that adds to the undo stack causes us to be dirty.
        this.dirty = true;
    }

    // Revert to the previous undo state, if any.
    undo()
    {
        if(this.undo_stack.length == 0)
            return;

        this.redo_stack.push(this.get_state());
        this.set_state(this.undo_stack.pop());

        // If InpaintEditor was adding a line, we just undid the first point, so end it.
        this.editors.inpaint.adding_line = null;
        this.refresh();
    }

    // Redo the last undo.
    redo()
    {
        if(this.redo_stack.length == 0)
            return;

        this.undo_stack.push(this.get_state());
        this.set_state(this.redo_stack.pop());
        this.refresh();
    }

    // Load and save state, for undo.
    get_state()
    {
        let result = {};
        for(let [name, editor] of Object.entries(this.editors))
            result[name] = editor.get_state();
        return result;
    }

    set_state(state)
    {
        for(let [name, editor] of Object.entries(this.editors))
            editor.set_state(state[name]);
    }

    get_data_to_save({include_empty=true}={})
    {
        let edits = { };
        for(let editor of Object.values(this.editors))
        {
            for(let [key, value] of Object.entries(editor.get_data_to_save()))
            {
                if(include_empty || value != null)
                    edits[key] = value;
            }
        }
        return edits;
    }

    async save()
    {
        // Clear dirty before saving, so any edits made while saving will re-dirty, but set
        // it back to true if there's an error saving.
        this.dirty = false;

        let spinner = this.container.querySelector(".spinner");
        this.save_edits.hidden = true;
        spinner.hidden = false;
        try {
            // Get data from each editor.
            let edits = this.get_data_to_save();

            let media_info;
            if(helpers.is_media_id_local(this.media_id))
            {
                let result = await local_api.local_post_request(`/api/set-image-edits/${this.media_id}`, edits);
                if(!result.success)
                {
                    message_widget.singleton.show(`Error saving image edits: ${result.reason}`);
                    console.error("Error saving image edits:", result);
                    this.dirty = true;

                    return;
                }

                // Update cached media info to include the change.
                media_info = result.illust;
                local_api.adjust_illust_info(media_info);
                media_cache.update_media_info(this.media_id, media_info);
            }
            else
            {
                // Save data for Pixiv images to image_data.
                media_info = await media_cache.save_extra_image_data(this.media_id, edits);                
            }

            // Let the widgets know that we saved.
            let current_editor = this.active_editor;
            if(current_editor?.after_save)
                current_editor.after_save(media_info);
        } finally {
            this.save_edits.hidden = false;
            spinner.hidden = true;
        }
    }

    async copy()
    {
        let data = this.get_data_to_save({include_empty: false});

        if(Object.keys(data).length == 0)
        {
            message_widget.singleton.show("No edits to copy");
            return;
        }

        data.type = "ppixiv-edits";
        data = JSON.stringify(data, null, 4);

        // We should be able to write to the clipboard with a custom MIME type that we can
        // recognize, but the clipboard API is badly designed and only lets you write a tiny
        // set of types.
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/plain": new Blob([data], { type: "text/plain" })
            })
        ]);

        message_widget.singleton.show("Edits copied");
    }

    async paste()
    {
        let text = await navigator.clipboard.readText();
        let data;
        try {
            data = JSON.parse(text);
        } catch(e) {
            message_widget.singleton.show("Clipboard doesn't contain edits");
            return;
        }

        if(data.type != "ppixiv-edits")
        {
            message_widget.singleton.show("Clipboard doesn't contain edits");
            return;
        }

        this.set_state(data);
        await this.save();

        message_widget.singleton.show("Edits pasted");
    }

    get active_editor_name()
    {
        return settings.get("image_editing_mode", null);
    }

    set active_editor_name(editor_name)
    {
        if(editor_name != null && this.editors[editor_name] == null)
            throw new Error(`Invalid editor name ${editor_name}`);

        settings.set("image_editing_mode", editor_name);
    }

    get active_editor()
    {
        let current_editor = this.active_editor_name;
        if(current_editor == null)
            return null;
        else
            return this.editors[current_editor];
    }

    get dirty() { return this._dirty; }
    set dirty(value)
    {
        if(this._dirty == value)
            return;

        this._dirty = value;
        this.refresh();
    }
}

// This is a custom element that roughly emulates an HTMLImageElement, but contains two
// overlaid images instead of one to overlay the inpaint, and holds the InpaintEditorOverlay.
// Load and error events are dispatched, and the image is considered loaded or complete when
// both of its images are loaded or complete.  This allows on_click_viewer to display inpainting
// and the inpaint editor without needing to know much about it, so we can avoid complicating
// the viewer.
ppixiv.ImageEditingOverlayContainer = class extends ppixiv.widget
{
    constructor({
        ...options
    })
    {
        super({...options, template: `
            <div class=editing-container>
                <div class=inpaint-editor-overlay-container></div>
                <div class=crop-editor-overlay-container></div>
                <div class=pan-editor-overlay-container></div>
            </div>
        `});

        this.inpaint_editor_overlay_container = this.container.querySelector(".inpaint-editor-overlay-container");
        this.crop_editor_overlay_container = this.container.querySelector(".crop-editor-overlay-container");
        this.pan_editor_overlay_container = this.container.querySelector(".pan-editor-overlay-container");
    }

    set inpaint_editor_overlay(node)
    {
        helpers.remove_elements(this.inpaint_editor_overlay_container);
        this.inpaint_editor_overlay_container.appendChild(node);
    }

    set crop_editor_overlay(node)
    {
        helpers.remove_elements(this.crop_editor_overlay_container);
        this.crop_editor_overlay_container.appendChild(node);
    }

    set pan_editor_overlay(node)
    {
        helpers.remove_elements(this.pan_editor_overlay_container);
        this.pan_editor_overlay_container.appendChild(node);
    }
}
