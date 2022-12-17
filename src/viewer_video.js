"use strict";

ppixiv.viewer_video_base = class extends ppixiv.viewer
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

        this.video_container = this.container.querySelector(".video-container");

        // Create the video UI.
        this.video_ui = new ppixiv.video_ui({
            container: this.container.querySelector(".video-ui-container"),
        });

        this.video_ui.seek_bar.set_current_time(0);
        this.video_ui.seek_bar.set_callback(this.seek_callback.bind(this));

        if(ppixiv.mobile)
        {
            // This seek bar is used for mobile seeking.  It's placed at the top of the screen, so
            // it's not obscured by the user's hand, and drags with a DragHandler similar to TouchScroller's
            // dragging.  seek_bar itself doesn't trigger seeks here.
            this.top_seek_bar = new seek_bar({
                container: this.container.querySelector(".top-seek-bar"),
            });
    
            this.seek_dragger = new ppixiv.DragHandler({
                name: "seek-dragger",
                element: this.container,
                defer_delay_ms: 30,
                ...this._signal,

                ondragstart: () => {
                    this.seek_callback(true, null);
                    this.drag_remainder = 0;
                    helpers.set_class(this.top_seek_bar.container, "dragging", true);
                    return true;
                },
                ondrag: ({movementX}) => {
                    let fraction = movementX / Math.min(window.innerWidth, window.innerHeight);

                    let current_time = this._current_time + this.drag_remainder;
                    let position = current_time / this._duration;
                    position += fraction;
                    position = helpers.clamp(position, 0, 1);

                    let new_position = position * this._duration;
                    this.seek_callback(true, new_position);

                    // The video player may round the position.  See how far from the requested position
                    // we ended up on, and apply it to the next drag, so drag inputs smaller than a frame
                    // aren't lost.
                    this.drag_remainder = new_position - this._current_time;
                },
                ondragend: () => {
                    helpers.set_class(this.top_seek_bar.container, "dragging", false);
                    this.seek_callback(false, null);
                },
            });
        }
    }

    async load()
    {
        let load_sentinel = this._load_sentinel = new Object();

        this.illust_data = await ppixiv.media_cache.get_media_info(this.media_id);

        return load_sentinel;
    }

    shutdown()
    {
        this.illust_data = null;

        // If this.load() is running, cancel it.
        this._load_sentinel = null;

        this.video.remove();
        this.video_ui.seek_bar.set_callback(null);

        super.shutdown();
    }

    refresh_focus()
    {
    }

    toggle_pause = (e) =>
    {
        this.set_want_playing(!this.want_playing);
        this.refresh_focus();
    }

    // This is called when the user interacts with the seek bar.
    seek_callback(pause, seconds)
    {
        this.seeking = pause;
    }

    set_seek_bar({current_time=null, duration=null, available=null}={})
    {
        if(current_time != null)
            this._current_time = current_time;
        if(duration != null)
            this._duration = duration;

        // If the seekable range changes during a drag, discard drag_remainder so we don't
        // snap into the newly loaded area on the next pointer movement.
        if(available != null)
            this.drag_remainder = null;

        for(let bar of [this.video_ui.seek_bar, this.top_seek_bar])
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

// A player for video files.
//
// This is only used for local files, since Pixiv doesn't have any video support.
// See viewer_ugoira for Pixiv's jank animation format.
//
// We don't show buffering.  This is only used for viewing local files.
ppixiv.viewer_video = class extends ppixiv.viewer_video_base
{
    constructor({...options})
    {
        super({...options});
        
        // Create a canvas to render into.
        this.video = document.createElement("video");
        this.video.loop = true;
        this.video.controls = false;
        this.video.preload = "auto";
        this.video.playsInline = true; // prevents iOS taking over the video on long press
        this.video.volume = settings.get("volume");
        this.video.muted = settings.get("mute");

        // Set the video inert to work around an iOS bug: after PIP is activated on a video and
        // then deactivated, the shadow controls for the "this video is playing in picture in
        // picture" still exist and continue to cancel pointer events forever.  We don't use inputs
        // directly on the video, so we can set it inert to prevent this from happening.
        this.video.inert = true;

        // Store changes to volume.
        this.video.addEventListener("volumechange", (e) => {
            settings.set("volume", this.video.volume);
            settings.set("mute", this.video.muted);
        });

        this.video.autoplay = true;
        this.video.className = "filtering";
        this.video.style.width = "100%";
        this.video.style.height = "100%";
        this.video.style.display = "block";

        this.video_container.appendChild(this.video);

        this.video.addEventListener("timeupdate", () => this.update_seek_bar());
        this.video.addEventListener("progress", () => this.update_seek_bar());

        // Clicking on mobile shows the menu, so use dblclick for pause.
        this.video_container.addEventListener(ppixiv.mobile? "dblclick":"click", this.toggle_pause);

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
        onnextimage=() => { },
    }={})
    {
        await super.load(media_id, { slideshow, onnextimage });

        // Remove the old source, if any, and create a new one.
        if(this.source)
            this.source.remove();
        this.source = document.createElement("source");

        // Don't loop in slideshow.
        this.video.loop = !slideshow;
        this.video.onended = () => {
            onnextimage(this);
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
        
        // We want to wait until something is displayed before firing this.ready, but
        // HTMLVideoElement doesn't give an event for that, and there's no event at
        // all to tell when the poster is loaded.  Decode the poster separately and
        // hope it completes at the same time as the video doing it, and also continue
        // on canplay.
        let img = document.createElement("img");
        img.src = this.video.poster;
        let decode = img.decode();
        let canplay = helpers.wait_for_event(this.video, "loadeddata");

        // Wait for at least one to complete.
        await Promise.any([canplay, decode]);

        this.ready.accept(true);

        this.refresh_focus();
    }

    shutdown()
    {
        super.shutdown();

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
        // Update the seek bar.
        let current_time = isNaN(this.video.currentTime)? 0:this.video.currentTime;
        let duration = isNaN(this.video.duration)? 1:this.video.duration;
        this.set_seek_bar({current_time, duration});
    }

    toggle_mute()
    {
        this.video.muted = !this.video.muted;
    }

    // This is sent manually by the UI handler so we can control focus better.
    onkeydown = (e) =>
    {
        if(this.video == null)
            return;

        if(e.code >= "Digit1" && e.code <= "Digit9")
        {
            // 5 sets the speed to default, 1234 slow the video down, and 6789 speed it up.
            e.stopPropagation();
            e.preventDefault();
            if(!this.video)
                return;

            var speed;
            switch(e.code)
            {
            case "Digit1": speed = 0.10; break;
            case "Digit2": speed = 0.25; break;
            case "Digit3": speed = 0.50; break;
            case "Digit4": speed = 0.75; break;
            case "Digit5": speed = 1.00; break;
            case "Digit6": speed = 1.25; break;
            case "Digit7": speed = 1.50; break;
            case "Digit8": speed = 1.75; break;
            case "Digit9": speed = 2.00; break;
            }

            this.video.playbackRate = speed;
            return;
        }

        switch(e.code)
        {
        case "KeyM":
            this.toggle_mute();
            break;
        case "Space":
            e.stopPropagation();
            e.preventDefault();
            this.set_want_playing(!this.want_playing);
            return;

        case "Home":
            e.stopPropagation();
            e.preventDefault();
            if(!this.video)
                return;

            this.video.currentTime = 0;
            return;

        case "End":
            e.stopPropagation();
            e.preventDefault();
            if(!this.video)
                return;

            this.pause();

            // This isn't completely reliable.  If we set the time to the very end, the video loops
            // immediately and we go to the beginning.  If we set it to duration - 0.000001, it gets
            // rounded and loops anyway, and if we set it to duration - 1 we end up too far.  It might
            // depend on the video framerate and need to be set to duration - 1 frame, but the HTML video
            // API is painfully incomplete and doesn't include any sort of frame info or frame stepping.
            // Try using a small-but-not-too-small value.
            this.video.currentTime = this.video.duration - 0.001;
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
            helpers.navigate(args, { add_to_history: false, cause: "updating-video-pause" });

            this.want_playing = value;
        }

        this.refresh_focus();
    }

    refresh_focus()
    {
        super.refresh_focus();

        if(this.source == null)
            return;

        let active = this.want_playing && !this.seeking && this._active;
        if(active)
            this.video.play(); 
        else
            this.video.pause(); 
    };

    // This is called when the user interacts with the seek bar.
    seek_callback(pause, seconds)
    {
        super.seek_callback(pause, seconds);

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
        ClassFlags.get.addEventListener("mobile-ui-visible", (e) => {
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
        this.seek_bar = new seek_bar({
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
                this.player.set_want_playing(!this.player.want_playing);
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
        let show_ui = ClassFlags.get.get("mobile-ui-visible");
        helpers.set_class(this.container, "show-ui", show_ui);
    }

    // Set whether the seek bar is above or below the video UI.
    set_seek_bar_pos()
    {
        // Insert the seek bar into the correct container.
        let top = ppixiv.mobile || !helpers.is_fullscreen();
        this.seek_bar.container.remove();
        let seek_bar_container = top? ".seek-bar-container-top":".seek-bar-container-bottom";
        this.container.querySelector(seek_bar_container).appendChild(this.seek_bar.container);

        this.seek_bar.container.dataset.position = top? "top":"bottom";
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
