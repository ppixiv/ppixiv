"use strict";

class scroll_handler
{
    constructor(container)
    {
        this.container = container;
    }

    // Bring item into view.  We'll also try to keep the next and previous items visible.
    scroll_into_view(item)
    {
        // Make sure item is a direct child of the container.
        if(item.parentNode != this.container)
        {
            console.error("Node", item, "isn't in scroller", this.container);
            return;
        }

        // Scroll so the items to the left and right of the current thumbnail are visible,
        // so you can tell whether there's another entry to scroll to.  If we can't fit
        // them, center the selection.
        var scroller_left = this.container.getBoundingClientRect().left;
        var left = item.offsetLeft - scroller_left;
        
        if(item.previousElementSibling)
            left = Math.min(left, item.previousElementSibling.offsetLeft - scroller_left);

        var right = item.offsetLeft + item.offsetWidth - scroller_left;
        if(item.nextElementSibling)
            right = Math.max(right, item.nextElementSibling.offsetLeft + item.nextElementSibling.offsetWidth - scroller_left);

        var new_left = this.container.scrollLeft;
        if(new_left > left)
            new_left = left;
        if(new_left + this.container.offsetWidth < right)
            new_left = right - this.container.offsetWidth;
        this.container.scrollLeft = new_left;

        // If we didn't fit the previous and next entries, there isn't enough space.  This
        // might be a wide thumbnail or the window might be very narrow.  Just center the
        // selection.  Note that we need to compare against the value we assigned and not
        // read scrollLeft back, since the API is broken and reads back the smoothed value
        // rather than the target we set.
        if(new_left > left ||
           new_left + this.container.offsetWidth < right)
        {
            this.center_item(item);
        }
    }

    // Scroll the given item to the center.
    center_item(item)
    {
        var scroller_left = this.container.getBoundingClientRect().left;
        var left = item.offsetLeft - scroller_left;
        left += item.offsetWidth/2;
        left -= this.container.offsetWidth / 2;
        this.container.scrollLeft = left;
    }

    /* Snap to the target position, cancelling any smooth scrolling. */
    snap()
    {
        this.container.style.scrollBehavior = "auto";
        if(this.container.firstElementChild)
            this.container.firstElementChild.getBoundingClientRect();
        this.container.getBoundingClientRect();
        this.container.style.scrollBehavior = "";
    }
};

ppixiv.manga_thumbnail_widget = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({options, template: `
            <div class=strip>
                <div class=manga-thumbnail-arrow data-direction=left>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="100" viewBox="0 0 20 100">
                        <path d="M 0 50 L 20 0 L 20 100 L 0 50" />
                    </svg>
                </div>

                <div class=manga-thumbnails></div>

                <div class=manga-thumbnail-arrow data-direction=right>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="100" viewBox="0 0 20 100">
                        <path d="M 20 50 L 0 0 L 0 100 L 20 50" />
                    </svg>
                </div>
            </div>
        `});

        this.onclick = this.onclick.bind(this);
        this.onmouseenter = this.onmouseenter.bind(this);
        this.onmouseleave = this.onmouseleave.bind(this);
        this.check_image_loads = this.check_image_loads.bind(this);
        this.window_onresize = this.window_onresize.bind(this);
        
        window.addEventListener("resize", this.window_onresize);

        this.container = container;
        this.container.addEventListener("click", this.onclick);
        this.container.addEventListener("mouseenter", this.onmouseenter);
        this.container.addEventListener("mouseleave", this.onmouseleave);

        this.cursor = document.createElement("div");
        this.cursor.classList.add("thumb-list-cursor");

        this.scroll_box = this.container.querySelector(".manga-thumbnails");
        this.scroller = new scroll_handler(this.scroll_box);

        this.visible = false;
        this.set_illust_info(null);
    }

    // Both Firefox and Chrome have some nasty layout bugs when resizing the window,
    // causing the flexbox and the images inside it to be incorrect.  Work around it
    // by forcing a refresh.
    window_onresize(e)
    {
        this.refresh();
    }

    onmouseenter(e)
    {
        this.hovering = true;
        this.refresh_visible();
    }

    onmouseleave(e)
    {
        this.stop_hovering();
    }

    stop_hovering()
    {
        this.hovering = false;
        this.refresh_visible();
    }

    refresh_visible()
    {
        this.visible = this.hovering;
    }

    get visible()
    {
        return this.container.classList.contains("visible");
    }

    set visible(visible)
    {
        if(visible == this.visible)
            return;

        helpers.set_class(this.container, "visible", visible);

        if(!visible)
            this.stop_hovering();
    }

    onclick(e)
    {
        var arrow = e.target.closest(".manga-thumbnail-arrow");
        if(arrow != null)
        {
            e.preventDefault();
            e.stopPropagation();

            var left = arrow.dataset.direction == "left";
            console.log("scroll", left);

            var new_page = this.current_page + (left? -1:+1);
            if(new_page < 0 || new_page >= this.entries.length)
                return;

            let media_id = helpers.illust_id_to_media_id(this.illust_info.illustId, new_page);
            main_controller.singleton.show_media(media_id);
            
            /*
            var entry = this.entries[new_page];
            if(entry == null)
                return;

            this.scroller.scroll_into_view(entry);
            
            */
            return;
        }

        var thumb = e.target.closest(".manga-thumbnail-box");
        if(thumb != null)
        {
            e.preventDefault();
            e.stopPropagation();

            var new_page = parseInt(thumb.dataset.page);
            let media_id = helpers.illust_id_to_media_id(new_illust_id, new_page);
            main_controller.singleton.show_media(media_id);
            return;
        }
    }

    set_illust_info(illust_info)
    {
        if(illust_info == this.illust_info)
            return;

        // Only display if we have at least two pages.
        if(illust_info != null && illust_info.pageCount < 2)
            illust_info = null;

        // If we're not on a manga page, hide ourselves entirely, including the hover box.
        this.container.hidden = illust_info == null;

        this.illust_info = illust_info;

        if(illust_info == null)
            this.stop_hovering();

        // Refresh the thumb images.
        this.refresh();

        // Start or stop check_image_loads if needed.
        if(this.illust_info == null && this.check_image_loads_timer != null)
        {
            clearTimeout(this.check_image_loads_timer);
            this.check_image_loads_timer = null;
        }
        this.check_image_loads();
    }

    snap_transition()
    {
        this.scroller.snap();
    }

    // This is called when the manga page is changed externally.
    current_page_changed(page)
    {
        // Ignore page changes if we're not displaying anything.
        if(this.illust_info == null)
            return
        
        this.current_page = page;
        if(this.current_page == null)
            return;

        // Find the entry for the page.
        var entry = this.entries[this.current_page];
        if(entry == null)
        {
            console.error("Scrolled to unknown page", this.current_page);
            return;
        }

        this.scroller.scroll_into_view(entry);

        if(this.selected_entry)
            helpers.set_class(this.selected_entry, "selected", false);

        this.selected_entry = entry;

        if(this.selected_entry)
        {
            helpers.set_class(this.selected_entry, "selected", true);

            this.update_cursor_position();
        }
    }

    update_cursor_position()
    {
        // Wait for images to know their size before positioning the cursor.
        if(this.selected_entry == null || this.waiting_for_images || this.cursor.parentNode == null)
            return;

        // Position the cursor to the position of the selection.
        this.cursor.style.width = this.selected_entry.offsetWidth + "px";

        var scroller_left = this.scroll_box.getBoundingClientRect().left;
        var base_left = this.cursor.parentNode.getBoundingClientRect().left;
        var position_left = this.selected_entry.getBoundingClientRect().left;
        var left = position_left - base_left;
        this.cursor.style.left = left + "px";
    }

    // We can't update the UI properly until we know the size the thumbs will be,
    // and the site doesn't tell us the size of manga pages (only the first page).
    // Work around this by hiding until we have naturalWidth for all images, which
    // will allow layout to complete.  There's no event for this for some reason,
    // so the only way to detect it is with a timer.
    //
    // This often isn't needed because of image preloading.
    check_image_loads()
    {
        if(this.illust_info == null)
            return;

        this.check_image_loads_timer = null;
        var all_images_loaded = true;
        for(var img of this.container.querySelectorAll("img.manga-thumb"))
        {
            if(img.naturalWidth == 0)
                all_images_loaded = false;
        }

        // If all images haven't loaded yet, check again.
        if(!all_images_loaded)
        {
            this.waiting_for_images = true;
            this.check_image_loads_timer = setTimeout(this.check_image_loads, 10);
            return;
        }
        this.waiting_for_images = false;

        // Now that we know image sizes and layout can update properly, we can update the cursor's position.
        this.update_cursor_position();
    }

    refresh()
    {
        if(this.cursor.parentNode)
            this.cursor.parentNode.removeChild(this.cursor);

        var ul = this.container.querySelector(".manga-thumbnails");
        helpers.remove_elements(ul);
        this.entries = [];

        if(this.illust_info == null)
            return;

        // Add left and right padding elements to center the list if needed.
        var left_padding = document.createElement("div");
        left_padding.style.flex = "1";
        ul.appendChild(left_padding);

        for(var page = 0; page < this.illust_info.pageCount; ++page)
        {
            var page_info = this.illust_info.mangaPages[page];
            var url = page_info.urls.small;

            var img = document.createElement("img");
            let entry = this.create_template({name: "thumb", html: `
                <div class=manga-thumbnail-box>
                    <img class=manga-thumb>
                </div>
            `});
            entry.dataset.page = page;
            entry.querySelector("img.manga-thumb").src = url;
            ul.appendChild(entry);
            this.entries.push(entry);
        }
        
        var right_padding = document.createElement("div");
        right_padding.style.flex = "1";
        ul.appendChild(right_padding);

        // Place the cursor inside the first entry, so it follows it around as we scroll.
        this.entries[0].appendChild(this.cursor);

        this.update_cursor_position();
    }
};

