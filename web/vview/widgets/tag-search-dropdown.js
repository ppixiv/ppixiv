import widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/ppixiv-imports.js';
import SavedSearchTags from 'vview/misc/saved-search-tags.js';

// Handle showing the search history and tag edit dropdowns.
export class TagSearchBoxWidget extends widget
{
    constructor({...options})
    {
        super({...options, template: `
            <div class="search-box tag-search-box">
                <div class="input-field-container hover-menu-box">
                    <input placeholder=Tags size=1 autocorrect=off>

                    <span class="edit-search-button right-side-button">
                        ${ helpers.create_icon("mat:edit") }
                    </span>

                    <span class="search-submit-button right-side-button">
                        ${ helpers.create_icon("search") }
                    </span>
                </div>
            </div>
        `});

        this.input_element = this.container.querySelector(".input-field-container > input");

        this.querySelector(".edit-search-button").addEventListener("click", (e) => {
            this.dropdown_opener.visible = true;
            this.dropdown_opener.box_widget.editing = !this.dropdown_opener.box_widget.editing;
        });

        this.dropdown_opener = new ppixiv.dropdown_box_opener({
            button: this.input_element,

            create_box: ({...options}) => {
                let dropdown = new TagSearchDropdownWidget({
                    input_element: this.container,
                    parent: this,
                    saved_position: this.saved_dropdown_position,
                    ...options,
                });

                // Save the scroll position when the dropdown closes, so we can restore it the
                // next time we open it.
                dropdown.shutdown_signal.signal.addEventListener("abort", () => {
                    this.saved_dropdown_position = dropdown.save_search_position();
                });
                return dropdown;
            },

            close_for_click: (e) => {
                // Ignore clicks while we're showing a dialog.
                if(this.showing_dialog)
                    return false;

                // Ignore clicks inside our container.
                if(helpers.is_above(this.container, e.target))
                    return false;

                return true;
            },
        });

        // Show the dropdown when the input box is focused.
        this.input_element.addEventListener("focus", () => this.dropdown_opener.visible = true, true);

        // Search submission:
        helpers.input_handler(this.input_element, this.submit_search);
        this.container.querySelector(".search-submit-button").addEventListener("click", this.submit_search);
    }

    // Hide the dropdowns if our tree becomes hidden.
    on_visible_recursively_changed()
    {
        super.on_visible_recursively_changed();

        if(!this.visible_recursively)
            this.dropdown_opener.visible = false;
    }

    // Run a text prompt.
    //
    // We need to keep ourself from closing when the prompt takes our focus temporarily, and restore
    // our focus when it's finished.
    async dialog(promise)
    {
        this.showing_dialog = true;
        try {
            return await promise;
        } finally {
            this.input_element.focus();
            this.showing_dialog = false;
        }
    }

    text_prompt(options)
    {
        return this.dialog(text_prompt.prompt(options));
    }

    confirm_prompt(options)
    {
        return this.dialog(confirm_prompt.prompt(options));
    }

    submit_search = (e) =>
    {
        // This can be sent to either the search page search box or the one in the
        // navigation dropdown.  Figure out which one we're on.
        var tags = this.input_element.value.trim();
        if(tags.length == 0)
            return;

        // Add this tag to the recent search list.
        SavedSearchTags.add(tags);

        // If we're submitting by pressing enter on an input element, unfocus it and
        // close any widgets inside it (tag dropdowns).
        if(e.target instanceof HTMLInputElement)
        {
            e.target.blur();
            this.dropdown_opener.visible = false;
        }
        
        // Run the search.
        let args = ppixiv.helpers.get_args_for_tag_search(tags, ppixiv.plocation);
        helpers.navigate(args);
    }
}

class TagSearchDropdownWidget extends widget
{
    constructor({input_element, saved_position, ...options})
    {
        super({...options, template: `
            <div class="search-history input-dropdown" tabindex=1>
                <div class=input-dropdown-list>
                    <div class="tag-section create-section-button editing-only">
                        <div class="edit-button">
                            ${ helpers.create_icon("mat:create_new_folder") }
                        </div>
                        <div class=label>Add section</div>
                    </div>

                    <!-- template-tag-dropdown-entry instances will be added here. -->
                    <vv-container class=contents></vv-container>
                </div>
            </div>
        `});

        this.autocomplete_cache = new Map();
        this.disable_autocomplete_until = 0;
        this.saved_position = saved_position;

        // Find the <input>.
        this.input_element = input_element.querySelector("input");

        this.input_element.addEventListener("keydown", this.input_onkeydown);
        this.input_element.addEventListener("input", this.input_oninput);
        document.addEventListener("selectionchange", this.input_selectionchange, { signal: this.shutdown_signal.signal });

        // Refresh the dropdown when the tag search history changes.
        window.addEventListener("recent-tag-searches-changed", this.populate_dropdown, { signal: this.shutdown_signal.signal });

        // Update the selection if the page is navigated while we're open.
        window.addEventListener("pp:popstate", this.select_current_search, { signal: this.shutdown_signal.signal });

        this.container.addEventListener("click", this.dropdown_onclick);

        this.current_autocomplete_results = [];

        // input-dropdown is resizable.  Save the size when the user drags it.
        this.all_results = this.container;
        this.input_dropdown = this.container.querySelector(".input-dropdown-list");
        this.input_dropdown_contents = this.input_dropdown.querySelector(".contents");
        let observer = new MutationObserver((mutations) => {
            // resize sets the width.  Use this instead of offsetWidth, since offsetWidth sometimes reads
            // as 0 here.
            let width = parseInt(this.container.style.width);
            if(isNaN(width))
                width = 600;
            ppixiv.settings.set("tag-dropdown-width", width);
        });
        observer.observe(this.container, { attributes: true });

        // Restore input-dropdown's width.
        this.input_dropdown.style.width = ppixiv.settings.get("tag-dropdown-width", "400px");

        // tag-dropdown-width may have "px" baked into it.  Use parseInt to remove it.
        let width = ppixiv.settings.get("tag-dropdown-width", "400");
        width = parseInt(width);

        this.container.style.setProperty('--width', `${width}px`);

        this.pointer_listener = new ppixiv.pointer_listener({
            element: this.container,
            callback: this.pointerevent,
        });

        this.editing = false;

        this._load();
    }
    
    get editing() { return this._editing; }

    set editing(value)
    {
        if(this._editing == value)
            return;

        this._editing = value;
        helpers.set_class(this.container, "editing", this._editing);
        helpers.set_class(this.container.querySelector(".input-dropdown-list"), "editing", this._editing);
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
        return null;
    }

    pointermove_drag_handle = (e) =>
    {
        // Scan backwards or forwards to find the next valid place where entry can be placed
        // after.
        // Find the next and previous entry that we can drag to.
        function find_sibling(entry, next)
        {
            let sibling = entry;
            while(sibling)
            {
                if(next)
                    sibling = sibling.nextElementSibling;
                else
                    sibling = sibling.previousElementSibling;

                if(sibling == null)
                    return null;

                // If this is an uncollapsed tag or group, return it.
                if(!sibling.classList.contains("collapsed"))
                    return sibling;
            }
            return null;
        }

        let entry = this.find_tag_entry(this.dragging_tag);

        // Check downwards first, then upwards.
        let entry_rect = entry.getBoundingClientRect();
        for(let down = 0; down <= 1; down++)
        {
            let entry_to_check = find_sibling(entry, down == 1);
            if(entry_to_check == null)
                continue;

            if(!entry_to_check.classList.contains("saved") && !entry_to_check.classList.contains("tag-section"))
                continue;

            // When moving up, find the next entry where the entry above it is uncollapsed.
            // For tags this is always true (visible tags are always inside a visible group),
            // but if we're dragging above a group header, this makes sure we drag into an
            // uncollapsed group.
            //
            // To see if we should move up, compare the Y position to the center of the combination
            // of the element and the element above it.  threshold is how far over the boundary
            // we need to go before moving.
            let neighbor_rect = entry_to_check.getBoundingClientRect();
            let threshold = 5;
            if(down)
            {
                let y = (neighbor_rect.bottom + entry_rect.top) / 2;
                if(e.clientY - threshold < y)
                    continue;
            }
            else
            {
                let y = (entry_rect.bottom + neighbor_rect.top) / 2;
                if(e.clientY + threshold > y)
                    continue;
            }

            // We want to drag in this direction.  If we're dragging downwards, we'll place the item
            // after entry_to_check.  If we're dragging upwards, find the next uncollapsed entry before
            // it to place it after.
            let entry_to_place_after = entry_to_check;
            if(!down)
                entry_to_place_after = find_sibling(entry_to_check, false);
            if(entry_to_place_after == null)
                continue;

            // Find its index in the list.
            let move_after_idx = -1;
            if(entry_to_place_after.group_name)
                move_after_idx = SavedSearchTags.find_index({group: entry_to_place_after.group_name});
            else if(entry_to_place_after.dataset.tag)
                move_after_idx = SavedSearchTags.find_index({tag: entry_to_place_after.dataset.tag});

            if(move_after_idx != -1)
            {
                // Move the tag after move_after_idx.
                SavedSearchTags.move(this.dragging_tag, move_after_idx+1);
                return;
            }
        }
    };

    stop_dragging()
    {
        this.dragging_tag = null;
        window.removeEventListener("pointermove", this.pointermove_drag_handle);
    }

    // Return the tag-section for the given group.
    //
    // We could do this with querySelector, but we'd need to escape the string.
    get_section_header_for_group(group)
    {
        for(let tag_section of this.container.querySelectorAll(".tag-section"))
        {
            if(tag_section.group_name == group)
                return tag_section;
        }
        return null;
    }

    get_entry_for_tag(tag, { include_autocomplete=false }={})
    {
        tag = tag.trim();
        
        for(let entry of this.container.querySelectorAll(".entry"))
        {
            if(!include_autocomplete && entry.classList.contains("autocomplete"))
                continue;
            if(entry.dataset.tag.trim() == tag)
                return entry;
        }
        return null;
    }

    dropdown_onclick = async(e) =>
    {
        let entry = e.target.closest(".entry");
        let tag_section = e.target.closest(".tag-section");

        let create_section_button = e.target.closest(".create-section-button");
        if(create_section_button)
        {
            e.stopPropagation();
            e.preventDefault();

            let label = await this.parent.text_prompt({ title: "Group name:" });
            if(label == null)
                return; // cancelled
            
            // Group names identify the group, so don't allow adding a group that already exists.
            // SavedSearchTags.add won't allow this, but check so we can tell the user.
            let tag_groups = new Set(SavedSearchTags.get_all_groups().keys());
            if(tag_groups.has(label))
            {
                message_widget.singleton.show(`Group "${label}" already exists`);
                return;
            }

            // Add the group.
            SavedSearchTags.add(null, { group: label });

            // The edit will update automatically, but that happens async and may not have
            // completed yet.  Force an update now so we can scroll the new group into view.
            await this.populate_dropdown();
            let new_section = this.get_section_header_for_group(label);
            this.scroll_entry_into_view(new_section);
            return;
        }
        
        let tag_button = e.target.closest("a[data-tag]");
        if(tag_button)
        {
            if(this.editing)
            {
                // Don't navigate on click while we're editing tags.  Note that the anchor is around
                // the buttons, so this may be a click on an editor button too.
                // e.stopPropagation();
                e.preventDefault();
            }
            else
            {
                // When a tag link is clicked, hide and also unfocus the input box so clicking it will
                // reopen us.
                this.input_element.blur();
                this.hide();

                // If this is a navigation the input box will be filled automatically, but clicking an
                // entry matching the current search won't navigate.  Fill in the input box with the search
                // even if the click doesn't trigger navigation.
                this.input_element.value = entry.dataset.tag;

                return;
            }
        }

        if(this.editing)
        {
            let move_group_up = e.target.closest(".move-group-up");
            let move_group_down = e.target.closest(".move-group-down");
            if(move_group_up || move_group_down)
            {
                e.stopPropagation();
                e.preventDefault();
                SavedSearchTags.move_group(tag_section.group_name, { down: move_group_down != null });
                return;
            }

            let save_search = e.target.closest(".save-search");
            if(save_search)
            {
                e.stopPropagation();
                e.preventDefault();

                // Figure out which group to put it in.  If there are no groups, this is the first
                // saved search, so create "Saved tags" by default.  If there's just one group, use
                // it.  Otherwise, ask the user.
                //
                // maybe only expand one group at a time
                let tag_groups = new Set(SavedSearchTags.get_all_groups().keys());
                tag_groups.delete(null); // ignore the recents group
                let add_to_group = "Saved tags";
                if(tag_groups.size == 1)
                    add_to_group = Array.from(tag_groups)[0];
                else if(tag_groups.size > 1)
                {
                    // For now, add to the bottommost uncollapsed group.  This is a group which is
                    // closest to recents, where the user should be able to see where the tag he
                    // saved went.
                    let all_groups = new Set(SavedSearchTags.get_all_groups().keys());
                    all_groups.delete(null);

                    let collapsed_groups = SavedSearchTags.get_collapsed_tag_groups();
                    add_to_group = null;
                    for(let group of all_groups)
                    {
                        if(collapsed_groups.has(group))
                            continue;
                        add_to_group = group;
                    }

                    if(add_to_group == null)
                    {
                        // If no groups are uncollapsed, use the last group.  It'll be uncollapsed
                        // below.
                        for(let group of all_groups)
                            add_to_group = group;
                    }
                }

                console.log(`Adding search "${entry.dataset.tag}" to group "${add_to_group}"`);

                // If the group we're adding to is collapsed, uncollapse it.
                if(SavedSearchTags.get_collapsed_tag_groups().has(add_to_group))
                {
                    console.log(`Uncollapsing group ${add_to_group} because we're adding to it`);
                    SavedSearchTags.set_tag_group_collapsed(add_to_group, false);
                }

                // Add or change the tag to a saved tag.
                SavedSearchTags.add(entry.dataset.tag, {group: add_to_group, add_to_end: true});

                // We tried to keep the new tag in view, but scroll it into view if it isn't, such as
                // if we had to expand the group and the scroll position is in the wrong place now.
                await this.populate_dropdown();
                let new_entry = this.get_entry_for_tag(entry.dataset.tag);
                this.scroll_entry_into_view(new_entry);
            }

            let edit_tags = e.target.closest(".edit-tags-button");
            if(edit_tags != null)
            {
                e.stopPropagation();
                e.preventDefault();
                
                // Add a space to the end for convenience with the common case of just wanting to add something
                // to the end.
                let new_tags = await this.parent.text_prompt({ title: "Edit search:", value: entry.dataset.tag + " " });
                if(new_tags == null || new_tags == entry.dataset.tag)
                    return; // cancelled

                new_tags = new_tags.trim();
                SavedSearchTags.modify_tag(entry.dataset.tag, new_tags);                
                return;
            }

            let remove_entry = e.target.closest(".delete-entry");
            if(remove_entry != null)
            {
                // Clicked X to remove a tag or group.
                e.stopPropagation();
                e.preventDefault();

                if(entry != null)
                {
                    SavedSearchTags.remove(entry.dataset.tag);
                    return;
                }

                // This isn't a tag, so it must be a group.  If the group has no items in it, just remove
                // it.  If it does have items, confirm first.
                let tags_in_group = SavedSearchTags.get_all_groups().get(tag_section.group_name);
                if(tags_in_group.length > 0)
                {
                    let header, text = null;
                    if(tag_section.group_name == null)
                        header = `Clear ${tags_in_group.length} recent ${tags_in_group.length == 1? "search":"searches"}?`;
                    else
                    {
                        header = "Delete tag group";
                        
                        text = `This group contains ${tags_in_group.length} ${tags_in_group.length == 1? "tag":"tags"}.
                            
                        Delete this group and all tags inside it?  This can't be undone.`;
                    }

                    let result = await this.parent.confirm_prompt({ header, text });
                    if(!result)
                        return;
                }

                console.log("Deleting group:", tag_section.group_name);
                console.log("Containing tags:", tags_in_group);
                SavedSearchTags.delete_group(tag_section.group_name);

                return;
            }

            let rename_group = e.target.closest(".rename-group-button");
            if(rename_group != null)
            {
                e.stopPropagation();
                e.preventDefault();

                // The recents group can't be renamed.
                if(tag_section.group_name == null)
                    return;

                let new_group_name = await this.parent.text_prompt({ title: "Rename group:", value: tag_section.group_name });
                if(new_group_name == null || new_group_name == tag_section.group_name)
                    return; // cancelled

                SavedSearchTags.rename_group(tag_section.group_name, new_group_name);
                return;
            }
        }

        // Toggling tag sections:
        if(tag_section != null && !tag_section.classList.contains("autocomplete"))
        {
            e.stopPropagation();
            e.preventDefault();
            SavedSearchTags.set_tag_group_collapsed(tag_section.group_name, "toggle");
            return;
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

            // Disabled for now since keyboard navigation is currently broken.
            this.move(e.code == "ArrowDown");
            break;
        }
        
    }

    input_selectionchange = (e) =>
    {
        this.run_autocomplete();
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

    async _load()
    {
        // We need to go async to load translations, and if we become visible before then we'll flash
        // an unfilled dialog (this is annoying since it's a local database and the load is always
        // nearly instant).  But, if we're hidden then we have no layout, so things like restoring
        // the scroll position and setting the max height don't work.  Work around this by making ourselves
        // visible immediately, but staying transparent, so we have layout but aren't visible until we're
        // ready.
        this.container.classList.add("loading");
        this.container.hidden = false;

        // Fill in the dropdown before displaying it.  This returns false if we were hidden before
        // we finished loading.
        if(!await this.populate_dropdown())
            return;

        this.select_current_search();
        this.run_autocomplete();
    }

    hide()
    {
        if(!this.visible)
            return;
        this.visible = false;

        // If populate_dropdown is still running, cancel it.
        this.cancel_populate_dropdown();

        this.current_autocomplete_results = [];
        this.most_recent_autocomplete = null;
        this.editing = false;
        this.stop_dragging();
        this.container.hidden = true;
    }

    async run_autocomplete()
    {
        // Don't refresh if we're not visible.
        if(!this.visible)
            return;

        // If true, this is a value change caused by keyboard navigation.  Don't run autocomplete,
        // since we don't want to change the dropdown due to navigating in it.
        if(this.navigating)
            return;
        
        if(this.disable_autocomplete_until > Date.now())
            return;

        var tags = this.input_element.value.trim();

        // Get the word under the cursor (we ignore UTF-16 surrogates here for now).  This is
        // the word we'll replace if the user selects a result.  If there's no selection this
        // is also the word we'll search for.
        let text = this.input_element.value;
        let word_start = this.input_element.selectionStart;
        while(word_start > 0 && text[word_start-1] != " ")
            word_start--;

        let word_end = this.input_element.selectionEnd;
        while(word_end < text.length && text[word_end] != " ")
            word_end++;

        // Get the text to search for.  if the selection is collapsed, use the whole word.
        // If we have a selection, search for just the selected text.
        let keyword;
        if(this.input_element.selectionStart != this.input_element.selectionEnd)
            keyword = text.substr(this.input_element.selectionStart, this.input_element.selectionEnd-this.input_element.selectionStart);
        else
            keyword = text.substr(word_start, word_end-word_start);
        keyword = keyword.trim();

        // If the word contains a space because the user selected multiple words, delete
        // everything after the first space.
        keyword = keyword.replace(/ .*/, "");

        // Remove grouping parentheses.
        keyword = keyword.replace(/^\(+/g, '');
        keyword = keyword.replace(/\)+$/g, '');

        // Don't autocomplete the search keyword "or".
        if(keyword == "or")
            return;

        // Stop if we're already up to date.
        if(this.most_recent_autocomplete == keyword)
            return;

        if(this.abort_autocomplete != null)
        {
            // If an autocomplete request is already running, let it finish before we
            // start another.  This matches the behavior of Pixiv's input forms.
            return;
        }

        this.most_recent_autocomplete = keyword;

        // See if we have this search cached, so we don't spam requests if the user
        // moves the cursor around a lot.
        let cached_result = this.autocomplete_cache.get(keyword);
        if(cached_result != null)
        {
            this.autocomplete_request_finished(tags, keyword, { candidates: cached_result, text, word_start, word_end });
            return;
        }

        // Don't send requests with an empty string.  Just finish the search synchronously,
        // so we clear the autocomplete immediately.
        if(keyword == "")
        {
            if(this.abort_autocomplete != null)
                this.abort_autocomplete.abort();
            this.autocomplete_request_finished(tags, keyword, { candidates: [] });
            return;
        }

        // Run the search.
        let result = null;
        try {
            this.abort_autocomplete = new AbortController();
            result = await helpers.rpc_get_request("/rpc/cps.php", {
                keyword,
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

        this.autocomplete_request_finished(tags, keyword, { candidates: result.candidates, text, word_start, word_end });
    }
    
    // A tag autocomplete request finished.
    autocomplete_request_finished(tags, word, { candidates, text, word_start, word_end }={})
    {
        this.abort_autocomplete = null;

        // Cache the result.
        this.autocomplete_cache.set(word, candidates);

        // Cache any translated tags the autocomplete gave us.
        let translations = { };
        for(let tag of candidates)
        {
            // Only cache translations, not romanizations.
            if(tag.type != "tag_translation")
                continue;

            translations[tag.tag_name] = {
                en: tag.tag_translation
            };
        }
        ppixiv.tag_translations.get().add_translations_dict(translations);

        // Store the results.
        this.current_autocomplete_results = [];
        for(let candidate of candidates || [])
        {
            // Skip the word we searched for, since it's the text we already have.
            if(candidate.tag_name == word)
                continue;

            // If the input has multiple tags, we're searching the tag the cursor was on.  Replace just
            // that word.
            let search = text.slice(0, word_start) + candidate.tag_name + text.slice(word_end);
            this.current_autocomplete_results.push({ tag: candidate.tag_name, search });
        }

        // Refresh the dropdown with the new results.  Scroll to autocomplete if we're filling it in
        // because of the user typing a tag, but not for things like clicking on the input box, so
        // we don't steal the scroll position.
        this.populate_dropdown();

        // If the input element's value has changed since we started this search, we
        // stalled any other autocompletion.  Start it now.
        if(tags != this.input_element.value)
            this.run_autocomplete();
    }

    // tag_search is a search, like "tag -tag2".
    //
    // tags is the tag list to display.  The entry will link to target_tags, or tags
    // if target_tags is null.
    create_entry(tags, { classes, target_tags=null }={})
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

                <span class="edit-button edit-tags-button" data-shown-in="saved">${ helpers.create_icon("mat:edit") }</span>
                <span class="edit-button delete-entry" data-shown-in="recent saved">X</span>
            </a>
        `});

        target_tags ??= tags;
        entry.dataset.tag = target_tags;

        for(let name of classes)
            entry.classList.add(name);

        let translated_tag = this.translated_tags[tags];
        if(translated_tag)
            entry.dataset.translated_tag = translated_tag;

        let tag_container = entry.querySelector(".search");
        for(let tag of helpers.split_search_tags(tags))
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
            let translated_tag = this.translated_tags[prefix_and_tag[1]];
            if(translated_tag)
                translated_tag = prefix_and_tag[0] + translated_tag;

            span.textContent = translated_tag || tag;
            if(translated_tag)
                span.dataset.translated_tag = translated_tag;

            tag_container.appendChild(span);
        }

        var url = ppixiv.helpers.get_args_for_tag_search(target_tags, ppixiv.plocation);
        entry.href = url;
        return entry;
    }

    create_separator(label, { icon, is_user_section, group_name=null, collapsed=false, classes=[] })
    {
        let section = this.create_template({html: `
            <div class=tag-section>
                <div class="edit-button user-section-edit-button move-group-up">
                    ${ helpers.create_icon("mat:arrow_upward") }
                </div>
                <div class="edit-button user-section-edit-button move-group-down">
                    ${ helpers.create_icon("mat:arrow_downward") }
                </div>

                ${ helpers.create_icon(icon, { classes: ['section-icon']}) }
                <span class=label></span>

                <span class="edit-button rename-group-button">${ helpers.create_icon("mat:edit") }</span>
                <span class="edit-button delete-entry">X</span>
            </div>
        `});
        section.querySelector(".label").textContent = label;

        helpers.set_class(section, "user-section", is_user_section);
        helpers.set_class(section, "collapsed", collapsed);
        if(group_name != null)
            section.dataset.group = group_name;
        else
            section.classList.add("recents");

        section.group_name = group_name;

        if(group_name == null)
            section.querySelector(".rename-group-button").hidden = true;

        for(let name of classes)
            section.classList.add(name);

        return section;
    }

    // Select the next or previous entry in the dropdown.
    move(down)
    {
        // Temporarily set this.navigating to true.  This lets run_autocomplete know that
        // it shouldn't run an autocomplete request for this value change.
        this.navigating = true;
        try {
            let all_entries = this.all_results.querySelectorAll(".entry");

            // Stop if there's nothing in the list.
            let total_entries = all_entries.length;
            if(total_entries == 0)
                return;

            // Find the index of the previous selection, if any.
            let selected_idx = null;
            for(let idx = 0; idx < all_entries.length; ++idx)
            {
                if(all_entries[idx].classList.contains("selected"))
                {
                    selected_idx = idx;
                    break;
                }
            }
            
            if(selected_idx == null)
                selected_idx = down? 0:(total_entries-1);
            else
                selected_idx += down? +1:-1;

            selected_idx = (selected_idx + total_entries) % total_entries;

            // If there's an autocomplete request in the air, cancel it.
            if(this.abort_autocomplete != null)
                this.abort_autocomplete.abort();

            // Set the new selection.
            let new_entry = all_entries[selected_idx];
            this.set_selection(new_entry.dataset.tag);

            // selectionchange is fired async.  This doesn't make sense, since it makes it
            // impossible to tell what triggered it: this.navigating will be false by the time
            // we see it.   Work around this with a timer to disable autocomplete briefly.
            this.disable_autocomplete_until = Date.now() + 50;
            this.input_element.value = new_entry.dataset.tag;
        } finally {
            this.navigating = false;
        }
    }

    get_selection()
    {
        let entry = this.all_results.querySelector(".entry.selected");
        return entry?.dataset?.tag;
    }

    set_selection(tags)
    {
        // Temporarily set this.navigating to true.  This lets run_autocomplete know that
        // it shouldn't run an autocomplete request for this value change.
        this.navigating = true;

        try {
            // Clear the old selection.
            let old_selection = this.all_results.querySelector(".entry.selected");
            if(old_selection)
                old_selection.classList.remove("selected");

            // Find the entry for the given search.
            if(tags != null)
            {
                let entry = this.get_entry_for_tag(tags, { include_autocomplete: true });
                if(entry)
                {
                    entry.classList.add("selected");
                    this.scroll_entry_into_view(entry);
                }
            }
        } finally {
            this.navigating = false;
        }
    }

    // If the current search is in the list, select it.
    select_current_search = () =>
    {
        let current_search_tags = this.input_element.value.trim();
        if(!current_search_tags)
            return;

        this.set_selection(current_search_tags);

        // If that selected something, scroll it into view.
        let selected_entry = this.container.querySelector(".entry.selected");
        if(selected_entry)
            this.scroll_entry_into_view(selected_entry);
    }

    populate_dropdown = async(options) =>
    {
        // If this is called again before the first call completes, the original call will be
        // aborted.  Keep waiting until one completes without being aborted (or we're hidden), so
        // we don't return until our contents are actually filled in.
        let promise = this._populate_dropdown_promise = this.populate_dropdown_inner(options);
        this._populate_dropdown_promise.finally(() => {
            if(promise === this._populate_dropdown_promise)
                this._populate_dropdown_promise = null;
        });

        while(this.visible && this._populate_dropdown_promise != null)
        {
            if(await this._populate_dropdown_promise)
                return true;
        }
        return false;
    }

    // Populate the tag dropdown.
    //
    // This is async, since IndexedDB is async.  (It shouldn't be.  It's an overcorrection.
    // Network APIs should be async, but local I/O should not be forced async.)  If another
    // call to populate_dropdown() is made before this completes or cancel_populate_dropdown
    // cancels it, return false.  If it completes, return true.
    populate_dropdown_inner = async() =>
    {
        // If another populate_dropdown is already running, cancel it and restart.
        this.cancel_populate_dropdown();

        // Set populate_dropdown_abort to an AbortController for this call.
        let abort_controller = this.populate_dropdown_abort = new AbortController();        
        let abort_signal = abort_controller.signal;

        let autocompleted_tags = this.current_autocomplete_results || [];

        let tags_by_group = SavedSearchTags.get_all_groups();

        let all_saved_tags = [];
        for(let saved_tag of tags_by_group.values())
            all_saved_tags = [...all_saved_tags, ...saved_tag];

        for(let tag of autocompleted_tags)
            all_saved_tags.push(tag.tag);

        // Separate tags in each search, so we can look up translations.
        var all_tags = {};
        for(let tag_search of all_saved_tags)
        {
            for(let tag of helpers.split_search_tags(tag_search))
            {
                tag = helpers.split_tag_prefixes(tag)[1];
                all_tags[tag] = true;
            }
        }

        all_tags = Object.keys(all_tags);
    
        // Get tag translations.
        //
        // Don't do this if we're updating the list during a drag.  The translations will never change
        // since we're just reordering the list, and we need to avoid going async to make sure we update
        // the list immediately since the drag will get confused if it isn't.
        let translated_tags;
        if(this.dragging_tag == null)
        {
            translated_tags = await ppixiv.tag_translations.get().get_translations(all_tags, "en");
        
            // Check if we were aborted while we were loading tags.
            if(abort_signal.aborted)
                return false;
        
            this.translated_tags = translated_tags;
        }
            
        // Save the selection so we can restore it.
        let saved_selection = this.get_selection();
    
        // If we were given a saved scroll position, use it the first time we open.  Otherwise,
        // save the current position.  This preserves the scroll position when we're destroyed
        // and recreated, and when we refresh due tothings like autocomplete changing.
        let saved_position = this.saved_position ?? this.save_search_position();
        this.saved_position = null;
        saved_position ??= {};

        helpers.remove_elements(this.input_dropdown_contents);

        // Add autocompletes at the top.
        if(autocompleted_tags.length)
            this.input_dropdown_contents.appendChild(this.create_separator(`Suggestions for ${this.most_recent_autocomplete}`, { icon: "mat:assistant", classes: ["autocomplete"] }));

        for(var tag of autocompleted_tags)
        {
            // Autocomplete entries link to the fully completed search, but only display the
            // tag that was searched for.
            let entry = this.create_entry(tag.tag, { classes: ["autocomplete"], target_tags: tag.search });
            this.input_dropdown_contents.appendChild(entry);
        }

        // Show saved tags above recent tags.
        for(let [group_name, tags_in_group] of tags_by_group.entries())
        {
            // Skip recents.
            if(group_name == null)
                continue;

            let collapsed = SavedSearchTags.get_collapsed_tag_groups().has(group_name);
            this.input_dropdown_contents.appendChild(this.create_separator(group_name, {
                icon: collapsed? "mat:folder":"mat:folder_open",
                is_user_section: true,
                group_name: group_name,
                collapsed,
            }));

            // Add contents if this section isn't collapsed.
            if(!collapsed)
            {
                for(let tag of tags_in_group)
                    this.input_dropdown_contents.appendChild(this.create_entry(tag, { classes: ["history", "saved"] }));
            }
        }

        // Show recent searches.  This group always exists, but hide it if it's empty.
        let recents_collapsed = SavedSearchTags.get_collapsed_tag_groups().has(null);
        let recent_tags = tags_by_group.get(null);
        if(recent_tags.length)
            this.input_dropdown_contents.appendChild(this.create_separator("Recent tags", {
                icon: "mat:history",
                collapsed: recents_collapsed,
            }));

        if(!recents_collapsed)
        {
            for(let tag of recent_tags)
                this.input_dropdown_contents.appendChild(this.create_entry(tag, { classes: ["history", "recent"] }));
        }

        // Restore the previous selection.
        if(saved_selection)
            this.set_selection(saved_selection);       

        this.restore_search_position(saved_position);

        // We're populated now, so if we were hidden for initial loading, we can actually show
        // our contents if we have any.
        let empty = Array.from(this.all_results.querySelectorAll(".entry, .tag-section")).length == 0;
        helpers.set_class(this.container, "loading", empty);

        return true;
    }

    cancel_populate_dropdown()
    {
        if(this.populate_dropdown_abort == null)
            return;

        this.populate_dropdown_abort.abort();
    }

    // Save the current search position, to be restored with restore_search_position.
    // This can be used as the saved_position argument to the constructor.
    save_search_position()
    {
        // Find the first visible entry.
        for(let node of this.input_dropdown.querySelectorAll(".entry[data-tag]"))
        {
            if(node.offsetTop < this.container.scrollTop)
                continue;

            let saved_position = helpers.save_scroll_position(this.container, node);
            let tag = node.dataset.tag;
            return { saved_position, tag };
        }

        return { };
    }

    restore_search_position({ saved_position, tag })
    {
        if(saved_position == null)
            return;

        let restore_entry = this.get_entry_for_tag(tag);
        if(restore_entry)
            helpers.restore_scroll_position(this.container, restore_entry, saved_position);
    }

    // Scroll a row into view.  entry can be an entry or a section header.
    scroll_entry_into_view(entry)
    {
        entry.scrollIntoView({ block: "nearest" });

        if(!entry.classList.contains("entry"))
            return;

        // Work around a bug in most browsers: scrollIntoView will scroll an element underneath
        // sticky headers, where it isn't in view at all.  This is a pain, because there's no direct
        // way to find which element is actually the top sticky header.  We have to scan through the
        // list and find it.  All nodes that are stickied will have the same offsetTop, so we need
        // to find the last sticky node with the same offsetTop as the first one.
        let sticky_top = null;
        for(let node of this.input_dropdown_contents.children)
        {
            if(!node.classList.contains("tag-section"))
                continue;
            if(sticky_top != null && node.offsetTop != sticky_top.offsetTop)
                break;

            sticky_top = node;
        }

        // If entry is underneath the header, scroll down to make it visible.  The extra offsetTop
        // adjustment is to adjust for the autocomplete box above the scroller.
        let sticky_padding = sticky_top.offsetHeight;
        let offset_from_top = entry.offsetTop - this.input_dropdown.offsetTop - this.container.scrollTop;
        if(offset_from_top < sticky_padding)
            this.container.scrollTop -= sticky_padding - offset_from_top;
    }
}
