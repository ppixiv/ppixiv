import { helpers } from 'vview/misc/helpers.js';

export default class MediaCacheMappings
{
    // Get the mapping from /ajax/user/id/illusts/bookmarks to illust_list.php's keys.
    static _thumbnailInfoMapIllustList =
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

    static _thumbnailInfoMapRanking = [
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
    static remapPartialMediaInfo(mediaInfo, source)
    {
        let remappedMediaInfo = null;
        if(source == "normal")
        {
            // The data is already in the format we want.  The only change we make is
            // to rename title to illustTitle, to match it up with illust info.
            if(!("title" in mediaInfo))
            {
                console.warn("Thumbnail info is missing key: title");
            }
            else
            {
                mediaInfo.illustTitle = mediaInfo.title;
                delete mediaInfo.title;
            }

            // Check that all keys we expect exist, and remove any keys we don't know about
            // so we don't use them accidentally.
            let thumbnailInfoMap = this._thumbnailInfoMapRanking;
            remappedMediaInfo = { };
            for(let pair of thumbnailInfoMap)
            {
                let key = pair[1];
                if(!(key in mediaInfo))
                {
                    console.warn("Thumbnail info is missing key:", key);
                    continue;
                }
                remappedMediaInfo[key] = mediaInfo[key];
            }

            if(!('bookmarkData' in mediaInfo))
                console.warn("Thumbnail info is missing key: bookmarkData");
            else
            {
                remappedMediaInfo.bookmarkData = mediaInfo.bookmarkData;

                // See above.
                if(remappedMediaInfo.bookmarkData != null)
                    delete remappedMediaInfo.bookmarkData.bookmarkId;
            }
        }
        else if(source == "illust_list" || source == "rankings")
        {
            // Get the mapping for this mode.
            let thumbnailInfoMap = 
                source == "illust_list"? this._thumbnailInfoMapIllustList:
                    this._thumbnailInfoMapRanking;

            remappedMediaInfo = { };
            for(let pair of thumbnailInfoMap)
            {
                let fromKey = pair[0];
                let toKey = pair[1];
                if(fromKey == null)
                {
                    // This is just for illust_list createDate.
                    remappedMediaInfo[toKey] = null;
                    continue;
                }

                if(!(fromKey in mediaInfo))
                {
                    console.warn("Thumbnail info is missing key:", fromKey);
                    continue;
                }
                let value = mediaInfo[fromKey];
                remappedMediaInfo[toKey] = value;
            }

            // Make sure that the illust IDs and user IDs are strings.
            remappedMediaInfo.id = "" + remappedMediaInfo.id;
            remappedMediaInfo.userId = "" + remappedMediaInfo.userId;

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
            remappedMediaInfo.bookmarkData = null;
            if(!('is_bookmarked' in mediaInfo))
                console.warn("Thumbnail info is missing key: is_bookmarked");
            if(mediaInfo.is_bookmarked)
            {
                remappedMediaInfo.bookmarkData = {
                    // See above.
                    // bookmarkId: mediaInfo.bookmark_id,
                    private: mediaInfo.bookmark_illust_restrict == 1,
                };
            }

            // illustType can be a string in these instead of an int, so convert it.
            remappedMediaInfo.illustType = parseInt(remappedMediaInfo.illustType);

            if(source == "rankings")
            {
                // Rankings thumbnail info gives createDate as a Unix timestamp.  Convert
                // it to the same format as everything else.
                let date = new Date(remappedMediaInfo.createDate*1000);
                remappedMediaInfo.createDate = date.toISOString();
            }
            else if(source == "illust_list")
            {
                // This is the only source of thumbnail data that doesn't give createDate at
                // all.  This source is very rarely used now, so just fill in a bogus date.
                remappedMediaInfo.createDate = new Date(0).toISOString();
            }
        }
        else if(source == "internal")
        {
            remappedMediaInfo = mediaInfo;
        }
        else
            throw "Unrecognized source: " + source;

        // "internal" is for thumbnail data which is already processed.
        if(source != "internal")
        {
            // These fields are strings in some sources.  Switch them to ints.
            for(let key of ["pageCount", "width", "height"])
            {
                if(remappedMediaInfo[key] != null)
                    remappedMediaInfo[key] = parseInt(remappedMediaInfo[key]);
            }

            // Different APIs return different thumbnail URLs.
            remappedMediaInfo.url = helpers.pixiv.getHighResThumbnailUrl(remappedMediaInfo.url);
        
            // Create a list of thumbnail URLs.
            remappedMediaInfo.previewUrls = [];
            for(let page = 0; page < remappedMediaInfo.pageCount; ++page)
            {
                let url = helpers.pixiv.getHighResThumbnailUrl(remappedMediaInfo.url, page);
                remappedMediaInfo.previewUrls.push(url);
            }

            // Remove url.  Use previewUrl[0] instead
            delete remappedMediaInfo.url;

            // Rename .tags to .tagList, for consistency with the flat tag list in illust info.
            remappedMediaInfo.tagList = remappedMediaInfo.tags;
            delete remappedMediaInfo.tags;

            // Put id in illustId and set mediaId.  This matches what we do in illust_data.
            remappedMediaInfo.illustId = remappedMediaInfo.id;
            remappedMediaInfo.mediaId = helpers.mediaId.fromIllustId(remappedMediaInfo.illustId);
            delete remappedMediaInfo.id;
        }
        
        // This is really annoying: the profile picture is the only field that's present in thumbnail
        // info but not illust info.  We want a single basic data set for both, so that can't include
        // the profile picture.  But, we do want to display it in places where we can't get user
        // info (muted search results), so store it separately.
        let profileImageUrl = null;
        if(remappedMediaInfo.profileImageUrl)
        {
            profileImageUrl = remappedMediaInfo.profileImageUrl;
            profileImageUrl = profileImageUrl.replace("_50.", "_170."),
            delete remappedMediaInfo.profileImageUrl;
        }

        return { remappedMediaInfo, profileImageUrl };
    }
}
