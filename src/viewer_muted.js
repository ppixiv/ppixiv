"use strict";

// This is used to display a muted image.
this.viewer_muted = class extends this.viewer
{
    constructor(container, illust_data)
    {
        super(container, illust_data);

        this.container = container;

        // Create the display.
        this.root = helpers.create_from_template(".template-muted");
        container.appendChild(this.root);

        // Show the user's avatar instead of the muted image.
        var img = this.root.querySelector(".muted-image");
        img.src = illust_data.userInfo.imageBig;

        var muted_tag = muting.singleton.any_tag_muted(illust_data.tags.tags);
        var muted_user = muting.singleton.is_muted_user_id(illust_data.userId);

        var muted_label = this.root.querySelector(".muted-label");
        if(muted_tag)
            muted_label.innerText = muted_tag;
        else
            muted_label.innerText = illust_data.userInfo.name;
    }

    shutdown()
    {
        this.root.parentNode.removeChild(this.root);
    }
}

