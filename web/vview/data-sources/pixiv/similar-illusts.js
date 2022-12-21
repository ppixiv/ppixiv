// bookmark_detail.php#recommendations=1 - Similar Illustrations
//
// We use this as an anchor page for viewing recommended illusts for an image, since
// there's no dedicated page for this.

import DataSource from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_SimilarIllusts extends DataSource
{
    get name() { return "related-illusts"; }
   
    get estimated_items_per_page() { return 60; }

    async _load_page_async(page, cause)
    {
        // The first time we load a page, get info about the source illustration too, so
        // we can show it in the UI.
        if(!this.fetched_illust_info)
        {
            this.fetched_illust_info = true;

            // Don't wait for this to finish before continuing.
            let illust_id = this.url.searchParams.get("illust_id");
            let mediaId = helpers.illust_id_to_media_id(illust_id)
            ppixiv.media_cache.get_media_info(mediaId).then((illust_info) => {
                this.illust_info = illust_info;
                this.call_update_listeners();
            }).catch((e) => {
                console.error(e);
            });
        }

        return await super._load_page_async(page, cause);
    }
     
    async load_page_internal(page)
    {
        // Don't load more than one page.  Related illusts for the same post generally
        // returns the same results, so if we load more pages we can end up making lots of
        // requests that give only one or two new images each, and end up loading up to
        // page 5 or 6 for just a few extra results.
        if(page > 1)
            return;

        // Get "mode" from the URL.  If it's not present, use "all".
        let mode = this.url.searchParams.get("mode") || "all";
        let result = await helpers.get_request("/ajax/discovery/artworks", {
            sampleIllustId: this.url.searchParams.get("illust_id"),
            mode: mode,
            limit: this.estimated_items_per_page,
            lang: "en",
        });

        // result.body.recommendedIllusts[].recommendMethods, recommendSeedIllustIds
        // has info about why it recommended it.
        let thumbs = result.body.thumbnails.illust;
        await ppixiv.media_cache.add_media_infos_partial(thumbs, "normal");

        let media_ids = [];
        for(let thumb of thumbs)
            media_ids.push(helpers.illust_id_to_media_id(thumb.id));

        ppixiv.tag_translations.add_translations_dict(result.body.tagTranslation);
        this.add_page(page, media_ids);
    };

    get page_title() { return "Similar Illusts"; }
    get_displaying_text() { return "Similar Illustrations"; }

    get uiInfo()
    {
        let imageUrl = null;
        let imageLinkUrl = null;
        if(this.illust_info)
        {
            imageLinkUrl = `/artworks/${this.illust_info.illustId}#ppixiv`;
            imageUrl = this.illust_info.previewUrls[0];
        }

        return { imageUrl, imageLinkUrl };
    }
}
