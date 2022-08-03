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
    
    get tab_shown()
    {
        return this.container.classList.contains("active-tab");
    }

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

    get content_node() { return this.more_options_widget.container; }

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
        });
    }
    get content_node() { return this.bookmark_tag_widget.container; }

    show_tab()
    {
        super.show_tab();
        this.shown_changed();
    }

    hide_tab()
    {
        this.bookmark_tag_widget.save_current_tags();
        super.hide_tab();
        this.shown_changed();
    }

    shown_changed()
    {
        // Only tell bookmark_tag_widget the current media ID when we're visible, so it doesn't
        // load Pixiv tags until it's actually used.  Tell it to save tags when we're not visible,
        // since that normally happens when it's set to not visible, which we're not doing here.
        this.bookmark_tag_widget.set_media_id(this._media_id);
        if(!this.visible)
            this.bookmark_tag_widget.save_current_tags();
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
            <div class="mobile-illust-ui-page top-page">
                <div class=top-page-buttons>
                    <div class=top-page-button-row>
                        <div class="item button-toggle-slideshow enabled">
                            <div class=button>
                                ${ helpers.create_icon("mat:wallpaper") }
                            </div>
                            <span class=label>Slideshow</span>
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
                    </div>

                    <div class=top-page-button-row>
                        <div class="item button-browser-back">
                            <div class=button>
                                <ppixiv-inline src="resources/exit-icon.svg" style="transform: scaleX(-1);"></ppixiv-inline>
                            </div>
                            <span class=label>Back</span>
                        </div>

                        <div class="item button-more enabled">
                            <div class="button">
                                ${ helpers.create_icon("settings") }
                            </div>
                            <span class=label>More...</span>
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
                    </div>
                </div>
            </div>
        `});

        this._media_id = null;
        this._on_click_viewer = null;
        this.submenu_open = false;

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

        this.toggle_slideshow_bottom = this.container.querySelector(".button-toggle-slideshow");
        this.toggle_slideshow_bottom.addEventListener("click", (e) => {
            main_controller.toggle_slideshow();
            this.parent.hide();
            this.refresh();
        });

        this.avatar_widget = new avatar_widget({
            container: this.container.querySelector(".avatar-widget-container"),
            mode: "overlay",
        });

        this.container.querySelector(".button-more").addEventListener("click", (e) => {
            this.parent.toggle_page("more", e.target);
        });

        this.container.querySelector(".button-bookmark-tags").addEventListener("click", (e) => {
            this.parent.toggle_page("bookmark_tags", e.target);
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

    // If a submenu is open, we'll hide our button labels.
    set_submenu_open(value)
    {
        this.submenu_open = value;
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

        helpers.set_class(this.container.querySelector(".top-page-buttons"), "display-labels", this.display_labels && !this.submenu_open);

        let button_view_manga = this.container.querySelector(".button-view-manga");
        button_view_manga.dataset.popup = "View manga pages";
        helpers.set_class(button_view_manga, "enabled", main_controller.navigate_out_enabled);

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
            for(let widget of this.illust_widgets)
            {
                if(widget.set_media_id)
                    widget.set_media_id(media_id);

                widget.show_page_number = true;
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
        main_controller.navigate_out();
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

        // Toggle between covering the screen and fitting the image onscreen.
        let old_level = this._on_click_viewer.zoom_level;
        this._on_click_viewer.zoom_level = old_level == "cover"? 0:"cover";
        
        this.refresh();
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
                    ${ helpers.create_icon("ppixiv:tag") }                    
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
        
        new view_hidden_listener(this.container, () => {
            this.hide();
        }, { signal: this.shutdown_signal.signal });

        // Listen for the image viewer changing.  This is used for zooming.
        ppixiv.image_viewer_base.primary_changed.addEventListener("changed", (e) => {
            this.on_click_viewer = e.viewer;
        }, { signal: this.shutdown_signal.signal });

        this._media_id = null;
        this.displayed_page = null;

        this.set_bottom_reservation("0px");
        this.show_page(null);
        
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

    // side is "left" or "right".
    show({side})
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

        let old_side = this.container.dataset.side;
        this.container.dataset.side = side;

        // Changing the side while we're not shown will trigger animations, as the invisible
        // elements shift from one side to the other.  These become visible when we actually
        // show the elements, so cancel them.
        if(side != old_side)
        {
            for(let element of this.container.querySelectorAll("*"))
            {
                for(let animation of element.getAnimations())
                    animation.cancel();
            }
        }

        this.pages.top.show_tab();

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

        this.pages.top.hide_tab();
        this.show_page(null);

        this.refresh();

        // Tell the caller that we're closing.
        if(this.onclose)
            this.onclose();
    }

    // If not null, button is the button that was used to show the page, to align the
    // submenu near.
    show_page(new_page_name, button)
    {
        let old_page_name = this.displayed_page;
        if(new_page_name == old_page_name)
            return;

        let new_page = this.pages[new_page_name];
        let old_page = this.pages[old_page_name];
        this.displayed_page = new_page_name;
        helpers.set_dataset(this.container.dataset, "displayedPage", this.displayed_page);
        if(old_page)
            old_page.hide_tab();
        if(new_page)
        {
            // If we were given a button, try to position the tab to its center.
            let pos = null;
            if(button)
            {
                let {top, height} = button.getBoundingClientRect();
                pos = top + height/2;
            }

            new_page.show_tab({pos});
        }

        this.pages.top.set_submenu_open(new_page_name != null);
    }

    toggle_page(page, button)
    {
        if(this.displayed_page == page)
            this.show_page(null);
        else
            this.show_page(page, button);
    }

    // Set the amount of space reserved at the bottom for other UI.  This is used to prevent
    // overlapping the video UI.
    set_bottom_reservation(value)
    {
        this.container.style.setProperty("--video-ui-height", value);
    }
    
    refresh()
    {
        // Set data-mobile-ui-visible so other UIs can tell if this UI is open.
        ClassFlags.get.set("mobile-ui-visible", this.shown);
        helpers.set_class(this.container, "shown", this.shown);

        for(let page of Object.values(this.pages))
            page.refresh();

        ppixiv.OpenWidgets.singleton.set(this, this.shown);
    }
}

