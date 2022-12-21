// This is a custom element that roughly emulates an HTMLImageElement, but contains two
// overlaid images instead of one to overlay the inpaint, and holds the InpaintEditorOverlay.
// Load and error events are dispatched, and the image is considered loaded or complete when
// both of its images are loaded or complete.  This allows on_click_viewer to display inpainting
// and the inpaint editor without needing to know much about it, so we can avoid complicating
// the viewer.

import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

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
