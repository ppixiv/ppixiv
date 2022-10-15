
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
        saved_search_tags.disable_adding_search_tags(this.visible);
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
            // Ignore the separator between recent and saved tags.
            if(tag_search == null)
                continue;

            // Ignore sections.
            if(tag_search instanceof Object)
                continue;

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
