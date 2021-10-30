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
        this.pending_movement = [0, 0];

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

        this.send_message(our_tab_info);

        // Add us to our own known_tabs.
        this.known_tabs[SendImage.tab_id] = our_tab_info;
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

    static send_mouse_movement_to_linked_tabs(x, y)
    {
        let tab_ids = settings.get("linked_tabs", []);
        if(tab_ids.length == 0)
            return;

        this.pending_movement[0] += x;
        this.pending_movement[1] += y;

        // Limit the rate we send these, since mice with high report rates can send updates
        // fast enough to saturate BroadcastChannel and cause messages to back up.  Add up
        // movement if we're sending too quickly and batch it into the next message.
        if(this.last_movement_message_time != null && Date.now() - this.last_movement_message_time < 10)
            return;

        this.last_movement_message_time = Date.now();

        SendImage.send_message({
            message: "preview-mouse-movement",
            x: this.pending_movement[0],
            y: this.pending_movement[1],
            to: tab_ids,
        }, false);
        
        this.pending_movement = [0, 0];
    }
};

ppixiv.link_tabs_popup = class extends ppixiv.dialog_widget
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

        new menu_option_toggle({
            container: this.container.querySelector(".toggle-enabled"),
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
        // We should always be visible when this is called.
        console.assert(this.visible);

        SendImage.send_message({
            message: "show-link-tab",
            linked_tabs: settings.get("linked_tabs", []),
        });
    }

    visibility_changed()
    {
        if(!this.visible)
        {
            SendImage.send_message({ message: "hide-link-tab" });
            return;
        }

        helpers.interval(this.send_link_tab_message, 1000, this.visibility_abort.signal);
    }
}

ppixiv.link_this_tab_popup = class extends ppixiv.dialog_widget
{
    constructor({...options})
    {
        super({template: "template-link-this-tab", ...options});

        this.hide_timer = new helpers.timer(() => { this.visible = false; });

        // Show ourself when we see a show-link-tab message and hide if we see a
        // hide-link-tab-message.
        SendImage.add_message_listener("show-link-tab", (message) => {
            this.other_tab_id = message.from;
            this.hide_timer.set(2000);

            let linked = message.linked_tabs.indexOf(SendImage.tab_id) != -1;
            this.container.querySelector(".link-this-tab").hidden = linked;
            this.container.querySelector(".unlink-this-tab").hidden = !linked;

            this.visible = true;
        });

        SendImage.add_message_listener("hide-link-tab", (message) => {
            this.hide_timer.clear();
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

        this.visible = false;
    }

    visibility_changed()
    {
        this.hide_timer.clear();

        // Hide if we don't see a show-link-tab message for a few seconds, as a
        // safety in case the other tab dies.
        if(this.visible)
            this.hide_timer.set(2000);
    }
}

ppixiv.send_image_popup = class extends ppixiv.dialog_widget
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

    visibility_changed()
    {
        if(!this.visible)
        {
            SendImage.send_message({ message: "hide-send-image" });
            return;
        }

        helpers.interval(() => {
            // We should always be visible when this is called.
            console.assert(this.visible);

            SendImage.send_message({ message: "show-send-image" });
        }, 1000, this.visibility_abort.signal);
    }
}

ppixiv.send_here_popup = class extends ppixiv.dialog_widget
{
    constructor({...options})
    {
        super({template: "template-send-here", ...options});

        this.hide_timer = new helpers.timer(() => { this.visible = false; });

        // Show ourself when we see a show-link-tab message and hide if we see a
        // hide-link-tab-message.
        SendImage.add_message_listener("show-send-image", (message) => {
            this.other_tab_id = message.from;
            this.hide_timer.set(2000);
            this.visible = true;
        });

        SendImage.add_message_listener("hide-send-image", (message) => {
            this.hide_timer.clear();
            this.visible = false;
        });

        this.visible = false;
    }

    take_image = (e) =>
    {
        // Send take-image.  The sending tab will respond with a send-image message.
        SendImage.send_message({ message: "take-image", to: [this.other_tab_id] });
    }

    visibility_changed()
    {
        this.hide_timer.clear();

        // Hide if we don't see a show-send-image message for a few seconds, as a
        // safety in case the other tab dies.
        if(this.visible)
        {
            window.addEventListener("click", this.take_image, { signal: this.visibility_abort.signal });
            this.hide_timer.set(2000);
        }
    }
}
