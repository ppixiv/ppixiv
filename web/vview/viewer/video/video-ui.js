import Widget from 'vview/widgets/widget.js';
import SeekBar from 'vview/viewer/video/seek-bar.js';
import { helpers } from 'vview/ppixiv-imports.js';

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
                        ${ helpers.create_icon("pause", { dataset: { play: "pause" }}) }
                        ${ helpers.create_icon("play_arrow", { dataset: { play: "play" }}) }
                    </vv-container>

                    <div class=time></div>

                    <div style="flex: 1;"></div>

                    <vv-container class="volume-slider button" data-hidden-on=ios>
                        <div class=volume-line></div>
                    </vv-container>

                    <vv-container class=button>
                        ${ helpers.create_icon("volume_up", { dataset: { volume: "high" }}) }
                        ${ helpers.create_icon("volume_off", { dataset: { volume: "mute" }}) }
                    </vv-container>

                    <vv-container class="pip-button button">
                        ${ helpers.create_icon("picture_in_picture_alt") }
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
        this.refresh_show_ui();

        // listen for data-mobile-ui-visible and show our UI
        ppixiv.ClassFlags.get.addEventListener("mobile-ui-visible", (e) => {
            this.refresh_show_ui();
        }, { signal: this.shutdown_signal.signal });

        // Set .dragging to stay visible during drags.
        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.container,
            callback: (e) => {
                helpers.set_class(this.container, "dragging", e.pressed);
            },
        });

        // Add the seek bar.  This moves between seek-bar-container-top and seek-bar-container-bottom.
        this.seekBar = new SeekBar({
            container: this.container.querySelector(".seek-bar-container-top"),
        });
        this.set_seek_bar_pos();

        this.volume_slider = new volume_slider_widget({
            contents: this.container.querySelector(".volume-slider"),
            started_dragging: () =>
            {
                // Remember what the volume was before the drag started.
                this.saved_volume = this.video.volume;
            },
            stopped_dragging: () =>
            {
                this.saved_volume = null;
            },
            ondrag: (volume) =>
            {
                if(!this.video)
                    return;

                // Dragging the volume slider to 0 mutes and resets the underlying volume.
                if(volume == 0)
                {
                    this.video.volume = this.saved_volume;
                    this.video.muted = true;
                }
                else
                {
                    this.video.volume = volume;
                    this.video.muted = false;
                }
            },
        });
        
        this.time = this.container.querySelector(".time");

        // Prevent dblclick from propagating to our parent, so double-clicking inside the
        // UI strip doesn't toggle fullscreen.
        this.container.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            e.preventDefault();
        });

        this.container.querySelector(".play-button").addEventListener("click", () => {
            if(this.player != null)
                this.player.setWantPlaying(!this.player.want_playing);
        }, { signal: this.shutdown_signal.signal });

        for(let button of this.container.querySelectorAll("[data-volume]"))
            button.addEventListener("click", () => {
                if(this.video == null)
                    return;
                this.video.muted = !this.video.muted;
            }, { signal: this.shutdown_signal.signal });

        this.container.querySelector(".pip-button").addEventListener("click", async () => {
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
        }, { signal: this.shutdown_signal.signal });

        document.addEventListener("fullscreenchange", (e) => {
            this.set_seek_bar_pos();
        }, { signal: this.shutdown_signal.signal });

        window.addEventListener("resize", (e) => {
            this.set_seek_bar_pos();
        }, { signal: this.shutdown_signal.signal });

        // Set up the fullscreen button.  Disable this on mobile, since it doesn't make sense there.
        let fullscreen_button = this.container.querySelector(".fullscreen");
        fullscreen_button.hidden = ppixiv.mobile;
        fullscreen_button.addEventListener("click", () => {
            helpers.toggle_fullscreen();
        }, { signal: this.shutdown_signal.signal });

        this.video_changed();
    }

    refresh_show_ui()
    {
        let show_ui = ppixiv.ClassFlags.get.get("mobile-ui-visible");
        helpers.set_class(this.container, "show-ui", show_ui);
    }

    // Set whether the seek bar is above or below the video UI.
    set_seek_bar_pos()
    {
        // Insert the seek bar into the correct container.
        let top = ppixiv.mobile || !helpers.is_fullscreen();
        this.seekBar.container.remove();
        let seek_bar_container = top? ".seek-bar-container-top":".seek-bar-container-bottom";
        this.container.querySelector(seek_bar_container).appendChild(this.seekBar.container);

        this.seekBar.container.dataset.position = top? "top":"bottom";
    }

    shutdown()
    {
        // Remove any listeners.
        this.video_changed();

        super.shutdown();
    }

    video_changed({player=null, video=null}={})
    {
        if(this.remove_video_listeners)
        {
            this.remove_video_listeners.abort();
            this.remove_video_listeners = null;
        }

        this.player = player;
        this.video = video;

        // Only display the main UI when we have a video.  Don't hide the seek bar, since
        // it's also used by viewer_ugoira.
        this.container.querySelector(".video-ui-strip").hidden = this.video == null;
        if(this.video == null)
            return;

        this.remove_video_listeners = new AbortController();

        this.video.addEventListener("volumechange", (e) => {
            this.volume_changed();
        }, { signal: this.remove_video_listeners.signal });

        this.video.addEventListener("play", (e) => { this.pause_changed(); }, { signal: this.remove_video_listeners.signal });
        this.video.addEventListener("pause", (e) => { this.pause_changed(); }, { signal: this.remove_video_listeners.signal });
        this.video.addEventListener("timeupdate", (e) => { this.time_changed(); }, { signal: this.remove_video_listeners.signal });
        this.video.addEventListener("loadedmetadata", (e) => { this.time_changed(); }, { signal: this.remove_video_listeners.signal });
        this.video.addEventListener("progress", (e) => { this.time_changed(); }, { signal: this.remove_video_listeners.signal });

        // Hide the PIP button if the browser or this video doesn't support it.
        this.container.querySelector(".pip-button").hidden = this.video.requestPictureInPicture == null;
        
        this.pause_changed();
        this.volume_changed();
        this.time_changed();
    }

    pause_changed()
    {
        this.container.querySelector("[data-play='play']").style.display = !this.video.paused? "":"none";
        this.container.querySelector("[data-play='pause']").style.display = this.video.paused? "":"none";
    }

    volume_changed()
    {
        if(this.video.hide_audio_controls)
        {
            for(let element of this.container.querySelectorAll("[data-volume]"))
                element.style.display = "none";
            this.volume_slider.container.hidden = true;
        }
        else
        {
            // Update the displayed volume icon.  When not muted, scale opacity based on the volume.
            let opacity = (this.video.volume * 0.75) + 0.25;
            this.container.querySelector("[data-volume='high']").style.display = !this.video.muted? "":"none";
            this.container.querySelector("[data-volume='high']").style.opacity = opacity;
            this.container.querySelector("[data-volume='mute']").style.display = this.video.muted? "":"none";

            // Update the volume slider.  If the video is muted, display 0 instead of the
            // underlying volume.
            this.volume_slider.container.hidden = false;
            this.volume_slider.set_value(this.video.muted? 0:this.video.volume);
        }
    }

    time_changed()
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
            let fmt = (total_seconds) => {
                let seconds = Math.floor(total_seconds);
                let ms = Math.round((total_seconds * 1000) % 1000);
                return "" + seconds + "." + ms.toString().padStart(3, '0');
            };
            this.time.innerText = `${fmt(now)} / ${fmt(duration)}`;
        }
        else
        {
            this.time.innerText = `${helpers.format_seconds(now)} / ${helpers.format_seconds(duration)}`;
        }
    }
}

class volume_slider_widget extends Widget
{
    constructor({
        ondrag,
        started_dragging,
        stopped_dragging,
        ...options
    })
    {
        super(options);

        this.ondrag = ondrag;
        this.started_dragging = started_dragging;
        this.stopped_dragging = stopped_dragging;

        this.volume_line = this.container.querySelector(".volume-line");

        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.container,
            callback: (e) => {
                if(e.pressed)
                {
                    this.started_dragging();
                    this.captured_pointer_id = e.pointerId;
                    this.container.setPointerCapture(this.captured_pointer_id);
                    this.container.addEventListener("pointermove", this.pointermove);
                    this.handle_drag(e);
                }
                else
                {
                    this.stop_dragging();
                }
            },
        });
    }

    get is_dragging()
    {
        return this.captured_pointer_id != null;
    }

    pointermove = (e) =>
    {
        this.handle_drag(e);
    }

    stop_dragging()
    {
        this.stopped_dragging();

        this.container.removeEventListener("pointermove", this.pointermove);
        
        if(this.captured_pointer_id != null)
        {
            this.container.releasePointerCapture(this.captured_pointer_id);
            this.captured_pointer_id = null;
        }
    }

    set_value(value)
    {
        // Ignore external changes while we're dragging.
        if(this.is_dragging)
            return;

        this.set_value_internal(value);
    }

    set_value_internal(value)
    {
        value = 1 - value;
        this.volume_line.style.background = `linear-gradient(to left, #000 ${value*100}%, #FFF ${value*100}px)`;
    }

    handle_drag(e)
    {
        // Get the mouse position relative to the volume slider.
        let {left, width} = this.volume_line.getBoundingClientRect();
        let volume = (e.clientX - left) / width;
        volume = Math.max(0, Math.min(1, volume));
        this.set_value_internal(volume);
        this.ondrag(volume);
    };
}
