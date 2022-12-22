// Encode a Pixiv video to MJPEG, using an MKV container.
//
// Other than having to wrangle the MKV format, this is easy: the source files appear to always
// be JPEGs, so we don't need to do any conversions and the encoding is completely lossless (other
// than the loss Pixiv forces by reencoding everything to JPEG).  The result is standard and plays
// in eg. VLC, but it's not a WebM file and browsers don't support it.  These can also be played
// when reading from the local API, since it'll decode these videos and turn them back into a ZIP.

import EncodeMKV from "vview/misc/encode-mkv.js";
import ZipImageDownloader from 'vview/misc/zip-image-downloader.js';
import { helpers } from 'vview/misc/helpers.js';

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
        ppixiv.message.show(`Downloading video...`);

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

        ppixiv.message.hide();

        // Some posts have the wrong dimensions in illustData (63162632).  If we use it, the resulting
        // file won't play.  Decode the first image to find the real resolution.
        let img = document.createElement("img");
        let blob = new Blob([this.frames[0]], {type: this.mimeType || "image/png"});
        let firstFrameURL = URL.createObjectURL(blob);
        img.src = firstFrameURL;

        await helpers.waitForImageLoad(img);

        URL.revokeObjectURL(firstFrameURL);
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        try {
            let encoder = new EncodeMKV(width, height);
            
            // Add each frame to the encoder.
            let frameCount = this.illustData.ugoiraMetadata.frames.length;
            for(let frame = 0; frame < frameCount; ++frame)
            {
                let frameData = this.frames[frame];
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
            let frameData = this.frames[frameCount-1];
            encoder.add(frameData, 0);
            
            // Build the file.
            let mkv = encoder.build();
            let filename = this.illustData.userName + " - " + this.illustData.illustId + " - " + this.illustData.illustTitle + ".mkv";
            helpers.saveBlob(mkv, filename);
        } catch(e) {
            console.error(e);
        };

        // Completed:
        if(this.onprogress)
            this.onprogress.set(null);
    }
}

