import DataSource from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/misc/helpers.js';

// /artworks/illust_id?manga - Viewing manga pages for an illustration
export default class DataSource_MangaPages extends DataSource
{
    get name() { return "manga"; }
    get includes_manga_pages() { return true; }

    constructor(url)
    {
        super(url);

        // /artworks/#
        url = new URL(url);
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");
        let illust_id = parts[2];
        this.mediaId = helpers.illust_id_to_media_id(illust_id);
    }

    async load_page_internal(page)
    {
        if(page != 1)
            return;

        // We need full illust info for get_manga_aspect_ratio, but we can fill out most of the
        // UI with thumbnail or illust info.  Load whichever one we have first and update, so we
        // display initial info quickly.
        this.media_info = await ppixiv.media_cache.get_media_info(this.mediaId, { full: false });
        this.call_update_listeners();

        // Load media info before continuing.
        this.illust_info = await ppixiv.media_cache.get_media_info(this.mediaId);
        if(this.illust_info == null)
            return;

        let page_media_ids = [];
        for(let page = 0; page < this.illust_info.pageCount; ++page)
            page_media_ids.push(helpers.get_media_id_for_page(this.mediaId, page));

        this.add_page(page, page_media_ids);
    }

    get page_title()
    {
        if(this.media_info)
            return this.media_info.userName + " - " + this.media_info.illustTitle;
        else
            return "Illustrations";
    }

    get_displaying_text()
    {
        if(this.media_info)
            return this.media_info.illustTitle + " by " + this.media_info.userName;
        else
            return "Illustrations";
    };

    // If all pages of the manga post we're viewing have around the same aspect ratio, use it
    // for thumbnails.
    get_thumbnail_aspect_ratio()
    {
        if(this.illust_info == null)
            return null;

        return helpers.get_manga_aspect_ratio(this.illust_info.mangaPages);
    }

    get uiInfo()
    {
        return {
            userId: this.media_info?.userId,
        }
    }
};
