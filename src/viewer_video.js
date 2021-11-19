"use strict";

// A player for video files.
//
// This is only used for local files, since Pixiv doesn't have any video support.
// See viewer_ugoira for Pixiv's jank animation format.
//
// We don't show buffering.  This is only used for viewing local files.
ppixiv.viewer_video = class extends ppixiv.viewer
{
    constructor({video_ui, ...options})
    {
        super(options);
        
        this.refresh_focus = this.refresh_focus.bind(this);
        this.clicked_video = this.clicked_video.bind(this);
        this.onkeydown = this.onkeydown.bind(this);
        this.update_seek_bar = this.update_seek_bar.bind(this);
        this.seek_callback = this.seek_callback.bind(this);

        this.video_ui = video_ui;
        this.seek_bar = options.seek_bar;
        this.seek_bar.set_current_time(0);
        this.seek_bar.set_callback(this.seek_callback);

        // Create a canvas to render into.
        this.video = document.createElement("video");
        this.video.loop = true;
        this.video.controls = false;
        this.video.preload = "auto";
        this.video.volume = settings.get("volume");
        this.video.muted = settings.get("mute");

        // Store changes to volume.
        this.video.addEventListener("volumechange", (e) => {
            settings.set("volume", this.video.volume);
            settings.set("mute", this.video.muted);
        });

        this.video.autoplay = true;
        this.video.className = "filtering";
        this.video.style.width = "100%";
        this.video.style.height = "100%";
        this.video.style.objectFit = "contain";
        this.container.appendChild(this.video);

        this.video.addEventListener("timeupdate", this.update_seek_bar);
        this.video.addEventListener("progress", this.update_seek_bar);
        this.video.addEventListener("click", this.clicked_video);
    
        // True if we want to play if the window has focus.  We always pause when backgrounded.
        let args = helpers.args.location;
        this.want_playing = !args.state.paused;

        // True if the user is seeking.  We temporarily pause while seeking.  This is separate
        // from this.want_playing so we stay paused after seeking if we were paused at the start.
        this.seeking = false;
    }
    
    async load(illust_id, manga_page)
    {
        this.unload();

        this.illust_id = illust_id;

        this.illust_data = await image_data.singleton().get_image_info(this.illust_id);

        // Remove the old source, if any, and create a new one.
        if(this.source)
            this.source.remove();
        this.source = document.createElement("source");
        this.video.appendChild(this.source);

        // Set the video URLs.
        this.video.poster = this.illust_data.mangaPages[0].urls.poster;
        this.source.src = this.illust_data.mangaPages[0].urls.original;
        this.update_seek_bar();

        // Tell the video UI about the video.
        this.video_ui.video_changed(this);

        this.refresh_focus();
    }

    // Undo load().
    unload()
    {
        if(this.source)
        {
            this.source.remove();
            this.source = null;
        }

        if(this.player)
        {
            this.player.pause(); 
            this.player = null;
        }
    }

    // Undo load() and the constructor.
    shutdown()
    {
        this.unload();

        super.shutdown();

        if(this.video_ui)
        {
            this.video_ui.video_changed(null);
            this.video_ui = null;
        }

        if(this.seek_bar)
        {
            this.seek_bar.set_callback(null);
            this.seek_bar = null;
        }

        this.video.remove();
    }

    set active(active)
    {
        super.active = active;

        // Rewind the video when we're not visible.
        if(!active && this.player != null)
            this.player.rewind();

        // Refresh playback, since we pause while the viewer isn't visible.
        this.refresh_focus();
    }

    update_seek_bar()
    {
        if(this.seek_bar != null)
        {
            // Update the seek bar.
            let current_time = isNaN(this.video.currentTime)? 0:this.video.currentTime;
            let duration = isNaN(this.video.duration)? 1:this.video.duration;
            this.seek_bar.set_current_time(current_time);
            this.seek_bar.set_duration(duration);
        }
    }

    toggle_mute()
    {
        this.video.muted = !this.video.muted;
    }

    // This is sent manually by the UI handler so we can control focus better.
    onkeydown(e)
    {
        if(this.video == null)
            return;

        if(e.keyCode >= 49 && e.keyCode <= 57)
        {
            // 5 sets the speed to default, 1234 slow the video down, and 6789 speed it up.
            e.stopPropagation();
            e.preventDefault();
            if(!this.video)
                return;

            var speed;
            switch(e.keyCode)
            {
            case 49: speed = 0.10; break; // 1
            case 50: speed = 0.25; break; // 2
            case 51: speed = 0.50; break; // 3
            case 52: speed = 0.75; break; // 4
            case 53: speed = 1.00; break; // 5
            case 54: speed = 1.25; break; // 6
            case 55: speed = 1.50; break; // 7
            case 56: speed = 1.75; break; // 8
            case 57: speed = 2.00; break; // 9
            }

            this.video.playbackRate = speed;
            return;
        }

        switch(e.keyCode)
        {
        case 77: // m
            this.toggle_mute();
            break;
            /*
        case 32: // space
            e.stopPropagation();
            e.preventDefault();

            this.set_want_playing(!this.want_playing);

            return;
            
        case 36: // home
            e.stopPropagation();
            e.preventDefault();
            if(!this.player)
                return;

            this.video.currentTime = 0;
            return;

        case 35: // end
            e.stopPropagation();
            e.preventDefault();
            if(!this.player)
                return;

            this.pause();
            this.player.set_current_frame(this.player.get_frame_count() - 1);
            return;

        case 81: // q
        case 87: // w
            e.stopPropagation();
            e.preventDefault();
            if(!this.player)
                return;

            this.pause();
            var current_frame = this.player.get_current_frame();
            var next = e.keyCode == 87;
            var new_frame = current_frame + (next?+1:-1);
            this.player.set_current_frame(new_frame);
            return;
            */
        }
    }

    play()
    {
        this.set_want_playing(true);
    }

    pause()
    {
        this.set_want_playing(false);
    }

    // Set whether the user wants the video to be playing or paused.
    set_want_playing(value)
    {
        if(this.want_playing != value)
        {
            // Store the play/pause state in history, so if we navigate out and back in while
            // paused, we'll stay paused.
            let args = helpers.args.location;
            args.state.paused = !value;
            helpers.set_page_url(args, false, "updating-video-pause");

            this.want_playing = value;
        }

        this.refresh_focus();
    }

    refresh_focus()
    {
        if(this.video == null)
            return;

        let active = this.want_playing && !this.seeking && this._active;
        if(active)
            this.video.play(); 
        else
            this.video.pause(); 
    };

    async clicked_video(e)
    {
        this.set_want_playing(!this.want_playing);
        this.refresh_focus();
    }

    // This is called when the user interacts with the seek bar.
    seek_callback(pause, seconds)
    {
        this.seeking = pause;
        this.refresh_focus();

        if(seconds != null)
        {
            this.video.currentTime = seconds;
            this.update_seek_bar();
            this.video_ui.time_changed();
        }
    };
}

// The overlay video UI.  This is created by screen_illust, since viewer_video gets
// recreated 
ppixiv.video_ui = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({
            ...options, template: `
            <div class=video-ui>
                <div class=play-button>
                    <ppixiv-inline data-play=play src="resources/video-play.svg"></ppixiv-inline>
                    <ppixiv-inline data-play=pause src="resources/video-pause.svg"></ppixiv-inline>
                </div>
                <div class=time></div>

                <div style="flex: 1;"></div>

                <div class=volume-slider>
                    <div class=volume-line></div>
                </div>

                <ppixiv-inline data-volume=high src="resources/volume-high.svg"></ppixiv-inline>
                <ppixiv-inline data-volume=low src="resources/volume-low.svg"></ppixiv-inline>
                <ppixiv-inline data-volume=mute src="resources/volume-mute.svg"></ppixiv-inline>

                <div class=pip-button>
                    <ppixiv-inline src="resources/picture-in-picture.svg"></ppixiv-inline>
                </div>
                <div class=fullscreen>
                    <ppixiv-inline src="resources/fullscreen.svg"></ppixiv-inline>
                </div>
            </div>
        `});

        this.volume_slider = new volume_slider_widget({
            contents: this.container.querySelector(".volume-slider"),
            parent: this,
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

        this.container.querySelector(".play-button").addEventListener("click", () => {
            if(this.player != null)
                this.player.set_want_playing(!this.player.want_playing);
        });

        for(let button of this.container.querySelectorAll("[data-volume]"))
            button.addEventListener("click", () => {
                if(this.video == null)
                    return;
                this.video.muted = !this.video.muted;
            });

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
        });

        this.container.querySelector(".fullscreen").addEventListener("click", () => {
            if(!document.fullscreenElement)
                document.documentElement.requestFullscreen();
            else
                document.exitFullscreen();
        });
    }

    video_changed(player)
    {
        if(this.remove_video_listeners)
        {
            this.remove_video_listeners.abort();
            this.remove_video_listeners = null;
        }

        this.player = player;
        this.video = player?.video;

        // Only display when we have a video.
        this.visible = this.video != null;
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
        // Update the displayed volume icon.
        let low_volume = this.video.volume <= 0.5;
        this.container.querySelector("[data-volume='high']").style.display = !this.video.muted && !low_volume? "":"none";
        this.container.querySelector("[data-volume='low']").style.display = !this.video.muted && low_volume? "":"none";
        this.container.querySelector("[data-volume='mute']").style.display = this.video.muted? "":"none";

        // Update the volume slider.  If the video is muted, display 0 instead of the
        // underlying volume.
        this.volume_slider.set_value(this.video.muted? 0:this.video.volume);
    }

    time_changed()
    {
        if(this.video == null)
            return;

        if(isNaN(this.video.duration))
        {
            this.time.innerText = "";
            return;
        }

        let current_time = helpers.format_seconds(this.video.currentTime);
        let duration = helpers.format_seconds(this.video.duration);
        this.time.innerText = `${current_time} / ${duration}`;
    }
}

class volume_slider_widget extends ppixiv.widget
{
    constructor({
        ondrag,
        started_dragging,
        stopped_dragging,
        ...options
    })
    {
        super(options);

        this.pointermove = this.pointermove.bind(this);

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

    pointermove(e)
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
