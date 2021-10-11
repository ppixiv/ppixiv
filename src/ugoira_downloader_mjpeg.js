"use strict";

// Encode a Pixiv video to MJPEG, using an MKV container.
//
// Other than having to wrangle the MKV format, this is easy: the source files appear to always
// be JPEGs, so we don't need to do any conversions and the encoding is completely lossless (other
// than the loss Pixiv forces by reencoding everything to JPEG).  The result is standard and plays
// in eg. VLC, but it's not a WebM file and browsers don't support it.
ppixiv.ugoira_downloader_mjpeg = class
{
    constructor(illust_data, progress)
    {
        this.illust_data = illust_data;
        this.onprogress = progress;
        this.metadata = illust_data.ugoiraMetadata;
        this.mime_type = illust_data.ugoiraMetadata.mime_type;
        this.frames = [];

        this.load_all_frames();
    }

    async load_all_frames()
    {
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
            let file = await downloader.get_next_frame();
            if(file == null)
                break;
            this.frames.push(file);
        }

        // Some posts have the wrong dimensions in illust_data (63162632).  If we use it, the resulting
        // file won't play.  Decode the first image to find the real resolution.
        var img = document.createElement("img");
        var blob = new Blob([this.frames[0]], {type: this.mime_type || "image/png"});
        var first_frame_url = URL.createObjectURL(blob);
        img.src = first_frame_url;

        await helpers.wait_for_image_load(img);

        URL.revokeObjectURL(first_frame_url);
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        try {
            var encoder = new encode_mkv(width, height);
            
            // Add each frame to the encoder.
            var frame_count = this.illust_data.ugoiraMetadata.frames.length;
            for(var frame = 0; frame < frame_count; ++frame)
            {
                var frame_data = this.frames[frame];
                let duration = this.metadata.frames[frame].delay;
                encoder.add(frame_data, duration);
            };

            // There's no way to encode the duration of the final frame of an MKV, which means the last frame
            // will be effectively lost when looping.  In theory the duration field on the file should tell the
            // player this, but at least VLC doesn't do that.
            //
            // Work around this by repeating the last frame with a zero duration.
            //
            // In theory we could set the "invisible" bit on this frame ("decoded but not displayed"), but that
            // doesn't seem to be used, at least not by VLC.
            var frame_data = this.frames[frame_count-1];
            encoder.add(frame_data, 0);
            
            // Build the file.
            var mkv = encoder.build();
            var filename = this.illust_data.userInfo.name + " - " + this.illust_data.illustId + " - " + this.illust_data.illustTitle + ".mkv";
            helpers.save_blob(mkv, filename);
        } catch(e) {
            console.error(e);
        };

        // Completed:
        if(this.onprogress)
            this.onprogress.set(null);
    }
}

