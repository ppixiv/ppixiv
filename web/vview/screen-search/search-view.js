// The main thumbnail grid view.

import Widget from 'vview/widgets/widget.js';
import { MenuOptionsThumbnailSizeSlider } from 'vview/widgets/menu-option.js';
import { getUrlForMediaId } from 'vview/misc/media-ids.js'
import PointerListener from 'vview/actors/pointer-listener.js';
import StopAnimationAfter from 'vview/actors/stop-animation-after.js';
import LocalAPI from 'vview/misc/local-api.js';
import { helpers, GuardedRunner } from 'vview/misc/helpers.js';

export default class SearchView extends Widget
{
    constructor({...options})
    {
        super({...options, template: `
            <div class=search-view data-context-menu-target>
                <div class=no-results hidden>
                    <div class=message>No results</div>
                </div>

                <div class=load-previous-page hidden>
                    <a class=load-previous-button href=#>
                        <vv-container style="font-size: 150%;">${ helpers.createIcon("mat:expand_less") }</vv-container>
                        Load previous results
                    </a>
                </div>

                <div class=artist-header hidden>
                    <div class=shape>
                        <img class=bg>
                    </div>
                </div>

                <div class=thumbnails></div>
            </div>
        `});

        // The node that scrolls to show thumbs.  This is normally the document itself.
        this.scrollContainer = this.root.closest(".scroll-container");
        this.thumbnailBox = this.root.querySelector(".thumbnails");
        this.loadPreviousPageButton = this.root.querySelector(".load-previous-page");
        this._setDataSourceRunner = new GuardedRunner(this._signal);

        this.artistHeader = this.querySelector(".artist-header");

        // A dictionary of thumbs in the view, in the same order.  This makes iterating
        // existing thumbs faster than iterating the nodes.
        this.thumbs = {};

        // A map of media IDs that the user has manually expanded or collapsed.
        this.expandedMediaIds = new Map();

        // Refresh the "load previous page" link when the URL changes.
        window.addEventListener("pp:statechange", (e) => this._refreshLoadPreviousButton(), this._signal);

        // This caches the results of isMediaIdExpanded.
        this._mediaIdExpandedCache = null;
        ppixiv.muting.addEventListener("mutes-changed", () => this._mediaIdExpandedCache = null, this._signal);

        new ResizeObserver(() => this.refreshImages()).observe(this.root);

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

        this.root.querySelector(".load-previous-button").addEventListener("click", (e) =>
        {
            e.preventDefault();
            e.stopImmediatePropagation();

            let page = this.dataSource.idList.getLowestLoadedPage() - 1;
            console.debug(`Load previous page button pressed, loading page ${page}`);
            this.loadPage(page);
        });

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
                helpers.html.setDataSet(entry.target.dataset, "fullyOnScreen", entry.isIntersecting);

            this.loadDataSourcePage();
            this.firstVisibleThumbsChanged();
        }, {
            root: this.scrollContainer,
            threshold: 1,
        }));
        
        this.intersectionObservers.push(new IntersectionObserver((entries) => {
            for(let entry of entries)
                helpers.html.setDataSet(entry.target.dataset, "nearby", entry.isIntersecting);

            this.refreshImages();

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
        ppixiv.settings.addEventListener("manga-thumbnail-size", () => this.updateFromSettings(), this._signal);
        ppixiv.settings.addEventListener("disable_thumbnail_zooming", () => this.updateFromSettings(), this._signal);
        ppixiv.settings.addEventListener("disable_thumbnail_panning", () => this.updateFromSettings(), this._signal);
        ppixiv.settings.addEventListener("expand_manga_thumbnails", () => this.updateFromSettings(), this._signal);
        ppixiv.muting.addEventListener("mutes-changed", () => this.refreshAfterMuteChange(), this._signal);

        this.updateFromSettings();
    }

    updateFromSettings()
    {
        this.refreshExpandedThumbAll();
        this.loadExpandedMediaIds(); // in case expand_manga_thumbnails has changed
        this.refreshImages();

        helpers.html.setClass(document.body, "disable-thumbnail-zooming", ppixiv.settings.get("disable_thumbnail_zooming") || ppixiv.mobile);
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
        for(let element of Object.values(this.thumbs))
        {
            if(element.dataset.fullyOnScreen)
                return element;
        }

        return null;
    }

    // This is called as the user scrolls and different thumbs are fully onscreen,
    // to update the page URL.
    firstVisibleThumbsChanged()
    {
        // Find the first thumb that's fully onscreen.  Ignore elements not specific to a page (load previous results).
        let firstThumb = this.getFirstFullyOnscreenThumb();
        if(!firstThumb)
            return;

        // If the data source supports a start page, update the page number in the URL to reflect
        // the first visible thumb.
        if(this.dataSource == null || !this.dataSource.supportsStartPage || firstThumb.dataset.searchPage == null)
            return;

        let args = helpers.args.location;
        this.dataSource.setStartPage(args, firstThumb.dataset.searchPage);
        helpers.navigate(args, { addToHistory: false, cause: "viewing-page", sendPopstate: false });
    }

    // Change the data source.  If targetMediaId is specified, it's the media ID we'd like to
    // scroll to if possible.
    setDataSource(dataSource, { targetMediaId }={})
    {
        let promise = this._setDataSourceRunner.call(this._setDataSource.bind(this), { dataSource, targetMediaId });

        // We ignore dataSourceUpdated calls while setting up, so run it once when it finishes.
        promise.then(() => this.dataSourceUpdated());

        return promise;
    }

    async _setDataSource({ dataSource, targetMediaId, signal }={})
    {
        // console.log("Showing search and scrolling to media ID:", targetMediaId);

        if(dataSource != this.dataSource)
        {
            // Remove listeners from the old data source.
            if(this.dataSource != null)
                this.dataSource.removeEventListener("pageadded", this.dataSourceUpdated);

            // Clear the view when the data source changes.  If we leave old thumbs in the list,
            // it confuses things if we change the sort and refreshThumbs tries to load thumbs
            // based on what's already loaded.
            while(this.thumbnailBox.firstElementChild != null)
            {
                let node = this.thumbnailBox.firstElementChild;
                node.remove();

                // We should be able to just remove the element and get a callback that it's no longer visible.
                // This works in Chrome since IntersectionObserver uses a weak ref, but Firefox is stupid and leaks
                // the node.
                for(let observer of this.intersectionObservers)
                    observer.unobserve(node);
            }

            // Don't leave the "load previous page" button displayed while we wait for the
            // data source to load.
            this.loadPreviousPageButton.hidden = true;

            this.thumbs = {};
            this._mediaIdExpandedCache = null;

            this.dataSource = dataSource;

            // Listen to the data source loading new pages, so we can refresh the list.
            this.dataSource.addEventListener("pageadded", this.dataSourceUpdated);

            this.refreshHeader();
        }

        // If we disabled loading more pages earlier, reenable it.
        this._disableLoadingMorePages = false;

        this.loadExpandedMediaIds();

        // Load the initial page if we haven't yet.
        await this.loadDataSourcePage({ cause: "initialization" });
        signal.throwIfAborted();

        // Create the initial thumbnails.  Keep creating more until we have enough to allow the screen
        // to scroll a bit.  This will create targetMediaId if possible, so we can scroll to it, and allow
        // refreshHeader to scroll the header where we want it.  Only attempt this a couple times, since
        // we might not have enough images to fill the screen.  This is just a best effort, since we're
        // not loading more data here and the data source's may not give enough data on the first page
        // to fill the screen.
        for(let i = 0; i < 4; ++i)
        {
            // Stop once the scroller is a bit taller than the screen.
            if(this.scrollContainer.scrollHeight > this.scrollContainer.offsetHeight * 1.5)
                break;

            this.refreshImages({ forcedMediaId: targetMediaId, forceMore: true });
        }

        this._restoreScrollForActivation({oldMediaId: targetMediaId});
    }

    // Start loading a data source page if needed.
    async loadDataSourcePage({cause="thumbnails"}={})
    {
        // We load pages when the last thumbs on the previous page are loaded, but the first
        // time through there's no previous page to reach the end of.  Always make sure the
        // first page is loaded (usually page 1).
        let loadPage = null;
        if(this.dataSource && !this.dataSource.isPageLoadedOrLoading(this.dataSource.initialPage))
            loadPage = this.dataSource.initialPage;

        if(loadPage == null)
        {
            // Load the next page when the last nearby thumbnail (set by the "nearby" IntersectionObserver)
            // is the last thumbnail in the list.
            let thumbs = this.getLoadedThumbs();
            if(thumbs.length > 0)
            {
                let lastThumb = thumbs[thumbs.length-1];
                if(lastThumb.dataset.nearby)
                    loadPage = parseInt(lastThumb.dataset.searchPage)+1;

                // If autoLoadPreviousPages is true, do the same at the start: load the previous page when the first
                // nearby thumbnail is the first thumbnail in the list.
                if(loadPage == null && this.dataSource?.autoLoadPreviousPages)
                {
                    let firstThumb = thumbs[0];
                    let searchPage = parseInt(firstThumb.dataset.searchPage);
                    if(firstThumb.dataset.nearby && searchPage > 1)
                    {
                        loadPage = searchPage - 1;
                        console.log("Auto-loading backwards:", loadPage);
                    }
                }
            }
        }

        // Hide "no results" if it's shown while we load data.
        let noResults = this.root.querySelector(".no-results");
        noResults.hidden = true;

        if(loadPage != null)
        {
            let result = await this.dataSource.loadPage(loadPage, { cause });

            // If this page didn't load, it probably means we've reached the end, so stop trying
            // to load more pages.
            if(!result)
                this._disableLoadingMorePages = true;
        }

        // If we have no IDs and nothing is loading, the data source is empty (no results).
        if(this.dataSource?.hasNoResults)
            noResults.hidden = false;
    }

    _restoreScrollForActivation({oldMediaId})
    {
        // If we have no saved scroll position or previous ID, scroll to the top.
        let args = helpers.args.location;
        if(args.state.scroll == null && oldMediaId == null)
        {
            // console.log("Scroll to top for new search");
            this.scrollContainer.scrollTop = 0;
            return;
        }

        // If we have a previous media ID, try to scroll to it.
        if(oldMediaId != null)
        {
            // If we're navigating backwards or toggling, and we're switching from the image UI to thumbnails,
            // try to scroll the search screen to the image that was displayed.
            if(this.scrollToMediaId(oldMediaId))
            {
                // console.log("Restored scroll position to:", oldMediaId);
                return;
            }

            console.log("Couldn't restore scroll position for:", oldMediaId);
        }

        this.restoreScrollPosition(args.state.scroll?.scrollPosition);
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

    // Save the current scroll position, so it can be restored from history.
    storeScrollPosition()
    {
        let args = helpers.args.location;
        args.state.scroll = {
            scrollPosition: this.saveScrollPosition(),
            nearbyMediaIds: this.getNearbyMediaIds({all: true}),
        };
        helpers.navigate(args, { addToHistory: false, cause: "viewing-page", sendPopstate: false });
    }

    dataSourceUpdated = () =>
    {
        // Don't load or refresh images if we're in the middle of setDataSource.
        if(this._setDataSourceRunner.isRunning)
            return;

        this.refreshHeader();
        this.refreshImages();
        this.loadDataSourcePage();
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

            // Create an image for each ID.
            for(let mediaId of mediaIdsOnPage)
            {
                // If this is a multi-page post and manga expansion is enabled, add a thumbnail for
                // each page.  We can only do this if the data source registers thumbnail info from
                // its results, not if we have to look it up asynchronously, but almost all data sources
                // do.
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
    // If forcedMediaId is set and it's in the search results, always include it in the results,
    // extending the list to include it.  If forcedMediaId is set and we also have thumbs already
    // loaded, we'll extend the range to include both.  If this would result in too many images
    // being added at once, we'll remove previously loaded thumbs so forcedMediaId takes priority.
    //
    // If we have no nearby thumbs and no ID to force load, it's an initial load, so we'll just
    // start at the beginning.
    //
    // The result is always a contiguous subset of media IDs from the data source.
    getMediaIdsToDisplay({
        allMediaIds,
        forcedMediaId,
        columns,
        forceMore=false,
    })
    {
        if(allMediaIds.length == 0)
            return [];

        // Figure out the range of allMediaIds that we want to have loaded.
        let startIdx = 999999;
        let endIdx = 0;

        // If this is the initial refresh and we have a saved scroll position, restore the list
        // of nearby media IDs, so we're able to scroll to the right place.
        let isInitialRefresh = Object.keys(this.thumbs).length == 0;
        let args = helpers.args.location;
        if(isInitialRefresh && args.state.scroll?.nearbyMediaIds != null)
        {
            // nearbyMediaIds is all media IDs that were nearby.  Not all of them may be
            // in the list now, eg. if we're only loading page 2 but some images from page 1
            // were nearby before, so find the biggest matching range.
            //
            // Skip this if the result is too far apart, so if the new results aren't similar
            // to the old ones, we won't try to load thousands of results.  This can happen on
            // shuffled searches.
            let firstIdx = helpers.other.findFirstIdx(args.state.scroll.nearbyMediaIds, allMediaIds);
            let lastIdx = helpers.other.findLastIdx(args.state.scroll.nearbyMediaIds, allMediaIds);
            if(firstIdx != -1 && lastIdx != -1 && Math.abs(firstIdx - lastIdx) < 100)
            {
                startIdx = firstIdx;
                endIdx = lastIdx;
            }
        }

        // Start the range with thumbs that are already loaded, if any.
        let [firstLoadedMediaId, lastLoadedMediaId] = this.getLoadedMediaIds();
        let firstLoadedMediaIdIdx = allMediaIds.indexOf(firstLoadedMediaId);
        if(firstLoadedMediaIdIdx != -1)
            startIdx = Math.min(startIdx, firstLoadedMediaIdIdx);

        let lastLoadedMediaIdIdx = allMediaIds.indexOf(lastLoadedMediaId);
        if(lastLoadedMediaIdIdx != -1)
            endIdx = Math.max(endIdx, lastLoadedMediaIdIdx);

        // If we have a specific media ID to display, extend the range to include it.
        let forcedMediaIdIdx = allMediaIds.indexOf(forcedMediaId);
        if(forcedMediaIdIdx != -1)
        {
            startIdx = Math.min(startIdx, forcedMediaIdIdx);
            endIdx = Math.max(endIdx, forcedMediaIdIdx);
        }

        // Otherwise, start at the beginning.
        if(startIdx == 999999)
        {
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
        //
        // If forceMore is true, always add a chunk to the end.
        let chunkSizeForwards = 25;
        let [firstNearbyMediaId, lastNearbyMediaId] = this.getNearbyMediaIds();
        let lastNearbyMediaIdIds = allMediaIds.indexOf(lastNearbyMediaId);
        if(lastNearbyMediaIdIds != -1 && lastNearbyMediaIdIds == lastLoadedMediaIdIdx)
            endIdx += chunkSizeForwards;
        else if(forceMore)
            endIdx += chunkSizeForwards;

        // Similarly, if the first loaded image is nearby, we should load another chunk upwards.
        //
        // Use a larger chunk size when extending backwards on iOS.  Adding to the start of the
        // scroller breaks smooth scrolling (is there any way to fix that?), so use a larger chunk
        // size so it at least happens less often.
        let chunkSizeBackwards = ppixiv.ios? 100:25;
        if(firstLoadedMediaIdIdx != -1)
        {
            let firstNearbyMediaIdIdx = allMediaIds.indexOf(firstNearbyMediaId);
            if(firstNearbyMediaId == null || firstNearbyMediaIdIdx == firstLoadedMediaIdIdx)
                startIdx -= chunkSizeBackwards;
        }

        // Clamp the range.
        startIdx = Math.max(startIdx, 0);
        endIdx = Math.min(endIdx, allMediaIds.length-1);
        endIdx = Math.max(startIdx, endIdx); // make sure startIdx <= endIdx

        // If we're forcing an image to be included, and we also have images already
        // loaded, we can end up with a huge range if the two are far apart.  For example,
        // if an image is loaded from a search, the user navigates for a long time in the
        // image view and then returns to the search, we'll load the image he ended up on
        // all the way to the images that were loaded before.  Check the number of images
        // we're adding, and if it's too big, ignore the previously loaded thumbs and just
        // load IDs around forcedMediaId.
        if(forcedMediaIdIdx != -1)
        {
            // See how many thumbs this would cause us to load.
            let loadedThumbIds = new Set();
            for(let node of this.getLoadedThumbs())
                loadedThumbIds.add(node.dataset.id);
    
            let loadingThumbCount = 0;
            for(let thumbId of allMediaIds.slice(startIdx, endIdx+1))
            {
                if(!loadedThumbIds.has(thumbId))
                    loadingThumbCount++;
            }

            if(loadingThumbCount > 100)
            {
                console.log("Reducing loadingThumbCount from", loadingThumbCount);

                startIdx = forcedMediaIdIdx - 10;
                endIdx = forcedMediaIdIdx + 10;
                startIdx = Math.max(startIdx, 0);
                endIdx = Math.min(endIdx, allMediaIds.length-1);
            }
        }

        // Snap the start of the range to the column count, so images always stay on the
        // same column if we add entries to the beginning of the list.  This only works if
        // the data source provides all IDs at once, but if it doesn't then we won't
        // auto-load earlier images anyway.
        if(columns != null)
            startIdx -= startIdx % columns;

        /*
        console.log(
            `Nearby range: ${firstNearbyMediaIdIdx} to ${lastNearbyMediaIdIds}, loaded: ${firstLoadedMediaIdIdx} to ${lastLoadedMediaIdIdx}, ` +
            `forced idx: ${forcedMediaIdIdx}, returning: ${startIdx} to ${endIdx}`);
        */

        return allMediaIds.slice(startIdx, endIdx+1);
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

    refreshImages({forcedMediaId=null, forceMore=false}={})
    {
        if(this.dataSource == null)
            return;

        let isMangaView = this.dataSource?.name == "manga";

        // Update the thumbnail size style.  This also tells us the number of columns being
        // displayed.
        let desiredSize = ppixiv.settings.get(isMangaView? "manga-thumbnail-size":"thumbnail-size", 4);
        desiredSize = MenuOptionsThumbnailSizeSlider.thumbnailSizeForValue(desiredSize);

        let {columns, padding, thumbWidth, thumbHeight, containerWidth} = SearchView.makeThumbnailSizingStyle({
            container: this.thumbnailBox,
            desiredSize,
            ratio: this.dataSource.getThumbnailAspectRatio(),

            // Limit the number of columns on most views, so we don't load too much data at once.
            // Allow more columns on the manga view, since that never loads more than one image.
            // Allow unlimited columns for local images, and on mobile where we're usually limited
            // by screen space and showing lots of columns (but few rows) can be useful.
            maxColumns: 
                ppixiv.mobile? 30:
                isMangaView? 15: 
                this.dataSource?.isVView? 100:5,

            // Pack images more tightly on mobile.
            minPadding: ppixiv.mobile? 3:15,
        });

        // Save the scroll position relative to the first thumbnail.  Do this before making
        // any changes.
        let savedScroll = this.saveScrollPosition();

        this.root.style.setProperty('--thumb-width', `${thumbWidth}px`);
        this.root.style.setProperty('--thumb-height', `${thumbHeight}px`);
        this.root.style.setProperty('--thumb-padding', `${padding}px`);
        this.root.style.setProperty('--container-width', `${containerWidth}px`);

        // Get all media IDs from the data source.
        let { allMediaIds, mediaIdPages } = this.getDataSourceMediaIds();

        // Sanity check: there should never be any duplicate media IDs from the data source.
        // Refuse to continue if there are duplicates, since it'll break our logic badly and
        // can cause infinite loops.  This is always a bug.
        if(allMediaIds.length != (new Set(allMediaIds)).size)
            throw Error("Duplicate media IDs");

        // If forcedMediaId isn't in the list, this might be a manga page beyond the first that
        // isn't displayed, so try the first page instead.
        if(forcedMediaId != null && allMediaIds.indexOf(forcedMediaId) == -1)
            forcedMediaId = helpers.mediaId.getMediaIdFirstPage(forcedMediaId);

        // When we remove thumbs, we'll cache them here, so if we end up reusing it we don't have
        // to recreate it.
        let removedNodes = {};
        let removeNode = (node) =>
        {
            node.remove();
            removedNodes[node.dataset.id] = node;
            delete this.thumbs[node.dataset.id];
        }

        // Remove any thumbs that aren't present in allMediaIds, so we only need to 
        // deal with adding thumbs below.  For example, this simplifies things when
        // a manga post is collapsed.
        {
            let mediaIdSet = new Set(allMediaIds);
            for(let [thumbMediaId, thumb] of Object.entries(this.thumbs))
            {
                if(!mediaIdSet.has(thumbMediaId))
                    removeNode(thumb);
            }
        }

        // Get the thumbnail media IDs to display.
        let mediaIds = this.getMediaIdsToDisplay({
            allMediaIds,
            columns,
            forcedMediaId,
            forceMore,
        });

        // Add thumbs.
        //
        // Most of the time we're just adding thumbs to the list.  Avoid removing or recreating
        // thumbs that aren't actually changing, which reduces flicker.
        //
        // Do this by looking for a range of thumbnails that matches a range in mediaIds.
        // If we're going to display [0,1,2,3,4,5,6,7,8,9], and the current thumbs are [4,5,6],
        // then 4,5,6 matches and can be reused.  We'll add [0,1,2,3] to the beginning and [7,8,9]
        // to the end.
        //
        // Most of the time we're just appending.  The main time that we add to the beginning is
        // the "load previous results" button.

        // Make a dictionary of all illust IDs and pages, so we can look them up quickly.
        let mediaIdIndex = {};
        for(let i = 0; i < mediaIds.length; ++i)
        {
            let mediaId = mediaIds[i];
            mediaIdIndex[mediaId] = i;
        }

        function getNodeIdx(node)
        {
            if(node == null)
                return null;

            let mediaId = node.dataset.id;
            return mediaIdIndex[mediaId];
        }

        // Find the first match (4 in the above example).
        let firstMatchingNode = this.thumbnailBox.firstElementChild;
        while(firstMatchingNode && getNodeIdx(firstMatchingNode) == null)
            firstMatchingNode = firstMatchingNode.nextElementSibling;

        // If we have a firstMatchingNode, walk forward to find the last matching node (6 in
        // the above example).
        let lastMatchingNode = firstMatchingNode;
        if(lastMatchingNode != null)
        {
            // Make sure the range is contiguous.  firstMatchingNode and all nodes through lastMatchingNode
            // should match a range exactly.  If there are any missing entries, stop.
            let nextExpectedIdx = getNodeIdx(lastMatchingNode) + 1;
            while(lastMatchingNode && getNodeIdx(lastMatchingNode.nextElementSibling) == nextExpectedIdx)
            {
                lastMatchingNode = lastMatchingNode.nextElementSibling;
                nextExpectedIdx++;
            }
        }

        // If we have a range, delete all items outside of it.  Otherwise, just delete everything.
        while(firstMatchingNode && firstMatchingNode.previousElementSibling)
            removeNode(firstMatchingNode.previousElementSibling);

        while(lastMatchingNode && lastMatchingNode.nextElementSibling)
            removeNode(lastMatchingNode.nextElementSibling);

        if(!firstMatchingNode && !lastMatchingNode)
        {
            while(this.thumbnailBox.firstElementChild != null)
                removeNode(this.thumbnailBox.firstElementChild);
        }

        // If we have a matching range, add any new elements before it.
        if(firstMatchingNode)
        {
           let firstIdx = getNodeIdx(firstMatchingNode);
           for(let idx = firstIdx - 1; idx >= 0; --idx)
           {
               let mediaId = mediaIds[idx];
               let searchPage = mediaIdPages[mediaId];
               let node = this.createThumb(mediaId, searchPage, { cachedNodes: removedNodes });
               firstMatchingNode.insertAdjacentElement("beforebegin", node);
               firstMatchingNode = node;
               this.thumbs = helpers.other.addToBeginning(this.thumbs, mediaId, node);
           }
        }

        // Add any new elements after the range.  If we don't have a range, just add everything.
        let lastIdx = -1;
        if(lastMatchingNode)
           lastIdx = getNodeIdx(lastMatchingNode);

        for(let idx = lastIdx + 1; idx < mediaIds.length; ++idx)
        {
            let mediaId = mediaIds[idx];
            let searchPage = mediaIdPages[mediaId];
            let node = this.createThumb(mediaId, searchPage, { cachedNodes: removedNodes });
            this.thumbnailBox.appendChild(node);
            helpers.other.addToEnd(this.thumbs, mediaId, node);
        }

        // If this data source supports a start page and we started after page 1, show the "load more"
        // button.  Hide it if we're auto-loading backwards too.
        this.loadPreviousPageButton.hidden = this.dataSource == null || this.dataSource.initialPage == 1;
        if(this.dataSource?.autoLoadPreviousPages)
            this.loadPreviousPageButton.hidden = true;

        this.restoreScrollPosition(savedScroll);

        // this.sanityCheckThumbList();
    }

    // Create a thumbnail.
    //
    // cachedNodes is a dictionary of previously-created nodes that we can reuse.
    createThumb(mediaId, searchPage, { cachedNodes })
    {
        if(cachedNodes[mediaId] != null)
        {
            let result = cachedNodes[mediaId];
            delete cachedNodes[mediaId];
            return result;
        }

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
                    <span>Muted:</span>
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

    // If element isn't loaded and we have media info for it, set it up.
    //
    // If force is true, always reconfigure the thumbnail.  This is used when something like mutes
    // have changed and we want to refresh all thumbnails.
    setupThumb(element)
    {
        let mediaId = element.dataset.id;
        if(mediaId == null)
            return;

        let { id: thumbId, type: thumbType } = helpers.mediaId.parse(mediaId);

        // On hover, use StopAnimationAfter to stop the animation after a while.
        this.addAnimationListener(element);

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
    static makeThumbnailSizingStyle({
        container,
        minPadding,
        desiredSize=300,
        ratio=null,
        maxColumns=5,
    }={})
    {
        // The total pixel size we want each thumbnail to have:
        ratio ??= 1;

        let desiredPixels = desiredSize*desiredSize;

        // The container might have a fractional size, and clientWidth will round it, which is
        // wrong for us: if the container is 500.75 wide and we calculate a fit for 501, the result
        // won't actually fit.  Get the bounding box instead, which isn't rounded.
        // let containerWidth = container.parentNode.clientWidth;
        let containerWidth = Math.floor(container.parentNode.getBoundingClientRect().width);
        let padding = minPadding;
        
        let closestErrorToDesiredPixels = -1;
        let bestSize = [0,0];
        let bestColumns = 0;

        // Find the greatest number of columns we can fit in the available width.
        for(let columns = maxColumns; columns >= 1; --columns)
        {
            // The amount of space in the container remaining for images, after subtracting
            // the padding around each image.  Padding is the flex gap, so this doesn't include
            // padding at the left and right edge.
            let remainingWidth = containerWidth - padding*(columns-1);
            let maxWidth = remainingWidth / columns;

            let maxHeight = maxWidth;
            if(ratio < 1)
                maxWidth *= ratio;
            else if(ratio > 1)
                maxHeight /= ratio;

            maxWidth = Math.floor(maxWidth);
            maxHeight = Math.floor(maxHeight);

            let pixels = maxWidth * maxHeight;
            let error = Math.abs(pixels - desiredPixels);
            if(closestErrorToDesiredPixels == -1 || error < closestErrorToDesiredPixels)
            {
                closestErrorToDesiredPixels = error;
                bestSize = [maxWidth, maxHeight];
                bestColumns = columns;
            }
        }

        let [thumbWidth, thumbHeight] = bestSize;

        // If we want a smaller thumbnail size than we can reach within the max column
        // count, we won't have reached desiredPixels.  In this case, just clamp to it.
        // This will cause us to use too many columns, which we'll correct below with
        // containerWidth.
        //
        // On mobile, just allow the thumbnails to be bigger, so we prefer to fill the
        // screen and not waste screen space.
        if(!ppixiv.mobile && thumbWidth * thumbHeight > desiredPixels)
        {
            thumbHeight = thumbWidth = Math.round(Math.sqrt(desiredPixels));

            if(ratio < 1)
                thumbWidth *= ratio;
            else if(ratio > 1)
                thumbHeight /= ratio;
        }

        // Clamp the width of the container to the number of columns we expect.
        containerWidth = bestColumns*thumbWidth + (bestColumns-1)*padding;
        return {columns: bestColumns, padding, thumbWidth, thumbHeight, containerWidth};
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

    // See if we can load page in-place.  Return true if we were able to, and the click that
    // requested it should be cancelled, or false if we can't and it should be handled as a
    // regular navigation.
    async loadPage(page)
    {
        // We can only add pages that are immediately before or after the pages we currently have.
        let minPage = this.dataSource.idList.getLowestLoadedPage();
        let maxPage = this.dataSource.idList.getHighestLoadedPage();
        if(page < minPage-1)
            return false;
        if(page > maxPage+1)
            return false;
        
        console.log("Loading page:", page);
        await this.dataSource.loadPage(page, { cause: "previous page" });
        return true;
    }

    // Save the current scroll position relative to the first visible thumbnail.
    // The result can be used with restoreScrollPosition.
    saveScrollPosition()
    {
        // Find a thumb near the middle of the screen to lock onto.  We don't need to read offsets
        // and possibly trigger layout, just find all fully onscreen thumbs and take the one in the
        // middle.  This gives a more stable scroll position when resizing than using the first one.
        let centerThumbs = [];
        for(let element of Object.values(this.thumbs))
        {
            if(!element.dataset.fullyOnScreen)
                continue;

            centerThumbs.push(element);
        }

        let firstVisibleThumbNode = centerThumbs[Math.floor(centerThumbs.length/2)];
        if(firstVisibleThumbNode == null)
            return null;

        return {
            savedScroll: helpers.html.saveScrollPosition(this.scrollContainer, firstVisibleThumbNode),
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

        helpers.html.restoreScrollPosition(this.scrollContainer, restoreScrollPositionNode, scroll.savedScroll);
        return true;
    }

    // Set whether the given thumb is expanded.
    //
    // We can store a thumb being explicitly expanded or explicitly collapsed, overriding the
    // current default.
    setMediaIdExpanded(mediaId, newValue)
    {
        let page = helpers.mediaId.toIllustIdAndPage(mediaId)[1];
        mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);

        this.expandedMediaIds.set(mediaId, newValue);

        // Clear this ID's isMediaIdExpanded cache, if any.
        if(this._mediaIdExpandedCache)
            this._mediaIdExpandedCache.delete(mediaId);

        this.saveExpandedMediaIds();

        // This will cause thumbnails to be added or removed, so refresh.
        this.refreshImages();

        // Refresh whether we're showing the expansion border.  refreshImages sets this when it's
        // created, but it doesn't handle refreshing it.
        let thumb = this.getThumbnailForMediaId(mediaId);
        this.refreshExpandedThumb(thumb);

        if(!newValue)
        {
            mediaId = helpers.mediaId.getMediaIdFirstPage(mediaId);

            // If we're collapsing a manga post on the first page, we know we don't need to
            // scroll since the user clicked the first page.  Leave it where it is so we don't
            // move the button he clicked around.  If we're collapsing a later page, scroll
            // the first page onscreen so we don't end up in a random scroll position two pages down.
            if(page != 0)
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
        if(info && info.pageCount > 1 && this.dataSource?.name != "manga")
        {
            let pageCountBox = thumb.querySelector(".manga-info-box");
            pageCountBox.hidden = false;

            let text = showExpanded? `${illustPage+1}/${info.pageCount}`:info.pageCount;
            thumb.querySelector(".manga-info-box .page-count").textContent = text;
            thumb.querySelector(".manga-info-box .page-count").hidden = false;
            helpers.html.setClass(thumb.querySelector(".manga-info-box"), "show-expanded", showExpanded);
        }
    }

    // Refresh all expanded thumbs.  This is only needed if the default changes.
    refreshExpandedThumbAll()
    {
        for(let thumb of this.getLoadedThumbs())
            this.refreshExpandedThumb(thumb);
    }

    // Set the link for the "load previous page" button.
    _refreshLoadPreviousButton()
    {
        if(this.dataSource == null)
            return;

        let page = this.dataSource.getStartPage(helpers.args.location);
        let previousPageLink = this.loadPreviousPageButton.querySelector("a.load-previous-button");
        let args = helpers.args.location;
        this.dataSource.setStartPage(args, page-1);
        previousPageLink.href = args.url;
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

        element.dataset.thumbLoaded = "1";

        // Set up the thumbnail panning direction, which is based on the image aspect ratio and the
        // displayed thumbnail aspect ratio.  Ths thumbnail aspect ratio is usually 1 for square thumbs,
        // but it can be different on the manga page.  Get this from the data source, since using offsetWidth
        // causes a reflow.
        let thumbAspectRatio = this.dataSource.getThumbnailAspectRatio() ?? 1;

        // console.log(`Thumbnail ${mediaId} loaded at ${cause}: ${width} ${height} ${thumb.src}`);
        SearchView.createThumbnailAnimation(thumb, width, height, thumbAspectRatio);
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
            if(ppixiv.settings.get("disable_thumbnail_panning") || ppixiv.mobile)
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
        let headerStripURL = this.dataSource?.uiInfo?.headerStripURL;
        if(headerStripURL == null)
        {
            this.artistHeader.hidden = true;
            let img = this.artistHeader.querySelector("img");
            img.src = helpers.other.blankImage;
            return;
        }

        let img = this.artistHeader.querySelector("img");
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

        thumbnailElement.querySelector(".ai-image").hidden = !showAI;
        thumbnailElement.querySelector(".heart.public").hidden = !showBookmarkHeart || mediaInfo.bookmarkData.private;
        thumbnailElement.querySelector(".heart.private").hidden = !showBookmarkHeart || !mediaInfo.bookmarkData.private;
    }

    // Refresh all thumbs after the mute list changes.
    refreshAfterMuteChange()
    {
        for(let element of Object.values(this.thumbs))
            this.setupThumb(element);
    }

    getLoadedThumbs()
    {
        return Object.values(this.thumbs);
    }

    // Scroll to mediaId if it's available.  This is called when we display the thumbnail view
    // after coming from an illustration.
    scrollToMediaId(mediaId)
    {
        // Make sure this image has a thumbnail created if possible.
        this.refreshImages({ forcedMediaId: mediaId });

        let thumb = this.getThumbnailForMediaId(mediaId, { fallbackOnPage1: true });
        if(thumb == null)
            return false;

        // If we were displaying an image, pulse it to make it easier to find your place.
        this.pulseThumbnail(mediaId);

        // Stop if the thumb is already fully visible.
        if(thumb.offsetTop >= this.scrollContainer.scrollTop &&
            thumb.offsetTop + thumb.offsetHeight < this.scrollContainer.scrollTop + this.scrollContainer.offsetHeight)
            return true;

        let y = thumb.offsetTop + thumb.offsetHeight/2 - this.scrollContainer.offsetHeight/2;

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

