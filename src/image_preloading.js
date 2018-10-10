// Handle preloading images.
//
// If we have a reasonably fast connection and the site is keeping up, we can just preload
// blindly and let the browser figure out priorities.  However, if we preload too aggressively
// for the connection and loads start to back up, it can cause image loading to become delayed.
// For example, if we preload 100 manga page images, and then back out of the page and want to
// view something else, the browser won't load anything else until those images that we no
// longer need finish loading.
//
// image_preloader is told the illust_id that we're currently showing, and the ID that we want
// to speculatively load.  We'll run loads in parallel, giving the current image's resources
// priority and cancelling loads when they're no longer needed.
//
// This doesn't handle thumbnail preloading.  Those are small and don't really need to be
// cancelled, and since we don't fill the browser's load queue here, we shouldn't prevent
// thumbnails from being able to load.

// A base class for fetching a single resource:
class _preloader
{
    constructor()
    {
        this._run_callback = this._run_callback.bind(this);
    }

    // Call and clear this.callback.
    _run_callback()
    {
        if(this.callback == null)
            return;

        var cb = this.callback;
        this.callback = null;
        try {
            cb(this);
        } catch(e) {
            console.error(e);
        }
    }
}

// Load a single image with <img>:
class _img_preloader extends _preloader
{
    constructor(url)
    {
        super();
        this.url = url;
    }

    // Start the fetch.  This should only be called once.  callback will be called when the fetch
    // completes (it won't be called if it's cancelled first).
    start(callback)
    {
        this.callback = callback;

        this.img = document.createElement("img");
        this.img.src = this.url;

        // If the image loaded synchronously, run the callbnack asynchronously.  Otherwise,
        // call it when the image finishes loading.
        if(this.img.complete)
            setTimeout(this._run_callback, 0);
        else
            this.img.addEventListener("load", this._run_callback);
    }

    // Cancel the fetch.
    cancel()
    {
        // Setting the src of an img causes any ongoing fetch to be cancelled in both Firefox
        // and Chrome.  Set it to a transparent PNG (if we set it to "#", Chrome will try to
        // load the page URL as an image).
        if(this.img == null)
            return;

        this.img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
        this.img = null;
        this.callback = null;
    }
}

// Load a resource with XHR.  We rely on helpers.fetch_resource to make concurrent
// loads with zip_image_player work cleanly.
class _xhr_preloader extends _preloader
{
    constructor(url)
    {
        super();
        this.url = url;
    }

    start(callback)
    {
        this.callback = callback;

        this.abort_controller = new AbortController();
        helpers.fetch_resource(this.url, {
            onload: this._run_callback,
            signal: this.abort_controller.signal,
        });
    }

    cancel()
    {
        if(this.abort_controller == null)
            return;

        this.abort_controller.abort();
        this.abort_controller = null;
    }
}

// The image preloader singleton.
class image_preloader
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
        this.preload_completed = this.preload_completed.bind(this);

        // The _preloader objects that we're currently running.
        this.preloads = [];

        // A queue of URLs that we've finished preloading recently.  We use this to tell if
        // we don't need to run a preload.
        this.recently_preloaded_urls = [];
    }

    // Set the illust_id the user is currently viewing.  If illust_id is null, the user isn't
    // viewing an image (eg. currently viewing thumbnails).
    set_current_image(illust_id)
    {
        if(this.current_illust_id == illust_id)
            return;

        this.current_illust_id = illust_id;
        this.current_illust_info = null;
        if(this.current_illust_id == null)
            return;

        // Get the image data.  This will often already be available.
        image_data.singleton().get_image_info(this.current_illust_id, function(illust_info)
        {
            if(this.current_illust_id != illust_id || this.current_illust_info != null)
                return;

            // Store the illust_info for current_illust_id.
            this.current_illust_info = illust_info;

            // Preload thumbnails.
            this.preload_thumbs(illust_info);

            this.check_fetch_queue();

        }.bind(this));
    }

    // Set the illust_id we want to speculatively load, which is the next or previous image in
    // the current search.  If illust_id is null, we don't want to speculatively load anything.
    set_speculative_image(illust_id)
    {
        if(this.speculative_illust_id == illust_id)
            return;
        
        this.speculative_illust_id = illust_id;
        this.speculative_illust_info = null;
        if(this.speculative_illust_id == null)
            return;

        // Get the image data.  This will often already be available.
        image_data.singleton().get_image_info(this.speculative_illust_id, function(illust_info)
        {
            if(this.speculative_illust_id != illust_id || this.speculative_illust_info != null)
                return;

            // Store the illust_info for current_illust_id.
            this.speculative_illust_info = illust_info;

            // Preload thumbnails.
            this.preload_thumbs(illust_info);

            this.check_fetch_queue();
        }.bind(this));
    }

    // See if we need to start or stop preloads.  We do this when we have new illustration info,
    // and when a fetch finishes.
    check_fetch_queue()
    {
        // console.log("check queue:", this.current_illust_info != null, this.speculative_illust_info != null);

        // Make a list of fetches that we want to be running, in priority order.
        var wanted_preloads = [];
        if(this.current_illust_info != null)
            wanted_preloads = wanted_preloads.concat(this.create_preloaders_for_illust(this.current_illust_info));
        if(this.speculative_illust_info != null)
            wanted_preloads = wanted_preloads.concat(this.create_preloaders_for_illust(this.speculative_illust_info));

        // Remove all preloads from wanted_preloads that we've already finished recently.
        var filtered_preloads = [];
        for(var preload of wanted_preloads)
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
        var concurrent_preloads = 5;
        filtered_preloads.splice(concurrent_preloads);
        // console.log("Preloads:", filtered_preloads.length);

        // Start preloads that aren't running.  Add all preloads that are now running to
        // updated_preload_list.
        var unwanted_preloads;
        var updated_preload_list = [];
        for(var preload of filtered_preloads)
        {
            // If we already have a preloader running for this URL, just let it continue.
            var active_preload = this._find_active_preload_by_url(preload.url);
            if(active_preload != null)
            {
                updated_preload_list.push(active_preload);
                continue;
            }

            // Start this preload.
            // console.log("Start preload:", preload.url);
            preload.start(this.preload_completed);
            updated_preload_list.push(preload);
        }

        // Cancel preloads in this.preloads that aren't in updated_preload_list.  These are
        // preloads that we either don't want anymore, or which have been pushed further down
        // the priority queue and overridden.
        for(var preload of this.preloads)
        {
            if(updated_preload_list.indexOf(preload) != -1)
                continue;

            console.log("Cancelling preload:", preload.url);
            preload.cancel();
        }

        this.preloads = updated_preload_list;
    }

    // This is called when a preloader finishes loading.
    preload_completed(preload)
    {
        // preload finished running.  Remove it from this.preload and add its URL to recently_preloaded_urls.
        this.recently_preloaded_urls.push(preload.url);
        this.recently_preloaded_urls.splice(1000);

        var idx = this.preloads.indexOf(preload);
        if(idx == -1)
        {
            console.error("Preload finished, but we weren't running it:", preload.url);
            return;
        }
        this.preloads.splice(idx, 1);

        // See if we need to start another preload.
        this.check_fetch_queue();
    }

    // Return the preloader if we're currently preloading url.
    _find_active_preload_by_url(url)
    {
        for(var preload of this.preloads)
            if(preload.url == url)
                return preload;
        return null;
    }

    // Return an array of preloaders to load resources for the given illustration.
    create_preloaders_for_illust(illust_data)
    {
        // Don't precache muted images.
        if(muting.singleton.any_tag_muted(illust_data.tags.tags))
            return [];
        if(muting.singleton.is_muted_user_id(illust_data.userId))
            return [];

        // If this is a video, preload the ZIP.
        if(illust_data.illustType == 2)
        {
            var results = [];
            results.push(new _xhr_preloader(illust_data.ugoiraMetadata.originalSrc));

            // Preload the original image too, which viewer_ugoira displays if the ZIP isn't
            // ready yet.
            results.push(new _img_preloader(illust_data.urls.original));

            return results;
        }

        // Otherwise, preload the images.  Preload thumbs first, since they'll load
        // much faster.
        var results = [];
        for(var page = 0; page < illust_data.pageCount; ++page)
        {
            var url = helpers.get_url_for_page(illust_data, page, "original");
            results.push(new _img_preloader(url));
        }

        return results;
    }

    preload_thumbs(illust_info)
    {
        // We're only interested in preloading thumbs for manga pages for the manga
        // thumbnail bar.
        if(illust_info.pageCount < 2)
            return;

        // Preload thumbs directly rather than queueing, since they load quickly and
        // this reduces flicker in the manga thumbnail bar.
        var thumbs = [];
        for(var page = 0; page < illust_info.pageCount; ++page)
            thumbs.push(helpers.get_url_for_page(illust_info, page, "small"));

        helpers.preload_images(thumbs);
    }
};

