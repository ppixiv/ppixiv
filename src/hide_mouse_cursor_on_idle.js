"use strict";

// Hide the mouse cursor when it hasn't moved briefly, to get it out of the way.
// This only hides the cursor over element.
ppixiv.hide_mouse_cursor_on_idle = class
{
    constructor(element)
    {
        hide_mouse_cursor_on_idle.add_style();

        this.onmousemove = this.onmousemove.bind(this);
        this.onblur = this.onblur.bind(this);
        this.idle = this.idle.bind(this);
        this.hide_immediately = this.hide_immediately.bind(this);

        this.element = element;

        this.force_hidden_until = null;
        this.cursor_hidden = false;
        this.set_mouse_anchor_timeout = -1;
        this.last_mouse_pos = null;

        window.addEventListener("mousemove", this.onmousemove, true);
        window.addEventListener("blur", this.blur, true);
        window.addEventListener("hide-cursor-immediately", this.hide_immediately, true);

        window.addEventListener("enable-hiding-cursor", function() { this.enable = true; }.bind(this), true);
        window.addEventListener("disable-hiding-cursor", function() { this.enable = false; }.bind(this), true);

        settings.register_change_callback("no-hide-cursor", hide_mouse_cursor_on_idle.update_from_settings);
        hide_mouse_cursor_on_idle.update_from_settings();

        this.enable = true;
    }

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
        let style = 
            '.hide-cursor {\n' +
            '    cursor: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), none !important;\n' +
            '}\n' +
            '.hide-cursor * { cursor: inherit !important; }\n';

        style = helpers.create_style(style);
        hide_mouse_cursor_on_idle.global_style = style;
        document.head.appendChild(style);
    }

    static update_from_settings()
    {
        // If no-hide-cursor is true, disable the style that hides the cursor.  We track cursor
        // hiding and set the local hide-cursor style even if cursor hiding is disabled, so
        // other UI can use it, like video seek bars.
        hide_mouse_cursor_on_idle.global_style.disabled = settings.get("no-hide-cursor");
    }

    // Temporarily disable hiding all mouse cursors.
    static enable_all()
    {
        // Just let update_from_settings readding the enable-cursor-hiding class if needed.
        this.update_from_settings();
    }

    static disable_all()
    {
        // Just disable the style, so we stop hiding the mouse.  We don't just unset the hide-cursor
        // class, so this only stops hiding the mouse cursor and doesn't cause other UI like seek
        // bars to be displayed.
        hide_mouse_cursor_on_idle.global_style.disabled = true;
    }

    set enable(value)
    {
        if(this._enabled == value)
            return;

        this._enabled = value;

        if(this._enabled)
            this.reset_timer();
        else
        {
            this.remove_timer();
            this.show_cursor();
        }
    }

    get enable()
    {
        return this._enabled;
    };

    remove_timer()
    {
        if(!this.timer)
            return;

        clearTimeout(this.timer);
        this.timer = null;
    }

    // Hide the cursor now, and keep it hidden very briefly even if it moves.  This is done
    // when releasing a zoom to prevent spuriously showing the mouse cursor.
    hide_immediately(e)
    {
        this.force_hidden_until = Date.now() + 150;
        this.idle();
    }

    reset_timer()
    {
        this.show_cursor();

        this.remove_timer();
        this.timer = setTimeout(this.idle, 500);
    }

    idle()
    {
        this.remove_timer();
        this.hide_cursor();
    }

    onmousemove(e)
    {
        let mouse_pos = [e.screenX, e.screenY];
        this.last_mouse_pos = mouse_pos;
        if(!this.anchor_pos)
            this.anchor_pos = this.last_mouse_pos;

        // Cleare the anchor_pos timeout when the mouse moves.
        this.clear_mouse_anchor_timeout();

        if(this.force_hidden_until && this.force_hidden_until > Date.now())
            return;

        let distance = function(p1, p2)
        {
            let distance = Math.pow(p1[0]-p2[0], 2) + Math.pow(p1[1]-p2[1], 2);
            return Math.pow(distance, 0.5);
        }

        if(!this.cursor_hidden)
        {
            this.reset_timer();
            return;
        }

        // Show the cursor if the mouse has moved far enough from the current anchor_pos.
        let distance_moved = distance(this.anchor_pos, mouse_pos);
        if(distance_moved > 10)
        {
            this.reset_timer();
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

    onblur(e)
    {
        this.remove_timer();
        this.show_cursor();
    }

    show_cursor(e)
    {
        this.cursor_hidden = false;

        // When showing the cursor, snap the mouse movement anchor to the last seen position
        // and remove any anchor_pos timeout.
        this.anchor_pos = this.last_mouse_pos;
        this.clear_mouse_anchor_timeout();

        this.refresh_hide_cursor();
    }

    hide_cursor(e)
    {
        this.cursor_hidden = true;
        this.refresh_hide_cursor();
    }

    refresh_hide_cursor()
    {
        let hidden = this.cursor_hidden;
        helpers.set_class(this.element, "hide-cursor", hidden);
        helpers.set_class(this.element, "show-cursor", !hidden);
    }
}

