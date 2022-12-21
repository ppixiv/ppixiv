// /discovery - Recommended Works

import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_Discovery extends DataSource
{
    get name() { return "discovery"; }

    get estimated_items_per_page() { return 60; }

    async load_page_internal(page)
    {
        // Get "mode" from the URL.  If it's not present, use "all".
        let mode = this.url.searchParams.get("mode") || "all";
        let result = await helpers.get_request("/ajax/discovery/artworks", {
            limit: this.estimated_items_per_page,
            mode: mode,
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

    get page_title() { return "Discovery"; }
    get_displaying_text() { return "Recommended Works"; }

    get ui()
    {
        return class extends Widget
        {
            constructor({ data_source, ...options })
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

                data_source.set_item(this.container, { type: "all", fields: {mode: "all"}, default_values: {mode: "all"} });
                data_source.set_item(this.container, { type: "safe", fields: {mode: "safe"}, default_values: {mode: "all"} });
                data_source.set_item(this.container, { type: "r18", fields: {mode: "r18"}, default_values: {mode: "all"} });
            }
        }
    }
}
