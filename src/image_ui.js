"use strict";

// This handles the overlay UI on the illustration page.
ppixiv.image_ui = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({
            ...options,
            visible: false,
            template: `
<div class=image-ui>
    <div class=hover-sphere>
        <svg viewBox="0 0 1 1" preserveAspectRatio="none">
            <circle class=hover-circle cx="0.5" cy="0.5" r=".5" fill-opacity="0" />
        </svg>
    </div>

    <div class=ui-box>
        <div class=avatar-popup></div>

        <div class=ui-title-box>
            <div>
                <span class="title-block">
                    <!-- Put the title and author in separate inline-blocks, to encourage
                        the browser to wrap between them if possible, putting the author
                        on its own line if they won't both fit, but still allowing the
                        title to wrap if it's too long by itself. -->
                    <span style="display: inline-block;" class="title-font">
                        <a class="title"></a>
                    </span>
                    <span style="display: inline-block;" class="author-block title-font">
                        <span style="font-size: 12px;">by</span>
                        <a class="author"></a>
                    </span>
                    <span style="display: inline-block;" class=folder-block>
                        <span style="font-size: 12px;">in</span>
                        <a class="folder-text title-font"></a>
                    </span>

                    <a class=edit-post href=#>Edit post</a>
                </span>
            </div>
        </div>

        <div class=button-row style="margin: 0.5em 0">
            <a class="icon-button disable-ui-button popup pixiv-only" data-popup="Return to Pixiv" href="#no-ppixiv">
                ${ helpers.create_icon("ppixiv:pixiv") }
            </a>

            <div class="view-manga-button popup" data-popup="View manga pages">
                <div class="icon-button">
                    ${ helpers.create_icon("ppixiv:thumbnails") }
                </div>
            </div>

            <div class="download-button download-image-button popup pixiv-only" data-download="image" data-popup="Download image">
                <div class="icon-button button enabled">
                    <ppixiv-inline src="resources/download-icon.svg"></ppixiv-inline>
                </div>
            </div>

            <div class="download-button download-manga-button popup pixiv-only" data-download="ZIP" data-popup="Download ZIP of all images">
                <div class="icon-button button enabled">
                    <ppixiv-inline src="resources/download-manga-icon.svg"></ppixiv-inline>
                </div>
            </div>

            <div class="download-button download-video-button popup pixiv-only" data-download="MKV" data-popup="Download MKV">
                <div class="icon-button button enabled">
                    <ppixiv-inline src="resources/download-icon.svg"></ppixiv-inline>
                </div>
            </div>

            <div class=button-container>
                <!-- position: relative positions the bookmark count. -->
                <div class="button icon-button button-bookmark public popup" data-bookmark-type=public style="position: relative;">
                    <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                    <div class=count></div>
                </div>
            </div>

            <div class="button icon-button button-bookmark private popup button-container" data-bookmark-type=private>
                <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
            </div>
            
            <div style="position: relative;">
                <div class="button icon-button button-bookmark-tags popup" data-popup="Bookmark tags">
                    ${ helpers.create_icon("ppixiv:tag") }
                    <div style="position: absolute; bottom: 2px; left: 4px;">
                        <div class=tag-dropdown-arrow hidden></div>
                    </div>
                </div>
            </div>

            <div class="button icon-button button-like enabled popup button-container" style="position: relative;">
                <ppixiv-inline src="resources/like-button.svg"></ppixiv-inline>

                <div class=count></div>
            </div>

            <a class="similar-illusts-button popup pixiv-only" data-popup="Similar illustrations" href=#>
                <div class=icon-button>
                    ${ helpers.create_icon("ppixiv:suggestions") }
                </div>
            </a>

            <a class="similar-artists-button popup pixiv-only" data-popup="Similar artists" href=#>
                <div class=icon-button>
                    ${ helpers.create_icon("ppixiv:suggestions") }
                </div>
            </a>

            <a class="similar-bookmarks-button popup pixiv-only" data-popup="Similar bookmarks" href=#>
                <div class=icon-button>
                    ${ helpers.create_icon("ppixiv:suggestions") }
                </div>
            </a>

            <div class="image-settings-menu-box popup" data-popup="Preferences">
                <div class="icon-button preferences-button">
                    ${ helpers.create_icon("settings") }
                </div>
            </div>
        </div>
        <div class=post-info>
            <div class="post-age popup" hidden></div>
            <div class=image-info hidden></div>
            <div class=page-count hidden></div>
            <div class=ugoira-duration hidden></div>
            <div class=ugoira-frames hidden></div>
        </div>
        
        <div class="tag-list box-button-row"></div>
        <div class=description></div>
    </div>
</div>
        `});

        // ui-box is the real container.  THe outer div is just so hover-sphere isn't inside
        // the scroller.
        this.ui_box = this.container.querySelector(".ui-box");

        this.avatar_widget = new avatar_widget({
            container: this.container.querySelector(".avatar-popup"),
            mode: "dropdown",
            dropdownvisibilitychanged: () => {
                this.refresh_overlay_ui_visibility();
            },
        });

        this.tag_widget = new tag_widget({
            contents: this.container.querySelector(".tag-list"),
        });

        media_cache.addEventListener("mediamodified", this.refresh, { signal: this.shutdown_signal.signal });
        
        this.like_button = new like_button_widget({
            contents: this.container.querySelector(".button-like"),
        });
        this.like_count_widget = new like_count_widget({
            contents: this.container.querySelector(".button-like .count"),
        });
        this.bookmark_count_widget = new bookmark_count_widget({
            contents: this.container.querySelector(".button-bookmark .count"),
        });
        this.manga_page_bar = new progress_bar({container: this.ui_box}).controller();

        // The bookmark buttons, and clicks in the tag dropdown:
        this.bookmark_buttons = [];
        for(let a of this.container.querySelectorAll("[data-bookmark-type]"))
            this.bookmark_buttons.push(new bookmark_button_widget({
                contents: a,
                bookmark_type: a.dataset.bookmarkType,
            }));

        let bookmark_tags_button = this.container.querySelector(".button-bookmark-tags");
        this.bookmark_tags_dropdown_opener = new ppixiv.bookmark_tag_dropdown_opener({
            parent: this,
            bookmark_tags_button,
            bookmark_buttons: this.bookmark_buttons,

            // The dropdown affects visibility, so refresh when it closes.
            onvisibilitychanged: () => {
                this.refresh_overlay_ui_visibility();
            },
        });

        for(let button of this.container.querySelectorAll(".download-button"))
            button.addEventListener("click", this.clicked_download);
        this.container.querySelector(".download-manga-button").addEventListener("click", this.clicked_download);
        this.container.querySelector(".view-manga-button").addEventListener("click", (e) => {
            main_controller.navigate_out();
        });

        // Don't propagate wheel events if the contents can scroll, so moving the scroller doesn't change the
        // image.  Most of the time the contents will fit, so allow changing the page if there's no need to
        // scroll.
        this.ui_box.addEventListener("wheel", (e) => {
            if(this.ui_box.scrollHeight > this.ui_box.offsetHeight)
                e.stopPropagation();
        }, { passive: false });

        this.container.querySelector(".preferences-button").addEventListener("click", (e) => {
            new ppixiv.settings_dialog();
        });

        // Show on hover.
        this.ui_box.addEventListener("mouseenter", (e) => { this.hovering_over_box = true; this.refresh_overlay_ui_visibility(); });
        this.ui_box.addEventListener("mouseleave", (e) => { this.hovering_over_box = false; this.refresh_overlay_ui_visibility(); });

        let hover_circle = this.querySelector(".hover-circle");
        hover_circle.addEventListener("mouseenter", (e) => { this.hovering_over_sphere = true; this.refresh_overlay_ui_visibility(); });
        hover_circle.addEventListener("mouseleave", (e) => { this.hovering_over_sphere = false; this.refresh_overlay_ui_visibility(); });
        settings.addEventListener("image_editing", () => { this.refresh_overlay_ui_visibility(); });
        settings.addEventListener("image_editing_mode", () => { this.refresh_overlay_ui_visibility(); });
        ClassFlags.get.addEventListener("hide-ui", () => this.refresh_overlay_ui_visibility(), this._signal);

        this.refresh_overlay_ui_visibility();
    }

    refresh_overlay_ui_visibility()
    {
        // Hide widgets inside the hover UI when it's hidden.
        let visible = this.hovering_over_box || this.hovering_over_sphere;

        // Don't show the hover UI while editing, since it can get in the way of trying to
        // click the image.
        let editing = settings.get("image_editing") && settings.get("image_editing_mode") != null;
        if(editing)
            visible = false;

        // Stay visible if the bookmark tag dropdown or the follow dropdown are visible.
        if(this.bookmark_tags_dropdown_opener?.visible || this.avatar_widget.follow_dropdown_opener.visible)
            visible = true;

        if(ClassFlags.get.get("hide-ui"))
            visible = false;
        
        // Tell the image UI when it's visible.
        this.visible = visible;

        // Hide the UI's container too when we're editing, so the hover boxes don't get in
        // the way.
        this.container.hidden = editing || ppixiv.mobile;
    }

    apply_visibility()
    {
        helpers.set_class(this.container.querySelector(".ui-box"), "ui-hidden", this._visible);
    }

    visibility_changed()
    {
        super.visibility_changed();

        this.refresh();
    }

    set data_source(data_source)
    {
        if(this._data_source == data_source)
            return;

        this._data_source = data_source;
        this.refresh();
    }
    
    get media_id()
    {
        return this._media_id;
    }

    set media_id(media_id)
    {
        if(this._media_id == media_id)
            return;
        this._media_id = media_id;

        this.illust_data = null;
        this.refresh();
    }

    get displayed_page()
    {
        return helpers.parse_media_id(this._media_id).page;
    }

    handle_onkeydown(e)
    {
    }

    refresh = async() =>
    {
        helpers.set_class(this.container, "disabled", !this.visible);

        // Don't do anything if we're not visible.
        if(!this.visible)
            return;

        // Update widget illust IDs.
        this.like_button.set_media_id(this._media_id);
        this.like_count_widget.set_media_id(this._media_id);
        this.bookmark_count_widget.set_media_id(this._media_id);
        for(let button of this.bookmark_buttons)
            button.set_media_id(this._media_id);
        this.bookmark_tags_dropdown_opener.set_media_id(this._media_id);

        this.illust_data = null;
        if(this._media_id == null)
            return;

        // We need image info to update.
        let media_id = this._media_id;
        let illust_info = await media_cache.get_media_info(this._media_id);

        // Check if anything changed while we were loading.
        if(illust_info == null || media_id != this._media_id || !this.visible)
            return;

        this.illust_data = illust_info;

        let [illust_id] = helpers.media_id_to_illust_id_and_page(this._media_id);
        let user_id = illust_info.userId;

        // Show the author if it's someone else's post, or the edit link if it's ours.
        var our_post = global_data.user_id == user_id;
        this.container.querySelector(".author-block").hidden = our_post;
        this.container.querySelector(".edit-post").hidden = !our_post;
        this.container.querySelector(".edit-post").href = "/member_illust_mod.php?mode=mod&illust_id=" + illust_id;

        this.avatar_widget.set_user_id(user_id);
        this.tag_widget.set(illust_info.tagList);

        var element_title = this.container.querySelector(".title");
        element_title.textContent = illust_info.illustTitle;
        element_title.href = helpers.get_url_for_id(this._media_id).url;

        // Show the folder if we're viewing a local image.
        let folder_text_element = this.container.querySelector(".folder-text");
        let show_folder = helpers.is_media_id_local(this._media_id);
        if(show_folder)
        {
            let {id} = helpers.parse_media_id(this.media_id);
            folder_text_element.innerText = helpers.get_path_suffix(id, 2, 1); // last two parent directories

            let parent_folder_id = local_api.get_parent_folder(id);
            let args = new helpers.args("/", ppixiv.plocation);
            local_api.get_args_for_id(parent_folder_id, args);
            folder_text_element.href = args.url;
        }

        // If the author name or folder are empty, hide it instead of leaving it empty.
        this.container.querySelector(".author-block").hidden = illust_info.userName == "";
        this.container.querySelector(".folder-block").hidden = !show_folder;
        var element_author = this.container.querySelector(".author");
        if(illust_info.userName != "")
            element_author.textContent = illust_info.userName;

        element_author.href = `/users/${user_id}#ppixiv`;
        
        this.container.querySelector(".similar-illusts-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv?recommendations=1";
        this.container.querySelector(".similar-artists-button").href = "/discovery/users#ppixiv?user_id=" + user_id;
        this.container.querySelector(".similar-bookmarks-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv";

        // Fill in the post info text.
        this.set_post_info(this.container.querySelector(".post-info"));

        // The comment (description) can contain HTML.
        var element_comment = this.container.querySelector(".description");
        element_comment.hidden = illust_info.illustComment == "";
        element_comment.innerHTML = illust_info.illustComment;
        helpers.fix_pixiv_links(element_comment);
        helpers.make_pixiv_links_internal(element_comment);

        // Set the download button popup text.
        let download_image_button = this.container.querySelector(".download-image-button");
        download_image_button.hidden = !actions.is_download_type_available("image", illust_info);

        let download_manga_button = this.container.querySelector(".download-manga-button");
        download_manga_button.hidden = !actions.is_download_type_available("ZIP", illust_info);

        let download_video_button = this.container.querySelector(".download-video-button");
        download_video_button.hidden = !actions.is_download_type_available("MKV", illust_info);
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
        set_info(".post-age", helpers.age_to_string(seconds_old));
        post_info_container.querySelector(".post-age").dataset.popup = helpers.date_to_string(illust_data.createDate);

        var info = "";

        // Add the resolution and file type if available.
        if(this.displayed_page != null && this.illust_data != null)
        {
            var page_info = this.illust_data.mangaPages[this.displayed_page];
            info += page_info.width + "x" + page_info.height;

            // For illusts, add the image type.  Don't do this for animations.
            if(this.illust_data.illustType != 2)
            {
                let url = new URL(page_info.urls?.original);
                let ext = helpers.get_extension(url.pathname).toUpperCase();
                if(ext)
                    info += " " + ext;
            }
        }

        set_info(".image-info", info);

        var duration = "";
        if(illust_data.ugoiraMetadata)
        {
            var seconds = 0;
            for(var frame of illust_data.ugoiraMetadata.frames)
                seconds += frame.delay / 1000;

            var duration = seconds.toFixed(duration >= 10? 0:1);
            duration += seconds == 1? " second":" seconds";
        }
        set_info(".ugoira-duration", duration);
        set_info(".ugoira-frames", illust_data.ugoiraMetadata? (illust_data.ugoiraMetadata.frames.length + " frames"):"");

        // Add the page count for manga.
        var page_text = "";
        if(illust_data.pageCount > 1 && this.displayed_page != null)
            page_text = "Page " + (this.displayed_page+1) + "/" + illust_data.pageCount;
        set_info(".page-count", page_text);
    }

    clicked_download = (e) =>
    {
        if(this.illust_data == null)
            return;

        var clicked_button = e.target.closest(".download-button");
        if(clicked_button == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        let download_type = clicked_button.dataset.download;
        actions.download_illust(this._media_id, download_type, this.displayed_page);
    }
 }

