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
    constructor()
    {
        this.id_list = new illust_id_list();
        this.update_callbacks = [];
        this.loading_page_callbacks = {};
        this.first_empty_page = -1;
        this.update_callbacks = [];
    };

    // If a data source returns a name, we'll display any .data-source-specific elements in
    // the thumbnail view with that name.
    get name() { return null; }
    
    // Return the page that will be loaded by default, if load_page(null) is called.
    //
    // Most data sources store the page in the query.
    get_default_page()
    {
        var query_args = page_manager.singleton().get_query_args();
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
        var result = this.load_page_internal(page, function() {
            // If is_synchronous is true, the data source finished immediately before load_page_internal
            // returned.  This happens when the data is already available and didn't need to be loaded.
            // Make sure we complete the load asynchronously even if it finished synchronously.
            if(is_synchronous)
                setTimeout(completed, 0);
            else
                completed();
        }.bind(this));

        is_synchronous = false;

        if(!result)
        {
            // No request was actually started, so we're not calling the callback.
            delete this.loading_page_callbacks[page];
        }

        return result;
    }

    // Return the illust_id to display by default.
    //
    // This should only be called after the initial data is loaded.
    get_default_illust_id()
    {
        // If we have an explicit illust_id in the hash, use it.  Note that some pages (in
        // particular illustration pages) put this in the query, which is handled in the particular
        // data source.
        var hash_args = page_manager.singleton().get_hash_args();
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
    load_page_internal(page, callback)
    {
        return false;
    }

    // This is called when the currently displayed illust_id changes.  The illust_id should
    // always have been loaded by this data source, so it should be in id_list.  The data
    // source should update the history state to reflect the current state.
    //
    // If add_to_history, use history.pushState, otherwise use history.replaceState.  replace
    // is true when we're just updating the current state (eg. after loading the first image)
    // and false if we're actually navigating to a new image that should have a new history
    // entry (eg. pressing page down).
    set_current_illust_id(illust_id, add_to_history)
    {
    };

    // Load from the current history state.  Load the current page (if needed), then call
    // callback().
    //
    // This is called when changing history states.  The data source should load the new
    // page if needed, then call this.callback.
    load_from_current_state(callback)
    {
        this.load_page(null, callback);
    };

    // Return the estimated number of items per page.  This is used to pad the thumbnail
    // list to reduce items moving around when we load pages.
    get estimated_items_per_page()
    {
        return 10;
    };

    // Return true if this data source wants to show thumbnails by default, or false if
    // the default image should be shown.
    get show_thumbs_by_default()
    {
        return true;
    };

    // If we're viewing a page specific to a user (an illustration or artist page), return
    // the user ID we're viewing.  This can change when refreshing the UI.
    get viewing_user_id()
    {
        return null;
    };

    // If we're viewing a page specific to a user (an illustration or artist page), return
    // the username we're viewing.  This can change when refreshing the UI.
    get viewing_username()
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
        var new_url = new URL(document.location);
        for(var key of Object.keys(fields))
        {
            var value = fields[key];
            if(value != null)
                new_url.searchParams.set(key, value);
            else
                new_url.searchParams.delete(key);

            var this_value = value;
            if(this_value == null && default_values != null)
                this_value = default_values[key];

            var selected_value = url.searchParams.get(key);
            if(selected_value == null && default_values != null)
                selected_value = default_values[key];

            if(this_value != selected_value)
                button_is_selected = false;
        }

        helpers.set_class(link, "selected", button_is_selected);

        link.href = new_url.toString();
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
};

// /discovery
//
// This is an actual API call for once, so we don't need to scrape HTML.  We only show
// recommended works (we don't have a user view list).
//
// The API call returns 1000 entries.  We don't do pagination, we just show the 1000 entries
// and then stop.  I haven't checked to see if the API supports returning further pages.
class data_source_discovery extends data_source
{
    get name() { return "discovery"; }
    
    load_page_internal(page, callback)
    {
        if(page != 1)
            return false;

        // Get "mode" from the URL.  If it's not present, use "all".
        var query_args = page_manager.singleton().get_query_args();
        var mode = query_args.get("mode") || "all";
        
        var data = {
            type: "illust",
            sample_illusts: "auto",
            num_recommendations: 1000,
            page: "discovery",
            mode: mode,
        };

        helpers.get_request("/rpc/recommender.php", data, function(result) {
            // Unlike other APIs, this one returns IDs as ints rather than strings.  Convert back
            // to strings.
            var illust_ids = [];
            for(var illust_id of result.recommendations)
                illust_ids.push(illust_id + "");

            // Register the new page of data.
            this.add_page(page, illust_ids);

            if(callback)
                callback();
        }.bind(this))

        return true;
    };

    // This doesn't matter for this data source, since we don't load any more pages after the first.
    get estimated_items_per_page() { return 1; }

    get page_title() { return "Discovery"; }
    get_displaying_text() { return "Recommended Works"; }

    // Update the address bar with the current illustration ID.  If that illust ID is on a different
    // page and we know the page number, update that as well.
    set_current_illust_id(illust_id, add_to_history)
    {
        var query_args = page_manager.singleton().get_query_args();
        var hash_args = page_manager.singleton().get_hash_args();

        // Store the current illust ID in the hash, since the real bookmark page doesn't have
        // an illust_id.
        hash_args.set("illust_id", illust_id);

        page_manager.singleton().set_args(query_args, hash_args, add_to_history);
    };

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
class data_source_related_illusts extends data_source
{
    get name() { return "related-illusts"; }
   
    load_page(page, callback)
    {
        // The first time we load a page, get info about the source illustration too, so
        // we can show it in the UI.
        if(!this.fetched_illust_info)
        {
            this.fetched_illust_info = true;

            var query_args = page_manager.singleton().get_query_args();
            var illust_id = query_args.get("illust_id");
            image_data.singleton().get_image_info(illust_id, function(illust_info) {
                this.illust_info = illust_info;
                this.call_update_listeners();
            }.bind(this));
        }

        return super.load_page(page, callback);
    }
     
    load_page_internal(page, callback)
    {
        if(page != 1)
            return false;

        var query_args = page_manager.singleton().get_query_args();
        var illust_id = query_args.get("illust_id");

        var data = {
            type: "illust",
            sample_illusts: illust_id,
            num_recommendations: 1000,
        };

        helpers.get_request("/rpc/recommender.php", data, function(result) {
            // Unlike other APIs, this one returns IDs as ints rather than strings.  Convert back
            // to strings.
            var illust_ids = [];
            for(var illust_id of result.recommendations)
                illust_ids.push(illust_id + "");

            // Register the new page of data.
            this.add_page(page, illust_ids);

            if(callback)
                callback();
        }.bind(this))

        return true;
    };

    // This doesn't matter for this data source, since we don't load any more pages after the first.
    get estimated_items_per_page() { return 1; }

    get page_title() { return "Related Illusts"; }
    get_displaying_text() { return "Related Illustrations"; }

    // Update the address bar with the current illustration ID.  If that illust ID is on a different
    // page and we know the page number, update that as well.
    set_current_illust_id(illust_id, add_to_history)
    {
        var query_args = page_manager.singleton().get_query_args();
        var hash_args = page_manager.singleton().get_hash_args();

        // Store the current illust ID in the hash.  This is the image being viewed, not the source
        // image for the suggestion list (which is in the query).
        hash_args.set("illust_id", illust_id);

        page_manager.singleton().set_args(query_args, hash_args, add_to_history);
    };

    refresh_thumbnail_ui(container)
    {
        // Set the source image.
        var source_link = container.querySelector(".image-for-suggestions");
        source_link.hidden = this.illust_info == null;
        if(this.illust_info)
        {
            source_link.href = "/member_illust.php?illust_id=" + this.illust_info.illustId + "#ppixiv";

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
    constructor(doc)
    {
        super();

        this.doc = doc;
        this.max_page = 999999;

        // This is the date that the page is showing us.
        // We want to know the date the page is showing us, even if we requested the
        // default.  This is a little tricky since there's no unique class on that element,
        // but it's always the element after "before" and the element before "after".
        //
        // We can also get this from the API response, but doing it here reduces UI
        // pop by filling it in at the start.
        var current = doc.querySelector(".ranking-menu .before + li > a");
        this.today_text = current? current.innerText:"";

        // Figure out today
        var after = doc.querySelector(".ranking-menu .after > a");
        if(after)
            this.prev_date = new URL(after.href).searchParams.get("date");

        var before = doc.querySelector(".ranking-menu .before > a");
        if(before)
            this.next_date = new URL(before.href).searchParams.get("date");
    }
    
    get name() { return "rankings"; }
   
    load_page_internal(page, callback)
    {
        if(page > this.max_page)
            return false;

        // Get "mode" from the URL.  If it's not present, use "all".
        var query_args = page_manager.singleton().get_query_args();
        
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

        helpers.get_request("/ranking.php", data, function(result) {
        console.log(result);

            // If "next" is false, this is the last page.
            console.log(result.next);
            if(!result.next)
                this.max_page = Math.min(page, this.max_page);

            /* if(this.today_text == null)
                this.today_text = result.date;
            if(this.prev_date == null && result.prev_date)
                this.prev_date = result.prev_date;
            if(this.next_date == null && result.next_date)
                this.next_date = result.next_date; */
        
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
        
            // Register the new page of data.
            this.add_page(page, illust_ids);

            if(callback)
                callback();
        }.bind(this))

        return true;
    };

    get estimated_items_per_page() { return 50; }

    get page_title() { return "Rankings"; }
    get_displaying_text() { return "Rankings"; }

    // Update the address bar with the current illustration ID.  If that illust ID is on a different
    // page and we know the page number, update that as well.
    set_current_illust_id(illust_id, add_to_history)
    {
        var query_args = page_manager.singleton().get_query_args();
        var hash_args = page_manager.singleton().get_hash_args();

        // Store the current illust ID in the hash, since the real bookmark page doesn't have
        // an illust_id.
        hash_args.set("illust_id", illust_id);

        page_manager.singleton().set_args(query_args, hash_args, add_to_history);
    };

    refresh_thumbnail_ui(container)
    {
        var query_args = page_manager.singleton().get_query_args();
        
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

        var yesterday = container.querySelector(".nav-yesterday");
        yesterday.hidden = this.prev_date == null;
        if(this.prev_date)
        {
            var url = new URL(window.location);
            url.searchParams.set("date", this.prev_date);
            yesterday.querySelector("a").href = url;
        }

        var tomorrow = container.querySelector(".nav-tomorrow");
        tomorrow.hidden = this.next_date == null;
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
    constructor(doc)
    {
        super();

        this.original_doc = doc;
        this.items_per_page = 1;

        // Remember the URL that original_doc came from.
        if(doc != null)
            this.original_url = document.location.toString();
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

    load_page_internal(page, callback)
    {
        // Our page URL looks like eg.
        //
        // https://www.pixiv.net/bookmark.php?p=2
        //
        // possibly with other search options.  Request the current URL page data.
        var url = new unsafeWindow.URL(document.location);

        // Update the URL with the current page.
        var params = url.searchParams;
        params.set("p", page);

        if(this.original_url && this.is_same_page(url, this.original_url))
        {
            this.finished_loading_illust(page, this.original_doc, callback);
            return true;
        }

        // Work around a browser issue: loading an iframe with the same URL as the current page doesn't
        // work.  (This might have made sense once upon a time when it would always recurse, but today
        // this doesn't make sense.)  Just add a dummy query to the URL to make sure it's different.
        //
        // This usually doesn't happen, since we'll normally use this.original_doc if we're reading
        // the same page.  Skip it if it's not needed, so we don't throw weird URLs at the site if
        // we don't have to.
        if(this.is_same_page(url, document.location.toString()))
            params.set("x", 1);
                
        url.search = params.toString();

        console.log("Loading:", url.toString());

        helpers.load_data_in_iframe(url.toString(), function(document) {
            this.finished_loading_illust(page, document, callback);
        }.bind(this));
        return true;
    };

    get estimated_items_per_page() { return this.items_per_page; }

    // We finished loading a page.  Parse it, register the results and call the completion callback.
    finished_loading_illust(page, document, callback)
    {
        var illust_ids = this.parse_document(document);

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

        if(callback)
            callback();
    }

    // Parse the loaded document and return the illust_ids.
    parse_document(document)
    {
        throw "Not implemented";
    }

    // Update the address bar with the current illustration ID.  If that illust ID is on a different
    // page and we know the page number, update that as well.
    set_current_illust_id(illust_id, add_to_history)
    {
        var query_args = page_manager.singleton().get_query_args();
        var hash_args = page_manager.singleton().get_hash_args();

        // Store the current illust ID in the hash, since the real bookmark page doesn't have
        // an illust_id.
        hash_args.set("illust_id", illust_id);

        // Update the current page.  (This can be undefined if we're on a page that isn't
        // actually loaded for some reason.)
        var original_page = this.id_list.get_page_for_illust(illust_id);
        if(original_page != null)
            query_args.set("p", original_page);

        page_manager.singleton().set_args(query_args, hash_args, add_to_history);
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
class data_source_artist extends data_source_from_page
{
    constructor(doc)
    {
        super(doc);

        this.fetched_user_info = false;
    }
    get name() { return "artist"; }
  
    get viewing_user_id()
    {
        var query_args = page_manager.singleton().get_query_args();
        return query_args.get("id");
    };

    // If we're viewing a page specific to a user (an illustration or artist page), return
    // the username we're viewing.  This can change when refreshing the UI.
    get viewing_username()
    {
        return this.username;
    };
    
    load_page(page, callback)
    {
        // The first time we load a page, start loading the user's info too.
        if(!this.fetched_user_info)
        {
            this.fetched_user_info = true;
            var url = new URL(document.location);
            var user_id = url.searchParams.get("id");
            if(user_id == null)
            {
                console.error("Don't know how to handle URL:", url);
                return;
            }
            
            image_data.singleton().get_user_info(user_id, function(user_info) {
                // Refresh our UI now that we have user info.
                this.user_info = user_info;
                this.call_update_listeners();
            }.bind(this));
        }

        return super.load_page(page, callback);
    }
    
    parse_document(document)
    {
        // Find the user's name.  We'll get this with the user data when it's fetched later, but
        // we grab it now so we can return it from get_displaying_text.
        var user_name_element = document.querySelector("a.user-name[title]");
        this.username = user_name_element.title;

        // Grab the user's post tags, if any.
        this.post_tags = [];
        for(var element of document.querySelectorAll(".user-tags a[href*='member_illust'][href*='tag=']"))
        {
            var tag = new URL(element.href).searchParams.get("tag");
            if(tag != null)
                this.post_tags.push(tag);
        }

        var items = document.querySelectorAll("A.work[href*='member_illust.php']");

        var illust_ids = [];
        for(var item of items)
        {
            var url = new URL(item.href);
            illust_ids.push(url.searchParams.get("illust_id"));
        }
        return illust_ids;
    }

    refresh_thumbnail_ui(container, thumbnail_view)
    {
        if(this.user_info)
        {
            thumbnail_view.avatar_widget.set_from_user_data(this.user_info);
            helpers.set_page_icon(this.user_info.isFollowed? binary_data['favorited_icon.png']:binary_data['regular_pixiv_icon.png']);
        }

        this.set_item(container, "works", {type: null});
        this.set_item(container, "manga", {type: "manga"});
        this.set_item(container, "ugoira", {type: "ugoira"});

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

    get page_title() { return this.username; }

    get_displaying_text()
    {
        if(this.username)
            return this.username + "'s illustrations";
        else
            return "Illustrations";
    };
}

class data_source_current_illust extends data_source_from_page
{
    get name() { return "illust"; }

    // Show the illustration by default.
    get show_thumbs_by_default()
    {
        return false;
    };

    get_default_page() { return 1; }

    // We only have one page and we already have it when we're constructed, but we wait to load
    // it until load_page is called so this acts the same as the asynchronous data sources.
    load_page(page, callback)
    {
        // This data source only ever loads a single page.
        if(page != null && page != 1)
            return false;

        return super.load_page(page, callback);
    }

    parse_document(document)
    {
        var data = helpers.get_global_init_data(document);
        if(data == null)
        {
            console.error("Couldn't find globalInitData");
            return;
        }

        var illust_id = Object.keys(data.preload.illust)[0];
        var user_id = Object.keys(data.preload.user)[0];
        this.user_info = data.preload.user[user_id];
        var this_illust_data = data.preload.illust[illust_id];

        // Add the precache data for the image and user.
        image_data.singleton().add_illust_data(this_illust_data);
        image_data.singleton().add_user_data(data.preload.user[user_id]);

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
    get_default_illust_id()
    {
        // ?illust_id should always be an illustration ID on illustration pages.
        var query_args = page_manager.singleton().get_query_args();
        return query_args.get("illust_id");
    };
 
    set_current_illust_id(illust_id, replace)
    {
        var query_args = page_manager.singleton().get_query_args();
        var hash_args = page_manager.singleton().get_hash_args();

        query_args.set("illust_id", illust_id);

        page_manager.singleton().set_args(query_args, hash_args, replace);
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
            return this.user_info.name + "'s illustrations";
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
    
    get viewing_username()
    {
        if(this.user_info == null)
            return null;
        return this.user_info.name;
    }
};

// bookmark.php
//
// If id is in the query, we're viewing another user's bookmarks.  Otherwise, we're
// viewing our own.
class data_source_bookmarks extends data_source_from_page
{
    get name() { return "bookmarks"; }
    
    constructor(doc)
    {
        super(doc);
        this.bookmark_tags = [];
    }

    // Return true if we're viewing our own bookmarks.
    viewing_own_bookmarks()
    {
        var query_args = page_manager.singleton().get_query_args();
        return !query_args.has("id");
    }

    // Parse the loaded document and return the illust_ids.
    parse_document(document)
    {
        var title = document.querySelector(".user-name[title]");
        this.username = title.getAttribute("title");

        // Grab the user's bookmark tags, if any.
        this.bookmark_tags = [];
        for(var element of document.querySelectorAll("#bookmark_list a[href*='bookmark.php']"))
        {
            var tag = new URL(element.href).searchParams.get("tag");
            if(tag != null)
                this.bookmark_tags.push(tag);
        }

        var items = document.querySelectorAll("._image-items .image-item");

        var user_data = { };
        var illust_ids = [];

        for(var i = 0; i < items.length; ++i)
        {
            var item = items[i];

            // Pull the illustration ID out of the link.  For some reason, URLSearchParams
            // is stupid and can't handle being given a .search that has ? on it.  
            var link = item.querySelector("a[href^='member_illust']");
            var user_data_div = item.querySelector("[data-user_id]");

            // If user_data_div doesn't exist, skip the entry even if we have a link.  This happens
            // for deleted entries.
            if(user_data_div == null)
                continue;

            var query = new URL(link.href).search.substr(1);
            var params = new URLSearchParams(query);
            var illust_id = params.get("illust_id");
            illust_ids.push(illust_id);
        }

        return illust_ids;
    }

    get page_title()
    {
        if(!this.viewing_own_bookmarks())
        {
            if(this.username)
                return this.viewing_username + "'s Bookmarks";
            return "User's Bookmarks";
        }

        return "Bookmarks";
    }

    get_displaying_text()
    {
        if(!this.viewing_own_bookmarks())
        {
            if(this.viewing_username)
                return this.viewing_username + "'s Bookmarks";
            return "User's Bookmarks";
        }

        var query_args = page_manager.singleton().get_query_args();

        var private_bookmarks = query_args.get("rest") == "hide";
        var displaying = private_bookmarks? "Private bookmarks":"Bookmarks";

        var tag = query_args.get("tag");
        if(tag)
            displaying += " with tag \"" + tag + "\"";

        return displaying;
    };

    refresh_thumbnail_ui(container)
    {
        // The public/private button only makes sense when viewing your own bookmarks.
        container.querySelector(".bookmarks-public-private").hidden = !this.viewing_own_bookmarks();

        // Set up the public and private buttons.
        this.set_item(container, "public", {rest: null});
        this.set_item(container, "private", {rest: "hide"});

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
    }

    get viewing_user_id()
    {
        var query_args = page_manager.singleton().get_query_args();
        return query_args.get("id");
    };
    
    get viewing_username()
    {
        return this.username;
    }
};

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

    constructor(doc)
    {
        super(doc);
        this.bookmark_tags = [];
    }

    // Parse the loaded document and return the illust_ids.
    parse_document(document)
    {
        this.bookmark_tags = [];
        for(var element of document.querySelectorAll(".menu-items a[href*='bookmark_new_illust.php?tag'] span.icon-text"))
            this.bookmark_tags.push(element.innerText);
        
        var element = document.querySelector("#js-mount-point-latest-following");
        var items = JSON.parse(element.dataset.items);

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

    parse_document(document)
    {
        // The actual results are encoded in a string for some reason.
        var result_list_json = document.querySelector("#js-mount-point-search-result-list").dataset.items;
        var illusts = JSON.parse(result_list_json);

        // Store related tags.  Only do this the first time and don't change it when we read
        // future pages, so the tags don't keep changing as you scroll around.
        if(this.related_tags == null)
        {
            var related_tags_json = document.querySelector("#js-mount-point-search-result-list").dataset.relatedTags;
            var related_tags = JSON.parse(related_tags_json);
            this.related_tags = related_tags;
        }

        if(this.tag_translation == null)
        {
            var span = document.querySelector(".search-result-information .translation-column-title");
            if(span != null)
            {
                this.tag_translation = span.innerText;
                console.log(this.tag_translation);
            }
        }
        
        var illust_ids = [];
        for(var illust of illusts)
            illust_ids.push(illust.illustId);

        return illust_ids;
    }

    get page_title()
    {
        var query_args = page_manager.singleton().get_query_args();

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

