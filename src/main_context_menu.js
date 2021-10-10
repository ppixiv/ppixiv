"use strict";

// A global right-click popup menu.
//
// This is only active when right clicking over items with the context-menu-target
// class.
//
// Not all items are available all the time.  This is a singleton class, so it's easy
// for different parts of the UI to tell us when they're active.
//
// This also handles alt-mousewheel zooming.
this.context_menu_image_info_widget = class extends this.illust_widget
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
        {
            if(this._page == -1)
                page_text = illust_data.pageCount + " pages";
            else
                page_text = "Page " + (this._page+1) + "/" + illust_data.pageCount;
        }
        set_info(".page-count", page_text);

        // Show info for the current page.  If _page is -1 then we're on the search view and don't have
        // a specific page, so show info for the first page.
        let page = this._page;
        if(page == -1)
            page = 0;

        var info = "";
        var page_info = illust_data.mangaPages[page];
        info += page_info.width + "x" + page_info.height;
        set_info(".image-info", info);

        let seconds_old = (new Date() - new Date(illust_data.createDate)) / 1000;
        let age = helpers.age_to_string(seconds_old) + " ago";
        this.container.querySelector(".post-age").dataset.popup = helpers.date_to_string(illust_data.createDate);
        set_info(".post-age", age);
    }
}

this.main_context_menu = class extends this.popup_context_menu
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
        this.handle_link_click = this.handle_link_click.bind(this);

        this._on_click_viewer = null;
        this._page = -1;

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
        this.menu.querySelector(".button-browser-back").addEventListener("click", (e) => {
            history.back();
        });
        window.addEventListener("wheel", this.onwheel, {
            capture: true,

            // Work around Chrome intentionally breaking event listeners.  Remember when browsers
            // actually made an effort to not break things?
            passive: false,
        });

        this.menu.addEventListener("click", this.handle_link_click);

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

    // Override ctrl-clicks inside the context menu.
    //
    // This is a bit annoying.  Ctrl-clicking a link opens it in a tab, but we allow opening the
    // context menu by holding ctrl, which means all clicks are ctrl-clicks if you use the popup
    // that way.  We work around this by preventing ctrl-click from opening links in a tab and just
    // navigate normally.  This is annoying since some people might like opening tabs that way, but
    // there's no other obvious solution other than changing the popup menu hotkey.  That's not a
    // great solution since it needs to be on Ctrl or Alt, and Alt causes other problems, like showing
    // the popup menu every time you press alt-left.
    //
    // This only affects links inside the context menu, which is currently only the author link, and
    // most people probably use middle-click anyway, so this will have to do.
    handle_link_click(e)
    {
        let a = e.target.closest("A");
        if(a == null)
            return;

        // If a previous event handler called preventDefault on this click, ignore it.
        if(e.defaultPrevented)
            return;

        // Only change ctrl-clicks.
        if(e.altKey || e.shiftKey || !e.ctrlKey)
            return;

        e.preventDefault();
        e.stopPropagation();

        let url = new URL(a.href, document.location);
        helpers.set_page_url(url, true, "Clicked link in context menu");
    }

    // Return the illust ID active in the context menu, or null if none.
    //
    // If we're opened by right clicking on an illust, we'll show that image's
    // info.  Otherwise, we'll show the info for the illust we're on, if any.
    get effective_illust_id()
    {
        if(this._clicked_illust_id != null)
            return this._clicked_illust_id;
        else
            return this._illust_id;
    }

    get effective_user_id()
    {
        if(this._clicked_user_id != null)
            return this._clicked_user_id;
        else if(this._user_info)
            return this._user_info.userId;
        else
            return null;
    }

    get effective_user_info()
    {
        if(this._clicked_user_info != null)
            return this._clicked_user_info;
        else
            return this._user_info;
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
        // If we're not visible, don't refresh an illust until we are, so we don't trigger
        // data loads.  Do refresh even if we're hidden if we have no illust to clear
        // the previous illust's display even if we're not visible, so it's not visible the
        // next time we're displayed.
        let illust_id = this.effective_illust_id;
        if(!this.visible && illust_id != null)
            return;

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

    // Handle key events.  This is called whether the context menu is open or closed, and handles
    // global hotkeys.  This is handled here because it has a lot of overlapping functionality with
    // the context menu.
    //
    // The actual actions may happen async, but this always returns synchronously since the keydown/keyup
    // event needs to be defaultPrevented synchronously.
    //
    // We always return true for handled hotkeys even if we aren't able to perform them currently, so
    // keys don't randomly revert to default actions.
    _handle_key_event_for_image(e)
    {
        // These hotkeys require an image, which we have if we're viewing an image or if the user
        // was hovering over an image in search results.  We might not have the illust info yet,
        // but we at least need an illust ID.
        let illust_id = this.effective_illust_id;

        // All of these hotkeys require Ctrl.
        if(!e.ctrlKey)
            return;

        if(e.key.toUpperCase() == "V")
        {
            (async() => {
                if(illust_id == null)
                    return;

                let illust_data = await image_data.singleton().get_image_info(illust_id);
                actions.like_image(illust_data);
            })();

            return true;
        }

        if(e.key.toUpperCase() == "B")
        {
            (async() => {
                if(illust_id == null)
                    return;

                let illust_data = await image_data.singleton().get_image_info(illust_id);

                // Ctrl-Shift-Alt-B: add a bookmark tag
                if(e.altKey && e.shiftKey)
                {
                    actions.add_new_tag(illust_id);
                    return;
                }

                // Ctrl-Shift-B: unbookmark
                if(e.shiftKey)
                {
                    if(illust_data.bookmarkData == null)
                    {
                        message_widget.singleton.show("Image isn't bookmarked");
                        return;
                    }

                    actions.bookmark_remove(illust_data);
                    return;
                }

                // Ctrl-B: bookmark
                // Ctrl-Alt-B: bookmark privately
                let bookmark_privately = e.altKey;
                if(illust_data.bookmarkData != null)
                {
                    message_widget.singleton.show("Already bookmarked (^B to remove bookmark)");
                    return;
                }

                actions.bookmark_add(illust_data, {
                    private: bookmark_privately
                });
            })();
            
            return true;
        }

        return false;
    }

    _handle_key_event_for_user(e)
    {
        // These hotkeys require a user, which we have if we're viewing an image, if the user
        // was hovering over an image in search results, or if we're viewing a user's posts.
        // We might not have the user info yet, but we at least need a user ID.
        let user_id = this.effective_user_id;

        // All of these hotkeys require Ctrl.
        if(!e.ctrlKey)
            return;

        if(e.key.toUpperCase() == "F")
        {
            (async() => {
                if(user_id == null)
                    return;

                var user_info = await image_data.singleton().get_user_info_full(user_id);
                if(user_info == null)
                    return;

                // Ctrl-Shift-F: unfollow
                if(e.shiftKey)
                {
                    if(!user_info.isFollowed)
                    {
                        message_widget.singleton.show("Not following this user");
                        return;
                    }

                    await actions.unfollow(user_info);
                    return;
                }
            
                // Ctrl-F: follow
                // Ctrl-Alt-F: follow privately
                //
                // It would be better to check if we're following publically or privately to match the hotkey, but
                // Pixiv doesn't include that information.
                let follow_privately = e.altKey;
                if(user_info.isFollowed)
                {
                    message_widget.singleton.show("Already following this user");
                    return;
                }
            
                await actions.follow(user_info, follow_privately, []);
            })();

            return true;
        }

        return false;
    }

    handle_key_event(e)
    {
        if(e.type != "keydown")
            return false;

        if(this._is_zoom_ui_enabled)
        {
            var zoom = helpers.is_zoom_hotkey(e);
            if(zoom != null)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.handle_zoom_event(e, zoom < 0);
                return true;
            }
        }

        // Check image and user hotkeys.
        if(this._handle_key_event_for_image(e))
            return true;

        if(this._handle_key_event_for_user(e))
            return true;
        
        return false;
    }

    onwheel(e)
    {
        // RMB-wheel zooming is confusing in toggle mode.
        if(this.toggle_mode)
            return;

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
            // Hide the popup menu.  It remains open, so hide() will still be called when
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
            this._on_click_viewer.zoom_level = 0;
            this._on_click_viewer.locked_zoom = true;
            this.refresh();
        }

        this._on_click_viewer.change_zoom(down);

        // As a special case, 
        // If that put us in 0x zoom, we're now showing the image identically to not being zoomed
        // at all.  That's confusing, since toggling zoom does nothing since it toggles between
        // unzoomed and an identical zoom.  When this happens, switch zoom off and change the zoom
        // level to "cover".  The display will be identical, but clicking will zoom.
        //
        // This works with the test above: if you zoom again after this happens, we'll turn locked_zoom
        // back on.
        if(this._on_click_viewer.zoom_level == 0)
        {
            // but this should leave locked_zoom false, which we don't want
            this._on_click_viewer.zoom_level = "cover";
            this._on_click_viewer.locked_zoom = false;
        }

        this._on_click_viewer.set_image_position([pageX, pageY], center);
        this.refresh();
    }

    show(x, y, target)
    {
        // When we hide, we clear which ID we want to display, but we don't refresh the
        // display so it doesn't flicker while it fades out.  Refresh now instead, so
        // we don't flash the previous ID if we need to wait for a load.
        this._effective_illust_id_changed();

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
    // This is used to remember what the cursor was over when the context menu was opened when in
    // the search view.
    async _set_temporary_illust(illust_id, page)
    {
        // If this object is null or changed, we know we've been hidden since we
        // started this request.
        var show_sentinel = this.load_illust_sentinel = new Object();

        // Store the illust_id immediately, so it's available without waiting for image
        // info to load.
        this._clicked_illust_id = illust_id;

        // Read illust info to see if we're following the user.
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

        // Store the user_id immediately, so it's available without waiting for user
        // info to load.
        this._clicked_user_id = user_id;

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
        // For debugging, this can be set to temporarily force the context menu to stay open.
        if(unsafeWindow.keep_context_menu_open)
            return;

        this.load_illust_sentinel = null;
        this.load_user_sentinel = null;
        this._clicked_user_id = null;
        this._clicked_user_info = null;
        this._clicked_illust_id = null;
        this._clicked_illust_info = null;
        this._clicked_page = null;

        // Don't refresh yet, so we try to not change the display while it fades out.
        // We'll do the refresh the next time we're displayed.
        // this._effective_illust_id_changed();

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
        for(var element of this.menu.querySelectorAll(".button.requires-zoom"))
            helpers.set_class(element, "enabled", this._is_zoom_ui_enabled);

        // Set the avatar button.
        this.avatar_widget.set_from_user_data(this.effective_user_info);

        if(this._is_zoom_ui_enabled)
        {
            helpers.set_class(this.menu.querySelector(".button-zoom"), "selected", this._on_click_viewer.locked_zoom);

            var zoom_level = this._on_click_viewer.zoom_level;
            for(var button of this.menu.querySelectorAll(".button-zoom-level"))
                helpers.set_class(button, "selected", this._on_click_viewer.locked_zoom && button.dataset.level == zoom_level);
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

    // "Zoom lock", zoom as if we're holding the button constantly
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

        let level = e.currentTarget.dataset.level;

        // If the zoom level that's already selected is clicked and we're already zoomed,
        // just toggle zoom as if the toggle zoom button was pressed.
        if(this._on_click_viewer.zoom_level == level && this._on_click_viewer.locked_zoom)
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

        this._on_click_viewer.set_image_position([e.pageX, e.pageY], center);
        
        this.refresh();
    }
}

