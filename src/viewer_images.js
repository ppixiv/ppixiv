class viewer_images_context_menu extends popup_context_menu
{
    constructor(container, on_click_viewer)
    {
        super(container);

        this.on_click_viewer = on_click_viewer;

        this.refresh_zoom_icons();

        this.menu.querySelector(".button-zoom").addEventListener("click", this.clicked_zoom_toggle.bind(this));

        for(var button of this.menu.querySelectorAll(".button-zoom-level"))
            button.addEventListener("click", this.clicked_zoom_level.bind(this));
    }

    // Put the zoom toggle button under the cursor, so right-left click is a quick way
    // to toggle zoom lock.
    get element_to_center()
    {
        return this.displayed_menu.querySelector(".button-zoom");
    }
        
    // Update selection highlight for the context menu.
    refresh_zoom_icons()
    {
        helpers.set_class(this.menu.querySelector(".button-zoom"), "selected", this.on_click_viewer.locked_zoom);

        var zoom_level = this.on_click_viewer.zoom_level;
        for(var button of this.menu.querySelectorAll(".button-zoom-level"))
            helpers.set_class(button, "selected", parseInt(button.dataset.level) == zoom_level);
    }

    clicked_zoom_toggle(e)
    {
        this.on_click_viewer.set_zoom_center(e.clientX, e.clientY);
        this.on_click_viewer.locked_zoom = !this.on_click_viewer.locked_zoom;
        this.refresh_zoom_icons();
    }

    clicked_zoom_level(e)
    {
        console.log(e.currentTarget);
        var level = parseInt(e.currentTarget.dataset.level);

        // If the zoom level that's already selected is clicked and we're already zoomed,
        // just toggle zoom as if the toggle zoom button was pressed.
        if(this.on_click_viewer.zoom_level == level && this.on_click_viewer.locked_zoom)
        {
            this.on_click_viewer.locked_zoom = false;
            this.refresh_zoom_icons();
            return;
        }

        // Each zoom button enables zoom lock, since otherwise changing the zoom level would
        // only have an effect when click-dragging, so it looks like the buttons don't do anything.
        this.on_click_viewer.set_zoom_center(e.clientX, e.clientY);
        this.on_click_viewer.zoom_level = level;
        this.on_click_viewer.locked_zoom = true;
        this.refresh_zoom_icons();
    }
}

// This is the viewer for static images.  We take an illust_data and show
// either a single image or navigate between an image sequence.
class viewer_images extends viewer
{
    constructor(container, illust_data, options)
    {
        super(container, illust_data);

        this.container = container;
        this.options = options || {};
        this.progress_bar = options.progress_bar;
        this.manga_page_bar = options.manga_page_bar;
        this.img_onload = this.img_onload.bind(this);
        
        this.onkeydown = this.onkeydown.bind(this);

        this.index = options.show_last_image? illust_data.pageCount-1:0;

        // Create the image element.
        this.img = document.createElement("img");
        this.img.className = "filtering";
        this.img.addEventListener("load", this.img_onload);
        container.appendChild(this.img);

        // Create a click and drag viewer for the image.
        this.viewer = new on_click_viewer(this.img);

        this.context_menu = new viewer_images_context_menu(this.container, this.viewer);

        // Make a list of image URLs we're viewing.
        this.images = [];

        for(var page = 0; page < illust_data.pageCount; ++page)
            this.images.push(helpers.get_url_for_page(illust_data, page, "original"));

        this.refresh();
    }

    img_onload(e)
    {
        console.log("loaded", this.img.naturalWidth, this.img.naturalHeight);
        this.call_on_page_changed();
    }

    // For single-page illustrations, we have the image dimensions in illust_data.
    // For manga pages we have to get it from the image.  This will be out of date
    // during page loads, since there's no way to tell if naturalWidth/naturalHeight
    // have been updated.
    get current_image_width()
    {
        if(this.illust_data.illustType != 2 && this.illust_data.pageCount == 1)
            return this.illust_data.width;
        else
            return this.img.naturalWidth > 0? this.img.naturalWidth:null;
    }
    get current_image_height()
    {
        if(this.illust_data.illustType != 2 && this.illust_data.pageCount == 1)
            return this.illust_data.height;
        else
            return this.img.naturalHeight > 0? this.img.naturalHeight:null;
    }

    get current_image_type()
    {
        var url;
        if(this.illust_data.illustType != 2 && this.illust_data.pageCount == 1)
            url = this.illust_data.urls.original;
        else
            url = this.img.src;
        return helpers.get_extension(url).toUpperCase();
    }
    
    
    shutdown()
    {
        if(this.viewer)
        {
            this.viewer.disable();
            this.viewer = null;
        }

        if(this.img.parentNode)
            this.img.parentNode.removeChild(this.img);

        if(this.progress_bar)
            this.progress_bar.detach();

        if(this.context_menu)
        {
            this.context_menu.shutdown();
            this.context_menu = null;
        }
    }

    set_page(page)
    {
        this.index = page;
        this.refresh();
    }

    move(down)
    {
        var new_index = this.index + (down? +1:-1);
        new_index = Math.max(0, Math.min(this.images.length-1, new_index));
        if(new_index == this.index)
            return false;

        this.set_page(new_index);
        return true;
    }

    call_on_page_changed()
    {
        if(this.options.page_changed == null)
            return;

        this.options.page_changed(this.index, this.images.length, this.img.src);
    }

    refresh()
    {
        var url = this.images[this.index];
        if(this.viewer && this.img.src == url)
            return;

        this.img.src = url;
        this.viewer.image_changed();

        this.call_on_page_changed();


/*        if(this.progress_bar)
        {
            if(this.images.length == 1)
                this.progress_bar.set(null);
            else
            {
                // Flash the current manga page in the progress bar briefly.
                this.progress_bar.set((this.index+1) / this.images.length);
                this.progress_bar.show_briefly();
            }
        } */
        
        // If we have a manga_page_bar, update to show the current page.
        if(this.manga_page_bar)
        {
            if(this.images.length == 1)
                this.manga_page_bar.set(null);
            else
                this.manga_page_bar.set((this.index+1) / this.images.length);
        }
    }

    onkeydown(e)
    {
        switch(e.keyCode)
        {
        case 36: // home
            e.stopPropagation();
            e.preventDefault();
            this.index = 0;
            this.refresh();
            return;

        case 35: // end
            e.stopPropagation();
            e.preventDefault();

            this.index = this.images.length - 1;
            this.refresh();
            return;
        }
    }
}
