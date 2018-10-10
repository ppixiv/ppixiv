// This handles the overlay UI on the illustration page.
class image_ui
{
    constructor(container, progress_bar)
    {
        this.image_data_loaded = this.image_data_loaded.bind(this);
        this.refresh_bookmark_tag_highlights = this.refresh_bookmark_tag_highlights.bind(this);
        this.clicked_bookmark_tag_selector = this.clicked_bookmark_tag_selector.bind(this);
        this.clicked_bookmark = this.clicked_bookmark.bind(this);
        this.clicked_like = this.clicked_like.bind(this);
        this.clicked_download = this.clicked_download.bind(this);
        this.refresh = this.refresh.bind(this);

        this.container = container;
        this.progress_bar = progress_bar;

        this.ui = helpers.create_from_template(".template-image-ui");
        this.container.appendChild(this.ui);

        this.avatar_widget = new avatar_widget({
            parent: this.container.querySelector(".avatar-popup"),
        });

        this.tag_widget = new tag_widget({
            parent: this.container.querySelector(".tag-list"),
        });

        // Set up hover popups.
        helpers.setup_popups(this.container, [".image-settings-menu-box"]);
        
        image_data.singleton().illust_modified_callbacks.register(this.refresh);
        
        // Show the bookmark UI when hovering over the bookmark icon.
        this.bookmark_popup = this.container.querySelector(".bookmark-button");
        this.element_bookmark_tag_list = this.bookmark_popup.querySelector(".bookmark-tag-list");
        this.element_bookmark_tag_list.addEventListener("input", this.refresh_bookmark_tag_highlights);

        this.bookmark_popup.addEventListener("mouseover", function(e) { helpers.set_class(this.bookmark_popup, "popup-visible", true); }.bind(this));
        this.bookmark_popup.addEventListener("mouseout", function(e) { helpers.set_class(this.bookmark_popup, "popup-visible", false); }.bind(this));
        this.bookmark_popup.querySelector(".heart").addEventListener("click", this.clicked_bookmark.bind(this, false), false);
        this.bookmark_popup.querySelector(".bookmark-button.public").addEventListener("click", this.clicked_bookmark.bind(this, false), false);
        this.bookmark_popup.querySelector(".bookmark-button.private").addEventListener("click", this.clicked_bookmark.bind(this, true), false);
        this.bookmark_popup.querySelector(".unbookmark-button").addEventListener("click", this.clicked_bookmark.bind(this, true), false);
        this.bookmark_popup.querySelector(".bookmark-tag-selector").addEventListener("click", this.clicked_bookmark_tag_selector);

        // Bookmark publically when enter is pressed on the bookmark tag input.
        helpers.input_handler(this.bookmark_popup.querySelector(".bookmark-tag-list"), this.clicked_bookmark.bind(this, false));
        this.bookmark_popup.querySelector(".bookmark-tag-selector").addEventListener("click", this.clicked_bookmark_tag_selector);

        // stopPropagation on mousewheel movement inside the bookmark popup, so we allow the scroller to move
        // rather than changing images.
        this.bookmark_popup.addEventListener("wheel", function(e) { e.stopPropagation(); });

        this.element_liked = this.container.querySelector(".like-button");
        this.element_liked.addEventListener("click", this.clicked_like, false);

        this.container.querySelector(".download-button").addEventListener("click", this.clicked_download);
        this.container.querySelector(".navigate-out-button").addEventListener("click", function(e) {
            main_controller.singleton.navigate_out();
        }.bind(this));

        var settings_menu = this.container.querySelector(".settings-menu-box > .popup-menu-box");
        
        // Only add the thumbnail size option in the manga page.  We don't want it in
        // the illust page and its hotkey handling will confuse zooming.
        if(this.container.closest(".view-manga-container"))
        {
            this.thumbnail_size_slider = new thumbnail_size_slider_widget(settings_menu, {
                label: "Thumbnail size",
                setting: "manga-thumbnail-size",
                min: 0,
                max: 5,
            });
        }

        new menu_option_toggle(settings_menu, {
            label: "Bookmarking auto-likes",
            setting: "auto-like",
        });

        // Firefox's contextmenu behavior is broken, so hide this option.
        if(navigator.userAgent.indexOf("Firefox/") == -1)
        {
            new menu_option_toggle(settings_menu, {
                label: "Hold shift to open context menu",
                setting: "invert-popup-hotkey",
            });
        }
    }

    set data_source(data_source)
    {
        if(this._data_source == data_source)
            return;

        this._data_source = data_source;
        this.refresh();
    }
    
    shutdown()
    {
        image_data.singleton().illust_modified_callbacks.unregister(this.refresh);
        this.avatar_widget.shutdown();
        this.element_bookmark_tag_list.removeEventListener("input", this.refresh_bookmark_tag_highlights);
    }

    get illust_id()
    {
        return this._illust_id;
    }

    set illust_id(illust_id)
    {
        if(this._illust_id == illust_id)
            return;

        this._illust_id = illust_id;
        this.illust_data = null;
        image_data.singleton().get_image_info(illust_id).then((illust_info) => {
            this.image_data_loaded(illust_info);
        }).catch((e) => {
            console.error(e);
        });
    }

    handle_onkeydown(e)
    {
        this.avatar_widget.handle_onkeydown(e);
        if(e.defaultPrevented)
            return;

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

            var illust_data = this.illust_data;
            if(illust_data == null)
                return;

            if(e.ctrlKey)
            {
                // Remove the bookmark.
                if(illust_data.bookmarkData == null)
                {
                    message_widget.singleton.show("Image isn't bookmarked");
                    return;
                }

                actions.bookmark_remove(illust_data);
                
                return;
            }

            if(illust_data.bookmarkData)
            {
                message_widget.singleton.show("Already bookmarked (^B to remove bookmark)");
                return;
            }
            
            actions.bookmark_add(illust_data, e.shiftKey /* private_bookmark */);
            
            return;
        }
        
        if(e.ctrlKey || e.altKey)
            return;

        switch(e.keyCode)
        {
        case 86: // v
            e.stopPropagation();
            e.preventDefault();
            actions.like_image(this.illust_data);
            return;
        }
    }

    image_data_loaded(illust_data)
    {
        if(illust_data.illustId != this._illust_id)
            return;

        this.illust_data = illust_data;
        this.refresh();
    }

    refresh()
    {
        if(this.illust_data == null)
            return;

        var illust_data = this.illust_data;
        var illust_id = illust_data.illustId;
        var user_data = illust_data.userInfo;
        
        // Show the author if it's someone else's post, or the edit link if it's ours.
        var our_post = global_data.user_id == user_data.userId;
        this.container.querySelector(".author-block").hidden = our_post;
        this.container.querySelector(".edit-post").hidden = !our_post;
        this.container.querySelector(".edit-post").href = "/member_illust_mod.php?mode=mod&illust_id=" + illust_id;

        this.avatar_widget.set_from_user_data(user_data);
        this.tag_widget.set(illust_data.tags);

        var element_title = this.container.querySelector(".title");
        element_title.textContent = illust_data.illustTitle;
        element_title.href = "/member_illust.php?mode=medium&illust_id=" + illust_id + "#ppixiv";

        var element_author = this.container.querySelector(".author");
        element_author.textContent = user_data.name;
        element_author.href = "/member_illust.php?id=" + user_data.userId + "#ppixiv";
        
        this.container.querySelector(".similar-illusts-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv";

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
        if(this.displayed_width != null)
        {
            // Add the resolution and file type if available.
            info += this.displayed_width + "x" + this.displayed_height;
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
        var page_text = "";
        if(illust_data.pageCount > 1 && this.displayed_page != null)
            page_text = "Page " + (this.displayed_page+1) + "/" + illust_data.pageCount;
        set_info(".post-info > .page-count", page_text);

        // The comment (description) can contain HTML.
        var element_comment = this.container.querySelector(".description");
        element_comment.hidden = illust_data.illustComment == "";
        element_comment.innerHTML = illust_data.illustComment;
        helpers.fix_pixiv_links(element_comment);
        helpers.make_pixiv_links_internal(element_comment);

        var element_bookmarked = this.container.querySelector(".bookmark-button");
        element_bookmarked.dataset.state = illust_data.bookmarkData? "bookmarked":"not-bookmarked";
        helpers.set_class(element_bookmarked, "bookmarked", illust_data.bookmarkData != null);
        helpers.set_class(element_bookmarked, "bookmarked-public", illust_data.bookmarkData && !illust_data.bookmarkData.private);
        helpers.set_class(element_bookmarked, "bookmarked-private", illust_data.bookmarkData && illust_data.bookmarkData.private);
        element_bookmarked.querySelector(".popup").dataset.popup = illust_data.bookmarkCount + " bookmarks";
        this.refresh_bookmark_tag_list();

        helpers.set_class(this.element_liked, "liked", illust_data.likeData);
        this.element_liked.dataset.popup = illust_data.likeCount + " likes";

        // Set the download button popup text.
        if(this.illust_data != null)
        {
            var download_type = actions.get_download_type_for_image(this.illust_data);
            
            var download_button = this.container.querySelector(".download-button");
            download_button.hidden = download_type == null;
            if(download_type != null)
                download_button.dataset.popup = "Download " + download_type;
        }

        // Set the popup for the thumbnails button.
        var navigate_out_label = main_controller.singleton.navigate_out_label;
        var title = navigate_out_label != null? ("Return to " + navigate_out_label):"";
        this.container.querySelector(".navigate-out-button").dataset.popup = title;
    }

    // Set the resolution to display in image info.  If both are null, no resolution
    // is displayed.
    set_displayed_page_info(page, width, height)
    {
        this.displayed_page = page;
        this.displayed_width = width;
        this.displayed_height = height;
        this.refresh();
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

    get tag_list()
    {
        var tags = this.element_bookmark_tag_list.value;
        return tags == ""? []:tags.split(" ");
    }
    
    clicked_bookmark(private_bookmark, e)
    {
        e.preventDefault();
        e.stopPropagation();

        if(this.illust_data.bookmarkData)
        {
            // The illustration is already bookmarked, so remove the bookmark.
            actions.bookmark_remove(this.illust_data);
            return;
        }

        // Add a new bookmark.
        actions.bookmark_add(this.illust_data, private_bookmark, this.tag_list);
        
        // Clear the tag list after saving a bookmark.  Otherwise, it's too easy to set a tag for one
        // image, then forget to unset it later.
        this.element_bookmark_tag_list.value = null;
    }
    
    clicked_like(e)
    {
        e.preventDefault();
        e.stopPropagation();
        actions.like_image(this.illust_data);
    }

    clicked_download(e)
    {
        if(this.illust_data == null)
            return;

        var clicked_button = e.target.closest(".download-button");
        if(clicked_button == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        actions.download_illust(this.illust_data, this.progress_bar.controller());
    }
 }

