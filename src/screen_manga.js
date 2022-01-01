"use strict";

// A full page viewer for manga thumbnails.
//
// This is similar to the main search view.  It doesn't share code, since it
// works differently enough that it would complicate things too much.
ppixiv.screen_manga = class extends ppixiv.screen
{
    constructor(options)
    {
        super(options);

        this.refresh_ui = this.refresh_ui.bind(this);
        this.window_onresize = this.window_onresize.bind(this);
        this.refresh_count = 0;

        window.addEventListener("resize", this.window_onresize);

        this.scroll_container = this.container.querySelector(".search-results");

        this.scroll_container.addEventListener("scroll", (e) => {
            this.schedule_store_scroll_position();
        }, {
            passive: true,
        });

        // If the "view muted image" button is clicked, add view-muted to the URL.
        this.container.querySelector(".view-muted-image").addEventListener("click", (e) => {
            let args = helpers.args.location;
            args.hash.set("view-muted", "1");
            helpers.set_page_url(args, false /* add_to_history */, "override-mute");
        });

        this.progress_bar = main_controller.singleton.progress_bar;
        this.ui = new image_ui({
            container: this.container.querySelector(".ui-container"),
            parent: this,
            progress_bar: this.progress_bar,
        });
        
        image_data.singleton().user_modified_callbacks.register(this.refresh_ui);
        image_data.singleton().illust_modified_callbacks.register(this.refresh_ui);

        settings.register_change_callback("manga-thumbnail-size", this.refresh_ui);
        
        // Zoom the thumbnails on ctrl-mousewheel:
        this.container.addEventListener("wheel", (e) => {
            if(!e.ctrlKey)
                return;
    
            e.preventDefault();
            e.stopImmediatePropagation();
    
            settings.adjust_zoom("manga-thumbnail-size", e.deltaY > 0);
        }, { passive: false });
            
        this.container.addEventListener("keydown", (e) => {
            let zoom = helpers.is_zoom_hotkey(e);
            if(zoom != null)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                settings.adjust_zoom("manga-thumbnail-size", zoom < 0);
            }
        });

        // Create a style for our thumbnail style.
        this.thumbnail_dimensions_style = helpers.create_style("");
        document.body.appendChild(this.thumbnail_dimensions_style);

        this.set_active(false, { });
    }

    window_onresize(e)
    {
        if(!this._active)
            return;
        
        this.refresh_ui();
    }

    async set_active(active, { media_id, old_media_id })
    {
        if(this._active == active && this.media_id == media_id)
            return;

        let was_active = this._active;
        this._active = active;

        if(this.media_id != media_id)
        {
            // The load itself is async and might not happen immediately if we don't have page info yet.
            // Clear any previous image list so it doesn't flash on screen while we load the new info.
            let ul = this.container.querySelector(".thumbnails");
            helpers.remove_elements(ul);

            this.media_id = media_id;
            this.illust_info = null;
            this.ui.media_id = media_id;

            // Refresh even if media_id is null, so we quickly clear the screen.
            await this.refresh_ui();
        }

        if(this._active && !active)
        {
            // Hide the dropdown tag widget.
            this.ui.bookmark_tag_widget.visible = false;

            // Stop showing the user in the context menu.
            main_context_menu.get.user_id = null;
        }

        this._active = active;
        this.ui.visible = active;

        // This will hide or unhide us.
        await super.set_active(active);

        if(!active || this.media_id == null)
            return;
        
        // The rest of the load happens async.  Although we're already in an async
        // function, it should return without waiting for API requests.
        this.async_set_image(old_media_id);

        // Focus the container, so it receives keyboard events like home/end.
        this.container.querySelector(".search-results").focus();
    }
    
    async async_set_image(old_media_id)
    {
        console.log("Loading manga screen for:", this.media_id);

        // Load image info.
        let media_id = this.media_id;
        var illust_info = await image_data.singleton().get_media_info(this.media_id);
        if(media_id != this.media_id)
            return;

        this.illust_info = illust_info;

        await this.refresh_ui();

        this.restore_scroll_pos(old_media_id)
    }

    get view_muted()
    {
        return helpers.args.location.hash.get("view-muted") == "1";
    }

    should_hide_muted_image()
    {
        let muted_tag = muting.singleton.any_tag_muted(this.illust_info.tagList);
        let muted_user = muting.singleton.is_muted_user_id(this.illust_info.userId);
        if(this.view_muted || (!muted_tag && !muted_user))
            return { is_muted: false };

        return { is_muted: true, muted_tag: muted_tag, muted_user: muted_user };
    }
    
    update_mute()
    {
        // Check if this post is muted.
        let { is_muted, muted_tag, muted_user } = this.should_hide_muted_image();
        this.hiding_muted_image = this.view_muted;
        this.container.querySelector(".muted-text").hidden = !is_muted;
        if(!is_muted)
            return false;

        let muted_label = this.container.querySelector(".muted-label");
        if(muted_tag)
            tag_translations.get().set_translated_tag(muted_label, muted_tag);
        else if(muted_user)
            muted_label.innerText = this.illust_info.userName;

        return true;
    }

    refresh_ui = async () =>
    {
        if(!this._active)
            return;
        
        helpers.set_title_and_icon(this.illust_info);

        var original_scroll_top = this.container.scrollTop;

        var ul = this.container.querySelector(".thumbnails");
        helpers.remove_elements(ul);

        if(this.illust_info == null)
            return;

        // Tell the context menu which user is being viewed.
        main_context_menu.get.user_id = this.illust_info.userId;

        if(this.update_mute())
            return;

        // Get the aspect ratio to crop images to.
        var ratio = this.get_display_aspect_ratio(this.illust_info.mangaPages);
        let thumbnail_size = settings.get("manga-thumbnail-size", 4);
        thumbnail_size = thumbnail_size_slider_widget.thumbnail_size_for_value(thumbnail_size);

        let [css, column_count] = helpers.make_thumbnail_sizing_style(ul, ".screen-manga-container", {
            wide: true,
            size: thumbnail_size,
            ratio: ratio,

            // We preload this page anyway since it doesn't cause a lot of API calls, so we
            // can allow a high column count and just let the size take over.
            max_columns: 15,
        });

        this.thumbnail_dimensions_style.textContent = css;

        for(var page = 0; page < this.illust_info.mangaPages.length; ++page)
        {
            var manga_page = this.illust_info.mangaPages[page];
            
            var entry = this.create_thumb(page, manga_page);
            helpers.set_thumbnail_panning_direction(entry, manga_page.width, manga_page.height, ratio);
            
            ul.appendChild(entry);
        }
        
        // Restore the value of scrollTop from before we updated.  For some reason, Firefox
        // modifies scrollTop after we add a bunch of items, which causes us to scroll to
        // the wrong position, even though scrollRestoration is disabled.
        this.container.scrollTop = original_scroll_top;
    }

    get active()
    {
        return this._active;
    }
    
    get displayed_media_id()
    {
        return this.media_id;
    }

    // Navigating out goes back to the search.
    get navigate_out_target() { return "search"; }

    // Given a list of manga infos, return the aspect ratio we'll crop them to.
    get_display_aspect_ratio(manga_info)
    {
        // A lot of manga posts use the same resolution for all images, or just have
        // one or two exceptions for things like title pages.  If most images have
        // about the same aspect ratio, use it.
        var total = 0;
        for(var manga_page of manga_info)
            total += manga_page.width / manga_page.height;
        var average_aspect_ratio = total / manga_info.length;

        var illusts_far_from_average = 0;
        for(var manga_page of manga_info)
        {
            var ratio = manga_page.width / manga_page.height;
            if(Math.abs(average_aspect_ratio - ratio) > 0.1)
                illusts_far_from_average++;
        }

        // If we didn't find a common aspect ratio, just use square thumbs.
        if(illusts_far_from_average > 3)
            return 1;
        else
            return average_aspect_ratio;
    }

    get_display_resolution(width, height)
    {
        var fit_width = 300;
        var fit_height = 300;

        var ratio = width / fit_width;
        if(ratio > 1)
        {
            height /= ratio;
            width /= ratio;
        }

        var ratio = height / fit_height;
        if(ratio > 1)
        {
            height /= ratio;
            width /= ratio;
        }

        return [width, height];
    }

    create_thumb(page_idx, manga_page)
    {
        let element = this.create_template({name: "manga-view-thumbnail", html: `
            <div class=thumbnail-box>
                <div class=thumbnail-inner>
                    <a class=thumbnail-link href=#>
                        <img class=thumb>
                    </a>
                </div>
            </div>
        `});

        // These URLs should be the 540x540_70 master version, which is a non-squared high-res
        // thumbnail.  These tend to be around 30-40k, so loading a full manga set of them is
        // quick.
        //
        // XXX: switch this to 540x540_10_webp in Chrome, around 5k?
        var thumb = element.querySelector(".thumb");
        var url = manga_page.urls.small;
//        url = url.replace("/540x540_70/", "/540x540_10_webp/");
        thumb.src = url;
       
        var size = this.get_display_resolution(manga_page.width, manga_page.height);
        thumb.width = size[0];
        thumb.height = size[1];
        
        let id = helpers.parse_media_id(this.media_id);
        id.page = page_idx;
        let page_media_id = helpers.encode_media_id(id);

        let link = element.querySelector("a.thumbnail-link");
        link.dataset.mediaId = page_media_id;

        element.dataset.id = page_media_id;

        link.href = helpers.get_url_for_id(page_media_id, page_idx+1);

        // We don't use intersection checking for the manga view right now.  Mark entries
        // with all of the "image onscreen" tags.
        element.dataset.nearby = true;
        element.dataset.fartherAway = true;
        element.dataset.fullyOnScreen = true;

        return element;
    }

    restore_scroll_pos(old_media_id)
    {
        // Handle scrolling for the new state.
        if(old_media_id != null)
        {
            // If we're navigating backwards or toggling, and we're switching from the image UI to thumbnails,
            // try to scroll the search screen to the image that was displayed.
            if(this.scroll_to_media_id(old_media_id))
            {
                console.log("Restored scroll position to:", old_media_id);
                return;
            }
        }

        let args = helpers.args.location;
        if(args.state.scroll_position == null)
        {
            console.log("Scroll to top for new search");
            this.container.scrollTop = 0;
            return;
        }

        // Restore the scroll position from history.
        this.scroll_container.scrollTop = args.state.scroll_position;
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
        args.state.scroll_position = this.scroll_container.scrollTop;
        console.log(args.state);
        helpers.set_page_url(args, false, "viewing-page", { send_popstate: false });
    }

    scroll_to_media_id(media_id)
    {
        if(media_id == null)
            return false;

        let thumb = this.container.querySelector(`[data-id="${helpers.escape_selector(media_id)}"]`);
        if(thumb == null)
            return false;

        // If the item isn't visible, center it.
        let scroll_pos = this.scroll_container.scrollTop;
        if(thumb.offsetTop < scroll_pos || thumb.offsetTop + thumb.offsetHeight > scroll_pos + this.scroll_container.offsetHeight)
            this.scroll_container.scrollTop = thumb.offsetTop + thumb.offsetHeight/2 - this.scroll_container.offsetHeight/2;
        return true;
    }

    handle_onkeydown(e)
    {
        this.ui.handle_onkeydown(e);
    }    
}

