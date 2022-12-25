// This allows editing simple pan animations, to give finer control over slideshows.
import Widget from 'vview/widgets/widget.js';
import ImageEditingOverlayContainer from 'vview/viewer/images/editing-overlay-container.js';
import Slideshow from 'vview/misc/slideshow.js';
import PointerListener from 'vview/actors/pointer-listener.js';
import { helpers, FixedDOMRect, KeyListener } from 'vview/misc/helpers.js';

export default class PanEditor extends Widget
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

                <div class="image-editor-buttons bottom">
                    <div class="image-editor-button-row box-button-row left"></div>

                    <div class="image-editor-button-row editor-buttons box-button-row">
                        ${ helpers.createBoxLink({popup: "Edit start", icon: "first_page", classes: ["edit-start-button"] }) }
                        ${ helpers.createBoxLink({popup: "Swap start and end", icon: "swap_horiz", classes: ["swap-button"] }) }
                        ${ helpers.createBoxLink({popup: "Edit end", icon: "last_page", classes: ["edit-end-button"] }) }
                        ${ helpers.createBoxLink({popup: "Edit anchor", icon: "anchor", classes: ["edit-anchor"] }) }

                        <div class="box-link popup" data-popup="Zoom">
                            ${ helpers.createIcon("zoom_in") }
                            <input class=zoom-slider type=range min=5 max=200>
                        </div>

                        ${ helpers.createBoxLink({popup: "Portrait/landscape", icon: "panorama", classes: ["rotate-aspect-ratio"] }) }

                        <div class="box-link popup aspect-ratio-slider" data-popup="Aspect ratio">
                            <input class=zoom-slider type=range min=0 max=3 style="width: 70px;">
                        </div>

                        ${ helpers.createBoxLink({popup: "Clear animation", icon: "delete", classes: ["reset-button"] }) }
                    </div>
                    <div class="image-editor-button-row box-button-row right"></div>
                </div>
            </div>
        `});

        this.shutdownSignal = new AbortController();

        this.width = this.height = 100;
        this.dragging = false;
        this._dragStart = null;
        this.anchor = new FixedDOMRect(0.5, 0.5, 0.5, 0.5);

        this._aspectRatios = [
            [21, 9],
            [16, 9],
            [16, 10],
            [4, 3],
        ];

        // is_set is false if we've had no edits and we're displaying the defaults, or true if we
        // have data that can be saved.
        this._isSet = false;
        this._zoomLevel = [1,1]; // start, end
        this._displayedAspectRatio = 1;
        this._displayedAspectRatioPortrait = false;

        this.editing = "start"; // "start" or "end"
        this._editingAnchor = false;

        this.ui = this.root.querySelector(".editor-buttons");
        this._monitorPreviewBox = this.root.querySelector(".monitor-preview-box");

        // Remove .pan-editor-overlay.  It's inserted into the image overlay when we
        // have one, so it pans and zooms with the image.
        this._editorOverlay = this.root.querySelector(".pan-editor-overlay");
        this._editorCropRegion = this.root.querySelector(".pan-editor-crop-region");
        this._editorOverlay.remove();
        this._handle = this._editorOverlay.querySelector(".handle");

        // The real zoom value is the amount the image will be zoomed onscreen: if it's set
        // to 2, the image is twice as big.  The zoom slider is inverted: a slider value of
        // 1/2 gives a zoom of 2.  This makes the zoom slider scale the size of the monitor
        // box linearly and feels more natural.
        this._zoomSlider = this.ui.querySelector(".zoom-slider");

        // Use watchEdits to save undo at the start of inputs being dragged.
        helpers.watchEdits(this._zoomSlider, { signal: this.shutdownSignal.signal });
        this._zoomSlider.addEventListener("editbegin", (e) => { this.parent.saveUndo(); this._isSet = true; });
        this._zoomSlider.addEventListener("edit", (e) => {
            // console.log(e);
            let value = parseInt(this._zoomSlider.value) / 100;
            value = 1 / value;
            this._zoomLevel[this.editingIndex] = value;
            this.refresh();
        });

        // The preview size slider changes the monitor aspect ratio that we're previewing.
        this._aspectRatioSlider = this.ui.querySelector(".aspect-ratio-slider input");
        this._aspectRatioSlider.addEventListener("input", (e) => {
            this._displayedAspectRatio = parseInt(this._aspectRatioSlider.value);
            this.refresh();
        });

        this._aspectRatioSwitchButton = this.root.querySelector(".rotate-aspect-ratio");
        this._aspectRatioSwitchButton.addEventListener("click", (e) => {
            e.stopPropagation();

            this._displayedAspectRatioPortrait = !this._displayedAspectRatioPortrait;
            this.refresh();
        });

        this.ui.querySelector(".edit-start-button").addEventListener("click", (e) => { e.stopPropagation(); this.editing = "start"; this.refresh(); });
        this.ui.querySelector(".edit-end-button").addEventListener("click", (e) => { e.stopPropagation(); this.editing = "end"; this.refresh(); });
        this.ui.querySelector(".edit-anchor").addEventListener("click", (e) => { e.stopPropagation(); this._editingAnchor = !this._editingAnchor; this.refresh(); });
        this.ui.querySelector(".reset-button").addEventListener("click", (e) => { e.stopPropagation(); this.clear(); });
        this.ui.querySelector(".swap-button").addEventListener("click", (e) => { e.stopPropagation(); this.swap(); });

        this.pointerListener = new PointerListener({
            element: this._editorOverlay,
            callback: this.pointerevent,
            signal: this.shutdownSignal.signal,
        });

        // Prevent fullscreening if a UI element is double-clicked.
        this._editorOverlay.addEventListener("dblclick", this.ondblclick, { signal: this.shutdownSignal.signal });
    }

    // Return 0 if we're editing the start point, or 1 if we're editing the end point.
    get editingIndex()
    {
        return this.editing == "start"? 0:1;
    }

    get actuallyEditingAnchor()
    {
        return this._editingAnchor ^ this._shiftHeld;
    }

    // This is called when the ImageEditingOverlayContainer changes.
    set overlayContainer(overlayContainer)
    {
        console.assert(overlayContainer instanceof ImageEditingOverlayContainer);
        if(this._editorOverlay.parentNode)
            this._editorOverlay.remove();
            
        overlayContainer.panEditorOverlay = this._editorOverlay;
        this._overlayContainer = overlayContainer;
    }

    clear()
    {
        if(!this._isSet)
            return;

        this.parent.saveUndo();
        this.setState(null);
    }

    // Swap the start and end points.
    swap()
    {
        this.parent.saveUndo();
        this._isSet = true;
        this.rect = new FixedDOMRect(this.rect.x2, this.rect.y2, this.rect.x1,this.rect.y1);
        this.anchor = new FixedDOMRect(this.anchor.x2, this.anchor.y2, this.anchor.x1, this.anchor.y1);
        this._zoomLevel = [this._zoomLevel[1], this._zoomLevel[0]];
        this.refresh();
    }

    get previewSize()
    {
        let result = this._aspectRatios[this._displayedAspectRatio];
        if(this._displayedAspectRatioPortrait)
            return [result[1], result[0]];
        else
            return result;
    }

    refresh()
    {
        super.refresh();
        if(!this.visible)
            return;

        let zoom = this._zoomLevel[this.editingIndex];
        this._zoomSlider.value = 1 / zoom * 100;
        
        helpers.html.setClass(this.ui.querySelector(".edit-start-button"), "selected", this.editing == "start");
        helpers.html.setClass(this.ui.querySelector(".edit-end-button"), "selected", this.editing == "end");
        helpers.html.setClass(this.ui.querySelector(".edit-anchor"), "selected", this.actuallyEditingAnchor);

        this._aspectRatioSwitchButton.dataset.popup = 
            this._displayedAspectRatioPortrait? "Previewing portrait":"Previewing landscape";
        this._aspectRatioSwitchButton.querySelector(".font-icon").innerText =
            this._displayedAspectRatioPortrait? "portrait":"panorama";
        this._aspectRatioSlider.value = this._displayedAspectRatio;
        this.ui.querySelector(".aspect-ratio-slider").dataset.popup = `Previewing ${this.previewSize[0]}:${this.previewSize[1]}`;

        this.refreshZoomPreview();
        this.refreshCenter();
    }

    // Refresh the position of the center handle.
    refreshCenter()
    {
        let { x, y } = this.editing == "start"? { x: this.rect.x1, y: this.rect.y1 }: { x: this.rect.x2, y: this.rect.y2 };
        x *= this.width;
        y *= this.height;
        this._handle.querySelector(".crosshair").setAttribute("transform", `translate(${x} ${y})`);
    }

    visibilityChanged()
    {
        super.visibilityChanged();
        this._editorOverlay.hidden = !this.visible;
        this.ui.hidden = !this.visible;

        if(this.visible)
        {
            // Listen for shift presses while we're visible.
            new KeyListener("Shift", (pressed) => {
                this._shiftHeld = pressed;
                this.refresh();
            }, { signal: this.visibilityAbort.signal });

            this.refresh();
        }
        else
        {
            this._shiftHeld = false;
        }
    }

    setIllustData({replaceEditorData, extraData, width, height})
    {
        // Match the size of the image.
        this.width = width;
        this.height = height;

        // Handling crops and pans together is tricky.  The pan values are relative to the cropped
        // area: panning to 0.5x0.5 always goes to the center of the crop region, not the original
        // image.  But, these editors are all positioned and scaled relative to the original image.
        // This editor wants to be relative to the crop, so we scale and shift our own area relative
        // to the crop if there is one.
        if(extraData?.crop)
        {
            let crop = new FixedDOMRect(extraData.crop[0], extraData.crop[1], extraData.crop[2], extraData.crop[3]);
            this.width = crop.width;
            this.height = crop.height;

            this._editorCropRegion.style.width = `${100 * crop.width / width}%`;
            this._editorCropRegion.style.height = `${100 * crop.height / height}%`;
            this._editorCropRegion.style.top = `${100 * crop.top / height}%`;
            this._editorCropRegion.style.left = `${100 * crop.left / width}%`;
        }
        else
        {
            this._editorCropRegion.style.width = this._editorCropRegion.style.height = ``;
            this._editorCropRegion.style.top = this._editorCropRegion.style.left = ``;
        }

        this._handle.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);

        if(replaceEditorData)
            this.setState(extraData?.pan);

        this.refresh();
    }

    getDataToSave()
    {
        return { pan: this.getState() };
    }

    // Return data for saving.
    getState({force=false}={})
    {
        if(!force && !this._isSet)
            return null;

        // These are stored as unit values, so we don't need to know the image dimensions to
        // set them up.
        let result = {
            x1: this.rect.x1,
            y1: this.rect.y1,
            x2: this.rect.x2,
            y2: this.rect.y2,
            start_zoom: this._zoomLevel[0],
            end_zoom: this._zoomLevel[1],
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

    setState(data)
    {
        this._isSet = data != null;
        if(data == null)
            data = Slideshow.pans.defaultSlideshow;

        this.rect = new FixedDOMRect(data.x1, data.y1, data.x2, data.y2);

        this.anchor = new FixedDOMRect(0.5, 0.5, 0.5, 0.5);
        if(data.anchor)
            this.anchor = new FixedDOMRect(data.anchor.left, data.anchor.top, data.anchor.right, data.anchor.bottom);
        this._zoomLevel = [data.start_zoom, data.end_zoom];

        this.refresh();
    }

    getCurrentSlideshow({...options}={})
    {
        // this.height/this.width is the size of the image.  Scale it to cover previewWidth/previewHeight,
        // as if we're ViewerImages displaying it.  If the animation tells us to scale to 1x, it wants
        // to cover the screen.
        let [previewWidth, previewHeight] = this.previewSize;
        let scaleRatio = Math.max(previewWidth/this.width, previewHeight/this.height);
        let scaledWidth = this.width * scaleRatio, scaledHeight = this.height * scaleRatio;

        // The minimum zoom is the zoom that will fit the image onscreen.  This also matches ViewerImages.
        let coverRatio = Math.min(previewWidth/scaledWidth, previewHeight/scaledHeight);

        let slideshow = new Slideshow({
            width: scaledWidth,
            height: scaledHeight,
            containerWidth: previewWidth,
            containerHeight: previewHeight,

            // The minimum zoom level to allow:
            minimumZoom: coverRatio,
    
            // The position is normally clamped to the screen.  If we're editing the anchor, disable this to
            // display the position of the box before it's clamped.
            clampToWindow: !this.actuallyEditingAnchor,

            ...options
        });

        // Get the animation that we'd currently save, and load it as a slideshow.
        let panAnimation = this.getState({force: true});
        let animation = slideshow.getAnimation(panAnimation);
        return { animation, scaledWidth, scaledHeight, previewWidth, previewHeight };
    }

    // Refresh the position and size of the monitor preview box.
    refreshZoomPreview()
    {
        // Instead of moving the image around inside the monitor, scale the box to the size
        // of the preview "monitor", and scale/translate it around to show how the image would
        // fit inside it.
        let { animation, scaledWidth, scaledHeight, previewWidth, previewHeight } = this.getCurrentSlideshow();
        let pan = animation.pan[this.editingIndex];
    
        let box = this._monitorPreviewBox.querySelector(".box");
        box.style.width = `${100 * previewWidth / scaledWidth}%`;
        box.style.height = `${100 * previewHeight / scaledHeight}%`;

        let tx = 100 * -pan.tx / scaledWidth;
        let ty = 100 * -pan.ty / scaledHeight;

        // Apply the zoom by scaling the box's parent.  Scaling inside style.transform makes this simpler,
        // but makes things like outlines ugly.
        this._monitorPreviewBox.style.width = `${100 / pan.scale}%`;
        this._monitorPreviewBox.style.height = `${100 / pan.scale}%`;
        this._monitorPreviewBox.style.transform = `
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
            this._dragSavedUndo = false;
            this._dragPos = [e.clientX, e.clientY];
            window.addEventListener("pointermove", this._pointermoveDragPoint);
    
            return;
        }
        else if(this.dragging != -1 && !e.pressed)
        {
            // We stopped dragging.
            this.dragging = false;
            window.removeEventListener("pointermove", this._pointermoveDragPoint);
        }
    }

    // Convert a click from client coordinates to image coordinates.
    getPointFromClick({clientX, clientY})
    {
        let {width, height, top, left} = this._editorOverlay.getBoundingClientRect();
        let x = (clientX - left) / width * this.width;
        let y = (clientY - top) / height * this.height;
        return { x: x, y: y };
    }

    _pointermoveDragPoint = (e) =>
    {
        // Save undo for this drag if we haven't yet.
        if(!this._dragSavedUndo)
        {
            this.parent.saveUndo();
            this._dragSavedUndo = true;
        }

        // Get the delta in client coordinates.  Don't use movementX/movementY, since it's
        // in screen pixels and will be wrong if the browser is scaled.
        let deltaX = e.clientX - this._dragPos[0];
        let deltaY = e.clientY - this._dragPos[1];
        this._dragPos = [e.clientX, e.clientY];

        // Scale movement from client coordinates to the size of the container.
        let {width, height} = this._editorCropRegion.getBoundingClientRect();
        deltaX /= width;
        deltaY /= height;

        // Check if we're editing the pan position or the anchor.
        let editingAnchor = this.actuallyEditingAnchor;
        if(editingAnchor)
        {
            let { animation, scaledWidth, scaledHeight, previewWidth, previewHeight } = this.getCurrentSlideshow();
            let pan = animation.pan[this.editingIndex];

            // If we add 1 to anchor.x1, we'll move the anchor one screen width to the right.
            // Scale this to the monitor preview that's currently visible.  This makes the speed
            // of dragging the anchor point match the current display.
            //
            // Moving the anchor will also move the view, so we also adjust the view position by
            // the same amount below.  This cancels out the movement of the anchor, so the display
            // position is stationary as we move the anchor.
            let monitorWidth = (previewWidth / scaledWidth) / pan.scale;
            let monitorHeight = (previewHeight / scaledHeight) / pan.scale;
            if(this.editing == "start")
            {
                this.anchor.x1 += deltaX / monitorWidth;
                this.anchor.y1 += deltaY / monitorHeight;
            } else {
                this.anchor.x2 += deltaX / monitorWidth;
                this.anchor.y2 += deltaY / monitorHeight;
            }
        }

        // Drag the rect.
        let rect = new FixedDOMRect(this.rect.x1, this.rect.y1, this.rect.x2, this.rect.y2);
        if(this.editing == "start")
        {
            rect.x1 += deltaX;
            rect.y1 += deltaY;
        } else {
            rect.x2 += deltaX;
            rect.y2 += deltaY;
        }

        this.rect = rect;

        this._isSet = true;
        this.refresh();
    }
}
