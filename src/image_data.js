"use strict";

// This handles fetching and caching image data.
ppixiv.image_data = class extends EventTarget
{
    constructor()
    {
        super();
        
        this.illust_modified_callbacks = new callback_list();

        // Cached data:
        this.image_data = { };

        // Negative cache to remember illusts that don't exist, so we don't try to
        // load them repeatedly:
        this.nonexistant_media_ids = { };

        // Promises for ongoing requests:
        this.illust_loads = {};
    };

    // Return the singleton, creating it if needed.
    static singleton()
    {
        if(image_data._singleton == null)
            image_data._singleton = new image_data();
        return image_data._singleton;
    };

    call_illust_modified_callbacks(media_id)
    {
        this.illust_modified_callbacks.call(media_id);

        let event = new Event("mediamodified");
        event.media_id = media_id;
        this.dispatchEvent(event);
    }

    // Get media data asynchronously.
    //
    // await get_media_info(12345);
    //
    // If illust_id is a video, we'll also download the metadata before returning it, and store
    // it as image_data.ugoiraMetadata.
    get_media_info(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        if(media_id == null)
            return null;

        // Stop if we know this illust doesn't exist.
        if(media_id in this.nonexistant_media_ids)
            return null;

        // If we already have the image data, just return it.
        if(this.image_data[media_id] != null)
            return Promise.resolve(this.image_data[media_id]);

        // If there's already a load in progress, return the running promise.
        if(this.illust_loads[media_id] != null)
            return this.illust_loads[media_id];
        
        let load_promise = this._load_media_info(media_id);
        this._started_loading_image_data(media_id, load_promise);
        return load_promise;
    }

    // Add image data to the cache that we received from other sources.  Note that if
    // we have any fetches in the air already, we'll leave them running.  This will
    // trigger loads for secondary data like manga pages if it's not included in illust_data.
    //
    // If preprocessed is true, this data is coming from something like another ppixiv tab,
    // and we can just store the data.  It already has any required data and adjustments that
    // happen when we load data normally.  If preprocessed is false, illust_data is from
    // something like the HTML preload field and is treated the same as an API response.
    add_illust_data(illust_data, { preprocessed=false }={})
    {
        if(preprocessed)
        {
            // Just store the data directly.
            let media_id = illust_data.mediaId;
            this.image_data[media_id] = illust_data;
            this.call_illust_modified_callbacks(media_id);
            return Promise.resolve(illust_data);
        }
        else
        {
            // This illust_data is from the API and hasn't been adjusted yet, so illust_data.illustId
            // and illust_data.mediaId don't exist yet.
            let media_id = helpers.illust_id_to_media_id(illust_data.id);
            let load_promise = this._load_media_info(media_id, { illust_data, force: true });
            this._started_loading_image_data(media_id, load_promise);
            return load_promise;
        }
    }

    _started_loading_image_data(media_id, load_promise)
    {
        this.illust_loads[media_id] = load_promise;
        this.illust_loads[media_id].then(() => {
            if(this.illust_loads[media_id] === load_promise)
                delete this.illust_loads[media_id];
        });
    }
    
    // Like get_media_info, but return the result immediately.
    //
    // If the image info isn't loaded, don't start a request and just return null.
    get_media_info_sync(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        return this.image_data[media_id];
    }
    
    // Load media_id and all data that it depends on.
    //
    // If we already have the image data (not necessarily the rest, like ugoira_metadata),
    // it can be supplied with illust_data.
    async _load_media_info(media_id, { illust_data=null, force=false }={})
    {
        media_id = helpers.get_media_id_first_page(media_id);
        let [illust_id] = helpers.media_id_to_illust_id_and_page(media_id);

        // See if we already have data for this image.  If we do, stop.  We always load
        // everything we need if we load anything at all.
        if(!force && this.image_data[media_id] != null)
            return;

        media_id = helpers.get_media_id_first_page(media_id);
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

        // If we have thumbnail info, we can start loading other metadata immediately instead
        // of waiting for the illust info to load.
        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(thumbnail_info != null)
            start_loading(thumbnail_info.illustType, thumbnail_info.pageCount);
    
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

        // The image data has both "id" and "illustId" containing the image ID.  Remove id to
        // make sure we only use illustId, and set mediaId.  This makes it clear what type of
        // ID you're getting.
        illust_data.mediaId = media_id;
        delete illust_data.id;

        guess_image_url.get.add_info(illust_data);

        // Store the image data.
        this.image_data[media_id] = illust_data;
        this.call_illust_modified_callbacks(media_id);
        return illust_data;
    }

    // If get_image_info returned null, return the error message.
    get_illust_load_error(media_id)
    {
        media_id = helpers.get_media_id_first_page(media_id);
        return this.nonexistant_media_ids[media_id];
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

        this.image_data[media_id] = illust_data.illust;
        this.call_illust_modified_callbacks(media_id);
        return illust_data.illust;
    }

    // Refresh image data and thumbnail info for the given media ID.
    //
    // Only data which is already loaded will be refreshed, so refreshing a search result
    // where we haven't yet had any reason to load full image data will only refresh thumbnail
    // data.
    async refresh_media_info(media_id)
    {
        let promises = [];
        media_id = helpers.get_media_id_first_page(media_id);
        if(this.image_data[media_id] != null)
            promises.push(this._load_media_info(media_id, { force: true }));

        if(!helpers.is_media_id_local(media_id) && thumbnail_data.singleton().get_one_thumbnail_info(media_id) != null)
            promises.push(thumbnail_data.singleton().load_thumbnail_info([media_id], { force: true }));

        await Promise.all(promises);
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

        // If the image is loaded in image_data, update illust_data.extraData.
        let illust_data = this.get_media_info_sync(media_id);
        if(illust_data != null)
            illust_data.extraData[media_id] = data;

        // If the image is loaded in thumbnail_data, update illust_data.extraData.
        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(thumbnail_info)
            thumbnail_info.extraData[media_id] = data;

        this.call_illust_modified_callbacks(media_id);

        return data;
    }

    // Refresh extra_data in a loaded image.  This does nothing if media_id isn't loaded.
    replace_extra_data(media_id, data)
    {
        let illust_data = this.get_media_info_sync(media_id);
        if(illust_data != null)
            illust_data.extraData[media_id] = data;

        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(thumbnail_info)
            thumbnail_info.extraData[media_id] = data;

        this.call_illust_modified_callbacks(media_id);
    }

    // Update cached illust info.
    //
    // illust_info can contain any or all illust info keys.  We'll only update the keys
    // that are present.  For example,
    //
    // update_media_info(media_id, { likeCount: 10 });
    //
    // will update likeCount on the image.
    //
    // This updates both thumbnail info and illust info.  if illust_info isn't already loaded,
    // we won't load it here.  Only illusts that are already loaded will be updated 
    update_media_info(media_id, keys)
    {
        media_id = helpers.get_media_id_first_page(media_id);

        let image_data = this.image_data[media_id];
        if(image_data != null)
        {
            for(let [key, value] of Object.entries(keys))
                image_data[key] = value;
        }

        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(thumbnail_info)
        {
            for(let [key, value] of Object.entries(keys))
            {
                // Ignore data that isn't included in thumbnail info.
                if(thumbnail_data.singleton().partial_media_info_keys.indexOf(key) == -1)
                    continue;

                thumbnail_info[key] = value;
            }
        }

        this.call_illust_modified_callbacks(media_id);
    }

    // Helpers

    // Return the extra info for an image, given its image info.
    //
    // For local images, the extra info is simply stored on image_data.  This doesn't need
    // to be used if you know you're working with a local image.
    //
    // For Pixiv images, extra info is stored in image_data.extraData, with page media IDs
    // as keys.
    static get_extra_data(image_data, media_id, page=null)
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
    // If this is a local image, or this is the first page, the width and height are on
    // image_data.  If this isn't the first page of a manga post, get the dimensions from
    // mangaPages.  If this is the first page, get it directly from image_data, so this
    // can accept thumbnail data too.
    static get_dimensions(image_data, media_id=null, page=null)
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
                // If mangaPages isn't present then this is thumbnail data, and we don't know
                // the dimensions of images past the first page.
                if(image_data.mangaPages == null)
                    return { };

                page_info = image_data.mangaPages[page];
            }
        }

        return { width: page_info.width, height: page_info.height };
    }
}

