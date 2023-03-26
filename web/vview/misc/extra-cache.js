// This caches media info which isn't a part of regular illust info.

import { helpers } from 'vview/misc/helpers.js';
import MediaInfo  from 'vview/misc/media-info.js';

export default class ExtraCache
{
    constructor()
    {
        this._bookmarkedImageTags = { };
        this._recentLikes = { }
        this._quickUserData = { };

        this._getMediaAspectRatioLoads = {};
        this._mediaIdAspectRatio = { };
    }

    // Remember when we've liked an image recently, so we don't spam API requests.
    getLikedRecently(mediaId)
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        return this._recentLikes[mediaId];
    }

    addLikedRecently(mediaId)
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
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
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        let thumb = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(thumb && thumb.bookmarkData == null)
            return [];

        // The local API just puts bookmark info on the illust info.  Copy over the current
        // data.
        if(helpers.mediaId.isLocal(mediaId))
            this._bookmarkedImageTags[mediaId] = thumb.bookmarkData.tags;

        // If we already have bookmark tags, return them.  Return a copy, so modifying the
        // result doesn't change our cached data.
        if(this._bookmarkedImageTags[mediaId])
            return [...this._bookmarkedImageTags[mediaId]]; 

        let [illustId] = helpers.mediaId.toIllustIdAndPage(mediaId);
        let bookmarkPage = await helpers.pixivRequest.fetchDocument("/bookmark_add.php?type=illust&illust_id=" + illustId);
        
        let tags = bookmarkPage.querySelector(".bookmark-detail-unit form input[name='tag']").value;
        tags = tags.split(" ");
        tags = tags.filter((value) => { return value != ""; });

        this._bookmarkedImageTags[mediaId] = tags;
        return this._bookmarkedImageTags[mediaId]; 
    }

    // Return bookmark tags if they're already loaded, otherwise return null.
    getBookmarkDetailsSync(mediaId)
    {
        if(helpers.mediaId.isLocal(mediaId))
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
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);

        if(tags == null)
            delete this._bookmarkedImageTags[mediaId];
        else
            this._bookmarkedImageTags[mediaId] = tags;

        MediaInfo.callMediaInfoModifiedCallbacks(mediaId);
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

    // Image aspect ratios from thumbnails
    //
    // Pixiv doesn't include image dimensions for manga pages in most APIs, so it takes an extra
    // round trip to get them, and we don't want to do that in bulk and spam the server.  For
    // anything we can make do with just the aspect ratio, we can load the thumbnail and just
    // look at its size.  This is a lot more reasonable to load in bulk (that's what they're for),
    // and we're usually loading them anyway.
    //
    // By default this requires that media info already be cached.  This is done when we add data
    // from data sources, where we should already be caching this info, and this makes sure we don't
    // accidentally make hundreds of individual media info lookups if that doesn't happen.
    //
    // Note that the aspect ratio from this is approximate, since it's quantized by the thumbnail
    // resolution.
    getMediaAspectRatio(mediaId, { allowMediaInfoLoad=false }={})
    {
        if(this._mediaIdAspectRatio[mediaId] != null)
            return this._mediaIdAspectRatio[mediaId];

        if(this._getMediaAspectRatioLoads[mediaId])
            return this._getMediaAspectRatioLoads[mediaId];

        let promise = this._getMediaAspectRatioInner(mediaId, { allowMediaInfoLoad });
        this._getMediaAspectRatioLoads[mediaId] = promise;
        promise.then((result) => {
            this._mediaIdAspectRatio[mediaId] = result;
        });
        promise.finally(() => {
            delete this._getMediaAspectRatioLoads[mediaId];
        });
        return promise;
    }

    getMediaAspectRatioSync(mediaId)
    {
        return this._mediaIdAspectRatio[mediaId];
    }

    async _getMediaAspectRatioInner(mediaId, { allowMediaInfoLoad=false }={})
    {
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(mediaInfo == null)
        {
            if(!allowMediaInfoLoad)
            {
                console.error(`getMediaResolution(${mediaId}): media info wasn't loaded`);
                return null;
            }

            mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, { full: false });
        }

        // We always have the resolution for local images.
        if(helpers.mediaId.isLocal(mediaId))
            return mediaInfo.width / mediaInfo.height;

        let page = helpers.mediaId.parse(mediaId).page;
        let url = mediaInfo.previewUrls[page];

        let img = document.createElement("img");
        img.src = url;

        return await this.registerLoadingThumbnail(mediaId, img);
    }

    // Return { aspectRatios, promise }.  aspectRatios is a dictionary of IDs to aspect
    // ratios we already know.  If any aren't known and a lookup is started, promise will
    // resolve when the lookups complete, otherwise promise is null.
    batchGetMediaAspectRatio(mediaIds)
    {
        let aspectRatios = {};
        let promises = [];
        for(let mediaId of mediaIds)
        {
            let aspectRatio = this.getMediaAspectRatioSync(mediaId);
            if(aspectRatio != null)
                aspectRatios[mediaId] = aspectRatio;
            else
                promises.push(this.getMediaAspectRatio(mediaId));
        }

        let promise = promises.length > 0? Promise.all(promises):null;
        return { aspectRatios, promise };
    }

    // Register a thumbnail image that's being loaded.  This can be called if we're loading an
    // image thumbnail, so we'll remember its resolution for future calls to getMediaAspectRatio.
    async registerLoadingThumbnail(mediaId, img)
    {
        await helpers.other.waitForImageLoad(img);

        // If the image load fails, waitForImageLoad will still resolve.  Store a fallback aspect
        // ratio, so we can't end up getting stuck trying to load a broken image over and over.
        // waitForImageLoad will still resolve if the image load fails
        let aspectRatio = img.naturalWidth / img.naturalHeight;
        if(img.naturalHeight == 0)
            aspectRatio = 0;

        this._mediaIdAspectRatio[mediaId] = aspectRatio;
        return aspectRatio;
    }
}
