// This is a custom element that roughly emulates an HTMLImageElement, but contains two
// overlaid images instead of one to overlay the inpaint, and holds the InpaintEditorOverlay.
// Load and error events are dispatched, and the image is considered loaded or complete when
// both of its images are loaded or complete.  This allows ViewerImages to display inpainting
// and the inpaint editor without needing to know much about it, so we can avoid complicating
// the viewer.

import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';

export default class ImageEditingOverlayContainer extends Widget
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

        this._inpaintEditorOverlayContainer = this.root.querySelector(".inpaint-editor-overlay-container");
        this._cropEditorOverlayContainer = this.root.querySelector(".crop-editor-overlay-container");
        this._panEditorOverlayContainer = this.root.querySelector(".pan-editor-overlay-container");
    }

    set inpaintEditorOverlay(node)
    {
        helpers.html.removeElements(this._inpaintEditorOverlayContainer);
        this._inpaintEditorOverlayContainer.appendChild(node);
    }

    set cropEditorOverlay(node)
    {
        helpers.html.removeElements(this._cropEditorOverlayContainer);
        this._cropEditorOverlayContainer.appendChild(node);
    }

    set panEditorOverlay(node)
    {
        helpers.html.removeElements(this._panEditorOverlayContainer);
        this._panEditorOverlayContainer.appendChild(node);
    }
}
