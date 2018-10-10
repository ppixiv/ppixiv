// This handles fetching and caching image data and associated user data.
//
// We always load the user data for an illustration if it's not already loaded.  We also
// load ugoira_metadata.  This way, we can access all the info we need for an image in
// one place, without doing multi-phase loads elsewhere.
class image_data
{
    constructor()
    {
        this.loaded_image_info = this.loaded_image_info.bind(this);
        this.loaded_user_info = this.loaded_user_info.bind(this);

        this.illust_modified_callbacks = new callback_list();
        this.user_modified_callbacks = new callback_list();

        // Cached data:
        this.image_data = { };
        this.user_data = { };
        this.manga_info = { };
        this.illust_id_to_user_id = {};

        this.illust_loads = {};
        this.user_info_loads = {};
        this.manga_page_loads = {};
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
        
        this.illust_loads[illust_id] = this.load_image_info(illust_id);
        this.illust_loads[illust_id].then(() => {
            delete this.illust_loads[illust_id];
        });
        
        return this.illust_loads[illust_id];
    }
    
    // Like get_image_info, but return the result immediately.
    //
    // If the image info isn't loaded, don't start a request and just return null.
    get_image_info_sync(illust_id)
    {
        return this.image_data[illust_id];
    }

    // Load illust_id and all data that it depends on.
    async load_image_info(illust_id)
    {
        // If we have the user ID cached, start loading it without waiting for the
        // illustration data to finish loading first.  loaded_image_info will also
        // do this, and it'll use the request we started here.
        var cached_user_id = this.illust_id_to_user_id[illust_id];
        if(cached_user_id != null)
        {
            console.log("Prefetching user ID", cached_user_id);
            this.get_user_info(cached_user_id);
        }

        // console.log("Fetch illust", illust_id);

        console.error("Fetching", illust_id);

        var result = await helpers.get_request("/ajax/illust/" + illust_id, {});
        return await this.loaded_image_info(result);
    }

    async loaded_image_info(illust_result)
    {
        if(illust_result == null || illust_result.error)
            return;

        var illust_data = illust_result.body;
        var illust_id = illust_data.illustId;
        // console.log("Got illust", illust_id);

        var promises = [];
        if(illust_data.illustType == 2)
        {
            // If this is a video, load metadata and add it to the illust_data before we store it.
            var ugoira_result = helpers.get_request("/ajax/illust/" + illust_id + "/ugoira_meta");
            promises.push(ugoira_result);
        }

        // Load user info for the illustration.
        //
        // Do this async rather than immediately, so if we're loading initial info with calls to
        // add_illust_data and add_user_data, we'll give the caller a chance to finish and give us
        // user info, rather than fetching it now when we won't need it.
        var user_info = this.get_user_info(illust_data.userId);
        promises.push(user_info);

        // Wait for the user info and ugoira data to both complete.
        await Promise.all(promises);

        // Store the results.
        var user_info = await user_info;
        illust_data.userInfo = user_info;

        if(illust_data.illustType == 2)
        {
            ugoira_result = await ugoira_result;
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
        // Call loaded_image_info directly, so we'll load video metadata, etc.
        this.loaded_image_info({
            error: false,
            body: illust_data
        });
    }

    add_user_data(user_data)
    {
        this.loaded_user_info({
            body: user_data,
        });
    }

    // When we load an image, we load the user with it, and we get the user ID from
    // the illustration data.  However, this is slow, since we have to wait for
    // the illust request to finish before we know what user to load.
    //
    // In some cases we know from other sources what user we'll need (but where we
    // don't want to load the user yet).  This can be called to cache that, so if
    // an illust is loaded, we can start the user fetch in parallel.
    set_user_id_for_illust_id(illust_id, user_id)
    {
        this.illust_id_to_user_id[illust_id] = user_id;
    }

    // The main illust info doesn't include links to each manga page.  (They really
    // should.)  Fetch and reteurn manga page info for illust_id.
    //
    // This is separate from illust info rather than storing it in the illust info,
    // so the two can be loaded in parallel.
    get_manga_info(illust_id)
    {
        // If there's already a load in progress, just return it.
        if(this.manga_page_loads[illust_id] != null)
            return this.manga_page_loads[illust_id];

        this.manga_page_loads[illust_id] = this.load_manga_info(illust_id);
        this.manga_page_loads[illust_id].then(() => {
            delete this.manga_page_loads[illust_id];
        });
        return this.manga_page_loads[illust_id];
    }
    
    async load_manga_info(illust_id)
    {
        // If we already have the manga info for this illustration, we're done.
        if(this.manga_info[illust_id] != null)
            return this.manga_info[illust_id];

        // We can say {full: 1} to get more profile info (webpage URL, twitter, etc.).
        // That info isn't included in preloads, though, so it's not used for now to keep
        // things consistent.
        // console.log("Fetch manga", illust_id);
        var result = await helpers.get_request("/ajax/illust/" + illust_id + "/pages", {});

        // Store the result.
        this.manga_info[illust_id] = result.body;
        return this.manga_info[illust_id];
    }
}

