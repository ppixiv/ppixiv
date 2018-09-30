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

        this.ui = new image_ui(this.container.querySelector(".ui-container"), this.progress_bar);
        
        // Create a style for our thumbnail style.
        this.thumbnail_dimensions_style = document.createElement("style");
        document.body.appendChild(this.thumbnail_dimensions_style);
    }

    // XXX: don't load manga data while !this.active
    set active(active)
    {
        if(this.active == active)
            return;
        console.log("manga view:", active);

        this._active = active;
        this.container.hidden = !active;
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
        this.refresh_images();
        if(this.illust_id == null)
            return;

        console.log("Loading manga view for:", this.illust_id);
        // Load info about this post.
        image_data.singleton().get_image_info(this.illust_id, this.got_illust_info.bind(this));
        image_data.singleton().get_manga_info(this.illust_id, this.got_manga_info.bind(this));
    }

    got_illust_info(illust_info)
    {
        if(illust_info.id != this.illust_id)
            return;
        console.log("XXX1 illust");
        this.illust_info = illust_info;
    }

    got_manga_info(manga_info, illust_id)
    {
        if(illust_id != this.illust_id)
            return;
        console.log("got", illust_id);
        this.manga_info = manga_info;
        this.refresh_images();
    }

    refresh_images()
    {
        // Remove all existing entries and collect them.
        var ul = this.container.querySelector("ul.thumbnails");
        helpers.remove_elements(ul);
//        var original_scroll_top = this.container.scrollTop;

        if(this.manga_info == null)
            return;

        /* Given a size to fit thumbs into, find the max width and height.  A lot
         * of manga posts use the same resolution for all images, so fitting all
         * images into this will pack most posts cleanly. */
        var max_width = 1;
        var max_height = 1;
        for(var manga_page of this.manga_info)
        {
            var width = manga_page.width;
            var height = manga_page.height;

            var size = this.get_display_resolution(manga_page.width, manga_page.height);
            max_width = Math.max(max_width, size[0]);
            max_height = Math.max(max_height, size[1]);
        }

        this.thumbnail_dimensions_style.textContent = ".manga-view-container .thumbnail-box { width: " + max_width + "px; max-height: " + max_height + "px; }";


        for(var page = 0; page < this.manga_info.length; ++page)
        {
            var manga_page = this.manga_info[page];
            
            var entry = this.create_thumb(page, manga_page);
            ul.appendChild(entry);
        }
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

