// The main UI.  This handles creating the viewers and the global UI.
class main_ui
{
    constructor(main, container)
    {
        if(debug_show_ui) document.body.classList.add("force-ui");

        this.onwheel = this.onwheel.bind(this);
        this.refresh_ui = this.refresh_ui.bind(this);
        this.onkeydown = this.onkeydown.bind(this);
        this.clicked_bookmark = this.clicked_bookmark.bind(this);
        this.clicked_like = this.clicked_like.bind(this);
        this.shown_page_changed = this.shown_page_changed.bind(this);
        this.clicked_download = this.clicked_download.bind(this);
        this.image_data_loaded = this.image_data_loaded.bind(this);
        this.clicked_bookmark_tag_selector = this.clicked_bookmark_tag_selector.bind(this);
        this.refresh_bookmark_tag_highlights = this.refresh_bookmark_tag_highlights.bind(this);
        this.data_source_updated = this.data_source_updated.bind(this);
        this.toggle_auto_like = this.toggle_auto_like.bind(this);

        this.current_illust_id = -1;
        this.latest_navigation_direction_down = true;
        this.main = main;
        this.container = container;

        document.head.appendChild(document.createElement("title"));
        this.document_icon = document.head.appendChild(document.createElement("link"));
        this.document_icon.setAttribute("rel", "icon");
       
        new hide_mouse_cursor_on_idle(this.container.querySelector(".image-container"));

        new refresh_bookmark_tag_widget(this.container.querySelector(".refresh-bookmark-tags"));
        this.manga_thumbnails = new manga_thumbnail_widget(this.container.querySelector(".manga-thumbnail-container"));
        this.manga_thumbnails.set_page_changed_callback(function(page) {
            this.viewer.set_page(page);
        }.bind(this));

        this.avatar_widget = new avatar_widget({
            parent: this.container.querySelector(".avatar-popup"),
            changed_callback: this.refresh_ui,
        });

        // Set up hover popups.
        helpers.setup_popups(this.container, [".image-settings-menu-box"]);

        // When a bookmark is modified, refresh the UI if we're displaying it.
        bookmarking.singleton.add_bookmark_listener(function(illust_id) {
            if(this.current_illust_id == illust_id)
                this.refresh_ui();
        }.bind(this));

        // Show the bookmark UI when hovering over the bookmark icon.
        var bookmark_popup = this.container.querySelector(".bookmark-button");
        bookmark_popup.addEventListener("mouseover", function(e) { helpers.set_class(bookmark_popup, "popup-visible", true); }.bind(this));
        bookmark_popup.addEventListener("mouseout", function(e) { helpers.set_class(bookmark_popup, "popup-visible", false); }.bind(this));

        bookmark_popup.querySelector(".heart").addEventListener("click", this.clicked_bookmark.bind(this, false), false);
        bookmark_popup.querySelector(".bookmark-button.public").addEventListener("click", this.clicked_bookmark.bind(this, false), false);
        bookmark_popup.querySelector(".bookmark-button.private").addEventListener("click", this.clicked_bookmark.bind(this, true), false);
        bookmark_popup.querySelector(".unbookmark-button").addEventListener("click", this.clicked_bookmark.bind(this, true), false);
        this.element_bookmark_tag_list = bookmark_popup.querySelector(".bookmark-tag-list");

        // Bookmark publically when enter is pressed on the bookmark tag input.
        helpers.input_handler(bookmark_popup.querySelector(".bookmark-tag-list"), this.clicked_bookmark.bind(this, false));


        bookmark_popup.querySelector(".bookmark-tag-selector").addEventListener("click", this.clicked_bookmark_tag_selector);
        this.element_bookmark_tag_list.addEventListener("input", this.refresh_bookmark_tag_highlights);

        // stopPropagation on mousewheel movement inside the bookmark popup, so we allow the scroller to move
        // rather than changing images.
        bookmark_popup.addEventListener("wheel", function(e) { e.stopPropagation(); });

        this.container.querySelector(".download-button").addEventListener("click", this.clicked_download);
        this.container.querySelector(".show-thumbnails-button").addEventListener("click", this.main.toggle_thumbnail_view);
        this.container.querySelector(".toggle-auto-like").addEventListener("click", this.toggle_auto_like);

        window.addEventListener("bookmark-tags-changed", this.refresh_ui);

        this.element_title = this.container.querySelector(".title");
        this.element_author = this.container.querySelector(".author");
        this.element_bookmarked = this.container.querySelector(".bookmark-button");

        this.element_liked = this.container.querySelector(".like-button");
        this.element_liked.addEventListener("click", this.clicked_like, false);

        this.tag_widget = new tag_widget({
            parent: this.container.querySelector(".tag-list"),
        });
        this.element_tags = this.container.querySelector(".tag-list");
        this.element_comment = this.container.querySelector(".description");

        this.container.addEventListener("wheel", this.onwheel);
        window.addEventListener("keydown", this.onkeydown);

        // A bar showing how far along in an image sequence we are:
        this.manga_page_bar = new progress_bar(this.container.querySelector(".ui-box")).controller();
        this.progress_bar = new progress_bar(this.container.querySelector(".loading-progress-bar"));
        this.seek_bar = new seek_bar(this.container.querySelector(".ugoira-seek-bar"));

        helpers.add_clicks_to_search_history(document.body);
        this.update_from_settings();

        // We'll finish setting up when our caller calls set_data_source().
    }

    set_data_source(data_source)
    {
        if(data_source == this.data_source)
            return;

        if(this.data_source != null)
        {
            this.data_source.remove_update_listener(this.data_source_updated);
            this.data_source = null;
        }

        this.data_source = data_source;

        if(this.data_source != null)
        {
            this.data_source.add_update_listener(this.data_source_updated);

            this.refresh_ui();
        }
    }

    // Show an image.
    show_image(illust_id)
    {
        // If we previously set a pending navigation, this navigation overrides it.
        this.cancel_async_navigation();

        // If we were already shown (we're not coming from the thumbnail view), and we're showing
        // the previous image from the one we were already showing, start at the end instead
        // of the beginning, so we'll start at the end when browsing backwards.
        var show_last_page = false;
        if(this.active)
        {
            var next_illust_id = this.data_source.id_list.get_neighboring_illust_id(illust_id, true);
            show_last_page = (next_illust_id == this.wanted_illust_id);
        }
        
        // Remember that this is the image we want to be displaying.
        this.wanted_illust_id = illust_id;
        this.wanted_illust_last_page = show_last_page;

        // If this image is already loaded, stop.
        if(illust_id == this.current_illust_id)
        {
            console.log("illust_id", illust_id, "already displayed");
            return;
        }

        // If we're not active, stop.  We'll show this image if we become loaded later.
        if(!this.active)
        {
            console.log("show_image: stopping since we're not active");
            return;
        }

        // Tell the preloader about the current image.
        image_preloader.singleton.set_current_image(illust_id);

        // Load info for this image if needed.
        image_data.singleton().get_image_info(illust_id, this.image_data_loaded);
    }

    // If we started navigating to a new image and were delayed to load data (either to load
    // the image or to load a new page), cancel it and stay where we are.
    cancel_async_navigation()
    {
        // If we previously set a pending navigation, this navigation overrides it.
        this.pending_navigation = null;
    }


    // Stop displaying any image (and cancel any wanted navigation), putting us back
    // to where we were before displaying any images.
    //
    // This will also prevent the next image displayed from triggering speculative
    // loading, which we don't want to do when clicking an image in the thumbnail
    // view.
    stop_displaying_image()
    {
        if(this.viewer != null)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }

        this.manga_thumbnails.set_illust_info(null);
        
        this.wanted_illust_id = null;
        this.wanted_illust_last_page = null;
        this.current_illust_id = -1;
        this.refresh_ui();
    }

    image_data_loaded(illust_data)
    {
        var illust_id = illust_data.illustId;

        // If this isn't image data for the image we want to be showing, ignore it.
        if(this.wanted_illust_id != illust_id)
            return;

        console.log("Showing image", illust_id);
        
        var want_last_page = this.wanted_illust_last_page;

        // If true, this is the first image we're displaying.
        var first_image_displayed = this.current_illust_id == -1;

        if(illust_id == this.current_illust_id)
        {
            console.log("Image ID not changed");
            return;
        }

        // Speculatively load the next image, which is what we'll show if you press page down, so
        // advancing through images is smoother.
        //
        // We don't do this when showing the first image, since the most common case is simply
        // viewing a single image and not navigating to any others, so this avoids making
        // speculative loads every time you load a single illustration.
        if(!first_image_displayed)
        {
            // Let image_preloader handle speculative loading.  If preload_illust_id is null,
            // we're telling it that we don't need to load anything.
            var preload_illust_id = this.data_source.id_list.get_neighboring_illust_id(illust_id, this.latest_navigation_direction_down);
            image_preloader.singleton.set_speculative_image(preload_illust_id);
        }

        this.current_illust_id = illust_id;
        this.current_illust_data = illust_data;

        this.refresh_ui();

        var illust_data = this.current_illust_data;
        
        // If the image has the ドット絵 tag, enable nearest neighbor filtering.
        helpers.set_class(document.body, "dot", helpers.tags_contain_dot(illust_data));

        // Dismiss any message when changing images.
        message_widget.singleton.hide();
       
        // If we're showing something else, remove it.
        if(this.viewer != null)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }

        this.manga_page_bar.set(null);

        var image_container = this.container.querySelector(".image-container");

        // Check if this image is muted.
        var muted_tag = muting.singleton.any_tag_muted(illust_data.tags.tags);
        var muted_user = muting.singleton.is_muted_user_id(illust_data.userId);

        if(muted_tag || muted_user)
        {
            // Tell the thumbnail view about the image.  If the image is muted, disable thumbs.
            this.manga_thumbnails.set_illust_info(null);

            // If the image is muted, load a dummy viewer.
            this.viewer = new viewer_muted(image_container, illust_data);
            return;
        }
     
        // Tell the thumbnail view about the image.
        this.manga_thumbnails.set_illust_info(illust_data);
        this.manga_thumbnails.current_page_changed(want_last_page? (illust_data.pageCount-1):0);
        this.manga_thumbnails.snap_transition();

        // Create the image viewer.
        var progress_bar = this.progress_bar.controller();
        if(illust_data.illustType == 2)
            this.viewer = new viewer_ugoira(image_container, illust_data, this.seek_bar, function(value) {
                progress_bar.set(value);
            }.bind(this));
        else
        {
            this.viewer = new viewer_images(image_container, illust_data, {
                page_changed: this.shown_page_changed,
                progress_bar: progress_bar,
                manga_page_bar: this.manga_page_bar,
                show_last_image: want_last_page,
            });
        }

        // Refresh the UI now that we have a new viewer.
        this.refresh_ui();
    }

    // This is called when the page of a multi-page illustration sequence changes.
    shown_page_changed(page, total_pages, url)
    {
        // if we navigate down, then up quickly, undo any ongoing navigation to the
        // next image
        this.cancel_async_navigation();
        this.wanted_illust_id = this.current_illust_id;

        // Let the manga thumbnail display know about the selected page.
        this.manga_thumbnails.current_page_changed(page);

        this.refresh_ui();
    }

    data_source_updated()
    {
        this.refresh_ui();
    }

    get active()
    {
        return this._active;
    }

    set active(active)
    {
        if(this._active == active)
            return;

        this._active = active;
        this.container.hidden = !active;

        if(!active)
        {
            this.cancel_async_navigation();
            return;
        }

        // If show_image was called while we were inactive, load it now.
        if(this.wanted_illust_id != this.current_illust_id)
        {
            // Hide any previous image.  We want to keep the previous image if we're going
            // from image to image, but we don't want to flash the previous image when going
            // from the thumbnail view to an image.
            console.log("Showing illust_id", this.wanted_illust_id, "that was set while hidden");
            var wanted_illust_id = this.wanted_illust_id;
            this.stop_displaying_image();

            // Show the image.  (this.wanted_illust_id was cleared by stop_displaying_image.)
            this.show_image(wanted_illust_id);
        }
        
        // If we're becoming active, refresh the UI, since we don't do that while we're inactive.
        this.refresh_ui();
    }

    // Refresh the UI for the current image.
    refresh_ui()
    {
        // Don't refresh if the thumbnail view is active.  We're not visible, and we'll just
        // step over its page title, etc.
        if(!this._active)
            return;
        
        // Pull out info about the user and illustration.
        var illust_id = this.current_illust_id;

        // Update the disable UI button to point at the current image's illustration page.
        var disable_button = this.container.querySelector(".disable-ui-button");
        disable_button.href = "/member_illust.php?mode=medium&illust_id=" + illust_id + "#no-ppixiv";

        // If we're not showing an image yet, hide the UI and don't try to update it.
        helpers.set_class(this.container.querySelector(".ui"), "disabled", illust_id == -1);
        if(illust_id == -1)
        {
            helpers.set_page_title("Loading...");
            return;
        }

        var illust_data = this.current_illust_data;
        var user_data = illust_data.userInfo;

        var page_title = "";
        if(illust_data.bookmarkData)
            page_title += "★";
        page_title += user_data.name + " - " + illust_data.illustTitle;
        helpers.set_page_title(page_title);

        helpers.set_page_icon(user_data.isFollowed? binary_data['favorited_icon.png']:binary_data['regular_pixiv_icon.png']);

        // Show the author if it's someone else's post, or the edit link if it's ours.
        var our_post = global_data.user_id == user_data.userId;
        this.container.querySelector(".author-block").hidden = our_post;
        this.container.querySelector(".edit-post").hidden = !our_post;
        this.container.querySelector(".edit-post").href = "/member_illust_mod.php?mode=mod&illust_id=" + illust_id;

        this.avatar_widget.set_from_user_data(user_data);

        // Set the popup for the thumbnails button based on the label of the data source.
        this.container.querySelector(".show-thumbnails-button").dataset.popup = this.data_source.get_displaying_text();

        this.element_author.textContent = user_data.name;
        this.element_author.href = "/member_illust.php?id=" + user_data.userId + "#ppixiv";

        this.container.querySelector(".similar-illusts-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv";

        this.element_title.textContent = illust_data.illustTitle;
        this.element_title.href = "/member_illust.php?mode=medium&illust_id=" + illust_id + "#ppixiv";

        // Fill in the post info text.
        var set_info = function(query, text)
        {
            var node = this.container.querySelector(query);
            node.innerText = text;
            node.hidden = text == "";
        }.bind(this);

        var seconds_old = (new Date() - new Date(illust_data.createDate)) / 1000;
        set_info(".post-info > .post-age", helpers.age_to_string(seconds_old) + " ago");

        var info = "";
        if(this.viewer != null && this.viewer.current_image_width != null)
        {
            // Add the resolution and file type if available.
            info += this.viewer.current_image_width + "x" + this.viewer.current_image_height;
        }
        var ext = this.viewer? this.viewer.current_image_type:null;
        if(ext != null)
            info += " " + ext;

        set_info(".post-info > .image-info", info);

        var duration = "";
        if(illust_data.illustType == 2)
        {
            var seconds = 0;
            for(var frame of illust_data.ugoiraMetadata.frames)
                seconds += frame.delay / 1000;

            var duration = seconds.toFixed(duration >= 10? 0:1);
            duration += seconds == 1? " second":" seconds";
        }
        set_info(".post-info > .ugoira-duration", duration);
        set_info(".post-info > .ugoira-frames", illust_data.illustType == 2? (illust_data.ugoiraMetadata.frames.length + " frames"):"");

        // Add the page count for manga.
        set_info(".post-info > .page-count", illust_data.pageCount == 1? "":(illust_data.pageCount + " pages"));

        // The comment (description) can contain HTML.
        this.element_comment.hidden = illust_data.illustComment == "";
        this.element_comment.innerHTML = illust_data.illustComment;
        helpers.fix_pixiv_links(this.element_comment);
        helpers.make_pixiv_links_internal(this.element_comment);

        // Set the download button popup text.
        var download_type = this.get_download_type_for_image();
        var download_button = this.container.querySelector(".download-button");
        download_button.hidden = download_type == null;
        if(download_type != null)
            download_button.dataset.popup = "Download " + download_type;

        helpers.set_class(document.body, "bookmarked", illust_data.bookmarkData);

        helpers.set_class(this.element_bookmarked, "bookmarked-public", illust_data.bookmarkData && !illust_data.bookmarkData.private);
        helpers.set_class(this.element_bookmarked, "bookmarked-private", illust_data.bookmarkData && illust_data.bookmarkData.private);
        helpers.set_class(this.element_liked, "liked", illust_data.likeData);
        this.element_liked.dataset.popup = illust_data.likeCount + " likes";
        this.element_bookmarked.querySelector(".popup").dataset.popup = illust_data.bookmarkCount + " bookmarks";

        this.tag_widget.set(illust_data.tags);

        this.refresh_bookmark_tag_list();
    }

    is_download_type_available(download_type)
    {
        var illust_data = this.current_illust_data;
        
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

    get_download_type_for_image()
    {
        var download_types = ["image", "ZIP", "MKV"];
        for(var type of download_types)
            if(this.is_download_type_available(type))
                return type;

        return null;
    }

    onwheel(e)
    {
        if(!this._active)
            return;        

        // Don't intercept wheel scrolling over the description box.
        if(e.target.closest(".description") != null)
            return;

        var down = e.deltaY > 0;
        this.move(down);
    }

    onkeydown(e)
    {
        // Don't handle image viewer shortcuts when the thumbnail view is open on top of it.
        if(!this._active)
            return;
        
        // Let the viewer handle the input first.
        if(this.viewer && this.viewer.onkeydown)
        {
            this.viewer.onkeydown(e);
            if(e.defaultPrevented)
                return;
        }

        if(e.keyCode == 66) // b
        {
            // b to bookmark publically, B to bookmark privately, ^B to remove a bookmark.
            //
            // Use a separate hotkey to remove bookmarks, rather than toggling like the bookmark
            // button does, so you don't have to check whether an image is bookmarked.  You can
            // just press B to bookmark without worrying about accidentally removing a bookmark
            // instead.
            e.stopPropagation();
            e.preventDefault();

            var illust_id = this.current_illust_id;
            var illust_data = this.current_illust_data;

            if(e.ctrlKey)
            {
                // Remove the bookmark.
                if(illust_data.bookmarkData == null)
                {
                    message_widget.singleton.show("Image isn't bookmarked");
                    return;
                }

                this.bookmark_remove();
                return;
            }

            if(illust_data.bookmarkData)
            {
                message_widget.singleton.show("Already bookmarked (^B to remove bookmark)");
                return;
            }
            
            this.bookmark_add(e.shiftKey);
            return;
        }

        if(e.keyCode == 70) // f
        {
            // f to follow publically, F to follow privately, ^F to unfollow.
            e.stopPropagation();
            e.preventDefault();

            var illust_data = this.current_illust_data;
            if(illust_data == null)
                return;

            var user_data = illust_data.userInfo.isFollowed;
            if(e.ctrlKey)
            {
                // Remove the bookmark.
                if(!illust_data.userInfo.isFollowed)
                {
                    message_widget.singleton.show("Not following this user");
                    return;
                }

                this.avatar_widget.unfollow();
                return;
            }

            if(illust_data.userInfo.isFollowed)
            {
                message_widget.singleton.show("Already following (^F to unfollow)");
                return;
            }
            
            this.avatar_widget.follow(e.shiftKey);
            return;
        }
        
        if(e.ctrlKey || e.altKey)
            return;

        switch(e.keyCode)
        {
        case 86: // l
            e.stopPropagation();
            this.clicked_like(e);
            return;

        case 37: // left
        case 38: // up
        case 33: // pgup
            e.preventDefault();
            e.stopPropagation();

            this.move(false);
            break;

        case 39: // right
        case 40: // down
        case 34: // pgdn
            e.preventDefault();
            e.stopPropagation();

            this.move(true);
            break;
        }
    }

    move(down)
    {
        // Remember whether we're navigating forwards or backwards, for preloading.
        this.latest_navigation_direction_down = down;

        this.cancel_async_navigation();

        // Let the viewer handle the input first.
        if(this.viewer && this.viewer.move)
        {
            if(this.viewer.move(down))
            {
                // If we navigated down out of this image, then navigated up back through it
                // before the navigation happened, put this image back in the URL.
                this.main.show_illust_id(this.current_illust_id, false /* don't add to history */);
                return;
            }
        }

        // If we have a target illust_id, move relative to it.  Otherwise, move relative to the
        // displayed image.  This way, if we navigate repeatedly before a previous navigation
        // finishes, we'll keep moving rather than waiting for each navigation to complete.
        var navigate_from_illust_id = this.wanted_illust_id;
        if(navigate_from_illust_id == null)
            navigate_from_illust_id = this.current_illust_id;

        // Get the next (or previous) illustration after the current one.
        var new_illust_id = this.data_source.id_list.get_neighboring_illust_id(navigate_from_illust_id, down);
        console.log("move(): id", navigate_from_illust_id, "next", new_illust_id);
        console.log("    wanted", this.wanted_illust_id, "current", this.current_illust_id);
        if(new_illust_id == null)
        {
            // That page isn't loaded.  Try to load it.
            var next_page = this.data_source.id_list.get_page_for_neighboring_illust(navigate_from_illust_id, down);

            // If we can't find the next page, then the current image isn't actually loaded in
            // the current search results.  This can happen if the page is reloaded: we'll show
            // the previous image, but we won't have the results loaded (and the results may have
            // changed).  Just jump to the first image in the results so we get back to a place
            // we can navigate from.
            //
            // Note that we use id_list.get_first_id rather than get_current_illust_id, which is
            // just the image we're already on.
            if(next_page == null)
            {
                // We should normally know which page the illustration we're currently viewing is on.
                console.warn("Don't know the next page for illust", navigate_from_illust_id);
                new_illust_id = this.data_source.id_list.get_first_id();
                console.log("xxx", new_illust_id);
                this.main.show_illust_id(new_illust_id, false /* don't add to history */);
                return true;
            }

            console.log("Loading the next page of results:", next_page);

            // The page shouldn't already be loaded.  Double-check to help prevent bugs that might
            // spam the server requesting the same page over and over.
            if(this.data_source.id_list.is_page_loaded(next_page))
            {
                console.error("Page", next_page, "is already loaded");
                return;
            }

            // Ask the data source to load it.
            var pending_navigation = function()
            {
                // If this.pending_navigation is no longer set to this function, we navigated since
                // we requested this load and this navigation is stale, so stop.
                if(this.pending_navigation != pending_navigation)
                {
                    console.log("Aborting stale navigation");
                    return;
                }

                this.pending_navigation = null;

                // If we do have an image displayed, navigate up or down based on our most recent navigation
                // direction.  This simply retries the navigation now that we have data.
                console.log("Retrying navigation after data load");
                this.move(down);

            }.bind(this);
            this.pending_navigation = pending_navigation;

            if(!this.data_source.load_page(next_page, this.pending_navigation))
            {
                console.log("Reached the end of the list");
                return false;
            }

            return true;
        }

        // Show the new image.
        this.main.show_illust_id(new_illust_id, false /* don't add to history */);
        return true;
    }

    clicked_download(e)
    {
        var clicked_button = e.target.closest(".download-button");
        if(clicked_button == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        var illust_data = this.current_illust_data;

        var download_type = this.get_download_type_for_image();
        if(download_type == null)
        {
            console.error("No download types are available");
            retunr;
        }

        console.log("Download", this.current_illust_id, "with type", download_type);

        if(download_type == "MKV")
        {
            new ugoira_downloader_mjpeg(illust_data, this.progress_bar.controller());
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
        }.bind(this));
        return;
    }

    clicked_bookmark(private_bookmark, e)
    {
        e.preventDefault();
        e.stopPropagation();

        var illust_id = this.current_illust_id;
        var illust_data = this.current_illust_data;
        if(illust_data.bookmarkData)
        {
            // The illustration is already bookmarked, so remove the bookmark.
            this.bookmark_remove();
            return;
        }

        // Add a new bookmark.
        this.bookmark_add(private_bookmark);
    }

    bookmark_add(private_bookmark)
    {
        // If auto-like is enabled, like an image when we bookmark it.
        if(helpers.get_value("auto-like"))
        {
            console.log("Automatically liking image as well as bookmarking it due to auto-like preference");
            this.like_image(true /* quiet */);
        }
        
        var illust_id = this.current_illust_id;
        var illust_data = this.current_illust_data;

        var tags = this.element_bookmark_tag_list.value;
        var tag_list = tags == ""? []:tags.split(" ");

        bookmarking.singleton.bookmark_add(illust_id, private_bookmark, tag_list);
        
        helpers.update_recent_bookmark_tags(tag_list);

        // Clear the tag list after saving a bookmark.  Otherwise, it's too easy to set a tag for one
        // image, then forget to unset it later.
        this.element_bookmark_tag_list.value = null;
    }

    bookmark_remove()
    {
        var illust_id = this.current_illust_id;
        var illust_data = this.current_illust_data;
        var bookmark_id = illust_data.bookmarkData.id;
        bookmarking.singleton.bookmark_remove(illust_id, bookmark_id);
    }

    // Refresh the list of recent bookmark tags.
    refresh_bookmark_tag_list()
    {
        var bookmark_tags = this.container.querySelector(".bookmark-tag-selector");
        helpers.remove_elements(bookmark_tags);

        var recent_bookmark_tags = helpers.get_recent_bookmark_tags();
        recent_bookmark_tags.sort();
        for(var i = 0; i < recent_bookmark_tags.length; ++i)
        {
            var tag = recent_bookmark_tags[i];
            var entry = helpers.create_from_template(".template-bookmark-tag-entry");
            entry.dataset.tag = tag;
            bookmark_tags.appendChild(entry);
            entry.querySelector(".tag-name").innerText = tag;
        }

        this.refresh_bookmark_tag_highlights();
    }

    // Update which tags are highlighted in the bookmark tag list.
    refresh_bookmark_tag_highlights()
    {
        var bookmark_tags = this.container.querySelector(".bookmark-tag-selector");
        
        var tags = this.element_bookmark_tag_list.value;
        var tags = tags.split(" ");
        var tag_entries = bookmark_tags.querySelectorAll(".bookmark-tag-entry");
        for(var i = 0; i < tag_entries.length; ++i)
        {
            var entry = tag_entries[i];
            var tag = entry.dataset.tag;
            var highlight_entry = tags.indexOf(tag) != -1;
            helpers.set_class(entry, "enabled", highlight_entry);
        }
    }

    clicked_bookmark_tag_selector(e)
    {
        var clicked_tag_entry = e.target.closest(".bookmark-tag-entry");
        var tag = clicked_tag_entry.dataset.tag;

        var clicked_remove = e.target.closest(".remove");
        if(clicked_remove)
        {
            // Remove the clicked tag from the recent list.
            e.preventDefault();
            e.stopPropagation();

            var recent_bookmark_tags = helpers.get_recent_bookmark_tags();
            var idx = recent_bookmark_tags.indexOf(tag);
            if(idx != -1)
                recent_bookmark_tags.splice(idx, 1);
            helpers.set_recent_bookmark_tags(recent_bookmark_tags);
            this.refresh_bookmark_tag_list();
            return;
        }

        // Toggle the clicked tag.
        var tags = this.element_bookmark_tag_list.value;
        var tags = tags == ""? []:tags.split(" ");
        var idx = tags.indexOf(tag);
        if(idx != -1)
        {
            // Remove this tag from the list.
            tags.splice(idx, 1);
        }
        else
        {
            // Add this tag to the list.
            tags.push(tag);
        }

        this.element_bookmark_tag_list.value = tags.join(" ");
        this.refresh_bookmark_tag_highlights();
    }

    clicked_like(e)
    {
        e.preventDefault();
        e.stopPropagation();
        this.like_image();
    }

    // If quiet is true, don't print any messages.
    like_image(quiet)
    {
        var illust_id = this.current_illust_id;
        console.log("Clicked like on", illust_id);

        var illust_data = this.current_illust_data;
        if(illust_data.likeData)
        {
            if(!quiet)
                message_widget.singleton.show("Already liked this image");
            return;
        }
        
        helpers.post_request("/ajax/illusts/like", {
            "illust_id": illust_id,
        }, function() {
            // Update the data (even if it's no longer being viewed).
            illust_data.likeData = true;
            illust_data.likeCount++;

            // Refresh the UI if we're still on the same post.
            if(this.current_illust_id == illust_id)
                this.refresh_ui();

            if(!quiet)
                message_widget.singleton.show("Illustration liked");
        }.bind(this));
    }

    toggle_auto_like()
    {
        var auto_like = helpers.get_value("auto-like");
        auto_like = !auto_like;
        helpers.set_value("auto-like", auto_like);

        this.update_from_settings();
    }

    update_from_settings()
    {
        helpers.set_class(document.body, "auto-like", helpers.get_value("auto-like"));
    }    
    
}

