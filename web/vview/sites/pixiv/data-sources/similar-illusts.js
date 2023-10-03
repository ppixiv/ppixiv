// bookmark_detail.php#recommendations=1 - Similar Illustrations
//
// We use this as an anchor page for viewing recommended illusts for an image, since
// there's no dedicated page for this.

import DataSource from '/vview/sites/data-source.js';
import { helpers } from '/vview/misc/helpers.js';

export default class DataSource_SimilarIllusts extends DataSource
{
    get name() { return "related-illusts"; }
    get pageTitle() { return "Similar Illusts"; }
    getDisplayingText() { return "Similar Illustrations"; }
    get estimatedItemsPerPage() { return 60; }

    async _loadPageAsync(page, args)
    {
        // The first time we load a page, get info about the source illustration too, so
        // we can show it in the UI.
        if(!this.fetchedMediaInfo)
        {
            this.fetchedMediaInfo = true;

            // Don't wait for this to finish before continuing.
            let illustId = this.url.searchParams.get("illust_id");
            let mediaId = helpers.mediaId.fromIllustId(illustId)
            ppixiv.mediaCache.getMediaInfo(mediaId).then((mediaInfo) => {
                this.mediaInfo = mediaInfo;
                this.callUpdateListeners();
            }).catch((e) => {
                console.error(e);
            });
        }

        return await super._loadPageAsync(page, args);
    }
     
    async loadPageInternal(page)
    {
        // Don't load more than one page.  Related illusts for the same post generally
        // returns the same results, so if we load more pages we can end up making lots of
        // requests that give only one or two new images each, and end up loading up to
        // page 5 or 6 for just a few extra results.
        if(page > 1)
            return;

        // Get "mode" from the URL.  If it's not present, use "all".
        let mode = this.url.searchParams.get("mode") || "all";
        let result = await helpers.pixivRequest.get("/ajax/discovery/artworks", {
            sampleIllustId: this.url.searchParams.get("illust_id"),
            mode: mode,
            limit: this.estimatedItemsPerPage,
            lang: "en",
        });

        // result.body.recommendedIllusts[].recommendMethods, recommendSeedIllustIds
        // has info about why it recommended it.
        let thumbs = result.body.thumbnails.illust;
        await ppixiv.mediaCache.addMediaInfosPartial(thumbs, "normal");

        ppixiv.tagTranslations.addTranslationsDict(result.body.tagTranslation);

        let mediaIds = [];
        for(let thumb of thumbs)
            mediaIds.push(helpers.mediaId.fromIllustId(thumb.id));

        return { mediaIds };
    };

    get uiInfo()
    {
        let imageUrl = null;
        let imageLinkUrl = null;
        if(this.mediaInfo)
        {
            imageLinkUrl = `/artworks/${this.mediaInfo.illustId}#ppixiv`;
            imageUrl = this.mediaInfo.previewUrls[0];
        }

        return { imageUrl, imageLinkUrl };
    }
}
