// A global right-click popup menu.
//
// This is only active when right clicking over items with the context-menu-target
// class.
//
// Not all items are available all the time.  This is a singleton class, so it's easy
// for different parts of the UI to tell us when they're active.
//
// This also handles alt-mousewheel zooming.
class main_context_menu extends popup_context_menu
{
    // Return the singleton.
    static get get()
    {
        return main_context_menu._singleton;
    }

    constructor(container)
    {
        super(container);

        if(main_context_menu._singleton != null)
            throw "Singleton already exists";
        main_context_menu._singleton = this;

        this.onwheel = this.onwheel.bind(this);
        this.onkeydown = this.onkeydown.bind(this);
        this.refresh_bookmark_ui = this.refresh_bookmark_ui.bind(this);

        this.on_click_viewer = null;

        image_data.singleton().illust_modified_callbacks.register(this.refresh_bookmark_ui.bind(this));

        // Refresh the menu when the view changes.
        this.mode_observer = new MutationObserver(function(mutationsList, observer) {
            for(var mutation of mutationsList) {
                if(mutation.type == "attributes")
                {
                    if(mutation.attributeName == "data-current-view")
                        this.refresh();
                }
            }
        }.bind(this));

        this.mode_observer.observe(document.body, {
            attributes: true, childList: false, subtree: false
        });

        this.refresh();

        this.menu.querySelector(".button-return-to-search").addEventListener("click", this.clicked_return_to_search.bind(this));
        this.menu.querySelector(".button-fullscreen").addEventListener("click", this.clicked_fullscreen.bind(this));
        this.menu.querySelector(".button-zoom").addEventListener("click", this.clicked_zoom_toggle.bind(this));
        window.addEventListener("wheel", this.onwheel, true);
        window.addEventListener("keydown", this.onkeydown);

        settings.register_change_callback("recent-bookmark-tags", this.refresh_bookmark_ui);

        for(var button of this.menu.querySelectorAll(".button-zoom-level"))
            button.addEventListener("click", this.clicked_zoom_level.bind(this));



        // The bookmark buttons, and clicks in the tag dropdown:
        for(var a of this.menu.querySelectorAll(".button-bookmark"))
            a.addEventListener("click", this.clicked_bookmark.bind(this));
        this.bookmark_tag_dropdown = this.menu.querySelector(".popup-bookmark-tag-dropdown");
        this.bookmark_tag_dropdown.addEventListener("click", this.clicked_bookmark.bind(this), true);
        this.menu.querySelector(".button-like").addEventListener("click", this.clicked_like.bind(this));

        this.menu.querySelector(".add-tag").addEventListener("click", (e) => {
            this.add_new_tag();
        });
        this.menu.querySelector(".sync-tags").addEventListener("click", async (e) => {
            var bookmark_tags = await actions.load_recent_bookmark_tags();
            console.log("refreshed", bookmark_tags);
            helpers.set_recent_bookmark_tags(bookmark_tags);
        });
        
        this.menu.querySelector(".button-bookmark-tags").addEventListener("click", (e) => {
            e.preventDefault();

            // Ignore clicks if this button isn't enabled.
            if(!this.menu.querySelector(".button-bookmark-tags").classList.contains("enabled"))
                return;
            
            this.tag_dropdown_visible = !this.tag_dropdown_visible;
        });
        this.element_bookmark_tag_list = this.menu.querySelector(".bookmark-tag-list");
        this.refresh_bookmark_ui();
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

    get tag_dropdown_visible()
    {
        return !this.bookmark_tag_dropdown.hidden;
    }

    // Why can't setters be async?
    set tag_dropdown_visible(value) { this._set_tag_dropdown_visible(value); }

    async _set_tag_dropdown_visible(value)
    {
        if(this.bookmark_tag_dropdown.hidden == !value)
            return;

        this.bookmark_tag_dropdown.hidden = !value;
        this.menu.querySelector(".tag-dropdown-arrow").hidden = !value;

        if(value)
        {
            // We only load existing bookmark tags when the tag list is open, so refresh.
            await this.refresh_bookmark_ui();

            // Remember which tags were selected when the dropdown was open, so we can tell if
            // they've changed.
            this.initially_selected_tags = this.selected_tags;
            console.log("Initial tags:", this.selected_tags);
        }
        else
        {
            // The dropdown is being closed.  See if we need to save bookmark tags.  If the
            // image isn't bookmarked, we'll do this when the user clicks the bookmark button,
            // but if the image was already bookmarked we do it when the tag list is closed.
            //
            // If tag bookmarks are set, and the image is already bookmarked, save the new
            // tags to the bookmark.
            //
            // If tag bookmarks are set and the image isn't bookmarked, show a message.  The
            // user needs to click one of the bookmark buttons to initially save the bookmark
            // (or else we don't know whether it's a public or private bookmark).
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
    }

    // Refresh the bookmarking and like UI.
    async refresh_bookmark_ui()
    {
        // Store which tags were selected, before we clear the list.
        var old_selected_tags = this.selected_tags;

        var bookmark_tags = this.bookmark_tag_dropdown.querySelector(".tag-list");
        helpers.remove_elements(bookmark_tags);

        // Grab the illust info to check if it's bookmarked.
        var illust_id = this._illust_id;
        var illust_data = null;
        if(this._illust_id != null)
            illust_data = await image_data.singleton().get_image_info(this._illust_id);

        // Stop if the ID changed while we were async.
        if(this._illust_id != illust_id)
            return;

        // Update the like button highlight and tooltip.
        helpers.set_class(this.menu.querySelector(".button-like"),"liked", illust_data && illust_data.likeData);
        this.menu.querySelector(".button-like").dataset.tooltip =
            illust_data && !illust_data.likeData? "Like image":
            illust_data && illust_data.likeData? "Already liked image":"";
        helpers.set_class(this.menu.querySelector(".button-like"), "enabled", illust_data != null && !illust_data.likeData);
        this.menu.querySelector(".button-bookmark .count").textContent = illust_data? illust_data.bookmarkCount:"---";
        this.menu.querySelector(".button-like .count").textContent = illust_data? illust_data.likeCount:"---";

        var bookmarked = illust_data && illust_data.bookmarkData != null;
        var public_bookmark = illust_data && illust_data.bookmarkData && !illust_data.bookmarkData.private;
        var private_bookmark = illust_data && illust_data.bookmarkData && illust_data.bookmarkData.private;

        // Make sure the dropdown is hidden if we have no image.
        if(illust_data == null)
            this.bookmark_tag_dropdown.hidden = true;

        if(illust_data != null && this.tag_dropdown_visible)
        {
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
        else
        {
            console.log("Not refreshing tag list");
        }

        // Set up the bookmark buttons.
        helpers.set_class(this.menu.querySelector(".button-bookmark.public"),  "enabled",     illust_data != null);
        helpers.set_class(this.menu.querySelector(".button-bookmark.public"),  "bookmarked",  public_bookmark);
        helpers.set_class(this.menu.querySelector(".button-bookmark.public"),  "will-delete", public_bookmark);
        helpers.set_class(this.menu.querySelector(".button-bookmark.private"), "enabled",     illust_data != null);
        helpers.set_class(this.menu.querySelector(".button-bookmark.private"), "bookmarked",  private_bookmark);
        helpers.set_class(this.menu.querySelector(".button-bookmark.private"), "will-delete", private_bookmark);

        // We don't support editing tags (since bookmarkData doesn't include them), so disable the tag
        // dropdown if the image is bookmarked.
        helpers.set_class(this.menu.querySelector(".button-bookmark-tags"), "enabled", illust_data != null);
        
        this.menu.querySelector(".button-bookmark.public").dataset.tooltip =
            illust_data == null? "":
            !bookmarked? "Bookmark image":
            private_bookmark?"Change bookmark to public":"Remove bookmark";
        this.menu.querySelector(".button-bookmark.private").dataset.tooltip =
            illust_data == null? "":
            !bookmarked? "Bookmark privately":
            public_bookmark?"Change bookmark to private":"Remove bookmark";
    }

    // Return an array of tags selected in the tag dropdown.
    get selected_tags()
    {
        var tag_list = [];
        var bookmark_tags = this.bookmark_tag_dropdown;
        for(var entry of bookmark_tags.querySelectorAll(".popup-bookmark-tag-entry"))
        {
            if(!entry.classList.contains("active"))
                continue;
            tag_list.push(entry.dataset.tag);
        }
        return tag_list;
    }

    // Clicked one of the top-level bookmark buttons or the tag list.
    async clicked_bookmark(e)
    {
        a = e.target.closest(".popup-bookmark-tag-entry");
        if(a != null)
        {
            e.preventDefault();
            e.stopPropagation();

            // Toggle this tag.  Don't actually save it immediately, so if we make multiple
            // changes we don't spam requests.
            var tag = a.dataset.tag;
            console.log("toggle", tag);
            helpers.set_class(a, "active", !a.classList.contains("active"));

            return;
        }

        // See if this is a click on a bookmark button.
        var a = e.target.closest(".button-bookmark");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        var private_bookmark = a.classList.contains("private");

        // If the tag list dropdown is open, make a list of tags selected in the tag list dropdown.
        // If it's closed, leave tag_list null so we don't modify the tag list.
        var tag_list = null;
        if(this.tag_dropdown_visible)
            tag_list = this.selected_tags;

        // If the image is bookmarked and the same privacy button was clicked, remove the bookmark.
        var illust_data = await image_data.singleton().get_image_info(this._illust_id);
        if(illust_data.bookmarkData && illust_data.bookmarkData.private == private_bookmark)
        {
            await actions.bookmark_remove(illust_data);

            // If the current image changed while we were async, stop.
            if(this._illust_id != illust_data.illustId)
                return;
            
            // Hide the tag dropdown after unbookmarking.
            this.tag_dropdown_visible = false;
            
            return;
        }

        // Add or edit the bookmark.
        await actions.bookmark_edit(illust_data, {
            private: private_bookmark,
            tags: tag_list,
        });

        // If the current image changed while we were async, stop.
        if(this._illust_id != illust_data.illustId)
            return;

        // Remember that these tags were saved.
        this.initially_selected_tags = tag_list;        
    }

    async clicked_like(e)
    {
        e.preventDefault();
        e.stopPropagation();

        var illust_data = await image_data.singleton().get_image_info(this._illust_id);
        actions.like_image(illust_data);
    }

    set illust_id(value)
    {
        if(this._illust_id == value)
            return;

        this._illust_id = value;

        this.refresh_bookmark_ui();
    }

    shutdown()
    {
        this.mode_observer.disconnect();
        window.removeEventListener("wheel", this.onwheel, true);
        super.shutdown();
    }

    get on_click_viewer()
    {
        return this._on_click_viewer;
    }
    set on_click_viewer(viewer)
    {
        this._on_click_viewer = viewer;
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
        return view == "illust" && this._on_click_viewer != null;
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        this.data_source = data_source;
        this.refresh();
    }

    onkeydown(e)
    {
        if(this._is_zoom_ui_enabled)
        {
            var zoom = helpers.is_zoom_hotkey(e);
            if(zoom != null)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.handle_zoom_event(e, zoom < 0);
            }
        }
    }

    onwheel(e)
    {
        // Stop if zooming isn't enabled.
        if(!this._is_zoom_ui_enabled)
            return;

        // Only mousewheel zoom if control is pressed, or if the popup menu is visible.
        if(!e.ctrlKey && !this.visible)
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
            // Hide the poopup menu.  It remains open, so hide() will still be called when
            // the right mouse button is released and the overall flow remains unchanged, but
            // the popup itself will be hidden.
            this.hide_temporarily = true;
        }

        // If e is a keyboard event, use null to use the center of the screen.
        var keyboard = e instanceof KeyboardEvent;
        var pageX = keyboard? null:e.pageX;
        var pageY = keyboard? null:e.pageY;
        let center = this._on_click_viewer.get_image_position(pageX, pageY);
        
        // If mousewheel zooming is used while not zoomed, turn on zooming and set
        // a 1x zoom factor, so we zoom relative to the previously unzoomed image.
        if(!this._on_click_viewer.zoom_active)
        {
            this._on_click_viewer.zoom_level = 4; // level 4 is 1x
            this._on_click_viewer.locked_zoom = true;
            this._on_click_viewer.relative_zoom_level = 0;
            this.refresh();
        }

        this._on_click_viewer.relative_zoom_level += down? -1:+1;

        // As a special case, if we're in 1x zoom from above and we return to 1x relative zoom
        // (eg. the user mousewheeled up and then back down), switch to another zoom mode.
        // Otherwise, if you zoom up and then back down, the zoom level is left at 1x, so click
        // zooming seems to be broken.  We don't know what the old zoom setting was to restore it,
        // so we just switch to fill zoom.
        if(this._on_click_viewer.relative_zoom_level == 0 && this._on_click_viewer.zoom_level == 4)
        {
            this._on_click_viewer.zoom_level = 0;
            this._on_click_viewer.locked_zoom = false;
        }

        this._on_click_viewer.set_image_position(pageX, pageY, center);
        this.refresh();
    }

    show(x, y)
    {
        // If RMB is pressed while dragging LMB, stop dragging the window when we
        // show the popup.
        if(this.on_click_viewer != null)
            this.on_click_viewer.stop_dragging();

        super.show(x, y);
    }
    
    hide()
    {
        super.hide();

        // Clear the tag list when the menu closes, so it's clean on the next refresh.
        var bookmark_tags = this.bookmark_tag_dropdown.querySelector(".tag-list");
        helpers.remove_elements(bookmark_tags);
        
        // Hide the tag dropdown when the menu closes.
        this.tag_dropdown_visible = false;
    }

    // Update selection highlight for the context menu.
    refresh()
    {
        var view = document.body.dataset.currentView;

        // Update the tooltip for the thumbnail toggle button.
        var navigate_out_label = main_controller.singleton.navigate_out_label;
        var title = navigate_out_label != null? ("Return to " + navigate_out_label):"";
        this.menu.querySelector(".button-return-to-search").dataset.tooltip = title;
        helpers.set_class(this.menu.querySelector(".button-return-to-search"), "enabled", navigate_out_label != null);
        this.refresh_tooltip();

        // Enable the zoom buttons if we're in the image view and we have an on_click_viewer.
        for(var element of this.menu.querySelectorAll(".zoom-strip .button"))
            helpers.set_class(element, "enabled", this._is_zoom_ui_enabled);

        if(this._is_zoom_ui_enabled)
        {
            helpers.set_class(this.menu.querySelector(".button-zoom"), "selected", this._on_click_viewer.locked_zoom);

            var zoom_level = this._on_click_viewer.zoom_level;
            for(var button of this.menu.querySelectorAll(".button-zoom-level"))
                helpers.set_class(button, "selected", parseInt(button.dataset.level) == zoom_level);
        }
    }

    clicked_return_to_search(e)
    {
        main_controller.singleton.navigate_out();
    }

    clicked_fullscreen(e)
    {
        if(!document.fullscreenElement)
            document.documentElement.requestFullscreen();
        else
            document.exitFullscreen(); 
    }

    clicked_zoom_toggle(e)
    {
        if(!this._is_zoom_ui_enabled)
            return;
        
        let center = this._on_click_viewer.get_image_position(e.pageX, e.pageY);
        this._on_click_viewer.locked_zoom = !this._on_click_viewer.locked_zoom;
        this._on_click_viewer.set_image_position(e.pageX, e.pageY, center);

        this.refresh();
    }

    clicked_zoom_level(e)
    {
        if(!this._is_zoom_ui_enabled)
            return;

        var level = parseInt(e.currentTarget.dataset.level);

        // If the zoom level that's already selected is clicked and we're already zoomed,
        // just toggle zoom as if the toggle zoom button was pressed.
        if(this._on_click_viewer.zoom_level == level && this._on_click_viewer.relative_zoom_level == 0 && this._on_click_viewer.locked_zoom)
        {
            this.on_click_viewer.locked_zoom = false;
            this.refresh();
            return;
        }


        let center = this._on_click_viewer.get_image_position(e.pageX, e.pageY);
        
        // Each zoom button enables zoom lock, since otherwise changing the zoom level would
        // only have an effect when click-dragging, so it looks like the buttons don't do anything.
        this._on_click_viewer.zoom_level = level;
        this._on_click_viewer.locked_zoom = true;
        this._on_click_viewer.relative_zoom_level = 0;

        this._on_click_viewer.set_image_position(e.pageX, e.pageY, center);
        
        this.refresh();
    }
}

