"use strict";

// The image UI for mobile.
let mobile_illust_ui_top_page = class extends ppixiv.widget
{
    constructor({template, ...options})
    {
        super({...options, visible: true, template: `
                <div class=mobile-illust-ui-page>
                    <div class="item button-toggle-slideshow enabled">
                        ${ helpers.create_icon("mat:wallpaper") }
                        <span class=label>Slideshow</span>
                    </div>

                    <div class="item button-toggle-loop enabled">
                        ${ helpers.create_icon("mat:replay_circle_filled") }
                        <span class=label>Loop</span>
                    </div>

                    <div class="item button-bookmark">
                        <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                        <span class=label>Bookmark</span>
                    </div>

                    <div class="item button-similar enabled">
                        ${ helpers.create_icon("ppixiv:suggestions") }
                        <span class=label>Similar</span>
                    </div>

                    <div class="item button-more enabled">
                        ${ helpers.create_icon("settings") }
                        <span class=label>More...</span>
                    </div>

                    <div class="item button-view-manga enabled">
                        ${ helpers.create_icon("ppixiv:thumbnails") }
                        <span class=label>Pages</span>
                    </div>
                </div>
        `});

        this._media_id = null;

        this.container.querySelector(".button-view-manga").addEventListener("click", this.clicked_view_manga);

        this.toggle_slideshow_button = this.container.querySelector(".button-toggle-slideshow");
        this.toggle_slideshow_button.addEventListener("click", (e) => {
            main_controller.toggle_slideshow();
            this.parent.hide();
            this.refresh();
        });

        this.toggle_loop_button = this.container.querySelector(".button-toggle-loop");
        this.toggle_loop_button.addEventListener("click", (e) => {
            main_controller.loop_slideshow();
            this.parent.hide();
            this.refresh();
        });
        
        this.container.querySelector(".button-more").addEventListener("click", (e) => {
            new mobile_illust_ui_more_options_dialog({
                media_id: this._media_id
            });

            this.parent.hide();
        });

        this.button_bookmark = this.container.querySelector(".button-bookmark");
        this.bookmark_button_widget = new bookmark_button_display_widget({
            contents: this.button_bookmark,
        });

        this.button_similar = this.container.querySelector(".button-similar");
        this.button_similar.hidden = ppixiv.native;
        this.button_similar.addEventListener("click", (e) => {
            let [illust_id] = helpers.media_id_to_illust_id_and_page(this._media_id);
            let args = new helpers.args(`/bookmark_detail.php?illust_id=${illust_id}#ppixiv?recommendations=1`);
            helpers.navigate(args);
        });

        this.button_bookmark.addEventListener("click", (e) => {
            new mobile_overlay_bookmark_tag_dialog({
                media_id: this._media_id
            });
            
            this.parent.hide();
        });

        // This tells widgets that want to be above us how tall we are.
        this.refresh_video_height();
        this.resize_observer = new ResizeObserver(() => this.refresh_video_height());
        this.resize_observer.observe(this.container);
        this.shutdown_signal.signal.addEventListener("abort", () => this.resize_observer.disconnect());
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        this.data_source = data_source;

        this.refresh();
    }

    set media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;
        this.refresh();
    }

    refresh()
    {
        super.refresh();

        // If we're not visible, don't refresh an illust until we are, so we don't trigger
        // data loads.  Do refresh even if we're hidden if we have no illust to clear
        // the previous illust's display even if we're not visible, so it's not visible the
        // next time we're displayed.
        if(!this.visible && this._media_id != null)
            return

        let button_view_manga = this.container.querySelector(".button-view-manga");
        button_view_manga.dataset.popup = "View manga pages";
        button_view_manga.hidden = !main_controller.navigate_out_enabled;

        helpers.set_class(this.toggle_slideshow_button, "selected", main_controller.slideshow_mode == "1");
        helpers.set_class(this.toggle_loop_button, "selected", main_controller.slideshow_mode == "loop");
        helpers.set_class(this.container.querySelector(".button-bookmark"), "enabled", true);

        // If we're visible, tell widgets what we're viewing.  Don't do this if we're not visible, so
        // they don't load data unnecessarily.  Don't set these back to null if we're hidden, so they
        // don't blank themselves while we're still fading out.
        if(this.visible)
        {
            let media_id = this._media_id;
            this.bookmark_button_widget.set_media_id(media_id);
        }
    }

    refresh_video_height()
    {
        document.documentElement.style.setProperty("--menu-bar-height", `${this.container.offsetHeight}px`);
    }

    // Return the illust ID whose parent the parent button will go to.
    get folder_id_for_parent()
    {
        return this._media_id || this.data_source?.viewing_folder;
    }

    // Return the folder ID that the parent button goes to.
    // XXX: merge somewhere with main_context_menu
    get parent_folder_id()
    {
        let folder_id = this.folder_id_for_parent;
        let is_local = helpers.is_media_id_local(folder_id);
        if(!is_local)
            return null;

        // Go to the parent of the item that was clicked on. 
        let parent_folder_id = local_api.get_parent_folder(folder_id);

        // If the user right-clicked a thumbnail and its parent is the folder we're
        // already displaying, go to the parent of the folder instead (otherwise we're
        // linking to the page we're already on).  This makes the parent button make
        // sense whether you're clicking on an image in a search result (go to the
        // location of the image), while viewing an image (also go to the location of
        // the image), or in a folder view (go to the folder's parent).
        let currently_displaying_id = local_api.get_local_id_from_args(helpers.args.location);
        if(parent_folder_id == currently_displaying_id)
            parent_folder_id = local_api.get_parent_folder(parent_folder_id);

        return parent_folder_id;
    }

    clicked_view_manga = (e) =>
    {
        main_controller.navigate_out();
    }
}

class mobile_overlay_bookmark_tag_dialog extends ppixiv.dialog_widget
{
    constructor({media_id, ...options})
    {
        super({...options, dialog_class: "mobile-tag-list", header: "Bookmark illustration", template: `
            <div class=menu-bar>
                <div class="item button-bookmark public">
                    <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                </div>

                <div class="item button-bookmark private button-container">
                    <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                </div>

                <div class="button-bookmark item button-remove-bookmark icon-button">
                    ${ helpers.create_icon("mat:delete") }
                </div>
            </div>
        `});

        this.tag_list_widget = new bookmark_tag_list_widget({
            container: this.container.querySelector(".scroll"),
            container_position: "afterbegin",
            public_bookmark_button: this.public_bookmark,
            private_bookmark_button: this.private_bookmark,
        });

        let public_bookmark = this.container.querySelector(".public");
        this.public_bookmark = new bookmark_button_widget({
            contents: public_bookmark,
            bookmark_type: "public",
            onedited: () => this.visible = false,

            // Instead of deleting the bookmark, save tag changes when these bookmark buttons
            // are clicked.
            toggle_bookmark: false,

            // Close if a bookmark button is clicked.
            bookmark_tag_list_widget: this.tag_list_widget,
        });

        if(!ppixiv.native)
        {
            let private_bookmark = this.container.querySelector(".private");
            this.private_bookmark = new bookmark_button_widget({
                contents: private_bookmark,
                bookmark_type: "private",
                onedited: () => this.visible = false,
                toggle_bookmark: false,
                bookmark_tag_list_widget: this.tag_list_widget,
            });
        }

        let delete_bookmark = this.container.querySelector(".button-remove-bookmark");
        this.delete_bookmark = new bookmark_button_widget({
            contents: delete_bookmark,
            bookmark_type: "delete",
            onedited: () => this.visible = false,
            bookmark_tag_list_widget: this.tag_list_widget,
        });

        this.tag_list_widget.set_media_id(media_id);
        this.public_bookmark.set_media_id(media_id);
        this.delete_bookmark.set_media_id(media_id);
        if(this.private_bookmark)
            this.private_bookmark.set_media_id(media_id);
    }

    visibility_changed()
    {
        super.visibility_changed();

        // Let the tag list know when it's hidden, so it knows to save changes.
        this.tag_list_widget.visible = this.actually_visible;
    }
}

class mobile_illust_ui_more_options_dialog extends dialog_widget
{
    constructor({template, media_id, ...options})
    {
        super({...options, dialog_type: "small", header: "More", classes: ['mobile-illust-ui-dialog'], template: `
            <div class=box>
            </div>
        `});

        this.more_options_widget = new more_options_dropdown_widget({
            container: this.container.querySelector(".box"),
            visible: true,
        });
        this.more_options_widget.set_media_id(media_id);
    }

    get content_node() { return this.more_options_widget.container; }

    // more_options_widget items can call hide() on us when it's clicked.
    hide()
    {
        this.visible = false;
    }
}

// The container for the mobile image UI.  This just creates and handles displaying
// the tabs.
ppixiv.mobile_illust_ui = class extends ppixiv.widget
{
    constructor({
        onclose,

        // This node receives our drag animation property.  This goes on the screen instead of
        // us, so the video UI can see it too.
        transition_target,

        ...options
    })
    {
        super({...options, template: `
            <div class=mobile-illust-ui-container>
                <div class=context-menu-image-info-container></div>
            </div>
        `});
        
        this.transition_target = transition_target;

        this.info_widget = new image_info_widget({
            container: this.container.querySelector(".context-menu-image-info-container"),
        });

        this.onclose = onclose;
        this.page = new mobile_illust_ui_top_page({
            container: this.container,
        });
        
        new view_hidden_listener(this.container, () => {
            this.hide();
        }, { signal: this.shutdown_signal.signal });

        let menu_bar = this.page.container.querySelector(".mobile-illust-ui-page");
        this.dragger = new WidgetDragger({
            name: "menu-dragger",
            // Put the --menu-bar-pos property up high, since the video UI also uses it.
            node: [this.transition_target],
            drag_node: this.container.parentNode,
            size: () => menu_bar.offsetHeight,
            animated_property: "--menu-bar-pos",
            direction: "down",
            onpointerdown: ({event}) => {
                // This is just used for animations, not for dragging.
                return false;
            },
            onbeforeshown: () => this.visibility_changed(),
            onafterhidden: () => this.visibility_changed(),
            onanimationfinished: () => this.visibility_changed(),
        });

        // Listen for the image viewer changing.  This is used for zooming.
        ppixiv.image_viewer_base.primary_changed.addEventListener("changed", (e) => {
            this.on_click_viewer = e.viewer;
        }, { signal: this.shutdown_signal.signal });

        this._media_id = null;

        this.refresh();
    }

    set media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;
        this.info_widget.set_media_id(media_id);
        this.page.media_id = media_id;

        this.refresh();
    }
    get media_id() { return this._media_id; }

    // Set the current viewer, or null if none.  If set, we'll activate zoom controls.
    set on_click_viewer(viewer)
    {
        this.page.on_click_viewer = viewer;
    }

    set_data_source(data_source)
    {
        this.page.set_data_source(data_source);
    }

    get actually_visible()
    {
        return this.dragger.visible;
    }
    
    visibility_changed()
    {
        super.visibility_changed();

        let visible = this.actually_visible;

        // Only hide if we're actually not visible, so we're hidden if we're offscreen but
        // visible for transitions.
        this.container.hidden = !visible;

        if(visible)
        {
            if(this.click_outside_listener == null)
            {
                this.click_outside_listener = new click_outside_listener([this.container], (element) => {
                    // Don't close the UI if the click is inside an element with the no-close-ui
                    // class.
                    if(element.closest(".no-close-ui"))
                        return;
                    this.hide();
                });
            }            
        }
        else
        {
            if(this.click_outside_listener != null)
            {
                this.click_outside_listener.shutdown();
                this.click_outside_listener = null;
            }

            // Tell the caller that we're closing.
            if(this.onclose)
                this.onclose();
        }

        this.refresh();
    }

    show()
    {
        this.dragger.show();        
    }

    hide()
    {
        this.dragger.hide();        
    }

    refresh()
    {
        // Set data-mobile-ui-visible if we're fully visible so other UIs can tell if this UI is
        // open.
        let fully_visible = this.dragger.position == 1;
        ClassFlags.get.set("mobile-ui-visible", fully_visible);

        // Add ourself to OpenWidgets if we're visible at all.
        let visible = this.actually_visible;
        ppixiv.OpenWidgets.singleton.set(this, visible);

        this.page.refresh();
    }
}

let image_info_widget = class extends ppixiv.illust_widget
{
    constructor({...options})
    {
        super({ ...options, template: `
            <div class=image-info>
                <div class=avatar></div>

                <div class=info-text>
                    <div class=title-text-block>
                        <span class=folder-block hidden>
                            <span class=folder-text></span>
                            <span class=slash">/</span>
                        </span>
                        <span class=title hidden></span>
                    </div>
                    <div class=page-count hidden></div>
                    <div class=image-info-text hidden></div>
                    <div class="post-age popup" hidden></div>
                    <div class=mobile-tag-overlay>
                        <div class=bookmark-tags></div>
                    </div>
                </div>

            </div>
        `});

        this.avatar_widget = new avatar_widget({
            container: this.container.querySelector(".avatar"),
            mode: "dropdown",
            interactive: false,
        });
        this.container.querySelector(".avatar").hidden = ppixiv.native;
    }

    get needed_data()
    {
        // We need illust info if we're viewing a manga page beyond page 1, since
        // early info doesn't have that.  Most of the time, we only need early info.
        if(this._page == null || this._page == 0)
            return "partial";
        else
            return "full";
    }

    set show_page_number(value)
    {
        this._show_page_number = value;
        this.refresh();
    }

    refresh_internal({ media_id, media_info })
    {
        this.container.hidden = media_info == null;
        if(this.container.hidden)
            return;

        this.avatar_widget.set_user_id(media_info?.userId);

        let tag_widget = this.container.querySelector(".bookmark-tags");
        helpers.remove_elements(tag_widget);
        if(media_info.bookmarkData?.tags)
        {
            for(let tag of media_info.bookmarkData.tags)
            {
                let entry = this.create_template({name: "tag-entry", html: `
                    <div class="mobile-ui-tag-entry">
                        ${ helpers.create_icon("ppixiv:tag", { classes: ["bookmark-tag-icon"] }) }
                        <span class=tag-name></span>
                    </div>
                `});

                entry.querySelector(".tag-name").innerText = tag;
                tag_widget.appendChild(entry);
            }
        }

        let set_info = (query, text) =>
        {
            let node = this.container.querySelector(query);
            node.innerText = text;
            node.hidden = text == "";
        };
        
        // Add the page count for manga.  If the data source is data_source.vview, show
        // the index of the current file if it's loaded all results.
        let current_page = this._page;
        let page_count = media_info.pageCount;
        let show_page_number = this._show_page_number;
        if(this.data_source?.name == "vview" && this.data_source.all_pages_loaded)
        {
            let page = this.data_source.id_list.get_page_for_illust(media_id);
            let ids = this.data_source.id_list.media_ids_by_page.get(page);
            if(ids != null)
            {
                current_page = ids.indexOf(media_id);
                page_count = ids.length;
                show_page_number = true;
            }
        }

        let page_text = "";
        if(page_count > 1)
        {
            if(show_page_number || current_page > 0)
                page_text = `Page ${current_page+1}/${page_count}`;
            else
                page_text = `${page_count} pages`;
        }
        set_info(".page-count", page_text);

        set_info(".title", media_info.illustTitle);
    
        let show_folder = helpers.is_media_id_local(this._media_id);
        this.container.querySelector(".folder-block").hidden = !show_folder;
        if(show_folder)
        {
            let {id} = helpers.parse_media_id(this._media_id);
            this.container.querySelector(".folder-text").innerText = helpers.get_path_suffix(id, 1, 1); // parent directory
        }

        // If we're on the first page then we only requested early info, and we can use the dimensions
        // on it.  Otherwise, get dimensions from mangaPages from illust data.  If we're displaying a
        // manga post and we don't have illust data yet, we don't have dimensions, so hide it until
        // it's loaded.
        var info = "";
        let { width, height } = ppixiv.media_cache.get_dimensions(media_info, this._media_id);
        if(width != null && height != null)
            info += width + "x" + height;
        set_info(".image-info-text", info);

        let seconds_old = (new Date() - new Date(media_info.createDate)) / 1000;
        let age = helpers.age_to_string(seconds_old);
        this.container.querySelector(".post-age").dataset.popup = helpers.date_to_string(media_info.createDate);
        set_info(".post-age", age);
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        this.data_source = data_source;
        this.refresh();
    }
}
