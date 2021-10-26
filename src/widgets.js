"use strict";

// A basic widget base class.
ppixiv.widget = class
{
    constructor({container, parent=null}={})
    {
        console.assert(container != null);

        this.parent = parent;
        this.container = container;

        // Let the caller finish, then refresh.
        helpers.yield(() => {
            this.refresh();
        });
    }

    async refresh()
    {
    }
}

// A widget that shows info for a particular illust_id.
//
// An illust_id can be set, and we'll refresh when it changes.
ppixiv.illust_widget = class extends ppixiv.widget
{
    constructor(options)
    {
        super(options);

        // Refresh when the image data changes.
        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    // The data this widget needs.  This can be illust_id (nothing but the ID), illust_info,
    // or thumbnail info.
    //
    // This can change dynamically.  Some widgets need illust_info only when viewing a manga
    // page.
    get needed_data()
    {
        return "illust_info";
    }

    set_illust_id(illust_id, page=null)
    {
        console.assert(page != -1);
        if(this._illust_id == illust_id && this._page == page)
            return;

        this._illust_id = illust_id;
        this._page = page;
        this.refresh();
    }

    set illust_id(illust_id)
    {
        this.set_illust_id(illust_id);
    }

    get illust_id() { return this._illust_id; }

    get visible()
    {
        return !this.container.hidden;
    }
     
    async refresh()
    {
        // Grab the illust info.
        var illust_id = this._illust_id;
        var illust_data = null;
        let info = { illust_id: this._illust_id };
        if(this._illust_id != null)
        {
            if(this.needed_data == "illust_id")
                illust_data = illust_id;
            else if(this.needed_data == "thumbnail")
                info.thumbnail_data = await thumbnail_data.singleton().get_or_load_illust_data(this._illust_id);
            else
                info.illust_data = await image_data.singleton().get_image_info(this._illust_id);
        }

        // Stop if the ID changed while we were async.
        if(this._illust_id != illust_id)
            return;

        await this.refresh_internal(info);
    }

    async refresh_internal({ illust_id, illust_data, thumbnail_data })
    {
        throw "Not implemented";
    }
}

// Display messages in the popup widget.  This is a singleton.
ppixiv.message_widget = class
{
    static get singleton()
    {
        if(message_widget._singleton == null)
            message_widget._singleton = new message_widget();
        return message_widget._singleton;
    }

    constructor()
    {
        this.container = document.body.querySelector(".hover-message");
        this.timer = null;
    }

    show(message)
    {
        this.clear_timer();

        this.container.querySelector(".message").innerHTML = message;

        this.container.classList.add("show");
        this.container.classList.remove("centered");
        this.timer = setTimeout(() => {
            this.container.classList.remove("show");
        }, 3000);
    }

    clear_timer()
    {
        if(this.timer != null)
        {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    hide()
    {
        this.clear_timer();
        this.container.classList.remove("show");
    }
}

// Call a callback on any click not inside a list of nodes.
//
// This is used to close dropdown menus.
ppixiv.click_outside_listener = class
{
    constructor(node_list, callback)
    {
        this.window_onmousedown = this.window_onmousedown.bind(this);

        this.node_list = node_list;
        this.callback = callback;

        window.addEventListener("mousedown", this.window_onmousedown, true);
    }

    // Return true if node is below any node in node_list.
    is_node_in_list(node)
    {
        for(let ancestor of this.node_list)
        {
            if(helpers.is_above(ancestor, node))
                return true;
        }
        return false;
    }

    window_onmousedown(e)
    {
        // Close the popup if anything outside the dropdown is clicked.  Don't
        // prevent the click event, so the click still happens.
        //
        // If this is a click inside the box or our button, ignore it.
        if(this.is_node_in_list(e.target))
            return;

        this.callback();
    }

    shutdown()
    {
        window.removeEventListener("mousedown", this.window_onmousedown, true);
    }
}

// Show popup menus when a button is clicked.
ppixiv.dropdown_menu_opener = class
{
    static create_handlers(container, selectors)
    {
        for(let selector of selectors)
        {
            let item = container.querySelector(selector);
            if(item == null)
            {
                console.warn("Couldn't find", selector);
                continue;
            }
            dropdown_menu_opener.create_handler(item);
        }
    }

    // A shortcut for creating an opener for our common button/popup layout.
    static create_handler(container)
    {
        let button = container.querySelector(".menu-button");
        let box = container.querySelector(".popup-menu-box");
        if(button == null)
        {
            console.error("Couldn't find menu button for " + container);
            return;
        }
        if(box == null)
        {
            console.error("Couldn't find menu box for " + container);
            return;
        }
        new dropdown_menu_opener(button, box);
    }

    constructor(button, box)
    {
        this.box_onclick = this.box_onclick.bind(this);

        this.button = button;
        this.box = box;

        this.visible = false;

        this.button.addEventListener("click", (e) => { this.button_onclick(e); });

        // Hide popups when any containing view is hidden.
        new view_hidden_listener(this.button, (e) => {
            this.visible = false;
        });
    }

    // The viewhidden event is sent when the enclosing view is no longer visible, and
    // all menus in it should be hidden.
    onviewhidden(e)
    {
        this.visible = false;
    }

    get visible()
    {
        return !this.box.hidden;
    }

    set visible(value)
    {
        if(this.box.hidden == !value)
            return;

        this.box.hidden = !value;
        helpers.set_class(this.box, "popup-visible", value);

        if(value)
        {
            this.listener = new click_outside_listener([this.button, this.box], () => {
                this.visible = false;
            });

            if(this.close_on_click_inside)
                this.box.addEventListener("click", this.box_onclick, true);
        }
        else
        {
            if(this.listener)
            {
                this.listener.shutdown();
                this.listener = null;
            }

            this.box.removeEventListener("click", this.box_onclick, true);
        }

        // If we're inside a .top-ui-box container (the UI that sits at the top of the screen), set
        // .force-open on that element while we're open.
        let top_ui_box = this.box.closest(".top-ui-box");
        if(top_ui_box)
            helpers.set_class(top_ui_box, "force-open", value);

        // Let the widget know its visibility has changed.
        this.box.dispatchEvent(new Event(value? "popupshown":"popuphidden"));
    }

    // Return true if this popup should close when clicking inside it.  If false,
    // the menu will stay open until something else closes it.
    get close_on_click_inside()
    {
        return true;
    }

    box_onclick(e)
    {
        if(e.target.closest(".keep-menu-open"))
            return;

        this.visible = false;
    }

    // Toggle the popup when the button is clicked.
    button_onclick(e)
    {
        e.preventDefault();
        e.stopPropagation();
        this.visible = !this.visible;
    }
};

// A pointless creepy eye.  Looks away from the mouse cursor when hovering over
// the unfollow button.
ppixiv.creepy_eye_widget = class
{
    constructor(eye)
    {
        this.onevent = this.onevent.bind(this);

        this.eye = eye;

        this.eye.addEventListener("mouseenter", this.onevent);
        this.eye.addEventListener("mouseleave", this.onevent);
        this.eye.addEventListener("mousemove", this.onevent);
        this.eye_middle = this.eye.querySelector(".middle");
    }

    onevent(e)
    {
        if(e.type == "mouseenter")
            this.hover = true;
        if(e.type == "mouseleave")
            this.hover = false;

        if(!this.hover)
        {
            this.eye_middle.style.transform = "";
            return;
        }
        var mouse = [e.pageX, e.pageY];

        var bounds = this.eye.getBoundingClientRect();
        var eye = [bounds.x + bounds.width/2, bounds.y + bounds.height/2];

        var vector_length = function(vec)
        {
            return Math.sqrt(vec[0]*vec[0] + vec[1]*vec[1]);
        }
        // Normalize to get a direction vector.
        var normalize_vector = function(vec)
        {
            var length = vector_length(vec);
            if(length < 0.0001)
                return [0,0];
            return [vec[0]/length, vec[1]/length];
        };

        var pos = [mouse[0] - eye[0], mouse[1] - eye[1]];
        pos = normalize_vector(pos);

        if(Math.abs(pos[0]) < 0.5)
        {
            var negative = pos[0] < 0;
            pos[0] = 0.5;
            if(negative)
                pos[0] *= -1;
        }
//        pos[0] = 1 - ((1-pos[0]) * (1-pos[0]));
        pos[0] *= -3;
        pos[1] *= -6;
        this.eye_middle.style.transform = "translate(" + pos[0] + "px, " + pos[1] + "px)";
    }
}

ppixiv.avatar_widget = class extends widget
{
    // options:
    // parent: node to add ourself to (required)
    // changed_callback: called when a follow or unfollow completes
    // big: if true, show the big avatar instead of the small one
    constructor(options)
    {
        super({...options});

        this.options = options;
        if(this.options.mode != "dropdown" && this.options.mode != "overlay")
            throw "Invalid avatar widget mode";

        this.clicked_follow = this.clicked_follow.bind(this);
        this.user_changed = this.user_changed.bind(this);
        this._visible = false;

        this.root = helpers.create_from_template(".template-avatar");
        helpers.set_class(this.root, "big", this.options.big);

        image_data.singleton().user_modified_callbacks.register(this.user_changed);

        let element_author_avatar = this.root.querySelector(".avatar");

        this.img = document.createElement("img");

        // A canvas filter for the avatar.  This has no actual filters.  This is just to kill off any
        // annoying GIF animations in people's avatars.
        this.base_filter = new image_canvas_filter(this.img, element_author_avatar.querySelector("canvas.main"));

        // The actual highlight filter:
        this.highlight_filter = new image_canvas_filter(this.img, element_author_avatar.querySelector("canvas.highlight"), "brightness(150%)", (ctx, img) => {
            ctx.globalCompositeOperation = "destination-in";

            let feather = 25;
            let radius = 15;
            ctx.filter = "blur(" + feather + "px)";
            helpers.draw_round_rect(ctx, feather, feather + this.img.naturalHeight/2, this.img.naturalWidth - feather*2, this.img.naturalHeight - feather*2, radius);
            ctx.fill();
        });
        
        this.root.dataset.mode = this.options.mode;

        // Show the favorite UI when hovering over the avatar icon.
        let avatar_popup = this.root; //container.querySelector(".avatar-popup");
        if(this.options.mode == "dropdown")
        {
            avatar_popup.addEventListener("mouseover", function(e) { helpers.set_class(avatar_popup, "popup-visible", true); }.bind(this));
            avatar_popup.addEventListener("mouseout", function(e) { helpers.set_class(avatar_popup, "popup-visible", false); }.bind(this));
        }

        new creepy_eye_widget(this.root.querySelector(".unfollow-button .eye-image"));

        for(let button of avatar_popup.querySelectorAll(".follow-button.public"))
            button.addEventListener("click", this.clicked_follow.bind(this, false), false);
        for(let button of avatar_popup.querySelectorAll(".follow-button.private"))
            button.addEventListener("click", this.clicked_follow.bind(this, true), false);
        for(let button of avatar_popup.querySelectorAll(".unfollow-button"))
            button.addEventListener("click", this.clicked_follow.bind(this, true), false);
        this.element_follow_folder = avatar_popup.querySelector(".folder");

        // Follow publically when enter is pressed on the follow folder input.
        helpers.input_handler(avatar_popup.querySelector(".folder"), this.clicked_follow.bind(this, false));

        this.container.appendChild(this.root);
    }

    shutdown()
    {
        image_data.singleton().user_modified_callbacks.unregister(this.user_changed);
    }

    set visible(value)
    {
        if(this._visible == value)
            return;
        this._visible = value;
        this.refresh();
    }

    get visible() { return this._visible; }
    
    // Refresh when the user changes.
    user_changed(user_id)
    {
        if(this.user_id == null || this.user_id != user_id)
            return;

        this.set_user_id(this.user_id);
    }

    async set_user_id(user_id)
    {
        this.user_id = user_id;
        this.refresh();
    }

    async refresh()
    {
        // Only update when we're visible, so we don't load user info until it's needed.
        if(!this._visible)
            return;

        if(this.user_id == null)
        {
            this.user_data = null;
            this.root.classList.add("loading");

            // Set the avatar image to a blank image, so it doesn't flash the previous image
            // the next time we display it.  It should never do this, since we set a new image
            // before displaying it, but Chrome doesn't do this correctly at least with Canvas.
            this.img.src = helpers.blank_image;
            return;
        }

        // If we've seen this user's profile image URL from thumbnail data, start loading it
        // now.  Otherwise, we'll have to wait until user info finishes loading.
        let cached_profile_url = thumbnail_data.singleton().user_profile_urls[this.user_id];
        if(cached_profile_url)
            this.img.src = cached_profile_url;

        // Set up stuff that we don't need user info for.
        this.root.querySelector(".avatar-link").href = `/users/${this.user_id}/artworks#ppixiv`;

        // Hide the popup in dropdown mode, since it covers the dropdown.
        if(this.options.mode == "dropdown")
            this.root.querySelector(".avatar").classList.remove("popup");

        // Clear stuff we need user info for, so we don't show old data while loading.
        helpers.set_class(this.root, "followed", false);
        this.root.querySelector(".avatar").dataset.popup = "";
        this.root.querySelector(".follow-buttons").hidden = true;
        this.root.querySelector(".follow-popup").hidden = true;

        this.root.classList.remove("loading");

        let user_data = await image_data.singleton().get_user_info(this.user_id);
        this.user_data = user_data;
        if(user_data == null)
        {
            console.log("Couldn't load user:", this.user_id);
            return;
        }

        helpers.set_class(this.root, "self", this.user_id == global_data.user_id);

        // We can't tell if we're followed privately or not, only that we're following.
        helpers.set_class(this.root, "followed", this.user_data.isFollowed);

        this.root.querySelector(".avatar").dataset.popup = "View " + this.user_data.name + "'s posts";

        // If we don't have an image because we're loaded from a source that doesn't give us them,
        // just hide the avatar image.
        let key = "imageBig";
        if(this.user_data[key])
            this.img.src = this.user_data[key];
        else
            this.img.src = helpers.blank_image;

        this.root.querySelector(".follow-buttons").hidden = false;
        this.root.querySelector(".follow-popup").hidden = false;
    }
    
    async follow(follow_privately)
    {
        if(this.user_id == null)
            return;

        var tags = this.element_follow_folder.value;
        await actions.follow(this.user_id, follow_privately, tags);
    }

    async unfollow()
    {
        if(this.user_id == null)
            return;

        await actions.unfollow(this.user_id);
    }

    // Note that in some cases we'll only have the user's ID and name, so we won't be able
    // to tell if we're following.
    clicked_follow(follow_privately, e)
    {
        e.preventDefault();
        e.stopPropagation();

        if(this.user_data == null)
            return;

        if(this.user_data.isFollowed)
        {
            // Unfollow the user.
            this.unfollow();
            return;
        }

        // Follow the user.
        this.follow(follow_privately);
    }
};

// A list of tags, with translations in popups where available.
ppixiv.tag_widget = class
{
    // options:
    // parent: node to add ourself to (required)
    // format_link: a function to format a tag to a URL
    constructor(options)
    {
        this.options = options;
        this.container = this.options.parent;
        this.tag_list_container = this.options.parent.appendChild(document.createElement("div"));
        this.tag_list_container.classList.add("tag-list-widget");

        // Refresh when we're opened, in case translations have been turned on or off.
        this.container.addEventListener("popupshown", (e) => {
            this.refresh();
        });
    };

    format_tag_link(tag)
    {
        if(this.options.format_link)
            return this.options.format_link(tag);

        let search_url = new URL("/tags/" + encodeURIComponent(tag) + "/artworks", ppixiv.location.href);
        search_url.hash = "#ppixiv";
        return search_url.toString();
    };

    async set(tags)
    {
        this.tags = tags;
        this.refresh();
    }

    async refresh()
    {
        if(this.tags == null)
            return;

        // Look up tag translations.
        let tag_list = this.tags;
        let translated_tags = await tag_translations.get().get_translations(tag_list, "en");
        
        // Remove any old tag list and create a new one.
        helpers.remove_elements(this.tag_list_container);

        for(let tag of tag_list)
        {
            let a = this.tag_list_container.appendChild(document.createElement("a"));
            a.classList.add("tag");
            a.classList.add("box-link");

            let popup = null;
            let translated_tag = tag;
            if(translated_tags[tag])
                translated_tag = translated_tags[tag];

            a.dataset.tag = tag;
            a.textContent = translated_tag;

            a.href = this.format_tag_link(tag);
        }
    }
};

// A popup for inputting text.
//
// This is currently special purpose for the add tag prompt.
ppixiv.text_prompt = class
{
    constructor()
    {
        this.submit = this.submit.bind(this);
        this.close = this.close.bind(this);
        this.onkeydown = this.onkeydown.bind(this);

        this.result = new Promise((completed, cancelled) => {
            this._completed = completed;
            this._cancelled = cancelled;
        });

        this.root = helpers.create_from_template(".template-add-tag-prompt");
        document.body.appendChild(this.root);
        this.input = this.root.querySelector("input.add-tag-input");
        this.input.value = "";
        this.input.focus();

        this.root.querySelector(".close-button").addEventListener("click", this.close);
        this.root.querySelector(".submit-button").addEventListener("click", this.submit);

        this.root.addEventListener("click", (e) => {
            // Clicks that aren't inside the box close the dialog.
            if(e.target.closest(".box") != null)
                return;

            e.preventDefault();
            e.stopPropagation();
            this.close();
        });

        window.addEventListener("keydown", this.onkeydown);

        // This disables global key handling and hotkeys.
        document.body.dataset.popupOpen = "1";
    }

    onkeydown(e)
    {
        if(e.key == "Escape")
        {
            e.preventDefault();
            e.stopPropagation();

            this.close();
        }

        if(e.key == "Enter")
        {
            e.preventDefault();
            e.stopPropagation();
            this.submit();
        }
    }

    // Close the popup and call the completion callback with the result.
    submit(e)
    {
        let result = this.input.value;
        console.log("submit", result);
        this._remove();

        this._completed(result);
    }

    close()
    {
        this._remove();

        // Cancel the promise.  If we're actually submitting a result, 
        this._cancelled("Cancelled by user");
    }

    _remove()
    {
        window.removeEventListener("keydown", this.onkeydown);

        delete document.body.dataset.popupOpen;
        this.root.remove();
    }

}

// Widget for editing bookmark tags.
ppixiv.bookmark_tag_list_widget = class extends ppixiv.illust_widget
{
    get needed_data() { return "illust_id"; }

    constructor(options)
    {
        super(options);

        this.container.hidden = true;
        this.displaying_illust_id = null;

        this.container.appendChild(helpers.create_from_template(".template-popup-bookmark-tag-dropdown"));

        this.container.addEventListener("click", this.clicked_bookmark_tag.bind(this), true);

        this.container.querySelector(".add-tag").addEventListener("click", async (e) => {
            await actions.add_new_tag(this._illust_id);
        });

        this.container.querySelector(".sync-tags").addEventListener("click", async (e) => {
            var bookmark_tags = await actions.load_recent_bookmark_tags();
            helpers.set_recent_bookmark_tags(bookmark_tags);
        });

        // Close if our containing widget is closed.
        new view_hidden_listener(this.container, (e) => {
            this.visible = false;
        });

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
        settings.register_change_callback("recent-bookmark-tags", this.refresh.bind(this));
    }

    // Return an array of tags selected in the tag dropdown.
    get selected_tags()
    {
        var tag_list = [];
        var bookmark_tags = this.container;
        for(var entry of bookmark_tags.querySelectorAll(".popup-bookmark-tag-entry"))
        {
            if(!entry.classList.contains("active"))
                continue;
            tag_list.push(entry.dataset.tag);
        }
        return tag_list;
    }

    // Override setting illust_id to save tags when we're closed.  Otherwise, illust_id will already
    // be cleared when we close and we won't be able to save.
    set_illust_id(illust_id, page=null)
    {
        // If we're hiding and were previously visible, save changes.
        if(illust_id == null)
            this.save_current_tags();

        super.set_illust_id(illust_id, page);
    }
    
    get visible()
    {
        return !this.container.hidden;
    }
    
    set visible(value) { this._set_tag_dropdown_visible(value); }

    // Hide the dropdown without committing anything.  This happens if a bookmark
    // button is pressed to remove a bookmark: if we just close the dropdown normally,
    // we'd readd the bookmark.
    hide_without_sync()
    {
        this._set_tag_dropdown_visible(false, true);
    }

    async _set_tag_dropdown_visible(value, skip_save)
    {
        if(this.container.hidden == !value)
            return;

        this.container.hidden = !value;

        if(value)
        {
            // We only load existing bookmark tags when the tag list is open, so refresh.
            await this.refresh();
        }
        else
        {
            if(!skip_save)
            {
                // Save any selected tags when the dropdown is closed.
                this.save_current_tags();
            }

            // Clear the tag list when the menu closes, so it's clean on the next refresh.
            var bookmark_tags = this.container.querySelector(".tag-list");
            helpers.remove_elements(bookmark_tags);
            this.displaying_illust_id = null;
        }
    }

    async refresh_internal({ illust_id })
    {
        // If we're refreshing the same illust that's already refreshed, store which tags were selected
        // before we clear the list.
        let old_selected_tags = this.displaying_illust_id == illust_id? this.selected_tags:[];

        this.displaying_illust_id = null;

        let bookmark_tags = this.container.querySelector(".tag-list");
        helpers.remove_elements(bookmark_tags);

        // Make sure the dropdown is hidden if we have no image.
        if(illust_id == null)
            this.visible = false;

        if(illust_id == null || !this.visible)
            return;

        // Figure out how much space we have, and set that as the max-height.  This will
        // fit the tag scroll box within however much space we have available.
        let dropdown = this.container.querySelector(".tag-list");
        let pos = helpers.get_relative_pos(dropdown, document)[1];
        let tag_box_height = window.innerHeight - pos;
        tag_box_height -= 10; // a bit of padding so it's not flush against the edge
        tag_box_height = Math.min(400, tag_box_height);
        dropdown.style.maxHeight = `${tag_box_height}px`;

        // Create a temporary entry to show loading while we load bookmark details.
        let entry = document.createElement("span");
        bookmark_tags.appendChild(entry);
        entry.innerText = "Loading...";

        // If the tag list is open, populate bookmark details to get bookmark tags.
        // If the image isn't bookmarked this won't do anything.
        let active_tags = await image_data.singleton().load_bookmark_details(illust_id);

        // Remember which illustration's bookmark tags are actually loaded.
        this.displaying_illust_id = illust_id;

        // Remove elements again, in case another refresh happened while we were async
        // and to remove the loading entry.
        helpers.remove_elements(bookmark_tags);
        
        // If we're refreshing the list while it's open, make sure that any tags the user
        // selected are still in the list, even if they were removed by the refresh.  Put
        // them in active_tags, so they'll be marked as active.
        for(let tag of old_selected_tags)
        {
            if(active_tags.indexOf(tag) == -1)
                active_tags.push(tag);
        }

        let shown_tags = [];

        let recent_bookmark_tags = Array.from(helpers.get_recent_bookmark_tags()); // copy
        for(let tag of recent_bookmark_tags)
            if(shown_tags.indexOf(tag) == -1)
                shown_tags.push(tag);

        shown_tags.sort((lhs, rhs) => {
            lhs = lhs.toLowerCase();
            rhs = rhs.toLowerCase();
            return lhs.localeCompare(rhs);
        });

        for(let i = 0; i < shown_tags.length; ++i)
        {
            let tag = shown_tags[i];
            let entry = helpers.create_from_template(".template-popup-bookmark-tag-entry");
            entry.dataset.tag = tag;
            bookmark_tags.appendChild(entry);
            entry.querySelector(".tag-name").innerText = tag;

            let active = active_tags.indexOf(tag) != -1;
            helpers.set_class(entry, "active", active);
        }
    }

    // Save the selected bookmark tags to the current illust.
    async save_current_tags()
    {
        // Store the ID and tag list we're saving, since they can change when we await.
        let illust_id = this._illust_id;
        let new_tags = this.selected_tags;
        if(illust_id == null)
            return;

        // Only save tags if we're refreshed to the current illust ID, to make sure we don't save
        // incorrectly if we're currently waiting for the async refresh.
        if(illust_id != this.displaying_illust_id)
            return;

        // Get the tags currently on the bookmark to compare.
        let old_tags = await image_data.singleton().load_bookmark_details(illust_id);

        var equal = new_tags.length == old_tags.length;
        for(let tag of new_tags)
        {
            if(old_tags.indexOf(tag) == -1)
                equal = false;
        }
        // If the selected tags haven't changed, we're done.
        if(equal)
            return;
        
        // Save the tags.  If the image wasn't bookmarked, this will create a public bookmark.
        console.log("Tag list closing and tags have changed");
        console.log("Old tags:", old_tags);
        console.log("New tags:", new_tags);

        await actions.bookmark_add(this._illust_id, {
            tags: new_tags,
        });
    }

    // Toggle tags on click.  We don't save changes until we're closed.
    async clicked_bookmark_tag(e)
    {
        let a = e.target.closest(".popup-bookmark-tag-entry");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // Toggle this tag.  Don't actually save it immediately, so if we make multiple
        // changes we don't spam requests.
        let tag = a.dataset.tag;
        helpers.set_class(a, "active", !a.classList.contains("active"));
    }
}

// The button that shows and hides the tag list.
ppixiv.toggle_bookmark_tag_list_widget = class extends ppixiv.illust_widget
{
    // We only need an illust ID and no info.
    get needed_data() { return "illust_id"; }

    constructor({bookmark_tag_widget, ...options})
    {
        super(options);

        this.bookmark_tag_widget = bookmark_tag_widget;

        this.container.addEventListener("click", (e) => {
            e.preventDefault();

            // Ignore clicks if this button isn't enabled.
            if(!this.container.classList.contains("enabled"))
                return;
            
            this.bookmark_tag_widget.visible = !this.bookmark_tag_widget.visible;
        });
    }

    refresh_internal({ illust_id })
    {
        helpers.set_class(this.container, "enabled", illust_id != null);
    }
}

ppixiv.bookmark_button_widget = class extends ppixiv.illust_widget
{
    get needed_data() { return "thumbnail"; }

    constructor({private_bookmark, bookmark_tag_widget, ...options})
    {
        super(options);

        this.private_bookmark = private_bookmark;
        this.bookmark_tag_widget = bookmark_tag_widget;

        this.container.addEventListener("click", this.clicked_bookmark.bind(this));

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    refresh_internal({ thumbnail_data })
    {
        let bookmarked = thumbnail_data?.bookmarkData != null;
        let our_bookmark_type = thumbnail_data?.bookmarkData?.private == this.private_bookmark;

        // Set up the bookmark buttons.
        helpers.set_class(this.container,  "enabled",     thumbnail_data != null);
        helpers.set_class(this.container,  "bookmarked",  our_bookmark_type);
        helpers.set_class(this.container,  "will-delete", our_bookmark_type);
        
        // Set the tooltip.
        let type_string = this.private_bookmark? "private":"public";
        this.container.dataset.popup =
            thumbnail_data == null? "":
            !bookmarked? (this.private_bookmark? "Bookmark privately":"Bookmark image"):
            our_bookmark_type? "Remove bookmark":
            "Change bookmark to " + type_string;
    }
    
    // Clicked one of the top-level bookmark buttons or the tag list.
    async clicked_bookmark(e)
    {
        // See if this is a click on a bookmark button.
        let a = e.target.closest(".button-bookmark");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // If the tag list dropdown is open, make a list of tags selected in the tag list dropdown.
        // If it's closed, leave tag_list null so we don't modify the tag list.
        let tag_list = null;
        if(this.bookmark_tag_widget && this.bookmark_tag_widget.visible)
            tag_list = this.bookmark_tag_widget.selected_tags;

        // If we have a tag list dropdown, close it before saving the bookmark.
        //
        // When the tag list bookmark closes, it'll save the bookmark with its current tags
        // if they're different, creating the bookmark if needed.  If we leave it open when
        // we save, it's possible to click the private bookmark button in the context menu,
        // then release the right mouse button to close the context menu before the bookmark
        // finishes saving.  The tag list won't know that the bookmark is already being saved
        // and will save.  This can cause private bookmarks to become public bookmarks.  Just
        // tell the tag list to close without saving, since we're committing the tag list now.
        if(this.bookmark_tag_widget)
            this.bookmark_tag_widget.hide_without_sync();

        // If the image is bookmarked and the same privacy button was clicked, remove the bookmark.
        let illust_data = await thumbnail_data.singleton().get_or_load_illust_data(this._illust_id);
        
        if(illust_data.bookmarkData && illust_data.bookmarkData.private == this.private_bookmark)
        {
            await actions.bookmark_remove(this._illust_id);

            // If the current image changed while we were async, stop.
            if(this._illust_id != illust_data.illustId)
                return;
            
            // Hide the tag dropdown after unbookmarking, without saving any tags in the
            // dropdown (that would readd the bookmark).
            if(this.bookmark_tag_widget)
                this.bookmark_tag_widget.hide_without_sync();
            
            return;
        }

        // Add or edit the bookmark.
        await actions.bookmark_add(this._illust_id, {
            private: this.private_bookmark,
            tags: tag_list,
        });
    }
}

ppixiv.bookmark_count_widget = class extends ppixiv.illust_widget
{
    constructor(options)
    {
        super(options);

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    refresh_internal({ illust_data })
    {
        let count = this.container.querySelector(".count");
        if(count)
            count.textContent = illust_data? illust_data.bookmarkCount:"---";
    }
}

ppixiv.like_button_widget = class extends ppixiv.illust_widget
{
    get needed_data() { return "illust_id"; }

    constructor(options)
    {
        super(options);

        this.container.addEventListener("click", this.clicked_like);

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    async refresh_internal({ illust_id })
    {
        let liked_recently = this._illust_id != null? image_data.singleton().get_liked_recently(this._illust_id):false;
        helpers.set_class(this.container, "liked", liked_recently);
        helpers.set_class(this.container, "enabled", !liked_recently);

        this.container.dataset.popup = this._illust_id == null? "":
            liked_recently? "Already liked image":"Like image";
    }
    
    clicked_like = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(this._illust_id != null)
            actions.like_image(this._illust_id);
    }
}

ppixiv.like_count_widget = class extends ppixiv.illust_widget
{
    constructor(options)
    {
        super(options);
        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    async refresh_internal({ illust_data })
    {
        this.container.textContent = illust_data? illust_data.likeCount:"---";
    }
}

