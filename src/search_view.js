// JavaScript objects are ordered, but for some reason there's no way to actually manipulate
// the order, such as adding to the beginning.  We have to make a copy of the object, add
// our new entry, then add everything else.
function add_to_beginning(object, key, value)
{
    let result = {};
    result[key] = value;
    for(let [old_key, old_value] of Object.entries(object))
    {
        if(old_key != key)
            result[old_key] = old_value;
    }
    return result;
}

// Similar to add_to_beginning, this adds at the end.  Note that while add_to_beginning returns a
// new object, this edits the object in-place.  We need to be careful with this, but it avoids making
// a copy of the thumb dictionary every time we append to the end.  To make it clearer that this
// differs from add_to_beginning, this doesn't return the object.
function add_to_end(object, key, value)
{
    // Remove the key if it exists, so it's moved to the end.
    delete object[key];
    object[key] = value;
}

// The main thumbnail grid view.
ppixiv.search_view = class extends ppixiv.widget
{
    constructor({
        // This is called if we change the start page in the URL.
        onstartpagechanged,
        ...options})
    {
        super({...options,template: `
            <div class=search-view>
                <div class=no-results hidden>
                    <div class=message>No results</div>
                </div>

                <div class=load-previous-page hidden>
                    <div class=load-previous-buttons>
                        <a class="load-previous-button load-previous-page-link" href=#>
                            Load previous results
                        </a>
                    </div>
                </div>

                <div class=thumbnails data-context-menu-target></div>
            </div>
        `});

        this.onstartpagechanged = onstartpagechanged;

        // The node that scrolls to show thumbs.  This is normally the document itself.
        this.scroll_container = document.documentElement;
        this.thumbnail_box = this.container.querySelector(".thumbnails");
        this.load_previous_page_button = this.container.querySelector(".load-previous-page");

        // A dictionary of thumbs in the view, in the same order.  This makes iterating
        // existing thumbs faster than iterating the nodes.
        this.thumbs = {};

        this.expanded_media_ids = new Map();

        window.addEventListener("thumbnailsloaded", this.thumbs_loaded);
        window.addEventListener("focus", this.visible_thumbs_changed);

        // When a bookmark is modified, refresh the heart icon.
        image_data.singleton().illust_modified_callbacks.register(this.refresh_thumbnail);

        this.container.addEventListener("load", (e) => {
            if(e.target.classList.contains("thumb"))
                this.thumb_image_load_finished(e.target.closest(".thumbnail-box"), { cause: "onload" });
        }, { capture: true } );

        // Work around a browser bug: even though it's document.documentElement.scrollTop is
        // changing, it doesn't receive onscroll and we have to listen on window instead.
        window.addEventListener("scroll", (e) => {
            this.schedule_store_scroll_position();
        }, {
            passive: true,
        });
                
        // As an optimization, start loading image info on mousedown.  We don't navigate until click,
        // but this lets us start loading image info a bit earlier.
        this.thumbnail_box.addEventListener("mousedown", async (e) => {
            if(e.button != 0)
                return;

            var a = e.target.closest("a.thumbnail-link");
            if(a == null)
                return;

            if(a.dataset.mediaId == null)
                return;

            // Only do this for illustrations.
            let {type} = helpers.parse_media_id(a.dataset.mediaId);
            if(type != "illust")
                return;

            await image_data.singleton().get_media_info(a.dataset.mediaId);
        }, { capture: true });

        this.thumbnail_box.addEventListener("click", this.thumbnail_onclick);

        this.container.querySelector(".load-previous-page-link").addEventListener("click", (e) =>
        {
            e.preventDefault();
            e.stopImmediatePropagation();

            let page = this.data_source.id_list.get_lowest_loaded_page() - 1;
            console.debug(`Load previous page button pressed, loading page ${page}`);
            this.load_page(page);
        });

        // Handle quick view.
        new ppixiv.pointer_listener({
            element: this.thumbnail_box,
            button_mask: 0b1,
            callback: (e) => {
                if(!e.pressed)
                    return;

                let a = e.target.closest("A");
                if(a == null)
                    return;

                if(!settings.get("quick_view"))
                    return;

                // Activating on press would probably break navigation on touchpads, so only do
                // this for mouse events.
                if(e.pointerType != "mouse")
                    return;

                let { media_id } = main_controller.singleton.get_illust_at_element(e.target);
                if(media_id == null)
                    return;

                // Don't stopPropagation.  We want the illustration view to see the press too.
                e.preventDefault();
                // e.stopImmediatePropagation();

                main_controller.singleton.show_media(media_id, { add_to_history: true });
            },
        });

        // Create IntersectionObservers for thumbs that are completely onscreen, nearly onscreen (should
        // be preloaded), and farther off (but not so far they should be unloaded).
        this.intersection_observers = [];
        this.intersection_observers.push(new IntersectionObserver((entries) => {
            for(let entry of entries)
                helpers.set_dataset(entry.target.dataset, "fullyOnScreen", entry.isIntersecting);

            this.load_data_source_page();
            this.first_visible_thumbs_changed();
        }, {
            root: document,
            threshold: 1,
        }));
        
        this.intersection_observers.push(new IntersectionObserver((entries) => {
            for(let entry of entries)
                helpers.set_dataset(entry.target.dataset, "nearby", entry.isIntersecting);

            // Set up any thumbs that just came nearby, and see if we need to load more search results.
            this.refresh_images();
            this.set_visible_thumbs();
            this.load_data_source_page();
        }, {
            root: document,

            // This margin determines how far in advance we load the next page of results.
            rootMargin: "150%",
        }));

        this.intersection_observers.push(new IntersectionObserver((entries) => {
            for(let entry of entries)
                helpers.set_dataset(entry.target.dataset, "visible", entry.isIntersecting);
            
            this.visible_thumbs_changed();
        }, {
            root: document,
            rootMargin: "0%",
        }));
            
        settings.register_change_callback("thumbnail-size", this.update_from_settings);
        settings.register_change_callback("manga-thumbnail-size", this.update_from_settings);
        settings.register_change_callback("disable_thumbnail_zooming", this.update_from_settings);
        settings.register_change_callback("disable_thumbnail_panning", this.update_from_settings);
        settings.register_change_callback("expand_manga_thumbnails", this.update_from_settings);
        muting.singleton.addEventListener("mutes-changed", this.refresh_after_mute_change);

        this.update_from_settings();
    }

    update_from_settings = () =>
    {
        this.refresh_expanded_thumb_all();
        this.load_expanded_media_ids(); // in case expand_manga_thumbnails has changed
        this.set_visible_thumbs();
        this.refresh_images();

        helpers.set_class(document.body, "disable-thumbnail-zooming", settings.get("disable_thumbnail_zooming") || ppixiv.mobile);
    }

    get_thumbnail_for_media_id(media_id)
    {
        return this.thumbs[media_id];
    }

    get_first_visible_thumb()
    {
        // Find the first thumb that's fully onscreen.
        for(let element of Object.values(this.thumbs))
        {
            if(element.dataset.fullyOnScreen)
                return element;
        }

        return null;
    }

    // This is called as the user scrolls and different thumbs are fully onscreen,
    // to update the page URL.
    first_visible_thumbs_changed()
    {
        // Find the first thumb that's fully onscreen.  Ignore elements not specific to a page (load previous results).
        let first_thumb = this.get_first_visible_thumb();
        if(!first_thumb)
            return;

        // If the data source supports a start page, update the page number in the URL to reflect
        // the first visible thumb.
        if(this.data_source == null || !this.data_source.supports_start_page || first_thumb.dataset.searchPage == null)
            return;

        let args = helpers.args.location;
        this.data_source.set_start_page(args, first_thumb.dataset.searchPage);
        helpers.set_page_url(args, false, "viewing-page", { send_popstate: false });

        // Tell our parent that we changed the start page.
        if(this.onstartpagechanged)
            this.onstartpagechanged();
    }

    // The thumbs actually visible onscreen have changed, or the window has gained focus.
    // Store recently viewed thumbs.
    visible_thumbs_changed = () =>
    {
        if(!recently_seen_illusts.get().enabled)
            return;

        // Don't add recent illusts if we're viewing recent illusts.
        if(this.data_source && this.data_source.name == "recent")
            return;

        let visible_media_ids = [];
        for(let [media_id, element] of Object.entries(this.thumbs))
        {
            if(!element.dataset.visible)
                continue;
        
            let { type, id } = helpers.parse_media_id(media_id);
            if(type != "illust")
                continue;

            visible_media_ids.push(media_id);
        }
        
        ppixiv.recently_seen_illusts.get().add_illusts(visible_media_ids);
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        // Remove listeners from the old data source.
        if(this.data_source != null)
            this.data_source.remove_update_listener(this.data_source_updated);

        console.debug("Clearing thumbnails for new data source");

        // Clear the view when the data source changes.  If we leave old thumbs in the list,
        // it confuses things if we change the sort and refresh_thumbs tries to load thumbs
        // based on what's already loaded.
        while(this.thumbnail_box.firstElementChild != null)
        {
            let node = this.thumbnail_box.firstElementChild;
            node.remove();

            // We should be able to just remove the element and get a callback that it's no longer visible.
            // This works in Chrome since IntersectionObserver uses a weak ref, but Firefox is stupid and leaks
            // the node.
            for(let observer of this.intersection_observers)
                observer.unobserve(node);
        }

        // Don't leave the "load previous page" button displayed while we wait for the
        // data source to load.
        this.load_previous_page_button.hidden = true;

        this.thumbs = {};

        this.data_source = data_source;

        // Cancel any async scroll restoration if the data source changes.
        this.cancel_restore_scroll_pos();

        if(this.data_source == null)
            return;

        // If we disabled loading more pages earlier, reenable it.
        this.disable_loading_more_pages = false;

        // Listen to the data source loading new pages, so we can refresh the list.
        this.data_source.add_update_listener(this.data_source_updated);
    }

    async set_active(active, { data_source, old_media_id })
    {
        this._active = active;

        if(!active)
        {
            this.stop_pulsing_thumbnail();
            this.cancel_restore_scroll_pos();
            return;
        }

        this.set_data_source(data_source);
        this.load_expanded_media_ids();

        // We might get data_source_updated callbacks during load_data_source_page.
        // Make sure we ignore those, since we want the first refresh_images call
        // to be the one we make below.
        this.activating = true;
        try {
            // Make the first call to load_data_source_page, to load the initial page of images.
            await this.load_data_source_page();
        } finally {
            this.activating = false;
        }

        // Show images.  If we were displaying an image before we came here, forced_media_id
        // will force it to be included in the displayed results.
        this.finish_load_and_restore_scroll_pos(old_media_id);

        // If nothing's focused, focus the search so keyboard navigation works.  Don't do this if
        // we already have focus, so we don't steal focus from things like the tag search dropdown
        // and cause them to be closed.
        let focus = document.querySelector(":focus");
        if(focus == null)
            this.scroll_container.focus();
    }

    // Wait for the initial page to finish loading, then restore the scroll position if possible.
    async finish_load_and_restore_scroll_pos(old_media_id)
    {
        // Before we can set the scroll position, we need to wait for the initial page load to finish
        // so we can create thumbnails to scroll to.
        let restore_scroll_pos_id = this.restore_scroll_pos_id = new Object();
        await this.data_source.load_page(this.data_source.initial_page, { cause: "initial scroll" });

        // Stop if we were called again while we were waiting, or if we were cancelled.
        if(restore_scroll_pos_id !== this.restore_scroll_pos_id || !this._active)
            return;

        // If the media ID isn't in the list, this might be a manga page beyond the first that
        // isn't displayed, so try the first page instead.
        if(old_media_id != null && this.get_thumbnail_for_media_id(old_media_id) == null)
            old_media_id = helpers.get_media_id_first_page(old_media_id);

        // Create the initial thumbnails.  This will happen automatically, but we need to do it now so
        // we can scroll to them.
        this.refresh_images({ forced_media_id: old_media_id });

        // If we have no saved scroll position or previous ID, scroll to the top.
        let args = helpers.args.location;
        if(args.state.scroll == null && old_media_id == null)
        {
            console.log("Scroll to top for new search");
            this.scroll_container.scrollTop = 0;
            return;
        }

        // If we have a previous media ID, try to scroll to it.
        if(old_media_id != null)
        {
            // If we were displaying an image, pulse it to make it easier to find your place.
            this.pulse_thumbnail(old_media_id);
        
            // If we're navigating backwards or toggling, and we're switching from the image UI to thumbnails,
            // try to scroll the search screen to the image that was displayed.
            if(this.scroll_to_media_id(old_media_id))
            {
                console.log("Restored scroll position to:", old_media_id);
                return;
            }

            console.log("Couldn't restore scroll position for:", old_media_id);
        }

        if(this.restore_scroll_position(args.state.scroll?.scroll_position))
            console.log("Restored scroll position from history");
    }

    // Schedule storing the scroll position, resetting the timer if it's already running.
    schedule_store_scroll_position()
    {
        if(this.scroll_position_timer != -1)
        {
            clearTimeout(this.scroll_position_timer);
            this.scroll_position_timer = -1;
        }

        this.scroll_position_timer = setTimeout(() => {
            this.store_scroll_position();
        }, 100);
    }

    // Save the current scroll position, so it can be restored from history.
    store_scroll_position()
    {
        let args = helpers.args.location;
        args.state.scroll = {
            scroll_position: this.save_scroll_position(),
            nearby_media_ids: this.get_nearby_media_ids({all: true}),
        };
        helpers.set_page_url(args, false, "viewing-page", { send_popstate: false });
    }

    // Cancel any call to restore_scroll_pos that's waiting for data.
    cancel_restore_scroll_pos()
    {
        this.restore_scroll_pos_id = null;
    }

    data_source_updated = () =>
    {
        // Don't load or refresh images if we're in the middle of set_active.
        if(this.activating)
            return;

        this.refresh_images();
        this.load_data_source_page();
    }

    // Return all media IDs currently loaded in the data source, and the page
    // each one is on.
    get_data_source_media_ids()
    {
        let media_ids = [];
        let media_id_pages = {};
        if(this.data_source == null)
            return [media_ids, media_id_pages];

        let id_list = this.data_source.id_list;
        let min_page = id_list.get_lowest_loaded_page();
        let max_page = id_list.get_highest_loaded_page();
        for(let page = min_page; page <= max_page; ++page)
        {
            let media_ids_on_page = id_list.media_ids_by_page.get(page);
            console.assert(media_ids_on_page != null);

            // Create an image for each ID.
            for(let media_id of media_ids_on_page)
            {
                // If this is a multi-page post and manga expansion is enabled, add a thumbnail for
                // each page.  We can only do this if the data source registers thumbnail info from
                // its results, not if we have to look it up asynchronously, but almost all data sources
                // do.
                let media_ids_on_page = this.get_expanded_pages(media_id);
                if(media_ids_on_page != null)
                {
                    for(let page_media_id of media_ids_on_page)
                    {
                        media_ids.push(page_media_id);
                        media_id_pages[page_media_id] = page;
                    }
                    continue;
                }

                media_ids.push(media_id);
                media_id_pages[media_id] = page;
            }
        }

        return [media_ids, media_id_pages];
    }

    // If media_id is an expanded multi-page post, return the pages.  Otherwise, return null.
    get_expanded_pages(media_id)
    {
        if(!this.is_media_id_expanded(media_id))
            return null;

        let info = thumbnail_data.singleton().get_illust_data_sync(media_id);
        if(info == null || info.pageCount <= 1)
            return null;

        let results = [];
        let { type, id } = helpers.parse_media_id(media_id);
        for(let manga_page = 0; manga_page < info.pageCount; ++manga_page)
        {
            let page_media_id = helpers.encode_media_id({type, id, page: manga_page});
            results.push(page_media_id);
        }
        return results;
    }

    // Make a list of media IDs that we want loaded.  This has a few inputs:
    //
    // - The thumbnails that are already loaded, if any.
    // - A media ID that we want to have loaded.  If we're coming back from viewing an image
    //   and it's in the search results, we always want that image loaded so we can scroll to
    //   it.
    // - The thumbnails that are near the scroll position (nearby thumbs).  These should always
    //   be loaded.
    // 
    // Try to keep thumbnails that are already loaded in the list, since there's no performance
    // benefit to unloading thumbs.  Creating thumbs can be expensive if we're creating thousands of
    // them, but once they're created, content-visibility keeps things fast.
    //
    // If forced_media_id is set and it's in the search results, always include it in the results,
    // extending the list to include it.  If forced_media_id is set and we also have thumbs already
    // loaded, we'll extend the range to include both.  If this would result in too many images
    // being added at once, we'll remove previously loaded thumbs so forced_media_id takes priority.
    //
    // If we have no nearby thumbs and no ID to force load, it's an initial load, so we'll just
    // start at the beginning.
    //
    // The result is always a contiguous subset of media IDs from the data source.
    get_media_ids_to_display({all_media_ids, forced_media_id, columns})
    {
        if(all_media_ids.length == 0)
            return [];

        let [first_nearby_media_id, last_nearby_media_id] = this.get_nearby_media_ids();
        let [first_loaded_media_id, last_loaded_media_id] = this.get_loaded_media_ids();

        // If we're restoring a scroll position, state.scroll_nearby_media_ids is a list of
        // the IDs that were nearby when it was saved.  For the initial refresh, load the same
        // range of nearby media IDs.
        let args = helpers.args.location;
        if(first_nearby_media_id == null && args.state.scroll?.nearby_media_ids != null)
        {
            // nearby_media_ids is all media IDs that were nearby.  Not all of them may be
            // in the list now, eg. if we're only loading page 2 but some images from page 1
            // were nearby before, so find the biggest matching range.
            let first = helpers.find_first(args.state.scroll.nearby_media_ids, all_media_ids);
            let last = helpers.find_last(args.state.scroll.nearby_media_ids, all_media_ids);
            if(first != null && last != null)
            {
                first_nearby_media_id = first;
                last_nearby_media_id = last;
            }
        }

        // The indices of each related media_id.  These can all be -1.  Note that it's
        // possible for nearby entries to not be in the data source, if the data source
        // was just refreshed and entries were removed.
        let first_nearby_media_id_idx = all_media_ids.indexOf(first_nearby_media_id);
        let last_nearby_media_id_idx = all_media_ids.indexOf(last_nearby_media_id);
        let first_loaded_media_id_idx = all_media_ids.indexOf(first_loaded_media_id);
        let last_loaded_media_id_idx = all_media_ids.indexOf(last_loaded_media_id);
        let forced_media_id_idx = all_media_ids.indexOf(forced_media_id);

        // Figure out the range of all_media_ids that we want to have loaded.
        let start_idx = 999999;
        let end_idx = 0;

        // If there are visible thumbs, extend the range to include them.
        if(first_nearby_media_id_idx != -1)
            start_idx = Math.min(start_idx, first_nearby_media_id_idx);
        if(last_nearby_media_id_idx != -1)
            end_idx = Math.max(end_idx, last_nearby_media_id_idx);

        // If we have a media ID to display, extend the range to include it.
        if(forced_media_id_idx != -1)
        {
            start_idx = Math.min(start_idx, forced_media_id_idx);
            end_idx = Math.max(end_idx, forced_media_id_idx);
        }

        // If we have a range, extend it outwards in both directions to load images
        // around it.
        if(start_idx != 999999)
        {
            start_idx -= 10;
            end_idx += 10;
        }

        // If there are thumbs already loaded, extend the range to include them.  Do this
        // after extending the range above.
        if(first_loaded_media_id_idx != -1)
            start_idx = Math.min(start_idx, first_loaded_media_id_idx);
        if(last_loaded_media_id_idx != -1)
            end_idx = Math.max(end_idx, last_loaded_media_id_idx);

        // If we don't have anything, start at the beginning.
        if(start_idx == 999999)
        {
            start_idx = 0;
            end_idx = 0;
        }

        // Clamp the range.
        start_idx = Math.max(start_idx, 0);
        end_idx = Math.min(end_idx, all_media_ids.length-1);
        end_idx = Math.max(start_idx, end_idx); // make sure start_idx <= end_idx

        // If we're forcing an image to be included, and we also have images already
        // loaded, we can end up with a huge range if the two are far apart.  For example,
        // if an image is loaded from a search, the user navigates for a long time in the
        // image view and then returns to the search, we'll load the image he ended up on
        // all the way to the images that were loaded before.  Check the number of images
        // we're adding, and if it's too big, ignore the previously loaded thumbs and just
        // load IDs around forced_media_id.
        if(forced_media_id_idx != -1)
        {
            // See how many thumbs this would cause us to load.
            let loaded_thumb_ids = new Set();
            for(let node of this.get_loaded_thumbs())
                loaded_thumb_ids.add(node.dataset.id);
    
            let loading_thumb_count = 0;
            for(let thumb_id of all_media_ids.slice(start_idx, end_idx+1))
            {
                if(!loaded_thumb_ids.has(thumb_id))
                    loading_thumb_count++;
            }

            if(loading_thumb_count > 100)
            {
                console.log("Reducing loading_thumb_count from", loading_thumb_count);

                start_idx = forced_media_id_idx - 10;
                end_idx = forced_media_id_idx + 10;
                start_idx = Math.max(start_idx, 0);
                end_idx = Math.min(end_idx, all_media_ids.length-1);
            }
        }

        // Snap the start of the range to the column count, so images always stay on the
        // same column if we add entries to the beginning of the list.  This only works if
        // the data source provides all IDs at once, but if it doesn't then we won't
        // auto-load earlier images anyway.
        if(columns != null)
            start_idx -= start_idx % columns;

        let media_ids = all_media_ids.slice(start_idx, end_idx+1);
        /*
        console.log(
            "Nearby range:", first_nearby_media_id_idx, "to", last_nearby_media_id_idx,
            "Loaded range:", first_loaded_media_id_idx, "to", last_loaded_media_id_idx,
            "Forced idx:", forced_media_id_idx,
            "Returning:", start_idx, "to", end_idx);
*/
        // Load thumbnail info for the results.  We don't wait for this to finish.
        this.load_thumbnail_data_for_media_ids(all_media_ids, start_idx, end_idx);

        return media_ids;
    }

    load_thumbnail_data_for_media_ids(all_media_ids, start_idx, end_idx)
    {
        // Stop if the range is already loaded.
        let media_ids = all_media_ids.slice(start_idx, end_idx+1);
        if(thumbnail_data.singleton().are_all_media_ids_loaded_or_loading(media_ids))
            return;

        // Make a list of IDs that need to be loaded, removing ones that are already
        // loaded.
        let media_ids_to_load = [];
        for(let media_id of media_ids)
        {
            if(!thumbnail_data.singleton().is_media_id_loaded_or_loading(media_id))
                media_ids_to_load.push(media_id);
        }

        if(media_ids_to_load.length == 0)
            return;

        // Try not to request thumbnail info in tiny chunks.  If we load them as they
        // scroll on, we'll make dozens of requests for 4-5 thumbnails each and spam
        // the API.  Avoid this by extending the list outwards, so we load a bigger chunk
        // in one request and then stop for a while.
        //
        // Don't do this for the local API.  Making lots of tiny requests is harmless
        // there since it's all local, and requesting file info causes the file to be
        // scanned if it's not yet cached, so it's better to make fine-grained requests.
        let min_to_load = this.data_source?.name == "vview"? 10: 30;

        let load_start_idx = start_idx;
        let load_end_idx = end_idx;
        while(media_ids_to_load.length < min_to_load && (load_start_idx >= 0 || load_end_idx < all_media_ids.length))
        {
            let media_id = all_media_ids[load_start_idx];
            if(media_id != null && !thumbnail_data.singleton().is_media_id_loaded_or_loading(media_id))
                media_ids_to_load.push(media_id);

            media_id = all_media_ids[load_end_idx];
            if(media_id != null && !thumbnail_data.singleton().is_media_id_loaded_or_loading(media_id))
                media_ids_to_load.push(media_id);

            load_start_idx--;
            load_end_idx++;
        }

        thumbnail_data.singleton().get_thumbnail_info(media_ids_to_load);
    }

    // Return the first and last media IDs that are nearby (or all of them if all is true).
    get_nearby_media_ids({all=false}={})
    {
        let media_ids = [];
        for(let [media_id, element] of Object.entries(this.thumbs))
        {
            if(element.dataset.nearby)
                media_ids.push(media_id);
        }

        if(all)
            return media_ids;
        else
            return [media_ids[0], media_ids[media_ids.length-1]];
    }

    // Return the first and last media IDs that's currently loaded into thumbs.
    get_loaded_media_ids()
    {
        let media_ids = Object.keys(this.thumbs);
        let first_loaded_media_id = media_ids[0];
        let last_loaded_media_id = media_ids[media_ids.length-1];
        return [first_loaded_media_id, last_loaded_media_id];
    }

    refresh_images = ({forced_media_id=null}={}) =>
    {
        if(this.data_source == null)
            return;

        let manga_view = this.data_source?.name == "manga";

        // Update the thumbnail size style.  This also tells us the number of columns being
        // displayed.
        let thumbnail_size = settings.get(manga_view? "manga-thumbnail-size":"thumbnail-size", 4);
        thumbnail_size = thumbnail_size_slider_widget.thumbnail_size_for_value(thumbnail_size);

        let {columns, padding, max_width, max_height, container_width} = helpers.make_thumbnail_sizing_style(this.thumbnail_box, {
            wide: true,
            size: thumbnail_size,
            ratio: this.data_source.get_thumbnail_aspect_ratio(),

            // Limit the number of columns on most views, so we don't load too much data at once.
            // Allow more columns on the manga view, since that never loads more than one image.
            // Allow unlimited columns for local images.
            max_columns: manga_view? 15: 
                this.data_source?.name == "vview"? 100:5,

            // Set a minimum padding to make sure there's room for the popup text to fit between images.
            min_padding: 15,
        });

        this.container.style.setProperty('--thumb-width', `${max_width}px`);
        this.container.style.setProperty('--thumb-height', `${max_height}px`);
        this.container.style.setProperty('--thumb-padding', `${padding}px`);
        this.container.style.setProperty('--container-width', `${container_width}px`);

        // Save the scroll position relative to the first thumbnail.  Do this before making
        // any changes.
        let saved_scroll = this.save_scroll_position();

        // Get all media IDs from the data source.
        let [all_media_ids, media_id_pages] = this.get_data_source_media_ids();

        // Sanity check: there should never be any duplicate media IDs from the data source.
        // Refuse to continue if there are duplicates, since it'll break our logic badly and
        // can cause infinite loops.  This is always a bug.
        if(all_media_ids.length != (new Set(all_media_ids)).size)
            throw Error("Duplicate media IDs");

        // When we remove thumbs, we'll cache them here, so if we end up reusing it we don't have
        // to recreate it.
        let removed_nodes = {};
        let remove_node = (node) =>
        {
            node.remove();
            removed_nodes[node.dataset.id] = node;
            delete this.thumbs[node.dataset.id];
        }

        // Remove any thumbs that aren't present in all_media_ids, so we only need to 
        // deal with adding thumbs below.  For example, this simplifies things when
        // a manga post is collapsed.
        {
            let media_id_set = new Set(all_media_ids);
            for(let [thumb_media_id, thumb] of Object.entries(this.thumbs))
            {
                if(!media_id_set.has(thumb_media_id))
                    remove_node(thumb);
            }
        }

        // Get the thumbnail media IDs to display.
        let media_ids = this.get_media_ids_to_display({
            all_media_ids,
            columns,
            forced_media_id,
        });

        // Add thumbs.
        //
        // Most of the time we're just adding thumbs to the list.  Avoid removing or recreating
        // thumbs that aren't actually changing, which reduces flicker.
        //
        // Do this by looking for a range of thumbnails that matches a range in media_ids.
        // If we're going to display [0,1,2,3,4,5,6,7,8,9], and the current thumbs are [4,5,6],
        // then 4,5,6 matches and can be reused.  We'll add [0,1,2,3] to the beginning and [7,8,9]
        // to the end.
        //
        // Most of the time we're just appending.  The main time that we add to the beginning is
        // the "load previous results" button.

        // Make a dictionary of all illust IDs and pages, so we can look them up quickly.
        let media_id_index = {};
        for(let i = 0; i < media_ids.length; ++i)
        {
            let media_id = media_ids[i];
            media_id_index[media_id] = i;
        }

        let get_node_idx = function(node)
        {
            if(node == null)
                return null;

            let media_id = node.dataset.id;
            return media_id_index[media_id];
        }

        // Find the first match (4 in the above example).
        let first_matching_node = this.thumbnail_box.firstElementChild;
        while(first_matching_node && get_node_idx(first_matching_node) == null)
            first_matching_node = first_matching_node.nextElementSibling;

        // If we have a first_matching_node, walk forward to find the last matching node (6 in
        // the above example).
        let last_matching_node = first_matching_node;
        if(last_matching_node != null)
        {
            // Make sure the range is contiguous.  first_matching_node and all nodes through last_matching_node
            // should match a range exactly.  If there are any missing entries, stop.
            let next_expected_idx = get_node_idx(last_matching_node) + 1;
            while(last_matching_node && get_node_idx(last_matching_node.nextElementSibling) == next_expected_idx)
            {
                last_matching_node = last_matching_node.nextElementSibling;
                next_expected_idx++;
            }
        }

        // If we have a range, delete all items outside of it.  Otherwise, just delete everything.
        while(first_matching_node && first_matching_node.previousElementSibling)
            remove_node(first_matching_node.previousElementSibling);

        while(last_matching_node && last_matching_node.nextElementSibling)
            remove_node(last_matching_node.nextElementSibling);

        if(!first_matching_node && !last_matching_node)
        {
            while(this.thumbnail_box.firstElementChild != null)
                remove_node(this.thumbnail_box.firstElementChild);
        }

        // If we have a matching range, add any new elements before it.
        if(first_matching_node)
        {
           let first_idx = get_node_idx(first_matching_node);
           for(let idx = first_idx - 1; idx >= 0; --idx)
           {
               let media_id = media_ids[idx];
               let search_page = media_id_pages[media_id];
               let node = this.create_thumb(media_id, search_page, { cached_nodes: removed_nodes });
               first_matching_node.insertAdjacentElement("beforebegin", node);
               first_matching_node = node;
               this.thumbs = add_to_beginning(this.thumbs, media_id, node);
           }
        }

        // Add any new elements after the range.  If we don't have a range, just add everything.
        let last_idx = -1;
        if(last_matching_node)
           last_idx = get_node_idx(last_matching_node);

        for(let idx = last_idx + 1; idx < media_ids.length; ++idx)
        {
            let media_id = media_ids[idx];
            let search_page = media_id_pages[media_id];
            let node = this.create_thumb(media_id, search_page, { cached_nodes: removed_nodes });
            this.thumbnail_box.appendChild(node);
            add_to_end(this.thumbs, media_id, node);
        }

        // If this data source supports a start page and we started after page 1, show the "load more"
        // button.
        this.load_previous_page_button.hidden = this.data_source == null || this.data_source.initial_page == 1;

        this.restore_scroll_position(saved_scroll);

        // this.sanity_check_thumb_list();
    }

    sanity_check_thumb_list()
    {
        let actual = [];
        for(let thumb of this.thumbnail_box.children)
            actual.push(thumb.dataset.id);
        let expected = Object.keys(this.thumbs);

        if(JSON.stringify(actual) != JSON.stringify(expected))
        {
            console.log("actual  ", actual);
            console.log("expected", expected);
        }
    }
    // Start loading data pages that we need to display visible thumbs, and start
    // loading thumbnail data for nearby thumbs.
    async load_data_source_page()
    {
        // We load pages when the last thumbs on the previous page are loaded, but the first
        // time through there's no previous page to reach the end of.  Always make sure the
        // first page is loaded (usually page 1).
        let load_page = null;
        if(this.data_source && !this.data_source.is_page_loaded_or_loading(this.data_source.initial_page))
            load_page = this.data_source.initial_page;
        else
        {
            // If the last thumb in the list is visible, we need the next page to continue.
            // Note that since get_nearby_thumbnails returns thumbs before they actually scroll
            // into view, this will happen before the last thumb is actually visible to the user.
            let elements = this.get_nearby_thumbnails();
            if(elements.length > 0 && elements[elements.length-1].nextElementSibling == null)
            {
                let last_element = elements[elements.length-1];
                load_page = parseInt(last_element.dataset.searchPage)+1;
            }
        }

        // Hide "no results" if it's shown while we load data.
        let no_results = this.container.querySelector(".no-results");
        no_results.hidden = true;

        if(load_page != null)
        {
            var result = await this.data_source.load_page(load_page, { cause: "thumbnails" });

            // If this page didn't load, it probably means we've reached the end, so stop trying
            // to load more pages.
            if(!result)
                this.disable_loading_more_pages = true;
        }

        // If we have no IDs and nothing is loading, the data source is empty (no results).
        if(this.data_source?.no_results)
            no_results.hidden = false;
        
        this.set_visible_thumbs();
    }

    // Handle clicks on the "load previous results" button.
    //
    // If we let the regular click handling in main_controller.set_current_data_source do this,
    // it'll notice that the requested page isn't loaded and create a new data source.  We know
    // we can view the previous page, so special case this so we don't lose the pages that are
    // already loaded.
    //
    // This can also trigger for the "return to start" button if we happen to be on page 2.
    thumbnail_onclick = async(e) =>
    {
        let page_count_box = e.target.closest(".expand-button");
        if(page_count_box)
        {
            e.preventDefault();
            e.stopPropagation();
            let id_node = page_count_box.closest("[data-id]");
            let media_id = id_node.dataset.id;
            this.set_media_id_expanded(media_id, !this.is_media_id_expanded(media_id));
            return;
        }

        // This only matters if the data source supports start pages.
        if(!this.data_source.supports_start_page)
            return;

        let a = e.target.closest("A");
        if(a == null)
            return;
    }

    // See if we can load page in-place.  Return true if we were able to, and the click that
    // requested it should be cancelled, or false if we can't and it should be handled as a
    // regular navigation.
    async load_page(page)
    {
        // We can only add pages that are immediately before or after the pages we currently have.
        let min_page = this.data_source.id_list.get_lowest_loaded_page();
        let max_page = this.data_source.id_list.get_highest_loaded_page();
        if(page < min_page-1)
            return false;
        if(page > max_page+1)
            return false;
        
        console.log("Loading page:", page);
        await this.data_source.load_page(page, { cause: "previous page" });
        return true;
    }

    // Save the current scroll position relative to the first visible thumbnail.
    // The result can be used with restore_scroll_position.
    save_scroll_position()
    {
        let first_visible_thumb_node = this.get_first_visible_thumb();
        if(first_visible_thumb_node == null)
            return null;

        return {
            saved_scroll: helpers.save_scroll_position(this.scroll_container, first_visible_thumb_node),
            media_id: first_visible_thumb_node.dataset.id,
        }
    }

    // Restore the scroll position from a position saved by save_scroll_position.
    restore_scroll_position(scroll)
    {
        if(scroll == null)
            return false;

        // Find the thumbnail for the media_id the scroll position was saved at.
        let restore_scroll_position_node = this.get_thumbnail_for_media_id(scroll.media_id);
        if(restore_scroll_position_node == null)
            return false;

        helpers.restore_scroll_position(this.scroll_container, restore_scroll_position_node, scroll.saved_scroll);
        return true;
    }

    // Set whether the given thumb is expanded.
    //
    // We can store a thumb being explicitly expanded or explicitly collapsed, overriding the
    // current default.
    set_media_id_expanded(media_id, new_value)
    {
        let page = helpers.media_id_to_illust_id_and_page(media_id)[1];
        media_id = helpers.get_media_id_first_page(media_id);

        this.expanded_media_ids.set(media_id, new_value);
        this.save_expanded_media_ids();

        // This will cause thumbnails to be added or removed, so refresh.
        this.refresh_images();

        // Refresh whether we're showing the expansion border.  refresh_images sets this when it's
        // created, but it doesn't handle refreshing it.
        let thumb = this.get_thumbnail_for_media_id(media_id);
        this.refresh_expanded_thumb(thumb);

        if(!new_value)
        {
            media_id = helpers.get_media_id_first_page(media_id);

            // If we're collapsing a manga post on the first page, we know we don't need to
            // scroll since the user clicked the first page.  Leave it where it is so we don't
            // move the button he clicked around.  If we're collapsing a later page, scroll
            // the first page onscreen so we don't end up in a random scroll position two pages down.
            if(page != 0)
                this.scroll_to_media_id(helpers.get_media_id_first_page(media_id));
        }
    }

    // Set whether thumbs are expanded or collapsed by default.
    toggle_expanding_media_ids_by_default()
    {
        // If the new setting is the same as the expand_manga_thumbnails setting, just
        // remove expand-thumbs.  Otherwise, set it to the overridden setting.
        let args = helpers.args.location;
        let new_value = !this.media_ids_expanded_by_default;
        if(new_value == settings.get("expand_manga_thumbnails"))
            args.hash.delete("expand-thumbs");
        else
            args.hash.set("expand-thumbs", new_value? "1":"0");

        // Clear manually expanded/unexpanded thumbs, and navigate to the new setting.
        delete args.state.expanded_media_ids;
        helpers.set_page_url(args, true, "viewing-page");
    }

    load_expanded_media_ids()
    {
        // Load expanded_media_ids.
        let args = helpers.args.location;
        let media_ids = args.state.expanded_media_ids ?? {};
        this.expanded_media_ids = new Map(Object.entries(media_ids));

        // Load media_ids_expanded_by_default.
        let expand_thumbs = args.hash.get("expand-thumbs");
        if(expand_thumbs == null)
            this.media_ids_expanded_by_default = settings.get("expand_manga_thumbnails");
        else
            this.media_ids_expanded_by_default = expand_thumbs == "1";
    }

    // Store this.expanded_media_ids to history.
    save_expanded_media_ids()
    {
        let args = helpers.args.location;
        args.state.expanded_media_ids = Object.fromEntries(this.expanded_media_ids);
        helpers.set_page_url(args, false, "viewing-page", { send_popstate: false });
    }

    is_media_id_expanded(media_id)
    {
        // Never expand manga posts on data sources that include manga pages themselves.
        // This can result in duplicate media IDs.
        if(this.data_source?.includes_manga_pages)
            return false;

        media_id = helpers.get_media_id_first_page(media_id);

        // Only illust IDs can be expanded.
        let { type } = helpers.parse_media_id(media_id);
        if(type != "illust")
            return false;

        // Check if the user has manually expanded or collapsed the image.
        if(this.expanded_media_ids.has(media_id))
            return this.expanded_media_ids.get(media_id);

        // The media ID hasn't been manually expanded or unexpanded.  If we're not expanding
        // by default, it's unexpanded.
        if(!this.media_ids_expanded_by_default)
            return false;

        // If the image is muted, never expand it by default, even if we're set to expand by default.
        // We'll just show a wall of muted thumbs.
        let info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(info != null)
        {
            let muted_tag = muting.singleton.any_tag_muted(info.tagList);
            let muted_user = muting.singleton.is_muted_user_id(info.userId);
            if(muted_tag || muted_user)
                return false;
        }

        // Otherwise, it's expanded by default if it has more than one page.
        if(info == null || info.pageCount == 1)
            return false;

        return true;
    }

    // Refresh the expanded-thumb class on thumbnails after expanding or unexpanding a manga post.
    refresh_expanded_thumb(thumb)
    {
        if(thumb == null)
            return;

        // Don't set expanded-thumb on the manga view, since it's always expanded.
        let media_id = thumb.dataset.id;
        let show_expanded = !this.data_source?.includes_manga_pages && this.is_media_id_expanded(media_id);
        helpers.set_class(thumb, "expanded-thumb", show_expanded);

        let info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);        
        let [illust_id, illust_page] = helpers.media_id_to_illust_id_and_page(media_id);
        
        helpers.set_class(thumb, "expanded-manga-post", show_expanded);
        helpers.set_class(thumb, "first-manga-page", illust_page == 0);

        // Show the page count if this is a multi-page post (unless we're on the
        // manga view itself).
        if(info.pageCount > 1 && this.data_source?.name != "manga")
        {
            let pageCountBox = thumb.querySelector(".manga-info-box");
            pageCountBox.hidden = false;

            let text = show_expanded? `${illust_page+1}/${info.pageCount}`:info.pageCount;
            thumb.querySelector(".manga-info-box .page-count").textContent = text;
            thumb.querySelector(".manga-info-box .page-count").hidden = false;

            let page_count_box2 = thumb.querySelector(".show-manga-pages-button");
            page_count_box2.hidden = false;
            page_count_box2.href = `/artworks/${illust_id}#ppixiv?manga=1`;
        }
    }

    // Refresh all expanded thumbs.  This is only needed if the default changes.
    refresh_expanded_thumb_all()
    {
        for(let thumb of this.get_loaded_thumbs())
            this.refresh_expanded_thumb(thumb);
    }

    // Populate all visible thumbnails.
    //
    // This won't trigger loading any data (other than the thumbnails themselves).
    set_visible_thumbs({force=false}={})
    {
        // Make a list of IDs that we're assigning.
        var elements = this.get_nearby_thumbnails();
        for(var element of elements)
        {
            let media_id = element.dataset.id;
            if(media_id == null)
                continue;

            let [illust_id, illust_page] = helpers.media_id_to_illust_id_and_page(media_id);

            let { id: thumb_id, type: thumb_type } = helpers.parse_media_id(media_id);

            // For illustrations, get thumbnail info.  If we don't have it yet, skip the image (leave it pending)
            // and we'll come back once we have it.
            if(thumb_type == "illust" || thumb_type == "file" || thumb_type == "folder")
            {
                // Get thumbnail info.
                var info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
                if(info == null)
                    continue;
            }
            
            // Leave it alone if it's already been loaded.
            if(!force && !("pending" in element.dataset))
                continue;

            // Why is this not working in FF?  It works in the console, but not here.  Sandboxing
            // issue?
            // delete element.dataset.pending;
            element.removeAttribute("data-pending");

            // On hover, use stop_animation_after to stop the animation after a while.
            this.add_animation_listener(element);

            if(thumb_type == "user" || thumb_type == "bookmarks")
            {
                // This is a user thumbnail rather than an illustration thumbnail.  It just shows a small subset
                // of info.
                let user_id = thumb_id;

                var link = element.querySelector("a.thumbnail-link");
                if(thumb_type == "user")
                    link.href = `/users/${user_id}/artworks#ppixiv`;
                else
                    link.href = `/users/${user_id}/bookmarks/artworks#ppixiv`;

                link.dataset.userId = user_id;

                let quick_user_data = thumbnail_data.singleton().get_quick_user_data(user_id);
                if(quick_user_data == null)
                {
                    // We should always have this data for users if the data source asked us to display this user.
                    throw "Missing quick user data for user ID " + user_id;
                }
                
                var thumb = element.querySelector(".thumb");
                thumb.src = quick_user_data.profileImageUrl;

                var label = element.querySelector(".thumbnail-label");
                label.hidden = false;
                label.querySelector(".label").innerText = quick_user_data.userName;

                continue;
            }

            if(thumb_type != "illust" && thumb_type != "file" && thumb_type != "folder")
                throw "Unexpected thumb type: " + thumb_type;

            // Set this thumb.
            let { page } = helpers.parse_media_id(media_id);
            let url = info.previewUrls[page];
            var thumb = element.querySelector(".thumb");

            // Check if this illustration is muted (blocked).
            var muted_tag = muting.singleton.any_tag_muted(info.tagList);
            var muted_user = muting.singleton.is_muted_user_id(info.userId);
            if(muted_tag || muted_user)
            {
                // The image will be obscured, but we still shouldn't load the image the user blocked (which
                // is something Pixiv does wrong).  Load the user profile image instead.
                thumb.src = thumbnail_data.singleton().get_profile_picture_url(info.userId);
                element.classList.add("muted");

                let muted_label = element.querySelector(".muted-label");

                // Quick hack to look up translations, since we're not async:
                (async() => {
                    if(muted_tag)
                        muted_tag = await tag_translations.get().get_translation(muted_tag);
                    muted_label.textContent = muted_tag? muted_tag:info.userName;
                })();

                // We can use this if we want a "show anyway' UI.
                thumb.dataset.mutedUrl = url;
            }
            else
            {
                thumb.src = url;
                element.classList.remove("muted");

                // Try to set up the aspect ratio.
                this.thumb_image_load_finished(element, { cause: "setup" });
            }

            // Set the link.  Setting dataset.mediaId will allow this to be handled with in-page
            // navigation, and the href will allow middle click, etc. to work normally.
            var link = element.querySelector("a.thumbnail-link");
            if(thumb_type == "folder")
            {
                // This is a local directory.  We only expect to see this while on the local
                // data source.  The folder link retains any search parameters in the URL.
                let args = helpers.args.location;
                local_api.get_args_for_id(media_id, args);
                link.href = args.url;

                element.querySelector(".manga-info-box").hidden = false;
            }
            else
            {
                link.href = helpers.get_url_for_id(media_id).url;
            }

            link.dataset.mediaId = media_id;
            link.dataset.userId = info.userId;

            element.querySelector(".ugoira-icon").hidden = info.illustType != 2 && info.illustType != "video";

            helpers.set_class(element, "dot", helpers.tags_contain_dot(info));

            // Set expanded-thumb if this is an expanded manga post.  This is also updated in
            // set_media_id_expanded.  Set the border to a random-ish value to try to make it
            // easier to see the boundaries between manga posts.  It's hard to guarantee that it
            // won't be the same color as a neighboring post, but that's rare.  Using the illust
            // ID means the color will always be the same.  The saturation is a bit low so these
            // colors aren't blinding.
            this.refresh_expanded_thumb(element);
            helpers.set_class(link, "first-page", illust_page == 0);
            helpers.set_class(link, "last-page", illust_page == info.pageCount-1);
            link.style.borderBottomColor = `hsl(${illust_id}deg 50% 50%)`;

            this.refresh_bookmark_icon(element);

            // Set the label.  This is only actually shown in following views.
            var label = element.querySelector(".thumbnail-label");
            if(thumb_type == "folder")
            {
                // The ID is based on the filename.  Use it to show the directory name in the thumbnail.
                let parts = media_id.split("/");
                let basename = parts[parts.length-1];
                let label = element.querySelector(".thumbnail-label");
                label.hidden = false;
                label.querySelector(".label").innerText = basename;
            } else {
                label.hidden = true;
            }
        }        

        if(this.data_source != null)
        {
            // Set the link for the first page and previous page buttons.  Most of the time this is handled
            // by our in-page click handler.
            let page = this.data_source.get_start_page(helpers.args.location);
            let previous_page_link = this.load_previous_page_button.querySelector("a.load-previous-page-link");
            let args = helpers.args.location;
            this.data_source.set_start_page(args, page-1);
            previous_page_link.href = args.url;
        }
    }

    // Set things up based on the image dimensions.  We can do this immediately if we know the
    // thumbnail dimensions already, otherwise we'll do it based on the thumbnail once it loads.
    thumb_image_load_finished(element, { cause })
    {
        if(element.dataset.thumbLoaded)
            return;

        let media_id = element.dataset.id;
        let [illust_id, illust_page] = helpers.media_id_to_illust_id_and_page(media_id);
        let thumb = element.querySelector(".thumb");

        // Try to use thumbnail info first.  Preferring this makes things more consistent,
        // since naturalWidth may or may not be loaded depending on browser cache.
        let width, height;
        if(illust_page == 0)
        {
            let info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
            if(info != null)
            {
                width = info.width;
                height = info.height;
            }
        }

        // If that wasn't available, try to use the dimensions from the image.  This is the size
        // of the thumb rather than the image, but all we care about is the aspect ratio.
        if(width == null && thumb.naturalWidth != 0)
        {
            width = thumb.naturalWidth;
            height = thumb.naturalHeight;
        }

        if(width == null)
            return;

        element.dataset.thumbLoaded = "1";

        // Set up the thumbnail panning direction, which is based on the image aspect ratio and the
        // displayed thumbnail aspect ratio.  Ths thumbnail aspect ratio is usually 1 for square thumbs,
        // but it can be different on the manga page.  Get this from the data source, since using offsetWidth
        // causes a reflow.
        let thumb_aspect_ratio = this.data_source.get_thumbnail_aspect_ratio() ?? 1;

        // console.log(`Thumbnail ${media_id} loaded at ${cause}: ${width} ${height} ${thumb.src}`);
        helpers.create_thumbnail_animation(thumb, width, height, thumb_aspect_ratio);
    }

    // element is a thumbnail element.  On mouseover, start the pan animation, and create
    // a stop_animation_after to prevent the animation from running forever.
    //
    // We create the pan animations programmatically instead of with CSS, since for some
    // reason element.getAnimations is extremely slow and often takes 10ms or more.  CSS
    // can't be used to pause programmatic animations, so we have to play/pause it manually
    // too.
    add_animation_listener(element)
    {
        element.addEventListener("mouseover", (e) => {
            if(settings.get("disable_thumbnail_panning") || ppixiv.mobile)
                return;

            let thumb = element.querySelector(".thumb");
            let anim = thumb.panAnimation;
            if(anim == null)
                return;

            // Start playing the animation.
            anim.play();

            // Stop if stop_animation_after is already running for this thumb.
            if(this.stop_animation?.animation == anim)
                return;
            // If we were running it on another thumb and we missed the mouseout for
            // some reason, remove it.  This only needs to run on the current hover.
            if(this.stop_animation)
            {
                this.stop_animation.shutdown();
                this.stop_animation = null;
            }

            this.stop_animation = new helpers.stop_animation_after(anim, 6, 1, anim.animationName == "pan-thumbnail-vertically");

            // Remove it when the mouse leaves the thumb.  We'll actually respond to mouseover/mouseout
            // for elements inside the thumb too, but it doesn't cause problems here.
            element.addEventListener("mouseout", (e) => {
                this.stop_animation.shutdown();
                this.stop_animation = null;
                anim.pause();
            }, { once: true, signal: this.stop_animation.abort.signal });
        });
    }
    
    // Refresh the thumbnail for media_id.
    //
    // This is used to refresh the bookmark icon when changing a bookmark.
    refresh_thumbnail = (media_id) =>
    {
        // If this is a manga post, refresh all thumbs for this media ID, since bookmarking
        // a manga post is shown on all pages if it's expanded.
        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(thumbnail_info == null)
            return;

        for(let page = 0; page < thumbnail_info.pageCount; ++page)
        {
            media_id = helpers.get_media_id_for_page(media_id, page);
            let thumbnail_element = this.get_thumbnail_for_media_id(media_id);
            if(thumbnail_element != null)
                this.refresh_bookmark_icon(thumbnail_element);
        }
    }

    // Set the bookmarked heart for thumbnail_element.  This can change if the user bookmarks
    // or un-bookmarks an image.
    refresh_bookmark_icon(thumbnail_element)
    {
        if(this.data_source && this.data_source.name == "manga")
            return;

        var media_id = thumbnail_element.dataset.id;
        if(media_id == null)
            return;

        // Get thumbnail info.
        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(thumbnail_info == null)
            return;

        var show_bookmark_heart = thumbnail_info.bookmarkData != null;
        if(this.data_source != null && !this.data_source.show_bookmark_icons)
            show_bookmark_heart = false;
        
        thumbnail_element.querySelector(".heart.public").hidden = !show_bookmark_heart || thumbnail_info.bookmarkData.private;
        thumbnail_element.querySelector(".heart.private").hidden = !show_bookmark_heart || !thumbnail_info.bookmarkData.private;
    }

    // Force all thumbnails to refresh after the mute list changes, to refresh mutes.
    refresh_after_mute_change = () =>
    {
        // Force the update to refresh thumbs that have already been created.
        this.set_visible_thumbs({force: true});

        // Refresh the user ID-dependant UI so we refresh the mute/unmute button.
        this.refresh_ui_for_user_id();
    }

    // Return a list of thumbnails that are either visible, or close to being visible
    // (so we load thumbs before they actually come on screen).
    get_nearby_thumbnails()
    {
        // If the container has a zero height, that means we're hidden and we don't want to load
        // thumbnail data at all.
        if(this.container.offsetHeight == 0)
            return [];

        let results = [];
        for(let element of Object.values(this.thumbs))
        {
            if(element.dataset.id && element.dataset.nearby)
                results.push(element);
        }

        return results;
    }

    get_loaded_thumbs()
    {
        return Object.values(this.thumbs);
    }

    // Create a thumb placeholder.  This doesn't load the image yet.
    //
    // media_id is the illustration this will be if it's displayed, or null if this
    // is a placeholder for pages we haven't loaded.  page is the page this illustration
    // is on (whether it's a placeholder or not).
    //
    // cached_nodes is a dictionary of previously-created nodes that we can reuse.
    create_thumb(media_id, search_page, { cached_nodes })
    {
        if(cached_nodes[media_id] != null)
        {
            let result = cached_nodes[media_id];
            delete cached_nodes[media_id];
            return result;
        }

        // make_svg_unique is disabled here as a small optimization, since these SVGs don't need it.
        let entry = this.create_template({ name: "template-thumbnail", make_svg_unique: false, html: `
            <div class=thumbnail-box>
                <a class=thumbnail-link href=#>
                    <img class=thumb>
                </a>

                <div class=last-viewed-image-marker>
                    <ppixiv-inline class=last-viewed-image-marker src="resources/last-viewed-image-marker.svg"></ppixiv-inline>
                </div>

                <div class=bottom-row>
                    <div class=bottom-left-icon>
                        <div class="heart button-bookmark public bookmarked" hidden>
                            <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                        </div>
                        <div class="heart button-bookmark private bookmarked" hidden>
                            <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                        </div>
                    </div>

                    <div style="flex: 1;"></div>

                    <div class=thumbnail-label hidden>
                        <span class="thumbnail-ellipsis-box">
                            <span class=label></span>
                        </span>
                    </div>

                    <div style="flex: 1;"></div>

                    <div class=bottom-right-icon>
                        <div class=ugoira-icon hidden>
                            <ppixiv-inline src="resources/play-button.svg"></ppixiv-inline>
                        </div>

                        <div class=manga-info-box style="cursor: pointer;" hidden>
                            <a class=show-manga-pages-button hidden>
                                ${ helpers.create_icon("pages") }
                            </a>

                            <span class=expand-button>
                                <span class=page-icon>
                                    <img class=regular src="ppixiv:resources/page-icon.png">
                                    <img class=hover src="ppixiv:resources/page-icon-hover.png">
                                </span>
                                <span class=page-count hidden>1234</span>
                            </span>
                        </div>
                    </div>
                </div>
                <div class=muted-text>
                    <span>Muted:</span>
                    <span class=muted-label></span>
                </div>
            </div>
        `});

        // Mark that this thumb hasn't been filled in yet.
        entry.dataset.pending = true;
        entry.dataset.id = media_id;

        if(search_page != null)
            entry.dataset.searchPage = search_page;
        for(let observer of this.intersection_observers)
            observer.observe(entry);
        return entry;
    }

    // This is called when thumbnail_data has loaded more thumbnail info.
    thumbs_loaded = (e) =>
    {
        this.set_visible_thumbs();
    }

    // Scroll to media_id if it's available.  This is called when we display the thumbnail view
    // after coming from an illustration.
    scroll_to_media_id(media_id)
    {
        let thumb = this.get_thumbnail_for_media_id(media_id);
        if(thumb == null)
            return false;

        this.scroll_container.scrollTop = thumb.offsetTop + thumb.offsetHeight/2 - this.scroll_container.offsetHeight/2;
        return true;
    };

    pulse_thumbnail(media_id)
    {
        let thumb = this.get_thumbnail_for_media_id(media_id);
        if(thumb == null)
            return;

        this.stop_pulsing_thumbnail();

        this.flashing_image = thumb;
        thumb.classList.add("flash");
    };

    // Work around a bug in CSS animations: even if animation-iteration-count is 1,
    // the animation will play again if the element is hidden and displayed again, which
    // causes previously-flashed thumbnails to flash every time we exit and reenter
    // thumbnails.
    stop_pulsing_thumbnail()
    {
        if(this.flashing_image == null)
            return;

        this.flashing_image.classList.remove("flash");
        this.flashing_image = null;
    };
};

