import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

// new_illust.php
export default class DataSource_NewPostsByEveryone extends DataSource
{
    get name() { return "new_illust"; }
    get pageTitle() { return "New Works"; }
    getDisplayingText() { return "New Works"; }
    get ui() { return UI; }

    async loadPageInternal(page)
    {
        let args = new helpers.args(this.url);

        // new_illust.php or new_illust_r18.php:
        let r18 = this.url.pathname == "/new_illust_r18.php";
        let type = args.query.get("type") || "illust";
        
        // Everything Pixiv does has always been based on page numbers, but this one uses starting IDs.
        // That's a better way (avoids duplicates when moving forward in the list), but it's inconsistent
        // with everything else.  We usually load from page 1 upwards.  If we're loading the next page and
        // we have a previous last_id, assume it starts at that ID.
        //
        // This makes some assumptions about how we're called: that we won't be called for the same page
        // multiple times and we're always loaded in ascending order.  In practice this is almost always
        // true.  If Pixiv starts using this method for more important pages it might be worth checking
        // this more carefully.
        if(this.lastId == null)
        {
            this.lastId = 0;
            this.lastId_page = 1;
        }

        if(this.lastId_page != page)
        {
            console.error("Pages weren't loaded in order");
            return;
        }

        console.log("Assuming page", page, "starts at", this.lastId);

        let url = "/ajax/illust/new";
        let result = await helpers.pixivRequest.get(url, {
            limit: 20,
            type: type,
            r18: r18,
            lastId: this.lastId,
        });

        if(result.body.illusts.length > 0)
        {
            this.lastId = result.body.illusts[result.body.illusts.length-1].id;
            this.lastId_page++;
        }

        let mediaIds = [];
        for(let illustData of result.body.illusts)
            mediaIds.push(helpers.mediaId.fromIllustId(illustData.id));

        await ppixiv.mediaCache.addMediaInfosPartial(result.body.illusts, "normal");

        // Register the new page of data.
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
                    <div class=box-button-row>
                        ${ helpers.createBoxLink({label: "Illustrations", popup: "Show illustrations",     dataType: "new-illust-type-illust" }) }
                        ${ helpers.createBoxLink({label: "Manga",         popup: "Show manga only",        dataType: "new-illust-type-manga" }) }
                    </div>

                    <div class=box-button-row>
                        ${ helpers.createBoxLink({label: "R18",           popup: "Show only R18 works",         dataType: "new-illust-ages-r18" }) }
                    </div>
                </div>
            </div>
        `});

        dataSource.setItem(this.container, { type: "new-illust-type-illust", fields: {type: null} });
        dataSource.setItem(this.container, { type: "new-illust-type-manga", fields: {type: "manga"} });

        dataSource.setItem(this.container, { type: "new-illust-ages-r18", toggle: true, urlFormat: "path",
            fields: {"/path": "new_illust_r18.php"},
            defaults: {"/path": "new_illust.php"},
        });
    }
}