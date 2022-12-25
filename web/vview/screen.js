import Widget from 'vview/widgets/widget.js';

// The base class for our main screens.
export default class Screen extends Widget
{
    // Handle a key input.  This is only called while the screen is active.
    handleKeydown(e)
    {
    }

    // Return the media ID being displayed, or null if none.
    get displayedMediaId() { return null; }

    // Screens don't hide themselves when visible is false, but we still set visibility so
    // visibleRecursively works.
    applyVisibility() { }

    get active() { return !this.root.inert; }

    // The screen is becoming active.  This is async, since it may load data.
    async activate()
    {
        this.root.inert = false;
    }

    // The screen is becoming inactive.  This is sync, since we never need to stop to
    // load data in order to deactivate.
    deactivate()
    {
        this.root.inert = true;
    }
}

