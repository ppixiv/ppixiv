// The thumbnail overlay UI.
class thumbnail_view
{
    constructor(container, show_image_callback)
    {
        this.thumbs_loaded = this.thumbs_loaded.bind(this);
        this.data_source_updated = this.data_source_updated.bind(this);
        this.onclick = this.onclick.bind(this);
        this.onwheel = this.onwheel.bind(this);
        this.onscroll = this.onscroll.bind(this);
        this.onpopstate = this.onpopstate.bind(this);
//        this.onmousemove = this.onmousemove.bind(this);
        this.submit_search = this.submit_search.bind(this);
        this.toggle_big_thumbnails = this.toggle_big_thumbnails.bind(this);
        this.toggle_light_mode = this.toggle_light_mode.bind(this);
        this.toggle_disable_thumbnail_panning = this.toggle_disable_thumbnail_panning.bind(this);
        this.toggle_disable_thumbnail_zooming = this.toggle_disable_thumbnail_zooming.bind(this);

        this.container = container;
        this.show_image_callback = show_image_callback;

        window.addEventListener("thumbnailsLoaded", this.thumbs_loaded);
        window.addEventListener("popstate", this.onpopstate);

        this.container.addEventListener("click", this.onclick);
        this.container.addEventListener("wheel", this.onwheel);
//        this.container.addEventListener("mousemove", this.onmousemove);

        this.container.addEventListener("scroll", this.onscroll);
        window.addEventListener("resize", this.onscroll);

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
        var setup_popup = function(popup)
        {
            var box = this.container.querySelector(popup);
            box.addEventListener("mouseover", function(e) { helpers.set_class(box, "popup-visible", true); }.bind(this));
            box.addEventListener("mouseout", function(e) { helpers.set_class(box, "popup-visible", false); }.bind(this));
        }.bind(this);

        for(var popup of [".navigation-menu-box", ".settings-menu-box", ".ages-box", ".popularity-box", ".type-box", ".search-mode-box", ".size-box", ".aspect-ratio-box", ".bookmarks-box", ".time-box", ".member-tags-box", ".search-tags-box"])
            setup_popup(popup);

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

        this.container.querySelector(".toggle-big-thumbnails").addEventListener("click", this.toggle_big_thumbnails);
        this.container.querySelector(".toggle-light-mode").addEventListener("click", this.toggle_light_mode);
        this.container.querySelector(".toggle-thumbnail-zooming").addEventListener("click", this.toggle_disable_thumbnail_zooming);
        this.container.querySelector(".toggle-thumbnail-panning").addEventListener("click", this.toggle_disable_thumbnail_panning);

        // Create the tag dropdown for the search page input.
        new tag_search_dropdown_widget(this.container.querySelector(".tag-search-box .search-tags"));
            
        // Create the tag dropdown for the search input in the menu dropdown.
        new tag_search_dropdown_widget(this.container.querySelector(".navigation-search-box .search-tags"));

        this.update_from_settings();
        this.refresh_images();
        this.load_needed_thumb_data();
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
        document.location.href = page_manager.singleton().get_url_for_tag_search(tags);
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
    onclick(e)
    {
        // Only the <A> inside thumbnail-box is clickable.
        var a = e.target.closest("a.thumbnail-link");
        if(a != null)
        {
            // A thumbnail was clicked.  
            e.stopPropagation();
            e.preventDefault();

            var thumb = a.closest(".thumbnail-box");

            var illust_id = thumb.dataset.illust_id;
            if(illust_id == null)
                return;

            this.show_image_callback(illust_id);
            this.enabled = false;
            return;
        }
    };

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
        if(this.data_source != null)
            this.data_source.remove_update_listener(this.data_source_updated);

        this.data_source = data_source;

        if(this.data_source == null)
            return;
        
        // If we disabled loading more pages earlier, reenable it.
        this.disable_loading_more_pages = false;

        // Listen to the data source loading new pages, so we can refresh the list.
        this.data_source.add_update_listener(this.data_source_updated);

        this.set_enabled_from_url();
        this.refresh_images();
        this.load_needed_thumb_data();

        this.refresh_ui();
    };

    refresh_ui()
    {
        if(!this.enabled)
            return;

        var page_title = this.data_source.page_title || "Loading...";
        document.querySelector("title").textContent = page_title;
        
        var ui_box = this.container.querySelector(".thumbnail-ui-box");

        // Show UI elements with this data source in their data-datasource attribute.
        var data_source_name = this.data_source.name;
        for(var node of ui_box.querySelectorAll(".data-source-specific[data-datasource]"))
        {
            var data_sources = node.dataset.datasource.split(" ");
            var show_element = data_sources.indexOf(data_source_name) != -1;
            node.hidden = !show_element;
        }

        var element_displaying = this.container.querySelector(".displaying");
        element_displaying.hidden = this.data_source.get_displaying_text == null;
        if(this.data_source.get_displaying_text != null)
            element_displaying.innerText = this.data_source.get_displaying_text();

        // Set the regular icon.  The data source might change it to something else.
        helpers.set_page_icon(binary_data['regular_pixiv_icon.png']);
        
        // Update the link to bookmarks for the user we're viewing.
        var viewing_user_id = this.data_source.viewing_user_id;
        var viewing_username = this.data_source.viewing_username;
        var show_bookmark_link = viewing_user_id != null && viewing_username != null && viewing_username != global_data.user_id;
        var user_bookmarks = this.container.querySelector(".user-bookmarks");
        user_bookmarks.hidden = !show_bookmark_link;
        if(show_bookmark_link)
        {
            user_bookmarks.href = "/bookmark.php?id=" + viewing_user_id + "#ppixiv";
            user_bookmarks.textContent = viewing_username + "'s Bookmarks";
        }

        this.data_source.refresh_thumbnail_ui(ui_box, this);
    };

    set_enabled_from_url()
    {
        this.set_enabled(this.enabled, false);
    };

    onpopstate(e)
    {
        this.set_enabled_from_url();
    };

    // Show or hide the thumbnail view.
    get enabled()
    {
        // If thumbs is set in the hash, it's whether we're enabled.  Otherwise, use
        // the data source's default.
        var hash_args = page_manager.singleton().get_hash_args();
        var enabled;
        if(!hash_args.has("thumbs"))
            return this.data_source.show_thumbs_by_default;
        else
            return hash_args.get("thumbs") == "1";
    };

    set enabled(enabled)
    {
        this.set_enabled(enabled, false);
    }

    set_enabled(enabled, add_to_history)
    {
        this.container.hidden = !enabled;

        // Update the URL to remember whether we're in the thumb view.
        var query_args = page_manager.singleton().get_query_args();
        var hash_args = page_manager.singleton().get_hash_args();
        if(enabled == this.data_source.show_thumbs_by_default)
            hash_args.delete("thumbs");
        else
            hash_args.set("thumbs", enabled? "1":"0");

        // Dismiss any widget when toggling between views.
        message_widget.singleton.hide();

        page_manager.singleton().set_args(query_args, hash_args, add_to_history);

        if(enabled)
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

        if(!enabled)
            this.stop_pulsing_thumbnail();
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
                this.disable_loading_more_pages = true;

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
        helpers.set_class(this.container, "big-thumbnails", helpers.get_value("thumbnail-size") == "big");
        this.set_visible_thumbs();

        helpers.set_class(document.body, "light", helpers.get_value("theme") == "light");

        helpers.set_class(document.body, "disable-thumbnail-panning", helpers.get_value("disable_thumbnail_panning"));
        helpers.set_class(document.body, "disable-thumbnail-zooming", helpers.get_value("disable_thumbnail_zooming"));
    }

    toggle_big_thumbnails()
    {
        var big_thumbnails = helpers.get_value("thumbnail-size") == "big";
        big_thumbnails = !big_thumbnails;
        helpers.set_value("thumbnail-size", big_thumbnails? "big":"normal");

        this.update_from_settings();
    }

    toggle_light_mode()
    {
        var light_mode = helpers.get_value("theme") == "light";
        light_mode = !light_mode;
        helpers.set_value("theme", light_mode? "light":"dark");

        this.update_from_settings();
    }

    toggle_disable_thumbnail_panning()
    {
        var disable_panning = helpers.get_value("disable_thumbnail_panning");
        disable_panning = !disable_panning;
        helpers.set_value("disable_thumbnail_panning", disable_panning);

        this.update_from_settings();
    }

    toggle_disable_thumbnail_zooming()
    {
        var disable_zooming = helpers.get_value("disable_thumbnail_zooming");
        disable_zooming = !disable_zooming;
        helpers.set_value("disable_thumbnail_zooming", disable_zooming);

        this.update_from_settings();
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

        // If true, we're loading and showing larger resolution thumbnails.
        var big_thumbnails = helpers.get_value("thumbnail-size") == "big";
        helpers.set_class(this.container, "big-thumbnails", big_thumbnails);

        for(var element of elements)
        {
            var illust_id = element.dataset.illust_id;
            if(illust_id == null)
                continue;

            // Get thumbnail info.
            var info = thumbnail_data.singleton().get_one_thumbnail_info(illust_id);
            if(info == null)
                continue;

            var ugoira = info.illust_type == 2;
            info.illust_page_count;

            // Set this thumb.  Do this even if pending is set, so we update if big_thumbnails has changed.
            var url = info.url;
            if(big_thumbnails)
                url = info.url.replace(/\/240x240\//, "/540x540_70/");

            var thumb = element.querySelector(".thumb");

            // Check if this illustration is muted (blocked).
            var muted_tag = main.any_tag_muted(info.tags);
            var muted_user = main.is_muted_user_id(info.illust_user_id);
            if(muted_tag || muted_user)
            {
                element.classList.add("muted");

                // The image will be obscured, but we still shouldn't load the image the user blocked (which
                // is something Pixiv does wrong).  Load the user profile image instead.
                thumb.src = info.user_profile_img;

                element.querySelector(".muted-label").textContent = muted_tag? muted_tag:info.user_name;

                // We can use this if we want a "show anyway' UI.
                thumb.dataset.mutedUrl = url;
            }
            else
            {
                thumb.src = url;

                // If the aspect ratio is very narrow, don't use any panning, since it becomes too spastic.
                // If the aspect ratio is portrait, use vertical panning.
                // If the aspect ratio is landscape, use horizontal panning.
                //
                // If it's in between, don't pan at all, since we don't have anywhere to move and it can just
                // make the thumbnail jitter in place.
                //
                // Don't pan muted images.
                var aspect_ratio = info.illust_width / info.illust_height;
                var min_aspect_for_pan = 1.1;
                var max_aspect_for_pan = 4;
                var vertical_panning = aspect_ratio > (1/max_aspect_for_pan) && aspect_ratio < 1/min_aspect_for_pan;
                var horizontal_panning = aspect_ratio > min_aspect_for_pan && aspect_ratio < max_aspect_for_pan;
                helpers.set_class(element, "vertical-panning", vertical_panning);
                helpers.set_class(element, "horizontal-panning", horizontal_panning);
            }

            // Leave it alone if it's already been loaded.
            if(!("pending" in element.dataset))
                continue;

            // Why is this not working in FF?  It works in the console, but not here.  Sandboxing
            // issue?
            // delete element.dataset.pending;
            element.removeAttribute("data-pending");

            // Set the link.  We'll capture clicks and navigate in-page, but this allows middle click, etc.
            // to work normally.
            element.querySelector("a.thumbnail-link").href = "/member_illust.php?mode=medium&illust_id=" + illust_id + "#ppixiv";

            if(info.illust_type == 2)
                element.querySelector(".ugoira-icon").hidden = false;

            if(info.illust_page_count > 1)
            {
                element.querySelector(".page-count-box").hidden = false;
                element.querySelector(".page-count-box .page-count").textContent = info.illust_page_count;
            }


            helpers.set_class(element, "dot", helpers.tags_contain_dot(info));

            // Set the popup.
            var a = element.querySelector(".thumbnail-inner");
            var popup = info.user_name + ": " + info.illust_title;
            a.classList.add("popup");
            a.dataset.popup = popup;
        }        
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
        var entry = helpers.create_from_template(".template-thumbnail");

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

        // scrollIntoView scrolls even if the item is already in view, which doesn't make sense, so
        // we have to manually check.
        unsafeWindow.fff = thumb;
        var scroll_pos = this.container.scrollTop;
        if(thumb.offsetTop < scroll_pos || thumb.offsetTop + thumb.offsetHeight > scroll_pos + this.container.offsetHeight)
            thumb.scrollIntoView();
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

