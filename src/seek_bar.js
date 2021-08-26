class seek_bar
{
    constructor(container)
    {
        this.mousedown = this.mousedown.bind(this);
        this.mouseup = this.mouseup.bind(this);
        this.mousemove = this.mousemove.bind(this);
        this.mouseover = this.mouseover.bind(this);
        this.mouseout = this.mouseout.bind(this);

        this.container = container;

        this.bar = this.container.appendChild(helpers.create_node('\
            <div class="seek-bar visible"> \
                <div class=seek-empty> \
                    <div class=seek-fill></div> \
                </div> \
            </div> \
        '));

        this.bar.addEventListener("mousedown", this.mousedown);
        this.bar.addEventListener("mouseover", this.mouseover);
        this.bar.addEventListener("mouseout", this.mouseout);

        this.current_time = 0;
        this.duration = 1;
        this.refresh_visibility();
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
        helpers.set_class(this.bar, "dragging", this.dragging);
        this.refresh_visibility();

        // Only listen to mousemove while we're dragging.  Put this on window, so we get drags outside
        // the window.
        window.addEventListener("mousemove", this.mousemove);
        window.addEventListener("mouseup", this.mouseup);

        this.set_drag_pos(e);
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

    refresh_visibility()
    {
        // Show the seek bar if the mouse is over it, or if we're actively dragging.
        // Only show if we're active.
        var visible = this.callback != null && (this.hovering || this.dragging);
        helpers.set_class(this.bar, "visible", visible);
    }

    stop_dragging()
    {
        if(!this.dragging)
            return;

        this.dragging = false;
        helpers.set_class(this.bar, "dragging", this.dragging);
        this.refresh_visibility();

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
        var bounds = this.bar.getBoundingClientRect();
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
        this.bar.hidden = callback == null;
        if(this.callback == callback)
            return;

        // Stop dragging on any previous caller before we replace the callback.
        if(this.callback != null)
            this.stop_dragging();

        this.callback = callback;
        this.refresh_visibility();
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
        this.bar.querySelector(".seek-fill").style.width = (position * 100) + "%";
    };
}

