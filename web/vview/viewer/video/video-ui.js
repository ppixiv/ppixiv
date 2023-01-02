import Widget from 'vview/widgets/widget.js';
import SeekBar from 'vview/viewer/video/seek-bar.js';
import PointerListener from 'vview/actors/pointer-listener.js';
import { helpers, ClassFlags } from 'vview/misc/helpers.js';

// The overlay video UI.
export default class VideoUI extends Widget
{
    constructor({...options})
    {
        super({
            ...options, template: `
            <div class=video-ui>
                <div class=seek-bar-container-top></div>
                <div class=video-ui-strip>
                    <vv-container class="play-button button">
                        ${ helpers.createIcon("pause", { dataset: { play: "pause" }}) }
                        ${ helpers.createIcon("play_arrow", { dataset: { play: "play" }}) }
                    </vv-container>

                    <div class=time></div>

                    <div style="flex: 1;"></div>

                    <vv-container class=volume-slider-container data-hidden-on=mobile></vv-container>

                    <vv-container class=button>
                        ${ helpers.createIcon("volume_up", { dataset: { volume: "high" }}) }
                        ${ helpers.createIcon("volume_off", { dataset: { volume: "mute" }}) }
                    </vv-container>

                    <vv-container class="pip-button button">
                        ${ helpers.createIcon("picture_in_picture_alt") }
                    </vv-container>

                    <vv-container class="fullscreen button">
                        <ppixiv-inline src="resources/fullscreen.svg"></ppixiv-inline>
                    </vv-container>
                </div>
                <div class=seek-bar-container-bottom></div>
            </div>
        `});

        // We set .show-ui to force the video control bar to be displayed when the mobile UI
        // is visible.
        this.refreshShowUi();

        // listen for data-mobile-ui-visible and show our UI
        ClassFlags.get.addEventListener("mobile-ui-visible", (e) => {
            this.refreshShowUi();
        }, { signal: this.shutdownSignal });

        // Set .dragging to stay visible during drags.
        new PointerListener({
            element: this.root,
            callback: (e) => {
                helpers.html.setClass(this.root, "dragging", e.pressed);
            },
        });

        // Add the seek bar.  This moves between seek-bar-container-top and seek-bar-container-bottom.
        this.seekBar = new SeekBar({
            container: this.root.querySelector(".seek-bar-container-top"),
        });
        this._setSeekBarPos();

        this.volumeSlider = new VolumeSliderWidget({
            container: this.root.querySelector(".volume-slider-container"),
            startedDragging: () =>
            {
                // Remember what the volume was before the drag started.
                this.savedVolume = this.video.volume;
            },
            stoppedDragging: () =>
            {
                this.savedVolume = null;
            },
            ondrag: (volume) =>
            {
                if(!this.video)
                    return;

                // Dragging the volume slider to 0 mutes and resets the underlying volume.
                if(volume == 0)
                {
                    this.video.volume = this.savedVolume;
                    this.video.muted = true;
                }
                else
                {
                    this.video.volume = volume;
                    this.video.muted = false;
                }
            },
        });
        
        this.time = this.root.querySelector(".time");

        // Prevent dblclick from propagating to our parent, so double-clicking inside the
        // UI strip doesn't toggle fullscreen.
        this.root.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            e.preventDefault();
        });

        this.root.querySelector(".play-button").addEventListener("click", () => {
            if(this.player != null)
                this.player.setWantPlaying(!this.player.wantPlaying);
        }, { signal: this.shutdownSignal });

        for(let button of this.root.querySelectorAll("[data-volume]"))
            button.addEventListener("click", () => {
                if(this.video == null)
                    return;
                this.video.muted = !this.video.muted;
            }, { signal: this.shutdownSignal });

        this.root.querySelector(".pip-button").addEventListener("click", async () => {
            if(this.video == null)
                return;
                
            if(this.video.requestPictureInPicture == null)
                return false;
    
            try {
                await this.video.requestPictureInPicture();
                return true;
            } catch(e) {
                return false;
            }
        }, { signal: this.shutdownSignal });

        document.addEventListener("fullscreenchange", (e) => {
            this._setSeekBarPos();
        }, { signal: this.shutdownSignal });

        window.addEventListener("resize", (e) => {
            this._setSeekBarPos();
        }, { signal: this.shutdownSignal });

        // Set up the fullscreen button.  Disable this on mobile, since it doesn't make sense there.
        let fullscreenButton = this.root.querySelector(".fullscreen");
        fullscreenButton.hidden = ppixiv.mobile;
        fullscreenButton.addEventListener("click", () => {
            helpers.toggleFullscreen();
        }, { signal: this.shutdownSignal });

        this.videoChanged();
    }

    refreshShowUi()
    {
        let show_ui = ClassFlags.get.get("mobile-ui-visible");
        helpers.html.setClass(this.root, "show-ui", show_ui);
    }

    // Set whether the seek bar is above or below the video UI.
    _setSeekBarPos()
    {
        // Insert the seek bar into the correct container.
        let top = ppixiv.mobile || !helpers.isFullscreen();
        this.seekBar.root.remove();
        let seekBarContainer = top? ".seek-bar-container-top":".seek-bar-container-bottom";
        this.root.querySelector(seekBarContainer).appendChild(this.seekBar.root);

        this.seekBar.root.dataset.position = top? "top":"bottom";
    }

    shutdown()
    {
        // Remove any listeners.
        this.videoChanged();

        super.shutdown();
    }

    videoChanged({player=null, video=null}={})
    {
        if(this.removeVideoListeners)
        {
            this.removeVideoListeners.abort();
            this.removeVideoListeners = null;
        }

        this.player = player;
        this.video = video;

        // Only display the main UI when we have a video.  Don't hide the seek bar, since
        // it's also used by ViewerUgoira.
        this.root.querySelector(".video-ui-strip").hidden = this.video == null;
        if(this.video == null)
            return;

        this.removeVideoListeners = new AbortController();

        this.video.addEventListener("volumechange", (e) => {
            this.volumeChanged();
        }, { signal: this.removeVideoListeners.signal });

        this.video.addEventListener("play", (e) => { this.pauseChanged(); }, { signal: this.removeVideoListeners.signal });
        this.video.addEventListener("pause", (e) => { this.pauseChanged(); }, { signal: this.removeVideoListeners.signal });
        this.video.addEventListener("timeupdate", (e) => { this.timeChanged(); }, { signal: this.removeVideoListeners.signal });
        this.video.addEventListener("loadedmetadata", (e) => { this.timeChanged(); }, { signal: this.removeVideoListeners.signal });
        this.video.addEventListener("progress", (e) => { this.timeChanged(); }, { signal: this.removeVideoListeners.signal });

        // Hide the PIP button if the browser or this video doesn't support it.
        this.root.querySelector(".pip-button").hidden = this.video.requestPictureInPicture == null;
        
        this.pauseChanged();
        this.volumeChanged();
        this.timeChanged();
    }

    pauseChanged()
    {
        this.root.querySelector("[data-play='play']").style.display = !this.video.paused? "":"none";
        this.root.querySelector("[data-play='pause']").style.display = this.video.paused? "":"none";
    }

    volumeChanged()
    {
        if(this.video.hideAudioControls)
        {
            for(let element of this.root.querySelectorAll("[data-volume]"))
                element.style.display = "none";
            this.volumeSlider.root.hidden = true;
        }
        else
        {
            // Update the displayed volume icon.  When not muted, scale opacity based on the volume.
            let opacity = (this.video.volume * 0.75) + 0.25;
            this.root.querySelector("[data-volume='high']").style.display = !this.video.muted? "":"none";
            this.root.querySelector("[data-volume='high']").style.opacity = opacity;
            this.root.querySelector("[data-volume='mute']").style.display = this.video.muted? "":"none";

            // Update the volume slider.  If the video is muted, display 0 instead of the
            // underlying volume.
            this.volumeSlider.root.hidden = false;
            this.volumeSlider.setValue(this.video.muted? 0:this.video.volume);
        }
    }

    timeChanged()
    {
        if(this.video == null)
            return;

        let duration = this.video.duration;
        let now = this.video.currentTime;
        if(isNaN(duration))
        {
            this.time.innerText = "";
            return;
        }

        if(duration < 10)
        {
            let fmt = (totalSeconds) => {
                let seconds = Math.floor(totalSeconds);
                let ms = Math.round((totalSeconds * 1000) % 1000);
                return "" + seconds + "." + ms.toString().padStart(3, '0');
            };
            this.time.innerText = `${fmt(now)} / ${fmt(duration)}`;
        }
        else
        {
            this.time.innerText = `${helpers.strings.formatSeconds(now)} / ${helpers.strings.formatSeconds(duration)}`;
        }
    }
}

class VolumeSliderWidget extends Widget
{
    constructor({
        ondrag,
        startedDragging,
        stoppedDragging,
        ...options
    })
    {
        super({
            ...options,
            template: `
                <div class=volume-slider>
                    <div class=volume-line></div>
                </div>
            `
        });

        this.ondrag = ondrag;
        this.startedDragging = startedDragging;
        this.stoppedDragging = stoppedDragging;

        this.volumeLine = this.root.querySelector(".volume-line");

        new PointerListener({
            element: this.root,
            callback: (e) => {
                if(e.pressed)
                {
                    this.startedDragging();
                    this._capturedPointerId = e.pointerId;
                    this.root.setPointerCapture(this._capturedPointerId);
                    this.root.addEventListener("pointermove", this.pointermove);
                    this.handleDrag(e);
                }
                else
                {
                    this.stopDragging();
                }
            },
        });
    }

    get is_dragging()
    {
        return this._capturedPointerId != null;
    }

    pointermove = (e) =>
    {
        this.handleDrag(e);
    }

    stopDragging()
    {
        this.stoppedDragging();

        this.root.removeEventListener("pointermove", this.pointermove);
        
        if(this._capturedPointerId != null)
        {
            this.root.releasePointerCapture(this._capturedPointerId);
            this._capturedPointerId = null;
        }
    }

    setValue(value)
    {
        // Ignore external changes while we're dragging.
        if(this.is_dragging)
            return;

        this.setValueInternal(value);
    }

    setValueInternal(value)
    {
        value = 1 - value;
        this.volumeLine.style.background = `linear-gradient(to left, #000 ${value*100}%, #FFF ${value*100}px)`;
    }

    handleDrag(e)
    {
        // Get the mouse position relative to the volume slider.
        let {left, width} = this.volumeLine.getBoundingClientRect();
        let volume = (e.clientX - left) / width;
        volume = Math.max(0, Math.min(1, volume));
        this.setValueInternal(volume);
        this.ondrag(volume);
    };
}
