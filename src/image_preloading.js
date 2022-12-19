"use strict";

// Handle preloading images.
//
// If we have a reasonably fast connection and the site is keeping up, we can just preload
// blindly and let the browser figure out priorities.  However, if we preload too aggressively
// for the connection and loads start to back up, it can cause image loading to become delayed.
// For example, if we preload 100 manga page images, and then back out of the page and want to
// view something else, the browser won't load anything else until those images that we no
// longer need finish loading.
//
// image_preloader is told the media_id that we're currently showing, and the ID that we want
// to speculatively load.  We'll run loads in parallel, giving the current image's resources
// priority and cancelling loads when they're no longer needed.

// A base class for fetching a single resource:
class preloader
{
    constructor()
    {
        this.abort_controller = new AbortController();
    }

    // Cancel the fetch.
    cancel()
    {
        if(this.abort_controller == null)
            return;

        this.abort_controller.abort();
        this.abort_controller = null;
    }
}

// Load a single image with <img>:
class img_preloader extends preloader
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

        let result = await helpers.wait_for_image_load(img, this.abort_controller.signal);
        if(result == "failed" && this.onerror)
            this.onerror();
    }
}

// Load a resource with fetch.
class fetch_preloader extends preloader
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
            signal: this.abort_controller.signal,
        });

        // Wait for the body to download before completing.  Ignore errors here (they'll
        // usually be cancellations).
        try {
            request = await request;
            await request.text();
        } catch(e) { }
    }
}

// The image preloader singleton.
ppixiv.image_preloader = class
{
    // Return the singleton, creating it if needed.
    static get singleton()
    {
        if(image_preloader._singleton == null)
            image_preloader._singleton = new image_preloader();
        return image_preloader._singleton;
    };

    constructor()
    {
        // The _preloader objects that we're currently running.
        this.preloads = [];

        // A queue of URLs that we've finished preloading recently.  We use this to tell if
        // we don't need to run a preload.
        this.recently_preloaded_urls = [];
    }

    // Set the media_id the user is currently viewing.  If media_id is null, the user isn't
    // viewing an image (eg. currently viewing thumbnails).
    async set_current_image(media_id)
    {
        if(this.current_media_id == media_id)
            return;

        this.current_media_id = media_id;
        this.current_illust_info = null;

        await this.guess_preload(media_id);

        if(this.current_media_id == null)
            return;

        // Get the image data.  This will often already be available.
        let illust_info = await media_cache.get_media_info(this.current_media_id);

        // Stop if the illust was changed while we were loading.
        if(this.current_media_id != media_id)
            return;

        // Store the illust_info for current_media_id.
        this.current_illust_info = illust_info;

        this.check_fetch_queue();
    }

    // Set the media_id we want to speculatively load, which is the next or previous image in
    // the current search.  If media_id is null, we don't want to speculatively load anything.
    async set_speculative_image(media_id)
    {
        if(this.speculative_media_id == media_id)
            return;

        this.speculative_media_id = media_id;
        this.speculative_illust_info = null;
        if(this.speculative_media_id == null)
            return;

        // Get the image data.  This will often already be available.
        let illust_info = await media_cache.get_media_info(this.speculative_media_id);
        if(this.speculative_media_id != media_id)
            return;

        // Stop if the illust was changed while we were loading.
        if(this.speculative_media_id != media_id)
            return;

        // Store the illust_info for current_media_id.
        this.speculative_illust_info = illust_info;

        this.check_fetch_queue();
    }

    // See if we need to start or stop preloads.  We do this when we have new illustration info,
    // and when a fetch finishes.
    check_fetch_queue()
    {
        // console.log("check queue:", this.current_illust_info != null, this.speculative_illust_info != null);

        // Make a list of fetches that we want to be running, in priority order.
        let wanted_preloads = [];
        if(this.current_illust_info != null)
            wanted_preloads = wanted_preloads.concat(this.create_preloaders_for_illust(this.current_illust_info, this.current_media_id));
        if(this.speculative_illust_info != null)
            wanted_preloads = wanted_preloads.concat(this.create_preloaders_for_illust(this.speculative_illust_info, this.speculative_media_id));

        // Remove all preloads from wanted_preloads that we've already finished recently.
        let filtered_preloads = [];
        for(let preload of wanted_preloads)
        {
            if(this.recently_preloaded_urls.indexOf(preload.url) == -1)
                filtered_preloads.push(preload);
        }

        // If we don't want any preloads, stop.  If we have any running preloads, let them continue.
        if(filtered_preloads.length == 0)
        {
            // console.log("Nothing to do");
            return;
        }

        // Discard preloads beyond the number we want to be running.  If we're loading more than this,
        // we'll start more as these finish.
        let concurrent_preloads = 5;
        filtered_preloads.splice(concurrent_preloads);
        // console.log("Preloads:", filtered_preloads.length);

        // If any preload in the list is running, stop.  We only run one preload at a time, so just
        // let it finish.
        for(let preload of filtered_preloads)
        {
            let active_preload = this._find_active_preload_by_url(preload.url);
            if(active_preload != null)
                return;
        }

        // No preloads are running, so start the highest-priority preload.
        //
        // updated_preload_list allows us to run multiple preloads at a time, but we currently
        // run them in serial.
        let unwanted_preloads;
        let updated_preload_list = [];
        for(let preload of filtered_preloads)
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
                    this.recently_preloaded_urls.push(preload.url);
                    this.recently_preloaded_urls.splice(0, this.recently_preloaded_urls.length - 1000);
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
                this.check_fetch_queue();
            });

            updated_preload_list.push(preload);
            break;
        }

        // Cancel preloads in this.preloads that aren't in updated_preload_list.  These are
        // preloads that we either don't want anymore, or which have been pushed further down
        // the priority queue and overridden.
        for(let preload of this.preloads)
        {
            if(updated_preload_list.indexOf(preload) != -1)
                continue;

            // console.log("Cancelling preload:", preload.url);
            preload.cancel();

            // Preloads stay in the list until the cancellation completes.
            updated_preload_list.push(preload);
        }

        this.preloads = updated_preload_list;
    }

    // Return the preloader if we're currently preloading url.
    _find_active_preload_by_url(url)
    {
        for(let preload of this.preloads)
            if(preload.url == url)
                return preload;
        return null;
    }

    // Return an array of preloaders to load resources for the given illustration.
    create_preloaders_for_illust(illust_data, media_id)
    {
        // Don't precache muted images.
        if(muting.singleton.any_tag_muted(illust_data.tagList))
            return [];
        if(muting.singleton.is_muted_user_id(illust_data.userId))
            return [];

        // If this is an animation, preload the ZIP.
        if(illust_data.illustType == 2 && !helpers.is_media_id_local(media_id))
        {
            let results = [];

            // Don't preload ZIPs in Firefox.  It has a bug in Fetch: when in an incognito window,
            // the actual streaming file read in IncrementalReader will stop returning data  after a
            // couple seconds if it overlaps with this non-streaming read.  (It also has another bug:
            // this non-streaming read will prevent the unrelated streaming read from streaming, so
            // image loading will block until the file finishes loading instead of loading smoothly.)
            let firefox = navigator.userAgent.indexOf("Firefox/") != -1;
            if(!firefox)
                results.push(new fetch_preloader(illust_data.ugoiraMetadata.originalSrc));

            // Preload the original image too, which viewer_ugoira displays if the ZIP isn't
            // ready yet.
            results.push(new img_preloader(illust_data.urls.original));

            return results;
        }

        // If this is a video, preload the poster.
        if(illust_data.illustType == "video")
            return [new img_preloader(illust_data.mangaPages[0].urls.poster) ];

        // Otherwise, preload the images.  Preload thumbs first, since they'll load
        // much faster.  Don't preload local thumbs, since they're generated on-demand
        // by the local server and are just as expensive to load as the full image.
        let results = [];

        for(let url of illust_data.previewUrls)
        {
            if(!local_api.should_preload_thumbs(media_id, url))
                continue;

            results.push(new img_preloader(url));
        }

        // Preload the requested page.
        let page = helpers.parse_media_id(media_id).page;
        if(page < illust_data.mangaPages.length)
        {
            let { url } = media_cache.get_main_image_url(illust_data, page);
            results.push(new img_preloader(url));
        }

        if(!ppixiv.mobile)
        {
            // Preload the remaining pages.
            for(let p = 0; p < illust_data.mangaPages.length; ++p)
            {
                if(p == page)
                    continue;

                let { url } = media_cache.get_main_image_url(illust_data, page);
                results.push(new img_preloader(url));
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
    async guess_preload(media_id)
    {
        if(ppixiv.mobile)
            return;

        // See if we can guess the image's URL from previous info, or if we can figure it
        // out from another source.
        let guessed_url = null;
        if(media_id != null)
        {
            guessed_url = await guess_image_url.get.guess_url(media_id);
            if(this.guessed_preload && this.guessed_preload.url == guessed_url)
                return;
        }

        // Cancel any previous guessed preload.
        if(this.guessed_preload)
        {
            this.guessed_preload.cancel();
            this.guessed_preload = null;
        }

        // Start the new guessed preload.
        if(guessed_url)
        {
            this.guessed_preload = new img_preloader(guessed_url, () => {
                // The image load failed.  Let guessed_preload know.
                // console.info("Guessed image load failed");
                guess_image_url.get.guessed_url_incorrect(media_id);
            });
            this.guessed_preload.start();
        }
    }
};

