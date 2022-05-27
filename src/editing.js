"use strict";

ppixiv.ImageEditor = class extends ppixiv.illust_widget
{
    constructor({onvisibilitychanged, ...options})
    {
        super({...options,
            template: `
            <div class=image-editor>
                <div class="image-editor-buttons top">
                    <div class="image-editor-button-row box-button-row">
                        ${ helpers.create_box_link({icon: "save",     popup: "Save",          classes: ["save-edits", "popup-bottom"] }) }
                        ${ helpers.create_box_link({icon: "refresh",  popup: "Saving...",     classes: ["spinner"] }) }
                        ${ helpers.create_box_link({icon: "crop",     popup: "Crop",          classes: ["show-crop", "popup-bottom"] }) }
                        ${ helpers.create_box_link({icon: "wallpaper",popup: "Slideshow safe zones", classes: ["show-safe-zone", "popup-bottom"] }) }
                        ${ helpers.create_box_link({icon: "brush",    popup: "Inpainting",    classes: ["show-inpaint", "popup-bottom"] }) }
                        ${ helpers.create_box_link({icon: "close",    popup: "Stop editing",  classes: ["close-editor", "popup-bottom"] }) }
                    </div>
                </div>
                <div class="image-editor-buttons bottom"></div>
            </div>
        `});

        this.container.querySelector(".spinner").hidden = true;

        let crop_editor = new ppixiv.CropEditor({
            container: this.container,
            parent: this,
            mode: "crop",
        });

        let safe_zone_editor = new ppixiv.CropEditor({
            container: this.container,
            parent: this,
            mode: "safe_zone",
        });

        let inpaint_editor = new ppixiv.InpaintEditor({
            container: this.container,
            parent: this,
        });

        this.editors = {
            inpaint: inpaint_editor,
            crop: crop_editor,
            safe_zone: safe_zone_editor,
        };

        this.onvisibilitychanged = onvisibilitychanged;
        this._dirty = false;
        this.editing_media_id = null;
        this.undo_stack = [];

        this.top_button_row = this.container.querySelector(".image-editor-buttons.top");

        this.show_crop = this.container.querySelector(".show-crop");
        this.show_crop.addEventListener("click", (e) => {
            this.active_editor_name = this.active_editor_name == "crop"? null:"crop";
        });

        this.show_safe_zone = this.container.querySelector(".show-safe-zone");
        this.show_safe_zone.addEventListener("click", (e) => {
            this.active_editor_name = this.active_editor_name == "safe_zone"? null:"safe_zone";
        });

        this.show_inpaint = this.container.querySelector(".show-inpaint");
        this.show_inpaint.hidden = true;
        this.show_inpaint.addEventListener("click", (e) => {
            this.active_editor_name = this.active_editor_name == "inpaint"? null:"inpaint";
        });

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
            this.save();
        }, { signal: this.shutdown_signal.signal });

        this.close_editor = this.container.querySelector(".close-editor");
        this.close_editor.addEventListener("click", async (e) => {
            settings.set("image_editing", null);
            settings.set("image_editing_mode", null);
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

        // Steal buttons from the individual editors.
        this.inpaint_buttons = this.editors.inpaint.container.querySelector(".image-editor-button-row");
        this.inpaint_buttons.remove();
        this.container.querySelector(".image-editor-buttons.bottom").appendChild(this.inpaint_buttons);
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
    async refresh_internal({ media_id, illust_data })
    {
        // We can get the media ID before we have illust_data.  Ignore it until we have both.
        if(illust_data == null)
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
        let { width, height } = image_data.get_dimensions(illust_data, media_id);
        let extra_data = image_data.get_extra_data(illust_data, media_id);

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

        let showing_safe_zone = this.active_editor_name == "safe_zone" && this.visible;
        this.editors.safe_zone.visible = showing_safe_zone;
        helpers.set_class(this.show_safe_zone, "selected", showing_safe_zone);

        let showing_inpaint = is_local && this.active_editor_name == "inpaint" && this.visible;
        this.editors.inpaint.visible = showing_inpaint;
        this.inpaint_buttons.hidden = !showing_inpaint;
        helpers.set_class(this.show_inpaint, "selected", showing_inpaint);

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
    }

    // Redo the last undo.
    redo()
    {
        if(this.redo_stack.length == 0)
            return;

        this.undo_stack.push(this.get_state());
        this.set_state(this.redo_stack.pop());
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

    async save()
    {
        // Clear dirty before saving, so any edits made while saving will re-dirty, but set
        // it back to true if there's an error saving.
        this.dirty = false;

        let spinner = this.container.querySelector(".spinner");
        this.save_edits.hidden = true;
        spinner.hidden = false;
        try {
            // Get data from each editor, so we can save them together.
            let edits = { };
            for(let editor of Object.values(this.editors))
            {
                for(let [key, value] of Object.entries(editor.get_data_to_save()))
                    edits[key] = value;
            }

            let result;
            if(helpers.is_media_id_local(this.media_id))
            {
                result = await local_api.local_post_request(`/api/set-image-edits/${this.media_id}`, edits);
                if(!result.success)
                {
                    console.error("Error saving image edits:", result);
                    this.dirty = true;
                    return;
                }

                result = result.illust;
            }
            else
            {
                // Save data for Pixiv images to image_data.
                result = await image_data.singleton().save_extra_image_data(this.media_id, edits);                
            }

            // Let the widgets know that we saved.
            let current_editor = this.active_editor;
            if(current_editor?.after_save)
                current_editor.after_save(result);
        } finally {
            this.save_edits.hidden = false;
            spinner.hidden = true;
        }
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
ppixiv.ImageEditingOverlayContainer = class extends HTMLElement
{
    static get observedAttributes() { return ["image_src", "inpaint_src"]; }

    constructor()
    {
        super();

        this.attachShadow({mode: "open"});

        let container = document.createElement("div");
        container.setAttribute("class", "container");
        this.shadowRoot.append(container);

        this._main_img = document.createElement("img");
        this._main_img.dataset.img = "main-image";
        this._inpaint_img = document.createElement("img");
        this._inpaint_img.dataset.img = "inpaint-image";

        // Let pointer events through to the underlying image.
        this._inpaint_img.style.pointerEvents = "none";

        for(let img of [this._main_img, this._inpaint_img])
        {
            img.classList.add("filtering");
            img.addEventListener("load", this._onload);
            img.addEventListener("error", this._onerror);
            container.appendChild(img);
        }

        // Create slots to hold the editors.
        let inpaint_slot = document.createElement("slot");
        inpaint_slot.name = "inpaint-editor";
        container.append(inpaint_slot);

        let crop_slot = document.createElement("slot");
        crop_slot.name = "crop-editor";
        container.append(crop_slot);        

        let style = helpers.create_style(`
            .container, .container > * {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
            }
            img { will-change: transform; }
        `);
        this.shadowRoot.append(style);

        this.setAttribute("image_src", "");
        this.setAttribute("inpaint_src", "");
    }

    set_image_urls(image_url, inpaint_url)
    {
        this.image_src = image_url || "";
        this.inpaint_src = inpaint_url || "";
    }

    // Note that load will currently be fired twice, once for each image.
    _onload = (e) =>
    {
        // Dispatch loaded on ourself if both images are loaded.
        if(this.complete)
            this.dispatchEvent(new Event("load"));
    }

    _onerror = (e) =>
    {
        this.dispatchEvent(new Event("error"));
    }

    // Set the image URLs.  If set to null, use a blank image instead so we don't trigger
    // load errors.
    get image_src() { return this.getAttribute("image_src"); }
    set image_src(value) { this.setAttribute("image_src", value); }
    get inpaint_src() { return this.getAttribute("inpaint_src"); }
    set inpaint_src(value) { this.setAttribute("inpaint_src", value); }

    get complete()
    {
        return this._main_img.complete && this._inpaint_img.complete;
    }

    decode()
    {
        return Promise.all([this._main_img.decode(), this._inpaint_img.decode()]);
    }

    attributeChangedCallback(name, oldValue, newValue)
    {
        if(newValue == "")
            newValue = helpers.blank_image;
        if(name == "image_src")
            this._main_img.src = newValue;
        if(name == "inpaint_src")
            this._inpaint_img.src = newValue;
    }

    get width() { return this._main_img.width; }
    get height() { return this._main_img.height; }
    get naturalWidth() { return this._main_img.naturalWidth; }
    get naturalHeight() { return this._main_img.naturalHeight; }

    get hide_inpaint() { return this._inpaint_img.style.opacity == 0; }
    set hide_inpaint(value)
    {
        this._inpaint_img.style.opacity = value? 0:1;
    }
}

customElements.define("image-editing-overlay-container", ppixiv.ImageEditingOverlayContainer);
