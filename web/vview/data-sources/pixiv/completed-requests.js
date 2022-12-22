import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSources_CompletedRequests extends DataSource
{
    get name() { return "completed-requests"; }
    get pageTitle() { return "Completed requests"; };
    getDisplayingText() { return "Completed requests"; }
    get ui() { return UI; }
    get supportsStartPage() { return true; }

    async loadPageInternal(page)
    {
        let args = new helpers.args(new URL(this.url));
        let showing = args.get("type") || "latest"; // "latest" or "recommended"
        let mode = args.get("mode") || "all";
        let type = args.get_pathname_segment(2); // "illust" in "request/complete/illust"

        let result = await helpers.get_request(`/ajax/commission/page/request/complete/${type}`, {
            mode,
            p: page,
            lang: "en",
        });

        // Convert the request data from an array to a dictionary.
        let request_data = {};
        for(let request of result.body.requests)
            request_data[request.requestId] = request;
        
        for(let user of result.body.users)
            ppixiv.user_cache.add_user_data(user);

        await ppixiv.media_cache.add_media_infos_partial(result.body.thumbnails.illust, "normal");
        ppixiv.tag_translations.add_translations_dict(result.body.tagTranslation);

        let mediaIds = [];
        let requestIds = result.body.page[showing == "latest"? "requestIds":"recommendRequestIds"];
        if(requestIds == null)
            return;

        for(let requestId of requestIds)
        {
            // This has info for the request, like the requester and request text, but we just show these
            // as regular posts.
            let request = request_data[requestId];
            let request_post_id = request.postWork.postWorkId;
            let mediaId = helpers.illust_id_to_media_id(request_post_id);

            // This returns a lot of post IDs that don't exist.  Why are people deleting so many of these?
            // Check whether the post was in result.body.thumbnails.illust.
            if(ppixiv.media_cache.get_media_info_sync(mediaId, { full: false }) == null)
                continue;

            mediaIds.push(mediaId);
        }

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
                <div class="box-button-row">
                    <div style="margin-right: 25px;">
                        ${ helpers.create_box_link({label: "Latest",        popup: "Show latest completed requests",       data_type: "completed-requests-latest" }) }
                        ${ helpers.create_box_link({label: "Recommended",   popup: "Show recommmended completed requests", data_type: "completed-requests-recommended" }) }
                    </div>

                    <div style="margin-right: 25px;">
                        ${ helpers.create_box_link({label: "Illustrations", popup: "Show latest completed requests",       data_type: "completed-requests-illust" }) }
                        ${ helpers.create_box_link({label: "Animations",    popup: "Show animations only",                 data_type: "completed-requests-ugoira" }) }
                        ${ helpers.create_box_link({label: "Manga",         popup: "Show manga only",                      data_type: "completed-requests-manga" }) }
                    </div>

                    <div>
                        ${ helpers.create_box_link({label: "All",           popup: "Show all works",                       data_type: "completed-requests-all" }) }
                        ${ helpers.create_box_link({label: "All ages",      popup: "Show all-ages works",                  data_type: "completed-requests-safe" }) }
                        ${ helpers.create_box_link({label: "R18",           popup: "Show R18 works",                       data_type: "completed-requests-r18", classes: ["r18"] }) }
                    </div>
                </div>
            </div>
        `});

        dataSource.setItem(this.container, { type: "completed-requests-latest", fields: {type: "latest"}, defaults: {type: "latest"}});
        dataSource.setItem(this.container, { type: "completed-requests-recommended", fields: {type: "recommended"}, defaults: {type: "latest"}});

        dataSource.setItem(this.container, { type: "completed-requests-all", fields: {mode: "all"}, defaults: {mode: "all"}});
        dataSource.setItem(this.container, { type: "completed-requests-safe", fields: {mode: "safe"}, defaults: {mode: "all"}});
        dataSource.setItem(this.container, { type: "completed-requests-r18", fields: {mode: "r18"}, defaults: {mode: "all"}});

        let urlFormat = "request/complete/type";
        dataSource.setItem(this.container, { urlFormat: urlFormat, type: "completed-requests-illust", fields: {"/type": "illust"} });
        dataSource.setItem(this.container, { urlFormat: urlFormat, type: "completed-requests-ugoira", fields: {"/type": "ugoira"} });
        dataSource.setItem(this.container, { urlFormat: urlFormat, type: "completed-requests-manga", fields: {"/type": "manga"} });
    }
}
