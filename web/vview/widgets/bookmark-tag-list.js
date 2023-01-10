import Actor from 'vview/actors/actor.js';
import Actions from 'vview/misc/actions.js';
import RecentBookmarkTags from 'vview/misc/recent-bookmark-tags.js';
import { IllustWidget } from 'vview/widgets/illust-widgets.js';
import { DropdownBoxOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

// Widget for editing bookmark tags.
export class BookmarkTagListWidget extends IllustWidget
{
    get neededData() { return "mediaId"; }

    constructor({...options})
    {
        super({...options, template: `
            <div class="bookmark-tag-list">
                <div class="tag-list vertical-list">
                </div>
            </div>
        `});

        this.displayingMediaId = null;
        this.root.addEventListener("click", this._clickedBookmarkTag, true);
        this.deactivated = false;

        ppixiv.settings.addEventListener("recent-bookmark-tags", this.refresh.bind(this));
    }

    // Deactivate this widget.  We won't refresh or make any bookmark changes after being
    // deactivated.  This is used by the bookmark button widget.  The widget will become
    // active again the next time it's displayed.
    deactivate()
    {
        this.deactivated = true;
    }

    shutdown()
    {
        // If we weren't hidden before being shut down, set ourselves hidden so we save any
        // changes.
        this.visible = false;

        super.shutdown();
    }

    // Return an array of tags selected in the tag dropdown.
    get selectedTags()
    {
        let tagList = [];
        let bookmarkTags = this.root;
        for(let entry of bookmarkTags.querySelectorAll(".popup-bookmark-tag-entry"))
        {
            if(!entry.classList.contains("selected"))
                continue;
            tagList.push(entry.dataset.tag);
        }
        return tagList;
    }

    // Override setting mediaId to save tags when we're closed.  Otherwise, mediaId will already
    // be cleared when we close and we won't be able to save.
    setMediaId(mediaId)
    {
        // If we're hiding and were previously visible, save changes.
        if(mediaId == null)
            this.saveCurrentTags();

        super.setMediaId(mediaId);
    }
    
    async visibilityChanged()
    {
        super.visibilityChanged();

        if(this.visible)
        {
            // If we were deactivated, reactivate when we become visible again.
            if(this.deactivated)
                console.info("reactivating tag list widget");

            this.deactivated = false;

            // We only load existing bookmark tags when the tag list is open, so refresh.
            await this.refresh();
        }
        else
        {
            // Save any selected tags when the dropdown is closed.
            this.saveCurrentTags();

            // Clear the tag list when the menu closes, so it's clean on the next refresh.
            this._clearTagList();

            this.displayingMediaId = null;
        }
    }

    _clearTagList()
    {
        // Make a copy of children when iterating, since it doesn't handle items being deleted
        // while iterating cleanly.
        let bookmarkTags = this.root.querySelector(".tag-list");
        for(let element of [...bookmarkTags.children])
        {
            if(element.classList.contains("dynamic") || element.classList.contains("loading"))
                element.remove();
        }
    }

    async refreshInternal({ mediaId })
    {
        if(this.deactivated)
            return;

        // If we're refreshing the same illust that's already refreshed, store which tags were selected
        // before we clear the list.
        let oldSelectedTags = this.displayingMediaId == mediaId? this.selectedTags:[];

        this.displayingMediaId = null;

        let bookmarkTags = this.root.querySelector(".tag-list");
        this._clearTagList();

        if(mediaId == null || !this.visible)
            return;

        // Create a temporary entry to show loading while we load bookmark details.
        let entry = document.createElement("span");
        entry.classList.add("loading");
        bookmarkTags.appendChild(entry);
        entry.innerText = "Loading...";

        // If the tag list is open, populate bookmark details to get bookmark tags.
        // If the image isn't bookmarked this won't do anything.
        let activeTags = await ppixiv.extraCache.loadBookmarkDetails(mediaId);

        // Remember which illustration's bookmark tags are actually loaded.
        this.displayingMediaId = mediaId;

        // Remove elements again, in case another refresh happened while we were async
        // and to remove the loading entry.
        this._clearTagList();
        
        // If we're refreshing the list while it's open, make sure that any tags the user
        // selected are still in the list, even if they were removed by the refresh.  Put
        // them in activeTags, so they'll be marked as active.
        for(let tag of oldSelectedTags)
        {
            if(activeTags.indexOf(tag) == -1)
                activeTags.push(tag);
        }

        let shownTags = [];

        let recentBookmarkTags = [...RecentBookmarkTags.getRecentBookmarkTags()]; // copy
        for(let tag of recentBookmarkTags)
            if(shownTags.indexOf(tag) == -1)
                shownTags.push(tag);

        // Add any tags that are on the bookmark but not in recent tags.
        for(let tag of activeTags)
            if(shownTags.indexOf(tag) == -1)
                shownTags.push(tag);

        shownTags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));

        let createEntry = (tag, { classes=[], icon }={}) =>
        {
            let entry = this.createTemplate({name: "tag-entry", html: `
                <div class="popup-bookmark-tag-entry dynamic">
                    <span class=tag-name></span>
                </div>
            `});

            for(let cls of classes)
                entry.classList.add(cls);
            entry.querySelector(".tag-name").innerText = tag;

            if(icon)
                entry.querySelector(".tag-name").insertAdjacentElement("afterbegin", icon);
            bookmarkTags.appendChild(entry);

            return entry;
        }

        let addButton = createEntry("Add", {
            icon: helpers.createIcon("add", { asElement: true }),
            classes: ["add-button"],
        });
        addButton.addEventListener("click", () => Actions.addNewBookmarkTag(this._mediaId));

        for(let tag of shownTags)
        {
            let entry = createEntry(tag, {
                classes: ["tag-toggle"],
//                icon: helpers.createIcon("ppixiv:tag", { asElement: true }),
            });

            entry.dataset.tag = tag;

            let active = activeTags.indexOf(tag) != -1;
            helpers.html.setClass(entry, "selected", active);
        }

        let syncButton = createEntry("Refresh", {
            icon: helpers.createIcon("refresh", { asElement: true }),
            classes: ["refresh-button"],
        });

        syncButton.addEventListener("click", async (e) => {
            let bookmarkTags = await Actions.loadRecentBookmarkTags();
            RecentBookmarkTags.setRecentBookmarkTags(bookmarkTags);
            this.refreshInternal({mediaId: this.mediaId});
        });
    }

    // Save the selected bookmark tags to the current illust.
    async saveCurrentTags()
    {
        if(this.deactivated)
            return;

        // Store the ID and tag list we're saving, since they can change when we await.
        let mediaId = this._mediaId;
        let newTags = this.selectedTags;
        if(mediaId == null)
            return;

        // Only save tags if we're refreshed to the current illust ID, to make sure we don't save
        // incorrectly if we're currently waiting for the async refresh.
        if(mediaId != this.displayingMediaId)
            return;

        // Get the tags currently on the bookmark to compare.
        let oldTags = await ppixiv.extraCache.loadBookmarkDetails(mediaId);

        let equal = newTags.length == oldTags.length;
        for(let tag of newTags)
        {
            if(oldTags.indexOf(tag) == -1)
                equal = false;
        }
        // If the selected tags haven't changed, we're done.
        if(equal)
            return;
        
        // Save the tags.  If the image wasn't bookmarked, this will create a public bookmark.
        console.log(`Tag list closing and tags have changed: "${oldTags.join(",")}" -> "${newTags.join(",")}"`);
        await Actions.bookmarkAdd(this._mediaId, {
            tags: newTags,
        });
    }

    // Toggle tags on click.  We don't save changes until we're closed.
    _clickedBookmarkTag = async(e) =>
    {
        if(this.deactivated)
            return;

        let a = e.target.closest(".tag-toggle");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // Toggle this tag.  Don't actually save it immediately, so if we make multiple
        // changes we don't spam requests.
        helpers.html.setClass(a, "selected", !a.classList.contains("selected"));
    }
}

// A bookmark tag list in a dropdown.
//
// The base class is a simple widget.  This subclass handles some of the trickier
// bits around closing the dropdown correctly, and tells any bookmark buttons about
// itself.
class BookmarkTagListDropdownWidget extends BookmarkTagListWidget
{
    constructor({
        mediaId,
        bookmarkButtons,
        ...options
    })
    {
        super({
            classes: ["popup-bookmark-tag-dropdown"],
            ...options
        });

        this.root.classList.add("popup-bookmark-tag-dropdown");

        this.bookmarkButtons = bookmarkButtons;

        this.setMediaId(mediaId);

        // Let the bookmark buttons know about this bookmark tag dropdown, and remove it when
        // it's closed.
        for(let bookmarkButton of this.bookmarkButtons)
            bookmarkButton.bookmarkTagListWidget = this;
    }

    async refreshInternal({ mediaId })
    {
        // Make sure the dropdown is hidden if we have no image.
        if(mediaId == null)
            this.visible = false;

        await super.refreshInternal({ mediaId });
    }

    // Hide if our tree becomes hidden.
    visibilityChanged()
    {
        super.visibilityChanged();

        if(!this.visibleRecursively)
            this.visible = false;
    }

    shutdown()
    {
        super.shutdown();

        for(let bookmarkButton of this.bookmarkButtons)
        {
            if(bookmarkButton.bookmarkTagListWidget == this)
                bookmarkButton.bookmarkTagListWidget = null;
        }
    }
}

// This opens the bookmark tag dropdown when a button is pressed.
export class BookmarkTagDropdownOpener extends Actor
{
    constructor({
        // The bookmark tag button which opens the dropdown.
        bookmarkTagsButton,

        // The associated bookmark button widgets, if any.
        bookmarkButtons,
        
        onvisibilitychanged,
        ...options
    })
    {
        super({...options});

        this.bookmarkTagsButton = bookmarkTagsButton;
        this.bookmarkButtons = bookmarkButtons;
        this._mediaId = null;

        // Create an opener to actually create the dropdown.
        this._opener = new DropdownBoxOpener({
            button: bookmarkTagsButton,
            onvisibilitychanged,
            createDropdown: this._createBox,

            // If we have bookmark buttons, don't close for clicks inside them.  We need the
            // bookmark button to handle the click first, then it'll close us.
            shouldCloseForClick: (e) =>
            {
                for(let button of this.bookmarkButtons)
                {
                    if(helpers.html.isAbove(button.root, e.target))
                        return false;
                }

                return true;
            },
        });

        bookmarkTagsButton.addEventListener("click", (e) => {
            this._opener.visible = !this._opener.visible;
        });

        for(let button of this.bookmarkButtons)
        {
            button.addEventListener("bookmarkedited", () => {
                this._opener.visible = false;
            }, this._signal);
        }
    }

    setMediaId(mediaId)
    {
        if(this._mediaId == mediaId)
            return;

        this._mediaId = mediaId;
        helpers.html.setClass(this.bookmarkTagsButton, "enabled", mediaId != null);

        // Hide the dropdown if the image changes while it's open.
        this._opener.visible = false;
    }

    _createBox = ({...options}) => {
        if(this._mediaId == null)
            return;

        return new BookmarkTagListDropdownWidget({
            ...options,
            parent: this,
            mediaId: this._mediaId,
            bookmarkButtons: this.bookmarkButtons,
        });
    }

    set visible(value) { this._opener.visible = value; }
    get visible() { return this._opener.visible; }
}
