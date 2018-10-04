// The search UI.
class view_search extends view
{
    constructor(container)
    {
        super();
        
        this.thumbs_loaded = this.thumbs_loaded.bind(this);
        this.data_source_updated = this.data_source_updated.bind(this);
        this.onwheel = this.onwheel.bind(this);
        this.onscroll = this.onscroll.bind(this);
//        this.onmousemove = this.onmousemove.bind(this);
        this.submit_search = this.submit_search.bind(this);
        this.refresh_thumbnail = this.refresh_thumbnail.bind(this);
        this.refresh_images = this.refresh_images.bind(this);
        this.window_onresize = this.window_onresize.bind(this);
        this.update_from_settings = this.update_from_settings.bind(this);

        this.container = container;
        this.active = false;

        window.addEventListener("thumbnailsLoaded", this.thumbs_loaded);
        window.addEventListener("resize", this.window_onresize);

        this.container.addEventListener("wheel", this.onwheel);
//        this.container.addEventListener("mousemove", this.onmousemove);

        this.container.addEventListener("scroll", this.onscroll);
        window.addEventListener("resize", this.onscroll);

        // When a bookmark is modified, refresh the heart icon.
        image_data.singleton().illust_modified_callbacks.register(this.refresh_thumbnail);

        this.thumbnail_dimensions_style = document.createElement("style");
        document.body.appendChild(this.thumbnail_dimensions_style);
        
        // Create the avatar widget shown on the artist data source.
        this.avatar_widget = new avatar_widget({
            parent: this.container.querySelector(".avatar-container"),
            changed_callback: this.data_source_updated,
            big: true,
        });
        
        // Create the tag widget used by the search data source.
        this.tag_widget = new tag_widget({
            parent: this.container.querySelector(".related-tag-list"),
            format_link: function(tag)
            {
                // The recommended tag links are already on the search page, and retain other
                // search settings.
                var url = new URL(window.location);
                url.searchParams.set("word", tag.tag);
                url.searchParams.delete("p");
                return url.toString();
            }.bind(this),
        });

        // Don't scroll thumbnails when scrolling tag dropdowns.
        // FIXME: This works on member-tags-box, but not reliably on search-tags-box, even though
        // they seem like the same thing.
        this.container.querySelector(".member-tags-box .post-tag-list").addEventListener("scroll", function(e) { e.stopPropagation(); }, true);
        this.container.querySelector(".search-tags-box .related-tag-list").addEventListener("scroll", function(e) { e.stopPropagation(); }, true);

        // Set up hover popups.
        helpers.setup_popups(this.container, [".navigation-menu-box", ".thumbnail-settings-menu-box", ".ages-box", ".popularity-box", ".type-box", ".search-mode-box", ".size-box", ".aspect-ratio-box", ".bookmarks-box", ".time-box", ".member-tags-box", ".search-tags-box"]);

        // Fill in the default value for the search page.  We don't do this in refresh_thumbnail_ui
        // since we don't want to clobber the user's edits later.  Only do this with the search box
        // on the search page, not the one in the navigation dropdown.
        var tag = new URL(document.location).searchParams.get("word");
        if(tag != null)
            this.container.querySelector(".search-page-tag-entry .search-tags").value = tag;

        
        helpers.input_handler(this.container.querySelector(".search-page-tag-entry .search-tags"), this.submit_search);
        helpers.input_handler(this.container.querySelector(".navigation-search-box .search-tags"), this.submit_search);

        this.container.querySelector(".search-page-tag-entry .search-submit-button").addEventListener("click", this.submit_search);
        this.container.querySelector(".navigation-search-box .search-submit-button").addEventListener("click", this.submit_search);

        var settings_menu = this.container.querySelector(".settings-menu-box > .popup-menu-box");

        this.thumbnail_size_slider = new thumbnail_size_slider_widget(settings_menu, {
            label: "Thumbnail size",
            setting: "thumbnail-size",
            input_container: this.container,
            onchange: this.refresh_images,
            min: 0,
            max: 5,
        });

        new menu_option_toggle_light_theme(settings_menu, {
            label: "Light mode",
            setting: "theme",
            onchange: this.update_from_settings,
        });

        new menu_option_toggle(settings_menu, {
            label: "Thumbnail zooming",
            setting: "disable_thumbnail_zooming",
            onchange: this.update_from_settings,
            invert_display: true,
        });

        new menu_option_toggle(settings_menu, {
            label: "Thumbnail panning",
            setting: "disable_thumbnail_panning",
            onchange: this.update_from_settings,
            invert_display: true,
        });

        // Create the tag dropdown for the search page input.
        new tag_search_dropdown_widget(this.container.querySelector(".tag-search-box .search-tags"));
            
        // Create the tag dropdown for the search input in the menu dropdown.
        new tag_search_dropdown_widget(this.container.querySelector(".navigation-search-box .search-tags"));

        this.update_from_settings();
        this.refresh_images();
        this.load_needed_thumb_data();
    }

    window_onresize(e)
    {
        if(!this.active)
            return;

        this.refresh_images();
    }

    submit_search(e)
    {
        // This can be sent to either the search page search box or the one in the
        // navigation dropdown.  Figure out which one we're on.
        var search_box = e.target.closest(".search-box");
        var tags = search_box.querySelector(".search-tags").value.trim();
        if(tags.length == 0)
            return;

        // Add this tag to the recent search list.
        helpers.add_recent_search_tag(tags);

        // Run the search.
        helpers.set_page_url(page_manager.singleton().get_url_for_tag_search(tags), true);
    }

    /* This scrolls the thumbnail when you hover over it.  It's sort of neat, but it's pretty
     * choppy, and doesn't transition smoothly when the mouse first hovers over the thumbnail,
     * causing it to pop to a new location. 
    onmousemove(e)
    {
        var thumb = e.target.closest(".thumbnail-box a");
        if(thumb == null)
            return;

        var bounds = thumb.getBoundingClientRect();
        var x = e.clientX - bounds.left;
        var y = e.clientY - bounds.top;
        x = 100 * x / thumb.offsetWidth;
        y = 100 * y / thumb.offsetHeight;

        var img = thumb.querySelector("img.thumb");
        img.style.objectPosition = x + "% " + y + "%";
    }
*/
    onwheel(e)
    {
        // Stop event propagation so we don't change images on any viewer underneath the thumbs.
        e.stopPropagation();
    };

    onscroll(e)
    {
        this.load_needed_thumb_data();
    };

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        if(this.data_source != null)
        {
            this.data_source.remove_update_listener(this.data_source_updated);

            // Store our scroll position on the data source, so we can restore it if it's
            // reactivated.  There's only one instance of thumbnail_view, so this is safe.
            this.data_source.thumbnail_view_scroll_pos = this.container.scrollTop;
        }

        this.data_source = data_source;

        if(this.data_source == null)
            return;
        
        // If we disabled loading more pages earlier, reenable it.
        this.disable_loading_more_pages = false;

        // Listen to the data source loading new pages, so we can refresh the list.
        this.data_source.add_update_listener(this.data_source_updated);

        this.refresh_images();
        this.load_needed_thumb_data();

        this.refresh_ui();
    };

    restore_scroll_position()
    {
        // If we saved a scroll position when navigating away from a data source earlier,
        // restore it now.  Only do this once.
        if(this.data_source.thumbnail_view_scroll_pos != null)
        {
            this.container.scrollTop = this.data_source.thumbnail_view_scroll_pos;
            delete this.data_source.thumbnail_view_scroll_pos;
        }
        else
            this.scroll_to_top();
    }

    scroll_to_top()
    {
        this.container.scrollTop = 0;
    }

    refresh_ui()
    {
        if(!this.active)
            return;

        var page_title = this.data_source.page_title || "Loading...";
        document.querySelector("title").textContent = page_title;
        
        var element_displaying = this.container.querySelector(".displaying");
        element_displaying.hidden = this.data_source.get_displaying_text == null;
        if(this.data_source.get_displaying_text != null)
            element_displaying.innerText = this.data_source.get_displaying_text();

        // Set the regular icon.  The data source might change it to something else.
        helpers.set_page_icon(binary_data['regular_pixiv_icon.png']);
        
        this.refresh_ui_for_user_id();

        var ui_box = this.container.querySelector(".thumbnail-ui-box");
        this.data_source.refresh_thumbnail_ui(ui_box, this);
    };

    // Update UI that requires user info for a user we're viewing.
    //
    // We want to update this like any other UI, automatically refreshing it if the
    // user ID changes, but we may need to make a user info request to fill this in.
    refresh_ui_for_user_info(user_info)
    {
        // Set the bookmarks link.
        var bookmarks_link = this.container.querySelector(".bookmarks-link");
        bookmarks_link.hidden = user_info == null;
        if(user_info != null)
        {
            var bookmarks_url = "/bookmark.php?id=" + user_info.userId + "&rest=show#ppixiv";
            bookmarks_link.href = bookmarks_url;
            bookmarks_link.dataset.popup = user_info? ("View " + user_info.name + "'s bookmarks"):"View bookmarks";
        }

        // Set the webpage link.
        var webpage_url = user_info && user_info.webpage;
        var webpage_link = this.container.querySelector(".webpage-link");
        webpage_link.hidden = webpage_url == null;
        if(webpage_url != null)
            webpage_link.href = webpage_url;

        // Set the twitter link.
        var twitter_url = user_info && user_info.social && user_info.social.twitter && user_info.social.twitter.url;
        var twitter_link = this.container.querySelector(".twitter-icon");
        twitter_link.hidden = twitter_url == null;
        if(twitter_url != null)
        {
            twitter_link.href = twitter_url;
            var path = new URL(twitter_url).pathname;
            var parts = path.split("/");
            twitter_link.dataset.popup = parts.length > 1? ("@" + parts[1]):"Twitter";
        }

        // Set the "send a message" link.
        var contact_link = this.container.querySelector(".contact-link");
        contact_link.hidden = user_info == null;
        if(user_info != null)
            contact_link.href = "/messages.php?receiver_id=" + user_info.userId;
    }

    // Call refresh_ui_for_user_info with the user_info for the user we're viewing,
    // if the user ID has changed.
    refresh_ui_for_user_id()
    {
        var user_id = this.data_source.viewing_user_id;
        if(user_id == this.last_updated_user_id)
            return;

        this.last_updated_user_id = user_id;

        // If there's no user, or if we're viewing ourself (our own bookmarks page),
        // just hide the user-related UI.
        if(user_id == null || user_id == window.global_data.user_id)
        {
            this.refresh_ui_for_user_info(null);
            return;
        }

        image_data.singleton().get_user_info_full(user_id, function(user_info) {
            // If last_updated_user_id changed since we started this request, the user ID
            // changed and we started a different request.
            if(this.last_updated_user_id != user_id)
                return;

            this.refresh_ui_for_user_info(user_info);
        }.bind(this));
    }

    set active(active)
    {
        if(this.active == active)
            return;

        this._active = active;

        this.container.hidden = !active;

        if(active)
        {
            this.refresh_ui();

            // Refresh the images now, so it's possible to scroll to entries, but wait to start
            // loading data to give the caller a chance to call scroll_to_illust_id(), which needs
            // to happen after refresh_images but before load_needed_thumb_data.  This way, if
            // we're showing a page far from the top, we won't load the first page that we're about
            // to scroll away from.
            this.refresh_images();

            setTimeout(function() {
                this.load_needed_thumb_data();
            }.bind(this), 0);
        }
        else
        {
            this.stop_pulsing_thumbnail();
        }
    }

    get active()
    {
        return this._active;
    }

    data_source_updated()
    {
        this.refresh_images();
        this.load_needed_thumb_data();
        this.refresh_ui();
    }

    // Recreate thumbnail images (the actual <img> elements).
    //
    // This is done when new pages are loaded, to create the correct number of images.
    // We don't need to do this when scrolling around or when new thumbnail data is available.
    refresh_images()
    {
        // Remove all existing entries and collect them.
        var ul = this.container.querySelector("ul.thumbnails");
        var original_scroll_top = this.container.scrollTop;

        // Make a list of [illust_id, page] thumbs to add.
        var images_to_add = [];
        if(this.data_source != null)
        {
            var id_list = this.data_source.id_list;
            var max_page = id_list.get_highest_loaded_page();
            var items_per_page = this.data_source.estimated_items_per_page;
            for(var page = 1; page <= max_page; ++page)
            {
                var illust_ids = id_list.illust_ids_by_page[page];
                if(illust_ids == null)
                {
                    // This page isn't loaded.  Fill the gap with items_per_page blank entries.
                    for(var idx = 0; idx < items_per_page; ++idx)
                        images_to_add.push([null, page]);
                    continue;
                }

                // Create an image for each ID.
                for(var illust_id of illust_ids)
                    images_to_add.push([illust_id, page]);
            }
        }

        // Remove next-page-placeholder while we repopulate.  It's a little different from the other
        // thumbs since it doesn't represent a real entry, so it just complicates the refresh logic.
        var old_placeholder = ul.querySelector(".next-page-placeholder");
        if(old_placeholder)
            ul.removeChild(old_placeholder);

        // Add thumbs.
        //
        // Most of the time we're just adding thumbs to the list.  Avoid removing or recreating
        // thumbs that aren't actually changing, which reduces flicker when adding entries and
        // avoids resetting thumbnail animations.  Do this by looking at the next node in the
        // list and seeing if it matches what we're adding.  When we're done, next_node will
        // point to the first entry that wasn't reused, and we'll remove everything from there onward.
        var next_node = ul.firstElementChild;

        for(var pair of images_to_add)
        {
            var illust_id = pair[0];
            var page = pair[1];

            if(next_node)
            {
                // If the illust_id matches, reuse the entry.  This includes the case where illust_id is
                // null for unloaded page placeholders and we're inserting an identical placeholder.
                if(next_node.dataset.illust_id == illust_id)
                {
                    next_node.dataset.page = page;
                    next_node = next_node.nextElementSibling;
                    continue;
                }

                // If the next node has no illust_id, it's an unloaded page placeholder.  If we're refreshing
                // and now have real entries for that page, we can reuse the placeholders for the real thumbs.
                if(next_node.dataset.illust_id == null && next_node.dataset.page == page)
                {
                    next_node.dataset.illust_id = illust_id;
                    next_node.dataset.page = page;
                    next_node = next_node.nextElementSibling;
                    continue;
                }
            }

            var entry = this.create_thumb(illust_id, page);
            
            // If next_node is null, we've used all existing nodes, so add to the end.  Otherwise,
            // insert before next_node.
            if(next_node != null)
                ul.insertBefore(entry, next_node);
            else
                ul.appendChild(entry);
            
            next_node = entry.nextElementSibling;
        }

        // Remove any images that we didn't use.
        var first_element_to_delete = next_node;
        while(first_element_to_delete != null)
        {
            var next = first_element_to_delete.nextElementSibling;
            ul.removeChild(first_element_to_delete);
            first_element_to_delete = next;
        }

        if(this.data_source != null)
        {
            // Add one dummy thumbnail at the end to represent future images.  If we have one page and
            // this scrolls into view, that tells us we're scrolled near the bottom and should try to
            // load page 2.
            var entry = this.create_thumb(null, max_page+1);
            entry.classList.add("next-page-placeholder");
            entry.hidden = this.disable_loading_more_pages;
            ul.appendChild(entry);
        }

        if(this.container.offsetWidth == 0)
            return;


        this.thumbnail_dimensions_style.textContent = helpers.make_thumbnail_sizing_style(ul, ".view-search-container", {
            wide: true,
            size: this.thumbnail_size_slider.thumbnail_size,
            max_columns: 5,

            // Set a minimum padding to make sure there's room for the popup text to fit between images.
            min_padding: 15,
        });




        // Restore the value of scrollTop from before we updated.  For some reason, Firefox
        // modifies scrollTop after we add a bunch of items, which causes us to scroll to
        // the wrong position, even though scrollRestoration is disabled.
        this.container.scrollTop = original_scroll_top;
    }

    // Start loading data pages that we need to display visible thumbs, and start
    // loading thumbnail data for nearby thumbs.
    //
    // FIXME: throttle loading pages if we scroll around quickly, so if we scroll
    // down a lot we don't load 10 pages of data
    load_needed_thumb_data()
    {
        // elements is a list of elements that are onscreen (or close to being onscreen).
        // We want thumbnails loaded for these, even if we need to load more thumbnail data.
        //
        // nearby_elements is a list of elements that are a bit further out.  If we load
        // thumbnail data for elements, we'll load these instead.  That way, if we scroll
        // up a bit and two more thumbs become visible, we'll load a bigger chunk.
        // That way, we make fewer batch requests instead of requesting two or three
        // thumbs at a time.

        // Make a list of pages that we need loaded, and illustrations that we want to have
        // set.
        var new_pages = [];
        var wanted_illust_ids = [];
        var need_thumbnail_data = false;

        var elements = this.get_visible_thumbnails(false);
        for(var element of elements)
        {
            if(element.dataset.illust_id == null)
            {
                // This is a placeholder image for a page that isn't loaded, so load the page.
                if(new_pages.indexOf(element.dataset.page) == -1)
                    new_pages.push(element.dataset.page);
            }
            else
            {
                wanted_illust_ids.push(element.dataset.illust_id);
            }
        }

        for(var page of new_pages)
        {
            console.log("Load page", page, "for thumbnails");

            var result = this.data_source.load_page(page);

            // If this page didn't load, it probably means we've reached the end.  Hide
            // the next-page-placeholder image so we don't keep trying to load more pages.
            // This won't prevent us from loading earlier pages.
            if(!result)
            {
                this.disable_loading_more_pages = true;

                // If this is the first page and there are no results, then there are no images
                // for this search.
                if(page == 1)
                {
                    console.log("No results on page 1.  Showing no results");
                    message_widget.singleton.show("No results");
                    message_widget.singleton.center();
                    message_widget.singleton.clear_timer();
                }
                
                console.log("stop");
            }

            // We could load more pages, but let's just load one at a time so we don't spam
            // requests too quickly.  Once this page loads we'll come back here and load
            // another if needed.
            break;
        }

        if(!thumbnail_data.singleton().are_all_ids_loaded_or_loading(wanted_illust_ids))
        {
            // At least one visible thumbnail needs to be loaded, so load more data at the same
            // time.
            var nearby_elements = this.get_visible_thumbnails(true);

            var nearby_illust_ids = [];
            for(var element of nearby_elements)
            {
                if(element.dataset.illust_id == null)
                    continue;
                nearby_illust_ids.push(element.dataset.illust_id);
            }

            // console.log("Wanted:", wanted_illust_ids.join(", "));
            // console.log("Nearby:", nearby_illust_ids.join(", "));

            // Load the thumbnail data if needed.
            thumbnail_data.singleton().get_thumbnail_info(nearby_illust_ids);
        }
        
        this.set_visible_thumbs();
    }

    update_from_settings()
    {
        var thumbnail_mode = helpers.get_value("thumbnail-size");
        this.set_visible_thumbs();
        this.refresh_images();

        helpers.set_class(document.body, "light", settings.get("theme") == "light");
        helpers.set_class(document.body, "disable-thumbnail-panning", settings.get("disable_thumbnail_panning"));
        helpers.set_class(document.body, "disable-thumbnail-zooming", settings.get("disable_thumbnail_zooming"));
    }

    // Set the URL for all loaded thumbnails that are onscreen.
    //
    // This won't trigger loading any data (other than the thumbnails themselves).
    set_visible_thumbs()
    {
        // Make a list of IDs that we're assigning.
        var elements = this.get_visible_thumbnails();
        var illust_ids = [];
        for(var element of elements)
        {
            if(element.dataset.illust_id == null)
                continue;
            illust_ids.push(element.dataset.illust_id);
        }        

        for(var element of elements)
        {
            var illust_id = element.dataset.illust_id;
            if(illust_id == null)
                continue;

            // Get thumbnail info.
            var info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
            if(info == null)
                continue;

            // Set this thumb.
            var url = info.url;
            var thumb = element.querySelector(".thumb");

            // Check if this illustration is muted (blocked).
            var muted_tag = muting.singleton.any_tag_muted(info.tags);
            var muted_user = muting.singleton.is_muted_user_id(info.userId);
            if(muted_tag || muted_user)
            {
                element.classList.add("muted");

                // The image will be obscured, but we still shouldn't load the image the user blocked (which
                // is something Pixiv does wrong).  Load the user profile image instead.
                thumb.src = info.profileImageUrl;

                element.querySelector(".muted-label").textContent = muted_tag? muted_tag:info.userName;

                // We can use this if we want a "show anyway' UI.
                thumb.dataset.mutedUrl = url;
            }
            else
            {
                thumb.src = url;

                // The search page thumbs are always square (aspect ratio 1).
                helpers.set_thumbnail_panning_direction(element, info.width, info.height, 1);
            }

            // Leave it alone if it's already been loaded.
            if(!("pending" in element.dataset))
                continue;

            // Why is this not working in FF?  It works in the console, but not here.  Sandboxing
            // issue?
            // delete element.dataset.pending;
            element.removeAttribute("data-pending");

            // Set the link.  Setting dataset.illustId will allow this to be handled with in-page
            // navigation, and the href will allow middle click, etc. to work normally.
            var link = element.querySelector("a.thumbnail-link");
            link.href = "/member_illust.php?mode=medium&illust_id=" + illust_id + "#ppixiv";
            if(info.pageCount > 1)
                link.href += "?view=manga";

            link.dataset.illustId = illust_id;

            if(info.illustType == 2)
                element.querySelector(".ugoira-icon").hidden = false;

            if(info.pageCount > 1)
            {
                element.querySelector(".page-count-box").hidden = false;
                element.querySelector(".page-count-box .page-count").textContent = info.pageCount;
            }

            helpers.set_class(element, "dot", helpers.tags_contain_dot(info));
            element.querySelector("A.similar-images-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv";

            this.refresh_bookmark_icon(element);

            // Set the label.
            var label = element.querySelector(".thumbnail-label");
            label.hidden = false;
            label.querySelector(".label").innerText = info.userName + ": " + info.title;
        }        
    }

    // Refresh the thumbnail for illust_id.
    //
    // This is used to refresh the bookmark icon when changing a bookmark.
    refresh_thumbnail(illust_id)
    {
        var ul = this.container.querySelector("ul.thumbnails");
        var thumbnail_element = ul.querySelector("[data-illust_id=\"" + illust_id + "\"]");
        if(thumbnail_element == null)
            return;
        this.refresh_bookmark_icon(thumbnail_element);
    }

    // Set the bookmarked heart for thumbnail_element.  This can change if the user bookmarks
    // or un-bookmarks an image.
    refresh_bookmark_icon(thumbnail_element)
    {
        var illust_id = thumbnail_element.dataset.illust_id;
        if(illust_id == null)
            return;

        // Get thumbnail info.
        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
        if(thumbnail_info == null)
            return;

        var show_bookmark_heart = thumbnail_info.bookmarkData != null;
        if(this.data_source != null && !this.data_source.show_bookmark_icons)
            show_bookmark_heart = false;
        
        thumbnail_element.querySelector(".heart").hidden = !show_bookmark_heart;
        if(!show_bookmark_heart)
            return;

        // Note that Pixiv returns wrong data for bookmarkType on a lot of pages, so
        // we'll often end up showing public for private bookmarks.
        thumbnail_element.querySelector(".heart").dataset.bookmarkType = thumbnail_info.bookmarkData.private? "private":"public";
    }

    // Return a list of thumbnails that are either visible, or close to being visible
    // (so we load thumbs before they actually come on screen).
    //
    // If extra is true, return more offscreen thumbnails.
    get_visible_thumbnails(extra)
    {
        // If the container has a zero height, that means we're hidden and we don't want to load
        // thumbnail data at all.
        if(this.container.offsetHeight == 0)
            return [];

        // We'll load thumbnails when they're within this number of pixels from being onscreen.
        var threshold = 450;

        var ul = this.container.querySelector("ul.thumbnails");
        var elements = [];
        var bounds_top = this.container.scrollTop - threshold;
        var bounds_bottom = this.container.scrollTop + this.container.offsetHeight + threshold;
        for(var element = ul.firstElementChild; element != null; element = element.nextElementSibling)
        {
            if(element.offsetTop + element.offsetHeight < bounds_top)
                continue;
            if(element.offsetTop > bounds_bottom)
                continue;
            elements.push(element);
        }

        if(extra)
        {
            // Expand the list outwards to include more thumbs.
            var expand_by = 20;
            var expand_upwards = true;
            while(expand_by > 0)
            {
                if(!elements[0].previousElementSibling && !elements[elements.length-1].nextElementSibling)
                {
                    // Stop if there's nothing above or below our results to add.
                    break;
                }

                if(!expand_upwards && elements[0].previousElementSibling)
                {
                    elements.unshift(elements[0].previousElementSibling);
                    expand_by--;
                }
                else if(expand_upwards && elements[elements.length-1].nextElementSibling)
                {
                    elements.push(elements[elements.length-1].nextElementSibling);
                    expand_by--;
                }

                expand_upwards = !expand_upwards;
            }
        }
        return elements;
    }

    // Create a thumb placeholder.  This doesn't load the image yet.
    //
    // illust_id is the illustration this will be if it's displayed, or null if this
    // is a placeholder for pages we haven't loaded.  page is the page this illustration
    // is on (whether it's a placeholder or not).
    create_thumb(illust_id, page)
    {
        // Cache a reference to the thumbnail template.  We can do this a lot, and this
        // query takes a lot of page setup time if we run it for each thumb.
        if(this.thumbnail_template == null)
            this.thumbnail_template = document.body.querySelector(".template-thumbnail");
            
        var entry = helpers.create_from_template(this.thumbnail_template);

        // Mark that this thumb hasn't been filled in yet.
        entry.dataset.pending = true;

        if(illust_id != null)
            entry.dataset.illust_id = illust_id;
        entry.dataset.page = page;
        return entry;
    }

    // This is called when thumbnail_data has loaded more thumbnail info.
    thumbs_loaded(e)
    {
        this.set_visible_thumbs();
    }

    // Scroll to illust_id if it's available.  This is called when we display the thumbnail view
    // after coming from an illustration.
    scroll_to_illust_id(illust_id)
    {
        var thumb = this.container.querySelector("li[data-illust_id='" + illust_id + "']");
        if(thumb == null)
            return;

        // If the item isn't visible, center it.
        var scroll_pos = this.container.scrollTop;
        if(thumb.offsetTop < scroll_pos || thumb.offsetTop + thumb.offsetHeight > scroll_pos + this.container.offsetHeight)
            this.container.scrollTop = thumb.offsetTop + thumb.offsetHeight/2 - this.container.offsetHeight/2;
    };

    pulse_thumbnail(illust_id)
    {
        var thumb = this.container.querySelector("li[data-illust_id='" + illust_id + "']");
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

