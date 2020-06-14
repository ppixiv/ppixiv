// The base class for our main views.
class view
{
    constructor(container)
    {
        this.container = container;

        // Make our container focusable, so we can give it keyboard focus when we
        // become active.
        this.container.tabIndex = -1;
    }

    // Handle a key input.  This is only called while the view is active.
    handle_onkeydown(e)
    {
    }

    // If this view is displaying an image, return its ID.
    // If this view is displaying a user's posts, return "user:ID".
    // Otherwise, return null.
    get displayed_illust_id()
    {
        return null;
    }

    // If this view is displaying a manga page, return its ID.  Otherwise, return null.
    // If this is non-null, displayed_illust_id will always also be non-null.
    get displayed_illust_page()
    {
        return null;
    }

    // These are called to restore the scroll position on navigation.
    scroll_to_top() { }
    restore_scroll_position() { }
    scroll_to_illust_id(illust_id, manga_page) { }

    set active(active)
    {
        // Show or hide the view container.
        this.container.hidden = !active;
        
        if(active)
        {
            // Focus the container, so it receives keyboard events, eg. home/end.
            this.container.focus();
        }
        else
        {
            // When the view isn't active, send viewhidden to close all popup menus inside it.
            view_hidden_listener.send_viewhidden(this.container);
        }
    }
}

