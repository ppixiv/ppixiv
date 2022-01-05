"use strict";

// A player for video files.
//
// This is only used for local files, since Pixiv doesn't have any video support.
// See viewer_ugoira for Pixiv's jank animation format.
//
// We don't show buffering.  This is only used for viewing local files.
ppixiv.viewer_video = class extends ppixiv.viewer
{
    constructor({...options})
    {
        super({...options, template: `
            <div class=viewer-video>
                <div class=video-container></div>
                <div class=video-ui-container></div>
            </div>
        `});
        
        // Create the video UI.
        this.video_ui = new ppixiv.video_ui({
            container: this.container.querySelector(".video-ui-container"),
            parent: this,
        });

        this.refresh_focus = this.refresh_focus.bind(this);
        this.clicked_video = this.clicked_video.bind(this);
        this.onkeydown = this.onkeydown.bind(this);
        this.update_seek_bar = this.update_seek_bar.bind(this);
        this.seek_callback = this.seek_callback.bind(this);

        this.seek_bar = this.video_ui.seek_bar;
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

        // Don't use object-fit to size the video, since Chrome's PIP display doesn't understand
        // it and always scales to fill, which is really ugly.  Work around this by setting the
        // video size to fill without using object-fit.
        this.video.style.width = "auto";
        this.video.style.height = "100%";
        this.video.style.display = "block";
        this.video.style.margin = "0 auto";

        this.video_container = this.container.querySelector(".video-container");
        this.video_container.appendChild(this.video);

        this.video.addEventListener("timeupdate", this.update_seek_bar);
        this.video.addEventListener("progress", this.update_seek_bar);
        this.video_container.addEventListener("click", this.clicked_video);

        // In case we start PIP without playing first, switch the poster when PIP starts.
        this.video.addEventListener("enterpictureinpicture", (e) => { this.switch_poster_to_thumb(); });

        // True if we want to play if the window has focus.  We always pause when backgrounded.
        let args = helpers.args.location;
        this.want_playing = !args.state.paused;

        // True if the user is seeking.  We temporarily pause while seeking.  This is separate
        // from this.want_playing so we stay paused after seeking if we were paused at the start.
        this.seeking = false;
    }
    
    async load(media_id, {
        slideshow=false,
        onnextimage=null,
    }={})
    {
        this.unload();

        this.illust_data = await image_data.singleton().get_media_info(media_id);

        // Remove the old source, if any, and create a new one.
        if(this.source)
            this.source.remove();
        this.source = document.createElement("source");

        // Don't loop in slideshow.
        this.video.loop = !slideshow;
        this.video.onended = () => {
            if(onnextimage)
                onnextimage();
        };

        this.video.appendChild(this.source);

        // Set the video URLs.  
        this.video.poster = this.illust_data.mangaPages[0].urls.poster;
        this.source.src = this.illust_data.mangaPages[0].urls.original;
        this.update_seek_bar();

        // Sometimes mysteriously needing a separate load() call isn't isn't a sign of
        // good HTML element design.  Everything else just updates after you change it,
        // how did this go wrong?
        this.video.load();

        // Tell the video UI about the video.
        this.video_ui.video_changed({player: this, video: this.video});

        this.refresh_focus();
    }

    // Undo load().
    unload()
    {
        this.illust_data = null;

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
            this.video_ui.video_changed();
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

    // Replace the poster with the thumbnail if we enter PIP.  Chrome displays the poster
    // in the main window while PIP is active, and the thumbnail is better for that.  It's
    // low res, but Chrome blurs this image anyway.
    switch_poster_to_thumb()
    {
        if(this.illust_data != null)
            this.video.poster = this.illust_data.mangaPages[0].urls.small;
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
        case 32: // space
            e.stopPropagation();
            e.preventDefault();

            this.set_want_playing(!this.want_playing);

            return;

        case 36: // home
            e.stopPropagation();
            e.preventDefault();
            if(!this.video)
                return;

            this.video.currentTime = 0;
            return;

        case 35: // end
            e.stopPropagation();
            e.preventDefault();
            if(!this.video)
                return;

            this.pause();
            this.video.currentTime = this.video.duration;
            return;
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
        if(this.source == null)
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
                <div class=seek-bar-container-top></div>
                <div class=video-ui-strip>
                    <div class=play-button>
                        <span data-play=pause class="material-icons button" style="font-size: 36px;">pause</span>
                        <span data-play=play class="material-icons button" style="font-size: 36px;">play_arrow</span>
                    </div>

                    <div class=time></div>

                    <div style="flex: 1;"></div>

                    <div class="volume-slider button">
                        <div class=volume-line></div>
                    </div>

                    <span data-volume=high class="material-icons button" style="font-size: 36px; display: block; width: 40px;">volume_up</span>
                    <span data-volume=mute class="material-icons button" style="font-size: 36px; display: block; width: 40px;">volume_off</span>

                    <div class="pip-button button">
                        <span class="material-icons" style="font-size: 36px;">picture_in_picture_alt</span>
                    </div>
                    <div class="fullscreen button">
                        <ppixiv-inline src="resources/fullscreen.svg"></ppixiv-inline>
                    </div>
                </div>
                <div class=seek-bar-container-bottom></div>
            </div>
        `});

        // Set .dragging to stay visible during drags.
        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.container,
            callback: (e) => {
                helpers.set_class(this.container, "dragging", e.pressed);
            },
        });

        // Add the seek bar.  This moves between seek-bar-container-top and seek-bar-container-bottom.
        this.seek_bar = new seek_bar({
            container: this.container.querySelector(".seek-bar-container-top"),
            parent: this,
        });
        this.set_seek_bar_pos();

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
        document.addEventListener("fullscreenchange", (e) => {
            this.set_seek_bar_pos();
        });

        this.container.querySelector(".fullscreen").addEventListener("click", () => {
            helpers.toggle_fullscreen();
        });

        this.video_changed();
    }

    // Set whether the seek bar is above or below the video UI.
    set_seek_bar_pos()
    {
        let top = document.fullscreenElement == null;
        // Insert the seek bar into the correct container.
        this.seek_bar.container.remove();
        let seek_bar_container = top? ".seek-bar-container-top":".seek-bar-container-bottom";
        this.container.querySelector(seek_bar_container).appendChild(this.seek_bar.container);

        this.seek_bar.container.dataset.position = top? "top":"bottom";
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
