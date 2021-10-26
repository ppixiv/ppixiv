"use strict";

// This handles fetching and caching image data and associated user data.
//
// We always load the user data for an illustration if it's not already loaded.  We also
// load ugoira_metadata.  This way, we can access all the info we need for an image in
// one place, without doing multi-phase loads elsewhere.
ppixiv.image_data = class
{
    constructor()
    {
        this.loaded_user_info = this.loaded_user_info.bind(this);

        this.illust_modified_callbacks = new callback_list();
        this.user_modified_callbacks = new callback_list();

        // Cached data:
        this.image_data = { };
        this.user_data = { };
        this.bookmarked_image_tags = { };
        this.recent_likes = { }

        // Negative cache to remember illusts that don't exist, so we don't try to
        // load them repeatedly:
        this.nonexistant_illist_ids = { };
        this.nonexistant_user_ids = { }; // XXX

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

    // Get image data asynchronously.
    //
    // await get_image_info(12345);
    //
    // If illust_id is a video, we'll also download the metadata before returning it, and store
    // it as image_data.ugoiraMetadata.
    get_image_info(illust_id)
    {
        if(illust_id == null)
            return null;

        // Stop if we know this illust doesn't exist.
        if(illust_id in this.nonexistant_illist_ids)
            return null;

        // If we already have the image data, just return it.
        if(this.image_data[illust_id] != null)
            return Promise.resolve(this.image_data[illust_id]);

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
    //
    // If load_user_info is true, we'll attempt to load user info in parallel.  It still
    // needs to be requested with get_user_info(), but loading it here can allow requesting
    // it sooner.
    async load_image_info(illust_id, illust_data, { load_user_info=false }={})
    {
        // See if we already have data for this image.  If we do, stop.  We always load
        // everything we need if we load anything at all.
        if(this.image_data[illust_id] != null)
            return;

        // We need the illust data, user data, and ugoira metadata (for illustType 2).  (We could
        // load manga data too, but we currently let the manga view do that.)  We need to know the
        // user ID and illust type to start those loads.
        console.log("Fetching", illust_id);

        var user_info_promise = null;
        var manga_promise = null;
        var ugoira_promise = null;

        // Given a user ID and/or an illust_type (or null if either isn't known yet), start any
        // fetches we can.
        var start_loading = (user_id, illust_type, page_count) => {
            // If we know the user ID and haven't started loading user info yet, start it.
            if(load_user_info && user_info_promise == null && user_id != null)
                user_info_promise = this.get_user_info(user_id);
            
            // If we know the illust type and haven't started loading other data yet, start them.
            if(page_count != null && page_count > 1 && manga_promise == null && (illust_data == null || illust_data.mangaPages == null))
                manga_promise = helpers.get_request("/ajax/illust/" + illust_id + "/pages", {});
            if(illust_type == 2 && ugoira_promise == null && (illust_data == null || illust_data.ugoiraMetadata == null))
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
            {
                let message = illust_result?.message || "Error loading illustration";
                console.log(`Error loading illust ${illust_id}; ${message}`);
                this.nonexistant_illist_ids[illust_id] = message;
                return null;
            }

            illust_data = illust_result.body;
        }
        tag_translations.get().add_translations(illust_data.tags.tags);

        // Now that we have illust data, load anything we weren't able to load before.
        start_loading(illust_data.userId, illust_data.illustType, illust_data.pageCount);

        // Add an array of thumbnail URLs.
        illust_data.previewUrls = [];
        for(let page = 0; page < illust_data.pageCount; ++page)
        {
            let url = helpers.get_high_res_thumbnail_url(illust_data.urls.small, page);
            illust_data.previewUrls.push(url);
        }

        // If we're loading image info, we're almost definitely going to load the avatar, so
        // start preloading it now.
        let user_info = await user_info_promise;
        if(user_info)
            helpers.preload_images([user_info.imageBig]);
        
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

        // If this is a single-page image, create a dummy single-entry mangaPages array.  This lets
        // us treat all images the same.
        if(illust_data.pageCount == 1)
        {
            illust_data.mangaPages = [{
                width: illust_data.width,
                height: illust_data.height,

                // Rather than just referencing illust_Data.urls, copy just the image keys that
                // exist in the regular mangaPages list (no thumbnails).
                urls: {
                    original: illust_data.urls.original,
                    regular: illust_data.urls.regular,
                    small: illust_data.urls.small,
                }
            }];
        }

        // Store the image data.
        this.image_data[illust_id] = illust_data;
        return illust_data;
    }

    // If get_image_info or get_user_info returned null, return the error message.
    get_illust_load_error(illust_id) { return this.nonexistant_illist_ids[illust_id]; }
    get_user_load_error(user_id) { return this.nonexistant_user_ids[illust_id]; }

    // The user request can either return a small subset of data (just the username,
    // profile image URL, etc.), or a larger set with a webpage URL, Twitter, etc.
    // User preloads often only have the smaller set, and we want to use the preload
    // data whenever possible.
    //
    // get_user_info requests the smaller set of data, and get_user_info_full requests
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

    get_user_info_sync(user_id)
    {
        return this.user_data[user_id];
    }

    // Load user_id if needed.
    //
    // If load_full_data is false, it means the caller only needs partial data, and we
    // won't send a request if we already have that, but if we do end up loading the
    // user we'll always load full data.
    //
    // Some sources only give us partial data, which only has a subset of keys.  See
    // _check_user_data for the keys available with partial and full data.
    _get_user_info(user_id, load_full_data)
    {
        if(user_id == null)
            return null;

        // Stop if we know this user doesn't exist.
        if(user_id in this.nonexistant_user_ids)
            return null;
        
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
        let result = await helpers.get_request("/ajax/user/" + user_id, {full:1});
        if(result == null || result.error)
        {
            let message = result?.message || "Error loading user";
            console.log(`Error loading user ${user_id}; ${message}`);
            this.nonexistant_user_ids[user_id] = message;
            return null;
        }

        return this.loaded_user_info(result);
    }

    _check_user_data(user_data)
    {
        // Make sure that the data contains all of the keys we expect, so we catch any unexpected
        // missing data early.  Discard keys that we don't use, to make sure we update this if we
        // make use of new keys.  This makes sure that the user data keys are always consistent.
        let full_keys = [
            'userId',
            // 'background',
            // 'image',
            'imageBig',
            // 'isBlocking',
            'isFollowed',
            'isMypixiv',
            'name',
            'partial',
            'social',
            'commentHtml',
            // 'premium',
            // 'sketchLiveId',
            // 'sketchLives',
        ];

        let partial_keys = [
            'userId',
            'isFollowed',
            'name',
            'imageBig',
            'partial',
        ];

        // partial is 0 if this is partial user data and 1 if it's full data (this is backwards).
        let expected_keys = user_data.partial? full_keys:partial_keys;

        var thumbnail_info_map = this.thumbnail_info_map_illust_list;
        var remapped_user_data = { };
        for(let key of expected_keys)
        {
            if(!(key in user_data))
            {
                console.warn("User info is missing key:", key);
                continue;
            }
            remapped_user_data[key] = user_data[key];
        }
        return remapped_user_data;
    }

    loaded_user_info(user_result)
    {
        if(user_result.error)
            return;

        var user_data = user_result.body;
        user_data = this._check_user_data(user_data);

        var user_id = user_data.userId;
        // console.log("Got user", user_id);

        // Store the user data.
        if(this.user_data[user_id] == null)
            this.user_data[user_id] = user_data;
        else
        {
            // If we already have an object for this user, we're probably replacing partial user data
            // with full user data.  Don't replace the user_data object itself, since widgets will have
            // a reference to the old one which will become stale.  Just replace the data inside the
            // object.
            var old_user_data = this.user_data[user_id];
            for(var key of Object.keys(old_user_data))
                delete old_user_data[key];
            for(var key of Object.keys(user_data))
                old_user_data[key] = user_data[key];
        }

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

    // Load bookmark tags.
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

    async load_bookmark_details(illust_id)
    {
        // Stop if this is already loaded.
        if(this.bookmarked_image_tags[illust_id])
            return this.bookmarked_image_tags[illust_id]; 

        let bookmark_page = await helpers.load_data_in_iframe("/bookmark_add.php?type=illust&illust_id=" + illust_id);
        
        let tags = bookmark_page.querySelector(".bookmark-detail-unit form input[name='tag']").value;
        tags = tags.split(" ");
        tags = tags.filter((value) => { return value != ""; });

        this.bookmarked_image_tags[illust_id] = tags;
        return this.bookmarked_image_tags[illust_id]; 
    }

    // Replace our cache of bookmark tags for an image.  This is used after updating
    // a bookmark.
    update_cached_bookmark_image_tags(illust_id, tags)
    {
        if(tags == null)
            delete this.bookmarked_image_tags[illust_id];
        else
            this.bookmarked_image_tags[illust_id] = tags;

        this.call_illust_modified_callbacks(illust_id);
    }

    thumbnail_info_early_illust_data_keys = {
        "id": "id",
        "illustType": "illustType",
        "illustTitle": "illustTitle",
        "pageCount": "pageCount",
        "userId": "userId",
        "userName": "userName",
        "width": "width",
        "height": "height",
        "previewUrls": "previewUrls",
        "bookmarkData": "bookmarkData",
        "width": "width",
        "height": "height",
        "createDate": "createDate",
        // This is handled separately.
        // "tags": "tags",
    };
    illust_info_early_illust_data_keys = {
        "id": "id",
        "illustType": "illustType",
        "illustTitle": "illustTitle",
        "pageCount": "pageCount",
        "userId": "userId",
        "userName": "userName",
        "width": "width",
        "height": "height",
        "previewUrls": "previewUrls",
        "bookmarkData": "bookmarkData",
        "width": "width",
        "height": "height",
        "createDate": "createDate",
        // "tags": "tags",
    };
    
    // Get illustration info that can be retrieved from both 
    // Get the info we need to set up an image display.  We can do this from thumbnail info
    // if we're coming from a search, or illust info otherwise.  This only blocks if we
    // need to load the data.
    async get_early_illust_data(illust_id)
    {
        let keys = null;
        let data = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        let result = { };
        if(data)
        {
            keys = this.thumbnail_info_early_illust_data_keys;
            result.tags = data.tags;
        }
        else
        {
            data = await image_data.singleton().get_image_info(illust_id);
            if(data == null)
                return null;

            keys = this.illust_info_early_illust_data_keys;

            result.tags = [];
            for(let tag of data.tags.tags)
                result.tags.push(tag.tag);
        }

        // Remap whichever data type we got.
        for(let from_key in keys)
        {
            let to_key = keys[from_key];
            if(!(from_key in data))
            {
                console.warn(`Missing key ${from_key} for early data`, data);
                continue;
            }

            result[to_key] = data[from_key];
        }

        return result;
    }

    // Update early illust data.
    //
    // THe data might have come from illust info or thumbnail info, so update whichever
    // we have.  This can't update fields with special handling, like tags.
    update_early_illust_data(illust_id, data)
    {
        let update_data = (update, keys) => {
            for(let from_key in keys)
            {
                let to_key = keys[from_key];
                if(!(from_key in data))
                    continue;

                console.assert(from_key != "tags");
                update[to_key] = data[from_key];
            }
        };

        let thumb_data = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        let tags = null;
        if(thumb_data)
            update_data(thumb_data, this.thumbnail_info_early_illust_data_keys);

        let illust_info = image_data.singleton().get_image_info_sync(illust_id);
        if(illust_info != null)
            update_data(illust_info, this.illust_info_early_illust_data_keys);

        this.call_illust_modified_callbacks(illust_id);
    }

    // Remember when we've liked an image recently, so we don't spam API requests.
    get_liked_recently(illust_id) { return this.recent_likes[illust_id]; }
    add_liked_recently(illust_id) { this.recent_likes[illust_id] = true; }

    // Convert a verbose tag list from illust info:
    //
    // illust_info.tags = { tags: [{tag: "tag1"}, {tag: "tag2"}] };
    //
    // to a simple array of tag names, which is what we get in thumbnail data and
    // the format we use in early illust info.
    static from_tag_list(tags)
    {
        let result = [];
        for(let tag of tags.tags)
        {
            result.push(tag.tag);
        }
        return result;
    }
}

