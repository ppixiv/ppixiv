"use strict";

// Helpers for the local API.
ppixiv.local_api = class
{
    static get local_url()
    {
        let url = settings.get("local_api_url");
        if(url == null)
            return null;
        return new URL(url);
    }

    static async local_post_request(pathname, data={}, options={})
    {
        let url = ppixiv.local_api.local_url;
        if(url == null)
            throw Error("Local API isn't enabled");

        url.pathname = pathname;
        var result = await helpers.send_pixiv_request({
            method: "POST",
            url: url.toString(),
            responseType: "json",
            data: JSON.stringify(data),
            signal: options.signal,
        });
    
        // If the result isn't valid JSON, we'll get a null result.
        if(result == null)
            result = { error: true, message: "Invalid response" };
    
        return result;
    }   

    // Return true if the local API is enabled.
    static is_enabled()
    {
        return ppixiv.local_api.local_url != null;
    }

    // Run a search against the local API.
    //
    // The results will be registered as thumbnail info and returned.
    static async list(path="", {...options})
    {
        let result = await local_api.local_post_request(`/api/list/${path}`, {
            ...options,
        });

        if(!result.success)
        {
            console.error("Error reading directory:", result.reason);
            return null;
        }

        thumbnail_data.singleton().loaded_thumbnail_info(result.results, "internal");
        return result;
    }

    static async bookmark_add(illust_id, options)
    {
        let illust_info = await thumbnail_data.singleton().get_or_load_illust_data(illust_id);
        let bookmark_options = { };
        if(options.tags != null)
            bookmark_options.tags = options.tags;

        // Remember whether this is a new bookmark or an edit.
        let was_bookmarked = illust_info.bookmarkData != null;

        let result = await local_api.local_post_request(`/api/bookmark/add/${illust_id}`, {
            ...bookmark_options,
        });
        if(!result.success)
            return;

        // Update bookmark tags and thumbnail data.
        image_data.singleton().update_cached_bookmark_image_tags(illust_id, result.bookmark.tags);

        thumbnail_data.singleton().update_illust_data(illust_id, {
            bookmarkData: result.bookmark
        });

        let { type } = helpers.parse_id(illust_id);
        
        message_widget.singleton.show(
            was_bookmarked? "Bookmark edited":
            type == "folder"? "Bookmarked folder":"Bookmarked",
        );
        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }

    static async bookmark_remove(illust_id)
    {
        let illust_info = await thumbnail_data.singleton().get_or_load_illust_data(illust_id);
        if(illust_info.bookmarkData == null)
        {
            console.log("Not bookmarked");
            return;
        }

        let result = await local_api.local_post_request(`/api/bookmark/delete/${illust_id}`);
        if(!result.success)
            return;

        thumbnail_data.singleton().update_illust_data(illust_id, {
            bookmarkData: null
        });

        message_widget.singleton.show("Bookmark removed");

        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }
}
