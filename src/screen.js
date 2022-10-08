"use strict";

// The base class for our main screens.
ppixiv.screen = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({
            ...options,
            visible: false,
        });
    }

    // Handle a key input.  This is only called while the screen is active.
    handle_onkeydown(e)
    {
    }

    // Return the media ID being displayed, or null if none.
    get displayed_media_id()
    {
        return null;
    }

    async set_active(active)
    {
        // Show or hide the screen.
        this.visible = active;

        if(!active)
        {
            // When the screen isn't active, send viewhidden to close all popup menus inside it.
            view_hidden_listener.send_viewhidden(this.container);
        }
    }
}

