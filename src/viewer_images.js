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
        `});

        this.manga_page_bar = options.manga_page_bar;
        this.restore_history = false;

        this.load = new SentinelGuard(this.load, this);

        let image_viewer_class = ppixiv.mobile? image_viewer_mobile:image_viewer_desktop;

        // Create a click and drag viewer for the image.
        this.on_click_viewer = new image_viewer_class({
            container: this.container,
        });

        // Make this the primary image viewer.
        image_viewer_base.set_primary(this.on_click_viewer);

        media_cache.addEventListener("mediamodified", ({media_id}) => {
            if(media_id == this.media_id)
            {
                console.log("refresh from modified");
                this.media_info_modified();
            }
        }, { signal: this.shutdown_signal.signal });

        // Create the inpaint editor.  This is passed down to on_click_viewer to group
        // it with the image, but we create it here and reuse it.
        this.image_editor = new ppixiv.ImageEditor({
            container: this.container,
            overlay_container: this.on_click_viewer.editing_container,
            onvisibilitychanged: () => { this.refresh(); }, // refresh when crop editing is changed
        });
    }

    get _page()
    {
        if(this.media_id == null)
            return 0;
        else
            return helpers.parse_media_id(this.media_id).page;
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
        this._slideshow = slideshow;
        this._onnextimage = onnextimage;

        // Tell the inpaint editor about the image.
        this.image_editor.set_media_id(this.media_id);

        // If full info is already loaded, use it.  We don't need to go async at all in this case.
        let illust_data = ppixiv.media_cache.get_media_info_sync(this.media_id);
        if(illust_data)
        {
            this._update_from_illust_data(illust_data);
            return;
        }

        // We don't have full info yet.  See if we have partial info.  If we do, we can use it
        // to set up the viewer immediately while we wait for full info to load.  This lets us
        // display the preview image if possible and not flash a black screen.
        illust_data = ppixiv.media_cache.get_media_info_sync(this.media_id, { full: false });
        if(illust_data)
        {
            this.illust_data = illust_data;

            // We got partial info, which only gives us the image dimensions for page 1.
            let extra_data = ppixiv.media_cache.get_extra_data(illust_data, this.media_id);
            this.images = [{
                preview_url: illust_data.previewUrls[0],
                width: illust_data.width,
                height: illust_data.height,
                crop: extra_data?.crop,
                pan: extra_data?.pan,
            }];

            this.refresh();
        }

        // Load full info.
        illust_data = await media_cache.get_media_info(this.media_id);

        // Stop if we were called again while we were waiting.
        signal.check();

        this._update_from_illust_data(illust_data);
    }

    _update_from_illust_data(illust_data)
    {
        this.illust_data = illust_data;
        this.refresh_from_illust_data();
    }

    refresh_from_illust_data()
    {
        if(this.illust_data == null)
            return;

        this.images = [];
        for(let [page, manga_page] of Object.entries(this.illust_data.mangaPages))
        {
            let extra_data = ppixiv.media_cache.get_extra_data(this.illust_data, this.media_id, page);
            this.images.push({
                url: manga_page.urls.original,
                preview_url: manga_page.urls.small,
                inpaint_url: manga_page.urls.inpaint,
                width: manga_page.width,
                height: manga_page.height,
                crop: extra_data?.crop,
                pan: extra_data?.pan,
            });
        }

        this.refresh();
    }

    // If media info changes, refresh in case any image URLs have changed.
    media_info_modified()
    {
        // Get the updated illust data.
        let illust_data = ppixiv.media_cache.get_media_info_sync(this.media_id);
        if(illust_data == null)
            return;

        this._update_from_illust_data(illust_data);
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
        this.on_click_viewer.set_new_image({
            media_id: this.media_id,
            url: current_image.url,
            preview_url: current_image.preview_url,
            inpaint_url: current_image.inpaint_url,
            width: current_image.width,
            height: current_image.height,
            crop: this.image_editor.editing_crop? null:current_image.crop, // no cropping while editing cropping
            pan: current_image.pan,
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
        
        switch(e.code)
        {
        case "Home":
        case "End":
            e.stopPropagation();
            e.preventDefault();

            let id = helpers.parse_media_id(this.media_id);
        
            if(e.code == "End")
                id.page = this.illust_data.pageCount - 1;
            else
                id.page = 0;

            let new_media_id = helpers.encode_media_id(id);
            main_controller.singleton.show_media(new_media_id);
            return;
        }
    }
}
