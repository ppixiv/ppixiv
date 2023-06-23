import DataSource from '/vview/data-sources/data-source.js';
import { helpers } from '/vview/misc/helpers.js';

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
        url = helpers.pixiv.getUrlWithoutLanguage(url);
        let parts = url.pathname.split("/");
        let illustId = parts[2];
        this.mediaId = helpers.mediaId.fromIllustId(illustId);
    }

    async loadPageInternal(page)
    {
        if(page != 1)
            return;

        // Get media info for the page count.
        this.mediaInfo = await ppixiv.mediaCache.getMediaInfo(this.mediaId, { full: false });
        if(this.mediaInfo == null)
            return;

        // Refresh the title.
        this.callUpdateListeners();

        let mediaIds = [];
        for(let page = 0; page < this.mediaInfo.pageCount; ++page)
            mediaIds.push(helpers.mediaId.getMediaIdForPage(this.mediaId, page));

        // Preload thumbs before continuing.  This allows extraCache to know the aspect ratio of
        // the image, so it's available to SearchView for aspect ratio thumbs.  These will often
        // already be cached from the view we came here from.
        let { promise } = ppixiv.extraCache.batchGetMediaAspectRatio(mediaIds);
        await promise;

        return { mediaIds };
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

    get uiInfo()
    {
        return {
            userId: this.mediaInfo?.userId,
        }
    }
}
