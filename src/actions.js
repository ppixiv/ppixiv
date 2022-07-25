"use strict";

// Global actions.
ppixiv.actions = class
{
    // Set a bookmark.  Any existing bookmark will be overwritten.
    static async _bookmark_add_internal(media_id, options)
    {
        let illust_id = helpers.media_id_to_illust_id_and_page(media_id)[0];
        let illust_info = await media_cache.get_media_info(media_id, { full: false });
        
        if(options == null)
            options = {};

        console.log("Add bookmark:", options);

        // If auto-like is enabled, like an image when we bookmark it.
        if(!options.disable_auto_like)
        {
            console.log("Automatically liking image with bookmark");
            actions.like_image(media_id, true /* quiet */);
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
        media_cache.update_media_info(media_id, {
            bookmarkData: {
                id: new_bookmark_id,
                private: !!request.restrict,
            },
        });

        // Broadcast that this illust was bookmarked.  This is for my own external
        // helper scripts.
        let e = new Event("bookmarked");
        e.illust_id = illust_id;
        window.dispatchEvent(e);

        // Even if we weren't given tags, we still know that they're unset, so set tags so
        // we won't need to request bookmark details later.
        extra_cache.singleton().update_cached_bookmark_image_tags(media_id, request.tags);
        console.log("Updated bookmark data:", media_id, new_bookmark_id, request.restrict, request.tags);

        if(!was_bookmarked)
        {
            // If we have full illust data loaded, increase its bookmark count locally.
            let full_illust_info = media_cache.get_media_info_sync(media_id);
            if(full_illust_info)
                full_illust_info.bookmarkCount++;
        }

        message_widget.singleton.show(
                was_bookmarked? "Bookmark edited":
                options.private? "Bookmarked privately":"Bookmarked");

        media_cache.call_illust_modified_callbacks(media_id);
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
    static async bookmark_add(media_id, options)
    {
        if(helpers.is_media_id_local(media_id))
            return await local_api.bookmark_add(media_id, options);

        if(options == null)
            options = {};

        // If bookmark_privately_by_default is enabled and private wasn't specified
        // explicitly, set it to true.
        if(options.private == null && settings.get("bookmark_privately_by_default"))
            options.private = true;

        let illust_info = await media_cache.get_media_info(media_id, { full: false });

        console.log("Add bookmark for", media_id, "options:", options);

        // This is a mess, since Pixiv's APIs are all over the place.
        //
        // If the image isn't already bookmarked, just use bookmark_add.
        if(illust_info.bookmarkData == null)
        {
            console.log("Initial bookmark");
            if(options.tags != null)
                helpers.update_recent_bookmark_tags(options.tags);
        
            return await actions._bookmark_add_internal(media_id, options);
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
            return await actions.bookmark_set_private(media_id, options.private);
        }

        // If we're modifying tags, we need bookmark details loaded, so we can preserve
        // the current privacy status.  This will insert the info into illust_info.bookmarkData.
        let bookmark_tags = await extra_cache.singleton().load_bookmark_details(media_id);

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
        
        return await actions._bookmark_add_internal(media_id, bookmark_params);
    }

    static async bookmark_remove(media_id)
    {
        if(helpers.is_media_id_local(media_id))
            return await local_api.bookmark_remove(media_id);

        let illust_info = await media_cache.get_media_info(media_id, { full: false });
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

        media_cache.update_media_info(media_id, {
            bookmarkData: null
        });

        // If we have full image data loaded, update the like count locally.
        let illust_data = media_cache.get_media_info_sync(media_id);
        if(illust_data)
        {
            illust_data.bookmarkCount--;
            media_cache.call_illust_modified_callbacks(media_id);
        }
        
        extra_cache.singleton().update_cached_bookmark_image_tags(media_id, null);

        message_widget.singleton.show("Bookmark removed");

        media_cache.call_illust_modified_callbacks(media_id);
    }

    // Change an existing bookmark to public or private.
    static async bookmark_set_private(media_id, private_bookmark)
    {
        if(helpers.is_media_id_local(media_id))
            return;

        let illust_info = await media_cache.get_media_info(media_id, { full: false });
        if(!illust_info.bookmarkData)
        {
            console.log(`Illust ${media_id} wasn't bookmarked`);
            return;
        }

        let bookmark_id = illust_info.bookmarkData.id;
        
        let result = await helpers.post_request("/ajax/illusts/bookmarks/edit_restrict", {
            bookmarkIds: [bookmark_id],
            bookmarkRestrict: private_bookmark? "private":"public",
        });

        // Update bookmark info.
        media_cache.update_media_info(media_id, {
            bookmarkData: {
                id: bookmark_id,
                private: private_bookmark,
            },
        });
        
        message_widget.singleton.show(private_bookmark? "Bookmarked privately":"Bookmarked");

        media_cache.call_illust_modified_callbacks(media_id);
    }

    // Show a prompt to enter tags, so the user can add tags that aren't already in the
    // list.  Add the bookmarks to recents, and bookmark the image with the entered tags.
    static async add_new_tag(media_id)
    {
        console.log("Show tag prompt");

        // Hide the popup when we show the prompt.
        this.hide_temporarily = true;

        let prompt = new text_prompt({ title: "New tag:" });
        let tags = await prompt.result;
        if(tags == null)
            return; // cancelled

        // Split the new tags.
        tags = tags.split(" ");
        tags = tags.filter((value) => { return value != ""; });

        // This should already be loaded, since the only way to open this prompt is
        // in the tag dropdown.
        let bookmark_tags = await extra_cache.singleton().load_bookmark_details(media_id);

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
        if(helpers.is_media_id_local(media_id))
            await local_api.bookmark_add(media_id, { tags: active_tags });
        else
            await actions.bookmark_add(media_id, { tags: active_tags, });
    }
    
    // If quiet is true, don't print any messages.
    static async like_image(media_id, quiet)
    {
        if(helpers.is_media_id_local(media_id))
            return;

        let illust_id = helpers.media_id_to_illust_id_and_page(media_id)[0];

        console.log("Clicked like on", media_id);
        
        if(extra_cache.singleton().get_liked_recently(media_id))
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
        extra_cache.singleton().add_liked_recently(media_id);

        // If we have illust data, increase the like count locally.  Don't load it
        // if it's not loaded already.
        let illust_data = media_cache.get_media_info_sync(media_id);
        if(!was_already_liked && illust_data)
            illust_data.likeCount++;

        // Let widgets know that the image was liked recently, and that the like count
        // may have changed.
        media_cache.call_illust_modified_callbacks(media_id);

        if(!quiet)
        {
            if(was_already_liked)
                message_widget.singleton.show("Already liked this image");
            else
                message_widget.singleton.show("Illustration liked");
        }
    }

    // Follow user_id with the given privacy and tag list.
    //
    // The follow editing API has a bunch of quirks.  You can call bookmark_add on a user
    // you're already following, but it'll only update privacy and not tags.  Editing tags
    // is done with following_user_tag_add/following_user_tag_delete (and can only be done
    // one at a time).
    //
    // A tag can only be set with this call if the caller knows we're not already following
    // the user, eg. if the user clicks a tag in the follow dropdown for an unfollowed user.
    // If we're editing an existing follow's tag, use change_follow_tags below.  We do handle
    // changing privacy here.
    static async follow(user_id, follow_privately, { tag=null }={})
    {
        if(user_id == -1)
            return;

        // We need to do this differently depending on whether we were already following the user.
        let user_info = await user_cache.get_user_info_full(user_id);
        if(user_info.isFollowed)
        {
            // If we were already following, we're just updating privacy.  We don't update follow
            // tags for existing follows this way.
            console.assert(tag == null);
            return await actions.change_follow_privacy(user_id, follow_privately);
        }

        // This is a new follow.
        //
        // If bookmark_privately_by_default is enabled and private wasn't specified
        // explicitly, set it to true.
        if(follow_privately == null && settings.get("bookmark_privately_by_default"))
            follow_privately = true;

        // This doesn't return any data (not even an error flag).
        await helpers.rpc_post_request("/bookmark_add.php", {
            mode: "add",
            type: "user",
            user_id,
            tag: tag ?? "",
            restrict: follow_privately? 1:0,
            format: "json",
        });

        // Cache follow info for this new follow.  Since we weren't followed before, we know
        // we can just create a new entry.
        let tag_set = new Set();
        if(tag != null)
        {
            tag_set.add(tag);
            user_cache.add_to_cached_all_user_follow_tags(tag);
        }
        let info = {
            tags: tag_set,
            following_privately: follow_privately,
        };

        user_cache.update_cached_follow_info(user_id, true, info);

        var message = "Followed " + user_info.name;
        if(follow_privately)
            message += " privately";
        message_widget.singleton.show(message);
    }

    // Change the privacy status of a user we're already following.
    static async change_follow_privacy(user_id, follow_privately)
    {
        let data = await helpers.rpc_post_request("/rpc/index.php", {
            mode: "following_user_restrict_change",
            user_id: user_id,
            restrict: follow_privately? 1:0,
        });

        if(data.error)
        {
            console.log(`Error editing follow tags: ${data.message}`);
            return;
        }

        // If we had cached follow info, update it with the new privacy.
        let info = user_cache.get_user_follow_info_sync(user_id);
        if(info  != null)
        {
            console.log("Updating cached follow privacy");
            info.following_privately = follow_privately;
            user_cache.update_cached_follow_info(user_id, true, info);
        }

        let user_info = await user_cache.get_user_info(user_id);
        let message = `Now following ${user_info.name} ${follow_privately? "privately":"publically"}`;
        message_widget.singleton.show(message);
    }

    // Add or remove a follow tag for a user we're already following.  The API only allows
    // editing one tag per call.
    static async change_follow_tags(user_id, {tag, add})
    {
        let data = await helpers.rpc_post_request("/rpc/index.php", {
            mode: add? "following_user_tag_add":"following_user_tag_delete",
            user_id: user_id,
            tag,
        });

        if(data.error)
        {
            console.log(`Error editing follow tags: ${data.message}`);
            return;
        }

        let user_info = await user_cache.get_user_info(user_id);
        let message = add? `Added the tag "${tag}" to ${user_info.name}`:`Removed the tag "${tag}" from ${user_info.name}`;
        message_widget.singleton.show(message);

        // Get follow info so we can update the tag list.  This will usually already be loaded,
        // since the caller will have had to load it to show the UI in the first place.
        let follow_info = await user_cache.get_user_follow_info(user_id);
        if(follow_info == null)
        {
            console.log("Error retrieving follow info to update tags");
            return;
        }

        if(add)
        {
            follow_info.tags.add(tag);

            // Make sure the tag is in the full tag list too.
            user_cache.add_to_cached_all_user_follow_tags(tag);
        }
        else
            follow_info.tags.delete(tag);

        user_cache.update_cached_follow_info(user_id, true, follow_info);
    }

    static async unfollow(user_id)
    {
        if(user_id == -1)
            return;

        var result = await helpers.rpc_post_request("/rpc_group_setting.php", {
            mode: "del",
            type: "bookuser",
            id: user_id,
        });

        let user_data = await user_cache.get_user_info(user_id);

        // Record that we're no longer following and refresh the UI.
        user_cache.update_cached_follow_info(user_id, false);

        message_widget.singleton.show("Unfollowed " + user_data.name);
    }
    
    // Image downloading
    //
    // Download illust_data.
    static async download_illust(media_id, download_type)
    {
        let progress_bar_controller = main_controller.progress_bar.controller();
        
        let illust_data = await media_cache.get_media_info(media_id);
        let user_info = await user_cache.get_user_info(illust_data.userId);
        console.log("Download", media_id, "with type", download_type);

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
        for(let page of illust_data.mangaPages)
        {
            let url = page.urls.original;
            url = url.replace(/:\/\/i-cf.pximg.net/, "://i.pximg.net");
            images.push(url);
        }

        // If we're in image mode for a manga post, only download the requested page.
        let manga_page = helpers.parse_media_id(media_id).page;
        if(download_type == "image")
            images = [images[manga_page]];

        let results = await helpers.download_urls(images);

        // If there's just one image, save it directly.
        if(images.length == 1)
        {
            var url = images[0];
            var buf = results[0];
            var blob = new Blob([results[0]]);
            var ext = helpers.get_extension(url);
            let filename = user_info.name + " - " + illust_data.illustId;

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
        var filename = user_info.name + " - " + illust_data.illustId + " - " + illust_data.illustTitle + ".zip";
        helpers.save_blob(zip, filename);
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
            return illust_data.illustType == 2;

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
        if(ppixiv.native)
            return await local_api.load_recent_bookmark_tags();

        let url = "/ajax/user/" + window.global_data.user_id + "/illusts/bookmark/tags";
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

    // Mute a user or tag using the Pixiv mute list.  type must be "tag" or "user".
    static async add_pixiv_mute(value, {type})
    {
        console.log(`Adding ${value} to the Pixiv ${type} mute list`);

        if(!muting.singleton.can_add_pixiv_mutes)
        {
            message_widget.singleton.show("The Pixiv mute list is full.");
            return;
        }

        // Stop if the value is already in the list.
        let mute_list = type == "tag"? "pixiv_muted_tags":"pixiv_muted_user_ids";
        let mutes = muting.singleton[mute_list];
        if(mutes.indexOf(value) != -1)
            return;

        // Get the label.  If this is a tag, the label is the same as the tag, otherwise
        // get the user's username.  We only need this for the message we'll display at the
        // end.
        let label = value;
        if(type == "user")
            label = (await user_cache.get_user_info(value)).name;

        // Note that this doesn't return an error if the mute list is full.  It returns success
        // and silently does nothing.
        let result = await helpers.rpc_post_request("/ajax/mute/items/add", {
            context: "illust",
            type: type,
            value: value,
        });

        if(result.error)
        {
            message_widget.singleton.show(result.message);
            return;
        }

        // The API call doesn't return the updated list, so we have to update it manually.
        mutes.push(value);

        // Pixiv sorts the muted tag list, so mute it here to match.
        if(type == "tag")
            mutes.sort();

        muting.singleton[mute_list] = mutes;

        message_widget.singleton.show(`Muted the ${type} ${label}`);
    }

    // Remove item from the Pixiv mute list.  type must be "tag" or "user".
    static async remove_pixiv_mute(value, {type})
    {
        console.log(`Removing ${value} from the Pixiv muted ${type} list`);

        // Get the label.  If this is a tag, the label is the same as the tag, otherwise
        // get the user's username.  We only need this for the message we'll display at the
        // end.
        let label = value;
        if(type == "user")
            label = (await user_cache.get_user_info(value)).name;

        let result = await helpers.rpc_post_request("/ajax/mute/items/delete", {
            context: "illust",
            type: type,
            value: value,
        });

        if(result.error)
        {
            message_widget.singleton.show(result.message);
            return;
        }

        // The API call doesn't return the updated list, so we have to update it manually.
        let mute_list = type == "tag"? "pixiv_muted_tags":"pixiv_muted_user_ids";
        let mutes = muting.singleton[mute_list];
        let idx = mutes.indexOf(value);
        if(idx != -1)
            mutes.splice(idx, 1);
        muting.singleton[mute_list] = mutes;
        message_widget.singleton.show(`Unmuted the ${type} ${label}`);
    }

    // value is a tag name or user ID.  label is the tag or username.  type must be
    // "tag" or "user".
    static async add_extra_mute(value, label, {type})
    {
        console.log(`Adding ${value} (${label}) to the extra muted ${type} list`);

        // Stop if the item is already in the list.
        let mutes = muting.singleton.extra_mutes;
        for(let {value: muted_value, type: muted_type} of mutes)
            if(value == muted_value && type == muted_type)
            {
                console.log("Item is already muted");
                return;
            }
        
        mutes.push({
            type: type,
            value: value,
            label: label,
        });
        mutes.sort((lhs, rhs) => { return lhs.label.localeCompare(rhs.label); });
        muting.singleton.extra_mutes = mutes;
        message_widget.singleton.show(`Muted the ${type} ${label}`);
    }

    static async remove_extra_mute(value, {type})
    {
        console.log(`Removing ${value} from the extra muted ${type} list`);

        let mutes = muting.singleton.extra_mutes;

        for(let idx = 0; idx < mutes.length; ++idx)
        {
            let mute = mutes[idx];
            if(mute.type == type && mute.value == value)
            {
                message_widget.singleton.show(`Unmuted the ${mute.type} ${mute.label}`);
                mutes.splice(idx, 1);
                break;
            }
        }

        muting.singleton.extra_mutes = mutes;
    }

    // If the user has premium, add to Pixiv mutes.  Otherwise, add to extra mutes.
    static async add_mute(value, label, {type})
    {
        if(window.global_data.premium)
        {
            await actions.add_pixiv_mute(value, {type: type});
        }
        else
        {
            if(type == "user" && label == null)
            {
                // We need to know the user's username to add to our local mute list.
                let user_data = await user_cache.get_user_info(value);
                label = user_data.name;
            }
            
            await actions.add_extra_mute(value, label, {type: type});
        }
    }
}
