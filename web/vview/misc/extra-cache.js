// This caches media info which isn't a part of regular illust info.

import { helpers } from 'vview/misc/helpers.js';

export default class ExtraCache
{
    constructor()
    {
        this.bookmarked_image_tags = { };
        this.recent_likes = { }
        this.quick_user_data = { };
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
        let thumb = ppixiv.media_cache.get_media_info_sync(media_id, { full: false });
        if(thumb && thumb.bookmarkData == null)
            return [];

        // The local API just puts bookmark info on the illust info.  Copy over the current
        // data.
        if(helpers.is_media_id_local(media_id))
            this.bookmarked_image_tags[media_id] = thumb.bookmarkData.tags;

        // If we already have bookmark tags, return them.  Return a copy, so modifying the
        // result doesn't change our cached data.
        if(this.bookmarked_image_tags[media_id])
            return [...this.bookmarked_image_tags[media_id]]; 

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
            let thumb = ppixiv.media_cache.get_media_info_sync(media_id, { full: false });
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

        ppixiv.media_cache.call_illust_modified_callbacks(media_id);
    }


    // This is a simpler form of thumbnail data for user info.  This is just the bare minimum
    // info we need to be able to show a user thumbnail on the search page.  This is used when
    // we're displaying lots of users in search results.
    //
    // We can get this info from two places, the following page (data_source_follows) and the
    // user recommendations page (data_source_discovery_users).  Of course, since Pixiv never
    // does anything the same way twice, they have different formats.
    //
    // The only info we need is:
    // userId
    // userName
    // profileImageUrl
    add_quick_user_data(source_data, source)
    {
        let data = null;
        let id = source_data.userId;
        if(source == "following")
        {
            data = {
                userId: source_data.userId,
                userName: source_data.userName,
                profileImageUrl: source_data.profileImageUrl,
            };
        }
        else if(source == "recommendations")
        {
            data = {
                userId: source_data.userId,
                userName: source_data.name,
                profileImageUrl: source_data.imageBig,
            };
        }
        else if(source == "users_bookmarking_illust" || source == "user_search")
        {
            data = {
                userId: source_data.user_id,
                userName: source_data.user_name,
                profileImageUrl: source_data.profile_img,
            };
        }
        else
            throw "Unknown source: " + source;

        this.quick_user_data[data.userId] = data;        
    }

    get_quick_user_data(user_id)
    {
        return this.quick_user_data[user_id];
    }
}
