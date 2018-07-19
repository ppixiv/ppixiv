// This is the base class for viewer classes, which are used to view a particular
// type of content in the main display.
class viewer
{
    constructor(container, illust_data)
    {
    }

    // Remove any event listeners, nodes, etc. and shut down so a different viewer can
    // be used.
    shutdown() { }
}

