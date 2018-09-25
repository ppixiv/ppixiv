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

            // We do our own muting, but for some reason this flag is needed to get bookmark info.
            exclude_muted_illusts: 1,
        }, function(results) {
            this.loaded_thumbnail_info(results, "illust_list");
        }.bind(this));
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
            ["illust_title", "title"],
            ["user_profile_img", "profileImageUrl"],

            ["user_name", "userName"],
        ];
        return this._thumbnail_info_map_illust_list;
    };

    // Get the mapping from search.php and bookmark_new_illust.php to illust_list.php's keys.
    get thumbnail_info_map_following()
    {
        if(this._thumbnail_info_map_following != null)
            return this._thumbnail_info_map_following;

        this._thumbnail_info_map_following = [
            ["illustId", "id"],
            ["url", "url"],
            ["tags", "tags"],
            ["userId", "userId"],
            ["width", "width"],
            ["height", "height"],
            ["pageCount", "pageCount"],
            ["illustTitle", "title"],
            ["userName", "userName"],
//            ["illustType", "illustType"],
//            ["user_profile_img", "profileImageUrl"],
        ];
        return this._thumbnail_info_map_following;
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
    //
    // Source is either the format we use directly, "normal" (returned by /ajax/user/id/illusts/bookmarks),
    // "illust_list" for illust_list.php, or "following" for bookmark_new_illust.php (following).
    // These are different APIs that return the same data in a bunch of different ways.  We map them to
    // the format used by "illust_list".
    loaded_thumbnail_info(thumb_result, source)
    {
        if(thumb_result.error)
            return;

        var thumbnail_info_map = this.thumbnail_info_map_illust_list;
        var urls = [];
        for(var thumb_info of thumb_result)
        {
            if(source == "normal")
            {
                // The data is already in the format we want.  Just check that all keys we
                // expect exist, and remove any keys we don't know about so we don't use them
                // accidentally.
                var thumbnail_info_map = this.thumbnail_info_map_illust_list;
                var remapped_thumb_info = { };
                for(var pair of thumbnail_info_map)
                {
                    var key = pair[1];
                    if(!(key in thumb_info))
                    {
                        console.warn("Thumbnail info is missing key:", from_key);
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
            else if(source == "illust_list" || source == "following")
            {
                // Get the mapping for this mode.
                var thumbnail_info_map = source == "illust_list"? this.thumbnail_info_map_illust_list:this.thumbnail_info_map_following;
                var remapped_thumb_info = { };
                for(var pair of thumbnail_info_map)
                {
                    var from_key = pair[0];
                    var to_key = pair[1];
                    if(!(from_key in thumb_info))
                    {
                        console.warn("Thumbnail info is missing key:", from_key);
                        continue;
                    }
                    var value = thumb_info[from_key];
                    remapped_thumb_info[to_key] = value;
                }

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
                if(source == "illust_list")
                {
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
                }
                else if(source == "following")
                {
                    // Why are there fifteen API variants for everything?  It's as if they
                    // hire a contractor for every feature and nobody ever talks to each other,
                    // so every feature has its own new API layout.
                    if(!('isBookmarked' in thumb_info))
                        console.warn("Thumbnail info is missing key: isBookmarked");
                    if(thumb_info.isBookmarked)
                    {
                        remapped_thumb_info.bookmarkData = {
                            private: thumb_info.isPrivateBookmark,
                        };
                    }
                }

                // illustType can be a string in these instead of an int, so convert it.
                remapped_thumb_info.illustType = parseInt(remapped_thumb_info.illustType);

                // Some of these APIs don't provide the user's avatar URL.  We only use it in a blurred-
                // out thumbnail for muted images, so just drop in the "no avatar" image.
                if(remapped_thumb_info.profileImageUrl == null)
                    remapped_thumb_info.profileImageUrl = "https://s.pximg.net/common/images/no_profile_s.png";
            }

            thumb_info = remapped_thumb_info;

            // Store the data.
            this.add_thumbnail_info(thumb_info);

            var illust_id = thumb_info.id;
            delete this.loading_ids[illust_id];

            // Don't preload muted images.
            if(!this.is_muted(thumb_info))
                urls.push(thumb_info.url);
        }

        // Preload thumbnails.
        helpers.preload_images(urls);

        // Broadcast that we have new thumbnail data available.
        window.dispatchEvent(new Event("thumbnailsLoaded"));
    };

    // Store thumbnail info.
    add_thumbnail_info(thumb_info)
    {
        var illust_id = thumb_info.id;
        this.thumbnail_data[illust_id] = thumb_info;

        // Let image_data know about the user for this illust, to speed up fetches later.
        image_data.singleton().set_user_id_for_illust_id(thumb_info.id, thumb_info.userId);
    }

    is_muted(thumb_info)
    {
        if(muting.singleton.is_muted_user_id(thumb_info.illust_user_id))
            return true;
        if(muting.singleton.any_tag_muted(thumb_info.tags))
            return true;
        return false;
    }
}

