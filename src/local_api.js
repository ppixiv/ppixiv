"use strict";

// Helpers for the local API.
ppixiv.local_api = class
{
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

        message_widget.singleton.show(was_bookmarked? "Bookmark edited":"Bookmarked");
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
