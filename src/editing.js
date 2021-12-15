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
                        <div class="box-link save-edits popup popup-bottom" style="position: relative" data-popup="Save">
                            <span class="material-icons">save</span>
                            
                            <div class=spinner hidden>
                                <span style="" class="material-icons spin">refresh</span>
                            </div>
                        </div>

                        <div class="box-link show-crop popup popup-bottom" data-popup="Crop">
                            <span class="material-icons">crop</span>
                        </div>
                        <div class="box-link show-inpaint popup popup-bottom" data-popup="Inpainting">
                            <span class="material-icons">brush</span>
                        </div>
                    </div>
                </div>
                <div class="image-editor-buttons bottom"></div>
            </div>
        `});

        this.crop_editor = new ppixiv.CropEditor({
            container: this.container,
            parent: this,
        });

        this.inpaint_editor = new ppixiv.InpaintEditor({
            container: this.container,
            parent: this,
        });

        this.shutdown_signal = new AbortController();
        this.onvisibilitychanged = onvisibilitychanged;
        this._dirty = false;
        this.editing_illust_id = null;
        this.undo_stack = [];

        this.show_crop = this.container.querySelector(".show-crop");
        this.show_crop.addEventListener("click", (e) => {
            settings.set("image_editing_mode", settings.get("image_editing_mode", null) == "crop"? null:"crop");
        });

        this.show_inpaint = this.container.querySelector(".show-inpaint");
        this.show_inpaint.addEventListener("click", (e) => {
            settings.set("image_editing_mode", settings.get("image_editing_mode", null) == "inpaint"? null:"inpaint");
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
        this.inpaint_buttons = this.inpaint_editor.container.querySelector(".image-editor-button-row");
        this.inpaint_buttons.remove();
        this.container.querySelector(".image-editor-buttons.bottom").appendChild(this.inpaint_buttons);
    }

    // Return true if the crop editor is active.
    get editing_crop()
    {
        return settings.get("image_editing", false) && settings.get("image_editing_mode", null) == "crop";
    }

    shutdown()
    {
        // Signal shutdown_signal to remove event listeners.
        console.assert(this.shutdown_signal != null);
        this.shutdown_signal.abort();
        this.shutdown_signal = null;

        this.crop_editor.shutdown();
        this.inpaint_editor.shutdown();

        this.container.remove();
    }

    visibility_changed()
    {
        settings.set("image_editing", this.visible);

        // Explicitly hide our children, so they have a chance to hide any overlays.
        this.crop_editor.visible = this.visible;
        this.inpaint_editor.visible = this.visible;

        this.onvisibilitychanged();

        super.visibility_changed();
    }

    async refresh_internal({ illust_data })
    {
        // If the illust ID hasn't changed, don't reimport data from illust_data.  Just
        // import it once when illust_id is set so we don't erase edits.
        let illust_id = illust_data?.id;
        if(illust_data && illust_id == this.editing_illust_id)
            return;

        // Clear undo/redo on load.
        this.undo_stack = [];
        this.redo_stack = [];
        this.editing_illust_id = illust_id;
    
        this.crop_editor.set_illust_data(illust_data);
        this.inpaint_editor.set_illust_data(illust_data);

        // We just loaded, so clear dirty.
        this.dirty = false;
    }

    // This is called when the ImageEditingOverlayContainer changes.
    set overlay_container(overlay_container)
    {
        this.inpaint_editor.overlay_container = overlay_container;
        this.crop_editor.overlay_container = overlay_container;
    }

    refresh()
    {
        super.refresh();

        this.visible = settings.get("image_editing", false);
        helpers.set_class(this.save_edits, "dirty", this.dirty);

        let showing_crop = settings.get("image_editing_mode", null) == "crop";
        this.crop_editor.visible = showing_crop;
        helpers.set_class(this.show_crop, "selected", showing_crop);

        let showing_inpaint = settings.get("image_editing_mode", null) == "inpaint";
        this.inpaint_editor.visible = showing_inpaint;
        this.inpaint_buttons.hidden = !showing_inpaint;
        helpers.set_class(this.show_inpaint, "selected", showing_inpaint);
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
        this.inpaint_editor.adding_line = null;
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
        return {
            inpaint: this.inpaint_editor.get_inpaint_data(),
            crop: this.crop_editor.get_state(),
        };
    }

    set_state(state)
    {
        console.log(state);
        this.inpaint_editor.set_inpaint_data(state.inpaint);
        this.crop_editor.set_state(state.crop);
    }

    async save()
    {
        // Clear dirty before saving, so any edits made while saving will re-dirty, but set
        // it back to true if there's an error saving.
        this.dirty = false;

        let spinner = this.save_edits.querySelector(".spinner");
        spinner.hidden = false;
        try {
            // Get data from each editor, so we can save them together.
            let edits = { };
            for(let editor of [this.inpaint_editor, this.crop_editor])
            {
                for(let [key, value] of Object.entries(editor.get_data_to_save()))
                    edits[key] = value;
            }

            let result = await local_api.local_post_request(`/api/set-image-edits/${this.illust_id}`, edits);
            if(!result.success)
            {
                console.error("Error saving image edits:", result);
                this.dirty = true;
                return;
            }

            // Let the widgets know that we saved.
            await this.inpaint_editor.after_save(result);
        } finally {
            spinner.hidden = true;
        }
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

        this._onload = this._onload.bind(this);
        this._onerror = this._onerror.bind(this);

        this.attachShadow({mode: "open"});

        let container = document.createElement("div");
        container.setAttribute("class", "container");
        this.shadowRoot.append(container);

        this._main_img = document.createElement("img");
        this._main_img.dataset.img = "main-image";
        this._inpaint_img = document.createElement("img");
        this._inpaint_img.dataset.img = "inpaint-image";

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

        this.attributeChangedCallback("image_src", null, this.getAttribute("image_src"));
        this.attributeChangedCallback("inpaint_src", null, this.getAttribute("inpaint_src"));
    }

    set_image_urls(image_url, inpaint_url)
    {
        this.image_src = image_url;
        this.inpaint_src = inpaint_url;
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
    get image_src() { return this.getAttribute("image_src"); }
    set image_src(value) { this.setAttribute("image_src", value || helpers.blank_image); }
    get inpaint_src() { return this.getAttribute("inpaint_src"); }
    set inpaint_src(value) { this.setAttribute("inpaint_src", value || helpers.blank_image); }

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
