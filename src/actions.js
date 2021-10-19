"use strict";

// Global actions.
ppixiv.actions = class
{
    // Set a bookmark.  Any existing bookmark will be overwritten.
    static async _bookmark_add_internal(illust_id, options)
    {
        let illust_info = await image_data.singleton().get_early_illust_data(illust_id);
        
        if(options == null)
            options = {};

        console.log("Add bookmark:", options);

        // If auto-like is enabled, like an image when we bookmark it.
        if(!options.disable_auto_like)
        {
            console.log("Automatically liking image with bookmark");
            actions.like_image(illust_id, true /* quiet */);
        }
         
        // Remember whether this is a new bookmark or an edit.
        var was_bookmarked = illust_info.bookmarkData != null;

        var request = {
            "illust_id": illust_id,
            "tags": options.tags || [],
            "restrict": options.private? 1:0,
        }
        var result = await helpers.post_request("/ajax/illusts/bookmarks/add", request);

        // If this is a new bookmark, last_bookmark_id is the new bookmark ID.
        // If we're editing an existing bookmark, last_bookmark_id is null and the
        // bookmark ID doesn't change.
        var new_bookmark_id = result.body.last_bookmark_id;
        if(new_bookmark_id == null)
            new_bookmark_id = illust_info.bookmarkData? illust_info.bookmarkData.id:null;
        if(new_bookmark_id == null)
            throw "Didn't get a bookmark ID";

        // Store the ID of the new bookmark, so the unbookmark button works.
        //
        image_data.singleton().update_early_illust_data(illust_id, {
            bookmarkData: {
                id: new_bookmark_id,
                private: !!request.restrict,
            },
        });

        // Even if we weren't given tags, we still know that they're unset, so set tags so
        // we won't need to request bookmark details later.
        image_data.singleton().update_cached_bookmark_image_tags(illust_id, request.tags);
        console.log("Updated bookmark data:", illust_id, new_bookmark_id, request.restrict, request.tags);

        if(!was_bookmarked)
        {
            // If we have full illust data loaded, increase its bookmark count locally.
            let full_illust_info = image_data.singleton().get_image_info_sync(illust_id);
            if(full_illust_info)
                full_illust_info.bookmarkCount++;
        }

        message_widget.singleton.show(
                was_bookmarked? "Bookmark edited":
                options.private? "Bookmarked privately":"Bookmarked");

        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }

    // Create or edit a bookmark.
    //
    // Create or edit a bookmark.  options can contain any of the fields tags or private.
    // Fields that aren't specified will be left unchanged on an existing bookmark.
    //
    // This is a headache.  Pixiv only has APIs to create a new bookmark (overwriting all
    // existing data), except for public/private which can be changed in-place, and we need
    // to do an extra request to retrieve the tag list if we need it.  We try to avoid
    // making the extra bookmark details request if possible.
    static async bookmark_add(illust_id, options)
    {
        if(options == null)
            options = {};

        let illust_info = await image_data.singleton().get_early_illust_data(illust_id);

        console.log("Add bookmark for", illust_id, "options:", options);

        // This is a mess, since Pixiv's APIs are all over the place.
        //
        // If the image isn't already bookmarked, just use bookmark_add.
        if(illust_info.bookmarkData == null)
        {
            console.log("Initial bookmark");
            if(options.tags != null)
                helpers.update_recent_bookmark_tags(options.tags);
        
            return await actions._bookmark_add_internal(illust_id, options);
        }
        
        // Special case: If we're not setting anything, then we just want this image to
        // be bookmarked.  Since it is, just stop.
        if(options.tags == null && options.private == null)
        {
            console.log("Already bookmarked");
            return;
        }

        // Special case: If all we're changing is the private flag, use bookmark_set_private
        // so we don't fetch bookmark details.
        if(options.tags == null && options.private != null)
        {
            // If the image is already bookmarked, use bookmark_set_private to edit the
            // existing bookmark.  This won't auto-like.
            console.log("Only editing private field", options.private);
            return await actions.bookmark_set_private(illust_id, options.private);
        }

        // If we're modifying tags, we need bookmark details loaded, so we can preserve
        // the current privacy status.  This will insert the info into illust_info.bookmarkData.
        let bookmark_tags = await image_data.singleton().load_bookmark_details(illust_id);

        var bookmark_params = {
            // Don't auto-like if we're editing an existing bookmark.
            disable_auto_like: true,
        };

        if("private" in options)
            bookmark_params.private = options.private;
        else
            bookmark_params.private = illust_info.bookmarkData.private;

        if("tags" in options)
            bookmark_params.tags = options.tags;
        else
            bookmark_params.tags = bookmark_tags;

        // Only update recent tags if we're modifying tags.
        if(options.tags != null)
        {
            // Only add new tags to recent tags.  If a bookmark has tags "a b" and is being
            // changed to "a b c", only add "c" to recently-used tags, so we don't bump tags
            // that aren't changing.
            for(var tag of options.tags)
            {
                var is_new_tag = bookmark_tags.indexOf(tag) == -1;
                if(is_new_tag)
                    helpers.update_recent_bookmark_tags([tag]);
            }
        }
        
        return await actions._bookmark_add_internal(illust_id, bookmark_params);
    }

    static async bookmark_remove(illust_id)
    {
        let illust_info = await image_data.singleton().get_early_illust_data(illust_id);
        if(illust_info.bookmarkData == null)
        {
            console.log("Not bookmarked");
            return;
        }

        var bookmark_id = illust_info.bookmarkData.id;
        
        console.log("Remove bookmark", bookmark_id);
        
        var result = await helpers.post_request("/ajax/illusts/bookmarks/remove", {
            bookmarkIds: [bookmark_id],
        });

        console.log("Removing bookmark finished");

        image_data.singleton().update_early_illust_data(illust_id, {
            bookmarkData: null
        });

        // If we have full image data loaded, update the like count locally.
        let illust_data = image_data.singleton().get_image_info_sync(illust_id);
        if(illust_data)
        {
            illust_info.bookmarkCount--;
            image_data.singleton().call_illust_modified_callbacks(illust_id);
        }
        
        image_data.singleton().update_cached_bookmark_image_tags(illust_id, null);

        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        if(thumbnail_info != null)
            thumbnail_info.bookmarkData = null;
         
        message_widget.singleton.show("Bookmark removed");

        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }

    // Change an existing bookmark to public or private.
    static async bookmark_set_private(illust_id, private_bookmark)
    {
        let illust_info = await image_data.singleton().get_early_illust_data(illust_id);
        if(!illust_info.bookmarkData)
        {
            console.log(`Illust ${illust_id} wasn't bookmarked`);
            return;
        }

        let bookmark_id = illust_info.bookmarkData.id;
        
        let result = await helpers.post_request("/ajax/illusts/bookmarks/edit_restrict", {
            bookmarkIds: [bookmark_id],
            bookmarkRestrict: private_bookmark? "private":"public",
        });

        // Update bookmark info.
        image_data.singleton().update_early_illust_data(illust_id, {
            bookmarkData: {
                id: bookmark_id,
                private: private_bookmark,
            },
        });
        
        message_widget.singleton.show(private_bookmark? "Bookmarked privately":"Bookmarked");

        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }

    // Show a prompt to enter tags, so the user can add tags that aren't already in the
    // list.  Add the bookmarks to recents, and bookmark the image with the entered tags.
    static async add_new_tag(illust_id)
    {
        let illust_data = await image_data.singleton().get_image_info(illust_id);

        console.log("Show tag prompt");

        // Hide the popup when we show the prompt.
        this.hide_temporarily = true;

        var prompt = new text_prompt();
        try {
            var tags = await prompt.result;
        } catch(e) {
            // The user cancelled the prompt.
            return;
        }

        // Split the new tags.
        tags = tags.split(" ");
        tags = tags.filter((value) => { return value != ""; });
        console.log("New tags:", tags);

        // This should already be loaded, since the only way to open this prompt is
        // in the tag dropdown.
        let bookmark_tags = await image_data.singleton().load_bookmark_details(illust_data.illustId);

        // Add each tag the user entered to the tag list to update it.
        let active_tags = [...bookmark_tags];

        for(let tag of tags)
        {
            if(active_tags.indexOf(tag) != -1)
                continue;

            // Add this tag to recents.  bookmark_add will add recents too, but this makes sure
            // that we add all explicitly entered tags to recents, since bookmark_add will only
            // add tags that are new to the image.
            helpers.update_recent_bookmark_tags([tag]);
            active_tags.push(tag);
        }
        console.log("All tags:", active_tags);
        
        // Edit the bookmark.
        await actions.bookmark_add(illust_id, {
            tags: active_tags,
        });
    }
    
    // If quiet is true, don't print any messages.
    static async like_image(illust_id, quiet)
    {
        console.log("Clicked like on", illust_id);
        
        if(image_data.singleton().get_liked_recently(illust_id))
        {
            if(!quiet)
                message_widget.singleton.show("Already liked this image");
            return;
        }
        
        var result = await helpers.post_request("/ajax/illusts/like", {
            "illust_id": illust_id,
        });

        // If is_liked is true, we already liked the image, so this had no effect.
        let was_already_liked = result.body.is_liked;

        // Remember that we liked this image recently.
        image_data.singleton().add_liked_recently(illust_id);

        // If we have illust data, increase the like count locally.  Don't load it
        // if it's not loaded already.
        let illust_data = image_data.singleton().get_image_info_sync(illust_id);
        if(!was_already_liked && illust_data)
        {
            illust_data.likeCount++;
            image_data.singleton().call_illust_modified_callbacks(illust_id);
        }

        if(!quiet)
        {
            if(was_already_liked)
                message_widget.singleton.show("Already liked this image");
            else
                message_widget.singleton.show("Illustration liked");
        }
    }

    static async follow(user_id, follow_privately, tags)
    {
        var result = await helpers.rpc_post_request("/bookmark_add.php", {
            mode: "add",
            type: "user",
            user_id: user_id,
            tag: tags,
            restrict: follow_privately? 1:0,
            format: "json",
        });

        // This doesn't return any data.  Record that we're following and refresh the UI.
        let user_data = await image_data.singleton().get_user_info(user_id);
        user_data.isFollowed = true;
        image_data.singleton().call_user_modified_callbacks(user_data.userId);

        var message = "Followed " + user_data.name;
        if(follow_privately)
            message += " privately";
        message_widget.singleton.show(message);
    }
   
    static async unfollow(user_id)
    {
        var result = await helpers.rpc_post_request("/rpc_group_setting.php", {
            mode: "del",
            type: "bookuser",
            id: user_id,
        });

        // Record that we're no longer following and refresh the UI.
        let user_data = await image_data.singleton().get_user_info(user_id);
        user_data.isFollowed = false;
        image_data.singleton().call_user_modified_callbacks(user_data.userId);

        message_widget.singleton.show("Unfollowed " + user_data.name);
    }
    
    // Image downloading
    //
    // Download illust_data.
    static download_illust(illust_data, progress_bar_controller, download_type, manga_page)
    {
        console.log("Download", illust_data.illustId, "with type", download_type);

        if(download_type == "MKV")
        {
            new ugoira_downloader_mjpeg(illust_data, progress_bar_controller);
            return;
        }

        if(download_type != "image" && download_type != "ZIP")
        {
            console.error("Unknown download type " + download_type);
            return;
        }

        // If we're in ZIP mode, download all images in the post.
        //
        // Pixiv's host for images changed from i.pximg.net to i-cf.pximg.net.  This will fail currently for that
        // host, since it's not in @connect, and adding that will prompt everyone for permission.  Work around that
        // by replacing i-cf.pixiv.net with i.pixiv.net, since that host still works fine.  This only affects downloads.
        var images = [];
        for(var page of illust_data.mangaPages)
        {
            let url = page.urls.original;
            url = url.replace(/:\/\/i-cf.pximg.net/, "://i.pximg.net");
            images.push(url);
        }

        // If we're in image mode for a manga post, only download the requested page.
        if(download_type == "image")
            images = [images[manga_page]];

        var user_data = illust_data.userInfo;
        helpers.download_urls(images, function(results) {
            // If there's just one image, save it directly.
            if(images.length == 1)
            {
                var url = images[0];
                var buf = results[0];
                var blob = new Blob([results[0]]);
                var ext = helpers.get_extension(url);
                var filename = user_data.name + " - " + illust_data.illustId;

                // If this is a single page of a manga post, include the page number.
                if(download_type == "image" && illust_data.mangaPages.length > 1)
                    filename += " #" + (manga_page + 1);

                filename += " - " + illust_data.illustTitle + "." + ext;
                helpers.save_blob(blob, filename);
                return;
            }

            // There are multiple images, and since browsers are stuck in their own little world, there's
            // still no way in 2018 to save a batch of files to disk, so ZIP the images.
            var filenames = [];
            for(var i = 0; i < images.length; ++i)
            {
                var url = images[i];
                var blob = results[i];

                var ext = helpers.get_extension(url);
                var filename = i.toString().padStart(3, '0') + "." + ext;
                filenames.push(filename);
            }

            // Create the ZIP.
            var zip = new create_zip(filenames, results);
            var filename = user_data.name + " - " + illust_data.illustId + " - " + illust_data.illustTitle + ".zip";
            helpers.save_blob(zip, filename);
        });
    }

    static is_download_type_available(download_type, illust_data)
    {
        // Single image downloading works for single images and manga pages.
        if(download_type == "image")
            return illust_data.illustType != 2;

        // ZIP downloading only makes sense for image sequences.
        if(download_type == "ZIP")
            return illust_data.illustType != 2 && illust_data.pageCount > 1;

        // MJPEG only makes sense for videos.
        if(download_type == "MKV")
        {
            if(illust_data.illustType != 2)
                return false;

            // All of these seem to be JPEGs, but if any are PNG, disable MJPEG exporting.
            // We could encode to JPEG, but if there are PNGs we should probably add support
            // for APNG.
            if(illust_data.ugoiraMetadata.mime_type != "image/jpeg")
                return false;

            return true;
        }
        throw "Unknown download type " + download_type;
    };

    static get_download_type_for_image(illust_data)
    {
        var download_types = ["image", "ZIP", "MKV"];
        for(var type of download_types)
            if(actions.is_download_type_available(type, illust_data))
                return type;

        return null;
    }

    static async load_recent_bookmark_tags()
    {
        let url = "https://www.pixiv.net/ajax/user/" + window.global_data.user_id + "/illusts/bookmark/tags";
        let result = await helpers.get_request(url, {});
        let bookmark_tags = [];
        let add_tag = (tag) => {
            // Ignore "untagged".
            if(tag.tag == "未分類")
                return;

            if(bookmark_tags.indexOf(tag.tag) == -1)
                bookmark_tags.push(tag.tag);
        }

        for(let tag of result.body.public)
            add_tag(tag);

        for(let tag of result.body.private)
            add_tag(tag);
        
        return bookmark_tags;
    }
}
