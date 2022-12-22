import Widget from 'vview/widgets/widget.js';
import DataSource, { TagDropdownWidget } from 'vview/data-sources/data-source.js';
import LocalAPI from 'vview/misc/local-api.js';
import { LocalSearchBoxWidget } from 'vview/widgets/local-widgets.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_VView extends DataSource
{
    get name() { return "vview"; }
    get pageTitle() { return this.getDisplayingText(); }
    get is_vview() { return true; }
    get supportsStartPage() { return true; }
    get ui() { return UI; }

    constructor(url)
    {
        super(url);

        this.reachedEnd = false;
        this.prevPageUuid = null;
        this.nextPageUuid = null;
        this.nextPageOffset = null;
        this.bookmarkTagCounts = null;
        this._allPagesLoaded = false;

        this.loadPage(this.initialPage, { cause: "preload" });
    }

    // If we've loaded all pages, this is true to let the context menu know it
    // should display page numbers.
    get allPagesLoaded() { return this._allPagesLoaded; }

    async loadPageInternal(page)
    {
        // If the last result was at the end, stop.
        if(this.reachedEnd)
            return;

        this.fetchBookmarkTagCounts();
        
        // We should only be called in one of three ways: a start page (any page, but only if we have
        // nothing loaded), or a page at the start or end of pages we've already loaded.  Figure out which
        // one this is.  "page" is set to result.next of the last page to load the next page, or result.prev
        // of the first loaded page to load the previous page.
        let lowestPage = this.idList.getLowestLoadedPage();
        let highestPage = this.idList.getHighestLoadedPage();
        let pageUuid = null;
        let loadingDirection;
        if(page == lowestPage - 1)
        {
            // Load the previous page.
            pageUuid = this.prevPageUuid;
            loadingDirection = "backwards";
        }
        else if(page == highestPage + 1)
        {
            // Load the next page.
            pageUuid = this.nextPageUuid;
            loadingDirection = "forwards";
        }
        else if(this.nextPageOffset == null)
        {
            loadingDirection = "initial";
        }
        else
        {
            // This isn't our start page, and it doesn't match up with our next or previous page.
            console.error(`Loaded unexpected page ${page} (${lowestPage}...${highestPage})`);
            return;
        }
    
        if(this.nextPageOffset == null)
        {
            // We haven't loaded any pages yet, so we can't resume the search in-place.  Set next_page_offset
            // to the approximate offset to skip to this page number.
            this.nextPageOffset = this.estimatedItemsPerPage * (page-1);
        }

        // Use the search options if there's no path.  Otherwise, we're navigating inside
        // the search, so just view the contents of where we navigated to.
        let args = new helpers.args(this.url);
        let { search_options } = LocalAPI.get_search_options_for_args(args);
        let folderId = LocalAPI.get_local_id_from_args(args, { get_folder: true });

        let order = args.hash.get("order");

        // If we have no search options, we're viewing a single directory.  Load the whole
        // ID list with /ids.  This only returns media IDs, but returns the entire directory,
        // and we can register the whole thing as one big page.  This lets us handle local
        // files better: if you load a random file in a big directory and then back out to
        // the search, we can show the file you were on instead of going back to the top.
        // screen_search will load media info as needed when they're actually displayed.
        //
        // If we have access restrictions (eg. we're guest and can only access certain tags),
        // this API is disabled, since all listings are bookmark searches.
        if(search_options == null && !LocalAPI.local_info.bookmark_tag_searches_only)
        {
            console.log("Loading folder contents:", folderId);
            let resultIds = await LocalAPI.local_post_request(`/api/ids/${folderId}`, {
                ...search_options,
                ids_only: true,

                order: args.hash.get("order"),
            });
            if(!resultIds.success)
            {
                ppixiv.message.show("Error reading directory: " + resultIds.reason);
                return;
            }
    
            this.reachedEnd = true;
            this._allPagesLoaded = true;            
            this.addPage(page, resultIds.ids);
            return;
        }

        // Note that this registers the results with media_info automatically.
        let result = await ppixiv.mediaCache.localSearch(folderId, {
            ...search_options,

            order: order,

            // If we have a next_page_uuid, use it to load the next page.
            page: pageUuid,
            limit: this.estimatedItemsPerPage,

            // This is used to approximately resume the search if next_page_uuid has expired.
            skip: this.nextPageOffset,
        });

        if(!result.success)
        {
            ppixiv.message.show("Error reading directory: " + result.reason);
            return result;
        }

        // If we got a local path, store it to allow copying it to the clipboard.
        this.localPath = result.local_path;

        // Update the next and previous page IDs.  If we're loading backwards, always update
        // the previous page.  If we're loading forwards, always update the next page.  If
        // either of these are null, update both.
        if(loadingDirection == "backwards" || loadingDirection == "initial")
            this.prevPageUuid = result.pages.prev;

        if(loadingDirection == "forwards" || loadingDirection == "initial")
            this.nextPageUuid = result.pages.next;

        this.nextPageOffset = result.next_offset;

        // If next is null, we've reached the end of the results.
        if(result.pages.next == null)
            this.reachedEnd = true;

        let foundMediaIds = [];
        for(let thumb of result.results)
            foundMediaIds.push(thumb.mediaId);

        this.addPage(page, foundMediaIds);
    };

    // Override canLoadPage.  If we've already loaded a page, we've cached the next
    // and previous page UUIDs and we don't want to load anything else, even if the first
    // page we loaded had no results.
    canLoadPage(page)
    {
        // next_page_offset is null if we haven't tried to load anything yet.
        if(this.nextPageOffset == null)
            return true;

        // If we've loaded pages 5-6, we can load anything between pages 4 and 7.
        let lowestPage = this.idList.getLowestLoadedPage();
        let highestPage = this.idList.getHighestLoadedPage();
        return page >= lowestPage && page <= highestPage+1;
    }

    get viewingFolder()
    {
        let args = new helpers.args(this.url);
        return LocalAPI.get_local_id_from_args(args, { get_folder: true });
    }

    setPageIcon()
    {
        helpers.set_icon({vview: true});
    }

    getDisplayingText()
    {
        let args = new helpers.args(this.url);
        return LocalAPI.get_search_options_for_args(args).title;
    }

    // Put the illust ID in the hash instead of the path.  Pixiv doesn't care about this,
    // and this avoids sending the user's filenames to their server as 404s.
    setCurrentMediaId(mediaId, args)
    {
        LocalAPI.get_args_for_id(mediaId, args);
    }

    getMediaIdFromUrl(args)
    {
        // If the URL points to a file, return it.  If no image is being viewed this will give
        // the folder we're in, which shouldn't be returned here.
        let illust_id = LocalAPI.get_local_id_from_args(args);
        if(illust_id == null || !illust_id.startsWith("file:"))
            return null;
        return illust_id;
    }

    getCurrentMediaId(args)
    {
        return this.getMediaIdFromUrl(args) ?? this.idList.getFirstId();
    }

    // We're doing a bookmark search if the bookmark filter is enabled, or if
    // we're restricted to listing tagged bookmarks.
    get bookmarkSearchActive()
    {
        return this.args.hash.has("bookmarks") || LocalAPI.local_info.bookmark_tag_searches_only;
    }

    async fetchBookmarkTagCounts()
    {
        if(this.fetchedBookmarkTagCounts)
            return;
        this.fetchedBookmarkTagCounts = true;

        // We don't need to do this if we're not showing bookmarks.
        if(!this.bookmarkSearchActive)
            return;

        let result = await LocalAPI.local_post_request(`/api/bookmark/tags`);
        if(!result.success)
        {
            console.log("Error fetching bookmark tag counts");
            return;
        }

        this.bookmarkTagCounts = result.tags;
        this.dispatchEvent(new Event("_refresh_ui"));
    }

    copy_link()
    {
        // The user clicked the "copy local link" button.
        navigator.clipboard.writeText(this.localPath);
    }
}

class UI extends Widget
{
    constructor({dataSource, ...options})
    {
        super({ ...options, dataSource, template: `
            <div>
                <vv-container class=tag-search-box-container></vv-container>

                <div class="box-button-row">
                    <span class="popup icon-button copy-local-path" data-popup="Copy local path to clipboard">
                        ${ helpers.create_icon("content_copy") }
                    </span>

                    ${ helpers.create_box_link({popup: "Close search", icon: "exit_to_app",  classes: ["clear-local-search"] }) }
                    ${ helpers.create_box_link({label: "Bookmarks",           popup: "Show bookmarks",                       data_type: "local-bookmarks-only" }) }

                    <div class=local-bookmark-tags-box>
                        ${ helpers.create_box_link({label: "Tags",    icon: "ppixiv:tag", classes: ["bookmark-tags-button"] }) }
                    </div>

                    ${ helpers.create_box_link({ label: "Type",          classes: ["file-type-button"] }) }
                    ${ helpers.create_box_link({ label: "Aspect ratio",  classes: ["aspect-ratio-button"] }) }
                    ${ helpers.create_box_link({ label: "Image size",    classes: ["image-size-button"] }) }
                    ${ helpers.create_box_link({ label: "Order",         classes: ["sort-button"] }) }
                </div>
            </div>
        `});

        this.dataSource = dataSource;

        // The search history dropdown for local searches.
        new LocalSearchBoxWidget({ container: this.querySelector(".tag-search-box-container") });

        dataSource.setupDropdown(this.querySelector(".file-type-button"), [{
            createOptions: { label: "All",           data_type: "local-type-all", dataset: { default: "1"} },
            setupOptions: { fields: {"#type": null} },
        }, {
            createOptions: { label: "Videos",        data_type: "local-type-videos" },
            setupOptions: { fields: {"#type": "videos"} },
        }, {
            createOptions: { label: "Images",        data_type: "local-type-images" },
            setupOptions: { fields: {"#type": "images"} },
        }]);

        dataSource.setupDropdown(this.querySelector(".aspect-ratio-button"), [{
            createOptions: { label: "All",           data_type: "local-aspect-ratio-all", dataset: { default: "1"} },
            setupOptions: { fields: {"#aspect-ratio": null} },
        }, {
            createOptions: { label: "Landscape",     data_type: "local-aspect-ratio-landscape" },
            setupOptions: { fields: {"#aspect-ratio": `3:2...`} },
        }, {
            createOptions: { label: "Portrait",      data_type: "local-aspect-ratio-portrait" },
            setupOptions: { fields: {"#aspect-ratio": `...2:3`} },
        }]);

        dataSource.setupDropdown(this.querySelector(".image-size-button"), [{
            createOptions: { label: "All",           dataset: { default: "1"} },
            setupOptions: { fields: {"#pixels": null} },
        }, {
            createOptions: { label: "High-res" },
            setupOptions: { fields: {"#pixels": "4000000..."} },
        }, {
            createOptions: { label: "Medium-res" },
            setupOptions: { fields: {"#pixels": "1000000...3999999"} },
        }, {
            createOptions: { label: "Low-res" },
            setupOptions: { fields: {"#pixels": "...999999"} },
        }]);

        dataSource.setupDropdown(this.querySelector(".sort-button"), [{
            createOptions: { label: "Name",           dataset: { default: "1"} },
            setupOptions: { fields: {"#order": null} },
        }, {
            createOptions: { label: "Name (inverse)" },
            setupOptions: { fields: {"#order": "-normal"} },
        }, {
            createOptions: { label: "Newest" },
            setupOptions: { fields: {"#order": "-ctime"} },

        }, {
            createOptions: { label: "Oldest" },
            setupOptions: { fields: {"#order": "ctime"} },

        }, {
            createOptions: { label: "New bookmarks" },
            setupOptions: { fields: {"#order": "bookmarked-at"},
                // If a bookmark sort is selected, also enable viewing bookmarks.
                adjustUrl: (args) => args.hash.set("bookmarks", 1),
            },
        }, {
            createOptions: { label: "Old bookmarks" },
            setupOptions: { fields: {"#order": "-bookmarked-at"},
                adjustUrl: (args) => args.hash.set("bookmarks", 1),
            },
        }, {
            createOptions: { label: "Shuffle", icon: "shuffle" },
            setupOptions: { fields: {"#order": "shuffle"}, toggle: true },
        }]);

        class bookmark_tag_dropdown extends TagDropdownWidget
        {
            refreshTags()
            {
                // Clear the tag list.
                for(let tag of this.container.querySelectorAll(".following-tag"))
                    tag.remove();

                // Stop if we don't have the tag list yet.
                if(this.dataSource.bookmarkTagCounts == null)
                    return;

                this.addTagLink(null); // All
                this.addTagLink(""); // Uncategorized

                let allTags = Object.keys(this.dataSource.bookmarkTagCounts);
                allTags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
                for(let tag of allTags)
                {
                    // Skip uncategorized, which is always placed at the beginning.
                    if(tag == "")
                        continue;

                    if(this.dataSource.bookmarkTagCounts[tag] == 0)
                        continue;

                    this.addTagLink(tag);
                }
            }

            addTagLink(tag)
            {
                let tagCount = this.dataSource.bookmarkTagCounts[tag];

                let tagName = tag;
                if(tagName == null)
                    tagName = "All bookmarks";
                else if(tagName == "")
                    tagName = "Untagged";

                // Show the bookmark count in the popup.
                let popup = null;
                if(tagCount != null)
                    popup = tagCount + (tagCount == 1? " bookmark":" bookmarks");

                let a = helpers.create_box_link({
                    label: tagName,
                    classes: ["following-tag"],
                    data_type: "following-tag",
                    popup,
                    link: "#",
                    as_element: true,
                });
                if(tagName == "All bookmarks")
                    a.dataset.default = 1;

                    this.dataSource.setItem(a, {
                    fields: {"#bookmark-tag": tag},
                });

                this.container.appendChild(a);
            }
        }

        this.tagDropdownOpener = new DropdownMenuOpener({
            button: this.querySelector(".bookmark-tags-button"),
            create_box: ({...options}) => new bookmark_tag_dropdown({ dataSource, ...options }),
        });

        // Hide the bookmark box if we're not showing bookmarks.
        this.querySelector(".local-bookmark-tags-box").hidden = !dataSource.bookmarkSearchActive;

        dataSource.addEventListener("_refresh_ui", () => {
            // Refresh the displayed label in case we didn't have it when we created the widget.
            this.tagDropdownOpener.set_button_popup_highlight();
        }, this._signal);

        let clearLocalSearchButton = this.querySelector(".clear-local-search");
        clearLocalSearchButton.addEventListener("click", (e) => {
            // Get the URL for the current folder and set it to a new URL, so it removes search
            // parameters.
            let mediaId = LocalAPI.get_local_id_from_args(dataSource.args, { get_folder: true });
            let args = new helpers.args("/", ppixiv.plocation);
            LocalAPI.get_args_for_id(mediaId, args);
            helpers.navigate(args);
        });

        let searchActive = LocalAPI.get_search_options_for_args(dataSource.args).search_options != null;
        helpers.set_class(clearLocalSearchButton, "disabled", !searchActive);

        this.querySelector(".copy-local-path").addEventListener("click", (e) => {
            this.copy_link();
        });

        // Hide the "copy local path" button if we don't have one.
        this.querySelector(".copy-local-path").hidden = dataSource.local_path == null;

        dataSource.setItem(this.container, { type: "local-bookmarks-only", fields: {"#bookmarks": "1"}, toggle: true,
            adjustUrl: (args) => {
                // If the button is exiting bookmarks, remove bookmark-tag too.
                if(!args.hash.has("bookmarks"))
                    args.hash.delete("bookmark-tag");
            }
        });

        // If we're only allowed to do bookmark searches, hide the bookmark search button.
        this.querySelector('[data-type="local-bookmarks-only"]').hidden = LocalAPI.local_info.bookmark_tag_searches_only;
    }
}
