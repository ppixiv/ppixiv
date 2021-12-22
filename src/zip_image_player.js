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

        // If this fails, the error was already logged.  The most common cause is being cancelled.
        if(response == null)
            return null;

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
        let result = await this.reader.read(file_size);

        // Read past the data descriptor if this file has one.
        let flags = view.getUint16(6, true);
        if(flags & 8)
        {
            let descriptor = await this.reader.read(16);
            let descriptor_view = new DataView(descriptor);
            if(descriptor_view.getUint32(0, true) != 0x08074b50)
                throw Error("Unrecognized file");
        }

        return result;
    }
};


// This gives a small subset of HTMLVideoPlayer's API to control the video, so
// video_ui can work with this in the same way as a regular video.
class ZipVideoInterface extends EventTarget
{
    constructor(player)
    {
        super();
        this.player = player;
    }

    // This is to tell video_ui to hide audio controls, since we have no audio.  Somehow
    // there's no interface on HTMLVideoElement for this.
    get hide_audio_controls() { return true; }

    get paused() { return this.player.paused; }

    get duration()
    {
        // Expose the seekable duration rather than the full duration, since it looks
        // weird if you seek to the end of the seek bar and the time isn't at the end.
        //
        // Some crazy person decided to use NaN as a sentinel for unknown duration instead
        // of null, so mimic that.
        let result = this.player.get_seekable_duration();
        if(result == null)
            return NaN;
        else
            return result;
    }

    get currentTime() { return this.player.get_current_frame_time(); }
    play() { return this.player.play(); }
    pause() { return this.player.pause(); }
}

ppixiv.ZipImagePlayer = class
{
    constructor(options)
    {
        this.next_frame = this.next_frame.bind(this);

        this.op = options;
        this.interface = new ZipVideoInterface(this);

        // If true, continue playback when we get more data.
        this.waiting_for_frame = true;

        this.dead = false;
        this.context = options.canvas.getContext("2d");

        // The frame that we want to be displaying:
        this.frame = 0;
        this.failed = false;

        // These aren't available until load() completes.
        this.frameTimestamps = [];
        this.total_length = 0;
        this.frame_count = 0;
        this.seekable_length = null;

        this.frame_data = [];
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

        if(this.op.local)
        {
            // For local files, the first file in the ZIP contains the metadata.
            let data;
            try {
                data = await this.downloader.get_next_frame();
            } catch(e) {
                // This will usually be cancellation.
                console.info("Error downloading file", e);
                return;
            }

            // Is there really no "decode databuffer to string with encoding" API?
            data = new Uint8Array(data);
            data = String.fromCharCode.apply(null, data);
            data = JSON.parse(data);

            this.frame_metadata = data;
        }
        else
        {
            this.frame_metadata = this.op.metadata.frames;
        }

        // Make a list of timestamps for each frame.
        this.frameTimestamps = [];
        let milliseconds = 0;
        let last_frame_time = 0;
        for(let frame of this.frame_metadata)
        {
            this.frameTimestamps.push(milliseconds);
            milliseconds += frame.delay;
            last_frame_time = frame.delay;
        }
        this.total_length = milliseconds;
        this.frame_count = this.frame_metadata.length;

        // The duration to display on the seek bar.  This doesn't include the duration of the
        // final frame.  We can't seek to the actual end of the video past the end of the last
        // frame, and the end of the seek bar represents the beginning of the last frame.
        this.seekable_length = milliseconds - last_frame_time;

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

            // Read the frame data into a blob and store it.
            //
            // Don't decode it just yet.  We'll decode it the first time it's displayed.  This way,
            // we read the file as it comes in, but we won't burst decode every frame right at the
            // start.  This is important if the video ZIP is coming out of cache, since the browser
            // can't cache the image decodes and we'll cause a big burst of CPU load.
            let mime_type = this.op.metadata?.mime_type || "image/jpeg";
            let blob = new Blob([file], {type: mime_type});
            this.frame_data.push(blob);

            // Call progress.  This is relative to frame timestamps, so load progress lines up
            // with the seek bar.
            if(this.op.progress)
            {
                let progress = this.frameTimestamps[frame] / this.total_length;
                this.op.progress(progress);
            }

            frame++;

            // We have more data to potentially decode, so start decode_frames if it's not already running.
            this.decode_frames();
        }

        // Call completion.
        if(this.op.progress)
            this.op.progress(null);
    }

    // Load the next frame into this.frame_images.
    async decode_frames()
    {
        // If this is already running, don't start another.
        if(this.loading_frames)
            return;

        try {
            this.loading_frames = true;
            while(await this.decode_one_frame())
            {
            }
        } finally {
            this.loading_frames = false;
        }
    }

    // Decode up to one frame ahead of this.frame, so we don't wait until we need a
    // frame to start decoding it.  Return true if we decoded a frame and should be
    // called again to see if we can decode another.
    async decode_one_frame()
    {
        let ahead = 0;
        for(ahead = 0; ahead < 2; ++ahead)
        {
            let frame = this.frame + ahead;

            // Stop if we don't have data for this frame.  If we don't have this frame, we won't
            // have any after either.
            let blob = this.frame_data[frame];
            if(blob == null)
                return;

            // Skip this frame if it's already decoded.
            if(this.frame_images[frame])
                continue;

            let url = URL.createObjectURL(blob);
            let image = document.createElement("img");
            image.src = url;

            await helpers.wait_for_image_load(image);

            URL.revokeObjectURL(url);

            this.frame_images[frame] = image;

            // If we were stalled waiting for data, display the frame.  It's possible the frame
            // changed while we were blocking and we won't actually have the new frame, but we'll
            // just notice and turn waiting_for_frame back on.
            if(this.waiting_for_frame) 
            {
                this.waiting_for_frame = false;
                this.display_frame();
            }

            if(this.dead)
                return false;

            return true;
        }

        return false;
    }

    async display_frame()
    {
        if(this.dead)
            return;

        this.decode_frames();

        // If we don't have the frame yet, just record that we want to be called when the
        // frame is decoded and stop.  decode_frames will call us when there's a frame to display.
        if(!this.frame_images[this.frame])
        {
            // We haven't downloaded this far yet.  Show the frame when we get it.
            this.waiting_for_frame = true;
            return;
        }

        let image = this.frame_images[this.frame];

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

        this.video_interface.dispatchEvent(new Event("timeupdate"));

        if(this.paused)
            return;

        let meta = this.frame_metadata[this.frame];
        this.pending_frame_metadata = meta;
        this.refresh_timer();
    }

    unset_timer()
    {
        if(!this.timer)
            return;

        clearTimeout(this.timer);
        this.timer = null;
    }

    refresh_timer()
    {
        if(this.paused)
            return;

        this.unset_timer();
        this.timer = setTimeout(this.next_frame, this.pending_frame_metadata.delay / this.speed);
    }

    get_frame_duration()
    {
        let meta = this.frame_metadata[this.frame];
        return meta.delay;
    }

    next_frame(frame)
    {
        this.timer = null;

        if(this.frame >= (this.frame_count - 1)) {
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
        this.display_frame();
    }

    play()
    {
        if(this.dead)
            return;

        if(this.paused) {
            this.paused = false;
            this.display_frame();

            this.video_interface.dispatchEvent(new Event("play"));
        }
    }

    pause()
    {
        if(this.dead)
            return;

        if(!this.paused) {
            this.unset_timer();
            this.paused = true;

            this.video_interface.dispatchEvent(new Event("pause"));
        }
    }

    set_pause(value)
    {
        if(this.dead)
            return;
        if(this.paused = value)
            return;

        this.context.canvas.paused = this.paused;
        this.paused = value;
    }

    get video_interface()
    {
        return this.interface;
    }

    toggle_pause()
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
        this.unset_timer();
        this.display_frame();
    }

    set_speed(value)
    {
        this.speed = value;

        // Refresh the timer, so we don't wait a long time if we're changing from a very slow
        // playback speed.
        this.refresh_timer();
    }

    stop()
    {
        this.dead = true;
        this.unset_timer();
        this.frame_images = null;
    }

    get_current_frame()
    {
        return this.frame;
    }

    set_current_frame(frame)
    {
        frame %= this.frame_count;
        if(frame < 0)
            frame += this.frame_count;
        this.frame = frame;
        this.display_frame();
    }

    get_total_duration()
    {
        return this.total_length / 1000;
    }

    get_seekable_duration()
    {
        if(this.seekable_length == null)
            return null;
        else
            return this.seekable_length / 1000;
    }

    get_current_frame_time()
    {
        let timestamp = this.frameTimestamps[this.frame];
        return timestamp == null? null: timestamp / 1000;
    }

    // Set the video to the closest frame to the given time.
    set_current_frame_time(seconds)
    {
        // We don't actually need to check all frames, but there's no need to optimize this.
        let closest_frame = null;
        let closest_error = null;
        for(let frame = 0; frame < this.frame_metadata.length; ++frame)
        {
            // Only seek to images that we've downloaded.  If we reach a frame we don't have
            // yet, stop.
            if(!this.frame_data[frame])
                break;

            let error = Math.abs(seconds - this.frameTimestamps[frame]/1000);
            if(closest_frame == null || error < closest_error)
            {
                closest_frame = frame;
                closest_error = error;
            }
        }

        this.frame = closest_frame;
        this.display_frame();
    }

    get_frame_count() { return this.frame_count; }
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
