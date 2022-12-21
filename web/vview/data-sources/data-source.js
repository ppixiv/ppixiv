import Widget from 'vview/widgets/widget.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import IllustIdList from 'vview/data-sources/illust-id-list.js';
import { helpers } from 'vview/ppixiv-imports.js';

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
export default class DataSource extends EventTarget
{
    constructor(url)
    {
        super();

        this.url = new URL(url);
        this.id_list = new IllustIdList();
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

    // Return this data source's URL as a helpers.args.
    get args()
    {
        return new helpers.args(this.url);        
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
        if(this.id_list.isPageLoaded(page))
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
        if(!this.id_list.anyPagesLoaded)
            return true;

        // If we've loaded pages 5-6, we can load anything between pages 5 and 7.
        let lowest_page = this.id_list.getLowestLoadedPage();
        let highest_page = this.id_list.getHighestLoadedPage();
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
        if(this.id_list.isPageLoaded(page))
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
        if(!this.id_list.mediaIdsByPage.has(page))
        {
            console.log("No data on page", page);
            if(this.first_empty_page == -1 || page < this.first_empty_page)
                this.first_empty_page = page;
        }
        else if(this.id_list.mediaIdsByPage.get(page).length == 0)
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
        let mediaId = this.get_media_id_from_url(args);
        if(mediaId)
            return mediaId;
         
        return this.id_list.getFirstId();
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
        return this.id_list.getFirstId() == null && !this.any_page_loading;
    }

    // This is implemented by the subclass.
    async load_page_internal(page)
    {
        throw "Not implemented";
    }

    // This is called when the currently displayed illust_id changes.  The illust_id should
    // always have been loaded by this data source, so it should be in id_list.  The data
    // source should update the history state to reflect the current state.
    set_current_media_id(mediaId, args)
    {
        let [illust_id] = helpers.media_id_to_illust_id_and_page(mediaId);
        if(this.supports_start_page)
        {
            // Store the page the illustration is on in the hash, so if the page is reloaded while
            // we're showing an illustration, we'll start on that page.  If we don't do this and
            // the user clicks something that came from page 6 while the top of the search results
            // were on page 5, we'll start the search at page 5 if the page is reloaded and not find
            // the image, which is confusing.
            let { page: original_page } = this.id_list.getPageForMediaId(illust_id);
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
    get viewingUserId()
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

        // If this data source doesn't return manga pages, always add the first page.
        if(!this.includes_manga_pages)
            initial_media_id = helpers.get_media_id_for_page(initial_media_id, 0);

        if(page == this.initial_page &&
            initial_media_id != null &&
            initial_media_id != "illust:*" && !ppixiv.local_api.is_slideshow_staging(helpers.args.location) && // not slideshow staging
            this.id_list.getPageForMediaId(initial_media_id).page == null &&
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
    //     imageUrl,                  // URL for an image related to this search
    //     imageLinkUrl,              // a URL where imageUrl should link to
    //     userId,                    // a user ID whose avatar should be displayed
    // }
    //
    // If this changes, the "updated" event will be sent to the data source.
    get uiInfo()
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
        return new DropdownMenuOpener({
            button,
            create_box: ({...options}) => {
                let dropdown = new Widget({
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
    set_item(link, {type=null, ...options}={})
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
        let args = new helpers.args(this.url);

        // Adjust the URL for this button.
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
            let this_value = value;
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
    async get_or_load_neighboring_media_id(mediaId, next, options={})
    {
        // See if it's already loaded.
        let newMediaId = this.id_list.getNeighboringMediaId(mediaId, next, options);
        if(newMediaId != null)
            return newMediaId;

        // We didn't have the new illustration, so we may need to load another page of search results.
        // See if we know which page mediaId is on.
        let page = mediaId != null? this.id_list.getPageForMediaId(mediaId).page:null;

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
            // If we don't know which page mediaId is on, start from initial_page.
            page = this.initial_page;
        }
        
        // Short circuit if we already know this is past the end.  This just avoids spamming
        // logs.
        if(this.is_page_past_end(page))
            return null;

        console.log("Loading the next page of results:", page);

        // The page shouldn't already be loaded.  Double-check to help prevent bugs that might
        // spam the server requesting the same page over and over.
        if(this.id_list.isPageLoaded(page))
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
        return this.id_list.getNeighboringMediaId(mediaId, next, options);
    }

    // Get the next or previous image to from_media_id.  If we're at the end, loop back
    // around to the other end.  options is the same as get_or_load_neighboring_media_id.
    async get_neighboring_media_id_with_loop(from_media_id, next, options={})
    {
        // See if we can keep moving in this direction.
        let mediaId = await this.get_or_load_neighboring_media_id(from_media_id, next, options);
        if(mediaId)
            return mediaId;

        // We're out of results in this direction.  If we're moving backwards, only loop
        // if we have all results.  Otherwise, we'll go to the last loaded image, but if
        // the user then navigates forwards, he'll just go to the next image instead of
        // where he came from, which is confusing.
        if(!next && !this.loaded_all_pages)
        {
            console.log("Not looping backwards since we don't have all pages");
            return null;
        }

        return next? this.id_list.getFirstId():this.id_list.getLastId();
    }
};

// This is a base class for data sources that work by loading a regular Pixiv page
// and scraping it.
//
// All of these work the same way.  We keep the current URL (ignoring the hash) synced up
// as a valid page URL that we can load.  If we change pages or other search options, we
// modify the URL appropriately.
export class DataSourceFromPage extends DataSource
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
        let url = new URL(this.url);

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
}

// This extends DataSource with local pagination.
//
// A few API calls just return all results as a big list of IDs.  We can handle loading
// them all at once, but it results in a very long scroll box, which makes scrolling
// awkward.  This artificially paginates the results.
export class DataSourceFakePagination extends DataSource
{
    async load_page_internal(page)
    {
        if(this.pages == null)
        {
            let media_ids = await this.load_all_results();
            this.pages = PaginateMediaIds(media_ids, this.estimated_items_per_page);
        }

        // Register this page.
        let media_ids = this.pages[page-1] || [];
        this.add_page(page, media_ids);
    }

    // Implemented by the subclass.  Load all results, and return the resulting IDs.
    async load_all_results()
    {
        throw "Not implemented";
    }
}

// Split a list of media IDs into pages.
//
// In general it's safe for a data source to return a lot of data, and the search view
// will handle incremental loading, but this can be used to split large results apart.
export function PaginateMediaIds(illust_ids, items_per_page)
{
    // Paginate the big list of results.
    let pages = [];
    let page = null;
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

// A helper widget for dropdown lists of tags which refreshes when the data source is updated.
export class TagDropdownWidget extends Widget
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
