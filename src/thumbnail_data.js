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
        this.loaded_thumbnail_info = this.loaded_thumbnail_info.bind(this);

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
   
    is_id_loaded_or_loading(illust_id)
    {
        return this.thumbnail_data[illust_id] != null || this.loading_ids[illust_id];
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
                // If this is a user:user_id instead of an illust ID, make sure we don't request it
                // as an illust ID.
                if(illust_id.indexOf(":") != -1)
                    continue;
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
    async load_thumbnail_info(illust_ids)
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
        var result = await helpers.rpc_get_request("/rpc/illust_list.php", {
            illust_ids: ids_to_load.join(","),

            // Specifying this gives us 240x240 thumbs, which we want, rather than the 150x150
            // ones we'll get if we don't (though changing the URL is easy enough too).
            page: "discover",

            // We do our own muting, but for some reason this flag is needed to get bookmark info.
            exclude_muted_illusts: 1,
        });

        this.loaded_thumbnail_info(result, "illust_list");
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

    
    // Given a low-res thumbnail URL from thumbnail data, return a high-res thumbnail URL.
    // If page isn't 0, return a URL for the given manga page.
    get_high_res_thumbnail_url(url, page=0)
    {
        // Some random results on the user recommendations page also return this:
        //
        // /c/540x540_70/custom-thumb/img/.../12345678_custom1200.jpg
        //
        // Replace /custom-thumb/' with /img-master/ first, since it makes matching below simpler.
        url = url.replace("/custom-thumb/", "/img-master/");

        // path should look like
        //
        // /c/250x250_80_a2/img-master/img/.../12345678_square1200.jpg
        //
        // where 250x250_80_a2 is the resolution and probably JPEG quality.  We want
        // the higher-res thumbnail (which is "small" in the full image data), which
        // looks like:
        //
        // /c/540x540_70/img-master/img/.../12345678_master1200.jpg
        //
        // The resolution field is changed, and "square1200" is changed to "master1200".
        var url = new URL(url, ppixiv.location);
        var path = url.pathname;
        var re = /(\/c\/)([^\/]+)(.*)(square1200|master1200|custom1200).jpg/;
        var match = re.exec(path);
        if(match == null)
        {
            console.warn("Couldn't parse thumbnail URL:", path);
            return url.toString();
        }

        url.pathname = match[1] + "540x540_70" + match[3] + "master1200.jpg";

        if(page != 0)
        {
            // Manga URLs end with:
            //
            // /c/540x540_70/custom-thumb/img/.../12345678_p0_master1200.jpg
            //
            // p0 is the page number.
            url.pathname = url.pathname.replace("_p0_master1200", "_p" + page + "_master1200");
        }

        return url.toString();

    }

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
    loaded_thumbnail_info(thumb_result, source)
    {
        if(thumb_result.error)
            return;

        let remapped_thumb_info = null;
        for(var thumb_info of thumb_result)
        {
            // Ignore entries with "isAdContainer".  These aren't search results at all and just contain
            // stuff we're not interested in.
            if(thumb_info.isAdContainer)
                continue;

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
            else
                throw "Unrecognized source: " + source;

            // These fields are strings in some sources.  Switch them to ints.
            for(let key of ["pageCount", "width", "height"])
            {
                if(remapped_thumb_info[key] != null)
                    remapped_thumb_info[key] = parseInt(remapped_thumb_info[key]);
            }

            // Different APIs return different thumbnail URLs.
            remapped_thumb_info.url = this.get_high_res_thumbnail_url(remapped_thumb_info.url);
            
            remapped_thumb_info.mangaPages = [];
            for(let page = 0; page < remapped_thumb_info.pageCount; ++page)
            {
                let url = this.get_high_res_thumbnail_url(remapped_thumb_info.url, page);
                remapped_thumb_info.mangaPages.push(url);
            }

            thumb_info = remapped_thumb_info;

            // Store the data.
            this.add_thumbnail_info(thumb_info);

            var illust_id = thumb_info.id;
            delete this.loading_ids[illust_id];

            // Cache the user's profile URL.  This lets us display it more quickly when we
            // haven't loaded user info yet.
            let profile_image_url = thumb_info.profileImageUrl;
            profile_image_url = profile_image_url.replace("_50.", "_170."),
            this.user_profile_urls[thumb_info.userId] = profile_image_url;
        }

        // Broadcast that we have new thumbnail data available.
        window.dispatchEvent(new Event("thumbnailsLoaded"));
    };

    // Store thumbnail info.
    add_thumbnail_info(thumb_info)
    {
        var illust_id = thumb_info.id;
        this.thumbnail_data[illust_id] = thumb_info;
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
    add_quick_user_data(user_data, source)
    {
        let data = null;
        if(source == "following")
        {
            data = {
                userId: user_data.userId,
                userName: user_data.userName,
                profileImageUrl: user_data.profileImageUrl,
            };
        }
        else if(source == "recommendations")
        {
            data = {
                userId: user_data.userId,
                userName: user_data.name,
                profileImageUrl: user_data.imageBig,
            };
        }
        else if(source == "users_bookmarking_illust" || source == "user_search")
        {
            data = {
                userId: user_data.user_id,
                userName: user_data.user_name,
                profileImageUrl: user_data.profile_img,
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

