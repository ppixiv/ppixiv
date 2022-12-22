import DataSource from 'vview/data-sources/data-source.js';
import LocalAPI from 'vview/misc/local-api.js';
import { getUrlForMediaId } from 'vview/misc/media-ids.js'
import { helpers } from 'vview/misc/helpers.js';

export default class DataSources_VViewSimilar extends DataSource
{
    get name() { return "similar"; }
    get pageTitle() { return this.getDisplayingText(); }
    getDisplayingText() { return `Similar images`; }
    get is_vview() { return true; }

    async loadPageInternal(page)
    {
        if(page != 1)
            return;

        // We can be given a local path or a URL to an image to search for.
        let args = new helpers.args(this.url);
        let path = args.hash.get("search_path");
        let url = args.hash.get("searchUrl");

        let result = await LocalAPI.local_post_request(`/api/similar/search`, {
            path,
            url,
            max_results: 10,
        });

        if(!result.success)
        {
            ppixiv.message.show("Error reading search: " + result.reason);
            return result;
        }

        // This is a URL to the original image we're searching for.
        this.sourceUrl = result.source_url;
        this.callUpdateListeners();

        let mediaIds = [];
        for(let item of result.results)
        {
            // console.log(item.score);

            // Register the results with media_cache.
            let entry = item.entry;
            LocalAPI.adjust_illust_info(entry);
            await ppixiv.media_cache.add_media_info_full(entry, { preprocessed: true });

            mediaIds.push(entry.mediaId);
        }

        this.addPage(page, mediaIds);
    };

    // We only load one page of results.
    canLoadPage(page)
    {
        return page == 1;
    }

    setPageIcon()
    {
        helpers.set_icon({vview: true});
    }

    get uiInfo()
    {
        let imageUrl = null;
        let imageLinkUrl = null;
        if(this.sourceUrl)
        {
            imageUrl = this.sourceUrl;

            // If this is a search for a local path, link to the image.
            let args = new helpers.args(this.url);
            let path = args.hash.get("search_path");
            if(path)
            {
                let mediaId = helpers.encode_media_id({type: "file", id: path});
                let linkArgs = getUrlForMediaId(mediaId);
                imageLinkUrl = linkArgs;
            }
        }

        return { imageUrl, imageLinkUrl };
    }
}
