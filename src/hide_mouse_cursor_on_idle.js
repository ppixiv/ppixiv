"use strict";

// A singleton that keeps track of whether the mouse has moved recently.
//
// Dispatch "mouseactive" on window when the mouse has moved recently and
// "mouseinactive" when it hasn't.
ppixiv.track_mouse_movement = class
{
    constructor()
    {
        track_mouse_movement._singleton = this;

        this.force_hidden_until = null;
        this.set_mouse_anchor_timeout = -1;
        this.last_mouse_pos = null;

        window.addEventListener("mousemove", this.onmousemove, { capture: true });
    }

    static _singleton = null;
    static get singleton() { return track_mouse_movement._singleton; }

    // True if the mouse is stationary.  This corresponds to the mouseinactive event.
    get stationary() { return !this._active; }

    // Briefly pretend that the mouse is inactive.
    //
    // This is done when releasing a zoom to prevent spuriously showing the mouse cursor.
    simulate_inactivity()
    {
        this.force_hidden_until = Date.now() + 150;
        this.idle();
    }

    onmousemove = (e) =>
    {
        let mouse_pos = [e.screenX, e.screenY];
        this.last_mouse_pos = mouse_pos;
        if(!this.anchor_pos)
            this.anchor_pos = this.last_mouse_pos;

        // Cleare the anchor_pos timeout when the mouse moves.
        this.clear_mouse_anchor_timeout();

        // If we're forcing the cursor inactive for a while, stop.
        if(this.force_hidden_until && this.force_hidden_until > Date.now())
            return;

        // Show the cursor if the mouse has moved far enough from the current anchor_pos.
        let distance_moved = helpers.distance(this.anchor_pos, mouse_pos);
        if(distance_moved > 10)
        {
            this.mark_mouse_active();
            return;
        }

        // If we see mouse movement that isn't enough to cause us to display the cursor
        // and we don't see more movement for a while, reset anchor_pos so we discard
        // the movement we saw.
        this.set_mouse_anchor_timeout = setTimeout(() => {
            this.set_mouse_anchor_timeout = -1;
            this.anchor_pos = this.last_mouse_pos;
        }, 500);
    }

    // Remove the set_mouse_anchor_timeout timeout, if any.
    clear_mouse_anchor_timeout()
    {
        if(this.set_mouse_anchor_timeout == -1)
            return;

        clearTimeout(this.set_mouse_anchor_timeout);
        this.set_mouse_anchor_timeout = -1;
    }

    remove_timer()
    {
        if(!this.timer)
            return;

        clearTimeout(this.timer);
        this.timer = null;
    }

    // The mouse has been active recently.  Send mouseactive if the state is changing,
    // and schedule the next time it'll become inactive.
    mark_mouse_active()
    {
        // When showing the cursor, snap the mouse movement anchor to the last seen position
        // and remove any anchor_pos timeout.
        this.anchor_pos = this.last_mouse_pos;
        this.clear_mouse_anchor_timeout();

        this.remove_timer();
        this.timer = setTimeout(this.idle, 500);

        if(!this._active)
        {
            this._active = true;
            window.dispatchEvent(new Event("mouseactive"));
        }
    }

    // The timer has expired (or was forced to expire).
    idle = () =>
    {
        this.remove_timer();

        if(this._active)
        {
            this._active = false;
            window.dispatchEvent(new Event("mouseinactive"));
        }
    }
}

// Hide the mouse cursor when it hasn't moved briefly, to get it out of the way.
// This only hides the cursor over element.
ppixiv.hide_mouse_cursor_on_idle = class
{
    static instances = new Set();
    constructor(element)
    {
        hide_mouse_cursor_on_idle.add_style();
        hide_mouse_cursor_on_idle.instances.add(this);

        this.track = new track_mouse_movement();
        
        this.element = element;

        window.addEventListener("mouseactive", this.refresh_cursor_stationary);
        window.addEventListener("mouseinactive", this.refresh_cursor_stationary);

        settings.register_change_callback("no-hide-cursor", hide_mouse_cursor_on_idle.update_from_settings);
        hide_mouse_cursor_on_idle.update_from_settings();
    }

    static disabled_by = new Set();

    static add_style()
    {
        if(hide_mouse_cursor_on_idle.global_style)
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
        let style = helpers.add_style("hide-cursor", `
            .hide-cursor {
                cursor: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), none !important;
            }
            .hide-cursor * { cursor: inherit !important; }
        `);

        hide_mouse_cursor_on_idle.global_style = style;
    }

    static update_from_settings()
    {
        // If no-hide-cursor is true, disable the style that hides the cursor.  We track cursor
        // hiding and set the local hide-cursor style even if cursor hiding is disabled, so
        // other UI can use it, like video seek bars.
        hide_mouse_cursor_on_idle.global_style.disabled = !this.is_enabled;
    }

    // Temporarily disable hiding all mouse cursors.  source is a key for the UI that's doing
    // this, so different UI can disable cursor hiding without conflicting.
    static enable_all(source)
    {
        this.disabled_by.delete(source);
        this.update_from_settings();
        for(let instance of hide_mouse_cursor_on_idle.instances)
            instance.refresh_hide_cursor();
    }

    static disable_all(source)
    {
        this.disabled_by.add(source);
        this.update_from_settings();
        for(let instance of hide_mouse_cursor_on_idle.instances)
            instance.refresh_hide_cursor();
    }

    static get mouse_stationary()
    {
        return this._mouse_stationary;
    }

    static set mouse_stationary(value)
    {
        this._mouse_stationary = value;
    }

    static get is_enabled()
    {
        return !settings.get("no-hide-cursor") && this.disabled_by.size == 0;
    }

    refresh_cursor_stationary = (e) =>
    {
        this.refresh_hide_cursor();
    }

    refresh_hide_cursor()
    {
        // cursor-stationary means the mouse isn't moving, whether or not we're hiding
        // the cursor when it's stationary.  hide-cursor is set to actually hide the cursor
        // and UI elements that are hidden with the cursor.
        let stationary = track_mouse_movement.singleton.stationary;
        let hidden = stationary && hide_mouse_cursor_on_idle.is_enabled;
        helpers.set_class(this.element, "hide-cursor", hidden);
        helpers.set_class(this.element, "show-cursor", !hidden);

        helpers.set_class(this.element, "cursor-stationary", stationary);
        helpers.set_class(this.element, "cursor-active", !stationary);
    }
}

