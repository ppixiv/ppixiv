ppixiv.UserCache = class extends EventTarget
{
    constructor()
    {
        super();

        this.user_data = { };
        this.all_user_follow_tags = null;
        this.user_follow_info = { };
        this.user_info_loads = {};
        this.follow_info_loads = {};
        this.user_follow_tags_load = null;
        this.nonexistant_user_ids = { };
    }

    // Call all illust_modified callbacks.
    call_user_modified_callbacks(user_id)
    {
        console.log("User modified:", user_id);
        let event = new Event("usermodified");
        event.user_id = user_id;
        this.dispatchEvent(event);
    }
    
    get_user_load_error(user_id)
    {
        return this.nonexistant_user_ids[user_id];
    }

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
        let base_media_id = "user:" + user_id;
        if(base_media_id in this.nonexistant_user_ids)
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
       
        this.user_info_loads[user_id] = this._load_user_info(user_id);
        this.user_info_loads[user_id].then(() => {
            delete this.user_info_loads[user_id];
        });

        return this.user_info_loads[user_id];
    };
    
    async _load_user_info(user_id)
    {
        // -1 is for illustrations with no user, which is used for local images.
        if(user_id == -1)
            return null;

        // console.log("Fetch user", user_id);
        let result = await helpers.get_request("/ajax/user/" + user_id, {full:1});
        if(result == null || result.error)
        {
            let message = result?.message || "Error loading user";
            console.log(`Error loading user ${user_id}: ${message}`);
            this.nonexistant_user_ids[user_id] = message;
            return null;
        }

        return this._loaded_user_info(result);
    }

    // Add user data that we received from other sources.
    add_user_data(user_data)
    {
        this._loaded_user_info({
            body: user_data,
        });
    }

    _loaded_user_info = (user_result) =>
    {
        if(user_result.error)
            return;

        let user_data = user_result.body;
        user_data = this._check_user_data(user_data);

        let user_id = user_data.userId;
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
            let old_user_data = this.user_data[user_id];
            for(let key of Object.keys(old_user_data))
                delete old_user_data[key];
            for(let key of Object.keys(user_data))
                old_user_data[key] = user_data[key];
        }

        return user_data;
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

        let remapped_user_data = { };
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

    // Load the follow info for a followed user, which includes follow tags and whether the
    // follow is public or private.  If the user isn't followed, return null.
    // 
    // This can also fetch the results of load_all_user_follow_tags and will cache it if
    // available, so if you're calling both get_user_follow_info and load_all_user_follow_tags,
    // call this first.
    async get_user_follow_info(user_id, { refresh=false }={})
    {
        // If we request following info for a user we're not following, we'll get a 400.  This
        // isn't great, since it means we have to make an extra API call first to see if we're
        // following to avoid spamming request errors.
        let user_data = await this.get_user_info(user_id);
        if(!user_data.isFollowed)
        {
            delete this.user_follow_info[user_id];
            return null;
        }

        // Stop if this user's follow info is already loaded.
        if(!refresh && this.user_follow_info[user_id])
            return this.user_follow_info[user_id];

        // If another request is already running for this user, wait for it to finish and use
        // its result.
        if(this.follow_info_loads[user_id])
        {
            await this.follow_info_loads[user_id];
            return this.user_follow_info[user_id];
        }

        this.follow_info_loads[user_id] = helpers.get_request("/ajax/following/user/details", {
            user_id: user_id,
            lang: "en",
        });
        
        let data = await this.follow_info_loads[user_id];
        this.follow_info_loads[user_id] = null;

        if(data.error)
        {
            console.log(`Couldn't request follow info for ${user_id}`);
            return null;
        }

        // This returns both selected tags and all follow tags, so we can also update
        // all_user_follow_tags.
        let all_tags = [];
        let tags = new Set();
        for(let tag_info of data.body.tags)
        {
            all_tags.push(tag_info.name);
            if(tag_info.selected)
                tags.add(tag_info.name);
        }

        this.set_cached_all_user_follow_tags(all_tags);
        this.user_follow_info[user_id] = {
            tags,
            following_privately: data.body.restrict == "1",
        }
        return this.user_follow_info[user_id];
    }

    get_user_follow_info_sync(user_id)
    {
        return this.user_follow_info[user_id];
    }

    // Load all of the user's follow tags.  This is cached unless refresh is true.
    async load_all_user_follow_tags({ refresh=false }={})
    {
        // Follow tags require premium.
        if(!window.global_data.premium)
            return [];

        if(!refresh && this.all_user_follow_tags != null)
            return this.all_user_follow_tags;

        // If another call is already running, wait for it to finish and use its result.
        if(this.user_follow_tags_load)
        {
            await this.user_follow_tags_load;
            return this.all_user_follow_tags;
        }

        // The only ways to get this list seem to be from looking at an already-followed
        // user, or looking at the follow list.
        this.user_follow_tags_load = helpers.get_request(`/ajax/user/${window.global_data.user_id}/following`, {
            offset: 0,
            limit: 1,
            rest: "show",
        });
        
        let result = await this.user_follow_tags_load;
        this.user_follow_tags_load = null;

        if(result.error)
            console.log("Error retrieving follow tags");
        else
            this.set_cached_all_user_follow_tags(result.body.followUserTags);

        return this.all_user_follow_tags;
    }

    
    // Update the list of tags we've followed a user with.
    set_cached_all_user_follow_tags(tags)
    {
        tags.sort();

        // Work around a Pixiv bug.  If you ever use the follow user API with a tag
        // of null (instead of ""), it returns an internal error and you end up with
        // a "null" tag in your tag list that never goes away.  It seems like it stores
        // the actual null value, which then gets coerced to the string "null" in the
        // API.  Remove it, since it's annoying (sorry if you really wanted to tag
        // people as "null").
        let idx = tags.indexOf("null");
        if(idx != -1)
            tags.splice(idx, 1);

        this.all_user_follow_tags = tags;
    }

    // Add a new tag to all_user_follow_tags When the user creates a new one.
    add_to_cached_all_user_follow_tags(tag)
    {
        if(this.all_user_follow_tags == null || this.all_user_follow_tags.indexOf(tag) != -1)
            return;

        this.all_user_follow_tags.push(tag);
        this.all_user_follow_tags.sort();
    }

    // Update the follow info for a user.  This is used after updating a follow.
    update_cached_follow_info(user_id, followed, follow_info)
    {
        // If user info isn't loaded, follow info isn't either.
        let user_info = this.get_user_info_sync(user_id);
        if(user_info == null)
            return;

        user_info.isFollowed = followed;
        if(!followed)
        {
            delete this.user_follow_info[user_id];
        }
        else
        {
            this.user_follow_info[user_id] = follow_info;
        }

        this.call_user_modified_callbacks(user_id);
    }
}