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
        this.onkeydown = this.onkeydown.bind(this);

        this.blank_image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

        this.index = options.manga_page || 0;

        // Create a click and drag viewer for the image.
        this.on_click_viewer = new on_click_viewer();

        main_context_menu.get.on_click_viewer = this.on_click_viewer;

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
        if(this.on_click_viewer)
        {
            this.on_click_viewer.disable();
            this.on_click_viewer = null;
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

    refresh()
    {
        var current_image = this.images[this.index];
        if(this.on_click_viewer && this.img && this.img.src == current_image.url)
            return;

        // Create the new image and pass it to the viewer.
        this._create_image(current_image.url, current_image.width, current_image.height);
        
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

    _create_image(url, width, height)
    {
        if(this.img)
        {
            this.img.remove();
            this.img = null;
        }

        this.img = document.createElement("img");
        this.img.src = url;
        this.img.className = "filtering";

        this.container.appendChild(this.img);
        this.on_click_viewer.set_new_image(this.img, width, height);
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
