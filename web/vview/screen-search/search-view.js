// The main thumbnail grid view.

import Widget from '/vview/widgets/widget.js';
import { MenuOptionsThumbnailSizeSlider } from '/vview/widgets/menu-option.js';
import { getUrlForMediaId } from '/vview/misc/media-ids.js'
import PointerListener from '/vview/actors/pointer-listener.js';
import StopAnimationAfter from '/vview/actors/stop-animation-after.js';
import LocalAPI from '/vview/misc/local-api.js';
import { helpers, GuardedRunner } from '/vview/misc/helpers.js';

// This is the logic for SearchView's grid display.  
class ThumbnailGrid
{
    constructor({container})
    {
        this.container = container;
        this.rows = [];
        this.sizingStyle = null;
    }

    clear()
    {
        for(let row of this.rows)
            row.remove();

        this.rows = [];
    }

    // Add a thumbnail to the first or last row, adding a new row if it's full.
    addThumbToRow(node, {atEnd})
    {
        // Get the row to add to.
        let row = this.getRow({atEnd});
        row.insertAdjacentElement(atEnd? "beforeend":"afterbegin", node);

        // Re-align the row with the new thumb.
        this.alignRow(row);

        // If the thumb fit on the row, stop here.  The row can still have more thumbs added
        // to it.
        let resultWidth = (row.children.length-1) * this.sizingStyle.padding;
        for(let thumb of row.children)
            resultWidth += thumb.currentWidth;
        resultWidth = Math.round(resultWidth);
        if(resultWidth <= this.sizingStyle.containerWidth)
            return row;
        
        // If this is the only thumb in this row, it should always fit.  If something goes wrong
        // and it doesn't, leave it alone.
        if(row.children.length == 1)
        {
            console.error("Single thumbnail didn't scale to fit:", row);
            return;
        }

        // Adding another thumb to it caused it to overflow, so this row is full.  Remove the
        // thumb from the overfilled row, re-align the row and put the thumb on a new one.
        node.remove();
        this.alignRow(row);

        let newRow = this.createRow({atEnd});
        newRow.insertAdjacentElement(atEnd? "beforeend":"afterbegin", node);
        return newRow;
    }

    // Return a row at the beginning or end, creating a row if needed.
    getRow({atEnd=true}={})
    {
        // Get the first or last row.
        let row = atEnd? this.rows[this.rows.length-1]:this.rows[0];
        if(row)
            return row;
        else
            return this.createRow({atEnd});
    }

    // Create a new row at the beginning or end.
    createRow({atEnd=true}={})
    {
        // Create a new row.
        let row = document.realCreateElement("div");
        row.className = "row";

        if(atEnd)
        {
            this.container.insertAdjacentElement("beforeend", row);
            this.rows.push(row);
        }
        else
        {
            this.container.insertAdjacentElement("afterbegin", row);
            this.rows.splice(0, 0, row);
        }

        return row;
    }

    getAverageHeightOfRow(row)
    {
        if(row.children.length == 0)
            return 0;

        // Get the average height of thumbs on this row.  We'll expand thumbs vertically to this height.
        let totalHeight = 0;
        for(let thumb of row.children)
            totalHeight += thumb.origHeight;
        return totalHeight / row.children.length;
    }

    // Once a row is full and won't have items added to it, finalize it to optimize space usage.
    alignRow(row)
    {
        for(let thumb of row.children)
        {
            thumb.currentWidth = thumb.origWidth;
            thumb.currentHeight = thumb.origHeight;
        }
    
        // Only adjust the size when in aspect mode, not for square thumbs.
        if(this.sizingStyle.thumbnailStyle != "aspect")
        {
            this.applySizes(row);
            return;
        }

        // Scale each thumb to the average height of the row, so all thumbs on the row have
        // the same height.
        let averageHeight = this.getAverageHeightOfRow(row);
        for(let thumb of row.children)
        {
            let ratio = averageHeight / thumb.currentHeight;
            thumb.currentHeight *= ratio;
            thumb.currentWidth *= ratio;
        }

        // Now try to scale the whole row to fit horizontally.
        let rowWidth = 0;
        for(let thumb of row.children)
            rowWidth += thumb.currentWidth;

        // Start with a scale that will exactly fit the view horizontally.
        let containerWidth = this.sizingStyle.containerWidth - (row.children.length-1) * this.sizingStyle.padding;
        let scaleX = containerWidth / rowWidth;

        // Clamp the amount we'll scale by, so we don't scale incomplete rows up endlessly trying to
        // fill the row.
        let maxAllowedHeight = this.sizingStyle.thumbHeight * 2;
        scaleX = Math.min(scaleX, maxAllowedHeight / averageHeight);

        // If the row has more than one thumb, never scale down.  Overflowing horizontally is what
        // triggers wrapping onto a new row, and scaling down would make us try to fit 
        if(row.children.length > 1)
            scaleX = Math.max(scaleX, 1);

        let scaleY = scaleX;

        for(let thumb of row.children)
        {
            thumb.currentWidth *= scaleX;
            thumb.currentHeight *= scaleY;
        }

        this.applySizes(row);
    }

    applySizes(row)
    {
        // Tell the row its height for content-intrinsic-size.  All thumbs on a row always have the
        // same height.
        let rowHeight = row.children[0]?.currentHeight ?? 128;
        row.style.setProperty("--row-height", `${rowHeight}px`);

        for(let thumb of row.children)
        {
            thumb.style.setProperty("--thumb-width", `${thumb.currentWidth}px`);
            thumb.style.setProperty("--thumb-height", `${thumb.currentHeight}px`);
        }
    }
}

export default class SearchView extends Widget
{
    constructor({...options})
    {
        super({...options, template: `
            <div class=search-view data-context-menu-target>
                <div class=artist-header hidden>
                    <div class=shape>
                        <img class=bg>
                    </div>
                </div>

                <div class=no-results hidden>
                    <div class=message>No results</div>
                </div>

                <div class=thumbnails></div>
            </div>
        `});

        // The node that scrolls to show thumbs.
        this.scrollContainer = this.root.closest(".scroll-container");
        this.thumbnailBox = this.root.querySelector(".thumbnails");
        this._setDataSourceRunner = new GuardedRunner(this._signal);
        this._loadPageRunner = new GuardedRunner(this._signal);

        this.grid = new ThumbnailGrid({
            container: this.thumbnailBox
        });

        this.artistHeader = this.querySelector(".artist-header");

        // A dictionary of thumbs in the view, in the same order.  This makes iterating
        // existing thumbs faster than iterating the nodes.
        this.thumbs = {};

        // A map of media IDs that the user has manually expanded or collapsed.
        this.expandedMediaIds = new Map();

        // This caches the results of isMediaIdExpanded.
        this._mediaIdExpandedCache = null;

        let resizeObserver = new ResizeObserver(() => this.refreshImages({cause: "resize"}));
        resizeObserver.observe(this.scrollContainer);
        resizeObserver.observe(this.thumbnailBox);

        // The scroll position may not make sense when if scroller changes size (eg. the window was resized
        // or we changed orientations).  Override it and restore from the latest scroll position that we
        // committed to history.
        new ResizeObserver(() => {
            let args = helpers.args.location;
            if(args.state.scroll)
                this.restoreScrollPosition(args.state.scroll?.scrollPosition);
        }).observe(this.scrollContainer);

        // When a bookmark is modified, refresh the heart icon.
        ppixiv.mediaCache.addEventListener("mediamodified", (e) => this.refreshThumbnail(e.mediaId), this._signal);

        // Call thumbImageLoadFinished when a thumbnail image finishes loading.
        this.root.addEventListener("load", (e) => {
            if(e.target.classList.contains("thumb"))
                this.thumbImageLoadFinished(e.target.closest(".thumbnail-box"), { cause: "onload" });
        }, { capture: true } );

        this.scrollContainer.addEventListener("scroll", (e) => this.scheduleStoreScrollPosition(), { passive: true });
        this.thumbnailBox.addEventListener("click", (e) => this.thumbnailClick(e));
                
        // As an optimization, start loading image info on mousedown.  We don't navigate until click,
        // but this lets us start loading image info a bit earlier.
        this.thumbnailBox.addEventListener("mousedown", async (e) => {
            if(e.button != 0)
                return;

            let a = e.target.closest("a.thumbnail-link");
            if(a == null)
                return;

            if(a.dataset.mediaId == null)
                return;

            // Only do this for illustrations.
            let {type} = helpers.mediaId.parse(a.dataset.mediaId);
            if(type != "illust")
                return;

            await ppixiv.mediaCache.getMediaInfo(a.dataset.mediaId);
        }, { capture: true });

        // Handle quick view.
        new PointerListener({
            element: this.thumbnailBox,
            buttonMask: 0b1,
            callback: (e) => {
                if(!e.pressed)
                    return;

                let a = e.target.closest("A");
                if(a == null)
                    return;

                if(!ppixiv.settings.get("quick_view"))
                    return;

                // Activating on press would probably break navigation on touchpads, so only do
                // this for mouse events.
                if(e.pointerType != "mouse")
                    return;

                let { mediaId } = ppixiv.app.getMediaIdAtElement(e.target);
                if(mediaId == null)
                    return;

                // Don't stopPropagation.  We want the illustration view to see the press too.
                e.preventDefault();
                // e.stopImmediatePropagation();

                ppixiv.app.showMediaId(mediaId, { addToHistory: true });
            },
        });

        // Create IntersectionObservers for thumbs that are fully onscreen and nearly onscreen.
        this.intersectionObservers = [];
        this.intersectionObservers.push(new IntersectionObserver((entries) => {
            for(let entry of entries)
                helpers.html.setDataSet(entry.target.dataset, "nearby", entry.isIntersecting);

            this.refreshImages({cause: "nearby-observer"});

            // If the last thumbnail is now nearby, see if we need to load more search results.
            this.loadDataSourcePage();
        }, {
            root: this.scrollContainer,

            // This margin determines how far in advance we load the next page of results.
            //
            // On mobile, allow this to be larger so we're less likely to interrupt scrolling.
            rootMargin: ppixiv.mobile? "400%":"150%",
        }));

        ppixiv.settings.addEventListener("thumbnail-size", () => this.updateFromSettings(), this._signal);
        ppixiv.settings.addEventListener("disable_thumbnail_zooming", () => this.updateFromSettings(), this._signal);
        ppixiv.settings.addEventListener("disable_thumbnail_panning", () => this.updateFromSettings(), this._signal);
        ppixiv.settings.addEventListener("expand_manga_thumbnails", () => this.updateFromSettings(), this._signal);
        ppixiv.settings.addEventListener("thumbnail_style", () => this.updateFromSettings(), this._signal);
        ppixiv.settings.addEventListener("pixiv_cdn", () => this.updateFromSettings(), this._signal);
        ppixiv.settings.addEventListener("show_ai_icon", () => this.refreshAllBookmarkIcons(), this._signal);
        ppixiv.muting.addEventListener("mutes-changed", () => this.refreshAfterMuteChange(), this._signal);

        this.updateFromSettings();
    }

    updateFromSettings()
    {
        this.refreshExpandedThumbAll();
        this.loadExpandedMediaIds(); // in case expand_manga_thumbnails has changed
        this.refreshImages({cause: "settings"});

        let disableThumbnailZooming = ppixiv.settings.get("disable_thumbnail_zooming") || ppixiv.mobile;
        if(ppixiv.settings.get("thumbnail_style") == "aspect")
            disableThumbnailZooming = true;
        helpers.html.setClass(document.body, "disable-thumbnail-zooming", disableThumbnailZooming);
    }

    // Return the thumbnail container for mediaId.
    //
    // If mediaId is a manga page and fallbackOnPage1 is true, return page 1 if the exact page
    // doesn't exist.
    getThumbnailForMediaId(mediaId, { fallbackOnPage1=false}={})
    {
        if(this.thumbs[mediaId] != null)
            return this.thumbs[mediaId];

        if(fallbackOnPage1)
        {
            // See if page 1 is available instead.
            let page1MediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);
            if(page1MediaId != mediaId && this.thumbs[page1MediaId] != null)
                return this.thumbs[page1MediaId];
        }

        return null;
    }

    // Return the first thumb that's fully onscreen.
    getFirstFullyOnscreenThumb()
    {
        // Find the first row near the top-left of the screen.  This is used to save and
        // restore scroll, so if there's no row exactly overlapping the top-left, prefer
        // one below it rather than above it.  This doesn't use IntersectionObserver because
        // it's async and sometimes doesn't update between resizes, causing the scroll position
        // to be lost.
        let screenTop = this.scrollContainer.scrollTop + this.scrollContainer.offsetHeight/4;
        let centerRow = null;
        let bestDistance = 999999;
        for(let row of this.grid.rows)
        {
            let rowTop = row.offsetTop;
            let distance = Math.abs(rowTop - screenTop);

            if(distance < Math.abs(bestDistance))
            {
                bestDistance = distance;
                centerRow = row;
            }
        }

        if(centerRow)
            return centerRow.firstElementChild;
        
        return null;
    }

    // Change the data source.  If targetMediaId is specified, it's the media ID we'd like to
    // scroll to if possible.
    setDataSource(dataSource, { targetMediaId }={})
    {
        return this._setDataSourceRunner.call(this._setDataSource.bind(this), { dataSource, targetMediaId });
    }

    async _setDataSource({ dataSource, targetMediaId, signal }={})
    {
        // console.log("Showing search and scrolling to media ID:", targetMediaId);

        if(dataSource != this.dataSource)
        {
            // Remove listeners from the old data source.
            if(this.dataSource != null)
                this.dataSource.removeEventListener("updated", this.dataSourceUpdated);

            this._clearThumbs();

            this._mediaIdExpandedCache = null;

            this.dataSource = dataSource;

            // Listen to the data source loading new pages, so we can refresh the list.
            this.dataSource.addEventListener("updated", this.dataSourceUpdated);

            // Set the header now if it's already known.
            this.refreshHeader();
        }

        this.loadExpandedMediaIds();

        // Load the initial page if we haven't yet.
        await this.loadDataSourcePage({ cause: "initialization" });
        signal.throwIfAborted();

        // If we weren't given a media ID to scroll to, see if we have a scroll position to restore.
        // If so, tell refreshImages that we want it to be included.
        let args = helpers.args.location;
        let scrollMediaId = args.state.scroll?.scrollPosition?.mediaId;

        // Create the initial thumbnails.
        this.refreshImages({
            cause: "initial",
            targetMediaId: targetMediaId ?? scrollMediaId,
        });

        // If a media ID to display was given, try to scroll to it.  Otherwise try to restore the
        // previous scroll position around scrollMediaId.
        if(targetMediaId != null)
            this.scrollToMediaId(targetMediaId);
        else if(!this.restoreScrollPosition(args.state.scroll?.scrollPosition))
            this.scrollContainer.scrollTop = 0;
    }

    loadDataSourcePage({cause="thumbnails"}={})
    {
        // Guard this against multiple concurrent calls.
        if(this._loadPageRunner.isRunning)
            return this._loadPageRunner.promise;

        return this._loadPageRunner.call(this._loadDataSourcePageInner.bind(this), { cause });
    }

    // Start loading a data source page if needed.
    async _loadDataSourcePageInner({cause="thumbnails", signal}={})
    {
        // We'll only load the next or previous page if we have a thumbnail displayed.
        let loadPage = this._dataSourcePageToLoad;
        if(loadPage == null)
            return;

        // Hide "no results" if it's shown while we load data.
        let noResults = this.root.querySelector(".no-results");
        noResults.hidden = true;

        await this.dataSource.loadPage(loadPage, { cause });

        // Refresh the view with any new data.  Skip this if we're in the middle of setDataSource,
        // since it wants to make the first refreshImages call.
        if(!this._setDataSourceRunner.isRunning)
            this.refreshImages({cause: "data-source-updated"});

        signal.throwIfAborted();

        // If we have no IDs and nothing is loading, the data source is empty (no results).
        if(this.dataSource?.hasNoResults)
            noResults.hidden = false;

        // See if there's another page we want to load.  This is async, since the current
        // loadDataSourcePage call should complete as soon as we've loaded a single page.
        (async() => {
            // Delay briefly as a sanity check.
            await helpers.other.sleep(100);
            this.loadDataSourcePage();
        })();
    }

    // Return the next data source page we want to load.
    get _dataSourcePageToLoad()
    {
        // We load pages when the last thumbs on the previous page are loaded, but the first
        // time through there's no previous page to reach the end of.  Always make sure the
        // first page is loaded (usually page 1).
        if(this.dataSource && !this.dataSource.isPageLoadedOrLoading(this.dataSource.initialPage))
            return this.dataSource.initialPage;

        // After the first page, don't load anything if there are no thumbs.  This avoids uncontrolled
        // loading: if we start on page 1000 and there's nothing there, we don't want to try loading
        // 999, 998, 997 endlessly looking for content.  The only thing that triggers more loads is
        // a previously loaded thumbnail coming nearby.
        let thumbs = this.getLoadedThumbs();
        if(thumbs.length == 0)
            return null;

        // Load the next page when the last nearby thumbnail (set by the "nearby" IntersectionObserver)
        // is the last thumbnail in the list.
        let lastThumb = thumbs[thumbs.length-1];
        if(lastThumb.dataset.nearby)
        {
            let loadPage = parseInt(lastThumb.dataset.searchPage) + 1;
            if(this.dataSource.canLoadPage(loadPage) && !this.dataSource.isPageLoadedOrLoading(loadPage))
                return loadPage;
        }

        // Likewise, load the previous page when the first nearby thumbnail is the first thumbnail
        // in the list.
        let firstThumb = thumbs[0];
        if(firstThumb.dataset.nearby)
        {
            let loadPage = parseInt(firstThumb.dataset.searchPage) - 1;
            if(!this.dataSource.isPageLoadedOrLoading(loadPage))
                return loadPage;
        }

        return null;
    }

    // Activate the view, waiting for the current data source to be displayed if needed.
    async activate()
    {
        this._active = true;

        // If nothing's focused, focus the search so keyboard navigation works.  Don't do this if
        // we already have focus, so we don't steal focus from things like the tag search dropdown
        // and cause them to be closed.
        let focus = document.querySelector(":focus");
        if(focus == null)
            this.scrollContainer.focus();

        // Wait until the load started by the most recent call to setDataSource finishes.
        await this._setDataSourceRunner.promise;
    }

    deactivate()
    {
        if(!this._active)
            return;

        this._active = false;
        this.stopPulsingThumbnail();
    }

    // Schedule storing the scroll position, resetting the timer if it's already running.
    scheduleStoreScrollPosition()
    {
        if(this.scrollPositionTimer != -1)
        {
            realClearTimeout(this.scrollPositionTimer);
            this.scrollPositionTimer = -1;
        }

        this.scrollPositionTimer = realSetTimeout(() => {
            this.storeScrollPosition();
        }, 100);
    }

    // Save the current scroll position so it can be restored from history, and update the search
    // page number.
    storeScrollPosition()
    {
        // Don't do this if we're in the middle of setDataSource.
        if(this._setDataSourceRunner.isRunning)
            return;

        let args = helpers.args.location;

        if(this.dataSource?.supportsStartPage)
        {
            // If the data source supports a start page, update the page number in the URL.
            let firstThumb = this.getFirstFullyOnscreenThumb();
            if(firstThumb?.dataset?.searchPage != null)
                this.dataSource.setStartPage(args, firstThumb.dataset.searchPage);
        }

        args.state.scroll = {
            scrollPosition: this.saveScrollPosition(),
        };
        helpers.navigate(args, { addToHistory: false, cause: "viewing-page", sendPopstate: false });
    }

    // This is called when the data source has more results.
    dataSourceUpdated = () =>
    {
        this.refreshHeader();
    }

    // Return all media IDs currently loaded in the data source, and the page
    // each one is on.
    getDataSourceMediaIds()
    {
        let allMediaIds = [];
        let mediaIdPages = {};
        if(this.dataSource == null)
            return { allMediaIds, mediaIdPages };

        let idList = this.dataSource.idList;
        let minPage = idList.getLowestLoadedPage();
        let maxPage = idList.getHighestLoadedPage();
        for(let page = minPage; page <= maxPage; ++page)
        {
            let mediaIdsOnPage = idList.mediaIdsByPage.get(page);
            console.assert(mediaIdsOnPage != null);

            for(let mediaId of mediaIdsOnPage)
            {
                // Add expanded manga pages.
                let mediaIdsOnPage = this._getExpandedPages(mediaId);
                if(mediaIdsOnPage != null)
                {
                    for(let pageMediaId of mediaIdsOnPage)
                    {
                        allMediaIds.push(pageMediaId);
                        mediaIdPages[pageMediaId] = page;
                    }
                    continue;
                }

                allMediaIds.push(mediaId);
                mediaIdPages[mediaId] = page;
            }
        }

        // Sanity check: there should never be any duplicate media IDs from the data source.
        // Refuse to continue if there are duplicates, since it'll break our logic badly and
        // can cause infinite loops.  This is always a bug.
        if(allMediaIds.length != (new Set(allMediaIds)).size)
            throw Error("Duplicate media IDs");

        return { allMediaIds, mediaIdPages };
    }

    // If mediaId is an expanded multi-page post, return the pages.  Otherwise, return null.
    _getExpandedPages(mediaId)
    {
        if(!this.isMediaIdExpanded(mediaId))
            return null;

        let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(info == null || info.pageCount <= 1)
            return null;

        let results = [];
        let { type, id } = helpers.mediaId.parse(mediaId);
        for(let mangaPage = 0; mangaPage < info.pageCount; ++mangaPage)
        {
            let pageMediaId = helpers.mediaId.encodeMediaId({type, id, page: mangaPage});
            results.push(pageMediaId);
        }
        return results;
    }

    // Make a list of media IDs that we want loaded.  This has a few inputs:
    //
    // - The thumbnails that are already loaded, if any.
    // - A media ID that we want to have loaded.  If we're coming back from viewing an image
    //   and it's in the search results, we always want that image loaded so we can scroll to
    //   it.
    // - The thumbnails that are near the scroll position (nearby thumbs).  These should always
    //   be loaded.
    // 
    // Try to keep thumbnails that are already loaded in the list, since there's no performance
    // benefit to unloading thumbs.  Creating thumbs can be expensive if we're creating thousands of
    // them, but once they're created, content-visibility keeps things fast.
    //
    // If targetMediaId is set and it's in the search results, always include it in the results,
    // extending the list to include it.  If targetMediaId is set and we also have thumbs already
    // loaded, we'll extend the range to include both.  If this would result in too many images
    // being added at once, we'll remove previously loaded thumbs so targetMediaId takes priority.
    //
    // If we have no nearby thumbs and no ID to force load, it's an initial load, so we'll just
    // start at the beginning.
    //
    // The result is always a contiguous subset of media IDs from the data source.
    getMediaIdsToDisplay({
        allMediaIds,
        targetMediaId,
    })
    {
        if(allMediaIds.length == 0)
            return { startIdx: 0, endIdx: 0 };

        let startIdx = 0, endIdx = 0;
    
        // If we have a specific media ID to display and it's not already loaded, ignore what we
        // have loaded and start around it instead.
        let targetMediaIdIdx = allMediaIds.indexOf(targetMediaId);
        if(targetMediaId && this.thumbs[targetMediaId] == null && targetMediaIdIdx != -1)
        {
            startIdx = targetMediaIdIdx;
            endIdx = targetMediaIdIdx;
        }
        else
        {
            // Figure out the range of allMediaIds that we want to have loaded.
            startIdx = 999999;
            endIdx = 0;

            // Start the range with thumbs that are already loaded, if any.
            let [firstLoadedMediaId, lastLoadedMediaId] = this.getLoadedMediaIds();
            let firstLoadedMediaIdIdx = allMediaIds.indexOf(firstLoadedMediaId);
            let lastLoadedMediaIdIdx = allMediaIds.indexOf(lastLoadedMediaId);
            if(firstLoadedMediaIdIdx != -1 && lastLoadedMediaIdIdx != -1)
            {
                startIdx = firstLoadedMediaIdIdx;
                endIdx = lastLoadedMediaIdIdx;
            }
            else
            {
                // Otherwise, start at the beginning.
                startIdx = 0;
                endIdx = 0;
            }

            // If the last loaded image is nearby,  we've scrolled near the end of what's loaded, so add
            // another chunk of images to the list.
            //
            // The chunk size is the number of thumbs we'll create at a time.
            //
            // Note that this doesn't determine when we'll load another page of data from the server.  The
            // "nearby" IntersectionObserver threshold controls that.  It does trigger media info loads
            // if they weren't supplied by the data source (this happens with DataSsource_VView if we're
            // using /api/ids).
            let chunkSizeForwards = 25;
            let [firstNearbyMediaId, lastNearbyMediaId] = this.getNearbyMediaIds();
            let lastNearbyMediaIdIdx = allMediaIds.indexOf(lastNearbyMediaId);
            if(lastNearbyMediaIdIdx != -1 && lastNearbyMediaIdIdx == lastLoadedMediaIdIdx)
                endIdx += chunkSizeForwards;

            // Similarly, if the first loaded image is nearby, we should load another chunk upwards.
            //
            // Use a larger chunk size when extending backwards on iOS.  Adding to the start of the
            // scroller breaks smooth scrolling (is there any way to fix that?), so use a larger chunk
            // size so it at least happens less often.
            let chunkSizeBackwards = ppixiv.ios? 100:25;
            let firstNearbyMediaIdIdx = allMediaIds.indexOf(firstNearbyMediaId);
            if(firstNearbyMediaIdIdx != -1 && firstNearbyMediaIdIdx == firstLoadedMediaIdIdx)
                startIdx -= chunkSizeBackwards;
        }

        // Clamp the range.
        startIdx = Math.max(startIdx, 0);
        endIdx = Math.min(endIdx, allMediaIds.length-1);
        endIdx = Math.max(startIdx, endIdx); // make sure startIdx <= endIdx

        // Expand the list outwards so we have enough to fill the screen.  This is an approximation:
        // we don't know how big thumbs will be, but we know they shouldn't be much bigger than
        // desiredPixels in area, and we know the area of the screen.  If we have thumbs that will
        // take more area than the screen, we know we have enough thumbs to fill it.
        //
        // We'll expand in both directions if possible, so if we have a targetMediaId and it's in
        // the middle, it'll stay in the middle if possible.  Expand to twice the screen area, since
        // some of the thumbs we'll create will only be partially onscreen.
        let { desiredPixels, containerWidth } = this.sizingStyle;
        let viewPixels = containerWidth * this.scrollContainer.offsetHeight;
        viewPixels *= 2;
        while(1)
        {
            let totalThumbs = (endIdx - startIdx) + 1;
            if(totalThumbs >= allMediaIds.length)
                break;

            let totalPixels = totalThumbs * desiredPixels;
            if(totalPixels >= viewPixels)
                break;

            if(startIdx > 0)
                startIdx--;
            if(endIdx + 1 < allMediaIds.length)
                endIdx++;
        }

        return { startIdx, endIdx };
    }

    // Return the first and last media IDs that are nearby (or all of them if all is true).
    getNearbyMediaIds({all=false}={})
    {
        let mediaIds = [];
        for(let [mediaId, element] of Object.entries(this.thumbs))
        {
            if(element.dataset.nearby)
                mediaIds.push(mediaId);
        }

        if(all)
            return mediaIds;
        else
            return [mediaIds[0], mediaIds[mediaIds.length-1]];
    }

    // Return the first and last media IDs that's currently loaded into thumbs.
    getLoadedMediaIds()
    {
        let mediaIds = Object.keys(this.thumbs);
        let firstLoadedMediaId = mediaIds[0];
        let lastLoadedMediaId = mediaIds[mediaIds.length-1];
        return [firstLoadedMediaId, lastLoadedMediaId];
    }

    refreshImages({
        targetMediaId=null,

        // If true, clear thumbs before refreshing, clearing out any accumulated offscreen thumbs.
        purge=false,

        // For diagnostics, this tells us what triggered this refresh.
        cause
    }={})
    {
        if(this.dataSource == null)
            return;

        // Update the thumbnail size style.
        let oldSizingStyle = this.sizingStyle;
        this.sizingStyle = this.makeThumbnailSizingStyle();
        this.grid.sizingStyle = this.sizingStyle;

        // Save the scroll position relative to the first thumbnail.  Do this before making
        // any changes.
        let savedScroll = this.saveScrollPosition();

        let {padding, containerWidth} = this.sizingStyle;
        this.root.style.setProperty('--thumb-padding', `${padding}px`);
        this.root.style.setProperty('--container-width', `${containerWidth}px`);

        // These are overridden for each thumb, but the base size is used for the header.
        this.root.style.setProperty("--thumb-width", `${this.sizingStyle.thumbWidth}px`);
        this.root.style.setProperty("--row-height", `${this.sizingStyle.thumbHeight}px`);

        // If purge is true or the sizing style changed, clear thumbs and start over.
        if(oldSizingStyle && JSON.stringify(oldSizingStyle) != JSON.stringify(this.sizingStyle))
            purge = true;
        
        if(purge)
        {
            // If we don't have a targetMediaId, set it to the scroll media ID so we'll recreate
            // thumbs near where we were.
            targetMediaId ??= savedScroll?.mediaId;

            // console.log(`Resetting view due to sizing change, target: ${targetMediaId}`);
            this._clearThumbs();
        }

        // Get all media IDs from the data source.
        let { allMediaIds, mediaIdPages } = this.getDataSourceMediaIds();

        // If targetMediaId isn't in the list, this might be a manga page beyond the first that
        // isn't displayed, so try the first page instead.
        if(targetMediaId != null && allMediaIds.indexOf(targetMediaId) == -1)
            targetMediaId = helpers.mediaId.getMediaIdFirstPage(targetMediaId);

        // Get the range of media IDs to display.
        let { startIdx, endIdx } = this.getMediaIdsToDisplay({
            allMediaIds,
            targetMediaId,
        });

        let mediaIds = allMediaIds.slice(startIdx, endIdx+1);

        // If the new media ID list doesn't overlap the old list, clear out the list and start
        // over.
        let currentMediaIds = Object.keys(this.thumbs);
        let firstExistingIdx = mediaIds.indexOf(currentMediaIds[0]);
        let lastExistingIdx = mediaIds.indexOf(currentMediaIds[currentMediaIds.length-1]);
        let incrementalUpdate = false;
        if(firstExistingIdx != -1 && lastExistingIdx != -1)
        {
            let currentMediaIdsSubset = mediaIds.slice(firstExistingIdx, lastExistingIdx+1);
            incrementalUpdate = helpers.other.arrayEqual(currentMediaIdsSubset, currentMediaIds);
        }

        // If this isn't an incremental update, clear the list.
        if(!incrementalUpdate)
        {
            // This isn't an incremental update.  It's a new search, or something has happened that
            // added or removed thumbs in the middle of the list, like expanding manga pages.
            this._clearThumbs();

            // If we're targetting an image, set firstExistingIdx and lastExistingIdx so we'll add
            // forwards starting at that image, then add the images before it backwards.  This way
            // that image will always be at the start of a row, which makes restoring the scroll
            // position much more consistent.  If we're not, just add all images forwards.
            let restoreIdx = mediaIds.indexOf(targetMediaId);
            if(restoreIdx != -1)
            {
                lastExistingIdx = restoreIdx-1;
                firstExistingIdx = restoreIdx;
            }
            else
            {
                lastExistingIdx = -1;
                firstExistingIdx = 0;
            }
        }

        // Add thumbs to the end.
        for(let idx = lastExistingIdx + 1; idx < mediaIds.length; ++idx)
        {
            let mediaId = mediaIds[idx];
            let searchPage = mediaIdPages[mediaId];
            let node = this.createThumb(mediaId, searchPage);
            helpers.other.addToEnd(this.thumbs, mediaId, node);
            this.grid.addThumbToRow(node, {atEnd: true});
        }

        // Add thumbs to the beginning.
        for(let idx = firstExistingIdx - 1; idx >= 0; --idx)
        {
            let mediaId = mediaIds[idx];
            let searchPage = mediaIdPages[mediaId];
            let node = this.createThumb(mediaId, searchPage);
            this.thumbs = helpers.other.addToBeginning(this.thumbs, mediaId, node);
            this.grid.addThumbToRow(node, {atEnd: false});
        }

        this.restoreScrollPosition(savedScroll);

        // this.sanityCheckThumbList();
    }

    // Clear the view.
    _clearThumbs()
    {
        for(let node of Object.values(this.thumbs))
        {
            node.remove();
            for(let observer of this.intersectionObservers)
                observer.unobserve(node);
        }

        this.thumbs = {};
        this.grid.clear();
    }

    // Create a thumbnail.
    createThumb(mediaId, searchPage)
    {
        // makeSVGUnique is disabled here as a small optimization, since these SVGs don't need it.
        let entry = this.createTemplate({ name: "template-thumbnail", makeSVGUnique: false, html: `
            <div class=thumbnail-box>
                <a class=thumbnail-link href=#>
                    <img class=thumb>
                </a>

                <div class=last-viewed-image-marker>
                    <ppixiv-inline class=last-viewed-image-marker src="resources/last-viewed-image-marker.svg"></ppixiv-inline>
                </div>

                <div class=bottom-row>
                    <div class=bottom-left-icon>
                        <div class="heart button-bookmark public bookmarked" hidden>
                            <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                        </div>
                        <div class="heart button-bookmark private bookmarked" hidden>
                            <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                        </div>
                        <img class=ai-image src="ppixiv:resources/ai.png" hidden>
                    </div>

                    <div style="flex: 1;"></div>

                    <div class=thumbnail-label hidden>
                        <span class="thumbnail-ellipsis-box">
                            <span class=label></span>
                        </span>
                    </div>

                    <div style="flex: 1;"></div>

                    <div class=bottom-right-icon>
                        <div class=ugoira-icon hidden>
                            <ppixiv-inline src="resources/play-button.svg"></ppixiv-inline>
                        </div>

                        <div class=manga-info-box hidden>
                            <img class="page-icon regular" src="ppixiv:resources/page-icon.png">
                            <img class="page-icon hover" src="ppixiv:resources/page-icon-hover.png">
                            <span class=page-count hidden>1234</span>
                        </div>
                    </div>
                </div>
                <div class=muted-text>
                    ${ helpers.createIcon("mat:block", { classes: ["muted-icon"] }) }
                    <span class=muted-label></span>
                </div>
            </div>
        `});

        entry.dataset.id = mediaId;

        if(searchPage != null)
            entry.dataset.searchPage = searchPage;
        for(let observer of this.intersectionObservers)
            observer.observe(entry);

        this.setupThumb(entry);

        return entry;
    }

    // Return { thumbWidth, thumbHeight} for mediaId.
    _thumbnailSize(mediaId)
    {
        // The sizing style gives us the base thumbnail size.
        let { thumbWidth, thumbHeight, desiredPixels } = this.sizingStyle;

        // Anything but illusts use the default width.
        let { type } = helpers.mediaId.parse(mediaId);
        if(type != "illust" && type != "file" && type != "folder")
            return { thumbWidth, thumbHeight };

        if(this.sizingStyle.thumbnailStyle == "square")
            return { thumbWidth, thumbHeight };

        // The manga view preloads thumbs so we can always get the aspect ratio from extraCache.
        let aspectRatio = null;
        if(this.dataSource?.name == "manga")
        {
            aspectRatio = ppixiv.extraCache.getMediaAspectRatioSync(mediaId);
            if(aspectRatio == null)
            {
                console.warn(`Manga view didn't cache the aspect ratio for ${mediaId}`);
                aspectRatio = 1;
            }
        }
        else
        {
            // Get the aspect ratio from media info.  If this is a manga page this won't be known,
            // and getImageDimensions will use the first page's dimensions.
            let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
            if(mediaInfo == null)
                throw new Error(`Missing media info data for ${mediaId}`);

            let { width, height } = ppixiv.mediaCache.getImageDimensions(mediaInfo, mediaId);
            if(width == null)
                return { thumbWidth, thumbHeight };

            aspectRatio = width / height;
        }

        // Set the thumbnail size to have an area of desiredPixels with the aspect ratio we've chosen.
        // This gives thumbnails a similar amount of screen space whether they're portrait or landscape,
        // and keeps the overall number of thumbs on screen at once mostly predictable.  Put a limit on
        // how narrow are, so extremely wide strip images don't take over the row.
        aspectRatio = helpers.math.clamp(aspectRatio, 1/3, 3);

        thumbWidth = Math.sqrt(desiredPixels * aspectRatio);
        thumbHeight = thumbWidth / aspectRatio;

        thumbWidth = Math.round(thumbWidth);
        thumbHeight = Math.round(thumbHeight);
        return { thumbWidth, thumbHeight };
    }

    _setThumbnailSize(mediaId, element)
    {
        let { thumbWidth, thumbHeight } = this._thumbnailSize(mediaId);

        // Store the preferred thumbnail size.
        element.origWidth = thumbWidth;
        element.origHeight = thumbHeight;
    }

    // If element isn't loaded and we have media info for it, set it up.
    setupThumb(element)
    {
        let mediaId = element.dataset.id;
        if(mediaId == null)
            return;

        let { id: thumbId, type: thumbType } = helpers.mediaId.parse(mediaId);

        // On hover, use StopAnimationAfter to stop the animation after a while.
        this.addAnimationListener(element);

        this._setThumbnailSize(mediaId, element);

        if(thumbType == "user" || thumbType == "bookmarks")
        {
            // This is a user thumbnail rather than an illustration thumbnail.  It just shows a small subset
            // of info.
            let userId = thumbId;

            let link = element.querySelector("a.thumbnail-link");
            if(thumbType == "user")
                link.href = `/users/${userId}/artworks#ppixiv`;
            else
                link.href = `/users/${userId}/bookmarks/artworks#ppixiv`;

            link.dataset.userId = userId;

            let quickUserData = ppixiv.extraCache.getQuickUserData(userId);
            if(quickUserData == null)
            {
                // We should always have this data for users if the data source asked us to display this user.
                throw new Error(`Missing quick user data for user ID ${userId}`);
            }
            
            let thumb = element.querySelector(".thumb");
            thumb.src = quickUserData.profileImageUrl;

            let label = element.querySelector(".thumbnail-label");
            label.hidden = false;
            label.querySelector(".label").innerText = quickUserData.userName;

            return;
        }

        if(thumbType != "illust" && thumbType != "file" && thumbType != "folder")
            throw "Unexpected thumb type: " + thumbType;

        // Get media info.  This should always be registered by the data source.
        let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(info == null)
            throw new Error(`Missing media info data for ${mediaId}`);

        // Set this thumb.
        let { page } = helpers.mediaId.parse(mediaId);
        let url = info.previewUrls[page];
        let thumb = element.querySelector(".thumb");
        let [illustId, illustPage] = helpers.mediaId.toIllustIdAndPage(mediaId);

        // Check if this illustration is muted (blocked).
        let mutedTag = ppixiv.muting.anyTagMuted(info.tagList);
        let mutedUser = ppixiv.muting.isUserIdMuted(info.userId);
        if(mutedTag || mutedUser)
        {
            // The image will be obscured, but we still shouldn't load the image the user blocked (which
            // is something Pixiv does wrong).  Load the user profile image instead.
            thumb.src = ppixiv.mediaCache.getProfilePictureUrl(info.userId);
            element.classList.add("muted");

            let mutedLabel = element.querySelector(".muted-label");

            // Quick hack to look up translations, since we're not async:
            (async() => {
                if(mutedTag)
                    mutedTag = await ppixiv.tagTranslations.getTranslation(mutedTag);
                mutedLabel.textContent = mutedTag? mutedTag:info.userName;
            })();

            // We can use this if we want a "show anyway' UI.
            thumb.dataset.mutedUrl = url;
        }
        else
        {
            thumb.src = url;
            element.classList.remove("muted");
            LocalAPI.thumbnailWasLoaded(url);

            // Let ExtraCache know about this image, so we'll learn the image's aspect ratio.
            ppixiv.extraCache.registerLoadingThumbnail(mediaId, thumb);

            // Try to set up the aspect ratio.
            this.thumbImageLoadFinished(element, { cause: "setup" });
        }

        // Set the link.  Setting dataset.mediaId will allow this to be handled with in-page
        // navigation, and the href will allow middle click, etc. to work normally.
        let link = element.querySelector("a.thumbnail-link");
        if(thumbType == "folder")
        {
            // This is a local directory.  We only expect to see this while on the local
            // data source.  Clear any search when navigating to a subdirectory.
            let args = new helpers.args("/");
            LocalAPI.getArgsForId(mediaId, args);
            link.href = args.url;
        }
        else
        {
            link.href = getUrlForMediaId(mediaId).url;
        }

        link.dataset.mediaId = mediaId;
        link.dataset.userId = info.userId;

        element.querySelector(".ugoira-icon").hidden = info.illustType != 2 && info.illustType != "video";

        helpers.html.setClass(element, "dot", helpers.pixiv.tagsContainDot(info.tagList));

        // Set expanded-thumb if this is an expanded manga post.  This is also updated in
        // setMediaIdExpanded.  Set the border to a random-ish value to try to make it
        // easier to see the boundaries between manga posts.  It's hard to guarantee that it
        // won't be the same color as a neighboring post, but that's rare.  Using the illust
        // ID means the color will always be the same.  The saturation is a bit low so these
        // colors aren't blinding.
        this.refreshExpandedThumb(element);
        helpers.html.setClass(link, "first-page", illustPage == 0);
        helpers.html.setClass(link, "last-page", illustPage == info.pageCount-1);
        link.style.borderBottomColor = `hsl(${illustId}deg 50% 50%)`;

        this.refreshBookmarkIcon(element);

        // Set the label.  This is only actually shown in following views.
        let label = element.querySelector(".thumbnail-label");
        if(thumbType == "folder")
        {
            // The ID is based on the filename.  Use it to show the directory name in the thumbnail.
            let parts = mediaId.split("/");
            let basename = parts[parts.length-1];
            let label = element.querySelector(".thumbnail-label");
            label.hidden = false;
            label.querySelector(".label").innerText = basename;
        } else {
            label.hidden = true;
        }
    }

    // Based on the dimensions of the container and a desired pixel size of thumbnails,
    // figure out how many columns to display to bring us as close as possible to the
    // desired size.  Return the corresponding CSS style attributes.
    //
    // container is the containing block (eg. ul.thumbnails).
    makeThumbnailSizingStyle()
    {
        // The thumbnail mode is included here so changes to it trigger a refresh.
        let thumbnailStyle = ppixiv.settings.get("thumbnail_style");

        let desiredSize = ppixiv.settings.get("thumbnail-size", 4);
        desiredSize = MenuOptionsThumbnailSizeSlider.thumbnailSizeForValue(desiredSize);

        // Pack images more tightly on mobile.
        let padding = ppixiv.mobile? 3:15;

        // The container might have a fractional size, and clientWidth will round it, which is
        // wrong for us: if the container is 500.75 wide and we calculate a fit for 501, the result
        // won't actually fit.  Get the bounding box instead, which isn't rounded.
        // let containerWidth = container.parentNode.clientWidth;
        let containerWidth = Math.floor(this.root.getBoundingClientRect().width);
        let containerHeight = Math.floor(this.scrollContainer.getBoundingClientRect().height);
        
        let columns = containerWidth / desiredSize;
        columns = Math.floor(columns);
        columns = Math.max(columns, 1);

        let remainingWidth = containerWidth - padding*(columns-1);
        let thumbWidth = Math.floor(remainingWidth / columns);
        let thumbHeight = Math.floor(thumbWidth);
        containerWidth = Math.floor(thumbWidth * columns + padding*(columns-1));

        // Limit the number of visible thumbs, so we don't load too much data at once.  Allow
        // unlimited columns for local images.
        let maxThumbs = this.dataSource?.isVView? 500:40;
        let rows = window.innerHeight / thumbWidth;
        if(columns * rows > maxThumbs)
        {
            columns = maxThumbs / rows;
            containerWidth = Math.floor(thumbWidth*columns + padding*(columns-1));
        }

        let desiredPixels = thumbWidth * thumbHeight;

        return {
            thumbnailStyle, padding, thumbWidth, thumbHeight,
            containerWidth, containerHeight,
            desiredPixels,

            // This list just forces a refresh if any values inside it change.
            deps: [
                ppixiv.settings.get("pixiv_cdn"),
            ],
        };
    }
    
    // Verify that thumbs we've created are in sync with this.thumbs.
    sanityCheckThumbList()
    {
        let actual = [];
        for(let thumb of this.thumbnailBox.children)
            actual.push(thumb.dataset.id);
        let expected = Object.keys(this.thumbs);

        if(JSON.stringify(actual) != JSON.stringify(expected))
        {
            console.log("actual  ", actual);
            console.log("expected", expected);
        }
    }

    thumbnailClick(e)
    {
        // See if this is a click on the manga page toggle.
        let pageCountBox = e.target.closest(".manga-info-box");
        if(pageCountBox)
        {
            e.preventDefault();
            e.stopPropagation();
            let idNode = pageCountBox.closest("[data-id]");
            let mediaId = idNode.dataset.id;
            this.setMediaIdExpanded(mediaId, !this.isMediaIdExpanded(mediaId));
        }
    }

    // Save the current scroll position relative to the first visible thumbnail.
    // The result can be used with restoreScrollPosition.
    saveScrollPosition()
    {
        let firstVisibleThumbNode = this.getFirstFullyOnscreenThumb();
        if(firstVisibleThumbNode == null)
            return null;

        // Save relative to the row instead of the thumb, since the thumb's offsetParent is the
        // row and its offsetTop is 0.
        let row = firstVisibleThumbNode.parentNode;

        return {
            savedScroll: helpers.html.saveScrollPosition(this.scrollContainer, row),
            mediaId: firstVisibleThumbNode.dataset.id,
        }
    }

    // Restore the scroll position from a position saved by saveScrollPosition.
    restoreScrollPosition(scroll)
    {
        if(scroll == null)
            return false;

        // Find the thumbnail for the mediaId the scroll position was saved at.
        let restoreScrollPositionNode = this.getThumbnailForMediaId(scroll.mediaId);
        if(restoreScrollPositionNode == null)
            return false;

        let row = restoreScrollPositionNode.parentNode;
        helpers.html.restoreScrollPosition(this.scrollContainer, row, scroll.savedScroll);
        return true;
    }

    // Set whether the given thumb is expanded.
    //
    // We can store a thumb being explicitly expanded or explicitly collapsed, overriding the
    // current default.
    setMediaIdExpanded(mediaId, newValue)
    {
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);

        this.expandedMediaIds.set(mediaId, newValue);

        // Clear this ID's isMediaIdExpanded cache, if any.
        if(this._mediaIdExpandedCache)
            this._mediaIdExpandedCache.delete(mediaId);

        this.saveExpandedMediaIds();

        // This will cause thumbnails to be added or removed, so refresh.  Allow this to purge the
        // thumbnail list.  This will trigger a full refresh since we're changing thumbs in the
        // middle, which can be slow if it recreates a huge accumulated thumbnail list.
        this.refreshImages({cause: "manga-expansion-change", purge: true});

        if(!newValue)
        {
            // After collapsing a manga post, scroll the first page onscreen.
            this.scrollToMediaId(helpers.mediaId.getMediaIdFirstPage(mediaId));
        }
    }

    // Set whether thumbs are expanded or collapsed by default.
    toggleExpandingMediaIdsByDefault()
    {
        // If the new setting is the same as the expand_manga_thumbnails setting, just
        // remove expand-thumbs.  Otherwise, set it to the overridden setting.
        let args = helpers.args.location;
        let newValue = !this.mediaIdsExpandedByDefault;
        if(newValue == ppixiv.settings.get("expand_manga_thumbnails"))
            args.hash.delete("expand-thumbs");
        else
            args.hash.set("expand-thumbs", newValue? "1":"0");

        // Clear manually expanded/unexpanded thumbs, and navigate to the new setting.
        delete args.state.expandedMediaIds;
        helpers.navigate(args);
    }

    loadExpandedMediaIds()
    {
        // Load expandedMediaIds.
        let args = helpers.args.location;
        let mediaIds = args.state.expandedMediaIds ?? {};
        this.expandedMediaIds = new Map(Object.entries(mediaIds));

        // Load mediaIdsExpandedByDefault.
        let expandThumbs = args.hash.get("expand-thumbs");
        if(expandThumbs == null)
            this.mediaIdsExpandedByDefault = ppixiv.settings.get("expand_manga_thumbnails");
        else
            this.mediaIdsExpandedByDefault = expandThumbs == "1";
    }

    // Store this.expandedMediaIds to history.
    saveExpandedMediaIds()
    {
        let args = helpers.args.location;
        args.state.expandedMediaIds = Object.fromEntries(this.expandedMediaIds);
        helpers.navigate(args, { addToHistory: false, cause: "viewing-page", sendPopstate: false });
    }

    // If mediaId is a manga post, return true if it should be expanded to show its pages.
    isMediaIdExpanded(mediaId)
    {
        // This is called a lot and becomes a bottleneck on large searches, so cache results.
        this._mediaIdExpandedCache ??= new Map();
        if(!this._mediaIdExpandedCache.has(mediaId))
            this._mediaIdExpandedCache.set(mediaId, this._isMediaIdExpanded(mediaId));

        return this._mediaIdExpandedCache.get(mediaId);
    }

    _isMediaIdExpanded(mediaId)
    {
        // Never expand manga posts on data sources that include manga pages themselves.
        // This can result in duplicate media IDs.
        if(!this.dataSource?.allowExpandingMangaPages)
            return false;

        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);

        // Only illust IDs can be expanded.
        let { type } = helpers.mediaId.parse(mediaId);
        if(type != "illust")
            return false;

        // Check if the user has manually expanded or collapsed the image.
        if(this.expandedMediaIds.has(mediaId))
            return this.expandedMediaIds.get(mediaId);

        // The media ID hasn't been manually expanded or unexpanded.  If we're not expanding
        // by default, it's unexpanded.
        if(!this.mediaIdsExpandedByDefault)
            return false;

        // If the image is muted, never expand it by default, even if we're set to expand by default.
        // We'll just show a wall of muted thumbs.
        let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(info != null)
        {
            let mutedTag = ppixiv.muting.anyTagMuted(info.tagList);
            let mutedUser = ppixiv.muting.isUserIdMuted(info.userId);
            if(mutedTag || mutedUser)
                return false;
        }

        // Otherwise, it's expanded by default if it has more than one page.  Note that if we don't
        // have media info yet, mediaInfoLoaded will refresh again once it becomes available.
        if(info == null || info.pageCount == 1)
            return false;

        return true;
    }

    // Refresh the expanded-thumb class on thumbnails after expanding or unexpanding a manga post.
    refreshExpandedThumb(thumb)
    {
        if(thumb == null)
            return;

        // Don't set expanded-thumb on the manga view, since it's always expanded.
        let mediaId = thumb.dataset.id;
        let showExpanded = this.dataSource?.allowExpandingMangaPages && this.isMediaIdExpanded(mediaId);
        helpers.html.setClass(thumb, "expanded-thumb", showExpanded);

        let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        let [illustId, illustPage] = helpers.mediaId.toIllustIdAndPage(mediaId);
        
        helpers.html.setClass(thumb, "expanded-manga-post", showExpanded);
        helpers.html.setClass(thumb, "first-manga-page", info && info.pageCount > 1 && illustPage == 0);

        // Show the page count if this is a multi-page post (unless we're on the
        // manga view itself).
        let showMangaPage = info && info.pageCount > 1 && this.dataSource?.name != "manga";
        let pageCountBox = thumb.querySelector(".manga-info-box");
        pageCountBox.hidden = !showMangaPage;
        if(showMangaPage)
        {
            let text = showExpanded? `${illustPage+1}/${info.pageCount}`:info.pageCount;
            pageCountBox.querySelector(".page-count").textContent = text;
            pageCountBox.querySelector(".page-count").hidden = false;
            helpers.html.setClass(pageCountBox, "show-expanded", showExpanded);
        }
    }

    // Refresh all expanded thumbs.  This is only needed if the default changes.
    refreshExpandedThumbAll()
    {
        for(let thumb of this.getLoadedThumbs())
            this.refreshExpandedThumb(thumb);
    }

    // Set things up based on the image dimensions.  We can do this immediately if we know the
    // thumbnail dimensions already, otherwise we'll do it based on the thumbnail once it loads.
    thumbImageLoadFinished(element, { cause })
    {
        if(element.dataset.thumbLoaded)
            return;

        let mediaId = element.dataset.id;
        let [illustId, illustPage] = helpers.mediaId.toIllustIdAndPage(mediaId);
        let thumb = element.querySelector(".thumb");

        // Try to use thumbnail info first.  Preferring this makes things more consistent,
        // since naturalWidth may or may not be loaded depending on browser cache.
        let width, height;
        if(illustPage == 0)
        {
            let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
            if(info != null)
            {
                width = info.width;
                height = info.height;
            }
        }

        // If that wasn't available, try to use the dimensions from the image.  This is the size
        // of the thumb rather than the image, but all we care about is the aspect ratio.
        if(width == null && thumb.naturalWidth != 0)
        {
            width = thumb.naturalWidth;
            height = thumb.naturalHeight;
        }

        if(width == null)
            return;

        // We can't do this until the node is added to the document and it has a size.
        if(element.offsetWidth == 0)
            return;

        element.dataset.thumbLoaded = "1";

        // Set up the thumbnail panning direction, which is based on the image aspect ratio and the
        // displayed thumbnail aspect ratio.
        let aspectRatio = element.offsetWidth / element.offsetHeight;
        SearchView.createThumbnailAnimation(thumb, width, height, aspectRatio);
    }

    // If the aspect ratio is very narrow, don't use any panning, since it becomes too spastic.
    // If the aspect ratio is portrait, use vertical panning.
    // If the aspect ratio is landscape, use horizontal panning.
    //
    // If it's in between, don't pan at all, since we don't have anywhere to move and it can just
    // make the thumbnail jitter in place.
    //
    // Don't pan muted images.
    //
    // containerAspectRatio is the aspect ratio of the box the thumbnail is in.  If the
    // thumb is in a 2:1 landscape box, we'll adjust the min and max aspect ratio accordingly.
    static getThumbnailPanningDirection(thumb, width, height, containerAspectRatio)
    {
        // Disable panning if we don't have the image size.  Local directory thumbnails
        // don't tell us the dimensions in advance.
        if(width == null || height == null)
        {
            helpers.html.setClass(thumb, "vertical-panning", false);
            helpers.html.setClass(thumb, "horizontal-panning", false);
            return null;
        }

        let aspectRatio = width / height;
        aspectRatio /= containerAspectRatio;
        let minAspectForPan = 1.1;
        let maxAspectForPan = 4;
        if(aspectRatio > (1/maxAspectForPan) && aspectRatio < 1/minAspectForPan)
            return "vertical";
        else if(aspectRatio > minAspectForPan && aspectRatio < maxAspectForPan)
            return "horizontal";
        else
            return null;
    }

    static createThumbnailAnimation(thumb, width, height, containerAspectRatio)
    {
        if(ppixiv.mobile)
            return null;

        // Create the animation, or update it in-place if it already exists, probably due to the
        // window being resized.  total_time won't be updated when we do this.
        let direction = this.getThumbnailPanningDirection(thumb, width, height, containerAspectRatio);
        if(thumb.panAnimation != null || direction == null)
            return null;

        let keyframes = direction == "horizontal"?
        [
            // This starts in the middle, pans left, pauses, pans right, pauses, returns to the
            // middle, then pauses again.
            { offset: 0.0, easing: "ease-in-out", objectPosition: "left top" }, // left
            { offset: 0.4, easing: "ease-in-out", objectPosition: "right top" }, // pan right
            { offset: 0.5, easing: "ease-in-out", objectPosition: "right top" }, // pause
            { offset: 0.9, easing: "ease-in-out", objectPosition: "left top" }, // pan left
            { offset: 1.0, easing: "ease-in-out", objectPosition: "left top" }, // pause
        ]:
        [
            // This starts at the top, pans down, pauses, pans back up, then pauses again.
            { offset: 0.0, easing: "ease-in-out", objectPosition: "center top" },
            { offset: 0.4, easing: "ease-in-out", objectPosition: "center bottom" },
            { offset: 0.5, easing: "ease-in-out", objectPosition: "center bottom" },
            { offset: 0.9, easing: "ease-in-out", objectPosition: "center top" },
            { offset: 1.0, easing: "ease-in-out", objectPosition: "center top" },
        ];
    
        let animation = new Animation(new KeyframeEffect(thumb, keyframes, {
            duration: 4000,
            iterations: Infinity,
            
            // The full animation is 4 seconds, and we want to start 20% in, at the halfway
            // point of the first left-right pan, where the pan is exactly in the center where
            // we are before any animation.  This is different from vertical panning, since it
            // pans from the top, which is already where we start (top center).
            delay: direction == "horizontal"? -800:0,
        }));

        animation.id = direction == "horizontal"? "horizontal-pan":"vertical-pan";
        thumb.panAnimation = animation;

        return animation;
    }

    // element is a thumbnail element.  On mouseover, start the pan animation, and create
    // a StopAnimationAfter to prevent the animation from running forever.
    //
    // We create the pan animations programmatically instead of with CSS, since for some
    // reason element.getAnimations is extremely slow and often takes 10ms or more.  CSS
    // can't be used to pause programmatic animations, so we have to play/pause it manually
    // too.
    addAnimationListener(element)
    {
        if(ppixiv.mobile)
            return;

        if(element.addedAnimationListener)
            return;
        element.addedAnimationListener = true;

        element.addEventListener("mouseover", (e) => {
            if(ppixiv.settings.get("disable_thumbnail_panning") || 
               ppixiv.settings.get("thumbnail_style") == "aspect" ||
                ppixiv.mobile)
                return;

            let thumb = element.querySelector(".thumb");
            let anim = thumb.panAnimation;
            if(anim == null)
                return;

            // Start playing the animation.
            anim.play();

            // Stop if StopAnimationAfter is already running for this thumb.
            if(this.stopAnimation?.animation == anim)
                return;
            // If we were running it on another thumb and we missed the mouseout for
            // some reason, remove it.  This only needs to run on the current hover.
            if(this.stopAnimation)
            {
                this.stopAnimation.shutdown();
                this.stopAnimation = null;
            }

            this.stopAnimation = new StopAnimationAfter(anim, 6, 1, anim.id == "vertical-pan");

            // Remove it when the mouse leaves the thumb.  We'll actually respond to mouseover/mouseout
            // for elements inside the thumb too, but it doesn't cause problems here.
            element.addEventListener("mouseout", (e) => {
                this.stopAnimation.shutdown();
                this.stopAnimation = null;
                anim.pause();
            }, { once: true, signal: this.stopAnimation.abort.signal });
        });
    }
    
    // Refresh the thumbnail for mediaId.
    //
    // This is used to refresh the bookmark icon when changing a bookmark.
    refreshThumbnail(mediaId)
    {
        // If this is a manga post, refresh all thumbs for this media ID, since bookmarking
        // a manga post is shown on all pages if it's expanded.
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(mediaInfo == null)
            return;

        let thumbnailElement = this.getThumbnailForMediaId(mediaId);
        if(thumbnailElement != null)
            this.refreshBookmarkIcon(thumbnailElement);

        // If we're displaying individual pages for this media ID, check them too.
        for(let page = 0; page < mediaInfo.pageCount; ++page)
        {
            let pageMediaId = helpers.mediaId.getMediaIdForPage(mediaId, page);
            thumbnailElement = this.getThumbnailForMediaId(pageMediaId);
            if(thumbnailElement != null)
                this.refreshBookmarkIcon(thumbnailElement);
        }
    }

    // If the data source gives us a URL to use as a header image, update it.
    refreshHeader()
    {
        let img = this.artistHeader.querySelector("img");
        let headerStripURL = this.dataSource?.uiInfo?.headerStripURL;
        if(headerStripURL == null)
        {
            this.artistHeader.hidden = true;
            img.src = helpers.other.blankImage;
            return;
        }

        if(img.src == headerStripURL)
            return;

        // Save the scroll position in case we're turning the header on.
        let savedScroll = this.saveScrollPosition();

        // If thumbnail panning is turned off, disable this animation too.
        helpers.html.setClass(img, "animated", ppixiv.mobile || !ppixiv.settings.get("disable_thumbnail_panning"));

        // Start the animation.
        img.classList.remove("loaded");
        img.onload = () => img.classList.add("loaded");

        // Set the URL.
        img.src = headerStripURL ?? helpers.other.blankImage;
        this.artistHeader.hidden = false;

        this.restoreScrollPosition(savedScroll);
    }

    refreshAllBookmarkIcons()
    {
        for(let thumb of this.getLoadedThumbs())
            this.refreshBookmarkIcon(thumb);
    }

    // Set the bookmarked heart for thumbnailElement.  This can change if the user bookmarks
    // or un-bookmarks an image.
    refreshBookmarkIcon(thumbnailElement)
    {
        if(this.dataSource && this.dataSource.name == "manga")
            return;

        let mediaId = thumbnailElement.dataset.id;
        if(mediaId == null)
            return;

        // Get thumbnail info.
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(mediaInfo == null)
            return;

        // aiType is 0 or 1 for false and 2 for true.
        let showAI = mediaInfo.aiType == 2;

        let showBookmarkHeart = mediaInfo.bookmarkData != null;
        if(this.dataSource != null && !this.dataSource.showBookmarkIcons)
            showBookmarkHeart = false;

        // On mobile, don't show ai-image if we're showing a bookmark to reduce clutter.
        if(ppixiv.mobile && showAI && showBookmarkHeart)
            showAI = false;
        if(!ppixiv.settings.get("show_ai_icon"))
            showAI = false;

        thumbnailElement.querySelector(".ai-image").hidden = !showAI;
        thumbnailElement.querySelector(".heart.public").hidden = !showBookmarkHeart || mediaInfo.bookmarkData.private;
        thumbnailElement.querySelector(".heart.private").hidden = !showBookmarkHeart || !mediaInfo.bookmarkData.private;
    }

    // Refresh all thumbs after the mute list changes.
    refreshAfterMuteChange()
    {
        this._mediaIdExpandedCache = null;
        this.refreshImages({cause: "mutes-changed", purge: true});
    }

    getLoadedThumbs()
    {
        return Object.values(this.thumbs);
    }

    // Scroll to mediaId if it's available.  This is called when we display the thumbnail view
    // after coming from an illustration.
    scrollToMediaId(mediaId)
    {
        if(mediaId == null)
            return false;

        // Make sure this image has a thumbnail created if possible.
        this.refreshImages({ targetMediaId: mediaId, cause: "scroll-to-id" });

        let thumb = this.getThumbnailForMediaId(mediaId, { fallbackOnPage1: true });
        if(thumb == null)
            return false;

        // If we were displaying an image, pulse it to make it easier to find your place.
        this.pulseThumbnail(mediaId);

        // Get the vertical position and height of the thumb.  Use the containing row instead
        // of the thumb itself for this, since the thumb's offsetParent is the row and its
        // offsetTop is 0.
        let { offsetTop, offsetHeight } = thumb.parentNode;

        // Stop if the thumb is already fully visible.
        if(offsetTop >= this.scrollContainer.scrollTop &&
            offsetTop + offsetHeight < this.scrollContainer.scrollTop + this.scrollContainer.offsetHeight)
            return true;

        let y = offsetTop + offsetHeight/2 - this.scrollContainer.offsetHeight/2;

        // If we set y outside of the scroll range, iOS will incorrectly report scrollTop briefly.
        // Clamp the position to avoid this.
        y = helpers.math.clamp(y, 0, this.scrollContainer.scrollHeight - this.scrollContainer.offsetHeight);

        this.scrollContainer.scrollTop = y;

        return true;
    };

    // Return the bounding rectangle for the given mediaId.
    getRectForMediaId(mediaId)
    {
        let thumb = this.getThumbnailForMediaId(mediaId, { fallbackOnPage1: true });
        if(thumb == null)
            return null;

        return thumb.getBoundingClientRect();
    }

    pulseThumbnail(mediaId)
    {
        // If animations are enabled, they indicate the last viewed image, so we don't need this.
        if(ppixiv.settings.get("animations_enabled"))
            return;

        let thumb = this.getThumbnailForMediaId(mediaId);
        if(thumb == null)
            return;

        this.stopPulsingThumbnail();

        this.flashingImage = thumb;
        thumb.classList.add("flash");
    };

    // Work around a bug in CSS animations: even if animation-iteration-count is 1,
    // the animation will play again if the element is hidden and displayed again, which
    // causes previously-flashed thumbnails to flash every time we exit and reenter
    // thumbnails.
    stopPulsingThumbnail()
    {
        if(this.flashingImage == null)
            return;

        this.flashingImage.classList.remove("flash");
        this.flashingImage = null;
    };
};

