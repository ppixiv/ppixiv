"use strict";

// This is used to display a muted image.
ppixiv.viewer_muted = class extends ppixiv.viewer
{
    constructor(container, illust_id)
    {
        super(container, illust_id);

        this.container = container;

        // Create the display.
        this.root = helpers.create_from_template(".template-muted");
        container.appendChild(this.root);

        this.load();
    }

    async load()
    {
        this.illust_data = await image_data.singleton().get_image_info(this.illust_id);

        // Stop if we were removed before the request finished.
        if(this.was_shutdown)
            return;
        
        // Show the user's avatar instead of the muted image.
        let user_info = await image_data.singleton().get_user_info(this.illust_data.userId);
        console.log(user_info);
        var img = this.root.querySelector(".muted-image");
        img.src = user_info.imageBig;

        let muted_tag = muting.singleton.any_tag_muted(this.illust_data.tags.tags);
        let muted_user = muting.singleton.is_muted_user_id(this.illust_data.userId);

        let muted_label = this.root.querySelector(".muted-label");
        if(muted_tag)
        {
            let translated_tags = await tag_translations.get().get_translations([muted_tag], "en");
            if(translated_tags[muted_tag])
                muted_tag = translated_tags[muted_tag];
            muted_label.innerText = muted_tag;
        }
        else
            muted_label.innerText = this.illust_data.userName;
    }

    shutdown()
    {
        super.shutdown();

        this.root.parentNode.removeChild(this.root);
    }
}

