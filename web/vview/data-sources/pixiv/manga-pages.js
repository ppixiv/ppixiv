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
        url = helpers.pixiv.getUrlWithoutLanguage(url);
        let parts = url.pathname.split("/");
        let illustId = parts[2];
        this.mediaId = helpers.mediaId.fromIllustId(illustId);
    }

    async loadPageInternal(page)
    {
        if(page != 1)
            return;

        // We need to load full illust info since SearchView is expecting us to, but we can fill
        // out most of the UI with thumbnail or illust info.  Load whichever one we have first
        // and update, so we display initial info quickly.
        this.mediaInfo = await ppixiv.mediaCache.getMediaInfo(this.mediaId, { full: false });
        this.callUpdateListeners();

        // Load media info before continuing.
        this.illustInfo = await ppixiv.mediaCache.getMediaInfo(this.mediaId);
        if(this.illustInfo == null)
            return;

        let mediaIds = [];
        for(let page = 0; page < this.illustInfo.pageCount; ++page)
            mediaIds.push(helpers.mediaId.getMediaIdForPage(this.mediaId, page));

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
