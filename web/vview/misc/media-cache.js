// This stores loaded info about images.
// 
// Image info can be full or partial.  Partial image info comes from Pixiv search APIs,
// and only includes a subset of info.  This is returned by a bunch of APIs that all
// use different names for the same thing, so we remap them to a format consistent with
// full image info.  We also store image info for the local API here, which is always full
// info.
// 
// Full image info also includes manga page info and animation info.  These require separate
// API calls.  We always load that data, since we almost always need it.
// 
// This also includes extra image info, which is used for storing image edits.  This is stored
// in IDB for Pixiv images, and natively by the local API.
// 
// Bookmark tags aren't handled here.  It requires a separate API call to load and we don't
// always need it, so it doesn't fit here.  See ppixiv.extraCache.loadBookmarkDetails.
// 
// Callers can request full or partial data.  If partial data is requested, we can return
// full data instead if we already have it, since it's a superset.  If we have to load info
// for a single image, we'll always load full info.  We can only batch load partial info,
// since Pixiv doesn't have any API to allow batch loading full info.
//
// Our media IDs encode Pixiv manga pages, but this only deals with top-level illustrations, and
// the page number in illust media IDs is always 1 here.

import LocalAPI from '/vview/misc/local-api.js';
import MediaCacheMappings from '/vview/misc/media-cache-mappings.js';
import MediaInfo, { MediaInfoEvents }  from '/vview/misc/media-info.js';
import { helpers } from '/vview/misc/helpers.js';

// This handles fetching and caching image data.
export default class MediaCache extends EventTarget
{
    constructor()
    {
        super();
        
        // Cached data:
        this._mediaInfo = { };

        // Negative cache to remember illusts that don't exist, so we don't try to
        // load them repeatedly:
        this._nonexistantMediaIds = { };

        // Promises for ongoing requests:
        this._mediaInfoLoadsFull = {};
        this._mediaInfoLoadsPartial = {};

        this.userProfileUrls = {};

        ppixiv.settings.addEventListener("pixiv_cdn", () => this._updatePixivURLs());

        // XXX: remove
        MediaInfoEvents.addEventListener("mediamodified", (e) => {
            let event = new Event("mediamodified");
            event.mediaId = e.mediaId;
            this.dispatchEvent(event);
        });
    };

    // Load media data asynchronously.  If full is true, return full info, otherwise return
    // partial info.
    //
    // If partial info is requested and we have full info, we'll reduce it to partial info if
    // safe is true, otherwise we'll just return full info.  This helps avoid requesting
    // partial info and then accidentally using fields from full info.
    async getMediaInfo(mediaId, { full=true, safe=true }={})
    {
        let mediaInfo = await this._getMediaInfoInner(mediaId, { full });
        if(mediaInfo != null && !full && safe)
            mediaInfo = mediaInfo.partialInfo;

        return mediaInfo;
    }

    _getMediaInfoInner(mediaId, { full=true }={})
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        if(mediaId == null)
            return null;

        // Stop if we know this illust doesn't exist.
        if(mediaId in this._nonexistantMediaIds)
            return null;

        // If we already have the image data, just return it.
        if(this._mediaInfo[mediaId] != null && (!full || this._mediaInfo[mediaId].full))
            return Promise.resolve(this._mediaInfo[mediaId]);

        // If there's already a load in progress, wait for the running promise.  Note that this
        // promise will add to this._mediaInfo if it succeeds, but it won't necessarily return
        // the data directly since it may be a batch load.
        if(this._mediaInfoLoadsFull[mediaId] != null)
            return this._mediaInfoLoadsFull[mediaId].then(() => this._mediaInfo[mediaId]);
        if(!full && this._mediaInfoLoadsPartial[mediaId] != null)
            return this._mediaInfoLoadsPartial[mediaId].then(() => this._mediaInfo[mediaId]);
        
        // Start the load.  If something's requesting partial info for a single image
        // then we'll almost always need full info too, so we always just load full info
        // here.
        let loadPromise = this._loadMediaInfo(mediaId);
        this._startedLoadingMediaInfoFull(mediaId, loadPromise);
        return loadPromise;
    }

    // Like getMediaInfo, but return the result immediately, or null if it's not
    // already loaded.
    getMediaInfoSync(mediaId, { full=true, safe=true }={})
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        let mediaInfo = this._mediaInfo[mediaId];

        // If full info was requested and we only have partial info, don't return it.
        if(full && !mediaInfo?.full)
            return null;

        if(mediaInfo && !full && safe)
            mediaInfo = mediaInfo.partialInfo;

        return mediaInfo;
    }
    
    // If getMediaInfo returned null, return the error message.
    getMediaLoadError(mediaId)
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        return this._nonexistantMediaIds[mediaId];
    }

    // Refresh media info for the given media ID.
    //
    // If an image only has partial info loaded, this will cause its full info to be loaded.
    //
    // refreshFromDisk: If true, ask the server to reload from disk even if it thinks the file
    // hasn't changed.
    async refreshMediaInfo(mediaId, { refreshFromDisk=false }={})
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        await this._loadMediaInfo(mediaId, { refreshFromDisk });
    }

    // Add full media info from a Pixiv API response.  This will trigger loads for any
    // missing data, like manga info.
    addPixivFullMediaInfo(mediaInfo)
    {
        let mediaId = helpers.mediaId.fromIllustId(mediaInfo.id);
        let loadPromise = this._loadMediaInfo(mediaId, { mediaInfo });
        this._startedLoadingMediaInfoFull(mediaId, loadPromise);
        return loadPromise;
    }

    _startedLoadingMediaInfoFull(mediaId, loadPromise)
    {
        // Remember that we're loading this ID, and unregister it when it completes.
        this._mediaInfoLoadsFull[mediaId] = loadPromise;
        this._mediaInfoLoadsFull[mediaId].finally(() => {
            if(this._mediaInfoLoadsFull[mediaId] === loadPromise)
                delete this._mediaInfoLoadsFull[mediaId];
        });
    }

    _startedLoadingMediaInfoPartial(mediaId, loadPromise)
    {
        // Remember that we're loading this ID, and unregister it when it completes.
        this._mediaInfoLoadsPartial[mediaId] = loadPromise;
        this._mediaInfoLoadsPartial[mediaId].finally(() => {
            if(this._mediaInfoLoadsPartial[mediaId] === loadPromise)
                delete this._mediaInfoLoadsPartial[mediaId];
        });
    }

    // Load mediaId and all data that it depends on.
    //
    // If we already have the image data (not necessarily the rest, like ugoira_metadata),
    // it can be supplied with mediaInfo.
    async _loadMediaInfo(mediaId, { mediaInfo=null, refreshFromDisk=false }={})
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        let [illustId] = helpers.mediaId.toIllustIdAndPage(mediaId);

        delete this._nonexistantMediaIds[mediaId];

        // If this is a local image, use our API to retrieve it.
        if(helpers.mediaId.isLocal(mediaId))
            return await this._loadLocalImageData(mediaId, { refreshFromDisk });

        // console.log("Fetching", mediaId);

        let mangaPromise = null;
        let ugoiraPromise = null;

        // Given an illustType, start any fetches we can.
        let startLoading = (illustType, pageCount) => {
            // If we know the illust type and haven't started loading other data yet, start them.
            if(pageCount != null && pageCount > 1 && mangaPromise == null && mediaInfo?.mangaPages == null)
                mangaPromise = helpers.pixivRequest.get(`/ajax/illust/${illustId}/pages`, {});
            if(illustType == 2 && ugoiraPromise == null && (mediaInfo == null || mediaInfo.ugoiraMetadata == null))
                ugoiraPromise = helpers.pixivRequest.get(`/ajax/illust/${illustId}/ugoira_meta`);
        };

        // If we already had partial info, we can start loading other metadata immediately instead
        // of waiting for the illust info to load, since we already know the image type.
        let partialInfo = this._mediaInfo[mediaId];
        if(partialInfo != null)
            startLoading(partialInfo.illustType, partialInfo.pageCount);
    
        // If we don't have illust data, block while it loads.
        if(mediaInfo == null)
        {
            let illustResultPromise = helpers.pixivRequest.get(`/ajax/illust/${illustId}`, {});
            let illustResult = await illustResultPromise;
            if(illustResult == null || illustResult.error)
            {
                let message = illustResult?.message || "Error loading illustration";
                console.log(`Error loading illust ${illustId}; ${message}`);
                this._nonexistantMediaIds[mediaId] = message;
                return null;
            }

            mediaInfo = illustResult.body;
        }
        ppixiv.tagTranslations.addTranslations(mediaInfo.tags.tags);

        // If we have extra data stored for this image, load it.
        let extraData = await ppixiv.extraImageData.loadAllPagesForIllust(illustId);
        mediaInfo.extraData = extraData;

        // Now that we have illust data, load anything we weren't able to load before.
        startLoading(mediaInfo.illustType, mediaInfo.pageCount);

        // Add an array of thumbnail URLs.
        mediaInfo.previewUrls = [];
        for(let page = 0; page < mediaInfo.pageCount; ++page)
        {
            let url = helpers.pixiv.getHighResThumbnailUrl(mediaInfo.urls.small, page);
            mediaInfo.previewUrls.push(url);
        }

        // Add a flattened tag list.
        mediaInfo.tagList = [];
        for(let tag of mediaInfo.tags.tags)
            mediaInfo.tagList.push(tag.tag);

        if(mangaPromise != null)
        {
            let mangaInfo = await mangaPromise;
            mediaInfo.mangaPages = mangaInfo.body;
        }

        if(ugoiraPromise != null)
        {
            let ugoiraResult = await ugoiraPromise;
            mediaInfo.ugoiraMetadata = ugoiraResult.body;
        }
        else
            mediaInfo.ugoiraMetadata = null;

        this._updateMediaInfoUrls(mediaInfo);

        // If this is a single-page image, create a dummy single-entry mangaPages array.  This lets
        // us treat all images the same.
        if(mediaInfo.pageCount == 1)
        {
            mediaInfo.mangaPages = [{
                width: mediaInfo.width,
                height: mediaInfo.height,

                // Rather than just referencing mediaInfo.urls, copy just the image keys that
                // exist in the regular mangaPages list (no thumbnails).
                urls: {
                    original: mediaInfo.urls.original,
                    regular: mediaInfo.urls.regular,
                    small: mediaInfo.urls.small,
                }
            }];
        }

        // Try to find the user's avatar URL.  userIllusts contains a list of the user's illust IDs,
        // and only three have thumbnail data, probably for UI previews.  For some reason these don't
        // always contain profileImageUrl, but usually one or two of the three do.  Cache it if it's
        // there so it's ready for AvatarWidget if possible.
        if(mediaInfo.userIllusts)
        {
            for(let userIllustData of Object.values(mediaInfo.userIllusts))
            {
                if(userIllustData?.profileImageUrl == null)
                    continue;

                let { profileImageUrl } = MediaCacheMappings.remapPartialMediaInfo(userIllustData, "normal");
                if(profileImageUrl)
                    this.cacheProfilePictureUrl(mediaInfo.userId, profileImageUrl);
            }
        }

        // Remember that this is full info.
        mediaInfo.full = true;

        // The image data has both "id" and "illustId" containing the image ID.  Remove id to
        // make sure we only use illustId, and set mediaId.  This makes it clear what type of
        // ID you're getting.
        mediaInfo.mediaId = mediaId;
        delete mediaInfo.id;
        delete mediaInfo.userIllusts;

        ppixiv.guessImageUrl.addInfo(mediaInfo);

        return this.addFullMediaInfo(mediaInfo);
    }

    // Update URLs for all cached images after a change to the pixiv_cdn setting.
    _updatePixivURLs()
    {
        for(let mediaInfo of Object.values(this._mediaInfo))
            this._updateMediaInfoUrls(mediaInfo);

        for(let mediaId of Object.keys(this._mediaInfo))
            MediaInfo.callMediaInfoModifiedCallbacks(mediaId);
    }

    // Update URLs in mediaInfo that are affected by adjustImageUrlHostname.  This can be called
    // again if the pixiv_cdn setting changes.
    _updateMediaInfoUrls(mediaInfo)
    {
        if(mediaInfo.urls)
        {
            for(let [key, url] of Object.entries(mediaInfo.urls))
            {
                url = new URL(url);
                mediaInfo.urls[key] = helpers.pixiv.adjustImageUrlHostname(url).toString();
            }
        }

        if(mediaInfo.previewUrls)
        {
            for(let page = 0; page < mediaInfo.previewUrls.length; ++page)
            {
                let url = mediaInfo.previewUrls[page];
                mediaInfo.previewUrls[page] = helpers.pixiv.adjustImageUrlHostname(url).toString();
            }
        }

        if(mediaInfo.mangaPages)
        {
            for(let page of mediaInfo.mangaPages)
            {
                for(let [key, url] of Object.entries(page.urls))
                {
                    url = helpers.pixiv.adjustImageUrlHostname(url);
                    page.urls[key] = url.toString();
                }
            }
        }

        if(mediaInfo.ugoiraMetadata)
        {
            // Switch the data URL to i-cf..pximg.net.
            let url = new URL(mediaInfo.ugoiraMetadata.originalSrc);
            url = helpers.pixiv.adjustImageUrlHostname(url);
            mediaInfo.ugoiraMetadata.originalSrc = url.toString();
        }
    }

    // Load partial info for the given media IDs if they're not already loaded.
    //
    // If userId is set, mediaIds is known to be all posts from the same user.  This
    // lets us use a better API.
    async batchGetMediaInfoPartial(mediaIds, { force=false, userId=null }={})
    {
        let promises = [];

        let neededMediaIds = [];
        let localMediaIds = [];
        for(let mediaId of mediaIds)
        {
            mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);

            // If we're not forcing a refresh, skip this ID if it's already loaded.
            if(!force && this._mediaInfo[mediaId] != null)
                continue;

            // Ignore media IDs that have already failed to load.
            if(!force && this._nonexistantMediaIds[mediaId])
                continue;

            // Skip IDs that are already loading.
            let existingLoad = this._mediaInfoLoadsFull[mediaId] ?? this._mediaInfoLoadsPartial[mediaId];
            if(existingLoad)
            {
                promises.push(existingLoad);
                continue;
            }

            // Only load local IDs and illust IDs.
            let { type } = helpers.mediaId.parse(mediaId);
            if(helpers.mediaId.isLocal(mediaId))
                localMediaIds.push(mediaId);
            else if(type == "illust")
                neededMediaIds.push(mediaId);
        }

        // If any of these are local IDs, load them with LocalAPI.
        if(localMediaIds.length)
        {
            let loadPromise = this._loadLocalMediaIds(localMediaIds);

            // Local API loads always give full info, so register these as full loads.
            for(let mediaId of mediaIds)
                this._startedLoadingMediaInfoFull(mediaId, loadPromise);

            promises.push(loadPromise);
        }

        if(neededMediaIds.length)
        {
            let loadPromise = this._doBatchGetMediaInfo(neededMediaIds, { userId });
            for(let mediaId of mediaIds)
                this._startedLoadingMediaInfoPartial(mediaId, loadPromise);
            promises.push(loadPromise);
        }

        // Wait for all requests we started to finish, as well as any requests that
        // were already running.
        await Promise.all(promises);
    }

    // Run the low-level API call to load partial media info, and register the result.
    async _doBatchGetMediaInfo(mediaIds, { userId=null }={})
    {
        if(mediaIds.length == 0)
            return;

        let illustIds = [];
        for(let mediaId of mediaIds)
        {
            if(helpers.mediaId.parse(mediaId).type != "illust")
                continue;

            let [illustId] = helpers.mediaId.toIllustIdAndPage(mediaId);
            illustIds.push(illustId);
        }

        // If all of these IDs are from the same user, we can use this API instead.  It's
        // more useful since it includes bookmarking info, which is missing in /rpc/illust_list,
        // and it's in a much more consistent data format.  Unfortunately, it doesn't work
        // with illusts from different users, which seems like an arbitrary restriction.
        //
        // (This actually doesn't restrict to the same user anymore.  It's not clear if this
        // is a bug and you still have to specify an arbitrary user.  There's no particular place
        // to take advantage of this right now, though.)
        if(userId != null)
        {
            let url = `/ajax/user/${userId}/profile/illusts`;
            let result = await helpers.pixivRequest.get(url, {
                "ids[]": illustIds,
                work_category: "illustManga",
                is_first_page: "0",
            });
            
            let illusts = Object.values(result.body.works);
            await this.addMediaInfosPartial(illusts, "normal");
        }
        else
        {
            // This is a fallback if we're displaying search results we never received media
            // info for.  It's a very old API and doesn't have all of the information newer ones
            // do: it's missing the AI flag, and only has a boolean value for "bookmarked" and no
            // bookmark data.  However, it seems to be the only API available that can batch
            // load info for a list of unrelated illusts.
            let result = await helpers.pixivRequest.get("/rpc/illust_list.php", {
                illust_ids: illustIds.join(","),

                // Specifying this gives us 240x240 thumbs, which we want, rather than the 150x150
                // ones we'll get if we don't (though changing the URL is easy enough too).
                page: "discover",

                // We do our own muting, but for some reason this flag is needed to get bookmark info.
                exclude_muted_illusts: 1,
            });

            await this.addMediaInfosPartial(result, "illust_list");
        }

        // Mark any media IDs that we asked for but didn't receive as not existing, so we won't
        // keep trying to load them.
        for(let mediaId of mediaIds)
        {
            if(this._mediaInfo[mediaId] == null && this._nonexistantMediaIds[mediaId] == null)
                this._nonexistantMediaIds[mediaId] = "Illustration doesn't exist";
        }
    }

    // Cache partial media info that was loaded from a Pixiv search.  This can come from
    // batchGetMediaInfoPartial() or from being included in a search result.
    //
    // Return the media IDs in the results, which can be returned as the media ID list from
    // data sources.
    addMediaInfosPartial = async (searchResult, source) =>
    {
        if(searchResult.error)
            return [];

        // Ignore entries with "isAdContainer".
        searchResult = searchResult.filter(item => !item.isAdContainer);

        let allThumbInfo = [];
        let mediaIds = [];
        for(let thumbInfo of searchResult)
        {
            let { remappedMediaInfo, profileImageUrl } = MediaCacheMappings.remapPartialMediaInfo(thumbInfo, source);

            // Return media IDs for convenience.  Return all media IDs, even if we skip updating
            // it below.
            mediaIds.push(remappedMediaInfo.mediaId);

            // The profile image URL isn't included in image info since it's not present in full
            // info.  Store it separately.
            if(profileImageUrl)
                this.cacheProfilePictureUrl(remappedMediaInfo.userId, profileImageUrl);

            // If we already have full media info, don't replace it with partial info.  This can happen
            // when a data source is refreshed.
            if(this.getMediaInfoSync(remappedMediaInfo.mediaId, { full: true }) != null)
                continue;

            allThumbInfo.push(remappedMediaInfo);
        }

        // Load any extra image data stored for these media IDs.  These are stored per page, but
        // batch loaded per image.
        let illustIds = allThumbInfo.map((info) => info.illustId);
        let extraData = await ppixiv.extraImageData.batchLoadAllPagesForIllust(illustIds);

        for(let mediaInfo of allThumbInfo)
        {
            // Store extra data for each page.
            mediaInfo.extraData = extraData[mediaInfo.illustId] || {};
            mediaInfo.full = false;

            this._updateMediaInfoUrls(mediaInfo);

            // Store the data.
            this.addFullMediaInfo(mediaInfo);
        }

        return mediaIds;
    }

    // Load image info from the local API.
    async _loadLocalImageData(mediaId, { refreshFromDisk }={})
    {
        let mediaInfo = await LocalAPI.loadMediaInfo(mediaId, { refreshFromDisk });
        if(!mediaInfo.success)
        {
            mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
            this._nonexistantMediaIds[mediaId] = mediaInfo.reason;
            return null;
        }

        return this.addFullMediaInfo(mediaInfo.illust);
    }

    // Create or update a MediaInfo.  mediaInfo is either a MediaInfo object, or a
    // complete media info result.
    //
    // Pixiv's raw API results don't return full info, so this shouldn't be called
    // directly for those.  Use addPixivFullMediaInfo instead, which will make any
    // secondary loads we need.  This can be called directly for local API results.
    addFullMediaInfo(mediaInfo)
    {
        // Create a MediaInfo wrapper.
        mediaInfo = MediaInfo.createFrom({ mediaInfo });

        let { mediaId } = mediaInfo;
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);

        if(mediaId in this._mediaInfo)
        {
            // We already have a MediaInfo for this mediaId.  Update the object we already
            // have instead of replacing it.
            this._mediaInfo[mediaId].updateInfo(mediaInfo);
        }
        else
            this._mediaInfo[mediaId] = mediaInfo;

        MediaInfo.callMediaInfoModifiedCallbacks(mediaId);

        return mediaInfo;
    }

    // Return true if all thumbs in mediaIds have been loaded, or are currently loading.
    //
    // We won't start fetching IDs that aren't loaded.
    areAllMediaIdsLoadedOrLoading(mediaIds)
    {
        for(let mediaId of mediaIds)
        {
            if(!this.isMediaIdLoadedOrLoading(mediaId))
                return false;
        }
        return true;
    }

    isMediaIdLoadedOrLoading(mediaId)
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        return this._mediaInfo[mediaId] != null || this._mediaInfoLoadsFull[mediaId] || this._mediaInfoLoadsPartial[mediaId];
    }
        
    // Save data to extra_image_data, and update cached data.  Returns the updated extra data.
    async saveExtraImageData(mediaId, edits)
    {
        let [illustId] = helpers.mediaId.toIllustIdAndPage(mediaId);

        // Load the current data from the database, in case our cache is out of date.
        let results = await ppixiv.extraImageData.loadMediaId([mediaId]);
        let data = results[mediaId] ?? { illust_id: illustId };

        // Update each key, removing any keys which are null.
        for(let [key, value] of Object.entries(edits))
            data[key] = value;

        // Delete any null keys.
        for(let [key, value] of Object.entries(data))
        {
            if(value == null)
                delete data[key];
        }

        // Update the edited timestamp.
        data.edited_at = Date.now() / 1000;

        // Save the new data.  If the only fields left are illustId and edited_at, delete the record.
        if(Object.keys(data).length == 2)
            await ppixiv.extraImageData.deleteMediaId(mediaId);
        else
            await ppixiv.extraImageData.updateMediaId(mediaId, data);

        this.replaceExtraData(mediaId, data);

        return data;
    }

    // Refresh extraData in a loaded image.  This does nothing if mediaId isn't loaded.
    replaceExtraData(mediaId, data)
    {
        let mediaInfo = this.getMediaInfoSync(mediaId, { full: false });
        if(mediaInfo == null)
            return;

        mediaInfo.extraData[mediaId] = data;
        MediaInfo.callMediaInfoModifiedCallbacks(mediaId);
    }

    // Get the user's profile picture URL, or a fallback if we haven't seen it.
    getProfilePictureUrl(userId)
    {
        let result = this.userProfileUrls[userId];
        if(!result)
            result = "https://s.pximg.net/common/images/no_profile.png";
        return result;
    }

    // Cache the URL to a user's avatar and preload it.
    cacheProfilePictureUrl(userId, url)
    {
        if(this.userProfileUrls[userId] == url)
            return;

        this.userProfileUrls[userId] = url;
        helpers.other.preloadImages([url]);
    }

    // Return the extra info for an image, given its image info.
    getExtraData(mediaInfo, mediaId, page=null)
    {
        if(mediaInfo == null)
            return { };

        // If page is null, mediaId is already this page's ID.
        if(page != null)
            mediaId = helpers.mediaId.getMediaIdForPage(mediaId, page);
        
        return mediaInfo.extraData[mediaId] ?? {};
    }

    // Get the width and height of mediaId from mediaInfo.
    //
    // This handles the inconsistency with page info: if we have partial image info, we only
    // know the dimensions for the first page.  For page 1, we can always get the dimensions,
    // even from partial info.  For other pages, we have to get the dimensions from mangaPages.
    // If we only have partial info, the other page dimensions aren't known and we'll return
    // null.
    getImageDimensions(mediaInfo, mediaId=null, page=null, { }={})
    {
        if(mediaInfo == null)
            return { width: 1, height: 1 };

        let pageInfo = mediaInfo;
        if(!helpers.mediaId.isLocal(mediaInfo.mediaId))
        {
            if(page == null)
            {
                // For Pixiv images, at least one of mediaId or page must be specified so we
                // know what page we want.
                if(mediaId == null)
                    throw new Error("At least one of mediaId or page must be specified");
                page = helpers.mediaId.toIllustIdAndPage(mediaId)[1];
            }

            if(page > 0)
            {
                // If this is partial info, we don't know the dimensions of pages past the first.
                // Use the size of the first page as a fallback.
                if(!mediaInfo.full)
                    return { width: pageInfo.width, height: pageInfo.height };

                pageInfo = mediaInfo.mangaPages[page];
            }
        }

        return { width: pageInfo.width, height: pageInfo.height };
    }

    async _loadLocalMediaIds(mediaIds)
    {
        if(mediaIds.length == 0)
            return;

        let result = await LocalAPI.localPostRequest(`/api/illusts`, {
            ids: mediaIds,
        });

        if(!result.success)
        {
            console.error("Error reading IDs:", result.reason);
            return;
        }

        for(let illust of result.results)
            await this.addFullMediaInfo(illust);
    }

    // Run a search against the local API.
    async localSearch(path="", {...options}={})
    {
        let result = await LocalAPI.localPostRequest(`/api/list/${path}`, {
            ...options,
        });

        if(!result.success)
        {
            console.error("Error reading directory:", result.reason);
            return result;
        }

        for(let illust of result.results)
            await this.addFullMediaInfo(illust);

        return result;
    }
}
