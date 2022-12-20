// Encode a Pixiv video to MJPEG, using an MKV container.
//
// Other than having to wrangle the MKV format, this is easy: the source files appear to always
// be JPEGs, so we don't need to do any conversions and the encoding is completely lossless (other
// than the loss Pixiv forces by reencoding everything to JPEG).  The result is standard and plays
// in eg. VLC, but it's not a WebM file and browsers don't support it.  These can also be played
// when reading from the local API, since it'll decode these videos and turn them back into a ZIP.

import encodeMKV from "vview/misc/encode_mkv.js";
import ZipImageDownloader from 'vview/misc/zip-image-downloader.js';

export default class PixivUgoiraDownloader
{
    constructor(illustData, progress)
    {
        this.illustData = illustData;
        this.onprogress = progress;
        this.metadata = illustData.ugoiraMetadata;
        this.mimeType = illustData.ugoiraMetadata.mimeType;
        this.frames = [];

        this.loadAllFrames();
    }

    async loadAllFrames()
    {
        // XXX
        // message_widget.singleton.show(`Downloading video...`);

        let downloader = new ZipImageDownloader(this.metadata.originalSrc, {
            onprogress: (progress) => {
                if(!this.onprogress)
                    return;

                try {
                    this.onprogress.set(progress);
                } catch(e) {
                    console.error(e);
                }
            },
        });
        
        while(1)
        {
            let file = await downloader.getNextFrame();
            if(file == null)
                break;
            this.frames.push(file);
        }

        // XXX
        // message_widget.singleton.hide();

        // Some posts have the wrong dimensions in illustData (63162632).  If we use it, the resulting
        // file won't play.  Decode the first image to find the real resolution.
        var img = document.createElement("img");
        var blob = new Blob([this.frames[0]], {type: this.mimeType || "image/png"});
        var firstFrameURL = URL.createObjectURL(blob);
        img.src = firstFrameURL;

        await ppixiv.helpers.wait_for_image_load(img);

        URL.revokeObjectURL(firstFrameURL);
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        try {
            var encoder = new encodeMKV(width, height);
            
            // Add each frame to the encoder.
            var frameCount = this.illustData.ugoiraMetadata.frames.length;
            for(var frame = 0; frame < frameCount; ++frame)
            {
                var frameData = this.frames[frame];
                let duration = this.metadata.frames[frame].delay;
                encoder.add(frameData, duration);
            };

            // There's no way to encode the duration of the final frame of an MKV, which means the last frame
            // will be effectively lost when looping.  In theory the duration field on the file should tell the
            // player this, but at least VLC doesn't do that.
            //
            // Work around this by repeating the last frame with a zero duration.
            //
            // In theory we could set the "invisible" bit on this frame ("decoded but not displayed"), but that
            // doesn't seem to be used, at least not by VLC.
            var frameData = this.frames[frameCount-1];
            encoder.add(frameData, 0);
            
            // Build the file.
            var mkv = encoder.build();
            var filename = this.illustData.userName + " - " + this.illustData.illustId + " - " + this.illustData.illustTitle + ".mkv";
            ppixiv.helpers.save_blob(mkv, filename);
        } catch(e) {
            console.error(e);
        };

        // Completed:
        if(this.onprogress)
            this.onprogress.set(null);
    }
}

