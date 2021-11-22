"use strict";

// This is a helper to show a container when the mouse is visible.
ppixiv.hide_seek_bar = class
{
    constructor(container)
    {
        this.mouseover = this.mouseover.bind(this);
        this.mouseout = this.mouseout.bind(this);

        this.container = container;

        this.container.addEventListener("mouseover", this.mouseover);
        this.container.addEventListener("mouseout", this.mouseout);
        this.refresh_visibility();

        // Keep the widget visible during drags.
        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.container,
            callback: (e) => {
                this.dragging = e.pressed;
                this.refresh_visibility();
            },
        });

        this.container.visible = false;
    }

    mouseover()
    {
        this.hovering = true;
        this.refresh_visibility();
    }

    mouseout()
    {
        this.hovering = false;
        this.refresh_visibility();
    }

    get actually_visible()
    {
        return this.hovering || this.dragging;
    }

    refresh_visibility()
    {
        // Show the seek bar if the mouse is over it, or if we're actively dragging.
        // Only show if we're active.
        var visible = this.actually_visible;
        helpers.set_class(this.container, "visible", visible);
    }
}

ppixiv.seek_bar = class extends widget
{
    constructor({...options})
    {
        super({...options,
            template: `
                <div class="seek-bar">
                    <div class=seek-empty>
                        <div class=seek-fill></div>
                    </div>
                </div>
            `
        });

        this.mousedown = this.mousedown.bind(this);
        this.mouseup = this.mouseup.bind(this);
        this.mousemove = this.mousemove.bind(this);

        this.container.addEventListener("mousedown", this.mousedown);

        this.current_time = 0;
        this.duration = 1;
        this.refresh();
        this.set_callback(null);
    };

    mousedown(e)
    {
        // Never start dragging while we have no callback.  This generally shouldn't happen
        // since we should be hidden.
        if(this.callback == null)
            return;

        if(this.dragging)
            return;

        e.preventDefault();
        this.dragging = true;
        helpers.set_class(this.container, "dragging", this.dragging);

        // Only listen to mousemove while we're dragging.  Put this on window, so we get drags outside
        // the window.
        window.addEventListener("mousemove", this.mousemove);
        window.addEventListener("mouseup", this.mouseup);

        this.set_drag_pos(e);
    }

    stop_dragging()
    {
        if(!this.dragging)
            return;

        this.dragging = false;
        helpers.set_class(this.container, "dragging", this.dragging);

        window.removeEventListener("mousemove", this.mousemove);
        window.removeEventListener("mouseup", this.mouseup);

        if(this.callback)
            this.callback(false, null);
    }

    mouseup(e)
    {
        this.stop_dragging();
    }

    mousemove(e)
    {
        this.set_drag_pos(e);
    }

    // The user clicked or dragged.  Pause and seek to the clicked position.
    set_drag_pos(e)
    {
        // Get the mouse position relative to the seek bar.
        var bounds = this.container.getBoundingClientRect();
        var pos = (e.clientX - bounds.left) / bounds.width;
        pos = Math.max(0, Math.min(1, pos));
        var time = pos * this.duration;

        // Tell the user to seek.
        this.callback(true, time);
    }

    // Set the callback.  callback(pause, time) will be called when the user interacts
    // with the seek bar.  The first argument is true if the video should pause (because
    // the user is dragging the seek bar), and time is the desired playback time.  If callback
    // is null, remove the callback.
    set_callback(callback)
    {
        this.container.hidden = callback == null;
        if(this.callback == callback)
            return;

        // Stop dragging on any previous caller before we replace the callback.
        if(this.callback != null)
            this.stop_dragging();

        this.callback = callback;
    };

    set_duration(seconds)
    {
        this.duration = seconds;
        this.refresh();
    };

    set_current_time(seconds)
    {
        this.current_time = seconds;
        this.refresh();
    };

    refresh()
    {
        var position = this.duration > 0.0001? (this.current_time / this.duration):0;
        this.container.querySelector(".seek-fill").style.width = (position * 100) + "%";
    };
}

