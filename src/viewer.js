"use strict";

// This is the base class for viewer classes, which are used to view a particular
// type of content in the main display.
ppixiv.viewer = class extends widget
{
    constructor({media_id, ...options})
    {
        super(options);

        this.options = options;
        this.media_id = media_id;
        this.active = false;

        // This promise will be fulfilled with true once the viewer is displaying something,
        // so any previous viewer can be removed without flashing a blank screen.  It'll be
        // fulfilled with false if we're shut down before that happens.
        this.ready = helpers.make_promise();
    }

    // Remove any event listeners, nodes, etc. and shut down so a different viewer can
    // be used.
    shutdown()
    {
        this.container.remove();

        this.ready.accept(false);

        super.shutdown();
    }

    set active(value) { this._active = value; }
    get active() { return this._active; }

    // Return the amount of space that should be reserved by the mobile UI for this view.
    get bottom_reservation() { return "0px"; }
}

