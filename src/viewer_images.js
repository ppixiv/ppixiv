// This is the viewer for static images.  We take an illust_data and show
// either a single image or navigate between an image sequence.
//
class viewer_images extends viewer
{
    constructor(container, illust_data, options)
    {
        super(container, illust_data);

        this.illust_data = illust_data;
        this.container = container;
        this.options = options || {};
        this.progress_bar = options.progress_bar;
        this.manga_page_bar = options.manga_page_bar;
        
        this.onkeydown = this.onkeydown.bind(this);

        this.index = options.show_last_image? illust_data.pageCount-1:0;

        // Create the image element.
        this.img = document.createElement("img");
        this.img.className = "filtering";
        container.appendChild(this.img);

        // Create a click and drag viewer for the image.
        this.viewer = new on_click_viewer(this.img);

        // Make a list of image URLs we're viewing.
        this.images = [];

        for(var page = 0; page < illust_data.pageCount; ++page)
            this.images.push(helpers.get_url_for_page(illust_data, page, "original"));

        this.refresh();
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

        if(this.progress_bar)
            this.progress_bar.detach();
    }

    move(down)
    {
        var new_index = this.index + (down? +1:-1);
        new_index = Math.max(0, Math.min(this.images.length-1, new_index));
        if(new_index == this.index)
            return false;

        this.index = new_index;
        this.refresh();
        return true;
    }

    refresh(e)
    {
        var url = this.images[this.index];
        if(this.viewer && this.img.src == url)
            return;

        this.img.src = url;
        this.viewer.image_changed();

        if(this.options.page_changed)
            this.options.page_changed(this.index, this.images.length, url);

        if(this.progress_bar)
        {
            if(this.images.length == 1)
                this.progress_bar.set(null);
            else
            {
                // Flash the current manga page in the progress bar briefly.
                this.progress_bar.set((this.index+1) / this.images.length);
                this.progress_bar.show_briefly();
            }
        }
        
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
            this.index = 0;
            this.refresh();
            return;

        case 35: // end
            e.stopPropagation();
            e.preventDefault();

            this.index = this.images.length - 1;
            this.refresh();
            return;
        }
    }
}
