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
        this.illust_ids_by_page = {};
    };

    get_all_illust_ids()
    {
        // Make a list of all IDs we already have.
        var all_ids = [];
        for(var page of Object.keys(this.illust_ids_by_page))
        {
            var ids = this.illust_ids_by_page[page];
            all_ids = all_ids.concat(ids);
        }
        return all_ids;
    }

    get_lowest_loaded_page()
    {
        var min_page = 999999;
        for(var page of Object.keys(this.illust_ids_by_page))
            min_page = Math.min(min_page, page);
        return min_page;
    }

    get_highest_loaded_page()
    {
        var max_page = 0;
        for(var page of Object.keys(this.illust_ids_by_page))
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

        if(this.illust_ids_by_page[page] != null)
        {
            console.warn("Page", page, "was already loaded");
            return true;
        }

        // Make a list of all IDs we already have.
        var all_illusts = this.get_all_illust_ids();

        // For fast-moving pages like new_illust.php, we'll very often get a few entries at the
        // start of page 2 that were at the end of page 1 when we requested it, because new posts
        // have been added to page 1 that we haven't seen.  Remove any duplicate IDs.
        var ids_to_remove = [];
        for(var new_id of illust_ids)
        {
            if(all_illusts.indexOf(new_id) != -1)
                ids_to_remove.push(new_id);
        }

        if(ids_to_remove.length > 0)
            console.log("Removing duplicate illustration IDs:", ids_to_remove.join(", "));
        illust_ids = illust_ids.slice();
        for(var new_id of ids_to_remove)
        {
            var idx = illust_ids.indexOf(new_id);
            illust_ids.splice(idx, 1);
        }

        // If there's nothing on this page, don't add it, so this doesn't increase
        // get_highest_loaded_page().
        // FIXME: If we removed everything, the data source will appear to have reached the last
        // page and we won't load any more pages, since thumbnail_view assumes that a page not
        // returning any data means we're at the end.
        if(illust_ids.length == 0)
            return;

        this.illust_ids_by_page[page] = illust_ids;
    };

    // Return the page number illust_id is on, or null if we don't know.
    get_page_for_illust(illust_id)
    {
        for(var page of Object.keys(this.illust_ids_by_page))
        {
            var ids = this.illust_ids_by_page[page];
            page = parseInt(page);
            if(ids.indexOf(illust_id) != -1)
                return page;
        };
        return null;
    };

    // Return the next or previous illustration.  If we don't have that page, return null.
    //
    // This only returns illustrations, skipping over any special entries like user:12345.
    get_neighboring_illust_id(illust_id, next)
    {
        for(let i = 0; i < 100; ++i) // sanity limit
        {
            illust_id = this._get_neighboring_illust_id_internal(illust_id, next);
            if(illust_id == null)
                return null;

            // If it's not an illustration, keep looking.
            if(helpers.parse_id(illust_id).type == "illust")
                return illust_id;
        }
        return null;
    }

    // The actual logic for get_neighboring_illust_id, except for skipping entries.
    _get_neighboring_illust_id_internal(illust_id, next)
    {
        var page = this.get_page_for_illust(illust_id);
        if(page == null)
            return null;

        var ids = this.illust_ids_by_page[page];
        var idx = ids.indexOf(illust_id);
        var new_idx = idx + (next? +1:-1);
        if(new_idx < 0)
        {
            // Return the last illustration on the previous page, or null if that page isn't loaded.
            var prev_page_no = page - 1;
            var prev_page_illust_ids = this.illust_ids_by_page[prev_page_no];
            if(prev_page_illust_ids == null)
                return null;
            return prev_page_illust_ids[prev_page_illust_ids.length-1];
        }
        else if(new_idx >= ids.length)
        {
            // Return the first illustration on the next page, or null if that page isn't loaded.
            var next_page_no = page + 1;
            var next_page_illust_ids = this.illust_ids_by_page[next_page_no];
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
        var page = this.get_page_for_illust(illust_id);
        if(page == null)
            return null;

        var ids = this.illust_ids_by_page[page];
        var idx = ids.indexOf(illust_id);
        var new_idx = idx + (next? +1:-1);
        if(new_idx >= 0 && new_idx < ids.length)
            return page;

        page += next? +1:-1;
        return page;
    };

    // Return the first ID, or null if we don't have any.
    get_first_id()
    {
        var keys = Object.keys(this.illust_ids_by_page);
        if(keys.length == 0)
            return null;

        var page = keys[0];
        return this.illust_ids_by_page[page][0];
    }

    // Return true if the given page is loaded.
    is_page_loaded(page)
    {
        return this.illust_ids_by_page[page] != null;
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
class data_source
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
        // If p=1 is in the query, it's the page number, which doesn't affect the data source.
        url.searchParams.delete("p");

        let args = new helpers.args(url);

        // The manga page doesn't affect the data source.
        args.hash.delete("page");

        // #view=thumbs controls which view is active.
        args.hash.delete("view");

        // illust_id in the hash is always just telling us which image within the current
        // data source to view.  data_source_current_illust is different and is handled in
        // the subclass.
        args.hash.delete("illust_id");

        // These are for quick view and don't affect the data source.
        args.hash.delete("virtual");
        args.hash.delete("quick-view");

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
    load_page(page)
    {
        var result = this.loading_pages[page];
        if(result == null)
        {
            // console.log("started loading page", page);
            var result = this._load_page_async(page);
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

    async _load_page_async(page)
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
        {
            console.info("No pages after", this.first_empty_page);
            return false;
        }

        // If the page is already loaded, stop.
        if(this.id_list.is_page_loaded(page))
            return true;
        
        // Check if this is past the end.
        if(!this.load_page_available(page))
            return false;
        
        // Start the actual load.
        var result = await this.load_page_internal(page);

        // Reduce the start page, which will update the "load more results" button if any.  It's important
        // to do this after the await above.  If we do it before, it'll update the button before we load
        // and cause the button to update before the thumbs.  view_search.refresh_images won't be able
        // to optimize that and it'll cause uglier refreshes.
        if(this.supports_start_page && page < this.initial_page)
            this.initial_page = page;

        // If there were no results, then we've loaded the last page.  Don't try to load
        // any pages beyond this.
        if(this.id_list.illust_ids_by_page[page] == null)
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

    // Return the page title to use.
    get page_title()
    {
        return "Pixiv";
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

    // Return the estimated number of items per page.  This is used to pad the thumbnail
    // list to reduce items moving around when we load pages.
    get estimated_items_per_page()
    {
        return 10;
    };

    // Return the view that should be displayed by default, if no "view" field is in the URL.
    get default_view()
    {
        return "search";
    }

    // If we're viewing a page specific to a user (an illustration or artist page), return
    // the user ID we're viewing.  This can change when refreshing the UI.
    get viewing_user_id()
    {
        return null;
    };

    // Some data sources can restart the search at a page.
    get supports_start_page() { return false; }

    // Store the current page in the URL.
    //
    // This is only used if supports_start_page is true.
    set_start_page(args, page)
    {
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
        setTimeout(function() {
            this.call_update_listeners();
        }.bind(this), 0);
    }

    call_update_listeners()
    {
        var callbacks = this.update_callbacks.slice();
        for(var callback of callbacks)
        {
            try {
                callback();
            } catch(e) {
                console.error(e);
            }
        }
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
    set_item(container, type, fields, default_values)
    {
        var link = container.querySelector("[data-type='" + type + "']");
        if(link == null)
        {
            console.warn("Couldn't find button with selector", type);
            return;
        }

        // This button is selected if all of the keys it sets are present in the URL.
        var button_is_selected = true;

        // Adjust the URL for this button.
        let url = new URL(this.url);

        // Don't include the page number in search buttons, so clicking a filter goes
        // back to page 1.
        url.searchParams.delete("p");

        let args = new helpers.args(url);
        for(var key of Object.keys(fields))
        {
            var original_key = key;
            var value = fields[key];

            // If key begins with "#", it means it goes in the hash.
            var hash = key.startsWith("#");
            if(hash)
                key = key.substr(1);

            let params = hash? args.hash:args.query;

            // The value we're setting in the URL:
            var this_value = value;
            if(this_value == null && default_values != null)
                this_value = default_values[original_key];

            // The value currently in the URL:
            var selected_value = params.get(key);
            if(selected_value == null && default_values != null)
                selected_value = default_values[original_key];

            // If the URL didn't have the key we're setting, then it isn't selected.
            if(this_value != selected_value)
                button_is_selected = false;

            // If the value we're setting is the default, delete it instead.
            if(default_values != null && this_value == default_values[original_key])
                value = null;

            if(value != null)
                params.set(key, value);
            else
                params.delete(key);
        }
        url = args.url;

        helpers.set_class(link, "selected", button_is_selected);

        link.href = url.toString();
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
    
    // Highlight search menu popups if any entry other than the default in them is
    // selected.
    //
    // selector_list is a list of selectors for each menu item.  If any of them are
    // selected and don't have the data-default attribute, set .active on the popup.
    // Search filters 
    // Set the active class on all top-level dropdowns which have something other than
    // the default selected.
    set_active_popup_highlight(container, selector_list)
    {
        for(var popup of selector_list)
        {
            var box = container.querySelector(popup);
            var selected_item = box.querySelector(".selected");
            if(selected_item == null)
            {
                // There's no selected item.  If there's no default item then this is normal, but if
                // there's a default item, it should have been selected by default, so this is probably
                // a bug.
                var default_entry_exists = box.querySelector("[data-default]") != null;
                if(default_entry_exists)
                    console.warn("Popup", popup, "has no selection");
                continue;
            }

            var selected_default = selected_item.dataset["default"];
            helpers.set_class(box, "active", !selected_default);

            // Find the dropdown menu button.
            let menu_button = box.querySelector(".menu-button");
            if(menu_button == null)
            {
                console.warn("Couldn't find menu button for " + box);
                continue;
            }

            // Store the original text, so we can restore it when the default is selected.
            if(menu_button.dataset.originalText == null)
                menu_button.dataset.originalText = menu_button.innerText;

            // If an option is selected, replace the menu button text with the selection's label.
            if(selected_default)
                menu_button.innerText = menu_button.dataset.originalText;
            else
            {
                // The short label is used to try to keep these labels from causing the menu buttons to
                // overflow the container, and for labels like "2 years ago" where the menu text doesn't
                // make sense.
                let label = selected_item.dataset.shortLabel;
                menu_button.innerText = label? label:selected_item.innerText;
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
    get estimated_items_per_page() { return 30; }

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

// /discovery
//
// This is an actual API call for once, so we don't need to scrape HTML.  We only show
// recommended works (we don't have a user view list).
//
// The API call returns 1000 entries.  We don't do pagination, we just show the 1000 entries
// and then stop.  I haven't checked to see if the API supports returning further pages.

ppixiv.data_sources.discovery = class extends data_source_fake_pagination
{
    get name() { return "discovery"; }

    // Implement data_source_fake_pagination:
    async load_all_results()
    {
        // Get "mode" from the URL.  If it's not present, use "all".
        var query_args = this.url.searchParams;
        var mode = query_args.get("mode") || "all";
        
        var data = {
            type: "illust",
            sample_illusts: "auto",
            num_recommendations: 1000,
            page: "discovery",
            mode: mode,
        };

        var result = await helpers.get_request("/rpc/recommender.php", data);

        // Unlike other APIs, this one returns IDs as ints rather than strings.  Convert back
        // to strings.
        var illust_ids = [];
        for(var illust_id of result.recommendations)
            illust_ids.push(illust_id + "");

        return illust_ids;
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

// Artist suggestions take a random sample of followed users, and query suggestions from them.
// The followed user list normally comes from /discovery/users.
//
// This can also be used to view recommendations based on a specific user.  Note that if we're
// doing this, we don't show things like the artist's avatar in the corner, so it doesn't look
// like the images we're showing are by that user.
ppixiv.data_sources.discovery_users = class extends data_source
{
    get name() { return "discovery_users"; }

    // The constructor receives the original HTMLDocument.
    constructor(url, doc)
    {
        super(url);

        let args = new helpers.args(this.url);
        let user_id = args.hash.get("user_id");
        if(user_id != null)
        {
            this.showing_user_id = user_id;
            this.sample_user_ids = [user_id]
        }
        else
            this.sample_user_ids = null;
        this.original_doc = doc;
        this.original_url = url;
        this.seen_user_ids = {};
    }

    // Return true if the two URLs refer to the same data.
    is_same_page(url1, url2)
    {
        var cleanup_url = (url) =>
        {
            var url = new URL(url);

            // The hash doesn't affect the page that we load.
            url.hash = "";
            return url.toString();
        };

        var url1 = cleanup_url(url1);
        var url2 = cleanup_url(url2);
        return url1 == url2;
    }

    // We can always return another page.
    load_page_available(page)
    {
        return true;
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
 
        // Find the sample user IDs we need to request suggestions.
        await this.load_sample_user_ids();

        var data = {
            mode: "get_recommend_users_and_works_by_user_ids",
            user_ids: this.sample_user_ids.join(","),
            user_num: 30,
            work_num: 5,
        };

        // Get suggestions.  Each entry is a user, and contains info about a small selection of
        // images.
        var result = await helpers.get_request("/rpc/index.php", data);
        if(result.error)
            throw "Error reading suggestions: " + result.message;

        // Convert the images into thumbnail_info.  Like everything else, this is returned in a format
        // slightly different from the other APIs that it's similar to.
        let illust_ids = [];
        for(let user of result.body)
        {
            // Each time we load a "page", we're actually just getting a new randomized set of recommendations
            // for our seed, so we'll often get duplicate results.  Ignore users that we've seen already.  id_list
            // will remove dupes, but we might get different sample illustrations for a duplicated artist, and
            // those wouldn't be removed.
            if(this.seen_user_ids[user.user_id])
                continue;
            this.seen_user_ids[user.user_id] = true;

            // Register this as quick user data, for use in thumbnails.
            thumbnail_data.singleton().add_quick_user_data(user, "recommendations");

            illust_ids.push("user:" + user.user_id);

            for(let illust_data of user.illusts)
                illust_ids.push(illust_data.illust_id);
        }

        // Register the new page of data.
        this.add_page(page, illust_ids);
    }

    // Read /discovery/users and set sample_user_ids from userRecommendSampleUser.
    async load_sample_user_ids()
    {
        if(this.sample_user_ids)
            return;

        // Work around a browser issue: loading an iframe with the same URL as the current page doesn't
        // work.  (This might have made sense once upon a time when it would always recurse, but today
        // this doesn't make sense.)  Just add a dummy query to the URL to make sure it's different.
        //
        // This usually doesn't happen, since we'll normally use this.original_doc if we're reading
        // the same page.  Skip it if it's not needed, so we don't throw weird URLs at the site if
        // we don't have to.
        var url = new unsafeWindow.URL(this.original_url);

        // If the underlying page isn't /discovery/users, load it in an iframe to get some data.
        let doc = this.original_doc;
        if(this.original_doc == null || !this.is_same_page(url, this.original_url))
        {
            console.log("Loading:", url.toString());
            doc = await helpers.load_data_in_iframe(url.toString());
        }

        // Look for:
        //
        // <script>pixiv.context.userRecommendSampleUser = "id,id,id,...";</script>
        let sample_user_script = null;
        for(let script of doc.querySelectorAll("script"))
        {
            let text = script.innerText;
            if(!text.startsWith("pixiv.context.userRecommendSampleUser"))
                continue;

            sample_user_script = script.innerText;
            break;
        }

        if(sample_user_script == null)
            throw "Couldn't find userRecommendSampleUser";

        // Pull out the list, and turn it into a JSON array to parse it.
        let match = sample_user_script.match(/pixiv.context.userRecommendSampleUser = "(.*)";/);
        if(match == null)
            throw "Couldn't parse userRecommendSampleUser: " + sample_user_scripts;

        this.sample_user_ids = JSON.parse("[" + match[1] + "]");
        console.log("Sample user IDs:", this.sample_user_ids);
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

// bookmark_detail.php (with recommendations=1 in the hash)
//
// We use this as an anchor page for viewing recommended illusts for an image, since
// there's no dedicated page for this.
//
// This returns a big chunk of results in one call, so we use data_source_fake_pagination
// to break it up.
ppixiv.data_sources.related_illusts = class extends data_source_fake_pagination
{
    get name() { return "related-illusts"; }
   
    async _load_page_async(page)
    {
        // The first time we load a page, get info about the source illustration too, so
        // we can show it in the UI.
        if(!this.fetched_illust_info)
        {
            this.fetched_illust_info = true;

            // Don't wait for this to finish before continuing.
            var query_args = this.url.searchParams;
            var illust_id = query_args.get("illust_id");
            image_data.singleton().get_image_info(illust_id).then((illust_info) => {
                this.illust_info = illust_info;
                this.call_update_listeners();
            }).catch((e) => {
                console.error(e);
            });
        }

        return await super._load_page_async(page);
    }
     
    // Implement data_source_fake_pagination:
    async load_all_results()
    {
        var query_args = this.url.searchParams;
        var illust_id = query_args.get("illust_id");

        var data = {
            type: "illust",
            sample_illusts: illust_id,
            num_recommendations: 1000,
        };

        var result = await helpers.get_request("/rpc/recommender.php", data);

        // Unlike other APIs, this one returns IDs as ints rather than strings.  Convert back
        // to strings.
        var illust_ids = [];
        for(var illust_id of result.recommendations)
            illust_ids.push(illust_id + "");

        return illust_ids;
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
            img.src = this.illust_info.urls.thumb;
        }
    }
}

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
        helpers.set_class(yesterday.querySelector(".box-link"), "disabled", this.prev_date == null);
        if(this.prev_date)
        {
            var url = new URL(window.location);
            url.searchParams.set("date", this.prev_date);
            yesterday.querySelector("a").href = url;
        }

        var tomorrow = container.querySelector(".nav-tomorrow");
        helpers.set_class(tomorrow.querySelector(".box-link"), "disabled", this.next_date == null);
        if(this.next_date)
        {
            var url = new URL(window.location);
            url.searchParams.set("date", this.next_date);
            tomorrow.querySelector("a").href = url;
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
// This wouldn't be needed if we could access the mobile APIs, but for some reason those
// use different authentication tokens and can't be accessed from the website.
//
// All of these work the same way.  We keep the current URL (ignoring the hash) synced up
// as a valid page URL that we can load.  If we change pages or other search options, we
// modify the URL appropriately.
class data_source_from_page extends data_source
{
    // The constructor receives the original HTMLDocument.
    constructor(url, doc)
    {
        super(url);
        if(url == null)
            throw "url can't be null";

        this.original_doc = doc;
        this.items_per_page = 1;

        // Remember the URL that original_doc came from.
        this.original_url = url;
    }

    // Return true if the two URLs refer to the same data.
    is_same_page(url1, url2)
    {
        var cleanup_url = (url) =>
        {
            var url = new URL(url);

            // p=1 and no page at all is the same.  Remove p=1 so they compare the same.
            if(url.searchParams.get("p") == "1")
                url.searchParams.delete("p");

            // The hash doesn't affect the page that we load.
            url.hash = "";
            return url.toString();
        };

        var url1 = cleanup_url(url1);
        var url2 = cleanup_url(url2);
        return url1 == url2;
    }

    load_page_available(page)
    {
        return true;
    }
    
    async load_page_internal(page)
    {
        // Our page URL looks like eg.
        //
        // https://www.pixiv.net/bookmark.php?p=2
        //
        // possibly with other search options.  Request the current URL page data.
        var url = new unsafeWindow.URL(this.original_url);

        // Update the URL with the current page.
        var params = url.searchParams;
        params.set("p", page);

        if(this.original_doc != null && this.is_same_page(url, this.original_url))
        {
            this.finished_loading_illust(page, this.original_doc);
            return true;
        }

        url.search = params.toString();

        console.log("Loading:", url.toString());

        var doc = await helpers.load_data_in_iframe(url.toString());
        this.finished_loading_illust(page, doc);
    };

    get estimated_items_per_page() { return this.items_per_page; }

    // We finished loading a page.  Parse it and register the results.
    finished_loading_illust(page, doc)
    {
        var illust_ids = this.parse_document(doc);
        if(illust_ids == null)
        {
            // The most common case of there being no data in the document is loading
            // a deleted illustration.  See if we can find an error message.
            console.error("No data on page");
            var error = doc.querySelector(".error-message");
            var error_message = "Error loading page";
            if(error != null)
                error_message = error.textContent;
            message_widget.singleton.show(error_message);
            message_widget.singleton.clear_timer();
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

// There are two ways we can show images for a user: from an illustration page
// (/artworks/#), or from the user's works page (/users/#).
//
// The illustration page is better, since it gives us the ID of every post by the
// user, so we don't have to fetch them page by page, but we have to know the ID
// of a post to get to to that.  It's also handy because we can tell where we are
// in the list from the illustration ID without having to know which page we're on,
// the page has the user info encoded (so we don't have to request it separately,
// making loads faster), and if we're going to display a specific illustration, we
// don't need to request it separately either.
//
// However, we can only do searching and filtering on the user page, and that's
// where we land when we load a link to the user.
ppixiv.data_sources.artist = class extends data_source
{
    get name() { return "artist"; }
  
    constructor(url)
    {
        super(url);

        this.fanbox_url = null;
    }

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
                var illust_ids = await this.load_all_results();
                this.pages = paginate_illust_ids(illust_ids, this.estimated_items_per_page);
            }

            // Register this page.
            var illust_ids = this.pages[page-1] || [];
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
            links.push(this.fanbox_url);
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
        if(this.user_info)
        {
            thumbnail_view.avatar_widget.set_from_user_data(this.user_info);
        }

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
        
        var add_tag_link = (tag) =>
        {
            var a = document.createElement("a");
            a.classList.add("box-link");
            a.classList.add("following-tag");
            a.innerText = tag;

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
            add_tag_link("All");
            for(var tag of this.post_tags || [])
                add_tag_link(tag);
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
        // Only do this once.
        if(this.loaded_tags)
        {
            console.log("already loaded");
            return;
        }
        this.loaded_tags = true;

        // Get user info.  We probably have this on this.user_info, but that async load
        // might not be finished yet.
        var user_info = await image_data.singleton().get_user_info_full(this.viewing_user_id);
        console.log("Loading tags for user", user_info.userId);

        // Load the user's common tags.
        this.post_tags = await this.get_user_tags(user_info);

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

        var result = await helpers.get_request("https://www.pixiv.net/ajax/user/" + user_info.userId + "/illustmanga/tags", {});
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

        var tags = [];
        for(var tag_info of result.body)
            tags.push(tag_info.tag);

        // Cache the results on the user info.
        user_info.frequentTags = tags;
        return tags;
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

// Viewing a single illustration.
//
// This page gives us all of the user's illustration IDs, so we can treat this as
// a data source for a user without having to make separate requests.
//
// This reads data from a page, but we don't use data_source_from_page here.  We
// don't need its pagination logic, and we do want to have pagination from data_source_fake_pagination.
ppixiv.data_sources.current_illust = class extends data_source
{
    get name() { return "illust"; }

    // The constructor receives the original HTMLDocument.
    constructor(url, doc)
    {
        super(url);

        this.original_doc = doc;
        this.original_url = url;

        // /artworks/#
        url = new URL(url);
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");
        this.illust_id = parts[2];

        this.check_illust();
    }

    // Show the illustration by default.
    get default_view()
    {
        return "illust";
    }

    // This data source just views a single image and doesn't return any posts.
    async load_page_internal(page) { }

    check_illust()
    {
        if(this.original_doc == null)
            return;
    
        // Check that this is actually an illust page.
        let preload = this.original_doc.querySelector("#meta-preload-data");
        if(preload != null)
            return;

        // The most common case of there being no data in the document is loading
        // a deleted illustration.  See if we can find an error message.
        console.error("Couldn't find globalInitData");

        console.error("No data on page");
        var error = this.original_doc.querySelector(".error-message");
        var error_message = "Error loading page";
        if(error != null)
            error_message = error.textContent;

        // Hack: show this async instead of immediately.  main.set_current_data_source will hide
        // the error message if the data source is changing and it's tricky to fix the ordering.
        setTimeout(() => {
            message_widget.singleton.show(error_message);
            message_widget.singleton.clear_timer();
        }, 0);
    }

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

    get page_title()
    {
        if(this.user_info)
            return this.user_info.name;
        else
            return "Illustrations";
    }

    get_displaying_text()
    {
        if(this.user_info)
            return this.user_info.name + "'s Illustrations";
        else
            return "Illustrations";
    };

    refresh_thumbnail_ui(container, thumbnail_view)
    {
        if(this.user_info)
        {
            thumbnail_view.avatar_widget.set_from_user_data(this.user_info);
        }
    }

    get page_title()
    {
        if(this.user_info)
            return this.user_info.name;
        else
            return "Illustrations";
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
    }

    // Return the bookmark types we're showing: "public", "private" or "both".
    get public_search_mode() { throw "Not implemented"; }

    async load_page_internal(page)
    {
        this.fetch_bookmark_tag_counts();
        
        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        var user_info = await image_data.singleton().get_user_info_full(this.viewing_user_id);

        this.user_info = user_info;
        this.call_update_listeners();

        await this.continue_loading_page_internal(page);
    };

    get supports_start_page()
    {
        return true;
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

        // Fetch bookmark tags.  We can do this in parallel with everything else.
        var url = "https://www.pixiv.net/ajax/user/" + this.viewing_user_id + "/illusts/bookmark/tags";
        var result = await helpers.get_request(url, {});

        let search_mode = this.public_search_mode;
        
        // Reformat the tag list into a format that's easier to work with.
        let tags = { };
        let add_tag = (tag, public_tag) =>
        {
            // Rename "未分類" (uncategorized) to "".
            if(tag.tag == "未分類")
                tag.tag = "";

            if(tags[tag.tag] == null)
                tags[tag.tag] = 0;

            // Add to the tag count.
            let tag_count = parseInt(bookmark_tag.cnt);
            if(search_mode == "public" && public_tag)
                tags[tag.tag] += tag_count;
            if(search_mode == "private" && !public_tag)
                tags[tag.tag] += tag_count;
            if(search_mode == "both")
                tags[tag.tag] += tag_count;
        };

        for(var bookmark_tag of result.body.public)
            add_tag(bookmark_tag, true);
        for(var bookmark_tag of result.body.private)
            add_tag(bookmark_tag, false);

        // Sort tags by count, so we can trim just the most used tags.  Use the count for the
        // display mode we're in.
        var all_tags = Object.keys(tags);
        all_tags.sort(function(lhs, rhs) {
            return tags[lhs].count - tags[lhs].count;
        });

        // Trim the list.  Some users will return thousands of tags.
        all_tags.splice(20);
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
            offset: (page-1)*20,
            limit: 20,
            rest: rest, // public or private (no way to get both)
        };
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
        let private_bookmarks = args.query.get("rest") == "hide";
        var displaying = this.viewing_all_bookmarks? "All Bookmarks":
            private_bookmarks? "Private Bookmarks":"Public Bookmarks";

        var tag = this.displaying_tag;
        if(tag)
            displaying += " with tag \"" + tag + "\"";

        return displaying;
    };

    get viewing_all_bookmarks() { return false; }

    refresh_thumbnail_ui(container, thumbnail_view)
    {
        // The public/private button only makes sense when viewing your own bookmarks.
        var public_private_button_container = container.querySelector(".bookmarks-public-private");
        public_private_button_container.hidden = !this.viewing_own_bookmarks();

        // Set up the public and private buttons.
        this.set_item(public_private_button_container, "all", {"#show-all": 1}, {"#show-all": 1});
        this.set_item(container, "public", {rest: null, "#show-all": 0}, {"#show-all": 1});
        this.set_item(container, "private", {rest: "hide", "#show-all": 0}, {"#show-all": 1});

        // Refresh the bookmark tag list.  Remove the page number from these buttons.
        let current_url = new URL(this.url);
        current_url.searchParams.delete("p");

        var tag_list = container.querySelector(".bookmark-tag-list");
        let current_tag = this.displaying_tag;
        
        helpers.remove_elements(tag_list);

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
                tag_name = "Uncategorized";
            a.innerText = tag_name;

            // Show the bookmark count in the popup.
            if(tag != "All")
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
                parts[5] = tag;
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

        if(this.user_info)
            thumbnail_view.avatar_widget.set_from_user_data(this.user_info);
    }

    get viewing_user_id()
    {
        if(helpers.get_path_part(this.url, 0) == "users")
        {
            // New URLs (/users/13245/bookmarks)
            //
            // This is currently only used for viewing other people's bookmarks.  Your own bookmarks are still
            // viewed with /bookmark.php with no ID.
            return helpers.get_path_part(this.url, 1);
        }
        else
        {
            // Old URLs (/bookmark.php?id=12345)
            // If there's no user ID in the URL, view our own bookmarks.
            var query_args = this.url.searchParams;
            var user_id = query_args.get("id");
            if(user_id == null)
                return window.global_data.user_id;
            
            return query_args.get("id");
        }
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
    get public_search_mode()
    {
        var query_args = this.url.searchParams;
        var rest = query_args.get("rest") || "show";
        return rest == "show"? "public":"private";
    }

    async continue_loading_page_internal(page)
    {
        var data = this.get_bookmark_query_params(page);

        var url = "/ajax/user/" + this.viewing_user_id + "/illusts/bookmarks";
        var result = await helpers.get_request(url, data);
        result.body.works = data_source_bookmarks_base.filter_deleted_images(result.body.works);

        var illust_ids = [];
        for(var illust_data of result.body.works)
            illust_ids.push(illust_data.id);

        // This request returns all of the thumbnail data we need.  Forward it to
        // thumbnail_data so we don't need to look it up.
        thumbnail_data.singleton().loaded_thumbnail_info(result.body.works, "normal");

        // Register the new page of data.
        this.add_page(page, illust_ids);
    }
};

// Merged bookmark querying.  This makes queries for both public and private bookmarks,
// and merges them together.
ppixiv.data_sources.bookmarks_merged = class extends data_source_bookmarks_base
{
    get viewing_all_bookmarks() { return true; }
    get public_search_mode() { return "both"; }

    constructor(url)
    {
        super(url);

        this.max_page_per_type = [-1, -1]; // public, private
        this.bookmark_illust_ids = [[], []]; // public, private
    }

    async continue_loading_page_internal(page)
    {
        // Request both the public and private bookmarks on the given page.  If we've
        // already reached the end of either of them, don't send that request.
        var request1 = this.request_bookmarks(page, "show");
        var request2 = this.request_bookmarks(page, "hide");

        // Wait for both requests to finish.
        await Promise.all([request1, request2]);

        // Both requests finished.  Combine the two lists of illust IDs into a single page
        // and register it.
        var illust_ids = [];
        for(var i = 0; i < 2; ++i)
            if(this.bookmark_illust_ids[i] != null && this.bookmark_illust_ids[i][page] != null)
                illust_ids = illust_ids.concat(this.bookmark_illust_ids[i][page]);
        
        this.add_page(page, illust_ids);
    }

    async request_bookmarks(page, rest)
    {
        var is_private = rest == "hide"? 1:0;
        var max_page = this.max_page_per_type[is_private];
        if(max_page != -1 && page > max_page)
        {
            // We're past the end.
            console.log("page", page, "beyond", max_page, rest);
            return;
        }

        var data = this.get_bookmark_query_params(page, rest);

        var url = "/ajax/user/" + this.viewing_user_id + "/illusts/bookmarks";
        var result = await helpers.get_request(url, data);
        result.body.works = data_source_bookmarks_base.filter_deleted_images(result.body.works);

        // Put higher (newer) bookmarks first.
        result.body.works.sort(function(lhs, rhs)
        {
            return parseInt(rhs.bookmarkData.id) - parseInt(lhs.bookmarkData.id);
        });

        var illust_ids = [];
        for(var illust_data of result.body.works)
            illust_ids.push(illust_data.id);

        // This request returns all of the thumbnail data we need.  Forward it to
        // thumbnail_data so we don't need to look it up.
        thumbnail_data.singleton().loaded_thumbnail_info(result.body.works, "normal");

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
        let translations = [];
        for(let tag of Object.keys(data.tagTranslation))
        {
            translations.push({
                tag: tag,
                translation: data.tagTranslation[tag],
            });
        }
        tag_translations.get().add_translations(translations);

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
        helpers.remove_elements(tag_list);

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

    constructor(url, doc)
    {
        super(url, doc);

        this.cache_search_title = this.cache_search_title.bind(this);

        // Add the search tags to tag history.  We only do this at the start when the
        // data source is created, not every time we navigate back to the search.
        let tag = this._search_tags;
        if(tag)
            helpers.add_recent_search_tag(tag);

        this.cache_search_title();
    }

    get _search_tags()
    {
        return helpers._get_search_tags_from_url(this.url);
    }

    // Return the search type from the URL.  This is one of "artworks", "illustrations"
    // or "novels" (not supported").  It can also be omitted, which is the "top" page,
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
        var query_args = this.url.searchParams;
        let args = {
            p: page,
        };

        // "artworks" and "illustrations" are different on the search page: "artworks" uses "/tag/TAG/artworks",
        // and "illustrations" is "/tag/TAG/illustrations?type=illust_and_ugoira".
        let search_type = this._search_type;
        let api_search_type = "artworks";
        if(search_type == "artworks")
        {
            // "artworks" doesn't use the type field.
            api_search_type = "artworks";
        }
        else
        if(search_type == "illustrations")
        {
            api_search_type = "illustrations";
            args.type = "illust_and_ugoira";
        }
        else if(search_type == "manga")
        {
            api_search_type = "manga";
            args.type = "manga";
        }

        query_args.forEach((value, key) => { args[key] = value; });
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
            this.related_tags = [];
            for(let tag of body.relatedTags)
                this.related_tags.push({tag: tag});
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
        container.querySelector(".search-page-tag-entry .search-tags").value = tag;
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
        {
            thumbnail_view.tag_widget.set({
                tags: this.related_tags
            });
        }

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

        this.set_active_popup_highlight(container, [".ages-box", ".popularity-box", ".type-box", ".search-mode-box", ".size-box", ".aspect-ratio-box", ".bookmarks-box", ".time-box", ".member-tags-box"]);

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
            offset: 48*(page-1),
            limit: 48,
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
        if(this.user_info)
        {
            thumbnail_view.avatar_widget.set_from_user_data(this.user_info);
        }

        // The public/private button only makes sense when viewing your own follows.
        var public_private_button_container = container.querySelector(".follows-public-private");
        public_private_button_container.hidden = !this.viewing_self;

        this.set_item(container, "public-follows", {rest: "show"}, {rest: "show"});
        this.set_item(container, "private-follows", {rest: "hide"}, {rest: "show"});

        var tag_list = container.querySelector(".follow-tag-list");
        
        helpers.remove_elements(tag_list);

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
            if(tag == "Uncategorized")
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

        if(this.user_info)
            thumbnail_view.avatar_widget.set_from_user_data(this.user_info);
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
                profile_img: element.dataset.profile_img.replace("_50", "_170"),
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
            img.src = this.illust_info.urls.thumb;
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

    
/*
    refresh_thumbnail_ui(container, thumbnail_view)
    {
        this.set_item(container, "public-follows", {rest: "show"}, {rest: "show"});
        this.set_item(container, "private-follows", {rest: "hide"}, {rest: "show"});

        var tag_list = container.querySelector(".follow-tag-list");
        
        helpers.remove_elements(tag_list);

        // Refresh the bookmark tag list.  Remove the page number from these buttons.
        let current_url = new URL(this.url);
        current_url.searchParams.delete("p");
        let current_query = current_url.searchParams.toString();
    }
*/

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

