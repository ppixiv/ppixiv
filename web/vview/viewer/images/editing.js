import PanEditor from '/vview/viewer/images/editing-pan.js';
import InpaintEditor from '/vview/viewer/images/editing-inpaint.js';
import CropEditor from '/vview/viewer/images/editing-crop.js';
import LocalAPI from '/vview/misc/local-api.js';
import { HideMouseCursorOnIdle } from '/vview/misc/hide-mouse-cursor-on-idle.js';
import { IllustWidget } from '/vview/widgets/illust-widgets.js';
import { helpers, OpenWidgets } from '/vview/misc/helpers.js';

export default class ImageEditor extends IllustWidget
{
    constructor({
        // The ImageEditingOverlayContainer, which holds editor UI that goes inside the
        // image box.
        overlayContainer,
        onvisibilitychanged,
        visible=null,
        ...options
    })
    {
        // Set our default visibility to the image_editing setting.
        if(visible == null)
            visible = ppixiv.settings.get("image_editing", false);

        super({...options,
            visible,
            template: `
            <div class=image-editor>
                <div class="image-editor-buttons top">
                    <div class="image-editor-button-row box-button-row left">
                        ${ helpers.createBoxLink({icon: "undo",     popup: "Undo",          classes: ["undo", "popup-bottom"] }) }
                        ${ helpers.createBoxLink({icon: "redo",     popup: "Redo",          classes: ["redo", "popup-bottom"] }) }
                    </div>
                    <div class="image-editor-button-row box-button-row center ">
                        ${ helpers.createBoxLink({icon: "save",     popup: "Save",          classes: ["save-edits", "popup-bottom"] }) }
                        ${ helpers.createBoxLink({icon: "refresh",  popup: "Saving...",     classes: ["spinner"] }) }
                        ${ helpers.createBoxLink({icon: "crop",     popup: "Crop",          classes: ["show-crop", "popup-bottom"] }) }
                        ${ helpers.createBoxLink({icon: "wallpaper",popup:  "Edit panning", classes: ["show-pan", "popup-bottom"] }) }
                        ${ helpers.createBoxLink({icon: "brush",    popup: "Inpainting",    classes: ["show-inpaint", "popup-bottom"], dataset: { popupSide: "center" } }) }
                    </div>
                    <div class="image-editor-button-row box-button-row right">
                        ${ helpers.createBoxLink({icon: "close",    popup: "Stop editing",  classes: ["close-editor", "popup-bottom"], dataset: { popupSide: "left" } }) }
                    </div>
                </div>
            </div>
        `});

        this.root.querySelector(".spinner").hidden = true;

        let cropEditor = new CropEditor({
            container: this.root,
            mode: "crop",
            visible: false,
        });

        let panEditor = new PanEditor({
            container: this.root,
            visible: false,
        });

        let inpaintEditor = new InpaintEditor({
            container: this.root,
            visible: false,
        });

        this.editors = {
            inpaint: inpaintEditor,
            crop: cropEditor,
            pan: panEditor,
        };

        this.onvisibilitychanged = onvisibilitychanged;
        this._dirty = false;
        this._editingMediaId = null;
        this._undoStack = [];
        this._redoStack = [];

        this._topButtonRow = this.root.querySelector(".image-editor-buttons.top");

        this._showCrop = this.root.querySelector(".show-crop");
        this._showCrop.addEventListener("click", (e) => {
            e.stopPropagation();

            this.activeEditorName = this.activeEditorName == "crop"? null:"crop";
        });

        this._showPan = this.root.querySelector(".show-pan");
        this._showPan.addEventListener("click", (e) => {
            e.stopPropagation();

            this.activeEditorName = this.activeEditorName == "pan"? null:"pan";
        });

        this._showInpaint = this.root.querySelector(".show-inpaint");
        this._showInpaint.hidden = true;
        this._showInpaint.addEventListener("click", (e) => {
            e.stopPropagation();

            this.activeEditorName = this.activeEditorName == "inpaint"? null:"inpaint";
        });

        this.overlayContainer = overlayContainer;

        OpenWidgets.singleton.addEventListener("changed", this._refreshTemporarilyHidden, { signal: this.shutdownSignal });

        window.addEventListener("keydown", (e) => {
            if(!this.visible)
                return;

            if(e.code == "KeyC" && helpers.isCtrlPressed(e))
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
            else if(e.code == "KeyV" && helpers.isCtrlPressed(e))
            {
                e.preventDefault();
                e.stopPropagation();
                this.paste();
            }
        }, { signal: this.shutdownSignal });

        // Refresh when these settings change.
        for(let setting of ["image_editing", "image_editing_mode"])
            ppixiv.settings.addEventListener(setting, () => {
                this.refresh();

                // Let our parent know that we may have changed editor visibility, since this
                // affects whether image cropping is active.
                this.onvisibilitychanged();
            }, { signal: this.shutdownSignal });

        // Stop propagation of pointerdown at the container, so clicks inside the UI don't
        // move the image.
        this.root.addEventListener("pointerdown", (e) => { e.stopPropagation(); });

        // Prevent fullscreen doubleclicks on UI buttons.
        this.root.addEventListener("dblclick", (e) => {
            e.stopPropagation();
        });

        this._saveEdits = this.root.querySelector(".save-edits");
        this._saveEdits.addEventListener("click", async (e) => {
            e.stopPropagation();
            this.save();
        }, { signal: this.shutdownSignal });

        this._closeEditor = this.root.querySelector(".close-editor");
        this._closeEditor.addEventListener("click", async (e) => {
            e.stopPropagation();
            ppixiv.settings.set("image_editing", null);
            ppixiv.settings.set("image_editing_mode", null);
        }, { signal: this.shutdownSignal });

        this._undoButton = this.root.querySelector(".undo");
        this._redoButton = this.root.querySelector(".redo");
        this._undoButton.addEventListener("click", async (e) => {
            e.stopPropagation();
            this.undo();            
        }, { signal: this.shutdownSignal });
        this._redoButton.addEventListener("click", async (e) => {
            e.stopPropagation();
            this.redo();            
        }, { signal: this.shutdownSignal });

        // Hotkeys:
        window.addEventListener("keydown", (e) => {
            if(e.code == "KeyS" && helpers.isCtrlPressed(e))
            {
                e.stopPropagation();
                e.preventDefault();
                this.save();
            }

            if(e.code == "KeyZ" && helpers.isCtrlPressed(e))
            {
                e.stopPropagation();
                e.preventDefault();
                this.undo();
            }

            if(e.code == "KeyY" && helpers.isCtrlPressed(e))
            {
                e.stopPropagation();
                e.preventDefault();
                this.redo();
            }
        }, { signal: this.shutdownSignal });
    }

    // Return true if the crop editor is active.
    get editingCrop()
    {
        return ppixiv.settings.get("image_editing", false) && this.activeEditorName == "crop";
    }

    _refreshTemporarilyHidden = () =>
    {
        // Hide while the UI is open.  This is only needed on mobile, where our buttons
        // overlap the hover UI.
        let hidden = ppixiv.mobile && !OpenWidgets.singleton.empty;
        helpers.html.setClass(this.root, "temporarily-hidden", hidden);
    }

    visibilityChanged()
    {
        if(ppixiv.settings.get("image_editing") != this.visible)
            ppixiv.settings.set("image_editing", this.visible);

        // Refresh to update editor visibility.
        this.refresh();

        this.onvisibilitychanged();

        super.visibilityChanged();
    }

    // In principle we could refresh from thumbnail data if this is the first manga page, since
    // all we need is the image dimensions.  However, the editing container is only displayed
    // by ViewerImages after we have full image data anyway since it's treated as part of the
    // main image, so we won't be displayed until then anyway.
    async refreshInternal({ mediaId, mediaInfo })
    {
        // We can get the media ID before we have mediaInfo.  Ignore it until we have both.
        if(mediaInfo == null)
            mediaId = null;

        let editorIsOpen = this.openEditor != null;
        let mediaIdChanging = mediaId != this._editingMediaId;

        this._editingMediaId = mediaId;

        // Only tell the editor to replace its own data if we're changing images, or the
        // editor is closed.  If the editor is open and we're not changing images, don't
        // clobber ongoing edits.
        let replaceEditorData = mediaIdChanging || !editorIsOpen;

        // For local images, editing data is simply stored as a field on the illust data, which
        // we can save to the server.
        //
        // For Pixiv images, we store editing data locally in IndexedDB.  All pages are stored on
        // the data for the first page, as an extraData dictionary with page media IDs as keys.
        //
        // Pull out the dictionary containing editing data for this image to give to the editor.
        let { width, height } = ppixiv.mediaCache.getImageDimensions(mediaInfo, mediaId);
        let extraData = ppixiv.mediaCache.getExtraData(mediaInfo, mediaId);

        // Give the editors the new illust data.
        for(let editor of Object.values(this.editors))
            editor.setIllustData({ mediaId, extraData, width, height, replaceEditorData });

        // If no editor is open, make sure the undo stack is cleared and clear dirty.
        if(!editorIsOpen)
        {
            // Otherwise, just make sure the undo stack is cleared.
            this._undoStack = [];
            this._redoStack = [];
            this.dirty = false;
        }

        this._refreshTemporarilyHidden();
    }

    get openEditor()
    {
        for(let editor of Object.values(this.editors))
        {
            if(editor.visible)
                return editor;
        }

        return null;
    }

    // This is called when the ImageEditingOverlayContainer changes.
    set overlayContainer(overlayContainer)
    {
        this.currentOverlayContainer = overlayContainer;
        for(let editor of Object.values(this.editors))
            editor.overlayContainer = overlayContainer;
    }

    refresh()
    {
        super.refresh();

        this.visible = ppixiv.settings.get("image_editing", false);
        helpers.html.setClass(this._saveEdits, "dirty", this.dirty);

        let isLocal = helpers.mediaId.isLocal(this._mediaId);
        if(this._mediaId != null)
            this._showInpaint.hidden = !isLocal;

        let showingCrop = this.activeEditorName == "crop" && this.visible;
        this.editors.crop.visible = showingCrop;
        helpers.html.setClass(this._showCrop, "selected", showingCrop);

        let showingPan = this.activeEditorName == "pan" && this.visible;
        this.editors.pan.visible = showingPan;
        helpers.html.setClass(this._showPan, "selected", showingPan);

        let showingInpaint = isLocal && this.activeEditorName == "inpaint" && this.visible;
        this.editors.inpaint.visible = showingInpaint;
        helpers.html.setClass(this._showInpaint, "selected", showingInpaint);

        helpers.html.setClass(this._undoButton, "disabled", this._undoStack.length == 0);
        helpers.html.setClass(this._redoButton, "disabled", this._redoStack.length == 0);

        // Hide the undo buttons in the top-left when no editor is active, since it overlaps the hover
        // UI.  Undo doesn't handle changes across editors well currently anyway.
        this._topButtonRow.querySelector(".left").hidden = this.activeEditorName == null;

        // Disable hiding the mouse cursor when editing is enabled.  This also prevents
        // the top button row from being hidden.
        if(showingCrop || showingInpaint)
            HideMouseCursorOnIdle.disableAll("image-editing");
        else
            HideMouseCursorOnIdle.enableAll("image-editing");
    }

    // Store the current data as an undo state.
    saveUndo()
    {
        this._undoStack.push(this.getState());
        this._redoStack = [];

        // Anything that adds to the undo stack causes us to be dirty.
        this.dirty = true;
    }

    // Revert to the previous undo state, if any.
    undo()
    {
        if(this._undoStack.length == 0)
            return;

        this._redoStack.push(this.getState());
        this.setState(this._undoStack.pop());

        // If InpaintEditor was adding a line, we just undid the first point, so end it.
        this.editors.inpaint.addingline = null;
        this.refresh();
    }

    // Redo the last undo.
    redo()
    {
        if(this._redoStack.length == 0)
            return;

        this._undoStack.push(this.getState());
        this.setState(this._redoStack.pop());
        this.refresh();
    }

    // Load and save state, for undo.
    getState()
    {
        let result = {};
        for(let [name, editor] of Object.entries(this.editors))
            result[name] = editor.getState();
        return result;
    }

    setState(state)
    {
        for(let [name, editor] of Object.entries(this.editors))
            editor.setState(state[name]);
    }

    getDataToSave({includeEmpty=true}={})
    {
        let edits = { };
        for(let editor of Object.values(this.editors))
        {
            for(let [key, value] of Object.entries(editor.getDataToSave()))
            {
                if(includeEmpty || value != null)
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

        let spinner = this.root.querySelector(".spinner");
        this._saveEdits.hidden = true;
        spinner.hidden = false;
        try {
            // Get data from each editor.
            let edits = this.getDataToSave();

            if(helpers.mediaId.isLocal(this._mediaId))
            {
                let result = await LocalAPI.localPostRequest(`/api/set-image-edits/${this._mediaId}`, edits);
                if(!result.success)
                {
                    ppixiv.message.show(`Error saving image edits: ${result.reason}`);
                    console.error("Error saving image edits:", result);
                    this.dirty = true;

                    return;
                }

                // Update cached media info to include the change.
                ppixiv.mediaCache.addFullMediaInfo(result.illust);
            }
            else
            {
                // Save data for Pixiv images to image_data.
                await ppixiv.mediaCache.saveExtraImageData(this._mediaId, edits);                
            }

            // Let the widgets know that we saved.
            let currentEditor = this.activeEditor;
            let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(this._mediaId);
            if(currentEditor?.afterSave)
                currentEditor.afterSave(mediaInfo);
        } finally {
            this._saveEdits.hidden = false;
            spinner.hidden = true;
        }
    }

    async copy()
    {
        let data = this.getDataToSave({includeEmpty: false});

        if(Object.keys(data).length == 0)
        {
            ppixiv.message.show("No edits to copy");
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

        ppixiv.message.show("Edits copied");
    }

    async paste()
    {
        let text = await navigator.clipboard.readText();
        let data;
        try {
            data = JSON.parse(text);
        } catch(e) {
            ppixiv.message.show("Clipboard doesn't contain edits");
            return;
        }

        if(data.type != "ppixiv-edits")
        {
            ppixiv.message.show("Clipboard doesn't contain edits");
            return;
        }

        this.setState(data);
        await this.save();

        ppixiv.message.show("Edits pasted");
    }

    get activeEditorName()
    {
        return ppixiv.settings.get("image_editing_mode", null);
    }

    set activeEditorName(editorName)
    {
        if(editorName != null && this.editors[editorName] == null)
            throw new Error(`Invalid editor name ${editorName}`);

        ppixiv.settings.set("image_editing_mode", editorName);
    }

    get activeEditor()
    {
        let currentEditor = this.activeEditorName;
        if(currentEditor == null)
            return null;
        else
            return this.editors[currentEditor];
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
