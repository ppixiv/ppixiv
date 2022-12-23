import Widget from 'vview/widgets/widget.js';
import PointerListener from 'vview/actors/pointer-listener.js';
import ImageEditingOverlayContainer from 'vview/viewer/images/editing-overlay-container.js';
import { FixedDOMRect } from 'vview/misc/helpers.js';

export default class CropEditor extends Widget
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

        this.width = 1;
        this.height = 1;

        this._editorOverlay = this.container.querySelector(".crop-editor-overlay");
        this._editorOverlay.remove();
        this._currentCrop = null;

        this._editorOverlay.addEventListener("dblclick", this.ondblclick, { signal: this.shutdownSignal.signal });

        new PointerListener({
            element: this._editorOverlay,
            callback: this.pointerevent,
            signal: this.shutdownSignal.signal,
        });
        
        this.box = this._editorOverlay.querySelector(".crop-box");

        this.refresh();
    }

    // Clear the crop on double-click.
    ondblclick = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();
        this.parent.saveUndo();
        this._currentCrop = null;
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
            this._currentCrop = this._effectiveCrop;
            return;
        }

        let clickedHandle = null;
        if(this._currentCrop == null)
        {
            let {x,y} = this.clientToContainerPos({ x: e.clientX, y: e.clientY });
            this._currentCrop = new FixedDOMRect(x, y, x, y);
            clickedHandle = "bottomright";
        }
        else
            clickedHandle = e.target.dataset.crop;
        if(clickedHandle == null)
            return;

        e.preventDefault();
        e.stopPropagation();
        this.parent.saveUndo();

        // Which dimensions each handle moves:
        let dragParts = {
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
        this.dragging = dragParts[clickedHandle];
        this._dragPos = this.clientToContainerPos({ x: e.clientX, y: e.clientY });
        this.refresh();
    }

    clientToContainerPos({x, y})
    {
        let {width, height, top, left} = this._editorOverlay.getBoundingClientRect();
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
        let pos = this.clientToContainerPos({ x: e.clientX, y: e.clientY });
        let delta = { x: pos.x - this._dragPos.x, y: pos.y - this._dragPos.y };
        this._dragPos = pos;

        // Apply the drag.
        if(this.dragging == "move")
        {
            this._currentCrop.x += delta.x;
            this._currentCrop.y += delta.y;

            this._currentCrop.x = Math.max(0, this._currentCrop.x);
            this._currentCrop.y = Math.max(0, this._currentCrop.y);
            this._currentCrop.x = Math.min(this.width - this._currentCrop.width, this._currentCrop.x);
            this._currentCrop.y = Math.min(this.height - this._currentCrop.height, this._currentCrop.y);
        }
        else
        {
            let dragging = this.dragging;
            if(dragging.x != null)
                this._currentCrop[dragging.x] += delta.x;
            if(dragging.y != null)
                this._currentCrop[dragging.y] += delta.y;
        }

        this.refresh();
    }

    // Return the current crop.  If we're dragging, clean up the rectangle, making sure it
    // has a minimum size and isn't inverted.
    get _effectiveCrop()
    {
        // If we're not dragging, just return the current crop rectangle.
        if(this.dragging == null)
            return this._currentCrop;

        let crop = new FixedDOMRect(
            this._currentCrop.x1,
            this._currentCrop.y1,
            this._currentCrop.x2,
            this._currentCrop.y2,
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

            let minSize = 5;
            if(this.dragging.x != null && Math.abs(crop.width) < minSize)
            {
                let opposite_x = opposites[this.dragging.x];
                if(crop[this.dragging.x] < crop[opposite_x])
                    crop[this.dragging.x] = crop[opposite_x] - minSize;
                else
                    crop[this.dragging.x] = crop[opposite_x] + minSize;
            }

            if(this.dragging.y != null && Math.abs(crop.height) < minSize)
            {
                let opposite_y = opposites[this.dragging.y];
                if(crop[this.dragging.y] < crop[opposite_y])
                    crop[this.dragging.y] = crop[opposite_y] - minSize;
                else
                    crop[this.dragging.y] = crop[opposite_y] + minSize;
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
        let box = this._editorOverlay.querySelector(".crop-box");
        box.hidden = this._currentCrop == null;
        if(this._currentCrop == null)
            return;

        let crop = this._effectiveCrop;
        box.style.width = `${100 * crop.width / this.width}%`;
        box.style.height = `${100 * crop.height / this.height}%`;
        box.style.left = `${100 * crop.left / this.width}%`;
        box.style.top = `${100 * crop.top / this.height}%`;
    }

    setIllustData({replaceEditorData, extraData, width, height})
    {
        if(extraData == null)
            return;

        this.width = width;
        this.height = height;
        this.box.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    
        if(replaceEditorData)
            this.setState(extraData.crop);

        this.refresh();
    }

    set overlayContainer(overlayContainer)
    {
        console.assert(overlayContainer instanceof ImageEditingOverlayContainer);
        if(this._editorOverlay.parentNode)
            this._editorOverlay.remove();

        overlayContainer.cropEditorOverlay = this._editorOverlay;
        this._overlayContainer = overlayContainer;
    }

    getDataToSave()
    {
        // If there's no crop, save an empty array to clear it.
        let state = this.getState();
        return {
            crop: state,
        };
    }
    
    async afterSave(mediaInfo)
    {
        // Disable cropping after saving, so the crop is visible.
        ppixiv.settings.set("image_editing_mode", null);
    }

    getState()
    {
        if(this._currentCrop == null)
            return null;

        let crop = this._effectiveCrop;
        return [
            Math.round(crop.left),
            Math.round(crop.top),
            Math.round(crop.right),
            Math.round(crop.bottom),
        ]
    }

    setState(crop)
    {
        if(crop == null)
            this._currentCrop = null;
        else
            this._currentCrop = new FixedDOMRect(crop[0], crop[1], crop[2], crop[3]);
        this.refresh();
    }

    visibilityChanged()
    {
        super.visibilityChanged();
        this._editorOverlay.hidden = !this.visible;
    }
}
