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
function ZipImagePlayer(options) {
    this.op = options;
    if (!Blob) {
        this._error("No Blob support");
    }
    if (!Uint8Array) {
        this._error("No Uint8Array support");
    }
    if (!DataView) {
        this._error("No DataView support");
    }
    if (!ArrayBuffer) {
        this._error("No ArrayBuffer support");
    }
    this._loadingState = 0;
    this._dead = false;
    this._context = options.canvas.getContext("2d");
    this._files = {};
    this._frameCount = this.op.metadata.frames.length;
    this._debugLog("Frame count: " + this._frameCount);
    this._frame = 0;
    this._loadFrame = 0;
    this._frameImages = [];
    this._paused = false;
    this._startLoad();
    this.speed = 1;
    if (this.op.autoStart) {
        this.play();
    } else {
        this._paused = true;
    }
}

// Removed partial loading.  It doesn't cache in Firefox, and it's unnecessary with the very
// tiny files Pixiv supports.
ZipImagePlayer.prototype = {
    _failed: false,
    _mkerr: function(msg) {
        var _this = this;
        return function() {
            _this._error(msg);
        }
    },
    _error: function(msg) {
        this._failed = true;
        throw Error("ZipImagePlayer error: " + msg);
    },
    _debugLog: function(msg) {
        if (this.op.debug) {
            console.log(msg);
        }
    },
    _load: function() {
        var _this = this;

        // Use helpers.fetch_resource, so we share fetches with preloading.
        var xhr = helpers.fetch_resource(this.op.source, {
            onload: function(ev) {
                if (_this._dead) {
                    return;
                }
                _this._debugLog("Load: status=" + ev.status);
                if (ev.status != 200) {
                    _this._error("Unexpected HTTP status " + ev.status);
                }
                var length = ev.response.byteLength;
                _this._len = length;
                _this._pHead = length;
                _this._buf = ev.response;
                _this._bytes = new Uint8Array(_this._buf);
                this._findCentralDirectory();

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
            }.bind(this),

            onerror: this._mkerr("Fetch failed"),
            onprogress: function(e) {
                if(!this.op.progress)
                    return;
                try {
                    this.op.progress(e.loaded / e.total);
                } catch(e) {
                    console.error(e);
                }
            }.bind(this),
        });
    },
    _startLoad: function() {
        var _this = this;
        if (!this.op.source) {
            // Unpacked mode (individiual frame URLs) - just load the frames.
            this._loadNextFrame();
            return;
        }
        _this._load();
    },
    _findCentralDirectory: function() {
        // No support for ZIP file comment
        var dv = new DataView(this._buf, this._len - 22, 22);
        if (dv.getUint32(0, true) != 0x06054b50) {
            this._error("End of Central Directory signature not found");
        }
        var count = dv.getUint16(10, true);
        var size = dv.getUint32(12, true);
        var offset = dv.getUint32(16, true);
        if (offset < this._pTail) {
            this._error("End central directory past end of file");
            return;
        }

        // Parse the central directory.
        var dv = new DataView(this._buf, offset, size);
        var p = 0;
        for (var i = 0; i < count; i++ ) {
            if (dv.getUint32(p, true) != 0x02014b50) {
                this._error("Invalid Central Directory signature");
            }
            var compMethod = dv.getUint16(p + 10, true);
            var uncompSize = dv.getUint32(p + 24, true);
            var nameLen = dv.getUint16(p + 28, true);
            var extraLen = dv.getUint16(p + 30, true);
            var cmtLen = dv.getUint16(p + 32, true);
            var off = dv.getUint32(p + 42, true);
            if (compMethod != 0) {
                this._error("Unsupported compression method");
            }
            p += 46;
            var nameView = new Uint8Array(this._buf, offset + p, nameLen);
            var name = "";
            for (var j = 0; j < nameLen; j++) {
                name += String.fromCharCode(nameView[j]);
            }
            p += nameLen + extraLen + cmtLen;
            /*this._debugLog("File: " + name + " (" + uncompSize +
                           " bytes @ " + off + ")");*/
            this._files[name] = {off: off, len: uncompSize};
        }
        // Two outstanding fetches at any given time.
        // Note: the implementation does not support more than two.
        if (this._pHead < this._pTail) {
            this._error("Chunk past end of file");
            return;
        }

        this._pHead = this._len;
        this._loadNextFrame();
    },
    _fileDataStart: function(offset) {
        var dv = new DataView(this._buf, offset, 30);
        var nameLen = dv.getUint16(26, true);
        var extraLen = dv.getUint16(28, true);
        return offset + 30 + nameLen + extraLen;
    },
    _isFileAvailable: function(name) {
        var info = this._files[name];
        if (!info) {
            this._error("File " + name + " not found in ZIP");
        }
        if (this._pHead < (info.off + 30)) {
            return false;
        }
        return this._pHead >= (this._fileDataStart(info.off) + info.len);
    },
    getFrameData: function(frame) {
        if (this._dead) {
            return;
        }
        if (frame >= this._frameCount) {
            return null;
        }
        var meta = this.op.metadata.frames[frame];
        if (!this._isFileAvailable(meta.file)) {
            return null;
        }
        var off = this._fileDataStart(this._files[meta.file].off);
        var end = off + this._files[meta.file].len;
        var mime_type = this.op.metadata.mime_type || "image/png";
        var slice;
        if (!this._buf.slice) {
            slice = new ArrayBuffer(this._files[meta.file].len);
            var view = new Uint8Array(slice);
            view.set(this._bytes.subarray(off, end));
        } else {
            slice = this._buf.slice(off, end);
        }
        return slice;
    },
    _loadNextFrame: function() {
        if (this._dead) {
            return;
        }
        var frame = this._loadFrame;
        if (frame >= this._frameCount) {
            return;
        }
        var meta = this.op.metadata.frames[frame];
        if (!this.op.source) {
            // Unpacked mode (individiual frame URLs)
            this._loadFrame += 1;
            this._loadImage(frame, meta.file, false);
            return;
        }
        if (!this._isFileAvailable(meta.file)) {
            return;
        }
        this._loadFrame += 1;
        var off = this._fileDataStart(this._files[meta.file].off);
        var end = off + this._files[meta.file].len;
        var url;
        var mime_type = this.op.metadata.mime_type || "image/png";
        var slice;
        if (!this._buf.slice) {
            slice = new ArrayBuffer(this._files[meta.file].len);
            var view = new Uint8Array(slice);
            view.set(this._bytes.subarray(off, end));
        } else {
            slice = this._buf.slice(off, end);
        }
        var blob = new Blob([slice], {type: mime_type});
        /*_this._debugLog("Loading " + meta.file + " to frame " + frame);*/
        url = URL.createObjectURL(blob);
        this._loadImage(frame, url, true);
    },
    _loadImage: function(frame, url, isBlob) {
        var _this = this;
        var image = document.createElement("img");
        var meta = this.op.metadata.frames[frame];
        image.addEventListener('load', function() {
            _this._debugLog("Loaded " + meta.file + " to frame " + frame);
            if (isBlob) {
                URL.revokeObjectURL(url);
            }
            if (_this._dead) {
                return;
            }
            _this._frameImages[frame] = image;
            if (_this._loadingState == 0) {
                _this._displayFrame.apply(_this);
            }
            if (frame >= (_this._frameCount - 1)) {
                _this._setLoadingState(2);
                _this._buf = null;
                _this._bytes = null;
            } else {
                _this._loadNextFrame();
            }
        });
        image.src = url;
    },
    _setLoadingState: function(state) {
        if (this._loadingState != state) {
            this._loadingState = state;
        }
    },
    _displayFrame: function() {
        if (this._dead) {
            return;
        }
        var _this = this;
        var meta = this.op.metadata.frames[this._frame];
        // this._debugLog("Displaying frame: " + this._frame + " " + meta.file);
        var image = this._frameImages[this._frame];
        if (!image) {
            this._debugLog("Image not available!");
            this._setLoadingState(0);
            return;
        }
        if (this._loadingState != 2) {
            this._setLoadingState(1);
        }
        if (this.op.autosize) {
            if (this._context.canvas.width != image.width || this._context.canvas.height != image.height) {
                // make the canvas autosize itself according to the images drawn on it
                // should set it once, since we don't have variable sized frames
                this._context.canvas.width = image.width;
                this._context.canvas.height = image.height;
            }
        };
        this.drawn_frame = this._frame;
        this._context.clearRect(0, 0, this.op.canvas.width,
                                this.op.canvas.height);
        this._context.drawImage(image, 0, 0);

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
        
        if (this._paused)
            return;
        this._pending_frame_metadata = meta;
        this._refreshTimer();
    },
    _unsetTimer: function() {
        if(!this._timer)
            return;

        clearTimeout(this._timer);
        this._timer = null;
    },
    _refreshTimer: function() {
        if(this._paused)
            return;

        this._unsetTimer();
        this._timer = setTimeout(this._nextFrame.bind(this), this._pending_frame_metadata.delay / this.speed);
    },
    getFrameDuration: function() {
        var meta = this.op.metadata.frames[this._frame];
        return meta.delay;
    },
    getFrameNoDuration: function(frame) {
        var meta = this.op.metadata.frames[frame];
        return meta.delay;
    },
    _nextFrame: function(frame) {
        this._timer = null;

        if (this._frame >= (this._frameCount - 1)) {
            if (this.op.loop) {
                this._frame = 0;
            } else {
                this.pause();
                return;
            }
        } else {
            this._frame += 1;
        }
        this._displayFrame();
    },
    play: function() {
        if (this._dead) {
            return;
        }
        if (this._paused) {
            this._paused = false;
            this._displayFrame();
        }
    },
    pause: function() {
        if (this._dead) {
            return;
        }
        if (!this._paused) {
            this._unsetTimer();
            this._paused = true;
        }
    },
    togglePause: function() {
        if(this._paused)
            this.play();
        else
            this.pause();
    },
    rewind: function() {
        if (this._dead) {
            return;
        }
        this._frame = 0;
        this._unsetTimer();
        this._displayFrame();
    },
    setSpeed: function(value) {
        this.speed = value;

        // Refresh the timer, so we don't wait a long time if we're changing from a very slow
        // playback speed.
        this._refreshTimer();
    },
    stop: function() {
        this._debugLog("Stopped");
        this._dead = true;
        this._unsetTimer();
        this._frameImages = null;
        this._buf = null;
        this._bytes = null;
    },
    getCurrentFrame: function() {
        return this._frame;
    },
    setCurrentFrame: function(frame) {
        frame %= this._frameCount;
        if(frame < 0)
            frame += this._frameCount;
        this._frame = frame;
        this._displayFrame();
    },
    getLoadedFrames: function() {
        return this._frameImages.length;
    },
    getFrameCount: function() {
        return this._frameCount;
    },
    hasError: function() {
        return this._failed;
    }
}

