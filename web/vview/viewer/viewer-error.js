import Viewer from 'vview/viewer/viewer.js';

// This is used to display muted images, and images that returned an error.
export default class ViewerError extends Viewer
{
    constructor({
        ...options
    }={})
    {
        super({...options, template: `
            <div class="viewer viewer-error">
                <img class=muted-image>
                <div class=error-text-container>
                    <span class=muted-label hidden>Muted:</span>
                    <span class=error-text></span>
                    <div class=view-muted-image hidden>
                        View image
                    </div>
                </div>
            </div>
        `});

        this.container.querySelector(".view-muted-image").addEventListener("click", (e) => {
            let args = helpers.args.location;
            args.hash.set("view-muted", "1");
            helpers.navigate(args, { add_to_history: false, cause: "override-mute" });
        });

        this.error_text = this.container.querySelector(".error-text");

        // Just fire onready immediately for this viewer.
        this.ready.accept(true);
    }

    async load()
    {
        let { error, slideshow=false, onnextimage=() => { } } = this.options;

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

                onnextimage(this);
            })();
        }

        // If we were given an error message, just show it.
        if(error)
        {
            console.log("Showing error view:", error);
            this.error_text.innerText = error;
            return;
        }

        let illust_data = await ppixiv.mediaCache.get_media_info(this.mediaId);

        // Show the user's avatar instead of the muted image.
        let user_info = await ppixiv.userCache.get_user_info(illust_data.userId);
        if(user_info)
        {
            let img = this.container.querySelector(".muted-image");
            img.src = user_info.imageBig;
        }

        let muted_tag = ppixiv.muting.any_tag_muted(illust_data.tagList);
        let muted_user = ppixiv.muting.is_muted_user_id(illust_data.userId);
        console.log("x", muted_tag, muted_user);

        this.container.querySelector(".muted-label").hidden = false;
        this.container.querySelector(".view-muted-image").hidden = false;

        if(muted_tag)
        {
            let translated_tag = await ppixiv.tagTranslations.get_translation(muted_tag);
            this.error_text.innerText = translated_tag;
        }
        else if(muted_user)
            this.error_text.innerText = illust_data.userName;
    }

    shutdown()
    {
        super.shutdown();

        this.slideshow_timer = null;
    }
}

