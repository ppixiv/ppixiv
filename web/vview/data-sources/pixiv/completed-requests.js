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
        let type = args.getPathnameSegment(2); // "illust" in "request/complete/illust"

        let result = await helpers.pixivRequest.get(`/ajax/commission/page/request/complete/${type}`, {
            mode,
            p: page,
            lang: "en",
        });

        // Convert the request data from an array to a dictionary.
        let request_data = {};
        for(let request of result.body.requests)
            request_data[request.requestId] = request;
        
        for(let user of result.body.users)
            ppixiv.userCache.addUserData(user);

        await ppixiv.mediaCache.addMediaInfosPartial(result.body.thumbnails.illust, "normal");
        ppixiv.tagTranslations.addTranslationsDict(result.body.tagTranslation);

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
            let mediaId = helpers.mediaId.fromIllustId(request_post_id);

            // This returns a lot of post IDs that don't exist.  Why are people deleting so many of these?
            // Check whether the post was in result.body.thumbnails.illust.
            if(ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false }) == null)
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
                        ${ helpers.createBoxLink({label: "Latest",        popup: "Show latest completed requests",       dataType: "completed-requests-latest" }) }
                        ${ helpers.createBoxLink({label: "Recommended",   popup: "Show recommmended completed requests", dataType: "completed-requests-recommended" }) }
                    </div>

                    <div style="margin-right: 25px;">
                        ${ helpers.createBoxLink({label: "Illustrations", popup: "Show latest completed requests",       dataType: "completed-requests-illust" }) }
                        ${ helpers.createBoxLink({label: "Animations",    popup: "Show animations only",                 dataType: "completed-requests-ugoira" }) }
                        ${ helpers.createBoxLink({label: "Manga",         popup: "Show manga only",                      dataType: "completed-requests-manga" }) }
                    </div>

                    <div>
                        ${ helpers.createBoxLink({label: "All",           popup: "Show all works",                       dataType: "completed-requests-all" }) }
                        ${ helpers.createBoxLink({label: "All ages",      popup: "Show all-ages works",                  dataType: "completed-requests-safe" }) }
                        ${ helpers.createBoxLink({label: "R18",           popup: "Show R18 works",                       dataType: "completed-requests-r18", classes: ["r18"] }) }
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
