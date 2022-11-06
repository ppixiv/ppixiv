"use strict";

// The image UI for mobile.  This is similar to main_context_menu, but the UI is
// different enough for mobile that it's implemented separately.


let mobile_illust_ui_page = class extends ppixiv.widget
{
    constructor({template, ...options})
    {
        super({...options, template});
    }

    set media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;
        this.refresh();
    }

    set_data_source(data_source) { }

    refresh() { }
    
    show_tab({pos}={})
    {
        helpers.set_class(this.container, "active-tab", true);

        if(pos)
            this.align_to(pos);
    }

    hide_tab()
    {
        helpers.set_class(this.container, "active-tab", false);
    }

    // Try to center content around the given viewport Y position.
    align_to(pos)
    {
        let content_node = this.content_node;
        if(content_node == null)
            return;
        
        content_node.marginTop = ``;

        let content_height = content_node.offsetHeight;

        // If the content is larger than the available space, remove the top padding entirely.
        let available_height = this.container.offsetParent.offsetHeight;
        if(available_height < content_height)
            return;

        // console.log(`height ${this.container.offsetHeight} parent ${available_height} content ${content_height}`);

        let offset_to_center = pos - content_height/2;
        if(offset_to_center < 0)
            return;

        content_node.style.marginTop = `${offset_to_center}px`;
    }
}

let mobile_illust_ui_top_page = class extends mobile_illust_ui_page
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

                <div class="item button-bookmark public" data-bookmark-type=public>
                    <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                    <span class=label>Bookmark</span>
                </div>

                <div class="item button-bookmark private button-container" data-bookmark-type=private>
                    <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                    <span class=label>Bookmark privately</span>
                </div>
                
                <div class="item button-bookmark-tags">
                    ${ helpers.create_icon("ppixiv:tag") }
                    <span class=label>Tags</span>
                </div>

                <div class="item button-more enabled">
                    ${ helpers.create_icon("settings") }
                    <span class=label>More...</span>
                </div>

                <div class="item button-like enabled button-container">
                    <ppixiv-inline src="resources/like-button.svg"></ppixiv-inline>
                    <span class=label>Like</span>
                </div>

                <div class="item button-view-manga enabled">
                    ${ helpers.create_icon("ppixiv:thumbnails") }
                    <span class=label>View manga pages</span>
                </div>

                <div class="item button-back" hidden>
                    ${ helpers.create_icon("folder") }
                    <span class=label>View folder</span>
                </div>
            </div>
        `});

        this._media_id = null;
        this._on_click_viewer = null;

        this.container.querySelector(".button-view-manga").addEventListener("click", this.clicked_view_manga);

        this.container.querySelector(".button-back").addEventListener("click", () => main_controller.navigate_to_search());

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
        
        this.avatar_widget = new avatar_widget({
            container: this.container.querySelector(".avatar-widget-container"),
            mode: "overlay",
        });

        this.container.querySelector(".button-more").addEventListener("click", (e) => {
            new mobile_illust_ui_more_options_dialog({
                media_id: this._media_id
            });

            this.parent.hide();
        });

        this.container.querySelector(".button-bookmark-tags").addEventListener("click", (e) => {
            new mobile_overlay_bookmark_tag_dialog({
                media_id: this._media_id
            });
            
            this.parent.hide();
        });

        this.illust_widgets = [
            this.avatar_widget,
            new like_button_widget({
                parent: this,
                contents: this.container.querySelector(".button-like"),
            }),
        ];

        // The bookmark buttons, and clicks in the tag dropdown:
        for(let a of this.container.querySelectorAll("[data-bookmark-type]"))
        {
            this.illust_widgets.push(new bookmark_button_widget({
                parent: this,
                contents: a,
                bookmark_type: a.dataset.bookmarkType,
            }));
        }

        // This tells widgets that want to be above us how tall we are.
        this.refresh_video_height();
        this.resize_observer = new ResizeObserver(() => this.refresh_video_height());
        this.resize_observer.observe(this.container);
        this.shutdown_signal.signal.addEventListener("abort", () => this.resize_observer.disconnect());
    }

    get _is_zoom_ui_enabled()
    {
        return this._on_click_viewer != null;
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        this.data_source = data_source;

        for(let widget of this.illust_widgets)
        {
            if(widget.set_data_source)
                widget.set_data_source(data_source);
        }

        this.refresh();
    }

    // Set the current viewer, or null if none.  If set, we'll activate zoom controls.
    set on_click_viewer(viewer)
    {
        this._on_click_viewer = viewer;
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
        helpers.set_class(this.container.querySelector(".button-bookmark-tags"), "enabled", true);

        // If we're visible, tell widgets what we're viewing.  Don't do this if we're not visible, so
        // they don't load data unnecessarily.  Don't set these back to null if we're hidden, so they
        // don't blank themselves while we're still fading out.
        if(this.visible)
        {
            let media_id = this._media_id;
            for(let widget of this.illust_widgets)
            {
                if(widget.set_media_id)
                    widget.set_media_id(media_id);

                widget.show_page_number = true;
            }

            // If we're on a local ID, show the parent folder button.
            let back_button = this.container.querySelector(".button-back");
            let is_local = helpers.is_media_id_local(this.folder_id_for_parent);
            back_button.hidden = !is_local;
            helpers.set_class(back_button, "enabled", this.parent_folder_id != null);
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
        super({...options, dialog_class: "mobile-tag-list", header: "Bookmark tags", template: `
            <div class=scroll></div>
        `});

        this.tag_list_widget = new bookmark_tag_list_widget({
            parent: this,
            container: this.container.querySelector(".scroll"),
        });

        this.tag_list_widget.set_media_id(media_id);
    }

    set_data_source(data_source)
    {
        this.tag_list_widget.data_source = data_source;
    }

    visibility_changed()
    {
        super.visibility_changed();

        // Let the tag list know when it's hidden, so it knows to save changes.
        this.tag_list_widget.visible = this.visible;
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
            parent: this,
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

// We can only show tags when running natively, since bookmark tags aren't always loaded
// on Pixiv.  This is only used for the mobile UI.
class mobile_overlay_bookmark_tag_widget extends ppixiv.illust_widget
{
    constructor({...options})
    {
        super({ ...options, template: `
            <div class=mobile-bookmark-tag-overlay>
                <div class=bookmark-tags></div>
            </div>
        `});
    }

    refresh_internal({ media_info })
    {
        this.container.hidden = media_info == null;
        if(this.container.hidden)
            return;

        let tag_widget = this.container.querySelector(".bookmark-tags");
        helpers.remove_elements(tag_widget);
        if(!media_info.bookmarkData?.tags)
            return;

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

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        this.data_source = data_source;
        this.refresh();
    }
}

// The container for the mobile image UI.  This just creates and handles displaying
// the tabs.
ppixiv.mobile_illust_ui = class extends ppixiv.widget
{
    constructor({
        onclose,
        ...options
    })
    {
        super({...options, template: `
            <div class=mobile-illust-ui-container>
                <div class=context-menu-image-info-container></div>
            </div>
        `});
        
        this.info_widget = new context_menu_image_info_widget({
            parent: this,
            container: this.container.querySelector(".context-menu-image-info-container"),
            show_title: true,
        });

        this.bookmark_tag_list_widget = new mobile_overlay_bookmark_tag_widget({
            parent: this,
            container: this.container.querySelector(".context-menu-image-info-container"),
        });

        this.onclose = onclose;
        this.page = new mobile_illust_ui_top_page({
            container: this.container,
            parent: this,
        });
        
        new view_hidden_listener(this.container, () => {
            this.hide();
        }, { signal: this.shutdown_signal.signal });

        // Listen for the image viewer changing.  This is used for zooming.
        ppixiv.image_viewer_base.primary_changed.addEventListener("changed", (e) => {
            this.on_click_viewer = e.viewer;
        }, { signal: this.shutdown_signal.signal });

        this._media_id = null;

        this.refresh();
    }

    visibility_changed()
    {
        super.visibility_changed();
    }

    set media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;
        this.info_widget.set_media_id(media_id);
        this.bookmark_tag_list_widget.set_media_id(media_id);
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

    show()
    {
        if(this.shown)
            return;
        this.shown = true;

        // If we're becoming visible, create our click_outside_listener.
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

        this.page.show_tab();

        // Make sure we're up to date if we deferred an update while hidden.
        this.refresh();
    }

    hide()
    {
        if(!this.shown)
            return;
        this.shown = false;

        // If we're becoming hidden, remove our click_outside_listener.
        if(this.click_outside_listener != null)
        {
            this.click_outside_listener.shutdown();
            this.click_outside_listener = null;
        }

        if(this.swipe_out_handler != null)
        {
            this.swipe_out_handler.shutdown();
            this.swipe_out_handler = null;
        }

        this.page.hide_tab();

        this.refresh();

        // Tell the caller that we're closing.
        if(this.onclose)
            this.onclose();
    }

    refresh()
    {
        // Set data-mobile-ui-visible so other UIs can tell if this UI is open.
        ClassFlags.get.set("mobile-ui-visible", this.shown);
        helpers.set_class(this.container, "shown", this.shown);

        this.page.refresh();

        ppixiv.OpenWidgets.singleton.set(this, this.shown);
    }
}

