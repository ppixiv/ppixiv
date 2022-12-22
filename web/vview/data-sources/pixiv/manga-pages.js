import DataSource from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/misc/helpers.js';

// /artworks/illust_id?manga - Viewing manga pages for an illustration
export default class DataSource_MangaPages extends DataSource
{
    get name() { return "manga"; }
    get allowExpandingMangaPages() { return false; }

    constructor(url)
    {
        super(url);

        // /artworks/#
        url = new URL(url);
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");
        let illustId = parts[2];
        this.mediaId = helpers.illust_id_to_media_id(illustId);
    }

    async loadPageInternal(page)
    {
        if(page != 1)
            return;

        // We need full illust info for get_manga_aspect_ratio, but we can fill out most of the
        // UI with thumbnail or illust info.  Load whichever one we have first and update, so we
        // display initial info quickly.
        this.mediaInfo = await ppixiv.media_cache.get_media_info(this.mediaId, { full: false });
        this.callUpdateListeners();

        // Load media info before continuing.
        this.illustInfo = await ppixiv.media_cache.get_media_info(this.mediaId);
        if(this.illustInfo == null)
            return;

        let pageMediaIds = [];
        for(let page = 0; page < this.illustInfo.pageCount; ++page)
            pageMediaIds.push(helpers.get_media_id_for_page(this.mediaId, page));

        this.addPage(page, pageMediaIds);
    }

    get pageTitle()
    {
        if(this.mediaInfo)
            return this.mediaInfo.userName + " - " + this.mediaInfo.illustTitle;
        else
            return "Illustrations";
    }

    getDisplayingText()
    {
        if(this.mediaInfo)
            return this.mediaInfo.illustTitle + " by " + this.mediaInfo.userName;
        else
            return "Illustrations";
    };

    // If all pages of the manga post we're viewing have around the same aspect ratio, use it
    // for thumbnails.
    getThumbnailAspectRatio()
    {
        if(this.illustInfo == null)
            return null;

        return helpers.get_manga_aspect_ratio(this.illustInfo.mangaPages);
    }

    get uiInfo()
    {
        return {
            userId: this.mediaInfo?.userId,
        }
    }
}
