"use strict";

this.ZipImagePlayer = class
{
    constructor(options)
    {
        this.op = options;
        this.loadingState = 0;
        this.dead = false;
        this.context = options.canvas.getContext("2d");
        this.files = {};
        this.frameCount = this.op.metadata.frames.length;
        this.frame = 0;
        this.loadFrame = 0;
        this.failed = false;

        // Make a list of timestamps for each frame.
        this.frameTimestamps = [];
        let milliseconds = 0;
        for(let frame of this.op.metadata.frames)
        {
            this.frameTimestamps.push(milliseconds);
            milliseconds += frame.delay;
        }

        this.frameImages = [];
        this.paused = false;
        this.startLoad();
        this.speed = 1;
        if(this.op.autoStart)
            this.play();
        else
            this.paused = true;
    }

    error(msg)
    {
        this.failed = true;
        throw Error("ZipImagePlayer error: " + msg);
    }

    async load()
    {
        // Use helpers.fetch_resource, so we share fetches with preloading.
        let response = helpers.fetch_resource(this.op.source, {
            onprogress: (e) => {
                if(!this.op.progress)
                    return;

                try {
                    this.op.progress(e.loaded / e.total);
                } catch(e) {
                    console.error(e);
                }
            }
        });
        response = await response;
        response = await response.arrayBuffer();
        
        if(this.dead)
            return;
        this.buf = response;

        let length = this.buf.byteLength;
        this.len = length;
        this.pHead = length;
        this.bytes = new Uint8Array(this.buf);
        this.findCentralDirectory();

        if(this.op.progress)
        {
            try {
                setTimeout(function() {
                    this.op.progress(null);
                }.bind(this), 0);
            } catch(e) {
                console.error(e);
            }
        }
    }

    startLoad()
    {
        if(!this.op.source) {
            // Unpacked mode (individiual frame URLs) - just load the frames.
            this.loadNextFrame();
            return;
        }
        this.load();
    }

    findCentralDirectory()
    {
        // No support for ZIP file comment
        let dv = new DataView(this.buf, this.len - 22, 22);
        if(dv.getUint32(0, true) != 0x06054b50)
            this.error("End of Central Directory signature not found");

        let count = dv.getUint16(10, true);
        let size = dv.getUint32(12, true);
        let offset = dv.getUint32(16, true);
        if(offset < this.pTail) {
            this.error("End central directory past end of file");
            return;
        }

        // Parse the central directory.
        dv = new DataView(this.buf, offset, size);
        let p = 0;
        for (let i = 0; i < count; i++ )
        {
            if(dv.getUint32(p, true) != 0x02014b50) {
                this.error("Invalid Central Directory signature");
            }
            let compMethod = dv.getUint16(p + 10, true);
            let uncompSize = dv.getUint32(p + 24, true);
            let nameLen = dv.getUint16(p + 28, true);
            let extraLen = dv.getUint16(p + 30, true);
            let cmtLen = dv.getUint16(p + 32, true);
            let off = dv.getUint32(p + 42, true);
            if(compMethod != 0)
                this.error("Unsupported compression method");

            p += 46;
            let nameView = new Uint8Array(this.buf, offset + p, nameLen);
            let name = "";
            for(let j = 0; j < nameLen; j++)
                name += String.fromCharCode(nameView[j]);

            p += nameLen + extraLen + cmtLen;
            this.files[name] = {off: off, len: uncompSize};
        }

        // Two outstanding fetches at any given time.
        // Note: the implementation does not support more than two.
        if(this.pHead < this.pTail) {
            this.error("Chunk past end of file");
            return;
        }

        this.pHead = this.len;
        this.loadNextFrame();
    }

    fileDataStart(offset)
    {
        let dv = new DataView(this.buf, offset, 30);
        let nameLen = dv.getUint16(26, true);
        let extraLen = dv.getUint16(28, true);
        return offset + 30 + nameLen + extraLen;
    }

    isFileAvailable(name)
    {
        let info = this.files[name];
        if(!info)
            this.error("File " + name + " not found in ZIP");

        if(this.pHead < (info.off + 30))
            return false;

        return this.pHead >= (this.fileDataStart(info.off) + info.len);
    }

    getFrameData(frame)
    {
        if(this.dead)
            return;

        if(frame >= this.frameCount)
            return null;

        let meta = this.op.metadata.frames[frame];
        if(!this.isFileAvailable(meta.file))
            return null;

        let off = this.fileDataStart(this.files[meta.file].off);
        let end = off + this.files[meta.file].len;
        let mime_type = this.op.metadata.mime_type || "image/png";
        if(this.buf.slice)
            return this.buf.slice(off, end);

        let slice = new ArrayBuffer(this.files[meta.file].len);
        let view = new Uint8Array(slice);
        view.set(this.bytes.subarray(off, end));
        return slice;
    }

    loadNextFrame()
    {
        if(this.dead)
            return;

        let frame = this.loadFrame;
        if(frame >= this.frameCount)
            return;

        let meta = this.op.metadata.frames[frame];
        if(!this.op.source) {
            // Unpacked mode (individiual frame URLs)
            this.loadFrame += 1;
            this.loadImage(frame, meta.file, false);
            return;
        }

        if(!this.isFileAvailable(meta.file))
            return;

        this.loadFrame += 1;
        let off = this.fileDataStart(this.files[meta.file].off);
        let end = off + this.files[meta.file].len;
        let mime_type = this.op.metadata.mime_type || "image/png";
        let slice = this.buf.slice(off, end);
        let blob = new Blob([slice], {type: mime_type});
        let url = URL.createObjectURL(blob);
        this.loadImage(frame, url, true);
    }

    loadImage(frame, url, isBlob)
    {
        let image = document.createElement("img");

        // "can't access dead object"
        let meta = this.op.metadata.frames[frame];
        image.addEventListener('load', () => {
            if(isBlob)
                URL.revokeObjectURL(url);

            if(this.dead)
                return;

            this.frameImages[frame] = image;
            if(this.loadingState == 0) {
                this.displayFrame();
            }
            if(frame >= (this.frameCount - 1)) {
                this.setLoadingState(2);
                this.buf = null;
                this.bytes = null;
            } else {
                this.loadNextFrame();
            }
        });

        image.src = url;
    }

    setLoadingState(state)
    {
        if(this.loadingState != state)
            this.loadingState = state;
    }

    displayFrame()
    {
        if(this.dead)
            return;

        let meta = this.op.metadata.frames[this.frame];
        let image = this.frameImages[this.frame];
        if(!image) {
            console.log("Image not available");
            this.setLoadingState(0);
            return;
        }

        if(this.loadingState != 2)
            this.setLoadingState(1);

        if(this.op.autosize) {
            if(this.context.canvas.width != image.width || this.context.canvas.height != image.height) {
                // make the canvas autosize itself according to the images drawn on it
                // should set it once, since we don't have variable sized frames
                this.context.canvas.width = image.width;
                this.context.canvas.height = image.height;
            }
        };
        this.drawn_frame = this.frame;
        this.context.clearRect(0, 0, this.op.canvas.width,
                                this.op.canvas.height);
        this.context.drawImage(image, 0, 0);

        // If the user wants to know when the frame is ready, call it.
        if(this.op.drew_frame)
        {
            try {
                setTimeout(function() {
                    this.op.drew_frame(null);
                }.bind(this), 0);
            } catch(e) {
                console.error(e);
            }
        }
        
        if(this.paused)
            return;
        this.pending_frame_metadata = meta;
        this.refreshTimer();
    }

    unsetTimer()
    {
        if(!this.timer)
            return;

        clearTimeout(this.timer);
        this.timer = null;
    }

    refreshTimer()
    {
        if(this.paused)
            return;

        this.unsetTimer();
        this.timer = setTimeout(this.nextFrame.bind(this), this.pending_frame_metadata.delay / this.speed);
    }

    getFrameDuration()
    {
        let meta = this.op.metadata.frames[this.frame];
        return meta.delay;
    }

    getFrameNoDuration(frame)
    {
        let meta = this.op.metadata.frames[frame];
        return meta.delay;
    }

    nextFrame(frame)
    {
        this.timer = null;

        if(this.frame >= (this.frameCount - 1)) {
            if(!this.op.loop) {
                this.pause();
                return;
            }

            this.frame = 0;
        } else {
            this.frame += 1;
        }
        this.displayFrame();
    }

    play()
    {
        if(this.dead)
            return;

        if(this.paused) {
            this.paused = false;
            this.displayFrame();
        }
    }

    pause()
    {
        if(this.dead)
            return;

        if(!this.paused) {
            this.unsetTimer();
            this.paused = true;
        }
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
        this.unsetTimer();
        this.displayFrame();
    }

    setSpeed(value)
    {
        this.speed = value;

        // Refresh the timer, so we don't wait a long time if we're changing from a very slow
        // playback speed.
        this.refreshTimer();
    }

    stop()
    {
        this.dead = true;
        this.unsetTimer();
        this.frameImages = null;
        this.buf = null;
        this.bytes = null;
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
        this.displayFrame();
    }

    getTotalDuration()
    {
        let last_frame = this.op.metadata.frames.length - 1;
        return this.frameTimestamps[last_frame] / 1000;
    }

    getCurrentFrameTime()
    {
        return this.frameTimestamps[this.frame] / 1000;
    }

    // Set the video to the closest frame to the given time.
    setCurrentFrameTime(seconds)
    {
        // We don't actually need to check all frames, but there's no need to optimize this.
        let closest_frame = null;
        let closest_error = null;
        for(let frame = 0; frame < this.op.metadata.frames.length; ++frame)
        {
            let error = Math.abs(seconds - this.frameTimestamps[frame]/1000);
            if(closest_frame == null || error < closest_error)
            {
                closest_frame = frame;
                closest_error = error;
            }
        }

        this.frame = closest_frame;
        this.displayFrame();
    }
    getLoadedFrames() { return this.frameImages.length; }
    getFrameCount() { return this.frameCount; }
    hasError() { return this.failed; }
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
