import Widget from 'vview/widgets/widget.js';
import Actions from 'vview/misc/actions.js';
import { helpers } from 'vview/misc/helpers.js';

// A widget that shows info for a particular media ID, and refreshes if the image changes.
export class IllustWidget extends Widget
{
    constructor(options)
    {
        super(options);

        // Refresh when the image data changes.
        ppixiv.media_cache.addEventListener("mediamodified", (e) => {
            if(e.media_id == this._media_id)
                this.refresh();
        }, { signal: this.shutdown_signal.signal });
    }

    // The data this widget needs.  This can be media_id (nothing but the ID), full or partial.
    //
    // This can change dynamically.  Some widgets need illust_info only when viewing a manga
    // page.
    get needed_data() { return "full"; }

    set_media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;

        let [illust_id, page] = helpers.media_id_to_illust_id_and_page(media_id);
        this._page = page;
        this.refresh();
    }
    
    get media_id() { return this._media_id; }

    async refresh()
    {
        // Grab the illust info.
        let media_id = this._media_id;
        let info = { media_id: this._media_id };
        
        // If we have a media ID and we want media info (not just the media ID itself), load
        // the info.
        if(this._media_id != null && this.needed_data != "media_id")
        {
            let full = this.needed_data == "full";

            // See if we have the data the widget wants already.
            info.media_info = ppixiv.media_cache.get_media_info_sync(this._media_id, { full });

            // If we need to load data, clear the widget while we load, so we don't show the old
            // data while we wait for data.  Skip this if we don't need to load, so we don't clear
            // and reset the widget.  This can give the widget an illust ID without data, which is
            // OK.
            if(info.media_info == null)
                await this.refresh_internal(info);

            info.media_info = await ppixiv.media_cache.get_media_info(this._media_id, { full });
        }

        // Stop if the media ID changed while we were async.
        if(this._media_id != media_id)
            return;

        await this.refresh_internal(info);
    }

    async refresh_internal({ media_id, media_info })
    {
        throw "Not implemented";
    }
}

export class BookmarkButtonWidget extends IllustWidget
{
    get needed_data() { return "partial"; }

    constructor({
        // "public", "private" or "delete"
        bookmark_type,

        // If true, clicking a bookmark button that's already bookmarked will remove the
        // bookmark.  If false, the bookmark tags will just be updated.
        toggle_bookmark=true,

        // An associated BookmarkTagListWidget.
        //
        // Bookmark buttons and the tag list widget both manipulate and can create bookmarks.  Telling
        // us about an active bookmarkTagListWidget lets us prevent collisions.
        bookmarkTagListWidget,

        ...options})
    {
        super({...options});

        this.bookmark_type = bookmark_type;
        this.toggle_bookmark = toggle_bookmark;
        this._bookmarkTagListWidget = bookmarkTagListWidget;

        this.container.addEventListener("click", this.clicked_bookmark);
    }

    // Dispatch bookmarkedited when we're editing a bookmark.  This lets any bookmark tag
    // dropdowns know they should close.
    _fire_onedited()
    {
        this.dispatchEvent(new Event("bookmarkedited"));
    }

    // Set the associated bookmarkTagListWidget.
    //
    // Bookmark buttons and the tag list widget both manipulate and can create bookmarks.  Telling
    // us about an active bookmarkTagListWidget lets us prevent collisions.
    set bookmarkTagListWidget(value)
    {
        this._bookmarkTagListWidget = value;
    }

    get bookmarkTagListWidget()
    {
        return this._bookmarkTagListWidget;
    }

    refresh_internal({ media_id, media_info })
    {
        // If this is a local image, we won't have a bookmark count, so set local-image
        // to remove our padding for it.  We can get media_id before media_info.
        let is_local =  helpers.is_media_id_local(media_id);
        helpers.set_class(this.container,  "has-like-count", !is_local);

        let { type } = helpers.parse_media_id(media_id);

        // Hide the private bookmark button for local IDs.
        if(this.bookmark_type == "private")
            this.container.closest(".button-container").hidden = is_local;

        let bookmarked = media_info?.bookmarkData != null;
        let private_bookmark = this.bookmark_type == "private";
        let is_our_bookmark_type = media_info?.bookmarkData?.private == private_bookmark;
        let will_delete = this.toggle_bookmark && is_our_bookmark_type;
        if(this.bookmark_type == "delete")
            is_our_bookmark_type = will_delete = bookmarked;

        // Set up the bookmark buttons.
        helpers.set_class(this.container,  "enabled",     media_info != null);
        helpers.set_class(this.container,  "bookmarked",  is_our_bookmark_type);
        helpers.set_class(this.container,  "will-delete", will_delete);
        
        // Set the tooltip.
        this.container.dataset.popup =
            media_info == null? "":
            !bookmarked && this.bookmark_type == "folder"? "Bookmark folder":
            !bookmarked && this.bookmark_type == "private"? "Bookmark privately":
            !bookmarked && this.bookmark_type == "public" && type == "folder"? "Bookmark folder":
            !bookmarked && this.bookmark_type == "public"? "Bookmark image":
            will_delete? "Remove bookmark":
            "Change bookmark to " + this.bookmark_type;
    }
    
    // Clicked one of the top-level bookmark buttons or the tag list.
    clicked_bookmark = async(e) =>
    {
        // See if this is a click on a bookmark button.
        let a = e.target.closest(".button-bookmark");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // If the tag list dropdown is open, make a list of tags selected in the tag list dropdown.
        // If it's closed, leave tag_list null so we don't modify the tag list.
        let tag_list = null;
        if(this._bookmarkTagListWidget && this._bookmarkTagListWidget.visible_recursively)
            tag_list = this._bookmarkTagListWidget.selected_tags;

        // If we have a tag list dropdown, tell it to become inactive.  It'll continue to
        // display its contents, so they don't change during transitions, but it won't make
        // any further bookmark changes.  This prevents it from trying to create a bookmark
        // when it closes, since we're doing that already.
        if(this._bookmarkTagListWidget)
            this._bookmarkTagListWidget.deactivate();

        this._fire_onedited();

        let illust_data = await ppixiv.media_cache.get_media_info(this._media_id, { full: false });
        let private_bookmark = this.bookmark_type == "private";

        // If the image is bookmarked and a delete bookmark button or the same privacy button was clicked, remove the bookmark.
        let delete_bookmark = this.toggle_bookmark && illust_data.bookmarkData?.private == private_bookmark;
        if(this.bookmark_type == "delete")
            delete_bookmark = true;

        if(delete_bookmark)
        {
            if(!illust_data.bookmarkData)
                return;

            // Confirm removing bookmarks when on mobile.
            if(ppixiv.mobile)
            {
                let result = await (new ppixiv.confirm_prompt({ header: "Remove bookmark?" })).result;
                if(!result)
                    return;
            }

            let media_id = this._media_id;
            await Actions.bookmarkRemove(this._media_id);

            // If the current image changed while we were async, stop.
            if(media_id != this._media_id)
                return;
            
            // Hide the tag dropdown after unbookmarking, without saving any tags in the
            // dropdown (that would readd the bookmark).
            if(this._bookmarkTagListWidget)
                this._bookmarkTagListWidget.deactivate();

            this._fire_onedited();

            return;
        }

        // Add or edit the bookmark.
        await Actions.bookmarkAdd(this._media_id, {
            private: private_bookmark,
            tags: tag_list,
        });
    }
}

// A trivial version of BookmarkButtonWidget that just displays if the image is bookmarked.
export class ImageBookmarkedWidget extends IllustWidget
{
    get needed_data() { return "partial"; }

    refresh_internal({ media_info })
    {
        let bookmarked = media_info?.bookmarkData != null;
        let private_bookmark = media_info?.bookmarkData?.private;

        helpers.set_class(this.container,  "enabled",     media_info != null);
        helpers.set_class(this.container,  "bookmarked",  bookmarked);
        helpers.set_class(this.container,  "public",      !private_bookmark);
    }
}

export class BookmarkCountWidget extends IllustWidget
{
    refresh_internal({ media_info })
    {
        this.container.textContent = media_info? media_info.bookmarkCount:"---";
    }
}

export class LikeButtonWidget extends IllustWidget
{
    get needed_data() { return "media_id"; }

    constructor(options)
    {
        super(options);

        this.container.addEventListener("click", this.clicked_like);
    }

    async refresh_internal({ media_id })
    {
        // Hide the like button for local IDs.
        this.container.closest(".button-container").hidden = helpers.is_media_id_local(media_id);

        let liked_recently = media_id != null? ppixiv.extra_cache.get_liked_recently(media_id):false;
        helpers.set_class(this.container, "liked", liked_recently);
        helpers.set_class(this.container, "enabled", !liked_recently);

        this.container.dataset.popup = this._media_id == null? "":
            liked_recently? "Already liked image":"Like image";
    }
    
    clicked_like = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(this._media_id != null)
            Actions.likeImage(this._media_id);
    }
}

export class LikeCountWidget extends IllustWidget
{
    async refresh_internal({ media_info })
    {
        this.container.textContent = media_info? media_info.likeCount:"---";
    }
}
