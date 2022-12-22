import ViewerVideoBase from 'vview/viewer/video/viewer-video-base.js';
import ZipImagePlayer from 'vview/widgets/zip-image-player.js';
import { helpers } from 'vview/misc/helpers.js';

export default class ViewerUgoira extends ViewerVideoBase
{
    constructor({...options})
    {
        super({...options});
        
        // Create a canvas to render into.
        this.video = document.createElement("canvas");
        this.video.hidden = true;
        this.video.className = "filtering";
        this.video.style.width = "100%";
        this.video.style.height = "100%";
        this.video.style.objectFit = "contain";
        this.videoContainer.appendChild(this.video);

        this.video.addEventListener(ppixiv.mobile? "dblclick":"click", this.togglePause);

        // True if we want to play if the window has focus.  We always pause when backgrounded.
        let args = helpers.args.location;
        this.wantPlaying = !args.state.paused;

        // True if the user is seeking.  We temporarily pause while seeking.  This is separate
        // from this.wantPlaying so we stay paused after seeking if we were paused at the start.
        this.seeking = false;

        window.addEventListener("visibilitychange", this.refreshFocus.bind(this), { signal: this.shutdownSignal.signal });
    }

    async load()
    {
        // Show a static image while we're waiting for the video to load, like ViewerImages.
        //
        // Pixiv gives us two usable images: the search thumbnail (previewUrls[0] + urls.small),
        // and urls.original, which is a full-size frame of the first frame.  We'll show the
        // thumbnail immediately if we have early illust data to avoid flickering a black screen,
        // then switch to urls.original once we have it to get away from the blurry thumbnail.
        //
        // Vview has two types of image for videos: thumbs (urls.small) and posters (urls.poster).
        // The thumbnail is a few seconds into the video to avoid completely black thumbs, so we
        // don't want to use it here.  Only use the poster image, so it matches up with the start
        // of the video.
        //
        // First, show the thumbnail if we're on Pixiv:
        let local = helpers.isMediaIdLocal(this.mediaId);
        if(!local)
        {
            // Load early data to show the low-res preview quickly.  This is a simpler version of
            // what ViewerImages does.
            let loadSentinel = this._loadSentinel = new Object();
            let partialMediaInfo = await ppixiv.mediaCache.getMediaInfo(this.mediaId, { full: false });
            if(loadSentinel !== this._loadSentinel)
                return;
            this._createPreviewImages(partialMediaInfo.previewUrls[0], null);
        }

        // Fire this.ready when either preview finishes loading.
        helpers.waitForAnyImageLoad([this.previewImage1, this.previewImage2]).then(() => this.ready.accept(true));

        // Load full data.
        let { slideshow=false, onnextimage=null } = this.options;
        let loadSentinel = await super.load(this.mediaId, {
            slideshow,
            onnextimage: () => onnextimage(this),
        });
        if(loadSentinel !== this._loadSentinel)
            return;

        // Now show the poster if we're local, or change to the original image on Pixiv.
        if(local)
            this._createPreviewImages(this.mediaInfo.urls.poster, null);
        else
            this._createPreviewImages(this.mediaInfo.previewUrls[0], this.mediaInfo.urls.original);

        // This can be used to abort ZipImagePlayer's download.
        this.abortController = new AbortController;

        let source = null;
        if(local)
        {
            // The local API returns a separate path for these, since it doesn't have
            // illust_data.ugoiraMetadata.
            source = this.mediaInfo.mangaPages[0].urls.mjpeg_zip;
        }
        else
        {
            source = this.mediaInfo.ugoiraMetadata.originalSrc;
        }

        // Create the player.
        this.player = new ZipImagePlayer({
            metadata: this.mediaInfo.ugoiraMetadata,
            autoStart: false,
            source: source,
            local: local,
            mime_type: this.mediaInfo.ugoiraMetadata?.mime_type,
            signal: this.abortController.signal,
            autosize: true,
            canvas: this.video,
            loop: !slideshow,
            progress: this.progress,
            onfinished: () => onnextimage(this),
        });            

        this.player.videoInterface.addEventListener("timeupdate", this.ontimeupdate, { signal: this.abortController.signal });

        this.videoUi.videoChanged({player: this, video: this.player.videoInterface});

        this.refreshFocus();
    }

    shutdown()
    {
        super.shutdown();

        // Cancel the player's download and remove event listeners.
        if(this.abortController)
        {
            this.abortController.abort();
            this.abortController = null;
        }

        // Send a finished progress callback if we were still loading.
        this.progress(null);

        this.video.hidden = true;

        if(this.player)
        {
            this.player.pause(); 
            this.player = null;
        }

        if(this.previewImage1)
        {
            this.previewImage1.remove();
            this.previewImage1 = null;
        }
        if(this.previewImage2)
        {
            this.previewImage2.remove();
            this.previewImage2 = null;
        }
    }

    async _createPreviewImages(url1, url2)
    {
        if(this.previewImage1)
        {
            this.previewImage1.remove();
            this.previewImage1 = null;
        }

        if(this.previewImage2)
        {
            this.previewImage2.remove();
            this.previewImage2 = null;
        }
        
        // Create an image to display the static image while we load.
        //
        // Like static image viewing, load the thumbnail, then the main image on top, since
        // the thumbnail will often be visible immediately.
        if(url1)
        {
            let img1 = document.createElement("img");
            img1.classList.add("low-res-preview");
            img1.style.position = "absolute";
            img1.style.width = "100%";
            img1.style.height = "100%";
            img1.style.objectFit = "contain";
            img1.src = url1;
            this.videoContainer.appendChild(img1);
            this.previewImage1 = img1;

            // Allow clicking the previews too, so if you click to pause the video before it has enough
            // data to start playing, it'll still toggle to paused.
            img1.addEventListener(ppixiv.mobile? "dblclick":"click", this.togglePause);
        }

        if(url2)
        {
            let img2 = document.createElement("img");
            img2.style.position = "absolute";
            img2.className = "filtering";
            img2.style.width = "100%";
            img2.style.height = "100%";
            img2.style.objectFit = "contain";
            img2.src = url2;
            this.videoContainer.appendChild(img2);
            img2.addEventListener(ppixiv.mobile? "dblclick":"click", this.togglePause);
            this.previewImage2 = img2;

            // Wait for the high-res image to finish loading.
            let img1 = this.previewImage1;
            helpers.waitForImageLoad(img2).then(() => {
                // Remove the low-res preview image when the high-res one finishes loading.
                img1.remove();
            });
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

    progress = (available) =>
    {
        available ??= 1;
        this.setSeekBar({available});
    }

    // Once we draw a frame, hide the preview and show the canvas.  This avoids
    // flicker when the first frame is drawn.
    ontimeupdate = () =>
    {
        if(this.previewImage1)
            this.previewImage1.hidden = true;
        if(this.previewImage2)
            this.previewImage2.hidden = true;
        this.video.hidden = false;

        this.updateSeekBar();
    }

    updateSeekBar()
    {
        // Update the seek bar.
        let currentTime = this.player.getCurrentFrameTime();
        let duration = this.player.getSeekableDuration();
        this.setSeekBar({currentTime, duration});
    }

    // This is sent manually by the UI handler so we can control focus better.
    onkeydown = (e) =>
    {
        if(e.code >= "Digit1" && e.code <= "Digit9")
        {
            // 5 sets the speed to default, 1234 slow the video down, and 6789 speed it up.
            e.stopPropagation();
            e.preventDefault();
            if(!this.player)
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

            this.player.setSpeed(speed);
            return;
        }

        switch(e.code)
        {
        case "Space":
            e.stopPropagation();
            e.preventDefault();

            this.setWantPlaying(!this.wantPlaying);

            return;
        case "Home":
            e.stopPropagation();
            e.preventDefault();
            if(!this.player)
                return;

            this.player.rewind();
            return;

        case "End":
            e.stopPropagation();
            e.preventDefault();
            if(!this.player)
                return;

            this.pause();
            this.player.setCurrentFrame(this.player.getFrameCount() - 1);
            return;

        case "KeyQ":
        case "KeyW":
            e.stopPropagation();
            e.preventDefault();
            if(!this.player)
                return;

            this.pause();
            let currentFrame = this.player.getCurrentFrame();
            let next = e.code == "KeyW";
            let newFrame = currentFrame + (next?+1:-1);
            this.player.setCurrentFrame(newFrame);
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

        if(this.player == null)
            return;

        let active = this.wantPlaying && !this.seeking && !window.document.hidden && this._active;
        if(active)
            this.player.play(); 
        else
            this.player.pause(); 
    };

    // This is called when the user interacts with the seek bar.
    seekCallback(pause, seconds)
    {
        super.seekCallback(pause, seconds);

        this.refreshFocus();

        if(seconds != null)
            this.player.setCurrentFrameTime(seconds);
    };
}

