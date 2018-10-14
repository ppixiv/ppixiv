// The base class for our main views.
class view
{
    constructor(container)
    {
        this.container = container;
    }

    // Handle a key input.  This is only called while the view is active.
    handle_onkeydown(e)
    {
    }

    // If this view is displaying an image, return its ID.  Otherwise, return null.
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
        // When the view isn't active, send viewhidden to close all popup menus inside it.
        if(!active)
            view_hidden_listener.send_viewhidden(this.container);
    }
}

