import DataSource from 'vview/data-sources/data-source.js';
import LocalAPI from 'vview/misc/local-api.js';
import { getUrlForMediaId } from 'vview/misc/media-ids.js'
import { helpers } from 'vview/misc/helpers.js';

export default class DataSources_VViewSimilar extends DataSource
{
    get name() { return "similar"; }
    get pageTitle() { return this.getDisplayingText(); }
    getDisplayingText() { return `Similar images`; }
    get isVView() { return true; }

    async loadPageInternal(page)
    {
        if(page != 1)
            return;

        // We can be given a local path or a URL to an image to search for.
        let args = new helpers.args(this.url);
        let path = args.hash.get("search_path");
        let url = args.hash.get("search_url");

        let result = await LocalAPI.localPostRequest(`/api/similar/search`, {
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
            LocalAPI.adjustIllustInfo(entry);
            await ppixiv.mediaCache.addMediaInfoFull(entry, { preprocessed: true });

            mediaIds.push(entry.mediaId);
        }

        await this.addPage(page, mediaIds);
    };

    // We only load one page of results.
    canLoadPage(page)
    {
        return page == 1;
    }

    setPageIcon()
    {
        helpers.setIcon({vview: true});
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
                let mediaId = helpers.mediaId.encodeMediaId({type: "file", id: path});
                let linkArgs = getUrlForMediaId(mediaId);
                imageLinkUrl = linkArgs;
            }
        }

        return { imageUrl, imageLinkUrl };
    }
}
