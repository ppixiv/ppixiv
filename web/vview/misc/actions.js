// Global actions.
import { TextPrompt } from 'vview/widgets/prompts.js';
import LocalAPI from 'vview/misc/local-api.js';
import RecentBookmarkTags from 'vview/misc/recent-bookmark-tags.js';
import PixivUgoiraDownloader from 'vview/misc/pixiv-ugoira-downloader.js';
import CreateZIP from 'vview/misc/create-zip.js';
import { helpers } from 'vview/misc/helpers.js';

export default class Actions
{
    // Set a bookmark.  Any existing bookmark will be overwritten.
    static async _bookmarkAddInternal(media_id, options)
    {
        let illustId = helpers.media_id_to_illust_id_and_page(media_id)[0];
        let mediaInfo = await ppixiv.mediaCache.get_media_info(media_id, { full: false });
        
        if(options == null)
            options = {};

        console.log("Add bookmark:", options);

        // If auto-like is enabled, like an image when we bookmark it.
        if(!options.disableAutoLike)
        {
            console.log("Automatically liking image with bookmark");
            Actions.likeImage(media_id, true /* quiet */);
        }
         
        // Remember whether this is a new bookmark or an edit.
        let wasBookmarked = mediaInfo.bookmarkData != null;

        let request = {
            "illust_id": illustId,
            "tags": options.tags || [],
            "restrict": options.private? 1:0,
        }
        let result = await helpers.post_request("/ajax/illusts/bookmarks/add", request);

        // If this is a new bookmark, last_bookmarkId is the new bookmark ID.
        // If we're editing an existing bookmark, last_bookmarkId is null and the
        // bookmark ID doesn't change.
        let newBookmarkId = result.body.last_bookmark_id;
        if(newBookmarkId == null)
            newBookmarkId = mediaInfo.bookmarkData? mediaInfo.bookmarkData.id:null;
        if(newBookmarkId == null)
            throw "Didn't get a bookmark ID";

        // Store the ID of the new bookmark, so the unbookmark button works.
        ppixiv.mediaCache.update_media_info(media_id, {
            bookmarkData: {
                id: newBookmarkId,
                private: !!request.restrict,
            },
        });

        // Broadcast that this illust was bookmarked.  This is for my own external
        // helper scripts.
        let e = new Event("bookmarked");
        e.illustId = illustId;
        window.dispatchEvent(e);

        // Even if we weren't given tags, we still know that they're unset, so set tags so
        // we won't need to request bookmark details later.
        ppixiv.extraCache.update_cached_bookmark_image_tags(media_id, request.tags);
        console.log("Updated bookmark data:", media_id, newBookmarkId, request.restrict, request.tags);

        if(!wasBookmarked)
        {
            // If we have full illust data loaded, increase its bookmark count locally.
            let fullMediaInfo = ppixiv.mediaCache.get_media_info_sync(media_id);
            if(fullMediaInfo)
                fullMediaInfo.bookmarkCount++;
        }

        ppixiv.message.show(
                wasBookmarked? "Bookmark edited":
                options.private? "Bookmarked privately":"Bookmarked");

        ppixiv.mediaCache.call_illust_modified_callbacks(media_id);
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
    static async bookmarkAdd(media_id, options)
    {
        if(helpers.is_media_id_local(media_id))
            return await this._localBookmarkAdd(media_id, options);

        if(options == null)
            options = {};

        // If bookmark_privately_by_default is enabled and private wasn't specified
        // explicitly, set it to true.
        if(options.private == null && ppixiv.settings.get("bookmark_privately_by_default"))
            options.private = true;

        let mediaInfo = await ppixiv.mediaCache.get_media_info(media_id, { full: false });

        console.log("Add bookmark for", media_id, "options:", options);

        // This is a mess, since Pixiv's APIs are all over the place.
        //
        // If the image isn't already bookmarked, just use bookmarkAdd.
        if(mediaInfo.bookmarkData == null)
        {
            console.log("Initial bookmark");
            if(options.tags != null)
                RecentBookmarkTags.updateRecentBookmarkTags(options.tags);
        
            return await Actions._bookmarkAddInternal(media_id, options);
        }
        
        // Special case: If we're not setting anything, then we just want this image to
        // be bookmarked.  Since it is, just stop.
        if(options.tags == null && options.private == null)
        {
            console.log("Already bookmarked");
            return;
        }

        // Special case: If all we're changing is the private flag, use bookmarkSetPrivate
        // so we don't fetch bookmark details.
        if(options.tags == null && options.private != null)
        {
            // If the image is already bookmarked, use bookmarkSetPrivate to edit the
            // existing bookmark.  This won't auto-like.
            console.log("Only editing private field", options.private);
            return await Actions.bookmarkSetPrivate(media_id, options.private);
        }

        // If we're modifying tags, we need bookmark details loaded, so we can preserve
        // the current privacy status.  This will insert the info into mediaInfo.bookmarkData.
        let bookmarkTags = await ppixiv.extraCache.load_bookmark_details(media_id);

        let bookmarkParams = {
            // Don't auto-like if we're editing an existing bookmark.
            disableAutoLike: true,
        };

        if("private" in options)
            bookmarkParams.private = options.private;
        else
            bookmarkParams.private = mediaInfo.bookmarkData.private;

        if("tags" in options)
            bookmarkParams.tags = options.tags;
        else
            bookmarkParams.tags = bookmarkTags;

        // Only update recent tags if we're modifying tags.
        if(options.tags != null)
        {
            // Only add new tags to recent tags.  If a bookmark has tags "a b" and is being
            // changed to "a b c", only add "c" to recently-used tags, so we don't bump tags
            // that aren't changing.
            for(let tag of options.tags)
            {
                let is_new_tag = bookmarkTags.indexOf(tag) == -1;
                if(is_new_tag)
                    RecentBookmarkTags.updateRecentBookmarkTags([tag]);
            }
        }
        
        return await Actions._bookmarkAddInternal(media_id, bookmarkParams);
    }

    static async bookmarkRemove(media_id)
    {
        if(helpers.is_media_id_local(media_id))
            return await this._localBookmarkRemove(media_id);

        let mediaInfo = await ppixiv.mediaCache.get_media_info(media_id, { full: false });
        if(mediaInfo.bookmarkData == null)
        {
            console.log("Not bookmarked");
            return;
        }

        let bookmarkId = mediaInfo.bookmarkData.id;
        
        console.log("Remove bookmark", bookmarkId);
        
        let result = await helpers.post_request("/ajax/illusts/bookmarks/remove", {
            bookmarkIds: [bookmarkId],
        });

        console.log("Removing bookmark finished");

        ppixiv.mediaCache.update_media_info(media_id, {
            bookmarkData: null
        });

        // If we have full image data loaded, update the like count locally.
        let fullMediaInfo = ppixiv.mediaCache.get_media_info_sync(media_id);
        if(fullMediaInfo)
        {
            fullMediaInfo.bookmarkCount--;
            ppixiv.mediaCache.call_illust_modified_callbacks(media_id);
        }
        
        ppixiv.extraCache.update_cached_bookmark_image_tags(media_id, null);

        ppixiv.message.show("Bookmark removed");

        ppixiv.mediaCache.call_illust_modified_callbacks(media_id);
    }

    static async _localBookmarkAdd(media_id, options)
    {
        let mediaInfo = await ppixiv.mediaCache.get_media_info(media_id, { full: false });
        let bookmark_options = { };
        if(options.tags != null)
            bookmark_options.tags = options.tags;

        // Remember whether this is a new bookmark or an edit.
        let wasBookmarked = mediaInfo.bookmarkData != null;

        let result = await LocalAPI.local_post_request(`/api/bookmark/add/${media_id}`, {
            ...bookmark_options,
        });
        if(!result.success)
        {
            ppixiv.message.show(`Couldn't edit bookmark: ${result.reason}`);
            return;
        }

        // Update bookmark tags and thumbnail data.
        ppixiv.extraCache.update_cached_bookmark_image_tags(media_id, result.bookmark.tags);
        ppixiv.mediaCache.update_media_info(media_id, {
            bookmarkData: result.bookmark
        });

        let { type } = helpers.parse_media_id(media_id);
        
        ppixiv.message.show(
            wasBookmarked? "Bookmark edited":
            type == "folder"? "Bookmarked folder":"Bookmarked",
        );
        ppixiv.mediaCache.call_illust_modified_callbacks(media_id);
    }

    static async _localBookmarkRemove(media_id)
    {
        let mediaInfo = await ppixiv.mediaCache.get_media_info(media_id, { full: false });
        if(mediaInfo.bookmarkData == null)
        {
            console.log("Not bookmarked");
            return;
        }

        let result = await LocalAPI.local_post_request(`/api/bookmark/delete/${media_id}`);
        if(!result.success)
        {
            ppixiv.message.show(`Couldn't remove bookmark: ${result.reason}`);
            return;
        }

        ppixiv.mediaCache.update_media_info(media_id, {
            bookmarkData: null
        });

        ppixiv.message.show("Bookmark removed");

        ppixiv.mediaCache.call_illust_modified_callbacks(media_id);
    }

    // Change an existing bookmark to public or private.
    static async bookmarkSetPrivate(media_id, private_bookmark)
    {
        if(helpers.is_media_id_local(media_id))
            return;

        let mediaInfo = await ppixiv.mediaCache.get_media_info(media_id, { full: false });
        if(!mediaInfo.bookmarkData)
        {
            console.log(`Illust ${media_id} wasn't bookmarked`);
            return;
        }

        let bookmarkId = mediaInfo.bookmarkData.id;
        
        let result = await helpers.post_request("/ajax/illusts/bookmarks/edit_restrict", {
            bookmarkIds: [bookmarkId],
            bookmarkRestrict: private_bookmark? "private":"public",
        });

        // Update bookmark info.
        ppixiv.mediaCache.update_media_info(media_id, {
            bookmarkData: {
                id: bookmarkId,
                private: private_bookmark,
            },
        });
        
        ppixiv.message.show(private_bookmark? "Bookmarked privately":"Bookmarked");

        ppixiv.mediaCache.call_illust_modified_callbacks(media_id);
    }

    // Show a prompt to enter tags, so the user can add tags that aren't already in the
    // list.  Add the bookmarks to recents, and bookmark the image with the entered tags.
    static async addNewBookmarkTag(media_id)
    {
        console.log("Show tag prompt");

        // Hide the popup when we show the prompt.
        this.hide_temporarily = true;

        let prompt = new TextPrompt({ title: "New tag:" });
        let tags = await prompt.result;
        if(tags == null)
            return; // cancelled

        // Split the new tags.
        tags = tags.split(" ");
        tags = tags.filter((value) => { return value != ""; });

        // This should already be loaded, since the only way to open this prompt is
        // in the tag dropdown.
        let bookmarkTags = await ppixiv.extraCache.load_bookmark_details(media_id);

        // Add each tag the user entered to the tag list to update it.
        let active_tags = [...bookmarkTags];

        for(let tag of tags)
        {
            if(active_tags.indexOf(tag) != -1)
                continue;

            // Add this tag to recents.  bookmarkAdd will add recents too, but this makes sure
            // that we add all explicitly entered tags to recents, since bookmarkAdd will only
            // add tags that are new to the image.
            RecentBookmarkTags.updateRecentBookmarkTags([tag]);
            active_tags.push(tag);
        }
        console.log("All tags:", active_tags);
        
        // Edit the bookmark.
        if(helpers.is_media_id_local(media_id))
            await Actions._localBookmarkAdd(media_id, { tags: active_tags });
        else
            await Actions.bookmarkAdd(media_id, { tags: active_tags, });
    }
    
    // If quiet is true, don't print any messages.
    static async likeImage(media_id, quiet)
    {
        if(helpers.is_media_id_local(media_id))
            return;

        let illust_id = helpers.media_id_to_illust_id_and_page(media_id)[0];

        console.log("Clicked like on", media_id);
        
        if(ppixiv.extraCache.get_liked_recently(media_id))
        {
            if(!quiet)
                ppixiv.message.show("Already liked this image");
            return;
        }
        
        let result = await helpers.post_request("/ajax/illusts/like", {
            "illust_id": illust_id,
        });

        // If is_liked is true, we already liked the image, so this had no effect.
        let was_already_liked = result.body.is_liked;

        // Remember that we liked this image recently.
        ppixiv.extraCache.add_liked_recently(media_id);

        // If we have illust data, increase the like count locally.  Don't load it
        // if it's not loaded already.
        let mediaInfo = ppixiv.mediaCache.get_media_info_sync(media_id);
        if(!was_already_liked && mediaInfo)
            mediaInfo.likeCount++;

        // Let widgets know that the image was liked recently, and that the like count
        // may have changed.
        ppixiv.mediaCache.call_illust_modified_callbacks(media_id);

        if(!quiet)
        {
            if(was_already_liked)
                ppixiv.message.show("Already liked this image");
            else
                ppixiv.message.show("Illustration liked");
        }
    }

    // Follow user_id with the given privacy and tag list.
    //
    // The follow editing API has a bunch of quirks.  You can call bookmarkAdd on a user
    // you're already following, but it'll only update privacy and not tags.  Editing tags
    // is done with following_user_tag_add/following_user_tag_delete (and can only be done
    // one at a time).
    //
    // A tag can only be set with this call if the caller knows we're not already following
    // the user, eg. if the user clicks a tag in the follow dropdown for an unfollowed user.
    // If we're editing an existing follow's tag, use changeFollowTags below.  We do handle
    // changing privacy here.
    static async follow(user_id, followPrivately, { tag=null }={})
    {
        if(user_id == -1)
            return;

        // We need to do this differently depending on whether we were already following the user.
        let userInfo = await ppixiv.userCache.get_userInfo_full(user_id);
        if(userInfo.isFollowed)
        {
            // If we were already following, we're just updating privacy.  We don't update follow
            // tags for existing follows this way.
            console.assert(tag == null);
            return await Actions.changeFollowPrivacy(user_id, followPrivately);
        }

        // This is a new follow.
        //
        // If bookmark_privately_by_default is enabled and private wasn't specified
        // explicitly, set it to true.
        if(followPrivately == null && ppixiv.settings.get("bookmark_privately_by_default"))
            followPrivately = true;

        // This doesn't return any data (not even an error flag).
        await helpers.rpc_post_request("/bookmark_add.php", {
            mode: "add",
            type: "user",
            user_id,
            tag: tag ?? "",
            restrict: followPrivately? 1:0,
            format: "json",
        });

        // Cache follow info for this new follow.  Since we weren't followed before, we know
        // we can just create a new entry.
        let tagSet = new Set();
        if(tag != null)
        {
            tagSet.add(tag);
            ppixiv.userCache.add_to_cached_all_user_follow_tags(tag);
        }
        let info = {
            tags: tagSet,
            following_privately: followPrivately,
        };

        ppixiv.userCache.update_cached_follow_info(user_id, true, info);

        let message = "Followed " + userInfo.name;
        if(followPrivately)
            message += " privately";
        ppixiv.message.show(message);
    }

    // Change the privacy status of a user we're already following.
    static async changeFollowPrivacy(userId, followPrivately)
    {
        let data = await helpers.post_request("/ajax/following/user/restrict_change", {
            mode: "following_user_restrict_change",
            user_id: userId,
            restrict: followPrivately? 1:0,
        });

        if(data.error)
        {
            console.log(`Error editing follow tags: ${data.message}`);
            return;
        }

        // If we had cached follow info, update it with the new privacy.
        let info = ppixiv.userCache.get_user_follow_info_sync(userId);
        if(info  != null)
        {
            console.log("Updating cached follow privacy");
            info.following_privately = followPrivately;
            ppixiv.userCache.update_cached_follow_info(userId, true, info);
        }

        let userInfo = await ppixiv.userCache.get_userInfo(ususerIder_id);
        let message = `Now following ${userInfo.name} ${followPrivately? "privately":"publically"}`;
        ppixiv.message.show(message);
    }

    // Add or remove a follow tag for a user we're already following.  The API only allows
    // editing one tag per call.
    static async changeFollowTags(userId, {tag, add})
    {
        let data = await helpers.rpc_post_request(add? "/ajax/following/user/tag_add":"/ajax/following/user/tag_delete", {
            user_id: userId,
            tag,
        });

        if(data.error)
        {
            console.log(`Error editing follow tags: ${data.message}`);
            return;
        }

        let userInfo = await ppixiv.userCache.get_userInfo(userId);
        let message = add? `Added the tag "${tag}" to ${userInfo.name}`:`Removed the tag "${tag}" from ${userInfo.name}`;
        ppixiv.message.show(message);

        // Get follow info so we can update the tag list.  This will usually already be loaded,
        // since the caller will have had to load it to show the UI in the first place.
        let follow_info = await ppixiv.userCache.get_user_follow_info(ususerIder_id);
        if(follow_info == null)
        {
            console.log("Error retrieving follow info to update tags");
            return;
        }

        if(add)
        {
            follow_info.tags.add(tag);

            // Make sure the tag is in the full tag list too.
            ppixiv.userCache.add_to_cached_all_user_follow_tags(tag);
        }
        else
            follow_info.tags.delete(tag);

        ppixiv.userCache.update_cached_follow_info(userId, true, follow_info);
    }

    static async unfollow(userId)
    {
        if(userId == -1)
            return;

        let result = await helpers.rpc_post_request("/rpc_group_setting.php", {
            mode: "del",
            type: "bookuser",
            id: userId,
        });

        let userData = await ppixiv.userCache.get_userInfo(userId);

        // Record that we're no longer following and refresh the UI.
        ppixiv.userCache.update_cached_follow_info(user_id, false);

        ppixiv.message.show("Unfollowed " + userData.name);
    }
    
    // Image downloading
    //
    // Download mediaInfo.
    static async downloadIllust(media_id, downloadType)
    {
        let mediaInfo = await ppixiv.mediaCache.get_media_info(media_id);
        let userInfo = await ppixiv.userCache.get_userInfo(mediaInfo.userId);
        console.log("Download", media_id, "with type", downloadType);

        if(downloadType == "MKV")
        {
            new PixivUgoiraDownloader(mediaInfo);
            return;
        }

        if(downloadType != "image" && downloadType != "ZIP")
        {
            console.error("Unknown download type " + downloadType);
            return;
        }

        // If we're in ZIP mode, download all images in the post.
        //
        // Pixiv's host for images changed from i.pximg.net to i-cf.pximg.net.  This will fail currently for that
        // host, since it's not in @connect, and adding that will prompt everyone for permission.  Work around that
        // by replacing i-cf.pixiv.net with i.pixiv.net, since that host still works fine.  This only affects downloads.
        let images = [];
        for(let page of mediaInfo.mangaPages)
        {
            let url = page.urls.original;
            url = url.replace(/:\/\/i-cf.pximg.net/, "://i.pximg.net");
            images.push(url);
        }

        // If we're in image mode for a manga post, only download the requested page.
        let manga_page = helpers.parse_media_id(media_id).page;
        if(downloadType == "image")
            images = [images[manga_page]];

        ppixiv.message.show(images.length > 1? `Downloading ${images.length} pages...`:`Downloading image...`);

        let results;
        try {
            results = await helpers.download_urls(images);
        } catch(e) {
            ppixiv.message.show(e.toString());
            return;
        }

        ppixiv.message.hide();

        // If there's just one image, save it directly.
        if(images.length == 1)
        {
            let url = images[0];
            let blob = new Blob([results[0]]);
            let ext = helpers.get_extension(url);
            let filename = userInfo.name + " - " + mediaInfo.illustId;

            // If this is a single page of a manga post, include the page number.
            if(downloadType == "image" && mediaInfo.mangaPages.length > 1)
                filename += " #" + (manga_page + 1);

            filename += " - " + mediaInfo.illustTitle + "." + ext;
            helpers.save_blob(blob, filename);
            return;
        }

        // There are multiple images, and since browsers are stuck in their own little world, there's
        // still no way in 2018 to save a batch of files to disk, so ZIP the images.
        let filenames = [];
        for(let i = 0; i < images.length; ++i)
        {
            let url = images[i];
            let ext = helpers.get_extension(url);
            let filename = i.toString().padStart(3, '0') + "." + ext;
            filenames.push(filename);
        }

        // Create the ZIP.
        let zip = new CreateZIP(filenames, results);
        let filename = userInfo.name + " - " + mediaInfo.illustId + " - " + mediaInfo.illustTitle + ".zip";
        helpers.save_blob(zip, filename);
    }

    static isDownloadTypeAvailable(downloadType, mediaInfo)
    {
        if(ppixiv.mobile)
            return false;

        // Single image downloading works for single images and manga pages.
        if(downloadType == "image")
            return mediaInfo.illustType != 2;

        // ZIP downloading only makes sense for image sequences.
        if(downloadType == "ZIP")
            return mediaInfo.illustType != 2 && mediaInfo.pageCount > 1;

        // MJPEG only makes sense for videos.
        if(downloadType == "MKV")
            return mediaInfo.illustType == 2;

        throw "Unknown download type " + downloadType;
    };

    static async loadRecentBookmarkTags()
    {
        if(ppixiv.native)
            return await LocalAPI.loadRecentBookmarkTags();

        let url = "/ajax/user/" + window.global_data.user_id + "/illusts/bookmark/tags";
        let result = await helpers.get_request(url, {});
        let bookmarkTags = [];
        let addTag = (tag) => {
            // Ignore "untagged".
            if(tag.tag == "未分類")
                return;

            if(bookmarkTags.indexOf(tag.tag) == -1)
                bookmarkTags.push(tag.tag);
        }

        for(let tag of result.body.public)
            addTag(tag);

        for(let tag of result.body.private)
            addTag(tag);
        
        return bookmarkTags;
    }
}
