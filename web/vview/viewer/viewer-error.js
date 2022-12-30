import Viewer from 'vview/viewer/viewer.js';
import { helpers } from 'vview/misc/helpers.js';

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

        this.root.querySelector(".view-muted-image").addEventListener("click", (e) => {
            // Add view-muted to the URL to override the mute for this image.
            let args = helpers.args.location;
            args.hash.set("view-muted", "1");
            helpers.navigate(args, { addToHistory: false, cause: "override-mute" });
        });

        this.errorText = this.root.querySelector(".error-text");

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
            let slideshowTimer = this._slideshowTimer = (async() => {
                await helpers.other.sleep(2000);
                if(slideshowTimer != this._slideshowTimer)
                    return;

                onnextimage(this);
            })();
        }

        // If we were given an error message, just show it.
        if(error)
        {
            console.log("Showing error view:", error);
            this.errorText.innerText = error;
            return;
        }

        // Show the user's avatar instead of the muted image.
        let mediaInfo = await ppixiv.mediaCache.getMediaInfo(this.mediaId);
        let userInfo = await ppixiv.userCache.getUserInfo(mediaInfo.userId);
        if(userInfo)
        {
            let img = this.root.querySelector(".muted-image");
            img.src = userInfo.imageBig;
        }

        let mutedTag = ppixiv.muting.anyTagMuted(mediaInfo.tagList);
        let mutedUser = ppixiv.muting.isUserIdMuted(mediaInfo.userId);

        this.root.querySelector(".muted-label").hidden = false;
        this.root.querySelector(".view-muted-image").hidden = false;

        if(mutedTag)
        {
            let translatedTag = await ppixiv.tagTranslations.getTranslation(mutedTag);
            this.errorText.innerText = translatedTag;
        }
        else if(mutedUser)
            this.errorText.innerText = mediaInfo.userName;
    }

    shutdown()
    {
        super.shutdown();

        this._slideshowTimer = null;
    }
}

