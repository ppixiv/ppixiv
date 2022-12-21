import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

// new_illust.php
export default class DataSource_NewPostsByEveryone extends DataSource
{
    get name() { return "new_illust"; }

    get page_title()
    {
        return "New Works";
    }

    get_displaying_text()
    {
        return "New Works";
    };

    async load_page_internal(page)
    {
        let args = new helpers.args(this.url);

        // new_illust.php or new_illust_r18.php:
        let r18 = this.url.pathname == "/new_illust_r18.php";
        var type = args.query.get("type") || "illust";
        
        // Everything Pixiv does has always been based on page numbers, but this one uses starting IDs.
        // That's a better way (avoids duplicates when moving forward in the list), but it's inconsistent
        // with everything else.  We usually load from page 1 upwards.  If we're loading the next page and
        // we have a previous last_id, assume it starts at that ID.
        //
        // This makes some assumptions about how we're called: that we won't be called for the same page
        // multiple times and we're always loaded in ascending order.  In practice this is almost always
        // true.  If Pixiv starts using this method for more important pages it might be worth checking
        // this more carefully.
        if(this.last_id == null)
        {
            this.last_id = 0;
            this.last_id_page = 1;
        }

        if(this.last_id_page != page)
        {
            console.error("Pages weren't loaded in order");
            return;
        }

        console.log("Assuming page", page, "starts at", this.last_id);

        var url = "/ajax/illust/new";
        var result = await helpers.get_request(url, {
            limit: 20,
            type: type,
            r18: r18,
            lastId: this.last_id,
        });

        if(result.body.illusts.length > 0)
        {
            this.last_id = result.body.illusts[result.body.illusts.length-1].id;
            this.last_id_page++;
        }

        let media_ids = [];
        for(var illust_data of result.body.illusts)
            media_ids.push(helpers.illust_id_to_media_id(illust_data.id));

        await ppixiv.media_cache.add_media_infos_partial(result.body.illusts, "normal");

        // Register the new page of data.
        this.add_page(page, media_ids);
    }

    get ui()
    {
        return class extends Widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class=box-button-row>
                            <div class=box-button-row>
                                ${ helpers.create_box_link({label: "Illustrations", popup: "Show illustrations",     data_type: "new-illust-type-illust" }) }
                                ${ helpers.create_box_link({label: "Manga",         popup: "Show manga only",        data_type: "new-illust-type-manga" }) }
                            </div>

                            <div class=box-button-row>
                                ${ helpers.create_box_link({label: "R18",           popup: "Show only R18 works",         data_type: "new-illust-ages-r18" }) }
                            </div>
                        </div>
                    </div>
                `});

                data_source.set_item(this.container, { type: "new-illust-type-illust", fields: {type: null} });
                data_source.set_item(this.container, { type: "new-illust-type-manga", fields: {type: "manga"} });
        
                data_source.set_item(this.container, { type: "new-illust-ages-r18", toggle: true, url_format: "path",
                    fields: {"/path": "new_illust_r18.php"},
                    default_values: {"/path": "new_illust.php"},
                });
            }
        }
    }
}
