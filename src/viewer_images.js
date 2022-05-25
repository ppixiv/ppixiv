"use strict";

// This is the viewer for static images.  We take an illust_data and show
// either a single image or navigate between an image sequence.
ppixiv.viewer_images = class extends ppixiv.viewer
{
    constructor(options)
    {
        super({...options, template: `
            <div class=viewer-images>
            </div>
        `
        });

        this.manga_page_bar = options.manga_page_bar;
        this.restore_history = false;

        this.load = new SentinelGuard(this.load, this);

        // Create a click and drag viewer for the image.
        this.on_click_viewer = new on_click_viewer({
            container: this.container,
            onviewcontainerchange: (viewcontainer) => {
                // Let image_editor know when the overlay container changes.
                if(viewcontainer instanceof ImageEditingOverlayContainer)
                    this.image_editor.overlay_container = viewcontainer;
            },
        });

        // Create the inpaint editor.  This is passed down to on_click_viewer to group
        // it with the image, but we create it here and reuse it.
        this.image_editor = new ppixiv.ImageEditor({
            container: this.container,
            onvisibilitychanged: () => { this.refresh(); }, // refresh when crop editing is changed
        });

        main_context_menu.get.on_click_viewer = this.on_click_viewer;
    }

    async load(signal,
        media_id, {
            restore_history=false,
            slideshow=false,
            onnextimage=null,
        }={})
    {
        this.restore_history = restore_history;

        this.media_id = media_id;
        this._page = helpers.parse_media_id(media_id).page;
        this._slideshow = slideshow;
        this._onnextimage = onnextimage;

        // Tell the inpaint editor about the image.
        this.image_editor.set_media_id(this.media_id);

        // First, load early illust data.  This is enough info to set up the image list
        // with preview URLs, so we can start the image view early.  This can return either
        // thumbnail info or illust info.
        //
        // If this blocks to load, the full illust data will be loaded, so we'll never
        // run two separate requests here.
        let early_illust_data = await thumbnail_data.singleton().get_or_load_illust_data(this.media_id);

        // Stop if we were removed before the request finished.
        signal.check();

        // See if we got illust info or thumbnail info.
        if(early_illust_data.mangaPages != null)
        {
            // We got illust data and not thumbnail data, so we have all we need.
            this.illust_data = early_illust_data;
        } else {
            // We got thumbnail data, which only gives us the image dimensions for page 1.  We'll still
            // have any extra_data.
            let extra_data = image_data.get_extra_data(early_illust_data, this.media_id);
            this.images = [{
                preview_url: early_illust_data.previewUrls[0],
                width: early_illust_data.width,
                height: early_illust_data.height,
                crop: extra_data?.crop,
                safe_zone: extra_data?.safe_zone,
            }];

            this.refresh();
            
            // Now wait for full illust info to load.
            this.illust_data = await image_data.singleton().get_media_info(this.media_id);

            // Stop if we were removed before the request finished.
            signal.check();
        }

        // Update the list to include the image URLs.
        this.refresh_from_illust_data();
    }

    refresh_from_illust_data()
    {
        if(this.illust_data == null)
            return;

        this.images = [];
        for(let [page, manga_page] of Object.entries(this.illust_data.mangaPages))
        {
            let extra_data = image_data.get_extra_data(this.illust_data, this.media_id, page);
            this.images.push({
                url: manga_page.urls.original,
                preview_url: manga_page.urls.small,
                inpaint_url: manga_page.urls.inpaint,
                width: manga_page.width,
                height: manga_page.height,
                crop: extra_data?.crop,
                safe_zone: extra_data?.safe_zone,
            });
        }

        this.refresh();
    }

    // If illust data changes, refresh in case any image URLs have changed.
    illust_data_changed()
    {
        // If we don't have illust_data, load() is still going.  Don't do anything here,
        // let it finish and it'll pick up the latest data.
        if(this.illust_data == null)
            return;

        // Get the updated illust data.
        let illust_data = image_data.singleton().get_media_info_sync(this.media_id);
        if(illust_data == null)
            return;

        this.illust_data = illust_data;
        this.refresh_from_illust_data();
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

        if(this.image_editor)
        {
            this.image_editor.shutdown();
            this.image_editor = null;
        }

        main_context_menu.get.on_click_viewer = null;
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
            console.log(`No info for page ${this._page} yet`);
            this.on_click_viewer.set_new_image();
            return;
        }

        // Create the new image and pass it to the viewer.
        this.url = current_image.url || current_image.preview_url;
        this.on_click_viewer.set_new_image({
            media_id: this.media_id,
            url: current_image.url,
            preview_url: current_image.preview_url,
            inpaint_url: current_image.inpaint_url,
            width: current_image.width,
            height: current_image.height,
            crop: this.image_editor.editing_crop? null:current_image.crop, // no cropping while editing cropping
            safe_zone: current_image.safe_zone,
            restore_position: this.restore_history? "history":"auto",

            slideshow: this._slideshow,
            onnextimage: this._onnextimage,

            ondisplayed: (e) => {
                // Clear restore_history once the image is actually restored, since we
                // only want to do this the first time.  We don't do this immediately
                // so we don't skip it if a set_new_image call is interrupted when we
                // replace preview images (history has always been restored when we get
                // here).
                this.restore_history = false;
            },
        });

        // If we have a manga_page_bar, update to show the current page.
        if(this.manga_page_bar)
        {
            if(this.images.length == 1)
                this.manga_page_bar.set(null);
            else
                this.manga_page_bar.set((this._page+1) / this.images.length);
        }
    }

    onkeydown = (e) =>
    {
        if(e.ctrlKey || e.altKey || e.metaKey)
            return;
        
        switch(e.keyCode)
        {
        case 36: // home
        case 35: // end
            e.stopPropagation();
            e.preventDefault();

            let id = helpers.parse_media_id(this.media_id);
        
            if(e.keyCode == 35)
                id.page = this.illust_data.pageCount - 1;
            else
                id.page = 0;

            let new_media_id = helpers.encode_media_id(id);
            main_controller.singleton.show_media(new_media_id);
            return;
        }
    }
}
