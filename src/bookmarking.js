class bookmarking
{
    static get singleton()
    {
        if(bookmarking._singleton == null)
            bookmarking._singleton = new bookmarking();
        return bookmarking._singleton;
    };

    constructor()
    {
        this.update_callbacks = [];
    }
    
    // Bookmark an image.
    //
    // If private_bookmark is true, bookmark privately.
    // tag_list is an array of bookmark tags.
    bookmark_add(illust_id, private_bookmark, tag_list)
    {
        helpers.post_request("/ajax/illusts/bookmarks/add", {
            "illust_id": illust_id,
            "tags": tag_list,
            "comment": "",
            "restrict": private_bookmark? 1:0,
        }, function(result) {
            if(result == null || result.error)
                return;

            // last_bookmark_id seems to be the ID of the new bookmark.  We need to store this correctly
            // so the unbookmark button works.
            console.log("New bookmark id:", result.body.last_bookmark_id, illust_id);

            // If this image's info is loaded, update its bookmark info.
            var illust_data = image_data.singleton().get_image_info_sync(illust_id);
            if(illust_data != null)
            {
                illust_data.bookmarkData = {
                    "id": result.body.last_bookmark_id,
                    "private": private_bookmark,
                }

                illust_data.bookmarkCount++;
            }

            // If this image's thumbnail info is loaded, update that too.
            var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
            if(thumbnail_info != null)
            {
                thumbnail_info.bookmarkData = {
                    "id": result.body.last_bookmark_id,
                    "private": private_bookmark,
                }
            }
            
            message_widget.singleton.show(private_bookmark? "Bookmarked privately":"Bookmarked");

            this.call_bookmark_listeners(illust_id);
        }.bind(this));
    }

    bookmark_remove(illust_id, bookmark_id)
    {
        console.log("Remove bookmark", bookmark_id);
        
        helpers.rpc_post_request("/rpc/index.php", {
            mode: "delete_illust_bookmark",
            bookmark_id: bookmark_id,
        }, function(result) {
            if(result == null || result.error)
                return;

            console.log("Removing bookmark finished");

            var illust_data = image_data.singleton().get_image_info_sync(illust_id);
            if(illust_data != null)
            {
                illust_data.bookmarkData = false;
                illust_data.bookmarkCount--;
            }

            var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
            if(thumbnail_info != null)
                thumbnail_info.bookmarkData = null;
             
            message_widget.singleton.show("Bookmark removed");

            this.call_bookmark_listeners(illust_id);
        }.bind(this));
    }

    // Add a callback to be called when a bookmark is added or removed.
    add_bookmark_listener(callback)
    {
        this.update_callbacks.push(callback);
    }

    // Unregister a callback.
    remove_bookmark_listener(callback)
    {
        var idx = this.update_callbacks.indexOf(callback);
        if(idx != -1)
            this.update_callbacks.splice(idx);
    }

    call_bookmark_listeners(illust_id)
    {
        var callbacks = this.update_callbacks.slice();
        for(var callback of callbacks)
        {
            try {
                callback(illust_id);
            } catch(e) {
                console.error(e);
            }
        }
    }
};
