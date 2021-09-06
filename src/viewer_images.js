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
                preview_url: page.urls.small,
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
            this.img.remove();
        if(this.preview_img)
            this.preview_img.remove();

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
        if(current_image == null)
        {
            console.error("Invalid page", this.index, "in images", this.images);
            return;
        }
        if(this.on_click_viewer && this.img && this.img.src == current_image.url)
            return;

        // Create the new image and pass it to the viewer.
        this._create_image(current_image.url, current_image.preview_url, current_image.width, current_image.height);
        
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

    _create_image(url, preview_url, width, height)
    {
        if(this.img)
        {
            this.img.remove();
            this.img = null;
        }

        if(this.preview_img)
        {
            this.preview_img.remove();
            this.preview_img = null;
        }
        
        // Create the low-res preview.  This loads the thumbnail underneath the main image.  Don't set the
        // "filtering" class, since using point sampling for the thumbnail doesn't make sense.
        this.preview_img = document.createElement("img");
        this.preview_img.src = preview_url;
        this.preview_img.classList.add("low-res-preview");

        // The secondary image holds the low-res preview image that's shown underneath the loading image.
        // It just follows the main image around and shouldn't receive input events.
        this.preview_img.style.pointerEvents = "none";
        this.container.appendChild(this.preview_img);

        this.img = document.createElement("img");
        this.img.src = url;
        this.img.className = "filtering";
        this.container.appendChild(this.img);

        // When the image finishes loading, remove the preview image, to prevent artifacts with
        // transparent images.  Keep a reference to preview_img, so we don't need to worry about
        // it changing.  on_click_viewer will still have a reference to it, but it won't do anything.
        var preview_image = this.preview_img;
        this.img.addEventListener("load", (e) => {
            preview_image.remove();
        });

        this.on_click_viewer.set_new_image(this.img, this.preview_img, width, height);
    }

    onkeydown(e)
    {
        if(e.ctrlKey || e.altKey || e.metaKey)
            return;
        
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
