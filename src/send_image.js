"use strict";

// This handles sending images from one tab to another.
ppixiv.SendImage = class
{
    // This is a singleton, so we never close this channel.
    static send_image_channel = new BroadcastChannel("ppixiv:send-image");

    // A UUID we use to identify ourself to other tabs:
    static session_uuid = this.create_session_uuid();
    static session_uuid_tiebreaker = Date.now()
    
    static create_session_uuid(recreate=false)
    {
        // If we have a saved tab ID, use it.
        if(!recreate && sessionStorage.ppixivTabId)
            return sessionStorage.ppixivTabId;

        // Make a new ID, and save it to the session.  This helps us keep the same ID
        // when we're reloaded.
        sessionStorage.ppixivTabId = helpers.create_uuid();
        return sessionStorage.ppixivTabId;helpers.create_uuid();
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

    // Send an image to another tab.  action is either "preview", to show the image temporarily,
    // or "display", to navigate to it.
    static async send_image(illust_id, page, tab_id, action)
    {
        // Send everything we know about the image, so the receiver doesn't have to
        // do a lookup.
        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        let illust_data = image_data.singleton().get_image_info_sync(illust_id);
        let info = {
            illust_id: illust_id,
            thumbnail_info: thumbnail_info,
            illust_data: illust_data,
        };

        this.send_message({
            message: "send-image",
            from: SendImage.session_uuid,
            to: tab_id,
            illust_id: illust_id,
            page: page,
            info: info,
            action: action, // "preview" or "display"
        });
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
            if(data.from == SendImage.session_uuid)
            {
                // The other tab has the same ID we do.  The only way this normally happens
                // is if a tab is duplicated, which will duplicate its sessionStorage with it.
                // If this happens, use session_uuid_tiebreaker to decide who wins.  The tab with
                // the higher value will recreate its tab ID.  This is set to the time when
                // we're loaded, so this will usually cause new tabs to be the one to create
                // a new ID.
                if(SendImage.session_uuid_tiebreaker >= data.session_uuid_tiebreaker)
                {
                    console.log("Creating a new tab ID due to ID conflict");
                    session_uuid = SendImage.create_session_uuid(true /* recreate */ );
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
            if(data.to != SendImage.session_uuid)
                return;

            // Register the illust info from this image.  It can have thumbnail info, image
            // info or both, depending on what the sending page had.
            let thumbnail_info = data.info.thumbnail_info;
            if(thumbnail_info != null)
                thumbnail_data.singleton().loaded_thumbnail_info([thumbnail_info], "normal");

            let illust_data = data.info.illust_data;
            if(illust_data != null)
            {
                // If it also has user info, add that too.  Do this before registering illust data,
                // or image_data will request the data.  This is the only place we get user info
                // along with illust info.
                if(illust_data.userInfo)
                    image_data.singleton().add_user_data(illust_data.userInfo);

                image_data.singleton().add_illust_data(illust_data);
            }
            
            let was_in_preview = ppixiv.history.virtual;
            let do_preview = data.action == "preview";

            // Show the image.
            let url = new URL("https://www.pixiv.net/en/artworks/" + data.info.illust_id);
            let hash_args = new unsafeWindow.URLSearchParams();
            if(do_preview)
            {
                hash_args.set("virtual", "1");
                hash_args.set("preview", "1");
            }
            if(data.page != -1)
                hash_args.set("page", data.page+1);

            helpers.set_hash_args(url, hash_args);
            
            // When we first show a preview, add it to history.  If we show another image
            // or finalize the previewed image while we're showing a preview, replace the
            // preview history entry.
            helpers.set_page_url(url, !was_in_preview, "sent-image");
        }
        else if(data.message == "hide-preview-image")
        {
            this.hide_preview_image();
        }
    }

    static broadcast_tab_info()
    {
        let view = main_controller.singleton.displayed_view;
        let illust_id = view? view.displayed_illust_id:null;
        let page = view? view.displayed_illust_page:null;
        let thumbnail_info = illust_id? thumbnail_data.singleton().get_one_thumbnail_info(illust_id):null;
        let illust_data = illust_id? image_data.singleton().get_image_info_sync(illust_id):null;

        let our_tab_info = {
            message: "tab-info",
            session_uuid_tiebreaker: SendImage.session_uuid_tiebreaker,
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
        };

        // Add any extra data we've been given.
        for(let key in this.extra_data)
            our_tab_info[key] = this.extra_data[key];

        this.send_message(our_tab_info);

        // Add us to our own known_tabs.
        this.known_tabs[SendImage.session_uuid] = our_tab_info;
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
        data.from = this.session_uuid;
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

ppixiv.send_image_widget = class extends ppixiv.illust_widget
{
    constructor(container)
    {
        let contents = helpers.create_from_template(".template-popup-send-image");
        container.appendChild(contents);

        super(contents);

        this.dropdown_list = this.container.querySelector(".list");

        // Close the dropdown if the popup menu is closed.
        new view_hidden_listener(this.container, (e) => { this.visible = false; });

        // Refresh when the image data changes.
        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    set_illust_id(illust_id, page=-1)
    {
        if(this._illust_id == illust_id && this._page == page)
            return;

        this._illust_id = illust_id;
        this._page = page;
        this.refresh();
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
        this.previewing_on_tab = null;

        // Stop previewing the tab.
        SendImage.send_message({ message: "hide-preview-image" });
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

            if(tab_id != SendImage.session_uuid)
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
        if(tab_id == SendImage.session_uuid)
            entry.classList.add("self");

        // Set the image.
        let img = entry.querySelector(".shown-image");
        img.hidden = true;
        if(info.illust_id != null && info.illust_screen_pos != null)
        {
            let image_url = null;
            if(info.illust_data)
            {
                image_url = info.illust_data.urls.small;
                if(info.page > 0)
                    image_url = info.illust_data.mangaPages[info.page].urls.small;
            }
            else if(info.thumbnail_info)
            {
                image_url = info.thumbnail_info.url;
            }
            if(image_url)
            {
                img.hidden = false;
                img.src = image_url;
            }

            // Position the image in the same way it is in the tab.  The container is the same
            // dimensions as the window, so we can just copy the final percentages.
            img.style.top = `${info.illust_screen_pos.top*100}%`;
            img.style.left = `${info.illust_screen_pos.left*100}%`;
            img.style.width = `${info.illust_screen_pos.width*100}%`;
            img.style.height = `${info.illust_screen_pos.height*100}%`;
        }

        // We don't need mouse event listeners for ourself.
        if(tab_id == SendImage.session_uuid)
            return entry;

        entry.addEventListener("click", (e) => {
            if(tab_id == SendImage.session_uuid)
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

            SendImage.send_image(this._illust_id, this._page, tab_id, "preview");
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

