// Image translation
//
// This needs GM.xmlHttpRequest to fetch Pixiv images and make API requests.  It won't
// work in Safari, since it doesn't support @connect.

import { helpers } from '/vview/misc/helpers.js';
import { downloadPixivImage, sendRequest } from '/vview/util/gm-download.js';
import MediaInfo  from '/vview/misc/media-info.js';

// The cotrans script seems to have no limit to the number of requests it'll start, but
// for sanity we set a request limit.
const MaxParallelTranslationRequests = 5;

export default class ImageTranslations
{
    constructor()
    {
        this._displayedMediaId = null;
        this._translateMediaIds = new Set();
        this._translatedUrls = new Map();
        this._translationRequests = new Map();
        this._settingsToId = new Map();
    }

    // Set the media ID that the viewer is currently displaying.  We'll only actively
    // request translations for pages on the post that's currently being viewed, and
    // cancel pending translations if we navigate away from it.
    setDisplayedMediaId(mediaId)
    {
        this._displayedMediaId = mediaId;
        this._checkTranslationQueue();
    }

    // Enable or disable translations for the given media ID.
    setTranslationsEnabled(mediaId, enabled)
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);

        if(enabled)
            this._translateMediaIds.add(mediaId);
        else
            this._translateMediaIds.delete(mediaId);

        // Let anyone listening know that the translation URL for pages on this image may
        // have changed.  We need to do this for all pages, but only for pages we actually
        // have a URL for.
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: true });
        if(mediaInfo != null)
        {
            for(let page = 0; page < mediaInfo.pageCount; ++page)
            {
                let pageMediaId = helpers.mediaId.getMediaIdForPage(mediaId, page);
                if(this._translatedUrls.has(this._getIdForMediaId(pageMediaId)))
                    MediaInfo.callMediaInfoModifiedCallbacks(pageMediaId);
            }
        }

        this._checkTranslationQueue();
    }

    getTranslationsEnabled(mediaId)
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        return this._translateMediaIds.has(mediaId);
    }

    _checkTranslationQueue()
    {
        this._refreshTranslationIndicator();

        // Stop if we're running the maximum number of requests.
        if(this._translationRequests.size >= MaxParallelTranslationRequests)
            return;

        // Stop if we're not displaying an image that we want translations for.
        let mediaId = this._displayedMediaId;
        let firstPageMediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        if(mediaId == null || !this._translateMediaIds.has(firstPageMediaId))
            return;

        // Get media info for the post we're viewing.  If it isn't available yet, request it and
        // come back when it's cached.  We need full info so we have URLs for manga pages.
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: true });
        if(mediaInfo == null)
        {
            ppixiv.mediaCache.getMediaInfo(mediaId, { full: true }).then(() => {
                console.log("Check queue after fetching info");
                this._checkTranslationQueue();
            });
            return;
        }

        // Make a list of pages for this image in the order we want to load them.  Start on the page
        // the user is currently on and load to the end, then load backwards to page 0.  This tries to
        // load images the user is more likely to be viewing soon first.
        let [_, currentPage] = helpers.mediaId.toIllustIdAndPage(mediaId);
        let pagesToLoad = [];
        for(let page = currentPage; page < mediaInfo.pageCount; ++page)
            pagesToLoad.push(page);
        for(let page = currentPage-1; page >= 0; --page)
            pagesToLoad.push(page);

        for(let page of pagesToLoad)
        {
            // Stop once we've started the maximum number of requests.  We'll come back and start
            // more as they finish.
            if(this._translationRequests.size >= MaxParallelTranslationRequests)
                break;

            let pageMediaId = helpers.mediaId.getMediaIdForPage(mediaId, page);

            // Skip this page if we already have it, or if a request is already queued.
            if(this._translatedUrls.has(this._getIdForMediaId(pageMediaId)) || this._translationRequests.has(this._getIdForMediaId(pageMediaId)))
                continue;

            // Start this translation.
            let promise = this._getMediaIdTranslation(pageMediaId, page);
            this._translationRequests.set(this._getIdForMediaId(pageMediaId), promise);

            // Remove the request from the list when the promise finishes.
            promise.finally(() => {
                this._translationRequests.delete(this._getIdForMediaId(pageMediaId), promise);
            });

            promise.then(async() => {
                // Delay a little before starting more requests, as an extra safety in case
                // something is wrong
                await helpers.other.sleep(250);

                // See if we need to start another request when each promise finishes.  Only do
                // this on success, so we don't get stuck in a loop if the promises are throwing.
                this._checkTranslationQueue();

                return false;
            });
        }

        this._refreshTranslationIndicator();
    }

    // Set loadingTranslation if the loading indicator should be visible.
    _refreshTranslationIndicator()
    {
        // Show the indicator if we want translations for the current image and don't have it yet.
        let showLoadingIndicator = this._displayedMediaId != null &&
            this.getTranslationsEnabled(this._displayedMediaId) &&
            !this._translatedUrls.has(this._getIdForMediaId(this._displayedMediaId));
        helpers.html.setDataSet(document.documentElement.dataset, "loadingTranslation", showLoadingIndicator);
    }

    async _getMediaIdTranslation(mediaId, page)
    {
        console.log(`Requesting translation for ${mediaId}`);

        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: true });
        console.assert(mediaInfo != null);

        // Request the low-res version of the image.
        let translationUrl = await this._translateImage(mediaInfo, page);

        // If this URL is returned, there's no translation for this image.
        let blankImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQI12NgYAAAAAMAASDVlMcAAAAASUVORK5CYII=";
        if(translationUrl == blankImage)
            translationUrl = null;

        // Preload the translation image.  Don't wait for this.
        if(translationUrl != null)
            helpers.other.preloadImages([translationUrl]);

        // Store the translation URL.
        this._translatedUrls.set(this._getIdForMediaId(mediaId), translationUrl);

        // Trigger a refresh for this image now that we have its translation image.
        MediaInfo.callMediaInfoModifiedCallbacks(mediaId);
    }

    // Return the translation overlay URL for the given media ID if we have one and translations
    // for this image are enabled.
    getTranslationUrl(mediaId)
    {
        // Don't return the translation URL if translations for this image aren't enabled, even
        // if we know it.
        let firstPageMediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        if(!this._translateMediaIds.has(firstPageMediaId))
            return null;

        return this._translatedUrls.get(this._getIdForMediaId(mediaId));
    }

    // Return settings that affect the result.
    get _currentSettings()
    {
        return {
            // If true, translate using a lower resolution Pixiv image.  This is usually good enough,
            // and is much faster.  Unfortunately there's no way to provide a low-res image for translation
            // and to receive a high-res result, so this causes the text to also be lower resolution.
            forceLowRes: true,

            // S: 1024
            // M: 1536
            // L: 2048
            // XL: 2560
            size: "M",

            // gpt3.5, youdao, baidu, google, deepl, papago, offline
            translator: "gpt3.5",

            // auto, h, v
            direction: "auto",

            // "ctd" is the only option.
            detector: "default",

            // CHS, CHT, JPN, ENG, KOR, VIN, CSY, NLD, FRA, DEU, HUN, ITA, PLK, PTB, ROM, RUS, UKR, ESP, TRK
            target_language: "ENG",
        };
    }

    // Return a unique ID for the current set of settings.
    get _currentSettingsId()
    {
        let settings = JSON.stringify(this._currentSettings);
        let settingsId = this._settingsToId.get(settings);
        if(settingsId != null)
            return settingsId;

        settingsId = this._settingsToId.size;
        this._settingsToId.set(settings, settingsId);
        return settingsId;
    }

    // Get the ID to use for storing the given media ID in _translatedUrls and _translationRequests.
    // This ties them to the current set of settings, so we'll request new translation images if settings
    // change, and not need to request them again if the settings change is reverted.
    _getIdForMediaId(mediaId)
    {
        return `${mediaId}|${this._currentSettingsId}`;
    }

    // Request an image translation.  Return the translation URL.
    async _translateImage(mediaInfo, page)
    {
        let pageMediaId = helpers.mediaId.getMediaIdForPage(mediaInfo.mediaId, page);
        let { size, translator, direction, detector, target_language, forceLowRes } = this._currentSettings;
        let { url } = mediaInfo.getMainImageUrl(page, { forceLowRes });
        url = helpers.pixiv.adjustImageUrlHostname(url);

        // Download the image.
        console.log(`Downloading image for translation: ${url}`);
        let file = await downloadPixivImage(url);
        console.log(`Got image: ${url}`);

        // Run preprocessing.  This isn't needed if we're using the low-res image,.
        if(!forceLowRes)
            file = await this._preprocessImage(file);

        let translationApiUrl = ppixiv.settings.get("translation_api_url") + '/task/upload/v1';

        let response;
        try {
            console.log(`Sending image for translation: ${url}`);
            response = await sendRequest({
                url: translationApiUrl,
                method: "POST",
                responseType: "text",
                formData: {
                    size, translator, direction, detector, target_language,
                    retry: "true",
                    file,
                 },
            });
        } catch(e) {
            console.error(`Error requesting translation for ${url}:`, e);
            return null;
        }

        response = JSON.parse(response);

        // We expect to either get a request ID, an error, or a translation result.
        let { id, error, translation_mask } = response;

        if(error != null)
        {
            console.log(`Translation error for ${pageMediaId}: ${error}`);
            return null;
        }

        if(translation_mask != null)
        {
            console.log(`Cached translation result for ${pageMediaId}: ${translation_mask}`);
            return translation_mask;
        }

        if(id == null)
        {
            // We didn't get anything, so we don't understand this response.
            console.log(`Unexpected translation response for ${pageMediaId}:`, response);
            return null;
        }

        // Open the queue socket to wait for the result.
        let websocket = new WebSocket(`wss://api.cotrans.touhou.ai/task/${id}/event/v1`);

        if(!await helpers.other.waitForWebSocketOpened(websocket))
        {
            console.log("Couldn't connect to translation socket");
            return null;
        }

        // Handle messages from the socket.
        try {
            while(1)
            {
                let data = await helpers.other.waitForWebSocketMessage(websocket);
                if(data == null)
                {
                    console.log(`Translation socket closed without a result: ${pageMediaId}`);
                    return null;
                }

                switch(data.type)
                {
                case "status":
                    // console.log(`Translation status: ${data.status}`);
                    continue;

                case "pending":
                    // Our position in the queue changed.
                    continue;

                case "result":
                    console.log(`Translation result for ${pageMediaId}: ${data.result.translation_mask}`);
                    return data.result.translation_mask;

                case "error":
                    console.log(`Translation error for ${pageMediaId}: $[data.error}`);
                    return null;

                case "not_found":
                    // The ID is unknown.  This is either a bug or a server problem.
                    console.log(`Translation error for ${pageMediaId}: ID not found`);
                    return null;

                default:
                    // Ignore messages that we don't understand.
                    console.log(`Unknown translation queue message for ${pageMediaId}}:`, data);
                    continue;
                }        
            }
        } finally {
            websocket.close();
        }
    }

    async _preprocessImage(data)
    {
        // We don't propagate the MIME type or URL here.  Figure out if this image is already a
        // JPEG.  We'll reencode other images (PNG and GIF) to JPEG regardless of image size.
        let u8 = new Uint8Array(data);
        let isJpeg = u8[0] == 0xFF && u8[1] == 0xD8 && u8[2] == 0xFF && u8[3] == 0xE0;

        // Load the image to get its resolution.
        let blob = new Blob([data]);
        let blobUrl = URL.createObjectURL(blob);
        try {
            let img = document.createElement("img");
            img.src = blobUrl;

            let result = await helpers.other.waitForImageLoad(img);
            if(result == "failed")
            {
                console.log(`Image load failed`);
                return null;
            }

            // Reduce the image dimensions to the max size.
            let width = img.naturalWidth;
            let height = img.naturalHeight;
            let maxSize = 2048;
            let resizeBy = 1;
            resizeBy = Math.min(resizeBy, maxSize / width);
            resizeBy = Math.min(resizeBy, maxSize / height);
            
            // If this image is already a JPEG and doesn't need to be downscaled, just use
            // the original image data.
            if(resizeBy == 1 && isJpeg)
                return data;

            // Draw the image into a canvas.
            let canvas = document.createElement("canvas");
            canvas.width = Math.round(width * resizeBy);
            canvas.height = Math.round(height * resizeBy);

            let context = canvas.getContext("2d");
            context.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, canvas.width, canvas.height);

            // Encode to a JPEG.  They encode much more quickly than PNGs and there's no reason to spend
            // time sending a big PNG.
            return await helpers.other.canvasToBlob(canvas, { type: "image/jpeg", quality: 0.75 });
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }
}

