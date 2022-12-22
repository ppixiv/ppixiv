import Widget from 'vview/widgets/widget.js';
import Screen from 'vview/screen.js';
import DesktopSearchUI from 'vview/screen-search/desktop-search-ui.js';
import MobileSearchUI from 'vview/screen-search/mobile-search-ui.js';
import ScrollListener from 'vview/actors/scroll-listener.js';
import LocalNavigationTreeWidget from 'vview/widgets/folder-tree.js';
import SearchView from 'vview/screen-search/search-view.js';
import DialogWidget from 'vview/widgets/dialog.js';
import LocalAPI from 'vview/misc/local-api.js';
import { HoverWithDelay } from 'vview/misc/helpers.js';
import { helpers } from 'vview/misc/helpers.js';

// The search UI.
export default class ScreenSearch extends Screen
{
    constructor(options)
    {
        super({...options, template: `
            <div inert class="screen screen-search-container">
                <!-- The tree widget for local navigation: -->
                <div class=local-navigation-box hidden></div>

                <vv-container class=title-bar-container></vv-container>

                <div class="search-results scroll-container">
                    <div class=top-ui-box hidden></div>

                    <vv-container class=thumbnail-container-box></vv-container>
                </div>

                <div class=mobile-navigation-bar-container></div>
            </div>
        `});

        ppixiv.userCache.addEventListener("usermodified", this.refreshUi, { signal: this.shutdown_signal.signal });        
        
        // Add the top search UI if we're on desktop.
        if(!ppixiv.mobile)
        {
            let topUiBox = this.container.querySelector(".top-ui-box");
            topUiBox.hidden = false;

            this.desktopSearchUi = new DesktopSearchUI({
                container: topUiBox,
            });

            // Add a slight delay before hiding the UI.  This allows opening the UI by swiping past the top
            // of the window, without it disappearing as soon as the mouse leaves the window.  This doesn't
            // affect opening the UI.
            new HoverWithDelay(topUiBox, 0, 0.25);
            
            // Set --ui-box-height to the container's height, which is used by the hover style.
            let resize = new ResizeObserver(() => {
                topUiBox.style.setProperty('--ui-box-height', `${topUiBox.offsetHeight}px`);
            }).observe(topUiBox);
            this.shutdown_signal.signal.addEventListener("abort", () => resize.disconnect());

            // The ui-on-hover class enables the hover style if it's enabled.
            let refreshUiOnHover = () => helpers.set_class(topUiBox, "ui-on-hover", ppixiv.settings.get("ui-on-hover") && !ppixiv.mobile);
            ppixiv.settings.addEventListener("ui-on-hover", refreshUiOnHover, { signal: this.shutdown_signal.signal });
            refreshUiOnHover();
        }

        if(ppixiv.mobile)
        {
            this.titleBarWidget = new class extends Widget {
                constructor({...options}={})
                {
                    super({
                        ...options,
                        template: `
                            <div class=title-bar>
                                <div class=title-stretch>
                                    <div class=title></div>
                                </div>
                                <div class=data-source-ui></div>
                            </div>
                        `
                    });
                }

                apply_visibility()
                {
                    helpers.set_class(this.container, "shown", this._visible);
                }
            }({
                container: this.container.querySelector(".title-bar-container"),
            });

            let navigationBarContainer = this.container.querySelector(".mobile-navigation-bar-container");
            this.thumbnailUiMobile = new MobileSearchUI({
                container: navigationBarContainer,
            });

            // Set the height on the nav bar and title for transitions to use.
            helpers.set_height_as_property(this.querySelector(".title-bar"), "--title-height", {
                ...this._signal,
                target: this.container,
            });
            helpers.set_height_as_property(this.thumbnailUiMobile.container, "--nav-bar-height", {
                ...this._signal,
                target: this.container,
            });
    
            let onchange = () =>
            {
                let shown = !this.scroll_listener.scrolled_forwards;
                this.thumbnailUiMobile.visible = shown;
                this.titleBarWidget.visible = shown;
            };
            
            let scroller = this.querySelector(".search-results");
            this.scroll_listener = new ScrollListener({
                scroller,
                parent: this,
                onchange,
                sticky_ui_node: this.querySelector(".title-bar"),
            });
            onchange();
        }

        ppixiv.muting.addEventListener("mutes-changed", this.refreshUiForUserId);

        // Zoom the thumbnails on ctrl-mousewheel:
        this.container.addEventListener("wheel", (e) => {
            if(!e.ctrlKey)
                return;
    
            e.preventDefault();
            e.stopImmediatePropagation();
    
            let manga_view = this.dataSource?.name == "manga";
            ppixiv.settings.adjust_zoom(manga_view? "manga-thumbnail-size":"thumbnail-size", e.deltaY > 0);
        }, { passive: false });

        this.container.addEventListener("keydown", (e) => {
            let zoom = helpers.is_zoom_hotkey(e);
            if(zoom != null)
            {
                e.preventDefault();
                e.stopImmediatePropagation();

                let manga_view = this.dataSource?.name == "manga";
                ppixiv.settings.adjust_zoom(manga_view? "manga-thumbnail-size":"thumbnail-size", zoom < 0);
            }
        });

        // If the local API is enabled and tags aren't restricted, set up the directory tree sidebar.
        //
        // We don't currently show the local navigation panel on mobile.  The UI isn't set up for
        // it, and it causes thumbnails to flicker while scrolling for some reason.
        if(LocalAPI.is_enabled() && !LocalAPI.local_info.bookmark_tag_searches_only && !ppixiv.mobile)
        {
            let local_navigation_box = this.container.querySelector(".local-navigation-box");

            // False if the user has hidden the navigation tree.  Default to false on mobile, since
            // it takes up a lot of screen space.  Also default to false if we were initially opened
            // as a similar image search.
            this.local_navigation_visible = !ppixiv.mobile && ppixiv.plocation.pathname != "/similar";

            this.local_nav_widget = new LocalNavigationTreeWidget({
                container: local_navigation_box,
            });

            // Hack: if the local API isn't enabled, hide the local navigation box completely.  This shouldn't
            // be needed since it'll hide itself, but this prevents it from flashing onscreen and animating
            // away when the page loads.  That'll still happen if you have the local API enabled and you're on
            // a Pixiv page, but this avoids the visual glitch for most users.  I'm not sure how to fix this
            // cleanly.
            local_navigation_box.hidden = false;
        }

        this.search_view = new SearchView({
            container: this.container.querySelector(".thumbnail-container-box"),
        });
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

        this.search_view.deactivate();
    }

    async activate({ oldMediaId })
    {
        if(oldMediaId)
            console.log("Showing search, came from media ID:", oldMediaId);

        super.activate();

        this._active = true;
        this.refreshUi();

        await this.search_view.activate({ oldMediaId });
    }

    scrollToMediaId(mediaId)
    {
        this.search_view.scrollToMediaId(mediaId);
    }

    getRectForMediaId(mediaId)
    {
        return this.search_view.getRectForMediaId(mediaId);
    }
    
    setDataSource(data_source)
    {
        if(this.dataSource == data_source)
            return;

        // Remove listeners from the old data source.
        if(this.dataSource != null)
            this.dataSource.removeEventListener("updated", this.dataSourceUpdated);

        this.dataSource = data_source;

        this.search_view.setDataSource(data_source);
        if(this.desktopSearchUi)
            this.desktopSearchUi.setDataSource(data_source);

        if(this.current_data_source_ui)
        {
            this.current_data_source_ui.shutdown();
            this.current_data_source_ui = null;
        }
    
        if(this.dataSource == null)
        {
            this.refreshUi();
            return;
        }

        if(ppixiv.mobile)
        {
            if(this.dataSource.ui)
            {
                let data_source_ui_container = this.container.querySelector(".title-bar .data-source-ui");
                this.current_data_source_ui = new this.dataSource.ui({
                    dataSource: this.dataSource,
                    container: data_source_ui_container,
                });
            }
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
        ppixiv.app.refreshCurrentDataSource({removeSearchPage: true});
    }

    refreshSearchFromPage()
    {
        ppixiv.app.refreshCurrentDataSource({removeSearchPage: false});
    }
        
    refreshUi = () =>
    {
        // Update the title even if we're not active, so it's up to date for transitions.
        if(this.titleBarWidget)
        {
            if(this.dataSource?.getDisplayingText != null)
            {
                let text = this.dataSource?.getDisplayingText();
                this.titleBarWidget.container.querySelector(".title").replaceChildren(text);
            }
        }

        if(!this.active)
            return;

        if(this.desktopSearchUi)
            this.desktopSearchUi.refreshUi();
        if(this.thumbnailUiMobile)
            this.thumbnailUiMobile.refreshUi();

        this.dataSource.setPageIcon();
        helpers.set_page_title(this.dataSource.pageTitle || "Loading...");
        
        // Refresh whether we're showing the local navigation widget and toggle button.
        helpers.set_dataset(this.container.dataset, "showNavigation", this.can_show_local_navigation && this.local_navigation_visible);

        this.refreshUiForUserId();
    };

    refreshUiForUserId()
    {
        if(this.desktopSearchUi == null)
            return;

        this.desktopSearchUi.userInfoLinks.setUserIdAndDataSource({userId: this.viewingUserId, dataSource: this.dataSource});
    }
    
    get can_show_local_navigation()
    {
        return this.dataSource?.is_vview && !LocalAPI?.local_info?.bookmark_tag_searches_only;
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

        let user_id = this.dataSource.viewingUserId;
        if(user_id != null)
            return "user:" + user_id;

        let folder_id = this.dataSource.viewingFolder;
        if(folder_id != null)
            return folder_id;
    
        return super.displayedMediaId;
    }

    async handleKeydown(e)
    {
        if(e.repeat)
            return;

        if(this.dataSource.name == "vview")
        {
            // Pressing ^F while on the local search focuses the search box.
            if(e.code == "KeyF" && e.ctrlKey)
            {
                this.container.querySelector(".local-tag-search-box input").focus();
                e.preventDefault();
                e.stopPropagation();
            }

            // Pressing ^V while on the local search pastes into the search box.  We don't do
            // this for other searches since this is the only one I find myself wanting to do
            // often.
            if(e.code == "KeyV" && e.ctrlKey)
            {
                let text = await navigator.clipboard.readText();
                let input = this.container.querySelector(".local-tag-search-box input");
                input.value = text;
                LocalAPI.navigate_to_tag_search(text, {add_to_history: false});
            }
        }
    }
}
