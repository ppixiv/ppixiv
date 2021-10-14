"use strict";

ppixiv.viewer_ugoira = class extends ppixiv.viewer
{
    constructor(container, illust_data, seek_bar, options)
    {
        super(container, illust_data);
        
        console.log("create player:", illust_data.illustId);

        this.refresh_focus = this.refresh_focus.bind(this);
        this.clicked_canvas = this.clicked_canvas.bind(this);
        this.onkeydown = this.onkeydown.bind(this);
        this.drew_frame = this.drew_frame.bind(this);
        this.progress = this.progress.bind(this);
        this.seek_callback = this.seek_callback.bind(this);

        this.container = container;
        this.options = options;

        this.seek_bar = seek_bar;
        this.seek_bar.set_current_time(0);
        this.seek_bar.set_callback(this.seek_callback);

        // Create an image to display the static image while we load.
        //
        // Like static image viewing, load the thumbnail, then the main image on top, since
        // the thumbnail will often be visible immediately.
        this.preview_img1 = document.createElement("img");
        this.preview_img1.classList.add("low-res-preview");
        this.preview_img1.style.position = "absolute";
        this.preview_img1.style.width = "100%";
        this.preview_img1.style.height = "100%";
        this.preview_img1.style.objectFit = "contain";
        this.preview_img1.src = illust_data.urls.small;
        this.container.appendChild(this.preview_img1);

        this.preview_img2 = document.createElement("img");
        this.preview_img2.style.position = "absolute";
        this.preview_img2.className = "filtering";
        this.preview_img2.style.width = "100%";
        this.preview_img2.style.height = "100%";
        this.preview_img2.style.objectFit = "contain";
        this.preview_img2.src = illust_data.urls.original;
        this.container.appendChild(this.preview_img2);

        // Remove the low-res preview image when the high-res one finishes loading.
        this.preview_img2.addEventListener("load", (e) => {
            this.preview_img1.remove();
        });
        
        // Create a canvas to render into.
        this.canvas = document.createElement("canvas");
        this.canvas.hidden = true;
        this.canvas.className = "filtering";
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.style.objectFit = "contain";
        this.container.appendChild(this.canvas);

        this.canvas.addEventListener("click", this.clicked_canvas, false);

        // Allow clicking the previews too, so if you click to pause the video before it has enough
        // data to start playing, it'll still toggle to paused.
        this.preview_img1.addEventListener("click", this.clicked_canvas, false);
        this.preview_img2.addEventListener("click", this.clicked_canvas, false);

        // True if we want to play if the window has focus.  We always pause when backgrounded.
        this.want_playing = true;

        // True if the user is seeking.  We temporarily pause while seeking.  This is separate
        // from this.want_playing so we stay paused after seeking if we were paused at the start.
        this.seeking = false;

        window.addEventListener("visibilitychange", this.refresh_focus);

        // This can be used to abort ZipImagePlayer's download.
        this.abort_controller = new AbortController;

        // Create the player.
        this.player = new ZipImagePlayer({
            metadata: illust_data.ugoiraMetadata,
            autoStart: false,
            source: illust_data.ugoiraMetadata.originalSrc,
            mime_type: illust_data.ugoiraMetadata.mime_type,
            signal: this.abort_controller.signal,
            autosize: true,
            canvas: this.canvas,
            loop: true,
            debug: false,
            progress: this.progress,
            drew_frame: this.drew_frame,
        });            

        this.refresh_focus();
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

    progress(value)
    {
        if(this.options.progress_bar)
            this.options.progress_bar.set(value);

        if(value == null)
        {
            // Once we send "finished", don't make any more progress calls.
            this.options.progress_bar = null;
        }
    }

    // Once we draw a frame, hide the preview and show the canvas.  This avoids
    // flicker when the first frame is drawn.
    drew_frame()
    {
        this.preview_img1.hidden = true;
        this.preview_img2.hidden = true;
        this.canvas.hidden = false;

        if(this.seek_bar)
        {
            // Update the seek bar.
            var frame_time = this.player.get_current_frame_time();
            this.seek_bar.set_current_time(this.player.get_current_frame_time());
            this.seek_bar.set_duration(this.player.get_seekable_duration());
        }
    }

    // This is sent manually by the UI handler so we can control focus better.
    onkeydown(e)
    {
        if(e.keyCode >= 49 && e.keyCode <= 57)
        {
            // 5 sets the speed to default, 1234 slow the video down, and 6789 speed it up.
            e.stopPropagation();
            e.preventDefault();
            if(!this.player)
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

            this.player.set_speed(speed);
            return;
        }

        switch(e.keyCode)
        {
        case 32: // space
            e.stopPropagation();
            e.preventDefault();

            this.want_playing = !this.want_playing;
            this.refresh_focus();

            return;
        case 36: // home
            e.stopPropagation();
            e.preventDefault();
            if(!this.player)
                return;

            this.player.rewind();
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
            var total_frames = this.player.get_frame_count();
            var current_frame = this.player.get_current_frame();
            var next = e.keyCode == 87;
            var new_frame = current_frame + (next?+1:-1);
            this.player.set_current_frame(new_frame);
            return;
        }
    }

    play()
    {
        this.want_playing = true;
        this.refresh_focus();
    }

    pause()
    {
        this.want_playing = false;
        this.refresh_focus();
    }

    shutdown()
    {
        this.finished = true;

        // Cancel the player's download.
        this.abort_controller.abort();

        if(this.seek_bar)
        {
            this.seek_bar.set_callback(null);
            this.seek_bar = null;
        }

        window.removeEventListener("visibilitychange", this.refresh_focus);

        // Send a finished progress callback if we were still loading.  We won't
        // send any progress calls after this (though the ZipImagePlayer will finish
        // downloading the file anyway).
        this.progress(null);

        if(this.player)
            this.player.pause(); 
        this.preview_img1.remove();
        this.preview_img2.remove();
        this.canvas.remove();
    }

    refresh_focus()
    {
        if(this.player == null)
            return;

        let active = this.want_playing && !this.seeking && !window.document.hidden && this._active;
        if(active)
            this.player.play(); 
        else
            this.player.pause(); 
    };

    clicked_canvas(e)
    {
        this.want_playing = !this.want_playing;
        this.refresh_focus();
    }

    // This is called when the user interacts with the seek bar.
    seek_callback(pause, seconds)
    {
        this.seeking = pause;
        this.refresh_focus();

        if(seconds != null)
            this.player.set_current_frame_time(seconds);
    };
}

