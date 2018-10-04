// The main UI.  This handles creating the viewers and the global UI.
class view_illust extends view
{
    constructor(container)
    {
        super();
        
        if(debug_show_ui) document.body.classList.add("force-ui");

        this.onwheel = this.onwheel.bind(this);
        this.refresh_ui = this.refresh_ui.bind(this);
        this.data_source_updated = this.data_source_updated.bind(this);

        this.current_illust_id = -1;
        this.latest_navigation_direction_down = true;
        this.container = container;

        this.progress_bar = main_controller.singleton.progress_bar;

        // Create a UI box and put it in its container.
        var ui_container = this.container.querySelector(".ui");
        this.ui = new image_ui(ui_container, this.progress_bar);
        
        var hover_circle = this.container.querySelector(".ui .hover-circle");
        var ui_box = this.container.querySelector(".ui-box");
        hover_circle.addEventListener("mouseover", (e) => { helpers.set_class(ui_box, "ui-visible", true); });
        hover_circle.addEventListener("mouseout", (e) => { helpers.set_class(ui_box, "ui-visible", false); });

        document.head.appendChild(document.createElement("title"));
        this.document_icon = document.head.appendChild(document.createElement("link"));
        this.document_icon.setAttribute("rel", "icon");
       
        image_data.singleton().user_modified_callbacks.register(this.refresh_ui);
        image_data.singleton().illust_modified_callbacks.register(this.refresh_ui);

        new hide_mouse_cursor_on_idle(this.container.querySelector(".image-container"));

        new refresh_bookmark_tag_widget(this.container.querySelector(".refresh-bookmark-tags"));
        // this.manga_thumbnails = new manga_thumbnail_widget(this.container.querySelector(".manga-thumbnail-container"));

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
    // If manga_page is -1, show the last page.
    async show_image(illust_id, manga_page)
    {
        // If we previously set a pending navigation, this navigation overrides it.
        this.cancel_async_navigation();

        // If we were already shown (we're not coming from the thumbnail view), and we're showing
        // the previous image from the one we were already showing, start at the end instead
        // of the beginning, so we'll start at the end when browsing backwards.
        var show_last_page = false;
        if(this.active && manga_page == null)
        {
            var next_illust_id = this.data_source.id_list.get_neighboring_illust_id(illust_id, true);
            show_last_page = (next_illust_id == this.wanted_illust_id);
            manga_page = show_last_page? -1:0;
        }
        
        // Remember that this is the image we want to be displaying.
        this.wanted_illust_id = illust_id;
        this.wanted_illust_page = manga_page;

        // If this image is already loaded, just make sure it's not hidden.
        if(illust_id == this.current_illust_id && this.wanted_illust_page == this.viewer.page && !this.viewer.hide_image)
        {
            console.log("illust_id", illust_id, "page", this.wanted_illust_page, "already displayed");
            return;
        }

        // If we're not active, stop.  We'll show this image if we become loaded later.
        if(!this.active)
        {
            // console.log("not active, set wanted id to", this.wanted_illust_id);
            return;
        }

        // Tell the preloader about the current image.
        image_preloader.singleton.set_current_image(illust_id);

        // Load info for this image if needed.
        var illust_data = await image_data.singleton().get_image_info_async(illust_id);

        // If this is no longer the image we want to be showing, stop.
        if(this.wanted_illust_id != illust_id)
        {
            console.log("show_image: illust ID changed while async, stopping");
            return;
        }

        // If manga_page is -1, we didn't know the page count when we did the navigation
        // and we want the last page.  Otherwise, just make sure the page is in range.
        if(manga_page == -1)
            manga_page = illust_data.pageCount - 1;
        else
            manga_page = helpers.clamp(manga_page, 0, illust_data.pageCount-1);

        console.log("Showing image", illust_id, "page", manga_page);

        // If we adjusted the page, update the URL.  For single-page posts, there should be
        // no page field.
        var args = helpers.get_args(document.location);
        var wanted_page_arg = illust_data.pageCount > 1? (manga_page + 1).toString():null;
        if(args.hash.get("page") != wanted_page_arg)
        {
            if(wanted_page_arg != null)
                args.hash.set("page", wanted_page_arg);
            else
                args.hash.delete("page");

            console.log("Updating URL with page number:", args.hash.toString());
            helpers.set_args(args, false /* add_to_history */);
        }

        // If true, this is the first image we're displaying.
        var first_image_displayed = this.current_illust_id == -1;

        // If the illust ID isn't changing, just update the viewed page.
        if(illust_id == this.current_illust_id && this.viewer != null)
        {
            console.log("Image ID not changed, setting page", this.wanted_illust_page);
            this.viewer.page = this.wanted_illust_page;
            if(this.manga_thumbnails)
                this.manga_thumbnails.current_page_changed(manga_page);
            this.viewer.hide_image = false;

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

        var image_container = this.container.querySelector(".image-container");

        // Check if this image is muted.
        var muted_tag = muting.singleton.any_tag_muted(illust_data.tags.tags);
        var muted_user = muting.singleton.is_muted_user_id(illust_data.userId);

        if(muted_tag || muted_user)
        {
            // Tell the thumbnail view about the image.  If the image is muted, disable thumbs.
            if(this.manga_thumbnails)
                this.manga_thumbnails.set_illust_info(null);

            // If the image is muted, load a dummy viewer.
            this.viewer = new viewer_muted(image_container, illust_data);
            return;
        }
     
        var manga_page = this.wanted_illust_page;
        if(manga_page == -1)
            manga_page = illust_data.pageCount - 1;

        // Tell the thumbnail view about the image.
        if(this.manga_thumbnails)
        {
            this.manga_thumbnails.set_illust_info(illust_data);
            this.manga_thumbnails.snap_transition();

            // Let the manga thumbnail display know about the selected page.
            this.manga_thumbnails.current_page_changed(manga_page);
        }

        // Create the image viewer.
        var progress_bar = this.progress_bar.controller();
        if(illust_data.illustType == 2)
            this.viewer = new viewer_ugoira(image_container, illust_data, this.seek_bar, function(value) {
                progress_bar.set(value);
            }.bind(this));
        else
        {
            this.viewer = new viewer_images(image_container, illust_data, {
                image_finished_loading: this.refresh_ui,
                progress_bar: progress_bar,
                manga_page_bar: this.manga_page_bar,
                manga_page: manga_page,
            });
        }

        // Refresh the UI now that we have a new viewer.
        this.refresh_ui();
    }

    // If we started navigating to a new image and were delayed to load data (either to load
    // the image or to load a new page), cancel it and stay where we are.
    cancel_async_navigation()
    {
        // If we previously set a pending navigation, this navigation overrides it.
        if(this.pending_navigation == null)
            return;

        console.info("Cancelling async navigation");
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

        if(this.manga_thumbnails)
            this.manga_thumbnails.set_illust_info(null);
        
        this.wanted_illust_id = null;

        // The manga page to show, or the last page if -1.
        this.wanted_illust_page = 0;
        this.current_illust_id = -1;
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
            console.log("Hide illust,", this.viewer != null);
            this.cancel_async_navigation();

            // Remove any image we're displaying, so if we show another image later, we
            // won't show the previous image while the new one's data loads.
            if(this.viewer != null)
                this.viewer.hide_image = true;
            
            return;
        }

        // If show_image was called while we were inactive, load it now.
        if(this.wanted_illust_id != this.current_illust_id || this.wanted_illust_page != this.viewer.page || this.viewer.hide_image)
        {
            // Show the image.
            console.log("Showing illust_id", this.wanted_illust_id, "that was set while hidden");
            this.show_image(this.wanted_illust_id, this.wanted_illust_page);
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
        
        // Tell the UI the image resolution.
        var page = this.viewer != null && this.viewer.page;
        var width = this.viewer != null && this.viewer.current_image_width;
        var height = this.viewer != null && this.viewer.current_image_height;
        this.ui.set_displayed_page_info(page, width, height);

        // Pull out info about the user and illustration.
        var illust_id = this.current_illust_id;

        // Update the disable UI button to point at the current image's illustration page.
        var disable_button = this.container.querySelector(".disable-ui-button");
        disable_button.href = "/member_illust.php?mode=medium&illust_id=" + illust_id + "#no-ppixiv";

        // If we're not showing an image yet, hide the UI and don't try to update it.
        helpers.set_class(this.container.querySelector(".ui"), "disabled", illust_id == -1);

        helpers.set_title_and_icon(this.current_illust_data);

        if(illust_id == -1)
            return;

        this.ui.refresh();
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

    get displayed_illust_id()
    {
        return this.wanted_illust_id;        
    }

    get displayed_illust_page()
    {
        return this.wanted_illust_page;
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
        
        if(e.ctrlKey || e.altKey)
            return;

        switch(e.keyCode)
        {
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

    async move(down)
    {
        // Remember whether we're navigating forwards or backwards, for preloading.
        this.latest_navigation_direction_down = down;

        this.cancel_async_navigation();

        // See if we should change the manga page.
        if(this.current_illust_data != null && this.current_illust_data.pageCount > 1)
        {
            var old_page = this.wanted_illust_page;
            console.log("navigate", down, "from", old_page);
            var new_page = old_page + (down? +1:-1);
            new_page = Math.max(0, Math.min(this.current_illust_data.pageCount - 1, new_page));
            if(new_page != old_page)
            {
                main_controller.singleton.show_illust(this.current_illust_id, {
                    manga_page: new_page,
                });
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
        if(new_illust_id != null)
        {
            // Show the new image.
            main_controller.singleton.show_illust(new_illust_id);
            return true;

        }

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
            main_controller.singleton.show_illust(new_illust_id);
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
        var pending_navigation = this.pending_navigation = new Object();
        if(!await this.data_source.load_page(next_page))
        {
            console.log("Reached the end of the list");
            return false;
        }

        // If this.pending_navigation is no longer set to this function, we navigated since
        // we requested this load and this navigation is stale, so stop.
        if(this.pending_navigation != pending_navigation)
        {
            console.error("Aborting stale navigation");
            return;
        }

        this.pending_navigation = null;

        // If we do have an image displayed, navigate up or down based on our most recent navigation
        // direction.  This simply retries the navigation now that we have data.
        console.log("Retrying navigation after data load");
        await this.move(down);

        return true;
    }
}

