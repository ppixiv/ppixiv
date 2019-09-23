// A global right-click popup menu.
//
// This is only active when right clicking over items with the context-menu-target
// class.
//
// Not all items are available all the time.  This is a singleton class, so it's easy
// for different parts of the UI to tell us when they're active.
//
// This also handles alt-mousewheel zooming.
class context_menu_image_info_widget extends illust_widget
{
    set_illust_and_page(illust_id, page)
    {
        if(this._illust_id == illust_id && this._page == page)
            return;

        this._illust_id = illust_id;
        this._page = page;
        this.refresh();
    }

    refresh_internal(illust_data)
    {
        this.container.hidden = (illust_data == null || this._page == null);
        if(this.container.hidden)
            return;

        var set_info = (query, text) =>
        {
            var node = this.container.querySelector(query);
            node.innerText = text;
            node.hidden = text == "";
        };
        
        // Add the page count for manga.
        var page_text = "";
        if(illust_data.pageCount > 1)
            page_text = "Page " + (this._page+1) + "/" + illust_data.pageCount;
        set_info(".page-count", page_text);

        var info = "";
        var page_info = illust_data.mangaPages[this._page];
        info += page_info.width + "x" + page_info.height;
        set_info(".image-info", info);
    }
}

class main_context_menu extends popup_context_menu
{
    // Return the singleton.
    static get get()
    {
        return main_context_menu._singleton;
    }

    constructor(container)
    {
        super(container);

        if(main_context_menu._singleton != null)
            throw "Singleton already exists";
        main_context_menu._singleton = this;

        this.onwheel = this.onwheel.bind(this);
        this.onkeydown = this.onkeydown.bind(this);

        this._on_click_viewer = null;
        this._page = 0;

        // Refresh the menu when the view changes.
        this.mode_observer = new MutationObserver(function(mutationsList, observer) {
            for(var mutation of mutationsList) {
                if(mutation.type == "attributes")
                {
                    if(mutation.attributeName == "data-current-view")
                        this.refresh();
                }
            }
        }.bind(this));

        this.mode_observer.observe(document.body, {
            attributes: true, childList: false, subtree: false
        });

        this.menu.querySelector(".button-return-to-search").addEventListener("click", this.clicked_return_to_search.bind(this));
        this.menu.querySelector(".button-fullscreen").addEventListener("click", this.clicked_fullscreen.bind(this));
        this.menu.querySelector(".button-zoom").addEventListener("click", this.clicked_zoom_toggle.bind(this));
        window.addEventListener("wheel", this.onwheel, {
            capture: true,

            // Work around Chrome intentionally breaking event listeners.  Remember when browsers
            // actually made an effort to not break things?
            passive: false,
        });
        window.addEventListener("keydown", this.onkeydown);

        for(var button of this.menu.querySelectorAll(".button-zoom-level"))
            button.addEventListener("click", this.clicked_zoom_level.bind(this));

        this.bookmark_tag_widget = new bookmark_tag_list_widget(this.menu.querySelector(".popup-bookmark-tag-dropdown-container"));
        this.toggle_tag_widget = new toggle_bookmark_tag_list_widget(this.menu.querySelector(".button-bookmark-tags"), this.bookmark_tag_widget);
        this.like_button = new like_button_widget(this.menu.querySelector(".button-like"));
        this.image_info_widget = new context_menu_image_info_widget(this.menu.querySelector(".context-menu-image-info"));

        this.avatar_widget = new avatar_widget({
            parent: this.menu.querySelector(".avatar-widget-container"),
            mode: "overlay",
        });

        // The bookmark buttons, and clicks in the tag dropdown:
        this.bookmark_buttons = [];
        for(var a of this.menu.querySelectorAll(".button-bookmark"))
            this.bookmark_buttons.push(new bookmark_button_widget(a, a.classList.contains("private"), this.bookmark_tag_widget));

        this.element_bookmark_tag_list = this.menu.querySelector(".bookmark-tag-list");

        this.refresh();
    }

    // Return the illust ID active in the context menu, or null if none.
    //
    // If we're opened by right clicking on an illust, we'll show that image's
    // info.  Otherwise, we'll show the info for the illust we're on, if any.
    get effective_illust_id()
    {
        if(this._clicked_illust_info != null)
            return this._clicked_illust_info.illustId;
        else
            return this._illust_id;
    }

    get effective_page()
    {
        if(this._clicked_page != null)
            return this._clicked_page;
        else
            return this._page;
    }
    
    // When the effective illust ID changes, let our widgets know.
    _effective_illust_id_changed()
    {
        // If we're not visible, don't refresh until we are, so we don't trigger
        // data loads.
        if(!this.visible)
            return;

        var illust_id = this.effective_illust_id;

        this.like_button.illust_id = illust_id;
        this.bookmark_tag_widget.illust_id = illust_id;
        this.toggle_tag_widget.illust_id = illust_id;
        for(var button of this.bookmark_buttons)
            button.illust_id = illust_id;

        this.image_info_widget.set_illust_and_page(this.effective_illust_id, this.effective_page);
    }

    set illust_id(value)
    {
        if(this._illust_id == value)
            return;

        this._illust_id = value;
        this._effective_illust_id_changed();
    }

    set page(value)
    {
        if(this._page == value)
            return;

        this._page = value;
        this._effective_illust_id_changed();
    }
    
    shutdown()
    {
        this.mode_observer.disconnect();
        window.removeEventListener("wheel", this.onwheel, true);
        super.shutdown();
    }

    // Set the current viewer, or null if none.  If set, we'll activate zoom controls.
    get on_click_viewer()
    {
        return this._on_click_viewer;
    }
    set on_click_viewer(viewer)
    {
        this._on_click_viewer = viewer;
        this.refresh();
    }

    // Set the related user currently being viewed, or null if none.
    get user_info()
    {
        return this._user_info;
    }
    set user_info(user_info)
    {
        if(this._user_info == user_info)
            return;
        this._user_info = user_info;

        this.refresh();
    }

    // Put the zoom toggle button under the cursor, so right-left click is a quick way
    // to toggle zoom lock.
    get element_to_center()
    {
        return this.displayed_menu.querySelector(".button-zoom");
    }
        
    get _is_zoom_ui_enabled()
    {
        var view = document.body.dataset.currentView;
        return view == "illust" && this._on_click_viewer != null;
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        this.data_source = data_source;
        this.refresh();
    }

    onkeydown(e)
    {
        if(this._is_zoom_ui_enabled)
        {
            var zoom = helpers.is_zoom_hotkey(e);
            if(zoom != null)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.handle_zoom_event(e, zoom < 0);
            }
        }
    }

    onwheel(e)
    {
        // Stop if zooming isn't enabled.
        if(!this._is_zoom_ui_enabled)
            return;

        // Only mousewheel zoom if control is pressed, or if the popup menu is visible.
        if(!e.ctrlKey && !this.visible)
            return;

        // We want to override almost all mousewheel events while the popup menu is open, but
        // don't override scrolling the popup menu's tag list.
        if(e.target.closest(".popup-bookmark-tag-dropdown"))
            return;

        e.preventDefault();
        e.stopImmediatePropagation();
        
        var down = e.deltaY > 0;
        this.handle_zoom_event(e, down);
    }
    
    // Handle both mousewheel and control-+/- zooming.
    handle_zoom_event(e, down)
    {
        e.preventDefault();
        e.stopImmediatePropagation();

        if(!this.hide_temporarily)
        {
            // Hide the poopup menu.  It remains open, so hide() will still be called when
            // the right mouse button is released and the overall flow remains unchanged, but
            // the popup itself will be hidden.
            this.hide_temporarily = true;
        }

        // If e is a keyboard event, use null to use the center of the screen.
        var keyboard = e instanceof KeyboardEvent;
        var pageX = keyboard? null:e.pageX;
        var pageY = keyboard? null:e.pageY;
        let center = this._on_click_viewer.get_image_position([pageX, pageY]);
        
        // If mousewheel zooming is used while not zoomed, turn on zooming and set
        // a 1x zoom factor, so we zoom relative to the previously unzoomed image.
        if(!this._on_click_viewer.zoom_active)
        {
            this._on_click_viewer.zoom_level = 4; // level 4 is 1x
            this._on_click_viewer.locked_zoom = true;
            this._on_click_viewer.relative_zoom_level = 0;
            this.refresh();
        }

        this._on_click_viewer.relative_zoom_level += down? -1:+1;

        // As a special case, if we're in 1x zoom from above and we return to 1x relative zoom
        // (eg. the user mousewheeled up and then back down), switch to another zoom mode.
        // Otherwise, if you zoom up and then back down, the zoom level is left at 1x, so click
        // zooming seems to be broken.  We don't know what the old zoom setting was to restore it,
        // so we just switch to fill zoom.
        if(this._on_click_viewer.relative_zoom_level == 0 && this._on_click_viewer.zoom_level == 4)
        {
            this._on_click_viewer.zoom_level = 0;
            this._on_click_viewer.locked_zoom = false;
        }

        this._on_click_viewer.set_image_position([pageX, pageY], center);
        this.refresh();
    }

    show(x, y, target)
    {
        // If RMB is pressed while dragging LMB, stop dragging the window when we
        // show the popup.
        if(this.on_click_viewer != null)
            this.on_click_viewer.stop_dragging();

        // See if an element representing a user and/or an illust was under the cursor.
        if(target != null)
        {
            var user_target = target.closest("[data-user-id]");
            if(user_target != null)
                this._set_temporary_user(user_target.dataset.userId);

            var illust_target = target.closest("[data-illust-id]");
            if(illust_target != null)
                this._set_temporary_illust(illust_target.dataset.illustId, illust_target.dataset.pageIdx);
        }

        super.show(x, y, target);

        // Make sure we're up to date if we deferred an update while hidden.
        this._effective_illust_id_changed();
    }

    // Set an alternative illust ID to show.  This is effective until the context menu is hidden.
    async _set_temporary_illust(illust_id, page)
    {
        // If this object is null or changed, we know we've been hidden since we
        // started this request.
        var show_sentinel = this.load_illust_sentinel = new Object();

        // Read illust info to see if we're following the user.
        console.log("get", illust_id);
        var illust_info = await image_data.singleton().get_image_info(illust_id);

        // If the popup was closed while we were waiting, ignore the results.
        if(show_sentinel != this.load_illust_sentinel)
            return;
        this.load_illust_sentinel = null;

        if(page != null)
            page = parseInt(page);

        this._clicked_illust_info = illust_info;
        this._clicked_page = page;
        this._effective_illust_id_changed();
    }

    // Set an alternative user ID to show.  This is effective until the context menu is hidden.
    async _set_temporary_user(user_id)
    {
        // Clear the avatar widget while we load user info, so we don't show the previous
        // user's avatar while the new avatar loads.
        this.avatar_widget.set_from_user_data(null);
        
        // If this object is null or changed, we know we've been hidden since we
        // started this request.
        var show_sentinel = this.load_user_sentinel = new Object();

        // Read user info to see if we're following the user.
        var user_info = await image_data.singleton().get_user_info(user_id);

        // If the popup was closed while we were waiting, ignore the results.
        if(show_sentinel != this.load_user_sentinel)
            return;
        this.load_user_sentinel = null;

        this._clicked_user_info = user_info;
        this.refresh();
    }

    hide()
    {
        this.load_illust_sentinel = null;
        this.load_user_sentinel = null;
        this._clicked_user_info = null;
        this._clicked_illust_info = null;
        this._clicked_page = null;

        // Even though we're hiding, update widgets so they don't show the last image's
        // bookmark count, etc. the next time we're displayed.
        this._effective_illust_id_changed();

        super.hide();
    }
    
    // Update selection highlight for the context menu.
    refresh()
    {
        var view = document.body.dataset.currentView;

        // Update the tooltip for the thumbnail toggle button.
        var navigate_out_label = main_controller.singleton.navigate_out_label;
        var title = navigate_out_label != null? ("Return to " + navigate_out_label):"";
        this.menu.querySelector(".button-return-to-search").dataset.popup = title;
        helpers.set_class(this.menu.querySelector(".button-return-to-search"), "enabled", navigate_out_label != null);
        this.refresh_tooltip();

        // Enable the zoom buttons if we're in the image view and we have an on_click_viewer.
        for(var element of this.menu.querySelectorAll(".zoom-strip .button"))
            helpers.set_class(element, "enabled", this._is_zoom_ui_enabled);

        // Set the avatar button.
        this.avatar_widget.set_from_user_data(this._clicked_user_info || this._user_info);

        if(this._is_zoom_ui_enabled)
        {
            helpers.set_class(this.menu.querySelector(".button-zoom"), "selected", this._on_click_viewer.locked_zoom);

            var zoom_level = this._on_click_viewer.zoom_level;
            for(var button of this.menu.querySelectorAll(".button-zoom-level"))
                helpers.set_class(button, "selected", parseInt(button.dataset.level) == zoom_level);
        }
    }

    clicked_return_to_search(e)
    {
        main_controller.singleton.navigate_out();
    }

    clicked_fullscreen(e)
    {
        if(!document.fullscreenElement)
            document.documentElement.requestFullscreen();
        else
            document.exitFullscreen(); 
    }

    clicked_zoom_toggle(e)
    {
        if(!this._is_zoom_ui_enabled)
            return;
        
        let center = this._on_click_viewer.get_image_position([e.pageX, e.pageY]);
        this._on_click_viewer.locked_zoom = !this._on_click_viewer.locked_zoom;
        this._on_click_viewer.set_image_position([e.pageX, e.pageY], center);

        this.refresh();
    }

    clicked_zoom_level(e)
    {
        if(!this._is_zoom_ui_enabled)
            return;

        var level = parseInt(e.currentTarget.dataset.level);

        // If the zoom level that's already selected is clicked and we're already zoomed,
        // just toggle zoom as if the toggle zoom button was pressed.
        if(this._on_click_viewer.zoom_level == level && this._on_click_viewer.relative_zoom_level == 0 && this._on_click_viewer.locked_zoom)
        {
            this.on_click_viewer.locked_zoom = false;
            this.refresh();
            return;
        }


        let center = this._on_click_viewer.get_image_position([e.pageX, e.pageY]);
        
        // Each zoom button enables zoom lock, since otherwise changing the zoom level would
        // only have an effect when click-dragging, so it looks like the buttons don't do anything.
        this._on_click_viewer.zoom_level = level;
        this._on_click_viewer.locked_zoom = true;
        this._on_click_viewer.relative_zoom_level = 0;

        this._on_click_viewer.set_image_position([e.pageX, e.pageY], center);
        
        this.refresh();
    }
}

