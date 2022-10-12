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
        super({...options, visible: false, template: `
            <div class=search-history>
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

        // Sometimes the popup closes when searches are clicked and sometimes they're not.  Make sure
        // we always close on navigation.
        this.container.addEventListener("click", (e) => {
            if(e.defaultPrevented)
                return;
            let a = e.target.closest("A");
            if(a == null)
                return;

            this.input_element.blur();
            this.hide();
        });
    }

    dropdown_onclick = (e) =>
    {
        let remove_entry = e.target.closest(".remove-history-entry");
        let move_to_bottom = e.target.closest(".move-to-bottom");
        if(remove_entry != null || move_to_bottom != null)
        {
            // Clicked X to remove a tag from history.
            e.stopPropagation();
            e.preventDefault();
            var tag = e.target.closest(".entry").dataset.tag;

            let action = move_to_bottom? "bottom":"remove";
            helpers.edit_recent_search_tag(tag, { action });

            // Hack: the input focus will have been on the tag entry we just removed.  Focus
            // the nearest focusable item (probably the tag_search_box_widget container), so
            // the dropdown isn't closed due to losing focus.
            this.container.closest("[tabindex]").focus();
            return;
        }

        // Close the dropdown if the user clicks a tag (but not when clicking
        // remove-history-entry).
        if(e.target.closest(".tag"))
            this.hide();
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
                <div class=suggestion-icon>
                    <ppixiv-inline src="resources/search-result-icon.svg"></ppixiv-inline>
                </div>
                
                <span class=search></span>
                <span class="move-to-bottom right-side-button keep-menu-open">${ helpers.create_icon("mat:south") }</span>
                <span class="remove-history-entry right-side-button">X</span>
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

        let tag_searches = settings.get("recent-tag-searches") || [];
        let autocompleted_tags = this.current_autocomplete_results;

        // Separate tags in each search, so we can look up translations.
        //
        var all_tags = {};
        for(let tag_search of tag_searches)
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
        
        let translated_tags = await tag_translations.get().get_translations(all_tags, "en");

        // Check if we were aborted while we were loading tags.
        if(abort_signal && abort_signal.aborted)
        {
            console.log("populate_dropdown_inner aborted");
            return false;
        }
        
        var list = this.container.querySelector(".input-dropdown-list");
        helpers.remove_elements(list);
        this.selected_idx = null;

        for(var tag of autocompleted_tags)
        {
            var entry = this.create_entry(tag.tag_name, translated_tags);
            entry.classList.add("autocomplete"); 
            list.appendChild(entry);
        }

        for(var tag of tag_searches)
        {
            var entry = this.create_entry(tag, translated_tags);
            entry.classList.add("history");
            list.appendChild(entry);
        }

        return true;
    }

    cancel_populate_dropdown()
    {
        if(this.populate_dropdown_abort == null)
            return;

        this.populate_dropdown_abort.abort();
    }
}

ppixiv.tag_search_edit_widget = class extends ppixiv.widget
{
    constructor({input_element, ...options})
    {
        super({...options, visible: false, template: `
            <div class=edit-search>
                <div class=input-dropdown>
                    <div class="edit-tags-list">
                        <!-- template-edit-search-dropdown-entry instances will be added here. -->
                    </div>
                </div>
            </div>
        `});

        this.input_element = input_element.querySelector("input");

        // Refresh the dropdown when the tag search history changes.
        window.addEventListener("recent-tag-searches-changed", this.populate_dropdown);

        this.container.addEventListener("click", this.dropdown_onclick);

        // Refresh tags if the user edits the search directly.
        this.input_element.addEventListener("input", (e) => { this.refresh_highlighted_tags(); });

        // input-dropdown is resizable.  Save the size when the user drags it.
        this.input_dropdown = this.container.querySelector(".input-dropdown");
        let observer = new MutationObserver((mutations) => {
            // resize sets the width.  Use this instead of offsetWidth, since offsetWidth sometimes reads
            // as 0 here.
            settings.set("search-edit-dropdown-width", this.input_dropdown.style.width);
        });
        observer.observe(this.input_dropdown, { attributes: true });

        // Restore input-dropdown's width.  Force a minimum width, in case this setting is saved incorrectly.
        this.input_dropdown.style.width = settings.get("search-edit-dropdown-width", "400px");
    }

    dropdown_onclick = (e) =>
    {
        e.preventDefault();
        e.stopImmediatePropagation();

        // Clicking tags toggles the tag in the search box.
        let entry = e.target.closest(".entry");
        if(entry == null)
            return;

        this.toggle_tag(entry.dataset.tag);

        // Control-clicking the tag probably caused its enclosing search link to be focused, which will
        // cause it to activate when enter is pressed.  Switch focus to the input box, so pressing enter
        // will submit the search.
        this.input_element.focus();
    }

    async show()
    {
        if(this.visible)
            return;

        // Fill in the dropdown before displaying it.  If hide() is called before this
        // finishes this will return false, so stop.
        if(!await this.populate_dropdown())
            return;

        this.visible = true;

        helpers.set_max_height(this.input_dropdown);
    }

    hide()
    {
        if(!this.visible)
            return;
        this.visible = false;

        // If populate_dropdown is still running, cancel it.
        this.cancel_populate_dropdown();
    }

    visibility_changed()
    {
        super.visibility_changed();

        // Disable adding searches to search history while the edit dropdown is open.  Otherwise,
        // every time a tag is toggled, that combination of tags is added to search history by
        // data_source_search, which makes a mess.
        helpers.disable_adding_search_tags(this.visible);
    }

    // tag_search is a search, like "tag -tag2".  translated_tags is a dictionary of known translations.
    create_entry(tag, translated_tags)
    {
        let entry = this.create_template({name: "dropdown-entry", html: `
            <a class=entry>
            </a>
        `});
        entry.dataset.tag = tag;

        let translated_tag = translated_tags[tag];
        if(translated_tag)
            entry.dataset.translated_tag = translated_tag;

        entry.innerText = translated_tag || tag;
        entry.href = ppixiv.helpers.get_args_for_tag_search(tag, ppixiv.plocation);
        return entry;
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

        var tag_searches = settings.get("recent-tag-searches") || [];

        // Individually show all tags in search history.
        var all_tags = {};
        for(let tag_search of tag_searches)
        {
            for(let tag of helpers.split_search_tags(tag_search))
            {
                tag = helpers.split_tag_prefixes(tag)[1];

                // Ignore "or".
                if(tag == "" || tag == "or")
                    continue;

                all_tags[tag] = true;
            }
        }
        all_tags = Object.keys(all_tags);
        
        let translated_tags = await tag_translations.get().get_translations(all_tags, "en");

        // Sort tags by their translation.
        all_tags.sort((lhs, rhs) => {
            if(translated_tags[lhs]) lhs = translated_tags[lhs];
            if(translated_tags[rhs]) rhs = translated_tags[rhs];
            return lhs.localeCompare(rhs);
        });

        // Check if we were aborted while we were loading tags.
        if(abort_signal && abort_signal.aborted)
        {
            console.log("populate_dropdown_inner aborted");
            return false;
        }
        
        let list = this.container.querySelector(".edit-tags-list");
        helpers.remove_elements(list);

        for(var tag of all_tags)
        {
            var entry = this.create_entry(tag, translated_tags);
            list.appendChild(entry);
        }

        this.refresh_highlighted_tags();

        return true;
    }

    cancel_populate_dropdown()
    {
        if(this.populate_dropdown_abort == null)
            return;

        this.populate_dropdown_abort.abort();
    }

    refresh_highlighted_tags()
    {
        let tags = helpers.split_search_tags(this.input_element.value);
        
        let list = this.container.querySelector(".edit-tags-list");
        for(let tag_entry of list.querySelectorAll("[data-tag]"))
        {
            let tag = tag_entry.dataset.tag;
            let tag_selected = tags.indexOf(tag) != -1;
            helpers.set_class(tag_entry, "highlight", tag_selected);
        }
    }

    // Add or remove tag from the tag search.  This doesn't affect -tag searches.
    toggle_tag(tag)
    {
        console.log("Toggle tag:", tag);

        let tags = helpers.split_search_tags(this.input_element.value);
        let idx = tags.indexOf(tag);
        if(idx != -1)
            tags.splice(idx, 1);
        else
            tags.push(tag);
        this.input_element.value = tags.join(" ");

        this.refresh_highlighted_tags();

        // Navigate to the edited search immediately.  Don't add these to history, since it
        // spams navigation history.
        let args = ppixiv.helpers.get_args_for_tag_search(this.input_element.value, ppixiv.plocation);
        helpers.navigate(args, { add_to_history: false });
    }
}

