// MediaInfo holds data for a given illustration, thumbnail, folder, etc.
//
// This is mostly just a wrapper around the data we get back from the API to make what's
// available from different sources more explicit.  A MediaInfo is constructed with
// MediaInfo.createFrom.

import { helpers } from 'vview/misc/helpers.js';

let mediaInfoKeys = {
    // Global data is returned by all sources.  If a source doesn't support something in
    // this list, a dummy value will be inserted.
    global: [
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
    ],
};

export default class MediaInfo
{
    // If true, this is full media info, so full media fields can be accessed.
    get full() { return true; }

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
        this._info[name] = value;
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
        // Create the correct derived class.
        if(helpers.mediaId.isLocal(mediaInfo.mediaId))
        {
            return new VviewMediaInfo({mediaInfo});
        }

        let full = mediaInfo.full;
        return new PixivMediaInfo({mediaInfo, full});
    }

    constructor({
        mediaInfo,
    }={})
    {
        this._info = { };

        // Add the global list, which is always present.
        this._addDataFrom(mediaInfo, mediaInfoKeys.global);
    }

    _addDataFrom(mediaInfo, keyList)
    {
        for(let key of keyList)
        {
            if(!(key in mediaInfo))
            {
                console.warn(`Media info missing ${key}: ${mediaInfo.mediaId}`);
                continue;
            }
            this._info[key] = mediaInfo[key];
        }
    }

    updateInfo(keys)
    {
        for(let [key, value] of Object.entries(keys))
        {
            // Only update keys that we already have.  If this is partial info, don't add keys
            // for a full info update.
            if(!(key in this._info))
            {
                console.log(`Not updating key "${key}" for partial media info: ${this.mediaId}`);
                continue;
            }

            this._info[key] = value;
        }        
    }
}

class PixivMediaInfo extends MediaInfo
{
    get full() { return this._isFull; }

    constructor({
        mediaInfo,
        full,
    }={})
    {
        super({ mediaInfo });

        this._isFull = full;
        this._addDataFrom(mediaInfo, mediaInfoKeys.pixivPartial);

        if(full)
        {
            this._addDataFrom(mediaInfo, mediaInfoKeys.globalFull);
            this._addDataFrom(mediaInfo, mediaInfoKeys.pixivFull);

            // Only animations have ugoiraMetadata.
            if(mediaInfo.illustType == 2)
            {
                console.assert("ugoiraMetadata" in mediaInfo);
                this._info.ugoiraMetadata = mediaInfo.ugoiraMetadata;
            }
        }

        // Stash away any keys we didn't load.
        this._otherInfo = { };
        for(let [key, value] of Object.entries(mediaInfo))
        {
            if(key in this._info)
                continue;
            this._otherInfo[key] = value;
        }
    }

    get partialInfo()
    {
        if(!this.full)
            return this;
        
        return new PixivMediaInfo({ mediaInfo: this._info, full: false });
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
    get pageCount() { return this._type == "folder"? 0:1; }

    get isLocal() { return true; }

    constructor({
        mediaInfo
    })
    {
        mediaInfo = { ...mediaInfo };

        let type = helpers.mediaId.parse(mediaInfo.mediaId).type;
        if(type == "folder")
        {
            mediaInfo.mangaPages = [];

            // These metadata fields don't exist for folders.
            mediaInfo.userName = null;
            mediaInfo.illustType = 1;
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

        super({ mediaInfo });

        this._type = type;
        this._addDataFrom(mediaInfo, mediaInfoKeys.globalFull);
    }
}
