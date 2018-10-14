// A basic widget base class.
class widget
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
class illust_widget extends widget
{
    constructor(container)
    {
        super(container);

        // Refresh when the image data changes.
        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    set illust_id(value)
    {
        if(this._illust_id == value)
            return;
        this._illust_id = value;
        this.refresh();
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

// Show popup menus when a button is clicked.
class dropdown_menu_opener
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
        this.window_onmousedown = this.window_onmousedown.bind(this);
        this.box_onclick = this.box_onclick.bind(this);

        this.button = button;
        this.box = box;

        this.visible = false;

        this.button.addEventListener("click", (e) => { this.button_onclick(e); });
        document.body.addEventListener("viewhidden", (e) => { this.onviewhidden(e); });

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
            window.addEventListener("mousedown", this.window_onmousedown, true);
            if(this.close_on_click_inside)
                this.box.addEventListener("click", this.box_onclick, true);
        }
        else
        {
            window.removeEventListener("mousedown", this.window_onmousedown, true);
            this.box.removeEventListener("click", this.box_onclick, true);
        }
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

    window_onmousedown(e)
    {
        // Close the popup if anything outside the dropdown is clicked.  Don't
        // prevent the click event, so the click still happens.
        //
        // If this is a click inside the box or our button, ignore it.
        if(helpers.is_above(this.button, e.target) || helpers.is_above(this.box, e.target))
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
                a.classList.add("popup-bottom");
                a.dataset.popup = popup;
            }

            a.dataset.tag = tag_text;
            a.dataset.translatedTag = popup;

            a.textContent = tag_text;

            a.href = this.format_tag_link(tag);
        }

    }
};

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

    // This is only registered when we actually want to be blocking the context menu.
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

        // If invert-popup-hotkey is true, hold shift to open the popup menu.  Otherwise,
        // hold shift to suppress the popup menu so the browser context menu will open.
        //
        // Firefox doesn't cancel the context menu if shift is pressed.  This seems like a
        // well-intentioned but deeply confused attempt to let people override pages that
        // block the context menu, making it impossible for us to let you choose context
        // menu behavior and probably making it impossible for games to have sane keyboard
        // behavior at all.
        this.shift_was_pressed = e.shiftKey;
        if(navigator.userAgent.indexOf("Firefox/") == -1 && helpers.get_value("invert-popup-hotkey"))
            this.shift_was_pressed = !this.shift_was_pressed;
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
    get visible()
    {
        return this.displayed_menu != null;
    }
    show(x, y)
    {
        this.menu.hidden = false;

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
        this.menu.querySelector(".tooltip-display").hidden = element == null;
        if(element != null)
            this.menu.querySelector(".tooltip-display-text").textContent = element.dataset.popup;
    }

    onmouseover(e)
    {
        this.show_tooltip_for_element(e.target);
    }

    onmouseout(e)
    {
        this.show_tooltip_for_element(e.relatedTarget);
    }

    get hide_temporarily()
    {
        return this.menu.hidden;
    }

    set hide_temporarily(value)
    {
        this.menu.hidden = value;
    }

    hide()
    {
        if(this.displayed_menu == null)
            return;

        // Let menus inside the context menu know we're closing.
        view_hidden_listener.send_viewhidden(this.menu);
        
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

        // Remove any mutation observer.
        this.show_tooltip_for_element(null);

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

// A popup for inputting text.
//
// This is currently special purpose for the add tag prompt.
class text_prompt
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
class bookmark_tag_list_widget extends illust_widget
{
    constructor(container)
    {
        super(container);

        this.container.hidden = true;

        this.container.appendChild(helpers.create_from_template(".template-popup-bookmark-tag-dropdown"));

        this.container.addEventListener("click", this.clicked_bookmark_tag.bind(this), true);

        this.container.querySelector(".add-tag").addEventListener("click", (e) => {
            this.add_new_tag();
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

    get visible()
    {
        return !this.container.hidden;
    }
    
    // Why can't setters be async?
    set visible(value) { this._set_tag_dropdown_visible(value); }

    async _set_tag_dropdown_visible(value)
    {
        if(this.container.hidden == !value)
            return;

        this.container.hidden = !value;

        if(value)
        {
            // We only load existing bookmark tags when the tag list is open, so refresh.
            await this.refresh();

            // Remember which tags were selected when the dropdown was open, so we can tell if
            // they've changed.
            this.initially_selected_tags = this.selected_tags;
            console.log("Initial tags:", this.selected_tags);
        }
        else
        {
            // Save any selected tags when the dropdown is closed.
            this.save_current_tags();

            // Clear the tag list when the menu closes, so it's clean on the next refresh.
            var bookmark_tags = this.container.querySelector(".tag-list");
            helpers.remove_elements(bookmark_tags);
        }
    }

    async refresh_internal(illust_data)
    {
        // Store which tags were selected, before we clear the list.
        var old_selected_tags = this.selected_tags;

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
        if(this._illust_id == null)
            return;

        var old_tags = this.initially_selected_tags;
        var new_tags = this.selected_tags;
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
        var illust_data = await image_data.singleton().get_image_info(this._illust_id);
        var is_bookmarked = illust_data.bookmarkData != null;

        await actions.bookmark_edit(illust_data, {
            tags: new_tags,
        });
    }

    // Show a prompt to enter tags, so the user can add tags that aren't already in the
    // list.  Add the bookmarks to recents, and bookmark the image with the entered tags.
    async add_new_tag()
    {
        var illust_id = this._illust_id;
        var illust_data = await image_data.singleton().get_image_info(this._illust_id);

        console.log("Show tag prompt");

        // Hide the popup when we show the prompt.
        this.hide_temporarily = true;

        var prompt = new text_prompt();
        try {
            var tags = await prompt.result;
        } catch {
            // The user cancelled the prompt.
            return;
        }

        // Split the new tags.
        var tags = tags.split(" ");
        tags = tags.filter((value) => { return value != ""; });
        console.log("New tags:", tags);

        // This should already be loaded, since the only way to open this prompt is
        // in the tag dropdown.
        await image_data.singleton().load_bookmark_details(illust_data);

        // Add each tag the user entered to the tag list to update it.
        var active_tags = illust_data.bookmarkData? Array.from(illust_data.bookmarkData.tags):[];

        for(var tag of tags)
        {
            if(active_tags.indexOf(tag) != -1)
                continue;

            // Add this tag to recents.  bookmark_edit will add recents too, but this makes sure
            // that we add all explicitly entered tags to recents, since bookmark_edit will only
            // add tags that are new to the image.
            helpers.update_recent_bookmark_tags([tag]);
            active_tags.push(tag);
        }
        console.log("All tags:", active_tags);
        
        // Edit the bookmark.
        await actions.bookmark_edit(illust_data, {
            tags: active_tags,
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
class toggle_bookmark_tag_list_widget extends illust_widget
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

class bookmark_button_widget extends illust_widget
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

        // If the image is bookmarked and the same privacy button was clicked, remove the bookmark.
        var illust_data = await image_data.singleton().get_image_info(this._illust_id);
        if(illust_data.bookmarkData && illust_data.bookmarkData.private == this.private_bookmark)
        {
            await actions.bookmark_remove(illust_data);

            // If the current image changed while we were async, stop.
            if(this._illust_id != illust_data.illustId)
                return;
            
            // Hide the tag dropdown after unbookmarking.
            if(this.bookmark_tag_widget)
                this.bookmark_tag_widget.visible = false;
            
            return;
        }

        // Add or edit the bookmark.
        await actions.bookmark_edit(illust_data, {
            private: this.private_bookmark,
            tags: tag_list,
        });

        // If the current image changed while we were async, stop.
        if(this._illust_id != illust_data.illustId)
            return;

        // Remember that these tags were saved.
        this.initially_selected_tags = tag_list;        
    }
}

class like_button_widget extends illust_widget
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

