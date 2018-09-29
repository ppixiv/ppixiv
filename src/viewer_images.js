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

        this.index = options.manga_page || 0;

        // Create the image element.
        this.img = document.createElement("img");
        this.img.className = "filtering";
        this.img.addEventListener("load", this.img_onload);
        container.appendChild(this.img);

        // Create a click and drag viewer for the image.
        this.viewer = new on_click_viewer(this.img);

        main_context_menu.get.on_click_viewer = this.viewer;

        // Make a list of image URLs we're viewing.
        this.images = [];

        for(var page = 0; page < illust_data.pageCount; ++page)
            this.images.push(helpers.get_url_for_page(illust_data, page, "original"));

        this.refresh();
    }

    img_onload(e)
    {
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

        main_context_menu.get.on_click_viewer = null;
    }

    get page()
    {
        return this.index;
    }

    set page(page)
    {
        this.index = page;
        this.refresh();
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
            main_controller.singleton.show_manga_page(this.illust_data.id, 0, false /* don't add to history */);
            return;

        case 35: // end
            e.stopPropagation();
            e.preventDefault();
            main_controller.singleton.show_manga_page(this.illust_data.id, this.illust_data.pageCount - 1, false /* don't add to history */);
            return;
        }
    }
}
