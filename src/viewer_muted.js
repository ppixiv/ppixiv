"use strict";

// This is used to display a muted image.
ppixiv.viewer_muted = class extends ppixiv.viewer
{
    constructor({onready, ...options})
    {
        super({...options, template: `
            <div class="viewer mute-display">
                <img class=muted-image>
                <div class=muted-text>
                    <Span>Muted:</span>
                    <span class=muted-label></span>
                    <div class=view-muted-image>
                        View image
                    </div>
                </div>
            </div>
        `});

        // Just fire onready immediately for this viewer.
        onready();
    }

    async load(media_id, {
        slideshow=false,
        onnextimage=null,
    }={})
    {
        this.container.querySelector(".view-muted-image").addEventListener("click", (e) => {
            let args = helpers.args.location;
            args.hash.set("view-muted", "1");
            helpers.navigate(args, { add_to_history: false, cause: "override-mute" });
        });

        // We don't skip muted images in slideshow immediately, since it could cause
        // API hammering if something went wrong, and most of the time slideshow is used
        // on bookmarks where there aren't a lot of muted images anyway.  Just wait a couple
        // seconds and call onnextimage.
        if(slideshow && onnextimage)
        {
            let slideshow_timer = this.slideshow_timer = (async() => {
                await helpers.sleep(2000);
                if(slideshow_timer != this.slideshow_timer)
                    return;

                onnextimage();
            })();
        }

        this.illust_data = await ppixiv.media_cache.get_media_info(media_id);

        // Stop if we were removed before the request finished.
        if(this.was_shutdown)
            return;
        
        // Show the user's avatar instead of the muted image.
        let user_info = await user_cache.get_user_info(this.illust_data.userId);
        var img = this.container.querySelector(".muted-image");
        img.src = user_info.imageBig;

        let muted_tag = muting.singleton.any_tag_muted(this.illust_data.tagList);
        let muted_user = muting.singleton.is_muted_user_id(this.illust_data.userId);

        let muted_label = this.container.querySelector(".muted-label");
        if(muted_tag)
            tag_translations.get().set_translated_tag(muted_label, muted_tag);
        else if(muted_user)
            muted_label.innerText = this.illust_data.userName;
    }

    shutdown()
    {
        super.shutdown();

        this.slideshow_timer = null;
    }
}

