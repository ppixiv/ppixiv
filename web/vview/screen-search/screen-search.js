import Screen from '/vview/screen.js';
import DesktopSearchUI from '/vview/screen-search/search-ui-desktop.js';
import SearchUIMobile from '/vview/screen-search/search-ui-mobile.js';
import MobileMenuBar from '/vview/screen-search/mobile-menu-bar.js';
import ScrollListener from '/vview/actors/scroll-listener.js';
import LocalNavigationTreeWidget from '/vview/widgets/folder-tree.js';
import SearchView from '/vview/screen-search/search-view.js';
import LocalAPI from '/vview/misc/local-api.js';
import HoverWithDelay from '/vview/actors/hover-with-delay.js';
import { helpers, OpenWidgets } from '/vview/misc/helpers.js';

// The search UI.
export default class ScreenSearch extends Screen
{
    get screenType() { return "search"; }

    constructor(options)
    {
        super({...options, template: `
            <div inert class="screen screen-search-container">
                <!-- The tree widget for local navigation: -->
                <div class=local-navigation-box hidden></div>

                <vv-container class=search-mobile-ui></vv-container>

                <div class="search-results scroll-container">
                    <div class=search-desktop-ui hidden></div>

                    <vv-container class=thumbnail-container-box></vv-container>
                </div>

                <div class=mobile-navigation-bar-container></div>
            </div>
        `});

        ppixiv.userCache.addEventListener("usermodified", this.refreshUi, { signal: this.shutdownSignal });        
        
        this.searchView = new SearchView({
            container: this.root.querySelector(".thumbnail-container-box"),
        });

        // Add the top search UI if we're on desktop.
        if(!ppixiv.mobile)
        {
            let searchDesktopUiBox = this.root.querySelector(".search-desktop-ui");
            searchDesktopUiBox.hidden = false;

            this.desktopSearchUi = new DesktopSearchUI({
                container: searchDesktopUiBox,
            });

            // Add a slight delay before hiding the UI.  This allows opening the UI by swiping past the top
            // of the window, without it disappearing as soon as the mouse leaves the window.  This doesn't
            // affect opening the UI.
            new HoverWithDelay({ parent: this, element: searchDesktopUiBox, enterDelay: 0, exitDelay: 0.25 });
            
            // Set --ui-box-height to the container's height, which is used by the hover style.
            let resize = new ResizeObserver(() => {
                searchDesktopUiBox.style.setProperty('--ui-box-height', `${searchDesktopUiBox.offsetHeight}px`);
            }).observe(searchDesktopUiBox);
            this.shutdownSignal.addEventListener("abort", () => resize.disconnect());

            // The ui-on-hover class enables the hover style if it's enabled.
            let refreshUiOnHover = () => helpers.html.setClass(searchDesktopUiBox, "ui-on-hover",
                ppixiv.settings.get("ui-on-hover") && !ppixiv.mobile);
            ppixiv.settings.addEventListener("ui-on-hover", refreshUiOnHover, { signal: this.shutdownSignal });
            refreshUiOnHover();
        }

        if(ppixiv.mobile)
        {
            this.mobileSearchUi = new SearchUIMobile({
                container: this.root.querySelector(".search-mobile-ui"),
            });

            let navigationBarContainer = this.root.querySelector(".mobile-navigation-bar-container");
            this.mobileMenuBar = new MobileMenuBar({
                container: navigationBarContainer,
            });

            // Set the height on the nav bar and title for transitions to use.
            helpers.html.setSizeAsProperty(this.mobileSearchUi.root, {
                ...this._signal,
                heightProperty: "--title-height",
                target: this.root,
            });
            helpers.html.setSizeAsProperty(this.mobileMenuBar.root, {
                ...this._signal,
                heightProperty: "--nav-bar-height",
                target: this.root,
            });
    
            let scroller = this.querySelector(".search-results");
            this.scrollListener = new ScrollListener({
                scroller,
                parent: this,
                onchange: () => this._refreshMenuBarVisible(),
                stickyUiNode: this.mobileSearchUi.root,
            });

            OpenWidgets.singleton.addEventListener("changed", () => this._refreshMenuBarVisible(), this._signal);

            this._refreshMenuBarVisible();
        }

        // Zoom the thumbnails on ctrl-mousewheel:
        this.root.addEventListener("wheel", (e) => {
            if(!helpers.isCtrlPressed(e))
                return;
    
            e.preventDefault();
            e.stopImmediatePropagation();
    
            ppixiv.settings.adjustZoom("thumbnail-size", e.deltaY > 0);
        }, { passive: false });

        this.root.addEventListener("keydown", (e) => {
            let zoom = helpers.isZoomHotkey(e);
            if(zoom != null)
            {
                e.preventDefault();
                e.stopImmediatePropagation();

                ppixiv.settings.adjustZoom("thumbnail-size", zoom < 0);
            }
        });

        // If the local API is enabled and tags aren't restricted, set up the directory tree sidebar.
        //
        // We don't currently show the local navigation panel on mobile.  The UI isn't set up for
        // it, and it causes thumbnails to flicker while scrolling for some reason.
        if(LocalAPI.isEnabled() && !LocalAPI.localInfo.bookmark_tag_searches_only && !ppixiv.mobile)
        {
            let localNavigationBox = this.root.querySelector(".local-navigation-box");

            // False if the user has hidden the navigation tree.  Default to false on mobile, since
            // it takes up a lot of screen space.  Also default to false if we were initially opened
            // as a similar image search.
            this._localNavigationVisible = !ppixiv.mobile && ppixiv.plocation.pathname != "/similar";

            this._localNavigationTree = new LocalNavigationTreeWidget({
                container: localNavigationBox,
            });

            // Hack: if the local API isn't enabled, hide the local navigation box completely.  This shouldn't
            // be needed since it'll hide itself, but this prevents it from flashing onscreen and animating
            // away when the page loads.  That'll still happen if you have the local API enabled and you're on
            // a Pixiv page, but this avoids the visual glitch for most users.  I'm not sure how to fix this
            // cleanly.
            localNavigationBox.hidden = false;
        }
    }

    get active()
    {
        return this._active;
    }

    deactivate()
    {
        super.deactivate();
        if(!this._active)
            return;
        this._active = false;

        this.searchView.deactivate();
    }

    async activate()
    {
        super.activate();

        this._active = true;
        this.refreshUi();

        await this.searchView.activate();
    }

    // Return the media ID we'll try to scroll to if the given state is loaded.
    getTargetMediaId(args)
    {
        let scroll = args.state.scroll;
        let targetMediaId = scroll?.scrollPosition?.mediaId;
        return targetMediaId;
    }

    getRectForMediaId(mediaId)
    {
        return this.searchView.getRectForMediaId(mediaId);
    }
    
    setDataSource(dataSource, { targetMediaId })
    {
        // Remove listeners from the old data source.
        if(this.dataSource != null)
            this.dataSource.removeEventListener("updated", this.dataSourceUpdated);

        this.dataSource = dataSource;

        this.searchView.setDataSource(dataSource, { targetMediaId });
        if(this.desktopSearchUi)
            this.desktopSearchUi.setDataSource(dataSource);
        if(this.mobileSearchUi)
            this.mobileSearchUi.setDataSource(dataSource);

        if(this.dataSource == null)
        {
            this.refreshUi();
            return;
        }

        // Listen to the data source loading new pages, so we can refresh the list.
        this.dataSource.addEventListener("updated", this.dataSourceUpdated);
        this.refreshUi();
    };

    dataSourceUpdated = () =>
    {
        this.refreshUi();
    }

    refreshSearch()
    {
        ppixiv.app.setCurrentDataSource({ refresh: true, startAtBeginning: true });
    }

    refreshSearchFromPage()
    {
        ppixiv.app.setCurrentDataSource({ refresh: true, startAtBeginning: false });
    }
        
    refreshUi = () =>
    {
        if(this.desktopSearchUi)
            this.desktopSearchUi.refreshUi();
        if(this.mobileSearchUi)
            this.mobileSearchUi.refreshUi();
        if(this.mobileMenuBar)
            this.mobileMenuBar.refreshUi();

        this.dataSource.setPageIcon();

        if(this.active)
            helpers.setPageTitle(this.dataSource.pageTitle || "Loading...");
        
        // Refresh whether we're showing the local navigation widget and toggle button.
        helpers.html.setDataSet(this.root.dataset, "showNavigation", this.canShowLocalNavigation && this._localNavigationVisible);
    };

    _refreshMenuBarVisible()
    {
        // Hide the UI when scrolling down, and also hide the menu bar if a dialog is
        // open.  Do allow the menu bar to be opened while not active, so we set the
        // correct initial state.
        let shown = !this.scrollListener.scrolledForwards;
        this.mobileMenuBar.visible = shown && OpenWidgets.singleton.empty;
        this.mobileSearchUi.visible = shown;
    }

    get canShowLocalNavigation()
    {
        return this.dataSource?.isVView && !LocalAPI?.localInfo?.bookmark_tag_searches_only;
    }

    // Return the user ID we're viewing, or null if we're not viewing anything specific to a user.
    get viewingUserId()
    {
        if(this.dataSource == null)
            return null;
        return this.dataSource.viewingUserId;
    }

    // If the data source has an associated artist, return the "user:ID" for the user, so
    // when we navigate back to an earlier search, pulseThumbnail will know which user to
    // flash.
    get displayedMediaId()
    {
        if(this.dataSource == null)
            return super.displayedMediaId;

        let mediaId = this.dataSource.uiInfo.mediaId;
        if(mediaId != null)
            return mediaId;

        return super.displayedMediaId;
    }

    async handleKeydown(e)
    {
        if(e.repeat)
            return;

        if(this.dataSource.name == "vview" || this.dataSource.name == "vview-search")
        {
            // Pressing ^F while on the local search focuses the search box.
            if(e.code == "KeyF" && helpers.isCtrlPressed(e))
            {
                this.root.querySelector(".local-tag-search-box input").focus();
                e.preventDefault();
                e.stopPropagation();
            }

            // Pressing ^V while on the local search pastes into the search box.  We don't do
            // this for other searches since this is the only one I find myself wanting to do
            // often.
            if(e.code == "KeyV" && helpers.isCtrlPressed(e))
            {
                let text = await navigator.clipboard.readText();
                let input = this.root.querySelector(".local-tag-search-box input");
                input.value = text;
                LocalAPI.navigateToTagSearch(text, {addToHistory: false});
            }
        }
    }
}
