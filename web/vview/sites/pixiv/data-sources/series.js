import DataSource from '/vview/sites/data-source.js';
import { helpers } from '/vview/misc/helpers.js';

// /user/#/series/#
export default class DataSource_MangaPages extends DataSource
{
    get name() { return "series"; }

    constructor(args)
    {
        super(args);

        this.seriesInfo = null;
        this.userInfo = null;

        // /user/#/series/#
        let url = new URL(this.url);
        url = helpers.pixiv.getUrlWithoutLanguage(url);
        let parts = url.pathname.split("/");
        this.seriesId = parts[4];
    }

    async loadPageInternal(page)
    {
        let url = `/ajax/series/${this.seriesId}`;
        let result = await helpers.pixivRequest.get(url, { p: page });
        if(result.error)
        {
            ppixiv.message.show("Error reading series: " + result.message);
            return;
        }

        let { body } = result;

        // Add translations.
        let translations = [];
        for(let tag of Object.keys(body.tagTranslation))
        {
            translations.push({
                tag: tag,
                translation: body.tagTranslation[tag],
            });
        }
        ppixiv.tagTranslations.addTranslations(translations);

        // Find the series and user in the results.
        this.seriesInfo = helpers.other.findById(body.illustSeries, "id", this.seriesId);
        this.userInfo = helpers.other.findById(body.users, "userId", this.seriesInfo.userId);

        // Refresh the title.
        this.callUpdateListeners();

        // Register info.
        await ppixiv.mediaCache.addMediaInfosPartial(body.thumbnails.illust, "normal");

        // Add each page on each post in the series, sorting by order.
        let mediaIds = [];
        let seriesPageInfo = body.page;
        let seriesPages = seriesPageInfo.series;
        seriesPages.sort((lhs, rhs) => rhs.order - lhs.order);

        for(let seriesPage of seriesPages)
        {
            let illustId = seriesPage.workId;
            let mediaId = helpers.mediaId.fromIllustId(illustId, 0);
            mediaIds.push(mediaId);
        }

        return { mediaIds };
    }

    get pageTitle()
    {
        if(this.seriesInfo)
            return this.userInfo.name + " - " + this.seriesInfo.title;
        else
            return "Series";
    }

    getDisplayingText()
    {
        if(this.seriesInfo)
            return this.userInfo.name + " - " + this.seriesInfo.title;
        else
            return "Series";
    };

    get uiInfo()
    {
        let headerStripURL = this.seriesInfo?.url;
        return {
            userId: this.userInfo?.userId,
            headerStripURL,
        }
    }
}
