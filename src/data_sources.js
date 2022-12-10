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
        this.media_ids_by_page = new Map();
    };

    get_all_illust_ids()
    {
        // Make a list of all IDs we already have.
        let all_ids = [];
        for(let [page, ids] of this.media_ids_by_page)
            all_ids = all_ids.concat(ids);
        return all_ids;
    }

    get any_pages_loaded()
    {
        return this.media_ids_by_page.size != 0;
    }

    get_lowest_loaded_page()
    {
        // Give a default in case media_ids_by_page is empty, so we don't return infinity.
        return Math.min(999999, ...this.media_ids_by_page.keys());
    }

    get_highest_loaded_page()
    {
        return Math.max(0, ...this.media_ids_by_page.keys());
    }

    // Add a page of results.
    //
    // If the page cache has been invalidated, return false.  This happens if we think the
    // results have changed too much for us to reconcile it.
    add_page(page, media_ids, {
        // If media_ids is empty, that normally means we're past the end of the results, so we
        // don't add the page.  That way, can_load_page() will return false for future pages.
        // If allow_empty is true, allow adding empty pages.  This is used when we have an empty
        // page but we know we're not actually at the end.
        allow_empty=false,
    }={})
    {
        // Sanity check:
        for(let media_id of media_ids)
            if(media_id == null)
                console.warn("Null illust_id added");

        if(this.media_ids_by_page.has(page))
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
        for(let new_id of media_ids)
        {
            if(all_illusts.indexOf(new_id) != -1)
                ids_to_remove.push(new_id);
        }

        if(ids_to_remove.length > 0)
            console.log("Removing duplicate illustration IDs:", ids_to_remove.join(", "));
            media_ids = media_ids.slice();
        for(let new_id of ids_to_remove)
        {
            let idx = media_ids.indexOf(new_id);
            media_ids.splice(idx, 1);
        }

        // If there's nothing on this page, don't add it, so this doesn't increase
        // get_highest_loaded_page().
        if(!allow_empty && media_ids.length == 0)
            return;

        this.media_ids_by_page.set(page, media_ids);
    };

    // Return the page number media_id is on and the index within the page.
    //
    // If check_first_page is true and media_id isn't in the list, try the first page
    // of media_id too, so if we're looking for page 3 of a manga post and the data
    // source only contains the first page, we'll use that.
    get_page_for_illust(media_id, { check_first_page=true }={})
    {
        for(let [page, ids] of this.media_ids_by_page)
        {
            let idx = ids.indexOf(media_id);
            if(idx != -1)
                return { page, idx, media_id };
        }

        if(!check_first_page)
            return { };

        // Try the first page.
        media_id = helpers.get_media_id_first_page(media_id);
        for(let [page, ids] of this.media_ids_by_page)
        {
            let idx = ids.indexOf(media_id);
            if(ids.indexOf(media_id) != -1)
                return { page, idx, media_id };
        }

        return { };
    };

    // Return the next or previous illustration.  If we don't have that page, return null.
    //
    // This only returns illustrations, skipping over any special entries like user:12345.
    // If illust_id is null, start at the first loaded illustration.
    get_neighboring_media_id(media_id, next, options={})
    {
        for(let i = 0; i < 100; ++i) // sanity limit
        {
            media_id = this._get_neighboring_media_id_internal(media_id, next, options);
            if(media_id == null)
                return null;

            // If it's not an illustration, keep looking.
            let { type } = helpers.parse_media_id(media_id);
            if(type == "illust" || type == "file")
                return media_id;
        }
        return null;
    }

    // The actual logic for get_neighboring_media_id, except for skipping entries.
    //
    // manga tells us how to handle manga pages:
    // - "normal": Navigate manga pages normally.
    // - "skip-to-first": Skip past manga pages, and always go to the first page of the
    //   next or previous image.
    // - "skip-past": Skip past manga pages.  If we're navigating backwards, go to the
    //   last page of the previous image, like we would normally.
    _get_neighboring_media_id_internal(media_id, next, { manga='normal' }={})
    {
        console.assert(manga == 'normal' || manga == 'skip-to-first' || manga == 'skip-past');

        if(media_id == null)
            return this.get_first_id();

        // If we're navigating forwards and we're not skipping manga pages, grab media info to
        // get the page count to see if we're at the end. 
        let id = helpers.parse_media_id(media_id);
        if(id.type == "illust" && manga == 'normal')
        {
            // If we're navigating backwards and we're past page 1, just go to the previous page.
            if(!next && id.page > 0)
            {
                id.page--;
                return helpers.encode_media_id(id);
            }

            // If we're navigating forwards, grab illust data to see if we can navigate to the
            // next page.
            if(next)
            {
                let info = media_cache.get_media_info_sync(media_id, { full: false });
                if(info == null)
                {
                    // This can happen if we're viewing a deleted image, which has no illust info.
                    console.log("Thumbnail info missing for", media_id);
                }
                else
                {
                    let [old_illust_id, old_page] = helpers.media_id_to_illust_id_and_page(media_id);
                    if(old_page < info.pageCount - 1)
                    {
                        // There are more pages, so just navigate to the next page.
                        id.page++;
                        return helpers.encode_media_id(id);
                    }
                }
            }
        }

        let { page, idx } = this.get_page_for_illust(media_id);
        if(page == null)
            return null;

        // Find the next or previous page that isn't empty, skipping over empty pages.
        let new_media_id = null;
        while(new_media_id == null)
        {
            let ids = this.media_ids_by_page.get(page);
            let new_idx = idx + (next? +1:-1);
            if(new_idx >= 0 && new_idx < ids.length)
            {
                // Navigate to the next or previous image on the same page.
                new_media_id = ids[new_idx];
                break;
            }
            
            if(next)
            {
                // Get the first illustration on the next page, or null if that page isn't loaded.
                page++;
                ids = this.media_ids_by_page.get(page);
                if(ids == null)
                    return null;
                new_media_id = ids[0];
            }
            else
            {
                // Get the last illustration on the previous page, or null if that page isn't loaded.
                page--;
                ids = this.media_ids_by_page.get(page);
                if(ids == null)
                    return null;
                new_media_id = ids[ids.length-1];
            }
        }

        // If we're navigating backwards and we're not in skip-to-first mode, get the last page on new_media_id.
        if(!next && manga != 'skip-to-first' && helpers.parse_media_id(new_media_id).type == "illust")
        {
            let info = media_cache.get_media_info_sync(new_media_id, { full: false });
            if(info == null)
            {
                console.log("Thumbnail info missing for", media_id);
                return null;
            }

            new_media_id = helpers.get_media_id_for_page(new_media_id, info.pageCount - 1);
        }

        return new_media_id;
    };
    
    // Return the first ID, or null if we don't have any.
    get_first_id()
    {
        if(this.media_ids_by_page.size == 0)
            return null;

        let first_page = this.get_lowest_loaded_page();
        return this.media_ids_by_page.get(first_page)[0];
    }

    // Return the last ID, or null if we don't have any.
    get_last_id()
    {
        if(this.media_ids_by_page.size == 0)
            return null;

        let last_page = this.get_highest_loaded_page();
        let ids = this.media_ids_by_page.get(last_page);
        return ids[ids.length-1];
    }

    // Return true if the given page is loaded.
    is_page_loaded(page)
    {
        return this.media_ids_by_page.has(page);
    }
};

// A helper widget for dropdown lists of tags.
class tag_dropdown_widget extends ppixiv.widget
{
    constructor({data_source, ...options})
    {
        super({
            ...options,
            template: `<div class="data-source-tag-list vertical-list"></div>`,
        });

        this.data_source = data_source;

        this.data_source.addEventListener("_refresh_ui", () => this.refresh_tags(), this._signal);
        this.refresh_tags();
    }

    refresh_tags()
    {
    }
}

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
ppixiv.data_source = class extends EventTarget
{
    constructor(url)
    {
        super();

        this.url = new URL(url);
        this.id_list = new illust_id_list();
        this.loading_pages = {};
        this.loaded_pages = {};
        this.first_empty_page = -1;

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
    
    toString()
    {
        return `${this.name}`;
    }

    // Returns true if the data source might return manga pages that the user might want to
    // expand.  This is usually true, except for things like user lists and local files.  This
    // just hides the expand/collapse button at the top when it can't do anything.
    get can_return_manga() { return true; }

    // Return true if all pages have been loaded.
    get loaded_all_pages() { return this.first_empty_page != -1; }

    // Return a canonical URL for this data source.  If the canonical URL is the same,
    // the same instance of the data source should be used.
    //
    // A single data source is used eg. for a particular search and search flags.  If
    // flags are changed, such as changing filters, a new data source instance is created.
    // However, some parts of the URL don't cause a new data source to be used.  Return
    // a URL with all unrelated parts removed, and with query and hash parameters sorted
    // alphabetically.
    static get_canonical_url(url, {
        // The search page doesn't affect the data source.  Set this to false to leave it
        // in the URL anyway.
        remove_search_page=true
    }={})
    {
        // Make a copy of the URL.
        var url = new URL(url);

        // Remove /en from the URL if it's present.
        url = helpers.get_url_without_language(url);

        let args = new helpers.args(url);

        // Remove parts of the URL that don't affect which data source instance is used.
        //
        // If p=1 is in the query, it's the page number, which doesn't affect the data source.
        if(remove_search_page)
            args.query.delete("p");

        // The manga page doesn't affect the data source.
        args.hash.delete("page");

        // #view=thumbs controls which view is active.
        args.hash.delete("view");

        // illust_id in the hash is always just telling us which image within the current
        // data source to view.  data_sources.current_illust is different and is handled in
        // the subclass.
        args.hash.delete("illust_id");

        // These are for temp view and don't affect the data source.
        args.hash.delete("virtual");
        args.hash.delete("temp-view");

        // This is for overriding muting.
        args.hash.delete("view-muted");

        // Ignore filenames for local IDs.
        args.hash.delete("file");

        // slideshow is used by the viewer and doesn't affect the data source.
        args.hash.delete("slideshow");

        // Sort query and hash parameters.
        args.query = helpers.sort_query_parameters(args.query);
        args.hash = helpers.sort_query_parameters(args.hash);

        return args;
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

    // Return the URL to use to return to this search.  For most data sources, this is the URL
    // it was initialized with.
    get search_url() { return this.url; }

    // This returns the widget class that can be instantiated for this data source's UI.
    get ui() { return null; }

    // Load the given page.  Return true if the page was loaded.
    load_page(page, { cause }={})
    {
        // Note that we don't remove entries from loading_pages when they finish, so
        // future calls to load_page will still return a promise for that page that will
        // resolve immediately.
        let result = this.loaded_pages[page] || this.loading_pages[page];
        if(result == null)
        {
            result = this._load_page_async(page, cause);
            this.loading_pages[page] = result;
            result.finally(() => {
                // Move the load from loading_pages to loaded_pages.
                delete this.loading_pages[page];
                this.loaded_pages[page] = result;
            });
        }

        return result;
    }

    // Return true if the given page is either loaded, or currently being loaded by a call to load_page.
    is_page_loaded_or_loading(page)
    {
        if(this.id_list.is_page_loaded(page))
            return true;
        if(this.loaded_pages[page] || this.loading_pages[page])
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

        // If we've loaded pages 5-6, we can load anything between pages 5 and 7.
        let lowest_page = this.id_list.get_lowest_loaded_page();
        let highest_page = this.id_list.get_highest_loaded_page();
        return page >= lowest_page && page <= highest_page+1;
    }

    // Return true if we know page is past the end of this data source's results.
    is_page_past_end(page)
    {
        return this.first_empty_page != -1 && page >= this.first_empty_page;
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
        if(this.is_page_past_end(page))
            return false;

        // If the page is already loaded, stop.
        if(this.id_list.is_page_loaded(page))
            return true;
        
        console.log("Load page", page, "for:", cause);

        // Before starting, await at least once so we get pushed to the event loop.  This
        // guarantees that load_page has a chance to store us in this.loading_pages before
        // we do anything that might have side-effects of starting another load.
        await null;

        // Run the actual load.
        await this.load_page_internal(page);

        // Reduce the start page, which will update the "load more results" button if any.
        if(this.supports_start_page && page < this.initial_page)
            this.initial_page = page;

        // If there were no results, then we've loaded the last page.  Don't try to load
        // any pages beyond this.
        if(!this.id_list.media_ids_by_page.has(page))
        {
            console.log("No data on page", page);
            if(this.first_empty_page == -1 || page < this.first_empty_page)
                this.first_empty_page = page;
        }
        else if(this.id_list.media_ids_by_page.get(page).length == 0)
        {
            // A page was added, but it was empty.  This is rare and can only happen if the
            // data source explicitly adds an empty page, and means there was an empty search
            // page that wasn't at the end.  This breaks the search view's logic (it expects
            // to get something back to trigger another load).  Work around this by starting
            // the next page.
            //
            // This is very rare.  Use a strong backoff, so if this happens repeatedly for some
            // reason, we don't hammer the API loading pages infinitely and get users API blocked.


            this.empty_page_load_backoff ??= new ppixiv.SafetyBackoffTimer();

            console.log(`Load was empty, but not at the end.  Delaying before loading the next page...`);
            await this.empty_page_load_backoff.wait();

            console.log(`Continuing load from ${page+1}`);
            return await this.load_page(page+1);
        }

        return true;
    }

    // If a URL for this data source contains a media ID to view, return it.  Otherwise, return
    // null.
    get_media_id_from_url(args)
    {
        // Most data sources for Pixiv store the media ID in the hash, separated into the
        // illust ID and page.
        let illust_id = args.hash.get("illust_id");
        if(illust_id == null)
            return null;

        let page = this.get_page_from_url(args);
        return helpers.illust_id_to_media_id(illust_id, page);
    }

    // If the URL specifies a manga page, return it, otherwise return 0.
    get_page_from_url(args)
    {
        if(!args.hash.has("page"))
            return 0;

        // Pages are 1-based in URLs, but 0-based internally.
        return parseInt(args.hash.get("page"))-1;
    }

    // Return the illust_id to display by default.
    //
    // This should only be called after the initial data is loaded.  Returns a media ID from the URL if
    // it contains one, otherwise one selected by the data source (usually the first result).
    get_current_media_id(args)
    {
        // If we have an explicit illust_id in the hash, use it.  Note that some pages (in
        // particular illustration pages) put this in the query, which is handled in the particular
        // data source.
        let media_id = this.get_media_id_from_url(args);
        if(media_id)
            return media_id;
         
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

    // If true, "No Results" will be displayed.
    get no_results()
    {
        return this.id_list.get_first_id() == null && !this.any_page_loading;
    }

    // This is implemented by the subclass.
    async load_page_internal(page)
    {
        throw "Not implemented";
    }

    // This is called when the currently displayed illust_id changes.  The illust_id should
    // always have been loaded by this data source, so it should be in id_list.  The data
    // source should update the history state to reflect the current state.
    set_current_media_id(media_id, args)
    {
        let [illust_id] = helpers.media_id_to_illust_id_and_page(media_id);
        if(this.supports_start_page)
        {
            // Store the page the illustration is on in the hash, so if the page is reloaded while
            // we're showing an illustration, we'll start on that page.  If we don't do this and
            // the user clicks something that came from page 6 while the top of the search results
            // were on page 5, we'll start the search at page 5 if the page is reloaded and not find
            // the image, which is confusing.
            let { page: original_page } = this.id_list.get_page_for_illust(illust_id);
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

    // If true, all pages are loaded.  This is only used by data_sources.vview.
    get all_pages_loaded() { return false; }

    // The data source can override this to set the aspect ratio to use for thumbnails.
    get_thumbnail_aspect_ratio() { return null; }

    // If true, this data source can return individual manga pages.  Most data sources only
    // return the first page of manga posts.  The search UI will only allow the user to expand
    // manga posts if this is false.
    get includes_manga_pages() { return false; }

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

    // Register a page of data.
    add_page(page, media_ids, {...options}={})
    {
        // If an image view is reloaded, it may no longer be on the same page in the underlying
        // search.  New posts might have pushed it onto another page, or the search might be
        // random.  This is confusing if you're trying to mousewheel navigate to other images.
        //
        // Work around this by making sure the initial image is on the initial page.  If we load
        // the first page and the image we were on isn't there anymore, insert it into the results.
        // It's probably still in the results somewhere, but we can't tell where.
        //
        // This allows the user to navigate to neighboring images normally.  We'll go to different
        // images, but at least we can still navigate, and we can get back to where we started
        // if the user navigates down and then back up.  If the image shows up in real results later,
        // it'll be filtered out.
        let initial_media_id = this.get_current_media_id(helpers.args.location);
        if(page == this.initial_page &&
            initial_media_id != null &&
            initial_media_id != "illust:*" && !local_api.is_slideshow_staging(helpers.args.location) && // not slideshow staging
            this.id_list.get_page_for_illust(initial_media_id).page == null &&
            media_ids.indexOf(initial_media_id) == -1)
        {
            console.log(`Adding initial media ID ${initial_media_id} to initial page ${this.initial_page}`);
            media_ids = [initial_media_id, ...media_ids];
        }

        this.id_list.add_page(page, media_ids, {...options});

        // Send pageadded asynchronously to let listeners know we added the page.
        helpers.yield(() => this.dispatchEvent(new Event("pageadded")));
    }

    // Send the "updated" event when we want to tell our parent that something has changed.
    // This is used when we've added a new page and the search view might want to refresh,
    // if the page title should be refreshed, etc.  Internal updates don't need to call this.
    call_update_listeners()
    {
        this.dispatchEvent(new Event("updated"));
    }

    // Return info useful for the container's UI elements:
    //
    // {
    //     image_url,                 // URL for an image related to this search
    //     image_link_url,            // a URL where image_url should link to
    //     user_id,                   // a user ID whose avatar should be displayed
    // }
    //
    // If this changes, the "updated" event will be sent to the data source.
    get ui_info()
    {
        return { };
    }
    // it to parent (normally a widget returned by create_box).
    create_and_set_button(parent, create_options, setup_options)
    {
        let button = helpers.create_box_link({
            as_element: true,
            ...create_options
        });
        parent.appendChild(button);
        this.set_item(button, setup_options);
        return button;
    }

    // Create a common search dropdown.  button is options to create_box_link, and items
    // is options to set_item.
    setup_dropdown(button, items)
    {
        return new ppixiv.dropdown_menu_opener({
            button,
            create_box: ({...options}) => {
                let dropdown = new ppixiv.widget({
                    ...options,
                    template: `<div class=vertical-list></div>`,
                });

                for(let {create_options, setup_options} of items)
                    this.create_and_set_button(dropdown.container, create_options, setup_options);

                return dropdown;
            },
        });
    }

    // A helper for setting up UI links.  Find the link with the given type,
    // set all {key: value} entries as query parameters, and remove any query parameters
    // where value is null.  Set .selected if the resulting URL matches the current one.
    //
    // If default_values is present, it tells us the default key that will be used if
    // a key isn't present.  For example, search.php?s_mode=s_tag is the same as omitting
    // s_mode.  We prefer to omit it rather than clutter the URL with defaults, but we
    // need to know this to figure out whether an item is selected or not.
    //
    // If a key begins with #, it's placed in the hash rather than the query.
    set_item(link, {type=null, current_url=null, ...options}={})
    {
        // If no type is specified, link itself is the link.
        if(type != null)
        {
            link = link.querySelector(`[data-type='${type}']`);
            if(link == null)
            {
                console.warn("Couldn't find button with selector", type);
                return;
            }
        }

        // The URL we're adjusting:
        if(current_url == null)
            current_url = this.url;

        // Adjust the URL for this button.
        let args = new helpers.args(new URL(current_url));

        let { args: new_args, button_is_selected } = this.set_item_in_url(args, options);

        helpers.set_class(link, "selected", button_is_selected);

        link.href = new_args.url.toString();
    };

    // Apply a search filter button to a search URL, activating or deactivating a search
    // filter.  Return { args, button_is_selected }.
    set_item_in_url(args, { fields=null, default_values=null, toggle=false,
        // If provided, this allows modifying URLs that put parameters in URL segments instead
        // of the query where they belong.  If url_format is "abc/def/ghi", a key of "/abc" will modify
        // the first segment, and so on.
        url_format=null,

        // This can be used to adjust the link's URL without affecting anything else.
        adjust_url=null
    }={})
    {
        // Ignore the language prefix on the URL if any, so it doesn't affect url_format.
        args.path = helpers.get_path_without_language(args.path);

        // If url_parts is provided, create a map from "/segment" to a segment number like "/1" that
        // args.set uses.
        let url_parts = {};
        if(url_format != null)
        {
            let parts = url_format.split("/");
            for(let idx = 0; idx < parts.length; ++idx)
                url_parts["/" + parts[idx]] = "/" + idx;
        }

        // Don't include the page number in search buttons, so clicking a filter goes
        // back to page 1.
        args.set("p", null);

        // This button is selected if all of the keys it sets are present in the URL.
        let button_is_selected = true;

        // Collect data for each key.
        let field_data = {};
        for(let [key, value] of Object.entries(fields))
        {
            let original_key = key;

            let default_value = null;
            if(default_values && key in default_values)
                default_value = default_values[key];

            // Convert path keys in fields from /path to their path index.
            if(key.startsWith("/"))
            {
                if(url_parts[key] == null)
                {
                    console.warn(`URL key ${key} not specified in URL: ${args}`);
                    continue;
                }

                key = url_parts[key];
            }
            
            field_data[key] = {
                value,
                original_key,
                default_value,
            }
        }

        for(let [key, {value}] of Object.entries(field_data))
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

        // If this is a toggle and the button is selected, set the fields to their default,
        // turning this into an "off" button.
        if(toggle && button_is_selected)
        {
            for(let [key, { default_value }] of Object.entries(field_data))
                args.set(key, default_value);
        }

        if(adjust_url)
            adjust_url(args);

        return { args, button_is_selected };
    }

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
        url = helpers.get_url_without_language(url);

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

    // Return true of the thumbnail view should show bookmark icons for this source.
    get show_bookmark_icons()
    {
        return true;
    }

    // URLs added to links will be included in the links at the top of the page when viewing an artist.
    add_extra_links(links)
    {
    }

    // Return the next or previous image to navigate to from illust_id.  If we're at the end of
    // the loaded results, load the next or previous page.  If illust_id is null, return the first
    // image.  This only returns illusts, not users or folders.
    //
    // This currently won't load more than one page.  If we load a page and it only has users,
    // we won't try another page.
    async get_or_load_neighboring_media_id(media_id, next, options={})
    {
        // See if it's already loaded.
        let new_media_id = this.id_list.get_neighboring_media_id(media_id, next, options);
        if(new_media_id != null)
            return new_media_id;

        // We didn't have the new illustration, so we may need to load another page of search results.
        // See if we know which page media_id is on.
        let page = media_id != null? this.id_list.get_page_for_illust(media_id).page:null;

        // Find the page this illustration is on.  If we don't know which page to start on,
        // use the initial page.
        if(page != null)
        {
            page += next? +1:-1;
            if(page < 1)
                return null;
        }
        else
        {
            // If we don't know which page media_id is on, start from initial_page.
            page = this.initial_page;
        }
        
        // Short circuit if we already know this is past the end.  This just avoids spamming
        // logs.
        if(this.is_page_past_end(page))
            return null;

        console.log("Loading the next page of results:", page);

        // The page shouldn't already be loaded.  Double-check to help prevent bugs that might
        // spam the server requesting the same page over and over.
        if(this.id_list.is_page_loaded(page))
        {
            console.error(`Page ${page} is already loaded`);
            return null;
        }

        // Load a page.
        let new_page_loaded = await this.load_page(page, { cause: "illust navigation" });
        if(!new_page_loaded)
            return null;

        // Now that we've loaded data, try to find the new image again.
        console.log("Finishing navigation after data load");
        return this.id_list.get_neighboring_media_id(media_id, next, options);
    }

    // Get the next or previous image to from_media_id.  If we're at the end, loop back
    // around to the other end.  options is the same as get_or_load_neighboring_media_id.
    async get_neighboring_media_id_with_loop(from_media_id, next, options={})
    {
        // See if we can keep moving in this direction.
        let media_id = await this.get_or_load_neighboring_media_id(from_media_id, next, options);
        if(media_id)
            return media_id;

        // We're out of results in this direction.  If we're moving backwards, only loop
        // if we have all results.  Otherwise, we'll go to the last loaded image, but if
        // the user then navigates forwards, he'll just go to the next image instead of
        // where he came from, which is confusing.
        if(!next && !this.loaded_all_pages)
        {
            console.log("Not looping backwards since we don't have all pages");
            return null;
        }

        return next? this.id_list.get_first_id():this.id_list.get_last_id();
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
            let media_ids = await this.load_all_results();
            this.pages = paginate_illust_ids(media_ids, this.estimated_items_per_page);
        }

        // Register this page.
        var media_ids = this.pages[page-1] || [];
        this.add_page(page, media_ids);
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
        await media_cache.add_media_infos_partial(thumbs, "normal");

        let media_ids = [];
        for(let thumb of thumbs)
            media_ids.push(helpers.illust_id_to_media_id(thumb.id));

        tag_translations.get().add_translations_dict(result.body.tagTranslation);
        this.add_page(page, media_ids);
    };

    get page_title() { return "Discovery"; }
    get_displaying_text() { return "Recommended Works"; }

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class=box-button-row>
                            ${ helpers.create_box_link({label: "All",      popup: "Show all works",    data_type: "all" }) }
                            ${ helpers.create_box_link({label: "All ages", popup: "All ages",          data_type: "safe" }) }
                            ${ helpers.create_box_link({label: "R18",      popup: "R18",               data_type: "r18", classes: ["r18"] }) }
                        </div>
                    </div>
                `});

                data_source.set_item(this.container, { type: "all", fields: {mode: "all"}, default_values: {mode: "all"} });
                data_source.set_item(this.container, { type: "safe", fields: {mode: "safe"}, default_values: {mode: "all"} });
                data_source.set_item(this.container, { type: "r18", fields: {mode: "r18"}, default_values: {mode: "all"} });
            }
        }
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
            let media_id = helpers.illust_id_to_media_id(illust_id)
            media_cache.get_media_info(media_id).then((illust_info) => {
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
        // Don't load more than one page.  Related illusts for the same post generally
        // returns the same results, so if we load more pages we can end up making lots of
        // requests that give only one or two new images each, and end up loading up to
        // page 5 or 6 for just a few extra results.
        if(page > 1)
            return;

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
        await media_cache.add_media_infos_partial(thumbs, "normal");

        let media_ids = [];
        for(let thumb of thumbs)
            media_ids.push(helpers.illust_id_to_media_id(thumb.id));

        tag_translations.get().add_translations_dict(result.body.tagTranslation);
        this.add_page(page, media_ids);
    };

    get page_title() { return "Similar Illusts"; }
    get_displaying_text() { return "Similar Illustrations"; }

    get ui_info()
    {
        let image_url = null;
        let image_link_url = null;
        if(this.illust_info)
        {
            image_link_url = `/artworks/${this.illust_info.illustId}#ppixiv`;
            image_url = this.illust_info.previewUrls[0];
        }

        return { image_url, image_link_url };
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
        // If we're showing similar users, only show one page, since the API returns the
        // same thing every time.
        if(this.showing_user_id && page > 1)
            return;

        if(this.showing_user_id != null)
        {
            // Make sure the user info is loaded.
            this.user_info = await user_cache.get_user_info_full(this.showing_user_id);

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

        await media_cache.add_media_infos_partial(result.body.thumbnails.illust, "normal");

        for(let user of result.body.users)
        {
            user_cache.add_user_data(user);

            // Register this as quick user data, for use in thumbnails.
            extra_cache.singleton().add_quick_user_data(user, "recommendations");
        }

        // Pixiv's motto: "never do the same thing the same way twice"
        // ajax/user/#/recommends is body.recommendUsers and user.illustIds.
        // discovery/users is body.recommendedUsers and user.recentIllustIds.
        let recommended_users = result.body.recommendUsers || result.body.recommendedUsers;
        let media_ids = [];
        for(let user of recommended_users)
        {
            // Each time we load a "page", we're actually just getting a new randomized set of recommendations
            // for our seed, so we'll often get duplicate results.  Ignore users that we've seen already.  id_list
            // will remove dupes, but we might get different sample illustrations for a duplicated artist, and
            // those wouldn't be removed.
            if(this.seen_user_ids[user.userId])
                continue;
            this.seen_user_ids[user.userId] = true;

            media_ids.push("user:" + user.userId);
            
            let illustIds = user.illustIds || user.recentIllustIds;
            for(let illust_id of illustIds)
                media_ids.push(helpers.illust_id_to_media_id(illust_id));
        }

        // Register the new page of data.
        this.add_page(page, media_ids);
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

    // A Pixiv classic: two separate, vaguely-similar ways of doing the same thing on desktop
    // and mobile (and a third, mobile apps).  It's like they use the same backend but are
    // implemented by two people who never talk to each other.  The desktop version is
    // preferred since it gives us thumbnail data, where the mobile version only gives
    // thumbnail IDs that we have to look up, but the desktop version can't be accessed
    // from mobile.
    async load_data_mobile({ date, mode, content, page })
    {
        let data = {
            mode,
            page,
            type: content,
        };

        if(date)
            data.date = date;

        let result = await helpers.get_request("/touch/ajax/ranking/illust", data);
        let this_date = result.body.rankingDate;

        function format_date(date)
        {
            let year = date.getUTCFullYear();
            let month = date.getUTCMonth() + 1;
            let day = date.getUTCDate();
            return year + "-" + 
                month.toString().padStart(2, '0') + "-" +
                day.toString().padStart(2, '0');
        }

        // This API doesn't tell us the previous and next ranking dates, so we have to figure
        // it out ourself.
        let next_date = new Date(this_date);
        let prev_date = new Date(this_date);
        next_date.setDate(next_date.getDate() + 1);
        prev_date.setDate(prev_date.getDate() - 1);

        next_date = format_date(next_date);
        prev_date = format_date(prev_date);

        // This version doesn't indicate the last page, and just keeps loading until it gets
        // an empty response.  It also doesn't indicate the first page where a ranking type
        // starts.  For example, AI results begin on 2022-10-31.  I'm not sure how to guess
        // the last page.  Are these dates UTC or JST?  Are new results available at exactly
        // midnight?
        let last_page = false;

        let media_ids = [];
        for(let item of result.body.ranking)
            media_ids.push(helpers.illust_id_to_media_id("" + item.illustId));

        return { media_ids, this_date, next_date, prev_date, last_page };
    }

    async load_data_desktop({ date, mode, content, page })
    {
        let data = {
            content,
            mode,
            format:  "json",
            p: page,
        };

        if(date)
            data.date = date;

        let result = await helpers.get_request("/ranking.php", data);
        let this_date = result.date;

        let next_date = result.next_date;
        let prev_date = result.prev_date;
        let last_page = !result.next;

        // Fix next_date and prev_date being false instead of null if there's no previous
        // or next date.
        if(!next_date)
            next_date = null;
        if(!prev_date)
            prev_date = null;

        // This is "YYYYMMDD".  Reformat it to YYYY-MM-DD.
        if(this_date.length == 8)
        {
            let year = this_date.slice(0,4);
            let month = this_date.slice(4,6);
            let day = this_date.slice(6,8);
            this_date = year + "/" + month + "/" + day;
        }

        // This API doesn't return aiType, but we can fill it in ourself since we know whether
        // we're on an AI rankings page or not.
        let is_ai = mode == "daily_ai" || mode == "daily_r18_ai";
        for(let illust of result.contents)
            illust.aiType = is_ai? 2:1;
        
        // This returns a struct of data that's like the thumbnails data response,
        // but it's not quite the same.
        let media_ids = [];
        for(var item of result.contents)
            media_ids.push(helpers.illust_id_to_media_id("" + item.illust_id));

        // Register this as thumbnail data.
        await media_cache.add_media_infos_partial(result.contents, "rankings");

        return { media_ids, this_date, next_date, prev_date, last_page };
    }

    load_data_for_platform(options)
    {
        if(ppixiv.mobile)
            return this.load_data_mobile(options);
        else
            return this.load_data_desktop(options);
    }

    async load_page_internal(page)
    {
        // Stop if we already know this is past the end.
        if(page > this.max_page)
            return;

        let query_args = this.url.searchParams;
        let date = query_args.get("date");
        let mode = query_args.get("mode") ?? "daily";
        let content = query_args.get("content") ?? "all";

        let { media_ids, this_date, next_date, prev_date, last_page } = await this.load_data_for_platform({ date, mode, content, page });

        if(last_page)
            this.max_page = Math.min(page, this.max_page);

        this.today_text ??= this_date;
        this.prev_date = prev_date;
        this.next_date = next_date;
        this.dispatchEvent(new Event("_refresh_ui"));

        // Register the new page of data.
        this.add_page(page, media_ids);
    };

    // This gives a tiny number of results per page on mobile.
    get estimated_items_per_page() { return ppixiv.mobile? 18:50; }

    get page_title() { return "Rankings"; }
    get_displaying_text() { return "Rankings"; }

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({data_source, ...options})
            {
                super({ ...options, template: `
                    <div class="ranking-data-source box-button-row">
                        <div class="box-button-row date-row">
                            ${ helpers.create_box_link({label: "Next day", popup: "Show the next day",     data_type: "new-illust-type-illust", classes: ["nav-tomorrow"] }) }
                            <span class=nav-today></span>
                            ${ helpers.create_box_link({label: "Previous day", popup: "Show the previous day",     data_type: "new-illust-type-illust", classes: ["nav-yesterday"] }) }
                        </div>

                        <div class=box-button-row>
                            ${ helpers.create_box_link({label: "Contents",    popup: "Content type to display", classes: ["content-type-button"] }) }
                        </div>

                        <div class=box-button-row>
                            ${ helpers.create_box_link({label: "Ranking type",    popup: "Content type to display", classes: ["mode-button"] }) }
                        </div>

                        <div class="box-button-row modes"></div>
                    </div>
                `});

                this.data_source = data_source;

                data_source.addEventListener("_refresh_ui", () => this.refresh_dates(), this._signal);
                this.refresh_dates();

                /*
                 * Pixiv has a fixed list of rankings, but it displays them as a set of buttons
                 * based on the current selection, showing which rankings are available in the current
                 * category.
                 *     
                 * These are the available ranking modes, and whether they're available in overall,
                 * content=illust/manga (these have the same selections) and content=ugoira, and
                 * whether there are R18 rankings.  R18 rankings have the same mode name with "_r18"
                 * appended.  (Except for AI which puts it in the middle, because Pixiv.)
                 *
                 * Be careful: Pixiv's UI has buttons in some filters that don't actually exist in the
                 * mode it's in, which actually redirect out of the content mode, such as "popular among
                 * male users" in "Illustrations" mode which actually goes back to "Overall".
                 *
                 * o: overall (all) o*: overall R18      o**: overall R18G
                 * i: illust/manga  i*: illust/manga R18 i**: illust/manga R18G
                 * u: ugoira        u*: ugoira R18
                 */
                let ranking_types = {
                    //                       Overall    Illust     Ugoira
                    //                            R18        R18        R18       
                    "daily":     { content: ["o", "o*", "i", "i*", "u", "u*"],                label: "Daily",    popup: "Daily rankings",  },

                    // Weekly also has "r18g" for most content types.
                    "weekly":    { content: ["o", "o*", "i", "i*", "u", "u*", "o**", "i**"],  label: "Weekly",   popup: "Weekly rankings",  },
                    "monthly":   { content: ["o",       "i"],                                 label: "Monthly",  popup: "Monthly rankings",  },
                    "rookie":    { content: ["o",       "i"],                                 label: "Rookie",   popup: "Rookie rankings" },
                    "original":  { content: ["o"],                                            label: "Original", popup: "Original rankings" },
                    "daily_ai":  { content: ["o", "o*"],                                      label: "AI",       popup: "Show AI works" },
                    "male":      { content: ["o", "o*"],                                      label: "Male",     popup: "Popular with men"      },
                    "female":    { content: ["o", "o*"],                                      label: "Female",   popup: "Popular with women"       },
                };

                // Given a content selection ("all", "illust", "manga", "ugoira") and an ages selection, return
                // the shorthand key for this combination, such as "i*".
                function content_key_for(content, ages)
                {
                    let keys = { "all": "o", "illust": "i", "manga": "i" /* same as illust */, "ugoira": "u" };
                    let content_key = keys[content];

                    // Append * for r18 and ** for r18g.
                    if(ages == "r18")
                        content_key += "*";
                    else if(ages == "r18g")
                        content_key += "**";

                    return content_key;
                }

                // Given a mode ("daily") and an ages selection ("r18"), return the combined mode,
                // eg. "daily_r18".
                function mode_with_ages(mode, ages)
                {
                    if(ages == "r18")
                        mode += "_r18"; // daily_r18
                    else if(ages == "r18g")
                        mode += "_r18g"; // daily_r18g

                    // Seriously, guys?
                    if(mode == "daily_ai_r18")
                        mode = "daily_r18_ai";
                    else if(mode == "weekly_r18g")
                        mode = "r18g";

                    return mode;
                }

                let current_args = helpers.args.location;

                // The current content type: all, illust, manga, ugoira
                let current_content = current_args.query.get("content") || "all";

                // The current mode: daily, weekly, etc.
                let current_mode = current_args.query.get("mode") || "daily";
                if(current_mode == "r18g") // work around Pixiv inconsistency
                    current_mode = "weekly_r18g";

                // "all", "r18", "r18g"
                let current_ages = current_mode.indexOf("r18g") != -1? "r18g":
                    current_mode.indexOf("r18") != -1? "r18":"all";
                
                // Strip _r18 or _r18g out of current_mode, so current_mode is the base mode, ignoring the
                // ages selection.
                current_mode = current_mode.replace("_r18g", "").replace("_r18", "");

                // The key for the current mode:
                let content_key = content_key_for(current_content, current_ages);
                console.log(`Rankings content mode: ${current_content}, ages: ${current_ages}, key: ${content_key}`);

                let mode_container = this.querySelector(".modes");

                // Create the R18 and R18G buttons.  If we're on a selection where toggling this doesn't exist,
                // pick a default.
                for(let ages_toggle of ["r18", "r18g"])
                {
                    let target_mode = current_mode;

                    let current_ranking_type = ranking_types[current_mode];
                    console.assert(current_ranking_type, current_mode);
                    let { content } = current_ranking_type;

                    let button = helpers.create_box_link({
                        label: ages_toggle.toUpperCase(),
                        popup: `Show ${ages_toggle.toUpperCase()} works`,
                        classes: [ages_toggle],
                        as_element: true,
                    });
                    mode_container.appendChild(button);

                    // If toggling this would put us in a mode that doesn't exist, default to "daily" for R18 and
                    // "weekly" for R18G, since those combinations always exist.  The buttons aren't disabled or
                    // removed since it makes it confusing to find them.
                    let content_key_for_mode = content_key_for(current_content, ages_toggle);
                    if(content.indexOf(content_key_for_mode) == -1)
                        target_mode = ages_toggle == "r18"? "daily":"weekly";

                    let mode_enabled = mode_with_ages(target_mode, ages_toggle);
                    let mode_disabled = mode_with_ages(target_mode, "all");

                    data_source.set_item(button, {
                        fields: {mode: mode_enabled},
                        toggle: true,
                        current_url: current_args.url,
                        classes: [ages_toggle], // only show if enabled
                        adjust_url: (args) => {
                            // If we're in R18, clicking this would remove the mode field entirely.  Instead,
                            // switch to the all-ages link.
                            if(current_ages == ages_toggle)
                                args.query.set("mode", mode_disabled);
                        }
                    });
                }

                // Create the content dropdown.
                new ppixiv.dropdown_menu_opener({
                    button: this.querySelector(".content-type-button"),
                    create_box: ({...options}) => {
                        let dropdown = new ppixiv.widget({
                            ...options,
                            template: `
                                <div class="vertical-list">
                                    ${ helpers.create_box_link({label: "All",           popup: "Show all works",           data_type: "content-all" }) }
                                    ${ helpers.create_box_link({label: "Illustrations", popup: "Show illustrations only",  data_type: "content-illust" }) }
                                    ${ helpers.create_box_link({label: "Animations",    popup: "Show animations only",     data_type: "content-ugoira" }) }
                                    ${ helpers.create_box_link({label: "Manga",         popup: "Show manga only",          data_type: "content-manga" }) }
                                </div>
                            `,
                        });

                        // Set up the content links.
                        // grr: this doesn't work with the dropdown text
                        for(let content of ["all", "illust", "ugoira", "manga"])
                        {
                            data_source.set_item(dropdown, {
                                type: "content-" + content, // content-all, content-illust, etc
                                fields: {content},
                                default_values: {content: "all"},
                                adjust_url: (args) => {
                                    if(content == current_content)
                                        return;

                                    // If the current mode and ages combination doesn't exist in the content type
                                    // this link will switch to, also reset the mode to daily, since it exists for
                                    // all "all-ages" modes.
                                    let current_ranking_type = ranking_types[current_mode];
                                    console.assert(current_ranking_type, current_mode);
                                    let switching_to_content_key = content_key_for(content, current_ages);
                                    if(current_ranking_type.content.indexOf(switching_to_content_key) == -1)
                                        args.query.set("mode", "daily");
                                },
                            });
                        }

                        return dropdown;
                    },
                });

                // Create the mode dropdown.
                new ppixiv.dropdown_menu_opener({
                    button: this.querySelector(".mode-button"),
                    create_box: ({...options}) => {
                        let dropdown = new ppixiv.widget({
                            ...options,
                            template: `
                                <div class="vertical-list">
                                </div>
                            `
                        });

                        // Create mode links for rankings that exist in the current content and ages selection.
                        for(let [mode, {content, label, popup}] of Object.entries(ranking_types))
                        {
                            console.assert(content, mode);

                            mode = mode_with_ages(mode, current_ages);

                            // Skip this mode if it's not available in the selected content and ages combination.
                            if(content.indexOf(content_key) == -1)
                                continue;

                            let button = helpers.create_box_link({
                                label,
                                popup,
                                as_element: true,
                            });
                            dropdown.container.appendChild(button);

                            data_source.set_item(button, {
                                fields: {mode},
                                default_values: {mode: "daily"},
                                current_url: current_args.url,
                            });
                        }

                        return dropdown;
                    }
                });
            }

            refresh_dates = () =>
            {
                if(this.data_source.today_text)
                    this.querySelector(".nav-today").innerText = this.data_source.today_text;
        
                // This UI is greyed rather than hidden before we have the dates, so the UI doesn't
                // shift around as we load.
                let yesterday = this.querySelector(".nav-yesterday");
                helpers.set_class(yesterday, "disabled", this.data_source.prev_date == null);
                if(this.data_source.prev_date)
                {
                    let url = new URL(this.data_source.url);
                    url.searchParams.set("date", this.data_source.prev_date);
                    yesterday.href = url;
                }
        
                let tomorrow = this.querySelector(".nav-tomorrow");
                helpers.set_class(tomorrow, "disabled", this.data_source.next_date == null);
                if(this.data_source.next_date)
                {
                    let url = new URL(this.data_source.url);
                    url.searchParams.set("date", this.data_source.next_date);
                    tomorrow.href = url;
                }
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
        var url = new URL(this.url);

        // Update the URL with the current page.
        url.searchParams.set("p", page);

        console.log("Loading:", url.toString());

        let doc = await helpers.fetch_document(url);

        let media_ids = this.parse_document(doc);
        if(media_ids == null)
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
            this.items_per_page = Math.max(media_ids.length, this.items_per_page);

        // Register the new page of data.
        this.add_page(page, media_ids);
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
        this.booth_url = null;
    }

    get supports_start_page() { return true; }

    get viewing_user_id()
    {
        // /users/13245
        return helpers.get_path_part(this.url, 1);
    };

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
        // We'll load translations for all tags if the tag dropdown is opened, but for now
        // just load the translation for the selected tag, so it's available for the button text.
        let current_tag = this.current_tag;
        if(current_tag != null)
        {
            this.translated_tags = await tag_translations.get().get_translations([current_tag], "en");
            this.call_update_listeners();
        }

        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        this.user_info = await user_cache.get_user_info_full(this.viewing_user_id);

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
                let all_media_ids = await this.load_all_results();
                this.pages = paginate_illust_ids(all_media_ids, this.estimated_items_per_page);
            }

            // Tell media_cache to start loading these media IDs.  This will happen anyway if we don't
            // do it here, but we know these posts are all from the same user ID, so kick it off here
            // to hint batch_get_media_info_partial to use the user-specific API.  Don't wait for this
            // to complete, since we don't need to and it'll cause the search view to take longer to
            // appear.
            let media_ids = this.pages[page-1] || [];
            media_cache.batch_get_media_info_partial(media_ids, { user_id: this.viewing_user_id });

            // Register this page.
            this.add_page(page, media_ids);
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
            // inconsistency than an optimization.  Fill it in for media_info.
            for(var item of result.body.works)
            {
                item.userName = this.user_info.name;
                item.profileImageUrl = this.user_info.imageBig;
            }

            var media_ids = [];
            for(var illust_data of result.body.works)
                media_ids.push(helpers.illust_id_to_media_id(illust_data.id)); 

            await media_cache.add_media_infos_partial(result.body.works, "normal");

            // Register the new page of data.
            this.add_page(page, media_ids);
        }
    }
    
    add_extra_links(links)
    {
        // Add the Fanbox link to the list if we have one.
        if(this.fanbox_url)
            links.push({url: this.fanbox_url, label: "Fanbox"});
        if(this.booth_url)
            links.push({url: this.booth_url, label: "Booth"});

        if(this.accepting_requests)
        {
            links.push({
                url: new URL(`/users/${this.viewing_user_id}/request#no-ppixiv`, ppixiv.plocation),
                type: "request",
                label: "Accepting requests",
            });
        }
    }

    async load_all_results()
    {
        let type = this.viewing_type;

        let result = await helpers.get_request("/ajax/user/" + this.viewing_user_id + "/profile/all", {});

        // Remember if this user is accepting requests, so we can add a link.
        this.accepting_requests = result.body.request.showRequestTab;

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
        }
        this.call_update_listeners();

        // If this user has a linked Booth account, look it up.  Only do this if the profile indicates
        // that it exists.  Don't wait for this to complete.
        if(result.body?.externalSiteWorksStatus?.booth)
            this.load_booth();

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

        var media_ids = [];
        for(let illust_id of illust_ids)
            media_ids.push(helpers.illust_id_to_media_id(illust_id));

        return media_ids;
    };

    async load_booth()
    {
        let booth_request = await helpers.get_request("https://api.booth.pm/pixiv/shops/show.json", {
            pixiv_user_id: this.viewing_user_id,
            adult: "include",
            limit: 24,
        });

        let booth = await booth_request;
        if(booth.error)
        {
            console.log(`Error reading Booth profile for ${this.viewing_user_id}`);
            return;
        }

        this.booth_url = booth.body.url;
        this.call_update_listeners();
    }

    // If we're filtering a follow tag, return it.  Otherwise, return null.
    get current_tag()
    {
        let args = new helpers.args(this.url);
        return args.query.get("tag");
    }

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({data_source, ...options})
            {
                super({ ...options, template: `
                    <div>
                        <div class="box-button-row search-options-row">
                            ${ helpers.create_box_link({label: "Works",    popup: "Show all works",            data_type: "artist-works" }) }
                            ${ helpers.create_box_link({label: "Illusts",  popup: "Show illustrations only",   data_type: "artist-illust" }) }
                            ${ helpers.create_box_link({label: "Manga",    popup: "Show manga only",           data_type: "artist-manga" }) }
                            ${ helpers.create_box_link({label: "Tags",     popup: "Tags", icon: "bookmark", classes: ["member-tags-button"] }) }
                        </div>

                        <vv-container class=avatar-container></vv-container>
                    </div>
                `});

                this.data_source = data_source;

                data_source.addEventListener("_refresh_ui", () => {
                    // Refresh the displayed label in case we didn't have it when we created the widget.
                    this.tag_dropdown.set_button_popup_highlight();
                }, this._signal);

                data_source.set_path_item(this.container, "artist-works", 2, "artworks");
                data_source.set_path_item(this.container, "artist-illust", 2, "illustrations");
                data_source.set_path_item(this.container, "artist-manga", 2, "manga");

                // On mobile, create our own avatar display for the search popup.
                if(ppixiv.mobile)
                {
                    let avatar_container = this.container.querySelector(".avatar-container");
                    this.avatar_widget = new avatar_widget({
                        container: avatar_container,
                        big: true,
                        mode: "dropdown",
                    });
                    this.avatar_widget.set_user_id(data_source.viewing_user_id);
                }

                class tag_dropdown extends tag_dropdown_widget
                {
                    refresh_tags()
                    {
                        // Refresh the post tag list.
                        helpers.remove_elements(this.container);

                        if(data_source.post_tags != null)
                        {
                            this.add_tag_link({ tag: "All" });
                            for(let tag_info of data_source.post_tags || [])
                                this.add_tag_link(tag_info);
                        }
                        else
                        {
                            // Tags aren't loaded yet.  We'll be refreshed after tag_list_opened loads tags.
                            // If a tag is selected, fill in just that tag so the button text works.
                            var span = document.createElement("span");
                            span.innerText = "Loading...";
                            this.container.appendChild(span);

                            this.add_tag_link({ tag: "All" });

                            let current_tag = data_source.current_tag;
                            if(current_tag != null)
                                this.add_tag_link({ tag: current_tag });
                        }
                    }

                    add_tag_link(tag_info)
                    {
                        let current_args = helpers.args.location;

                        // Skip tags with very few posts.  This list includes every tag the author
                        // has ever used, and ends up being pages long with tons of tags that were
                        // only used once.
                        if(tag_info.tag != "All" && tag_info.cnt < 5)
                            return;

                        let tag = tag_info.tag;
                        let translated_tag = tag;
                        if(data_source.translated_tags && data_source.translated_tags[tag])
                            translated_tag = data_source.translated_tags[tag];

                        let classes = ["tag-entry"];

                        // If the user has searched for this tag recently, add the recent tag.  This is added
                        // in tag_list_opened.
                        if(tag_info.recent)
                            classes.push("recent");

                        let a = helpers.create_box_link({
                            label: translated_tag,
                            classes,
                            popup: tag_info?.cnt,
                            link: "#",
                            as_element: true,
                            data_type: "artist-tag",
                        });

                        data_source.set_item(a, { fields: {"tag": tag != "All"? tag:null}, current_url: current_args.url });

                        if(tag == "All")
                            a.dataset["default"] = 1;

                        this.container.appendChild(a);
                    };
                };

                this.tag_dropdown = new ppixiv.dropdown_menu_opener({
                    button: this.querySelector(".member-tags-button"),
                    create_box: ({...options}) => new tag_dropdown({data_source, ...options}),
                    onvisibilitychanged: (opener) => {
                        // Populate the tags dropdown if it's opened, so we don't load user tags for every user page.
                        if(opener.visible);
                            data_source.tag_list_opened();
                    }
                });
            }
        }
    }

    get ui_info()
    {
        return {
            user_id: this.viewing_user_id,
        }
    }

    // This is called when the tag list dropdown is opened.
    async tag_list_opened()
    {
        // Get user info.  We probably have this on this.user_info, but that async load
        // might not be finished yet.
        let user_info = await user_cache.get_user_info_full(this.viewing_user_id);
        console.log("Loading tags for user", user_info.userId);

        // Load this artist's common tags.
        this.post_tags = await this.get_user_tags(user_info);

        // Mark the tags in this.post_tags that the user has searched for recently, so they can be
        // marked in the UI.
        let user_tag_searches = saved_search_tags.get_all_used_tags();
        for(let tag of this.post_tags)
            tag.recent = user_tag_searches.has(tag.tag);

        // Move tags that this artist uses to the top if the user has searched for them recently.
        this.post_tags.sort((lhs, rhs) => {
            if(rhs.recent != lhs.recent)
                return rhs.recent - lhs.recent;
            else
                return rhs.cnt - lhs.cnt;
        });

        let tags = [];
        for(let tag_info of this.post_tags)
            tags.push(tag_info.tag);
        this.translated_tags = await tag_translations.get().get_translations(tags, "en");

        // Refresh the tag list now that it's loaded.
        this.dispatchEvent(new Event("_refresh_ui"));
    }

    async get_user_tags(user_info)
    {
        if(user_info.frequentTags)
            return Array.from(user_info.frequentTags);

        var result = await helpers.get_request("/ajax/user/" + user_info.userId + "/illustmanga/tags", {});
        if(result.error)
        {
            console.error("Error fetching tags for user " + user_info.userId + ": " + result.error);
            user_info.frequentTags = [];
            return Array.from(user_info.frequentTags);
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
        return Array.from(user_info.frequentTags);
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

        this.media_id = this.get_media_id_from_url(new helpers.args(url));

        this._load_media_info();
    }

    async _load_media_info()
    {
        this.media_info = await media_cache.get_media_info(this.media_id, { full: false });
    }

    // Show the illustration by default.
    get default_screen()
    {
        return "illust";
    }

    // This data source just views a single image and doesn't return any posts.
    async load_page_internal(page) { }

    get_media_id_from_url(args)
    {
        // The illust ID is stored in the path, for compatibility with Pixiv URLs:
        //
        // https://www.pixiv.net/en/users/#/artworks
        //
        // The page (if any) is stored in the hash.
        let url = args.url;
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");
        let illust_id = parts[2];

        let page = this.get_page_from_url(args);
        return helpers.illust_id_to_media_id(illust_id, page);
    }

    // We're always viewing our media ID.
    get_current_media_id(args) { return this.media_id; }

    // Use the artist's page as the view if we're trying to return to a search for this data
    // source.
    get search_url()
    {
        if(this.media_info)
            return new URL(`/users/${this.media_info.userId}/artworks#ppixiv`, this.url);
        else
            return this.url;
    }

    // We don't return any posts to navigate to, but this can still be called by
    // quick view.
    set_current_media_id(media_id, args)
    {
        let [illust_id] = helpers.media_id_to_illust_id_and_page(media_id);

        // Pixiv's inconsistent URLs are annoying.  Figure out where the ID field is.
        // If the first field is a language, it's the third field (/en/artworks/#), otherwise
        // it's the second (/artworks/#).
        let parts = args.path.split("/");
        let id_part = parts[1].length == 2? 3:2;
        parts[id_part] = illust_id;
        args.path = parts.join("/");
    }
};

// /artworks/illust_id?manga - Viewing manga pages for an illustration
ppixiv.data_sources.manga = class extends data_source
{
    get name() { return "manga"; }
    get includes_manga_pages() { return true; }

    constructor(url)
    {
        super(url);

        // /artworks/#
        url = new URL(url);
        url = helpers.get_url_without_language(url);
        let parts = url.pathname.split("/");
        let illust_id = parts[2];
        this.media_id = helpers.illust_id_to_media_id(illust_id);
    }

    async load_page_internal(page)
    {
        if(page != 1)
            return;

        // We need full illust info for get_manga_aspect_ratio, but we can fill out most of the
        // UI with thumbnail or illust info.  Load whichever one we have first and update, so we
        // display initial info quickly.
        this.media_info = await media_cache.get_media_info(this.media_id, { full: false });
        this.call_update_listeners();

        // Load media info before continuing.
        this.illust_info = await media_cache.get_media_info(this.media_id);
        if(this.illust_info == null)
            return;

        let page_media_ids = [];
        for(let page = 0; page < this.illust_info.pageCount; ++page)
            page_media_ids.push(helpers.get_media_id_for_page(this.media_id, page));

        this.add_page(page, page_media_ids);
    }

    get page_title()
    {
        if(this.media_info)
            return this.media_info.userName + " - " + this.media_info.illustTitle;
        else
            return "Illustrations";
    }

    get_displaying_text()
    {
        if(this.media_info)
            return this.media_info.illustTitle + " by " + this.media_info.userName;
        else
            return "Illustrations";
    };

    // If all pages of the manga post we're viewing have around the same aspect ratio, use it
    // for thumbnails.
    get_thumbnail_aspect_ratio()
    {
        if(this.illust_info == null)
            return null;

        return helpers.get_manga_aspect_ratio(this.illust_info.mangaPages);
    }

    get ui_info()
    {
        return {
            user_id: this.media_info?.userId,
        }
    }
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
ppixiv.data_source_bookmarks_base = class extends data_source
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
        let user_info_promise = user_cache.get_user_info_full(this.viewing_user_id);
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

        all_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.bookmark_tag_counts = {};
        for(let tag of all_tags)
            this.bookmark_tag_counts[tag] = tags[tag];

        // Update the UI with the tag list.
        this.dispatchEvent(new Event("_refresh_ui"));
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
                let media_id = helpers.illust_id_to_media_id(illust.id.toString());
                extra_cache.singleton().update_cached_bookmark_image_tags(media_id, tags);
            }
        }

        // Store whether there are any results.  Do this before filtering deleted images,
        // so we know the results weren't empty even if all results on this page are deleted.
        result.body.empty = result.body.works.length == 0;
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
            displaying += ` / untagged`;
        else if(tag != null)
            displaying += ` / ${tag}`;

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

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div class=box-button-row>
                        <div class=box-button-row>
                            <!-- These are hidden if you're viewing somebody else's bookmarks. -->
                            <span class=bookmarks-public-private style="margin-right: 25px;">
                                ${ helpers.create_box_link({label: "All",        popup: "Show all bookmarks",       data_type: "all" }) }
                                ${ helpers.create_box_link({label: "Public",     popup: "Show public bookmarks",    data_type: "public" }) }
                                ${ helpers.create_box_link({label: "Private",    popup: "Show private bookmarks",   data_type: "private" }) }
                            </span>

                            ${ helpers.create_box_link({ popup: "Shuffle", icon: "shuffle",   data_type: "order-shuffle" }) }
                        </div>

                        ${ helpers.create_box_link({label: "All bookmarks",    popup: "Bookmark tags",  icon: "ppixiv:tag", classes: ["bookmark-tag-button"] }) }
                    </div>
                `});

                this.data_source = data_source;

                // Refresh the displayed label in case we didn't have it when we created the widget.
                this.data_source.addEventListener("_refresh_ui", () => this.tag_dropdown.set_button_popup_highlight(), this._signal);

                // The public/private button only makes sense when viewing your own bookmarks.
                let public_private_button_container = this.querySelector(".bookmarks-public-private");
                public_private_button_container.hidden = !this.data_source.viewing_own_bookmarks();

                // Set up the public and private buttons.  The "all" button also removes shuffle, since it's not
                // supported there.
                this.data_source.set_item(public_private_button_container, { type: "all", fields: {"#show-all": 1, "#shuffle": null}, default_values: {"#show-all": 1} });
                this.data_source.set_item(this.container, { type: "public", fields: {rest: null, "#show-all": 0}, default_values: {"#show-all": 1} });
                this.data_source.set_item(this.container, { type: "private", fields: {rest: "hide", "#show-all": 0}, default_values: {"#show-all": 1} });

                // Shuffle isn't supported for merged bookmarks.  If we're on #show-all, make the shuffle button
                // also switch to public bookmarks.  This is easier than graying it out and trying to explain it
                // in the popup, and better than hiding it which makes it hard to find.
                let args = new helpers.args(this.data_source.url);
                let show_all = args.hash.get("show-all") != "0";
                let set_public = show_all? { rest: null, "#show-all": 0 }:{};
                this.data_source.set_item(this.container, {type: "order-shuffle", fields: {"#shuffle": 1, ...set_public}, toggle: true, default_values: {"#shuffle": null, "#show-all": 1}});

                class bookmark_tags_dropdown extends tag_dropdown_widget
                {
                    refresh_tags()
                    {
                        // Refresh the bookmark tag list.  Remove the page number from these buttons.
                        let current_url = new URL(data_source.url);
                        current_url.searchParams.delete("p");

                        for(let tag of this.container.querySelectorAll(".tag-entry"))
                            tag.remove();

                        this.add_tag_link(null); // All
                        this.add_tag_link(""); // Uncategorized

                        let all_tags = Object.keys(data_source.bookmark_tag_counts);
                        all_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
                        for(let tag of all_tags)
                        {
                            // Skip uncategorized, which is always placed at the beginning.
                            if(tag == "")
                                continue;

                            if(data_source.bookmark_tag_counts[tag] == 0)
                                continue;

                            this.add_tag_link(tag);
                        }
                    }                    

                    add_tag_link(tag)
                    {
                        let current_args = helpers.args.location;

                        let label;
                        if(tag == null)
                            label = "All bookmarks";
                        else if(tag == "")
                            label = "Untagged";
                        else
                            label = tag;

                        let a = helpers.create_box_link({
                            label,
                            classes: ["tag-entry"],
                            popup: data_source.bookmark_tag_counts[tag],
                            link: "#",
                            as_element: true,
                            data_type: "bookmark-tag",
                        });

                        if(label == "All bookmarks")
                            a.dataset.default = 1;

                        if(tag == "")
                            tag = "未分類"; // Uncategorized

                            data_source.set_item(a, {
                            url_format: "users/id/bookmarks/type/tag",
                            fields: {"/tag": tag},
                            current_url: current_args.url
                        });

                        this.container.appendChild(a);
                    };
                };

                // Create the bookmark tag dropdown.
                this.tag_dropdown = new ppixiv.dropdown_menu_opener({
                    button: this.querySelector(".bookmark-tag-button"),
                    create_box: ({...options}) => new bookmark_tags_dropdown({data_source, ...options}),
                });
            }
        };
    }

    get ui_info()
    {
        return {
            user_id: this.viewing_own_bookmarks()? null:this.viewing_user_id,
        }
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

        var media_ids = [];
        for(let illust_data of result.works)
            media_ids.push(helpers.illust_id_to_media_id(illust_data.id)); 

        // If we're shuffling, shuffle the individual illustrations too.
        if(this.shuffle)
            helpers.shuffle_array(media_ids);
        
        await media_cache.add_media_infos_partial(result.works, "normal");

        // Register the new page of data.  If we're shuffling, use the original page number, not the
        // shuffled page.
        //
        // If media_ids is empty but result.empty is false, we had results in the list but we
        // filtered them all out.  Set allow_empty to true in this case so we add the empty page,
        // or else it'll look like we're at the end of the results when we know we aren't.
        this.add_page(page, media_ids, {
            allow_empty: !result.empty,
        });

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
        let media_ids = [];
        for(var i = 0; i < 2; ++i)
            if(this.bookmark_illust_ids[i] != null && this.bookmark_illust_ids[i][page] != null)
                media_ids = media_ids.concat(this.bookmark_illust_ids[i][page]);
        
        this.add_page(page, media_ids);

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

        var media_ids = [];
        for(let illust_data of result.works)
            media_ids.push(helpers.illust_id_to_media_id(illust_data.id));

        await media_cache.add_media_infos_partial(result.works, "normal");

        // If there are no results, remember that this is the last page, so we don't
        // make more requests for this type.  Use the "empty" flag for this and not
        // whether there are any media IDs, in case there were IDs but they're all
        // deleted.
        if(result.empty)
        {
            if(this.max_page_per_type[is_private] == -1)
                this.max_page_per_type[is_private] = page;
            else
                this.max_page_per_type[is_private] = Math.min(page, this.max_page_per_type[is_private]);
            // console.log("max page for", is_private? "private":"public", this.max_page_per_type[is_private]);
        }

        // Store the IDs.  We don't register them here.
        this.bookmark_illust_ids[is_private][page] = media_ids;

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

        if(result.body.illusts.length > 0)
        {
            this.last_id = result.body.illusts[result.body.illusts.length-1].id;
            this.last_id_page++;
        }

        let media_ids = [];
        for(var illust_data of result.body.illusts)
            media_ids.push(helpers.illust_id_to_media_id(illust_data.id));

        await media_cache.add_media_infos_partial(result.body.illusts, "normal");

        // Register the new page of data.
        this.add_page(page, media_ids);
    }

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class=box-button-row>
                            <div class=box-button-row>
                                ${ helpers.create_box_link({label: "Illustrations", popup: "Show illustrations",     data_type: "new-illust-type-illust" }) }
                                ${ helpers.create_box_link({label: "Manga",         popup: "Show manga only",        data_type: "new-illust-type-manga" }) }
                            </div>

                            <div class=box-button-row>
                                ${ helpers.create_box_link({label: "R18",           popup: "Show only R18 works",         data_type: "new-illust-ages-r18" }) }
                            </div>
                        </div>
                    </div>
                `});

                let current_args = helpers.args.location;

                data_source.set_item(this.container, { type: "new-illust-type-illust", fields: {type: null} });
                data_source.set_item(this.container, { type: "new-illust-type-manga", fields: {type: "manga"} });
        
                data_source.set_item(this.container, { type: "new-illust-ages-r18", toggle: true, url_format: "path",
                    fields: {"/path": "new_illust_r18.php"},
                    default_values: {"/path": "new_illust.php"},
                    current_url: current_args.url,
                });
       
            }
        }
    }
}

// bookmark_new_illust.php, bookmark_new_illust_r18.php
ppixiv.data_sources.new_works_by_following = class extends data_source
{
    get name() { return "new_works_by_following"; }

    constructor(url)
    {
        super(url);
        this.bookmark_tags = [];
    }

    get supports_start_page() { return true; }

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
        this.bookmark_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.dispatchEvent(new Event("_refresh_ui"));

        // Populate thumbnail data with this data.
        await media_cache.add_media_infos_partial(data.thumbnails.illust, "normal");

        let media_ids = [];
        for(let illust of data.thumbnails.illust)
            media_ids.push(helpers.illust_id_to_media_id(illust.id));

        // Register the new page of data.
        this.add_page(page, media_ids);
    }
    
    get page_title()
    {
        return "Following";
    }

    get_displaying_text()
    {
        return "Following";
    };

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class=box-button-row>
                            ${ helpers.create_box_link({label: "R18",    popup: "Show only R18 works",   data_type: "bookmarks-new-illust-ages-r18", classes: ["r18"] }) }
                            ${ helpers.create_box_link({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["follow-tag-button", "premium-only"] }) }
                        </div>
                    </div>
                `});

                this.data_source = data_source;

                class follow_tag_dropdown extends tag_dropdown_widget
                {
                    refresh_tags()
                    {
                        // Refresh the bookmark tag list.
                        let current_tag = data_source.url.searchParams.get("tag") || "All tags";

                        for(let tag of this.container.querySelectorAll(".tag-entry"))
                            tag.remove();

                        this.add_tag_link("All tags");
                        for(let tag of data_source.bookmark_tags)
                            this.add_tag_link(tag);

                        // If we don't have the tag list yet because we're still loading the page, fill in
                        // the current tag, to reduce flicker as the page loads.
                        if(data_source.bookmark_tags.length == 0 && current_tag != "All tags")
                            this.add_tag_link(current_tag);
                    }

                    add_tag_link(tag)
                    {
                        let current_args = helpers.args.location;

                        // Work around Pixiv always returning a follow tag named "null" for some users.
                        if(tag == "null")
                            return;

                        let label = tag;
                        if(tag == "All tags")
                            tag = null;

                        let a = helpers.create_box_link({
                            label,
                            classes: ["tag-entry"],
                            link: "#",
                            as_element: true,
                            data_type: "following-tag",
                        });

                        if(label == "All tags")
                            a.dataset.default = 1;

                            data_source.set_item(a, { fields: {"tag": tag}, current_url: current_args.url });

                        this.container.appendChild(a);
                    };
                };
                
                // Create the follow tag dropdown.
                new ppixiv.dropdown_menu_opener({
                    button: this.querySelector(".follow-tag-button"),
                    create_box: ({...options}) => new follow_tag_dropdown({data_source, ...options}),
                });

                let current_args = helpers.args.location;
                data_source.set_item(this.container, {
                    type: "bookmarks-new-illust-ages-r18",
                    toggle: true,
                    url_format: "path",
                    fields: {"/path": "bookmark_new_illust_r18.php"},
                    default_values: {"/path": "bookmark_new_illust.php"},
                    current_url: current_args.url,
                });
            }
        }
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

        // Add the search tags to tag history.  We only do this at the start when the
        // data source is created, not every time we navigate back to the search.
        let tag = this._search_tags;
        if(tag)
            saved_search_tags.add(tag);

        this.cache_search_title();
    }

    get supports_start_page() { return true; }

    get no_results()
    {
        // Don't display "No Results" while we're still waiting for the user to enter a tag.
        if(!this._search_tags)
            return false;

        return super.no_results;
    }

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
        settings.addEventListener("disable-translations", this.cache_search_title);
    }

    shutdown()
    {
        super.shutdown();
        settings.removeEventListener("disable-translations", this.cache_search_title);
    }

    cache_search_title = async() =>
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
                else if(tag == "(" || tag == ")")
                    span.classList.add("paren");
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
            this.dispatchEvent(new Event("_refresh_ui"));
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
        await media_cache.add_media_infos_partial(illusts, "normal");

        let media_ids = [];
        for(let illust of illusts)
            media_ids.push(helpers.illust_id_to_media_id(illust.id));

        // Register the new page of data.
        this.add_page(page, media_ids);
    }

    get page_title()
    {
        return this.title;
    }

    get_displaying_text()
    {
        return this.displaying_tags ?? "Search works";
    };

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

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class=tag-search-with-related-tags>
                            <vv-container class=tag-search-box-container></vv-container>

                            ${ helpers.create_box_link({label: "Related tags",    icon: "bookmark", classes: ["related-tags-button"] }) }
                        </div>

                        <div class="box-button-row search-options-row">
                            ${ helpers.create_box_link({label: "Ages",    classes: ["ages-button"] }) }
                            ${ helpers.create_box_link({label: "Sort",    classes: ["sort-button"] }) }
                            ${ helpers.create_box_link({label: "Type",    classes: [["search-type-button"]] }) }
                            ${ helpers.create_box_link({label: "Search mode",    classes: ["search-mode-button"] }) }
                            ${ helpers.create_box_link({label: "Image size",    classes: ["image-size-button"] }) }
                            ${ helpers.create_box_link({label: "Aspect ratio",    classes: ["aspect-ratio-button"] }) }
                            ${ helpers.create_box_link({label: "Bookmarks",    classes: ["bookmark-count-button", "premium-only"] }) }
                            ${ helpers.create_box_link({label: "Time",    classes: ["time-ago-button"] }) }
                            ${ helpers.create_box_link({label: "Reset", popup: "Clear all search options", classes: ["reset-search"] }) }
                        </div>
                    </div>
                `});

                this.data_source = data_source;

                class related_tag_dropdown extends tag_dropdown_widget
                {
                    constructor({...options})
                    {
                        super({...options});

                        this.related_tag_widget = new tag_widget({
                            contents: this.container,
                        });

                        this.refresh_tags();
                    }

                    refresh_tags()
                    {
                        if(this.data_source.related_tags && this.related_tag_widget)
                            this.related_tag_widget.set(this.data_source.related_tags);
                    }
                };

                this.tag_dropdown = new ppixiv.dropdown_menu_opener({
                    button: this.querySelector(".related-tags-button"),
                    create_box: ({...options}) => new related_tag_dropdown({ data_source, ...options }),
                });

                data_source.setup_dropdown(this.querySelector(".ages-button"), [{
                    create_options: { label: "All",  dataset: { default: true } },
                    setup_options: { fields: {mode: null} },
                }, {
                    create_options: { label: "All ages" },
                    setup_options: { fields: {mode: "safe"} },
                }, {
                    create_options: { label: "R18", classes: ["r18"] },
                    setup_options: { fields: {mode: "r18"} },
                }]);

                data_source.setup_dropdown(this.querySelector(".sort-button"), [{
                    create_options: { label: "Newest",              dataset: { default: true } },
                    setup_options: { fields: {order: null}, default_values: {order: "date_d"} }
                }, {
                    create_options: { label: "Oldest" },
                    setup_options: { fields: {order: "date"} }
                }, {
                    create_options: { label: "Popularity",          classes: ["premium-only"] },
                    setup_options: { fields: {order: "popular_d"} }
                }, {
                    create_options: { label: "Popular with men",    classes: ["premium-only"] },
                    setup_options: { fields: {order: "popular_male_d"} }
                }, {
                    create_options: { label: "Popular with women",  classes: ["premium-only"] },
                    setup_options:  { fields: {order: "popular_female_d"} }
                }]);

                let url_format = "tags/tag/type";
                data_source.setup_dropdown(this.querySelector(".search-type-button"), [{
                    create_options: { label: "All",             dataset: { default: true } },
                    setup_options: {
                        url_format,
                        fields: {"/type": "artworks", type: null},
                    }
                }, {
                    create_options: { label: "Illustrations" },
                    setup_options: {
                        url_format,
                        fields: {"/type": "illustrations", type: "illust"},
                    }
                }, {
                    create_options: { label: "Manga" },
                    setup_options: {
                        url_format,
                        fields: {"/type": "manga", type: null},
                    }
                }, {
                    create_options: { label: "Animations" },
                    setup_options: {
                        url_format,
                        fields: {"/type": "illustrations", type: "ugoira"},
                    }
                }]);

                data_source.setup_dropdown(this.querySelector(".search-mode-button"), [{
                    create_options: { label: "Tag",               dataset: { default: true } },
                    setup_options: { fields: {s_mode: null}, default_values: {s_mode: "s_tag"} },
                }, {
                    create_options: { label: "Exact tag match" },
                    setup_options:  { fields: {s_mode: "s_tag_full"} },
                }, {
                    create_options: { label: "Text search" },
                    setup_options:  { fields: {s_mode: "s_tc"} },
                }]);

                data_source.setup_dropdown(this.querySelector(".image-size-button"), [{
                    create_options: { label: "All",               dataset: { default: true } },
                    setup_options: { fields: {wlt: null, hlt: null, wgt: null, hgt: null} },
                }, {
                    create_options: { label: "High-res" },
                    setup_options: { fields: {wlt: 3000, hlt: 3000, wgt: null, hgt: null} },
                }, {
                    create_options: { label: "Medium-res" },
                    setup_options: { fields: {wlt: 1000, hlt: 1000, wgt: 2999, hgt: 2999} },
                }, {
                    create_options: { label: "Low-res" },
                    setup_options: { fields: {wlt: null, hlt: null, wgt: 999, hgt: 999} },
                }]);

                data_source.setup_dropdown(this.querySelector(".aspect-ratio-button"), [{
                    create_options: {label: "All",               icon: "", dataset: { default: true } },
                    setup_options: { fields: {ratio: null} },
                }, {
                    create_options: {label: "Landscape",         icon: "panorama" },
                    setup_options: { fields: {ratio: "0.5"} },
                }, {
                    create_options: {label: "Portrait",          icon: "portrait" },
                    setup_options: { fields: {ratio: "-0.5"} },
                }, {
                    create_options: {label: "Square",            icon: "crop_square" },
                    setup_options: { fields: {ratio: "0"} },
                }]);

                // The Pixiv search form shows 300-499, 500-999 and 1000-.  That's not
                // really useful and the query parameters let us filter differently, so we
                // replace it with a more useful "minimum bookmarks" filter.
                data_source.setup_dropdown(this.querySelector(".bookmark-count-button"), [{
                    create_options: { label: "All",               data_type: "bookmarks-all",    dataset: { default: true } },
                    setup_options: { fields: {blt: null, bgt: null} },
                }, {
                    create_options: { label: "100+",              data_type: "bookmarks-100" },
                    setup_options: { fields: {blt: 100, bgt: null} },
                }, {
                    create_options: { label: "250+",              data_type: "bookmarks-250" },
                    setup_options: { fields: {blt: 250, bgt: null} },
                }, {
                    create_options: { label: "500+",              data_type: "bookmarks-500" },
                    setup_options: { fields: {blt: 500, bgt: null} },
                }, {
                    create_options: { label: "1000+",             data_type: "bookmarks-1000" },
                    setup_options: { fields: {blt: 1000, bgt: null} },
                }, {
                    create_options: { label: "2500+",             data_type: "bookmarks-2500" },
                    setup_options: { fields: {blt: 2500, bgt: null} },
                }, {
                    create_options: { label: "5000+",             data_type: "bookmarks-5000" },
                    setup_options: { fields: {blt: 5000, bgt: null} },
                }]);

                // The time-ago dropdown has a custom layout, so create it manually.
                new ppixiv.dropdown_menu_opener({
                    button: this.querySelector(".time-ago-button"),
                    create_box: ({...options}) => {
                        let dropdown = new ppixiv.widget({
                            ...options,
                            template: `
                                <div class=vertical-list>
                                    ${ helpers.create_box_link({label: "All",               data_type: "time-all",  dataset: { default: true } }) }
                                    ${ helpers.create_box_link({label: "This week",         data_type: "time-week", dataset: { shortLabel: "Weekly" } }) }
                                    ${ helpers.create_box_link({label: "This month",        data_type: "time-month" }) }
                                    ${ helpers.create_box_link({label: "This year",         data_type: "time-year" }) }

                                    <div class=years-ago>
                                        ${ helpers.create_box_link({label: "1",             data_type: "time-years-ago-1", dataset: { shortLabel: "1 year" } }) }
                                        ${ helpers.create_box_link({label: "2",             data_type: "time-years-ago-2", dataset: { shortLabel: "2 years" } }) }
                                        ${ helpers.create_box_link({label: "3",             data_type: "time-years-ago-3", dataset: { shortLabel: "3 years" } }) }
                                        ${ helpers.create_box_link({label: "4",             data_type: "time-years-ago-4", dataset: { shortLabel: "4 years" } }) }
                                        ${ helpers.create_box_link({label: "5",             data_type: "time-years-ago-5", dataset: { shortLabel: "5 years" } }) }
                                        ${ helpers.create_box_link({label: "6",             data_type: "time-years-ago-6", dataset: { shortLabel: "6 years" } }) }
                                        ${ helpers.create_box_link({label: "7",             data_type: "time-years-ago-7", dataset: { shortLabel: "7 years" } }) }
                                        <span>years ago</span>
                                    </div>
                                </div>
                            `,
                        });

                        // The time filter is a range, but I'm not sure what time zone it filters in
                        // (presumably either JST or UTC).  There's also only a date and not a time,
                        // which means you can't actually filter "today", since there's no way to specify
                        // which "today" you mean.  So, we offer filtering starting at "this week",
                        // and you can just use the default date sort if you want to see new posts.
                        // For "this week", we set the end date a day in the future to make sure we
                        // don't filter out posts today.
                        data_source.set_item(dropdown, { type: "time-all", fields: {scd: null, ecd: null} });

                        let format_date = (date) =>
                        {
                            return (date.getYear() + 1900).toFixed().padStart(2, "0") + "-" +
                                    (date.getMonth() + 1).toFixed().padStart(2, "0") + "-" +
                                    date.getDate().toFixed().padStart(2, "0");
                        };

                        let set_date_filter = (name, start, end) =>
                        {
                            let start_date = format_date(start);
                            let end_date = format_date(end);
                            data_source.set_item(dropdown, { type: name, fields: {scd: start_date, ecd: end_date} });
                        };

                        let tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
                        let last_week = new Date(); last_week.setDate(last_week.getDate() - 7);
                        let last_month = new Date(); last_month.setMonth(last_month.getMonth() - 1);
                        let last_year = new Date(); last_year.setFullYear(last_year.getFullYear() - 1);
                        set_date_filter("time-week", last_week, tomorrow);
                        set_date_filter("time-month", last_month, tomorrow);
                        set_date_filter("time-year", last_year, tomorrow);
                        for(let years_ago = 1; years_ago <= 7; ++years_ago)
                        {
                            let start_year = new Date(); start_year.setFullYear(start_year.getFullYear() - years_ago - 1);
                            let end_year = new Date(); end_year.setFullYear(end_year.getFullYear() - years_ago);
                            set_date_filter("time-years-ago-" + years_ago, start_year, end_year);
                        }

                        // The "reset search" button removes everything in the query except search terms, and resets
                        // the search type.
                        let box = this.querySelector(".reset-search");
                        let url = new URL(this.data_source.url);
                        let tag = helpers._get_search_tags_from_url(url);
                        url.search = "";
                        if(tag == null)
                            url.pathname = "/tags";
                        else
                            url.pathname = "/tags/" + encodeURIComponent(tag) + "/artworks";
                        box.href = url;

                        return dropdown;
                    },
                });

                // Create the tag dropdown for the search page input.
                this.tag_search_box = new tag_search_box_widget({ container: this.querySelector(".tag-search-box-container") });

                // Fill the search box with the current tag.
                //
                // Add a space to the end, so another tag can be typed immediately after focusing an existing search.
                let search = this.data_source._search_tags;
                if(search)
                    search += " ";
                this.querySelector(".tag-search-box .input-field-container > input").value = search;
            }
        }
    }
};

ppixiv.data_sources.follows = class extends data_source
{
    get name() { return "following"; }
    get can_return_manga() { return false; }
  
    constructor(url)
    {
        super(url);

        this.follow_tags = [];
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
        this.user_info = await user_cache.get_user_info_full(this.viewing_user_id);

        // Update to refresh our page title, which uses user_info.
        this.call_update_listeners();

        var query_args = this.url.searchParams;
        var rest = query_args.get("rest") || "show";
        let acceptingRequests = query_args.get("acceptingRequests") || "0";

        var url = "/ajax/user/" + this.viewing_user_id + "/following";
        let args = {
            offset: this.estimated_items_per_page*(page-1),
            limit: this.estimated_items_per_page,
            rest: rest,
            acceptingRequests,
        };
        if(query_args.get("tag"))
            args.tag = query_args.get("tag");
        let result = await helpers.get_request(url, args);

        // Store following tags.
        this.follow_tags = result.body.followUserTags;
        this.follow_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.dispatchEvent(new Event("_refresh_ui"));

        // Make a list of the first illustration for each user.
        var illusts = [];
        for(let followed_user of result.body.users)
        {
            if(followed_user == null)
                continue;

            // Register this as quick user data, for use in thumbnails.
            extra_cache.singleton().add_quick_user_data(followed_user, "following");

            // XXX: user:user_id
            if(!followed_user.illusts.length)
            {
                console.log("Can't show followed user that has no posts:", followed_user.userId);
                continue;
            }

            let illust = followed_user.illusts[0];
            illusts.push(illust);

            // We'll register this with media_info below.  These results don't have profileImageUrl
            // and only put it in the enclosing user, so copy it over.
            illust.profileImageUrl = followed_user.profileImageUrl;
        }

        var media_ids = [];
        for(let illust of illusts)
            media_ids.push("user:" + illust.userId);

        await media_cache.add_media_infos_partial(illusts, "normal");

        // Register the new page of data.
        this.add_page(page, media_ids);
    }

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class=box-button-row>
                            <div class=box-button-row>
                                <vv-container class=follows-public-private style="margin-right: 25px;">
                                    ${ helpers.create_box_link({label: "Public",    popup: "Show publically followed users",   data_type: "public-follows" }) }
                                    ${ helpers.create_box_link({label: "Private",    popup: "Show privately followed users",   data_type: "private-follows" }) }
                                </vv-container>

                                ${ helpers.create_box_link({ popup: "Accepting requests", icon: "paid",   data_type: "accepting-requests" }) }
                            </div>

                            ${ helpers.create_box_link({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["follow-tags-button", "premium-only"] }) }
                        </div>
                    </div>
                `});

                this.data_source = data_source;

                // The public/private button only makes sense when viewing your own follows.
                let public_private_button_container = this.querySelector(".follows-public-private");
                public_private_button_container.hidden = !data_source.viewing_self;

                data_source.set_item(this.container, { type: "public-follows", fields: {rest: "show"}, default_values: {rest: "show"} });
                data_source.set_item(this.container, { type: "private-follows", fields: {rest: "hide"}, default_values: {rest: "show"} });
                data_source.set_item(this.container, { type: "accepting-requests", toggle: true, fields: {acceptingRequests: "1"}, default_values: {acceptingRequests: "0"}});

                class follow_tag_dropdown extends ppixiv.widget
                {
                    constructor()
                    {
                        super({
                            ...options,
                            template: `<div class="follow-tag-list vertical-list"></div>`,
                        });

                        data_source.addEventListener("_refresh_ui", () => this.refresh_following_tags(), this._signal);
                        this.refresh_following_tags();
                    }

                    refresh_following_tags()
                    {
                        let current_args = helpers.args.location;
        
                        let tag_list = this.container;
                        for(let tag of tag_list.querySelectorAll(".tag-entry"))
                            tag.remove();
        
                        // Refresh the bookmark tag list.  Remove the page number from these buttons.
                        let current_tag = data_source.url.searchParams.get("tag") || "All tags";
        
                        let add_tag_link = (tag) =>
                        {
                            // Work around Pixiv always returning a follow tag named "null" for some users.
                            if(tag == "null")
                                return;
        
                            let a = helpers.create_box_link({
                                label: tag,
                                classes: ["tag-entry"],
                                link: "#",
                                as_element: true,
                                data_type: "following-tag",
                            });
        
                            if(tag == "All tags")
                            {
                                tag = null;
                                a.dataset.default = 1;
                            }
        
                            data_source.set_item(a, { fields: {"tag": tag}, current_url: current_args.url });
        
                            tag_list.appendChild(a);
                        };
        
                        add_tag_link("All tags");
                        for(let tag of data_source.follow_tags)
                            add_tag_link(tag);
        
                        // If we don't have the tag list yet because we're still loading the page, fill in
                        // the current tag, to reduce flicker as the page loads.
                        if(data_source.follow_tags.length == 0 && current_tag != "All tags")
                            add_tag_link(current_tag);
                    }
                }
                // Create the follow tag dropdown.
                new ppixiv.dropdown_menu_opener({
                    button: this.querySelector(".follow-tags-button"),
                    create_box: ({...options}) => new follow_tag_dropdown({data_source, ...options}),
                });
            }
        }
    }

    get ui_info()
    {
        return {
            user_id: this.viewing_self? null:this.viewing_user_id,
        }
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
    get can_return_manga() { return false; }
  
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
        let media_id = helpers.illust_id_to_media_id(illust_id)
        this.illust_info = await media_cache.get_media_info(media_id);
        this.call_update_listeners();

        return super.load_page_internal(page);
    }

    // Parse the loaded document and return the illust_ids.
    parse_document(doc)
    {
        var ids = [];
        for(var element of doc.querySelectorAll("li.bookmark-item a[data-user_id]"))
        {
            // Register this as quick user data, for use in thumbnails.
            extra_cache.singleton().add_quick_user_data({
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

    get ui_info()
    {
        let image_url = null;
        let image_link_url = null;
        if(this.illust_info)
        {
            image_link_url = `/artworks/${this.illust_info.id}#ppixiv`;
            image_url = this.illust_info.previewUrls[0];
        }

        return { image_url, image_link_url };
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
    get can_return_manga() { return false; }
  
    parse_document(doc)
    {
        var illust_ids = [];
        for(let item of doc.querySelectorAll(".user-recommendation-items .user-recommendation-item"))
        {
            let username = item.querySelector(".title").innerText;
            let user_id = item.querySelector(".follow").dataset.id;
            let profile_image = item.querySelector("._user-icon").dataset.src;

            extra_cache.singleton().add_quick_user_data({
                user_id: user_id,
                user_name: username,
                profile_img: profile_image,
            }, "user_search");

            illust_ids.push("user:" + user_id);
        }
        return illust_ids;
    }

    get username()
    {
        return this.url.searchParams.get("nick");
    }

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div class="search-box">
                        <div class="user-search-box input-field-container hover-menu-box">
                            <input class=search-users placeholder="Search users">
                            <span class="search-submit-button right-side-button">
                                ${ helpers.create_icon("search") }
                            </span>
                        </div>
                    </div>
                `});

                this.data_source = data_source;

                this.querySelector(".user-search-box .search-submit-button").addEventListener("click", this.submit_user_search);
                helpers.input_handler(this.querySelector(".user-search-box input.search-users"), this.submit_user_search);

                this.querySelector(".search-users").value = data_source.username;
            }

            // Handle submitting searches on the user search page.
            submit_user_search = (e) =>
            {
                let search = this.querySelector(".user-search-box input.search-users").value;
                let url = new URL("/search_user.php#ppixiv", ppixiv.plocation);
                url.searchParams.append("nick", search);
                url.searchParams.append("s_mode", "s_usr");
                helpers.navigate(url);
            }
        }
    }
    
    get no_results()
    {
        // Don't display "No Results" while we're still waiting for the user to enter a search.
        if(!this.username)
            return false;

        return super.no_results;
    }

    get page_title()
    {
        let search = this.username;
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

ppixiv.data_sources.completed_requests = class extends data_source
{
    get name() { return "completed-requests"; }
  
    get supports_start_page()
    {
        return true;
    }

    async load_page_internal(page)
    {
        let args = new helpers.args(new URL(this.url));
        let showing = args.get("type") || "latest"; // "latest" or "recommended"
        let mode = args.get("mode") || "all";
        let type = args.get_pathname_segment(2); // "illust" in "request/complete/illust"

        let url = `/ajax/commission/page/request/complete/${type}`;
        let request_args = {
            "mode": mode,
            "p": page,
            "lang": "en",
        };
        let result = await helpers.get_request(url, request_args);

        // Convert the request data from an array to a dictionary.
        let request_data = {};
        for(let request of result.body.requests)
            request_data[request.requestId] = request;
        
        for(let user of result.body.users)
            user_cache.add_user_data(user);

        await media_cache.add_media_infos_partial(result.body.thumbnails.illust, "normal");
        tag_translations.get().add_translations_dict(result.body.tagTranslation);

        let media_ids = [];
        let request_ids = result.body.page[showing == "latest"? "requestIds":"recommendRequestIds"];
        if(request_ids == null)
            return;

        for(let request_id of request_ids)
        {
            // This has info for the request, like the requester and request text, but we just show these
            // as regular posts.
            let request = request_data[request_id];
            let request_post_id = request.postWork.postWorkId;
            let media_id = helpers.illust_id_to_media_id(request_post_id);

            // This returns a lot of post IDs that don't exist.  Why are people deleting so many of these?
            // Check whether the post was in result.body.thumbnails.illust.
            if(media_cache.get_media_info_sync(media_id, { full: false }) == null)
                continue;

            media_ids.push(media_id);
        }

        // Register the new page of data.
        this.add_page(page, media_ids);
    }

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class="box-button-row">
                            <div style="margin-right: 25px;">
                                ${ helpers.create_box_link({label: "Latest",        popup: "Show latest completed requests",       data_type: "completed-requests-latest" }) }
                                ${ helpers.create_box_link({label: "Recommended",   popup: "Show recommmended completed requests", data_type: "completed-requests-recommended" }) }
                            </div>

                            <div style="margin-right: 25px;">
                                ${ helpers.create_box_link({label: "Illustrations", popup: "Show latest completed requests",       data_type: "completed-requests-illust" }) }
                                ${ helpers.create_box_link({label: "Animations",    popup: "Show animations only",                 data_type: "completed-requests-ugoira" }) }
                                ${ helpers.create_box_link({label: "Manga",         popup: "Show manga only",                      data_type: "completed-requests-manga" }) }
                            </div>

                            <div>
                                ${ helpers.create_box_link({label: "All",           popup: "Show all works",                       data_type: "completed-requests-all" }) }
                                ${ helpers.create_box_link({label: "All ages",      popup: "Show all-ages works",                  data_type: "completed-requests-safe" }) }
                                ${ helpers.create_box_link({label: "R18",           popup: "Show R18 works",                       data_type: "completed-requests-r18", classes: ["r18"] }) }
                            </div>
                        </div>
                    </div>
                `});

                data_source.set_item(this.container, { type: "completed-requests-latest", fields: {type: "latest"}, default_values: {type: "latest"}});
                data_source.set_item(this.container, { type: "completed-requests-recommended", fields: {type: "recommended"}, default_values: {type: "latest"}});
        
                data_source.set_item(this.container, { type: "completed-requests-all", fields: {mode: "all"}, default_values: {mode: "all"}});
                data_source.set_item(this.container, { type: "completed-requests-safe", fields: {mode: "safe"}, default_values: {mode: "all"}});
                data_source.set_item(this.container, { type: "completed-requests-r18", fields: {mode: "r18"}, default_values: {mode: "all"}});
        
                let url_format = "request/complete/type";
                data_source.set_item(this.container, { url_format: url_format, type: "completed-requests-illust", fields: {"/type": "illust"} });
                data_source.set_item(this.container, { url_format: url_format, type: "completed-requests-ugoira", fields: {"/type": "ugoira"} });
                data_source.set_item(this.container, { url_format: url_format, type: "completed-requests-manga", fields: {"/type": "manga"} });
            }
        }
    }

    get page_title() { return "Completed requests"; };
    get_displaying_text() { return "Completed requests"; }
}

// https://www.pixiv.net/en/#ppixiv/edits
// View images that have edits on them
//
// This views all images that the user has saved crops, etc. for.  This isn't currently
// shown in the UI.
ppixiv.data_sources.edited_images = class extends data_source_fake_pagination
{
    get name() { return "edited"; }
    get includes_manga_pages() { return true; }

    async load_all_results()
    {
        return await ppixiv.extra_image_data.get.get_all_edited_images();
    };

    get page_title() { return "Edited"; }
    get_displaying_text() { return "Edited Images"; }
}

ppixiv.data_sources.vview = class extends data_source
{
    get name() { return "vview"; }
    get is_vview() { return true; }
    get can_return_manga() { return false; }

    constructor(url)
    {
        super(url);

        this.reached_end = false;
        this.prev_page_uuid = null;
        this.next_page_uuid = null;
        this.next_page_offset = null;
        this.bookmark_tag_counts = null;
        this._all_pages_loaded = false;

        this.load_page(this.initial_page, { cause: "preload" });
    }

    get supports_start_page() { return true; }

    // If we've loaded all pages, this is true to let the context menu know it
    // should display page numbers.
    get all_pages_loaded() { return this._all_pages_loaded; }

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
            console.error(`Loaded unexpected page ${page} (${lowest_page}...${highest_page})`);
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

        let order = args.hash.get("order");

        // If we have no search options, we're viewing a single directory.  Load the whole
        // ID list with /ids.  This only returns media IDs, but returns the entire directory,
        // and we can register the whole thing as one big page.  This lets us handle local
        // files better: if you load a random file in a big directory and then back out to
        // the search, we can show the file you were on instead of going back to the top.
        // screen_search will load media info as needed when they're actually displayed.
        //
        // If we have access restrictions (eg. we're guest and can only access certain tags),
        // this API is disabled, since all listings are bookmark searches.
        if(search_options == null && !local_api.local_info.bookmark_tag_searches_only)
        {
            console.log("Loading folder contents:", folder_id);
            let result_ids = await local_api.local_post_request(`/api/ids/${folder_id}`, {
                ...search_options,
                ids_only: true,

                order: args.hash.get("order"),
            });
            if(!result_ids.success)
            {
                message_widget.singleton.show("Error reading directory: " + result_ids.reason);
                return;
            }
    
            this.reached_end = true;
            this._all_pages_loaded = true;            
            this.add_page(page, result_ids.ids);
            return;
        }

        // Note that this registers the results with media_info automatically.
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

        let found_media_ids = [];
        for(let thumb of result.results)
            found_media_ids.push(thumb.mediaId);

        this.add_page(page, found_media_ids);
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

    get_displaying_text()
    {
        let args = new helpers.args(this.url);
        return local_api.get_search_options_for_args(args).title;
    }

    // Put the illust ID in the hash instead of the path.  Pixiv doesn't care about this,
    // and this avoids sending the user's filenames to their server as 404s.
    set_current_media_id(media_id, args)
    {
        local_api.get_args_for_id(media_id, args);
    }

    get_media_id_from_url(args)
    {
        // If the URL points to a file, return it.  If no image is being viewed this will give
        // the folder we're in, which shouldn't be returned here.
        let illust_id = local_api.get_local_id_from_args(args);
        if(illust_id == null || !illust_id.startsWith("file:"))
            return null;
        return illust_id;
    }

    get_current_media_id(args)
    {
        return this.get_media_id_from_url(args) ?? this.id_list.get_first_id();
    }

    // more streamlined but harder to get access to ourself
    // XXX
    xxxcreate_ui = ({ data_source, ...options }) => new class extends ppixiv.widget
    {
    };

    get ui()
    {
        return class extends ppixiv.widget
        {
            constructor({data_source, ...options})
            {
                super({ ...options, data_source, template: `
                    <div>
                        <div class="search-box local-tag-search-box">
                            <div class="input-field-container hover-menu-box">
                                <input placeholder="Search files">

                                <span class="clear-local-search-button right-side-button">
                                    ${ helpers.create_icon("clear") }
                                </span>

                                <span class="submit-local-search-button right-side-button">
                                    ${ helpers.create_icon("search") }
                                </span>
                            </div>
                        </div>

                        <div class="box-button-row">
                            <span class="popup icon-button copy-local-path" data-popup="Copy local path to clipboard">
                                ${ helpers.create_icon("content_copy") }
                            </span>

                            ${ helpers.create_box_link({popup: "Close search", icon: "exit_to_app",  classes: ["clear-local-search"] }) }
                            ${ helpers.create_box_link({label: "Bookmarks",           popup: "Show bookmarks",                       data_type: "local-bookmarks-only" }) }

                            <div class=local-bookmark-tags-box>
                                ${ helpers.create_box_link({label: "Tags",    icon: "ppixiv:tag", classes: ["bookmark-tags-button"] }) }
                            </div>

                            ${ helpers.create_box_link({ label: "Type",          classes: ["file-type-button"] }) }
                            ${ helpers.create_box_link({ label: "Aspect ratio",  classes: ["aspect-ratio-button"] }) }
                            ${ helpers.create_box_link({ label: "Image size",    classes: ["image-size-button"] }) }
                            ${ helpers.create_box_link({ label: "Order",         classes: ["sort-button"] }) }
                        </div>
                    </div>
                `});

                this.data_source = data_source;

                // The search history dropdown for local searches.
                new local_search_box_widget({ contents: this.querySelector(".local-tag-search-box") });
        
                let current_args = helpers.args.location;

                data_source.setup_dropdown(this.querySelector(".file-type-button"), [{
                    create_options: { label: "All",           data_type: "local-type-all", dataset: { default: "1"} },
                    setup_options: { fields: {"#type": null}, current_url: current_args.url },
                }, {
                    create_options: { label: "Videos",        data_type: "local-type-videos" },
                    setup_options: { fields: {"#type": "videos"}, current_url: current_args.url },
                }, {
                    create_options: { label: "Images",        data_type: "local-type-images" },
                    setup_options: { fields: {"#type": "images"}, current_url: current_args.url },
                }]);

                data_source.setup_dropdown(this.querySelector(".aspect-ratio-button"), [{
                    create_options: { label: "All",           data_type: "local-aspect-ratio-all", dataset: { default: "1"} },
                    setup_options: { fields: {"#aspect-ratio": null}, current_url: current_args.url },
                }, {
                    create_options: { label: "Landscape",     data_type: "local-aspect-ratio-landscape" },
                    setup_options: { fields: {"#aspect-ratio": `3:2...`}, current_url: current_args.url },
                }, {
                    create_options: { label: "Portrait",      data_type: "local-aspect-ratio-portrait" },
                    setup_options: { fields: {"#aspect-ratio": `...2:3`}, current_url: current_args.url },
                }]);

                data_source.setup_dropdown(this.querySelector(".image-size-button"), [{
                    create_options: { label: "All",           dataset: { default: "1"} },
                    setup_options: { fields: {"#pixels": null}, current_url: current_args.url },
                }, {
                    create_options: { label: "High-res" },
                    setup_options: { fields: {"#pixels": "4000000..."}, current_url: current_args.url },
                }, {
                    create_options: { label: "Medium-res" },
                    setup_options: { fields: {"#pixels": "1000000...3999999"}, current_url: current_args.url },
                }, {
                    create_options: { label: "Low-res" },
                    setup_options: { fields: {"#pixels": "...999999"}, current_url: current_args.url },
                }]);

                data_source.setup_dropdown(this.querySelector(".sort-button"), [{
                    create_options: { label: "Name",           dataset: { default: "1"} },
                    setup_options: { fields: {"#order": null}, current_url: current_args.url },
                }, {
                    create_options: { label: "Name (inverse)" },
                    setup_options: { fields: {"#order": "-normal"}, current_url: current_args.url },
                }, {
                    create_options: { label: "Newest" },
                    setup_options: { fields: {"#order": "-ctime"}, current_url: current_args.url },

                }, {
                    create_options: { label: "Oldest" },
                    setup_options: { fields: {"#order": "ctime"}, current_url: current_args.url },

                }, {
                    create_options: { label: "New bookmarks" },
                    setup_options: { fields: {"#order": "bookmarked-at"}, current_url: current_args.url,
                        // If a bookmark sort is selected, also enable viewing bookmarks.
                        adjust_url: (args) => args.hash.set("bookmarks", 1),
                    },
                }, {
                    create_options: { label: "Old bookmarks" },
                    setup_options: { fields: {"#order": "-bookmarked-at"}, current_url: current_args.url,
                        adjust_url: (args) => args.hash.set("bookmarks", 1),
                    },
                }, {
                    create_options: { label: "Shuffle", icon: "shuffle" },
                    setup_options: { fields: {"#order": "shuffle"}, toggle: true, current_url: current_args.url },
                }]);

                class bookmark_tag_dropdown extends tag_dropdown_widget
                {
                    refresh_tags()
                    {
                        // Clear the tag list.
                        for(let tag of this.container.querySelectorAll(".following-tag"))
                            tag.remove();

                        // Stop if we don't have the tag list yet.
                        if(this.data_source.bookmark_tag_counts == null)
                            return;

                        this.add_tag_link(null); // All
                        this.add_tag_link(""); // Uncategorized

                        let all_tags = Object.keys(this.data_source.bookmark_tag_counts);
                        all_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
                        for(let tag of all_tags)
                        {
                            // Skip uncategorized, which is always placed at the beginning.
                            if(tag == "")
                                continue;

                            if(this.data_source.bookmark_tag_counts[tag] == 0)
                                continue;

                            this.add_tag_link(tag);
                        }
                    }

                    add_tag_link(tag)
                    {
                        let current_args = helpers.args.location;

                        let tag_count = this.data_source.bookmark_tag_counts[tag];

                        let tag_name = tag;
                        if(tag_name == null)
                            tag_name = "All bookmarks";
                        else if(tag_name == "")
                            tag_name = "Untagged";

                        // Show the bookmark count in the popup.
                        let popup = null;
                        if(tag_count != null)
                            popup = tag_count + (tag_count == 1? " bookmark":" bookmarks");

                        let a = helpers.create_box_link({
                            label: tag_name,
                            classes: ["following-tag"],
                            data_type: "following-tag",
                            popup,
                            link: "#",
                            as_element: true,
                        });
                        if(tag_name == "All bookmarks")
                            a.dataset.default = 1;

                            this.data_source.set_item(a, {
                            fields: {"#bookmark-tag": tag},
                            current_url: current_args.url,
                        });

                        this.container.appendChild(a);
                    }
                }

                this.tag_dropdown = new ppixiv.dropdown_menu_opener({
                    button: this.querySelector(".bookmark-tags-button"),
                    create_box: ({...options}) => new bookmark_tag_dropdown({ data_source, ...options }),
                });

                // Hide the bookmark box if we're not showing bookmarks.
                this.querySelector(".local-bookmark-tags-box").hidden = !data_source.bookmark_search_active;

                data_source.addEventListener("_refresh_ui", () => {
                    // Refresh the displayed label in case we didn't have it when we created the widget.
                    this.tag_dropdown.set_button_popup_highlight();
                }, this._signal);

                let clear_local_search_button = this.querySelector(".clear-local-search");
                clear_local_search_button.addEventListener("click", (e) => {
                    // Get the URL for the current folder and set it to a new URL, so it removes search
                    // parameters.
                    let media_id = local_api.get_local_id_from_args(helpers.args.location, { get_folder: true });
                    let args = new helpers.args("/", ppixiv.plocation);
                    local_api.get_args_for_id(media_id, args);
                    helpers.navigate(args);
                });

                let search_active = local_api.get_search_options_for_args(helpers.args.location).search_options != null;
                helpers.set_class(clear_local_search_button, "disabled", !search_active);

                this.querySelector(".copy-local-path").addEventListener("click", (e) => {
                    this.copy_link();
                });

                // Hide the "copy local path" button if we don't have one.
                this.querySelector(".copy-local-path").hidden = data_source.local_path == null;

                data_source.set_item(this.container, { type: "local-bookmarks-only", fields: {"#bookmarks": "1"}, toggle: true, current_url: current_args.url,
                    adjust_url: (args) => {
                        // If the button is exiting bookmarks, remove bookmark-tag too.
                        if(!args.hash.has("bookmarks"))
                            args.hash.delete("bookmark-tag");
                    }
                });

                // If we're only allowed to do bookmark searches, hide the bookmark search button.
                this.querySelector('[data-type="local-bookmarks-only"]').hidden = local_api.local_info.bookmark_tag_searches_only;
            }
        }
    }

    // We're doing a bookmark search if the bookmark filter is enabled, or if
    // we're restricted to listing tagged bookmarks.
    get bookmark_search_active()
    {
        return helpers.args.location.hash.has("bookmarks") || local_api.local_info.bookmark_tag_searches_only;
    }

    async fetch_bookmark_tag_counts()
    {
        if(this.fetched_bookmark_tag_counts)
            return;
        this.fetched_bookmark_tag_counts = true;

        // We don't need to do this if we're not showing bookmarks.
        if(!this.bookmark_search_active)
            return;

        let result = await local_api.local_post_request(`/api/bookmark/tags`);
        if(!result.success)
        {
            console.log("Error fetching bookmark tag counts");
            return;
        }

        this.bookmark_tag_counts = result.tags;
        this.dispatchEvent(new Event("_refresh_ui"));
    }

    copy_link()
    {
        // The user clicked the "copy local link" button.
        navigator.clipboard.writeText(this.local_path);
    }
}

ppixiv.data_sources.vview_similar = class extends data_source
{
    get name() { return "similar"; }
    get is_vview() { return true; }
    get can_return_manga() { return false; }

    async load_page_internal(page)
    {
        if(page != 1)
            return;

        // We can be given a local path or a URL to an image to search for.
        let args = new helpers.args(this.url);
        let path = args.hash.get("search_path");
        let url = args.hash.get("search_url");

        let result = await local_api.local_post_request(`/api/similar/search`, {
            path,
            url,
            max_results: 10,
        });

        if(!result.success)
        {
            message_widget.singleton.show("Error reading search: " + result.reason);
            return result;
        }

        // This is a URL to the original image we're searching for.
        this.source_url = result.source_url;
        this.call_update_listeners();

        let media_ids = [];
        for(let item of result.results)
        {
            // console.log(item.score);

            // Register the results with media_cache.
            let entry = item.entry;
            ppixiv.local_api.adjust_illust_info(entry);
            await media_cache.add_media_info_full(entry, { preprocessed: true });

            media_ids.push(entry.mediaId);
        }

        this.add_page(page, media_ids);
    };

    // We only load one page of results.
    can_load_page(page)
    {
        return page == 1;
    }

    get page_title() { return this.get_displaying_text(); }

    set_page_icon()
    {
        helpers.set_icon({vview: true});
    }

    get_displaying_text()
    {
        return `Similar images`;
    }

    get ui_info()
    {
        let image_url = null;
        let image_link_url = null;
        if(this.source_url)
        {
            image_url = this.source_url;

            // If this is a search for a local path, link to the image.
            let args = new helpers.args(this.url);
            let path = args.hash.get("search_path");
            if(path)
            {
                let media_id = helpers.encode_media_id({type: "file", id: path});
                let link_args = helpers.get_url_for_id(media_id);
                image_link_url = link_args;
            }
        }

        return { image_url, image_link_url };
    }
}

