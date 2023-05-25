// AsyncLookups handle a common pattern for looking up data for an ID, usually for display.
// onrefresh will be called with the result once it becomes available.  If the data isn't
// available immediately, it will be called with an empty result until data becomes available,
// so the UI can be cleared.

import Actor from '/vview/actors/actor.js';
import { helpers } from '/vview/misc/helpers.js';

export default class AsyncLookup extends Actor
{
    constructor({
        // The initial ID to look up.
        id=null,

        // This is called when the results change.
        onrefresh=async ({}) => { },

        // If false, we won't make API requests to load data if we're not active.  If we already
        // have data it'll still be provided.
        loadWhileNotVisible=false,

        ...options
    })
    {
        super({...options});

        this._onrefresh = onrefresh;
        this._loadWhileNotVisible = loadWhileNotVisible;

        this._id = id;
        this._info = { };

        // Defer the initial refresh so we don't call onrefresh before the constructor returns.
        helpers.other.defer(() => this.refresh());
    }

    // Set the ID we're looking up.
    get id() { return this._id; }
    set id(value)
    {
        if(this._id == value)
            return;

        this._id = value;
        this.refresh();
    }

    // Return the most recent info given to onrefresh.
    get info()
    {
        return this._info ?? { };
    }

    visibilityChanged()
    {
        super.visibilityChanged();

        // If we might have skipped loading while not visible, refresh now.  Use visibleRecursively
        // for this and not actuallyVisibleRecursively so we don't refresh while we're transitioning
        // away.
        if(!this._loadWhileNotVisible && this.visibleRecursively)
            this.refresh();
    }

    async refresh()
    {
        if(this.hasShutdown)
            return;

        this._refreshInner();
    }

    // The subclass should implement this.
    async _refreshInner() { }
}
