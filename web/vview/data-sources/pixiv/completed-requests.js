import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/ppixiv-imports.js';

export default class DataSources_CompletedRequests extends DataSource
{
    get name() { return "completed-requests"; }
  
    get supports_start_page()
    {
        return true;
    }

    async load_page_internal(page)
    {
        let args = new helpers.args(new URL(this.url));
        let showing = args.get("type") || "latest"; // "latest" or "recommended"
        let mode = args.get("mode") || "all";
        let type = args.get_pathname_segment(2); // "illust" in "request/complete/illust"

        let url = `/ajax/commission/page/request/complete/${type}`;
        let request_args = {
            "mode": mode,
            "p": page,
            "lang": "en",
        };
        let result = await helpers.get_request(url, request_args);

        // Convert the request data from an array to a dictionary.
        let request_data = {};
        for(let request of result.body.requests)
            request_data[request.requestId] = request;
        
        for(let user of result.body.users)
            ppixiv.user_cache.add_user_data(user);

        await ppixiv.media_cache.add_media_infos_partial(result.body.thumbnails.illust, "normal");
        ppixiv.tag_translations.add_translations_dict(result.body.tagTranslation);

        let media_ids = [];
        let request_ids = result.body.page[showing == "latest"? "requestIds":"recommendRequestIds"];
        if(request_ids == null)
            return;

        for(let request_id of request_ids)
        {
            // This has info for the request, like the requester and request text, but we just show these
            // as regular posts.
            let request = request_data[request_id];
            let request_post_id = request.postWork.postWorkId;
            let mediaId = helpers.illust_id_to_media_id(request_post_id);

            // This returns a lot of post IDs that don't exist.  Why are people deleting so many of these?
            // Check whether the post was in result.body.thumbnails.illust.
            if(ppixiv.media_cache.get_media_info_sync(mediaId, { full: false }) == null)
                continue;

            media_ids.push(mediaId);
        }

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

                data_source.set_item(this.container, { type: "completed-requests-latest", fields: {type: "latest"}, default_values: {type: "latest"}});
                data_source.set_item(this.container, { type: "completed-requests-recommended", fields: {type: "recommended"}, default_values: {type: "latest"}});
        
                data_source.set_item(this.container, { type: "completed-requests-all", fields: {mode: "all"}, default_values: {mode: "all"}});
                data_source.set_item(this.container, { type: "completed-requests-safe", fields: {mode: "safe"}, default_values: {mode: "all"}});
                data_source.set_item(this.container, { type: "completed-requests-r18", fields: {mode: "r18"}, default_values: {mode: "all"}});
        
                let url_format = "request/complete/type";
                data_source.set_item(this.container, { url_format: url_format, type: "completed-requests-illust", fields: {"/type": "illust"} });
                data_source.set_item(this.container, { url_format: url_format, type: "completed-requests-ugoira", fields: {"/type": "ugoira"} });
                data_source.set_item(this.container, { url_format: url_format, type: "completed-requests-manga", fields: {"/type": "manga"} });
            }
        }
    }

    get page_title() { return "Completed requests"; };
    get_displaying_text() { return "Completed requests"; }
}
