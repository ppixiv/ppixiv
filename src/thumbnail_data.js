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
        this.quick_user_data = { };
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

    // Get the mapping from /ajax/user/id/illusts/bookmarks to illust_list.php's keys.
    get thumbnail_info_map_illust_list()
    {
        if(this._thumbnail_info_map_illust_list != null)
            return this._thumbnail_info_map_illust_list;

        this._thumbnail_info_map_illust_list = [
            ["illust_id", "id"],
            ["url", "url"],
            ["tags", "tags"],
            ["illust_user_id", "userId"],
            ["illust_width", "width"],
            ["illust_height", "height"],
            ["illust_type", "illustType"],
            ["illust_page_count", "pageCount"],
            ["illust_title", "illustTitle"],
            ["user_profile_img", "profileImageUrl"],
            ["user_name", "userName"],

            // illust_list.php doesn't give the creation date.
            [null, "createDate"],
        ];
        return this._thumbnail_info_map_illust_list;
    };

    get thumbnail_info_map_ranking()
    {
        if(this._thumbnail_info_map_ranking != null)
            return this._thumbnail_info_map_ranking;

        this._thumbnail_info_map_ranking = [
            ["illust_id", "id"],
            ["url", "url"],
            ["tags", "tags"],
            ["user_id", "userId"],
            ["width", "width"],
            ["height", "height"],
            ["illust_type", "illustType"],
            ["illust_page_count", "pageCount"],
            ["title", "illustTitle"],
            ["profile_img", "profileImageUrl"],
            ["user_name", "userName"],
            ["illust_upload_timestamp", "createDate"],
        ];
        return this._thumbnail_info_map_ranking;
    };

    

    // This is called when we have new thumbnail data available.  thumb_result is
    // an array of thumbnail items.
    //
    // This can come from a bunch of different places, which all return the same data, but
    // each in a different way:
    //
    // name           URL
    // normal         /ajax/user/id/illusts/bookmarks
    // illust_list    illust_list.php 
    // following      bookmark_new_illust.php 
    // following      search.php 
    // rankings       ranking.php
    //
    // We map each of these to "normal".
    //
    // These have the same data, but for some reason everything has different names.  
    // Remap them to "normal", and check that all fields we expect exist, to make it
    // easier to notice if something is wrong.
    loaded_thumbnail_info = async (thumb_result, source) =>
    {
        if(thumb_result.error)
            return;

        let all_thumb_info = [];
        for(let thumb_info of thumb_result)
        {
            // Ignore entries with "isAdContainer".  These aren't search results at all and just contain
            // stuff we're not interested in.
            if(thumb_info.isAdContainer)
                continue;

            let remapped_thumb_info = null;
            if(source == "normal")
            {
                // The data is already in the format we want.  The only change we make is
                // to rename title to illustTitle, to match it up with illust info.
                if(!("title" in thumb_info))
                {
                    console.warn("Thumbnail info is missing key: title");
                }
                else
                {
                    thumb_info.illustTitle = thumb_info.title;
                    delete thumb_info.title;
                }

                // Check that all keys we expect exist, and remove any keys we don't know about
                // so we don't use them accidentally.
                let thumbnail_info_map = this.thumbnail_info_map_ranking;
                remapped_thumb_info = { };
                for(let pair of thumbnail_info_map)
                {
                    let key = pair[1];
                    if(!(key in thumb_info))
                    {
                        console.warn("Thumbnail info is missing key:", key);
                        continue;
                    }
                    remapped_thumb_info[key] = thumb_info[key];
                }

                if(!('bookmarkData' in thumb_info))
                    console.warn("Thumbnail info is missing key: bookmarkData");
                else
                {
                    remapped_thumb_info.bookmarkData = thumb_info.bookmarkData;

                    // See above.
                    if(remapped_thumb_info.bookmarkData != null)
                        delete remapped_thumb_info.bookmarkData.bookmarkId;
                }
            }
            else if(source == "illust_list" || source == "rankings")
            {
                // Get the mapping for this mode.
                let thumbnail_info_map = 
                    source == "illust_list"? this.thumbnail_info_map_illust_list:
                    this.thumbnail_info_map_ranking;

                remapped_thumb_info = { };
                for(let pair of thumbnail_info_map)
                {
                    let from_key = pair[0];
                    let to_key = pair[1];
                    if(from_key == null)
                    {
                        // This is just for illust_list createDate.
                        remapped_thumb_info[to_key] = null;
                        continue;
                    }

                    if(!(from_key in thumb_info))
                    {
                        console.warn("Thumbnail info is missing key:", from_key);
                        continue;
                    }
                    let value = thumb_info[from_key];
                    remapped_thumb_info[to_key] = value;
                }

                // Make sure that the illust IDs and user IDs are strings.
                remapped_thumb_info.id = "" + remapped_thumb_info.id;
                remapped_thumb_info.userId = "" + remapped_thumb_info.userId;

                // Bookmark data is a special case.
                //
                // The old API has is_bookmarked: true, bookmark_id: "id" and bookmark_illust_restrict: 0 or 1.
                // bookmark_id and bookmark_illust_restrict are omitted if is_bookmarked is false.
                //
                // The new API is a dictionary:
                //
                // bookmarkData = {
                //     bookmarkId: id,
                //     private: false
                // }
                //
                // or null if not bookmarked.
                //
                // A couple sources of thumbnail data (bookmark_new_illust.php and search.php)
                // don't return the bookmark ID.  We don't use this (we only edit bookmarks from
                // the image page, where we have full image data), so we omit bookmarkId from this
                // data.
                //
                // Some pages return buggy results.  /ajax/user/id/profile/all includes bookmarkData,
                // but private is always false, so we can't tell if it's a private bookmark.  This is
                // a site bug that we can't do anything about (it affects the site too).
                remapped_thumb_info.bookmarkData = null;
                if(!('is_bookmarked' in thumb_info))
                    console.warn("Thumbnail info is missing key: is_bookmarked");
                if(thumb_info.is_bookmarked)
                {
                    remapped_thumb_info.bookmarkData = {
                        // See above.
                        // bookmarkId: thumb_info.bookmark_id,
                        private: thumb_info.bookmark_illust_restrict == 1,
                    };
                }

                // illustType can be a string in these instead of an int, so convert it.
                remapped_thumb_info.illustType = parseInt(remapped_thumb_info.illustType);

                if(source == "rankings")
                {
                    // Rankings thumbnail info gives createDate as a Unix timestamp.  Convert
                    // it to the same format as everything else.
                    let date = new Date(remapped_thumb_info.createDate*1000);
                    remapped_thumb_info.createDate = date.toISOString();
                }
                else if(source == "illust_list")
                {
                    // This is the only source of thumbnail data that doesn't give createDate at
                    // all.  This source is very rarely used now, so just fill in a bogus date.
                    remapped_thumb_info.createDate = new Date(0).toISOString();
                }
            }
            else if(source == "internal")
            {
                remapped_thumb_info = thumb_info;
            }
            else
                throw "Unrecognized source: " + source;

            // "internal" is for thumbnail data which is already processed.
            if(source != "internal")
            {
                // These fields are strings in some sources.  Switch them to ints.
                for(let key of ["pageCount", "width", "height"])
                {
                    if(remapped_thumb_info[key] != null)
                        remapped_thumb_info[key] = parseInt(remapped_thumb_info[key]);
                }

                // Different APIs return different thumbnail URLs.
                remapped_thumb_info.url = helpers.get_high_res_thumbnail_url(remapped_thumb_info.url);
            
                // Create a list of thumbnail URLs.
                remapped_thumb_info.previewUrls = [];
                for(let page = 0; page < remapped_thumb_info.pageCount; ++page)
                {
                    let url = helpers.get_high_res_thumbnail_url(remapped_thumb_info.url, page);
                    remapped_thumb_info.previewUrls.push(url);
                }

                // Remove url.  Use previewUrl[0] instead
                delete remapped_thumb_info.url;

                // Rename .tags to .tagList, for consistency with the flat tag list in illust info.
                remapped_thumb_info.tagList = remapped_thumb_info.tags;
                delete remapped_thumb_info.tags;
            }

            // This is really annoying: the profile picture is the only field that's present in thumbnail
            // info but not illust info.  We want a single basic data set for both, so that can't include
            // the profile picture.  But, we do want to display it in places where we can't get user
            // info (muted search results), so store it separately.
            if(remapped_thumb_info.profileImageUrl)
            {
                let profile_image_url = remapped_thumb_info.profileImageUrl;
                profile_image_url = profile_image_url.replace("_50.", "_170."),
                this.user_profile_urls[remapped_thumb_info.userId] = profile_image_url;
                delete remapped_thumb_info.profileImageUrl;
            }

            all_thumb_info[remapped_thumb_info.id] = remapped_thumb_info;
        }

        // Load any extra image data stored for these media IDs.
        let illust_ids = Object.keys(all_thumb_info);
        let extra_data = await extra_image_data.get.load_illust_data(illust_ids);

        for(let [illust_id, info] of Object.entries(all_thumb_info))
        {
            // Store extra data for each page.
            info.extraData = extra_data[illust_id]?.pages || {};

            // Store the data.
            this.add_thumbnail_info(info);

            let media_id = helpers.illust_id_to_media_id(illust_id);
            delete this.loading_ids[media_id];
        }

        // Broadcast that we have new thumbnail data available.
        window.dispatchEvent(new Event("thumbnailsloaded"));
    };

    // Store thumbnail info.
    add_thumbnail_info(thumb_info)
    {
        let media_id = helpers.illust_id_to_media_id(thumb_info.id);
        this.thumbnail_data[media_id] = thumb_info;
    }

    is_muted(thumb_info)
    {
        if(muting.singleton.is_muted_user_id(thumb_info.illust_user_id))
            return true;
        if(muting.singleton.any_tag_muted(thumb_info.tags))
            return true;
        return false;
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

    thumbnail_info_keys = [
        "id",
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
    // thumbnail_info_keys to be included, regardless of where the data came from.
    _check_illust_data(illust_data)
    {
        if(illust_data == null)
            return;

        for(let key of this.thumbnail_info_keys)
        {
            if(!(key in illust_data))
            {
                console.warn(`Missing key ${key} for early data`, illust_data);
                continue;
            }
        }
    }
}

