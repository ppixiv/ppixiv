// Image translation
//
// This needs GM.xmlHttpRequest to fetch Pixiv images and make API requests.  It won't
// work in Safari, since it doesn't support @connect.

import { helpers } from '/vview/misc/helpers.js';
import { downloadPixivImage, sendRequest } from '/vview/util/gm-download.js';
import Widget from '/vview/widgets/widget.js';
import { MenuOptionOptionsSetting, MenuOptionToggleSetting, MenuOptionToggle, MenuOptionRow, MenuOptionButton } from '/vview/widgets/menu-option.js';
   
// The cotrans script seems to have no limit to the number of requests it'll start, but
// for sanity we set a request limit.
const MaxParallelTranslationRequests = 3;

// Map from our settings to API fields:
const AllSettings = {
    // If true, translate using a lower resolution Pixiv image.  This is usually good enough,
    // and is much faster.  Unfortunately there's no way to provide a low-res image for translation
    // and to receive a high-res result, so this causes the text to also be lower resolution.
    translation_low_res: "forceLowRes",

    // S: 1024
    // M: 1536
    // L: 2048
    // XL: 2560
    translation_size: "size",

    // gpt3.5, youdao, baidu, google, deepl, papago, offline
    translation_translator: "translator",

    // auto, h, v
    translation_direction: "direction",

    // CHS, CHT, JPN, ENG, KOR, VIN, CSY, NLD, FRA, DEU, HUN, ITA, PLK, PTB, ROM, RUS, UKR, ESP, TRK
    translation_language: "target_language",
};

class TranslationError extends Error { };

export default class ImageTranslations extends EventTarget
{
    constructor()
    {
        super();

        this._displayedMediaId = null;
        this._translateMediaIds = new Set();

        // This contains URLs to inpaint images, null if translation succeeded but was blank, or
        // exceptions for failed translations.
        this._translations = new Map();
        this._translationRequests = new Map();
        this._settingsToId = new Map();
        this._mediaIdSettingsOverrides = new Map();

        // Start translations if needed when settings change.
        for(let settingsKey of Object.keys(AllSettings))
        {
            ppixiv.settings.addEventListener(settingsKey, () => {
                this._checkTranslationQueue();
                this._callTranslationUrlsListeners();
            });
        }
    }

    // Return true if image translation is supported.
    get supported()
    {
        return !ppixiv.native && !ppixiv.ios;
    }

    // Fire an event if translation URLs may have changed: we have a new translation, or settings
    // have changed.
    _callTranslationUrlsListeners()
    {
        this.dispatchEvent(new Event("translation-urls-changed"));
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

        this._checkTranslationQueue();

        // Fire callbacks if we turn translations on or off.
        this._callTranslationUrlsListeners();
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

            // XXX: this is settings-specific
            let pageMediaId = helpers.mediaId.getMediaIdForPage(mediaId, page);

            // Skip this page if we already have it, or if a request is already queued.
            if(this._translations.has(this._getIdForMediaId(pageMediaId)) || this._translationRequests.has(this._getIdForMediaId(pageMediaId)))
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
            !this._translations.has(this._getIdForMediaId(this._displayedMediaId));
        helpers.html.setDataSet(document.documentElement.dataset, "loadingTranslation", showLoadingIndicator);
    }

    async _getMediaIdTranslation(mediaId, page)
    {
        console.log(`Requesting translation for ${mediaId}`);

        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: true });
        console.assert(mediaInfo != null);

        // Request the low-res version of the image.
        let translationUrl;
        try {
            translationUrl = await this._translateImage(mediaInfo, page);
        } catch(e) {
            // Only log this as an error if it's something other than a TranslationError, so
            // we don't spam stack traces for API errors.
            let log = `Error translating ${mediaInfo.mediaId}: ${e.message}`;
            if(e instanceof TranslationError)
                console.log(log);
            else
                console.error(log);

            // Store the exception as the result.
            translationUrl = e;
        }

        // If this URL is returned, there's no translation for this image.
        let blankImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQI12NgYAAAAAMAASDVlMcAAAAASUVORK5CYII=";
        if(translationUrl == blankImage)
            translationUrl = null;

        // Preload the translation image.  Don't wait for this.
        if(translationUrl != null && !(translationUrl instanceof Error))
            helpers.other.preloadImages([translationUrl]);

        // Store the translation URL.
        this._translations.set(this._getIdForMediaId(mediaId), translationUrl);

        // Trigger a refresh for this image now that we have its translation image.
        this._callTranslationUrlsListeners();
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

        let url = this._translations.get(this._getIdForMediaId(mediaId));
        if(url instanceof Error)
            return null;
        else
            return url;
    }

    // If an error occurred translating mediaId, return it as a string.  Otherwise, return null.
    getTranslationError(mediaId)
    {
        // Don't display any errors if translations for this image have been turned back off.
        let firstPageMediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
        if(!this._translateMediaIds.has(firstPageMediaId))
            return null;

        let url = this._translations.get(this._getIdForMediaId(mediaId));
        if(url instanceof Error)
            return url.message;
        else
            return null;
    }

    // If a translation failed with an error, clear the error so it can be retried.
    retryTranslation(mediaId)
    {
        let id = this._getIdForMediaId(mediaId);
        let url = this._translations.get(id);
        if(url instanceof Error)
            this._translations.delete(id);

        this._checkTranslationQueue();
        this._callTranslationUrlsListeners();
    }

    // Return current settings for mediaId.
    _settingsForImage(mediaId)
    {
        let settings = {
            // "ctd" is the only option for this, so we don't have a setting for it.
            detector: "default",
        };

        // If we have overrides for this image, overlay them on top.
        let overrides = this._mediaIdSettingsOverrides.get(mediaId) ?? {};

        for(let [settingsKey, apiKey] of Object.entries(AllSettings))
            settings[apiKey] = overrides[settingsKey] ?? ppixiv.settings.get(settingsKey);

        return settings;
    }

    // Return a settings object for a single media ID.  This can be used interchangably with
    // ppixiv.settings to edit settings for one media ID.
    getSettingHandlerForImage(mediaId)
    {
        return {
            get: (settingName) => {
                return this.getSettingForImage(mediaId, settingName);
            },
            set: (settingName, value) => {
                this.setSettingForImage(mediaId, settingName, value);
                this._callTranslationUrlsListeners();
            },

            // This isn't used.
            addEventListener: () => null,
        };
    }

    // Get and set settings overrides for a single media ID.  Setting names are the same as
    // the equivalent regular settings names.  Setting an override to the current global setting
    // removes the override.  These aren't stored between sessions.
    getSettingForImage(mediaId, settingName)
    {
        let defaultValue = ppixiv.settings.get(settingName);
        let overrides = this._mediaIdSettingsOverrides.get(mediaId);
        if(overrides == null)
            return defaultValue;

        return overrides[settingName] ?? defaultValue;
    }

    setSettingForImage(mediaId, settingName, value)
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);

        let overrides = this._mediaIdSettingsOverrides.get(mediaId);
        if(overrides == null)
        {
            overrides = {};
            this._mediaIdSettingsOverrides.set(mediaId, overrides);
        }

        let defaultValue = ppixiv.settings.get(settingName);
        if(value == defaultValue)
            delete overrides[settingName];
        else
            overrides[settingName] = value;

        this._checkTranslationQueue();
    }

    // Return a string identifying a specific set of settings.
    _idForSettings(settings)
    {
        settings = JSON.stringify(settings);
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
        let settings = this._settingsForImage(mediaId);
        let settingsId = this._idForSettings(settings);
        return `${mediaId}|${settingsId}`;
    }

    // Request an image translation.  Return the translation URL, or an Exception object on error.
    async _translateImage(mediaInfo, page)
    {
        let pageMediaId = helpers.mediaId.getMediaIdForPage(mediaInfo.mediaId, page);
        let settings = this._settingsForImage(mediaInfo.mediaId);
        let { size, translator, direction, detector, target_language, forceLowRes } = settings;
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
                    retry: "false",
                    file,
                 },
            });
        } catch(e) {
            throw new TranslationError(e);
        }

        response = JSON.parse(response);

        // We expect to either get a request ID, an error, or a translation result.
        let { id, error, translation_mask } = response;

        if(error != null)
            throw new TranslationError(`Translation error for ${pageMediaId}: ${error}`);

        if(translation_mask != null)
        {
            console.log(`Cached translation result for ${pageMediaId}: ${translation_mask}`);
            return translation_mask;
        }

        if(id == null)
        {
            // We didn't get anything, so we don't understand this response.
            throw new TranslationError(`Unexpected translation response for ${pageMediaId}:`, response);
        }

        // Open the queue socket to wait for the result.
        let websocket = new WebSocket(`wss://api.cotrans.touhou.ai/task/${id}/event/v1`);

        if(!await helpers.other.waitForWebSocketOpened(websocket))
            throw new TranslationError("Couldn't connect to translation socket");

        // Handle messages from the socket.
        try {
            while(1)
            {
                let data = await helpers.other.waitForWebSocketMessage(websocket);
                if(data == null)
                    throw new TranslationError(`Translation socket closed without a result: ${pageMediaId}`);;

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
                    throw new TranslationError(`Translation error for ${pageMediaId}: ${data.error}`);

                case "not_found":
                    // The ID is unknown.  This is either a bug or a server problem.
                    throw new TranslationError(`Translation error for ${pageMediaId}: ID not found`);

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

    // Return a canvas with the given image and its translation composited, or null if we weren't
    // able to load a translation.
    async getTranslatedImage(mediaId)
    {
        // Translations must already be enabled for this post.
        if(!this.getTranslationsEnabled(mediaId))
            return null;

        let [_, page] = helpers.mediaId.toIllustIdAndPage(mediaId);
        let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, { full: true });

        // Even if translations are using the low-res image, download the full image for saving.
        let { url } = mediaInfo.getMainImageUrl(page);

        // Wait for the translation to complete if needed.
        await this.waitForTranslation(mediaId);

        // The translation URL will be null if there's no translated text on this page or if translation failed.
        let translationUrl = this.getTranslationUrl(mediaId);
        if(translationUrl == null)
            return null;

        // Composite the images together.
        let canvas = document.createElement("canvas");
        let context = canvas.getContext("2d");
        let createdCanvas = false;
        for(let imageUrl of [
            url, translationUrl,
        ])
        {
            // Download the image.  We need to use downloadPixivImage for both of these images, since
            // neither supports CORS.
            let arrayBuffer = await downloadPixivImage(imageUrl);
            let blob = new Blob([arrayBuffer]);
            let imageBlobUrl = URL.createObjectURL(blob);

            let img = document.createElement("img");
            img.src = imageBlobUrl;
            try {
                let imageLoadResult = await helpers.other.waitForImageLoad(img);
                if(imageLoadResult == "failed")
                {
                    console.log(`Image load failed: ${imageUrl}`);
                    return null;
                }
            } finally {
                URL.revokeObjectURL(imageBlobUrl);
            }

            // Set up the canvas when we get the main image.
            if(!createdCanvas)
            {
                createdCanvas = true;
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
            }

            context.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, canvas.width, canvas.height);
        }
        
        return canvas;
    }

    // If translations are enabled for mediaId, wait for the translation result.  If translations
    // are turned off, return immediately.
    waitForTranslation(mediaId, { signal }={})
    {
        return new Promise((resolve) => {
            // Return true if we should resolve.
            let isReady = () =>
            {
                if(!this.getTranslationsEnabled(mediaId))
                {
                    console.error(`Translations not enabled for ${mediaId}`);
                    return true;
                }

                return this._translations.has(this._getIdForMediaId(mediaId));
            }

            // Just resolve now if the result is already ready.
            if(isReady())
            {
                resolve();
                return;
            }

            // mediamodified will be fired when we get a translation, and also if translations
            // are disabled while we're waiting.
            let cleanupAbort =  new AbortController();

            ppixiv.mediaCache.addEventListener("mediamodified", (e) => {
                if(isReady())
                {
                    cleanupAbort.abort();
                    resolve();
                }
            }, { signal: cleanupAbort.signal });
        });
    }
}

// A MenuOptionToggle to toggle translation for an image.
export class MenuOptionToggleImageTranslation extends MenuOptionToggle
{
    constructor({ mediaId, ...options })
    {
        super({
            label: "Translate this image",
            onclick: (e) => this.value = !this.value,
            ...options
        });

        this.mediaId = mediaId;
    }

    refresh()
    {
        super.refresh();
        this.checkbox.checked = this.value;
    }

    get value()
    {
        return ppixiv.imageTranslations.getTranslationsEnabled(this.mediaId);
    }

    set value(value)
    {
        ppixiv.imageTranslations.setTranslationsEnabled(this.mediaId, value);
        this.refresh();
    }
}

// Show translation errors and allow retrying.
export class MenuOptionRetryTranslation extends MenuOptionRow
{
    constructor({ mediaId, ...options })
    {
        super({
            label: "There was an error translating this image",
            onclick: (e) => this.value = !this.value,
            ...options
        });

        new MenuOptionButton({
            icon: "wallpaper",
            label: "Retry",
            container: this.root,
            onclick: () => {
                ppixiv.imageTranslations.retryTranslation(this.mediaId);
            },
        });

        ppixiv.imageTranslations.addEventListener("translation-urls-changed", () => this.refresh(), this._signal);

        this.mediaId = mediaId;
    }

    refresh()
    {
        super.refresh();

        let error = ppixiv.imageTranslations.getTranslationError(this.mediaId);
        this.visible = error;
    }
}

function createTranslationSettingsWidget({ globalOptions, editOverrides })
{
    // If we're editing overrides, use the settings handler for this image.  Otherwise, just edit
    // settings normally.  We access the current media ID directly here (noromal settings pages
    // don't need it, so it's not propagated here) and assume the current image won't change
    // while a dialog is open.
    let settings = ppixiv.settings;
    let displayedMediaId = ppixiv.app.displayedMediaId;
    if(editOverrides)
        settings = editOverrides? ppixiv.imageTranslations.getSettingHandlerForImage(displayedMediaId):ppixiv.settings;

    return {
        // Translation settings
        translateThisImage: () => {
            // This is only used if we have a valid media ID.
            return new MenuOptionToggleImageTranslation({
                ...globalOptions,
                mediaId: displayedMediaId,
            });
        },

        translationLanguage: () => {
            return new MenuOptionOptionsSetting({
                ...globalOptions,
                setting: "translation_language",
                settings,
                label: "Language",
                values: {
                    ENG: "English",
                    CHS: "Chinese (Simplified)",
                    CHT: "Chinese (Traditional)",
                    CSY: "Czech",
                    NLD: "Dutch",
                    FRA: "French",
                    DEU: "German",
                    HUN: "Hungarian",
                    ITA: "Italian",
                    JPN: "Japanese",
                    KOR: "Korean",
                    PLK: "Polish",
                    PTB: "Portuguese (Brazil)",
                    ROM: "Romanian",
                    RUS: "Russian",
                    ESP: "Spanish",
                    TRK: "Turkish",
                    UKR: "Ukrainian",
                    VIN: "Vietnames",
                    ARA: "Arabic",
                    SRP: "Serbian",
                    HRV: "Croatian",
                },
            });
        },

        translationTranslator: () => {
            return new MenuOptionOptionsSetting({
                ...globalOptions,
                setting: "translation_translator",
                settings,
                label: "Translation engine",
                values: {
                    "gpt3.5": "GPT3.5",
                    googleL: "Google",
                    youdao: "Youdao",
                    baidu: "Baidu",
                    deepl: "DeepL",
                    papago: "Papago",
                    offline: "Offline",
                    none: "None (remove text)",
                },
            });
        },

        translationLowRes: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                setting: "translation_low_res",
                settings,
                label: "Use low res image for translations (faster)",
            });
        },

        translationSize: () => {
            return new MenuOptionOptionsSetting({
                ...globalOptions,
                setting: "translation_size",
                settings,
                label: "Translation resolution",
                values: {
                    S: "1024x1024",
                    M: "1536x1536",
                    L: "2048x2048",
                    XL: "2560x2560",
                },
            });
        },

        translationDirection: () => {
            return new MenuOptionOptionsSetting({
                ...globalOptions,
                setting: "translation_direction",
                settings,
                label: "Text direction",
                values: {
                    auto: "Automatic",
                    h: "Horizontal",
                    v: "Vertical",
                },
            });
        },        
    
        retryTranslation: () => {
            return new MenuOptionRetryTranslation({
                ...globalOptions,
                mediaId: displayedMediaId,
            });
        },
    }
}

// Create settings widgets.  If editOverrides is true, edit settings overrides for the current image.
export function createTranslationSettingsWidgets({ globalOptions, editOverrides })
{
    let settingsWidgets = createTranslationSettingsWidget({ globalOptions, editOverrides });

    // If this is the override settings page, add the explanation header.
    if(editOverrides)
    {
        new Widget({
            ...globalOptions,
            template: `
                <div style="padding: 0.5em;">
                    These settings will only affect this image, and aren't saved.  Settings for
                    all images can be changed from settings.
                </div>
            `,
        });

        settingsWidgets.translateThisImage();
    }

    settingsWidgets.translationLanguage();
    settingsWidgets.translationTranslator();
    // settingsWidgets.translationLowRes();
    settingsWidgets.translationSize();
    settingsWidgets.translationDirection();
    settingsWidgets.retryTranslation();
}
