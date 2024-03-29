// A singleton that keeps track of whether the mouse has moved recently.
//
// Dispatch "mouseactive" on window when the mouse has moved recently and
// "mouseinactive" when it hasn't.

import { helpers } from '/vview/misc/helpers.js';

class TrackMouseMovement
{
    constructor()
    {
        TrackMouseMovement._singleton = this;

        this.forceHiddenUntil = null;
        this.setMouseAnchorTimeout = -1;
        this.lastMousePos = null;

        window.addEventListener("mousemove", this.onmousemove, { capture: true });
    }

    static _singleton = null;
    static get singleton() { return TrackMouseMovement._singleton; }

    // True if the mouse is stationary.  This corresponds to the mouseinactive event.
    get stationary() { return !this._active; }

    // Briefly pretend that the mouse is inactive.
    //
    // This is done when releasing a zoom to prevent spuriously showing the mouse cursor.
    simulateInactivity()
    {
        this.forceHiddenUntil = Date.now() + 150;
        this.idle();
    }

    onmousemove = (e) =>
    {
        let mousePos = [e.screenX, e.screenY];
        this.lastMousePos = mousePos;
        if(!this.anchorPos)
            this.anchorPos = this.lastMousePos;

        // Cleare the anchorPos timeout when the mouse moves.
        this.clearMouseAnchorTimeout();

        // If we're forcing the cursor inactive for a while, stop.
        if(this.forceHiddenUntil && this.forceHiddenUntil > Date.now())
            return;

        // Show the cursor if the mouse has moved far enough from the current anchorPos.
        let distanceMoved = helpers.math.distance({x: this.anchorPos[0], y: this.anchorPos[1]}, {x: mousePos[0], y: mousePos[1]});
        if(distanceMoved > 10)
        {
            this.markMouseActive();
            return;
        }

        // If we see mouse movement that isn't enough to cause us to display the cursor
        // and we don't see more movement for a while, reset anchorPos so we discard
        // the movement we saw.
        this.setMouseAnchorTimeout = realSetTimeout(() => {
            this.setMouseAnchorTimeout = -1;
            this.anchorPos = this.lastMousePos;
        }, 500);
    }

    // Remove the setMouseAnchorTimeout timeout, if any.
    clearMouseAnchorTimeout()
    {
        if(this.setMouseAnchorTimeout == -1)
            return;

        realClearTimeout(this.setMouseAnchorTimeout);
        this.setMouseAnchorTimeout = -1;
    }

    _removeTimer()
    {
        if(!this.timer)
            return;

        realClearTimeout(this.timer);
        this.timer = null;
    }

    // The mouse has been active recently.  Send mouseactive if the state is changing,
    // and schedule the next time it'll become inactive.
    markMouseActive()
    {
        // When showing the cursor, snap the mouse movement anchor to the last seen position
        // and remove any anchorPos timeout.
        this.anchorPos = this.lastMousePos;
        this.clearMouseAnchorTimeout();

        this._removeTimer();
        this.timer = realSetTimeout(this.idle, 500);

        if(!this._active)
        {
            this._active = true;
            window.dispatchEvent(new Event("mouseactive"));
        }
    }

    // The timer has expired (or was forced to expire).
    idle = () =>
    {
        this._removeTimer();

        if(this._active)
        {
            this._active = false;
            window.dispatchEvent(new Event("mouseinactive"));
        }
    }
}

// Hide the mouse cursor when it hasn't moved briefly, to get it out of the way.
// This only hides the cursor over element.
export class HideMouseCursorOnIdle
{
    static instances = new Set();

    static simulateInactivity()
    {
        TrackMouseMovement.singleton.simulateInactivity();
    }

    constructor(element)
    {
        if(ppixiv.mobile)
            return;

        HideMouseCursorOnIdle.addStyle();
        HideMouseCursorOnIdle.instances.add(this);

        this.track = new TrackMouseMovement();
        
        this.element = element;

        window.addEventListener("mouseactive", () => this._refreshHideCursor());
        window.addEventListener("mouseinactive", () => this._refreshHideCursor());

        ppixiv.settings.addEventListener("no-hide-cursor", HideMouseCursorOnIdle.updateFromSettings);
        HideMouseCursorOnIdle.updateFromSettings();
    }

    static disabled_by = new Set();

    static addStyle()
    {
        if(HideMouseCursorOnIdle.globalStyle)
            return;

        // Create the style to hide the mouse cursor.  This hides the mouse cursor on .hide-cursor,
        // and forces everything underneath it to inherit it.  This prevents things further down
        // that set their own cursors from unhiding it.
        //
        // This also works around a Chrome bug: if the cursor is hidden, and we show the cursor while
        // simultaneously animating an element to be visible over it, it doesn't recognize
        // hovers over the element until the animation completes or the mouse moves.  It
        // seems to be incorrectly optimizing out hover checks when the mouse is hidden.
        // Work around this by hiding the cursor with an empty image instead of cursor: none,
        // so it doesn't know that the cursor isn't visible.
        //
        // This is set as a separate style, so we can disable it selectively.  This allows us to
        // globally disable mouse hiding.  This used to be done by setting a class on body, but
        // that's slower and can cause animation hitches.
        let style = helpers.html.addStyle("hide-cursor", `
            .hide-cursor {
                cursor: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), none !important;
            }
            .hide-cursor * { cursor: inherit !important; }
        `);

        HideMouseCursorOnIdle.globalStyle = style;
    }

    static updateFromSettings()
    {
        // If no-hide-cursor is true, disable the style that hides the cursor.  We track cursor
        // hiding and set the local hide-cursor style even if cursor hiding is disabled, so
        // other UI can use it, like video seek bars.
        HideMouseCursorOnIdle.globalStyle.disabled = !this.isEnabled;
    }

    // Temporarily disable hiding all mouse cursors.  source is a key for the UI that's doing
    // this, so different UI can disable cursor hiding without conflicting.
    static enableAll(source)
    {
        if(ppixiv.mobile)
            return;

        this.disabled_by.delete(source);
        this.updateFromSettings();
        for(let instance of HideMouseCursorOnIdle.instances)
            instance._refreshHideCursor();
    }

    static disableAll(source)
    {
        if(ppixiv.mobile)
            return;

        this.disabled_by.add(source);
        this.updateFromSettings();
        for(let instance of HideMouseCursorOnIdle.instances)
            instance._refreshHideCursor();
    }

    static get mouseStationary()
    {
        return this._mouseStationary;
    }

    static set mouseStationary(value)
    {
        this._mouseStationary = value;
    }

    static get isEnabled()
    {
        return !ppixiv.settings.get("no-hide-cursor") && this.disabled_by.size == 0;
    }

    _refreshHideCursor()
    {
        // cursor-stationary means the mouse isn't moving, whether or not we're hiding
        // the cursor when it's stationary.  hide-cursor is set to actually hide the cursor
        // and UI elements that are hidden with the cursor.
        let stationary = TrackMouseMovement.singleton.stationary;
        let hidden = stationary && HideMouseCursorOnIdle.isEnabled;
        helpers.html.setClass(this.element, "hide-cursor", hidden);
        helpers.html.setClass(this.element, "show-cursor", !hidden);

        helpers.html.setClass(this.element, "cursor-stationary", stationary);
        helpers.html.setClass(this.element, "cursor-active", !stationary);
    }
}
