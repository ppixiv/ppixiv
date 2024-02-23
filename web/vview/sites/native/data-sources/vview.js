import Widget from '/vview/widgets/widget.js';
import DataSource, { PaginateMediaIds, TagDropdownWidget } from '/vview/sites/data-source.js';
import LocalAPI from '/vview/misc/local-api.js';
import { LocalSearchBoxWidget } from '/vview/widgets/local-widgets.js';
import { DropdownMenuOpener } from '/vview/widgets/dropdown.js';
import { helpers } from '/vview/misc/helpers.js';

class VViewBase extends DataSource
{
    get pageTitle() { return this.getDisplayingText(); }
    get isVView() { return true; }
    get supportsStartPage() { return true; }
    get ui() { return UI; }
    get autoLoadPreviousPages() { return true; }

    constructor(args)
    {
        super(args);

        this.reachedEnd = false;
        this.prevPageUuid = null;
        this.nextPageUuid = null;
        this.nextPageOffset = null;
        this.bookmarkTagCounts = null;
    }

    async init()
    {
        super.init();

        this.fetchBookmarkTagCounts();
    }

    // We set our own start page by looking for the starting ID, so don't pollute the URL
    // with a page number that won't be sued.
    setStartPage(args, page) { }

    get uiInfo()
    {
        let args = new helpers.args(this.url);
        let mediaId = LocalAPI.getLocalIdFromArgs(args, { getFolder: true });

        return { mediaId };
    }

    setPageIcon()
    {
        helpers.setIcon({vview: true});
    }

    getDisplayingText()
    {
        let args = new helpers.args(this.url);
        return LocalAPI.getSearchOptionsForArgs(args).title;
    }

    // Put the illust ID in the hash instead of the path.  Pixiv doesn't care about this,
    // and this avoids sending the user's filenames to their server as 404s.
    setUrlMediaId(mediaId, args)
    {
        LocalAPI.getArgsForId(mediaId, args);
    }

    getUrlMediaId(args)
    {
        // If the URL points to a file, return it.  If no image is being viewed this will give
        // the folder we're in, which shouldn't be returned here.
        let mediaId = LocalAPI.getLocalIdFromArgs(args);
        if(mediaId == null || !mediaId.startsWith("file:"))
            return null;
        return mediaId;
    }

    // We're doing a bookmark search if the bookmark filter is enabled, or if
    // we're restricted to listing tagged bookmarks.
    get bookmarkSearchActive()
    {
        return this.args.hash.has("bookmarks") || LocalAPI.localInfo.bookmark_tag_searches_only;
    }

    async fetchBookmarkTagCounts()
    {
        if(this.fetchedBookmarkTagCounts)
            return;
        this.fetchedBookmarkTagCounts = true;

        // We don't need to do this if we're not showing bookmarks.
        if(!this.bookmarkSearchActive)
            return;

        let result = await LocalAPI.localPostRequest(`/api/bookmark/tags`);
        if(!result.success)
        {
            console.log("Error fetching bookmark tag counts");
            return;
        }

        this.bookmarkTagCounts = result.tags;
        this.callUpdateListeners();
    }
}

// This data source is used when we have no search and we're viewing a single directory.
// We'll load the whole directory with /ids, and then load media info as we go.
export class VView extends VViewBase
{
    get name() { return "vview"; }

    constructor(url)
    {
        super(url);
        this._allIds = null;
    }

    async init({targetMediaId})
    {
        await super.init();

        if(this._initialized)
            return;
        this._initialized = true;

        let args = new helpers.args(this.url);
        let { searchOptions } = LocalAPI.getSearchOptionsForArgs(args);

        let folderId = LocalAPI.getLocalIdFromArgs(args, { getFolder: true });
        console.log("Loading folder contents:", folderId);

        let order = args.hash.get("order");
        let resultIds = await LocalAPI.localPostRequest(`/api/ids/${folderId}`, {
            ...searchOptions,
            ids_only: true,
            order,
        });

        if(!resultIds.success)
        {
            ppixiv.message.show("Error reading directory: " + resultIds.reason);
            return;
        }

        this.pages = PaginateMediaIds(resultIds.ids, this.estimatedItemsPerPage);
        this._allIds = resultIds.ids;

        // If a file was present in the URL when we're created, try to start on the page
        // containing it, overriding the starting page.
        this._selectInitialPage(targetMediaId);
    }

    // Return the index into this.pages containing mediaId, or -1 if not found.
    //
    // Note that the result is an index into this.pages, which is 0-based.
    getMediaIdPage(mediaId)
    {
        if(this.pages == null)
            return -1;

        for(let page = 0; page < this.pages.length; ++page)
        {
            let mediaIdsOnPage = this.pages[page];
            if(mediaIdsOnPage.indexOf(mediaId) != -1)
                return page;
        }

        return -1;
    }

    // Most data sources load a page of results at a time and remember the current page
    // in the URL.  VView works differently: if we're viewing a directory we get the entire
    // directory's IDs at once.  We don't store the page in the URL, since we might be
    // loaded directly from a file association that wouldn't know which page it'll be.
    //
    // The default getStartPage expects a page number.  Override it so if we're viewing
    // an image, we'll return the page it's on.  That way if we're viewing an image and
    // navigate to the next image, it'll know which page we're on and won't create a new
    // data source thinking we're trying to navigate to page 1.
    getStartPage(args)
    {
        if(this.pages == null)
            return 1;

        let mediaId = LocalAPI.getLocalIdFromArgs(args);
        if(mediaId == null)
            return 1;

        let page = this.getMediaIdPage(mediaId);
        if(page != -1)
            return page + 1; // 0-based to 1-based

        return 1;
    }

    _selectInitialPage(targetMediaId)
    {
        if(targetMediaId == null)
            return;

        let page = this.getMediaIdPage(targetMediaId);
        if(page == -1)
            return;

        // If the new initial page couldn't normally be loaded, reset our loaded pages and
        // start over.
        let newInitialPage = page + 1;
        let needsReset = !this.canLoadPage(newInitialPage);
        this.initialPage = newInitialPage;
        console.log(`Start on page ${this.initialPage}, reset: ${needsReset}`);
        if(needsReset)
            this._resetLoadedPages();
    }

    // If we've loaded all pages, we can display the file index as a page number.
    getPageTextForMediaId(mediaId)
    {
        if(this._allIds == null)
            return null;

        let idx = this._allIds.indexOf(mediaId);
        if(idx == -1)
            return null;

        return `Page ${idx+1}/${this._allIds.length}`;
    }

    async loadPageInternal(page)
    {
        let mediaIds = this.pages[page-1] || [];

        // Load info for these images before returning them.
        await ppixiv.mediaCache.batchGetMediaInfoPartial(mediaIds);
        return { mediaIds };
    }
}

export class VViewSearch extends VViewBase
{
    get name() { return "vview-search"; }

    async loadPageInternal(page)
    {
        // If the last result was at the end, stop.
        if(this.reachedEnd)
            return;

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

        let args = new helpers.args(this.url);
        let { searchOptions } = LocalAPI.getSearchOptionsForArgs(args);
        let folderId = LocalAPI.getLocalIdFromArgs(args, { getFolder: true });
        let order = args.hash.get("order");

        // Note that this registers the results with MediaCache automatically.
        let result = await ppixiv.mediaCache.localSearch(folderId, {
            ...searchOptions,

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

        let mediaIds = [];
        for(let thumb of result.results)
            mediaIds.push(thumb.mediaId);

        return { mediaIds };
    };

    // Override canLoadPage.  If we've already loaded a page, we've cached the next
    // and previous page UUIDs and we don't want to load anything else, even if the first
    // page we loaded had no results.
    canLoadPage(page)
    {
        if(page < 1)
            return false;

        // next_page_offset is null if we haven't tried to load anything yet.
        if(this.nextPageOffset == null)
            return true;

        // If we've loaded pages 5-6, we can load anything between pages 4 and 7.
        let lowestPage = this.idList.getLowestLoadedPage();
        let highestPage = this.idList.getHighestLoadedPage();
        return page >= lowestPage-1 && page <= highestPage+1;
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
                    ${ helpers.createBoxLink({label: "Bookmarks",           popup: "Show bookmarks",                       dataType: "local-bookmarks-only" }) }

                    <div class=local-bookmark-tags-box>
                        ${ helpers.createBoxLink({label: "Tags",    icon: "ppixiv:tag", classes: ["bookmark-tags-button"] }) }
                    </div>

                    ${ helpers.createBoxLink({ label: "Type",          classes: ["file-type-button"] }) }
                    ${ helpers.createBoxLink({ label: "Aspect ratio",  classes: ["aspect-ratio-button"] }) }
                    ${ helpers.createBoxLink({ label: "Image size",    classes: ["image-size-button"] }) }
                    ${ helpers.createBoxLink({ label: "Order",         classes: ["sort-button"] }) }

                    ${ helpers.createBoxLink({ label: "Reset", popup: "Clear all search options", classes: ["clear-local-search"] }) }
                </div>
            </div>
        `});

        this.dataSource = dataSource;

        // The search history dropdown for local searches.
        new LocalSearchBoxWidget({ container: this.querySelector(".tag-search-box-container") });

        dataSource.setupDropdown(this.querySelector(".file-type-button"), [{
            createOptions: { label: "All",           dataType: "local-type-all", dataset: { default: "1"} },
            setupOptions: { fields: {"#type": null} },
        }, {
            createOptions: { label: "Images",        dataType: "local-type-images" },
            setupOptions: { fields: {"#type": "images"} },
        }, {
            createOptions: { label: "Videos",        dataType: "local-type-videos" },
            setupOptions: { fields: {"#type": "videos"} },
        }]);

        dataSource.setupDropdown(this.querySelector(".aspect-ratio-button"), [{
            createOptions: { label: "All",           dataType: "local-aspect-ratio-all", dataset: { default: "1"} },
            setupOptions: { fields: {"#aspect-ratio": null} },
        }, {
            createOptions: { label: "Landscape",     dataType: "local-aspect-ratio-landscape" },
            setupOptions: { fields: {"#aspect-ratio": `3:2...`} },
        }, {
            createOptions: { label: "Portrait",      dataType: "local-aspect-ratio-portrait" },
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

        class BookmarkTagDropdown extends TagDropdownWidget
        {
            refreshTags()
            {
                // Clear the tag list.
                for(let tag of this.root.querySelectorAll(".following-tag"))
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

                let a = helpers.createBoxLink({
                    label: tagName,
                    classes: ["following-tag"],
                    dataType: "following-tag",
                    popup,
                    link: "#",
                    asElement: true,
                });
                if(tagName == "All bookmarks")
                    a.dataset.default = 1;

                    this.dataSource.setItem(a, {
                    fields: {"#bookmark-tag": tag},
                });

                this.root.appendChild(a);
            }
        }

        this.tagDropdownOpener = new DropdownMenuOpener({
            button: this.querySelector(".bookmark-tags-button"),
            createDropdown: ({...options}) => new BookmarkTagDropdown({ dataSource, ...options }),
        });

        // Hide the bookmark box if we're not showing bookmarks.
        this.querySelector(".local-bookmark-tags-box").hidden = !dataSource.bookmarkSearchActive;

        dataSource.addEventListener("updated", () => {
            // Refresh the displayed label in case we didn't have it when we created the widget.
            this.tagDropdownOpener.setButtonPopupHighlight();
        }, this._signal);

        let clearLocalSearchButton = this.querySelector(".clear-local-search");
        clearLocalSearchButton.addEventListener("click", (e) => {
            // Get the URL for the current folder and set it to a new URL, so it removes search
            // parameters.
            let mediaId = LocalAPI.getLocalIdFromArgs(dataSource.args, { getFolder: true });
            let args = new helpers.args("/", ppixiv.plocation);
            LocalAPI.getArgsForId(mediaId, args);
            helpers.navigate(args);
        });

        let searchActive = LocalAPI.getSearchOptionsForArgs(dataSource.args).searchOptions != null;
        if(dataSource.args.hash.has("order"))
            searchActive = true;
        helpers.html.setClass(clearLocalSearchButton, "disabled", !searchActive);

        dataSource.setItem(this.root, { type: "local-bookmarks-only", fields: {"#bookmarks": "1"}, toggle: true,
            adjustUrl: (args) => {
                // If the button is exiting bookmarks, remove bookmark-tag too.
                if(!args.hash.has("bookmarks"))
                    args.hash.delete("bookmark-tag");
            }
        });

        // If we're only allowed to do bookmark searches, hide the bookmark search button.
        this.querySelector('[data-type="local-bookmarks-only"]').hidden = LocalAPI.localInfo.bookmark_tag_searches_only;
    }
}
