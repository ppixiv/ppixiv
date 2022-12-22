import Viewer from 'vview/viewer/viewer.js';
import VideoUI from 'vview/viewer/video/video-ui.js';
import DragHandler from 'vview/misc/drag-handler.js';
import SeekBar from 'vview/viewer/video/seek-bar.js';
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

        this.videoUi.seekBar.setCurrentTime(0);
        this.videoUi.seekBar.setCallback(this.seekCallback.bind(this));

        if(ppixiv.mobile)
        {
            // This seek bar is used for mobile seeking.  It's placed at the top of the screen, so
            // it's not obscured by the user's hand, and drags with a DragHandler similar to TouchScroller's
            // dragging.  The seek bar itself doesn't trigger seeks here.
            this.topSeekBar = new SeekBar({
                container: this.container.querySelector(".top-seek-bar"),
            });
    
            this.seekDragger = new DragHandler({
                name: "seek-dragger",
                element: this.container,
                deferDelayMs: 30,
                ...this._signal,

                ondragstart: () => {
                    this.seekCallback(true, null);
                    this.dragRemainder = 0;
                    helpers.setClass(this.topSeekBar.container, "dragging", true);
                    return true;
                },
                ondrag: ({movementX}) => {
                    let fraction = movementX / Math.min(window.innerWidth, window.innerHeight);

                    let currentTime = this._currentTime + this.dragRemainder;
                    let position = currentTime / this._duration;
                    position += fraction;
                    position = helpers.clamp(position, 0, 1);

                    let newPosition = position * this._duration;
                    this.seekCallback(true, newPosition);

                    // The video player may round the position.  See how far from the requested position
                    // we ended up on, and apply it to the next drag, so drag inputs smaller than a frame
                    // aren't lost.
                    this.dragRemainder = newPosition - this._currentTime;
                },
                ondragend: () => {
                    helpers.setClass(this.topSeekBar.container, "dragging", false);
                    this.seekCallback(false, null);
                },
            });
        }
    }

    async load()
    {
        let loadSentinel = this._loadSentinel = new Object();

        this.mediaInfo = await ppixiv.mediaCache.getMediaInfo(this.mediaId);

        return loadSentinel;
    }

    shutdown()
    {
        this.mediaInfo = null;

        // If this.load() is running, cancel it.
        this._loadSentinel = null;

        this.video.remove();
        this.videoUi.seekBar.setCallback(null);

        super.shutdown();
    }

    refreshFocus()
    {
    }

    togglePause = (e) =>
    {
        this.setWantPlaying(!this.wantPlaying);
        this.refreshFocus();
    }

    // This is called when the user interacts with the seek bar.
    seekCallback(pause, seconds)
    {
        this.seeking = pause;
    }

    setSeekBar({currentTime=null, duration=null, available=null}={})
    {
        if(currentTime != null)
            this._currentTime = currentTime;
        if(duration != null)
            this._duration = duration;

        // If the seekable range changes during a drag, discard dragRemainder so we don't
        // snap into the newly loaded area on the next pointer movement.
        if(available != null)
            this.dragRemainder = null;

        for(let bar of [this.videoUi.seekBar, this.topSeekBar])
        {
            if(bar == null)
                continue;

            if(currentTime != null)
                bar.setCurrentTime(currentTime);
            if(duration != null)
                bar.setDuration(duration);
            if(available != null)
                bar.setLoaded(available);
        }
    }
}
