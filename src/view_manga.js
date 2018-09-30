// A full page viewer for manga thumbnails.
//
// This is similar to the main search view.  It doesn't share code, since it
// works differently enough that it would complicate things too much.
class view_manga extends view
{
    constructor(container)
    {
        super();

        this.container = container;
        this.refresh_ui = this.refresh_ui.bind(this);

        this.ui = new image_ui(this.container.querySelector(".ui-container"), this.progress_bar);
        
        image_data.singleton().user_modified_callbacks.register(this.refresh_ui);
        image_data.singleton().illust_modified_callbacks.register(this.refresh_ui);

        // Create a style for our thumbnail style.
        this.thumbnail_dimensions_style = document.createElement("style");
        document.body.appendChild(this.thumbnail_dimensions_style);
    }

    set active(active)
    {
        if(this.active == active)
            return;

        this._active = active;
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
            image_data.singleton().get_image_info_async(this.illust_id),
            image_data.singleton().get_manga_info_async(this.illust_id),
        ]);

        var illust_info = results[0];
        if(illust_info.id != this.illust_id)
            return;

        this.illust_info = results[0];
        this.manga_info = results[1];

        this.refresh_ui();
    }

    refresh_ui()
    {
        helpers.set_title_and_icon(this.illust_info);
        
        this.refresh_images();
    }

    refresh_images()
    {
        // Remove all existing entries and collect them.
        var ul = this.container.querySelector("ul.thumbnails");
        helpers.remove_elements(ul);

        if(this.manga_info == null)
            return;

        // Get the aspect ratio to crop images to.
        var ratio = this.get_display_aspect_ratio(this.manga_info);

        // Figure out the size to use.
        // XXX: large/small/wide thumb settings
        var max_width = 400;
        var max_height = 400;
        if(ratio < 1)
            max_width *= ratio;
        else if(ratio > 1)
            max_height /= ratio;

        this.thumbnail_dimensions_style.textContent = ".view-manga-container .thumbnail-link { width: " + max_width + "px; height: " + max_height + "px; }";

        for(var page = 0; page < this.manga_info.length; ++page)
        {
            var manga_page = this.manga_info[page];
            
            var entry = this.create_thumb(page, manga_page);
            var link = entry.querySelector(".thumbnail-link");
            helpers.set_thumbnail_panning_direction(entry, manga_page.width, manga_page.height, ratio);
            
            ul.appendChild(entry);
        }
    }

    // Given a list of manga infos, return the aspect ratio we'll crop them to.
    get_display_aspect_ratio(manga_info)
    {
        // A lot of manga posts use the same resolution for all images, or just have
        // one or two exceptions for things like title pages.  Try to find a common
        // aspect ratio across most images, allowing for a couple exceptions.
        //
        // First, make a list of aspect ratios, in 0.1 chunks.  XXX: This doesn't deal
        // with the boundary condition (0.899 is in a different bucket than 0.901).
        var count_by_aspect_ratio = [];
        for(var manga_page of manga_info)
        {
            var width = manga_page.width;
            var height = manga_page.height;
            var ratio = width / height;
            var snapped_ratio = Math.round(10 * ratio);
            if(count_by_aspect_ratio[snapped_ratio] == null)
                count_by_aspect_ratio[snapped_ratio] = 0;
            count_by_aspect_ratio[snapped_ratio]++;
        }

        // If all but a small number of images have roughly the same aspect ratio, use that
        // that for all thumbs.  If there's more variance than that, just use squares.
        for(var ratio in count_by_aspect_ratio)
        {
            var total_in_ratio = count_by_aspect_ratio[ratio];

            if(total_in_ratio >= this.manga_info.length - 3)
                return ratio / 10;
        }

        // We didn't find a common aspect ratio, so just use square thumbs.
        return 1;
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
        
        // XXX: support page number in URLs
        var link = element.querySelector("a.thumbnail-link");
        link.href = "/member_illust.php?mode=medium&illust_id=" + this.illust_id + "#ppixiv?page=" + page_idx;
        link.dataset.illustId = this.illust_id;
        link.dataset.pageIdx = page_idx;

        element.dataset.pageIdx = page_idx;
        return element;
    }

}

