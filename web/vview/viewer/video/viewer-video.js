import ViewerVideoBase from 'vview/viewer/video/viewer-video-base.js';
import { helpers } from 'vview/misc/helpers.js';

// A player for video files.
//
// This is only used for local files, since Pixiv doesn't have any video support.
// See ViewerUgoira for Pixiv's jank animation format.
//
// We don't show buffering.  This is only used for viewing local files.
export default class ViewerVideo extends ViewerVideoBase
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

        this.videoContainer.appendChild(this.video);

        this.video.addEventListener("timeupdate", () => this.updateSeekBar());
        this.video.addEventListener("progress", () => this.updateSeekBar());

        // Clicking on mobile shows the menu, so use dblclick for pause.
        this.videoContainer.addEventListener(ppixiv.mobile? "dblclick":"click", this.togglePause);

        // In case we start PIP without playing first, switch the poster when PIP starts.
        this.video.addEventListener("enterpictureinpicture", (e) => { this._switchPosterToThumb(); });

        // True if we want to play if the window has focus.  We always pause when backgrounded.
        let args = helpers.args.location;
        this.wantPlaying = !args.state.paused;

        // True if the user is seeking.  We temporarily pause while seeking.  This is separate
        // from this.wantPlaying so we stay paused after seeking if we were paused at the start.
        this.seeking = false;
    }
    
    async load(mediaId, {
        slideshow=false,
        onnextimage=() => { },
    }={})
    {
        await super.load(mediaId, { slideshow, onnextimage });

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
        this.video.poster = this.mediaInfo.mangaPages[0].urls.poster;
        this.source.src = this.mediaInfo.mangaPages[0].urls.original;
        this.updateSeekBar();

        // Sometimes mysteriously needing a separate load() call isn't isn't a sign of
        // good HTML element design.  Everything else just updates after you change it,
        // how did this go wrong?
        this.video.load();

        // Tell the video UI about the video.
        this.videoUi.videoChanged({player: this, video: this.video});
        
        // We want to wait until something is displayed before firing this.ready, but
        // HTMLVideoElement doesn't give an event for that, and there's no event at
        // all to tell when the poster is loaded.  Decode the poster separately and
        // hope it completes at the same time as the video doing it, and also continue
        // on canplay.
        let img = document.createElement("img");
        img.src = this.video.poster;
        let decode = img.decode();
        let canplay = helpers.other.waitForEvent(this.video, "loadeddata");

        // Wait for at least one to complete.
        await Promise.any([canplay, decode]);

        this.ready.accept(true);

        this.refreshFocus();
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
        this.refreshFocus();
    }

    // Replace the poster with the thumbnail if we enter PIP.  Chrome displays the poster
    // in the main window while PIP is active, and the thumbnail is better for that.  It's
    // low res, but Chrome blurs this image anyway.
    _switchPosterToThumb()
    {
        if(this.mediaInfo != null)
            this.video.poster = this.mediaInfo.mangaPages[0].urls.small;
    }

    updateSeekBar()
    {
        // Update the seek bar.
        let currentTime = isNaN(this.video.currentTime)? 0:this.video.currentTime;
        let duration = isNaN(this.video.duration)? 1:this.video.duration;
        this.setSeekBar({currentTime, duration});
    }

    toggleMute()
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

            let speed;
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
            this.toggleMute();
            break;
        case "Space":
            e.stopPropagation();
            e.preventDefault();
            this.setWantPlaying(!this.wantPlaying);
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
        this.setWantPlaying(true);
    }

    pause()
    {
        this.setWantPlaying(false);
    }

    // Set whether the user wants the video to be playing or paused.
    setWantPlaying(value)
    {
        if(this.wantPlaying != value)
        {
            // Store the play/pause state in history, so if we navigate out and back in while
            // paused, we'll stay paused.
            let args = helpers.args.location;
            args.state.paused = !value;
            helpers.navigate(args, { addToHistory: false, cause: "updating-video-pause" });

            this.wantPlaying = value;
        }

        this.refreshFocus();
    }

    refreshFocus()
    {
        super.refreshFocus();

        if(this.source == null)
            return;

        let active = this.wantPlaying && !this.seeking && this._active;
        if(active)
            this.video.play(); 
        else
            this.video.pause(); 
    };

    // This is called when the user interacts with the seek bar.
    seekCallback(pause, seconds)
    {
        super.seekCallback(pause, seconds);

        this.refreshFocus();

        if(seconds != null)
        {
            this.video.currentTime = seconds;
            this.updateSeekBar();
            this.videoUi.timeChanged();
        }
    };
}
