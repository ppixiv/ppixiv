"use strict";

// A wrapper for the clunky ReadableStream API that lets us do at basic
// thing that API forgot about: read a given number of bytes at a time.
ppixiv.IncrementalReader = class
{
    constructor(reader, options={})
    {
        this.reader = reader;
        this.position = 0;

        // Check if this is an ArrayBuffer.  "reader instanceof ArrayBuffer" is
        // broken in Firefox (but what isn't?).
        if("byteLength" in reader)
        {
            this.input_buffer = new Int8Array(reader);
            this.input_buffer_finished = true;
        }
        else
        {
            this.input_buffer = new Int8Array(0);
            this.input_buffer_finished = false;
        }

        // If set, this is called with the current read position as we read data.
        this.onprogress = options.onprogress;
    }

    async read(bytes)
    {
        let buffer = new ArrayBuffer(bytes);

        let result = new Int8Array(buffer);
        let output_pos = 0;

        while(output_pos < bytes)
        {
            // See if we have leftover data in this.input_buffer.
            if(this.input_buffer.byteLength > 0)
            {
                // Create a view of the bytes we want to copy, then use set() to copy them to the
                // output.  This is just memcpy(), why can't you just set(buf, srcPos, srcLen, dstPos)?
                let copy_bytes = Math.min(bytes-output_pos, this.input_buffer.byteLength);
                let buf = new Int8Array(this.input_buffer.buffer, this.input_buffer.byteOffset, copy_bytes);
                result.set(buf, output_pos);
                output_pos += copy_bytes;

                // Remove the data we read from the buffer.  This is just making the view smaller.
                this.input_buffer = new Int8Array(this.input_buffer.buffer, this.input_buffer.byteOffset + copy_bytes);

                continue;
            }

            // If we need more data and there isn't any, we've passed EOF.
            if(this.input_buffer_finished)
                throw new Error("Incomplete file");

            let { value, done } = await this.reader.read();
            if(value == null)
                value = new Int8Array(0);

            this.input_buffer_finished = done;
            this.input_buffer = value;
            if(value)
                this.position += value.length;

            if(this.onprogress)
                this.onprogress(this.position);
        };

        return buffer;
    }
};

// Download a ZIP, returning files as they download in the order they're stored
// in the ZIP.
ppixiv.ZipImageDownloader = class
{
    constructor(url, options={})
    {
        this.url = url;

        // An optional AbortSignal.
        this.signal = options.signal;
        this.onprogress = options.onprogress;

        this.start_promise = this.start();
    }

    async start()
    {
        let response = await helpers.send_pixiv_request({
            method: "GET",
            url: this.url,
            responseType: "arraybuffer",
            signal: this.signal,
        });        

        // We could also figure out progress from frame numbers, but doing it with the actual
        // amount downloaded is more accurate, and the server always gives us content-length.
        this.total_length = response.headers.get("Content-Length");
        if(this.total_length != null)
            this.total_length = parseInt(this.total_length);

        // Firefox is in the dark ages and can't stream data from fetch.  Fall back
        // on loading the whole body if we don't have getReader.
        let fetch_reader;
        if(response.body.getReader)
            fetch_reader = response.body.getReader();
        else
            fetch_reader = await response.arrayBuffer();

        this.reader = new IncrementalReader(fetch_reader, {
            onprogress: (position) => {
                if(this.onprogress && this.total_length > 0)
                {
                    let progress = position / this.total_length;
                    this.onprogress(progress);
                }
            }
        });
    }

    async get_next_frame()
    {
        // Wait for start_download to complete, if it hasn't yet.
        await this.start_promise;

        // Read the local file header up to the filename.
        let header = await this.reader.read(30);
        let view = new DataView(header);

        // Check the header.
        let magic = view.getUint32(0, true);
        if(magic == 0x02014b50)
        {
            // Once we see the central directory, we're at the end.
            return null;
        }

        if(magic != 0x04034b50)
            throw Error("Unrecognized file");

        let compression = view.getUint16(8, true);
        if(compression != 0)
            throw Error("Unsupported compression method");
        
        // Get the variable field lengths, and skip over the rest of the local file headers.
        let file_size = view.getUint32(22, true);
        let filename_size = view.getUint16(26, true);
        let extra_size = view.getUint16(28, true);
        await this.reader.read(filename_size);
        await this.reader.read(extra_size);

        // Read the file.
        return await this.reader.read(file_size);
    }
};

ppixiv.ZipImagePlayer = class
{
    constructor(options)
    {
        this.nextFrame = this.nextFrame.bind(this);

        this.op = options;

        // If true, continue playback when we get more data.
        this.waiting_for_frame = true;

        this.dead = false;
        this.context = options.canvas.getContext("2d");
        this.frame_count = this.op.metadata.frames.length;

        // The frame that we want to be displaying:
        this.frame = 0;
        this.failed = false;

        // Make a list of timestamps for each frame.
        this.frameTimestamps = [];
        let milliseconds = 0;
        for(let frame of this.op.metadata.frames)
        {
            this.frameTimestamps.push(milliseconds);
            milliseconds += frame.delay;
        }
        this.total_length = milliseconds;

        this.frame_images = [];
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

        let frame = 0;
        while(1)
        {
            let file;
            try {
                file = await this.downloader.get_next_frame();
            } catch(e) {
                // This will usually be cancellation.
                console.info("Error downloading file", e);
                return;
            }

            if(file == null)
                break;

            // Decode the frame.
            let mime_type = this.op.metadata.mime_type || "image/png";
            let blob = new Blob([file], {type: mime_type});
            await this.loadNextFrame(frame, blob);

            // Call progress.  This is relative to frame timestamps, so load progress lines up
            // with the seek bar.
            if(this.op.progress)
            {
                let progress = this.frameTimestamps[frame] / this.total_length;
                this.op.progress(progress);
            }

            frame++;
        }

        // Call completion.
        if(this.op.progress)
        {
            setTimeout(() => {
                this.op.progress(null);
            }, 0);
        }
    }

    // Load the next frame into this.frame_images.
    async loadNextFrame(frame, blob)
    {
        if(this.dead)
            return;

        let url = URL.createObjectURL(blob);
        let image = document.createElement("img");
        image.src = url;

        await helpers.wait_for_image_load(image);

        URL.revokeObjectURL(url);

        if(this.dead)
            return;

        this.frame_images.push(image);

        // If we were stalled waiting for data, display the frame.
        if(this.waiting_for_frame) 
        {
            this.waiting_for_frame = false;
            this.displayFrame();
        }
    }

    displayFrame()
    {
        if(this.dead)
            return;

        let meta = this.op.metadata.frames[this.frame];
        let image = this.frame_images[this.frame];
        if(!image) {
            // We haven't downloaded this far yet.  Show the frame when we get it.
            this.waiting_for_frame = true;
            return;
        }

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
        this.timer = setTimeout(this.nextFrame, this.pending_frame_metadata.delay / this.speed);
    }

    getFrameDuration()
    {
        let meta = this.op.metadata.frames[this.frame];
        return meta.delay;
    }

    nextFrame(frame)
    {
        this.timer = null;

        if(this.frame >= (this.frame_count - 1)) {
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
        this.frame_images = null;
    }

    getCurrentFrame()
    {
        return this.frame;
    }

    setCurrentFrame(frame)
    {
        frame %= this.frame_count;
        if(frame < 0)
            frame += this.frame_count;
        this.frame = frame;
        this.displayFrame();
    }

    getTotalDuration()
    {
        return this.total_length / 1000;
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
            // Only seek to images that we've downloaded.  If we reach a frame we don't have
            // yet, stop.
            if(!this.frame_images[frame])
                break;

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
    getLoadedFrames() { return this.frame_images.length; }
    getFrameCount() { return this.frame_count; }
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
