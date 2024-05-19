import widget from '/vview/widgets/widget.js';
import SavedSearchTags from '/vview/misc/saved-search-tags.js';
import DragHandler from '/vview/misc/drag-handler.js';
import { DropdownBoxOpener } from '/vview/widgets/dropdown.js';
import { ConfirmPrompt, TextPrompt } from '/vview/widgets/prompts.js';
import { helpers } from '/vview/misc/helpers.js';

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
                        ${ helpers.createIcon("mat:edit") }
                    </span>

                    <span class="search-submit-button right-side-button">
                        ${ helpers.createIcon("search") }
                    </span>
                </div>
            </div>
        `});

        this._inputElement = this.root.querySelector(".input-field-container > input");

        this.querySelector(".edit-search-button").addEventListener("click", (e) => {
            this._dropdownOpener.visible = true;
            this._dropdownOpener.dropdown.editing = !this._dropdownOpener.dropdown.editing;
        });

        this._dropdownOpener = new DropdownBoxOpener({
            button: this._inputElement,

            createDropdown: ({...options}) => {
                let dropdown = new TagSearchDropdownWidget({
                    inputElement: this.root,
                    parent: this,
                    savedPosition: this._savedDropdownPosition,
                    textPrompt: (args) => this.textPrompt(args),
                    ...options,
                });

                // Save the scroll position when the dropdown closes, so we can restore it the
                // next time we open it.
                dropdown.shutdownSignal.addEventListener("abort", () => {
                    this._savedDropdownPosition = dropdown._saveSearchPosition();
                });
                return dropdown;
            },

            shouldCloseForClick: (e) => {
                // Ignore clicks while we're showing a dialog.
                if(this._showingDialog)
                    return false;

                // Ignore clicks inside our container.
                if(helpers.html.isAbove(this.root, e.target))
                    return false;

                return true;
            },
        });

        // Show the dropdown when the input box is focused.
        this._inputElement.addEventListener("focus", () => this._dropdownOpener.visible = true, true);

        // Search submission:
        helpers.inputHandler(this._inputElement, this._submitSearch);
        this.root.querySelector(".search-submit-button").addEventListener("click", this._submitSearch);
    }

    // Hide the dropdowns if our tree becomes hidden.
    visibilityChanged()
    {
        super.visibilityChanged();

        if(!this.visibleRecursively)
            this._dropdownOpener.visible = false;
    }

    // Run a text prompt.
    //
    // We need to keep ourself from closing when the prompt takes our focus temporarily, and restore
    // our focus when it's finished.
    async dialog(promise)
    {
        this._showingDialog = true;
        try {
            return await promise;
        } finally {
            this._inputElement.focus();
            this._showingDialog = false;
        }
    }

    textPrompt(options)
    {
        return this.dialog(TextPrompt.prompt(options));
    }

    confirmPrompt(options)
    {
        return this.dialog(ConfirmPrompt.prompt(options));
    }

    _submitSearch = (e) =>
    {
        // This can be sent to either the search page search box or the one in the
        // navigation dropdown.  Figure out which one we're on.
        let tags = this._inputElement.value.trim();
        if(tags.length == 0)
            return;

        // Add this tag to the recent search list.
        SavedSearchTags.add(tags);

        // If we're submitting by pressing enter on an input element, unfocus it and
        // close any widgets inside it (tag dropdowns).
        if(e.target instanceof HTMLInputElement)
        {
            e.target.blur();
            this._dropdownOpener.visible = false;
        }
        
        // Run the search.
        let args = helpers.getArgsForTagSearch(tags, ppixiv.plocation);
        helpers.navigate(args);
    }
}

class TagSearchDropdownWidget extends widget
{
    constructor({inputElement, savedPosition, textPrompt, ...options})
    {
        super({...options, template: `
            <div class="search-history input-dropdown" tabindex=1>
                <div class=input-dropdown-list>
                    <div class="tag-section create-section-button editing-only">
                        <div class="edit-button">
                            ${ helpers.createIcon("mat:create_new_folder") }
                        </div>
                        <div class=label>Add section</div>
                    </div>

                    <!-- template-tag-dropdown-entry instances will be added here. -->
                    <vv-container class=contents></vv-container>
                </div>
            </div>
        `});

        this._autocompleteCache = new Map();
        this._disableAutocompleteUntil = 0;
        this.savedPosition = savedPosition;
        this.textPrompt = textPrompt;

        // Find the <input>.
        this._inputElement = inputElement.querySelector("input");

        this._inputElement.addEventListener("keydown", this._inputKeydown);
        this._inputElement.addEventListener("input", this.inputOnInput);
        document.addEventListener("selectionchange", this._inputSelectionChange, { signal: this.shutdownSignal });

        // Refresh the dropdown when the tag search history changes.
        window.addEventListener("recent-tag-searches-changed", this._populateDropdown, { signal: this.shutdownSignal });

        // Update the selection if the page is navigated while we're open.
        window.addEventListener("pp:popstate", this._selectCurrentSearch, { signal: this.shutdownSignal });

        this.root.addEventListener("click", this._dropdownClick);

        this._currentAutocompleteResults = [];

        // input-dropdown is resizable.  Save the size when the user drags it.
        this._allResults = this.root;
        this._inputDropdown = this.root.querySelector(".input-dropdown-list");
        this._inputDropdownContents = this._inputDropdown.querySelector(".contents");
        let observer = new MutationObserver((mutations) => {
            // resize sets the width.  Use this instead of offsetWidth, since offsetWidth sometimes reads
            // as 0 here.
            let width = parseInt(this.root.style.width);
            if(isNaN(width))
                width = 600;
            ppixiv.settings.set("tag-dropdown-width", width);
        });
        observer.observe(this.root, { attributes: true });

        // Restore input-dropdown's width.
        this._inputDropdown.style.width = ppixiv.settings.get("tag-dropdown-width", "400px");

        // tag-dropdown-width may have "px" baked into it.  Use parseInt to remove it.
        let width = ppixiv.settings.get("tag-dropdown-width", "400");
        width = parseInt(width);

        this.root.style.setProperty('--width', `${width}px`);

        this.dragger = new DragHandler({
            parent: this,
            name: "search-dragger",
            element: this.root,
            confirmDrag: ({event}) => event.target.closest(".drag-handle") != null,
            ondragstart: (args) => this._ondragstart(args),
            ondrag: (args) => this._ondrag(args),
            ondragend: (args) => this._ondragend(args),
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
        helpers.html.setClass(this.root, "editing", this._editing);
        helpers.html.setClass(this.root.querySelector(".input-dropdown-list"), "editing", this._editing);
    }

    _findTagEntry(tag)
    {
        for(let entry of this._inputDropdown.querySelectorAll(".entry[data-tag]"))
        {
            if(entry.dataset.tag == tag)
                return entry;
        }
        return null;
    }

    _ondragstart({event})
    {
        // Remember the tag we're dragging.
        let dragHandle = event.target.closest(".drag-handle");
        let entry = dragHandle.closest(".entry");
        this.draggingTag = entry.dataset.tag;
        return true;
    }

    _ondrag({event})
    {
        // Scan backwards or forwards to find the next valid place where entry can be placed
        // after.
        // Find the next and previous entry that we can drag to.
        function findSibling(entry, next)
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

        let entry = this._findTagEntry(this.draggingTag);

        // Check downwards first, then upwards.
        let entryRect = entry.getBoundingClientRect();
        for(let down = 0; down <= 1; down++)
        {
            let entryToCheck = findSibling(entry, down == 1);
            if(entryToCheck == null)
                continue;

            if(!entryToCheck.classList.contains("saved") && !entryToCheck.classList.contains("tag-section"))
                continue;

            // When moving up, find the next entry where the entry above it is uncollapsed.
            // For tags this is always true (visible tags are always inside a visible group),
            // but if we're dragging above a group header, this makes sure we drag into an
            // uncollapsed group.
            //
            // To see if we should move up, compare the Y position to the center of the combination
            // of the element and the element above it.  threshold is how far over the boundary
            // we need to go before moving.
            let neighborRect = entryToCheck.getBoundingClientRect();
            let threshold = 5;
            if(down)
            {
                let y = (neighborRect.bottom + entryRect.top) / 2;
                if(event.clientY - threshold < y)
                    continue;
            }
            else
            {
                let y = (entryRect.bottom + neighborRect.top) / 2;
                if(event.clientY + threshold > y)
                    continue;
            }

            // We want to drag in this direction.  If we're dragging downwards, we'll place the item
            // after entryToCheck.  If we're dragging upwards, find the next uncollapsed entry before
            // it to place it after.
            let entryToPlaceAfter = entryToCheck;
            if(!down)
                entryToPlaceAfter = findSibling(entryToCheck, false);
            if(entryToPlaceAfter == null)
                continue;

            // Find its index in the list.
            let moveAfterIdx = -1;
            if(entryToPlaceAfter.groupName)
                moveAfterIdx = SavedSearchTags.findIndex({group: entryToPlaceAfter.groupName});
            else if(entryToPlaceAfter.dataset.tag)
                moveAfterIdx = SavedSearchTags.findIndex({tag: entryToPlaceAfter.dataset.tag});

            if(moveAfterIdx != -1)
            {
                // Move the tag after moveAfterIdx.
                SavedSearchTags.move(this.draggingTag, moveAfterIdx+1);
                return;
            }
        }
    };

    _ondragend({event})
    {
        this.draggingTag = null;
    }

    // Return the tag-section for the given group.
    //
    // We could do this with querySelector, but we'd need to escape the string.
    _getSectionHeaderForGroup(group)
    {
        for(let tagSection of this.root.querySelectorAll(".tag-section"))
        {
            if(tagSection.groupName == group)
                return tagSection;
        }
        return null;
    }

    getEntryForTag(tag, { includeAutocomplete=false }={})
    {
        tag = tag.trim();
        
        for(let entry of this.root.querySelectorAll(".entry"))
        {
            if(!includeAutocomplete && entry.classList.contains("autocomplete"))
                continue;
            if(entry.dataset.tag.trim() == tag)
                return entry;
        }
        return null;
    }

    _dropdownClick = async(e) =>
    {
        let entry = e.target.closest(".entry");
        let tagSection = e.target.closest(".tag-section");

        let createSectionButton = e.target.closest(".create-section-button");
        if(createSectionButton)
        {
            e.stopPropagation();
            e.preventDefault();

            let label = await this.textPrompt({ title: "Group name:" });
            if(label == null)
                return; // cancelled
            
            // Group names identify the group, so don't allow adding a group that already exists.
            // SavedSearchTags.add won't allow this, but check so we can tell the user.
            let tagGroups = new Set(SavedSearchTags.getAllGroups().keys());
            if(tagGroups.has(label))
            {
                ppixiv.message.show(`Group "${label}" already exists`);
                return;
            }

            // Add the group.
            SavedSearchTags.add(null, { group: label });

            // The edit will update automatically, but that happens async and may not have
            // completed yet.  Force an update now so we can scroll the new group into view.
            await this._populateDropdown();
            let newSection = this._getSectionHeaderForGroup(label);
            this._scrollEntryIntoView(newSection);
            return;
        }
        
        let tagButton = e.target.closest("a[data-tag]");
        if(tagButton)
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
                this._inputElement.blur();
                this.hide();

                // If this is a navigation the input box will be filled automatically, but clicking an
                // entry matching the current search won't navigate.  Fill in the input box with the search
                // even if the click doesn't trigger navigation.
                this._inputElement.value = entry.dataset.tag;

                return;
            }
        }

        if(this.editing)
        {
            let moveGroupUp = e.target.closest(".move-group-up");
            let moveGroupDown = e.target.closest(".move-group-down");
            if(moveGroupUp || moveGroupDown)
            {
                e.stopPropagation();
                e.preventDefault();
                SavedSearchTags.moveGroup(tagSection.groupName, { down: moveGroupDown != null });
                return;
            }

            let saveSearch = e.target.closest(".save-search");
            if(saveSearch)
            {
                e.stopPropagation();
                e.preventDefault();

                // Figure out which group to put it in.  If there are no groups, this is the first
                // saved search, so create "Saved tags" by default.  If there's just one group, use
                // it.  Otherwise, ask the user.
                //
                // maybe only expand one group at a time
                let tagGroups = new Set(SavedSearchTags.getAllGroups().keys());
                tagGroups.delete(null); // ignore the recents group
                let addToGroup = "Saved tags";
                if(tagGroups.size == 1)
                    addToGroup = Array.from(tagGroups)[0];
                else if(tagGroups.size > 1)
                {
                    // For now, add to the bottommost uncollapsed group.  This is a group which is
                    // closest to recents, where the user should be able to see where the tag he
                    // saved went.
                    let allGroups = new Set(SavedSearchTags.getAllGroups().keys());
                    allGroups.delete(null);

                    let collapsedGroups = SavedSearchTags.getCollapsedTagGroups();
                    addToGroup = null;
                    for(let group of allGroups)
                    {
                        if(collapsedGroups.has(group))
                            continue;
                        addToGroup = group;
                    }

                    if(addToGroup == null)
                    {
                        // If no groups are uncollapsed, use the last group.  It'll be uncollapsed
                        // below.
                        for(let group of allGroups)
                            addToGroup = group;
                    }
                }

                console.log(`Adding search "${entry.dataset.tag}" to group "${addToGroup}"`);

                // If the group we're adding to is collapsed, uncollapse it.
                if(SavedSearchTags.getCollapsedTagGroups().has(addToGroup))
                {
                    console.log(`Uncollapsing group ${addToGroup} because we're adding to it`);
                    SavedSearchTags.setTagGroupCollapsed(addToGroup, false);
                }

                // Add or change the tag to a saved tag.
                SavedSearchTags.add(entry.dataset.tag, {group: addToGroup, addToEnd: true});

                // We tried to keep the new tag in view, but scroll it into view if it isn't, such as
                // if we had to expand the group and the scroll position is in the wrong place now.
                await this._populateDropdown();
                let newEntry = this.getEntryForTag(entry.dataset.tag);
                this._scrollEntryIntoView(newEntry);
            }

            let editTags = e.target.closest(".edit-tags-button");
            if(editTags != null)
            {
                e.stopPropagation();
                e.preventDefault();
                
                // Add a space to the end for convenience with the common case of just wanting to add something
                // to the end.
                let newTags = await this.textPrompt({ title: "Edit search:", value: entry.dataset.tag + " " });
                if(newTags == null || newTags == entry.dataset.tag)
                    return; // cancelled

                newTags = newTags.trim();
                SavedSearchTags.modifyTag(entry.dataset.tag, newTags);                
                return;
            }

            let removeEntry = e.target.closest(".delete-entry");
            if(removeEntry != null)
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
                let tagsInGroup = SavedSearchTags.getAllGroups().get(tagSection.groupName);
                if(tagsInGroup.length > 0)
                {
                    let header, text = null;
                    if(tagSection.groupName == null)
                        header = `Clear ${tagsInGroup.length} recent ${tagsInGroup.length == 1? "search":"searches"}?`;
                    else
                    {
                        header = "Delete tag group";
                        
                        text = `This group contains ${tagsInGroup.length} ${tagsInGroup.length == 1? "tag":"tags"}.
                            
                        Delete this group and all tags inside it?  This can't be undone.`;
                    }

                    let result = await this.parent.confirmPrompt({ header, text });
                    if(!result)
                        return;
                }

                console.log("Deleting group:", tagSection.groupName);
                console.log("Containing tags:", tagsInGroup);
                SavedSearchTags.deleteGroup(tagSection.groupName);

                return;
            }

            let renameGroup = e.target.closest(".rename-group-button");
            if(renameGroup != null)
            {
                e.stopPropagation();
                e.preventDefault();

                // The recents group can't be renamed.
                if(tagSection.groupName == null)
                    return;

                let newGroupName = await this.textPrompt({ title: "Rename group:", value: tagSection.groupName });
                if(newGroupName == null || newGroupName == tagSection.groupName)
                    return; // cancelled

                SavedSearchTags.renameGroup(tagSection.groupName, newGroupName);
                return;
            }
        }

        // Toggling tag sections:
        if(tagSection != null && !tagSection.classList.contains("autocomplete"))
        {
            e.stopPropagation();
            e.preventDefault();
            SavedSearchTags.setTagGroupCollapsed(tagSection.groupName, "toggle");
            return;
        }
    }

    _inputKeydown = (e) =>
    {
        // Only handle inputs when we're open.
        if(this.root.hidden)
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

    _inputSelectionChange = (e) =>
    {
        this._runAutocomplete();
    }
    
    inputOnInput = (e) =>
    {
        if(this.root.hidden)
            return;
        
        // Clear the selection on input.
        this.setSelection(null);

        // Update autocomplete when the text changes.
        this._runAutocomplete();
    }

    async _load()
    {
        // We need to go async to load translations, and if we become visible before then we'll flash
        // an unfilled dialog (this is annoying since it's a local database and the load is always
        // nearly instant).  But, if we're hidden then we have no layout, so things like restoring
        // the scroll position and setting the max height don't work.  Work around this by making ourselves
        // visible immediately, but staying transparent, so we have layout but aren't visible until we're
        // ready.
        this.root.classList.add("loading");
        this.root.hidden = false;

        // Fill in the dropdown before displaying it.  This returns false if we were hidden before
        // we finished loading.
        if(!await this._populateDropdown())
            return;

        this._selectCurrentSearch();
        this._runAutocomplete();
    }

    hide()
    {
        if(!this.visible)
            return;
        this.visible = false;

        // If _populateDropdown is still running, cancel it.
        this._cancelPopulateDropdown();

        this._currentAutocompleteResults = [];
        this._mostRecentAutocomplete = null;
        this.editing = false;
        this.dragger.cancelDrag();
        this.root.hidden = true;
    }

    async _runAutocomplete()
    {
        // Don't refresh if we're not visible.
        if(!this.visible)
            return;

        // If true, this is a value change caused by keyboard navigation.  Don't run autocomplete,
        // since we don't want to change the dropdown due to navigating in it.
        if(this.navigating)
            return;
        
        if(this._disableAutocompleteUntil > Date.now())
            return;

        let tags = this._inputElement.value.trim();

        // Get the word under the cursor (we ignore UTF-16 surrogates here for now).  This is
        // the word we'll replace if the user selects a result.  If there's no selection this
        // is also the word we'll search for.
        let text = this._inputElement.value;
        let wordStart = this._inputElement.selectionStart;
        while(wordStart > 0 && text[wordStart-1] != " ")
            wordStart--;

        let wordEnd = this._inputElement.selectionEnd;
        while(wordEnd < text.length && text[wordEnd] != " ")
            wordEnd++;

        // Get the text to search for.  if the selection is collapsed, use the whole word.
        // If we have a selection, search for just the selected text.
        let keyword;
        if(this._inputElement.selectionStart != this._inputElement.selectionEnd)
            keyword = text.substr(this._inputElement.selectionStart, this._inputElement.selectionEnd-this._inputElement.selectionStart);
        else
            keyword = text.substr(wordStart, wordEnd-wordStart);
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
        if(this._mostRecentAutocomplete == keyword)
            return;

        if(this._abortAutocomplete != null)
        {
            // If an autocomplete request is already running, let it finish before we
            // start another.  This matches the behavior of Pixiv's input forms.
            return;
        }

        this._mostRecentAutocomplete = keyword;

        // See if we have this search cached, so we don't spam requests if the user
        // moves the cursor around a lot.
        let cachedResult = this._autocompleteCache.get(keyword);
        if(cachedResult != null)
        {
            this._autocompleteRequestFinished(tags, keyword, { candidates: cachedResult, text, wordStart, wordEnd });
            return;
        }

        // Don't send requests with an empty string.  Just finish the search synchronously,
        // so we clear the autocomplete immediately.
        if(keyword == "")
        {
            if(this._abortAutocomplete != null)
                this._abortAutocomplete.abort();
            this._autocompleteRequestFinished(tags, keyword, { candidates: [] });
            return;
        }

        // Run the search.
        let result = null;
        try {
            this._abortAutocomplete = new AbortController();
            result = await helpers.pixivRequest.get("/rpc/cps.php", {
                keyword,
            }, {
                signal: this._abortAutocomplete.signal,
            });
        } catch(e) {
            console.info("Tag autocomplete error:", e);
            return;
        } finally {
            this._abortAutocomplete = null;
        }

        // If result is null, we were probably aborted.
        if(result == null)
            return;

        this._autocompleteRequestFinished(tags, keyword, { candidates: result.candidates, text, wordStart, wordEnd });
    }
    
    // A tag autocomplete request finished.
    _autocompleteRequestFinished(tags, word, { candidates, text, wordStart, wordEnd }={})
    {
        this._abortAutocomplete = null;

        // Cache the result.
        this._autocompleteCache.set(word, candidates);

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
        ppixiv.tagTranslations.addTranslationsDict(translations);

        // Store the results.
        this._currentAutocompleteResults = [];
        for(let candidate of candidates || [])
        {
            // Skip the word we searched for, since it's the text we already have.
            if(candidate.tag_name == word)
                continue;

            // If the input has multiple tags, we're searching the tag the cursor was on.  Replace just
            // that word.
            let search = text.slice(0, wordStart) + candidate.tag_name + text.slice(wordEnd);
            this._currentAutocompleteResults.push({ tag: candidate.tag_name, search });
        }

        // Refresh the dropdown with the new results.  Scroll to autocomplete if we're filling it in
        // because of the user typing a tag, but not for things like clicking on the input box, so
        // we don't steal the scroll position.
        this._populateDropdown();

        // If the input element's value has changed since we started this search, we
        // stalled any other autocompletion.  Start it now.
        if(tags != this._inputElement.value)
            this._runAutocomplete();
    }

    // tagSearch is a search, like "tag -tag2".
    //
    // tags is the tag list to display.  The entry will link to targetTags, or tags
    // if targetTags is null.
    createEntry(tags, { classes, targetTags=null }={})
    {
        let entry = this.createTemplate({name: "tag-dropdown-entry", html: `
            <a class=entry href=#>
                <div class="edit-button drag-handle" data-shown-in="saved">
                    ${ helpers.createIcon("mat:drag_handle") }
                </div>

                <div class="edit-button save-search" data-shown-in="recent autocomplete">
                    ${ helpers.createIcon("mat:push_pin") }
                </div>

                <span class=search></span>

                <span class="edit-button edit-tags-button" data-shown-in="saved">${ helpers.createIcon("mat:edit") }</span>
                <span class="edit-button delete-entry" data-shown-in="recent saved">X</span>
            </a>
        `});

        targetTags ??= tags;
        entry.dataset.tag = targetTags;

        for(let name of classes)
            entry.classList.add(name);

        let translatedTag = this.translatedTags[tags];
        if(translatedTag)
            entry.dataset.translatedTag = translatedTag;

        let tagContainer = entry.querySelector(".search");
        for(let tag of helpers.pixiv.splitSearchTags(tags))
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
            let prefixAndTag = helpers.pixiv.splitTagPrefixes(tag);
            let translatedTag = this.translatedTags[prefixAndTag[1]];
            if(translatedTag)
                translatedTag = prefixAndTag[0] + translatedTag;

            span.textContent = translatedTag || tag;
            if(translatedTag)
                span.dataset.translatedTag = translatedTag;

            tagContainer.appendChild(span);
        }

        let url = helpers.getArgsForTagSearch(targetTags, ppixiv.plocation);
        entry.href = url;
        return entry;
    }

    createSeparator(label, { icon, isUserSection, groupName=null, collapsed=false, classes=[] })
    {
        let section = this.createTemplate({html: `
            <div class=tag-section>
                <div class="edit-button user-section-edit-button move-group-up">
                    ${ helpers.createIcon("mat:arrow_upward") }
                </div>
                <div class="edit-button user-section-edit-button move-group-down">
                    ${ helpers.createIcon("mat:arrow_downward") }
                </div>

                ${ helpers.createIcon(icon, { classes: ['section-icon']}) }
                <span class=label></span>

                <span class="edit-button rename-group-button">${ helpers.createIcon("mat:edit") }</span>
                <span class="edit-button delete-entry">X</span>
            </div>
        `});
        section.querySelector(".label").textContent = label;

        helpers.html.setClass(section, "user-section", isUserSection);
        helpers.html.setClass(section, "collapsed", collapsed);
        if(groupName != null)
            section.dataset.group = groupName;
        else
            section.classList.add("recents");

        section.groupName = groupName;

        if(groupName == null)
            section.querySelector(".rename-group-button").hidden = true;

        for(let name of classes)
            section.classList.add(name);

        return section;
    }

    // Select the next or previous entry in the dropdown.
    move(down)
    {
        // Temporarily set this.navigating to true.  This lets _runAutocomplete know that
        // it shouldn't run an autocomplete request for this value change.
        this.navigating = true;
        try {
            let allEntries = this._allResults.querySelectorAll(".entry");

            // Stop if there's nothing in the list.
            let totalEntries = allEntries.length;
            if(totalEntries == 0)
                return;

            // Find the index of the previous selection, if any.
            let selectedIdx = null;
            for(let idx = 0; idx < allEntries.length; ++idx)
            {
                if(allEntries[idx].classList.contains("selected"))
                {
                    selectedIdx = idx;
                    break;
                }
            }
            
            if(selectedIdx == null)
                selectedIdx = down? 0:(totalEntries-1);
            else
                selectedIdx += down? +1:-1;

            selectedIdx = (selectedIdx + totalEntries) % totalEntries;

            // If there's an autocomplete request in the air, cancel it.
            if(this._abortAutocomplete != null)
                this._abortAutocomplete.abort();

            // Set the new selection.
            let newEntry = allEntries[selectedIdx];
            this.setSelection(newEntry.dataset.tag);

            // selectionchange is fired async.  This doesn't make sense, since it makes it
            // impossible to tell what triggered it: this.navigating will be false by the time
            // we see it.   Work around this with a timer to disable autocomplete briefly.
            this._disableAutocompleteUntil = Date.now() + 50;
            this._inputElement.value = newEntry.dataset.tag;
        } finally {
            this.navigating = false;
        }
    }

    getSelection()
    {
        let entry = this._allResults.querySelector(".entry.selected");
        return entry?.dataset?.tag;
    }

    setSelection(tags)
    {
        // Temporarily set this.navigating to true.  This lets _runAutocomplete know that
        // it shouldn't run an autocomplete request for this value change.
        this.navigating = true;

        try {
            // Clear the old selection.
            let oldSelection = this._allResults.querySelector(".entry.selected");
            if(oldSelection)
                oldSelection.classList.remove("selected");

            // Find the entry for the given search.
            if(tags != null)
            {
                let entry = this.getEntryForTag(tags, { includeAutocomplete: true });
                if(entry)
                {
                    entry.classList.add("selected");
                    this._scrollEntryIntoView(entry);
                }
            }
        } finally {
            this.navigating = false;
        }
    }

    // If the current search is in the list, select it.
    _selectCurrentSearch = () =>
    {
        let currentSearchTags = this._inputElement.value.trim();
        if(!currentSearchTags)
            return;

        this.setSelection(currentSearchTags);

        // If that selected something, scroll it into view.
        let selectedEntry = this.root.querySelector(".entry.selected");
        if(selectedEntry)
            this._scrollEntryIntoView(selectedEntry);
    }

    _populateDropdown = async(options) =>
    {
        // If this is called again before the first call completes, the original call will be
        // aborted.  Keep waiting until one completes without being aborted (or we're hidden), so
        // we don't return until our contents are actually filled in.
        let promise = this._populateDropdownPromise = this._populateDropdownInner(options);
        this._populateDropdownPromise.finally(() => {
            if(promise === this._populateDropdownPromise)
                this._populateDropdownPromise = null;
        });

        while(this.visible && this._populateDropdownPromise != null)
        {
            if(await this._populateDropdownPromise)
                return true;
        }
        return false;
    }

    // Composing tag groups by matching translation in lowercase with brackets stripped out.
    // joinMonotags provides split and mono tag handling e.g. handglove like hand_glove, hand-glove, hand glove will reside in hand group
    // joinMonotags strictly applyed only to tags starting in lowercase since it's likely not name of the character
    // joinPrefixes will try to join formed groups with same prefix
    _groupTagsByTranslation = (autocompletedTags, translatedTags, options) => {
        const tagGroupReducer = (acc, tag) => {
            const strippedTag = tag.tag.replace(/\s*\(.+\)\s*/g, '');

            // Consider translated itself if defined as property but does not have a value
            if (!Object.hasOwn(translatedTags, strippedTag)) {
                acc.standalone.push(tag);
                return acc;
            }

            const translated = translatedTags[strippedTag] ?? tag.tag;
            let slug = translated.toLowerCase();

            if(options.joinMonotags) {
                // Likely not name since starting with lowercase
                if (translated[0] === slug[0]) {
                    // Attach to group if starts with any existing group name for monotags and tags with spaces handling
                    slug = Object.keys(acc.groups).find(key => slug.startsWith(key)) ?? slug;
                    slug = slug.split(/[ _-]/g)[0]
                }
            }

            if (!acc.groups[slug]) {
                acc.groups[slug] = {
                    tag: new Set([tag.tag]),
                    // Downside of this approach is that joined tag list shoud be inserted in fixed place since we dont know position
                    search: tag.search.replace(tag.tag, '')
                };
            } else {
                acc.groups[slug].tag.add(tag.tag);
            }

            return acc;
        }

        const secondPassRequired = options.joinMonotags;
        const accumulator = { groups: {}, standalone: [] };

        // Run twice ensuring all prefix tags are collected in groups
        const groupedTags = autocompletedTags.reduce(
            tagGroupReducer,
            secondPassRequired ?
            autocompletedTags.reduce(
                tagGroupReducer, accumulator
            ) : accumulator
        );

        // Will join groups with matching prefix
        if (options.joinPrefixes) {
            for (const [name, group] of Object.entries(groupedTags.groups)) {
                const keys = Object.keys(groupedTags.groups).filter(key => key.startsWith(name) && key !== name);
                if (keys.length === 0) {
                    continue
                }

                for (const key of keys) {
                    groupedTags.groups[key].tag.forEach(tag => group.tag.add(tag));
                    delete groupedTags.groups[key];
                }
            }
        }

        const convertedGroups = Object.values(groupedTags.groups).reduce((acc, { search, tag }) => {
            const tags = Array.from(tag);
            const target = tags.length === 1 ? tags[0] : `( ${tags.join(' OR ')} )`;

            // Since we removed tag when pushing search append it from the start
            acc.push({ search: `${target} ${search}`, tag: target });

            return acc;
        }, []);

        return convertedGroups.concat(groupedTags.standalone);
    }

    // Populate the tag dropdown.
    //
    // This is async, since IndexedDB is async.  (It shouldn't be.  It's an overcorrection.
    // Network APIs should be async, but local I/O should not be forced async.)  If another
    // call to _populateDropdown() is made before this completes or _cancelPopulateDropdown
    // cancels it, return false.  If it completes, return true.
    _populateDropdownInner = async() =>
    {
        // If another _populateDropdown is already running, cancel it and restart.
        this._cancelPopulateDropdown();

        // Set populate_dropdown_abort to an AbortController for this call.
        let abortController = this._populateDropdownAbort = new AbortController();        
        let abortSignal = abortController.signal;

        let autocompletedTags = this._currentAutocompleteResults || [];

        let tagsByGroup = SavedSearchTags.getAllGroups();

        let allSavedTags = [];
        for(let savedTag of tagsByGroup.values())
            allSavedTags = [...allSavedTags, ...savedTag];

        for(let tag of autocompletedTags)
            allSavedTags.push(tag.tag);

        // Separate tags in each search, so we can look up translations.
        let allTags = {};
        for(let tagSearch of allSavedTags)
        {
            for(let tag of helpers.pixiv.splitSearchTags(tagSearch))
            {
                tag = helpers.pixiv.splitTagPrefixes(tag)[1];
                allTags[tag] = true;
            }
        }

        allTags = Object.keys(allTags);
    
        // Get tag translations.
        //
        // Don't do this if we're updating the list during a drag.  The translations will never change
        // since we're just reordering the list, and we need to avoid going async to make sure we update
        // the list immediately since the drag will get confused if it isn't.
        let translatedTags;
        if(this.draggingTag == null)
        {
            translatedTags = await ppixiv.tagTranslations.getTranslations(allTags, "en");
        
            // Check if we were aborted while we were loading tags.
            if(abortSignal.aborted)
                return false;
        
            this.translatedTags = translatedTags;
        }
            
        // Save the selection so we can restore it.
        let savedSelection = this.getSelection();
    
        // If we were given a saved scroll position, use it the first time we open.  Otherwise,
        // save the current position.  This preserves the scroll position when we're destroyed
        // and recreated, and when we refresh due tothings like autocomplete changing.
        let savedPosition = this.savedPosition ?? this._saveSearchPosition();
        this.savedPosition = null;
        savedPosition ??= {};

        helpers.html.removeElements(this._inputDropdownContents);

        // Add autocompletes at the top.
        if(autocompletedTags.length)
            this._inputDropdownContents.appendChild(this.createSeparator(`Suggestions for ${this._mostRecentAutocomplete}`, { icon: "mat:assistant", classes: ["autocomplete"] }));

        // Compose tag groups
        const groupedTags = this._groupTagsByTranslation(autocompletedTags, translatedTags, {
            joinMonotags: false,
            joinPrefixes: false
        });

        for(let tag of groupedTags)
        {
            // Autocomplete entries link to the fully completed search, but only display the
            // tag that was searched for.
            let entry = this.createEntry(tag.tag, { classes: ["autocomplete"], targetTags: tag.search });
            this._inputDropdownContents.appendChild(entry);
        }

        // Show saved tags above recent tags.
        for(let [groupName, tagsInGroup] of tagsByGroup.entries())
        {
            // Skip recents.
            if(groupName == null)
                continue;

            let collapsed = SavedSearchTags.getCollapsedTagGroups().has(groupName);
            this._inputDropdownContents.appendChild(this.createSeparator(groupName, {
                icon: collapsed? "mat:folder":"mat:folder_open",
                isUserSection: true,
                groupName: groupName,
                collapsed,
            }));

            // Add contents if this section isn't collapsed.
            if(!collapsed)
            {
                for(let tag of tagsInGroup)
                    this._inputDropdownContents.appendChild(this.createEntry(tag, { classes: ["history", "saved"] }));
            }
        }

        // Show recent searches.  This group always exists, but hide it if it's empty.
        let recentsCollapsed = SavedSearchTags.getCollapsedTagGroups().has(null);
        let recentTags = tagsByGroup.get(null);
        if(recentTags.length)
            this._inputDropdownContents.appendChild(this.createSeparator("Recent tags", {
                icon: "mat:history",
                collapsed: recentsCollapsed,
            }));

        if(!recentsCollapsed)
        {
            for(let tag of recentTags)
                this._inputDropdownContents.appendChild(this.createEntry(tag, { classes: ["history", "recent"] }));
        }

        // Restore the previous selection.
        if(savedSelection)
            this.setSelection(savedSelection);       

        this._restoreSearchPosition(savedPosition);

        // We're populated now, so if we were hidden for initial loading, we can actually show
        // our contents if we have any.
        let empty = Array.from(this._allResults.querySelectorAll(".entry, .tag-section")).length == 0;
        helpers.html.setClass(this.root, "loading", empty);

        return true;
    }

    _cancelPopulateDropdown()
    {
        if(this._populateDropdownAbort == null)
            return;

        this._populateDropdownAbort.abort();
    }

    // Save the current search position, to be restored with _restoreSearchPosition.
    // This can be used as the savedPosition argument to the constructor.
    _saveSearchPosition()
    {
        // If we're dragging, never save the search position relative to the tag that's
        // being dragged, or the tag on either side.  This keeps the scroll position stable
        // when the drag moves and swaps a tag with its neighbor.
        let ignoredNodes = new Set();
        if(this.draggingTag)
        {
            let entry = this._findTagEntry(this.draggingTag);
            ignoredNodes.add(entry);

            let nextEntry = entry.nextElementSibling;
            if(nextEntry)
                ignoredNodes.add(nextEntry);

            let previousEntry = entry.previousElementSibling;
            if(previousEntry)
                ignoredNodes.add(previousEntry);
        }

        for(let node of this._inputDropdown.querySelectorAll(".entry[data-tag]"))
        {
            if(node.offsetTop < this.root.scrollTop)
                continue;

            if(ignoredNodes.has(node))
                continue;

            let savedPosition = helpers.html.saveScrollPosition(this.root, node);
            let tag = node.dataset.tag;
            return { savedPosition, tag };
        }

        return { };
    }

    _restoreSearchPosition({ savedPosition, tag })
    {
        if(savedPosition == null)
            return;

        let restoreEntry = this.getEntryForTag(tag);
        if(restoreEntry)
            helpers.html.restoreScrollPosition(this.root, restoreEntry, savedPosition);
    }

    // Scroll a row into view.  entry can be an entry or a section header.
    _scrollEntryIntoView(entry)
    {
        entry.scrollIntoView({ block: "nearest" });

        if(!entry.classList.contains("entry"))
            return;

        // Work around a bug in most browsers: scrollIntoView will scroll an element underneath
        // sticky headers, where it isn't in view at all.  This is a pain, because there's no direct
        // way to find which element is actually the top sticky header.  We have to scan through the
        // list and find it.  All nodes that are stickied will have the same offsetTop, so we need
        // to find the last sticky node with the same offsetTop as the first one.
        let stickyTop = null;
        for(let node of this._inputDropdownContents.children)
        {
            if(!node.classList.contains("tag-section"))
                continue;
            if(stickyTop != null && node.offsetTop != stickyTop.offsetTop)
                break;

            stickyTop = node;
        }

        // If entry is underneath the header, scroll down to make it visible.  The extra offsetTop
        // adjustment is to adjust for the autocomplete box above the scroller.
        let stickyPadding = stickyTop.offsetHeight;
        let offsetFromTop = entry.offsetTop - this._inputDropdown.offsetTop - this.root.scrollTop;
        if(offsetFromTop < stickyPadding)
            this.root.scrollTop -= stickyPadding - offsetFromTop;
    }
}
