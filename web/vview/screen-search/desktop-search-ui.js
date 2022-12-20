// The main desktop search UI.

import { helpers } from 'vview/ppixiv-imports.js';
import UserInfoLinks from 'vview/screen-search/user-info-links.js';
import CreateSearchMenu from 'vview/screen-search/search-menu.js';

export default class DesktopSearchUI extends ppixiv.widget
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
                    <img src="${helpers.blank_image}">
                </a>

                <div class=title-with-button-row-container data-hidden-on="mobile">
                    <div class=title-with-button-row>
                        <div class="displaying title-font"></div>
                        <div style="flex: 1;"></div>
                        <!-- Links at the top left when viewing a user will be inserted here. -->
                        <div class=user-links></div>
                    </div>
                </div>

                <div class=button-row style="margin-bottom: 0.5em;">
                    <div class="icon-button toggle-local-navigation-button popup" data-popup="Show navigation" hidden data-hidden-on="mobile">
                        ${ helpers.create_icon("mat:keyboard_double_arrow_left") }
                    </div>

                    <a class="icon-button disable-ui-button popup pixiv-only" data-popup="Return to Pixiv" href="#no-ppixiv" data-hidden-on="mobile">
                        ${ helpers.create_icon("ppixiv:pixiv") }
                    </a>

                    <!-- These login/logout buttons are only used by the local API. -->
                    <div class="login-button icon-button popup" data-popup="Login" hidden>
                        ${ helpers.create_icon("login") }
                    </div>

                    <div class="logout-button icon-button popup" data-popup="Logout" hidden>
                        ${ helpers.create_icon("logout") }
                    </div>

                    <div class="main-search-menu-button icon-button popup pixiv-only" data-popup="Search">
                        ${ helpers.create_icon("menu") }
                    </div>

                    <div class="refresh-search-button icon-button popup" data-popup="Refresh">
                        ${ helpers.create_icon("refresh") }
                    </div>

                    <div class="refresh-search-from-page-button icon-button popup" data-popup="Refresh from page">
                        ${ helpers.create_icon("restart_alt") }
                    </div>

                    <div class="expand-manga-posts icon-button popup">
                        ${ helpers.create_icon("") /* filled in by refreshExpandMangaPostsButton */ }
                    </div>

                    <a class="slideshow icon-button popup" data-popup="Slideshow" href="#">
                        ${ helpers.create_icon("wallpaper") }
                    </a>

                    <div class="settings-menu-box popup" data-popup="Preferences">
                        <div class="icon-button preferences-button">
                            ${ helpers.create_icon("settings") }
                        </div>
                    </div>
                </div>

                <div class=data-source-ui></div>
            </div>
            `
        });

        // Create the search menu dropdown.
        new ppixiv.dropdown_menu_opener({
            button: this.container.querySelector(".main-search-menu-button"),
            create_box: ({...options}) => {
                let dropdown = this.bookmark_tags_dropdown = new ppixiv.widget({
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
            this.parent.search_view.toggle_expanding_media_ids_by_default();
        });

        this.container.querySelector(".refresh-search-button").addEventListener("click", () => this.parent.refreshSearch());

        this.toggle_local_navigation_button = this.container.querySelector(".toggle-local-navigation-button");
        this.toggle_local_navigation_button.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.parent.local_navigation_visible = !this.parent.local_navigation_visible;
            this.parent.refreshUi();
        });        

        this.container.querySelector(".preferences-button").addEventListener("click", (e) => new ppixiv.settings_dialog());

        // Refresh the "Refresh search from page" tooltip if the page in the URL changes.  Use statechange
        // rather than popstate for this, so it responds to all URL changes.
        window.addEventListener("pp:statechange", (e) => this.refreshRefreshSearchFromPage(), { signal: this.shutdown_signal.signal });

        this.avatarWidget = new ppixiv.avatar_widget({
            container: this.querySelector(".avatar-container"),
            big: true,
            mode: "dropdown",

            // Disable the avatar widget unless the data source enables it.
            visible: false,
        });

        this.image_for_suggestions = this.querySelector(".image-for-suggestions");

        // Set up login/logout buttons for native.
        if(ppixiv.native)
        {
            let { logged_in, local } = ppixiv.local_api.local_info;
            this.container.querySelector(".login-button").hidden = local || logged_in;
            this.container.querySelector(".logout-button").hidden = local || !logged_in;
            this.container.querySelector(".login-button").addEventListener("click", () => ppixiv.local_api.redirect_to_login());
            this.container.querySelector(".logout-button").addEventListener("click", () => {
                if(confirm("Log out?"))
                    ppixiv.local_api.logout();
            });
        }
    }
    
    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        this.dataSource = dataSource;
        this.avatarWidget.set_user_id(null);
        this.avatarWidget.visible = false;
        this.image_for_suggestions.hidden = true;

        if(dataSource == null)
            return;

        // Remove any previous data source's UI.
        if(this.currentDataSourceUi)
        {
            this.currentDataSourceUi.shutdown();
            this.currentDataSourceUi = null;
        }

        // Create the new data source's UI.
        if(this.dataSource.ui)
        {
            let dataSourceUiContainer = this.container.querySelector(".data-source-ui");
            this.currentDataSourceUi = new this.dataSource.ui({
                data_source: this.dataSource,
                container: dataSourceUiContainer,
            });
        }

        this.container.querySelector(".refresh-search-from-page-button").hidden = !this.dataSource.supports_start_page;
    }
    
    updateFromSettings = () =>
    {
        this.refreshExpandMangaPostsButton();
    }

    refreshUi()
    {
        if(this.dataSource)
        {
            let { user_id, image_url, image_link_url } = this.dataSource.ui_info;

            this.image_for_suggestions.hidden = image_url == null;
            this.image_for_suggestions.href = image_link_url ?? "#";

            let img = this.image_for_suggestions.querySelector(".image-for-suggestions > img");
            img.src = image_url ?? helpers.blank_image;

            this.avatarWidget.visible = user_id != null;
            this.avatarWidget.set_user_id(user_id);
        }

        let element_displaying = this.container.querySelector(".displaying");
        element_displaying.hidden = this.dataSource?.get_displaying_text == null;
        if(this.dataSource?.get_displaying_text != null)
        {
            let text = this.dataSource.get_displaying_text();
            element_displaying.replaceChildren(text);
        }

        if(this.toggle_local_navigation_button)
        {
            this.toggle_local_navigation_button.hidden = this.parent.local_nav_widget == null || !this.parent.can_show_local_navigation;
            this.toggle_local_navigation_button.querySelector(".font-icon").innerText = this.local_navigation_visible?
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
        let enabled = this.parent.search_view.media_ids_expanded_by_default;
        let button = this.container.querySelector(".expand-manga-posts");
        button.dataset.popup = enabled? "Collapse manga posts":"Expand manga posts";
        button.querySelector(".font-icon").innerText = enabled? "close_fullscreen":"open_in_full";
        
        // Hide the button if the data source can never return manga posts to be expanded, or
        // if it's the manga page itself which always expands.
        button.hidden =
            !this.dataSource?.can_return_manga ||
            this.dataSource?.includes_manga_pages;
    }

    refreshRefreshSearchFromPage()
    {
        if(this.dataSource == null)
            return;

        // Refresh the "refresh from page #" button popup.  This is updated by search_view
        // as the user scrolls.
        let start_page = this.dataSource.get_start_page(helpers.args.location);
        this.container.querySelector(".refresh-search-from-page-button").dataset.popup = `Refresh search from page ${start_page}`;
    }
}
