"use strict";

// This handles sending images from one tab to another.
ppixiv.SendImage = class
{
    // This is a singleton, so we never close this channel.
    static send_image_channel = new BroadcastChannel("ppixiv:send-image");

    // A UUID we use to identify ourself to other tabs:
    static tab_id = this.create_tab_id();
    static tab_id_tiebreaker = Date.now()
    
    static create_tab_id(recreate=false)
    {
        // If we have a saved tab ID, use it.
        if(!recreate && sessionStorage.ppixivTabId)
            return sessionStorage.ppixivTabId;

        // Make a new ID, and save it to the session.  This helps us keep the same ID
        // when we're reloaded.
        sessionStorage.ppixivTabId = helpers.create_uuid();
        return sessionStorage.ppixivTabId;
    }

    static known_tabs = {};
    
    static initialized = false;
    static init()
    {
        if(this.initialized)
            return;
        this.initialized = true;

        this.broadcast_tab_info = this.broadcast_tab_info.bind(this);

        window.addEventListener("unload", this.window_onunload.bind(this));

        // Let other tabs know when the info we send in tab info changes.  For resize, delay this
        // a bit so we don't spam broadcasts while the user is resizing the window.
        window.addEventListener("resize", (e) => {
            if(this.broadcast_info_after_resize_timer != -1)
                clearTimeout(this.broadcast_info_after_resize_timer);
            this.broadcast_info_after_resize_timer = setTimeout(this.broadcast_tab_info, 250);
        });
        window.addEventListener("visibilitychange", this.broadcast_tab_info);
        document.addEventListener("windowtitlechanged", this.broadcast_tab_info);

        // Send on window focus change, so we update things like screenX/screenY that we can't
        // monitor.
        window.addEventListener("focus", this.broadcast_tab_info);
        window.addEventListener("blur", this.broadcast_tab_info);
        window.addEventListener("popstate", this.broadcast_tab_info);

        SendImage.send_image_channel.addEventListener("message", this.received_message.bind(this));
        this.broadcast_tab_info();

        this.query_tabs();

        this.install_quick_view();
    }

    // If we're sending an image and the page is unloaded, try to cancel it.  This is
    // only registered when we're sending an image.
    static window_onunload(e)
    {
        // Tell other tabs that this tab has closed.
        SendImage.send_message({ message: "tab-closed" });
    }

    static query_tabs()
    {
        SendImage.send_message({ message: "list-tabs" });
    }

    // Send an image to another tab.  action is either "quick-view", to show the image temporarily,
    // or "display", to navigate to it.
    static async send_image(illust_id, page, tab_id, action)
    {
        // Send everything we know about the image, so the receiver doesn't have to
        // do a lookup.
        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        let illust_data = image_data.singleton().get_image_info_sync(illust_id);

        let user_id = illust_data?.userId;
        let user_info = user_id? image_data.singleton().get_user_info_sync(user_id):null;

        this.send_message({
            message: "send-image",
            from: SendImage.tab_id,
            to: tab_id,
            illust_id: illust_id,
            page: page,
            action: action, // "quick-view" or "display"
            thumbnail_info: thumbnail_info,
            illust_data: illust_data,
            user_info: user_info,
        }, true);
    }

    static received_message(e)
    {
        let data = e.data;
        if(data.message == "tab-info")
        {
            // Info about a new tab, or a change in visibility.
            //
            // This may contain thumbnail and illust info.  We don't register it here.  It
            // can be used explicitly when we're displaying a tab thumbnail, but each tab
            // might have newer or older image info, and propagating them back and forth
            // could be confusing.
            if(data.from == SendImage.tab_id)
            {
                // The other tab has the same ID we do.  The only way this normally happens
                // is if a tab is duplicated, which will duplicate its sessionStorage with it.
                // If this happens, use tab_id_tiebreaker to decide who wins.  The tab with
                // the higher value will recreate its tab ID.  This is set to the time when
                // we're loaded, so this will usually cause new tabs to be the one to create
                // a new ID.
                if(SendImage.tab_id_tiebreaker >= data.tab_id_tiebreaker)
                {
                    console.log("Creating a new tab ID due to ID conflict");
                    SendImage.tab_id = SendImage.create_tab_id(true /* recreate */ );
                }
                else
                    console.log("Tab ID conflict (other tab will create a new ID)");

                // Broadcast info.  If we recreated our ID then we want to broadcast it on the
                // new ID.  If we didn't, we still want to broadcast it to replace the info
                // the other tab just sent on our ID.
                this.broadcast_tab_info();
            }
            this.known_tabs[data.from] = data;
        }
        else if(data.message == "tab-closed")
        {
            delete this.known_tabs[data.from];
        }
        else if(data.message == "list-tabs")
        {
            // A new tab is populating its tab list.
            this.broadcast_tab_info();
        }
        else if(data.message == "send-image")
        {
            // If to is null, a tab is sending a quick view preview.  Show this preview if this
            // tab is a quick view target and the document is visible.  Otherwise, to is a tab
            // ID, so only preview if it's us.
            if(data.to == null)
            {
                if(settings.get("no_receive_quick_view") || document.hidden)
                {
                    console.log("Not receiving quick view");
                    return;
                }
            }
            else if(data.to != SendImage.tab_id)
                return;

            // If this message has illust info or thumbnail info, register it.
            let thumbnail_info = data.thumbnail_info;
            if(thumbnail_info != null)
                thumbnail_data.singleton().loaded_thumbnail_info([thumbnail_info], "normal");

            let user_info = data.user_info;
            if(user_info != null)
                image_data.singleton().add_user_data(user_info);

            let illust_data = data.illust_data;
            if(illust_data != null)
                image_data.singleton().add_illust_data(illust_data);

            // To finalize, just remove preview and quick-view from the URL to turn the current
            // preview into a real navigation.  This is slightly different from sending "display"
            // with the illust ID, since it handles navigation during quick view.
            if(data.action == "finalize")
            {
                let args = ppixiv.helpers.args.location;
                args.hash.delete("virtual");
                args.hash.delete("quick-view");
                ppixiv.helpers.set_page_url(args, false, "navigation");
                return;
            }

            if(data.action == "cancel")
            {
                this.hide_preview_image();
                return;
            }

            // Otherwise, we're displaying an image.  quick-view displays in quick-view+virtual
            // mode, display just navigates to the image normally.
            console.assert(data.action == "quick-view" || data.action == "display");

            // Show the image.
            main_controller.singleton.show_illust(data.illust_id, {
                page: data.page,
                quick_view: data.action == "quick-view",
                source: "quick-view",

                // When we first show a preview, add it to history.  If we show another image
                // or finalize the previewed image while we're showing a preview, replace the
                // preview history entry.
                add_to_history: !ppixiv.history.virtual,
            });
        }
        else if(data.message == "preview-mouse-movement")
        {
            // Ignore this message if we're not displaying a quick view image.
            if(!ppixiv.history.virtual)
                return;
            
            // The mouse moved in the tab that's sending quick view.  Broadcast an event
            // like pointermove.
            let event = new PointerEvent("quickviewpointermove", {
                movementX: data.x,
                movementY: data.y,
            });

            window.dispatchEvent(event);
        }
    }

    static broadcast_tab_info()
    {
        let screen = main_controller.singleton.displayed_screen;
        let illust_id = screen? screen.displayed_illust_id:null;
        let page = screen? screen.displayed_illust_page:null;
        let thumbnail_info = illust_id? thumbnail_data.singleton().get_one_thumbnail_info(illust_id):null;
        let illust_data = illust_id? image_data.singleton().get_image_info_sync(illust_id):null;

        let user_id = illust_data?.userId;
        let user_info = user_id? image_data.singleton().get_user_info_sync(user_id):null;

        let our_tab_info = {
            message: "tab-info",
            tab_id_tiebreaker: SendImage.tab_id_tiebreaker,
            visible: !document.hidden,
            title: document.title,
            window_width: window.innerWidth,
            window_height: window.innerHeight,
            screen_x: window.screenX,
            screen_y: window.screenY,
            illust_id: illust_id,
            page: page,

            // Include whatever we know about this image, so if we want to display this in
            // another tab, we don't have to look it up again.
            thumbnail_info: thumbnail_info,
            illust_data: illust_data,
            user_info: user_info,
        };

        // Add any extra data we've been given.
        for(let key in this.extra_data)
            our_tab_info[key] = this.extra_data[key];

        this.send_message(our_tab_info);

        // Add us to our own known_tabs.
        this.known_tabs[SendImage.tab_id] = our_tab_info;
    }

    // Allow adding extra data to tab info.  This lets us include things like the image
    // zoom position without having to propagate it around.
    static extra_data = {};
    static set_extra_data(key, data, send_immediately)
    {
        this.extra_data[key] = data;
        if(send_immediately)
            this.broadcast_tab_info();
    }

    static send_message(data, send_to_self)
    {
        // Include the tab ID in all messages.
        data.from = this.tab_id;
        this.send_image_channel.postMessage(data);

        if(send_to_self)
        {
            // Make a copy of data, so we don't modify the caller's copy.
            data = JSON.parse(JSON.stringify(data));

            // Set self to true to let us know that this is our own message.
            data.self = true;
            this.send_image_channel.dispatchEvent(new MessageEvent("message", { data: data }));
        }
    }

    // This is called if something else changes the illust while we're in quick view.  Send it
    // as a quick-view instead.
    static illust_change_during_quick_view(illust_id, page)
    {
        // This should only happen while we're in quick view.
        console.assert(ppixiv.history.virtual);

        SendImage.send_image(illust_id, page, null, "quick-view");
    }

    // If we're currently showing a preview image sent from another tab, back out to
    // where we were before.
    static hide_preview_image()
    {
        let was_in_preview = ppixiv.history.virtual;
        if(!was_in_preview)
            return;

        ppixiv.history.back();        
    }

    static install_quick_view()
    {
        let setup = () => {
            // Remove old event handlers.
            if(this.quick_view_active)
            {
                this.quick_view_active.abort();
                this.quick_view_active = null;
            }

       
            // Stop if quick view isn't enabled.
            if(!settings.get("quick_view"))
                return;
            
            this.quick_view_active = new AbortController();
            window.addEventListener("click", this.quick_view_window_onclick, { signal: this.quick_view_active.signal, capture: true });

            new ppixiv.pointer_listener({
                element: window,
                button_mask: 0b11,
                signal: this.quick_view_active.signal,
                callback: this.quick_view_pointerevent,
            });
        };

        // Set up listeners, and update them when the quick view setting changes.
        setup();
        settings.register_change_callback("quick_view", setup);
    }

    static quick_view_started(pointer_id)
    {
        // Hide the cursor, and capture the cursor to the document so it stays hidden.
        document.body.style.cursor = "none";

        this.captured_pointer_id = pointer_id;
        document.body.setPointerCapture(this.captured_pointer_id);
        
        // Pause thumbnail animations, so they don't keep playing while viewing an image
        // in another tab.
        document.body.classList.add("pause-thumbnail-animation");

        // Listen to pointer movement during quick view.
        window.addEventListener("pointermove", this.quick_view_window_onpointermove);
        window.addEventListener("contextmenu", this.quick_view_window_oncontextmenu, { capture: true });
    }

    static quick_view_stopped()
    {
        if(this.captured_pointer_id != null)
        {
            document.body.releasePointerCapture(this.captured_pointer_id);
            this.captured_pointer_id = null;
        }

        document.body.classList.remove("pause-thumbnail-animation");
        window.removeEventListener("pointermove", this.quick_view_window_onpointermove);
        window.removeEventListener("contextmenu", this.quick_view_window_oncontextmenu, { capture: true });

        document.body.style.cursor = "";
    }

    static finalize_quick_view()
    {
        this.quick_view_stopped();

        SendImage.send_message({ message: "send-image", action: "finalize", to: null }, true);
    }

    static quick_view_pointerevent = (e) =>
    {
        if(e.pressed && e.mouseButton == 0)
        {
            // See if the click is on an image search result.
            let { illust_id, page } = main_controller.singleton.get_illust_at_element(e.target);
            if(illust_id == null)
                return;

            e.preventDefault();
            e.stopImmediatePropagation();

            // This should never happen, but make sure we don't register duplicate pointermove events.
            if(this.previewing_image)
                return;

            // Quick view this image.
            this.previewing_image = true;
            SendImage.send_image(illust_id, page, null, "quick-view");

            this.quick_view_started(e.pointerId);
        }

        // Right-clicking while quick viewing an image locks the image, so it doesn't go away
        // when the LMB is released.
        if(e.pressed && e.mouseButton == 1)
        {
            if(!this.previewing_image)
                return;

            e.preventDefault();
            e.stopImmediatePropagation();

            this.finalize_quick_view();
        }

        // Releasing LMB while previewing an image stops previewing.
        if(!e.pressed && e.mouseButton == 0)
        {
            if(!this.previewing_image)
                return;
            this.previewing_image = false;
            
            e.preventDefault();
            e.stopImmediatePropagation();

            this.quick_view_stopped();

            SendImage.send_message({ message: "send-image", action: "cancel", to: null }, true);
        }
    }

    static quick_view_window_onclick = (e) =>
    {
        if(e.button != 0)
            return;

        // Work around one of the oldest design mistakes: cancelling mouseup doesn't prevent
        // the resulting click.  Check if this click was on an element that was handled by
        // quick view, and cancel it if it was.
        let { illust_id, page } = main_controller.singleton.get_illust_at_element(e.target);
        if(illust_id == null)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();
    }

    // Work around another wonderful bug: while pointer lock is active, we don't get pointerdown
    // events for *other* mouse buttons.  That doesn't make much sense.  Work around it by
    // assuming RMB will fire contextmenu.
    static quick_view_window_oncontextmenu = (e) =>
    {
        console.log("context", e.button);
        e.preventDefault();
        e.stopImmediatePropagation();

        this.finalize_quick_view();
    }

    // This is only registered while we're quick viewing, to send mouse movements to
    // anything displaying the image.
    static quick_view_window_onpointermove = (e) =>
    {
        SendImage.send_message({
            message: "preview-mouse-movement",
            x: e.movementX,
            y: e.movementY,
        }, true);
    }
};

// A context menu widget showing known tabs on the desktop to send images to.
ppixiv.send_image_widget = class extends ppixiv.illust_widget
{
    constructor(options)
    {
        super(options);

        let contents = helpers.create_from_template(".template-popup-send-image");
        this.container.appendChild(contents);

        this.dropdown_list = this.container.querySelector(".list");

        // Close the dropdown if the popup menu is closed.
        new view_hidden_listener(this.container, (e) => { this.visible = false; });

        // Refresh when the image data changes.
        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    get visible()
    {
        return this.container.classList.contains("visible");
    }
    
    set visible(value)
    {
        if(this.container.classList.contains("visible") == value)
            return;

        helpers.set_class(this.container, "visible", value);

        if(value)
        {
            // Refresh when we're displayed.
            this.refresh();
        }
        else
        {
            // Make sure we don't leave a tab highlighted if we're hidden.
            this.unhighlight_tab();
        }
    }

    // Stop highlighting a tab.
    unhighlight_tab()
    {
        if(this.previewing_on_tab == null)
            return;

        // Stop previewing the tab.
        SendImage.send_message({ message: "send-image", action: "cancel", to: this.previewing_on_tab }, true);

        this.previewing_on_tab = null;
    }

    refresh()
    {
        // Clean out the old tab list.
        var old_tab_entries = this.container.querySelectorAll(".tab-entry");
        for(let entry of old_tab_entries)
            entry.remove();

        // Make sure the dropdown is hidden if we have no image.
        if(this._illust_id == null)
            this.visible = false;

        if(!this.visible)
            return;

        // Start preloading the image and image data, so it gives it a head start to be cached
        // when the other tab displays it.  We don't need to wait for this to display our UI.
        image_data.singleton().get_image_info(this._illust_id).then((illust_data) => {
            helpers.preload_images([illust_data.urls.original]);
        });

        let tab_ids = Object.keys(SendImage.known_tabs);

        // We'll create icons representing the aspect ratio of each tab.  This is a quick way
        // to identify tabs when they have different sizes.  Find the max width and height of
        // any tab, so we can scale relative to it.
        let max_width = 1, max_height = 1;
        let desktop_min_x = 999999, desktop_max_x = -999999;
        let desktop_min_y = 999999, desktop_max_y = -999999;
        let found_any = false;
        for(let tab_id of tab_ids)
        {
            let info = SendImage.known_tabs[tab_id];
            if(!info.visible)
                continue;

            desktop_min_x = Math.min(desktop_min_x, info.screen_x);
            desktop_min_y = Math.min(desktop_min_y, info.screen_y);
            desktop_max_x = Math.max(desktop_max_x, info.screen_x + info.window_width);
            desktop_max_y = Math.max(desktop_max_y, info.screen_y + info.window_height);

            max_width = Math.max(max_width, info.window_width);
            max_height = Math.max(max_height, info.window_height);

            if(tab_id != SendImage.tab_id)
                found_any = true;
        }

        // If there are no tabs other than ourself, show the intro.
        this.container.querySelector(".no-other-tabs").hidden = found_any;
        if(!found_any)
        {
            this.dropdown_list.style.width = this.dropdown_list.style.height = "";
            return;
        }

        let desktop_width = desktop_max_x - desktop_min_x;
        let desktop_height = desktop_max_y - desktop_min_y;

        // Scale the maximum dimension of the largest tab to a fixed size, and the other
        // tabs relative to it, so we show the relative shape and dimensions of each tab.
        let max_dimension = 400;
        let scale_by = max_dimension / Math.max(desktop_width, desktop_height);

        // Scale the overall size to fit.
        desktop_width *= scale_by;
        desktop_height *= scale_by;

        let offset_x_by = -desktop_min_x * scale_by;
        let offset_y_by = -desktop_min_y * scale_by;

        // Set the size of the containing box.
        this.dropdown_list.style.width = `${desktop_width}px`;
        this.dropdown_list.style.height = `${desktop_height}px`;

        // If the popup is off the screen, shift it in.  We don't do this with the popup
        // menu to keep buttons in the same relative positions all the time, but this popup
        // tends to overflow.
        {
            this.container.style.margin = "0"; // reset
            let [actual_pos_x, actual_pos_y] = helpers.get_relative_pos(this.dropdown_list, document.body);
            let wanted_pos_x = helpers.clamp(actual_pos_x, 20, window.innerWidth-desktop_width-20);
            let wanted_pos_y = helpers.clamp(actual_pos_y, 20, window.innerHeight-desktop_height-20);
            let shift_window_x = wanted_pos_x - actual_pos_x;
            let shift_window_y = wanted_pos_y - actual_pos_y;
            this.container.style.marginLeft = `${shift_window_x}px`;
            this.container.style.marginTop = `${shift_window_y}px`;
        }
        
        // Add an entry for each tab we know about.
        for(let tab_id of tab_ids)
        {
            let info = SendImage.known_tabs[tab_id];

            // For now, only show visible tabs.
            if(!info.visible)
                continue;

            let entry = this.create_tab_entry(tab_id);
            this.dropdown_list.appendChild(entry);

            // Position this entry.
            let left = info.screen_x * scale_by + offset_x_by;
            let top = info.screen_y * scale_by + offset_y_by;
            let width = info.window_width * scale_by;
            let height = info.window_height * scale_by;
            entry.style.left = `${left}px`;
            entry.style.top = `${top}px`;
            entry.style.width = `${width}px`;
            entry.style.height =`${height}px`;
            entry.style.display = "block";
        }
    }

    create_tab_entry(tab_id)
    {
        let info = SendImage.known_tabs[tab_id];

        let entry = helpers.create_from_template(".template-send-image-tab");
        entry.dataset.tab_id = tab_id;

        if(info.visible)
            entry.classList.add("tab-visible");

        // If this tab is our own window:
        if(tab_id == SendImage.tab_id)
            entry.classList.add("self");

        // Set the image.
        let img = entry.querySelector(".shown-image");
        img.hidden = true;

        let image_url = null;
        if(info.illust_data)
        {
            image_url = info.illust_data.urls.small;
            if(info.page > 0)
                image_url = info.illust_data.previewUrls[info.page];
        }
        else if(info.thumbnail_info)
        {
            image_url = info.thumbnail_info.url;
        }

        if(image_url && info.illust_screen_pos)
        {
            img.hidden = false;
            img.src = image_url;

            // Position the image in the same way it is in the tab.  The container is the same
            // dimensions as the window, so we can just copy the final percentages.
            img.style.top = `${info.illust_screen_pos.top*100}%`;
            img.style.left = `${info.illust_screen_pos.left*100}%`;
            img.style.width = `${info.illust_screen_pos.width*100}%`;
            img.style.height = `${info.illust_screen_pos.height*100}%`;
        }
        else
        {
            // Show the mock search image if we have no image URL.
            entry.querySelector(".search-tab").hidden = false;
        }

        // We don't need mouse event listeners for ourself.
        if(tab_id == SendImage.tab_id)
            return entry;

        entry.addEventListener("click", (e) => {
            if(tab_id == SendImage.tab_id)
                return;            

            // On click, send the image for display, and close the dropdown.
            SendImage.send_image(this._illust_id, this._page, tab_id, "display");
            this.visible = false;
            this.previewing_on_tab = null;
        });

        entry.addEventListener("mouseenter", (e) => {
            let entry = e.target.closest(".tab-entry");
            if(!entry)
                return;

            SendImage.send_image(this._illust_id, this._page, tab_id, "quick-view");
            this.previewing_on_tab = tab_id;
        });

        entry.addEventListener("mouseleave", (e) => {
            let entry = e.target.closest(".tab-entry");
            if(!entry)
                return;

            this.unhighlight_tab();
        });

        return entry;
    }
}

