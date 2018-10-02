// Display messages in the popup widget.  This is a singleton.
class message_widget
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

    // Center the current message instead of showing it at the bottom.
    center()
    {
        this.container.classList.add("centered");
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

class avatar_widget
{
    // options:
    // parent: node to add ourself to (required)
    // changed_callback: called when a follow or unfollow completes
    // big: if true, show the big avatar instead of the small one
    constructor(options)
    {
        this.options = options;
        this.clicked_follow = this.clicked_follow.bind(this);
        this.user_changed = this.user_changed.bind(this);

        this.root = helpers.create_from_template(".template-avatar");
        helpers.set_class(this.root, "big", this.options.big);

        image_data.singleton().user_modified_callbacks.register(this.user_changed);

        // Show the favorite UI when hovering over the avatar icon.
        var avatar_popup = this.root; //container.querySelector(".avatar-popup");
        avatar_popup.addEventListener("mouseover", function(e) { helpers.set_class(avatar_popup, "popup-visible", true); }.bind(this));
        avatar_popup.addEventListener("mouseout", function(e) { helpers.set_class(avatar_popup, "popup-visible", false); }.bind(this));

        avatar_popup.querySelector(".follow-button.public").addEventListener("click", this.clicked_follow.bind(this, false), false);
        avatar_popup.querySelector(".follow-button.private").addEventListener("click", this.clicked_follow.bind(this, true), false);
        avatar_popup.querySelector(".unfollow-button").addEventListener("click", this.clicked_follow.bind(this, true), false);
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

        var is_us = user_data.userId == global_data.user_id;
        this.root.hidden = is_us;
        if(is_us)
            return;

        // We can't tell if we're followed privately or not, only that we're following.
        helpers.set_class(this.root, "followed", this.user_data.isFollowed);

        this.root.querySelector(".avatar-link").href = "/member_illust.php?id=" + user_data.userId + "#ppixiv";

        // If we don't have an image because we're loaded from a source that doesn't give us them,
        // just hide the avatar image.
        var element_author_avatar = this.root.querySelector(".avatar");
        var key = "imageBig";
        if(user_data[key])
            element_author_avatar.src = user_data[key];
    }
    
    follow(follow_privately)
    {
        if(this.user_data == null)
            return;

        var username = this.user_data.name;
        var tags = this.element_follow_folder.value;
        helpers.rpc_post_request("/bookmark_add.php", {
            mode: "add",
            type: "user",
            user_id: this.user_data.userId,
            tag: tags,
            restrict: follow_privately? 1:0,
            format: "json",
        }, function(result) {
            if(result == null)
                return;

            // This doesn't return any data.  Record that we're following and refresh the UI.
            this.user_data.isFollowed = true;
            image_data.singleton().call_user_modified_callbacks(this.user_data.userId);

            var message = "Followed " + username;
            if(follow_privately)
                message += " privately";
            message_widget.singleton.show(message);
        }.bind(this));
    }

    unfollow()
    {
        if(this.user_data == null)
            return;

        var username = this.user_data.name;

        helpers.rpc_post_request("/rpc_group_setting.php", {
            mode: "del",
            type: "bookuser",
            id: this.user_data.userId,
        }, function(result) {
            if(result == null)
                return;

            // Record that we're no longer following and refresh the UI.
            this.user_data.isFollowed = false;
            image_data.singleton().call_user_modified_callbacks(this.user_data.userId);

            message_widget.singleton.show("Unfollowed " + username);
        }.bind(this));
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

    handle_onkeydown(e)
    {
        if(this.user_data == null)
            return;
        
        if(e.keyCode == 70) // f
        {
            // f to follow publically, F to follow privately, ^F to unfollow.
            e.stopPropagation();
            e.preventDefault();

            if(this.user_data == null)
                return;

            if(e.ctrlKey)
            {
                // Remove the bookmark.
                if(!this.user_data.isFollowed)
                {
                    message_widget.singleton.show("Not following this user");
                    return;
                }

                this.unfollow();
                return;
            }

            if(this.user_data.isFollowed)
            {
                message_widget.singleton.show("Already following (^F to unfollow)");
                return;
            }
            
            this.follow(e.shiftKey);
            return;
        }
    }
};

// A list of tags, with translations in popups where available.
class tag_widget
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
    };

    format_tag_link(tag)
    {
        if(this.options.format_link)
            return this.options.format_link(tag);

        var search_url = new URL("/search.php", window.location.href);
        search_url.search = "s_mode=s_tag_full&word=" + tag.tag;
        search_url.hash = "#ppixiv";
        return search_url.toString();
    };

    set(tags)
    {
        // Remove any old tag list and create a new one.
        helpers.remove_elements(this.tag_list_container);

        var tags = tags.tags;
        for(var tag of tags)
        {
            var a = this.tag_list_container.appendChild(document.createElement("a"));
            a.classList.add("tag");
            a.classList.add("box-link");

            // They really can't decide how to store tag translations:
            var popup = null;
            if(tag.translation && tag.translation.en)
                popup = tag.translation.en;
            else if(tag.romaji != null && tag.romaji != "")
                popup = tag.romaji;
            else if(tag.tag_translation != null & tag.tag_translation != "")
                popup = tag.tag_translation;

            var tag_text = tag.tag;

            if(popup && false)
            {
                var swap = tag_text;
                tag_text = popup;
                popup = swap;
            }

            if(popup)
            {
                a.classList.add("popup");
                a.dataset.popup = popup;
            }

            a.dataset.tag = tag_text;
            a.dataset.translatedTag = popup;

            a.textContent = tag_text;

            a.href = this.format_tag_link(tag);
        }

    }
};

// A widget for refreshing bookmark tags.
//
// Pages don't tell us what our bookmark tags are so we can display them.  This
// lets us sync our bookmark tag list with the tags the user has.
class refresh_bookmark_tag_widget
{
    constructor(container)
    {
        this.onclick = this.onclick.bind(this);

        this.container = container;
        this.running = false;
        this.container.addEventListener("click", this.onclick);
    }

    onclick(e)
    {
        this.refresh();
    }

    async refresh(e)
    {
        if(this.running)
            return;

        this.running = true;
        helpers.set_class(this.container,"spin", this.running);

        try {
            var doc = await helpers.load_data_in_iframe_async("/bookmark.php");
            f();
        } finally {
            this.running = false;

            // For some reason, if we disable the spin in this callback, the icon skips
            // for a frame every time (at least in Firefox).  There's no actual processing
            // skip and it doesn't happen if we set the class from a timer.
            setTimeout(function() {
                helpers.set_class(this.container,"spin", this.running);
            }.bind(this), 100);
        }

        var bookmark_tags = [];
        for(var element of doc.querySelectorAll("#bookmark_list a[href*='bookmark.php']"))
        {
            var tag = new URL(element.href).searchParams.get("tag");
            if(tag != null)
                bookmark_tags.push(tag);
        }
        helpers.set_recent_bookmark_tags(bookmark_tags);

        window.dispatchEvent(new Event("bookmark-tags-changed"));
    }
}

// A helper for a simple right-click context menu.
//
// The menu opens on right click and closes when the button is released.
class popup_context_menu
{
    constructor(container)
    {
        this.onmousedown = this.onmousedown.bind(this);
        this.onmouseup = this.onmouseup.bind(this);
        this.oncontextmenu = this.oncontextmenu.catch_bind(this);
        this.onmouseover = this.onmouseover.bind(this);
        this.onmouseout = this.onmouseout.bind(this);

        this.container = container;

        this.container.addEventListener("mousedown", this.onmousedown);
        window.addEventListener("contextmenu", this.oncontextmenu);

        // Create the menu.  The caller will attach event listeners for clicks.
        this.menu = helpers.create_from_template(".template-context-menu");

        // Work around glitchiness in Chrome's click behavior (if we're in Chrome).
        new fix_chrome_clicks(this.menu);

        this.menu.addEventListener("mouseover", this.onmouseover, true);
        this.menu.addEventListener("mouseout", this.onmouseout, true);

        // Whether the left and right mouse buttons are pressed:
        this.buttons_down = [false, false, false];
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

    oncontextmenu(e)
    {
        e.preventDefault();
        e.stopPropagation();
    }

    onmousedown(e)
    {
        if(this.displayed_menu == null && !this.context_menu_enabled_for_element(e.target))
            return;
        
        if(this.displayed_menu == null && e.button != 2)
            return;

        this.buttons_down[e.button] = true;
        if(e.button != 2)
            return;

        this.shift_was_pressed = e.shiftKey;
        if(this.shift_was_pressed)
            return;

        e.preventDefault();
        e.stopPropagation();

        this.show(e.pageX, e.pageY);
    }

    // Releasing the left or right mouse button hides the menu if both the left
    // and right buttons are released.  Pressing right, then left, then releasing
    // right won't close the menu until left is also released.  This prevents lost
    // inputs when quickly right-left clicking.
    onmouseup(e)
    {
        this.buttons_down[e.button] = false;
        if(!this.buttons_down[0] && !this.buttons_down[2])
        {
            // Run the hide asynchronously.  If we close it immediately and this
            // release would have triggered a click event, the click won't happen.
            setTimeout(this.hide.bind(this), 0);
        }
    }

    // Return the element that should be under the cursor when the menu is opened.
    get element_to_center()
    {
        return null;
    }
    show(x, y)
    {
        if(this.displayed_menu != null)
            return;

        this.start_preventing_context_menu();

        this.displayed_menu = this.menu;
        this.container.appendChild(this.displayed_menu);

        // Disable popup UI while a context menu is open.
        document.body.classList.add("hide-ui");
        
        window.addEventListener("mouseup", this.onmouseup);

        var centered_element = this.element_to_center;
        if(centered_element == null)
            centered_element = this.displayed_menu;
        var pos = helpers.get_relative_pos(centered_element, this.displayed_menu);
        x -= pos[0];
        y -= pos[1];
        x -= centered_element.offsetWidth / 2;
        y -= centered_element.offsetHeight * 3 / 4;
        this.displayed_menu.style.left = x + "px";
        this.displayed_menu.style.top = y + "px";

        hide_mouse_cursor_on_idle.disable_all();
    }

    // If element is within a button that has a tooltip set, show it.
    show_tooltip_for_element(element)
    {
        if(this.tooltip_element == element)
            return;
        this.tooltip_element = element;
        this.refresh_tooltip();
    }

    refresh_tooltip()
    {
        var element = this.tooltip_element;
        if(element != null)
            element = element.closest("[data-tooltip]");
        this.menu.querySelector(".tooltip-display").hidden = element == null;
        if(element != null)
            this.menu.querySelector(".tooltip-display-text").textContent = element.dataset.tooltip;
    }

    onmouseover(e)
    {
        this.show_tooltip_for_element(e.target);
    }

    onmouseout(e)
    {
        this.show_tooltip_for_element(e.relatedTarget);
    }

    hide()
    {
        if(this.displayed_menu == null)
            return;

        this.stop_preventing_context_menu_after_delay();
        
        this.displayed_menu.parentNode.removeChild(this.displayed_menu);
        this.displayed_menu = null;
        hide_mouse_cursor_on_idle.enable_all();
        this.buttons_down = [false, false, false];
        document.body.classList.remove("hide-ui");
        window.removeEventListener("mouseup", this.onmouseup);
    }

    shutdown()
    {
        this.hide();

        this.container.removeEventListener("mousedown", this.onmousedown);
        this.container.removeEventListener("click", this.onclick);
        this.stop_preventing_context_menu();
    }

    // Work around bad Firefox oncontextmenu behavior (seen in 62).  In Chrome and older
    // versions of Firefox, contextmenu is always sent to the same element as mousedown,
    // even if you move the mouse before releasing the button.  Current versions of Firefox
    // send contextmenu to the element the mouse is over at the time of the mouse release.
    // This makes it impossible to tell what element was clicked on in the first place.
    // That's bad, since you want to be able to prevent the context menu if you did something
    // else with the right mouse button, like our popup menus.
    //
    // Work around this by temporarily blocking all contextmenu events in the document
    // after our popup closes.  That blocks the context menu regardless of which element
    // it goes to.  This is brief enough that it won't interfere with other real context
    // menus.
    cancel_stop_preventing_context_menu_after_delay()
    {
        if(this.timer == null)
            return;

        clearTimeout(this.timer);
        this.timer = null;
    }

    stop_preventing_context_menu_after_delay()
    {
        this.cancel_stop_preventing_context_menu_after_delay();

        this.timer = setTimeout(function() {
            this.timer = null;
            this.stop_preventing_context_menu();
        }.bind(this), 100);
    }

    start_preventing_context_menu()
    {
        this.cancel_stop_preventing_context_menu_after_delay();

        if(this.preventing_context_menu)
            return;

        this.preventing_context_menu = true;
        window.addEventListener("contextmenu", this.oncontextmenu);
    }

    stop_preventing_context_menu()
    {
        if(!this.preventing_context_menu)
            return;

        this.preventing_context_menu = false;
        window.removeEventListener("contextmenu", this.oncontextmenu);
    }
}

// A widget to control the thumbnail size slider.
class thumbnail_size_slider_widget
{
    constructor(preference_name, slider)
    {
        this.oninput = this.oninput.bind(this);

        this.preference_name = preference_name;
        this.slider = slider;
        this.on_change = new callback_list();

        this.load_from_pref();

        this.slider.addEventListener("input", this.oninput);
    }

    load_from_pref()
    {
        var value = parseInt(helpers.get_value(this.preference_name));
        if(typeof(value) != "number" || isNaN(value))
            value = 4;
        this.value = value;
    }

    save_to_pref()
    {
        helpers.set_value(this.preference_name, this.value);
    }
    
    set value(value)
    {
        this.slider.value = value;
        this.on_change.call();
    }

    get value()
    {
        return parseInt(this.slider.value);
    }

    get size()
    {
        var width = 100 * Math.pow(1.3, this.slider.value);
        return width;
    }

    oninput(e)
    {
        this.save_to_pref();
        this.on_change.call();
    }
};

