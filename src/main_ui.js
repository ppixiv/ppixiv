// The main UI.  This handles creating the viewers and the global UI.
class main_ui
{
    constructor(main, container)
    {
        if(debug_show_ui) document.body.classList.add("force-ui");

        this.onwheel = this.onwheel.bind(this);
        this.refresh_ui = this.refresh_ui.bind(this);
        this.shown_page_changed = this.shown_page_changed.bind(this);
        this.image_data_loaded = this.image_data_loaded.bind(this);
        this.data_source_updated = this.data_source_updated.bind(this);

        this.current_illust_id = -1;
        this.latest_navigation_direction_down = true;
        this.main = main;
        this.container = container;

        this.progress_bar = new progress_bar(this.container.querySelector(".loading-progress-bar"));

        // Create a UI box and put it in its container.
        this.ui = new image_ui(this.container.querySelector(".ui"), this.progress_bar);
        
        document.head.appendChild(document.createElement("title"));
        this.document_icon = document.head.appendChild(document.createElement("link"));
        this.document_icon.setAttribute("rel", "icon");
       
        image_data.singleton().user_modified_callbacks.register(this.refresh_ui);
        image_data.singleton().illust_modified_callbacks.register(this.refresh_ui);

        new hide_mouse_cursor_on_idle(this.container.querySelector(".image-container"));

        new refresh_bookmark_tag_widget(this.container.querySelector(".refresh-bookmark-tags"));
        this.manga_thumbnails = new manga_thumbnail_widget(this.container.querySelector(".manga-thumbnail-container"));
        this.manga_thumbnails.set_page_changed_callback(function(page) {
            this.viewer.page = page;
        }.bind(this));

        // Show the bookmark UI when hovering over the bookmark icon.
        var bookmark_popup = this.container.querySelector(".bookmark-button");

        window.addEventListener("bookmark-tags-changed", this.refresh_ui);

        this.container.addEventListener("wheel", this.onwheel);

        // A bar showing how far along in an image sequence we are:
        this.manga_page_bar = new progress_bar(this.container.querySelector(".ui-box")).controller();
        this.seek_bar = new seek_bar(this.container.querySelector(".ugoira-seek-bar"));

        helpers.add_clicks_to_search_history(document.body);

        // We'll finish setting up when our caller calls set_data_source().
    }

    set_data_source(data_source)
    {
        if(data_source == this.data_source)
            return;

        if(this.data_source != null)
        {
            this.data_source.remove_update_listener(this.data_source_updated);
            this.data_source = null;
        }

        this.data_source = data_source;
        this.ui.data_source = data_source;

        if(this.data_source != null)
        {
            this.data_source.add_update_listener(this.data_source_updated);

            this.refresh_ui();
        }
    }

    // Show an image.
    //
    // If manga_page isn't null, it's the page to display.
    show_image(illust_id, manga_page)
    {
        // If we previously set a pending navigation, this navigation overrides it.
        this.cancel_async_navigation();

        // If we were already shown (we're not coming from the thumbnail view), and we're showing
        // the previous image from the one we were already showing, start at the end instead
        // of the beginning, so we'll start at the end when browsing backwards.
        var show_last_page = false;
        var wanted_page = manga_page;
        if(this.active && wanted_page == null)
        {
            var next_illust_id = this.data_source.id_list.get_neighboring_illust_id(illust_id, true);
            show_last_page = (next_illust_id == this.wanted_illust_id);
            wanted_page = show_last_page? -1:0;
        }
        
        // Remember that this is the image we want to be displaying.
        this.wanted_illust_id = illust_id;
        this.wanted_illust_page = wanted_page;

        // If this image is already loaded, stop.
        if(illust_id == this.current_illust_id && this.wanted_illust_page == this.viewer.page)
        {
            console.log("illust_id", illust_id, "page", this.wanted_illust_page, "already displayed");
            return;
        }

        // If we're not active, stop.  We'll show this image if we become loaded later.
        if(!this.active)
        {
            console.log("show_image: stopping since we're not active");
            return;
        }

        // Tell the preloader about the current image.
        image_preloader.singleton.set_current_image(illust_id);

        // Load info for this image if needed.
        image_data.singleton().get_image_info(illust_id, this.image_data_loaded);
    }

    // If we started navigating to a new image and were delayed to load data (either to load
    // the image or to load a new page), cancel it and stay where we are.
    cancel_async_navigation()
    {
        // If we previously set a pending navigation, this navigation overrides it.
        this.pending_navigation = null;
    }


    // Stop displaying any image (and cancel any wanted navigation), putting us back
    // to where we were before displaying any images.
    //
    // This will also prevent the next image displayed from triggering speculative
    // loading, which we don't want to do when clicking an image in the thumbnail
    // view.
    stop_displaying_image()
    {
        if(this.viewer != null)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }

        this.manga_thumbnails.set_illust_info(null);
        
        this.wanted_illust_id = null;

        // The manga page to show, or the last page if -1.
        this.wanted_illust_page = 0;
        this.current_illust_id = -1;
        this.refresh_ui();
    }

    image_data_loaded(illust_data)
    {
        var illust_id = illust_data.illustId;

        // If this isn't image data for the image we want to be showing, ignore it.
        if(this.wanted_illust_id != illust_id)
            return;

        console.log("Showing image", illust_id);
        
        if(this.wanted_illust_page == -1)
        {
            // We're navigating to the last page, but we didn't know the page count when we
            // did the navigation.  Update the URL to contain the page number now that we have
            // it.
            var query_args = new URL(document.location).searchParams;
            var hash_args = helpers.get_hash_args(document.location);
            hash_args.set("page", illust_data.pageCount-1);
            console.log("Updating URL with page number", illust_data.pageCount);
            
            page_manager.singleton().set_args(null, hash_args, false);
        }

        // If true, this is the first image we're displaying.
        var first_image_displayed = this.current_illust_id == -1;

        // If the illust ID isn't changing, just update the viewed page.
        if(illust_id == this.current_illust_id && this.viewer != null)
        {
            console.log("Image ID not changed, setting page", this.wanted_illust_page);
            this.viewer.page = this.wanted_illust_page;
            return;
        }

        // Speculatively load the next image, which is what we'll show if you press page down, so
        // advancing through images is smoother.
        //
        // We don't do this when showing the first image, since the most common case is simply
        // viewing a single image and not navigating to any others, so this avoids making
        // speculative loads every time you load a single illustration.
        if(!first_image_displayed)
        {
            // Let image_preloader handle speculative loading.  If preload_illust_id is null,
            // we're telling it that we don't need to load anything.
            var preload_illust_id = this.data_source.id_list.get_neighboring_illust_id(illust_id, this.latest_navigation_direction_down);
            image_preloader.singleton.set_speculative_image(preload_illust_id);
        }

        this.current_illust_id = illust_id;
        this.current_illust_data = illust_data;

        this.ui.illust_id = illust_id;

        this.refresh_ui();

        var illust_data = this.current_illust_data;
        
        // If the image has the ドット絵 tag, enable nearest neighbor filtering.
        helpers.set_class(document.body, "dot", helpers.tags_contain_dot(illust_data));

        // Dismiss any message when changing images.
        message_widget.singleton.hide();
       
        // If we're showing something else, remove it.
        if(this.viewer != null)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }

        this.manga_page_bar.set(null);

        var image_container = this.container.querySelector(".image-container");

        // Check if this image is muted.
        var muted_tag = muting.singleton.any_tag_muted(illust_data.tags.tags);
        var muted_user = muting.singleton.is_muted_user_id(illust_data.userId);

        if(muted_tag || muted_user)
        {
            // Tell the thumbnail view about the image.  If the image is muted, disable thumbs.
            this.manga_thumbnails.set_illust_info(null);

            // If the image is muted, load a dummy viewer.
            this.viewer = new viewer_muted(image_container, illust_data);
            return;
        }
     
        var manga_page = this.wanted_illust_page;
        if(manga_page == -1)
            manga_page = illust_data.pageCount - 1;

        // Tell the thumbnail view about the image.
        this.manga_thumbnails.set_illust_info(illust_data);
        this.manga_thumbnails.current_page_changed(manga_page);
        this.manga_thumbnails.snap_transition();

        // Create the image viewer.
        var progress_bar = this.progress_bar.controller();
        if(illust_data.illustType == 2)
            this.viewer = new viewer_ugoira(image_container, illust_data, this.seek_bar, function(value) {
                progress_bar.set(value);
            }.bind(this));
        else
        {
            this.viewer = new viewer_images(image_container, illust_data, {
                page_changed: this.shown_page_changed,
                progress_bar: progress_bar,
                manga_page_bar: this.manga_page_bar,
                manga_page: manga_page,
            });
        }

        // Refresh the UI now that we have a new viewer.
        this.refresh_ui();
    }

    // This is called when the page of a multi-page illustration sequence changes.
    shown_page_changed(page, total_pages, url)
    {
        // if we navigate down, then up quickly, undo any ongoing navigation to the
        // next image
        this.cancel_async_navigation();
        this.wanted_illust_id = this.current_illust_id;

        // Let the manga thumbnail display know about the selected page.
        this.manga_thumbnails.current_page_changed(page);

        this.refresh_ui();
    }

    data_source_updated()
    {
        this.refresh_ui();
    }

    get active()
    {
        return this._active;
    }

    set active(active)
    {
        if(this._active == active)
            return;

        this._active = active;
        this.container.hidden = !active;

        if(!active)
        {
            this.cancel_async_navigation();

            // Remove any image we're displaying, so if we show another image later, we
            // won't show the previous image while the new one's data loads.
            this.stop_displaying_image();
            
            return;
        }

        // If show_image was called while we were inactive, load it now.
        if(this.wanted_illust_id != this.current_illust_id || this.wanted_illust_page != this.viewer.page)
        {
            console.log("Showing illust_id", this.wanted_illust_id, "that was set while hidden");
            var wanted_illust_id = this.wanted_illust_id;
            var wanted_page = this.wanted_illust_page;

            // Show the image.  (this.wanted_illust_id was cleared by stop_displaying_image.)
            this.show_image(wanted_illust_id, wanted_page);
        }
        
        // If we're becoming active, refresh the UI, since we don't do that while we're inactive.
        this.refresh_ui();
    }

    // Refresh the UI for the current image.
    refresh_ui()
    {
        // Don't refresh if the thumbnail view is active.  We're not visible, and we'll just
        // step over its page title, etc.
        if(!this._active)
            return;
        
        // Pull out info about the user and illustration.
        var illust_id = this.current_illust_id;

        // Update the disable UI button to point at the current image's illustration page.
        var disable_button = this.container.querySelector(".disable-ui-button");
        disable_button.href = "/member_illust.php?mode=medium&illust_id=" + illust_id + "#no-ppixiv";

        // If we're not showing an image yet, hide the UI and don't try to update it.
        helpers.set_class(this.container.querySelector(".ui"), "disabled", illust_id == -1);
        if(illust_id == -1)
        {
            helpers.set_page_title("Loading...");
            return;
        }

        this.ui.refresh();

        var illust_data = this.current_illust_data;
        var user_data = illust_data.userInfo;

        var page_title = "";
        if(illust_data.bookmarkData)
            page_title += "★";
        page_title += user_data.name + " - " + illust_data.illustTitle;
        helpers.set_page_title(page_title);

        helpers.set_page_icon(user_data.isFollowed? binary_data['favorited_icon.png']:binary_data['regular_pixiv_icon.png']);
    }

    onwheel(e)
    {
        if(!this._active)
            return;        

        // Don't intercept wheel scrolling over the description box.
        if(e.target.closest(".description") != null)
            return;

        var down = e.deltaY > 0;
        this.move(down);
    }

    handle_onkeydown(e)
    {
        // Let the viewer handle the input first.
        if(this.viewer && this.viewer.onkeydown)
        {
            this.viewer.onkeydown(e);
            if(e.defaultPrevented)
                return;
        }

        this.ui.handle_onkeydown(e);
        if(e.defaultPrevented)
            return;
        
        if(e.keyCode == 66) // b
        {
            // b to bookmark publically, B to bookmark privately, ^B to remove a bookmark.
            //
            // Use a separate hotkey to remove bookmarks, rather than toggling like the bookmark
            // button does, so you don't have to check whether an image is bookmarked.  You can
            // just press B to bookmark without worrying about accidentally removing a bookmark
            // instead.
            e.stopPropagation();
            e.preventDefault();

            var illust_id = this.current_illust_id;
            var illust_data = this.current_illust_data;

            if(e.ctrlKey)
            {
                // Remove the bookmark.
                if(illust_data.bookmarkData == null)
                {
                    message_widget.singleton.show("Image isn't bookmarked");
                    return;
                }

                actions.bookmark_remove(this.current_illust_data);
                
                return;
            }

            if(illust_data.bookmarkData)
            {
                message_widget.singleton.show("Already bookmarked (^B to remove bookmark)");
                return;
            }
            
            actions.bookmark_add(illust_data, e.shiftKey /* private_bookmark */);
            
            return;
        }

        if(e.ctrlKey || e.altKey)
            return;

        switch(e.keyCode)
        {
        case 86: // l
            e.stopPropagation();
            actions.like_image(this.current_illust_data);
            
            return;

        case 37: // left
        case 38: // up
        case 33: // pgup
            e.preventDefault();
            e.stopPropagation();

            this.move(false);
            break;

        case 39: // right
        case 40: // down
        case 34: // pgdn
            e.preventDefault();
            e.stopPropagation();

            this.move(true);
            break;
        }
    }

    move(down)
    {
        // Remember whether we're navigating forwards or backwards, for preloading.
        this.latest_navigation_direction_down = down;

        this.cancel_async_navigation();

        // Let the viewer handle the input first.
        if(this.current_illust_data != null && this.current_illust_data.pageCount > 1)
        {
            var hash_args = helpers.get_hash_args(document.location);
            var page = parseInt(hash_args.get("page") || 0);
            page += down? +1:-1;

            page = Math.max(0, Math.min(this.current_illust_data.pageCount - 1, page));
            if(page != this.viewer.index)
            {
                this.main.show_manga_page(this.current_illust_id, page, false /* don't add to history */);

                // If we navigated down out of this image, then navigated up back through it
                // before the navigation happened, put this image back in the URL.
                this.main.show_illust_id(this.current_illust_id, false /* don't add to history */);
                return;
            }
        }

        // If we have a target illust_id, move relative to it.  Otherwise, move relative to the
        // displayed image.  This way, if we navigate repeatedly before a previous navigation
        // finishes, we'll keep moving rather than waiting for each navigation to complete.
        var navigate_from_illust_id = this.wanted_illust_id;
        if(navigate_from_illust_id == null)
            navigate_from_illust_id = this.current_illust_id;

        // Get the next (or previous) illustration after the current one.
        var new_illust_id = this.data_source.id_list.get_neighboring_illust_id(navigate_from_illust_id, down);
        console.log("move(): id", navigate_from_illust_id, "next", new_illust_id);
        console.log("    wanted", this.wanted_illust_id, "current", this.current_illust_id);
        if(new_illust_id == null)
        {
            // That page isn't loaded.  Try to load it.
            var next_page = this.data_source.id_list.get_page_for_neighboring_illust(navigate_from_illust_id, down);

            // If we can't find the next page, then the current image isn't actually loaded in
            // the current search results.  This can happen if the page is reloaded: we'll show
            // the previous image, but we won't have the results loaded (and the results may have
            // changed).  Just jump to the first image in the results so we get back to a place
            // we can navigate from.
            //
            // Note that we use id_list.get_first_id rather than get_current_illust_id, which is
            // just the image we're already on.
            if(next_page == null)
            {
                // We should normally know which page the illustration we're currently viewing is on.
                console.warn("Don't know the next page for illust", navigate_from_illust_id);
                new_illust_id = this.data_source.id_list.get_first_id();
                console.log("xxx", new_illust_id);
                this.main.show_illust_id(new_illust_id, false /* don't add to history */);
                return true;
            }

            console.log("Loading the next page of results:", next_page);

            // The page shouldn't already be loaded.  Double-check to help prevent bugs that might
            // spam the server requesting the same page over and over.
            if(this.data_source.id_list.is_page_loaded(next_page))
            {
                console.error("Page", next_page, "is already loaded");
                return;
            }

            // Ask the data source to load it.
            var pending_navigation = function()
            {
                // If this.pending_navigation is no longer set to this function, we navigated since
                // we requested this load and this navigation is stale, so stop.
                if(this.pending_navigation != pending_navigation)
                {
                    console.log("Aborting stale navigation");
                    return;
                }

                this.pending_navigation = null;

                // If we do have an image displayed, navigate up or down based on our most recent navigation
                // direction.  This simply retries the navigation now that we have data.
                console.log("Retrying navigation after data load");
                this.move(down);

            }.bind(this);
            this.pending_navigation = pending_navigation;

            if(!this.data_source.load_page(next_page, this.pending_navigation))
            {
                console.log("Reached the end of the list");
                return false;
            }

            return true;
        }

        // Show the new image.
        this.main.show_illust_id(new_illust_id, false /* don't add to history */);
        return true;
    }
}

