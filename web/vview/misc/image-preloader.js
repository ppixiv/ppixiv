// Handle preloading images.
//
// If we have a reasonably fast connection and the site is keeping up, we can just preload
// blindly and let the browser figure out priorities.  However, if we preload too aggressively
// for the connection and loads start to back up, it can cause image loading to become delayed.
// For example, if we preload 100 manga page images, and then back out of the page and want to
// view something else, the browser won't load anything else until those images that we no
// longer need finish loading.
//
// ImagePreloader is told the media_id that we're currently showing, and the ID that we want
// to speculatively load.  We'll run loads in parallel, giving the current image's resources
// priority and cancelling loads when they're no longer needed.

import LocalAPI from 'vview/misc/local-api.js';
import { helpers } from 'vview/misc/helpers.js';

// The image ResourceLoader singleton.
export default class ImagePreloader
{
    // Return the singleton, creating it if needed.
    static get singleton()
    {
        if(ImagePreloader._singleton == null)
            ImagePreloader._singleton = new ImagePreloader();
        return ImagePreloader._singleton;
    };

    constructor()
    {
        // The _preloader objects that we're currently running.
        this.preloads = [];

        // A queue of URLs that we've finished preloading recently.  We use this to tell if
        // we don't need to run a preload.
        this.recentlyPreloadedUrls = [];
    }

    // Set the media_id the user is currently viewing.  If media_id is null, the user isn't
    // viewing an image (eg. currently viewing thumbnails).
    async set_current_image(media_id)
    {
        if(this.currentMediaId == media_id)
            return;

        this.currentMediaId = media_id;
        this.currentMediaInfo = null;

        await this.guessPreload(media_id);

        if(this.currentMediaId == null)
            return;

        // Get the image data.  This will often already be available.
        let illust_info = await ppixiv.media_cache.get_media_info(this.currentMediaId);

        // Stop if the illust was changed while we were loading.
        if(this.currentMediaId != media_id)
            return;

        // Store the illust_info for current_media_id.
        this.currentMediaInfo = illust_info;

        this.checkFetchQueue();
    }

    // Set the media_id we want to speculatively load, which is the next or previous image in
    // the current search.  If media_id is null, we don't want to speculatively load anything.
    async set_speculative_image(media_id)
    {
        if(this._speculativeMediaId == media_id)
            return;

        this._speculativeMediaId = media_id;
        this._speculativeMediaInfo = null;
        if(this._speculativeMediaId == null)
            return;

        // Get the image data.  This will often already be available.
        let illust_info = await ppixiv.media_cache.get_media_info(this._speculativeMediaId);
        if(this._speculativeMediaId != media_id)
            return;

        // Stop if the illust was changed while we were loading.
        if(this._speculativeMediaId != media_id)
            return;

        // Store the illust_info for current_media_id.
        this._speculativeMediaInfo = illust_info;

        this.checkFetchQueue();
    }

    // See if we need to start or stop preloads.  We do this when we have new illustration info,
    // and when a fetch finishes.
    checkFetchQueue()
    {
        // console.log("check queue:", this.currentMediaInfo != null, this._speculativeMediaInfo != null);

        // Make a list of fetches that we want to be running, in priority order.
        let wantedPreloads = [];
        if(this.currentMediaInfo != null)
            wantedPreloads = wantedPreloads.concat(this.createPreloadersForIllust(this.currentMediaInfo, this.currentMediaId));
        if(this._speculativeMediaInfo != null)
            wantedPreloads = wantedPreloads.concat(this.createPreloadersForIllust(this._speculativeMediaInfo, this._speculativeMediaId));

        // Remove all preloads from wantedPreloads that we've already finished recently.
        let filteredPreloads = [];
        for(let preload of wantedPreloads)
        {
            if(this.recentlyPreloadedUrls.indexOf(preload.url) == -1)
                filteredPreloads.push(preload);
        }

        // If we don't want any preloads, stop.  If we have any running preloads, let them continue.
        if(filteredPreloads.length == 0)
        {
            // console.log("Nothing to do");
            return;
        }

        // Discard preloads beyond the number we want to be running.  If we're loading more than this,
        // we'll start more as these finish.
        let concurrentPreloads = 5;
        filteredPreloads.splice(concurrentPreloads);
        // console.log("Preloads:", filteredPreloads.length);

        // If any preload in the list is running, stop.  We only run one preload at a time, so just
        // let it finish.
        for(let preload of filteredPreloads)
        {
            let active_preload = this._findActivePreloadByUrl(preload.url);
            if(active_preload != null)
                return;
        }

        // No preloads are running, so start the highest-priority preload.
        //
        // updatedPreloadList allows us to run multiple preloads at a time, but we currently
        // run them in serial.
        let updatedPreloadList = [];
        for(let preload of filteredPreloads)
        {
            // Start this preload.
            // console.log("Start preload:", preload.url);
            let promise = preload.start();
            let aborted = false;
            promise.catch((e) => {
                if(e.name == "AbortError")
                    aborted = true;
            });

            promise.finally(() => {
                // Add the URL to recently_preloaded_urls, so we don't try to preload this
                // again for a while.  We do this even on error, so we don't try to load
                // failing images repeatedly.
                //
                // Don't do this if the request was aborted, since that just means the user
                // navigated away.
                if(!aborted)
                {
                    this.recentlyPreloadedUrls.push(preload.url);
                    this.recentlyPreloadedUrls.splice(0, this.recentlyPreloadedUrls.length - 1000);
                }

                // When the preload finishes (successful or not), remove it from the list.
                let idx = this.preloads.indexOf(preload);
                if(idx == -1)
                {
                    console.error("Preload finished, but we weren't running it:", preload.url);
                    return;
                }
                this.preloads.splice(idx, 1);

                // See if we need to start another preload.
                this.checkFetchQueue();
            });

            updatedPreloadList.push(preload);
            break;
        }

        // Cancel preloads in this.preloads that aren't in updatedPreloadList.  These are
        // preloads that we either don't want anymore, or which have been pushed further down
        // the priority queue and overridden.
        for(let preload of this.preloads)
        {
            if(updatedPreloadList.indexOf(preload) != -1)
                continue;

            // console.log("Cancelling preload:", preload.url);
            preload.cancel();

            // Preloads stay in the list until the cancellation completes.
            updatedPreloadList.push(preload);
        }

        this.preloads = updatedPreloadList;
    }

    // Return the ResourceLoader if we're currently preloading url.
    _findActivePreloadByUrl(url)
    {
        for(let preload of this.preloads)
            if(preload.url == url)
                return preload;
        return null;
    }

    // Return an array of preloaders to load resources for the given illustration.
    createPreloadersForIllust(mediaInfo, media_id)
    {
        // Don't precache muted images.
        if(ppixiv.muting.any_tag_muted(mediaInfo.tagList))
            return [];
        if(ppixiv.muting.is_muted_user_id(mediaInfo.userId))
            return [];

        // If this is an animation, preload the ZIP.
        if(mediaInfo.illustType == 2 && !helpers.is_media_id_local(media_id))
        {
            let results = [];

            // Don't preload ZIPs in Firefox.  It has a bug in Fetch: when in an incognito window,
            // the actual streaming file read in IncrementalReader will stop returning data  after a
            // couple seconds if it overlaps with this non-streaming read.  (It also has another bug:
            // this non-streaming read will prevent the unrelated streaming read from streaming, so
            // image loading will block until the file finishes loading instead of loading smoothly.)
            let firefox = navigator.userAgent.indexOf("Firefox/") != -1;
            if(!firefox)
                results.push(new FetchResourceLoader(mediaInfo.ugoiraMetadata.originalSrc));

            // Preload the original image too, which viewer_ugoira displays if the ZIP isn't
            // ready yet.
            results.push(new ImgResourceLoader(mediaInfo.urls.original));

            return results;
        }

        // If this is a video, preload the poster.
        if(mediaInfo.illustType == "video")
            return [new ImgResourceLoader(mediaInfo.mangaPages[0].urls.poster) ];

        // Otherwise, preload the images.  Preload thumbs first, since they'll load
        // much faster.  Don't preload local thumbs, since they're generated on-demand
        // by the local server and are just as expensive to load as the full image.
        let results = [];

        for(let url of mediaInfo.previewUrls)
        {
            if(!LocalAPI.should_preload_thumbs(media_id, url))
                continue;

            results.push(new ImgResourceLoader(url));
        }

        // Preload the requested page.
        let page = helpers.parse_media_id(media_id).page;
        if(page < mediaInfo.mangaPages.length)
        {
            let { url } = ppixiv.media_cache.get_main_image_url(mediaInfo, page);
            results.push(new ImgResourceLoader(url));
        }

        if(!ppixiv.mobile)
        {
            // Preload the remaining pages.
            for(let p = 0; p < mediaInfo.mangaPages.length; ++p)
            {
                if(p == page)
                    continue;

                let { url } = ppixiv.media_cache.get_main_image_url(mediaInfo, page);
                results.push(new ImgResourceLoader(url));
            }
        }

        return results;
    }

    // Try to start a guessed preload.
    //
    // This uses guess_image_url to try to figure out the image URL earlier.  Normally
    // we have to wait for the image info request to finish before we have the image URL
    // to start loading, but if we can guess the URL correctly then we can start loading
    // it immediately.
    //
    // If media_id is null, stop any running guessed preload.
    async guessPreload(media_id)
    {
        if(ppixiv.mobile)
            return;

        // See if we can guess the image's URL from previous info, or if we can figure it
        // out from another source.
        let guessedUrl = null;
        if(media_id != null)
        {
            guessedUrl = await ppixiv.guess_image_url.guess_url(media_id);
            if(this.guessedPreload && this.guessedPreload.url == guessedUrl)
                return;
        }

        // Cancel any previous guessed preload.
        if(this.guessedPreload)
        {
            this.guessedPreload.cancel();
            this.guessedPreload = null;
        }

        // Start the new guessed preload.
        if(guessedUrl)
        {
            this.guessedPreload = new ImgResourceLoader(guessedUrl, () => {
                // The image load failed.  Let guessed_preload know.
                // console.info("Guessed image load failed");
                ppixiv.guess_image_url.guessed_url_incorrect(media_id);
            });
            this.guessedPreload.start();
        }
    }
}

// A base class for fetching a single resource:
class ResourceLoader
{
    constructor()
    {
        this.abortController = new AbortController();
    }

    // Cancel the fetch.
    cancel()
    {
        if(this.abortController == null)
            return;

        this.abortController.abort();
        this.abortController = null;
    }
}

// Load a single image with <img>:
class ImgResourceLoader extends ResourceLoader
{
    constructor(url, onerror=null)
    {
        super();
        this.url = url;
        this.onerror = onerror;
        console.assert(url);
    }

    // Start the fetch.  This should only be called once.
    async start()
    {
        if(this.url == null)
            return;

        let img = document.createElement("img");
        img.src = this.url;

        let result = await helpers.wait_for_image_load(img, this.abortController.signal);
        if(result == "failed" && this.onerror)
            this.onerror();
    }
}

// Load a resource with fetch.
class FetchResourceLoader extends ResourceLoader
{
    constructor(url)
    {
        super();
        this.url = url;
        console.assert(url);
    }

    async start()
    {
        if(this.url == null)
            return;

        let request = helpers.send_pixiv_request({
            url: this.url,
            method: "GET",
            signal: this.abortController.signal,
        });

        // Wait for the body to download before completing.  Ignore errors here (they'll
        // usually be cancellations).
        try {
            request = await request;
            await request.text();
        } catch(e) { }
    }
}
