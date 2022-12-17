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

        this.current_time = 0;
        this.duration = 1;
        this.amount_loaded = 1;
        this.refresh();
        this.set_callback(null);

        this.dragger = new ppixiv.DragHandler({
            element: this.container,
            signal: this.shutdown_signal.signal,
            name: "seek-bar",

            // Don't delay the start of seek bar drags until the first pointer movement.
            deferred_start: () => false,

            confirm_drag: () => {
                // Never start dragging while we have no callback.  This generally shouldn't happen
                // since we should be hidden.
                return this.callback != null;
            },

            ondragstart: ({event}) => {
                helpers.set_class(this.container, "dragging", true);

                this.set_drag_pos(event);
                return true;
            },

            ondrag: ({event, first}) => {
                this.set_drag_pos(event);
            },

            ondragend: () => {
                helpers.set_class(this.container, "dragging", false);

                if(this.callback)
                    this.callback(false, null);
            },
        });
    };

    // The user clicked or dragged.  Pause and seek to the clicked position.
    set_drag_pos(e)
    {
        // Get the mouse position relative to the seek bar.
        let bounds = this.container.getBoundingClientRect();
        let pos = (e.clientX - bounds.left) / bounds.width;
        pos = Math.max(0, Math.min(1, pos));
        let time = pos * this.duration;

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
            this.dragger.cancel_drag();

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

