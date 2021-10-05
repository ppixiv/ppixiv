"use strict";

// Encode a Pixiv video to MJPEG, using an MKV container.
//
// Other than having to wrangle the MKV format, this is easy: the source files appear to always
// be JPEGs, so we don't need to do any conversions and the encoding is completely lossless (other
// than the loss Pixiv forces by reencoding everything to JPEG).  The result is standard and plays
// in eg. VLC, but it's not a WebM file and browsers don't support it.
this.ugoira_downloader_mjpeg = function(illust_data, progress)
{
    this.illust_data = illust_data;
    this.progress = progress;

    // We don't need image data, but we make a dummy canvas to make ZipImagePlayer happy.
    var canvas = document.createElement("canvas");

    // Create a ZipImagePlayer.  This will download the ZIP, and handle parsing the file.
    this.player = new ZipImagePlayer({
        "metadata": illust_data.ugoiraMetadata,
        "source": illust_data.ugoiraMetadata.originalSrc,
        "mime_type": illust_data.ugoiraMetadata.mime_type,
        "canvas": canvas,
        "progress": this.zip_finished_loading.bind(this),
    });            
}

this.ugoira_downloader_mjpeg.prototype.zip_finished_loading = function(progress)
{
    if(this.progress)
    {
        try {
            this.progress.set(progress);
        } catch(e) {
            console.error(e);
        }
    }

    // We just want to know when the ZIP has been completely downloaded, which is indicated when progress
    // finishes.
    if(progress != null)
        return;

    // Some posts have the wrong dimensions in illust_data (63162632).  If we use it, the resulting
    // file won't play.  Decode the first image to find the real resolution.
    var img = document.createElement("img");
    var blob = new Blob([this.player.getFrameData(0)], {type: this.player.op.metadata.mime_type || "image/png"});
    var first_frame_url = URL.createObjectURL(blob);
    img.src = first_frame_url;

    img.onload = (e) =>
    {
        URL.revokeObjectURL(first_frame_url);
        this.continue_saving(img.naturalWidth, img.naturalHeight)
    };
}

this.ugoira_downloader_mjpeg.prototype.continue_saving = function(width, height)
{
    try {
        var encoder = new encode_mkv(width, height);
        
        // Add each frame to the encoder.
        var frame_count = this.illust_data.ugoiraMetadata.frames.length;
        for(var frame = 0; frame < frame_count; ++frame)
        {
            var frame_data = this.player.getFrameData(frame);
            encoder.add(frame_data, this.player.getFrameNoDuration(frame));
        };

        // There's no way to encode the duration of the final frame of an MKV, which means the last frame
        // will be effectively lost when looping.  In theory the duration field on the file should tell the
        // player this, but at least VLC doesn't do that.
        //
        // Work around this by repeating the last frame with a zero duration.
        //
        // In theory we could set the "invisible" bit on this frame ("decoded but not displayed"), but that
        // doesn't seem to be used, at least not by VLC.
        var frame_data = this.player.getFrameData(frame_count-1);
        encoder.add(frame_data, 0);
        
        // Build the file.
        var mkv = encoder.build();
        var filename = this.illust_data.userInfo.name + " - " + this.illust_data.illustId + " - " + this.illust_data.illustTitle + ".mkv";
        helpers.save_blob(mkv, filename);
    } catch(e) {
        console.error(e);
    };
};

