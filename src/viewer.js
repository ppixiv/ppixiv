// This is the base class for viewer classes, which are used to view a particular
// type of content in the main display.
class viewer
{
    constructor(container, illust_data)
    {
        this.illust_data = illust_data;
    }

    // Remove any event listeners, nodes, etc. and shut down so a different viewer can
    // be used.
    shutdown() { }

    // Return the current image's dimensions.
    //
    // For single images this is available immediately from illust_data, but for manga
    // pages we only know it after the image finishes loading.
    //
    // These return null if the viewer doesn't want to display dimensions.
    get current_image_width() { return this.illust_data.width; }
    get current_image_height() { return this.illust_data.height; }

    // Return the file type for display in the UI, eg. "PNG".
    get current_image_type() { return null; }
}

