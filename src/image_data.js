// This handles fetching and caching image data and associated user data.
//
// We always load the user data for an illustration if it's not already loaded.  We also
// load ugoira_metadata.  This way, we can access all the info we need for an image in
// one place, without doing multi-phase loads elsewhere.
class image_data
{
    constructor()
    {
        this.loaded_user_info = this.loaded_user_info.bind(this);

        this.illust_modified_callbacks = new callback_list();
        this.user_modified_callbacks = new callback_list();

        // Cached data:
        this.image_data = { };
        this.user_data = { };

        this.illust_loads = {};
        this.user_info_loads = {};
    };

    // Return the singleton, creating it if needed.
    static singleton()
    {
        if(image_data._singleton == null)
            image_data._singleton = new image_data();
        return image_data._singleton;
    };

    // Call all illust_modified callbacks.
    call_user_modified_callbacks(user_id)
    {
        console.log("User modified:", user_id);
        this.user_modified_callbacks.call(user_id);
    }

    call_illust_modified_callbacks(illust_id)
    {
        this.illust_modified_callbacks.call(illust_id);
    }

    // Get image data.  Call callback when it's available:
    //
    // callback(image_data, user_data);
    //
    // User data for the illustration will be fetched, and returned as image_data.userInfo.
    // Note that user data can change (eg. when following a user), and all images for the
    // same user will share the same userInfo object.
    //
    // If illust_id is a video, we'll also download the metadata before returning it, and store
    // it as image_data.ugoiraMetadata.
    get_image_info(illust_id)
    {
        // If we already have the image data, just return it.
        if(this.image_data[illust_id] != null && this.image_data[illust_id].userInfo)
        {
            return new Promise(resolve => {
                resolve(this.image_data[illust_id]);
            });
        }

        // If there's already a load in progress, just return it.
        if(this.illust_loads[illust_id] != null)
            return this.illust_loads[illust_id];
        
        var load_promise = this.load_image_info(illust_id);
        this._started_loading_image_info(illust_id, load_promise);
        return load_promise;
    }

    _started_loading_image_info(illust_id, load_promise)
    {
        this.illust_loads[illust_id] = load_promise;
        this.illust_loads[illust_id].then(() => {
            delete this.illust_loads[illust_id];
        });
    }
    
    // Like get_image_info, but return the result immediately.
    //
    // If the image info isn't loaded, don't start a request and just return null.
    get_image_info_sync(illust_id)
    {
        return this.image_data[illust_id];
    }

    // Load illust_id and all data that it depends on.
    //
    // If we already have the image data (not necessarily the rest, like ugoira_metadata),
    // it can be supplied with illust_data.
    async load_image_info(illust_id, illust_data)
    {
        // We need the illust data, user data, and ugoira metadata (for illustType 2).  (We could
        // load manga data too, but we currently let the manga view do that.)  We need to know the
        // user ID and illust type to start those loads.
        console.error("Fetching", illust_id);

        var user_info_promise = null;
        var manga_promise = null;
        var ugoira_promise = null;

        // Given a user ID and/or an illust_type (or null if either isn't known yet), start any
        // fetches we can.
        var start_loading = (user_id, illust_type, page_count) => {
            // If we know the user ID and haven't started loading user info yet, start it.
            if(user_info_promise == null && user_id != null)
                user_info_promise = this.get_user_info(user_id);
            
            // If we know the illust type and haven't started loading other data yet, start them.
            if(page_count != null && page_count > 1 && manga_promise == null)
                manga_promise = helpers.get_request("/ajax/illust/" + illust_id + "/pages", {});
            if(illust_type == 2 && ugoira_promise == null)
                ugoira_promise = helpers.get_request("/ajax/illust/" + illust_id + "/ugoira_meta");
        };

        // If we have thumbnail info, it tells us the user ID.  This lets us start loading
        // user info without waiting for the illustration data to finish loading first.
        // Don't fetch thumbnail info if it's not already loaded.
        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        if(thumbnail_info != null)
            start_loading(thumbnail_info.userId, thumbnail_info.illustType, thumbnail_info.pageCount);
    
        // If we don't have illust data, block while it loads.
        if(illust_data == null)
        {
            var illust_result_promise = helpers.get_request("/ajax/illust/" + illust_id, {});
            var illust_result = await illust_result_promise;
            if(illust_result == null || illust_result.error)
                return;
            illust_data = illust_result.body;
        }

        // Now that we have illust data, load anything we weren't able to load before.
        start_loading(illust_data.userId, illust_data.illustType, illust_data.pageCount);

        // Store the results.
        illust_data.userInfo = await user_info_promise;

        // If we're loading image info, we're almost definitely going to load the avatar, so
        // start preloading it now.
        helpers.preload_images([illust_data.userInfo.imageBig]);
        
        if(manga_promise != null)
        {
            var manga_info = await manga_promise;
            illust_data.mangaPages = manga_info.body;
        }

        if(ugoira_promise != null)
        {
            var ugoira_result = await ugoira_promise;
            illust_data.ugoiraMetadata = ugoira_result.body;
        }

        // Store the image data.
        this.image_data[illust_id] = illust_data;
        return illust_data;
    }

    // The user request can either return a small subset of data (just the username,
    // profile image URL, etc.), or a larger set with a webpage URL, Twitter, etc.
    // User preloads often only have the smaller set, and we want to use the preload
    // data whenever possible.
    //
    // getuser_info requests the smaller set of data, and get_user_info_full requests
    // the full data.
    //
    // Note that get_user_info will return the full data if we have it already.
    async get_user_info_full(user_id)
    {
        return await this._get_user_info(user_id, true);
    }

    async get_user_info(user_id)
    {
        return await this._get_user_info(user_id, false);
    }

    _get_user_info(user_id, load_full_data)
    {
        // If we already have the user info for this illustration (and it's full data, if
        // requested), we're done.
        if(this.user_data[user_id] != null)
        {
            // user_info.partial is 1 if it's the full data (this is backwards).  If we need
            // full data and we only have partial data, we still need to request data.
            if(!load_full_data || this.user_data[user_id].partial)
            {
                return new Promise(resolve => {
                    resolve(this.user_data[user_id]);
                });
            }
        }

        // If there's already a load in progress, just return it.
        if(this.user_info_loads[user_id] != null)
            return this.user_info_loads[user_id];
       
        this.user_info_loads[user_id] = this.load_user_info(user_id);
        this.user_info_loads[user_id].then(() => {
            delete this.user_info_loads[user_id];
        });

        return this.user_info_loads[user_id];
    };
    
    async load_user_info(user_id)
    {
        // console.log("Fetch user", user_id);
        var result = await helpers.get_request("/ajax/user/" + user_id, {full:1});
        return this.loaded_user_info(result);
    }

    loaded_user_info(user_result)
    {
        if(user_result.error)
            return;

        var user_data = user_result.body;
        var user_id = user_data.userId;
        // console.log("Got user", user_id);

        // Store the user data.
        this.user_data[user_id] = user_data;

        return user_data;
    }

    // Add image and user data to the cache that we received from other sources.  Note that if
    // we have any fetches in the air already, we'll leave them running.
    add_illust_data(illust_data)
    {
        var load_promise = this.load_image_info(illust_data.illustId, illust_data);
        this._started_loading_image_info(illust_data.illustId, load_promise);
    }

    add_user_data(user_data)
    {
        this.loaded_user_info({
            body: user_data,
        });
    }

    // Load bookmark tags and comments.
    //
    // There's no visible API to do this, so we have to scrape the bookmark_add page.  I wish
    // they'd just include this in bookmarkData.  Since this takes an extra request, we should
    // only load this if the user is viewing/editing bookmark tags.
    get_bookmark_details(illust_info)
    {
        var illust_id = illust_info.illustId;

        if(this.bookmark_details[illust_id] == null)
            this.bookmark_details[illust_id] = this.load_bookmark_details(illust_info);

        return this.bookmark_details[illust_id];
    }

    async load_bookmark_details(illust_info)
    {
        // Stop if this image isn't bookmarked.
        if(illust_info.bookmarkData == null)
            return;

        // Stop if this is already loaded.
        if(illust_info.bookmarkData.tags != null)
            return;

        var bookmark_page = await helpers.load_data_in_iframe("/bookmark_add.php?type=illust&illust_id=" + illust_info.illustId);

        // Stop if the image was unbookmarked while we were loading.
        if(illust_info.bookmarkData == null)
            return;

        var tags = bookmark_page.querySelector(".bookmark-detail-unit form input[name='tag']").value;
        var comment = bookmark_page.querySelector(".bookmark-detail-unit form input[name='comment']").value;
        tags = tags.split(" ");
        tags = tags.filter((value) => { return value != ""; });

        illust_info.bookmarkData.tags = tags;
        illust_info.bookmarkData.comment = comment;
     }
}

