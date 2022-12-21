import Viewer from 'vview/viewer/viewer.js';
import VideoUI from 'vview/viewer/video/video-ui.js';
import DragHandler from 'vview/misc/drag-handler.js';
import { helpers } from 'vview/misc/helpers.js';

export default class ViewerVideoBase extends Viewer
{
    constructor({...options})
    {
        super({...options, template: `
            <div class="viewer viewer-video">
                <div class=top-seek-bar></div>
                <div class=video-container></div>
                <div class=video-ui-container></div>
            </div>
        `});

        this.videoContainer = this.container.querySelector(".video-container");

        // Create the video UI.
        this.videoUi = new VideoUI({
            container: this.container.querySelector(".video-ui-container"),
        });

        this.videoUi.seekBar.set_current_time(0);
        this.videoUi.seekBar.set_callback(this.seekCallback.bind(this));

        if(ppixiv.mobile)
        {
            // This seek bar is used for mobile seeking.  It's placed at the top of the screen, so
            // it's not obscured by the user's hand, and drags with a DragHandler similar to TouchScroller's
            // dragging.  The seek bar itself doesn't trigger seeks here.
            this.topSeekBar = new seek_bar({
                container: this.container.querySelector(".top-seek-bar"),
            });
    
            this.seekDragger = new DragHandler({
                name: "seek-dragger",
                element: this.container,
                defer_delay_ms: 30,
                ...this._signal,

                ondragstart: () => {
                    this.seekCallback(true, null);
                    this.drag_remainder = 0;
                    helpers.set_class(this.topSeekBar.container, "dragging", true);
                    return true;
                },
                ondrag: ({movementX}) => {
                    let fraction = movementX / Math.min(window.innerWidth, window.innerHeight);

                    let current_time = this._current_time + this.drag_remainder;
                    let position = current_time / this._duration;
                    position += fraction;
                    position = helpers.clamp(position, 0, 1);

                    let new_position = position * this._duration;
                    this.seekCallback(true, new_position);

                    // The video player may round the position.  See how far from the requested position
                    // we ended up on, and apply it to the next drag, so drag inputs smaller than a frame
                    // aren't lost.
                    this.drag_remainder = new_position - this._current_time;
                },
                ondragend: () => {
                    helpers.set_class(this.topSeekBar.container, "dragging", false);
                    this.seekCallback(false, null);
                },
            });
        }
    }

    async load()
    {
        let load_sentinel = this._loadSentinel = new Object();

        this.mediaInfo = await ppixiv.media_cache.get_media_info(this.mediaId);

        return load_sentinel;
    }

    shutdown()
    {
        this.mediaInfo = null;

        // If this.load() is running, cancel it.
        this._loadSentinel = null;

        this.video.remove();
        this.videoUi.seekBar.set_callback(null);

        super.shutdown();
    }

    refreshFocus()
    {
    }

    togglePause = (e) =>
    {
        this.setWantPlaying(!this.want_playing);
        this.refreshFocus();
    }

    // This is called when the user interacts with the seek bar.
    seekCallback(pause, seconds)
    {
        this.seeking = pause;
    }

    setSeekBar({current_time=null, duration=null, available=null}={})
    {
        if(current_time != null)
            this._current_time = current_time;
        if(duration != null)
            this._duration = duration;

        // If the seekable range changes during a drag, discard drag_remainder so we don't
        // snap into the newly loaded area on the next pointer movement.
        if(available != null)
            this.drag_remainder = null;

        for(let bar of [this.videoUi.seekBar, this.topSeekBar])
        {
            if(bar == null)
                continue;

            if(current_time != null)
                bar.set_current_time(current_time);
            if(duration != null)
                bar.set_duration(duration);
            if(available != null)
                bar.set_loaded(available);
        }
    }
}
