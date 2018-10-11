// Global actions.
class actions
{
    // Set a bookmark.  Any existing bookmark will be overwritten.
    static async _bookmark_add_internal(illust_info, options)
    {
        if(options == null)
            options = {};

        console.log("Add bookmark:", options);

        // If auto-like is enabled, like an image when we bookmark it.
        if(!options.disable_auto_like && helpers.get_value("auto-like"))
        {
            console.log("Automatically liking image as well as bookmarking it due to auto-like preference");
            actions.like_image(illust_info, true /* quiet */);
        }
         
        // Remember whether this is a new bookmark or an edit.
        var was_bookmarked = illust_info.bookmarkData != null;

        var illust_id = illust_info.illustId;

        var request = {
            "illust_id": illust_id,
            "tags": options.tags || [],
            "comment": options.comment || "",
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

        // last_bookmark_id seems to be the ID of the new bookmark.  We need to store this correctly
        // so the unbookmark button works.
        //
        // Update bookmark info in image data.
        //
        // Even if we weren't given tags or a comment, we still know that they're unset,
        // so set comment and tags so we won't need to request bookmark details later.
        illust_info.bookmarkData = {
            id: new_bookmark_id,
            private: !!request.restrict,
            comment: request.comment,
            tags: request.tags,
        }
        console.log("Updated bookmark data:", illust_info.bookmarkData);

        if(!was_bookmarked)
            illust_info.bookmarkCount++;

        // If this image's thumbnail info is loaded, update that too.
        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        if(thumbnail_info != null)
        {
            thumbnail_info.bookmarkData = {
                id: result.body.last_bookmark_id,
                private: !!request.restrict,
            }
        }
        
        message_widget.singleton.show(
                was_bookmarked? "Bookmark edited":
                options.private? "Bookmarked privately":"Bookmarked");

        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }

    static bookmark_edit(illust_info, options)
    {
        return actions.bookmark_add(illust_info, options);
    }

    // Create or edit a bookmark.
    //
    // Create or edit a bookmark.  options can contain any of the fields tags, comment
    // or private.  Fields that aren't specified will be left unchanged on an existing
    // bookmark.
    //
    // This is a headache.  Pixiv only has APIs to create a new bookmark (overwriting all
    // existing data), except for public/private which can be changed in-place, and we need
    // to do an extra request to retrieve the tag list and comment if we need them.  We
    // try to avoid making the extra bookmark details request if possible.
    static async bookmark_add(illust_info, options)
    {
        if(options == null)
            options = {};

        console.log("Edit bookmark options:", options);

        // This is a mess, since Pixiv's APIs are all over the place.
        //
        // If the image isn't bookmarked, just use bookmark_add.
        if(illust_info.bookmarkData == null)
        {
            console.log("Initial bookmark");
            if(options.tags != null)
                helpers.update_recent_bookmark_tags(options.tags);
        
            return await actions._bookmark_add_internal(illust_info, options);
        }
        
        // Special case: If we're not setting anything, then we just want this image to
        // be bookmarked.  Since it is, just stop.
        if(options.tags == null && options.comment == null && options.private == null)
        {
            console.log("Already bookmarked");
            return;
        }

        // Special case: If all we're changing is the private flag, use bookmark_set_private
        // so we don't fetch bookmark details.
        if(options.tags == null && options.comment == null && options.private != null)
        {
            // If the image is already bookmarked, use bookmark_set_private to edit the
            // existing bookmark.  This won't auto-like.
            console.log("Only editing private field", options.private);
            return await actions.bookmark_set_private(illust_info, options.private);
        }

        // If we're modifying tags or comments, we need bookmark details loaded.
        // This will insert the info into illust_info.bookmarkData.  We could skip
        // this if we're setting both tags and comments, but we don't currently do
        // that.
        await image_data.singleton().load_bookmark_details(illust_info);

        var bookmark_params = {
            // Don't auto-like if we're editing an existing bookmark.
            disable_auto_like: true,
        };

        // Copy any of these keys that are in options to our bookmark_add arguments.
        // Copy any fields that aren't being set from the current value.
        for(var key of ["private", "comment", "tags"])
        {
            var value = options[key];
            if(value == null)
                value = illust_info.bookmarkData[key];

            bookmark_params[key] = value;
        }

        // Only update recent tags if we're modifying tags.
        if(options.tags != null)
            helpers.update_recent_bookmark_tags(options.tags);
        
        return await actions._bookmark_add_internal(illust_info, bookmark_params);
    }

    static async bookmark_remove(illust_info)
    {
        if(illust_info.bookmarkData == null)
        {
            console.log("Not bookmarked");
            return;
        }

        var illust_id = illust_info.illustId;
        var bookmark_id = illust_info.bookmarkData.id;
        
        console.log("Remove bookmark", bookmark_id, illust_info);
        
        var result = await helpers.rpc_post_request("/rpc/index.php", {
            mode: "delete_illust_bookmark",
            bookmark_id: bookmark_id,
        });

        console.log("Removing bookmark finished");

        illust_info.bookmarkData = null;
        illust_info.bookmarkCount--;

        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        if(thumbnail_info != null)
            thumbnail_info.bookmarkData = null;
         
        message_widget.singleton.show("Bookmark removed");

        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }

    // Change an existing bookmark to public or private.
    static async bookmark_set_private(illust_info, private_bookmark)
    {
        var illust_id = illust_info.illustId;
        var bookmark_id = illust_info.bookmarkData.id;
        
        // We're mimicing a form submission here, since there doesn't seem to be any
        // API call for it.
        var params = new URLSearchParams();
        params.set("book_id[]", bookmark_id);
        params.set("type", "");
        params.set("untagged", 0);

        // "rest" is actually the bookmark page the user is viewing, not the new state.
        // We just mimic the value in the form (it probably only affects the redirect that
        // we don't use).
        params.set("rest", private_bookmark? "show":"hide");
        if(private_bookmark)
            params.set("hide", "Private");
        else
            params.set("show", "Public");
        params.set("tag", "");
        params.set("p", "1");
        params.set("order", "");
        params.set("add_tag", "");
        params.toString();

        // This returns an HTML page that we don't care about.
        var result = await helpers.post_form_request("/bookmark_setting.php", params);

        // If this image's info is loaded, update its bookmark info.  Leave fields other
        // than private_bookmark alone.
        if(illust_info.bookmarkData != null)
            illust_info.bookmarkData.private = private_bookmark;

        // If this image's thumbnail info is loaded, update that too.
        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        if(thumbnail_info != null)
            thumbnail_info.bookmarkData.private = private_bookmark;
        
        message_widget.singleton.show(private_bookmark? "Bookmarked privately":"Bookmarked");

        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }

    // If quiet is true, don't print any messages.
    static async like_image(illust_data, quiet)
    {
        var illust_id = illust_data.illustId;
        console.log("Clicked like on", illust_id);
        if(illust_data.likeData)
        {
            if(!quiet)
                message_widget.singleton.show("Already liked this image");
            return;
        }
        
        var result = await helpers.post_request("/ajax/illusts/like", {
            "illust_id": illust_id,
        });

        // Update the image data.
        illust_data.likeData = true;
        illust_data.likeCount++;
        image_data.singleton().call_illust_modified_callbacks(illust_id);

        if(!quiet)
            message_widget.singleton.show("Illustration liked");
    }

    static async follow(user_data, follow_privately, tags)
    {
        var result = await helpers.rpc_post_request("/bookmark_add.php", {
            mode: "add",
            type: "user",
            user_id: user_data.userId,
            tag: tags,
            restrict: follow_privately? 1:0,
            format: "json",
        });

        // This doesn't return any data.  Record that we're following and refresh the UI.
        user_data.isFollowed = true;
        image_data.singleton().call_user_modified_callbacks(user_data.userId);

        var message = "Followed " + user_data.name;
        if(follow_privately)
            message += " privately";
        message_widget.singleton.show(message);
    }
   
    static async unfollow(user_data)
    {
        var result = await helpers.rpc_post_request("/rpc_group_setting.php", {
            mode: "del",
            type: "bookuser",
            id: user_data.userId,
        });

        // Record that we're no longer following and refresh the UI.
        user_data.isFollowed = false;
        image_data.singleton().call_user_modified_callbacks(user_data.userId);

        message_widget.singleton.show("Unfollowed " + user_data.name);
    }
    
    // Image downloading
    //
    // Download illust_data.
    static download_illust(illust_data, progress_bar_controller)
    {
        var download_type = actions.get_download_type_for_image(illust_data);
        if(download_type == null)
        {
            console.error("No download types are available");
            return;
        }

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

        // Download all images.
        var images = [];
        for(var page = 0; page < illust_data.pageCount; ++page)
            images.push(helpers.get_url_for_page(illust_data, page, "original"));

        var user_data = illust_data.userInfo;
        helpers.download_urls(images, function(results) {
            // If there's just one image, save it directly.
            if(images.length == 1)
            {
                var url = images[0];
                var buf = results[0];
                var blob = new Blob([results[0]]);
                var ext = helpers.get_extension(url);
                var filename = user_data.name + " - " + illust_data.illustId + " - " + illust_data.illustTitle + "." + ext;
                helpers.save_blob(blob, filename);
                return;
            }

            // There are multiple images, and since browsers are stuck in their own little world, there's
            // still no way in 2018 to save a batch of files to disk, so ZIP the images.
            console.log(results);
       
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
        // Single image downloading only works for single images.
        if(download_type == "image")
            return illust_data.illustType != 2 && illust_data.pageCount == 1;

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
}

