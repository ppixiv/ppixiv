"use strict";

// This handles sending images from one tab to another.
ppixiv.SendImage = class
{
    // This is a singleton, so we never close this channel.
    static send_image_channel = new ppixiv.LocalBroadcastChannel("ppixiv:send-image");

    // A UUID we use to identify ourself to other tabs:
    static tab_id = this.create_tab_id();
    static tab_id_tiebreaker = Date.now()
    
    static create_tab_id(recreate=false)
    {
        // If we have a saved tab ID, use it.
        //
        // sessionStorage on Android Chrome is broken.  Home screen apps should retain session storage
        // for that particular home screen item, but they don't.  (This isn't a problem on iOS.)  Use
        // localStorage instead, which means things like linked tabs will link to the device instead of
        // the instance.  That's usually good enough if you're linking to a phone or tablet.
        let storage = ppixiv.android? localStorage:sessionStorage;
        if(!recreate && storage.ppixivTabId)
            return storage.ppixivTabId;

        // Make a new ID, and save it to the session.  This helps us keep the same ID
        // when we're reloaded.
        storage.ppixivTabId = helpers.create_uuid();
        return storage.ppixivTabId;
    }

    static known_tabs = {};
    
    static initialized = false;
    static init()
    {
        if(this.initialized)
            return;
        this.initialized = true;

        this.pending_movement = [0, 0];

        this.listeners = {};

        window.addEventListener("unload", this.window_onunload);

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
        // history.  On mobile, do this on any touch.
        window.addEventListener(mobile? "pointerdown":"focus", (e) => {
            this.finalize_quick_view_image();
        }, { capture: true });

        image_data.singleton().illust_modified_callbacks.register((media_id) => { this.broadcast_illust_changes(media_id); });

        SendImage.send_image_channel.addEventListener("message", this.received_message);
        this.broadcast_tab_info();

        this.query_tabs();
    }

    static finalize_quick_view_image = () =>
    {
        let args = ppixiv.helpers.args.location;
        if(args.hash.has("temp-view"))
        {
            console.log("Finalizing quick view image because we gained focus");
            args.hash.delete("virtual");
            args.hash.delete("temp-view");
            ppixiv.helpers.set_page_url(args, false, "navigation");
        }
    }

    static messages = new EventTarget();

    static add_message_listener(message, func)
    {
        if(!this.listeners[message])
            this.listeners[message] = [];
        this.listeners[message].push(func);

    }

    // If we're sending an image and the page is unloaded, try to cancel it.  This is
    // only registered when we're sending an image.
    static window_onunload = (e) =>
    {
        // If we were sending an image to another tab, cancel it if this tab is closed.
        SendImage.send_message({
            message: "send-image",
            action: "cancel",
            to: settings.get("linked_tabs", []),
        });

        // Tell other tabs that this tab has closed.
        SendImage.send_message({ message: "tab-closed" });
    }

    static query_tabs()
    {
        SendImage.send_message({ message: "list-tabs" });
    }

    // Send an image to another tab.  action is either "temp-view", to show the image temporarily,
    // or "display", to navigate to it.
    static async send_image(media_id, tab_ids, action)
    {
        // Send everything we know about the image, so the receiver doesn't have to
        // do a lookup.
        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        let illust_data = image_data.singleton().get_media_info_sync(media_id);

        let user_id = illust_data?.userId;
        let user_info = user_id? image_data.singleton().get_user_info_sync(user_id):null;

        this.send_message({
            message: "send-image",
            from: SendImage.tab_id,
            to: tab_ids,
            media_id: media_id,
            action: action, // "temp-view" or "display"
            thumbnail_info: thumbnail_info,
            illust_data: illust_data,
            user_info: user_info,
            origin: window.origin,
        }, false);
    }

    static broadcast_illust_changes(media_id)
    {
        // Don't do this if this is coming from another tab, so we don't re-broadcast data
        // we just received.
        if(this.handling_broadcasted_image_info)
            return;
        
        // Broadcast the new info to other tabs.
        this.broadcast_image_info(media_id);
    }

    // Send image info to other tabs.  We do this when we know about modifications to
    // an image that other tabs might be displaying, such as the like count and crop
    // info.  This isn't done when we simply load image data from the server, so we're
    // not constantly sending all search results to all tabs.  We don't currently update
    // thumbnail data from image data, so if a tab edits image data while it doesn't have
    // thumbnail data loaded, other tabs with only thumbnail data loaded won't see it.
    static broadcast_image_info(media_id)
    {
        // Send everything we know about the image, so the receiver doesn't have to
        // do a lookup.
        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        let illust_data = image_data.singleton().get_media_info_sync(media_id);

        let user_id = illust_data?.userId;
        let user_info = user_id? image_data.singleton().get_user_info_sync(user_id):null;

        this.send_message({
            message: "image-info",
            from: SendImage.tab_id,
            media_id: media_id,
            illust_data: illust_data ?? thumbnail_info,
            bookmark_tags: image_data.singleton().get_bookmark_details_sync(media_id),
            user_info: user_info,
            origin: window.origin,
        }, false);
    }

    static received_message = async(e) =>
    {
        let data = e.data;

        // If this message has a target and it's not us, ignore it.
        if(data.to && data.to.indexOf(SendImage.tab_id) == -1)
            return;

        let event = new Event(data.message);
        event.message = data;
        this.messages.dispatchEvent(event);

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
            // If this message has illust info or thumbnail info and it's on the same origin,
            // register it.
            if(data.origin == window.origin)
            {
                console.log("Registering cached image info");
                let thumbnail_info = data.thumbnail_info;
                if(thumbnail_info != null)
                    await thumbnail_data.singleton().loaded_thumbnail_info([thumbnail_info], "internal");

                let user_info = data.user_info;
                if(user_info != null)
                    image_data.singleton().add_user_data(user_info);

                let illust_data = data.illust_data;
                if(illust_data != null)
                    image_data.singleton().add_illust_data(illust_data);
            }
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
            main_controller.singleton.show_media(data.media_id, {
                temp_view: data.action == "temp-view",
                source: "temp-view",

                // When we first show a preview, add it to history.  If we show another image
                // or finalize the previewed image while we're showing a preview, replace the
                // preview history entry.
                add_to_history: !ppixiv.history.virtual,
            });
        }
        else if(data.message == "image-info")
        {
            if(data.origin != window.origin)
                return;

            // update_media_info will trigger illust_modified_callbacks below.  Make sure we don't rebroadcast
            // info that we're receiving here.  Note that add_illust_data can trigger loads, and we won't
            // send any info for changes that happen before those complete since we have to wait
            // for it to finish, but normally this receives all info for an illust anyway.
            this.handling_broadcasted_image_info = true;
            try {
                // Another tab is broadcasting updated image info.  If we have this image loaded,
                // update it.
                let illust_data = data.illust_data;
                if(illust_data != null)
                    image_data.singleton().update_media_info(data.media_id, illust_data);

                let bookmark_tags = data.bookmark_tags;
                if(bookmark_tags != null)
                    image_data.singleton().update_cached_bookmark_image_tags(data.media_id, bookmark_tags);

                let user_info = data.user_info;
                if(user_info != null)
                    image_data.singleton().add_user_data(user_info);
            } finally {
                this.handling_broadcasted_image_info = false;
            }
        }
        else if(data.message == "preview-mouse-movement")
        {
            // Ignore this message if we're not displaying a quick view image.
            if(!ppixiv.history.virtual)
                return;
            
            // The mouse moved in the tab that's sending quick view.  Broadcast an event
            // like pointermove.  We have to work around a stupid pair of bugs: Safari
            // doesn't handle setting movementX/movementY in the constructor, and Firefox
            // *only* handles it that way, throwing an error if you try to set it manually.
            let event = new PointerEvent("quickviewpointermove", {
                movementX: data.x,
                movementY: data.y,
            });

            if(event.movementX == null)
            {
                event.movementX = data.x;
                event.movementY = data.y;
            }

            window.dispatchEvent(event);
        }
    }

    static broadcast_tab_info = () =>
    {
        let screen = main_controller.singleton.displayed_screen;
        let media_id = screen? screen.displayed_media_id:null;
        let thumbnail_info = media_id? thumbnail_data.singleton().get_one_thumbnail_info(media_id):null;
        let illust_data = media_id? image_data.singleton().get_media_info_sync(media_id):null;

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
            media_id: media_id,

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
        if(!settings.get("linked_tabs_enabled"))
            return;

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

ppixiv.link_tabs_popup = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({...options,
            classes: "link-tab-popup",
            template: `
            <div class="link-tab-popup">
                <div class=explanation>
                    <ppixiv-inline src="resources/multi-monitor.svg" class=tutorial-monitor></ppixiv-inline>
                    <div style="margin: 10px 0 15px 0; font-size: 125%;">
                        Open a 
                        <img src="ppixiv:resources/activate-icon.png" style="width: 28px; vertical-align: bottom;">
                        tab on another monitor and click "Link this tab" to send images to it
                    </div>
                </div>
            </div>
        `});
    }

    // Send show-link-tab to tell other tabs to display the "link this tab" popup.
    // This includes the linked tab list, so they know whether to say "link" or "unlink".
    send_link_tab_message = () =>
    {
        if(!this.visible)
            return;

        SendImage.send_message({
            message: "show-link-tab",
            linked_tabs: settings.get("linked_tabs", []),
        });
    }

    visibility_changed()
    {
        super.visibility_changed();

        if(!this.visible)
        {
            SendImage.send_message({ message: "hide-link-tab" });
            return;
        }

        helpers.interval(this.send_link_tab_message, 1000, this.visibility_abort.signal);

        // Refresh the "unlink all tabs" button on other tabs when the linked tab list changes.
        settings.changes.addEventListener("linked_tabs", this.send_link_tab_message, { signal: this.visibility_abort.signal });

        // The other tab will send these messages when the link and unlink buttons
        // are clicked.
        SendImage.messages.addEventListener("link-this-tab", (e) => {
            let message = e.message;

            let tab_ids = settings.get("linked_tabs", []);
            if(tab_ids.indexOf(message.from) == -1)
                tab_ids.push(message.from);

            settings.set("linked_tabs", tab_ids);

            this.send_link_tab_message();
        }, { signal: this.visibility_abort.signal });

        SendImage.messages.addEventListener("unlink-this-tab", (e) => {
            let message = e.message;
            let tab_ids = settings.get("linked_tabs", []);
            let idx = tab_ids.indexOf(message.from);
            if(idx != -1)
                tab_ids.splice(idx, 1);

            settings.set("linked_tabs", tab_ids);

            this.send_link_tab_message();
        }, { signal: this.visibility_abort.signal });
    }
}

ppixiv.link_this_tab_popup = class extends ppixiv.dialog_widget
{
    constructor({...options}={})
    {
        super({...options,
            classes: "link-this-tab-popup",
            dialog_template: true,
            remove_on_exit: false,
            dialog_type: "small",

            // This dialog is closed when the sending tab closes the link tab interface.
            allow_close: false,

            visible: false,
            template: `
                ${ helpers.create_box_link({ label: "Link this tab", classes: ["link-this-tab"]}) }
                ${ helpers.create_box_link({ label: "Unlink this tab", classes: ["unlink-this-tab"]}) }
        `});

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
    }

    visibility_changed()
    {
        super.visibility_changed();

        this.hide_timer.clear();

        // Hide if we don't see a show-link-tab message for a few seconds, as a
        // safety in case the other tab dies.
        if(this.visible)
            this.hide_timer.set(2000);
    }
}

ppixiv.send_image_popup = class extends ppixiv.dialog_widget
{
    constructor({...options}={})
    {
        super({...options,
            dialog_template: true,
            classes: "send-image-popup",
            remove_on_exit: false,
            show_close_button: false,
            dialog_type: "small",

            template: `
                <div>
                    Click a
                    <img src="ppixiv:resources/activate-icon.png" style="width: 28px; vertical-align: bottom;">
                    tab to send the image there
                </div>
        `});

        // Close if the container is clicked, but not if something inside the container is clicked.
        this.container.addEventListener("click", (e) => {
            if(e.target != this.container)
                return;

            this.visible = false;
        });

        SendImage.add_message_listener("take-image", (message) => {
            let tab_id = message.from;
            SendImage.send_image(this.media_id, [tab_id], "display");

            this.visible = false;
        });

        this.visible = false;
    }

    show_for_illust(media_id)
    {
        this.media_id = media_id;
        this.visible = true;
    }

    visibility_changed()
    {
        super.visibility_changed();

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
    constructor({...options}={})
    {
        super({...options,
            classes: "send-image-here-popup",
            dialog_template: true,
            remove_on_exit: false,
            visible: false,
            dialog_type: "small",

            // This dialog is closed when the sending tab closes the send image interface.
            allow_close: false,
            template: `
                ${ helpers.create_box_link({ label: "Click to send image here", classes: ["link-this-tab"]}) }
        `});

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
    }

    take_image = (e) =>
    {
        // Send take-image.  The sending tab will respond with a send-image message.
        SendImage.send_message({ message: "take-image", to: [this.other_tab_id] });
    }

    visibility_changed()
    {
        super.visibility_changed();

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
