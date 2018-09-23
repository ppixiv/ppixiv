// This handles batch fetching data for thumbnails.
//
// We can load a bunch of images at once with illust_list.php.  This isn't enough to
// display the illustration, since it's missing a lot of data, but it's enough for
// displaying thumbnails (which is what the page normally uses it for).
class thumbnail_data
{
    constructor()
    {
        this.loaded_thumbnail_info = this.loaded_thumbnail_info.bind(this);

        // Cached data:
        this.thumbnail_data = { };

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

    // Return true if all thumbs in illust_ids have been loaded, or are currently loading.
    //
    // We won't start fetching IDs that aren't loaded.
    are_all_ids_loaded_or_loading(illust_ids)
    {
        for(var illust_id of illust_ids)
        {
            if(this.thumbnail_data[illust_id] == null && !this.loading_ids[illust_id])
                return false;
        }
        return true;
    }
    
    // Return thumbnail data for illud_id, or null if it's not loaded.
    //
    // The thumbnail data won't be loaded if it's not already available.  Use get_thumbnail_info
    // to load thumbnail data in batches.
    get_one_thumbnail_info(illust_id)
    {
        return this.thumbnail_data[illust_id];
    }

    // Return thumbnail data for illust_ids, and start loading any requested IDs that aren't
    // already loaded.
    get_thumbnail_info(illust_ids)
    {
        var result = {};
        var needed_ids = [];
        for(var illust_id of illust_ids)
        {
            var data = this.thumbnail_data[illust_id];
            if(data == null)
            {
                needed_ids.push(illust_id);
                continue;
            }
            result[illust_id] = data;
        }

        // Load any thumbnail data that we didn't have.
        if(needed_ids.length)
            this.load_thumbnail_info(needed_ids);

        return result;
    }

    // Load thumbnail info for the given list of IDs.
    load_thumbnail_info(illust_ids)
    {
        // Make a list of IDs that we're not already loading.
        var ids_to_load = [];
        for(var id of illust_ids)
            if(this.loading_ids[id] == null)
                ids_to_load.push(id);

        if(ids_to_load.length == 0)
            return;

        for(var id of ids_to_load)
            this.loading_ids[id] = true;

        // There's also
        //
        // https://www.pixiv.net/ajax/user/user_id/profile/illusts?ids[]=1&ids[]=2&...
        //
        // which is used by newer pages.  That's useful since it tells us whether each
        // image is bookmarked.  However, it doesn't tell us the user's name or profile image
        // URL, and for some reason it's limited to a particular user.  Hopefully they'll
        // have an updated generic illustration lookup call if they ever update the
        // regular search pages, and we can switch to it then.
        helpers.rpc_get_request("/rpc/illust_list.php", {
            illust_ids: ids_to_load.join(","),

            // Specifying this gives us 240x240 thumbs, which we want, rather than the 150x150
            // ones we'll get if we don't (though changing the URL is easy enough too).
            page: "discover",
        }, function(results) {
            this.loaded_thumbnail_info(results, true);
        }.bind(this));
    }

    get thumbnail_info_map()
    {
        if(this._thumbnail_info_map != null)
            return this._thumbnail_info_map;

        this._thumbnail_info_map = [
            ["illust_id", "id"],
            ["url", "url"],
            ["tags", "tags"],
            ["illust_user_id", "userId"],
            ["illust_width", "width"],
            ["illust_height", "height"],
            ["illust_type", "illustType"],
            ["illust_page_count", "pageCount"],
            ["illust_title", "title"],
            ["user_profile_img", "profileImageUrl"],
            ["user_name", "userName"],
        ];
        return this._thumbnail_info_map;
    };

    // This is called when we have new thumbnail data available.  thumb_result is
    // an array of thumbnail items.
    //
    // This can come from /rpc/illust_list.php, or from search results.  These have
    // the same data, but for some reason everything has different names.  Figure out
    // which format the entries have, and if they have the format used by illust_list.php,
    // remap them to the format used by search results.  Check that all fields we expect
    // exist, to make it easier to notice if something is wrong.
    //
    loaded_thumbnail_info(thumb_result, from_illust_list)
    {
        if(thumb_result.error)
            return;

        var thumbnail_info_map = this.thumbnail_info_map;
        var urls = [];
        for(var thumb_info of thumb_result)
        {
            // Remap the thumb info.  We do this even for data not from illust_list.php
            // (which doesn't need remapping) in order to check that we have the keys
            // we expect.  This also removes keys we don't use, so if we start using a new
            // key, we remember to update the map.
            var remapped_thumb_info = { };
            for(var pair of thumbnail_info_map)
            {
                var from_key = pair[from_illust_list? 0:1];
                var to_key = pair[1];
                if(!(from_key in thumb_info))
                {
                    console.warn("Thumbnail info is missing key:", from_key);
                    continue;
                }
                var value = thumb_info[from_key];
                remapped_thumb_info[to_key] = value;
            }

            thumb_info = remapped_thumb_info;

            var illust_id = thumb_info.id;
            delete this.loading_ids[illust_id];

            // Store the data.
            this.thumbnail_data[illust_id] = thumb_info;

            // Don't preload muted images.
            if(!this.is_muted(thumb_info))
                urls.push(thumb_info.url);

            // Let image_data know about the user for this illust, to speed up fetches later.
            image_data.singleton().set_user_id_for_illust_id(thumb_info.illust_id, thumb_info.userId);
        }

        // Preload thumbnails.
        helpers.preload_images(urls);

        // Broadcast that we have new thumbnail data available.
        window.dispatchEvent(new Event("thumbnailsLoaded"));
    };

    is_muted(thumb_info)
    {
        if(main.is_muted_user_id(thumb_info.illust_user_id))
            return true;
        if(main.any_tag_muted(thumb_info.tags))
            return true;
        return false;
    }
}

