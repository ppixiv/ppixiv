import * as Site from '/vview/sites/site.js';
import LocalAPI from '/vview/misc/local-api.js';

import { VView, VViewSearch } from '/vview/sites/native/data-sources/vview.js';
import VViewSimilar from '/vview/sites/native/data-sources/similar.js';

class SiteNative extends Site.Site
{
    createDataSourceForUrl({ url, args })
    {
        if(args.path == "/similar")
            return VViewSimilar;
        
        let { searchOptions } = LocalAPI.getSearchOptionsForArgs(args);
        if(searchOptions == null && !LocalAPI.localInfo.bookmark_tag_searches_only)
            return VView;
        else
            return VViewSearch;
    }
}

export function register()
{
    if(!ppixiv.native)
        return;

    Site.registerSite(document.location.hostname, new SiteNative());
}
