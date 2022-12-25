import Widget from 'vview/widgets/widget.js';
import Actions from 'vview/misc/actions.js';
import { ConfirmPrompt } from 'vview/widgets/prompts.js';
import { helpers } from 'vview/misc/helpers.js';

// A widget that shows info for a particular media ID, and refreshes if the image changes.
export class IllustWidget extends Widget
{
    constructor(options)
    {
        super(options);

        // Refresh when the image data changes.
        ppixiv.mediaCache.addEventListener("mediamodified", (e) => {
            if(e.mediaId == this._mediaId)
                this.refresh();
        }, { signal: this.shutdownSignal.signal });
    }

    // The data this widget needs.  This can be mediaId (nothing but the ID), full or partial.
    //
    // This can change dynamically.  Some widgets need media info only when viewing a manga
    // page.
    get neededData() { return "full"; }

    setMediaId(mediaId)
    {
        if(this._mediaId == mediaId)
            return;

        this._mediaId = mediaId;

        let [illustId, page] = helpers.mediaId.toIllustIdAndPage(mediaId);
        this._page = page;
        this.refresh();
    }
    
    get mediaId() { return this._mediaId; }

    async refresh()
    {
        // Grab the illust info.
        let mediaId = this._mediaId;
        let info = { mediaId: this._mediaId };
        
        // If we have a media ID and we want media info (not just the media ID itself), load
        // the info.
        if(this._mediaId != null && this.neededData != "mediaId")
        {
            let full = this.neededData == "full";

            // See if we have the data the widget wants already.
            info.mediaInfo = ppixiv.mediaCache.getMediaInfoSync(this._mediaId, { full });

            // If we need to load data, clear the widget while we load, so we don't show the old
            // data while we wait for data.  Skip this if we don't need to load, so we don't clear
            // and reset the widget.  This can give the widget an illust ID without data, which is
            // OK.
            if(info.mediaInfo == null)
                await this.refreshInternal(info);

            info.mediaInfo = await ppixiv.mediaCache.getMediaInfo(this._mediaId, { full });
        }

        // Stop if the media ID changed while we were async.
        if(this._mediaId != mediaId)
            return;

        await this.refreshInternal(info);
    }

    async refreshInternal({ mediaId, mediaInfo })
    {
        throw "Not implemented";
    }
}

export class BookmarkButtonWidget extends IllustWidget
{
    get neededData() { return "partial"; }

    constructor({
        // The caller provides the template.
        template=null,

        // "public", "private" or "delete"
        bookmarkType,

        // If true, clicking a bookmark button that's already bookmarked will remove the
        // bookmark.  If false, the bookmark tags will just be updated.
        toggleBookmark=true,

        // An associated BookmarkTagListWidget.
        //
        // Bookmark buttons and the tag list widget both manipulate and can create bookmarks.  Telling
        // us about an active bookmarkTagListWidget lets us prevent collisions.
        bookmarkTagListWidget,

        ...options})
    {
        console.assert(template != null),
        super({
            template,
            ...options,
        });

        this.bookmarkType = bookmarkType;
        this.toggleBookmark = toggleBookmark;
        this._bookmarkTagListWidget = bookmarkTagListWidget;

        this.container.addEventListener("click", this.clickedBookmark);
    }

    // Dispatch bookmarkedited when we're editing a bookmark.  This lets any bookmark tag
    // dropdowns know they should close.
    _fireOnEdited()
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

    refreshInternal({ mediaId, mediaInfo })
    {
        // If this is a local image, we won't have a bookmark count, so set local-image
        // to remove our padding for it.  We can get mediaId before mediaInfo.
        let is_local =  helpers.mediaId.isLocal(mediaId);
        helpers.html.setClass(this.container,  "has-like-count", !is_local);

        let { type } = helpers.mediaId.parse(mediaId);

        // Hide the private bookmark button for local IDs.
        if(this.bookmarkType == "private")
            this.container.closest(".button-container").hidden = is_local;

        let bookmarked = mediaInfo?.bookmarkData != null;
        let privateBookmark = this.bookmarkType == "private";
        let isOurBookmarkType = mediaInfo?.bookmarkData?.private == privateBookmark;
        let willDelete = this.toggleBookmark && isOurBookmarkType;
        if(this.bookmarkType == "delete")
            isOurBookmarkType = willDelete = bookmarked;

        // Set up the bookmark buttons.
        helpers.html.setClass(this.container,  "enabled",     mediaInfo != null);
        helpers.html.setClass(this.container,  "bookmarked",  isOurBookmarkType);
        helpers.html.setClass(this.container,  "will-delete", willDelete);
        
        // Set the tooltip.
        this.container.dataset.popup =
            mediaInfo == null? "":
            !bookmarked && this.bookmarkType == "folder"? "Bookmark folder":
            !bookmarked && this.bookmarkType == "private"? "Bookmark privately":
            !bookmarked && this.bookmarkType == "public" && type == "folder"? "Bookmark folder":
            !bookmarked && this.bookmarkType == "public"? "Bookmark image":
            willDelete? "Remove bookmark":
            "Change bookmark to " + this.bookmarkType;
    }
    
    // Clicked one of the top-level bookmark buttons or the tag list.
    clickedBookmark = async(e) =>
    {
        // See if this is a click on a bookmark button.
        let a = e.target.closest(".button-bookmark");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // If the tag list dropdown is open, make a list of tags selected in the tag list dropdown.
        // If it's closed, leave tagList null so we don't modify the tag list.
        let tagList = null;
        if(this._bookmarkTagListWidget && this._bookmarkTagListWidget.visibleRecursively)
            tagList = this._bookmarkTagListWidget.selectedTags;

        // If we have a tag list dropdown, tell it to become inactive.  It'll continue to
        // display its contents, so they don't change during transitions, but it won't make
        // any further bookmark changes.  This prevents it from trying to create a bookmark
        // when it closes, since we're doing that already.
        if(this._bookmarkTagListWidget)
            this._bookmarkTagListWidget.deactivate();

        this._fireOnEdited();

        let mediaInfo = await ppixiv.mediaCache.getMediaInfo(this._mediaId, { full: false });
        let privateBookmark = this.bookmarkType == "private";

        // If the image is bookmarked and a delete bookmark button or the same privacy button was clicked, remove the bookmark.
        let deleteBookmark = this.toggleBookmark && mediaInfo.bookmarkData?.private == privateBookmark;
        if(this.bookmarkType == "delete")
            deleteBookmark = true;

        if(deleteBookmark)
        {
            if(!mediaInfo.bookmarkData)
                return;

            // Confirm removing bookmarks when on mobile.
            if(ppixiv.mobile)
            {
                let result = await (new ConfirmPrompt({ header: "Remove bookmark?" })).result;
                if(!result)
                    return;
            }

            let mediaId = this._mediaId;
            await Actions.bookmarkRemove(this._mediaId);

            // If the current image changed while we were async, stop.
            if(mediaId != this._mediaId)
                return;
            
            // Hide the tag dropdown after unbookmarking, without saving any tags in the
            // dropdown (that would readd the bookmark).
            if(this._bookmarkTagListWidget)
                this._bookmarkTagListWidget.deactivate();

            this._fireOnEdited();

            return;
        }

        // Add or edit the bookmark.
        await Actions.bookmarkAdd(this._mediaId, {
            private: privateBookmark,
            tags: tagList,
        });
    }
}

export class BookmarkCountWidget extends IllustWidget
{
    constructor({ ...options })
    {
        super({
            ...options,
            template: `
                <div class=count></div>
            `
        });
    }
    
    refreshInternal({ mediaId, mediaInfo })
    {
        let text = "";
        if(!helpers.mediaId.isLocal(mediaId))
            text = mediaInfo?.bookmarkCount ?? "---";
        this.container.textContent = text;
    }
}

export class LikeButtonWidget extends IllustWidget
{
    get neededData() { return "mediaId"; }

    constructor({
        // The caller provides the template.
        template=null,
        ...options
    })
    {
        console.assert(template != null),
        super({
            template,
            ...options,
        })

        this.container.addEventListener("click", this.clickedLike);
    }

    async refreshInternal({ mediaId })
    {
        // Hide the like button for local IDs.
        this.container.closest(".button-container").hidden = helpers.mediaId.isLocal(mediaId);

        let likedRecently = mediaId != null? ppixiv.extraCache.getLikedRecently(mediaId):false;
        helpers.html.setClass(this.container, "liked", likedRecently);
        helpers.html.setClass(this.container, "enabled", !likedRecently);

        this.container.dataset.popup = this._mediaId == null? "":
            likedRecently? "Already liked image":"Like image";
    }
    
    clickedLike = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(this._mediaId != null)
            Actions.likeImage(this._mediaId);
    }
}

export class LikeCountWidget extends IllustWidget
{
    constructor({ ...options })
    {
        super({
            ...options,
            template: `
                <div class=count></div>
            `
        });
    }
    
    async refreshInternal({ mediaId, mediaInfo })
    {
        let text = "";
        if(!helpers.mediaId.isLocal(mediaId))
            text = mediaInfo?.likeCount ?? "---";
        this.container.textContent = text;
    }
}
