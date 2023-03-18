import { helpers } from 'vview/misc/helpers.js';
import ZipImageDownloader from 'vview/misc/zip-image-downloader.js';

// This gives a small subset of HTMLVideoPlayer's API to control the video, so
// VideoUI can work with this in the same way as a regular video.
class ZipVideoInterface extends EventTarget
{
    constructor(player)
    {
        super();
        this.player = player;
    }

    get paused() { return this.player.paused; }

    get duration()
    {
        // Expose the seekable duration rather than the full duration, since it looks
        // weird if you seek to the end of the seek bar and the time isn't at the end.
        //
        // Some crazy person decided to use NaN as a sentinel for unknown duration instead
        // of null, so mimic that.
        let result = this.player.getSeekableDuration();
        if(result == null)
            return NaN;
        else
            return result;
    }

    get currentTime() { return this.player.getCurrentFrameTime(); }
    play() { return this.player.play(); }
    pause() { return this.player.pause(); }
    hideAudioControls() { return true; }
}

export default class ZipImagePlayer
{
    constructor(options)
    {
        this.op = options;
        this.interface = new ZipVideoInterface(this);

        // If true, continue playback when we get more data.
        this.waitingForFrame = true;

        this.dead = false;
        this.context = options.canvas.getContext("2d");

        // The frame that we want to be displaying:
        this.frame = 0;
        this.failed = false;

        // These aren't available until load() completes.
        this.frameTimestamps = [];
        this.totalLength = 0;
        this.frameCount = 0;
        this.seekableLength = null;

        this.frameData = [];
        this.frameImages = [];
        this.speed = 1;
        this.paused = !this.op.autoStart;

        this.load();
    }

    error(msg)
    {
        this.failed = true;
        throw Error("ZipImagePlayer error: " + msg);
    }

    async load()
    {
        this.downloader = new ZipImageDownloader(this.op.source, {
            signal: this.op.signal,
        });

        if(this.op.local)
        {
            // For local files, the first file in the ZIP contains the metadata.
            let data;
            try {
                data = await this.downloader.getNextFrame();
            } catch(e) {
                // This will usually be cancellation.
                console.info("Error downloading file", e);
                return;
            }

            // Is there really no "decode databuffer to string with encoding" API?
            data = new Uint8Array(data);
            data = String.fromCharCode.apply(null, data);
            data = JSON.parse(data);

            this.frameMetadata = data;
        }
        else
        {
            this.frameMetadata = this.op.metadata.frames;
        }

        // Make a list of timestamps for each frame.
        this.frameTimestamps = [];
        let milliseconds = 0;
        let lastFrameTime = 0;
        for(let frame of this.frameMetadata)
        {
            this.frameTimestamps.push(milliseconds);
            milliseconds += frame.delay;
            lastFrameTime = frame.delay;
        }
        this.totalLength = milliseconds;
        this.frameCount = this.frameMetadata.length;

        // The duration to display on the seek bar.  This doesn't include the duration of the
        // final frame.  We can't seek to the actual end of the video past the end of the last
        // frame, and the end of the seek bar represents the beginning of the last frame.
        this.seekableLength = milliseconds - lastFrameTime;

        let frame = 0;
        while(1)
        {
            let file;
            try {
                file = await this.downloader.getNextFrame();
            } catch(e) {
                // This will usually be cancellation.
                if(e.name != "AbortError")
                    console.info("Error downloading file", e);
                return;
            }

            if(file == null)
                break;

            // Read the frame data into a blob and store it.
            //
            // Don't decode it just yet.  We'll decode it the first time it's displayed.  This way,
            // we read the file as it comes in, but we won't burst decode every frame right at the
            // start.  This is important if the video ZIP is coming out of cache, since the browser
            // can't cache the image decodes and we'll cause a big burst of CPU load.
            let mimeType = this.op.metadata?.mime_type || "image/jpeg";
            let blob = new Blob([file], {type: mimeType});
            this.frameData.push(blob);

            // Call progress.  This is relative to frame timestamps, so load progress lines up
            // with the seek bar.
            if(this.op.progress)
            {
                let progress = this.frameTimestamps[frame] / this.totalLength;
                this.op.progress(progress);
            }

            frame++;

            // We have more data to potentially decode, so start _decodeFrames if it's not already running.
            this._decodeFrames();

            // Throttle decoding in case we're getting video data very quickly, so if we get the whole
            // file at once from cache or a local server we don't chew CPU decoding it all at once.  If
            // the data is streaming from a server, this small delay won't have any effect.
            await helpers.other.sleep(1);
        }

        // Call completion.
        if(this.op.progress)
            this.op.progress(null);
    }

    // Load the next frame into this.frameImages.
    async _decodeFrames()
    {
        // If this is already running, don't start another.
        if(this.loadingFrames)
            return;

        try {
            this.loadingFrames = true;
            while(await this._decodeOneFrame())
            {
            }
        } finally {
            this.loadingFrames = false;
        }
    }

    // Decode up to one frame ahead of this.frame, so we don't wait until we need a
    // frame to start decoding it.  Return true if we decoded a frame and should be
    // called again to see if we can decode another.
    async _decodeOneFrame()
    {
        let ahead = 0;
        for(ahead = 0; ahead < 2; ++ahead)
        {
            let frame = this.frame + ahead;

            // Stop if we don't have data for this frame.  If we don't have this frame, we won't
            // have any after either.
            let blob = this.frameData[frame];
            if(blob == null)
                return;

            // Skip this frame if it's already decoded.
            if(this.frameImages[frame])
                continue;

            let url = URL.createObjectURL(blob);
            let image = document.createElement("img");
            image.src = url;

            await helpers.other.waitForImageLoad(image);

            URL.revokeObjectURL(url);

            this.frameImages[frame] = image;

            // If we were stalled waiting for data, display the frame.  It's possible the frame
            // changed while we were blocking and we won't actually have the new frame, but we'll
            // just notice and turn waitingForFrame back on.
            if(this.waitingForFrame) 
            {
                this.waitingForFrame = false;
                this._displayFrame();
            }

            if(this.dead)
                return false;

            return true;
        }

        return false;
    }

    async _displayFrame()
    {
        if(this.dead)
            return;

        this._decodeFrames();

        // If we don't have the frame yet, just record that we want to be called when the
        // frame is decoded and stop.  _decodeFrames will call us when there's a frame to display.
        if(!this.frameImages[this.frame])
        {
            // We haven't downloaded this far yet.  Show the frame when we get it.
            this.waitingForFrame = true;
            return;
        }

        let image = this.frameImages[this.frame];

        if(this.op.autosize) {
            if(this.context.canvas.width != image.width || this.context.canvas.height != image.height) {
                // make the canvas autosize itself according to the images drawn on it
                // should set it once, since we don't have variable sized frames
                this.context.canvas.width = image.width;
                this.context.canvas.height = image.height;
            }
        };
        this.drawnFrame = this.frame;
        this.context.clearRect(0, 0, this.op.canvas.width, this.op.canvas.height);
        this.context.drawImage(image, 0, 0);

        this.videoInterface.dispatchEvent(new Event("timeupdate"));

        if(this.paused)
            return;

        let meta = this.frameMetadata[this.frame];
        this.pendingFrameMetadata = meta;
        this._refreshTimer();
    }

    _unsetTimer()
    {
        if(!this.timer)
            return;

        realClearTimeout(this.timer);
        this.timer = null;
    }

    _refreshTimer()
    {
        if(this.paused)
            return;

        this._unsetTimer();
        this.timer = realSetTimeout(this._nextFrame, this.pendingFrameMetadata.delay / this.speed);
    }

    _getFrameDuration()
    {
        let meta = this.frameMetadata[this.frame];
        return meta.delay;
    }

    _nextFrame = (frame) =>
    {
        this.timer = null;

        if(this.frame >= (this.frameCount - 1)) {
            if(!this.op.loop) {
                this.pause();
                if(this.op.onfinished)
                    this.op.onfinished();
                return;
            }

            this.frame = 0;
        } else {
            this.frame += 1;
        }
        this._displayFrame();
    }

    play()
    {
        if(this.dead)
            return;

        if(this.paused) {
            this.paused = false;
            this._displayFrame();

            this.videoInterface.dispatchEvent(new Event("play"));
        }
    }

    pause()
    {
        if(this.dead)
            return;

        if(!this.paused) {
            this._unsetTimer();
            this.paused = true;

            this.videoInterface.dispatchEvent(new Event("pause"));
        }
    }

    _setPause(value)
    {
        if(this.dead)
            return;
        if(this.paused = value)
            return;

        this.context.canvas.paused = this.paused;
        this.paused = value;
    }

    get videoInterface()
    {
        return this.interface;
    }

    togglePause()
    {
        if(this.paused)
            this.play();
        else
            this.pause();
    }

    rewind()
    {
        if(this.dead)
            return;

        this.frame = 0;
        this._unsetTimer();
        this._displayFrame();
    }

    setSpeed(value)
    {
        this.speed = value;

        // Refresh the timer, so we don't wait a long time if we're changing from a very slow
        // playback speed.
        this._refreshTimer();
    }

    stop()
    {
        this.dead = true;
        this._unsetTimer();
        this.frameImages = null;
    }

    getCurrentFrame()
    {
        return this.frame;
    }

    setCurrentFrame(frame)
    {
        frame %= this.frameCount;
        if(frame < 0)
            frame += this.frameCount;
        this.frame = frame;
        this._displayFrame();
    }

    getTotalDuration()
    {
        return this.totalLength / 1000;
    }

    getSeekableDuration()
    {
        if(this.seekableLength == null)
            return null;
        else
            return this.seekableLength / 1000;
    }

    getCurrentFrameTime()
    {
        let timestamp = this.frameTimestamps[this.frame];
        return timestamp == null? null: timestamp / 1000;
    }

    // Set the video to the closest frame to the given time.
    setCurrentFrameTime(seconds)
    {
        // We don't actually need to check all frames, but there's no need to optimize this.
        let closestFrame = null;
        let closestError = null;
        for(let frame = 0; frame < this.frameMetadata.length; ++frame)
        {
            // Only seek to images that we've downloaded.  If we reach a frame we don't have
            // yet, stop.
            if(!this.frameData[frame])
                break;

            let error = Math.abs(seconds - this.frameTimestamps[frame]/1000);
            if(closestFrame == null || error < closestError)
            {
                closestFrame = frame;
                closestError = error;
            }
        }

        this.frame = closestFrame;
        this._displayFrame();
    }

    getFrameCount() { return this.frameCount; }
}

/*
 * The MIT License (MIT)
 * 
 * Copyright (c) 2014 Pixiv Inc.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
*/
