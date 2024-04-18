// The main controller for viewing images.
//
// This handles creating and navigating between viewers.

import Screen from '/vview/screen.js';

import DesktopImageInfo from '/vview/screen-illust/desktop-image-info.js';

import MobileImageChanger from '/vview/screen-illust/mobile-image-changer.js';
import MobileImageDismiss from '/vview/screen-illust/mobile-image-dismiss.js';
import MobileUI from '/vview/screen-illust/mobile-ui.js';

import DesktopViewerImages from '/vview/viewer/images/desktop-viewer-images.js';
import MobileViewerImages from '/vview/viewer/images/mobile-viewer-images.js';

import ViewerVideo from '/vview/viewer/video/viewer-video.js';
import ViewerUgoira from '/vview/viewer/video/viewer-ugoira.js';
import ViewerError from '/vview/viewer/viewer-error.js';

import ImagePreloader from '/vview/misc/image-preloader.js';
import IsolatedTapHandler from '/vview/actors/isolated-tap-handler.js';
import LocalAPI from '/vview/misc/local-api.js';
import { HideMouseCursorOnIdle } from '/vview/misc/hide-mouse-cursor-on-idle.js';
import { helpers } from '/vview/misc/helpers.js';

// The main UI.  This handles creating the viewers and the global UI.
export default class ScreenIllust extends Screen
{
    get screenType() { return "illust"; }

    constructor(options)
    {
        super({...options, template: `
            <div inert class="screen screen-illust-container">
                <!-- This holds our views: the current view, and the neighbor view if we're transitioning
                     between them. -->
                <div class="view-container mouse-hidden-box" data-context-menu-target></div>

                <div class=manga-page-indicator>
                    <div class=bar></div>
                </div>

                <div class=page-change-indicator data-icon=last-image>
                    <ppixiv-inline src="resources/last-page.svg"></ppixiv-inline>
                </div>

                <!-- The top-left hover UI is inserted here. -->
                <div class=ui>
                </div>

                <!-- This is displayed while loading translations for the current image. -->
                <div class=translation-status>
                    <div class=translation-contents>${ helpers.createIcon("mat:translate") }</div>
                </div>

                <div class=fade-search></div>
            </div>
        `});
        
        this.currentMediaId = null;
        this.latestNavigationDirectionDown = true;

        // Create a UI box and put it in its container.
        let uiContainer = this.root.querySelector(".ui");
        if(!ppixiv.mobile)
            this.desktopUi = new DesktopImageInfo({ container: uiContainer });
        
        // Make sure the hover UI isn't shown on mobile.
        if(ppixiv.mobile)
            uiContainer.hidden = true;

        ppixiv.userCache.addEventListener("usermodified", this.refreshUi, { signal: this.shutdownSignal });        
        ppixiv.mediaCache.addEventListener("mediamodified", this.refreshUi, { signal: this.shutdownSignal });
        ppixiv.settings.addEventListener("recent-bookmark-tags", this.refreshUi, { signal: this.shutdownSignal });

        this.viewContainer = this.root.querySelector(".view-container");

        // Remove the "flash" class when the page change indicator's animation finishes.
        let pageChangeIndicator = this.root.querySelector(".page-change-indicator");
        pageChangeIndicator.addEventListener("animationend", (e) => {
            pageChangeIndicator.classList.remove("flash");
        });

        this.mangaPageIndicator = this.root.querySelector(".manga-page-indicator");

        // Desktop UI:
        if(!ppixiv.mobile)
        {
            // Fullscreen on double-click.
            this.viewContainer.addEventListener("dblclick", () => {
                helpers.toggleFullscreen();
            });

            new HideMouseCursorOnIdle(this.root.querySelector(".mouse-hidden-box"));

            this.root.addEventListener("wheel", this.onwheel, { passive: false });
        }

        // Mobile UI:
        if(ppixiv.mobile)
        {
            // Create this before mobileIllustUi so its drag handler is registered first.
            // This makes image change drags take priority over opening the menu.
            this.mobileImageChanger = new MobileImageChanger({ parent: this });

            this.mobileIllustUi = new MobileUI({
                container: this.root,
                transitionTarget: this.root,
            });

            // Toggle zoom on double-tap.
            this.root.addEventListener("dblclick", (e) => this.viewer.toggleZoom(e), this._signal);

            new IsolatedTapHandler({
                parent: this,
                node: this.viewContainer,
                callback: (e) => {
                    // Show or hide the menu on isolated taps.  Note that most of the time, hiding
                    // will happen in mobileIllustUi's oncancelled handler, when a press triggers
                    // another scroller (usually TouchScroller).  But, we also handle it here as a
                    // fallback in case that doesn't happen, such as if we're on a video.
                    this.mobileIllustUi.toggle();
                },
            });
        }

        // This handles transitioning between this and the search view.
        this.mobileImageDismiss = new MobileImageDismiss({ parent: this });

        this.deactivate();
    }

    setDataSource(dataSource)
    {
        if(dataSource == this.dataSource)
            return;

        if(this.dataSource != null)
        {
            this.dataSource.removeEventListener("updated", this.dataSourceUpdated);
            this.dataSource = null;
        }

        this.dataSource = dataSource;
        if(this.desktopUi)
            this.desktopUi.dataSource = dataSource;

        if(this.dataSource != null)
        {
            this.dataSource.addEventListener("updated", this.dataSourceUpdated);
            this.refreshUi();
        }
    }

    async activate({ mediaId, restoreHistory, cause })
    {
        let wasActive = this._active;
        this._active = true;

        super.activate();

        // If we have a viewer, tell it if we're active.
        if(this.viewer != null)
            this.viewer.active = true;

        // If we have a drag handler for mobile, cancel any drag or animation in progress
        // if the image changes externally or if we're deactivated.
        if(this.mobileImageChanger)
            this.mobileImageChanger.stop();

        await this.showImage(mediaId, { restoreHistory, initial: !wasActive });

        // Tell the dragger to transition us in.
        if(this.mobileImageDismiss)
            this.mobileImageDismiss.activate({ cause });
    }

    deactivate()
    {
        super.deactivate();
        this._active = false;

        // If we have a viewer, tell it if we're active.
        if(this.viewer != null)
            this.viewer.active = false;

        // If we have a drag handler for mobile, cancel any drag or animation in progress
        // if the image changes externally or if we're deactivated.
        if(this.mobileImageChanger)
            this.mobileImageChanger.stop();

        this.cancelAsyncNavigation();

        if(this.mobileIllustUi)
        {
            this.mobileIllustUi.mediaId = null;
            this.mobileIllustUi.setDataSource(null);
        }

        // Tell the dragger to transition us out.
        if(this.mobileImageDismiss)
            this.mobileImageDismiss.deactivate();

        this.cleanupImage();
        
        // We leave editing on when navigating between images, but turn it off when we exit to
        // the search.
        ppixiv.settings.set("image_editing_mode", null);
    }

    // Remove the viewer if we no longer want to be displaying it.
    cleanupImage()
    {
        if(this._active)
            return;

        // Don't remove the viewer if it's still being shown in the exit animation.
        if(this.mobileImageDismiss?.isAnimating)
            return;

        this.removeViewer();

        this._wantedMediaId = null;
        this.currentMediaId = null;

        this.refreshUi();

        // Tell the preloader that we're not displaying an image anymore.  This prevents the next
        // image displayed from triggering speculative loading, which we don't want to do when
        // clicking an image in the thumbnail view.
        ImagePreloader.singleton.setCurrentImage(null);
        ImagePreloader.singleton.setSpeculativeImage(null);

        // If remote quick view is active, cancel it if we leave the image.
        if(ppixiv.settings.get("linked_tabs_enabled"))
        {
            ppixiv.sendImage.sendMessage({
                message: "send-image",
                action: "cancel",
                to: ppixiv.settings.get("linked_tabs", []),
            });
        }
    }

    // Create a viewer for mediaId and begin loading it asynchronously.
    createViewer({ mediaId, earlyIllustData, ...options }={})
    {
        let viewerClass;

        let isMuted = earlyIllustData && this.shouldHideMutedImage(earlyIllustData).isMuted;
        let isError = earlyIllustData == null;
        if(isMuted)
        {
            viewerClass = ViewerError;
        }
        else if(isError)
        {
            viewerClass = ViewerError;
            let error = ppixiv.mediaCache.getMediaLoadError(mediaId);
            error ??= "Unknown error";
            options = { ...options, error };
        }
        else if(earlyIllustData.illustType == 2)
            viewerClass = ViewerUgoira;
        else if(earlyIllustData.illustType == "video")
            viewerClass = ViewerVideo;
        else
            viewerClass = ppixiv.mobile? MobileViewerImages:DesktopViewerImages;

        let newViewer = new viewerClass({
            mediaId,
            container: this.viewContainer,
            slideshow: helpers.args.location.hash.get("slideshow"),
            
            waitForTransitions: () => {
                return this.mobileImageDismiss?.waitForAnimationsPromise;
            },

            onnextimage: async (finishedViewer) => {
                if(!this._active)
                    return { };

                // Ignore this if this isn't the active viewer.  This can happen if we advance a slideshow
                // right as the user navigated to a different image, especially with mobile transitions.
                if(finishedViewer != this.viewer)
                {
                    console.log("onnextimage from viewer that isn't active");
                    return { };
                }                

                // The viewer wants to go to the next image, normally during slideshows.
                let manga = ppixiv.settings.get("slideshow_skips_manga")? "skip-to-first":"normal";
                return await this.navigateToNext(1, { flashAtEnd: false, manga });
            },
            ...options,
        });
        
        newViewer.load();

        return newViewer;
    }

    // Show a media ID.
    async showImage(mediaId, { restoreHistory=false, initial=false }={})
    {
        console.assert(mediaId != null);

        // If we previously set a pending navigation, this navigation overrides it.
        this.cancelAsyncNavigation();

        // Remember that this is the image we want to be displaying.  Do this before going
        // async, so everything knows what we're trying to display immediately.
        this._wantedMediaId = mediaId;

        if(await this.loadFirstImage(mediaId))
            return;

        // Get very basic illust info.  This is enough to tell which viewer to use, how
        // many pages it has, and whether it's muted.  This will always complete immediately
        // if we're coming from a search or anywhere else that will already have this info,
        // but it can block if we're loading from scratch.
        let earlyIllustData = await ppixiv.mediaCache.getMediaInfo(mediaId, { full: false });

        // If we were deactivated while waiting for image info or the image we want to show has changed, stop.
        if(!this.active || this._wantedMediaId != mediaId)
        {
            console.log("showImage: illust ID or page changed while async, stopping");
            return;
        }

        // Make sure the dragger isn't active, since changing main viewers while a drag is active
        // would cause confusing behavior.
        if(this.mobileImageChanger)
            this.mobileImageChanger.stop();

        // If we weren't given a viewer to use, create one.
        let newViewer = this.createViewer({
            earlyIllustData,
            mediaId,
            restoreHistory,
        });

        this.showImageViewer({ newViewer, initial });
    }

    // Show a viewer.
    //
    // If initial is first, this is the first image we're displaying after becoming visible,
    // usually from clicking a search result.  If it's false, we were already active and are
    // just changing images.
    showImageViewer({ newViewer=null, initial=false }={})
    {
        if(newViewer == this.viewer)
            return;

        helpers.html.setClass(document.body,  "force-ui", window.debugShowUi);

        let mediaId = newViewer.mediaId;

        // Dismiss any message when changing images.
        if(this.currentMediaId != mediaId)
            ppixiv.message.hide();

        this._wantedMediaId = mediaId;
        this.currentMediaId = mediaId;

        // This should always be available, because the caller always looks up media info
        // in order to create the viewer, which means we don't have to go async here.  If
        // this returns null, it should always mean we're viewing an image's error page.
        let earlyIllustData = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(this.active)
            helpers.setTitleAndIcon(earlyIllustData);

        // If the image has the ドット絵 tag, enable nearest neighbor filtering.
        helpers.html.setClass(document.body, "dot", helpers.pixiv.tagsContainDot(earlyIllustData?.tagList));

        // Update the manga page indicator.
        this.showCurrentPage();
        
        // If linked tabs are active, send this image.
        if(ppixiv.settings.get("linked_tabs_enabled"))
            ppixiv.sendImage.send_image(mediaId, ppixiv.settings.get("linked_tabs", []), "temp-view");

        // If this is a local image, refresh each view so we'll see changes quickly.  This is async,
        // so in the usual case where nothing changes it doesn't cause a delay.  Don't do this for
        // Pixiv images.
        if(helpers.mediaId.isLocal(mediaId))
            ppixiv.mediaCache.refreshMediaInfo(mediaId);

        // Tell the preloader about the current image.
        ImagePreloader.singleton.setCurrentImage(mediaId);

        // Speculatively load the next image, which is what we'll show if you press page down, so
        // advancing through images is smoother.
        //
        // If we're not local, don't do this when showing the first image, since the most common
        // case is simply viewing a single image and then backing out to the search, so this avoids
        // doing extra loads every time you load a single illustration.
        if(!initial || helpers.mediaId.isLocal(mediaId))
        {
            // getNavigation may block to load more search results.  Run this async without
            // waiting for it.
            (async() => {
                let newMediaId = await this.getNavigation(this.latestNavigationDirectionDown);

                // Let ImagePreloader handle speculative loading.  If newMediaId is null,
                // we're telling it that we don't need to load anything.
                ImagePreloader.singleton.setSpeculativeImage(newMediaId);
            })();
        }

        this.refreshUi();

        // If we're not animating so we know the search page isn't visible, try to scroll the
        // search page to the image we're viewing, so it's ready if we start a transition to it.
        if(this.mobileImageDismiss)
            this.mobileImageDismiss.scrollSearchToThumbnail();

        // If we already have an old viewer, then we loaded an image, and then navigated again before
        // the new image was displayed.  Discard the new image and keep the old one, since it's what's
        // being displayed.
        if(this.oldViewer && this.viewer)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }
        else
            this.oldViewer = this.viewer;

        this.viewer = newViewer;

        let oldViewer = this.oldViewer;

        // If we already had a viewer, hide the new one until the new one is ready to be displayed.
        // We'll make it visible below at the same time the old viewer is removed, so we don't show
        // both at the same time.
        if(this.oldViewer)
            this.viewer.visible = false;

        this.viewer.ready.finally(() => {
            // The new viewer is displaying an image, so we can remove the old viewer now.
            //
            // If this isn't the main viewer anymore, another one was created and replaced this one
            // (the old viewer check above), so don't do anything.
            if(this.viewer !== newViewer || oldViewer !== this.oldViewer)
                return;

            this.viewer.visible = true;
            if(this.oldViewer)
            {
                this.oldViewer.shutdown();
                this.oldViewer = null;
            }
        });

        this.viewer.active = this._active;

        // Refresh the UI now that we have a new viewer.
        this.refreshUi();
    }

    // Take the current viewer out of the screen.  It'll still be active and in the document.
    // This is used by DragImageChanger to change the current viewer into a preview viewer.
    takeViewer()
    {
        let viewer = this.viewer;
        this.viewer = null;
        return viewer;
    }

    // If we're loading "*", it's a placeholder saying to view the first search result.
    // This allows viewing shuffled results.  This can be a Pixiv illust ID of *, or
    // a local ID with a filename of *.  Load the initial data source page if it's not
    // already loaded, and navigate to the first result.
    async loadFirstImage(mediaId)
    {
        if(helpers.mediaId.isLocal(mediaId))
        {
            let args = helpers.args.location;
            LocalAPI.getArgsForId(mediaId, args);
            if(args.hash.get("file") != "*")
                return false;
        }
        else if(helpers.mediaId.parse(mediaId).id != "*")
            return false;

        // This will load results if needed, skip folders so we only pick images, and return
        // the first ID.
        let newMediaId = await this.dataSource.getOrLoadNeighboringMediaId(null, true);
        if(newMediaId == null)
        {
            ppixiv.message.show("Couldn't find an image to view");
            return true;
        }

        ppixiv.app.showMediaId(newMediaId, {
            addToHistory: false,
        });
        return true;
    }

    // Return true if we're allowing a muted image to be displayed, because the user
    // clicked to override it in the mute view.
    get viewMuted()
    {
        return helpers.args.location.hash.get("view-muted") == "1";
    }

    shouldHideMutedImage(earlyIllustData)
    {
        let mutedTag = ppixiv.muting.anyTagMuted(earlyIllustData.tagList);
        let mutedUser = ppixiv.muting.isUserIdMuted(earlyIllustData.userId);
        if(this.viewMuted || (!mutedTag && !mutedUser))
            return { isMuted: false };

        return { isMuted: true, mutedTag, mutedUser };
    }
    
    // Remove the old viewer, if any.
    removeViewer()
    {
        if(this.viewer != null)
        {
            this.viewer.shutdown();
            this.viewer = null;
        }

        if(this.oldViewer != null)
        {
            this.oldViewer.shutdown();
            this.oldViewer = null;
        }
    }

    // If we started navigating to a new image and were delayed to load data (either to load
    // the image or to load a new page), cancel it and stay where we are.
    cancelAsyncNavigation()
    {
        // If we previously set a pending navigation, this navigation overrides it.
        if(this.pendingNavigation == null)
            return;

        console.info("Cancelling async navigation");
        this.pendingNavigation = null;
    }

    dataSourceUpdated = () =>
    {
        this.refreshUi();
    }

    get active()
    {
        return this._active;
    }

    // Refresh the UI for the current image.
    refreshUi = (e) =>
    {
        // Don't refresh if the thumbnail view is active.  We're not visible, and we'll just
        // step over its page title, etc.
        if(!this._active)
            return;
        
        // Tell the UI which page is being viewed.
        if(this.desktopUi)
            this.desktopUi.mediaId = this.currentMediaId;

        if(this.mobileIllustUi)
        {
            this.mobileIllustUi.mediaId = this.currentMediaId;
            this.mobileIllustUi.setDataSource(this.dataSource);
        }

        if(this.desktopUi)
            this.desktopUi.refresh();
    }

    onwheel = (e) =>
    {
        if(!this._active)
            return;        

        let down = e.deltaY > 0;
        this.navigateToNext(down, { manga: e.shiftKey? "skip-to-first":"normal" });
    }

    get displayedMediaId()
    {
        return this._wantedMediaId;
    }

    handleKeydown(e)
    {
        // Let the viewer handle the input first.
        if(this.viewer && this.viewer.onkeydown)
        {
            this.viewer.onkeydown(e);
            if(e.defaultPrevented)
                return;
        }

        if(this.desktopUi)
            this.desktopUi.handleKeydown(e);
        if(e.defaultPrevented)
            return;
        
        if(e.ctrlKey || e.altKey || e.metaKey)
            return;
        switch(e.key)
        {
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
            e.preventDefault();
            e.stopPropagation();

            this.navigateToNext(false, { manga: e.shiftKey? "skip-to-first":"normal" });
            break;

        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
            e.preventDefault();
            e.stopPropagation();

            this.navigateToNext(true, { manga: e.shiftKey? "skip-to-first":"normal" });
            break;
        }
    }

    // Get the media ID and page navigating down (or up) will go to.
    //
    // This may trigger loading the next page of search results, if we've reached the end.
    async getNavigation(down, { navigateFromMediaId=null, manga="normal", loop=false }={})
    {
        // Check if we're just changing pages within the same manga post.
        // If we have a target media ID, move relative to it.  Otherwise, move relative to the
        // displayed image.  This way, if we navigate repeatedly before a previous navigation
        // finishes, we'll keep moving rather than waiting for each navigation to complete.
        navigateFromMediaId ??= this._wantedMediaId;
        navigateFromMediaId ??= this.currentMediaId;

        // Get the next (or previous) illustration after the current one.
        if(!loop)
            return await this.dataSource.getOrLoadNeighboringMediaId(navigateFromMediaId, down, { manga });

        let mediaId = await this.dataSource.getOrLoadNeighboringMediaIdWithLoop(navigateFromMediaId, down, { manga });

        // If we only have one image, don't loop.  We won't actually navigate so things
        // don't quite work, since navigating to the same media ID won't trigger a navigation.
        if(mediaId == navigateFromMediaId)
        {
            console.log("Not looping since we only have one media ID");
            return null;
        }

        return mediaId;
    }

    // Navigate to the next or previous image.
    //
    // manga is a manga skip mode.  See IllustIdList.getNeighboringMediaId.
    async navigateToNext(down, { manga="normal", flashAtEnd=true }={})
    {
        // Loop if we're in slideshow mode, otherwise stop when we reach the end.
        let loop = helpers.args.location.hash.get("slideshow") != null;

        // If we're viewing an error page, always skip manga pages.
        if(manga == "normal" && this.viewer instanceof ViewerError)
            manga = "skip-past";

        // Remember whether we're navigating forwards or backwards, for preloading.
        this.latestNavigationDirectionDown = down;

        this.cancelAsyncNavigation();

        let pendingNavigation = this.pendingNavigation = new Object();

        // See if we should change the manga page.  This may block if it needs to load
        // the next page of search results.
        let newMediaId = await this.getNavigation(down, { manga, loop });
    
        // If we didn't get a page, we're at the end of the search results.  Flash the
        // indicator to show we've reached the end and stop.
        if(newMediaId == null)
        {
            console.log("Reached the end of the list");
            if(flashAtEnd)
                this.flashEndIndicator(down, "last-image");
            return { reachedEnd: true };
        }

        // If this.pendingNavigation is no longer the same as pendingNavigation, we navigated since
        // we requested this load and this navigation is stale, so stop.
        if(this.pendingNavigation != pendingNavigation)
        {
            console.error("Aborting stale navigation");
            return { stale: true };
        }

        this.pendingNavigation = null;

        // Go to the new illustration.
        ppixiv.app.showMediaId(newMediaId);
        return { mediaId: newMediaId };
    }

    flashEndIndicator(down, icon)
    {
        let indicator = this.root.querySelector(".page-change-indicator");
        indicator.dataset.icon = icon;
        indicator.dataset.side = down? "right":"left";
        indicator.classList.remove("flash");

        // Call getAnimations() so the animation is removed immediately:
        indicator.getAnimations();

        indicator.classList.add("flash");
    }

    // If enabled and the current media is a manga post, flash the manga page indicator.
    async showCurrentPage()
    {
        if(!ppixiv.settings.get("manga_page_indicator"))
            return;

        // Don't flash the manga page in slideshows.
        if(helpers.args.location.hash.get("slideshow"))
            return;

        if(this._lastShownMangaPageId == this.currentMediaId)
            return;
        this._lastShownMangaPageId = this.currentMediaId;

        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(this.currentMediaId, { full: false });

        let ourSentinel = this._hideCurrentPageSentinel = new Object();
        if(this._hideCurrentPageTimer !== null)
            realClearTimeout(this._hideCurrentPageTimer);

        // If this is a manga page, show the page display.  If not, continue and hide
        // the display immediately if it's visible.
        if(mediaInfo != null && mediaInfo.pageCount >= 2)
        {
            let pageCount = mediaInfo.pageCount;
            let [_, page] = helpers.mediaId.toIllustIdAndPage(this.currentMediaId);
            let percent = Math.round(helpers.math.scale(page, 0, pageCount-1, 0, 100));
            this.mangaPageIndicator.style.setProperty("--percent", `${percent}%`);

            if(this._mangaPageIndicatorAnimation)
            {
                this._mangaPageIndicatorAnimation.cancel();
                this._mangaPageIndicatorAnimation = null;
            }
    
            this.mangaPageIndicator.style.opacity = 1;

            // Sleep briefly before hiding it.
            await helpers.other.sleep(250);
        }

        // Stop if another call to showCurrentPage took over the animation.
        if(ourSentinel != this._hideCurrentPageSentinel)
            return;

        this._mangaPageIndicatorAnimation = this.mangaPageIndicator.animate([
            { opacity: 0 }
        ], {
            duration: 150,
            easing: 'ease-in',
            fill: 'forwards',
        });

        try {
            await this._mangaPageIndicatorAnimation.finished;
        }
        catch {
            return;
        }

        if(ourSentinel != this._hideCurrentPageSentinel)
            return;

        this._mangaPageIndicatorAnimation.commitStyles();
        this._mangaPageIndicatorAnimation.cancel();
        this._mangaPageIndicatorAnimation = null;
    }
}
