"use strict";

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
// always need it, so it doesn't fit here.  See ppixiv.extra_cache.load_bookmark_details.
// 
// Callers can request full or partial data.  If partial data is requested, we can return
// full data instead if we already have it, since it's a superset.  If we have to load info
// for a single image, we'll always load full info.  We can only batch load partial info,
// since Pixiv doesn't have any API to allow batch loading full info.
//
// Our media IDs encode Pixiv manga pages, but this only deals with top-level illustrations, and
// the page number in illust media IDs is always 1 here.

// Partial media info always contains these keys.  This is checked by _check_illust_data,
// to make sure we don't accidentally start storing keys that might not always be there.
// We aren't strict with full info, since it's always all the data we have available and
// it only comes from one API.
const partial_media_info_keys = Object.freeze([
    "mediaId",                          // Our media ID
    "illustId",                         // Pixiv's illust ID
    "illustType",                       // 0 or 1: illust, 2: ugoira, "video": local video
    "illustTitle",
    "pageCount",                        // Manga pages (always 1 for videos and local images)
    "userId",
    "userName",
    "width",                            // if a manga post, this is for the first page only 
    "height",
    "previewUrls",
    "bookmarkData",                     // null if not bookmarked, otherwise an object
    "createDate",
    "tagList",                          // a flat array of illust tags
    "extraData",                        // editor info
    "full",
]);

// This handles fetching and caching image data.
ppixiv.MediaCache = class extends EventTarget
{
    constructor()
    {
        super();
        
        this.illust_modified_callbacks = new callback_list();

        // Cached data:
        this.media_info = { };

        // Negative cache to remember illusts that don't exist, so we don't try to
        // load them repeatedly:
        this.nonexistant_media_ids = { };

        // Promises for ongoing requests:
        this.media_info_loads_full = {};
        this.media_info_loads_partial = {};

        this.user_profile_urls = {};
    };

    call_illust_modified_callbacks(media_id)
    {
        this.illust_modified_callbacks.call(media_id);

        let event = new Event("mediamodified");
        event.media_id = media_id;
        this.dispatchEvent(event);

        this.queue_info_loaded_event(media_id);
    }

    // Queue an infoloaded event.  This is batched and lets listeners know when any
    // info has been loaded.
    queue_info_loaded_event(media_id)
    {
        if(this._media_ids_loaded == null)
        {
            this._media_ids_loaded = new Set();

            setTimeout(() => {
                let e = new Event("infoloaded");
                e.mediaIds = Array.from(this._media_ids_loaded);
                this._media_ids_loaded = null;
                this.dispatchEvent(e);
            }, 0);
        }

        this._media_ids_loaded.add(media_id);
    }

    // Load media data asynchronously.  If full is true, return full info, otherwise full or
    // partial info can be returned.
    get_media_info(media_id, { full=true }={})
    {
        media_id = helpers.get_media_id_first_page(media_id);
        if(media_id == null)
            return null;

        // Stop if we know this illust doesn't exist.
        if(media_id in this.nonexistant_media_ids)
            return null;

        // If we already have the image data, just return it.
        if(this.media_info[media_id] != null && (!full || this.media_info[media_id].full))
            return Promise.resolve(this.media_info[media_id]);

        // If there's already a load in progress, return the running promise.
        if(full && this.media_info_loads_full[media_id] != null)
            return this.media_info_loads_full[media_id];
        if(!full && this.media_info_loads_partial[media_id] != null)
            return this.media_info_loads_partial[media_id];
        
        // Start the load.  If something's requesting partial info for a single image
        // then we'll almost always need full info too, so we always just load full info
        // here.
        let load_promise = this._load_media_info(media_id);
        this._started_loading_media_info_full(media_id, load_promise);
        return load_promise;
    }

    // Like get_media_info, but return the result immediately, or null if it's not
    // already loaded.
    get_media_info_sync(media_id, { full=true }={})
    {
        media_id = helpers.get_media_id_first_page(media_id);
        let media_info = this.media_info[media_id];

        // If full info was requested and we only have partial info, don't return it.
        if(full && !media_info?.full)
            return null;

        return media_info;
    }
    
    // If get_image_info returned null, return the error message.
    get_illust_load_error(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        return this.nonexistant_media_ids[media_id];
    }

    // Refresh media info for the given media ID.
    //
    // If an image only has partial info loaded, this will cause its full info to be loaded.
    async refresh_media_info(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        if(this.media_info[media_id] == null)
            return;

        await this._load_media_info(media_id, { force: true });
    }

    // Add media info to the cache that we received from other sources.  Note that if
    // we have any fetches in the air already, we'll leave them running.  This will
    // trigger loads for secondary data like manga pages if it's not included in media_info.
    //
    // If preprocessed is true, this data is coming from something like another ppixiv tab,
    // and we can just store the data.  It already has any required data and adjustments that
    // happen when we load data normally.  If preprocessed is false, media_info is from
    // something like the HTML preload field and is treated the same as an API response.
    add_media_info_full(media_info, { preprocessed=false }={})
    {
        if(preprocessed)
        {
            // Just store the data directly.
            this._check_illust_data(media_info);

            let media_id = media_info.mediaId;
            this.media_info[media_id] = media_info;
            this.call_illust_modified_callbacks(media_id);
            return Promise.resolve(media_info);
        }
        else
        {
            // This media_info is from the API and hasn't been adjusted yet, so media_info.illustId
            // and media_info.mediaId don't exist yet.
            let media_id = helpers.illust_id_to_media_id(media_info.id);
            let load_promise = this._load_media_info(media_id, { media_info, force: true });
            this._started_loading_media_info_full(media_id, load_promise);
            return load_promise;
        }
    }

    _started_loading_media_info_full(media_id, load_promise)
    {
        // Remember that we're loading this ID, and unregister it when it completes.
        this.media_info_loads_full[media_id] = load_promise;
        this.media_info_loads_full[media_id].finally(() => {
            if(this.media_info_loads_full[media_id] === load_promise)
                delete this.media_info_loads_full[media_id];
        });
    }

    _started_loading_media_info_partial(media_id, load_promise)
    {
        // Remember that we're loading this ID, and unregister it when it completes.
        this.media_info_loads_partial[media_id] = load_promise;
        this.media_info_loads_partial[media_id].finally(() => {
            if(this.media_info_loads_partial[media_id] === load_promise)
                delete this.media_info_loads_partial[media_id];
        });
    }

    // Load media_id and all data that it depends on.
    //
    // If we already have the image data (not necessarily the rest, like ugoira_metadata),
    // it can be supplied with illust_data.
    async _load_media_info(media_id, { illust_data=null }={})
    {
        media_id = helpers.get_media_id_first_page(media_id);
        let [illust_id] = helpers.media_id_to_illust_id_and_page(media_id);

        delete this.nonexistant_media_ids[media_id];

        // If this is a local image, use our API to retrieve it.
        if(helpers.is_media_id_local(media_id))
            return await this._load_local_image_data(media_id);

        console.log("Fetching", media_id);

        let manga_promise = null;
        let ugoira_promise = null;

        // Given an illust_type, start any fetches we can.
        let start_loading = (illust_type, page_count) => {
            // If we know the illust type and haven't started loading other data yet, start them.
            if(page_count != null && page_count > 1 && manga_promise == null && illust_data?.mangaPages == null)
                manga_promise = helpers.get_request(`/ajax/illust/${illust_id}/pages`, {});
            if(illust_type == 2 && ugoira_promise == null && (illust_data == null || illust_data.ugoiraMetadata == null))
                ugoira_promise = helpers.get_request(`/ajax/illust/${illust_id}/ugoira_meta`);
        };

        // If we already had partial info, we can start loading other metadata immediately instead
        // of waiting for the illust info to load, since we already know the image type.
        let partial_info = this.media_info[media_id];
        if(partial_info != null)
            start_loading(partial_info.illustType, partial_info.pageCount);
    
        // If we don't have illust data, block while it loads.
        if(illust_data == null)
        {
            let illust_result_promise = helpers.get_request(`/ajax/illust/${illust_id}`, {});
            let illust_result = await illust_result_promise;
            if(illust_result == null || illust_result.error)
            {
                let message = illust_result?.message || "Error loading illustration";
                console.log(`Error loading illust ${illust_id}; ${message}`);
                this.nonexistant_media_ids[media_id] = message;
                return null;
            }

            illust_data = illust_result.body;
        }
        tag_translations.get().add_translations(illust_data.tags.tags);

        // If we have extra data stored for this image, load it.
        let extra_data = await extra_image_data.get.load_all_pages_for_illust(illust_id);
        illust_data.extraData = extra_data;

        // Now that we have illust data, load anything we weren't able to load before.
        start_loading(illust_data.illustType, illust_data.pageCount);

        // Switch from i.pximg.net to i-cf.pximg.net, which is much faster outside of Japan.
        for(let [key, url] of Object.entries(illust_data.urls))
        {
            url = new URL(url);
            helpers.adjust_image_url_hostname(url);
            illust_data.urls[key] = url.toString();
        }

        // Add an array of thumbnail URLs.
        illust_data.previewUrls = [];
        for(let page = 0; page < illust_data.pageCount; ++page)
        {
            let url = helpers.get_high_res_thumbnail_url(illust_data.urls.small, page);
            illust_data.previewUrls.push(url);
        }

        // Add a flattened tag list.
        illust_data.tagList = [];
        for(let tag of illust_data.tags.tags)
            illust_data.tagList.push(tag.tag);

        if(manga_promise != null)
        {
            let manga_info = await manga_promise;
            illust_data.mangaPages = manga_info.body;

            for(let page of illust_data.mangaPages)
            {
                for(let [key, url] of Object.entries(page.urls))
                {
                    url = new URL(url);
                    helpers.adjust_image_url_hostname(url);
                    page.urls[key] = url.toString();
                }
            }
        }

        if(ugoira_promise != null)
        {
            let ugoira_result = await ugoira_promise;
            illust_data.ugoiraMetadata = ugoira_result.body;

            // Switch the data URL to i-cf..pximg.net.
            let url = new URL(illust_data.ugoiraMetadata.originalSrc);
            helpers.adjust_image_url_hostname(url);
            illust_data.ugoiraMetadata.originalSrc = url.toString();
        }

        // If this is a single-page image, create a dummy single-entry mangaPages array.  This lets
        // us treat all images the same.
        if(illust_data.pageCount == 1)
        {
            illust_data.mangaPages = [{
                width: illust_data.width,
                height: illust_data.height,

                // Rather than just referencing illust_Data.urls, copy just the image keys that
                // exist in the regular mangaPages list (no thumbnails).
                urls: {
                    original: illust_data.urls.original,
                    regular: illust_data.urls.regular,
                    small: illust_data.urls.small,
                }
            }];
        }

        // Remember that this is full info.
        illust_data.full = true;

        // The image data has both "id" and "illustId" containing the image ID.  Remove id to
        // make sure we only use illustId, and set mediaId.  This makes it clear what type of
        // ID you're getting.
        illust_data.mediaId = media_id;
        delete illust_data.id;

        // 
        delete illust_data.userIllusts;
        guess_image_url.get.add_info(illust_data);

        this._check_illust_data(illust_data);

        // Store the image data.
        this.media_info[media_id] = illust_data;
        this.call_illust_modified_callbacks(media_id);
        return illust_data;
    }

    // Load partial info for the given media IDs if they're not already loaded.
    async batch_get_media_info_partial(media_ids, { force=false }={})
    {
        let promises = [];

        let needed_media_ids = [];
        let local_media_ids = [];
        for(let media_id of media_ids)
        {
            media_id = helpers.get_media_id_first_page(media_id);

            // If we're not forcing a refresh, skip this ID if it's already loaded.
            if(!force && this.media_info[media_id] != null)
                continue;

            // Skip IDs that are already loading.
            let existing_load = this.media_info_loads_full[media_id] ?? this.media_info_loads_partial[media_id];
            if(existing_load)
            {
                promises.push(existing_load);
                continue;
            }

            // Only load local IDs and illust IDs.
            let { type } = helpers.parse_media_id(media_id);
            if(helpers.is_media_id_local(media_id))
                local_media_ids.push(media_id);
            else if(type == "illust")
                needed_media_ids.push(media_id);
        }

        // If any of these are local IDs, load them with local_api.
        if(local_media_ids.length)
        {
            let load_promise = local_api.load_media_ids(local_media_ids);

            // Local API loads always give full info, so register these as full loads.
            for(let media_id of media_ids)
                this._started_loading_media_info_full(media_id, load_promise);

            promises.push(load_promise);
        }

        if(needed_media_ids.length)
        {
            let load_promise = this._do_batch_get_media_info(needed_media_ids);
            for(let media_id of media_ids)
                this._started_loading_media_info_partial(media_id, load_promise);
            promises.push(load_promise);
        }

        // Wait for all requests we started to finish, as well as any requests that
        // were already running.
        await Promise.all(promises);
    }

    // Run the low-level API call to load partial media info, and register the result.
    async _do_batch_get_media_info(media_ids)
    {
        if(media_ids.length == 0)
            return;

        // There's also
        //
        // https://www.pixiv.net/ajax/user/user_id/profile/illusts?ids[]=1&ids[]=2&...
        //
        // which is used by newer pages.  That's useful since it tells us whether each
        // image is bookmarked.  However, it doesn't tell us the user's name or profile image
        // URL, and for some reason it's limited to a particular user.  Hopefully they'll
        // have an updated generic illustration lookup call if they ever update the
        // regular search pages, and we can switch to it then.
        let result = await helpers.rpc_get_request("/rpc/illust_list.php", {
            illust_ids: media_ids.join(","),

            // Specifying this gives us 240x240 thumbs, which we want, rather than the 150x150
            // ones we'll get if we don't (though changing the URL is easy enough too).
            page: "discover",

            // We do our own muting, but for some reason this flag is needed to get bookmark info.
            exclude_muted_illusts: 1,
        });

        await this.add_media_infos_partial(result, "illust_list");
    }

    // Cache partial media info that was loaded from a Pixiv search.  This can come from
    // batch_get_media_info_partial() or from being included in a search result.
    add_media_infos_partial = async (search_result, source) =>
    {
        if(search_result.error)
            return;

        // Ignore entries with "isAdContainer".
        search_result = search_result.filter(item => !item.isAdContainer);

        let all_thumb_info = [];
        for(let thumb_info of search_result)
        {
            let { remapped_thumb_info, profile_image_url } = ppixiv.media_cache_mappings.remap_partial_media_info(thumb_info, source);

            // The profile image URL isn't included in image info since it's not present in full
            // info.  Store it separately.
            if(profile_image_url)
                this.user_profile_urls[remapped_thumb_info.userId] = profile_image_url;

            all_thumb_info.push(remapped_thumb_info);
        }

        // Load any extra image data stored for these media IDs.  These are stored per page, but
        // batch loaded per image.
        let media_ids = all_thumb_info.map((info) => info.illustId);
        let extra_data = await extra_image_data.get.batch_load_all_pages_for_illust(media_ids);

        for(let info of all_thumb_info)
        {
            // Store extra data for each page.
            info.extraData = extra_data[info.illustId] || {};
            info.full = false;

            this._check_illust_data(info);

            // Store the data.
            this.media_info[info.mediaId] = info;
        }

        // Broadcast that we have new thumbnail data available.
        this.queue_info_loaded_event();
    }

    // Load image info from the local API.
    async _load_local_image_data(media_id)
    {
        let illust_data = await local_api.load_media_info(media_id);
        if(!illust_data.success)
        {
            media_id = helpers.get_media_id_first_page(media_id);
            this.nonexistant_media_ids[media_id] = illust_data.reason;
            return null;
        }

        this.media_info[media_id] = illust_data.illust;
        this.call_illust_modified_callbacks(media_id);
        return illust_data.illust;
    }

    // Return true if all thumbs in media_ids have been loaded, or are currently loading.
    //
    // We won't start fetching IDs that aren't loaded.
    are_all_media_ids_loaded_or_loading(media_ids)
    {
        for(let media_id of media_ids)
        {
            if(!this.is_media_id_loaded_or_loading(media_id))
                return false;
        }
        return true;
    }

    is_media_id_loaded_or_loading(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        return this.media_info[media_id] != null || this.media_info_loads_full[media_id] || this.media_info_loads_partial[media_id];
    }
        
    // Save data to extra_image_data, and update cached data.  Returns the updated extra data.
    async save_extra_image_data(media_id, edits)
    {
        let [illust_id] = helpers.media_id_to_illust_id_and_page(media_id);

        // Load the current data from the database, in case our cache is out of date.
        let results = await extra_image_data.get.load_illust_data([media_id]);
        let data = results[media_id] ?? { illust_id: illust_id };

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

        // Save the new data.  If the only fields left are illust_id and edited_at, delete the record.
        if(Object.keys(data).length == 2)
            await extra_image_data.get.delete_illust(media_id);
        else
            await extra_image_data.get.save_illust(media_id, data);

        this.replace_extra_data(media_id, data);

        return data;
    }

    // Refresh extra_data in a loaded image.  This does nothing if media_id isn't loaded.
    replace_extra_data(media_id, data)
    {
        let illust_data = this.get_media_info_sync(media_id, { full: false });
        if(illust_data == null)
            return;

        illust_data.extraData[media_id] = data;
        this.call_illust_modified_callbacks(media_id);
    }

    // Update cached illust info.
    //
    // keys can contain any or all illust info keys.  We'll only update the keys
    // that are present.  For example,
    //
    // update_media_info(media_id, { likeCount: 10 });
    //
    // will update likeCount on the image.
    //
    // 
    // If we only have partial info, we'll only update keys for partial info.  We won't
    // add full info to media info if we don't have it to begin with, so we don't end up
    // with inconsistent fields.
    update_media_info(media_id, keys)
    {
        media_id = helpers.get_media_id_first_page(media_id);

        let image_data = this.media_info[media_id];
        if(image_data == null)
            return;

        for(let [key, value] of Object.entries(keys))
        {
            // If we only have partial info, ignore data that shouldn't be included in
            // partial info.
            if(!image_data.full && partial_media_info_keys.indexOf(key) == -1)
            {
                console.log("Not updating key for partial media info:", key);
                continue;
            }

            image_data[key] = value;
        }

        this.call_illust_modified_callbacks(media_id);
    }

    // Get the user's profile picture URL, or a fallback if we haven't seen it.
    get_profile_picture_url(user_id)
    {
        let result = this.user_profile_urls[user_id];
        if(!result)
            result = "https://s.pximg.net/common/images/no_profile.png";
        return result;
    }

    // Helpers

    // Check keys for partial media info.  We always expect all keys in partial_media_info_keys
    // to be included, regardless of where the data came from.
    _check_illust_data(media_info)
    {
        if(media_info == null)
            return;

        if(media_info.full)
            return;

        for(let key of partial_media_info_keys)
        {
            if(!(key in media_info))
                console.warn(`Missing key ${key} in partial data`, media_info);
        }

        for(let key of Object.keys(media_info))
        {
            if(partial_media_info_keys.indexOf(key) == -1)
                console.warn(`Unexpected key ${key} in partial data`, media_info);
        }
    }

    // Return the extra info for an image, given its image info.
    //
    // For local images, the extra info is simply stored on image_data.  This doesn't need
    // to be used if you know you're working with a local image.
    //
    // For Pixiv images, extra info is stored in image_data.extraData, with page media IDs
    // as keys.
    get_extra_data(image_data, media_id, page=null)
    {
        if(image_data == null)
            return { };

        if(helpers.is_media_id_local(media_id))
            return image_data;

        // If page is null, media_id is already this page's ID.
        if(page != null)
            media_id = helpers.get_media_id_for_page(media_id, page);
        
        return image_data.extraData[media_id] ?? {};
    }

    // Get the width and height of media_id from image_data.
    //
    // This handles the inconsistency with page info: if we have partial image info, we only
    // know the dimensions for the first page.  For page 1, we can always get the dimensions,
    // even from partial info.  For other pages, we have to get the dimensions from mangaPages.
    // If we only have partial info, the other page dimensions aren't known and we'll return
    // null.
    get_dimensions(image_data, media_id=null, page=null)
    {
        if(image_data == null)
            return { width: 1, height: 1 };

        let page_info = image_data;
        if(!helpers.is_media_id_local(image_data.mediaId))
        {
            if(page == null)
            {
                // For Pixiv images, at least one of media_id or page must be specified so we
                // know what page we want.
                if(media_id == null)
                    throw new Error("At least one of media_id or page must be specified");
                page = helpers.media_id_to_illust_id_and_page(media_id)[1];
            }

            if(page > 0)
            {
                // If this is partial info, we don't know the dimensions of pages past the first.
                if(image_data.mangaPages == null)
                    return { };

                page_info = image_data.mangaPages[page];
            }
        }

        return { width: page_info.width, height: page_info.height };
    }
}
