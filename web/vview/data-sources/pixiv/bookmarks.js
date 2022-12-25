// bookmark.php
// /users/12345/bookmarks
//
// If id is in the query, we're viewing another user's bookmarks.  Otherwise, we're
// viewing our own.
//
// Pixiv currently serves two unrelated pages for this URL, using an API-driven one
// for viewing someone else's bookmarks and a static page for viewing your own.  We
// always use the API in either case.
//
// For some reason, Pixiv only allows viewing either public or private bookmarks,
// and has no way to just view all bookmarks.
import DataSource, { TagDropdownWidget } from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

export class DataSource_BookmarksBase extends DataSource
{
    get name() { return "bookmarks"; }
    get ui() { return UI; }
  
    constructor(url)
    {
        super(url);

        this.bookmarkTagCounts = [];

        // The subclass sets this once it knows the number of bookmarks in this search.
        this.totalBookmarks = -1;
    }

    async loadPageInternal(page)
    {
        this.fetchBookmarkTagCounts();
        
        // Load the user's info.  We don't need to wait for this to finish.
        let userInfoPromise = ppixiv.userCache.getUserInfoFull(this.viewingUserId);
        userInfoPromise.then((userInfo) => {
            // Stop if we were deactivated before this finished.
            if(!this.active)
                return;

            this.userInfo = userInfo;
            this.callUpdateListeners();
        });

        await this.continueLoadingPageInternal(page);
    };

    get supportsStartPage()
    {
        // Disable start pages when we're shuffling pages anyway.
        return !this.shuffle;
    }

    get displayingTag()
    {
        let url = helpers.getUrlWithoutLanguage(this.url);
        let parts = url.pathname.split("/");
        if(parts.length < 6)
            return null;

        // Replace 未分類 with "" for uncategorized.
        let tag = decodeURIComponent(parts[5]);
        if(tag == "未分類")
            return "";
        return tag;
    }

    // If we haven't done so yet, load bookmark tags for this bookmark page.  This
    // happens in parallel with with page loading.
    async fetchBookmarkTagCounts()
    {
        if(this.fetchedBookmarkTagCounts)
            return;
        this.fetchedBookmarkTagCounts = true;

        // If we have cached bookmark counts for ourself, load them.
        if(this.viewingOwnBookmarks() && DataSource_BookmarksBase.cachedBookmarkTagCounts != null)
            this.loadBookmarkTagCounts(DataSource_BookmarksBase.cachedBookmarkTagCounts);
        
        // Fetch bookmark tags.  We can do this in parallel with everything else.
        let url = "/ajax/user/" + this.viewingUserId + "/illusts/bookmark/tags";
        let result = await helpers.getRequest(url, {});

        // Cache this if we're viewing our own bookmarks, so we can display them while
        // navigating bookmarks.  We'll still refresh it as each page loads.
        if(this.viewingOwnBookmarks())
            DataSource_BookmarksBase.cachedBookmarkTagCounts = result.body;

        this.loadBookmarkTagCounts(result.body);
    }

    loadBookmarkTagCounts(result)
    {
        let publicBookmarks = this.viewingPublic;
        let privateBookmarks = this.viewingPrivate;

        // Reformat the tag list into a format that's easier to work with.
        let tags = { };
        for(let privacy of ["public", "private"])
        {
            let publicTags = privacy == "public";
            if((publicTags && !publicBookmarks) ||
              (!publicTags && !privateBookmarks))
                continue;

            let tagCounts = result[privacy];
            for(let tagInfo of tagCounts)
            {
                let tag = tagInfo.tag;

                // Rename "未分類" (uncategorized) to "".
                if(tag == "未分類")
                    tag = "";
                
                if(tags[tag] == null)
                    tags[tag] = 0;

                // Add to the tag count.
                tags[tag] += tagInfo.cnt;
            }
        }

        // Fill in totalBookmarks from the tag count.  We'll get this from the search API,
        // but we can have it here earlier if we're viewing our own bookmarks and
        // cachedBookmarkTagCounts is filled in.  We can't do this when viewing all bookmarks
        // (summing the counts will give the wrong answer whenever multiple tags are used on
        // one bookmark).
        let displayingTag = this.displayingTag;
        if(displayingTag != null && this.totalBookmarks == -1)
        {
            let count = tags[displayingTag];
            if(count != null)
                this.totalBookmarks = count;
        }

        // Sort tags by count, so we can trim just the most used tags.  Use the count for the
        // display mode we're in.
        let allTags = Object.keys(tags);
        allTags.sort((lhs, rhs) => tags[lhs].count - tags[rhs].count);

        if(!this.viewingOwnBookmarks())
        {
            // Trim the list when viewing other users.  Some users will return thousands of tags.
            allTags.splice(20);
        }

        allTags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.bookmarkTagCounts = {};
        for(let tag of allTags)
            this.bookmarkTagCounts[tag] = tags[tag];

        // Update the UI with the tag list.
        this.callUpdateListeners();
    }
    
    // Get API arguments to query bookmarks.
    //
    // If forceRest isn't null, it's either "show" (public) or "hide" (private), which
    // overrides the search parameters.
    getBookmarkQueryParams(page, forceRest)
    {
        let queryArgs = this.url.searchParams;
        let rest = queryArgs.get("rest") || "show";
        if(forceRest != null)
            rest = forceRest;

        let tag = this.displayingTag;
        if(tag == "")
            tag = "未分類"; // Uncategorized
        else if(tag == null)
            tag = "";

        // Load 20 results per page, so our page numbers should match the underlying page if
        // the UI is disabled.
        return {
            tag: tag,
            offset: (page-1)*this.estimatedItemsPerPage,
            limit: this.estimatedItemsPerPage,
            rest: rest, // public or private (no way to get both)
        };
    }

    async requestBookmarks(page, rest)
    {
        let data = this.getBookmarkQueryParams(page, rest);
        let url = `/ajax/user/${this.viewingUserId}/illusts/bookmarks`;
        let result = await helpers.getRequest(url, data);

        if(this.viewingOwnBookmarks())
        {
            // This request includes each bookmark's tags.  Register those with MediaCache,
            // so the bookmark tag dropdown can display tags more quickly.
            for(let illust of result.body.works)
            {
                let bookmark_id = illust.bookmarkData.id;
                let tags = result.body.bookmarkTags[bookmark_id] || [];

                // illust.id is an int if this image is deleted.  Convert it to a string so it's
                // like other images.
                let mediaId = helpers.mediaId.fromIllustId(illust.id.toString());
                ppixiv.extraCache.updateCachedBookmarkTags(mediaId, tags);
            }
        }

        // Store whether there are any results.  Do this before filtering deleted images,
        // so we know the results weren't empty even if all results on this page are deleted.
        result.body.empty = result.body.works.length == 0;
        result.body.works = DataSource_BookmarksBase.filterDeletedImages(result.body.works);

        return result.body;
    }

    // This is implemented by the subclass to do the main loading.
    async continueLoadingPageInternal(page)
    {
        throw "Not implemented";
    }

    get pageTitle()
    {
        if(!this.viewingOwnBookmarks())
        {
            if(this.userInfo)
                return this.userInfo.name + "'s Bookmarks";
            else
                return "Loading...";
        }

        return "Bookmarks";
    }

    getDisplayingText()
    {
        if(!this.viewingOwnBookmarks())
        {
            if(this.userInfo)
                return this.userInfo.name + "'s Bookmarks";
            return "User's Bookmarks";
        }

        let publicBookmarks = this.viewingPublic;
        let privateBookmarks = this.viewingPrivate;
        let viewingAll = publicBookmarks && privateBookmarks;
        let displaying = "";

        if(this.totalBookmarks != -1)
            displaying += this.totalBookmarks + " ";

        displaying += viewingAll? "Bookmark":
            privateBookmarks? "Private Bookmark":"Public Bookmark";

        // English-centric pluralization:
        if(this.totalBookmarks != 1)
            displaying += "s";

        let tag = this.displayingTag;
        if(tag == "")
            displaying += ` / untagged`;
        else if(tag != null)
            displaying += ` / ${tag}`;

        return displaying;
    };

    // Return true if we're viewing publig and private bookmarks.  These are overridden
    // in BookmarksMerged.
    get viewingPublic()
    {
        let args = new helpers.args(this.url);
        return args.query.get("rest") != "hide";
    }

    get viewingPrivate()
    {
        let args = new helpers.args(this.url);
        return args.query.get("rest") == "hide";
    }

    get uiInfo()
    {
        return {
            userId: this.viewingOwnBookmarks()? null:this.viewingUserId,
        }
    }

    get viewingUserId()
    {
        // /users/13245/bookmarks
        //
        // This is currently only used for viewing other people's bookmarks.  Your own bookmarks are still
        // viewed with /bookmark.php with no ID.
        return helpers.strings.getPathPart(this.url, 1);
    };

    // Return true if we're viewing our own bookmarks.
    viewingOwnBookmarks()
    {
        return this.viewingUserId == ppixiv.pixivInfo.userId;
    }

    // Don't show bookmark icons for the user's own bookmarks.  Every image on that page
    // is bookmarked, so it's just a lot of noise.
    get showBookmarkIcons()
    {
        return !this.viewingOwnBookmarks();
    }

    // Bookmark results include deleted images.  These are weird and a bit broken:
    // the post ID is an integer instead of a string (which makes more sense but is
    // inconsistent with other results) and the data is mostly empty or garbage.
    // Check isBookmarkable to filter these out.
    static filterDeletedImages(images)
    {
        let result = [];
        for(let image of images)
        {
            if(!image.isBookmarkable)
            {
                console.log("Discarded deleted bookmark " + image.id);
                continue;
            }
            result.push(image);
        }
        return result;
    }
}

// Normal bookmark querying.  This can only retrieve public or private bookmarks,
// and not both.
export class Bookmarks extends DataSource_BookmarksBase
{
    get shuffle()
    {
        let args = new helpers.args(this.url);
        return args.hash.has("shuffle");
    }

    async continueLoadingPageInternal(page)
    {
        let pageToLoad = page;
        if(this.shuffle)
        {
            // We need to know the number of pages in order to shuffle, so load the first page.
            // This is why we don't support this for merged bookmark loading: we'd need to load
            // both first pages, then both first shuffled pages, so we'd be making four bookmark
            // requests all at once.
            if(this.totalShuffledBookmarks == null)
            {
                let result = await this.requestBookmarks(1, null);

                this.totalShuffledBookmarks = result.total;
                this.totalPages = Math.ceil(this.totalShuffledBookmarks / this.estimatedItemsPerPage);

                // Create a shuffled page list.
                this.shuffledPages = [];
                for(let p = 1; p <= this.totalPages; ++p)
                    this.shuffledPages.push(p);

                helpers.shuffleArray(this.shuffledPages);
            }

            if(page < this.shuffledPages.length)
                pageToLoad = this.shuffledPages[page];
        }

        let result = await this.requestBookmarks(pageToLoad, null);

        let mediaIds = [];
        for(let illustData of result.works)
            mediaIds.push(helpers.mediaId.fromIllustId(illustData.id)); 

        // If we're shuffling, shuffle the individual illustrations too.
        if(this.shuffle)
            helpers.shuffleArray(mediaIds);
        
        await ppixiv.mediaCache.addMediaInfosPartial(result.works, "normal");

        // Register the new page of data.  If we're shuffling, use the original page number, not the
        // shuffled page.
        //
        // If mediaIds is empty but result.empty is false, we had results in the list but we
        // filtered them all out.  Set allowEmpty to true in this case so we add the empty page,
        // or else it'll look like we're at the end of the results when we know we aren't.
        this.addPage(page, mediaIds, {
            allowEmpty: !result.empty,
        });

        // Remember the total count, for display.
        this.totalBookmarks = result.total;
    }
};

// Merged bookmark querying.  This makes queries for both public and private bookmarks,
// and merges them together.
export class BookmarksMerged extends DataSource_BookmarksBase
{
    get viewingPublic() { return true; }
    get viewingPrivate() { return true; }

    constructor(url)
    {
        super(url);

        this.maxPagePerType = [-1, -1]; // public, private
        this.bookmarkMediaIds = [[], []]; // public, private
        this.bookmarkTotals = [0, 0]; // public, private
    }

    async continueLoadingPageInternal(page)
    {
        // Request both the public and private bookmarks on the given page.  If we've
        // already reached the end of either of them, don't send that request.
        let request1 = this.requestBookmarkType(page, "show");
        let request2 = this.requestBookmarkType(page, "hide");

        // Wait for both requests to finish.
        await Promise.all([request1, request2]);

        // Both requests finished.  Combine the two lists of illust IDs into a single page
        // and register it.
        let mediaIds = [];
        for(let i = 0; i < 2; ++i)
            if(this.bookmarkMediaIds[i] != null && this.bookmarkMediaIds[i][page] != null)
                mediaIds = mediaIds.concat(this.bookmarkMediaIds[i][page]);
        
        this.addPage(page, mediaIds);

        // Combine the two totals.
        this.totalBookmarks = this.bookmarkTotals[0] + this.bookmarkTotals[1];
    }

    async requestBookmarkType(page, rest)
    {
        let isPrivate = rest == "hide"? 1:0;
        let maxPage = this.maxPagePerType[isPrivate];
        if(maxPage != -1 && page > maxPage)
        {
            // We're past the end.
            console.log("page", page, "beyond", maxPage, rest);
            return;
        }

        let result = await this.requestBookmarks(page, rest);

        // Put higher (newer) bookmarks first.
        result.works.sort(function(lhs, rhs)
        {
            return parseInt(rhs.bookmarkData.id) - parseInt(lhs.bookmarkData.id);
        });

        let mediaIds = [];
        for(let illustData of result.works)
            mediaIds.push(helpers.mediaId.fromIllustId(illustData.id));

        await ppixiv.mediaCache.addMediaInfosPartial(result.works, "normal");

        // If there are no results, remember that this is the last page, so we don't
        // make more requests for this type.  Use the "empty" flag for this and not
        // whether there are any media IDs, in case there were IDs but they're all
        // deleted.
        if(result.empty)
        {
            if(this.maxPagePerType[isPrivate] == -1)
                this.maxPagePerType[isPrivate] = page;
            else
                this.maxPagePerType[isPrivate] = Math.min(page, this.maxPagePerType[isPrivate]);
            // console.log("max page for", isPrivate? "private":"public", this.maxPagePerType[isPrivate]);
        }

        // Store the IDs.  We don't register them here.
        this.bookmarkMediaIds[isPrivate][page] = mediaIds;

        // Remember the total count, for display.
        this.bookmarkTotals[isPrivate] = result.total;
    }
}

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div class=box-button-row>
                <div class=box-button-row>
                    <!-- These are hidden if you're viewing somebody else's bookmarks. -->
                    <span class=bookmarks-public-private style="margin-right: 25px;">
                        ${ helpers.createBoxLink({label: "All",        popup: "Show all bookmarks",       dataType: "all" }) }
                        ${ helpers.createBoxLink({label: "Public",     popup: "Show public bookmarks",    dataType: "public" }) }
                        ${ helpers.createBoxLink({label: "Private",    popup: "Show private bookmarks",   dataType: "private" }) }
                    </span>

                    ${ helpers.createBoxLink({ popup: "Shuffle", icon: "shuffle",   dataType: "order-shuffle" }) }
                </div>

                ${ helpers.createBoxLink({label: "All bookmarks",    popup: "Bookmark tags",  icon: "ppixiv:tag", classes: ["bookmark-tag-button"] }) }
            </div>
        `});

        this.dataSource = dataSource;

        // Refresh the displayed label in case we didn't have it when we created the widget.
        this.dataSource.addEventListener("updated", () => this.tagDropdown.setButtonPopupHighlight(), this._signal);

        // The public/private button only makes sense when viewing your own bookmarks.
        let publicPrivateButtonContainer = this.querySelector(".bookmarks-public-private");
        publicPrivateButtonContainer.hidden = !this.dataSource.viewingOwnBookmarks();

        // Set up the public and private buttons.  The "all" button also removes shuffle, since it's not
        // supported there.
        this.dataSource.setItem(publicPrivateButtonContainer, { type: "all", fields: {"#show-all": 1, "#shuffle": null}, defaults: {"#show-all": 1} });
        this.dataSource.setItem(this.container, { type: "public", fields: {rest: null, "#show-all": 0}, defaults: {"#show-all": 1} });
        this.dataSource.setItem(this.container, { type: "private", fields: {rest: "hide", "#show-all": 0}, defaults: {"#show-all": 1} });

        // Shuffle isn't supported for merged bookmarks.  If we're on #show-all, make the shuffle button
        // also switch to public bookmarks.  This is easier than graying it out and trying to explain it
        // in the popup, and better than hiding it which makes it hard to find.
        let args = new helpers.args(this.dataSource.url);
        let showAll = args.hash.get("show-all") != "0";
        let setPublic = showAll? { rest: null, "#show-all": 0 }:{};
        this.dataSource.setItem(this.container, {type: "order-shuffle", fields: {"#shuffle": 1, ...setPublic}, toggle: true, defaults: {"#shuffle": null, "#show-all": 1}});

        class BookmarkTagsDropdown extends TagDropdownWidget
        {
            refreshTags()
            {
                for(let tag of this.container.querySelectorAll(".tag-entry"))
                    tag.remove();

                this.addTagLink(null); // All
                this.addTagLink(""); // Uncategorized

                let allTags = Object.keys(dataSource.bookmarkTagCounts);
                allTags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
                for(let tag of allTags)
                {
                    // Skip uncategorized, which is always placed at the beginning.
                    if(tag == "")
                        continue;

                    if(dataSource.bookmarkTagCounts[tag] == 0)
                        continue;

                    this.addTagLink(tag);
                }
            }                    

            addTagLink(tag)
            {
                let label;
                if(tag == null)
                    label = "All bookmarks";
                else if(tag == "")
                    label = "Untagged";
                else
                    label = tag;

                let a = helpers.createBoxLink({
                    label,
                    classes: ["tag-entry"],
                    popup: dataSource.bookmarkTagCounts[tag],
                    link: "#",
                    asElement: true,
                    dataType: "bookmark-tag",
                });

                if(label == "All bookmarks")
                    a.dataset.default = 1;

                if(tag == "")
                    tag = "未分類"; // Uncategorized

                dataSource.setItem(a, {
                    urlFormat: "users/id/bookmarks/type/tag",
                    fields: {"/tag": tag},
                });

                this.container.appendChild(a);
            };
        };

        // Create the bookmark tag dropdown.
        this.tagDropdown = new DropdownMenuOpener({
            button: this.querySelector(".bookmark-tag-button"),
            createBox: ({...options}) => new BookmarkTagsDropdown({dataSource, ...options}),
        });
    }
}
