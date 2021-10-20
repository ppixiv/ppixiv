"use strict";

// This is the viewer for static images.  We take an illust_data and show
// either a single image or navigate between an image sequence.
ppixiv.viewer_images = class extends ppixiv.viewer
{
    constructor(container, illust_id, options)
    {
        super(container, illust_id);

        this.container = container;
        this.options = options || {};
        this.manga_page_bar = options.manga_page_bar;
        this.onkeydown = this.onkeydown.bind(this);

        this.index = options.manga_page || 0;

        // Create a click and drag viewer for the image.
        this.on_click_viewer = new on_click_viewer();

        main_context_menu.get.on_click_viewer = this.on_click_viewer;

        this.load();
    }

    async load()
    {
        // First, load early illust data.  This is enough info to set up the image list
        // with preview URLs, so we can start the image view early.
        //
        // If this blocks to load, the full illust data will be loaded, so we'll never
        // run two separate requests here.
        let early_illust_data = await image_data.singleton().get_early_illust_data(this.illust_id);

        // Stop if we were removed before the request finished.
        if(this.was_shutdown)
            return;
       
        // Only add an entry for page 1.  We don't have image dimensions for manga pages from
        // early data, so we can't use them for quick previews.
        this.images = [{
            url: null,
            preview_url: early_illust_data.previewUrl,
            width: early_illust_data.width,
            height: early_illust_data.height,
        }];

        this.refresh();
        
        // Now wait for full illust info to load.
        this.illust_data = await image_data.singleton().get_image_info(this.illust_id);

        // Stop if we were removed before the request finished.
        if(this.was_shutdown)
            return;

        // Update the list to include the image URLs.
        this.images = [];
        for(var page of this.illust_data.mangaPages)
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
        super.shutdown();

        if(this.on_click_viewer)
        {
            this.on_click_viewer.disable();
            this.on_click_viewer = null;
        }

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
        // If we don't have this.images, load() hasn't set it up yet.
        if(this.images == null)
            return;

        // This will be null if this is a manga page that we don't have any info for yet.
        let current_image = this.images[this.index];
        if(current_image == null)
            console.info(`No info for page ${this.index} yet`);
        if(this.on_click_viewer && current_image?.url && this.img?.src == current_image?.url)
            return;

        // Create the new image and pass it to the viewer.
        this._create_image(current_image?.url, current_image?.preview_url, current_image?.width, current_image?.height);
        
        // Decode the next and previous image.  This reduces flicker when changing pages
        // since the image will already be decoded.
        if(this.index > 0 && this.index - 1 < this.images.length)
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
        
        // If width is null, we don't have any info for the image yet.  Clear the image so we
        // don't keep showing an old one, and don't create any image.
        if(width == null)
        {
            this.on_click_viewer.set_new_image(null, null, 0, 0);
            return;
        }

        // Create the low-res preview.  This loads the thumbnail underneath the main image.  Don't set the
        // "filtering" class, since using point sampling for the thumbnail doesn't make sense.  If preview_url
        // is null, just use a blank image.
        this.preview_img = document.createElement("img");
        this.preview_img.src = preview_url? preview_url:helpers.blank_image;
        this.preview_img.classList.add("low-res-preview");

        // The secondary image holds the low-res preview image that's shown underneath the loading image.
        // It just follows the main image around and shouldn't receive input events.
        this.preview_img.style.pointerEvents = "none";
        this.container.appendChild(this.preview_img);

        this.img = document.createElement("img");
        this.img.src = url? url:helpers.blank_image;
        this.img.className = "filtering";
        this.container.appendChild(this.img);

        // When the image finishes loading, remove the preview image, to prevent artifacts with
        // transparent images.  Keep a reference to preview_img, so we don't need to worry about
        // it changing.  on_click_viewer will still have a reference to it, but it won't do anything.
        //
        // Don't do this if url is null.  Leave the preview up and don't switch over to the blank
        // image.
        let preview_image = this.preview_img;
        if(url != null)
        {
            this.img.addEventListener("load", (e) => {
                preview_image.remove();
            });
        }

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
                page: 0,
            });
            return;

        case 35: // end
            e.stopPropagation();
            e.preventDefault();
            main_controller.singleton.show_illust(this.illust_data.id, {
                page: this.illust_data.pageCount - 1,
            });
            return;
        }
    }
}
