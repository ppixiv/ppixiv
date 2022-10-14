"use strict";

// Handle showing the search history and tag edit dropdowns.
ppixiv.tag_search_box_widget = class extends ppixiv.widget
{
    constructor({...options})
    {
        super(options);

        this.input_element = this.container.querySelector(".input-field-container > input");

        this.dropdown_widget = new tag_search_dropdown_widget({
            container: this.container,
            input_element: this.container,
        });
        this.edit_widget = new tag_search_edit_widget({
            container: this.container,
            input_element: this.container,
        });

        this.container.addEventListener("focus", this.focus_changed, true);
        this.container.addEventListener("blur", this.focus_changed, true);

        let edit_button = this.container.querySelector(".edit-search-button");
        if(edit_button)
        {
            edit_button.addEventListener("click", (e) => {
                // Toggle the edit widget, hiding the search history dropdown if it's visible.
                if(this.edit_widget.visible)
                {
                    this.edit_widget.hide();
                    this.dropdown_widget.show();
                } else {
                    this.dropdown_widget.hide();
                    this.edit_widget.show();
                }
            });
        }
        
        // Search submission:
        helpers.input_handler(this.input_element, this.submit_search);
        this.container.querySelector(".search-submit-button").addEventListener("click", this.submit_search);

        // Hide the dropdowns on navigation.
        new view_hidden_listener(this.input_element, (e) => {
            this.hide();
        });
    }

    hide()
    {
        this.dropdown_widget.hide();
        this.edit_widget.hide();
    }

    // Show the dropdown when the input is focused.  Hide it when the input is both
    // unfocused and this.container isn't being hovered.  This way, the input focus
    // can leave the input box to manipulate the dropdown without it being hidden,
    // but we don't rely on hovering to keep the dropdown open.
    focus_changed = (e) =>
    {
        this.focused = this.container.matches(":focus-within");

        // If anything inside the container is focused, make sure it's the input field.
        if(this.focused && !this.input_element.matches(":focus"))
            this.input_element.focus();

        // If we're focused and nothing was visible, show the tag dropdown.  If we're not
        // focused, hide both.
        if(this.focused && !this.dropdown_widget.visible && !this.edit_widget.visible)
            this.dropdown_widget.show();
        else if(!this.focused && (this.dropdown_widget.visible || this.edit_widget.visible))
            this.hide();
    }

    submit_search = (e) =>
    {
        // This can be sent to either the search page search box or the one in the
        // navigation dropdown.  Figure out which one we're on.
        var search_box = e.target.closest(".search-box");
        var tags = this.input_element.value.trim();
        if(tags.length == 0)
            return;

        // Add this tag to the recent search list.
        helpers.add_recent_search_tag(tags);

        // If we're submitting by pressing enter on an input element, unfocus it and
        // close any widgets inside it (tag dropdowns).
        if(e.target instanceof HTMLInputElement)
        {
            e.target.blur();
            view_hidden_listener.send_viewhidden(e.target);
        }
        
        // Run the search.
        let args = ppixiv.helpers.get_args_for_tag_search(tags, ppixiv.plocation);
        helpers.navigate(args);
    }
}

ppixiv.tag_search_dropdown_widget = class extends ppixiv.widget
{
    constructor({input_element, ...options})
    {
        // This is a tabindex so there's a place for focus to go for all clicks inside it, so
        // clicks inside it don't cause us to lose focus and hide.        
        super({...options, visible: false, template: `
            <div class=search-history tabindex="1">
                <div class=input-dropdown>
                    <div class=input-dropdown-list>
                        <!-- template-tag-dropdown-entry instances will be added here. -->
                    </div>
                </div>
            </div>
        `});

        // Find the <input>.
        this.input_element = input_element.querySelector("input");

        this.input_element.addEventListener("keydown", this.input_onkeydown);
        this.input_element.addEventListener("input", this.input_oninput);

        // Refresh the dropdown when the tag search history changes.
        window.addEventListener("recent-tag-searches-changed", this.populate_dropdown);

        this.container.addEventListener("click", this.dropdown_onclick);

        this.current_autocomplete_results = [];

        // input-dropdown is resizable.  Save the size when the user drags it.
        this.input_dropdown = this.container.querySelector(".input-dropdown");
        let observer = new MutationObserver((mutations) => {
            // resize sets the width.  Use this instead of offsetWidth, since offsetWidth sometimes reads
            // as 0 here.
            settings.set("tag-dropdown-width", this.input_dropdown.style.width);
        });
        observer.observe(this.input_dropdown, { attributes: true });

        // Restore input-dropdown's width.  Force a minimum width, in case this setting is saved incorrectly.
        this.input_dropdown.style.width = settings.get("tag-dropdown-width", "400px");

        this.container.hidden = true;

        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.container,
            callback: this.pointerevent,
        });

        this.set_editing(false);
    }
    
    set_editing(value)
    {
        if(this.editing == value)
            return;

        this.editing = value;
        helpers.set_class(this.container.querySelector(".input-dropdown-list"), "editing", this.editing);
    }

    pointerevent = (e) =>
    {
        if(e.pressed)
        {
            // See if this is a click on a drag handle.
            let drag_handle = e.target.closest(".drag-handle");
            if(drag_handle == null)
                return;

            e.preventDefault();
            e.stopPropagation();

            // Start dragging.  We remember the tag we're dragging rather than the element so this
            // stays valid as the list is refreshed.
            let entry = drag_handle.closest(".entry");
            this.dragging_tag = entry.dataset.tag;

            window.addEventListener("pointermove", this.pointermove_drag_handle);
        }
        else if(this.dragging_tag)
        {
            this.stop_dragging();
        }
    }

    find_tag_entry(tag)
    {
        for(let entry of this.container.querySelectorAll(".entry[data-tag]"))
        {
            if(entry.dataset.tag == tag)
                return entry;
        }
        return entry;
    }

    pointermove_drag_handle = (e) =>
    {
        let entry = this.find_tag_entry(this.dragging_tag);
        let next_entry = entry?.nextElementSibling;
        let previous_entry = entry?.previousElementSibling;

        // To see if we should move up, compare the Y position to the center of the combination
        // of the element and the element above it.  Only drag around other saved entries, not
        // to recent entries.
        let entry_rect = entry.getBoundingClientRect();
        if(next_entry && next_entry.classList.contains("saved"))
        {
            let next_rect = next_entry.getBoundingClientRect();
            let y = (entry_rect.top + next_rect.bottom) / 2;
            if(e.clientY > y)
            {
                helpers.edit_recent_search_tag(this.dragging_tag, { action: "down" });
                return;
            }
        }

        // To see if we should move down, compare the Y position to the center of the combination
        // of the element and the element below it.
        if(previous_entry && previous_entry.classList.contains("saved"))
        {
            let previous_rect = previous_entry.getBoundingClientRect();
            let y = (previous_rect.top + entry_rect.bottom) / 2;
            if(e.clientY < y)
            {
                helpers.edit_recent_search_tag(this.dragging_tag, { action: "up" });
                return;
            }
        }
    };

    stop_dragging()
    {
        this.dragging_tag = null;
        window.removeEventListener("pointermove", this.pointermove_drag_handle);
    }

    dropdown_onclick = (e) =>
    {
        let entry = e.target.closest(".entry");

        // Toggle editing:
        let toggle_edit_button = e.target.closest(".toggle-edit-button");
        if(toggle_edit_button)
        {
            e.stopPropagation();
            e.preventDefault();

            let old_top = toggle_edit_button.getBoundingClientRect().top;

            this.set_editing(!this.editing);

            // Toggling editing will change layout.  Try to scroll the list so the editing button
            // that was just clicked stays in the same place.
            let new_top = toggle_edit_button.getBoundingClientRect().top;
            let move_by = new_top - old_top;
            this.input_dropdown.scrollTop += move_by;
            return;
        }

        let tag_button = e.target.closest("a[data-tag]");
        if(tag_button)
        {
            if(this.editing)
            {
                // Don't navigate on click while we're editing tags.  Note that the anchor is around
                // the buttons, so this may be a click on an editor button too.
                e.stopPropagation();
                e.preventDefault();
            }
            else
            {
                // When a tag link is clicked, hide and also unfocus the input box so clicking it will
                // reopen us.
                this.input_element.blur();
                this.hide();
                return;
            }
        }

        if(this.editing)
        {
            let save_search = e.target.closest(".save-search");
            if(save_search)
            {
                e.stopPropagation();
                e.preventDefault();

                // If we're moving a tag from recents to saved, put it at the end.  If we're saving
                // from autocomplete put it at the beginning.  This just makes it more likely that
                // the added tag will be visible, so the user can see what happened, without having
                // to scroll the list (he might be adding several so that could be annoying).
                let add_to_end = entry.classList.contains("recent");
                helpers.add_recent_search_tag(entry.dataset.tag, {type: "saved", add_to_end});
            }

            let remove_entry = e.target.closest(".remove-history-entry");
            if(remove_entry != null)
            {
                // Clicked X to remove a tag from history.
                e.stopPropagation();
                e.preventDefault();
                let tag = entry.dataset.tag;

                helpers.edit_recent_search_tag(tag, { action: "remove" });
                return;
            }
        }
    }

    input_onkeydown = (e) =>
    {
        // Only handle inputs when we're open.
        if(this.container.hidden)
            return;

        switch(e.code)
        {
        case "ArrowUp":
        case "ArrowDown":
            e.preventDefault();
            e.stopImmediatePropagation();
            this.move(e.code == "ArrowDown");
            break;
        }
        
    }

    input_oninput = (e) =>
    {
        if(this.container.hidden)
            return;
        
        // Clear the selection on input.
        this.set_selection(null);

        // Update autocomplete when the text changes.
        this.run_autocomplete();
    }

    async show()
    {
        if(this.visible)
            return;
        this.visible = true;

        // Fill in the dropdown before displaying it.  If hide() is called before this
        // finishes this will return false, so stop.
        if(!await this.populate_dropdown())
            return;

        this.container.hidden = false;

        helpers.set_max_height(this.input_dropdown);
    }

    hide()
    {
        if(!this.visible)
            return;
        this.visible = false;

        // If populate_dropdown is still running, cancel it.
        this.cancel_populate_dropdown();

        this.set_editing(false);
        this.stop_dragging();
        this.container.hidden = true;
    }

    async run_autocomplete()
    {
        // If true, this is a value change caused by keyboard navigation.  Don't run autocomplete,
        // since we don't want to change the dropdown due to navigating in it.
        if(this.navigating)
            return;
        
        var tags = this.input_element.value.trim();

        // Stop if we're already up to date.
        if(this.most_recent_search == tags)
            return;

        if(this.abort_autocomplete != null)
        {
            // If an autocomplete request is already running, let it finish before we
            // start another.  This matches the behavior of Pixiv's input forms.
            console.log("Delaying search for", tags);
            return;
        }

        this.most_recent_search = tags;

        // Don't send requests with an empty string.  Just finish the search synchronously,
        // so we clear the autocomplete immediately.  Also, don't send requests if the search
        // string contains spaces, since the autocomplete API is only for single words.
        if(tags == "" || tags.indexOf(" ") != -1)
        {
            if(this.abort_autocomplete != null)
                this.abort_autocomplete.abort();
            this.autocomplete_request_finished("", { candidates: [] });
            return;
        }

        // Run the search.
        let result = null;
        try {
            this.abort_autocomplete = new AbortController();
            result = await helpers.rpc_get_request("/rpc/cps.php", {
                keyword: tags,
            }, {
                signal: this.abort_autocomplete.signal,
            });
        } catch(e) {
            console.info("Tag autocomplete error:", e);
            return;
        } finally {
            this.abort_autocomplete = null;
        }

        // If result is null, we were probably aborted.
        if(result == null)
            return;

        this.autocomplete_request_finished(tags, result);
    }
    
    // A tag autocomplete request finished.
    autocomplete_request_finished(tags, result)
    {
        this.abort_autocomplete = null;

        // We don't register translations from this API, since it only seems to return
        // romaji and not actual translations.
        let translations = { };
        for(let tag of result.candidates)
        {
            translations[tag.tag_name] = {
                en: tag.tag_translation
            };
        }
        // tag_translations.get().add_translations_dict(translations);

        // Store the new results.
        this.current_autocomplete_results = result.candidates || [];

        // Refresh the dropdown with the new results.
        this.populate_dropdown();

        // If the input element's value has changed since we started this search, we
        // stalled any other autocompletion.  Start it now.
        if(tags != this.input_element.value)
        {
            console.log("Run delayed autocomplete");
            this.run_autocomplete();
        }
    }

    // tag_search is a search, like "tag -tag2".  translated_tags is a dictionary of known translations.
    create_entry(tag_search, translated_tags)
    {
        let entry = this.create_template({name: "tag-dropdown-entry", html: `
            <a class=entry href=#>
                <div class="edit-button drag-handle" data-shown-in="saved">
                    ${ helpers.create_icon("mat:drag_handle") }
                </div>

                <div class="edit-button save-search" data-shown-in="recent autocomplete">
                    ${ helpers.create_icon("mat:push_pin") }
                </div>

                <span class=search></span>

                <span class="edit-button remove-history-entry" data-shown-in="recent saved">X</span>
            </a>
        `});
        entry.dataset.tag = tag_search;

        let translated_tag = translated_tags[tag_search];
        if(translated_tag)
            entry.dataset.translated_tag = translated_tag;

        let tag_container = entry.querySelector(".search");
        for(let tag of helpers.split_search_tags(tag_search))
        {
            if(tag == "")
                continue;

            // Force "or" lowercase.
            if(tag.toLowerCase() == "or")
                tag = "or";

            let span = document.createElement("span");
            span.dataset.tag = tag;
            span.classList.add("word");
            if(tag == "or")
                span.classList.add("or");
            else
                span.classList.add("tag");

            // Split off - prefixes to look up the translation, then add it back.
            let prefix_and_tag = helpers.split_tag_prefixes(tag);
            let translated_tag = translated_tags[prefix_and_tag[1]];
            if(translated_tag)
                translated_tag = prefix_and_tag[0] + translated_tag;

            span.innerText = translated_tag || tag;
            if(translated_tag)
                span.dataset.translated_tag = translated_tag;

            tag_container.appendChild(span);
        }

        var url = ppixiv.helpers.get_args_for_tag_search(tag_search, ppixiv.plocation);
        entry.href = url;

        // If making a URL for this search from the current URL doesn't change anything, it's the
        // search we're currently on.  This always removes the language from the URL, so remove
        // it to compare.
        if(helpers.get_url_without_language(ppixiv.plocation).toString() == url.toString())
            entry.classList.add("selected");

        return entry;
    }

    set_selection(idx)
    {
        // Temporarily set this.navigating to true.  This lets run_autocomplete know that
        // it shouldn't run an autocomplete request for this value change.
        this.navigating = true;
        try {
            // If there's an autocomplete request in the air and we're selecting a value, cancel it.
            if(idx != null && this.abort_autocomplete != null)
                this.abort_autocomplete.abort();

            // Clear any old selection.
            var all_entries = this.container.querySelectorAll(".input-dropdown-list .entry");
            if(this.selected_idx != null)
                all_entries[this.selected_idx].classList.remove("selected");

            // Set the new selection.
            this.selected_idx = idx;
            if(this.selected_idx != null)
            {
                var new_entry = all_entries[this.selected_idx];
                new_entry.classList.add("selected");
                new_entry.scrollIntoViewIfNeeded();
                this.input_element.value = new_entry.dataset.tag;
            }
        } finally {
            this.navigating = false;
        }
    }

    // Select the next or previous entry in the dropdown.
    move(down)
    {
        var all_entries = this.container.querySelectorAll(".input-dropdown-list .entry");

        // Stop if there's nothing in the list.
        var total_entries = all_entries.length;
        if(total_entries == 0)
            return;

        var idx = this.selected_idx;
        if(idx == null)
            idx = down? 0:(total_entries-1);
        else
            idx += down? +1:-1;
        idx = (idx + total_entries) % total_entries;

        this.set_selection(idx);
    }

    // Populate the tag dropdown.
    //
    // This is async, since IndexedDB is async.  (It shouldn't be.  It's an overcorrection.
    // Network APIs should be async, but local I/O should not be forced async.)  If another
    // call to populate_dropdown() is made before this completes or cancel_populate_dropdown
    // cancels it, return false.  If it completes, return true.
    populate_dropdown = async() =>
    {
        // If another populate_dropdown is already running, cancel it and restart.
        this.cancel_populate_dropdown();

        // Set populate_dropdown_abort to an AbortController for this call.
        let abort_controller = this.populate_dropdown_abort = new AbortController();        
        let abort_signal = abort_controller.signal;

        let autocompleted_tags = this.current_autocomplete_results;

        let recent_tags = helpers.get_recent_tag_searches("recent");
        let saved_tags = helpers.get_recent_tag_searches("saved");

        // Separate tags in each search, so we can look up translations.
        var all_tags = {};
        for(let tag_search of [...recent_tags, ...saved_tags])
        {
            for(let tag of helpers.split_search_tags(tag_search))
            {
                tag = helpers.split_tag_prefixes(tag)[1];
                all_tags[tag] = true;
            }
        }

        for(let tag of autocompleted_tags)
            all_tags[tag.tag_name] = true;

        all_tags = Object.keys(all_tags);
    
        // Get tag translations.
        //
        // Don't do this if we're updating the list during a drag.  The translations will never change
        // since we're just reordering the list, and we need to avoid going async to make sure we update
        // the list immediately since the drag will get confused if it isn't.
        if(this.dragging_tag == null)
            this.translated_tags = await tag_translations.get().get_translations(all_tags, "en");

        // Check if we were aborted while we were loading tags.
        if(abort_signal && abort_signal.aborted)
        {
            console.log("populate_dropdown_inner aborted");
            return false;
        }
        
        var list = this.container.querySelector(".input-dropdown-list");
        helpers.remove_elements(list);
        this.selected_idx = null;

        if(autocompleted_tags.length)
            list.appendChild(this.create_separator("Suggestions", "mat:assistant"));

        for(var tag of autocompleted_tags)
        {
            var entry = this.create_entry(tag.tag_name, this.translated_tags);
            entry.classList.add("autocomplete"); 
            list.appendChild(entry);
        }

        if(saved_tags.length)
            list.appendChild(this.create_separator("Saved tags", "mat:star"));

        // Show saved tags above recent tags.
        for(let tag of saved_tags)
        {
            var entry = this.create_entry(tag, this.translated_tags);
            entry.classList.add("history");
            entry.classList.add("saved");
            list.appendChild(entry);
        }

        if(recent_tags.length)
            list.appendChild(this.create_separator("Recent tags", "mat:history"));

        for(let tag of recent_tags)
        {
            var entry = this.create_entry(tag, this.translated_tags);
            entry.classList.add("history");
            entry.classList.add("recent");
            list.appendChild(entry);
        }

        return true;
    }

    create_separator(label, icon)
    {
        return this.create_template({html: `
            <div class="tag-dropdown-separator">
                ${ helpers.create_icon(icon) }
                <span>${label}</span>
                <span style="flex: 1;"></span>
                <div class=toggle-edit-button>${ helpers.create_icon("mat:edit") }</div>
            </div>
        `});
    }

    cancel_populate_dropdown()
    {
        if(this.populate_dropdown_abort == null)
            return;

        this.populate_dropdown_abort.abort();
    }
}
