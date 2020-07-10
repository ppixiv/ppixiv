// This handles the overlay UI on the illustration page.
class image_ui
{
    constructor(container, progress_bar)
    {
        this.image_data_loaded = this.image_data_loaded.bind(this);
        this.clicked_download = this.clicked_download.bind(this);
        this.refresh = this.refresh.bind(this);

        this.container = container;
        this.progress_bar = progress_bar;

        this.ui = helpers.create_from_template(".template-image-ui");
        this.container.appendChild(this.ui);

        this.avatar_widget = new avatar_widget({
            parent: this.container.querySelector(".avatar-popup"),
            mode: "dropdown",
        });

        this.tag_widget = new tag_widget({
            parent: this.container.querySelector(".tag-list"),
        });

        // Set up hover popups.
        dropdown_menu_opener.create_handlers(this.container, [".image-settings-menu-box"]);
        
        image_data.singleton().illust_modified_callbacks.register(this.refresh);
        
        this.bookmark_tag_widget = new bookmark_tag_list_widget(this.container.querySelector(".popup-bookmark-tag-dropdown-container"));
        this.toggle_tag_widget = new toggle_bookmark_tag_list_widget(this.container.querySelector(".button-bookmark-tags"), this.bookmark_tag_widget);
        this.like_button = new like_button_widget(this.container.querySelector(".button-like"));

        // The bookmark buttons, and clicks in the tag dropdown:
        this.bookmark_buttons = [];
        for(var a of this.container.querySelectorAll(".button-bookmark"))
            this.bookmark_buttons.push(new bookmark_button_widget(a, a.classList.contains("private"), this.bookmark_tag_widget));

        this.container.querySelector(".download-button").addEventListener("click", this.clicked_download);
        this.container.querySelector(".navigate-out-button").addEventListener("click", function(e) {
            main_controller.singleton.navigate_out();
        }.bind(this));

        var settings_menu = this.container.querySelector(".settings-menu-box > .popup-menu-box");
        menu_option.add_settings(settings_menu);
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

        this.like_button.illust_id = illust_id;
        this.bookmark_tag_widget.illust_id = illust_id;
        this.toggle_tag_widget.illust_id = illust_id;
        for(var button of this.bookmark_buttons)
            button.illust_id = illust_id;
        
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
            
            actions.bookmark_add(illust_data, {
                private: e.shiftKey
            });
            
            return;
        }
        
        if(e.ctrlKey || e.altKey || e.metaKey)
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
        element_title.href = "/artworks/" + illust_id + "#ppixiv";

        var element_author = this.container.querySelector(".author");
        element_author.textContent = user_data.name;
        element_author.href = "/users/" + user_data.userId + "#ppixiv";
        
        this.container.querySelector(".similar-illusts-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv?recommendations=1";
        this.container.querySelector(".similar-artists-button").href = "/discovery/users#ppixiv?user_id=" + user_data.userId;
        this.container.querySelector(".similar-bookmarks-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv";

        // Fill in the post info text.
        this.set_post_info(this.container.querySelector(".post-info"));

        // The comment (description) can contain HTML.
        var element_comment = this.container.querySelector(".description");
        element_comment.hidden = illust_data.illustComment == "";
        element_comment.innerHTML = illust_data.illustComment;
        helpers.fix_pixiv_links(element_comment);
        helpers.make_pixiv_links_internal(element_comment);

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

    set_post_info(post_info_container)
    {
        var illust_data = this.illust_data;

        var set_info = (query, text) =>
        {
            var node = post_info_container.querySelector(query);
            node.innerText = text;
            node.hidden = text == "";
        };

        var seconds_old = (new Date() - new Date(illust_data.createDate)) / 1000;
        set_info(".post-age", helpers.age_to_string(seconds_old) + " ago");
        post_info_container.querySelector(".post-age").dataset.popup = helpers.date_to_string(illust_data.createDate);

        var info = "";

        // Add the resolution and file type if available.
        if(this.displayed_page != null && this.illust_data != null)
        {
            var page_info = this.illust_data.mangaPages[this.displayed_page];
            page_info.width;
        
            info += page_info.width + "x" + page_info.height;
        }

        var ext = this.viewer? this.viewer.current_image_type:null;
        if(ext != null)
            info += " " + ext;

        set_info(".image-info", info);

        var duration = "";
        if(illust_data.illustType == 2)
        {
            var seconds = 0;
            for(var frame of illust_data.ugoiraMetadata.frames)
                seconds += frame.delay / 1000;

            var duration = seconds.toFixed(duration >= 10? 0:1);
            duration += seconds == 1? " second":" seconds";
        }
        set_info(".ugoira-duration", duration);
        set_info(".ugoira-frames", illust_data.illustType == 2? (illust_data.ugoiraMetadata.frames.length + " frames"):"");

        // Add the page count for manga.
        var page_text = "";
        if(illust_data.pageCount > 1 && this.displayed_page != null)
            page_text = "Page " + (this.displayed_page+1) + "/" + illust_data.pageCount;
        set_info(".page-count", page_text);
    }

    // Set the resolution to display in image info.  If both are null, no resolution
    // is displayed.
    set_displayed_page_info(page)
    {
        this.displayed_page = page;
        this.refresh();
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

