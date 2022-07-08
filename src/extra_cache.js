// This caches media info which isn't a part of regular illust info.
ppixiv.extra_cache = class
{
    // Return the singleton, creating it if needed.
    static singleton()
    {
        if(extra_cache._singleton == null)
            extra_cache._singleton = new extra_cache();
        return extra_cache._singleton;
    }

    constructor()
    {
        this.bookmarked_image_tags = { };
        this.recent_likes = { }
    }

    // Remember when we've liked an image recently, so we don't spam API requests.
    get_liked_recently(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        return this.recent_likes[media_id];
    }

    add_liked_recently(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        this.recent_likes[media_id] = true;
    }

    // Load bookmark tags.
    //
    // There's no visible API to do this, so we have to scrape the bookmark_add page.  I wish
    // they'd just include this in bookmarkData.  Since this takes an extra request, we should
    // only load this if the user is viewing/editing bookmark tags.
    async load_bookmark_details(media_id)
    {
        // If we know the image isn't bookmarked, we know there are no bookmark tags, so
        // we can skip this.
        media_id = helpers.get_media_id_first_page(media_id);
        let thumb = thumbnail_data.singleton().get_illust_data_sync(media_id);
        if(thumb && thumb.bookmarkData == null)
            return [];

        // Stop if this is already loaded.
        if(this.bookmarked_image_tags[media_id])
            return this.bookmarked_image_tags[media_id]; 

        // The local API just puts bookmark info on the illust info.
        if(helpers.is_media_id_local(media_id))
        {
            this.bookmarked_image_tags[media_id] = thumb.bookmarkData.tags;
            return this.bookmarked_image_tags[media_id]; 
        }

        let [illust_id] = helpers.media_id_to_illust_id_and_page(media_id);
        let bookmark_page = await helpers.fetch_document("/bookmark_add.php?type=illust&illust_id=" + illust_id);
        
        let tags = bookmark_page.querySelector(".bookmark-detail-unit form input[name='tag']").value;
        tags = tags.split(" ");
        tags = tags.filter((value) => { return value != ""; });

        this.bookmarked_image_tags[media_id] = tags;
        return this.bookmarked_image_tags[media_id]; 
    }

    // Return bookmark tags if they're already loaded, otherwise return null.
    get_bookmark_details_sync(media_id)
    {
        if(helpers.is_media_id_local(media_id))
        {
            let thumb = thumbnail_data.singleton().get_illust_data_sync(media_id);
            if(thumb && thumb.bookmarkData == null)
                return [];
   
            this.bookmarked_image_tags[media_id] = thumb.bookmarkData.tags;
            return this.bookmarked_image_tags[media_id]; 
        }
        else
            return this.bookmarked_image_tags[media_id]; 
    }

    // Replace our cache of bookmark tags for an image.  This is used after updating
    // a bookmark.
    update_cached_bookmark_image_tags(media_id, tags)
    {
        media_id = helpers.get_media_id_first_page(media_id);

        if(tags == null)
            delete this.bookmarked_image_tags[media_id];
        else
            this.bookmarked_image_tags[media_id] = tags;

        image_data.singleton().call_illust_modified_callbacks(media_id);
    }
}
