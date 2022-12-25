import LocalAPI from 'vview/misc/local-api.js';
import { helpers } from 'vview/misc/helpers.js';

// Return the canonical URL for an illust.  For most URLs this is
// /artworks/12345.  If manga is true, return the manga viewer page.
export function getUrlForMediaId(mediaId, { manga=false}={})
{
    if(helpers.mediaId.isLocal(mediaId))
    {
        // URLs for local files are handled differently.
        let args = helpers.args.location;
        LocalAPI.getArgsForId(mediaId, args);
        args.hash.set("view", "illust");
        return args;
    }

    let [illustId, page] = helpers.mediaId.toIllustIdAndPage(mediaId);
    let args = new helpers.args("/", ppixiv.plocation);
    args.path  = `/artworks/${illustId}`;

    if(manga)
        args.hash.set("manga", "1");

    if(page != null && page > 0)
        args.hash.set("page", page+1);

    return args;
}
