// This is the viewer for static images.  We take an illust_data and show
// either a single image or navigate between an image sequence.
class viewer_images extends viewer
{
    constructor(container, illust_data, options)
    {
        super(container, illust_data);

        this.container = container;
        this.options = options || {};
        this.manga_page_bar = options.manga_page_bar;
        this.img_onload = this.img_onload.bind(this);
        this.onkeydown = this.onkeydown.bind(this);

        this.blank_image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

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

        // If there are multiple pages, get image info from mangaPages.  Otherwise, use
        // the main image.
        for(var page of illust_data.mangaPages)
        {
            this.images.push({
                url: page.urls.original,
                width: page.width,
                height: page.height,
            });
        }

        this.refresh();
    }

    img_onload(e)
    {
        this.call_image_finished_loading();
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

    call_image_finished_loading()
    {
        if(this.options.image_finished_loading == null)
            return;

        this.options.image_finished_loading(this.index, this.images.length, this.img.src);
    }

    refresh()
    {
        var current_image = this.images[this.index];
        if(this.viewer && this.img && this.img.src == current_image.url)
            return;

        this.img.src = current_image.url;

        // Decode the next and previous image.  This reduces flicker when changing pages
        // since the image will already be decoded.
        if(this.index > 0)
            helpers.decode_image(this.images[this.index - 1].url);
        if(this.index + 1 < this.images.length)
            helpers.decode_image(this.images[this.index + 1].url);

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
            main_controller.singleton.show_illust(this.illust_data.id, {
                manga_page: 0,
            });
            return;

        case 35: // end
            e.stopPropagation();
            e.preventDefault();
            main_controller.singleton.show_illust(this.illust_data.id, {
                manga_page: this.illust_data.pageCount - 1,
            });
            return;
        }
    }
}
