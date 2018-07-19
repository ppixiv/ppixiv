// This handles the dropdown for an <input> showing recent searches and autocompletion.
// The dropdown will be placed as a sibling of the input, and the parent of both nodes
// should be a position: relative so we can position the dropdown correctly.
class tag_search_dropdown_widget
{
    constructor(input_element)
    {
        console.log("...");
        this.dropdown_onclick = this.dropdown_onclick.bind(this);
        this.input_onfocus = this.input_onfocus.bind(this);
        this.input_onblur = this.input_onblur.bind(this);
        this.input_onkeydown = this.input_onkeydown.bind(this);
        this.input_oninput = this.input_oninput.bind(this);
        this.autocomplete_request_finished = this.autocomplete_request_finished.bind(this);
        this.parent_onmouseenter = this.parent_onmouseenter.bind(this);
        this.parent_onmouseleave = this.parent_onmouseleave.bind(this);
        this.populate_dropdown = this.populate_dropdown.bind(this);

        this.input_element = input_element;
        this.parent_node = input_element.parentNode;

        this.input_element.addEventListener("focus", this.input_onfocus);
        this.input_element.addEventListener("blur", this.input_onblur);
        this.input_element.addEventListener("keydown", this.input_onkeydown);
        this.input_element.addEventListener("input", this.input_oninput);
        this.parent_node.addEventListener("mouseenter", this.parent_onmouseenter);
        this.parent_node.addEventListener("mouseleave", this.parent_onmouseleave);

        // Refresh the dropdown when the tag search history changes.
        window.addEventListener("recent-tag-searches-changed", this.populate_dropdown);

        // Add the dropdown widget to the input's parent.
        this.tag_dropdown = helpers.create_from_template(".template-tag-dropdown");
        this.tag_dropdown.addEventListener("click", this.dropdown_onclick);
        this.parent_node.appendChild(this.tag_dropdown);

        this.current_autocomplete_results = [];

        this.hide();
        this.populate_dropdown();
    }

    dropdown_onclick(e)
    {
        var remove_entry = e.target.closest(".remove-history-entry");
        if(remove_entry != null)
        {
            // Clicked X to remove a tag from history.
            e.stopPropagation();
            e.preventDefault();
            var tag = e.target.closest(".entry").dataset.tag;
            helpers.remove_recent_search_tag(tag);
            return;
        }
    }

    // Show the dropdown when the input is focused.  Hide it when the input is both
    // unfocused and this.parent_node isn't being hovered.  This way, the input focus
    // can leave the input box to manipulate the dropdown without it being hidden,
    // but we don't rely on hovering to keep the dropdown open.
    input_onfocus(e)
    {
        this.input_focused = true;
        this.show();
    }

    input_onblur(e)
    {
        this.input_focused = false;
        if(!this.input_focused && !this.mouse_over_parent)
            this.hide();
    }

    parent_onmouseenter(e)
    {
        this.mouse_over_parent = true;
    }
    parent_onmouseleave(e)
    {
        this.mouse_over_parent = false;
        if(!this.input_focused && !this.mouse_over_parent)
            this.hide();
    }

    input_onkeydown(e)
    {
        switch(e.keyCode)
        {
        case 38: // up arrow
        case 40: // down arrow
            e.preventDefault();
            e.stopImmediatePropagation();
            this.move(e.keyCode == 40);
            break;
        }
        
    }

    input_oninput(e)
    {
        // Clear the selection on input.
        this.set_selection(null);

        // Update autocomplete when the text changes.
        this.run_autocomplete();
    }

    show()
    {
        this.tag_dropdown.hidden = false;
    }

    hide()
    {
        this.tag_dropdown.hidden = true;
    }

    run_autocomplete()
    {
        // If true, this is a value change caused by keyboard navigation.  Don't run autocomplete,
        // since we don't want to change the dropdown due to navigating in it.
        if(this.navigating)
            return;
        
        var tags = this.input_element.value.trim();

        // Stop if we're already up to date.
        if(this.most_recent_search == tags)
            return;

        if(this.autocomplete_request != null)
        {
            // If an autocomplete request is already running, let it finish before we
            // start another.  This matches the behavior of Pixiv's input forms.
            console.log("Delaying search for", tags);
            return;
        }

        if(tags == "")
        {
            // Don't send requests with an empty string.  Just finish the search synchronously,
            // so we clear the autocomplete immediately.
            this.cancel_autocomplete_request();
            this.autocomplete_request_finished("", { candidates: [] });
            return;
        }

        // Run the search.
        this.autocomplete_request = helpers.rpc_get_request("/rpc/cps.php", {
            keyword: tags,
        }, this.autocomplete_request_finished.bind(this, tags));
    }
    
    cancel_autocomplete_request()
    {
        if(this.autocomplete_request == null)
            return;

        this.autocomplete_request.abort();
        this.autocomplete_request = null;
    }

    // A tag autocomplete request finished.
    autocomplete_request_finished(tags, result)
    {
        this.most_recent_search = tags;
        this.autocomplete_request = null;

        // Store the new results.
        this.current_autocomplete_results = result.candidates || [];
        console.log(result.candidates);

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
    
    create_entry(tag)
    {
        var entry = helpers.create_from_template(".template-tag-dropdown-entry");
        entry.dataset.tag = tag;
        entry.querySelector(".tag").innerText = tag;

        var url = page_manager.singleton().get_url_for_tag_search(tag);
        entry.querySelector("A.tag").href = url;
        return entry;
    }

    set_selection(idx)
    {
        // Temporarily set this.navigating to true.  This lets run_autocomplete know that
        // it shouldn't run an autocomplete request for this value change.
        this.navigating = true;
        try {
            // If there's an autocomplete request in the air, cancel it.
            this.cancel_autocomplete_request();

            // Clear any old selection.
            var all_entries = this.tag_dropdown.querySelectorAll(".input-dropdown-list .entry");
            if(this.selected_idx != null)
                all_entries[this.selected_idx].classList.remove("selected");

            // Set the new selection.
            this.selected_idx = idx;
            if(this.selected_idx != null)
            {
                var new_entry = all_entries[this.selected_idx];
                new_entry.classList.add("selected");
                this.input_element.value = new_entry.dataset.tag;
            }
        } finally {
            this.navigating = false;
        }
    }

    // Select the next or previous entry in the dropdown.
    move(down)
    {
        console.log("move down", down);

        var all_entries = this.tag_dropdown.querySelectorAll(".input-dropdown-list .entry");
        console.log(all_entries);

        // Stop if there's nothing in the list.
        var total_entries = all_entries.length;
        if(total_entries == 0)
            return;

        var idx = this.selected_idx;
        if(idx == null)
            idx = down? 0:(total_entries-1);
        else
            idx += down? +1:-1;
        idx %= total_entries;

        this.set_selection(idx);
    }

    populate_dropdown()
    {
        var list = this.tag_dropdown.querySelector(".input-dropdown-list");
        helpers.remove_elements(list);

        var tags = GM_getValue("recent-tag-searches") || [];
        var autocompleted_tags = this.current_autocomplete_results;
        
        for(var tag of autocompleted_tags)
        {
            var entry = this.create_entry(tag.tag_name);
            entry.classList.add("autocomplete");
            list.appendChild(entry);
        }

        for(var tag of tags)
        {
            var entry = this.create_entry(tag);
            entry.classList.add("history");
            list.appendChild(entry);
        }
    }
}

