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

        this.listeners = {};

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

        // If we gain focus while quick view is active, finalize the image.  Virtual
        // history isn't meant to be left enabled, since it doesn't interact with browser
        // history.
        window.addEventListener("focus", (e) => {
            let args = ppixiv.helpers.args.location;
            if(args.hash.has("temp-view"))
            {
                console.log("Finalizing quick view image because we gained focus");
                args.hash.delete("virtual");
                args.hash.delete("temp-view");
                ppixiv.helpers.set_page_url(args, false, "navigation");
            }
        });

        SendImage.send_image_channel.addEventListener("message", this.received_message.bind(this));
        this.broadcast_tab_info();

        this.query_tabs();
    }

    static add_message_listener(message, func)
    {
        if(!this.listeners[message])
            this.listeners[message] = [];
        this.listeners[message].push(func);

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

    // Send an image to another tab.  action is either "temp-view", to show the image temporarily,
    // or "display", to navigate to it.
    static async send_image(illust_id, page, tab_ids, action)
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
            to: tab_ids,
            illust_id: illust_id,
            page: page,
            action: action, // "temp-view" or "display"
            thumbnail_info: thumbnail_info,
            illust_data: illust_data,
            user_info: user_info,
        }, false);
    }

    static received_message(e)
    {
        let data = e.data;

        // If this message has a target and it's not us, ignore it.
        if(data.to && data.to.indexOf(SendImage.tab_id) == -1)
            return;

        // Call any listeners for this message.
        if(this.listeners[data.message])
        {
            for(let func of this.listeners[data.message])
                func(data);
        }

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
            // If this message has illust info or thumbnail info, register it.
            let thumbnail_info = data.thumbnail_info;
            if(thumbnail_info != null)
                thumbnail_data.singleton().loaded_thumbnail_info([thumbnail_info], "internal");

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
                args.hash.delete("temp-view");
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
            console.assert(data.action == "temp-view" || data.action == "display", data.actionj);

            // Show the image.
            main_controller.singleton.show_illust(data.illust_id, {
                page: data.page,
                temp_view: data.action == "temp-view",
                source: "temp-view",

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

    // If we're currently showing a preview image sent from another tab, back out to
    // where we were before.
    static hide_preview_image()
    {
        let was_in_preview = ppixiv.history.virtual;
        if(!was_in_preview)
            return;

        ppixiv.history.back();        
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
        SendImage.send_message({ message: "send-image", action: "cancel", to: [this.previewing_on_tab] }, true);

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
            image_url = info.illust_data.previewUrls[info.page];
        }
        else if(info.thumbnail_info)
        {
            image_url = info.thumbnail_info.previewUrls[0];
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

            SendImage.send_image(this._illust_id, this._page, tab_id, "temp-view");
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

ppixiv.link_tabs_popup = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({template: "template-link-tabs", ...options});

        this.container.querySelector(".close-button").addEventListener("click", (e) => {
            this.visible = false;
        });

        // Close if the container is clicked, but not if something inside the container is clicked.
        this.container.addEventListener("click", (e) => {
            if(e.target != this.container)
                return;

            this.visible = false;
        });

        new menu_option_toggle(this.container.querySelector(".toggle-enabled"), {
            label: "Enabled",
            setting: "linked_tabs_enabled",
        });

        // Refresh the "unlink all tabs" button when the linked tab list changes.
        settings.register_change_callback("linked_tabs", this.refresh_unlink_all);
        this.refresh_unlink_all();

        this.container.querySelector(".unlink-all").addEventListener("click", (e) => {
            settings.set("linked_tabs", []);
            this.send_link_tab_message();
        });

        // The other tab will send these messages when the link and unlink buttons
        // are clicked.
        SendImage.add_message_listener("link-this-tab", (message) => {
            let tab_ids = settings.get("linked_tabs", []);
            if(tab_ids.indexOf(message.from) == -1)
                tab_ids.push(message.from);

            settings.set("linked_tabs", tab_ids);

            this.send_link_tab_message();
        });

        SendImage.add_message_listener("unlink-this-tab", (message) => {
            let tab_ids = settings.get("linked_tabs", []);
            let idx = tab_ids.indexOf(message.from);
            if(idx != -1)
                tab_ids.splice(idx, 1);

            settings.set("linked_tabs", tab_ids);

            this.send_link_tab_message();
        });

        this.visible = false;
    }

    refresh_unlink_all = () =>
    {
        let any_tabs_linked = settings.get("linked_tabs", []).length > 0;
        this.container.querySelector(".unlink-all").hidden = !any_tabs_linked;
    }

    send_link_tab_message = () =>
    {
        // This will cause other tabs to show their linking UI, so only send this
        // if we're active.
        if(!this.visible)
            return;

        SendImage.send_message({
            message: "show-link-tab",
            linked_tabs: settings.get("linked_tabs", []),
        });
    }

    start_sending_link_tab_message()
    {
        if(this.send_id == null)
            this.send_id = setInterval(this.send_link_tab_message, 1000);

        this.send_link_tab_message();
    }

    stop_sending_link_tab_message()
    {
        if(this.send_id != null)
        {
            clearInterval(this.send_id);
            this.send_id = null;

            SendImage.send_message({ message: "hide-link-tab" });
        }
    }

    get visible() { return !this.container.hidden; }
    set visible(value)
    {
        this.container.hidden = !value;
        if(value)
            this.start_sending_link_tab_message();
        else
            this.stop_sending_link_tab_message();
    }
}

ppixiv.link_this_tab_popup = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({template: "template-link-this-tab", ...options});

        this.visible = false;

        // Show ourself when we see a show-link-tab message and hide if we see a
        // hide-link-tab-message.
        SendImage.add_message_listener("show-link-tab", (message) => {
            this.visible = true;

            this.other_tab_id = message.from;

            let linked = message.linked_tabs.indexOf(SendImage.tab_id) != -1;
            this.container.querySelector(".link-this-tab").hidden = linked;
            this.container.querySelector(".unlink-this-tab").hidden = !linked;
        });

        SendImage.add_message_listener("hide-link-tab", (message) => {
            this.visible = false;
        });

        // When "link this tab" is clicked, send a link-this-tab message.
        this.container.querySelector(".link-this-tab").addEventListener("click", (e) => {
            SendImage.send_message({ message: "link-this-tab", to: [this.other_tab_id] });

            // If we're linked to another tab, clear our linked tab list, to try to make
            // sure we don't have weird chains of tabs linking each other.
            settings.set("linked_tabs", []);
        });

        this.container.querySelector(".unlink-this-tab").addEventListener("click", (e) => {
            SendImage.send_message({ message: "unlink-this-tab", to: [this.other_tab_id] });
        });
    }

    set visible(value)
    {
        this.container.hidden = !value;

        if(this.visible_timer)
            clearTimeout(this.visible_timer);

        // Hide if we don't see a show-link-tab message for a few seconds, as a
        // safety in case the other tab dies.
        if(value)
        {
            this.visible_timer = setTimeout(() => {
                this.visible = false;
            }, 2000);
        }
    }
}

ppixiv.send_image_popup = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({template: "template-send-image", ...options});

        // Close if the container is clicked, but not if something inside the container is clicked.
        this.container.addEventListener("click", (e) => {
            if(e.target != this.container)
                return;

            this.visible = false;
        });

        SendImage.add_message_listener("take-image", (message) => {
            let tab_id = message.from;
            SendImage.send_image(this.illust_id, this.page, [tab_id], "display");

            this.visible = false;
        });

        this.visible = false;
    }

    show_for_illust(illust_id, page)
    {
        this.illust_id = illust_id;
        this.page = page;
        this.visible = true;
    }

    send_show_send_image_message = () =>
    {
        // This will cause other tabs to show their linking UI, so only send this
        // if we're active.
        if(!this.visible)
            return;

        SendImage.send_message({
            message: "show-send-image",
        });
    }

    start_sending_show_send_image_message()
    {
        if(this.send_id == null)
            this.send_id = setInterval(this.send_show_send_image_message, 1000);

        this.send_show_send_image_message();
    }

    stop_sending_show_send_image_message()
    {
        if(this.send_id != null)
        {
            clearInterval(this.send_id);
            this.send_id = null;

            SendImage.send_message({ message: "hide-send-image" });
        }
    }

    get visible() { return !this.container.hidden; }
    set visible(value)
    {
        this.container.hidden = !value;
        if(value)
            this.start_sending_show_send_image_message();
        else
            this.stop_sending_show_send_image_message();
    }
}

ppixiv.send_here_popup = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({template: "template-send-here", ...options});

        this.visible = false;

        // Show ourself when we see a show-link-tab message and hide if we see a
        // hide-link-tab-message.
        SendImage.add_message_listener("show-send-image", (message) => {
            this.visible = true;
            this.other_tab_id = message.from;
        });

        SendImage.add_message_listener("hide-send-image", (message) => {
            this.visible = false;
        });
    }

    take_image = (e) =>
    {
        // Send take-image.  The sending tab will respond with a send-image message.
        SendImage.send_message({ message: "take-image", to: [this.other_tab_id] });
    }

    set visible(value)
    {
        this.container.hidden = !value;

        if(this.visible_timer)
            clearTimeout(this.visible_timer);

        // Hide if we don't see a show-link-tab message for a few seconds, as a
        // safety in case the other tab dies.
        if(value)
        {
            window.addEventListener("click", this.take_image);

            this.visible_timer = setTimeout(() => {
                this.visible = false;
            }, 2000);
        }
        else
        {
            window.removeEventListener("click", this.take_image);
        }
    }
}
