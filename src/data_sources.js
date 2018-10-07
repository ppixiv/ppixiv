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

    get_highest_loaded_page()
    {
        var max_page = 1;
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
        if(this.illust_ids_by_page[page] != null)
        {
            console.warn("Page", page, "was already loaded");
            return true;
        }

        // Make a list of all IDs we already have.
        var all_illusts = this.get_all_illust_ids();

        // Special case: If there are any entries in this page which are also in the previous page,
        // just remove them from this page.
        //
        // For fast-moving pages like new_illust.php, we'll very often get a few entries at the
        // start of page 2 that were at the end of page 1 when we requested it, because new posts
        // have been added to page 1 that we haven't seen.  If we don't handle this, we'll clear
        // the page cache below on almost every page navigation.  Instead, we just remove the
        // duplicate IDs and end up with a slightly shorter page 2.
        var previous_page_illust_ids = this.illust_ids_by_page[page-1];
        if(previous_page_illust_ids)
        {
            var ids_to_remove = [];
            for(var new_id of illust_ids)
            {
                if(previous_page_illust_ids.indexOf(new_id) != -1)
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
        }

        // If there's nothing on this page, don't add it, so this doesn't increase
        // get_highest_loaded_page().
        // FIXME: If we removed everything, the data source will appear to have reached the last
        // page and we won't load any more pages, since thumbnail_view assumes that a page not
        // returning any data means we're at the end.
        if(illust_ids.length == 0)
            return true;

        // See if we already have any IDs in illust_ids.
        var duplicated_id = false;
        for(var new_id of illust_ids)
        {
            if(all_illusts.indexOf(new_id) != -1)
            {
                duplicated_id = true;
                break;
            }
        }

        var result = true;
        if(duplicated_id)
        {
            console.info("Page", page, "duplicates an illustration ID.  Clearing page cache.");
            this.illust_ids_by_page = {};

            // Return false to let the caller know we've done this, and that it should clear
            // any page caches.
            result = false;
        }

        this.illust_ids_by_page[page] = illust_ids;
        return result;
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
    get_neighboring_illust_id(illust_id, next)
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
        this.loading_page_callbacks = {};
        this.first_empty_page = -1;
        this.update_callbacks = [];
    };

    // If a data source returns a name, we'll display any .data-source-specific elements in
    // the thumbnail view with that name.
    get name() { return null; }
    
    // Return a canonical URL for this data source.  If the canonical URL is the same,
    // the same instance of the data source should be used.
    //
    // A single data source is used eg. for a particular search and search flags.  If
    // flags are changed, such as changing filters, a new data source instance is created.
    // However, some parts of the URL don't cause a new data source to be used.  Return
    // a URL with all unrelated parts removed, and with query and hash parameters sorted
    // alphabetically.
    //
    // Due to some quirkiness in data_source_current_illust, this is async.
    static async get_canonical_url(url)
    {
        // Make a copy of the URL.
        var url = new URL(url);
        this.remove_ignored_url_parts(url);

        // Sort query parameters.  We don't use multiple parameters with the same key.
        url.search = helpers.sort_query_parameters(url.searchParams).toString();

        // Sort hash parameters.
        var new_hash = helpers.sort_query_parameters(helpers.get_hash_args(url));
        helpers.set_hash_args(url, new_hash);        
        
        return url.toString();
    }

    // This is overridden by subclasses to remove parts of the URL that don't affect
    // which data source instance is used.
    static remove_ignored_url_parts(url)
    {
        // If p=1 is in the query, it's the page number, which doesn't affect the data source.
        url.searchParams.delete("p");

        var hash_args = helpers.get_hash_args(url);

        // #x=1 is a workaround for iframe loading.
        hash_args.delete("x");

        // The manga page doesn't affect the data source.
        hash_args.delete("page");

        // #view=thumbs controls which view is active.
        hash_args.delete("view");

        // illust_id in the hash is always just telling us which image within the current
        // data source to view.  data_source_current_illust is different and is handled in
        // the subclass.
        hash_args.delete("illust_id");

        // Any illust_id in the search or the hash doesn't require a new data source.
        // bluh
        // but the user underneath it does

        helpers.set_hash_args(url, hash_args);        
    }

    // Return the page that will be loaded by default, if load_page(null) is called.
    //
    // Most data sources store the page in the query.
    get_default_page()
    {
        var query_args = this.url.searchParams;
        return parseInt(query_args.get("p")) || 1;
    }

    // Load the given page, or the page of the current history state if page is null.
    // Call callback when the load finishes.
    //
    // If we synchronously know that the page doesn't exist, return false and don't
    // call callback.  Otherwise, return true.
    load_page(page, callback)
    {
        // If page is null, use the default page.
        if(page == null)
            page = this.get_default_page();

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

        // If the page is already loaded, just call the callback.
        if(this.id_list.is_page_loaded(page))
        {
            setTimeout(function() {
                if(callback != null)
                    callback();
            }.bind(this), 0);
            return true;
        }
        
        // If a page is loading, loading_page_callbacks[page] is a list of callbacks waiting
        // for that page.
        if(this.loading_page_callbacks[page])
        {
            // This page is currently loading, so just add the callback to that page's list.
            // This makes sure we don't spam the same request several times if different things
            // request it at the same time.
            if(callback != null)
                this.loading_page_callbacks[page].push(callback);
            return true;
        }

        // Check if this is past the end.
        if(!this.load_page_available(page))
            return false;
        
        // Create the callbacks list for this page if it doesn't exist.  This also records that
        // the request for this page is in progress.
        if(this.loading_page_callbacks[page] == null)
            this.loading_page_callbacks[page] = [];

        // Add this callback to the list, if any.
        if(callback != null)
            this.loading_page_callbacks[page].push(callback);

        var is_synchronous = true;

        var completed = function()
        {
            // If there were no results, then we've loaded the last page.  Don't try to load
            // any pages beyond this.
            if(this.id_list.illust_ids_by_page[page] == null)
            {
                console.log("No data on page", page);
                if(this.first_empty_page == -1 || page < this.first_empty_page)
                    this.first_empty_page = page;
            };

            // Call all callbacks waiting for this page.
            var callbacks = this.loading_page_callbacks[page].slice();
            delete this.loading_page_callbacks[page];

            for(var callback of callbacks)
            {
                try {
                    callback();
                } catch(e) {
                    console.error(e);
                }
            }
        }.bind(this);

        // Start the actual load.
        this.load_page_internal(page).then(function() {
            // If is_synchronous is true, the data source finished immediately before load_page_internal
            // returned.  This happens when the data is already available and didn't need to be loaded.
            // Make sure we complete the load asynchronously even if it finished synchronously.
            if(is_synchronous)
                setTimeout(completed, 0);
            else
                completed();
        }.bind(this));

        is_synchronous = false;

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
        var hash_args = helpers.get_hash_args(document.location);
        if(hash_args.has("illust_id"))
            return hash_args.get("illust_id");
        
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
    set_current_illust_id(illust_id, query_args, hash_args)
    {
        // By default, put the illust_id in the hash.
        hash_args.set("illust_id", illust_id);
    }

    // Load from the current history state.  Load the current page (if needed), then call
    // callback().
    //
    // This is called when changing history states.  The data source should load the new
    // page if needed, then call this.callback.
    load_current_page(callback)
    {
        this.load_page(null, callback);
    };

    async load_current_page_async()
    {
        return new Promise(resolve => {
            this.load_current_page((user_info) => {
                resolve();
            });
        });
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
        var result = this.id_list.add_page(page, illust_ids);

        // Call update listeners asynchronously to let them know we have more data.
        setTimeout(function() {
            this.call_update_listeners();
        }.bind(this), 0);
        return result;
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

    // Each data source can have a different UI in the thumbnail view.  container is
    // the thumbnail-ui-box container to refresh.
    refresh_thumbnail_ui(container) { }

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
        var url = new URL(document.location);
        var hash_args = helpers.get_hash_args(url);
        for(var key of Object.keys(fields))
        {
            var original_key = key;
            var value = fields[key];

            // If key begins with "#", it means it goes in the hash.
            var hash = key.startsWith("#");
            if(hash)
                key = key.substr(1);

            var params = hash? hash_args:url.searchParams;

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
        helpers.set_hash_args(url, hash_args);

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
        }
    }

    // Return true of the thumbnail view should show bookmark icons for this source.
    get show_bookmark_icons()
    {
        return true;
    }
};

// This extends data_source with local pagination.
//
// A few API calls just return all results as a big list of IDs.  We can handle loading
// them all at once, but it results in a very long scroll box, which makes scrolling
// awkward.  This artificially paginates the results.
class data_source_fake_pagination extends data_source
{
    get estimated_items_per_page() { return 30; }

    constructor(url)
    {
        super(url);

        this.all_illust_ids = null;
    }

    async load_page_internal(page)
    {
        if(this.loading_results == null)
        {
            this.loading_results = new Promise(resolve => {
                setTimeout(async function() {
                    var all_illust_ids = await this.load_all_results();

                    // Record the IDs.  Don't register all of them now, we'll wait until pages
                    // are requested.
                    this.all_illust_ids = all_illust_ids;
                    
                    // Allow all calls to load_page_internal to continue.
                    resolve();
                }.bind(this), 0);
            });
        }

        // Wait for loading_results to complete, if it hasn't yet.
        await this.loading_results;
        this.register_loaded_page(page);
    }

    register_loaded_page(page)
    {
        // If this page isn't loaded, load it now.
        if(this.id_list.is_page_loaded(page))
            return;

        // Paginate the big list of results.  Note that page starts at 1.
        var first_idx = (page-1) * this.estimated_items_per_page;
        var count = this.estimated_items_per_page;
        var illust_ids = [];
        for(var idx = first_idx; idx < first_idx + count && idx < this.all_illust_ids.length; ++idx)
            illust_ids.push(this.all_illust_ids[idx]);
    
        // Register the new page of data.
        this.add_page(page, illust_ids);
    }

    // Implemented by the subclass.  Load all results, and call finished_loading_results
    // with the resulting IDs.
    load_all_results()
    {
        throw "Not implemented";
    }

    // XXX remove
    finished_loading_results(all_illust_ids)
    {
        // Record the IDs.  Don't register all of them now, we'll wait until pages
        // are requested.
        this.all_illust_ids = all_illust_ids;
        this.finish_pending_callbacks();
    }
}

// /discovery
//
// This is an actual API call for once, so we don't need to scrape HTML.  We only show
// recommended works (we don't have a user view list).
//
// The API call returns 1000 entries.  We don't do pagination, we just show the 1000 entries
// and then stop.  I haven't checked to see if the API supports returning further pages.
class data_source_discovery extends data_source_fake_pagination
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

        var result = await helpers.get_request_async("/rpc/recommender.php", data);

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
        var current_mode = new URL(document.location).searchParams.get("mode") || "all";
        helpers.set_class(container.querySelector(".box-link[data-type=all]"), "selected", current_mode == "all");
        helpers.set_class(container.querySelector(".box-link[data-type=safe]"), "selected", current_mode == "safe");
        helpers.set_class(container.querySelector(".box-link[data-type=r18]"), "selected", current_mode == "r18");
    }
}


// bookmark_detail.php
//
// We use this as an anchor page for viewing recommended illusts for an image, since
// there's no dedicated page for this.
//
// This returns a big chunk of results in one call, so we use data_source_fake_pagination
// to break it up.
class data_source_related_illusts extends data_source_fake_pagination
{
    get name() { return "related-illusts"; }
   
    load_page(page, callback)
    {
        // The first time we load a page, get info about the source illustration too, so
        // we can show it in the UI.
        if(!this.fetched_illust_info)
        {
            this.fetched_illust_info = true;

            var query_args = this.url.searchParams;
            var illust_id = query_args.get("illust_id");
            image_data.singleton().get_image_info(illust_id, function(illust_info) {
                this.illust_info = illust_info;
                this.call_update_listeners();
            }.bind(this));
        }

        return super.load_page(page, callback);
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

        var result = await helpers.get_request_async("/rpc/recommender.php", data);

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
            source_link.href = "/member_illust.php?mode=medium&illust_id=" + this.illust_info.illustId + "#ppixiv";

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
class data_source_rankings extends data_source
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

        var result = await helpers.get_request_async("/ranking.php", data);

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
            image_data.singleton().set_user_id_for_illust_id(illust_id, user_id)
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
        this.set_item(container, "mode-weekly", {mode: "weekly"});
        this.set_item(container, "mode-monthly", {mode: "monthly"});
        this.set_item(container, "mode-rookie", {mode: "rookie"});
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
            "all/weekly",
            "all/monthly",
            "all/rookie",
            "all/male",
            "all/female",

            "illust/daily",
            "illust/daily_r18",
            "illust/weekly",
            "illust/monthly",
            "illust/rookie",

            "ugoira/daily",
            "ugoira/weekly",
            "ugoira/daily_r18",

            "manga/daily",
            "manga/daily_r18",
            "manga/weekly",
            "manga/monthly",
            "manga/rookie",
        ];

        // Check each link in both checked-links sections.
        for(var a of container.querySelectorAll(".checked-links a"))
        {
            var url = new URL(a.href, document.location);
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

        this.original_doc = doc;
        this.items_per_page = 1;

        // Remember the URL that original_doc came from.
        this.original_url = url;
    }

    // Return true if the two URLs refer to the same data.
    is_same_page(url1, url2)
    {
        var cleanup_url = function(url)
        {
            var url = new URL(url);

            // p=1 and no page at all is the same.  Remove p=1 so they compare the same.
            if(url.searchParams.get("p") == "1")
                url.searchParams.delete("p");

            // Any "x" parameter is a dummy that we set to force the iframe to load, so ignore
            // it here.
            url.searchParams.delete("x");

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

        // Work around a browser issue: loading an iframe with the same URL as the current page doesn't
        // work.  (This might have made sense once upon a time when it would always recurse, but today
        // this doesn't make sense.)  Just add a dummy query to the URL to make sure it's different.
        //
        // This usually doesn't happen, since we'll normally use this.original_doc if we're reading
        // the same page.  Skip it if it's not needed, so we don't throw weird URLs at the site if
        // we don't have to.
        if(this.is_same_page(url, this.original_url))
            params.set("x", 1);
                
        url.search = params.toString();

        console.log("Loading:", url.toString());

        var doc = await helpers.load_data_in_iframe_async(url.toString());
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
        if(!this.add_page(page, illust_ids))
        {
            // The page list was cleared because the underlying results have changed too much,
            // which means we want to re-request pages when they're viewed next.  Clear original_doc,
            // or we won't actually do that for page 1.
            this.original_doc = null;
            this.original_url = null;
        }
    }

    // Parse the loaded document and return the illust_ids.
    parse_document(doc)
    {
        throw "Not implemented";
    }

    set_current_illust_id(illust_id, query_args, hash_args)
    {
        // Use the default behavior for illust_id.
        super.set_current_illust_id(illust_id, query_args, hash_args);

        // Update the current page.  (This can be undefined if we're on a page that isn't
        // actually loaded for some reason.)
        var original_page = this.id_list.get_page_for_illust(illust_id);
        if(original_page != null)
            query_args.set("p", original_page);
    };
};

// There are two ways we can show images for a user: from an illustration page
// (member_illust.php?mode=medium&illust_id=1234), or from the user's works page
// (member_illust.php?id=1234).
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
class data_source_artist extends data_source_fake_pagination
{
    get name() { return "artist"; }
  
    get viewing_user_id()
    {
        var query_args = this.url.searchParams;
        return query_args.get("id");
    };

    async load_all_results()
    {
        this.post_tags = [];
        
        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        var user_info = await image_data.singleton().get_user_info_full_async(this.viewing_user_id);
        console.log("xxx", user_info);

        this.user_info = user_info;
        this.call_update_listeners();

        var query_args = this.url.searchParams;
        var type = query_args.get("type");

        var result = await helpers.get_request_async("/ajax/user/" + this.viewing_user_id + "/profile/all", {});

        var illust_ids = [];
        if(type == null || type == "illust")
            for(var illust_id in result.body.illusts)
                illust_ids.push(illust_id);
        if(type == null || type == "manga")
            for(var illust_id in result.body.manga)
                illust_ids.push(illust_id);

        // Sort the two sets of IDs back together, putting higher (newer) IDs first.
        illust_ids.sort(function(lhs, rhs)
        {
            return parseInt(rhs) - parseInt(lhs);
        });

        // Request common tags for these posts.
        //
        // get_request doesn't handle PHP's wonky array format for GET arguments, so we just
        // format it here.
        this.post_tags = [];
        var tags_for_illust_ids = illust_ids.slice(0,50);
        if(tags_for_illust_ids.length > 0)
        {
            var id_args = "";
            for(var id of tags_for_illust_ids)
            {
                if(id_args != "")
                    id_args += "&";
                id_args += "ids%5B%5D=" + id;
            }

            var frequent_tag_result = await helpers.get_request_async("/ajax/tags/frequent/illust?" + id_args, {});
            for(var tag of frequent_tag_result.body)
                this.post_tags.push(tag);
            this.call_update_listeners();
        }

        return illust_ids;
    };

    refresh_thumbnail_ui(container, thumbnail_view)
    {
        if(this.user_info)
        {
            thumbnail_view.avatar_widget.set_from_user_data(this.user_info);
            helpers.set_page_icon(this.user_info.isFollowed? binary_data['favorited_icon.png']:binary_data['regular_pixiv_icon.png']);
        }

        this.set_item(container, "artist-works", {type: null});
        this.set_item(container, "artist-illust", {type: "illust"});
        this.set_item(container, "artist-manga", {type: "manga"});
        
        // Refresh the post tag list.
        var current_query = new URL(document.location).searchParams.toString();
        
        var tag_list = container.querySelector(".post-tag-list");
        helpers.remove_elements(tag_list);
        
        var add_tag_link = function(tag)
        {
            var a = document.createElement("a");
            a.classList.add("box-link");
            a.classList.add("following-tag");
            a.innerText = tag;

            var url = new URL(document.location);

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

        add_tag_link("All");
        for(var tag of this.post_tags || [])
            add_tag_link(tag);

        this.set_active_popup_highlight(container, [".member-tags-box"]);
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
class data_source_current_illust extends data_source_fake_pagination
{
    get name() { return "illust"; }

    // The constructor receives the original HTMLDocument.
    constructor(url, doc)
    {
        super(url);

        this.original_doc = doc;
        this.original_url = url;
    }

    // Show the illustration by default.
    get default_view()
    {
        return "illust";
    }

    get_default_page() { return 1; }

    // Implement data_source_fake_pagination:
    async load_all_results()
    {
        if(this.original_doc != null)
            return this.load_all_results_from(this.original_doc);

        var url = new unsafeWindow.URL(this.original_url);

        // Work around browsers not loading the iframe properly when it has the same URL.
        url.searchParams.set("x", 1);
        
        console.log("Loading:", url.toString());

        var doc = await helpers.load_data_in_iframe_async(url.toString());
        return this.load_all_results_from(doc);
    };

    // Parse out illust IDs from doc, and pass them to finished_loading_results.
    load_all_results_from(doc)
    {
        var illust_ids = this.parse_document(doc);
        if(illust_ids != null)
            return illust_ids;

        // The most common case of there being no data in the document is loading
        // a deleted illustration.  See if we can find an error message.
        console.error("No data on page");
        var error = doc.querySelector(".error-message");
        var error_message = "Error loading page";
        if(error != null)
            error_message = error.textContent;
        message_widget.singleton.show(error_message);
        message_widget.singleton.clear_timer();

        return [];
    }

    parse_document(doc)
    {
        var data = helpers.get_global_init_data(doc);
        if(data == null)
        {
            console.error("Couldn't find globalInitData");
            return;
        }

        var illust_id = Object.keys(data.preload.illust)[0];
        var user_id = Object.keys(data.preload.user)[0];
        this.user_info = data.preload.user[user_id];
        var this_illust_data = data.preload.illust[illust_id];

        // Stash the user data so we can use it in get_displaying_text.
        this.user_info = data.preload.user[user_id];

        // Add the image list.
        var illust_ids = [];
        for(var related_illust_id in this_illust_data.userIllusts)
        {
            if(related_illust_id == illust_id)
                continue;
            illust_ids.push(related_illust_id);
        }

        // Make sure our illustration is in the list.
        if(illust_ids.indexOf(illust_id) == -1)
            illust_ids.push(illust_id);

        // Sort newest first.
        illust_ids.sort(function(a,b) { return b-a; });
        
        return illust_ids;
    };

    // Unlike most data_source_from_page implementations, we only have a single page.
    get_current_illust_id()
    {
        // ?illust_id should always be an illustration ID on illustration pages.
        var query_args = new URL(document.location).searchParams;
        return query_args.get("illust_id");
    };

    // data_source_current_illust is tricky.  Since it returns posts by the user
    // of an image, we remove the illust_id (since two images with the same user
    // can use the same data source), and add the user ID.
    //
    // This requires that get_canonical_url be asynchronous, since we might need
    // to load the image info.
    static async get_canonical_url(url, callback)
    {
        var url = new URL(url);
        var illust_id = url.searchParams.get("illust_id");
        var illust_info = await image_data.singleton().get_image_info_async(illust_id);

        var hash_args = helpers.get_hash_args(url);
        hash_args.set("user_id", illust_info.userId);
        helpers.set_hash_args(url, hash_args);

        url.searchParams.delete("illust_id");
        
        return await data_source.get_canonical_url(url);
    }

    // Unlike most data sources, data_source_current_illust puts the illust_id
    // in the query rather than the hash.
    set_current_illust_id(illust_id, query_args, hash_args)
    {
        query_args.set("illust_id", illust_id);
    };

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
            helpers.set_page_icon(this.user_info.isFollowed? binary_data['favorited_icon.png']:binary_data['regular_pixiv_icon.png']);
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
        this.bookmark_tags = [];
    }

    async load_page_internal(page)
    {
        this.fetch_bookmark_tags();
        
        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        var user_info = await image_data.singleton().get_user_info_full_async(this.viewing_user_id);

        this.user_info = user_info;
        this.call_update_listeners();

        await this.continue_loading_page_internal(page);
    };

    // If we haven't done so yet, load bookmark tags for this bookmark page.  This
    // happens in parallel with with page loading.
    fetch_bookmark_tags()
    {
        if(this.fetched_bookmark_tags)
            return;
        this.fetched_bookmark_tags = true;

        // Fetch bookmark tags.  We can do this in parallel with everything else.
        var url = "https://www.pixiv.net/ajax/user/" + this.viewing_user_id + "/illusts/bookmark/tags";
        helpers.get_request(url, {}, function(result) {
            var tag_counts = {};
            for(var bookmark_tag of result.body.public)
            {
                // Skip "uncategorized".  This is always the first entry.  There's no clear
                // marker for it, so just check the tag name.  We don't assume it'll always
                // be the first entry in case this changes.
                if(bookmark_tag.tag == "未分類")
                    continue;
                tag_counts[bookmark_tag.tag] = parseInt(bookmark_tag.cnt);
            }

            for(var bookmark_tag of result.body.private)
            {
                if(bookmark_tag.tag == "未分類")
                    continue;
                if(!(bookmark_tag.tag in tag_counts))
                    tag_counts[bookmark_tag.tag] = 0;
                tag_counts[bookmark_tag.tag] += parseInt(bookmark_tag.cnt);
            }

            var all_tags = [];
            for(var tag in tag_counts)
                all_tags.push(tag);

            // Sort tags by count, so we can trim just the most used tags.
            all_tags.sort(function(lhs, rhs) {
                return tag_counts[rhs] - tag_counts[lhs];
            });

            // Trim the list.  Some users will return thousands of tags.
            all_tags.splice(20);
            all_tags.sort();
            this.bookmark_tags = all_tags;

            // Update the UI with the tag list.
            this.call_update_listeners();
        }.bind(this));
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
        var tag = query_args.get("tag") || "";

        return {
            tag: tag,
            offset: (page-1)*48,
            limit: 48,
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

        var query_args = this.url.searchParams;
        var hash_args = helpers.get_hash_args(this.url);

        var private_bookmarks = query_args.get("rest") == "hide";
        var displaying = this.viewing_all_bookmarks? "All Bookmarks":
            private_bookmarks? "Private Bookmarks":"Public Bookmarks";

        var tag = query_args.get("tag");
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

        // Refresh the bookmark tag list.
        var current_query = new URL(document.location).searchParams.toString();

        var tag_list = container.querySelector(".bookmark-tag-list");
        
        helpers.remove_elements(tag_list);

        var add_tag_link = function(tag)
        {
            var a = document.createElement("a");
            a.classList.add("box-link");
            a.classList.add("following-tag");
            a.innerText = tag;

            var url = new URL(document.location);
            if(tag == "Uncategorized")
                url.searchParams.set("untagged", 1);
            else
                url.searchParams.delete("untagged", 1);

            if(tag != "All" && tag != "Uncategorized")
                url.searchParams.set("tag", tag);
            else
                url.searchParams.delete("tag");

            a.href = url.toString();
            if(url.searchParams.toString() == current_query)
                a.classList.add("selected");
            tag_list.appendChild(a);
        };

        add_tag_link("All");
        add_tag_link("Uncategorized");
        for(var tag of this.bookmark_tags || [])
            add_tag_link(tag);

        if(this.user_info)
            thumbnail_view.avatar_widget.set_from_user_data(this.user_info);
    }

    get viewing_user_id()
    {
        // If there's no user ID in the URL, view our own bookmarks.
        var query_args = this.url.searchParams;
        var user_id = query_args.get("id");
        if(user_id == null)
            return window.global_data.user_id;
        
        return query_args.get("id");
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
}

// Normal bookmark querying.  This can only retrieve public or private bookmarks,
// and not both.
class data_source_bookmarks extends data_source_bookmarks_base
{
    async continue_loading_page_internal(page)
    {
        var data = this.get_bookmark_query_params(page);

        var url = "/ajax/user/" + this.viewing_user_id + "/illusts/bookmarks";
        var result = await helpers.get_request_async(url, data);

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

        // Register the new page of data.
        this.add_page(page, illust_ids);
    }
};

// Merged bookmark querying.  This makes queries for both public and private bookmarks,
// and merges them together.
class data_source_bookmarks_merged extends data_source_bookmarks_base
{
    get viewing_all_bookmarks() { return true; }

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
            if(this.bookmark_illust_ids[i] != null)
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
        var result = await helpers.get_request_async(url, data);

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
            console.log("max page", this.max_page_per_type[is_private]);
        }

        // Store the IDs.  We don't register them here.
        this.bookmark_illust_ids[is_private][page] = illust_ids;
    }
}

// new_illust.php
class data_source_new_illust extends data_source_from_page
{
    get name() { return "new_illust"; }

    // Parse the loaded document and return the illust_ids.
    parse_document(document)
    {
        var items = document.querySelectorAll("A.work[href*='member_illust.php']");

        var illust_ids = [];
        for(var item of items)
        {
            var url = new URL(item.href);
            illust_ids.push(url.searchParams.get("illust_id"));
        }
        return illust_ids;
    }

    get page_title()
    {
        return "New Works";
    }

    get_displaying_text()
    {
        return "New Works";
    };

    refresh_thumbnail_ui(container)
    {
        this.set_item(container, "new-illust-type-all", {type: null});
        this.set_item(container, "new-illust-type-illust", {type: "illust"});
        this.set_item(container, "new-illust-type-manga", {type: "manga"});
        this.set_item(container, "new-illust-type-ugoira", {type: "ugoira"});

        // These links are different from anything else on the site: they switch between
        // two top-level pages, even though they're just flags and everything else is the
        // same.
        var all_ages_link = container.querySelector("[data-type='new-illust-ages-all']");
        var r18_link = container.querySelector("[data-type='new-illust-ages-r18']");

        var button_is_selected = true;

        var url = new URL(document.location);
        url.pathname = "/new_illust.php";
        all_ages_link.href = url;

        var url = new URL(document.location);
        url.pathname = "/new_illust_r18.php";
        r18_link.href = url;

        var url = new URL(document.location);
        var currently_all_ages = url.pathname == "/new_illust.php";
        helpers.set_class(currently_all_ages? all_ages_link:r18_link, "selected", button_is_selected);
    }
}

// bookmark_new_illust.php
class data_source_bookmarks_new_illust extends data_source_from_page
{
    get name() { return "bookmarks_new_illust"; }

    constructor(url, doc)
    {
        super(url, doc);
        this.bookmark_tags = [];
    }

    // Parse the loaded document and return the illust_ids.
    parse_document(doc)
    {
        this.bookmark_tags = [];
        for(var element of doc.querySelectorAll(".menu-items a[href*='bookmark_new_illust.php?tag'] span.icon-text"))
            this.bookmark_tags.push(element.innerText);
        
        var element = doc.querySelector("#js-mount-point-latest-following");
        var items = JSON.parse(element.dataset.items);

        // Populate thumbnail data with this data.
        thumbnail_data.singleton().loaded_thumbnail_info(items, "following");

        var illust_ids = [];
        for(var illust of items)
            illust_ids.push(illust.illustId);

        return illust_ids;
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
        var current_tag = new URL(document.location).searchParams.get("tag") || "All";

        var tag_list = container.querySelector(".bookmark-tag-list");
        helpers.remove_elements(tag_list);

        var add_tag_link = function(tag)
        {
            var a = document.createElement("a");
            a.classList.add("box-link");
            a.classList.add("following-tag");
            a.innerText = tag;

            var url = new URL(document.location);
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
    }
};

// search.php
class data_source_search extends data_source_from_page
{
    get name() { return "search"; }

    constructor(url, doc)
    {
        super(url, doc);

        // Add the search tags to tag history.  We only do this at the start when the
        // data source is created, not every time we navigate back to the search.
        var query_args = this.url.searchParams;
        var tag = query_args.get("word");
        if(tag)
            helpers.add_recent_search_tag(tag);
    }
     
    parse_document(doc)
    {
        // The actual results are encoded in a string for some reason.
        var result_list_json = doc.querySelector("#js-mount-point-search-result-list").dataset.items;
        var illusts = JSON.parse(result_list_json);

        // Store related tags.  Only do this the first time and don't change it when we read
        // future pages, so the tags don't keep changing as you scroll around.
        if(this.related_tags == null)
        {
            var related_tags_json = doc.querySelector("#js-mount-point-search-result-list").dataset.relatedTags;
            var related_tags = JSON.parse(related_tags_json);
            this.related_tags = related_tags;
        }

        if(this.tag_translation == null)
        {
            var span = doc.querySelector(".search-result-information .translation-column-title");
            if(span != null)
                this.tag_translation = span.innerText;
        }
        
        // Populate thumbnail data with this data.  This has the same format as
        // bookmark_new_illust.php.
        thumbnail_data.singleton().loaded_thumbnail_info(illusts, "following");

        var illust_ids = [];
        for(var illust of illusts)
            illust_ids.push(illust.illustId);

        return illust_ids;
    }

    get page_title()
    {
        var query_args = this.url.searchParams;

        var displaying = "Search: ";
        var tag = query_args.get("word");
        if(tag)
            displaying += tag;
        
        return displaying;
    }

    get_displaying_text()
    {
        var displaying = this.page_title;

        // Add the tag translation if there is one.  We only put this in the page and not
        // the title to avoid cluttering the title.
        if(this.tag_translation != null)
            displaying += " (" + this.tag_translation + ")";
        
        return displaying;
    };

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
        this.set_item(container, "order-male", {order: "popular_male_d"});
        this.set_item(container, "order-female", {order: "popular_female_d"});

        this.set_item(container, "search-type-all", {type: null});
        this.set_item(container, "search-type-illust", {type: "illust"});
        this.set_item(container, "search-type-manga", {type: "manga"});
        this.set_item(container, "search-type-ugoira", {type: "ugoira"});

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

        var format_date = function(date)
        {
            var f = (date.getYear() + 1900).toFixed();
            return (date.getYear() + 1900).toFixed().padStart(2, "0") + "-" +
                    (date.getMonth() + 1).toFixed().padStart(2, "0") + "-" +
                    date.getDate().toFixed().padStart(2, "0");
        };

        var set_date_filter = function(name, start, end)
        {
            var start_date = format_date(start);
            var end_date = format_date(end);
            this.set_item(container, name, {scd: start_date, ecd: end_date});
        }.bind(this);

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

        // The "reset search" button removes everything in the query except search terms.
        var box = container.querySelector(".reset-search");
        var url = new URL(document.location);
        var tag = url.searchParams.get("word");
        url.search = "";
        if(tag != null)
            url.searchParams.set("word", tag);
        box.href = url;
     }
 };

