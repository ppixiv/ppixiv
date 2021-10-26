"use strict";

// This is the viewer for static images.  We take an illust_data and show
// either a single image or navigate between an image sequence.
ppixiv.viewer_images = class extends ppixiv.viewer
{
    constructor(container, options)
    {
        super(container);

        this.container = container;
        this.options = options || {};
        this.manga_page_bar = options.manga_page_bar;
        this.onkeydown = this.onkeydown.bind(this);
        this.restore_history = false;

        this.load = new SentinelGuard(this.load, this);

        // Create a click and drag viewer for the image.
        this.on_click_viewer = new on_click_viewer(this.container);

        main_context_menu.get.on_click_viewer = this.on_click_viewer;
    }

    async load(signal, illust_id, page, { restore_history=false }={})
    {
        this.restore_history = restore_history;

        this.illust_id = illust_id;
        this._page = page;

        // First, load early illust data.  This is enough info to set up the image list
        // with preview URLs, so we can start the image view early.
        //
        // If this blocks to load, the full illust data will be loaded, so we'll never
        // run two separate requests here.
        let early_illust_data = await thumbnail_data.singleton().get_or_load_illust_data(this.illust_id);

        // Stop if we were removed before the request finished.
        signal.check();
       
        // Early data only gives us the image dimensions for page 1, which we'll include.
        // The rest set width and height to null, which will tell on_click_viewer to
        // get it from the images.
        this.images = [{
            preview_url: early_illust_data.previewUrls[0],
            width: early_illust_data.width,
            height: early_illust_data.height,
        }];

        for(let manga_page of early_illust_data.previewUrls.slice(1))
            this.images.push({ preview_url: manga_page });

        this.refresh();
        
        // Now wait for full illust info to load.
        this.illust_data = await image_data.singleton().get_image_info(this.illust_id);

        // Stop if we were removed before the request finished.
        signal.check();

        // Update the list to include the image URLs.
        this.images = [];
        for(let manga_page of this.illust_data.mangaPages)
        {
            this.images.push({
                url: manga_page.urls.original,
                preview_url: manga_page.urls.small,
                width: manga_page.width,
                height: manga_page.height,
            });
        }

        this.refresh();
    }

    // Note that this will always return JPG if all we have is the preview URL.
    get current_image_type()
    {
        return helpers.get_extension(this.url).toUpperCase();
    }
    
    
    shutdown()
    {
        super.shutdown();

        // If this.load() is running, cancel it.
        this.load.abort();

        if(this.on_click_viewer)
        {
            this.on_click_viewer.shutdown();
            this.on_click_viewer = null;
        }

        main_context_menu.get.on_click_viewer = null;
    }

    get page()
    {
        return this._page;
    }

    set page(page)
    {
        this._page = page;
        this.refresh();
    }

    refresh()
    {
        // If we don't have this.images, load() hasn't set it up yet.
        if(this.images == null)
            return;

        // We should always have an entry for each page.
        let current_image = this.images[this._page];
        if(current_image == null)
        {
            console.error(`No info for page ${this._page} yet`);
            return;
        }

        if(this.on_click_viewer &&
            current_image.url == this.on_click_viewer.url &&
            current_image.preview_url == this.on_click_viewer.preview_url)
            return;

        // Create the new image and pass it to the viewer.
        this.url = current_image.url || current_image.preview_url;
        this.on_click_viewer.set_new_image(current_image.url, current_image.preview_url,
            current_image.width, current_image.height);

        // If we have a manga_page_bar, update to show the current page.
        if(this.manga_page_bar)
        {
            if(this.images.length == 1)
                this.manga_page_bar.set(null);
            else
                this.manga_page_bar.set((this._page+1) / this.images.length);
        }

        // If we were created with the restore_history option set, restore it now that
        // we have an image set up.  This is done when we're restoring a browser state, so
        // only do this the first time.
        if(this.restore_history)
        {
            this.on_click_viewer.restore_from_history();
            this.restore_history = false;
        }
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
