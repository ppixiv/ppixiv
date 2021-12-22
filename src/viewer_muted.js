"use strict";

// This is used to display a muted image.
ppixiv.viewer_muted = class extends ppixiv.viewer
{
    constructor(options)
    {
        super({...options, template: `
            <div class=mute-display>
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
    }

    async load(illust_id, manga_page, {
        autoplay=false,
        onfinished=null,
    }={})
    {
        this.container.querySelector(".view-muted-image").addEventListener("click", (e) => {
            let args = helpers.args.location;
            args.hash.set("view-muted", "1");
            helpers.set_page_url(args, false /* add_to_history */, "override-mute");
        });

        // We don't skip muted images in autoplay immediately, since it could cause
        // API hammering if something went wrong, and most of the time autoplay is used
        // on bookmarks where there aren't a lot of muted images anyway.  Just wait a couple
        // seconds and call onfinished.
        if(autoplay && onfinished)
        {
            let autoplay_timer = this.autoplay_timer = (async() => {
                await helpers.sleep(2000);
                if(autoplay_timer != this.autoplay_timer)
                    return;

                onfinished();
            })();
        }

        this.illust_data = await image_data.singleton().get_image_info(illust_id);
        console.log(illust_id, this.illust_data);

        // Stop if we were removed before the request finished.
        if(this.was_shutdown)
            return;
        
        // Show the user's avatar instead of the muted image.
        let user_info = await image_data.singleton().get_user_info(this.illust_data.userId);
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

        this.container.parentNode.removeChild(this.container);
        this.autoplay_timer = null;
    }
}

