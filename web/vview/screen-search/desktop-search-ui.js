// The main desktop search UI.

import Widget from 'vview/widgets/widget.js';
import { AvatarWidget } from 'vview/widgets/user-widgets.js';
import { SettingsDialog } from 'vview/widgets/settings-widgets.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import UserInfoLinks from 'vview/screen-search/user-info-links.js';
import CreateSearchMenu from 'vview/screen-search/search-menu.js';
import LocalAPI from 'vview/misc/local-api.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DesktopSearchUI extends Widget
{
    constructor(options)
    {
        super({
            ...options,
            template: `
            <div class=thumbnail-ui-box data-context-menu-target=off>
                <!-- The images for the artist view (avatar) and related images, which shows the starting image. -->
                <div class=avatar-container></div>

                <a href=# class=image-for-suggestions>
                    <!-- A blank image, so we don't load anything: -->
                    <img src="${helpers.blankImage}">
                </a>

                <div class=title-with-button-row-container>
                    <div class=title-with-button-row>
                        <div class="displaying title-font"></div>
                        <div style="flex: 1;"></div>
                        <!-- Links at the top left when viewing a user will be inserted here. -->
                        <div class=user-links></div>
                    </div>
                </div>

                <div class=button-row style="margin-bottom: 0.5em;">
                    <div class="icon-button toggle-local-navigation-button popup" data-popup="Show navigation" hidden>
                        ${ helpers.createIcon("mat:keyboard_double_arrow_left") }
                    </div>

                    <a class="icon-button disable-ui-button popup pixiv-only" data-popup="Return to Pixiv" href="#no-ppixiv">
                        ${ helpers.createIcon("ppixiv:pixiv") }
                    </a>

                    <!-- These login/logout buttons are only used by the local API. -->
                    <div class="login-button icon-button popup" data-popup="Login" hidden>
                        ${ helpers.createIcon("login") }
                    </div>

                    <div class="logout-button icon-button popup" data-popup="Logout" hidden>
                        ${ helpers.createIcon("logout") }
                    </div>

                    <div class="main-search-menu-button icon-button popup pixiv-only" data-popup="Search">
                        ${ helpers.createIcon("menu") }
                    </div>

                    <div class="refresh-search-button icon-button popup" data-popup="Refresh">
                        ${ helpers.createIcon("refresh") }
                    </div>

                    <div class="refresh-search-from-page-button icon-button popup" data-popup="Refresh from page">
                        ${ helpers.createIcon("restart_alt") }
                    </div>

                    <div class="expand-manga-posts icon-button popup">
                        ${ helpers.createIcon("") /* filled in by refreshExpandMangaPostsButton */ }
                    </div>

                    <a class="slideshow icon-button popup" data-popup="Slideshow" href="#">
                        ${ helpers.createIcon("wallpaper") }
                    </a>

                    <div class="settings-menu-box popup" data-popup="Preferences">
                        <div class="icon-button preferences-button">
                            ${ helpers.createIcon("settings") }
                        </div>
                    </div>
                </div>

                <div class=data-source-ui></div>
            </div>
            `
        });

        // Create the search menu dropdown.
        new DropdownMenuOpener({
            button: this.container.querySelector(".main-search-menu-button"),
            createBox: ({...options}) => {
                let dropdown = this.bookmarkTagsDropdown = new Widget({
                    ...options,
                    template: `<div class="vertical-list"></div>`,
                });
                CreateSearchMenu(dropdown.container);

                return dropdown;
            },
        });

        this.userInfoLinks = new UserInfoLinks({
            container: this.querySelector(".user-links"),
        });

        this.container.querySelector(".refresh-search-from-page-button").addEventListener("click", () => this.parent.refreshSearchFromPage());
        this.container.querySelector(".expand-manga-posts").addEventListener("click", (e) => {
            this.parent.searchView.toggleExpandingMediaIdsByDefault();
        });

        this.container.querySelector(".refresh-search-button").addEventListener("click", () => this.parent.refreshSearch());

        this.toggleLocalNavigationButton = this.container.querySelector(".toggle-local-navigation-button");
        this.toggleLocalNavigationButton.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.parent._localNavigationVisible = !this.parent._localNavigationVisible;
            this.parent.refreshUi();
        });        

        this.container.querySelector(".preferences-button").addEventListener("click", (e) => new SettingsDialog());

        // Refresh the "Refresh search from page" tooltip if the page in the URL changes.  Use statechange
        // rather than popstate for this, so it responds to all URL changes.
        window.addEventListener("pp:statechange", (e) => this.refreshRefreshSearchFromPage(), { signal: this.shutdownSignal.signal });

        this.avatarWidget = new AvatarWidget({
            container: this.querySelector(".avatar-container"),
            big: true,
            mode: "dropdown",

            // Disable the avatar widget unless the data source enables it.
            visible: false,
        });

        this.imageForSuggestions = this.querySelector(".image-for-suggestions");

        // Set up login/logout buttons for native.
        if(ppixiv.native)
        {
            let { logged_in, local } = LocalAPI.localInfo;
            this.container.querySelector(".login-button").hidden = local || logged_in;
            this.container.querySelector(".logout-button").hidden = local || !logged_in;
            this.container.querySelector(".login-button").addEventListener("click", () => LocalAPI.redirectToLogin());
            this.container.querySelector(".logout-button").addEventListener("click", () => {
                if(confirm("Log out?"))
                    LocalAPI.logout();
            });
        }
    }
    
    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        // Remove any previous data source's UI.
        if(this.currentDataSourceUi)
        {
            this.currentDataSourceUi.shutdown();
            this.currentDataSourceUi = null;
        }

        this.dataSource = dataSource;
        this.avatarWidget.setUserId(null);
        this.avatarWidget.visible = false;
        this.imageForSuggestions.hidden = true;

        if(dataSource == null)
            return;

        // Create the new data source's UI.
        if(this.dataSource.ui)
        {
            let dataSourceUiContainer = this.container.querySelector(".data-source-ui");
            this.currentDataSourceUi = new this.dataSource.ui({
                dataSource: this.dataSource,
                container: dataSourceUiContainer,
            });
        }
    }
    
    updateFromSettings = () =>
    {
        this.refreshExpandMangaPostsButton();
    }

    refreshUi()
    {
        this.container.querySelector(".refresh-search-from-page-button").hidden = !this.dataSource.supportsStartPage;
        if(this.dataSource)
        {
            let { userId, imageUrl, imageLinkUrl } = this.dataSource.uiInfo;

            this.imageForSuggestions.hidden = imageUrl == null;
            this.imageForSuggestions.href = imageLinkUrl ?? "#";

            let img = this.imageForSuggestions.querySelector(".image-for-suggestions > img");
            img.src = imageUrl ?? helpers.blankImage;

            this.avatarWidget.visible = userId != null;
            this.avatarWidget.setUserId(userId);
        }

        let elementDisplaying = this.container.querySelector(".displaying");
        elementDisplaying.hidden = this.dataSource?.getDisplayingText == null;
        if(this.dataSource?.getDisplayingText != null)
        {
            let text = this.dataSource.getDisplayingText();
            elementDisplaying.replaceChildren(text);
        }

        if(this.toggleLocalNavigationButton)
        {
            this.toggleLocalNavigationButton.hidden = this.parent._localNavigationTree == null || !this.parent.canShowLocalNavigation;
            this.toggleLocalNavigationButton.querySelector(".font-icon").innerText = this.parent._localNavigationVisible?
                "keyboard_double_arrow_left":"keyboard_double_arrow_right";
        }

        this.refreshSlideshowButton();
        this.refreshExpandMangaPostsButton();
        this.refreshRefreshSearchFromPage();
    }

    // Refresh the slideshow button.
    refreshSlideshowButton()
    {
        let node = this.container.querySelector("A.slideshow");
        node.href = ppixiv.app.slideshowURL.url;
    }

    // Refresh the highlight for the "expand all posts" button.
    refreshExpandMangaPostsButton()
    {
        let enabled = this.parent.searchView.mediaIdsExpandedByDefault;
        let button = this.container.querySelector(".expand-manga-posts");
        button.dataset.popup = enabled? "Collapse manga posts":"Expand manga posts";
        button.querySelector(".font-icon").innerText = enabled? "close_fullscreen":"open_in_full";
        
        // Hide the button if the data source can never return manga posts to be expanded, or
        // if it's the manga page itself which always expands.
        button.hidden = !this.dataSource?.allowExpandingMangaPages;
    }

    refreshRefreshSearchFromPage()
    {
        if(this.dataSource == null)
            return;

        // Refresh the "refresh from page #" button popup.  This is updated by searchView
        // as the user scrolls.
        let startPage = this.dataSource.getStartPage(helpers.args.location);
        this.container.querySelector(".refresh-search-from-page-button").dataset.popup = `Refresh search from page ${startPage}`;
    }
}
