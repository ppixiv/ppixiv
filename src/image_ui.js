"use strict";

// This handles the overlay UI on the illustration page.
ppixiv.image_ui = class
{
    constructor(container, progress_bar)
    {
        this.clicked_download = this.clicked_download.bind(this);
        this.refresh = this.refresh.bind(this);

        this.container = container;
        this.progress_bar = progress_bar;
        this._visible = false;

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

        for(let button of this.container.querySelectorAll(".download-button"))
            button.addEventListener("click", this.clicked_download);
        this.container.querySelector(".download-manga-button").addEventListener("click", this.clicked_download);
        this.container.querySelector(".navigate-out-button").addEventListener("click", function(e) {
            main_controller.singleton.navigate_out();
        }.bind(this));

        var settings_menu = this.container.querySelector(".settings-menu-box > .popup-menu-box");
        menu_option.add_settings(settings_menu);
    }

    set visible(value)
    {
        if(this._visible == value)
            return;
        this._visible = value;
        this.avatar_widget.visible = value;

        if(value)
            this.refresh();
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

        this.like_button.illust_id = illust_id;
        this.bookmark_tag_widget.illust_id = illust_id;
        this.toggle_tag_widget.illust_id = illust_id;
        for(let button of this.bookmark_buttons)
            button.illust_id = illust_id;
        
        if(illust_id == null)
        {
            this.refresh();
            return;
        }

        image_data.singleton().get_image_info(illust_id).then((illust_info) => {
            if(illust_info.illustId != this._illust_id)
                return;
    
            this.illust_data = illust_info;
            this.refresh();
        });
    }

    handle_onkeydown(e)
    {
    }

    refresh()
    {
        if(this.illust_data == null || !this._visible)
            return;

        var illust_data = this.illust_data;
        var illust_id = illust_data.illustId;
        let user_id = illust_data.userId;
        
        // Show the author if it's someone else's post, or the edit link if it's ours.
        var our_post = global_data.user_id == user_id;
        this.container.querySelector(".author-block").hidden = our_post;
        this.container.querySelector(".edit-post").hidden = !our_post;
        this.container.querySelector(".edit-post").href = "/member_illust_mod.php?mode=mod&illust_id=" + illust_id;

        this.avatar_widget.set_user_id(user_id);
        this.tag_widget.set(illust_data.tags);

        var element_title = this.container.querySelector(".title");
        element_title.textContent = illust_data.illustTitle;
        element_title.href = "/artworks/" + illust_id + "#ppixiv";

        var element_author = this.container.querySelector(".author");
        element_author.textContent = illust_data.userName;
        element_author.href = `/users/${user_id}#ppixiv`;
        
        this.container.querySelector(".similar-illusts-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv?recommendations=1";
        this.container.querySelector(".similar-artists-button").href = "/discovery/users#ppixiv?user_id=" + user_id;
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
            let download_image_button = this.container.querySelector(".download-image-button");
            download_image_button.hidden = !actions.is_download_type_available("image", this.illust_data);

            let download_manga_button = this.container.querySelector(".download-manga-button");
            download_manga_button.hidden = !actions.is_download_type_available("ZIP", this.illust_data);

            let download_video_button = this.container.querySelector(".download-video-button");
            download_video_button.hidden = !actions.is_download_type_available("MKV", this.illust_data);
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
        console.assert(page == null || page >= 0);
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

        let download_type = clicked_button.dataset.download;
        actions.download_illust(this.illust_id, this.progress_bar.controller(), download_type, this.displayed_page);
    }
 }

