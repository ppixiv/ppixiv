ppixiv.media_cache_mappings = class
{

    // Get the mapping from /ajax/user/id/illusts/bookmarks to illust_list.php's keys.
    static thumbnail_info_map_illust_list =
    [
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

        // illust_list.php doesn't give the creation date, and it doesn't have the aiType field.
        [null, "createDate"],
        [null, "aiType"],
    ];

    static thumbnail_info_map_ranking = [
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

        // Rankings don't return aiType, but we fill it in ourself in the data source.
        ["aiType", "aiType"],
    ];
    
    // Partial media info comes from Pixiv search APIs.  They all have different formats
    // for the same data.  Remap it to our standardized format, which uses the same fields
    // as full media info.
    //
    // name           URL
    // normal         /ajax/user/id/illusts/bookmarks
    // illust_list    illust_list.php 
    // following      bookmark_new_illust.php 
    // following      search.php 
    // rankings       ranking.php
    //
    // We map each of these to "normal".
    static remap_partial_media_info(thumb_info, source)
    {
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

            // Put id in illustId and set mediaId.  This matches what we do in illust_data.
            remapped_thumb_info.illustId = remapped_thumb_info.id;
            remapped_thumb_info.mediaId = helpers.illust_id_to_media_id(remapped_thumb_info.illustId);
            delete remapped_thumb_info.id;
        }
        
        // This is really annoying: the profile picture is the only field that's present in thumbnail
        // info but not illust info.  We want a single basic data set for both, so that can't include
        // the profile picture.  But, we do want to display it in places where we can't get user
        // info (muted search results), so store it separately.
        let profile_image_url = null;
        if(remapped_thumb_info.profileImageUrl)
        {
            profile_image_url = remapped_thumb_info.profileImageUrl;
            profile_image_url = profile_image_url.replace("_50.", "_170."),
            delete remapped_thumb_info.profileImageUrl;
        }

        return { remapped_thumb_info, profile_image_url };
    }
}
