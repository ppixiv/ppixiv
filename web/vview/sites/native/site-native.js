import * as Site from '/vview/sites/site.js';
import LocalAPI from '/vview/misc/local-api.js';
import { helpers } from '/vview/misc/helpers.js';

import { VView, VViewSearch } from '/vview/sites/native/data-sources/vview.js';
import VViewSimilar from '/vview/sites/native/data-sources/similar.js';

export default class SiteNative extends Site.Site
{
    async init()
    {
        helpers.html.setClass(document.body, "native", ppixiv.native);

        // If enabled, cache local info which tells us what we have access to.
        await LocalAPI.loadLocalInfo();

        // If login is required to do anything, no API calls will succeed.  Stop now and
        // just redirect to login.  This is only for the local API.
        if(LocalAPI.localInfo.enabled && LocalAPI.localInfo.loginRequired)
        {
            LocalAPI.redirectToLogin();
            return false;
        }

        return true;
    }

    getDataSourceForUrl(url)
    {
        url = new URL(url);
        let args = new helpers.args(url);

        if(args.path == "/similar")
            return VViewSimilar;
        
        let { searchOptions } = LocalAPI.getSearchOptionsForArgs(args);
        if(searchOptions == null && !LocalAPI.localInfo.bookmark_tag_searches_only)
            return VView;
        else
            return VViewSearch;
    }

    async setInitialUrl()
    {
        if(document.location.hash != "")
            return;

        // If we're limited to tag searches, we don't view folders.  Just set the URL
        // to "/".
        if(LocalAPI.localInfo.bookmark_tag_searches_only)
        {
            let args = helpers.args.location;
            args.hashPath = "/";
            helpers.navigate(args, { addToHistory: false, cause: "initial" });
            return;
        }

        // Read the folder list.  If we have any mounts, navigate to the first one.  Otherwise,
        // show folder:/ as a fallback.
        let mediaId = "folder:/";
        let result = await ppixiv.mediaCache.localSearch(mediaId);
        if(result.results.length)
            mediaId = result.results[0].mediaId;

        let args = helpers.args.location;
        LocalAPI.getArgsForId(mediaId, args);
        helpers.navigate(args, { addToHistory: false, cause: "initial" });
    }
}
