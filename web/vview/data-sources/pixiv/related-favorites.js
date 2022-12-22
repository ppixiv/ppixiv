import { DataSourceFromPage } from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/misc/helpers.js';

// bookmark_detail.php
//
// This lists the users who publically bookmarked an illustration, linking to each users' bookmarks.
export default class DataSource_RelatedFavorites extends DataSourceFromPage
{
    get name() { return "illust-bookmarks"; }
    get pageTitle() { return "Similar Bookmarks"; }

    getDisplayingText()
    {
        if(this.illustInfo)
            return "Users who bookmarked " + this.illustInfo.illustTitle;
        else
            return "Users who bookmarked image";
    };
    
    constructor(url)
    {
        super(url);

        this.illustInfo = null;
    }

    async loadPageInternal(page)
    {
        // Get info for the illustration we're displaying bookmarks for.
        let queryArgs = this.url.searchParams;
        let illustId = queryArgs.get("illustId");
        let mediaId = helpers.illustIdToMediaId(illustId)
        this.illustInfo = await ppixiv.mediaCache.getMediaInfo(mediaId);
        this.callUpdateListeners();

        return super.loadPageInternal(page);
    }

    // Parse the loaded document and return the illust_ids.
    parseDocument(doc)
    {
        let ids = [];
        for(let element of doc.querySelectorAll("li.bookmark-item a[data-user_id]"))
        {
            // Register this as quick user data, for use in thumbnails.
            ppixiv.extraCache.addQuickUserData({
                user_id: element.dataset.user_id,
                user_name: element.dataset.user_name,

                // This page gives links to very low-res avatars.  Replace them with the high-res ones
                // that newer pages give.
                //
                // These links might be annoying animated GIFs, but we don't bother killing them here
                // like we do for the followed page since this isn't used very much.
                profile_img: element.dataset.profile_img.replace("_50.", "_170."),
            }, "users_bookmarking_illust");

            // The bookmarks: URL type will generate links to this user's bookmarks.
            ids.push("bookmarks:" + element.dataset.user_id);
        }
        return ids;
    }

    get uiInfo()
    {
        let imageUrl = null;
        let imageLinkUrl = null;
        if(this.illustInfo)
        {
            imageLinkUrl = `/artworks/${this.illustInfo.id}#ppixiv`;
            imageUrl = this.illustInfo.previewUrls[0];
        }

        return { imageUrl, imageLinkUrl };
    }
}
