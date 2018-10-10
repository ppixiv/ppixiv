// Global actions.
class actions
{
    // Bookmark an image.
    //
    // If private_bookmark is true, bookmark privately.
    // tag_list is an array of bookmark tags.
    static async bookmark_add(illust_info, private_bookmark, tag_list)
    {
        // If auto-like is enabled, like an image when we bookmark it.
        if(helpers.get_value("auto-like"))
        {
            console.log("Automatically liking image as well as bookmarking it due to auto-like preference");
            actions.like_image(illust_info, true /* quiet */);
        }
         
        var illust_id = illust_info.illustId;

        if(tag_list != null)
            helpers.update_recent_bookmark_tags(tag_list);
        
        var result = await helpers.post_request("/ajax/illusts/bookmarks/add", {
            "illust_id": illust_id,
            "tags": tag_list,
            "comment": "",
            "restrict": private_bookmark? 1:0,
        });

        // last_bookmark_id seems to be the ID of the new bookmark.  We need to store this correctly
        // so the unbookmark button works.
        //
        // If this image's info is loaded, update its bookmark info.
        var illust_info = image_data.singleton().get_image_info_sync(illust_id);
        if(illust_info != null)
        {
            illust_info.bookmarkData = {
                "id": result.body.last_bookmark_id,
                "private": private_bookmark,
            }

            illust_info.bookmarkCount++;
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

        image_data.singleton().call_illust_modified_callbacks(illust_id);
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
        
        console.log("Remove bookmark", bookmark_id);
        
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

        // last_bookmark_id seems to be the ID of the new bookmark.  We need to store this correctly
        // so the unbookmark button works.
        //
        // If this image's info is loaded, update its bookmark info.
        var illust_info = image_data.singleton().get_image_info_sync(illust_id);
        if(illust_info != null)
        {
            illust_info.bookmarkData = {
                id: bookmark_id,
                private: private_bookmark,
            }
        }

        // If this image's thumbnail info is loaded, update that too.
        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        if(thumbnail_info != null)
        {
            thumbnail_info.bookmarkData = {
                id: bookmark_id,
                private: private_bookmark,
            }
        }
        
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

