// This caches media info which isn't a part of regular illust info.

import { helpers } from 'vview/misc/helpers.js';

export default class ExtraCache
{
    constructor()
    {
        this._bookmarkedImageTags = { };
        this._recentLikes = { }
        this._quickUserData = { };
    }

    // Remember when we've liked an image recently, so we don't spam API requests.
    getLikedRecently(mediaId)
    {
        mediaId = helpers.getMediaIdFirstPage(mediaId);
        return this._recentLikes[mediaId];
    }

    addLikedRecently(mediaId)
    {
        mediaId = helpers.getMediaIdFirstPage(mediaId);
        this._recentLikes[mediaId] = true;
    }

    // Load bookmark tags.
    //
    // There's no visible API to do this, so we have to scrape the bookmark_add page.  I wish
    // they'd just include this in bookmarkData.  Since this takes an extra request, we should
    // only load this if the user is viewing/editing bookmark tags.
    async loadBookmarkDetails(mediaId)
    {
        // If we know the image isn't bookmarked, we know there are no bookmark tags, so
        // we can skip this.
        mediaId = helpers.getMediaIdFirstPage(mediaId);
        let thumb = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(thumb && thumb.bookmarkData == null)
            return [];

        // The local API just puts bookmark info on the illust info.  Copy over the current
        // data.
        if(helpers.isMediaIdLocal(mediaId))
            this._bookmarkedImageTags[mediaId] = thumb.bookmarkData.tags;

        // If we already have bookmark tags, return them.  Return a copy, so modifying the
        // result doesn't change our cached data.
        if(this._bookmarkedImageTags[mediaId])
            return [...this._bookmarkedImageTags[mediaId]]; 

        let [illustId] = helpers.mediaIdToIllustIdAndPage(mediaId);
        let bookmarkPage = await helpers.fetchDocument("/bookmark_add.php?type=illust&illust_id=" + illustId);
        
        let tags = bookmarkPage.querySelector(".bookmark-detail-unit form input[name='tag']").value;
        tags = tags.split(" ");
        tags = tags.filter((value) => { return value != ""; });

        this._bookmarkedImageTags[mediaId] = tags;
        return this._bookmarkedImageTags[mediaId]; 
    }

    // Return bookmark tags if they're already loaded, otherwise return null.
    getBookmarkDetailsSync(mediaId)
    {
        if(helpers.isMediaIdLocal(mediaId))
        {
            let thumb = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
            if(thumb && thumb.bookmarkData == null)
                return [];
   
            this._bookmarkedImageTags[mediaId] = thumb.bookmarkData.tags;
            return this._bookmarkedImageTags[mediaId]; 
        }
        else
            return this._bookmarkedImageTags[mediaId]; 
    }

    // Replace our cache of bookmark tags for an image.  This is used after updating
    // a bookmark.
    updateCachedBookmarkTags(mediaId, tags)
    {
        mediaId = helpers.getMediaIdFirstPage(mediaId);

        if(tags == null)
            delete this._bookmarkedImageTags[mediaId];
        else
            this._bookmarkedImageTags[mediaId] = tags;

        ppixiv.mediaCache.callMediaInfoModifiedCallbacks(mediaId);
    }

    // This is a simpler form of thumbnail data for user info.  This is just the bare minimum
    // info we need to be able to show a user thumbnail on the search page.  This is used when
    // we're displaying lots of users in search results.
    //
    // We can get this info from two places, the following page (data_source_follows) and the
    // user recommendations page (DataSource_DiscoverUsers).  Of course, since Pixiv never
    // does anything the same way twice, they have different formats.
    //
    // The only info we need is:
    // userId
    // userName
    // profileImageUrl
    addQuickUserData(sourceData, source="normal")
    {
        let data = null;
        if(source == "normal" || source == "following")
        {
            data = {
                userId: sourceData.userId,
                userName: sourceData.userName,
                profileImageUrl: sourceData.profileImageUrl,
            };
        }
        else if(source == "recommendations")
        {
            data = {
                userId: sourceData.userId,
                userName: sourceData.name,
                profileImageUrl: sourceData.imageBig,
            };
        }
        else if(source == "users_bookmarking_illust")
        {
            data = {
                userId: sourceData.user_id,
                userName: sourceData.user_name,
                profileImageUrl: sourceData.profile_img,
            };
        }
        else
            throw "Unknown source: " + source;

        this._quickUserData[data.userId] = data;        
    }

    getQuickUserData(userId)
    {
        return this._quickUserData[userId];
    }
}
