// The base class for our main views.
class view
{
    // Handle a key input.  This is only called while the view is active.
    handle_onkeydown(e)
    {
    }

    // If this view is displaying an image, return its ID.  Otherwise, return null.
    get displayed_illust_id()
    {
        return null;
    }
}

