// MediaInfo holds data for a given illustration, thumbnail, folder, etc.
//
// This is mostly just a wrapper around the data we get back from the API to make what's
// available from different sources more explicit.  A MediaInfo is constructed with
// MediaInfo.createFrom.

import { helpers } from 'vview/misc/helpers.js';

export const MediaInfoEvents = new EventTarget();

let pendingMediaIdCallbacks = new Set();

let mediaInfoKeys = {
    // Global data is returned by all sources.  If a source doesn't support something in
    // this list, a dummy value will be inserted.
    global: [
        "full",
        "mediaId",                          // Our media ID
        "bookmarkData",                     // null if not bookmarked, otherwise an object
        "createDate",
        "tagList",                          // a flat array of illust tags
        "extraData",                        // editor info

        "illustTitle",

        // 0 or 1: illust, 2: animation (ugoira), "video": local video
        "illustType",

        "userName",
        "previewUrls",
    ],

    // Data for full info.  This is returned by full Pixiv illust info requests but not by
    // searches.  Local images always include these fields.
    globalFull: [
        "mangaPages",
    ],

    // Extra info returned for Pixiv images (partial and full).  These fields don't exist
    // in the local API.
    pixivPartial: [
        // The regular Pixiv illustration ID.  Most of the time we use our media ID
        // representation instead.
        "illustId",
        "aiType",
        "userId",

        // Manga pages.  This is 1 for videos and local images and any other sources that
        // don't have pages.
        "pageCount",

        // The dimensions of the first manga page.  Search results don't give dimensions
        // for images past the first.
        "width", "height",
    ],

    // Full info returned for Pixiv images.  These fields don't exist in the local API.
    pixivFull: [
        "likeCount",
        "bookmarkCount",
        "ugoiraMetadata",
    ],
};

export default class MediaInfo
{
    // Send mediamodified when any data on a MediaInfo is modified.
    //
    // This is calso called when MediaCache has data for a new media ID.
    static callMediaInfoModifiedCallbacks(mediaId)
    {
        let wasEmpty = pendingMediaIdCallbacks.size == 0;
        pendingMediaIdCallbacks.add(mediaId);

        // Queue callMediaInfoModifiedCallbacksAsync if this is the first entry.
        if(wasEmpty)
            realSetTimeout(() => this._callMediaInfoModifiedCallbacksAsync(), 0);
    }

    static _callMediaInfoModifiedCallbacksAsync()
    {
        let mediaIds = pendingMediaIdCallbacks;
        pendingMediaIdCallbacks = new Set();
        for(let mediaId of mediaIds)
        {
            let event = new Event("mediamodified");
            event.mediaId = mediaId;
            MediaInfoEvents.dispatchEvent(event);
        }
    }

    // If true, this is full media info, so full media fields can be accessed.
    get full() { return this._getInfo("full"); }

    // Getters for all fields.  Most of these are given to us by the server, so we only
    // define setters for fields that we have a reason to update locally.  We define all
    // getters explicitly, so it's obvious if we're trying to access a field that doesn't
    // exist for the data.
    //
    // Partial media info fields.  These are included in all results, including bulk results
    // like searches, and are always available.
    get mediaId() { return this._getInfo("mediaId"); }
    get illustId() { return this._getInfo("illustId"); }
    get illustType() { return this._getInfo("illustType"); }
    get illustTitle() { return this._getInfo("illustTitle"); }
    get pageCount() { return this._getInfo("pageCount"); }
    get userId() { return this._getInfo("userId", null); }
    get userName() { return this._getInfo("userName"); }

    // mangaPages[0].width and mangaPages[0].height.  This doesn't give the resolution for manga
    // pages, but is always available.
    get width() { return this._getInfo("width"); }
    get height() { return this._getInfo("height"); }

    // previewUrls is an array of thumbnail URLs.  This is the same as mangaPages[*].urls.small.
    // Unlike mangaPages, this is always available, but doesn't have image dimensions.
    get previewUrls() { return this._getInfo("previewUrls"); }

    get bookmarkData() { return this._getInfo("bookmarkData"); }      set bookmarkData(value) { this._setInfo("bookmarkData", value); }
    get createDate() { return this._getInfo("createDate"); }
    get tagList() { return this._getInfo("tagList"); }
    get aiType() { return this._getInfo("aiType", 0); }
    get likeCount() { return this._getInfo("likeCount"); }            set likeCount(value) { this._setInfo("likeCount", value); }
    get bookmarkCount() { return this._getInfo("bookmarkCount"); }    set bookmarkCount(value) { this._setInfo("bookmarkCount", value); }
    get extraData() { return this._getInfo("extraData"); }            set extraData(value) { this._setInfo("extraData", value); }

    // Full media info fields.  These are only available when we load full data.
    //
    // mangaPages is an array of page info:
    // [{
    //     width, height,       // the width of the original image
    //     urls: {
    //         original,        // the URL to the original, unresized image
    //         small,           // the high-resolution thumbnail for searches
    //     }
    // ]}
    get mangaPages() { return this._getInfo("mangaPages"); }

    get ugoiraMetadata() { return this._getInfo("ugoiraMetadata"); }
    
    // Local images:
    get localPath() { return this._getInfo("localPath"); }

    // Get a key by name.
    //
    // If defaultValue is undefined, the key is expected to exist and an exception is thrown
    // if it doesn't.  Otherwise, defaultValue is returned if the key isn't set.
    _getInfo(name, defaultValue=undefined)
    {
        if(!(name in this._info))
        {
            if(defaultValue !== undefined)
                return defaultValue;

            throw new Error(`Field ${name} not available in image info for ${this._info.mediaId}`);
        }
        return this._info[name];
    }

    // Update a value.  We only expect to update fields in this way when they already exist.
    _setInfo(name, value)
    {
        if(!(name in this._info))
            throw new Error(`Field ${name} not available in image info for ${this._info.mediaId}`);
        if(this._info[name] === value)
            return;

        this._info[name] = value;
        MediaInfo.callMediaInfoModifiedCallbacks(this.mediaId);
    }
    
    // If this is full media info, return a MediaInfo containing only partial media info.  When
    // partial info is being requested we don't want to return full info.  This makes it easier
    // to be sure that callers only requesting partial info don't accidentally access full fields
    // and having it seem to work because full info was cached.
    //
    // If this is already partial info, return ourself.
    //
    // For local API media info, return ourself.  The local API is always full info.
    get partialInfo()
    {
        // This is implemented by the subclass if this media source supports it.
        return this;
    }

    // True if this is Vview media info.  This is overridden by VviewMediaInfo.
    get isLocal() { return false; }

    // Create a MediaInfo from an API result with the appropriate subclass.
    static createFrom({mediaInfo})
    {
        let classType;

        {
            // This is API data.  Figure out the correct subclass from the media ID.
            if(helpers.mediaId.isLocal(mediaInfo.mediaId))
                classType = VviewMediaInfo;
            else
                classType = PixivMediaInfo;

            // Run preprocessing if this subclass needs it.
            mediaInfo = classType.preprocessInfo({mediaInfo});
        }

        return new classType({mediaInfo});
    }

    // The subclass can implement this to adjust mediaInfo when it's coming from the API
    // before it's sent to the constructor.  This isn't called from serialized data, where
    // this has already been done.
    static preprocessInfo({mediaInfo})
    {
        return mediaInfo;
    }

    // Use createFrom above instead of calling this directly.
    constructor({ mediaInfo })
    {
        this._info = { ...mediaInfo };
    }

    // Update this MediaInfo from data in another MediaInfo for the same mediaId.
    updateInfo(mediaInfo)
    {
        console.assert(mediaInfo instanceof MediaInfo);
        for(let [key, value] of Object.entries(mediaInfo._info))
        {
            // Allow full to change from false to true, so if we get full info after partial info
            // we'll upgrade.  Don't allow it to change from true to false, so we can update full
            // info from partial info.
            if(key == "full" && !value)
                continue;

            // Make sure we never change mediaId.
            if(key == "mediaId")
            {
                console.assert(value == this._info.mediaId);
                continue;
            }

            this._info[key] = value;
        }        
    }

    // Return the main image to use for viewing the given image.
    //
    // If image_size_limit is set and the image is too large, use Pixiv's downscaled image instead.
    // This is an excessively low-res image with a max size of 1200, which seems like a resolution
    // that was picked a decade ago and never adjusted (1920 would make more sense), but it's the
    // only smaller image we have available.
    //
    // This is useful on mobile, where iOS's browser will OOM and silently reload the page if
    // we try to load extremely large images.  This can also be enabled on desktop for users with
    // very limited bandwidth.  For that use case it would make more sense to limit based on
    // file size, but that's not available.
    getMainImageUrl(page=0, { ignore_limits=false }={})
    {
        let mangaPage = this.mangaPages[page];
        if(mangaPage == null)
            return { };

        return {
            url: mangaPage.urls.original,
            width: mangaPage.width,
            height: mangaPage.height,
        };
    }
}

// We have one MediaInfo for a post containing everything we know about it.  Data
// from Pixiv search results usually only has partial info.  In many cases this is
// all we need, so we only ask for full info when it's needed.  However, we want to
// be sure that if a caller is asking for partial info, it isn't accidentally using
// info from full info, but appearing to work because full info was cached during
// testing.
//
// PartialPixivMediaInfo wraps a PixivMediaInfo to check this, and throws an exception
// if non-partial data is accessed.
let partialPixivKeys = new Set([
    "full",
    "mediaId",
    "bookmarkData",
    "createDate",
    "tagList",
    "extraData",
    "illustTitle",
    "illustType",
    "userName",
    "previewUrls",
    "illustId",
    "aiType",
    "userId",
    "pageCount",
    "width", "height",
]);

function createPartialPixivMediaInfo(mediaInfo)
{
    console.assert(mediaInfo instanceof PixivMediaInfo);

    return new Proxy(mediaInfo, {
        get(target, key, receiver) {
            // Awaiting an object tries to read "then".  Don't log an error for this.
            if(key == "then")
                return undefined;

            // Always return false for mediaInfo.full, even if the underlying data is full.
            if(key == "full")
                return false;

            if(!partialPixivKeys.has(key))
                throw new Error(`MediaInfo key ${key} isn't available in partial media info`);

            return target[key];
        },

        has(target, key) {
            if(!partialPixivKeys.has(key))
                throw new Error(`MediaInfo key ${key} isn't available in partial media info`);

            return key in target;
        },

        set(obj, key, value) {
            if(!partialPixivKeys.has(key))
                throw new Error(`MediaInfo key ${key} can't be set in partial media info`);

            obj[key] = value;
            return true;
        }
    });
}

class PixivMediaInfo extends MediaInfo
{
    get partialInfo()
    {
        return createPartialPixivMediaInfo(this);
    }

    getMainImageUrl(page=0, { ignore_limits=false }={})
    {
        let maxPixels = ppixiv.settings.get("image_size_limit")
        if(maxPixels != null && !ignore_limits)
        {
            let mangaPage = this.mangaPages[page];
            if(mangaPage == null)
                return { };

            let pixels = mangaPage.width * mangaPage.height;
            let huge = pixels > maxPixels;
            if(huge)
            {
                // Use the downscaled image.  This is currently always rescaled to fit a max
                // resolution of 1200.
                let ratio = Math.min(1, 1200 / mangaPage.width, 1200 / mangaPage.height);
                let width = Math.round(mangaPage.width * ratio);
                let height = Math.round(mangaPage.height * ratio);
                return { url: mangaPage.urls.regular, width, height };
            }
        }
        
        return super.getMainImageUrl(page);
    }
}

class VviewMediaInfo extends MediaInfo
{
    // Vview media info is always full.
    get full() { return true; }

    // We always have mangaPages, and just implement width and height for compatibility.
    // This is null for folders.
    get width() { return this.mangaPages[0]?.width; }
    get height() { return this.mangaPages[0]?.height; }
    get pageCount() { return this.mediaType == "folder"? 0:1; }

    get isLocal() { return true; }

    // Preprocess API data to fit our data model.  We don't do this in the constructor
    // since we don't want it to happen a second time when loading from serialized data.
    static preprocessInfo({mediaInfo})
    {
        mediaInfo = { ...mediaInfo };

        let { type } = helpers.mediaId.parse(mediaInfo.mediaId);
        if(type == "folder")
        {
            mediaInfo.mangaPages = [];

            // These metadata fields don't exist for folders.
            mediaInfo.userName = null;
            mediaInfo.illustType = 0;
        }
        else
        {
            // Vview images don't use pages and always have one page.
            mediaInfo.mangaPages = [{
                width: mediaInfo.width,
                height: mediaInfo.height,
                urls: mediaInfo.urls,
            }];
        }
        return mediaInfo;
    }

    // For local images, we can optionally use a high-quality GPU upscale for static
    // images.
    getMainImageUrl(page=0)
    {
        let result = this._getMainImageUrlWithUpscaling(page);
        return result ?? super.getMainImageUrl(page);
    }

    _getMainImageUrlWithUpscaling(page)
    {
        // This is only used for static images.
        if(this.illustType != 0)
            return null;

        let mangaPage = this.mangaPages[page];
        if(mangaPage == null)
            return null;

        // The upscale setting can be:
        // null: no upscaling
        // 2x, 3x, 4x: upscale by the given factor.  These are the upscales supported by the
        // underlying GPU resizer.
        // auto: upscale based on the image size.
        let upscaleSetting = ppixiv.settings.get("upscaling");
        if(!upscaleSetting)
            return null;

        // The upscaler will do 2x, 3x and 4x, but in practice going beyond 2x is nearly
        // indistinguishable from 2x with regular upscaling.  It's already done what it can
        // with the image.  Just decide whether to use 2x upscaling or none at all, so we
        // don't waste time upscaling images that aren't low-res.
        //
        // For now we just pick an arbitrary max resolution to turn on upscaling.
        let { width, height } = mangaPage;
        let maxSizeForUpscaling = 2000;
        if(width >= maxSizeForUpscaling && height > maxSizeForUpscaling)
            return null;

        return {
            url: mangaPage.urls.upscale2x,

            // We currently don't scale these values to reflect the upscale.  The viewer
            // only uses them for the aspect ratio (which won't change) unless it's in
            // "actual size" mode, so scaling these causes the image size to jump, but only
            // when the zoom is at actual size.  It's better to just leave it at the
            // natural size, so the zoom stays put.
            width: mangaPage.width,
            height: mangaPage.height,
        };
    }
}
