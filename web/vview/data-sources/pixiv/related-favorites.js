import { DataSourceFromPage } from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/ppixiv-imports.js';

// bookmark_detail.php
//
// This lists the users who publically bookmarked an illustration, linking to each users' bookmarks.
export default class DataSource_RelatedFavorites extends DataSourceFromPage
{
    get name() { return "illust-bookmarks"; }
    get can_return_manga() { return false; }
  
    constructor(url)
    {
        super(url);

        this.illust_info = null;
    }

    async load_page_internal(page)
    {
        // Get info for the illustration we're displaying bookmarks for.
        var query_args = this.url.searchParams;
        var illust_id = query_args.get("illust_id");
        let mediaId = helpers.illust_id_to_media_id(illust_id)
        this.illust_info = await ppixiv.media_cache.get_media_info(mediaId);
        this.call_update_listeners();

        return super.load_page_internal(page);
    }

    // Parse the loaded document and return the illust_ids.
    parse_document(doc)
    {
        var ids = [];
        for(var element of doc.querySelectorAll("li.bookmark-item a[data-user_id]"))
        {
            // Register this as quick user data, for use in thumbnails.
            extra_cache.singleton().add_quick_user_data({
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
        if(this.illust_info)
        {
            imageLinkUrl = `/artworks/${this.illust_info.id}#ppixiv`;
            imageUrl = this.illust_info.previewUrls[0];
        }

        return { imageUrl, imageLinkUrl };
    }

    get page_title()
    {
        return "Similar Bookmarks";
    };

    get_displaying_text()
    {
        if(this.illust_info)
            return "Users who bookmarked " + this.illust_info.illustTitle;
        else
            return "Users who bookmarked image";
    };
}
