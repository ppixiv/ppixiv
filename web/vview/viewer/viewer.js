// This is the base class for viewer classes, which are used to view a particular
// type of content in the main display.

import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';

export default class Viewer extends Widget
{
    constructor({mediaId, ...options})
    {
        super(options);

        this.options = options;
        this.mediaId = mediaId;
        this.active = false;

        // This promise will be fulfilled with true once the viewer is displaying something,
        // so any previous viewer can be removed without flashing a blank screen.  It'll be
        // fulfilled with false if we're shut down before that happens.
        this.ready = helpers.other.makePromise();
    }

    shutdown()
    {
        this.ready.accept(false);

        super.shutdown();
    }

    set active(value) { this._active = value; }
    get active() { return this._active; }

    // This is only called on mobile to handle double-tap to zoom.
    toggleZoom() { }
}

