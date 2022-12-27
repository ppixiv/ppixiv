import DataSource from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/misc/helpers.js';

// /artworks/# - Viewing a single illustration
//
// This is a stub for when we're viewing an image with no search.  it
// doesn't return any search results.
export default class DataSource_Illust extends DataSource
{
    get name() { return "illust"; }

    constructor(url)
    {
        super(url);

        this.mediaId = this.getMediaIdFromUrl(new helpers.args(url));

        this._loadMediaInfo();
    }

    async _loadMediaInfo()
    {
        this.mediaInfo = await ppixiv.mediaCache.getMediaInfo(this.mediaId, { full: false });
    }

    // Show the illustration by default.
    get defaultScreen() { return "illust";}

    // This data source just views a single image and doesn't return any posts.
    async loadPageInternal(page) { }

    getMediaIdFromUrl(args)
    {
        // The illust ID is stored in the path, for compatibility with Pixiv URLs:
        //
        // https://www.pixiv.net/en/users/#/artworks
        //
        // The page (if any) is stored in the hash.
        let url = args.url;
        url = helpers.pixiv.getUrlWithoutLanguage(url);
        let parts = url.pathname.split("/");
        let illustId = parts[2];

        let page = this.getPageFromUrl(args);
        return helpers.mediaId.fromIllustId(illustId, page);
    }

    // Use the artist's page as the view if we're trying to return to a search for this data
    // source.
    get searchUrl()
    {
        if(this.mediaInfo)
            return new URL(`/users/${this.mediaInfo.userId}/artworks#ppixiv`, this.url);
        else
            return this.url;
    }

    // We don't return any posts to navigate to, but this can still be called by
    // quick view.
    setCurrentMediaId(mediaId, args)
    {
        let [illustId, page] = helpers.mediaId.toIllustIdAndPage(mediaId);

        // Pixiv's inconsistent URLs are annoying.  Figure out where the ID field is.
        // If the first field is a language, it's the third field (/en/artworks/#), otherwise
        // it's the second (/artworks/#).
        let parts = args.path.split("/");
        let id_part = parts[1].length == 2? 3:2;
        parts[id_part] = illustId;
        args.path = parts.join("/");
        args.hash.set("page", page+1);
    }
}
