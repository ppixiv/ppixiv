"use strict";

// The base class for our main screens.
ppixiv.screen = class extends ppixiv.widget
{
    // Handle a key input.  This is only called while the screen is active.
    handle_onkeydown(e)
    {
    }

    // Return the media ID being displayed, or null if none.
    get displayedMediaId() { return null; }

    // Screens don't hide themselves when visible is false, but we still set visibility so
    // visible_recursively works.
    apply_visibility() { }

    get active() { return !this.container.inert; }

    // The screen is becoming active.  This is async, since it may load data.
    async activate()
    {
        this.container.inert = false;
    }

    // The screen is becoming inactive.  This is sync, since we never need to stop to
    // load data in order to deactivate.
    deactivate()
    {
        this.container.inert = true;
    }
}

