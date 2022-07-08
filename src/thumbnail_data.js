"use strict";

// This handles batch fetching data for thumbnails.
//
// We can load a bunch of images at once with illust_list.php.  This isn't enough to
// display the illustration, since it's missing a lot of data, but it's enough for
// displaying thumbnails (which is what the page normally uses it for).
ppixiv.thumbnail_data = class
{
    constructor()
    {
        // Cached data:
        this.thumbnail_data = { };
        this.user_profile_urls = {};

        // IDs that we're currently requesting:
        this.loading_ids = {};
    };

    // Return the singleton, creating it if needed.
    static singleton()
    {
        if(thumbnail_data._singleton == null)
            thumbnail_data._singleton = new thumbnail_data();
        return thumbnail_data._singleton;
    };

    // Return true if all thumbs in media_ids have been loaded, or are currently loading.
    //
    // We won't start fetching IDs that aren't loaded.
    are_all_media_ids_loaded_or_loading(media_ids)
    {
        for(let media_id of media_ids)
        {
            media_id = helpers.get_media_id_first_page(media_id);
            if(this.thumbnail_data[media_id] == null && !this.loading_ids[media_id])
                return false;
        }
        return true;
    }
   
    is_media_id_loaded_or_loading(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        if(helpers.is_media_id_local(media_id) && local_api.is_media_id_loading(media_id))
            return true;
        
        return this.thumbnail_data[media_id] != null || this.loading_ids[media_id];
    }
    
    // Return thumbnail data for media_id, or null if it's not loaded.
    //
    // The thumbnail data won't be loaded if it's not already available.  Use get_thumbnail_info
    // to load thumbnail data in batches.
    get_one_thumbnail_info(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        return this.thumbnail_data[media_id];
    }

    // Return thumbnail data for media_ids, and start loading any requested IDs that aren't
    // already loaded.
    get_thumbnail_info(media_ids)
    {
        var result = {};
        var needed_media_ids = [];
        let local_media_ids = [];
        for(let media_id of media_ids)
        {
            media_id = helpers.get_media_id_first_page(media_id);
            let data = this.thumbnail_data[media_id];
            if(data == null)
            {
                // Only load illust IDs.
                let { type } = helpers.parse_media_id(media_id);
                if(helpers.is_media_id_local(media_id))
                {
                    local_media_ids.push(media_id);
                    continue;
                }

                if(type != "illust")
                    continue;

                needed_media_ids.push(media_id);
                continue;
            }
            result[media_id] = data;
        }

        // If any of these are local IDs, load them with local_api.
        if(local_media_ids.length)
            local_api.load_media_ids(local_media_ids);

        // Load any thumbnail data that we didn't have.
        if(needed_media_ids.length)
            this.load_thumbnail_info(needed_media_ids);

        return result;
    }

    // Load thumbnail info for the given list of IDs.
    async load_thumbnail_info(media_ids, { force=false }={})
    {
        // Make a list of IDs that we're not already loading.
        let illust_ids_to_load = [];
        for(let media_id of media_ids)
        {
            media_id = helpers.get_media_id_first_page(media_id);
            if(!force && this.loading_ids[media_id] != null)
                continue;

            illust_ids_to_load.push(helpers.parse_media_id(media_id).id);
            this.loading_ids[media_id] = true;
        }

        if(illust_ids_to_load.length == 0)
            return;

        // There's also
        //
        // https://www.pixiv.net/ajax/user/user_id/profile/illusts?ids[]=1&ids[]=2&...
        //
        // which is used by newer pages.  That's useful since it tells us whether each
        // image is bookmarked.  However, it doesn't tell us the user's name or profile image
        // URL, and for some reason it's limited to a particular user.  Hopefully they'll
        // have an updated generic illustration lookup call if they ever update the
        // regular search pages, and we can switch to it then.
        var result = await helpers.rpc_get_request("/rpc/illust_list.php", {
            illust_ids: illust_ids_to_load.join(","),

            // Specifying this gives us 240x240 thumbs, which we want, rather than the 150x150
            // ones we'll get if we don't (though changing the URL is easy enough too).
            page: "discover",

            // We do our own muting, but for some reason this flag is needed to get bookmark info.
            exclude_muted_illusts: 1,
        });

        await this.loaded_thumbnail_info(result, "illust_list");
    }

    // Get the user's profile picture URL, or a fallback if we haven't seen it.
    get_profile_picture_url(user_id)
    {
        let result = this.user_profile_urls[user_id];
        if(!result)
            result = "https://s.pximg.net/common/images/no_profile.png";
        return result;
    }

    // Register thumbnail info loaded from the given source.
    loaded_thumbnail_info = async (thumb_result, source) =>
    {
        if(thumb_result.error)
            return;

        // Ignore entries with "isAdContainer".
        thumb_result = thumb_result.filter(item => !item.isAdContainer);

        let all_thumb_info = [];
        for(let thumb_info of thumb_result)
        {
            let { remapped_thumb_info, profile_image_url } = ppixiv.media_cache_mappings.remap_partial_media_info(thumb_info, source);

            // The profile image URL isn't included in image info since it's not present in full
            // info.  Store it separately.
            if(profile_image_url)
            {
                console.log(profile_image_url);
                this.user_profile_urls[remapped_thumb_info.userId] = profile_image_url;
            }

            all_thumb_info.push(remapped_thumb_info);
        }

        // Load any extra image data stored for these media IDs.  These are stored per page, but
        // batch loaded per image.
        let illust_ids = all_thumb_info.map((info) => info.illustId);
        let extra_data = await extra_image_data.get.batch_load_all_pages_for_illust(illust_ids);

        for(let info of all_thumb_info)
        {
            // Store extra data for each page.
            info.extraData = extra_data[info.illustId] || {};

            // Store the data.
            this.thumbnail_data[info.mediaId] = info;
            delete this.loading_ids[info.mediaId];
        }

        // Broadcast that we have new thumbnail data available.
        window.dispatchEvent(new Event("thumbnailsloaded"));
    };

    is_muted(thumb_info)
    {
        if(muting.singleton.is_muted_user_id(thumb_info.illust_user_id))
            return true;
        if(muting.singleton.any_tag_muted(thumb_info.tags))
            return true;
        return false;
    }

    partial_media_info_keys = [
        "mediaId",
        "illustId",
        "illustType",
        "illustTitle",
        "pageCount",
        "userId",
        "userName",
        "width",
        "height",
        "previewUrls",
        "bookmarkData",
        "createDate",
        "tagList",
    ];
    
    // Return illust info or thumbnail data, whichever is available.  If we don't have
    // either, read full illust info.  If we have both, return illust info.
    //
    // This is used when we're displaying info for a single image, and the caller only
    // needs thumbnail data.  It allows us to use either thumbnail data or illust info,
    // so we can usually return the data immediately.
    //
    // If it isn't available and we need to load it, we load illust info instead of thumbnail
    // data, since it takes a full API request either way.
    async get_or_load_illust_data(media_id)
    {
        // First, see if we have full illust info.  Prefer to use it over thumbnail info
        // if we have it, so full info is available.  If we don't, see if we have thumbnail
        // info.
        let data = image_data.singleton().get_media_info_sync(media_id);
        if(data == null)
            data = thumbnail_data.singleton().get_one_thumbnail_info(media_id);

        // If we don't have either, load the image info.
        if(data == null)
            data = await image_data.singleton().get_media_info(media_id);

        this._check_illust_data(data);

        return data;
    }

    // A sync version of get_or_load_illust_data.  This doesn't load data if it
    // isn't available.
    get_illust_data_sync(media_id)
    {
        // First, see if we have full illust info.  Prefer to use it over thumbnail info
        // if we have it, so full info is available.  If we don't, see if we have thumbnail
        // info.
        let data = image_data.singleton().get_media_info_sync(media_id);
        if(data == null)
            data = thumbnail_data.singleton().get_one_thumbnail_info(media_id);

        this._check_illust_data(data);

        return data;
    }

    // Check the result of get_or_load_illust_data.  We always expect all keys in
    // partial_media_info_keys to be included, regardless of where the data came from.
    _check_illust_data(illust_data)
    {
        if(illust_data == null)
            return;

        for(let key of this.partial_media_info_keys)
        {
            if(!(key in illust_data))
            {
                console.warn(`Missing key ${key} for early data`, illust_data);
                continue;
            }
        }
    }
}

