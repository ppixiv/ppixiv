"use strict";

// The base class for our main screens.
ppixiv.screen = class extends ppixiv.widget
{
    // Handle a key input.  This is only called while the screen is active.
    handle_onkeydown(e)
    {
    }

    // Return the media ID being displayed, or null if none.
    get displayed_media_id()
    {
        return null;
    }

    // The screen itself sets itself visible or not, since screen_search and screen_illust
    // handle this differently.
    async set_active(active)
    {
        this.container.inert = !active;

        if(!active)
        {
            // When the screen isn't active, send viewhidden to close all popup menus inside it.
            view_hidden_listener.send_viewhidden(this.container);
        }
    }
}

