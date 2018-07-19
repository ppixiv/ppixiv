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

        helpers.rpc_get_request("/rpc/illust_list.php", {
            illust_ids: ids_to_load.join(","),

            // Specifying this gives us 240x240 thumbs, which we want, rather than the 150x150
            // ones we'll get if we don't (though changing the URL is easy enough too).
            page: "discover",
        }, this.loaded_thumbnail_info);
    }

    loaded_thumbnail_info(thumb_result)
    {
        if(thumb_result.error)
            return;

        var urls = [];
        for(var thumb_info of thumb_result)
        {
            var illust_id = thumb_info.illust_id;
            delete this.loading_ids[illust_id];

            // Store the data.
            this.thumbnail_data[illust_id] = thumb_info;

            // Don't preload muted images.
            if(!this.is_muted(thumb_info))
                urls.push(thumb_info.url);

            // Let image_data know about the user for this illust, to speed up fetches later.
            image_data.singleton().set_user_id_for_illust_id(thumb_info.illust_id, thumb_info.illust_user_id);
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

