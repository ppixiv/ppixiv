import DataSource from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/ppixiv-imports.js';

export default class DataSources_VViewSimilar extends DataSource
{
    get name() { return "similar"; }
    get is_vview() { return true; }
    get can_return_manga() { return false; }

    async load_page_internal(page)
    {
        if(page != 1)
            return;

        // We can be given a local path or a URL to an image to search for.
        let args = new helpers.args(this.url);
        let path = args.hash.get("search_path");
        let url = args.hash.get("search_url");

        let result = await local_api.local_post_request(`/api/similar/search`, {
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
        this.source_url = result.source_url;
        this.call_update_listeners();

        let media_ids = [];
        for(let item of result.results)
        {
            // console.log(item.score);

            // Register the results with media_cache.
            let entry = item.entry;
            ppixiv.local_api.adjust_illust_info(entry);
            await ppixiv.media_cache.add_media_info_full(entry, { preprocessed: true });

            media_ids.push(entry.mediaId);
        }

        this.add_page(page, media_ids);
    };

    // We only load one page of results.
    can_load_page(page)
    {
        return page == 1;
    }

    get page_title() { return this.get_displaying_text(); }

    set_page_icon()
    {
        helpers.set_icon({vview: true});
    }

    get_displaying_text()
    {
        return `Similar images`;
    }

    get uiInfo()
    {
        let imageUrl = null;
        let imageLinkUrl = null;
        if(this.source_url)
        {
            imageUrl = this.source_url;

            // If this is a search for a local path, link to the image.
            let args = new helpers.args(this.url);
            let path = args.hash.get("search_path");
            if(path)
            {
                let mediaId = helpers.encode_media_id({type: "file", id: path});
                let linkArgs = helpers.get_url_for_id(mediaId);
                imageLinkUrl = linkArgs;
            }
        }

        return { imageUrl, imageLinkUrl };
    }
}
