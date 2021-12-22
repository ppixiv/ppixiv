"use strict";

// A list of illustration IDs by page.
//
// Store the list of illustration IDs returned from a search, eg. bookmark.php?p=3,
// and allow looking up the next or previous ID for an illustration.  If we don't have
// data for the next or previous illustration, return the page that should be loaded
// to make it available.
//
// We can have gaps in the pages we've loaded, due to history navigation.  If you load
// page 1, then jump to page 3, we'll figure out that to get the illustration before the
// first one on page 3, we need to load page 2.
//
// One edge case is when the underlying search changes while we're viewing it.  For example,
// if we're viewing page 2 with ids [1,2,3,4,5], and when we load page 3 it has ids
// [5,6,7,8,9], that usually means new entries were added to the start since we started.
// We don't want the same ID to occur twice, so we'll detect if this happens, and clear
// all other pages.  That way, we'll reload the previous pages with the updated data if
// we navigate back to them.
ppixiv.data_sources = { };
class illust_id_list
{
    constructor()
    {
        this.illust_ids_by_page = new Map();
    };

    get_all_illust_ids()
    {
        // Make a list of all IDs we already have.
        let all_ids = [];
        for(let [page, ids] of this.illust_ids_by_page)
            all_ids = all_ids.concat(ids);
        return all_ids;
    }

    get any_pages_loaded()
    {
        return this.illust_ids_by_page.size != 0;
    }

    get_lowest_loaded_page()
    {
        let min_page = 999999;
        for(let page of this.illust_ids_by_page.keys())
            min_page = Math.min(min_page, page);
        return min_page;
    }

    get_highest_loaded_page()
    {
        let max_page = 0;
        for(let page of this.illust_ids_by_page.keys())
            max_page = Math.max(max_page, page);
        return max_page;
    }

    // Add a page of results.
    //
    // If the page cache has been invalidated, return false.  This happens if we think the
    // results have changed too much for us to reconcile it.
    add_page(page, illust_ids)
    {
        // Sanity check:
        for(let illust_id of illust_ids)
            if(illust_id == null)
                console.warn("Null illust_id added");

        if(this.illust_ids_by_page.has(page))
        {
            console.warn("Page", page, "was already loaded");
            return true;
        }

        // Make a list of all IDs we already have.
        let all_illusts = this.get_all_illust_ids();

        // For fast-moving pages like new_illust.php, we'll very often get a few entries at the
        // start of page 2 that were at the end of page 1 when we requested it, because new posts
        // have been added to page 1 that we haven't seen.  Remove any duplicate IDs.
        let ids_to_remove = [];
        for(let new_id of illust_ids)
        {
            if(all_illusts.indexOf(new_id) != -1)
                ids_to_remove.push(new_id);
        }

        if(ids_to_remove.length > 0)
            console.log("Removing duplicate illustration IDs:", ids_to_remove.join(", "));
        illust_ids = illust_ids.slice();
        for(let new_id of ids_to_remove)
        {
            let idx = illust_ids.indexOf(new_id);
            illust_ids.splice(idx, 1);
        }

        // If there's nothing on this page, don't add it, so this doesn't increase
        // get_highest_loaded_page().
        // FIXME: If we removed everything, the data source will appear to have reached the last
        // page and we won't load any more pages, since thumbnail_view assumes that a page not
        // returning any data means we're at the end.
        if(illust_ids.length == 0)
            return;

        this.illust_ids_by_page.set(page, illust_ids);
    };

    // Return the page number illust_id is on, or null if we don't know.
    get_page_for_illust(illust_id)
    {
        for(let [page, ids] of this.illust_ids_by_page)
        {
            if(ids.indexOf(illust_id) != -1)
                return page;
        }
        return null;
    };

    // Return the next or previous illustration.  If we don't have that page, return null.
    //
    // This only returns illustrations, skipping over any special entries like user:12345.
    // If illust_id is null, start at the first loaded illustration.
    get_neighboring_illust_id(illust_id, next)
    {
        for(let i = 0; i < 100; ++i) // sanity limit
        {
            illust_id = this._get_neighboring_illust_id_internal(illust_id, next);
            if(illust_id == null)
                return null;

            // If it's not an illustration, keep looking.
            let { type } = helpers.parse_id(illust_id);
            if(type == "illust" || type == "file")
                return illust_id;
        }
        return null;
    }

    // The actual logic for get_neighboring_illust_id, except for skipping entries.
    _get_neighboring_illust_id_internal(illust_id, next)
    {
        if(illust_id == null)
            return this.get_first_id();

        let page = this.get_page_for_illust(illust_id);
        if(page == null)
            return null;

        let ids = this.illust_ids_by_page.get(page);
        let idx = ids.indexOf(illust_id);
        let new_idx = idx + (next? +1:-1);
        if(new_idx < 0)
        {
            // Return the last illustration on the previous page, or null if that page isn't loaded.
            let prev_page_no = page - 1;
            let prev_page_illust_ids = this.illust_ids_by_page.get(prev_page_no);
            if(prev_page_illust_ids == null)
                return null;
            return prev_page_illust_ids[prev_page_illust_ids.length-1];
        }
        else if(new_idx >= ids.length)
        {
            // Return the first illustration on the next page, or null if that page isn't loaded.
            let next_page_no = page + 1;
            let next_page_illust_ids = this.illust_ids_by_page.get(next_page_no);
            if(next_page_illust_ids == null)
                return null;
            return next_page_illust_ids[0];
        }
        else
        {
            return ids[new_idx];
        }
    };

    // Return the page we need to load to get the next or previous illustration.  This only
    // makes sense if get_neighboring_illust returns null.
    get_page_for_neighboring_illust(illust_id, next)
    {
        let page = this.get_page_for_illust(illust_id);
        if(page == null)
            return null;

        let ids = this.illust_ids_by_page.get(page);
        let idx = ids.indexOf(illust_id);
        let new_idx = idx + (next? +1:-1);
        if(new_idx >= 0 && new_idx < ids.length)
            return page;

        page += next? +1:-1;
        return page;
    };

    // Return the first ID, or null if we don't have any.
    get_first_id()
    {
        if(this.illust_ids_by_page.size == 0)
            return null;

        let keys = this.illust_ids_by_page.keys();
        let page = keys.next().value;
        return this.illust_ids_by_page.get(page)[0];
    }

    // Return true if the given page is loaded.
    is_page_loaded(page)
    {
        return this.illust_ids_by_page.has(page);
    }
};

// A data source asynchronously loads illust_ids to show.  The callback will be called
// with:
// {
//     'illust': {
//         illust_id1: illust_data1,
//         illust_id2: illust_data2,
//         ...
//     },
//     illust_ids: [illust_id1, illust_id2, ...]
//     next: function,
// }
//
// Some sources can retrieve user data, some can retrieve only illustration data, and
// some can't retrieve anything but IDs.
//
// The callback will always be called asynchronously, and data_source.callback can be set
// after creation.
//
// If "next" is included, it's a function that can be called to create a new data source
// to load the next page of data.  If there are no more pages, next will be null.

// A data source handles a particular source of images, depending on what page we're
// on:
//
// - Retrieves batches of image IDs to display, eg. a single page of bookmark results
// - Load another page of results with load_more()
// - Updates the page URL to reflect the current image
//
// Not all data sources have multiple pages.  For example, when we're viewing a regular
// illustration page, we get all of the author's other illust IDs at once, so we just
// load all of them as a single page.
ppixiv.data_source = class
{
    constructor(url)
    {
        this.url = new URL(url);
        this.id_list = new illust_id_list();
        this.update_callbacks = [];
        this.loading_pages = {};
        this.first_empty_page = -1;
        this.update_callbacks = [];

        // If this data source supports a start page, store the page we started on.
        // This isn't increased as we load more pages, but if we load earlier results
        // because the user clicks "load previous results", we'll reduce it.
        if(this.supports_start_page)
        {
            let args = new helpers.args(url);
            
            this.initial_page = this.get_start_page(args);
            console.log("Starting at page", this.initial_page);
        }
        else
            this.initial_page = 1;
    };

    // If a data source returns a name, we'll display any .data-source-specific elements in
    // the thumbnail view with that name.
    get name() { return null; }
    
    // Most data sources are for illustrations.  This is set to "users" for the followed view.
    get search_mode() { return "illusts"; }

    // Return a canonical URL for this data source.  If the canonical URL is the same,
    // the same instance of the data source should be used.
    //
    // A single data source is used eg. for a particular search and search flags.  If
    // flags are changed, such as changing filters, a new data source instance is created.
    // However, some parts of the URL don't cause a new data source to be used.  Return
    // a URL with all unrelated parts removed, and with query and hash parameters sorted
    // alphabetically.
    static get_canonical_url(url)
    {
        // Make a copy of the URL.
        var url = new URL(url);
        url = this.remove_ignored_url_parts(url);

        // Remove /en from the URL if it's present.
        url = helpers.get_url_without_language(url);

        // Sort query parameters.  We don't use multiple parameters with the same key.
        url.search = helpers.sort_query_parameters(url.searchParams).toString();

        let args = new helpers.args(url);

        // Sort hash parameters.
        args.hash = helpers.sort_query_parameters(args.hash);

        return args.url.toString();
    }

    // This is overridden by subclasses to remove parts of the URL that don't affect
    // which data source instance is used.
    static remove_ignored_url_parts(url)
    {
        let args = new helpers.args(url);

        // If p=1 is in the query, it's the page number, which doesn't affect the data source.
        args.query.delete("p");

        // The manga page doesn't affect the data source.
        args.hash.delete("page");

        // #view=thumbs controls which view is active.
        args.hash.delete("view");

        // illust_id in the hash is always just telling us which image within the current
        // data source to view.  data_source_current_illust is different and is handled in
        // the subclass.
        args.hash.delete("illust_id");

        // These are for temp view and don't affect the data source.
        args.hash.delete("virtual");
        args.hash.delete("temp-view");

        // This is for overriding muting.
        args.hash.delete("view-muted");

        // Ignore filenames for local IDs.
        args.hash.delete("file");

        return args.url;
    }

    // startup() is called when the data source becomes active, and shutdown is called when
    // it's done.  This can be used to add and remove event handlers on the UI.
    startup() 
    {
        this.active = true;
    }

    shutdown()
    {
        this.active = false;
    }

    // Load the given page, or the page of the current history state if page is null.
    // Call callback when the load finishes.
    //
    // If we synchronously know that the page doesn't exist, return false and don't
    // call callback.  Otherwise, return true.
    load_page(page, { cause }={})
    {
        var result = this.loading_pages[page];
        if(result == null)
        {
            var result = this._load_page_async(page, cause);
            this.loading_pages[page] = result;
            result.finally(() => {
                // console.log("finished loading page", page);
                delete this.loading_pages[page];
            });
        }

        return result;
    }

    // Return true if the given page is either loaded, or currently being loaded by a call to load_page.
    is_page_loaded_or_loading(page)
    {
        if(this.id_list.is_page_loaded(page))
            return true;
        if(this.loading_pages[page])
            return true;
        return false;
    }

    // Return true if any page is currently loading.
    get any_page_loading()
    {
        for(let page in this.loading_pages)
            if(this.loading_pages[page])
                return true;

        return false;
    }

    // Return true if the data source can load the given page.
    //
    // This returns false for the page before the first loaded page, even if the data source
    // is technically able to load it.  We can do that as a special case for the "load previous
    // results" button, which ignores this, but in most cases (such as clicking a page 1
    // link when on page 2), we don't and instead create a new data source.
    can_load_page(page)
    {
        // Most data sources can load any page if they haven't loaded a page yet.  Once
        // a page is loaded, they only load contiguous pages.
        if(!this.id_list.any_pages_loaded)
            return true;

        // If we've loaded pages 5-6, we can load anything between pages 4 and 7.
        let lowest_page = this.id_list.get_lowest_loaded_page();
        let highest_page = this.id_list.get_highest_loaded_page();
        return page >= lowest_page && page <= highest_page+1;
    }

    async _load_page_async(page, cause)
    {
        // Check if we're trying to load backwards too far.
        if(page < 1)
        {
            console.info("No pages before page 1");
            return false;
        }

        // If we know there's no data on this page (eg. we loaded an earlier page before and it
        // was empty), don't try to load this one.  This prevents us from spamming empty page
        // requests.
        if(this.first_empty_page != -1 && page >= this.first_empty_page)
            return false;

        // If the page is already loaded, stop.
        if(this.id_list.is_page_loaded(page))
            return true;
        
        // Check if this is past the end.
        if(!this.load_page_available(page))
            return false;
        
        console.log("Load page", page, "for:", cause);

        // Before starting, await at least once so we get pushed to the event loop.  This
        // guarantees that load_page has a chance to store us in this.loading_pages before
        // we do anything that might have side-effects of starting another load.
        await null;

        // Start the actual load.
        var result = await this.load_page_internal(page);

        // Reduce the start page, which will update the "load more results" button if any.  It's important
        // to do this after the await above.  If we do it before, it'll update the button before we load
        // and cause the button to update before the thumbs.  screen_search.refresh_images won't be able
        // to optimize that and it'll cause uglier refreshes.
        if(this.supports_start_page && page < this.initial_page)
            this.initial_page = page;

        // If there were no results, then we've loaded the last page.  Don't try to load
        // any pages beyond this.
        if(!this.id_list.illust_ids_by_page.has(page))
        {
            console.log("No data on page", page);
            if(this.first_empty_page == -1 || page < this.first_empty_page)
                this.first_empty_page = page;
        };

        return true;
    }

    // Return the illust_id to display by default.
    //
    // This should only be called after the initial data is loaded.
    get_current_illust_id()
    {
        // If we have an explicit illust_id in the hash, use it.  Note that some pages (in
        // particular illustration pages) put this in the query, which is handled in the particular
        // data source.
        let args = helpers.args.location;
        if(args.hash.has("illust_id"))
            return args.hash.get("illust_id");
        
        return this.id_list.get_first_id();
    };

    // If we're viewing a folder, return its ID.  This is used for local searches.
    get viewing_folder() { return null; }

    // Return the page title to use.
    get page_title()
    {
        return "Pixiv";
    }

    // Set the page icon.
    set_page_icon()
    {
        helpers.set_icon();
    }

    // This is implemented by the subclass.
    async load_page_internal(page)
    {
        throw "Not implemented";
    }

    // Return true if page is an available page (not past the end).
    //
    // We'll always stop if we read a page and it's empty.  This allows the extra
    // last request to be avoided if we know the last page earlier.
    load_page_available(page)
    {
        return true;
    }

    // This is called when the currently displayed illust_id changes.  The illust_id should
    // always have been loaded by this data source, so it should be in id_list.  The data
    // source should update the history state to reflect the current state.
    set_current_illust_id(illust_id, args)
    {
        if(this.supports_start_page)
        {
            // Store the page the illustration is on in the hash, so if the page is reloaded while
            // we're showing an illustration, we'll start on that page.  If we don't do this and
            // the user clicks something that came from page 6 while the top of the search results
            // were on page 5, we'll start the search at page 5 if the page is reloaded and not find
            // the image, which is confusing.
            var original_page = this.id_list.get_page_for_illust(illust_id);
            if(original_page != null)
                this.set_start_page(args, original_page);
        }

        // By default, put the illust_id in the hash.
        args.hash.set("illust_id", illust_id);
    }

    // Return the estimated number of items per page.
    get estimated_items_per_page()
    {
        // Most newer Pixiv pages show a grid of 6x8 images.  Try to match it, so page numbers
        // line up.
        return 48;
    };

    // Return the screen that should be displayed by default, if no "view" field is in the URL.
    get default_screen()
    {
        return "search";
    }

    // If we're viewing a page specific to a user (an illustration or artist page), return
    // the user ID we're viewing.  This can change when refreshing the UI.
    get viewing_user_id()
    {
        return null;
    };

    // If a data source is transient, it'll be discarded when the user navigates away instead of
    // reused.
    get transient() { return false; }

    // Some data sources can restart the search at a page.
    get supports_start_page() { return false; }

    // Store the current page in the URL.
    //
    // This is only used if supports_start_page is true.
    set_start_page(args, page)
    {
        // Remove the page for page 1 to keep the initial URL clean.
        if(page == 1)
            args.query.delete("p");
        else
            args.query.set("p", page);
    }

    get_start_page(args)
    {
        let page = args.query.get("p") || "1";
        return parseInt(page) || 1;
    }

    // Add or remove an update listener.  These are called when the data source has new data,
    // or wants a UI refresh to happen.
    add_update_listener(callback)
    {
        this.update_callbacks.push(callback);
    }

    remove_update_listener(callback)
    {
        var idx = this.update_callbacks.indexOf(callback);
        if(idx != -1)
            this.update_callbacks.splice(idx);
    }

    // Register a page of data.
    add_page(page, illust_ids)
    {
        this.id_list.add_page(page, illust_ids);

        // Call update listeners asynchronously to let them know we have more data.
        helpers.yield(() => {
            this.call_update_listeners();
        });
    }

    call_update_listeners()
    {
        var callbacks = this.update_callbacks.slice();
        for(var callback of callbacks)
            callback();
    }

    // Refresh parts of the UI that are specific to this data source.  This is only called
    // when first activating a data source, to update things like input fields that shouldn't
    // be overwritten on each refresh.
    initial_refresh_thumbnail_ui(container, view) { }

    // Each data source can have a different UI in the thumbnail view.  container is
    // the thumbnail-ui-box container to refresh.
    refresh_thumbnail_ui(container, view) { }

    // A helper for setting up UI links.  Find the link with the given data-type,
    // set all {key: value} entries as query parameters, and remove any query parameters
    // where value is null.  Set .selected if the resulting URL matches the current one.
    //
    // If default_values is present, it tells us the default key that will be used if
    // a key isn't present.  For example, search.php?s_mode=s_tag is the same as omitting
    // s_mode.  We prefer to omit it rather than clutter the URL with defaults, but we
    // need to know this to figure out whether an item is selected or not.
    //
    // If a key begins with #, it's placed in the hash rather than the query.
    set_item(container, type, fields, default_values, { current_url=null }={})
    {
        this.set_item2(container, {type: type, fields: fields, default_values: default_values, current_url: current_url });
    }

    set_item2(container, { type=null, fields=null, default_values=null, current_url=null, toggle=false }={})
    {
        let link = container.querySelector(`[data-type='${type}']`);
        if(link == null)
        {
            console.warn("Couldn't find button with selector", type);
            return;
        }

        // The URL the button is relative to:
        if(current_url == null)
            current_url = this.url;

        // Adjust the URL for this button.
        let args = new helpers.args(new URL(current_url));

        // Don't include the page number in search buttons, so clicking a filter goes
        // back to page 1.
        args.set("p", null);

        // This button is selected if all of the keys it sets are present in the URL.
        let button_is_selected = true;

        for(let [key, value] of Object.entries(fields))
        {
            // The value we're setting in the URL:
            var this_value = value;
            if(this_value == null && default_values != null)
                this_value = default_values[key];

            // The value currently in the URL:
            let selected_value = args.get(key);
            if(selected_value == null && default_values != null)
                selected_value = default_values[key];

            // If the URL didn't have the key we're setting, then it isn't selected.
            if(this_value != selected_value)
                button_is_selected = false;

            // If the value we're setting is the default, delete it instead.
            if(default_values != null && this_value == default_values[key])
                value = null;

            args.set(key, value);
        }

        // If this is a toggle and the button is selected, remove the fields, turning
        // this into an "off" button.
        if(toggle && button_is_selected)
        {
            for(let key of Object.keys(fields))
                args.set(key, null);
        }

        helpers.set_class(link, "selected", button_is_selected);
        link.href = args.url.toString();
    };

    // Like set_item for query and hash parameters, this sets parameters in the URL.
    //
    // Pixiv used to have clean, consistent URLs with page parameters in the query where
    // they belong, but recently they've started encoding them in an ad hoc way into the
    // path.  For example, what used to look like "/users/12345?type=illust" is now
    // "/users/12345/illustrations", so they can't be accessed in a generic way.
    //
    // index is the index into the path to replace.  In "/users/12345/abcd", "users" is
    // 0 and "abcd" is 2.  If the index doesn't exist, the path will be extended, so
    // replacing index 2 in "/users/12345" will become "/users/12345/abcd".  This only
    // makes sense when adding a single entry.
    //
    // Pixiv URLs can optionally have the language prefixed (which doesn't make sense).
    // This is handled automatically by get_path_part and set_path_part, and index should
    // always be for URLs without the language.
    set_path_item(container, type, index, value)
    {
        let link = container.querySelector("[data-type='" + type + "']");
        if(link == null)
        {
            console.warn("Couldn't find button with selector", type);
            return;
        }

        // Adjust the URL for this button.
        let url = new URL(this.url);

        // Don't include the page number in search buttons, so clicking a filter goes
        // back to page 1.
        url.searchParams.delete("p");

        // This button is selected if the given value was already set.
        let button_is_selected = helpers.get_path_part(url, index) == value;

        // Replace the path part.
        url = helpers.set_path_part(url, index, value);

        helpers.set_class(link, "selected", button_is_selected);

        link.href = url.toString();
    };
    
    // Set the active class on all top-level dropdowns which have something other than
    // the default selected.
    set_active_popup_highlight(container)
    {
        // popup-menu-box-button is buttons that have dropdowns.  Only affect .box-link,
        // so we don't mess with icons that are also buttons for popups.
        for(let button of container.querySelectorAll(".popup-menu-box-button.box-link"))
        {
            // See if this button has a dropdown menu.  This is set up by dropdown_menu_opener.
            let box = button.dropdownMenuBox;
            if(box == null)
                continue;

            // Find the selected item in the dropdown, if any.
            let selected_item = box.querySelector(".selected");
            let selected_default = selected_item == null || selected_item.dataset["default"];
            helpers.set_class(button, "active", !selected_default);
            helpers.set_class(box, "active", !selected_default);

            // Store the original text, so we can restore it when the default is selected.
            if(button.dataset.originalText == null)
                button.dataset.originalText = button.innerText;

            // If an option is selected, replace the menu button text with the selection's label.
            if(selected_default)
                button.innerText = button.dataset.originalText;
            else
            {
                // The short label is used to try to keep these labels from causing the menu buttons to
                // overflow the container, and for labels like "2 years ago" where the menu text doesn't
                // make sense.
                let label = selected_item.dataset.shortLabel;
                button.innerText = label? label:selected_item.innerText;
            }
        }
    }

    // Return true of the thumbnail view should show bookmark icons for this source.
    get show_bookmark_icons()
    {
        return true;
    }

    // URLs added to links will be included in the links at the top of the page when viewing an artist.
    add_extra_links(links)
    {
    }

    // Return the next or previous illustration.  If we don't have that page, return null.
    //
    // This only returns illustrations, skipping over any special entries like user:12345.
    get_neighboring_illust_id(illust_id, next)
    {
        return this.id_list.get_neighboring_illust_id(illust_id, next);
    }


    // Return the next or previous image to navigate to from illust_id.  If we're at the end of
    // the loaded results, load the next or previous page.  If illust_id is null, return the first
    // image.  This only returns illusts, not users or folders.
    //
    // This currently won't load more than one page.  If we load a page and it only has users,
    // we won't try another page.
    async get_or_load_neighboring_illust_id(illust_id, next)
    {
        let new_illust_id = this.get_neighboring_illust_id(illust_id, next);
        if(new_illust_id != null)
            return new_illust_id;

        // We didn't have the new illustration, so we may need to load another page of search results.
        // Find the page this illustration is on, or use the initial page if illust_id is null.
        let next_page = this.id_list.get_page_for_neighboring_illust(illust_id, next);
        if(illust_id == null)
            next_page = this.initial_page;

        // If we can't find the next page, then the image isn't actually loaded in the current
        // search results.  This can happen if the page is reloaded: we'll show the previous
        // image, but we won't have the results loaded (and the results may have changed).
        if(next_page == null)
        {
            // We should normally know which page the illustration we're currently viewing is on.
            console.log("Don't know the next page for illust", illust_id);
            return null;
        }

        console.log("Loading the next page of results:", next_page);

        // The page shouldn't already be loaded.  Double-check to help prevent bugs that might
        // spam the server requesting the same page over and over.
        if(this.id_list.is_page_loaded(next_page))
        {
            console.error("Page", next_page, "is already loaded");
            return null;
        }

        // Load a page.
        let new_page_loaded = await this.load_page(next_page, { cause: "illust navigation" });
        if(!new_page_loaded)
            return null;

        // Now that we've loaded data, try to find the new image again.
        console.log("Finishing navigation after data load");
        return this.id_list.get_neighboring_illust_id(illust_id, next);
    }
};

// Load a list of illust IDs, and allow retriving them by page.
function paginate_illust_ids(illust_ids, items_per_page)
{
    // Paginate the big list of results.
    var pages = [];
    var page = null;
    for(var illust_id of illust_ids)
    {
        if(page == null)
        {
            page = [];
            pages.push(page);
        }
        page.push(illust_id);
        if(page.length == items_per_page)
            page = null;
    }
    return pages;
}

// This extends data_source with local pagination.
//
// A few API calls just return all results as a big list of IDs.  We can handle loading
// them all at once, but it results in a very long scroll box, which makes scrolling
// awkward.  This artificially paginates the results.
class data_source_fake_pagination extends data_source
{
    async load_page_internal(page)
    {
        if(this.pages == null)
        {
            var illust_ids = await this.load_all_results();
            this.pages = paginate_illust_ids(illust_ids, this.estimated_items_per_page);
        }

        // Register this page.
        var illust_ids = this.pages[page-1] || [];
        this.add_page(page, illust_ids);
    }

    // Implemented by the subclass.  Load all results, and return the resulting IDs.
    async load_all_results()
    {
        throw "Not implemented";
    }
}

// /discovery - Recommended Works
ppixiv.data_sources.discovery = class extends data_source
{
    get name() { return "discovery"; }

    get estimated_items_per_page() { return 60; }

    async load_page_internal(page)
    {
        // Get "mode" from the URL.  If it's not present, use "all".
        let mode = this.url.searchParams.get("mode") || "all";
        let result = await helpers.get_request("/ajax/discovery/artworks", {
            limit: this.estimated_items_per_page,
            mode: mode,
            lang: "en",
        });

        // result.body.recommendedIllusts[].recommendMethods, recommendSeedIllustIds
        // has info about why it recommended it.
        let thumbs = result.body.thumbnails.illust;
        thumbnail_data.singleton().loaded_thumbnail_info(thumbs, "normal");

        let illust_ids = [];
        for(let thumb of thumbs)
            illust_ids.push(thumb.id);

        tag_translations.get().add_translations_dict(result.body.tagTranslation);
        this.add_page(page, illust_ids);
    };

    get page_title() { return "Discovery"; }
    get_displaying_text() { return "Recommended Works"; }

    refresh_thumbnail_ui(container)
    {
        // Set .selected on the current mode.
        let current_mode = this.url.searchParams.get("mode") || "all";
        helpers.set_class(container.querySelector(".box-link[data-type=all]"), "selected", current_mode == "all");
        helpers.set_class(container.querySelector(".box-link[data-type=safe]"), "selected", current_mode == "safe");
        helpers.set_class(container.querySelector(".box-link[data-type=r18]"), "selected", current_mode == "r18");
    }
}

// bookmark_detail.php#recommendations=1 - Similar Illustrations
//
// We use this as an anchor page for viewing recommended illusts for an image, since
// there's no dedicated page for this.
ppixiv.data_sources.related_illusts = class extends data_source
{
    get name() { return "related-illusts"; }
   
    get estimated_items_per_page() { return 60; }

    async _load_page_async(page, cause)
    {
        // The first time we load a page, get info about the source illustration too, so
        // we can show it in the UI.
        if(!this.fetched_illust_info)
        {
            this.fetched_illust_info = true;

            // Don't wait for this to finish before continuing.
            let illust_id = this.url.searchParams.get("illust_id");
            image_data.singleton().get_image_info(illust_id).then((illust_info) => {
                this.illust_info = illust_info;
                this.call_update_listeners();
            }).catch((e) => {
                console.error(e);
            });
        }

        return await super._load_page_async(page, cause);
    }
     
    async load_page_internal(page)
    {
        // Get "mode" from the URL.  If it's not present, use "all".
        let mode = this.url.searchParams.get("mode") || "all";
        let result = await helpers.get_request("/ajax/discovery/artworks", {
            sampleIllustId: this.url.searchParams.get("illust_id"),
            mode: mode,
            limit: this.estimated_items_per_page,
            lang: "en",
        });

        // result.body.recommendedIllusts[].recommendMethods, recommendSeedIllustIds
        // has info about why it recommended it.
        let thumbs = result.body.thumbnails.illust;
        thumbnail_data.singleton().loaded_thumbnail_info(thumbs, "normal");

        let illust_ids = [];
        for(let thumb of thumbs)
            illust_ids.push(thumb.id);

        tag_translations.get().add_translations_dict(result.body.tagTranslation);
        this.add_page(page, illust_ids);
    };

    get page_title() { return "Similar Illusts"; }
    get_displaying_text() { return "Similar Illustrations"; }

    refresh_thumbnail_ui(container)
    {
        // Set the source image.
        var source_link = container.querySelector(".image-for-suggestions");
        source_link.hidden = this.illust_info == null;
        if(this.illust_info)
        {
            source_link.href = "/artworks/" + this.illust_info.illustId + "#ppixiv";

            var img = source_link.querySelector(".image-for-suggestions > img");
            img.src = this.illust_info.previewUrls[0];
        }
    }
}

// Artist suggestions take a random sample of followed users, and query suggestions from them.
// The followed user list normally comes from /discovery/users.
//
// This can also be used to view recommendations based on a specific user.  Note that if we're
// doing this, we don't show things like the artist's avatar in the corner, so it doesn't look
// like the images we're showing are by that user.
ppixiv.data_sources.discovery_users = class extends data_source
{
    get name() { return "discovery_users"; }

    constructor(url)
    {
        super(url);

        let args = new helpers.args(this.url);
        let user_id = args.hash.get("user_id");
        if(user_id != null)
            this.showing_user_id = user_id;

        this.original_url = url;
        this.seen_user_ids = {};
    }

    get users_per_page() { return 20; }
    get estimated_items_per_page()
    {
        let illusts_per_user = this.showing_user_id != null? 3:5;
        return this.users_per_page + (users_per_page * illusts_per_user);
    }
    
    async load_page_internal(page)
    {
        if(this.showing_user_id != null)
        {
            // Make sure the user info is loaded.
            this.user_info = await image_data.singleton().get_user_info_full(this.showing_user_id);

            // Update to refresh our page title, which uses user_info.
            this.call_update_listeners();
        }
 
        // Get suggestions.  Each entry is a user, and contains info about a small selection of
        // images.
        let result;
        if(this.showing_user_id != null)
        {
            result = await helpers.get_request(`/ajax/user/${this.showing_user_id}/recommends`, {
                userNum: this.users_per_page,
                workNum: 8,
                isR18: true,
                lang: "en"
            });
        } else {
            result = await helpers.get_request("/ajax/discovery/users", {
                limit: this.users_per_page,
                lang: "en",
            });

            // This one includes tag translations.
            tag_translations.get().add_translations_dict(result.body.tagTranslation);
        }

        if(result.error)
            throw "Error reading suggestions: " + result.message;

        thumbnail_data.singleton().loaded_thumbnail_info(result.body.thumbnails.illust, "normal");

        for(let user of result.body.users)
        {
            image_data.singleton().add_user_data(user);

            // Register this as quick user data, for use in thumbnails.
            thumbnail_data.singleton().add_quick_user_data(user, "recommendations");
        }

        // Pixiv's motto: "never do the same thing the same way twice"
        // ajax/user/#/recommends is body.recommendUsers and user.illustIds.
        // discovery/users is body.recommendedUsers and user.recentIllustIds.
        let recommended_users = result.body.recommendUsers || result.body.recommendedUsers;
        let illust_ids = [];
        for(let user of recommended_users)
        {
            // Each time we load a "page", we're actually just getting a new randomized set of recommendations
            // for our seed, so we'll often get duplicate results.  Ignore users that we've seen already.  id_list
            // will remove dupes, but we might get different sample illustrations for a duplicated artist, and
            // those wouldn't be removed.
            if(this.seen_user_ids[user.userId])
                continue;
            this.seen_user_ids[user.userId] = true;

            illust_ids.push("user:" + user.userId);
            
            let illustIds = user.illustIds || user.recentIllustIds;
            for(let illust_id of illustIds)
                illust_ids.push(illust_id);
        }

        // Register the new page of data.
        this.add_page(page, illust_ids);
    }

    load_page_available(page)
    {
        // If we're showing similar users, only show one page, since the API returns the
        // same thing every time.
        if(this.showing_user_id)
            return page == 1;

        return true;
    }

    get estimated_items_per_page() { return 30; }
    get page_title()
    {
        if(this.showing_user_id == null)
            return "Recommended Users";

        if(this.user_info)
            return this.user_info.name;
        else
            return "Loading...";
    }
    
    get_displaying_text()
    {
        if(this.showing_user_id == null)
            return "Recommended Users";

        if(this.user_info)
            return "Similar artists to " + this.user_info.name;
        else
            return "Illustrations";
    };

    refresh_thumbnail_ui(container)
    {
    }
};

// /ranking.php
//
// This one has an API, and also formats the first page of results into the page.
// They have completely different formats, and the page is updated dynamically (unlike
// the pages we scrape), so we ignore the page for this one and just use the API.
//
// An exception is that we load the previous and next days from the page.  This is better
// than using our current date, since it makes sure we have the same view of time as
// the search results.
ppixiv.data_sources.rankings = class extends data_source
{
    constructor(url)
    {
        super(url);

        this.max_page = 999999;
    }
    
    get name() { return "rankings"; }

    load_page_available(page)
    {
        return page <= this.max_page;
    }

    async load_page_internal(page)
    {

        /*
        "mode": "daily",
        "content": "all",
        "page": 1,
        "prev": false,
        "next": 2,
        "date": "20180923",
        "prev_date": "20180922",
        "next_date": false,
        "rank_total": 500        
        */

        // Get "mode" from the URL.  If it's not present, use "all".
        var query_args = this.url.searchParams;
        
        var data = {
            format: "json",
            p: page,
        };

        var date = query_args.get("date");
        if(date)
            data.date = date;

        var content = query_args.get("content");
        if(content)
            data.content = content;

        var mode = query_args.get("mode");
        if(mode)
            data.mode = mode;

        var result = await helpers.get_request("/ranking.php", data);

        // If "next" is false, this is the last page.
        if(!result.next)
            this.max_page = Math.min(page, this.max_page);

        // Fill in the next/prev dates for the navigation buttons, and the currently
        // displayed date.
        if(this.today_text == null)
        {
            this.today_text = result.date;

            // This is "YYYYMMDD".  Reformat it.
            if(this.today_text.length == 8)
            {
                var year = this.today_text.slice(0,4);
                var month = this.today_text.slice(4,6);
                var day = this.today_text.slice(6,8);
                this.today_text = year + "/" + month + "/" + day;
            }
        }

        if(this.prev_date == null && result.prev_date)
            this.prev_date = result.prev_date;
        if(this.next_date == null && result.next_date)
            this.next_date = result.next_date;
    
        // This returns a struct of data that's like the thumbnails data response,
        // but it's not quite the same.
        var illust_ids = [];
        for(var item of result.contents)
        {
            // Most APIs return IDs as strings, but this one returns them as ints.
            // Convert them to strings.
            var illust_id = "" + item.illust_id;
            var user_id = "" + item.user_id;
            illust_ids.push(illust_id);
        }

        // Register this as thumbnail data.
        thumbnail_data.singleton().loaded_thumbnail_info(result.contents, "rankings");
        
        // Register the new page of data.
        this.add_page(page, illust_ids);
    };

    get estimated_items_per_page() { return 50; }

    get page_title() { return "Rankings"; }
    get_displaying_text() { return "Rankings"; }

    refresh_thumbnail_ui(container)
    {
        var query_args = this.url.searchParams;
        
        this.set_item(container, "content-all", {content: null});
        this.set_item(container, "content-illust", {content: "illust"});
        this.set_item(container, "content-ugoira", {content: "ugoira"});
        this.set_item(container, "content-manga", {content: "manga"});

        this.set_item(container, "mode-daily", {mode: null}, {mode: "daily"});
        this.set_item(container, "mode-daily-r18", {mode: "daily_r18"});
        this.set_item(container, "mode-r18g", {mode: "r18g"});
        this.set_item(container, "mode-weekly", {mode: "weekly"});
        this.set_item(container, "mode-monthly", {mode: "monthly"});
        this.set_item(container, "mode-rookie", {mode: "rookie"});
        this.set_item(container, "mode-original", {mode: "original"});
        this.set_item(container, "mode-male", {mode: "male"});
        this.set_item(container, "mode-female", {mode: "female"});

        if(this.today_text)
            container.querySelector(".nav-today").innerText = this.today_text;

        // This UI is greyed rather than hidden before we have the dates, so the UI doesn't
        // shift around as we load.
        var yesterday = container.querySelector(".nav-yesterday");
        helpers.set_class(yesterday, "disabled", this.prev_date == null);
        if(this.prev_date)
        {
            let url = new URL(this.url);
            url.searchParams.set("date", this.prev_date);
            yesterday.href = url;
        }

        var tomorrow = container.querySelector(".nav-tomorrow");
        helpers.set_class(tomorrow, "disabled", this.next_date == null);
        if(this.next_date)
        {
            let url = new URL(this.url);
            url.searchParams.set("date", this.next_date);
            tomorrow.href = url;
        }

        // Not all combinations of content and mode exist.  For example, there's no ugoira
        // monthly, and we'll get an error page if we load it.  Hide navigations that aren't
        // available.  This isn't perfect: if you want to choose ugoira when you're on monthly
        // you need to select a different time range first.  We could have the content links
        // switch to daily if not available...
        var available_combinations = [
            "all/daily",
            "all/daily_r18",
            "all/r18g",
            "all/weekly",
            "all/monthly",
            "all/rookie",
            "all/original",
            "all/male",
            "all/female",

            "illust/daily",
            "illust/daily_r18",
            "illust/r18g",
            "illust/weekly",
            "illust/monthly",
            "illust/rookie",

            "ugoira/daily",
            "ugoira/weekly",
            "ugoira/daily_r18",

            "manga/daily",
            "manga/daily_r18",
            "manga/r18g",
            "manga/weekly",
            "manga/monthly",
            "manga/rookie",
        ];

        // Check each link in both checked-links sections.
        for(var a of container.querySelectorAll(".checked-links a"))
        {
            let url = new URL(a.href, this.url);
            var link_content = url.searchParams.get("content") || "all";
            var link_mode = url.searchParams.get("mode") || "daily";
            var name = link_content + "/" + link_mode;

            var available = available_combinations.indexOf(name) != -1;

            var is_content_link = a.dataset.type.startsWith("content");
            if(is_content_link)
            {
                // If this is a content link (eg. illustrations) and the combination of the
                // current time range and this content type isn't available, make this link
                // go to daily rather than hiding it, so all content types are always available
                // and you don't have to switch time ranges just to select a different type.
                if(!available)
                {
                    url.searchParams.delete("mode");
                    a.href = url;
                }
            }
            else
            {
                // If this is a mode link (eg. weekly) and it's not available, just hide
                // the link.
                a.hidden = !available;
            }
        }
    }
}

// This is a base class for data sources that work by loading a regular Pixiv page
// and scraping it.
//
// All of these work the same way.  We keep the current URL (ignoring the hash) synced up
// as a valid page URL that we can load.  If we change pages or other search options, we
// modify the URL appropriately.
class data_source_from_page extends data_source
{
    constructor(url)
    {
        super(url);

        this.items_per_page = 1;
        this.original_url = url;
    }

    get estimated_items_per_page() { return this.items_per_page; }

    async load_page_internal(page)
    {
        // Our page URL looks like eg.
        //
        // https://www.pixiv.net/bookmark.php?p=2
        //
        // possibly with other search options.  Request the current URL page data.
        var url = new unsafeWindow.URL(this.url);

        // Update the URL with the current page.
        url.searchParams.set("p", page);

        console.log("Loading:", url.toString());

        let doc = await helpers.load_data_in_iframe(url);

        let illust_ids = this.parse_document(doc);
        if(illust_ids == null)
        {
            // The most common case of there being no data in the document is loading
            // a deleted illustration.  See if we can find an error message.
            console.error("No data on page");
            return;
        }

        // Assume that if the first request returns 10 items, all future pages will too.  This
        // is usually correct unless we happen to load the last page last.  Allow this to increase
        // in case that happens.  (This is only used by the thumbnail view.)
        if(this.items_per_page == 1)
            this.items_per_page = Math.max(illust_ids.length, this.items_per_page);

        // Register the new page of data.
        this.add_page(page, illust_ids);
    }

    // Parse the loaded document and return the illust_ids.
    parse_document(doc)
    {
        throw "Not implemented";
    }
};

// - User illustrations
//
// /users/# 
// /users/#/artworks
// /users/#/illustrations
// /users/#/manga
//
// We prefer to link to the /artworks page, but we handle /users/# as well.
ppixiv.data_sources.artist = class extends data_source
{
    get name() { return "artist"; }
  
    constructor(url)
    {
        super(url);

        this.fanbox_url = null;
    }

    get supports_start_page() { return true; }

    get viewing_user_id()
    {
        // /users/13245
        return helpers.get_path_part(this.url, 1);
    };

    startup()
    {
        super.startup();

        // While we're active, watch for the tags box to open.  We only populate the tags
        // dropdown if it's opened, so we don't load user tags for every user page.
        var popup = document.body.querySelector(".member-tags-box > .popup-menu-box");
        this.src_observer = new MutationObserver((mutation_list) => {
            if(popup.classList.contains("popup-visible"))
                this.tag_list_opened();
        });
        this.src_observer.observe(popup, { attributes: true });
    }

    shutdown()
    {
        super.shutdown();

        // Remove our MutationObserver.
        this.src_observer.disconnect();
        this.src_observer = null;
    }
    
    // Return "artworks" (all), "illustrations" or "manga".
    get viewing_type()
    {
        // The URL is one of:
        //
        // /users/12345
        // /users/12345/artworks
        // /users/12345/illustrations
        // /users/12345/manga
        //
        // The top /users/12345 page is the user's profile page, which has the first page of images, but
        // instead of having a link to page 2, it only has "See all", which goes to /artworks and shows you
        // page 1 again.  That's pointless, so we treat the top page as /artworks the same.  /illustrations
        // and /manga filter those types.
        let url = helpers.get_url_without_language(this.url);
        let parts = url.pathname.split("/");
        return parts[3] || "artworks";
    }

    async load_page_internal(page)
    {
        let viewing_type = this.type;
        
        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        this.user_info = await image_data.singleton().get_user_info_full(this.viewing_user_id);

        // Update to refresh our page title, which uses user_info.
        this.call_update_listeners();

        let args = new helpers.args(this.url);
        var tag = args.query.get("tag") || "";
        if(tag == "")
        {
            // If we're not filtering by tag, use the profile/all request.  This returns all of
            // the user's illust IDs but no thumb data.
            //
            // We can use the "illustmanga" code path for this by leaving the tag empty, but
            // we do it this way since that's what the site does.
            if(this.pages == null)
            {
                let all_illust_ids = await this.load_all_results();
                this.pages = paginate_illust_ids(all_illust_ids, this.estimated_items_per_page);
            }

            let illust_ids = this.pages[page-1] || [];

            if(illust_ids.length)
            {
                // That only gives us a list of illust IDs, so we have to load them.  Annoyingly, this
                // is the one single place it gives us illust info in bulk instead of thumbnail data.
                // It would be really useful to be able to batch load like this in general, but this only
                // works for a single user's posts.
                let url = `/ajax/user/${this.viewing_user_id}/profile/illusts`;
                let result = await helpers.get_request(url, {
                    "ids[]": illust_ids,
                    work_category: "illustManga",
                    is_first_page: "0",
                });
                
                let illusts = Object.values(result.body.works);
                thumbnail_data.singleton().loaded_thumbnail_info(illusts, "normal");
            }

            // Don't do this.  image_data assumes that if we have illust data, we want all data,
            // like manga pages, and it'll make a request for each one to add the missing info.
            // Just register it as thumbnail info.
            // for(let illust_data in illusts)
            //     await image_data.singleton().add_illust_data(illust_data);

            // Register this page.
            this.add_page(page, illust_ids);
        }
        else
        {
            // We're filtering by tag.
            var type = args.query.get("type");

            // For some reason, this API uses a random field in the URL for the type instead of a normal
            // query parameter.
            var type_for_url =
                type == null? "illustmanga":
                type == "illust"?"illusts":
                "manga";

            var request_url = "/ajax/user/" + this.viewing_user_id + "/" + type_for_url + "/tag";
            var result = await helpers.get_request(request_url, {
                tag: tag,
                offset: (page-1)*48,
                limit: 48,
            });

            // This data doesn't have profileImageUrl or userName.  That's presumably because it's
            // used on user pages which get that from user data, but this seems like more of an
            // inconsistency than an optimization.  Fill it in for thumbnail_data.
            for(var item of result.body.works)
            {
                item.userName = this.user_info.name;
                item.profileImageUrl = this.user_info.imageBig;
            }

            var illust_ids = [];
            for(var illust_data of result.body.works)
                illust_ids.push(illust_data.id);
            
            // This request returns all of the thumbnail data we need.  Forward it to
            // thumbnail_data so we don't need to look it up.
            thumbnail_data.singleton().loaded_thumbnail_info(result.body.works, "normal");

            // Register the new page of data.
            this.add_page(page, illust_ids);
        }
    }
    
    add_extra_links(links)
    {
        // Add the Fanbox link to the list if we have one.
        if(this.fanbox_url)
            links.push({url: this.fanbox_url, label: "Fanbox"});
    }

    async load_all_results()
    {
        this.call_update_listeners();

        var query_args = this.url.searchParams;
        let type = this.viewing_type;

        var result = await helpers.get_request("/ajax/user/" + this.viewing_user_id + "/profile/all", {});

        // See if there's a Fanbox link.
        //
        // For some reason Pixiv supports links to Twitter and Pawoo natively in the profile, but Fanbox
        // can only be linked in this weird way outside the regular user profile info.
        for(let pickup of result.body.pickup)
        {
            if(pickup.type != "fanbox")
                continue;

            // Remove the Google analytics junk from the URL.
            let url = new URL(pickup.contentUrl);
            url.search = "";
            this.fanbox_url = url.toString();
            this.call_update_listeners();
        }

        var illust_ids = [];
        if(type == "artworks" || type == "illustrations")
            for(var illust_id in result.body.illusts)
                illust_ids.push(illust_id);
        if(type == "artworks" || type == "manga")
            for(var illust_id in result.body.manga)
                illust_ids.push(illust_id);

        // Sort the two sets of IDs back together, putting higher (newer) IDs first.
        illust_ids.sort(function(lhs, rhs)
        {
            return parseInt(rhs) - parseInt(lhs);
        });

        return illust_ids;
    };

    refresh_thumbnail_ui(container, thumbnail_view)
    {
        thumbnail_view.avatar_container.hidden = false;
        thumbnail_view.avatar_widget.set_user_id(this.viewing_user_id);

        let viewing_type = this.viewing_type;
        let url = new URL(this.url);

        this.set_path_item(container, "artist-works", 2, "");
        this.set_path_item(container, "artist-illust", 2, "illustrations");
        this.set_path_item(container, "artist-manga", 2, "manga");

        // Refresh the post tag list.
        var query_args = this.url.searchParams;
        var current_query = query_args.toString();
        
        var tag_list = container.querySelector(".post-tag-list");
        helpers.remove_elements(tag_list);
        
        var add_tag_link = (tag_info) =>
        {
            // Skip tags with very few posts.  This list includes every tag the author
            // has ever used, and ends up being pages long with tons of tags that were
            // only used once.
            if(tag_info.tag != "All" && tag_info.cnt < 5)
                return;

            let tag = tag_info.tag;
            let translated_tag = tag;
            if(this.translated_tags[tag])
                translated_tag = this.translated_tags[tag];

            var a = document.createElement("a");
            a.classList.add("box-link");
            a.classList.add("following-tag");
            a.innerText = translated_tag;

            // Show the post count in the popup.
            a.classList.add("popup");
            a.dataset.popup = tag_info.cnt != null? tag_info.cnt:"";

            let url = new URL(this.url);
            url.hash = "#ppixiv";

            if(tag != "All")
                url.searchParams.set("tag", tag);
            else
            {
                url.searchParams.delete("tag");
                a.dataset["default"] = 1;
            }

            a.href = url.toString();
            if(url.searchParams.toString() == current_query)
                a.classList.add("selected");
            tag_list.appendChild(a);
        };

        if(this.post_tags != null)
        {
            add_tag_link({ tag: "All" });
            for(let tag_info of this.post_tags || [])
                add_tag_link(tag_info);
        }
        else
        {
            // Tags aren't loaded yet.  We'll be refreshed after tag_list_opened loads tags.
            var span = document.createElement("span");
            span.innerText = "Loading...";
            tag_list.appendChild(span);
        }

        // Set whether the tags menu item is highlighted.  We don't use set_active_popup_highlight
        // here so we don't need to load the tag list.
        var box = container.querySelector(".member-tags-box");
        helpers.set_class(box, "active", query_args.has("tag"));
    }

    // This is called when the tag list dropdown is opened.
    async tag_list_opened()
    {
        // Get user info.  We probably have this on this.user_info, but that async load
        // might not be finished yet.
        var user_info = await image_data.singleton().get_user_info_full(this.viewing_user_id);
        console.log("Loading tags for user", user_info.userId);

        // Load the user's common tags.
        this.post_tags = await this.get_user_tags(user_info);

        let tags = [];
        for(let tag_info of this.post_tags)
            tags.push(tag_info.tag);
        this.translated_tags = await tag_translations.get().get_translations(tags, "en");

        // If we became inactive before the above request finished, stop.
        if(!this.active)
            return;

        // Trigger refresh_thumbnail_ui to fill in tags.
        this.call_update_listeners();
    }

    async get_user_tags(user_info)
    {
        if(user_info.frequentTags)
            return user_info.frequentTags;

        var result = await helpers.get_request("/ajax/user/" + user_info.userId + "/illustmanga/tags", {});
        if(result.error)
        {
            console.error("Error fetching tags for user " + user_info.userId + ": " + result.error);
            user_info.frequentTags = [];
            return user_info.frequentTags;
        }

        // Sort most frequent tags first.
        result.body.sort(function(lhs, rhs) {
            return rhs.cnt - lhs.cnt;
        })

        // Store translations.
        let translations = [];
        for(let tag_info of result.body)
        {
            if(tag_info.tag_translation == "")
                continue;

            translations.push({
                tag: tag_info.tag,
                translation: {
                    en: tag_info.tag_translation,
                },
            });
        }
        tag_translations.get().add_translations(translations);

        // Cache the results on the user info.
        user_info.frequentTags = result.body;
        return result.body;
    }

    get page_title()
    {
        if(this.user_info)
            return this.user_info.name;
        else
            return "Loading...";
    }

    get_displaying_text()
    {
        if(this.user_info)
            return this.user_info.name + "'s Illustrations";
        else
            return "Illustrations";
    };
}

// /artworks/# - Viewing a single illustration
//
// This is a stub for when we're viewing an image with no search.  it
// doesn't return any search results.
ppixiv.data_sources.current_illust = class extends data_source
{
    get name() { return "illust"; }

    constructor(url)
    {
        super(url);

        // /artworks/#
        url = new URL(url);
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");
        this.illust_id = parts[2];
    }

    // Show the illustration by default.
    get default_screen()
    {
        return "illust";
    }

    // This data source just views a single image and doesn't return any posts.
    async load_page_internal(page) { }

    // We're always viewing our illust_id.
    get_current_illust_id() { return this.illust_id; }

    // We don't return any posts to navigate to, but this can still be called by
    // quick view.
    set_current_illust_id(illust_id, args)
    {
        // Pixiv's inconsistent URLs are annoying.  Figure out where the ID field is.
        // If the first field is a language, it's the third field (/en/artworks/#), otherwise
        // it's the second (/artworks/#).
        let parts = args.path.split("/");
        let id_part = parts[1].length == 2? 3:2;
        parts[id_part] = illust_id;
        args.path = parts.join("/");
    }

    get viewing_user_id()
    {
        if(this.user_info == null)
            return null;
        return this.user_info.userId;
    };
};

// bookmark.php
// /users/12345/bookmarks
//
// If id is in the query, we're viewing another user's bookmarks.  Otherwise, we're
// viewing our own.
//
// Pixiv currently serves two unrelated pages for this URL, using an API-driven one
// for viewing someone else's bookmarks and a static page for viewing your own.  We
// always use the API in either case.
//
// For some reason, Pixiv only allows viewing either public or private bookmarks,
// and has no way to just view all bookmarks.
class data_source_bookmarks_base extends data_source
{
    get name() { return "bookmarks"; }
  
    constructor(url)
    {
        super(url);

        this.bookmark_tag_counts = [];

        // The subclass sets this once it knows the number of bookmarks in this search.
        this.total_bookmarks = -1;
    }

    async load_page_internal(page)
    {
        this.fetch_bookmark_tag_counts();
        
        // Load the user's info.  We don't need to wait for this to finish.
        let user_info_promise = image_data.singleton().get_user_info_full(this.viewing_user_id);
        user_info_promise.then((user_info) => {
            // Stop if we were deactivated before this finished.
            if(!this.active)
                return;

            this.user_info = user_info;
            this.call_update_listeners();
        });

        await this.continue_loading_page_internal(page);
    };

    get supports_start_page()
    {
        // Disable start pages when we're shuffling pages anyway.
        return !this.shuffle;
    }

    get displaying_tag()
    {
        let url = helpers.get_url_without_language(this.url);
        let parts = url.pathname.split("/");
        if(parts.length < 6)
            return null;

        // Replace 未分類 with "" for uncategorized.
        let tag = decodeURIComponent(parts[5]);
        if(tag == "未分類")
            return "";
        return tag;
    }

    // If we haven't done so yet, load bookmark tags for this bookmark page.  This
    // happens in parallel with with page loading.
    async fetch_bookmark_tag_counts()
    {
        if(this.fetched_bookmark_tag_counts)
            return;
        this.fetched_bookmark_tag_counts = true;

        // If we have cached bookmark counts for ourself, load them.
        if(this.viewing_own_bookmarks() && data_source_bookmarks_base.cached_bookmark_tag_counts != null)
            this.load_bookmark_tag_counts(data_source_bookmarks_base.cached_bookmark_tag_counts);
        
        // Fetch bookmark tags.  We can do this in parallel with everything else.
        var url = "/ajax/user/" + this.viewing_user_id + "/illusts/bookmark/tags";
        var result = await helpers.get_request(url, {});

        // Cache this if we're viewing our own bookmarks, so we can display them while
        // navigating bookmarks.  We'll still refresh it as each page loads.
        if(this.viewing_own_bookmarks())
            data_source_bookmarks_base.cached_bookmark_tag_counts = result.body;

        this.load_bookmark_tag_counts(result.body);
    }

    load_bookmark_tag_counts(result)
    {
        let public_bookmarks = this.viewing_public;
        let private_bookmarks = this.viewing_private;

        // Reformat the tag list into a format that's easier to work with.
        let tags = { };
        for(let privacy of ["public", "private"])
        {
            let public_tags = privacy == "public";
            if((public_tags && !public_bookmarks) ||
              (!public_tags && !private_bookmarks))
                continue;

            let tag_counts = result[privacy];
            for(let tag_info of tag_counts)
            {
                let tag = tag_info.tag;

                // Rename "未分類" (uncategorized) to "".
                if(tag == "未分類")
                    tag = "";
                
                if(tags[tag] == null)
                    tags[tag] = 0;

                // Add to the tag count.
                tags[tag] += tag_info.cnt;
            }
        }

        // Fill in total_bookmarks from the tag count.  We'll get this from the search API,
        // but we can have it here earlier if we're viewing our own bookmarks and
        // cached_bookmark_tag_counts is filled in.  We can't do this when viewing all bookmarks
        // (summing the counts will give the wrong answer whenever multiple tags are used on
        // one bookmark).
        let displaying_tag = this.displaying_tag;
        if(displaying_tag != null && this.total_bookmarks == -1)
        {
            let count = tags[displaying_tag];
            if(count != null)
                this.total_bookmarks = count;
        }

        // Sort tags by count, so we can trim just the most used tags.  Use the count for the
        // display mode we're in.
        var all_tags = Object.keys(tags);
        all_tags.sort(function(lhs, rhs) {
            return tags[lhs].count - tags[lhs].count;
        });

        if(!this.viewing_own_bookmarks())
        {
            // Trim the list when viewing other users.  Some users will return thousands of tags.
            all_tags.splice(20);
        }

        all_tags.sort();
        this.bookmark_tag_counts = {};
        for(let tag of all_tags)
            this.bookmark_tag_counts[tag] = tags[tag];

        // Update the UI with the tag list.
        this.call_update_listeners();
    }
    
    // Get API arguments to query bookmarks.
    //
    // If force_rest isn't null, it's either "show" (public) or "hide" (private), which
    // overrides the search parameters.
    get_bookmark_query_params(page, force_rest)
    {
        var query_args = this.url.searchParams;
        var rest = query_args.get("rest") || "show";
        if(force_rest != null)
            rest = force_rest;

        let tag = this.displaying_tag;
        if(tag == "")
            tag = "未分類"; // Uncategorized
        else if(tag == null)
            tag = "";

        // Load 20 results per page, so our page numbers should match the underlying page if
        // the UI is disabled.
        return {
            tag: tag,
            offset: (page-1)*this.estimated_items_per_page,
            limit: this.estimated_items_per_page,
            rest: rest, // public or private (no way to get both)
        };
    }

    async request_bookmarks(page, rest)
    {
        let data = this.get_bookmark_query_params(page, rest);
        let url = `/ajax/user/${this.viewing_user_id}/illusts/bookmarks`;
        let result = await helpers.get_request(url, data);

        if(this.viewing_own_bookmarks())
        {
            // This request includes each bookmark's tags.  Register those with image_data,
            // so the bookmark tag dropdown can display tags more quickly.
            for(let illust of result.body.works)
            {
                let bookmark_id = illust.bookmarkData.id;
                let tags = result.body.bookmarkTags[bookmark_id] || [];

                // illust.id is an int if this image is deleted.  Convert it to a string so it's
                // like other images.
                image_data.singleton().update_cached_bookmark_image_tags(illust.id.toString(), tags);
            }
        }

        result.body.works = data_source_bookmarks_base.filter_deleted_images(result.body.works);
        return result.body;
    }

    // This is implemented by the subclass to do the main loading.
    async continue_loading_page_internal(page)
    {
        throw "Not implemented";
    }

    get page_title()
    {
        if(!this.viewing_own_bookmarks())
        {
            if(this.user_info)
                return this.user_info.name + "'s Bookmarks";
            else
                return "Loading...";
        }

        return "Bookmarks";
    }

    get_displaying_text()
    {
        if(!this.viewing_own_bookmarks())
        {
            if(this.user_info)
                return this.user_info.name + "'s Bookmarks";
            return "User's Bookmarks";
        }

        let args = new helpers.args(this.url);
        let public_bookmarks = this.viewing_public;
        let private_bookmarks = this.viewing_private;
        let viewing_all = public_bookmarks && private_bookmarks;
        var displaying = "";

        if(this.total_bookmarks != -1)
            displaying += this.total_bookmarks + " ";

        displaying += viewing_all? "Bookmark":
            private_bookmarks? "Private Bookmark":"Public Bookmark";

        // English-centric pluralization:
        if(this.total_bookmarks != 1)
            displaying += "s";

        var tag = this.displaying_tag;
        if(tag == "")
            displaying += ` with no tags`;
        else if(tag != null)
            displaying += ` with tag "${tag}"`;

        return displaying;
    };

    // Return true if we're viewing publig and private bookmarks.  These are overridden
    // in bookmarks_merged.
    get viewing_public()
    {
        let args = new helpers.args(this.url);
        return args.query.get("rest") != "hide";
    }

    get viewing_private()
    {
        let args = new helpers.args(this.url);
        return args.query.get("rest") == "hide";
    }

    refresh_thumbnail_ui(container, thumbnail_view)
    {
        // The public/private button only makes sense when viewing your own bookmarks.
        var public_private_button_container = container.querySelector(".bookmarks-public-private");
        public_private_button_container.hidden = !this.viewing_own_bookmarks();

        // Set up the public and private buttons.  The "all" button also removes shuffle, since it's not
        // supported there.
        this.set_item(public_private_button_container, "all", {"#show-all": 1, "#shuffle": null}, {"#show-all": 1});
        this.set_item(container, "public", {rest: null, "#show-all": 0}, {"#show-all": 1});
        this.set_item(container, "private", {rest: "hide", "#show-all": 0}, {"#show-all": 1});

        // Shuffle isn't supported for merged bookmarks.  If we're on #show-all, make the shuffle button
        // also switch to public bookmarks.  This is easier than graying it out and trying to explain it
        // in the popup, and better than hiding it which makes it hard to find.
        let args = new helpers.args(this.url);
        let show_all = args.hash.get("show-all") != "0";
        let set_public = show_all? { rest: null, "#show-all": 0 }:{};
        this.set_item(container, "order-date", {"#shuffle": null}, {"#shuffle": null});
        this.set_item(container, "order-shuffle", {"#shuffle": 1, ...set_public}, {"#shuffle": null, "#show-all": 1});

        // Refresh the bookmark tag list.  Remove the page number from these buttons.
        let current_url = new URL(this.url);
        current_url.searchParams.delete("p");

        var tag_list = container.querySelector(".bookmark-tag-list");
        let current_tag = this.displaying_tag;
        
        for(let tag of tag_list.querySelectorAll(".following-tag"))
            tag.remove();

        var add_tag_link = (tag) =>
        {
            let tag_count = this.bookmark_tag_counts[tag];

            var a = document.createElement("a");
            a.classList.add("box-link");
            a.classList.add("following-tag");

            let tag_name = tag;
            if(tag_name == null)
                tag_name = "All";
            else if(tag_name == "")
                tag_name = "Untagged";
            a.innerText = tag_name;

            // Show the bookmark count in the popup.
            if(tag_count != null)
            {
                a.classList.add("popup");
                a.dataset.popup = tag_count + (tag_count == 1? " bookmark":" bookmarks");
            }

            let url = new URL(this.url);
            url.searchParams.delete("p");

            if(tag == current_tag)
                a.classList.add("selected");

            // Pixiv used to put the tag in a nice, clean query parameter, but recently got
            // a bit worse and put it in the query.  That's a much worse way to do things:
            // it's harder to parse, and means you bake one particular feature into your
            // URLs.
            let old_pathname = helpers.get_url_without_language(url).pathname;
            let parts = old_pathname.split("/");
            if(tag == "")
                tag = "未分類"; // Uncategorized
            if(tag == null) // All
            {
                if(parts.length == 6)
                    parts = parts.splice(0,5);
            }
            else
            {
                if(parts.length < 6)
                    parts.push("");
                parts[5] = encodeURIComponent(tag);
            }
            url.pathname = parts.join("/");

            a.href = url.toString();
            tag_list.appendChild(a);
        };

        add_tag_link(null); // All
        add_tag_link(""); // Uncategorized
        for(var tag of Object.keys(this.bookmark_tag_counts))
        {
            // Skip uncategorized, which is always placed at the beginning.
            if(tag == "")
                continue;

            if(this.bookmark_tag_counts[tag] == 0)
                continue;

            add_tag_link(tag);
        }

        thumbnail_view.avatar_container.hidden = this.viewing_own_bookmarks();
        thumbnail_view.avatar_widget.set_user_id(this.viewing_user_id);
    }

    get viewing_user_id()
    {
        // /users/13245/bookmarks
        //
        // This is currently only used for viewing other people's bookmarks.  Your own bookmarks are still
        // viewed with /bookmark.php with no ID.
        return helpers.get_path_part(this.url, 1);
    };

    // Return true if we're viewing our own bookmarks.
    viewing_own_bookmarks()
    {
        return this.viewing_user_id == window.global_data.user_id;
    }

    // Don't show bookmark icons for the user's own bookmarks.  Every image on that page
    // is bookmarked, so it's just a lot of noise.
    get show_bookmark_icons()
    {
        return !this.viewing_own_bookmarks();
    }

    // Bookmark results include deleted images.  These are weird and a bit broken:
    // the post ID is an integer instead of a string (which makes more sense but is
    // inconsistent with other results) and the data is mostly empty or garbage.
    // Check isBookmarkable to filter these out.
    static filter_deleted_images(images)
    {
        let result = [];
        for(let image of images)
        {
            if(!image.isBookmarkable)
            {
                console.log("Discarded deleted bookmark " + image.id);
                continue;
            }
            result.push(image);
        }
        return result;
    }
}

// Normal bookmark querying.  This can only retrieve public or private bookmarks,
// and not both.
ppixiv.data_sources.bookmarks = class extends data_source_bookmarks_base
{
    get shuffle()
    {
        let args = new helpers.args(this.url);
        return args.hash.has("shuffle");
    }

    async continue_loading_page_internal(page)
    {
        let page_to_load = page;
        if(this.shuffle)
        {
            // We need to know the number of pages in order to shuffle, so load the first page.
            // This is why we don't support this for merged bookmark loading: we'd need to load
            // both first pages, then both first shuffled pages, so we'd be making four bookmark
            // requests all at once.
            if(this.total_shuffled_bookmarks == null)
            {
                let result = await this.request_bookmarks(1, null);

                this.total_shuffled_bookmarks = result.total;
                this.total_pages = Math.ceil(this.total_shuffled_bookmarks / this.estimated_items_per_page);

                // Create a shuffled page list.
                this.shuffled_pages = [];
                for(let p = 1; p <= this.total_pages; ++p)
                    this.shuffled_pages.push(p);

                helpers.shuffle_array(this.shuffled_pages);
            }

            if(page < this.shuffled_pages.length)
                page_to_load = this.shuffled_pages[page];
        }

        let result = await this.request_bookmarks(page_to_load, null);

        var illust_ids = [];
        for(let illust_data of result.works)
            illust_ids.push(illust_data.id);

        // If we're shuffling, shuffle the individual illustrations too.
        if(this.shuffle)
            helpers.shuffle_array(illust_ids);
        
        // This request returns all of the thumbnail data we need.  Forward it to
        // thumbnail_data so we don't need to look it up.
        thumbnail_data.singleton().loaded_thumbnail_info(result.works, "normal");

        // Register the new page of data.  If we're shuffling, use the original page number, not the
        // shuffled page.
        this.add_page(page, illust_ids);

        // Remember the total count, for display.
        this.total_bookmarks = result.total;
    }
};

// Merged bookmark querying.  This makes queries for both public and private bookmarks,
// and merges them together.
ppixiv.data_sources.bookmarks_merged = class extends data_source_bookmarks_base
{
    get viewing_public() { return true; }
    get viewing_private() { return true; }

    constructor(url)
    {
        super(url);

        this.max_page_per_type = [-1, -1]; // public, private
        this.bookmark_illust_ids = [[], []]; // public, private
        this.bookmark_totals = [0, 0]; // public, private
    }

    async continue_loading_page_internal(page)
    {
        // Request both the public and private bookmarks on the given page.  If we've
        // already reached the end of either of them, don't send that request.
        let request1 = this.request_bookmark_type(page, "show");
        let request2 = this.request_bookmark_type(page, "hide");

        // Wait for both requests to finish.
        await Promise.all([request1, request2]);

        // Both requests finished.  Combine the two lists of illust IDs into a single page
        // and register it.
        var illust_ids = [];
        for(var i = 0; i < 2; ++i)
            if(this.bookmark_illust_ids[i] != null && this.bookmark_illust_ids[i][page] != null)
                illust_ids = illust_ids.concat(this.bookmark_illust_ids[i][page]);
        
        this.add_page(page, illust_ids);

        // Combine the two totals.
        this.total_bookmarks = this.bookmark_totals[0] + this.bookmark_totals[1];
    }

    async request_bookmark_type(page, rest)
    {
        var is_private = rest == "hide"? 1:0;
        var max_page = this.max_page_per_type[is_private];
        if(max_page != -1 && page > max_page)
        {
            // We're past the end.
            console.log("page", page, "beyond", max_page, rest);
            return;
        }

        let result = await this.request_bookmarks(page, rest);

        // Put higher (newer) bookmarks first.
        result.works.sort(function(lhs, rhs)
        {
            return parseInt(rhs.bookmarkData.id) - parseInt(lhs.bookmarkData.id);
        });

        var illust_ids = [];
        for(let illust_data of result.works)
            illust_ids.push(illust_data.id);

        // This request returns all of the thumbnail data we need.  Forward it to
        // thumbnail_data so we don't need to look it up.
        thumbnail_data.singleton().loaded_thumbnail_info(result.works, "normal");

        // If there are no results, remember that this is the last page, so we don't
        // make more requests for this type.
        if(illust_ids.length == 0)
        {
            if(this.max_page_per_type[is_private] == -1)
                this.max_page_per_type[is_private] = page;
            else
                this.max_page_per_type[is_private] = Math.min(page, this.max_page_per_type[is_private]);
            // console.log("max page for", is_private? "private":"public", this.max_page_per_type[is_private]);
        }

        // Store the IDs.  We don't register them here.
        this.bookmark_illust_ids[is_private][page] = illust_ids;

        // Remember the total count, for display.
        this.bookmark_totals[is_private] = result.total;
    }
}

// new_illust.php
ppixiv.data_sources.new_illust = class extends data_source
{
    get name() { return "new_illust"; }

    get page_title()
    {
        return "New Works";
    }

    get_displaying_text()
    {
        return "New Works";
    };

    async load_page_internal(page)
    {
        let args = new helpers.args(this.url);

        // new_illust.php or new_illust_r18.php:
        let r18 = this.url.pathname == "/new_illust_r18.php";
        var type = args.query.get("type") || "illust";
        
        // Everything Pixiv does has always been based on page numbers, but this one uses starting IDs.
        // That's a better way (avoids duplicates when moving forward in the list), but it's inconsistent
        // with everything else.  We usually load from page 1 upwards.  If we're loading the next page and
        // we have a previous last_id, assume it starts at that ID.
        //
        // This makes some assumptions about how we're called: that we won't be called for the same page
        // multiple times and we're always loaded in ascending order.  In practice this is almost always
        // true.  If Pixiv starts using this method for more important pages it might be worth checking
        // this more carefully.
        if(this.last_id == null)
        {
            this.last_id = 0;
            this.last_id_page = 1;
        }

        if(this.last_id_page != page)
        {
            console.error("Pages weren't loaded in order");
            return;
        }

        console.log("Assuming page", page, "starts at", this.last_id);

        var url = "/ajax/illust/new";
        var result = await helpers.get_request(url, {
            limit: 20,
            type: type,
            r18: r18,
            lastId: this.last_id,
        });

        var illust_ids = [];
        for(var illust_data of result.body.illusts)
            illust_ids.push(illust_data.id);

        if(illust_ids.length > 0)
        {
            this.last_id = illust_ids[illust_ids.length-1];
            this.last_id_page++;
        }
        
        // This request returns all of the thumbnail data we need.  Forward it to
        // thumbnail_data so we don't need to look it up.
        thumbnail_data.singleton().loaded_thumbnail_info(result.body.illusts, "normal");

        // Register the new page of data.
        this.add_page(page, illust_ids);
    }
    
    refresh_thumbnail_ui(container)
    {
        this.set_item(container, "new-illust-type-illust", {type: null});
        this.set_item(container, "new-illust-type-manga", {type: "manga"});

        // These links are different from anything else on the site: they switch between
        // two top-level pages, even though they're just flags and everything else is the
        // same.  We don't actually need to do this since we're just making API calls, but
        // we try to keep the base URLs compatible, so we go to the equivalent page on Pixiv
        // if we're turned off.
        var all_ages_link = container.querySelector("[data-type='new-illust-ages-all']");
        var r18_link = container.querySelector("[data-type='new-illust-ages-r18']");

        let url = new URL(this.url);
        url.pathname = "/new_illust.php";
        all_ages_link.href = url;

        url = new URL(this.url);
        url.pathname = "/new_illust_r18.php";
        r18_link.href = url;

        url = new URL(this.url);
        var currently_all_ages = url.pathname == "/new_illust.php";
        helpers.set_class(all_ages_link, "selected", currently_all_ages);
        helpers.set_class(r18_link, "selected", !currently_all_ages);
    }
}

// bookmark_new_illust.php, bookmark_new_illust_r18.php
ppixiv.data_sources.bookmarks_new_illust = class extends data_source
{
    get name() { return "bookmarks_new_illust"; }

    constructor(url)
    {
        super(url);
        this.bookmark_tags = [];
    }

    async load_page_internal(page)
    {
        let current_tag = this.url.searchParams.get("tag") || "";
        let r18 = this.url.pathname == "/bookmark_new_illust_r18.php";
        let result = await helpers.get_request("/ajax/follow_latest/illust", {
            p: page,
            tag: current_tag,
            mode: r18? "r18":"all",
        });

        let data = result.body;

        // Add translations.
        tag_translations.get().add_translations_dict(data.tagTranslation);

        // Store bookmark tags.
        this.bookmark_tags = data.page.tags;

        // Populate thumbnail data with this data.
        thumbnail_data.singleton().loaded_thumbnail_info(data.thumbnails.illust, "normal");

        let illust_ids = [];
        for(let illust of data.thumbnails.illust)
            illust_ids.push(illust.id);

        // Register the new page of data.
        this.add_page(page, illust_ids);
    }
    
    get page_title()
    {
        return "Following";
    }

    get_displaying_text()
    {
        return "Following";
    };

    refresh_thumbnail_ui(container)
    {
        // Refresh the bookmark tag list.
        let current_tag = this.url.searchParams.get("tag") || "All";

        var tag_list = container.querySelector(".follow-new-post-tag-list");
        for(let tag of tag_list.querySelectorAll(".following-tag"))
            tag.remove();

        let add_tag_link = (tag) =>
        {
            var a = document.createElement("a");
            a.classList.add("box-link");
            a.classList.add("following-tag");
            a.innerText = tag;

            var url = new URL(this.url);
            if(tag != "All")
                url.searchParams.set("tag", tag);
            else
                url.searchParams.delete("tag");

            a.href = url.toString();
            if(tag == current_tag)
                a.classList.add("selected");
            tag_list.appendChild(a);
        };

        add_tag_link("All");
        for(var tag of this.bookmark_tags)
            add_tag_link(tag);

        var all_ages_link = container.querySelector("[data-type='bookmarks-new-illust-all']");
        var r18_link = container.querySelector("[data-type='bookmarks-new-illust-ages-r18']");

        var url = new URL(this.url);
        url.pathname = "/bookmark_new_illust.php";
        all_ages_link.href = url;

        var url = new URL(this.url);
        url.pathname = "/bookmark_new_illust_r18.php";
        r18_link.href = url;

        var url = new URL(this.url);
        var currently_all_ages = url.pathname == "/bookmark_new_illust.php";
        helpers.set_class(all_ages_link, "selected", currently_all_ages);
        helpers.set_class(r18_link, "selected", !currently_all_ages);
    }
};

// /tags
//
// The new tag search UI is a bewildering mess:
// 
// - Searching for a tag goes to "/tags/TAG/artworks".  This searches all posts with the
// tag.  The API query is "/ajax/search/artworks/TAG".  The "top" tab is highlighted, but
// it's not actually on that tab and no tab button goes back here.  "Illustrations, Manga,
// Ugoira" in search options also goes here.
// 
// - The "Illustrations" tab goes to "/tags/TAG/illustrations".  The API is
// "/ajax/search/illustrations/TAG?type=illust_and_ugoira".  This is almost identical to
// "artworks", but excludes posts marked as manga.  "Illustrations, Ugoira"  in search
// options also goes here.
// 
// - Clicking "manga" goes to "/tags/TAG/manga".  The API is "/ajax/search/manga" and also
// sets type=manga.  This is "Manga" in the search options.  This page is also useless.
//
// The "manga only" and "exclude manga" pages are useless, since Pixiv doesn't make any
// useful distinction between "manga" and "illustrations with more than one page".  We
// only include them for completeness.
// 
// - You can search for just animations, but there's no button for it in the UI.  You
// have to pick it from the dropdown in search options.  This one is "illustrations?type=ugoira".
// Why did they keep using type just for one search mode?  Saying "type=manga" or any
// other type fails, so it really is just used for this.
// 
// - Clicking "Top" goes to "/tags/TAG" with no type.  This is a completely different
// page and API, "/ajax/search/top/TAG".  It doesn't actually seem to be a rankings
// page and just shows the same thing as the others with a different layout, so we
// ignore this and treat it like "artworks".
ppixiv.data_sources.search = class extends data_source
{
    get name() { return "search"; }

    constructor(url)
    {
        super(url);

        this.cache_search_title = this.cache_search_title.bind(this);

        // Add the search tags to tag history.  We only do this at the start when the
        // data source is created, not every time we navigate back to the search.
        let tag = this._search_tags;
        if(tag)
            helpers.add_recent_search_tag(tag);

        this.cache_search_title();
    }

    get supports_start_page() { return true; }

    get _search_tags()
    {
        return helpers._get_search_tags_from_url(this.url);
    }

    // Return the search type from the URL.  This is one of "artworks", "illustrations"
    // or "novels" (not supported).  It can also be omitted, which is the "top" page,
    // but that gives the same results as "artworks" with a different page layout, so
    // we treat it as "artworks".
    get _search_type()
    {
        // ["", "tags", tag list, type]
        let url = helpers.get_url_without_language(this.url);
        let parts = url.pathname.split("/");
        if(parts.length >= 4)
            return parts[3];
        else
            return "artworks";
    }

    startup()
    {
        super.startup();

        // Refresh our title when translations are toggled.
        settings.register_change_callback("disable-translations", this.cache_search_title);
    }

    shutdown()
    {
        super.shutdown();
        settings.unregister_change_callback("disable-translations", this.cache_search_title);
    }

    async cache_search_title()
    {
        this.title = "Search: ";
        let tags = this._search_tags;
        if(tags)
        {
            tags = await tag_translations.get().translate_tag_list(tags, "en");
            var tag_list = document.createElement("span");
            for(let tag of tags)
            {
                // Force "or" lowercase.
                if(tag.toLowerCase() == "or")
                    tag = "or";
                
                var span = document.createElement("span");
                span.innerText = tag;
                span.classList.add("word");
                if(tag == "or")
                    span.classList.add("or");
                else
                    span.classList.add("tag");
                
                tag_list.appendChild(span);
            }

            this.title += tags.join(" ");
            this.displaying_tags = tag_list;
        }
        
        // Update our page title.
        this.call_update_listeners();
    }

    async load_page_internal(page)
    {
        let args = { };
        this.url.searchParams.forEach((value, key) => { args[key] = value; });

        args.p = page;

        // "artworks" and "illustrations" are different on the search page: "artworks" uses "/tag/TAG/artworks",
        // and "illustrations" is "/tag/TAG/illustrations?type=illust_and_ugoira".
        let search_type = this._search_type;
        let search_mode = this.get_url_search_mode();
        let api_search_type = null;
        if(search_mode == "all")
        {
            // "artworks" doesn't use the type field.
            api_search_type = "artworks";
        }
        else if(search_mode == "illust")
        {
            api_search_type = "illustrations";
            args.type = "illust_and_ugoira";
        }
        else if(search_mode == "manga")
        {
            api_search_type = "manga";
            args.type = "manga";
        }
        else if(search_mode == "ugoira")
        {
            api_search_type = "illustrations";
            args.type = "ugoira";
        }
        else
            console.error("Invalid search type:", search_type);

        let tag = this._search_tags;

        // If we have no tags, we're probably on the "/tags" page, which is just a list of tags.  Don't
        // run a search with no tags.
        if(!tag)
        {
            console.log("No search tags");
            return;
        }

        var url = "/ajax/search/" + api_search_type + "/" + encodeURIComponent(tag);

        var result = await helpers.get_request(url, args);
        let body = result.body;

        // Store related tags.  Only do this the first time and don't change it when we read
        // future pages, so the tags don't keep changing as you scroll around.
        if(this.related_tags == null)
        {
            this.related_tags = body.relatedTags;
            this.call_update_listeners();
        }

        // Add translations.
        let translations = [];
        for(let tag of Object.keys(body.tagTranslation))
        {
            translations.push({
                tag: tag,
                translation: body.tagTranslation[tag],
            });
        }
        tag_translations.get().add_translations(translations);

        // /tag/TAG/illustrations returns results in body.illust.
        // /tag/TAG/artworks returns results in body.illustManga.
        // /tag/TAG/manga returns results in body.manga.
        let illusts = body.illust || body.illustManga || body.manga;
        illusts = illusts.data;

        // Populate thumbnail data with this data.
        thumbnail_data.singleton().loaded_thumbnail_info(illusts, "normal");

        var illust_ids = [];
        for(let illust of illusts)
            illust_ids.push(illust.id);

        // Register the new page of data.
        this.add_page(page, illust_ids);
    }

    get page_title()
    {
        return this.title;
    }

    get_displaying_text()
    {
        return this.displaying_tags;
    };

    initial_refresh_thumbnail_ui(container, view)
    {
        // Fill the search box with the current tag.
        var query_args = this.url.searchParams;
        let tag = this._search_tags;
        container.querySelector(".tag-search-box .input-field-container > input").value = tag;
    }

    // Return the search mode, which is selected by the "Type" search option.  This generally
    // corresponds to the underlying page's search modes.
    get_url_search_mode()
    {
        // "/tags/tag/illustrations" has a "type" parameter with the search type.  This is used for
        // "illust" (everything except animations) and "ugoira".
        let search_type = this._search_type;
        if(search_type == "illustrations")
        {
            let query_search_type = this.url.searchParams.get("type");
            if(query_search_type == "ugoira") return "ugoira";
            if(query_search_type == "illust") return "illust";

            // If there's no parameter, show everything.
            return "all";
        }
        
        if(search_type == "artworks")
            return "all";
        if(search_type == "manga")
            return "manga";

        // Use "all" for unrecognized types.
        return "all";
    }

    // Return URL with the search mode set to mode.
    set_url_search_mode(url, mode)
    {
        url = new URL(url);
        url = helpers.get_url_without_language(url);

        // Only "ugoira" searches use type in the query.  It causes an error in other modes, so remove it.
        if(mode == "illust")
            url.searchParams.set("type", "illust");
        else if(mode == "ugoira")
            url.searchParams.set("type", "ugoira");
        else
            url.searchParams.delete("type");

        let search_type = "artworks";
        if(mode == "manga")
            search_type = "manga";
        else if(mode == "ugoira" || mode == "illust")
            search_type = "illustrations";

        // Set the type in the URL.
        let parts = url.pathname.split("/");
        parts[3] = search_type;
        url.pathname = parts.join("/");
        return url;
    }
 
    refresh_thumbnail_ui(container, thumbnail_view)
    {
        if(this.related_tags)
            thumbnail_view.tag_widget.set(this.related_tags);

        this.set_item(container, "ages-all", {mode: null});
        this.set_item(container, "ages-safe", {mode: "safe"});
        this.set_item(container, "ages-r18", {mode: "r18"});

        this.set_item(container, "order-newest", {order: null}, {order: "date_d"});
        this.set_item(container, "order-oldest", {order: "date"});
        this.set_item(container, "order-all", {order: "popular_d"});
        this.set_item(container, "order-male", {order: "popular_male_d"});
        this.set_item(container, "order-female", {order: "popular_female_d"});

        let set_search_mode = (container, type, mode) =>
        {
            var link = container.querySelector("[data-type='" + type + "']");
            if(link == null)
            {
                console.warn("Couldn't find button with selector", type);
                return;
            }

            let current_mode = this.get_url_search_mode();
            let button_is_selected = current_mode == mode;
            helpers.set_class(link, "selected", button_is_selected);

            // Adjust the URL for this button.
            let url = this.set_url_search_mode(this.url, mode);
            link.href = url.toString();
        };

        set_search_mode(container, "search-type-all", "all");
        set_search_mode(container, "search-type-illust", "illust");
        set_search_mode(container, "search-type-manga", "manga");
        set_search_mode(container, "search-type-ugoira", "ugoira");

        this.set_item(container, "search-all", {s_mode: null}, {s_mode: "s_tag"});
        this.set_item(container, "search-exact", {s_mode: "s_tag_full"});
        this.set_item(container, "search-text", {s_mode: "s_tc"});

        this.set_item(container, "res-all", {wlt: null, hlt: null, wgt: null, hgt: null});
        this.set_item(container, "res-high", {wlt: 3000, hlt: 3000, wgt: null, hgt: null});
        this.set_item(container, "res-medium", {wlt: 1000, hlt: 1000, wgt: 2999, hgt: 2999});
        this.set_item(container, "res-low", {wlt: null, hlt: null, wgt: 999, hgt: 999});

        this.set_item(container, "aspect-ratio-all", {ratio: null});
        this.set_item(container, "aspect-ratio-landscape", {ratio: "0.5"});
        this.set_item(container, "aspect-ratio-portrait", {ratio: "-0.5"});
        this.set_item(container, "aspect-ratio-square", {ratio: "0"});
       
        this.set_item(container, "bookmarks-all", {blt: null, bgt: null});
        this.set_item(container, "bookmarks-5000", {blt: 5000, bgt: null});
        this.set_item(container, "bookmarks-2500", {blt: 2500, bgt: null});
        this.set_item(container, "bookmarks-1000", {blt: 1000, bgt: null});
        this.set_item(container, "bookmarks-500", {blt: 500, bgt: null});
        this.set_item(container, "bookmarks-250", {blt: 250, bgt: null});
        this.set_item(container, "bookmarks-100", {blt: 100, bgt: null});

        // The time filter is a range, but I'm not sure what time zone it filters in
        // (presumably either JST or UTC).  There's also only a date and not a time,
        // which means you can't actually filter "today", since there's no way to specify
        // which "today" you mean.  So, we offer filtering starting at "this week",
        // and you can just use the default date sort if you want to see new posts.
        // For "this week", we set the end date a day in the future to make sure we
        // don't filter out posts today.
        this.set_item(container, "time-all", {scd: null, ecd: null});

        var format_date = (date) =>
        {
            var f = (date.getYear() + 1900).toFixed();
            return (date.getYear() + 1900).toFixed().padStart(2, "0") + "-" +
                    (date.getMonth() + 1).toFixed().padStart(2, "0") + "-" +
                    date.getDate().toFixed().padStart(2, "0");
        };

        var set_date_filter = (name, start, end) =>
        {
            var start_date = format_date(start);
            var end_date = format_date(end);
            this.set_item(container, name, {scd: start_date, ecd: end_date});
        };

        var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        var last_week = new Date(); last_week.setDate(last_week.getDate() - 7);
        var last_month = new Date(); last_month.setMonth(last_month.getMonth() - 1);
        var last_year = new Date(); last_year.setFullYear(last_year.getFullYear() - 1);
        set_date_filter("time-week", last_week, tomorrow);
        set_date_filter("time-month", last_month, tomorrow);
        set_date_filter("time-year", last_year, tomorrow);
        for(var years_ago = 1; years_ago <= 7; ++years_ago)
        {
            var start_year = new Date(); start_year.setFullYear(start_year.getFullYear() - years_ago - 1);
            var end_year = new Date(); end_year.setFullYear(end_year.getFullYear() - years_ago);
            set_date_filter("time-years-ago-" + years_ago, start_year, end_year);
        }

        this.set_active_popup_highlight(container);

        // The "reset search" button removes everything in the query except search terms, and resets
        // the search type.
        var box = container.querySelector(".reset-search");
        let url = new URL(this.url);
        let tag = helpers._get_search_tags_from_url(url);
        url.search = "";
        if(tag == null)
            url.pathname = "/tags";
        else
            url.pathname = "/tags/" + encodeURIComponent(tag) + "/artworks";
        box.href = url;
     }
};

ppixiv.data_sources.follows = class extends data_source
{
    get name() { return "following"; }
    get search_mode() { return "users"; }
  
    constructor(url)
    {
        super(url);

        this.follow_tags = null;
    }

    get supports_start_page()
    {
        return true;
    }

    get viewing_user_id()
    {
        if(helpers.get_path_part(this.url, 0) == "users")
        {
            // New URLs (/users/13245/follows)
            return helpers.get_path_part(this.url, 1);
        }
        
        var query_args = this.url.searchParams;
        let user_id = query_args.get("id");
        if(user_id == null)

            return window.global_data.user_id;
        
        return user_id;
    };

    async load_page_internal(page)
    {
        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        this.user_info = await image_data.singleton().get_user_info_full(this.viewing_user_id);

        // Update to refresh our page title, which uses user_info.
        this.call_update_listeners();

        var query_args = this.url.searchParams;
        var rest = query_args.get("rest") || "show";

        var url = "/ajax/user/" + this.viewing_user_id + "/following";
        let args = {
            offset: this.estimated_items_per_page*(page-1),
            limit: this.estimated_items_per_page,
            rest: rest,
        };
        if(query_args.get("tag"))
            args.tag = query_args.get("tag");
        let result = await helpers.get_request(url, args);

        // Store following tags.
        this.follow_tags = result.body.followUserTags;

        // Make a list of the first illustration for each user.
        var illusts = [];
        for(let followed_user of result.body.users)
        {
            if(followed_user == null)
                continue;

            // Register this as quick user data, for use in thumbnails.
            thumbnail_data.singleton().add_quick_user_data(followed_user, "following");

            // XXX: user:user_id
            if(!followed_user.illusts.length)
            {
                console.log("Can't show followed user that has no posts:", followed_user.userId);
                continue;
            }

            let illust = followed_user.illusts[0];
            illusts.push(illust);

            // We'll register this with thumbnail_data below.  These results don't have profileImageUrl
            // and only put it in the enclosing user, so copy it over.
            illust.profileImageUrl = followed_user.profileImageUrl;
        }

        var illust_ids = [];
        for(let illust of illusts)
            illust_ids.push("user:" + illust.userId);
        
        // This request returns all of the thumbnail data we need.  Forward it to
        // thumbnail_data so we don't need to look it up.
        thumbnail_data.singleton().loaded_thumbnail_info(illusts, "normal");

        // Register the new page of data.
        this.add_page(page, illust_ids);
    }

    refresh_thumbnail_ui(container, thumbnail_view)
    {
        if(!this.viewing_self)
        {
            thumbnail_view.avatar_container.hidden = false;
            thumbnail_view.avatar_widget.set_user_id(this.viewing_user_id);
        }
        
        // The public/private button only makes sense when viewing your own follows.
        var public_private_button_container = container.querySelector(".follows-public-private");
        public_private_button_container.hidden = !this.viewing_self;

        this.set_item(container, "public-follows", {rest: "show"}, {rest: "show"});
        this.set_item(container, "private-follows", {rest: "hide"}, {rest: "show"});

        var tag_list = container.querySelector(".follow-tag-list");
        for(let tag of tag_list.querySelectorAll(".following-tag"))
            tag.remove();

        // Refresh the bookmark tag list.  Remove the page number from these buttons.
        let current_url = new URL(this.url);
        current_url.searchParams.delete("p");
        let current_query = current_url.searchParams.toString();

        var add_tag_link = (tag) =>
        {
            var a = document.createElement("a");
            a.classList.add("box-link");
            a.classList.add("following-tag");
            a.innerText = tag;

            let url = new URL(this.url);
            url.searchParams.delete("p");
            if(tag == "Untagged")
                url.searchParams.set("untagged", 1);
            else
                url.searchParams.delete("untagged", 1);

            if(tag != "All")
                url.searchParams.set("tag", tag);
            else
                url.searchParams.delete("tag");

            a.href = url.toString();
            if(url.searchParams.toString() == current_query)
                a.classList.add("selected");
            tag_list.appendChild(a);
        };

        add_tag_link("All");
        for(var tag of this.follow_tags || [])
            add_tag_link(tag);
    }

    get viewing_self()
    {
        return this.viewing_user_id == window.global_data.user_id;
    }

    get page_title()
    {
        if(!this.viewing_self)
        {
            if(this.user_info)
                return this.user_info.name + "'s Follows";
            return "User's follows";
        }

        var query_args = this.url.searchParams;
        var private_follows = query_args.get("rest") == "hide";
        return private_follows? "Private follows":"Followed users";
    };

    get_displaying_text()
    {
        if(!this.viewing_self)
        {
            if(this.user_info)
                return this.user_info.name + "'s followed users";
            return "User's followed users";
        }

        var query_args = this.url.searchParams;
        var private_follows = query_args.get("rest") == "hide";
        return private_follows? "Private follows":"Followed users";
    };
}

// bookmark_detail.php
//
// This lists the users who publically bookmarked an illustration, linking to each users' bookmarks.
ppixiv.data_sources.related_favorites = class extends data_source_from_page
{
    get name() { return "illust-bookmarks"; }
    get search_mode() { return "users"; }
  
    constructor(url)
    {
        super(url);

        this.illust_info = null;
    }

    async load_page_internal(page)
    {
        // Get info for the illustration we're displaying bookmarks for.
        var query_args = this.url.searchParams;
        var illust_id = query_args.get("illust_id");
        this.illust_info = await image_data.singleton().get_image_info(illust_id);
        
        return super.load_page_internal(page);
    }

    // Parse the loaded document and return the illust_ids.
    parse_document(doc)
    {
        var ids = [];
        for(var element of doc.querySelectorAll("li.bookmark-item a[data-user_id]"))
        {
            // Register this as quick user data, for use in thumbnails.
            thumbnail_data.singleton().add_quick_user_data({
                user_id: element.dataset.user_id,
                user_name: element.dataset.user_name,

                // This page gives links to very low-res avatars.  Replace them with the high-res ones
                // that newer pages give.
                //
                // These links might be annoying animated GIFs, but we don't bother killing them here
                // like we do for the followed page since this isn't used very much.
                profile_img: element.dataset.profile_img.replace("_50.", "_170."),
            }, "users_bookmarking_illust");

            // The bookmarks: URL type will generate links to this user's bookmarks.
            ids.push("bookmarks:" + element.dataset.user_id);
        }
        return ids;
    }
    
    refresh_thumbnail_ui(container, thumbnail_view)
    {
        // Set the source image.
        var source_link = container.querySelector(".image-for-suggestions");
        source_link.hidden = this.illust_info == null;
        if(this.illust_info)
        {
            source_link.href = "/artworks/" + this.illust_info.illustId + "#ppixiv";

            var img = source_link.querySelector(".image-for-suggestions > img");
            img.src = this.illust_info.previewUrls[0];
        }
    }

    get page_title()
    {
        return "Similar Bookmarks";
    };

    get_displaying_text()
    {
        if(this.illust_info)
            return "Users who bookmarked " + this.illust_info.illustTitle;
        else
            return "Users who bookmarked image";
    };
}

ppixiv.data_sources.search_users = class extends data_source_from_page
{
    get name() { return "search-users"; }
    get search_mode() { return "users"; }
  
    parse_document(doc)
    {
        var illust_ids = [];
        for(let item of doc.querySelectorAll(".user-recommendation-items .user-recommendation-item"))
        {
            let username = item.querySelector(".title").innerText;
            let user_id = item.querySelector(".follow").dataset.id;
            let profile_image = item.querySelector("._user-icon").dataset.src;

            thumbnail_data.singleton().add_quick_user_data({
                user_id: user_id,
                user_name: username,
                profile_img: profile_image,
            }, "user_search");

            illust_ids.push("user:" + user_id);
        }
        return illust_ids;
    }

    initial_refresh_thumbnail_ui(container, view)
    {
        let search = this.url.searchParams.get("nick");
        container.querySelector(".search-users").value = search;
    }

    get page_title()
    {
        let search = this.url.searchParams.get("nick");
        if(search)
            return "Search users: " + search;
        else
            return "Search users";
    };

    get_displaying_text()
    {
        return this.page_title;
    };
}

// /history.php - Recent history
//
// This uses our own history and not Pixiv's history.
ppixiv.data_sources.recent = class extends data_source
{
    get name() { return "recent"; }

    async load_page_internal(page)
    {
        // Read illust_ids once and paginate them so we don't return them all at once.
        if(this.illust_ids == null)
        {
            let illust_ids = await ppixiv.recently_seen_illusts.get().get_recent_illust_ids();
            this.pages = paginate_illust_ids(illust_ids, this.estimated_items_per_page);
        }

        // Register this page.
        let illust_ids = this.pages[page-1] || [];
        let found_illust_ids = [];

        // Get thumbnail data for this page.  Some thumbnail data might be missing if it
        // expired before this page was viewed.  Don't add illust IDs that we don't have
        // thumbnail data for.
        let thumbs = await ppixiv.recently_seen_illusts.get().get_thumbnail_info(illust_ids);
        thumbnail_data.singleton().loaded_thumbnail_info(thumbs, "internal");

        for(let thumb of thumbs)
            found_illust_ids.push(thumb.id);

        this.add_page(page, found_illust_ids);
    };

    get page_title() { return "Recent"; }
    get_displaying_text() { return "Recent History"; }

    // This data source is transient, so it's recreated each time the user navigates to it.
    get transient() { return true; }
    
    refresh_thumbnail_ui(container)
    {
        // Set .selected on the current mode.
        let current_mode = this.url.searchParams.get("mode") || "all";
        helpers.set_class(container.querySelector(".box-link[data-type=all]"), "selected", current_mode == "all");
        helpers.set_class(container.querySelector(".box-link[data-type=safe]"), "selected", current_mode == "safe");
        helpers.set_class(container.querySelector(".box-link[data-type=r18]"), "selected", current_mode == "r18");
    }
}


ppixiv.data_sources.vview = class extends data_source
{
    get name() { return "vview"; }

    constructor(url)
    {
        super(url);

        this.reached_end = false;
        this.prev_page_uuid = null;
        this.next_page_uuid = null;
        this.next_page_offset = null;
        this.bookmark_tag_counts = null;
    }

    get supports_start_page() { return true; }

    async load_page_internal(page)
    {
        // If the last result was at the end, stop.
        if(this.reached_end)
            return;

        this.fetch_bookmark_tag_counts();
        
        // We should only be called in one of three ways: a start page (any page, but only if we have
        // nothing loaded), or a page at the start or end of pages we've already loaded.  Figure out which
        // one this is.  "page" is set to result.next of the last page to load the next page, or result.prev
        // of the first loaded page to load the previous page.
        let lowest_page = this.id_list.get_lowest_loaded_page();
        let highest_page = this.id_list.get_highest_loaded_page();
        let page_uuid = null;
        let loading_direction;
        if(page == lowest_page - 1)
        {
            // Load the previous page.
            page_uuid = this.prev_page_uuid;
            loading_direction = "backwards";
        }
        else if(page == highest_page + 1)
        {
            // Load the next page.
            page_uuid = this.next_page_uuid;
            loading_direction = "forwards";
        }
        else if(this.next_page_offset == null)
        {
            loading_direction = "initial";
        }
        else
        {
            // This isn't our start page, and it doesn't match up with our next or previous page.
            console.log(`Loaded unexpected page ${page} (${lowest_page}...${highest_page})`);
            return;
        }
    
        if(this.next_page_offset == null)
        {
            // We haven't loaded any pages yet, so we can't resume the search in-place.  Set next_page_offset
            // to the approximate offset to skip to this page number.
            this.next_page_offset = this.estimated_items_per_page * (page-1);
        }

        // Use the search options if there's no path.  Otherwise, we're navigating inside
        // the search, so just view the contents of where we navigated to.
        let args = new helpers.args(this.url);
        let { search_options } = local_api.get_search_options_for_args(args);
        let folder_id = local_api.get_local_id_from_args(args, { get_folder: true });
        if(args.hash.get("path") != null)
        {
            search_options = { }
        }

        let order = args.hash.get("order");

        let result = await local_api.list(folder_id, {
            ...search_options,

            order: order,

            // If we have a next_page_uuid, use it to load the next page.
            page: page_uuid,
            limit: this.estimated_items_per_page,

            // This is used to approximately resume the search if next_page_uuid has expired.
            skip: this.next_page_offset,
        });

        if(!result.success)
        {
            message_widget.singleton.show("Error reading directory: " + result.reason);
            return result;
        }

        // If we got a local path, store it to allow copying it to the clipboard.
        this.local_path = result.local_path;

        // Update the next and previous page IDs.  If we're loading backwards, always update
        // the previous page.  If we're loading forwards, always update the next page.  If
        // either of these are null, update both.
        if(loading_direction == "backwards" || loading_direction == "initial")
            this.prev_page_uuid = result.pages.prev;

        if(loading_direction == "forwards" || loading_direction == "initial")
            this.next_page_uuid = result.pages.next;

        this.next_page_offset = result.next_offset;

        // If next is null, we've reached the end of the results.
        if(result.pages.next == null)
            this.reached_end = true;

        let found_illust_ids = [];
        for(let thumb of result.results)
            found_illust_ids.push(thumb.id);

        this.add_page(page, found_illust_ids);
    };

    // Override can_load_page.  If we've already loaded a page, we've cached the next
    // and previous page UUIDs and we don't want to load anything else, even if the first
    // page we loaded had no results.
    can_load_page(page)
    {
        // next_page_offset is null if we haven't tried to load anything yet.
        if(this.next_page_offset == null)
            return true;

        // If we've loaded pages 5-6, we can load anything between pages 4 and 7.
        let lowest_page = this.id_list.get_lowest_loaded_page();
        let highest_page = this.id_list.get_highest_loaded_page();
        return page >= lowest_page && page <= highest_page+1;
    }

    get viewing_folder()
    {
        let args = new helpers.args(this.url);
        return local_api.get_local_id_from_args(args, { get_folder: true });
    }

    get page_title() { return this.get_displaying_text(); }

    set_page_icon()
    {
        helpers.set_icon({vview: true});
    }

    // Handle navigating to neighboring images.
    //
    // Normally, we only support navigating from illusts that we've loaded, since there's
    // no general way to find the page an illustration is on.  If we start by viewing an
    // illust on page 10, we can't figure out that it's on page 10 in order to load it.
    //
    // Handle this better if we're viewing a local directory, by loading the full contents
    // of the directory.  This way, if we're started by viewing a local file, we can always
    // navigate around the directory.
    //
    // This is only done if we're just viewing a directory without a search.  Doing it for
    // searches is much slower since it can require scanning all results at once for filtering,
    // and it's mostly important when viewing a file in a directory.
    async get_or_load_neighboring_illust_id(illust_id, next)
    {
        // If this is a search, use the regular behavior.
        let args = new helpers.args(this.url);
        let { search_options } = local_api.get_search_options_for_args(args);
        if(search_options != null)
            return super.get_or_load_neighboring_illust_id(illust_id, next);

        // Try loading results with the normal path first.  If this succeeds, we don't need
        // to make the slower api/ids call.
        let result = await super.get_or_load_neighboring_illust_id(illust_id, next);
        if(result != null)
            return result;

        // Load IDs if we haven't done so yet.
        if(this.all_illust_ids == null)
        {
            // If we're already loading, wait for the existing request.
            if(this.load_ids_promise == null)
            {
                let folder_id = local_api.get_local_id_from_args(args, { get_folder: true });
                console.log("Loading folder contents for navigation:", folder_id);
                this.load_ids_promise = local_api.local_post_request(`/api/ids/${folder_id}`, {
                    ...search_options,
                    ids_only: true,
        
                    order: args.hash.get("order"),
                });
            }

            let result = await this.load_ids_promise;
            if(!result.success)
            {
                console.error("Error loading IDs:", result.reason);
                return;
            }

            this.all_illust_ids = result.ids;
        }

        // Find illust_id.
        let idx = this.all_illust_ids.indexOf(illust_id);
        if(idx == -1)
        {
            console.log("Illust ID not found in folder:", illust_id);
            return null;
        }

        // Find the next file, ignoring folders.
        for(let i = 0; i < 100; ++i) // sanity limit
        {
            idx += next? +1:-1;
            if(idx < 0 || idx >= this.all_illust_ids.length)
            {
                console.log("Reached the end of results");
                return null;
            }

            // If it's not an illustration, keep looking.
            let next_illust_id = this.all_illust_ids[idx];
            let { type } = helpers.parse_id(next_illust_id);
            if(type == "illust" || type == "file")
                return next_illust_id;
        }

        console.log("Couldn't find the next illust");
        return null;
    }

    get_displaying_text()
    {
        // If we have a path inside a search, show the path, since we're not showing the
        // top-level search.  Otherwise, get the search title.
        let args = new helpers.args(this.url);
        if(args.hash.get("path") != null)
        {
            let folder_id = local_api.get_local_id_from_args(args, { get_folder: true });
            return helpers.get_path_suffix(helpers.parse_id(folder_id).id);
        }
        else
        {
            return local_api.get_search_options_for_args(args).title;
        }
    }

    // Put the illust ID in the hash instead of the path.  Pixiv doesn't care about this,
    // and this avoids sending the user's filenames to their server as 404s.
    set_current_illust_id(illust_id, args)
    {
        local_api.get_args_for_id(illust_id, args);
    }

    get_current_illust_id()
    {
        let args = helpers.args.location;

        // If illust_id is in the URL, it's a regular ID.
        let illust_id = args.hash.get("illust_id");
        if(illust_id)
            return illust_id;

        illust_id = local_api.get_local_id_from_args(args);
        if(illust_id != null)
            return illust_id;
        
        return this.id_list.get_first_id();
    }

    // Tell the navigation tree widget which search to view.
    refresh_thumbnail_ui(container)
    {
        let current_args = helpers.args.location;

        // Hide the "copy local path" button if we don't have one.
        container.querySelector(".copy-local-path").hidden = this.local_path == null;

        this.set_item2(container, { type: "local-bookmarks-only", fields: {"#bookmarks": 1}, toggle: true, current_url: current_args.url });

        this.set_item2(container, { type: "local-type-all", fields: {"#type": null}, current_url: current_args.url });
        this.set_item2(container, { type: "local-type-videos", fields: {"#type": "videos"}, current_url: current_args.url });
        this.set_item2(container, { type: "local-type-images", fields: {"#type": "images"}, current_url: current_args.url });

        this.set_item2(container, { type: "local-aspect-ratio-all", fields: {"#aspect-ratio": null}, current_url: current_args.url });
        this.set_item2(container, { type: "local-aspect-ratio-landscape", fields: {"#aspect-ratio": `3:2...`}, current_url: current_args.url });
        this.set_item2(container, { type: "local-aspect-ratio-portrait", fields: {"#aspect-ratio": `...2:3`}, current_url: current_args.url });

        this.set_item2(container, { type: "local-res-all", fields: {"#pixels": null}, current_url: current_args.url });
        this.set_item2(container, { type: "local-res-high", fields: {"#pixels": "4000000..."}, current_url: current_args.url });
        this.set_item2(container, { type: "local-res-medium", fields: {"#pixels": "1000000...3999999"}, current_url: current_args.url });
        this.set_item2(container, { type: "local-res-low", fields: {"#pixels": "...999999"}, current_url: current_args.url });

        this.set_item2(container, {type: "local-sort-normal", fields: {"#order": null}, current_url: current_args.url });
        this.set_item2(container, {type: "local-sort-invert", fields: {"#order": "-normal"}, current_url: current_args.url });
        this.set_item2(container, {type: "local-sort-newest", fields: {"#order": "-ctime"}, current_url: current_args.url });
        this.set_item2(container, {type: "local-sort-oldest", fields: {"#order": "ctime"}, current_url: current_args.url });
        this.set_item2(container, {type: "local-sort-shuffle", fields: {"#order": "shuffle"}, toggle: true, current_url: current_args.url });

        this.set_active_popup_highlight(container);
        this.refresh_bookmark_tag_list(container);
    }

    refresh_bookmark_tag_list(container)
    {
        // Clear the tag list.
        let tag_list = container.querySelector(".local-bookmark-tag-list");
        for(let tag of tag_list.querySelectorAll(".following-tag"))
            tag.remove();

        // Hide the bookmark box if we're not showing bookmarks.
        tag_list.hidden = !helpers.args.location.hash.has("bookmarks");

        // Stop if we don't have the tag list yet.
        if(this.bookmark_tag_counts == null)
            return;

        let add_tag_link = (tag) =>
        {
            let tag_count = this.bookmark_tag_counts[tag];

            let a = document.createElement("a");
            a.classList.add("box-link");
            a.classList.add("following-tag");

            let tag_name = tag;
            if(tag_name == null)
                tag_name = "All";
            else if(tag_name == "")
                tag_name = "Untagged";
            a.innerText = tag_name;

            // Show the bookmark count in the popup.
            if(tag_count != null)
            {
                a.classList.add("popup");
                a.dataset.popup = tag_count + (tag_count == 1? " bookmark":" bookmarks");
            }

            let args = helpers.args.location;

            let current_tag = args.hash.get("bookmark-tag");
            if(tag == current_tag)
                a.classList.add("selected");

            args.hash.delete("path");
            if(tag == null)
                args.hash.delete("bookmark-tag");
            else
                args.hash.set("bookmark-tag", tag);
            args.query.delete("p");
            a.href = args.url.toString();
            tag_list.appendChild(a);
        };

        add_tag_link(null); // All
        add_tag_link(""); // Uncategorized
        for(var tag of Object.keys(this.bookmark_tag_counts))
        {
            // Skip uncategorized, which is always placed at the beginning.
            if(tag == "")
                continue;

            if(this.bookmark_tag_counts[tag] == 0)
                continue;

            add_tag_link(tag);
        }
    }

    async fetch_bookmark_tag_counts()
    {
        if(this.fetched_bookmark_tag_counts)
            return;
        this.fetched_bookmark_tag_counts = true;

        // We don't need to do this if we're not showing bookmarks.
        if(!helpers.args.location.hash.has("bookmarks"))
            return;

        let result = await local_api.local_post_request(`/api/bookmark/tags`);
        if(!result.success)
        {
            console.log("Error fetching bookmark tag counts");
            return;
        }

        this.bookmark_tag_counts = result.tags;
        this.call_update_listeners();
    }

    copy_link()
    {
        // The user clicked the "copy local link" button.
        navigator.clipboard.writeText(this.local_path);
    }
}

