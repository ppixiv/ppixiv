// /discovery - Recommended Works

import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_Discovery extends DataSource
{
    get name() { return "discovery"; }
    get pageTitle() { return "Discovery"; }
    getDisplayingText() { return "Recommended Works"; }
    get ui() { return UI; }
    get estimatedItemsPerPage() { return 60; }

    async loadPageInternal(page)
    {
        // Get "mode" from the URL.  If it's not present, use "all".
        let mode = this.url.searchParams.get("mode") || "all";
        let result = await helpers.get_request("/ajax/discovery/artworks", {
            limit: this.estimatedItemsPerPage,
            mode: mode,
            lang: "en",
        });

        // result.body.recommendedIllusts[].recommendMethods, recommendSeedIllustIds
        // has info about why it recommended it.
        let thumbs = result.body.thumbnails.illust;
        await ppixiv.media_cache.add_media_infos_partial(thumbs, "normal");

        let mediaIds = [];
        for(let thumb of thumbs)
            mediaIds.push(helpers.illust_id_to_media_id(thumb.id));

        ppixiv.tag_translations.add_translations_dict(result.body.tagTranslation);
        this.addPage(page, mediaIds);
    }
}

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div>
                <div class=box-button-row>
                    ${ helpers.create_box_link({label: "All",      popup: "Show all works",    data_type: "all" }) }
                    ${ helpers.create_box_link({label: "All ages", popup: "All ages",          data_type: "safe" }) }
                    ${ helpers.create_box_link({label: "R18",      popup: "R18",               data_type: "r18", classes: ["r18"] }) }
                </div>
            </div>
        `});

        dataSource.setItem(this.container, { type: "all", fields: {mode: "all"}, defaults: {mode: "all"} });
        dataSource.setItem(this.container, { type: "safe", fields: {mode: "safe"}, defaults: {mode: "all"} });
        dataSource.setItem(this.container, { type: "r18", fields: {mode: "r18"}, defaults: {mode: "all"} });
    }
}
