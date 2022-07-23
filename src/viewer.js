"use strict";

// This is the base class for viewer classes, which are used to view a particular
// type of content in the main display.
ppixiv.viewer = class extends widget
{
    constructor({...options})
    {
        super(options);

        this.active = false;
    }

    // Remove any event listeners, nodes, etc. and shut down so a different viewer can
    // be used.
    shutdown()
    {
        this.was_shutdown = true;
    }

    set active(value) { this._active = value; }
    get active() { return this._active; }

    // If an image is displayed, clear it.
    //
    // This is only used with the illust viewer when changing manga pages in cases
    // where we don't want the old image to be displayed while the new one loads.
    set hide_image(value) { }
    get hide_image() { return false; }

    // Return the amount of space that should be reserved by the mobile UI for this view.
    get bottom_reservation() { return "0px"; }
}

