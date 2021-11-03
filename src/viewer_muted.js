"use strict";

// This is used to display a muted image.
ppixiv.viewer_muted = class extends ppixiv.viewer
{
    constructor(options)
    {
        super(options);

        // Create the display.
        this.root = helpers.create_from_template(".template-muted");
        container.appendChild(this.root);

        this.load();
    }

    async load()
    {
        this.root.querySelector(".view-muted-image").addEventListener("click", (e) => {
            let args = helpers.args.location;
            args.hash.set("view-muted", "1");
            helpers.set_page_url(args, false /* add_to_history */, "override-mute");
        });

        this.illust_data = await image_data.singleton().get_image_info(this.illust_id);

        // Stop if we were removed before the request finished.
        if(this.was_shutdown)
            return;
        
        // Show the user's avatar instead of the muted image.
        let user_info = await image_data.singleton().get_user_info(this.illust_data.userId);
        var img = this.root.querySelector(".muted-image");
        img.src = user_info.imageBig;

        let muted_tag = muting.singleton.any_tag_muted(this.illust_data.tagList);
        let muted_user = muting.singleton.is_muted_user_id(this.illust_data.userId);

        let muted_label = this.root.querySelector(".muted-label");
        if(muted_tag)
            tag_translations.get().set_translated_tag(muted_label, muted_tag);
        else if(muted_user)
            muted_label.innerText = this.illust_data.userName;
    }

    shutdown()
    {
        super.shutdown();

        this.root.parentNode.removeChild(this.root);
    }
}

