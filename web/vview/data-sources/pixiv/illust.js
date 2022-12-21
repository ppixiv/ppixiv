import DataSource from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/ppixiv-imports.js';

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

        this.mediaId = this.get_media_id_from_url(new helpers.args(url));

        this._load_media_info();
    }

    async _load_media_info()
    {
        this.media_info = await ppixiv.media_cache.get_media_info(this.mediaId, { full: false });
    }

    // Show the illustration by default.
    get default_screen()
    {
        return "illust";
    }

    // This data source just views a single image and doesn't return any posts.
    async load_page_internal(page) { }

    get_media_id_from_url(args)
    {
        // The illust ID is stored in the path, for compatibility with Pixiv URLs:
        //
        // https://www.pixiv.net/en/users/#/artworks
        //
        // The page (if any) is stored in the hash.
        let url = args.url;
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");
        let illust_id = parts[2];

        let page = this.get_page_from_url(args);
        return helpers.illust_id_to_media_id(illust_id, page);
    }

    // We're always viewing our media ID.
    get_current_media_id(args) { return this.mediaId; }

    // Use the artist's page as the view if we're trying to return to a search for this data
    // source.
    get search_url()
    {
        if(this.media_info)
            return new URL(`/users/${this.media_info.userId}/artworks#ppixiv`, this.url);
        else
            return this.url;
    }

    // We don't return any posts to navigate to, but this can still be called by
    // quick view.
    set_current_media_id(mediaId, args)
    {
        let [illust_id] = helpers.media_id_to_illust_id_and_page(mediaId);

        // Pixiv's inconsistent URLs are annoying.  Figure out where the ID field is.
        // If the first field is a language, it's the third field (/en/artworks/#), otherwise
        // it's the second (/artworks/#).
        let parts = args.path.split("/");
        let id_part = parts[1].length == 2? 3:2;
        parts[id_part] = illust_id;
        args.path = parts.join("/");
    }
};
