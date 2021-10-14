"use strict";

// A basic widget base class.
ppixiv.widget = class
{
    constructor(container)
    {
        this.container = container;

        // Let the caller finish, then refresh.
        setTimeout(() => {
            this.refresh();
        }, 0);
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
    constructor(container)
    {
        super(container);

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
        if(this._illust_id != null)
            illust_data = await image_data.singleton().get_image_info(this._illust_id);

        // Stop if the ID changed while we were async.
        if(this._illust_id != illust_id)
            return;

        await this.refresh_internal(illust_data);
    }

    refresh_internal(illust_data)
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
        this.timer = setTimeout(function() {
            this.container.classList.remove("show");
        }.bind(this), 3000);
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
        for(var ancestor of this.node_list)
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
        for(var selector of selectors)
        {
            var item = container.querySelector(selector);
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
        var button = container.querySelector(".menu-button");
        var box = container.querySelector(".popup-menu-box");
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

ppixiv.avatar_widget = class
{
    // options:
    // parent: node to add ourself to (required)
    // changed_callback: called when a follow or unfollow completes
    // big: if true, show the big avatar instead of the small one
    constructor(options)
    {
        this.options = options;
        if(this.options.mode != "dropdown" && this.options.mode != "overlay")
            throw "Invalid avatar widget mode";

        this.clicked_follow = this.clicked_follow.bind(this);
        this.user_changed = this.user_changed.bind(this);

        this.root = helpers.create_from_template(".template-avatar");
        helpers.set_class(this.root, "big", this.options.big);

        image_data.singleton().user_modified_callbacks.register(this.user_changed);

        var element_author_avatar = this.root.querySelector(".avatar");

        this.img = document.createElement("img");

        // A canvas filter for the avatar.  This has no actual filters.  This is just to kill off any
        // annoying GIF animations in people's avatars.
        this.base_filter = new image_canvas_filter(this.img, element_author_avatar.querySelector("canvas.main"));

        // The actual highlight filter:
        this.highlight_filter = new image_canvas_filter(this.img, element_author_avatar.querySelector("canvas.highlight"), "brightness(150%)", (ctx, img) => {
            ctx.globalCompositeOperation = "destination-in";

            var feather = 25;
            var radius = 15;
            ctx.filter = "blur(" + feather + "px)";
            helpers.draw_round_rect(ctx, feather, feather + this.img.naturalHeight/2, this.img.naturalWidth - feather*2, this.img.naturalHeight - feather*2, radius);
            ctx.fill();
        });
        
        this.root.dataset.mode = this.options.mode;

        // Show the favorite UI when hovering over the avatar icon.
        var avatar_popup = this.root; //container.querySelector(".avatar-popup");
        if(this.options.mode == "dropdown")
        {
            avatar_popup.addEventListener("mouseover", function(e) { helpers.set_class(avatar_popup, "popup-visible", true); }.bind(this));
            avatar_popup.addEventListener("mouseout", function(e) { helpers.set_class(avatar_popup, "popup-visible", false); }.bind(this));
        }

        new creepy_eye_widget(this.root.querySelector(".unfollow-button .eye-image"));

        for(var button of avatar_popup.querySelectorAll(".follow-button.public"))
            button.addEventListener("click", this.clicked_follow.bind(this, false), false);
        for(var button of avatar_popup.querySelectorAll(".follow-button.private"))
            button.addEventListener("click", this.clicked_follow.bind(this, true), false);
        for(var button of avatar_popup.querySelectorAll(".unfollow-button"))
            button.addEventListener("click", this.clicked_follow.bind(this, true), false);
        this.element_follow_folder = avatar_popup.querySelector(".folder");

        // Follow publically when enter is pressed on the follow folder input.
        helpers.input_handler(avatar_popup.querySelector(".folder"), this.clicked_follow.bind(this, false));

        this.options.parent.appendChild(this.root);
    }

    shutdown()
    {
        image_data.singleton().user_modified_callbacks.unregister(this.user_changed);
    }

    // Refresh when the user changes.
    user_changed(user_id)
    {
        if(this.user_data == null || this.user_data.userId != user_id)
            return;

        this.set_from_user_data(this.user_data);
    }

    set_from_user_data(user_data)
    {
        this.user_data = user_data;
        if(this.user_data == null)
        {
            this.root.classList.add("loading");

            // Set the avatar image to a blank image, so it doesn't flash the previous image
            // the next time we display it.  It should never do this, since we set a new image
            // before displaying it, but Chrome doesn't do this correctly at least with Canvas.
            this.img.src = helpers.blank_image;
            return;
        }
        this.root.classList.remove("loading");

        helpers.set_class(this.root, "self", user_data.userId == global_data.user_id);

        // We can't tell if we're followed privately or not, only that we're following.
        helpers.set_class(this.root, "followed", this.user_data.isFollowed);

        this.root.querySelector(".avatar-link").href = "/users/" + user_data.userId + "#ppixiv";
        this.root.querySelector(".avatar").dataset.popup = "View " + user_data.name + "'s posts";

        // Hide the popup in dropdown mode, since it covers the dropdown.
        if(this.options.mode == "dropdown")
            this.root.querySelector(".avatar").classList.remove("popup");

        // If we don't have an image because we're loaded from a source that doesn't give us them,
        // just hide the avatar image.
        var key = "imageBig";
        if(user_data[key])
            this.img.src = user_data[key];
        else
            this.img.src = helpers.blank_image;
    }
    
    async follow(follow_privately)
    {
        if(this.user_data == null)
            return;

        var tags = this.element_follow_folder.value;
        await actions.follow(this.user_data, follow_privately, tags);
    }

    async unfollow()
    {
        if(this.user_data == null)
            return;

        await actions.unfollow(this.user_data);
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

        var search_url = new URL("/tags/" + encodeURIComponent(tag) + "/artworks", window.location.href);
        search_url.hash = "#ppixiv";
        return search_url.toString();
    };

    async set(tags)
    {
        this.tags = tags;

        // Register any tag translations.  Not all sources will have this.
        tag_translations.get().add_translations(this.tags.tags);

        this.refresh();
    }

    async refresh()
    {
        if(this.tags == null)
            return;

        // Look up tag translations.
        let tag_list = [];
        for(var tag of this.tags.tags)
            tag_list.push(tag.tag);
        let translated_tags = await tag_translations.get().get_translations(tag_list, "en");
        
        // Remove any old tag list and create a new one.
        helpers.remove_elements(this.tag_list_container);

        for(var tag of tag_list)
        {
            var a = this.tag_list_container.appendChild(document.createElement("a"));
            a.classList.add("tag");
            a.classList.add("box-link");

            var popup = null;
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
        var result = this.input.value;
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
    constructor(container)
    {
        super(container);

        this.container.hidden = true;
        this.displaying_illust_id = null;

        this.container.appendChild(helpers.create_from_template(".template-popup-bookmark-tag-dropdown"));

        this.container.addEventListener("click", this.clicked_bookmark_tag.bind(this), true);

        this.container.querySelector(".add-tag").addEventListener("click", async (e) => {
            await actions.add_new_tag(this._illust_id);
        });

        this.container.querySelector(".sync-tags").addEventListener("click", async (e) => {
            var bookmark_tags = await actions.load_recent_bookmark_tags();
            console.log("refreshed", bookmark_tags);
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
    set_illust_id(illust_id, page=-1)
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
    
    // Why can't setters be async?
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

    async refresh_internal(illust_data)
    {
        let illust_id = illust_data? illust_data.illustId:null;

        // If we're refreshing the same illust that's already refreshed, store which tags were selected
        // before we clear the list.
        var old_selected_tags = this.displaying_illust_id == illust_id? this.selected_tags:[];

        this.displaying_illust_id = null;

        var bookmark_tags = this.container.querySelector(".tag-list");
        helpers.remove_elements(bookmark_tags);

        var bookmarked = illust_data && illust_data.bookmarkData != null;
        var public_bookmark = illust_data && illust_data.bookmarkData && !illust_data.bookmarkData.private;
        var private_bookmark = illust_data && illust_data.bookmarkData && illust_data.bookmarkData.private;

        // Make sure the dropdown is hidden if we have no image.
        if(illust_data == null)
            this.visible = false;

        if(illust_data == null || !this.visible)
            return;

        // Create a temporary entry to show loading while we load bookmark details.
        var entry = document.createElement("span");
        bookmark_tags.appendChild(entry);
        entry.innerText = "Loading...";

        // If the tag list is open, populate bookmark details to get bookmark tags.
        // If the image isn't bookmarked this won't do anything.
        await image_data.singleton().load_bookmark_details(illust_data);

        // Remember which illustration's bookmark tags are actually loaded.
        this.displaying_illust_id = illust_id;

        // Remove elements again, in case another refresh happened while we were async
        // and to remove the loading entry.
        helpers.remove_elements(bookmark_tags);
        
        // Put tags that are set on the bookmark first in alphabetical order, followed by
        // all other tags in order of recent use.
        var active_tags = illust_data.bookmarkData? Array.from(illust_data.bookmarkData.tags):[];

        // If we're refreshing the list while it's open, make sure that any tags the user
        // selected are still in the list, even if they were removed by the refresh.  Put
        // them in active_tags, so they'll be marked as active.
        for(var tag of old_selected_tags)
        {
            if(active_tags.indexOf(tag) == -1)
                active_tags.push(tag);
        }

        var shown_tags = Array.from(active_tags); // copy
        shown_tags.sort();

        var recent_bookmark_tags = Array.from(helpers.get_recent_bookmark_tags()); // copy
        for(var tag of recent_bookmark_tags)
            if(shown_tags.indexOf(tag) == -1)
                shown_tags.push(tag);

        console.log("Showing tags:", shown_tags);

        for(var i = 0; i < shown_tags.length; ++i)
        {
            var tag = shown_tags[i];
            var entry = helpers.create_from_template(".template-popup-bookmark-tag-entry");
            entry.dataset.tag = tag;
            bookmark_tags.appendChild(entry);
            entry.querySelector(".tag-name").innerText = tag;

            var active = active_tags.indexOf(tag) != -1;
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
        var illust_data = await image_data.singleton().get_image_info(illust_id);
        await image_data.singleton().load_bookmark_details(illust_data);
        var old_tags = illust_data.bookmarkData? illust_data.bookmarkData.tags:[];

        var equal = new_tags.length == old_tags.length;
        for(var tag of new_tags)
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

        await actions.bookmark_add(illust_data, {
            tags: new_tags,
        });
    }

    // Toggle tags on click.  We don't save changes until we're closed.
    async clicked_bookmark_tag(e)
    {
        var a = e.target.closest(".popup-bookmark-tag-entry");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // Toggle this tag.  Don't actually save it immediately, so if we make multiple
        // changes we don't spam requests.
        var tag = a.dataset.tag;
        helpers.set_class(a, "active", !a.classList.contains("active"));
    }
}

// The button that shows and hides the tag list.
ppixiv.toggle_bookmark_tag_list_widget = class extends ppixiv.illust_widget
{
    constructor(container, bookmark_tag_widget)
    {
        super(container);

        this.bookmark_tag_widget = bookmark_tag_widget;

        // XXX
        // this.menu.querySelector(".tag-dropdown-arrow").hidden = !value;

        this.container.addEventListener("click", (e) => {
            e.preventDefault();

            // Ignore clicks if this button isn't enabled.
            if(!this.container.classList.contains("enabled"))
                return;
            
            this.bookmark_tag_widget.visible = !this.bookmark_tag_widget.visible;
        });
    }

    async refresh_internal(illust_data)
    {
        helpers.set_class(this.container, "enabled", illust_data != null);
    }
}

ppixiv.bookmark_button_widget = class extends ppixiv.illust_widget
{
    constructor(container, private_bookmark, bookmark_tag_widget)
    {
        super(container);

        this.private_bookmark = private_bookmark;
        this.bookmark_tag_widget = bookmark_tag_widget;

        this.container.addEventListener("click", this.clicked_bookmark.bind(this));

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    async refresh_internal(illust_data)
    {
        var count = this.container.querySelector(".count");
        if(count)
            count.textContent = illust_data? illust_data.bookmarkCount:"---";

        var bookmarked = illust_data && illust_data.bookmarkData != null;
        var our_bookmark_type = illust_data && illust_data.bookmarkData && illust_data.bookmarkData.private == this.private_bookmark;

        // Set up the bookmark buttons.
        helpers.set_class(this.container,  "enabled",     illust_data != null);
        helpers.set_class(this.container,  "bookmarked",  our_bookmark_type);
        helpers.set_class(this.container,  "will-delete", our_bookmark_type);
        
        // Set the tooltip.
        var type_string = this.private_bookmark? "private":"public";
        this.container.dataset.popup =
            illust_data == null? "":
            !bookmarked? (this.private_bookmark? "Bookmark privately":"Bookmark image"):
            our_bookmark_type? "Remove bookmark":
            "Change bookmark to " + type_string;
    }
    
    // Clicked one of the top-level bookmark buttons or the tag list.
    async clicked_bookmark(e)
    {
        // See if this is a click on a bookmark button.
        var a = e.target.closest(".button-bookmark");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // If the tag list dropdown is open, make a list of tags selected in the tag list dropdown.
        // If it's closed, leave tag_list null so we don't modify the tag list.
        var tag_list = null;
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
        var illust_data = await image_data.singleton().get_image_info(this._illust_id);
        if(illust_data.bookmarkData && illust_data.bookmarkData.private == this.private_bookmark)
        {
            await actions.bookmark_remove(illust_data);

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
        await actions.bookmark_add(illust_data, {
            private: this.private_bookmark,
            tags: tag_list,
        });

        // If the current image changed while we were async, stop.
        if(this._illust_id != illust_data.illustId)
            return;
    }
}

ppixiv.like_button_widget = class extends ppixiv.illust_widget
{
    constructor(container, private_bookmark)
    {
        super(container);

        this.private_bookmark = private_bookmark;

        this.container.addEventListener("click", this.clicked_like.bind(this));

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    async refresh_internal(illust_data)
    {
        // Update the like button highlight and tooltip.
        this.container.querySelector(".count").textContent = illust_data? illust_data.likeCount:"---";
        helpers.set_class(this.container, "liked", illust_data && illust_data.likeData);
        helpers.set_class(this.container, "enabled", illust_data != null && !illust_data.likeData);

        this.container.dataset.popup =
            illust_data && !illust_data.likeData? "Like image":
            illust_data && illust_data.likeData? "Already liked image":"";
    }
    
    async clicked_like(e)
    {
        e.preventDefault();
        e.stopPropagation();

        var illust_data = await image_data.singleton().get_image_info(this._illust_id);
        actions.like_image(illust_data);
    }
}

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
                console.log(SendImage.session_uuid_tiebreaker, data.session_uuid_tiebreaker);
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
            
            let was_in_preview = ppixiv.location.virtual;
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
        let our_tab_info = {
            message: "tab-info",
            session_uuid_tiebreaker: SendImage.session_uuid_tiebreaker,
            visible: !document.hidden,
            title: document.title,
            window_width: window.innerWidth,
            window_height: window.innerHeight,
            screen_x: window.screenX,
            screen_y: window.screenY,
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
        if(!this.previewing_image)
            return;

        this.previewing_image = false;
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
        }

        let desktop_width = desktop_max_x - desktop_min_x;
        let desktop_height = desktop_max_y - desktop_min_y;

        // Scale the maximum dimension of the largest tab to a fixed size, and the other
        // tabs relative to it, so we show the relative shape and dimensions of each tab.
        let max_dimension = 400;
        let scale_by = max_dimension / Math.max(desktop_width, desktop_height);
        let offset_x_by = -desktop_min_x * scale_by;
        let offset_y_by = -desktop_min_y * scale_by;

        desktop_width *= scale_by;
        desktop_height *= scale_by;
        console.log("desktop:", desktop_width, desktop_height);

        // Set the size of the containing box.
        this.dropdown_list.style.width = `${desktop_width}px`;
        this.dropdown_list.style.height = `${desktop_height}px`;
        
        // Add an entry for each tab we know about.
        let found_any = false;
        for(let tab_id of tab_ids)
        {
            let info = SendImage.known_tabs[tab_id];

            // For now, only show visible tabs.
            if(!info.visible)
                continue;

            let entry = helpers.create_from_template(".template-send-image-tab");
            entry.dataset.tab_id = tab_id;

            // If this tab is our own window:
            if(tab_id == SendImage.session_uuid)
                entry.classList.add("self");

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

            if(info.visible)
                entry.classList.add("tab-visible");

            // entry.querySelector(".title").innerText = info.title;
            this.dropdown_list.appendChild(entry);
            found_any = true;

            if(tab_id != SendImage.session_uuid)
            {
                entry.addEventListener("click", (e) => {
                    let entry = e.target.closest(".tab-entry");
                    if(!entry)
                        return;

                    // On click, send the image for display, and close the dropdown.
                    SendImage.send_image(this._illust_id, this._page, entry.dataset.tab_id, "display");
                    this.visible = false;
                    this.previewing_image = false;
                });

                entry.addEventListener("mouseenter", (e) => {
                    let entry = e.target.closest(".tab-entry");
                    if(!entry)
                        return;

                    SendImage.send_image(this._illust_id, this._page, entry.dataset.tab_id, "preview");
                    this.previewing_image = true;
                });

                entry.addEventListener("mouseleave", (e) => {
                    let entry = e.target.closest(".tab-entry");
                    if(!entry)
                        return;

                    this.unhighlight_tab();
                });
            }
        }

        this.container.querySelector(".no-other-tabs").hidden = found_any;
    }
}

