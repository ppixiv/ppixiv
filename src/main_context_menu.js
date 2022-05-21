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
ppixiv.context_menu_image_info_widget = class extends ppixiv.illust_widget
{
    get needed_data()
    {
        // We need illust info if we're viewing a manga page beyond page 1, since
        // early info doesn't have that.  Most of the time, we only need early info.
        if(this._page == null || this._page == 0)
            return "thumbnail";
        else
            return "illust_info";
    }

    set show_page_number(value)
    {
        this._show_page_number = value;
        this.refresh();
    }

    refresh_internal({ media_id, thumbnail_data, illust_data })
    {
        if(!illust_data)
            illust_data = thumbnail_data;

        this.container.hidden = illust_data == null;
        if(this.container.hidden)
            return;

        var set_info = (query, text) =>
        {
            var node = this.container.querySelector(query);
            node.innerText = text;
            node.hidden = text == "";
        };
        
        // Add the page count for manga.  If the data source is data_source.vview, show
        // the index of the current file if it's loaded all results.
        let current_page = this._page;
        let page_count = illust_data.pageCount;
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

        // If we're on the first page then we only requested early info, and we can use the dimensions
        // on it.  Otherwise, get dimensions from mangaPages from illust data.  If we're displaying a
        // manga post and we don't have illust data yet, we don't have dimensions, so hide it until
        // it's loaded.
        var info = "";
        let width = null, height = null;
        if(this._page == 0)
        {
            width = illust_data.width;
            height = illust_data.height;
        }
        else if(illust_data.mangaPages)
        {
            width = illust_data.mangaPages[this._page].width;
            height = illust_data.mangaPages[this._page].height;
        }

        if(width != null && height != null)
            info += width + "x" + height;
        set_info(".image-info", info);

        let seconds_old = (new Date() - new Date(illust_data.createDate)) / 1000;
        let age = helpers.age_to_string(seconds_old);
        this.container.querySelector(".post-age").dataset.popup = helpers.date_to_string(illust_data.createDate);
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

// A helper for a simple right-click context menu.
//
// The menu opens on right click and closes when the button is released.
ppixiv.popup_context_menu = class extends ppixiv.widget
{
    // Names for buttons, for storing in this.buttons_down.
    buttons = ["lmb", "rmb", "mmb"];

    constructor({...options})
    {
        super({...options, template: `
            <div class=popup-context-menu>
                <div class=button-strip>
                    <div class=button-block>
                        <div class="button button-view-manga" data-level=0 data-popup="View manga pages">
                            <ppixiv-inline src="resources/thumbnails-icon.svg"></ppixiv-inline>
                        </div>
                    </div>

                    <div class=button-block>
                        <div class="button button-fullscreen enabled" data-level=0 data-popup="Fullscreen">
                            <ppixiv-inline src="resources/fullscreen.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <div class=context-menu-image-info>
                        <div style="flex: 1;"></div>
                        <div class=page-count hidden></div>
                        <div class=image-info hidden></div>
                        <div class="post-age popup" hidden></div>
                        <div style="flex: 1;"></div>
                    </div>
                </div>
                <div class=button-strip>
                    <div class="button-block shift-left">
                        <div class="button button-browser-back enabled" data-level=0 data-popup="Back" style="transform: scaleX(-1);">
                            <ppixiv-inline src="resources/exit-icon.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <div class=button-block>
                        <div class="button requires-zoom button-zoom" data-popup="Toggle zoom">
                            <ppixiv-inline src="resources/zoom-plus.svg"></ppixiv-inline>
                            <ppixiv-inline src="resources/zoom-minus.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <div class=button-block>
                        <div class="button requires-zoom button-zoom-level" data-level="cover" data-popup="Zoom to cover">
                            <ppixiv-inline src="resources/zoom-full.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <div class=button-block>
                        <div class="button requires-zoom button-zoom-level" data-level="actual" data-popup="Zoom to actual size">
                            <ppixiv-inline src="resources/zoom-actual.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <!-- position: relative positions the popup menu. -->
                    <div class=button-block style="position: relative;">
                        <div class="button button-more enabled" data-popup="More...">
                            <ppixiv-inline src="resources/settings-icon.svg"></ppixiv-inline>
                        </div>
                        <div class=popup-more-options-container></div>
                    </div>
                </div>
                <div class=button-strip>
                    <div class="button-block shift-left">
                        <div class="avatar-widget-container"></div>

                        <div class="button button-parent-folder enabled" data-level=0 data-popup="Parent folder" hidden>
                            <span class="material-icons">folder</span>
                        </div>
                    </div>

                    <!-- position: relative positions the popup menu. -->
                    <div class="button-block button-container" style="position: relative;">
                        <!-- position: relative positions the bookmark count. -->
                        <div class="button button-bookmark public" data-bookmark-type=public style="position: relative;">
                            <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>

                            <div class=count></div>
                        </div>
                    </div>

                    <div class="button-block button-container">
                        <div class="button button-bookmark private" data-bookmark-type=private>
                            <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                        </div>
                    </div>
                    
                    <div class="button-block view-in-explorer button-container" hidden>
                        <a href=# class="button private popup local-link">
                            <span class="material-icons">description</span>                        
                        </a>
                    </div>
                    
                    <div class=button-block style="position: relative;">
                        <div class="button button-bookmark-tags" data-popup="Bookmark tags">
                            <ppixiv-inline src="resources/tag-icon.svg"></ppixiv-inline>
                        </div>
                        <div class=popup-bookmark-tag-dropdown-container></div>
                    </div>

                    <div class="button-block button-container">
                        <div class="button button-like enabled" style="position: relative;">
                            <ppixiv-inline src="resources/like-button.svg"></ppixiv-inline>

                            <div class=count></div>
                        </div>
                    </div>
                </div>

                <div class=tooltip-display>
                    <div class=tooltip-display-text></div>
                </div>
            </div>
        `});

        this.visible = false;
        this.hide = this.hide.pbind(this);

        this.pointer_listener = new ppixiv.pointer_listener({
            element: window,
            button_mask: 0b11,
            callback: this.pointerevent,
        });
        
        window.addEventListener("keydown", this.onkeyevent);
        window.addEventListener("keyup", this.onkeyevent);

        // Use key_listener to watch for ctrl being held.
        new key_listener("Control", this.ctrl_pressed);

        // Work around glitchiness in Chrome's click behavior (if we're in Chrome).
        new fix_chrome_clicks(this.container);

        this.container.addEventListener("mouseover", this.onmouseover, true);
        this.container.addEventListener("mouseout", this.onmouseout, true);

        // Whether the left and right mouse buttons are pressed:
        this.buttons_down = {};
    }

    context_menu_enabled_for_element(element)
    {
        while(element != null && element instanceof Element)
        {
            if(element.dataset.contextMenuTarget == "off")
                return false;

            if("contextMenuTarget" in element.dataset)
                return true;

            element = element.parentNode;
        }
        return false;
    }

    pointerevent = (e) =>
    {
        if(e.pressed)
        {
            if(!this.visible && !this.context_menu_enabled_for_element(e.target))
                return;
            
            if(!this.visible && e.mouseButton != 1)
                return;

            let button_name = this.buttons[e.mouseButton];
            if(button_name != null)
                this.buttons_down[button_name] = true;
            if(e.mouseButton != 1)
                return;

            // If invert-popup-hotkey is true, hold shift to open the popup menu.  Otherwise,
            // hold shift to suppress the popup menu so the browser context menu will open.
            //
            // Firefox doesn't cancel the context menu if shift is pressed.  This seems like a
            // well-intentioned but deeply confused attempt to let people override pages that
            // block the context menu, making it impossible for us to let you choose context
            // menu behavior and probably making it impossible for games to have sane keyboard
            // behavior at all.
            this.shift_was_pressed = e.shiftKey;
            if(navigator.userAgent.indexOf("Firefox/") == -1 && settings.get("invert-popup-hotkey"))
                this.shift_was_pressed = !this.shift_was_pressed;
            if(this.shift_was_pressed)
                return;

            e.preventDefault();
            e.stopPropagation();

            if(this.toggle_mode && this.visible)
                this.hide();
            else
                this.show(e.pageX, e.pageY, e.target);
        } else {
            // Releasing the left or right mouse button hides the menu if both the left
            // and right buttons are released.  Pressing right, then left, then releasing
            // right won't close the menu until left is also released.  This prevents lost
            // inputs when quickly right-left clicking.
            if(!this.visible)
                return;

            let button_name = this.buttons[e.mouseButton];
            if(button_name != null)
                this.buttons_down[button_name] = false;

            this.hide_if_all_buttons_released();
        }
    }

    // If true, RMB toggles the menu instead of displaying while held, and we'll also hide the
    // menu if the mouse moves too far away.
    get toggle_mode()
    {
        return settings.get("touchpad-mode", false);
    }

    // The subclass can override this to handle key events.  This is called whether the menu
    // is open or not.
    handle_key_event(e) { return false; }

    onkeyevent = (e) =>
    {
        if(e.repeat)
            return;

        // Don't eat inputs if we're inside an input.
        if(e.target.closest("input, textarea"))
            return;

        // Let the subclass handle events.
        if(this.handle_key_event(e))
        {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }

    ctrl_pressed = (down) =>
    {
        if(!settings.get("ctrl_opens_popup"))
            return;

        this.buttons_down["Control"] = down;

        if(down)
        {
            let x = pointer_listener.latest_mouse_position[0];
            let y = pointer_listener.latest_mouse_position[1];
            let node = document.elementFromPoint(x, y);
            this.show(x, y, node);
        } else {
            this.hide_if_all_buttons_released();
        }
    }

    // This is called on mouseup, and when keyboard shortcuts are released.  Hide the menu if all buttons
    // that can open the menu have been released.
    hide_if_all_buttons_released()
    {
        if(this.toggle_mode)
            return;

        if(!this.buttons_down["lmb"] && !this.buttons_down["rmb"] && !this.buttons_down["Control"])
            this.hide();
    }

    window_onblur = (e) =>
    {
        this.hide();
    }

    // Return the element that should be under the cursor when the menu is opened.
    get element_to_center()
    {
        return null;
    }

    show(x, y, target)
    {
        if(this.visible)
            return;

        // This is signalled when the context menu is closed, and can be awaited
        // with wait_until_closed.
        this._closed_signal = new AbortController;

        this.pointer_listener.check();

        this.displayed_menu = this.container;
        this.visible = true;
        this.refresh_visibility();

        // Disable popup UI while a context menu is open.
        document.body.classList.add("hide-ui");
        
        window.addEventListener("blur", this.window_onblur);

        // Disable all dragging while the context menu is open, since drags cause browsers to
        // forget to send mouseup events, which throws things out of whack.  We don't use
        // drag and drop and there's no real reason to use it while the context menu is open.
        window.addEventListener("dragstart", this.cancel_event, true);

        // In toggle mode, close the popup if anything outside is clicked.
        if(this.toggle_mode && this.click_outside_listener == null)
        {
            this.click_outside_listener = new click_outside_listener([this.container], () => {
                this.hide();
            });
        }

        var centered_element = this.element_to_center;
        if(centered_element == null)
            centered_element = this.displayed_menu;

        // The center of the centered element, relative to the menu.  Shift the center
        // down a bit in the button.
        var pos = helpers.get_relative_pos(centered_element, this.displayed_menu);
        pos[0] += centered_element.offsetWidth / 2;
        pos[1] += centered_element.offsetHeight * 3 / 4;
        x -= pos[0];
        y -= pos[1];
        this.displayed_menu.style.left = x + "px";
        this.displayed_menu.style.top = y + "px";

        // Adjust the fade-in so it's centered around the centered element.
        this.displayed_menu.style.transformOrigin = (pos[0]) + "px " + (pos[1]) + "px";

        hide_mouse_cursor_on_idle.disable_all("context-menu");
    }

    wait_until_closed()
    {
        if(this._closed_signal == null)
            return null;

        return this._closed_signal.signal.wait();
    }

    // If element is within a button that has a tooltip set, show it.
    show_tooltip_for_element(element)
    {
        if(element != null)
            element = element.closest("[data-popup]");
        
        if(this.tooltip_element == element)
            return;

        this.tooltip_element = element;
        this.refresh_tooltip();

        if(this.tooltip_observer)
        {
            this.tooltip_observer.disconnect();
            this.tooltip_observer = null;
        }

        if(this.tooltip_element == null)
            return;

        // Refresh the tooltip if the popup attribute changes while it's visible.
        this.tooltip_observer = new MutationObserver((mutations) => {
            for(var mutation of mutations) {
                if(mutation.type == "attributes")
                {
                    if(mutation.attributeName == "data-popup")
                        this.refresh_tooltip();
                }
            }
        });
        
        this.tooltip_observer.observe(this.tooltip_element, { attributes: true });
    }

    refresh_tooltip()
    {
        var element = this.tooltip_element;
        if(element != null)
            element = element.closest("[data-popup]");
        this.container.querySelector(".tooltip-display").hidden = element == null;
        if(element != null)
            this.container.querySelector(".tooltip-display-text").textContent = element.dataset.popup;
    }

    onmouseover = (e) =>
    {
        this.show_tooltip_for_element(e.target);
    }

    onmouseout = (e) =>
    {
        this.show_tooltip_for_element(e.relatedTarget);
    }

    get hide_temporarily()
    {
        return this.hidden_temporarily;
    }

    set hide_temporarily(value)
    {
        this.hidden_temporarily = value;
        this.refresh_visibility();
    }

    // True if the widget is active (eg. RMB is pressed) and we're not hidden
    // by a zoom.
    get actually_visible()
    {
        return this.visible && !this.hidden_temporarily;
    }

    visibility_changed()
    {
        super.visibility_changed();
        this.refresh_visibility();
    }

    refresh_visibility()
    {
        let visible = this.actually_visible;
        helpers.set_class(this.container, "visible-widget", visible);
        helpers.set_class(this.container, "visible", visible);
    }

    hide()
    {
        if(!this.visible)
            return;

        this.visible = false;
        this.hidden_temporarily = false;
        this.refresh_visibility();

        // Let menus inside the context menu know we're closing.
        view_hidden_listener.send_viewhidden(this.container);
        
        this.displayed_menu = null;
        hide_mouse_cursor_on_idle.enable_all("context-menu");
        this.buttons_down = {};
        document.body.classList.remove("hide-ui");
        window.removeEventListener("blur", this.window_onblur);
        window.removeEventListener("dragstart", this.cancel_event, true);

        if(this.click_outside_listener)
        {
            this.click_outside_listener.shutdown();
            this.click_outside_listener = null;
        }

        this._closed_signal.abort();
        this._closed_signal = null;
    }

    cancel_event = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();
    }
}

ppixiv.main_context_menu = class extends ppixiv.popup_context_menu
{
    // Return the singleton.
    static get get()
    {
        return main_context_menu._singleton;
    }

    constructor({...options})
    {
        super(options);

        if(main_context_menu._singleton != null)
            throw "Singleton already exists";
        main_context_menu._singleton = this;

        this._on_click_viewer = null;
        this._media_id = null;

        // Refresh the menu when the view changes.
        this.mode_observer = new MutationObserver((mutationsList, observer) => {
            for(var mutation of mutationsList) {
                if(mutation.type == "attributes")
                {
                    if(mutation.attributeName == "data-current-view")
                        this.refresh();
                }
            }
        });

        this.mode_observer.observe(document.body, {
            attributes: true, childList: false, subtree: false
        });

        // If the page is navigated while the popup menu is open, clear the ID the
        // user clicked on, so we refresh and show the default.
        window.addEventListener("popstate", (e) => {
            this._clicked_media_id = null;
            this.refresh();
        });

        this.container.querySelector(".button-view-manga").addEventListener("click", this.clicked_view_manga);
        this.container.querySelector(".button-fullscreen").addEventListener("click", this.clicked_fullscreen);
        this.container.querySelector(".button-zoom").addEventListener("click", this.clicked_zoom_toggle);
        this.container.querySelector(".button-browser-back").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            history.back();
        });

        this.container.addEventListener("click", this.handle_link_click);
        this.container.querySelector(".button-parent-folder").addEventListener("click", this.clicked_go_to_parent);

        for(var button of this.container.querySelectorAll(".button-zoom-level"))
            button.addEventListener("click", this.clicked_zoom_level);

        this.avatar_widget = new avatar_widget({
            container: this.container.querySelector(".avatar-widget-container"),
            mode: "overlay",
        });

        let bookmark_tag_widget = new bookmark_tag_list_widget({
            parent: this,
            container: this.container.querySelector(".popup-bookmark-tag-dropdown-container"),
        });
        let more_options_widget = new more_options_dropdown_widget({
            parent: this,
            container: this.container.querySelector(".popup-more-options-container"),
        });

        this.illust_widgets = [
            this.avatar_widget,
            bookmark_tag_widget,
            more_options_widget,
            new toggle_dropdown_menu_widget({
                contents: this.container.querySelector(".button-bookmark-tags"),
                parent: this,
                bookmark_tag_widget: bookmark_tag_widget,
                require_image: true,
            }),
            new toggle_dropdown_menu_widget({
                contents: this.container.querySelector(".button-more"),
                parent: this,
                bookmark_tag_widget: more_options_widget,
            }),
            new like_button_widget({
                parent: this,
                contents: this.container.querySelector(".button-like"),
            }),
            new like_count_widget({
                parent: this,
                contents: this.container.querySelector(".button-like .count"),
            }),
            new context_menu_image_info_widget({
                parent: this,
                contents: this.container.querySelector(".context-menu-image-info"),
            }),
            new bookmark_count_widget({
                parent: this,
                contents: this.container.querySelector(".button-bookmark.public .count")
            }),
        ];

        this.illust_widgets.push(new view_in_explorer_widget({
            parent: this,
            contents: this.container.querySelector(".view-in-explorer"),
        }));

        // The bookmark buttons, and clicks in the tag dropdown:
        for(let a of this.container.querySelectorAll("[data-bookmark-type]"))
        {
            this.illust_widgets.push(new bookmark_button_widget({
                parent: this,
                contents: a,
                bookmark_type: a.dataset.bookmarkType,
                bookmark_tag_widget: bookmark_tag_widget,
            }));
        }
        this.element_bookmark_tag_list = this.container.querySelector(".bookmark-tag-list");

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
    handle_link_click = (e) =>
    {
        // Do nothing if opening the popup while holding ctrl is disabled.
        if(!settings.get("ctrl_opens_popup"))
            return;

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

        let url = new URL(a.href, ppixiv.location);
        helpers.set_page_url(url, true, "Clicked link in context menu");
    }

    visibility_changed(value)
    {
        super.visibility_changed(value);

        if(this.visible)
            window.addEventListener("wheel", this.onwheel, {
                capture: true,

                // Work around Chrome intentionally breaking event listeners.  Remember when browsers
                // actually made an effort to not break things?
                passive: false,
            });
        else
            window.removeEventListener("wheel", this.onwheel, true);
    }

    // Return the media ID active in the context menu, or null if none.
    //
    // If we're opened by right clicking on an illust, we'll show that image's
    // info.  Otherwise, we'll show the info for the illust we're on, if any.
    get effective_media_id()
    {
        if(this._clicked_media_id != null)
            return this._clicked_media_id;
        else
            return this._media_id;
    }

    get effective_user_id()
    {
        if(this._clicked_user_id != null)
            return this._clicked_user_id;
        else if(this._user_id)
            return this._user_id;
        else
            return null;
    }

    // When the effective illust ID changes, let our widgets know.
    _effective_media_id_changed()
    {
        // If we're not visible, don't refresh an illust until we are, so we don't trigger
        // data loads.  Do refresh even if we're hidden if we have no illust to clear
        // the previous illust's display even if we're not visible, so it's not visible the
        // next time we're displayed.
        let media_id = this.effective_media_id;
        if(!this.visible && media_id != null)
            return;

        this.refresh();
    }

    set_media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;
        this._effective_media_id_changed();
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
    get user_id()
    {
        return this._user_id;
    }
    set user_id(user_id)
    {
        if(this._user_id == user_id)
            return;
        this._user_id = user_id;

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
        return view == "illust" && this._on_click_viewer != null && !this._on_click_viewer.slideshow_enabled;
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
        let media_id = this.effective_media_id;

        // All of these hotkeys require Ctrl.
        if(!e.ctrlKey)
            return;

        if(e.key.toUpperCase() == "V")
        {
            (async() => {
                if(media_id == null)
                    return;

                actions.like_image(media_id);
            })();

            return true;
        }

        if(e.key.toUpperCase() == "B")
        {
            (async() => {
                if(media_id == null)
                    return;

                let illust_data = await thumbnail_data.singleton().get_or_load_illust_data(media_id);

                // Ctrl-Shift-Alt-B: add a bookmark tag
                if(e.altKey && e.shiftKey)
                {
                    actions.add_new_tag(media_id);
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

                    actions.bookmark_remove(media_id);
                    return;
                }

                // Ctrl-B: bookmark with default privacy
                // Ctrl-Alt-B: bookmark privately
                let bookmark_privately = null;
                if(e.altKey)
                    bookmark_privately = true;

                if(illust_data.bookmarkData != null)
                {
                    message_widget.singleton.show("Already bookmarked (^B to remove bookmark)");
                    return;
                }

                actions.bookmark_add(media_id, {
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

                    await actions.unfollow(user_id);
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
            
                await actions.follow(user_id, follow_privately, []);
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

    onwheel = (e) =>
    {
        // RMB-wheel zooming is confusing in toggle mode.
        if(this.toggle_mode)
            return;

        // Stop if zooming isn't enabled.
        if(!this._is_zoom_ui_enabled)
            return;

        // Only mousewheel zoom if the popup menu is visible.
        if(!this.visible)
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

        this._on_click_viewer.stop_animation();

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
        this._effective_media_id_changed();

        // If RMB is pressed while dragging LMB, stop dragging the window when we
        // show the popup.
        if(this.on_click_viewer != null)
            this.on_click_viewer.stop_dragging();

        // See if an element representing a user and/or an illust was under the cursor.
        if(target != null)
        {
            let { user_id, media_id } = main_controller.singleton.get_illust_at_element(target);
            if(user_id != null)
                this._set_temporary_user(user_id);

            if(media_id != null)
                this._set_temporary_illust(media_id);
        }

        super.show(x, y, target);

        // Make sure we're up to date if we deferred an update while hidden.
        this._effective_media_id_changed();
    }

    // Set an alternative illust ID to show.  This is effective until the context menu is hidden.
    // This is used to remember what the cursor was over when the context menu was opened when in
    // the search view.
    async _set_temporary_illust(media_id)
    {
        // Store the media_id immediately, so it's available without waiting for image
        // info to load.
        this._clicked_media_id = media_id;

        this._effective_media_id_changed();
    }

    // Set an alternative user ID to show.  This is effective until the context menu is hidden.
    async _set_temporary_user(user_id)
    {
        this._clicked_user_id = user_id;
        this.refresh();
    }

    hide()
    {
        // For debugging, this can be set to temporarily force the context menu to stay open.
        if(unsafeWindow.keep_context_menu_open)
            return;

        this._clicked_user_id = null;
        this._clicked_media_id = null;

        // Don't refresh yet, so we try to not change the display while it fades out.
        // We'll do the refresh the next time we're displayed.
        // this._effective_media_id_changed();

        super.hide();
    }
    
    // Update selection highlight for the context menu.
    refresh()
    {
        let button_view_manga = this.container.querySelector(".button-view-manga");
        button_view_manga.dataset.popup = "View manga pages";
        helpers.set_class(button_view_manga, "enabled", main_controller.singleton.navigate_out_enabled);
        this.refresh_tooltip();

        // Enable the zoom buttons if we're in the image view and we have an on_click_viewer.
        for(var element of this.container.querySelectorAll(".button.requires-zoom"))
            helpers.set_class(element, "enabled", this._is_zoom_ui_enabled);

        // If we're visible, tell widgets what we're viewing.  Don't do this if we're not visible, so
        // they don't load data unnecessarily.  Don't set these back to null if we're hidden, so they
        // don't blank themselves while we're still fading out.
        if(this.visible)
        {
            let media_id = this.effective_media_id;
            let user_id = this.effective_user_id;
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
                let showing_viewed_image = (this._clicked_media_id == null);
                widget.show_page_number = showing_viewed_image;
            }

            // If we're on a local ID, show the parent folder button.  Otherwise, show the
            // author button.  We only show one or the other of these.
            //
            // If we don't have an illust ID, see if the data source has a folder ID, so this
            // works when right-clicking outside thumbs on search pages.
            let folder_button = this.container.querySelector(".button-parent-folder");
            let author_button = this.container.querySelector(".avatar-widget-container");

            let is_local = helpers.is_media_id_local(this.folder_id_for_parent);
            folder_button.hidden = !is_local;
            author_button.hidden = is_local;
            helpers.set_class(folder_button, "enabled", this.parent_folder_id != null);
        }

        if(this._is_zoom_ui_enabled)
        {
            helpers.set_class(this.container.querySelector(".button-zoom"), "selected", this._on_click_viewer.locked_zoom);

            var zoom_level = this._on_click_viewer.zoom_level;
            for(var button of this.container.querySelectorAll(".button-zoom-level"))
                helpers.set_class(button, "selected", this._on_click_viewer.locked_zoom && button.dataset.level == zoom_level);
        }
    }

    clicked_view_manga = (e) =>
    {
        main_controller.singleton.navigate_out();
    }

    clicked_fullscreen = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        helpers.toggle_fullscreen();
    }

    // "Zoom lock", zoom as if we're holding the button constantly
    clicked_zoom_toggle = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(!this._is_zoom_ui_enabled)
            return;
        
        this._on_click_viewer.stop_animation();

        let center = this._on_click_viewer.get_image_position([e.pageX, e.pageY]);
        this._on_click_viewer.locked_zoom = !this._on_click_viewer.locked_zoom;
        this._on_click_viewer.set_image_position([e.pageX, e.pageY], center);

        this.refresh();
    }

    clicked_zoom_level = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(!this._is_zoom_ui_enabled)
            return;

        this._on_click_viewer.stop_animation();

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


    // Return the illust ID whose parent the parent button will go to.
    get folder_id_for_parent()
    {
        return this.effective_media_id || this.data_source.viewing_folder;
    }

    // Return the folder ID that the parent button goes to.
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
}

