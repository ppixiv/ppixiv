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
    
    show_tab()
    {
        helpers.set_class(this.container, "active-tab", true);
    }

    hide_tab()
    {
        helpers.set_class(this.container, "active-tab", false);
    }
}

let mobile_illust_ui_page_more  = class extends mobile_illust_ui_page
{
    constructor({template, ...options})
    {
        super({...options, visible: true, template: `
            <div class=mobile-illust-ui-page>
            </div>
        `});

        this.more_options_widget = new more_options_dropdown_widget({
            parent: this,
            container: this.container,
            visible: true,
        });

    }

    // more_options_widget items can call hide() on us when it's clicked.  Hide the top-level menu.
    hide()
    {
        this.parent.hide();
    }

    set media_id(media_id)
    {
        super.media_id = media_id;
        this.more_options_widget.set_media_id(media_id);
    }
}

let mobile_illust_ui_page_bookmark_tags  = class extends mobile_illust_ui_page
{
    constructor({template, ...options})
    {
        super({...options, visible: true, template: `
            <div class=mobile-illust-ui-page>
            </div>
        `});

        this.bookmark_tag_widget = new bookmark_tag_list_widget({
            parent: this,
            container: this.container,
            visible: true,
        });
    }

    hide_tab()
    {
        this.bookmark_tag_widget.save_current_tags();
        super.hide_tab();
    }

    set media_id(media_id)
    {
        super.media_id = media_id;
        this.bookmark_tag_widget.set_media_id(media_id);
    }
}


let mobile_illust_ui_top_page = class extends mobile_illust_ui_page
{
    constructor({template, ...options})
    {
        super({...options, visible: true, template: `
            <div class=mobile-illust-ui-page>
                <div class=top-page-button-row>
                    <div class="item button-browser-back">
                        <div class=button>
                            <ppixiv-inline src="resources/exit-icon.svg" style="transform: scaleX(-1);"></ppixiv-inline>
                        </div>
                        <span class=label>Back</span>
                    </div>

                    <div class="item button-toggle-zoom">
                        <div class=button>
                            <ppixiv-inline src="resources/zoom-full.svg"></ppixiv-inline>
                        </div>
                        <span class=label>Toggle zoom</span>
                    </div>

                    <div class="item button-bookmark public" data-bookmark-type=public>
                        <div class=button>
                            <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                        </div>

                        <span class=label>Bookmark</span>
                    </div>

                    <div class="item button-bookmark private button-container" data-bookmark-type=private>
                        <div class=button>
                            <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                        </div>

                        <span class=label>Bookmark privately</span>
                    </div>
                    
                    <div class="item button-bookmark-tags">
                        <div class=button>
                            ${ helpers.create_icon("ppixiv:tag") }
                        </div>
                        <span class=label>Bookmark tags</span>
                    </div>

                    <div class="item button-like enabled button-container">
                        <div class=button>
                            <ppixiv-inline src="resources/like-button.svg"></ppixiv-inline>
                        </div>
                        <span class=label>Like</span>
                    </div>

                    <div class="item button-view-manga">
                        <div class=button>
                            ${ helpers.create_icon("ppixiv:thumbnails") }
                        </div>
                        <span class=label>View manga pages</span>
                    </div>

                    <div class="item button-parent-folder" hidden>
                        <div class="button enabled">
                            ${ helpers.create_icon("folder") }
                        </div>

                        <span class=label>View folder</span>
                    </div>

                    <div class="item help enabled">
                        <div class=button>
                            ${ helpers.create_icon("help_outline") }
                        </div>

                        <span class=label>Help</span>
                    </div>

                    <div class="item button-more enabled">
                        <div class="button">
                            ${ helpers.create_icon("settings") }
                        </div>
                        <span class=label>More...</span>
                    </div>
                </div>
                <div class=context-menu-image-info-container></div>
            </div>
        `});

        this._media_id = null;
        this._on_click_viewer = null;

        this.container.querySelector(".button-view-manga").addEventListener("click", this.clicked_view_manga);

        this.display_labels = settings.get("mobile_display_ui_labels", false);
        this.help_button = this.container.querySelector(".help");
        this.help_button.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            this.display_labels = !this.display_labels;
            settings.set("mobile_display_ui_labels", this.display_labels);
            this.refresh();
        });

        this.browser_back_button = this.container.querySelector(".button-browser-back");
        this.browser_back_button.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            history.back();
        });

        this.container.querySelector(".button-parent-folder").addEventListener("click", this.clicked_go_to_parent);
        this.toggle_zoom_button = this.container.querySelector(".button-toggle-zoom");
        this.toggle_zoom_button.addEventListener("click", this.clicked_toggle_zoom);

        this.avatar_widget = new avatar_widget({
            container: this.container.querySelector(".avatar-widget-container"),
            mode: "overlay",
        });

        this.container.querySelector(".button-more").addEventListener("click", (e) => {
            this.parent.show_page("more");
        });

        this.container.querySelector(".button-bookmark-tags").addEventListener("click", (e) => {
            this.parent.show_page("bookmark_tags");
        });

        this.illust_widgets = [
            this.avatar_widget,
            new like_button_widget({
                parent: this,
                contents: this.container.querySelector(".button-like"),
            }),
            new context_menu_image_info_widget({
                parent: this,
                container: this.container.querySelector(".context-menu-image-info-container"),
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

        helpers.set_class(this.container.querySelector(".top-page-button-row"), "display-labels", this.display_labels);

        let button_view_manga = this.container.querySelector(".button-view-manga");
        button_view_manga.dataset.popup = "View manga pages";
        helpers.set_class(button_view_manga, "enabled", main_controller.singleton.navigate_out_enabled);

        // This isn't quite right since we might be the first history state, but it's tricky
        // to figure out if we can actually go back.  This at least greys out the button most
        // of the time for slideshow bookmarks.
        helpers.set_class(this.browser_back_button, "enabled", window.history.length > 1);

        // Enable the zoom button if we're in the image view and we have an on_click_viewer.
        helpers.set_class(this.toggle_zoom_button, "enabled", this._is_zoom_ui_enabled);

        helpers.set_class(this.container.querySelector(".button-bookmark-tags"), "enabled", true);

        // If we're visible, tell widgets what we're viewing.  Don't do this if we're not visible, so
        // they don't load data unnecessarily.  Don't set these back to null if we're hidden, so they
        // don't blank themselves while we're still fading out.
        if(this.visible)
        {
            let media_id = this._media_id;
            // XXX: from illust
            let user_id = null; //this.effective_user_id;
            for(let widget of this.illust_widgets)
            {
                if(widget.set_media_id)
                    widget.set_media_id(media_id);
                if(widget.set_user_id)
                    widget.set_user_id(user_id);

                // If _clicked_media_id is set, we're open for a search result image the user right-clicked
                // on.  Otherwise, we're open for the image actually being viewed.  Tell context_menu_image_info_widget
                // to show the current manga page if we're on a viewed image, but not if we're on a search
                // result.
                let showing_viewed_image = true; // XXX remove
                widget.show_page_number = showing_viewed_image;
            }

            // If we're on a local ID, show the parent folder button.
            let folder_button = this.container.querySelector(".button-parent-folder");
            let is_local = helpers.is_media_id_local(this.folder_id_for_parent);
            folder_button.hidden = !is_local;
            helpers.set_class(folder_button, "enabled", this.parent_folder_id != null);
        }
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
        main_controller.singleton.navigate_out();
    }

    clicked_go_to_parent = (e) =>
    {
        e.preventDefault();
            
        let parent_folder_id = this.parent_folder_id;
        if(parent_folder_id == null)
            return;

        let args = new helpers.args("/", ppixiv.location);
        local_api.get_args_for_id(parent_folder_id, args);
        helpers.set_page_url(args.url, true, "navigation");
    }


    clicked_toggle_zoom = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(!this._is_zoom_ui_enabled)
            return;

        // XXX remove this._on_click_viewer.stop_animation();

        // Toggle between covering the screen and fitting the image onscreen.
        let old_level = this._on_click_viewer.zoom_level;
        this._on_click_viewer.zoom_level = old_level == "cover"? 0:"cover";
        
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
            </div>
        `});

        this.onclose = onclose;
        this.pages = {};

        this.pages.top = new mobile_illust_ui_top_page({
            container: this.container,
            parent: this,
        });
        this.pages.more = new mobile_illust_ui_page_more({
            container: this.container,
            parent: this,
        });
        this.pages.bookmark_tags = new mobile_illust_ui_page_bookmark_tags({
            container: this.container,
            parent: this,
        });
        
        // Listen for the image viewer changing.  This is used for zooming.
        ppixiv.image_viewer_base.primary_changed.addEventListener("changed", (e) => {
            this.on_click_viewer = e.viewer;
        }, { signal: this.shutdown_signal.signal });

        this._media_id = null;
        this.displayed_page = null;

        this.show_page(null);

        this.refresh();
    }

    visibility_changed()
    {
        super.visibility_changed();
        this.refresh_visibility();
    }

    set media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;
        for(let page of Object.values(this.pages))
            page.media_id = media_id;

        this.refresh();
    }
    get media_id() { return this._media_id; }

    // Set the current viewer, or null if none.  If set, we'll activate zoom controls.
    set on_click_viewer(viewer)
    {
        for(let page of Object.values(this.pages))
            page.on_click_viewer = viewer;
    }

    set_data_source(data_source)
    {
        for(let page of Object.values(this.pages))
            page.set_data_source(data_source);
    }

    show()
    {
        if(this.displayed_page != null)
            return;

        this.show_page("top");

        // Make sure we're up to date if we deferred an update while hidden.
        this.refresh();
    }

    hide()
    {
        // To hide, hide the active page.
        this.show_page(null);
    }

    show_page(new_page_name)
    {
        let old_page_name = this.displayed_page;
        if(new_page_name == old_page_name)
            return;

        let new_page = this.pages[new_page_name];
        let old_page = this.pages[old_page_name];
        this.displayed_page = new_page_name;
        if(old_page)
            old_page.hide_tab();
        if(new_page)
            new_page.show_tab();

        // If we're becoming visible, create our click_outside_listener.
        if(old_page == null && this.click_outside_listener == null)
        {
            this.click_outside_listener = new click_outside_listener([this.container], () => {
                this.hide();
            });
        }

        // If we're becoming hidden, remove our click_outside_listener.
        if(new_page == null && this.click_outside_listener != null)
        {
            this.click_outside_listener.shutdown();
            this.click_outside_listener = null;
        }

        // Tell the caller that we're closing.
        if(new_page == null && this.onclose)
            this.onclose();
    }
    
    refresh()
    {
        for(let page of Object.values(this.pages))
            page.refresh();
    }
}

