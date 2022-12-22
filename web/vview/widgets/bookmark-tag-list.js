import Actor from 'vview/actors/actor.js';
import Actions from 'vview/misc/actions.js';
import RecentBookmarkTags from 'vview/misc/recent-bookmark-tags.js';
import { IllustWidget } from 'vview/widgets/illust-widgets.js';
import { DropdownBoxOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

// Widget for editing bookmark tags.
export class BookmarkTagListWidget extends IllustWidget
{
    get needed_data() { return "media_id"; }

    constructor({...options})
    {
        super({...options, template: `
            <div class="bookmark-tag-list">
                <div class=tag-list>
                </div>
            </div>
        `});

        this.displaying_media_id = null;
        this.container.addEventListener("click", this.clicked_bookmark_tag, true);
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
    get selected_tags()
    {
        var tag_list = [];
        var bookmark_tags = this.container;
        for(var entry of bookmark_tags.querySelectorAll(".popup-bookmark-tag-entry"))
        {
            if(!entry.classList.contains("selected"))
                continue;
            tag_list.push(entry.dataset.tag);
        }
        return tag_list;
    }

    // Override setting media_id to save tags when we're closed.  Otherwise, media_id will already
    // be cleared when we close and we won't be able to save.
    set_media_id(media_id)
    {
        // If we're hiding and were previously visible, save changes.
        if(media_id == null)
            this.save_current_tags();

        super.set_media_id(media_id);
    }
    
    async visibility_changed()
    {
        super.visibility_changed();

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
            this.save_current_tags();

            // Clear the tag list when the menu closes, so it's clean on the next refresh.
            this.clear_tag_list();

            this.displaying_media_id = null;
        }
    }

    clear_tag_list()
    {
        // Make a copy of children when iterating, since it doesn't handle items being deleted
        // while iterating cleanly.
        let bookmark_tags = this.container.querySelector(".tag-list");
        for(let element of [...bookmark_tags.children])
        {
            if(element.classList.contains("dynamic") || element.classList.contains("loading"))
                element.remove();
        }
    }

    async refresh_internal({ media_id })
    {
        if(this.deactivated)
            return;

        // If we're refreshing the same illust that's already refreshed, store which tags were selected
        // before we clear the list.
        let old_selected_tags = this.displaying_media_id == media_id? this.selected_tags:[];

        this.displaying_media_id = null;

        let bookmark_tags = this.container.querySelector(".tag-list");
        this.clear_tag_list();

        if(media_id == null || !this.visible)
            return;

        // Create a temporary entry to show loading while we load bookmark details.
        let entry = document.createElement("span");
        entry.classList.add("loading");
        bookmark_tags.appendChild(entry);
        entry.innerText = "Loading...";

        // If the tag list is open, populate bookmark details to get bookmark tags.
        // If the image isn't bookmarked this won't do anything.
        let active_tags = await ppixiv.extraCache.load_bookmark_details(media_id);

        // Remember which illustration's bookmark tags are actually loaded.
        this.displaying_media_id = media_id;

        // Remove elements again, in case another refresh happened while we were async
        // and to remove the loading entry.
        this.clear_tag_list();
        
        // If we're refreshing the list while it's open, make sure that any tags the user
        // selected are still in the list, even if they were removed by the refresh.  Put
        // them in active_tags, so they'll be marked as active.
        for(let tag of old_selected_tags)
        {
            if(active_tags.indexOf(tag) == -1)
                active_tags.push(tag);
        }

        let shown_tags = [];

        let recent_bookmark_tags = [...RecentBookmarkTags.getRecentBookmarkTags()]; // copy
        for(let tag of recent_bookmark_tags)
            if(shown_tags.indexOf(tag) == -1)
                shown_tags.push(tag);

        // Add any tags that are on the bookmark but not in recent tags.
        for(let tag of active_tags)
            if(shown_tags.indexOf(tag) == -1)
                shown_tags.push(tag);

        shown_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));

        let create_entry = (tag, { classes=[], icon }={}) =>
        {
            let entry = this.create_template({name: "tag-entry", html: `
                <div class="popup-bookmark-tag-entry dynamic">
                    <span class=tag-name></span>
                </div>
            `});

            for(let cls of classes)
                entry.classList.add(cls);
            entry.querySelector(".tag-name").innerText = tag;

            if(icon)
                entry.querySelector(".tag-name").insertAdjacentElement("afterbegin", icon);
            bookmark_tags.appendChild(entry);

            return entry;
        }

        let add_button = create_entry("Add", {
            icon: helpers.create_icon("add", { as_element: true }),
            classes: ["add-button"],
        });
        add_button.addEventListener("click", () => Actions.addNewBookmarkTag(this._media_id));

        for(let tag of shown_tags)
        {
            let entry = create_entry(tag, {
                classes: ["tag-toggle"],
//                icon: helpers.create_icon("ppixiv:tag", { as_element: true }),
            });

            entry.dataset.tag = tag;

            let active = active_tags.indexOf(tag) != -1;
            helpers.set_class(entry, "selected", active);
        }

        let sync_button = create_entry("Refresh", {
            icon: helpers.create_icon("refresh", { as_element: true }),
            classes: ["refresh-button"],
        });

        sync_button.addEventListener("click", async (e) => {
            let bookmark_tags = await Actions.loadRecentBookmarkTags();
            RecentBookmarkTags.setRecentBookmarkTags(bookmark_tags);
        });
    }

    // Save the selected bookmark tags to the current illust.
    async save_current_tags()
    {
        if(this.deactivated)
            return;

        // Store the ID and tag list we're saving, since they can change when we await.
        let media_id = this._media_id;
        let new_tags = this.selected_tags;
        if(media_id == null)
            return;

        // Only save tags if we're refreshed to the current illust ID, to make sure we don't save
        // incorrectly if we're currently waiting for the async refresh.
        if(media_id != this.displaying_media_id)
            return;

        // Get the tags currently on the bookmark to compare.
        let old_tags = await ppixiv.extraCache.load_bookmark_details(media_id);

        var equal = new_tags.length == old_tags.length;
        for(let tag of new_tags)
        {
            if(old_tags.indexOf(tag) == -1)
                equal = false;
        }
        // If the selected tags haven't changed, we're done.
        if(equal)
            return;
        
        // Save the tags.  If the image wasn't bookmarked, this will create a public bookmark.
        console.log(`Tag list closing and tags have changed: ${old_tags.join(",")} -> ${new_tags.join(",")}`);
        await Actions.bookmarkAdd(this._media_id, {
            tags: new_tags,
        });
    }

    // Toggle tags on click.  We don't save changes until we're closed.
    clicked_bookmark_tag = async(e) =>
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
        let tag = a.dataset.tag;
        helpers.set_class(a, "selected", !a.classList.contains("selected"));
    }
}

// A bookmark tag list in a dropdown.
//
// The base class is a simple widget.  This subclass handles some of the trickier
// bits around closing the dropdown correctly, and tells any bookmark buttons about
// itself.
export class BookmarkTagListDropdownWidget extends BookmarkTagListWidget
{
    constructor({
        media_id,
        bookmark_buttons,
        ...options
    })
    {
        super({
            classes: ["popup-bookmark-tag-dropdown"],
            ...options
        });

        this.container.classList.add("popup-bookmark-tag-dropdown");

        this.bookmark_buttons = bookmark_buttons;

        this.set_media_id(media_id);

        // Let the bookmark buttons know about this bookmark tag dropdown, and remove it when
        // it's closed.
        for(let bookmarkButton of this.bookmark_buttons)
            bookmarkButton.bookmarkTagListWidget = this;
    }

    async refresh_internal({ media_id })
    {
        // Make sure the dropdown is hidden if we have no image.
        if(media_id == null)
            this.visible = false;

        await super.refresh_internal({ media_id });
    }

    // Hide if our tree becomes hidden.
    on_visible_recursively_changed()
    {
        super.on_visible_recursively_changed();

        if(!this.visible_recursively)
            this.visible = false;
    }

    shutdown()
    {
        super.shutdown();

        for(let bookmarkButton of this.bookmark_buttons)
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
        bookmark_tags_button,

        // The associated bookmark button widgets, if any.
        bookmark_buttons,
        
        onvisibilitychanged,
        ...options
    })
    {
        super({...options});

        this.bookmark_tags_button = bookmark_tags_button;
        this.bookmark_buttons = bookmark_buttons;
        this._media_id = null;

        // Create an opener to actually create the dropdown.
        this._opener = new DropdownBoxOpener({
            button: bookmark_tags_button,
            onvisibilitychanged,
            create_box: this._create_box,

            // If we have bookmark buttons, don't close for clicks inside them.  We need the
            // bookmark button to handle the click first, then it'll close us.
            close_for_click: (e) =>
            {
                for(let button of this.bookmark_buttons)
                {
                    if(helpers.is_above(button.container, e.target))
                        return false;
                }

                return true;
            },
        });

        bookmark_tags_button.addEventListener("click", (e) => {
            this._opener.visible = !this._opener.visible;
        });

        for(let button of this.bookmark_buttons)
        {
            button.addEventListener("bookmarkedited", () => {
                this._opener.visible = false;
            }, this._signal);
        }
    }

    set_media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;
        helpers.set_class(this.bookmark_tags_button, "enabled", media_id != null);

        // Hide the dropdown if the image changes while it's open.
        this._opener.visible = false;
    }

    _create_box = ({...options}) => {
        if(this._media_id == null)
            return;

        return new BookmarkTagListDropdownWidget({
            ...options,
            parent: this,
            media_id: this._media_id,
            bookmark_buttons: this.bookmark_buttons,
        });
    }

    set visible(value) { this._opener.visible = value; }
    get visible() { return this._opener.visible; }
}
