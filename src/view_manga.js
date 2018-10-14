// A full page viewer for manga thumbnails.
//
// This is similar to the main search view.  It doesn't share code, since it
// works differently enough that it would complicate things too much.
class view_manga extends view
{
    constructor(container)
    {
        super(container);

        this.refresh_ui = this.refresh_ui.bind(this);
        this.window_onresize = this.window_onresize.bind(this);
        this.refresh_images = this.refresh_images.bind(this);

        window.addEventListener("resize", this.window_onresize);

        this.progress_bar = main_controller.singleton.progress_bar;
        this.ui = new image_ui(this.container.querySelector(".ui-container"), this.progress_bar);
        this.scroll_positions_by_illust_id = {};
        
        image_data.singleton().user_modified_callbacks.register(this.refresh_ui);
        image_data.singleton().illust_modified_callbacks.register(this.refresh_ui);

        settings.register_change_callback("manga-thumbnail-size", this.refresh_images);
        
        // Create a style for our thumbnail style.
        this.thumbnail_dimensions_style = document.createElement("style");
        document.body.appendChild(this.thumbnail_dimensions_style);
    }

    window_onresize(e)
    {
        if(!this.active)
            return;
        
        console.log("resize");
        this.refresh_images();
    }

    set active(active)
    {
        super.active = active;
        
        if(this.active == active)
            return;

        this._active = active;

        if(!active)
        {
            // Save the old scroll position.
            if(this.illust_id != null)
            {
                console.log("save scroll position for", this.illust_id, this.container.scrollTop);
                this.scroll_positions_by_illust_id[this.illust_id] = this.container.scrollTop;
            }

            // Hide the dropdown tag widget.
            this.ui.bookmark_tag_widget.visible = false;
        }

        this.container.hidden = !active;

        if(active)
            this.load_illust_id();
    }

    get active()
    {
        return this._active;
    }

    get shown_illust_id()
    {
        return this.illust_id;
    }

    set shown_illust_id(illust_id)
    {
        if(this.illust_id == illust_id)
            return;

        this.illust_id = illust_id;
        this.illust_info = null;
        this.manga_info = null;
        this.ui.illust_id = illust_id;

        // Refresh even if illust_id is null, so we quickly clear the view.
        this.refresh_ui();
        if(this.illust_id == null)
            return;

        if(!this.active)
            return;

        this.load_illust_id();
    }

    async load_illust_id()
    {
        if(this.illust_id == null)
            return;
        
        console.log("Loading manga view for:", this.illust_id);

        // Load both image and manga info in parallel.
        var results = await Promise.all([
            image_data.singleton().get_image_info(this.illust_id),
            image_data.singleton().get_manga_info(this.illust_id),
        ]);

        var illust_info = results[0];
        if(illust_info.id != this.illust_id)
            return;

        this.illust_info = results[0];
        this.manga_info = results[1];

        this.refresh_ui();
    }

    get displayed_illust_id()
    {
        return this.illust_id;        
    }
    
    refresh_ui()
    {
        helpers.set_title_and_icon(this.illust_info);
        
        this.refresh_images();
    }

    refresh_images()
    {
        var original_scroll_top = this.container.scrollTop;

        // Remove all existing entries and collect them.
        var ul = this.container.querySelector("ul.thumbnails");
        helpers.remove_elements(ul);

        if(this.manga_info == null)
            return;

        // Get the aspect ratio to crop images to.
        var ratio = this.get_display_aspect_ratio(this.manga_info);

        this.thumbnail_dimensions_style.textContent = helpers.make_thumbnail_sizing_style(ul, ".view-manga-container", {
            wide: true,
            size: this.ui.thumbnail_size_slider.thumbnail_size,
            ratio: ratio,

            // We preload this page anyway since it doesn't cause a lot of API calls, so we
            // can allow a high column count and just let the size take over.
            max_columns: 15,
        });

        for(var page = 0; page < this.manga_info.length; ++page)
        {
            var manga_page = this.manga_info[page];
            
            var entry = this.create_thumb(page, manga_page);
            var link = entry.querySelector(".thumbnail-link");
            helpers.set_thumbnail_panning_direction(entry, manga_page.width, manga_page.height, ratio);
            
            ul.appendChild(entry);
        }
        
        // Restore the value of scrollTop from before we updated.  For some reason, Firefox
        // modifies scrollTop after we add a bunch of items, which causes us to scroll to
        // the wrong position, even though scrollRestoration is disabled.
        this.container.scrollTop = original_scroll_top;
    }

    // Given a list of manga infos, return the aspect ratio we'll crop them to.
    get_display_aspect_ratio(manga_info)
    {
        // A lot of manga posts use the same resolution for all images, or just have
        // one or two exceptions for things like title pages.  If most images have
        // about the same aspect ratio, use it.
        var total = 0;
        for(var manga_page of manga_info)
            total += manga_page.width / manga_page.height;
        var average_aspect_ratio = total / manga_info.length;

        var illusts_far_from_average = 0;
        for(var manga_page of manga_info)
        {
            var ratio = manga_page.width / manga_page.height;
            if(Math.abs(average_aspect_ratio - ratio) > 0.1)
                illusts_far_from_average++;
        }

        // If we didn't find a common aspect ratio, just use square thumbs.
        if(illusts_far_from_average > 3)
            return 1;
        else
            return average_aspect_ratio;
    }

    get_display_resolution(width, height)
    {
        var fit_width = 300;
        var fit_height = 300;

        var ratio = width / fit_width;
        if(ratio > 1)
        {
            height /= ratio;
            width /= ratio;
        }

        var ratio = height / fit_height;
        if(ratio > 1)
        {
            height /= ratio;
            width /= ratio;
        }

        return [width, height];
    }

    create_thumb(page_idx, manga_page)
    {
        if(this.thumbnail_template == null)
            this.thumbnail_template = document.body.querySelector(".template-manga-view-thumbnail");
            
        var element = helpers.create_from_template(this.thumbnail_template);

        // These URLs should be the 540x540_70 master version, which is a non-squared high-res
        // thumbnail.  These tend to be around 30-40k, so loading a full manga set of them is
        // quick.
        //
        // XXX: switch this to 540x540_10_webp in Chrome, around 5k?
        var thumb = element.querySelector(".thumb");
        var url = manga_page.urls.small;
//        url = url.replace("/540x540_70/", "/540x540_10_webp/");
        thumb.src = url;
       
        var size = this.get_display_resolution(manga_page.width, manga_page.height);
        thumb.width = size[0];
        thumb.height = size[1];
        
        var link = element.querySelector("a.thumbnail-link");
        link.href = "/member_illust.php?mode=medium&illust_id=" + this.illust_id + "#ppixiv?page=" + (page_idx+1);
        link.dataset.illustId = this.illust_id;
        link.dataset.pageIdx = page_idx;

        element.dataset.pageIdx = page_idx;
        return element;
    }

    scroll_to_top()
    {
        // Read offsetHeight to force layout to happen.  If we don't do this, setting scrollTop
        // sometimes has no effect in Firefox.
        this.container.offsetHeight;
        this.container.scrollTop = 0;
        console.log("scroll to top", this.container.scrollTop, this.container.hidden, this.container.offsetHeight);
    }

    restore_scroll_position()
    {
        // If we saved a scroll position when navigating away from a data source earlier,
        // restore it now.  Only do this once.
        var scroll_pos = this.scroll_positions_by_illust_id[this.illust_id];
        if(scroll_pos != null)
        {
            console.log("scroll pos:", scroll_pos);
            this.container.scrollTop = scroll_pos;
            delete this.scroll_positions_by_illust_id[this.illust_id];
        }
        else
            this.scroll_to_top();
    }

    scroll_to_illust_id(illust_id, manga_page)
    {
        if(manga_page == null)
            return;

        var thumb = this.container.querySelector('[data-page-idx="' + manga_page + '"]');
        if(thumb == null)
            return;

        console.log("Scrolling to", thumb);

        // If the item isn't visible, center it.
        var scroll_pos = this.container.scrollTop;
        if(thumb.offsetTop < scroll_pos || thumb.offsetTop + thumb.offsetHeight > scroll_pos + this.container.offsetHeight)
            this.container.scrollTop = thumb.offsetTop + thumb.offsetHeight/2 - this.container.offsetHeight/2;
    }

    handle_onkeydown(e)
    {
        this.ui.handle_onkeydown(e);
    }    
}

