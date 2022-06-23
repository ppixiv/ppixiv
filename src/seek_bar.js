"use strict";

ppixiv.seek_bar = class extends widget
{
    constructor({...options})
    {
        super({...options,
            template: `
                <div class="seek-bar">
                    <div class=seek-parts>
                        <div data-seek-part=empty class=seek-empty></div>
                        <div data-seek-part=loaded class=seek-loaded></div>
                        <div data-seek-part=fill class=seek-fill></div>
                    </div>
                </div>
            `
        });

        this.container.addEventListener("pointerdown", this.mousedown);

        this.current_time = 0;
        this.duration = 1;
        this.amount_loaded = 1;
        this.refresh();
        this.set_callback(null);
    };

    mousedown = (e) =>
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
        window.addEventListener("pointermove", this.mousemove);
        window.addEventListener("pointerup", this.mouseup);
        window.addEventListener("pointercancel", this.mouseup);

        this.set_drag_pos(e);
    }

    stop_dragging()
    {
        if(!this.dragging)
            return;

        this.dragging = false;
        helpers.set_class(this.container, "dragging", this.dragging);

        window.removeEventListener("pointermove", this.mousemove);
        window.removeEventListener("pointerup", this.mouseup);

        if(this.callback)
            this.callback(false, null);
    }

    mouseup = (e) =>
    {
        this.stop_dragging();
    }

    mousemove = (e) =>
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

    // Set the amount of the video that's loaded.  If 1 or greater, the loading indicator will be
    // hidden.
    set_loaded(value)
    {
        this.amount_loaded = value;
        this.refresh();
    }

    refresh()
    {
        let position = this.duration > 0.0001? (this.current_time / this.duration):0;
        this.container.querySelector(".seek-fill").style.width = (position * 100) + "%";

        let loaded = this.amount_loaded < 1? this.amount_loaded:0;
        this.container.querySelector(".seek-loaded").style.width = (loaded * 100) + "%";
    };
}

