import Widget from 'vview/widgets/widget.js';
import DragHandler from 'vview/misc/drag-handler.js';
import { helpers } from 'vview/misc/helpers.js';

export default class SeekBar extends Widget
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

        this.currentTime = 0;
        this.duration = 1;
        this.amountLoaded = 1;
        this.refresh();
        this.setCallback(null);

        this.dragger = new DragHandler({
            element: this.container,
            signal: this.shutdownSignal.signal,
            name: "seek-bar",

            // Don't delay the start of seek bar drags until the first pointer movement.
            deferredStart: () => false,

            confirmDrag: () => {
                // Never start dragging while we have no callback.  This generally shouldn't happen
                // since we should be hidden.
                return this.callback != null;
            },

            ondragstart: ({event}) => {
                helpers.setClass(this.container, "dragging", true);

                this.setDragPos(event);
                return true;
            },

            ondrag: ({event, first}) => {
                this.setDragPos(event);
            },

            ondragend: () => {
                helpers.setClass(this.container, "dragging", false);

                if(this.callback)
                    this.callback(false, null);
            },
        });
    };

    // The user clicked or dragged.  Pause and seek to the clicked position.
    setDragPos(e)
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
    setCallback(callback)
    {
        if(this.callback == callback)
            return;

        // Stop dragging on any previous caller before we replace the callback.
        if(this.callback != null)
            this.dragger.cancelDrag();

        this.callback = callback;
    };

    setDuration(seconds)
    {
        this.duration = seconds;
        this.refresh();
    };

    setCurrentTime(seconds)
    {
        this.currentTime = seconds;
        this.refresh();
    };

    // Set the amount of the video that's loaded.  If 1 or greater, the loading indicator will be
    // hidden.
    setLoaded(value)
    {
        this.amountLoaded = value;
        this.refresh();
    }

    refresh()
    {
        let position = this.duration > 0.0001? (this.currentTime / this.duration):0;
        this.container.querySelector(".seek-fill").style.width = (position * 100) + "%";

        let loaded = this.amountLoaded < 1? this.amountLoaded:0;
        this.container.querySelector(".seek-loaded").style.width = (loaded * 100) + "%";
    };
}

