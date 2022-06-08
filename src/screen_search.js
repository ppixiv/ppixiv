"use strict";

let thumbnail_ui = class extends ppixiv.widget
{
    constructor(options)
    {
        super({
            ...options,
            template: `
            <div class=thumbnail-ui-box data-context-menu-target=off>
                <div class="data-source-specific avatar-container" data-datasource="artist illust bookmarks following"></div>
                <a href=# class="data-source-specific image-for-suggestions" data-datasource=related-illusts>
                    <!-- A blank image, so we don't load anything: -->
                    <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==">
                </a>

                <div class=title-with-button-row>
                    <div class="displaying title-font"></div>
                    <div style="flex: 1;"></div>
                    <!-- Links at the top left when viewing a user will be inserted here. -->
                    <div class="button-row user-links">
                    </div>
                </div>

                <div class=button-row style="margin-bottom: 0.5em;">
                    <a class="icon-button disable-ui-button popup pixiv-only" data-popup="Return to Pixiv" href="#no-ppixiv">
                        <span class=ppixiv-icon>pixiv</span>
                    </a>

                    <!-- These login/logout buttons are only used by the local API. -->
                    <div class="login-button icon-button popup" data-popup="Login" hidden>
                        <span class=material-icons>login</span>
                    </div>

                    <div class="logout-button icon-button popup" data-popup="Logout" hidden>
                        <span class=material-icons>logout</span>
                    </div>

                    <!-- Containing block for :hover highlights on the button: -->
                    <div class=pixiv-only>
                        <div class="icon-button popup-menu-box-button popup parent-highlight" data-popup="Search">
                            <span class=material-icons>menu</span>
                        </div>

                        <div hidden class="main-search-menu popup-menu-box vertical-list"></div>
                    </div>

                    <div class="refresh-search-button icon-button popup" data-popup="Refresh">
                        <div class=material-icons>refresh</div>
                    </div>

                    <div class="refresh-search-from-page-button icon-button popup" data-popup="Refresh from page">
                        <div class=material-icons>restart_alt</div>
                    </div>

                    <div class="expand-manga-posts icon-button popup">
                        <div class=material-icons></div>
                    </div>

                    <div class="icon-button whats-new-button popup" data-popup="What's New">
                        <div class=ppixiv-icon>whats_new</div>
                    </div>

                    <a class="slideshow icon-button popup" data-popup="Slideshow" href="#">
                        <div class=material-icons>wallpaper</div>
                    </a>

                    <div class="settings-menu-box popup" data-popup="Preferences">
                        <div class="parent-highlight icon-button preferences-button">
                            <span class=material-icons>settings</span>
                        </div>
                        <div hidden class="popup-menu-box vertical-list">
                        </div>
                    </div>
                </div>

                <div class="data-source-specific box-button-row" data-datasource=discovery>
                    ${ helpers.create_box_link({label: "All",      link: "?mode=all#ppixiv",     popup: "Show all works",    data_type: "all" }) }
                    ${ helpers.create_box_link({label: "All ages", link: "?mode=safe#ppixiv",    popup: "All ages",          data_type: "safe" }) }
                    ${ helpers.create_box_link({label: "R18",      link: "?mode=r18#ppixiv",     popup: "R18",               data_type: "r18", classes: ["r18"] }) }
                </div>

                <div class="data-source-specific box-button-row" data-datasource=new_illust>
                    ${ helpers.create_box_link({label: "Illustrations", popup: "Show illustrations",     data_type: "new-illust-type-illust" }) }
                    ${ helpers.create_box_link({label: "Manga",         popup: "Show manga only",        data_type: "new-illust-type-manga" }) }

                    ${ helpers.create_box_link({label: "All ages",      popup: "Show all-ages works",    data_type: "new-illust-ages-all" }) }
                    ${ helpers.create_box_link({label: "R18",           popup: "Show R18 works",         data_type: "new-illust-ages-r18" }) }
                </div>
                
                <div class="data-source-specific" data-datasource=rankings>
                    <div class=box-button-row>
                        ${ helpers.create_box_link({label: "Next day", popup: "Show the next day",     data_type: "new-illust-type-illust", classes: ["nav-tomorrow"] }) }
                        <span class=nav-today style="margin: 0 0.25em;"></span>
                        ${ helpers.create_box_link({label: "Previous day", popup: "Show the previous day",     data_type: "new-illust-type-illust", classes: ["nav-yesterday"] }) }
                    </div>

                    <div class="checked-links box-button-row">
                        ${ helpers.create_box_link({label: "All",           popup: "Show all works",           data_type: "content-all" }) }
                        ${ helpers.create_box_link({label: "Illustrations", popup: "Show illustrations only",  data_type: "content-illust" }) }
                        ${ helpers.create_box_link({label: "Animations",    popup: "Show animations only",     data_type: "content-ugoira" }) }
                        ${ helpers.create_box_link({label: "Manga",         popup: "Show manga only",          data_type: "content-manga" }) }
                    </div>

                    <div class="checked-links box-button-row">
                        ${ helpers.create_box_link({label: "Daily",         popup: "Daily rankings",           data_type: "mode-daily" }) }
                        ${ helpers.create_box_link({label: "R18",           popup: "Show R18 works (daily only)",     data_type: "mode-daily-r18", classes: ["r18"] }) }
                        ${ helpers.create_box_link({label: "R18G",          popup: "Show R18G works (weekly only)",   data_type: "mode-r18g", classes: ["r18g"] }) }
                        ${ helpers.create_box_link({label: "Weekly",        popup: "Weekly rankings",          data_type: "mode-weekly" }) }
                        ${ helpers.create_box_link({label: "Monthly",       popup: "Monthly rankings",         data_type: "mode-monthly" }) }
                        ${ helpers.create_box_link({label: "Rookie",        popup: "Rookie rankings",          data_type: "mode-rookie" }) }
                        ${ helpers.create_box_link({label: "Original",      popup: "Original rankings",        data_type: "mode-original" }) }
                        ${ helpers.create_box_link({label: "Male",          popup: "Popular with men",         data_type: "mode-male" }) }
                        ${ helpers.create_box_link({label: "Female",        popup: "Popular with women",       data_type: "mode-female" }) }
                    </div>
                </div>
                 
                <div class="data-source-specific box-button-row" data-datasource=recent>
                    ${ helpers.create_box_link({label: "Clear",        popup: "Clear recent history",       data_type: "clear-recents" }) }
                </div>
                
                <div class="data-source-specific" data-datasource=bookmarks>
                    <div class=box-button-row>
                        <!-- These are hidden if you're viewing somebody else's bookmarks. -->
                        <span class=bookmarks-public-private style="margin-right: 25px;">
                            ${ helpers.create_box_link({label: "All",        popup: "Show all bookmarks",       data_type: "all" }) }
                            ${ helpers.create_box_link({label: "Public",     popup: "Show public bookmarks",    data_type: "public" }) }
                            ${ helpers.create_box_link({label: "Private",    popup: "Show private bookmarks",   data_type: "private" }) }
                        </span>

                        <div class=bookmark-tags-box>
                            ${ helpers.create_box_link({label: "All bookmarks",    popup: "Bookmark tags",  icon: "ppixiv:tag", classes: ["popup-menu-box-button"] }) }
                            <div class="popup-menu-box bookmark-tag-list vertical-list"></div>
                        </div>

                        ${ helpers.create_box_link({ popup: "Shuffle", icon: "shuffle",   data_type: "order-shuffle" }) }
                    </div>
                </div>                

                <div class="data-source-specific" data-datasource=following>
                    <div class=box-button-row>
                        <span class=follows-public-private style="margin-right: 25px;">
                            ${ helpers.create_box_link({label: "Public",    popup: "Show publically followed users",   data_type: "public-follows" }) }
                            ${ helpers.create_box_link({label: "Private",    popup: "Show privately followed users",   data_type: "private-follows" }) }
                        </span>

                        <span class="followed-users-follow-tags premium-only">
                            ${ helpers.create_box_link({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["popup-menu-box-button"] }) }
                            <div class="popup-menu-box follow-tag-list vertical-list"></div>
                        </span>
                    </div>
                </div>                

                <div class=data-source-specific data-datasource="new_works_by_following">
                    <div class=box-button-row>
                        <span style="margin-right: 25px;">
                            ${ helpers.create_box_link({label: "All",    popup: "Show all works",   data_type: "bookmarks-new-illust-all", classes: ["r18"] }) }
                            ${ helpers.create_box_link({label: "R18",    popup: "Show R18 works",   data_type: "bookmarks-new-illust-ages-r18", classes: ["r18"] }) }
                        </span>

                        <span class="new-post-follow-tags premium-only">
                            ${ helpers.create_box_link({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["popup-menu-box-button"] }) }
                            <div class="popup-menu-box new-post-follow-tag-list vertical-list"></div>
                        </span>
                    </div>
                </div>

                <div class="data-source-specific" data-datasource=artist>
                    <div class="box-button-row search-options-row">
                        ${ helpers.create_box_link({label: "Works",    popup: "Show all works",            data_type: "artist-works" }) }
                        ${ helpers.create_box_link({label: "Illusts",  popup: "Show illustrations only",   data_type: "artist-illust" }) }
                        ${ helpers.create_box_link({label: "Manga",    popup: "Show manga only",           data_type: "artist-manga" }) }

                        <div class=member-tags-box>
                            ${ helpers.create_box_link({label: "Tags",    popup: "Tags", icon: "bookmark", classes: ["popup-menu-box-button"] }) }
                            <div class="popup-menu-box post-tag-list vertical-list"></div>
                        </div>
                    </div>
                </div>
                 
                <div class="data-source-specific" data-datasource=search>
                    <div>
                        <!-- The whole input widget is marked as a tabindex, to make it easier to tell
                                when the user clicks out of any of its widgets. -->
                        <div class="search-box tag-search-box" tabindex=1>
                            <div class="input-field-container hover-menu-box">
                                <input placeholder=Tags>
                                <span class="edit-search-button right-side-button">
                                    <ppixiv-inline src="resources/edit-icon.svg"></ppixiv-inline>
                                </span>

                                <span class="search-submit-button right-side-button">
                                    <span class="material-icons">search</span>                                            
                                </span>
                            </div>
                        </div>

                        <div class="search-tags-box box-button-row" style="display: inline-block;">
                            ${ helpers.create_box_link({label: "Related tags",    icon: "bookmark", classes: ["popup-menu-box-button"] }) }
                            <div class="popup-menu-box related-tag-list vertical-list"></div>
                        </div>
                    </div>

                    <!-- We don't currently have popup text for these, since it's a little annoying to
                         have it pop over the menu. -->
                    <div class="box-button-row search-options-row">
                        ${ helpers.create_box_link({label: "Ages",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "All",  data_type: "ages-all", dataset: { default: true } }) }
                            ${ helpers.create_box_link({label: "All ages",  data_type: "ages-safe" }) }
                            ${ helpers.create_box_link({label: "R18",  data_type: "ages-r18", classes: ["r18"] }) }
                        </div>

                        ${ helpers.create_box_link({label: "Sort",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "Newest",              data_type: "order-newest", dataset: { default: true } }) }
                            ${ helpers.create_box_link({label: "Oldest",              data_type: "order-oldest" }) }
                            ${ helpers.create_box_link({label: "Popularity",          data_type: "order-all",    classes: ["premium-only"] }) }
                            ${ helpers.create_box_link({label: "Popular with men",    data_type: "order-male",   classes: ["premium-only"] }) }
                            ${ helpers.create_box_link({label: "Popular with women",  data_type: "order-female", classes: ["premium-only"] }) }
                        </div>

                        ${ helpers.create_box_link({label: "Type",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "All",             data_type: "search-type-all",    dataset: { default: true } }) }
                            ${ helpers.create_box_link({label: "Illustrations",   data_type: "search-type-illust" }) }
                            ${ helpers.create_box_link({label: "Manga",           data_type: "search-type-manga" }) }
                            ${ helpers.create_box_link({label: "Animations",      data_type: "search-type-ugoira" }) }
                        </div>

                        ${ helpers.create_box_link({label: "Search mode",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "Tag",               data_type: "search-all",    dataset: { default: true } }) }
                            ${ helpers.create_box_link({label: "Exact tag match",   data_type: "search-exact" }) }
                            ${ helpers.create_box_link({label: "Text search",       data_type: "search-text" }) }
                        </div>

                        ${ helpers.create_box_link({label: "Image size",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "All",               data_type: "res-all",    dataset: { default: true } }) }
                            ${ helpers.create_box_link({label: "High-res",          data_type: "res-high" }) }
                            ${ helpers.create_box_link({label: "Medium-res",        data_type: "res-medium" }) }
                            ${ helpers.create_box_link({label: "Low-res",           data_type: "res-low" }) }
                        </div>
                        
                        ${ helpers.create_box_link({label: "Aspect ratio",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "All",               data_type: "aspect-ratio-all",       icon: "", dataset: { default: true } }) }
                            ${ helpers.create_box_link({label: "Landscape",         data_type: "aspect-ratio-landscape", icon: "panorama" }) }
                            ${ helpers.create_box_link({label: "Portrait",          data_type: "aspect-ratio-portrait",  icon: "portrait" }) }
                            ${ helpers.create_box_link({label: "Square",            data_type: "aspect-ratio-square",    icon: "crop_square" }) }
                        </div>

                        ${ helpers.create_box_link({label: "Bookmarks",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            <!-- The Pixiv search form shows 300-499, 500-999 and 1000-.  That's not
                                 really useful and the query parameters let us filter differently, so we
                                 replace it with a more useful "minimum bookmarks" filter. -->
                            ${ helpers.create_box_link({label: "All",               data_type: "bookmarks-all",    dataset: { default: true } }) }
                            ${ helpers.create_box_link({label: "100+",              data_type: "bookmarks-100" }) }
                            ${ helpers.create_box_link({label: "250+",              data_type: "bookmarks-250" }) }
                            ${ helpers.create_box_link({label: "500+",              data_type: "bookmarks-500" }) }
                            ${ helpers.create_box_link({label: "1000+",             data_type: "bookmarks-1000" }) }
                            ${ helpers.create_box_link({label: "2500+",             data_type: "bookmarks-2500" }) }
                            ${ helpers.create_box_link({label: "5000+",             data_type: "bookmarks-5000" }) }
                        </div>
                       
                        ${ helpers.create_box_link({label: "Time",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "All",               data_type: "time-all",  dataset: { default: true } }) }
                            ${ helpers.create_box_link({label: "This week",         data_type: "time-week", dataset: { shortLabel: "Weekly" } }) }
                            ${ helpers.create_box_link({label: "This month",        data_type: "time-month" }) }
                            ${ helpers.create_box_link({label: "This year",         data_type: "time-year" }) }

                            <div class=years-ago>
                                ${ helpers.create_box_link({label: "1",             data_type: "time-years-ago-1", dataset: { shortLabel: "1 year" } }) }
                                ${ helpers.create_box_link({label: "2",             data_type: "time-years-ago-2", dataset: { shortLabel: "2 years" } }) }
                                ${ helpers.create_box_link({label: "3",             data_type: "time-years-ago-3", dataset: { shortLabel: "3 years" } }) }
                                ${ helpers.create_box_link({label: "4",             data_type: "time-years-ago-4", dataset: { shortLabel: "4 years" } }) }
                                ${ helpers.create_box_link({label: "5",             data_type: "time-years-ago-5", dataset: { shortLabel: "5 years" } }) }
                                ${ helpers.create_box_link({label: "6",             data_type: "time-years-ago-6", dataset: { shortLabel: "6 years" } }) }
                                ${ helpers.create_box_link({label: "7",             data_type: "time-years-ago-7", dataset: { shortLabel: "7 years" } }) }
                                <span>years ago</span>
                            </div>
                        </div>
                        
                        ${ helpers.create_box_link({label: "Reset", popup: "Clear all search options", classes: ["reset-search"] }) }
                    </div>
                </div>

                <div class="search-box data-source-specific" data-datasource=search-users>
                    <div class="user-search-box input-field-container hover-menu-box">
                        <input class=search-users placeholder="Search users">
                        <span class="search-submit-button right-side-button">
                            <span class="material-icons">search</span>                                            
                        </span>
                    </div>
                </div>

                <div class="data-source-specific" data-datasource=completed-requests>
                    <div class="box-button-row">
                        <div style="margin-right: 25px;">
                            ${ helpers.create_box_link({label: "Latest",        popup: "Show latest completed requests",       data_type: "completed-requests-latest" }) }
                            ${ helpers.create_box_link({label: "Recommended",   popup: "Show recommmended completed requests", data_type: "completed-requests-recommended" }) }
                        </div>

                        <div style="margin-right: 25px;">
                            ${ helpers.create_box_link({label: "Illustrations", popup: "Show latest completed requests",       data_type: "completed-requests-illust" }) }
                            ${ helpers.create_box_link({label: "Animations",    popup: "Show animations only",                 data_type: "completed-requests-ugoira" }) }
                            ${ helpers.create_box_link({label: "Manga",         popup: "Show manga only",                      data_type: "completed-requests-manga" }) }
                        </div>

                        <div>
                            ${ helpers.create_box_link({label: "All",           popup: "Show all works",                       data_type: "completed-requests-all" }) }
                            ${ helpers.create_box_link({label: "All ages",      popup: "Show all-ages works",                  data_type: "completed-requests-safe" }) }
                            ${ helpers.create_box_link({label: "R18",           popup: "Show R18 works",                       data_type: "completed-requests-r18", classes: ["r18"] }) }
                        </div>
                    </div>
                </div>

                <div class="data-source-specific" data-datasource=vview>
                    <div class="search-box local-tag-search-box">
                        <div class="input-field-container hover-menu-box">
                            <input placeholder="Search files">

                            <span class="clear-local-search-button right-side-button">
                                <span class="material-icons" style="display: block; color: black;">clear</span>                                
                            </span>

                            <span class="submit-local-search-button right-side-button">
                                <span class="material-icons" style="display: block; color: black;">search</span>                                
                            </span>
                        </div>
                    </div>

                    <div class="box-button-row">
                        <span class="popup icon-button copy-local-path" data-popup="Copy local path to clipboard">
                            <span class="material-icons">content_copy</span>
                        </span>

                        ${ helpers.create_box_link({popup: "Close search", icon: "exit_to_app",  classes: ["clear-local-search"] }) }
                        ${ helpers.create_box_link({label: "Bookmarks",           popup: "Show bookmarks",                       data_type: "local-bookmarks-only" }) }

                        <div class=local-bookmark-tags-box>
                            ${ helpers.create_box_link({label: "Tags",    icon: "bookmark", classes: ["popup-menu-box-button"] }) }
                            <div class="popup-menu-box local-bookmark-tag-list vertical-list"></div>
                        </div>

                        ${ helpers.create_box_link({label: "Type",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "All",           data_type: "local-type-all", dataset: { default: "1"} }) }
                            ${ helpers.create_box_link({label: "Videos",        data_type: "local-type-videos" }) }
                            ${ helpers.create_box_link({label: "Images",        data_type: "local-type-images" }) }
                        </div>
                        
                        ${ helpers.create_box_link({label: "Aspect ratio",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "All",           data_type: "local-aspect-ratio-all", dataset: { default: "1"} }) }
                            ${ helpers.create_box_link({label: "Landscape",     data_type: "local-aspect-ratio-landscape" }) }
                            ${ helpers.create_box_link({label: "Portrait",      data_type: "local-aspect-ratio-portrait" }) }
                        </div>
                        
                        ${ helpers.create_box_link({label: "Image size",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "All",           data_type: "local-res-all", dataset: { default: "1"} }) }
                            ${ helpers.create_box_link({label: "High-res",      data_type: "local-res-high" }) }
                            ${ helpers.create_box_link({label: "Medium-res",    data_type: "local-res-medium" }) }
                            ${ helpers.create_box_link({label: "Low-res",       data_type: "local-res-low" }) }
                        </div>

                        ${ helpers.create_box_link({label: "Order",    classes: ["popup-menu-box-button"] }) }
                        <div hidden class="popup-menu-box vertical-list">
                            ${ helpers.create_box_link({label: "Name",           data_type: "local-sort-normal", dataset: { default: "1"} }) }
                            ${ helpers.create_box_link({label: "Name (inverse)", data_type: "local-sort-invert" }) }
                            ${ helpers.create_box_link({label: "Newest",         data_type: "local-sort-newest" }) }
                            ${ helpers.create_box_link({label: "Oldest",         data_type: "local-sort-oldest" }) }
                        </div>

                        ${ helpers.create_box_link({ popup: "Shuffle", icon: "shuffle",   data_type: "local-sort-shuffle" }) }
                    </div>
                </div>                
            </div>
            `
        });
    }
}

// The search UI.
ppixiv.screen_search = class extends ppixiv.screen
{
    constructor(options)
    {
        super({...options, template: `
            <div class="screen screen-search-container search-screen">
                <!-- The tree widget for local navigation: -->
                <div class=local-navigation-box></div>

                <div class="search-results">

                    <div class="thumbnail-ui top-ui-box">
                        <div style="flex: 1;"></div>
                        <div class=thumbnail-ui-box-container></div>
                        <div style="flex: 1;"></div>
                    </div>

                    <div class="top-ui-box-padding"></div>

                    <div class=no-results hidden>
                        <div class=message>No results</div>
                    </div>

                    <div class=thumbnail-container-box data-context-menu-target>
                        <div class=thumbnails></div>
                    </div>
                </div>
            </div>
        `});

        // The node that scrolls to show thumbs.  This is normally the document itself.
        this.scroll_container = document.documentElement;
        this.expanded_media_ids = new Map();

        window.addEventListener("thumbnailsloaded", this.thumbs_loaded);
        window.addEventListener("focus", this.visible_thumbs_changed);

        this.container.addEventListener("wheel", this.onwheel, { passive: false });
//        this.container.addEventListener("mousemove", this.onmousemove);

        image_data.singleton().user_modified_callbacks.register(this.refresh_ui);

        // When a bookmark is modified, refresh the heart icon.
        image_data.singleton().illust_modified_callbacks.register(this.refresh_thumbnail);

        this.container.addEventListener("load", (e) => {
            if(e.target.classList.contains("thumb"))
                this.thumb_image_load_finished(e.target.closest(".thumbnail-box"), { cause: "onload" });
        }, { capture: true } );

        new thumbnail_ui({
            parent: this,
            container: this.container.querySelector(".thumbnail-ui-box-container"),
        });

        this.create_main_search_menu();

        // Create the avatar widget shown on the artist data source.
        this.avatar_container = this.container.querySelector(".avatar-container");
        this.avatar_widget = new avatar_widget({
            container: this.avatar_container,
            changed_callback: this.data_source_updated,
            big: true,
            mode: "dropdown",
        });

        // Work around a browser bug: even though it's document.documentElement.scrollTop is
        // changing, it doesn't receive onscroll and we have to listen on window instead.
        window.addEventListener("scroll", (e) => {
            this.schedule_store_scroll_position();
        }, {
            passive: true,
        });
        
        // Create the tag widget used by the search data source.
        this.tag_widget = new tag_widget({
            contents: this.container.querySelector(".related-tag-list"),
        });

        // Don't scroll thumbnails when scrolling tag dropdowns.
        // FIXME: This works on member-tags-box, but not reliably on search-tags-box, even though
        // they seem like the same thing.
        this.container.querySelector(".member-tags-box .post-tag-list").addEventListener("scroll", function(e) { e.stopPropagation(); }, true);
        this.container.querySelector(".search-tags-box .related-tag-list").addEventListener("scroll", function(e) { e.stopPropagation(); }, true);
        this.container.querySelector(".bookmark-tags-box .bookmark-tag-list").addEventListener("scroll", function(e) { e.stopPropagation(); }, true);
        this.container.querySelector(".local-bookmark-tags-box .local-bookmark-tag-list").addEventListener("scroll", function(e) { e.stopPropagation(); }, true);

        // Set up hover popups.
        dropdown_menu_opener.create_handlers(this.container);

        // As an optimization, start loading image info on mousedown.  We don't navigate until click,
        // but this lets us start loading image info a bit earlier.
        this.container.querySelector(".thumbnails").addEventListener("mousedown", async (e) => {
            if(e.button != 0)
                return;

            var a = e.target.closest("a.thumbnail-link");
            if(a == null)
                return;

            if(a.dataset.mediaId == null)
                return;

            // Only do this for illustrations.
            let {type} = helpers.parse_media_id(a.dataset.mediaId);
            if(type != "illust")
                return;

            await image_data.singleton().get_media_info(a.dataset.mediaId);
        }, true);
 
        this.container.querySelector(".refresh-search-button").addEventListener("click", this.refresh_search);
        this.container.querySelector(".refresh-search-from-page-button").addEventListener("click", this.refresh_search_from_page);
        this.container.querySelector(".whats-new-button").addEventListener("click", this.whats_new);
        this.container.querySelector(".thumbnails").addEventListener("click", this.thumbnail_onclick);
        this.container.querySelector(".expand-manga-posts").addEventListener("click", (e) => {
            this.toggle_expanding_media_ids_by_default();
        });

        // Set up login/logout buttons for native.
        if(ppixiv.native)
        {
            let { logged_in, local } = local_api.local_info;
            this.container.querySelector(".login-button").hidden = local || logged_in;
            this.container.querySelector(".logout-button").hidden = local || !logged_in;
            this.container.querySelector(".login-button").addEventListener("click", () => { local_api.redirect_to_login(); });
            this.container.querySelector(".logout-button").addEventListener("click", () => { local_api.logout(); });
        }

        // Handle quick view.
        new ppixiv.pointer_listener({
            element: this.container.querySelector(".thumbnails"),
            button_mask: 0b1,
            callback: (e) => {
                if(!e.pressed)
                    return;

                let a = e.target.closest("A");
                if(a == null)
                    return;

                if(!settings.get("quick_view"))
                    return;

                // Activating on press would probably break navigation on touchpads, so only do
                // this for mouse events.
                if(e.pointerType != "mouse")
                    return;

                let { media_id } = main_controller.singleton.get_illust_at_element(e.target);
                if(media_id == null)
                    return;

                // Don't stopPropagation.  We want the illustration view to see the press too.
                e.preventDefault();
                // e.stopImmediatePropagation();

                main_controller.singleton.show_media(media_id, { add_to_history: true });
            },
        });
        // Clear recent illusts:
        this.container.querySelector("[data-type='clear-recents']").addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();

            await ppixiv.recently_seen_illusts.get().clear();
            this.refresh_search();
        });

        this.container.querySelector(".preferences-button").addEventListener("click", (e) => {
            new ppixiv.settings_dialog({ container: document.body });
        });

        settings.register_change_callback("thumbnail-size", () => { this.refresh_images(); });
        settings.register_change_callback("manga-thumbnail-size", () => { this.refresh_images(); });
        settings.register_change_callback("theme", this.update_from_settings);
        settings.register_change_callback("disable_thumbnail_zooming", this.update_from_settings);
        settings.register_change_callback("disable_thumbnail_panning", this.update_from_settings);
        settings.register_change_callback("ui-on-hover", this.update_from_settings);
        settings.register_change_callback("no-hide-cursor", this.update_from_settings);
        settings.register_change_callback("no_recent_history", this.update_from_settings);
        settings.register_change_callback("expand_manga_thumbnails", this.update_from_settings);
        muting.singleton.addEventListener("mutes-changed", this.refresh_after_mute_change);
        
        // Zoom the thumbnails on ctrl-mousewheel:
        this.container.addEventListener("wheel", (e) => {
            if(!e.ctrlKey)
                return;
    
            e.preventDefault();
            e.stopImmediatePropagation();
    
            let manga_view = this.data_source?.name == "manga";
            settings.adjust_zoom(manga_view? "manga-thumbnail-size":"thumbnail-size", e.deltaY > 0);
        }, { passive: false });
            
        this.container.addEventListener("keydown", (e) => {
            let zoom = helpers.is_zoom_hotkey(e);
            if(zoom != null)
            {
                e.preventDefault();
                e.stopImmediatePropagation();

                let manga_view = this.data_source?.name == "manga";
                settings.adjust_zoom(manga_view? "manga-thumbnail-size":"thumbnail-size", zoom < 0);
            }
        });

        // Create the tag dropdown for the search page input.
        new tag_search_box_widget({ contents: this.container.querySelector(".tag-search-box") });
            
        // The search history dropdown for local searches.
        new local_search_box_widget({ contents: this.container.querySelector(".local-tag-search-box") });
        
        // If the local API is enabled and tags aren't restricted, set up the directory tree sidebar.
        let local_navigation_box = this.container.querySelector(".local-navigation-box");

        this.clear_local_search_button = this.container.querySelector(".clear-local-search");
        this.clear_local_search_button.addEventListener("click", (e) => {
            // Get the URL for the current folder and set it to a new URL, so it removes search
            // parameters.
            let media_id = local_api.get_local_id_from_args(helpers.args.location, { get_folder: true });
            let args = new helpers.args("/", ppixiv.location);
            local_api.get_args_for_id(media_id, args);
            helpers.set_page_url(args, true, "navigation");
        });
            
        if(!local_api.local_info.bookmark_tag_searches_only)
        {
            this.local_nav_widget = new ppixiv.local_navigation_widget({
                parent: this,
                container: local_navigation_box,
            });
        }

        this.container.querySelector(".copy-local-path").addEventListener("click", (e) => {
            this.data_source.copy_link();
        });

        // Handle submitting searches on the user search page.
        this.container.querySelector(".user-search-box .search-submit-button").addEventListener("click", this.submit_user_search);
        helpers.input_handler(this.container.querySelector(".user-search-box input.search-users"), this.submit_user_search);

        // Create IntersectionObservers for thumbs that are completely onscreen, nearly onscreen (should
        // be preloaded), and farther off (but not so far they should be unloaded).
        this.intersection_observers = [];
        this.intersection_observers.push(new IntersectionObserver((entries) => {
            for(let entry of entries)
                helpers.set_dataset(entry.target.dataset, "fullyOnScreen", entry.isIntersecting);

            this.load_data_source_page();
            this.first_visible_thumbs_changed();
        }, {
            root: document,
            threshold: 1,
        }));
        
        this.intersection_observers.push(new IntersectionObserver((entries) => {
            let any_changed = false;
            for(let entry of entries)
            {
                // Ignore special entries, 
                if(entry.target.dataset.special)
                    continue;

                helpers.set_dataset(entry.target.dataset, "nearby", entry.isIntersecting);
                any_changed = true;
            }

            // If no actual thumbnails changed, don't refresh.  We don't want to trigger a refresh
            // from the special buttons being removed and added.
            if(!any_changed)
                return;

            // Set up any thumbs that just came nearby, and see if we need to load more search results.
            this.refresh_images();
            this.set_visible_thumbs();
            this.load_data_source_page();
        }, {
            root: document,

            // This margin determines how far in advance we load the next page of results.
            rootMargin: "150%",
        }));

        this.intersection_observers.push(new IntersectionObserver((entries) => {
            for(let entry of entries)
                helpers.set_dataset(entry.target.dataset, "visible", entry.isIntersecting);
            
            this.visible_thumbs_changed();
        }, {
            root: document,
            rootMargin: "0%",
        }));
        
        /*
         * Add a slight delay before hiding the UI.  This allows opening the UI by swiping past the top
         * of the window, without it disappearing as soon as the mouse leaves the window.  This doesn't
         * affect opening the UI.
         *
         * We're actually handling the manga UI's top-ui-box here too.
         */
        for(let box of document.querySelectorAll(".top-ui-box"))
            new hover_with_delay(box, 0, 0.25);
        
        this.update_from_settings();
        this.refresh_images();
        this.load_data_source_page();
        this.refresh_whats_new_button();
    }

    create_main_search_menu()
    {
        let option_box = this.container.querySelector(".main-search-menu");
        this.menu_options = [];
        let options = [
            { label: "Search works",           icon: "search", url: `/tags#ppixiv`,
                onclick: async() => {
                    // Focus the tag search box.  We need to go async to let the navigation happen
                    // so the search box is visible first.
                    await helpers.sleep(0);
                    this.container.querySelector(".tag-search-box input").focus();
                }
            },
            { label: "New works by following", icon: "photo_library",          url: "/bookmark_new_illust.php#ppixiv" },
            { label: "New works by everyone",  icon: "groups",          url: "/new_illust.php#ppixiv" },
            [
                { label: "Bookmarks", icon: "favorite", url: `/users/${window.global_data.user_id}/bookmarks/artworks#ppixiv` },
                { label: "all", url: `/users/${window.global_data.user_id}/bookmarks/artworks#ppixiv` },
                { label: "public", url: `/users/${window.global_data.user_id}/bookmarks/artworks#ppixiv?show-all=0` },
                { label: "private", url: `/users/${window.global_data.user_id}/bookmarks/artworks?rest=hide#ppixiv?show-all=0` },
            ],
            [
                { label: "Followed users", icon: "visibility", url: `/users/${window.global_data.user_id}/following#ppixiv` },
                { label: "public", url: `/users/${window.global_data.user_id}/following#ppixiv` },
                { label: "private", url: `/users/${window.global_data.user_id}/following?rest=hide#ppixiv` },
            ],

            { label: "Rankings",               icon: "auto_awesome"  /* who names this stuff? */, url: "/ranking.php#ppixiv" },
            { label: "Recommended works",      icon: "ppixiv:suggestions", url: "/discovery#ppixiv" },
            { label: "Recommended users",      icon: "ppixiv:suggestions", url: "/discovery/users#ppixiv" },
            { label: "Completed requests",     icon: "request_page", url: "/request/complete/illust#ppixiv" },
            { label: "Users",           icon: "search", url: "/search_user.php#ppixiv" },
            // { label: "Recent history", icon: "", url: "/history.php#ppixiv", classes: ["recent-history-link"] },
            { label: "Local search",           icon: "folder", url: `${local_api.path}#ppixiv/`, local: true, onclick: local_api.show_local_search },
        ];


        let create_option = (option) => {
            let button = new menu_option_button({
                container: option_box,
                parent: this,
                onclick: option.onclick,
                ...option
            })

            // Hide the local search menu option if it's not enabled.
            if(option.local && !local_api.is_enabled())
                button.container.hidden = true;
            return button;
        };

        for(let option of options)
        {
            if(Array.isArray(option))
            {
                let items = [];
                for(let suboption of option)
                    items.push(create_option(suboption));

                new menu_option_row({
                    container: option_box,
                    parent: this,
                    items: items,
                });
            }
            else
                this.menu_options.push(create_option(option));
        }
    }

    get_thumbnail_for_media_id(media_id)
    {
        return this.container.querySelector(`[data-id='${helpers.escape_selector(media_id)}']`);
    }

    get_first_visible_thumb()
    {
        // Find the first thumb that's fully onscreen.  Ignore elements not specific to a page (load previous results).
        return this.container.querySelector(`.thumbnails > [data-id][data-fully-on-screen][data-search-page]`);
    }

    // This is called as the user scrolls and different thumbs are fully onscreen,
    // to update the page URL.
    first_visible_thumbs_changed()
    {
        // Find the first thumb that's fully onscreen.  Ignore elements not specific to a page (load previous results).
        let first_thumb = this.get_first_visible_thumb();
        if(!first_thumb)
            return;

        // If the data source supports a start page, update the page number in the URL to reflect
        // the first visible thumb.
        if(this.data_source == null || !this.data_source.supports_start_page || first_thumb.dataset.searchPage == null)
            return;

        let args = helpers.args.location;
        this.data_source.set_start_page(args, first_thumb.dataset.searchPage);
        helpers.set_page_url(args, false, "viewing-page", { send_popstate: false });

        // Refresh the "refresh from page #" icon.
        this.refresh_refresh_search_from_page();
    }

    // The thumbs actually visible onscreen have changed, or the window has gained focus.
    // Store recently viewed thumbs.
    visible_thumbs_changed = () =>
    {
        // Don't add recent illusts if we're viewing recent illusts.
        if(this.data_source && this.data_source.name == "recent")
            return;

        let visible_media_ids = [];
        for(let element of this.container.querySelectorAll(`.thumbnails > [data-id][data-visible]:not([data-special])`))
        {
            let { type, id } = helpers.parse_media_id(element.dataset.id);
            if(type != "illust")
                continue;

            visible_media_ids.push(element.dataset.id);
        }
        
        ppixiv.recently_seen_illusts.get().add_illusts(visible_media_ids);
    }

    refresh_search = () =>
    {
        main_controller.singleton.refresh_current_data_source({remove_search_page: true});
    }

    refresh_search_from_page = () =>
    {
        main_controller.singleton.refresh_current_data_source({remove_search_page: false});
    }
        
    // Set or clear the updates class on the "what's new" button.
    refresh_whats_new_button()
    {
        let last_viewed_version = settings.get("whats-new-last-viewed-version", 0);

        // This was stored as a string before, since it came from GM_info.script.version.  Make
        // sure it's an integer.
        last_viewed_version = parseInt(last_viewed_version);

        let new_updates = last_viewed_version < whats_new.latest_interesting_history_revision();
        helpers.set_class(this.container.querySelector(".whats-new-button"), "updates", new_updates);
    }

    whats_new = () =>
    {
        settings.set("whats-new-last-viewed-version", whats_new.latest_history_revision());
        this.refresh_whats_new_button();

        new whats_new({ container: document.body });
    }

    /* This scrolls the thumbnail when you hover over it.  It's sort of neat, but it's pretty
     * choppy, and doesn't transition smoothly when the mouse first hovers over the thumbnail,
     * causing it to pop to a new location. 
    onmousemove = (e) =>
    {
        var thumb = e.target.closest(".thumbnail-box a");
        if(thumb == null)
            return;

        var bounds = thumb.getBoundingClientRect();
        var x = e.clientX - bounds.left;
        var y = e.clientY - bounds.top;
        x = 100 * x / thumb.offsetWidth;
        y = 100 * y / thumb.offsetHeight;

        var img = thumb.querySelector("img.thumb");
        img.style.objectPosition = x + "% " + y + "%";
    }
*/
    onwheel = (e) =>
    {
        // Stop event propagation so we don't change images on any viewer underneath the thumbs.
        e.stopPropagation();
    };

    initial_refresh_ui()
    {
        if(this.data_source != null)
        {
            var ui_box = this.container.querySelector(".thumbnail-ui-box");
            this.data_source.initial_refresh_thumbnail_ui(ui_box, this);

            // Only show the "refresh from page" button if the data source supports start
            // pages.  If it doesn't, the two refresh buttons are equivalent.
            this.container.querySelector(".refresh-search-from-page-button").hidden = !this.data_source.supports_start_page;
        }

        this.load_expanded_media_ids();
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        // Remove listeners from the old data source.
        if(this.data_source != null)
            this.data_source.remove_update_listener(this.data_source_updated);

        // Clear the view when the data source changes.  If we leave old thumbs in the list,
        // it confuses things if we change the sort and refresh_thumbs tries to load thumbs
        // based on what's already loaded.
        let ul = this.container.querySelector(".thumbnails");
        while(ul.firstElementChild != null)
        {
            let node = ul.firstElementChild;
            node.remove();

            // We should be able to just remove the element and get a callback that it's no longer visible.
            // This works in Chrome since IntersectionObserver uses a weak ref, but Firefox is stupid and leaks
            // the node.
            for(let observer of this.intersection_observers)
                observer.unobserve(node);
        }

        this.data_source = data_source;

        // Cancel any async scroll restoration if the data source changes.
        this.cancel_restore_scroll_pos();

        // Refresh whether we're showing the local navigation widget.
        let local_search_active = this.data_source?.name == "vview" && !local_api?.local_info?.bookmark_tag_searches_only;
        helpers.set_dataset(this.container.dataset, "showNavigation", local_search_active);

        if(this.data_source == null)
            return;
        
        // If we disabled loading more pages earlier, reenable it.
        this.disable_loading_more_pages = false;

        // Disable the avatar widget unless the data source enables it.
        this.avatar_container.hidden = true;
        this.avatar_widget.set_user_id(null);

        // Listen to the data source loading new pages, so we can refresh the list.
        this.data_source.add_update_listener(this.data_source_updated);
    };

    refresh_ui = () =>
    {
        if(!this.active)
            return;

        var element_displaying = this.container.querySelector(".displaying");
        element_displaying.hidden = this.data_source.get_displaying_text == null;
        if(this.data_source.get_displaying_text != null)
        {
            // get_displaying_text can either be a string or an element.
            let text = this.data_source.get_displaying_text();
            helpers.remove_elements(element_displaying);
            if(typeof text == "string")
                element_displaying.innerText = text;
            else if(text instanceof HTMLElement)
            {
                helpers.remove_elements(element_displaying);
                element_displaying.appendChild(text);
            }
        }

        this.data_source.set_page_icon();
        helpers.set_page_title(this.data_source.page_title || "Loading...");
        
        var ui_box = this.container.querySelector(".thumbnail-ui-box");
        this.data_source.refresh_thumbnail_ui(ui_box, this);

        this.refresh_slideshow_button();
        this.refresh_ui_for_user_id();
        this.refresh_expand_manga_posts_button();
        this.refresh_refresh_search_from_page();
    };

    // Return the user ID we're viewing, or null if we're not viewing anything specific to a user.
    get viewing_user_id()
    {
        if(this.data_source == null)
            return null;
        return this.data_source.viewing_user_id;
    }

    // If the data source has an associated artist, return the "user:ID" for the user, so
    // when we navigate back to an earlier search, pulse_thumbnail will know which user to
    // flash.
    get displayed_media_id()
    {
        if(this.data_source == null)
            return super.displayed_media_id;

        let user_id = this.data_source.viewing_user_id;
        if(user_id != null)
            return "user:" + user_id;

        let folder_id = this.data_source.viewing_folder;
        if(folder_id != null)
            return folder_id;
    
        return super.displayed_media_id;
    }

    // Call refresh_ui_for_user_info with the user_info for the user we're viewing,
    // if the user ID has changed.
    async refresh_ui_for_user_id()
    {
        // If we're viewing ourself (our own bookmarks page), hide the user-related UI.
        var initial_user_id = this.viewing_user_id;
        var user_id = initial_user_id == window.global_data.user_id? null:initial_user_id;

        var user_info = await image_data.singleton().get_user_info_full(user_id);

        // Stop if the user ID changed since we started this request, or if we're no longer active.
        if(this.viewing_user_id != initial_user_id || !this.active)
            return;

        // Make a list of links to add to the top corner.
        //
        // If we reach our limit for the icons we can fit, we'll cut off at the end, so put
        // higher-priority links earlier.
        let extra_links = [];

        if(user_info != null)
        {
            extra_links.push({
                url: new URL(`/messages.php?receiver_id=${user_info.userId}`, ppixiv.location),
                type: "contact-link",
                label: "Send a message",
            });
            
            extra_links.push({
                url: new URL(`/users/${user_info.userId}/following#ppixiv`, ppixiv.location),
                type: "following-link",
                label: `View ${user_info.name}'s followed users`,
            });

            extra_links.push({
                url: new URL(`/users/${user_info.userId}/bookmarks/artworks#ppixiv`, ppixiv.location),
                type: "bookmarks-link",
                label: user_info? `View ${user_info.name}'s bookmarks`:`View bookmarks`,
            });

            extra_links.push({
                url: new URL(`/discovery/users#ppixiv?user_id=${user_info.userId}`, ppixiv.location),
                type: "similar-artists",
                label: "Similar artists",
            });
        }

        // Set the pawoo link.
        let pawoo_url = user_info?.social?.pawoo?.url;
        if(pawoo_url != null)
        {
            extra_links.push({
                url: pawoo_url,
                type: "pawoo-icon",
                label: "Pawoo",
            });
        }

        // Add the twitter link if there's one in the profile.
        let twitter_url = user_info?.social?.twitter?.url;
        if(twitter_url != null)
        {
            extra_links.push({
                url: twitter_url,
                type: "twitter-icon",
            });
        }

        // Set the circle.ms link.
        let circlems_url = user_info?.social?.circlems?.url;
        if(circlems_url != null)
        {
            extra_links.push({
                url: circlems_url,
                type: "circlems-icon",
                label: "Circle.ms",
            });
        }

        // Set the webpage link.
        //
        // If the webpage link is on a known site, disable the webpage link and add this to the
        // generic links list, so it'll use the specialized icon.
        let webpage_url = user_info?.webpage;
        if(webpage_url != null)
        {
            let type = this.find_link_image_type(webpage_url);
            extra_links.push({
                url: webpage_url,
                type: type || "webpage-link",
                label: "Webpage",
            });
        }

        // Find any other links in the user's profile text.
        if(user_info != null)
        {
            let div = document.createElement("div");
            div.innerHTML = user_info.commentHtml;

            let limit = 4;
            for(let link of div.querySelectorAll("a"))
            {
                extra_links.push({url: helpers.fix_pixiv_link(link.href)});

                // Limit these in case people have a ton of links in their profile.
                limit--;
                if(limit == 0)
                    break;
            }
        }

        // Let the data source add more links.  For Fanbox links this is usually delayed
        // since it requires an extra API call, so put this at the end to prevent the other
        // buttons from shifting around.
        if(this.data_source != null)
            this.data_source.add_extra_links(extra_links);

        // Remove any extra buttons that we added earlier.
        let row = this.container.querySelector(".button-row.user-links");
        for(let div of row.querySelectorAll(".extra-profile-link-button"))
            div.remove();
        
        // Map from link types to icons:
        let link_types = {
            ["default-icon"]: "ppixiv:link",
            ["shopping-cart"]: "mat:shopping_cart",
            ["twitter-icon"]: "ppixiv:twitter",
            ["fanbox-icon"]: "resources/icon-fanbox.svg",
            ["booth-icon"]: "ppixiv:booth",
            ["webpage-link"]: "mat:home",
            ["pawoo-icon"]: "resources/icon-pawoo.svg",
            ["circlems-icon"]: "resources/icon-circlems.svg",
            ["twitch-icon"]: "ppixiv:twitch",
            ["contact-link"]: "mat:mail",
            ["following-link"]: "resources/followed-users-eye.svg",
            ["bookmarks-link"]: "mat:star",
            ["similar-artists"]: "ppixiv:suggestions",
        };

        let seen_links = {};
        for(let {url, label, type} of extra_links)
        {
            // Don't add the same link twice if it's in more than one place.
            if(seen_links[url])
                continue;
            seen_links[url] = true;

            try {
                url = new URL(url);
            } catch(e) {
                console.log("Couldn't parse profile URL:", url);
                continue;
            }

            // Guess the link type if one wasn't supplied.
            if(type == null)
                type = this.find_link_image_type(url);

            if(type == null)
                type = "default-icon";

            let entry = this.create_template({name: "extra-link", html: `
                <div class=extra-profile-link-button>
                    <a href=# class="extra-link icon-button bulb-button popup popup-bottom" rel="noreferer noopener"></a>
                </div>
            `});

            let image_name = link_types[type];
            let icon;
            if(image_name.endsWith(".svg"))
                icon = helpers.create_ppixiv_inline(image_name);
            else
                icon = helpers.create_icon(image_name);

            icon.classList.add(type);
            entry.querySelector(".extra-link").appendChild(icon);

            let a = entry.querySelector(".extra-link");
            a.href = url;

            // If this is a Twitter link, parse out the ID.  We do this here so this works
            // both for links in the profile text and the profile itself.
            if(type == "twitter-icon")
            {
                let parts = url.pathname.split("/");
                label = parts.length > 1? ("@" + parts[1]):"Twitter";
            }

            if(label == null)
                label = a.href;
            a.dataset.popup = decodeURIComponent(label);

            // Add the node at the start, so earlier links are at the right.  This makes the
            // more important links less likely to move around.
            row.insertAdjacentElement("afterbegin", entry);
        }

        // Mute/unmute
        if(user_id != null)
        {
            let entry = this.create_template({name: "mute-link", html: `
                <div class=extra-profile-link-button>
                    <span class="extra-link icon-button bulb-button popup popup-bottom" rel="noreferer noopener">
                        <span class=material-icons>block</span>
                    </span>
                </div>
            `});
            
            let muted = muting.singleton.is_muted_user_id(user_id);
            let a = entry.querySelector(".extra-link");
            a.dataset.popup = `${muted? "Unmute":"Mute"} ${user_info?.name || "this user"}`;

            row.insertAdjacentElement("beforeend", entry);
            a.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if(muting.singleton.is_muted_user_id(user_id))
                    muting.singleton.unmute_user_id(user_id);
                else
                    await actions.add_mute(user_id, null, {type: "user"});
            });
        }

        // Tell the context menu which user is being viewed (if we're viewing a user-specific
        // search).
        main_context_menu.get.user_id = user_id;
    }

    // Refresh the slideshow button.
    refresh_slideshow_button()
    {
        // For local images, set file=*.  For Pixiv, set the media ID to *.  Leave it alone
        // if we're on the manga view and just add slideshow=1.
        let args = helpers.args.location;
        if(this.data_source.name == "vview")
            args.hash.set("file", "*");
        else if(this.data_source?.name != "manga")
            this.data_source.set_current_media_id("*", args);

        args.hash.set("slideshow", "1");
        args.hash.set("view", "illust");

        let node = this.container.querySelector("A.slideshow");
        node.href = args.url;
    }

    // Use different icons for sites where you can give the artist money.  This helps make
    // the string of icons more meaningful (some artists have a lot of them).
    find_link_image_type(url)
    {
        url = new URL(url);

        let alt_icons = {
            "shopping-cart": [
                "dlsite.com",
                "fantia.jp",
                "skeb.jp",
                "ko-fi.com",
                "dmm.co.jp",
            ],
            "twitter-icon": [
                "twitter.com",
            ],
            "fanbox-icon": [
                "fanbox.cc",
            ],
            "booth-icon": [
                "booth.pm",
            ],
            "twitch-icon": [
                "twitch.tv",
            ],
        };

        // Special case for old Fanbox URLs that were under the Pixiv domain.
        if((url.hostname == "pixiv.net" || url.hostname == "www.pixiv.net") && url.pathname.startsWith("/fanbox/"))
            return "fanbox-icon";

        for(let alt in alt_icons)
        {
            // "domain.com" matches domain.com and *.domain.com.
            for(let domain of alt_icons[alt])
            {
                if(url.hostname == domain)
                    return alt;

                if(url.hostname.endsWith("." + domain))
                    return alt;
            }
        }
        return null;
    };

    async set_active(active, { data_source, old_media_id })
    {
        if(this._active == active && this.data_source == data_source)
            return;

        this._active = active;

        await super.set_active(active);
        
        if(active)
        {
            this.set_data_source(data_source);

            this.initial_refresh_ui();
            this.refresh_ui();

            console.log("Showing search, came from media ID:", old_media_id);

            // We might get data_source_updated callbacks during load_data_source_page.
            // Make sure we ignore those, since we want the first refresh_images call
            // to be the one we make below.
            this.activating = true;
            try {
                // Make the first call to load_data_source_page, to load the initial page of images.
                await this.load_data_source_page();
            } finally {
                this.activating = false;
            }

            // Show images.  If we were displaying an image before we came here, forced_media_id
            // will force it to be included in the displayed results.
            this.finish_load_and_restore_scroll_pos(old_media_id);

            // If nothing's focused, focus the search so keyboard navigation works.  Don't do this if
            // we already have focus, so we don't steal focus from things like the tag search dropdown
            // and cause them to be closed.
            let focus = document.querySelector(":focus");
            if(focus == null)
                this.scroll_container.focus();
            else
                console.log("Already focused:", focus);
        }
        else
        {
            this.stop_pulsing_thumbnail();
            this.cancel_restore_scroll_pos();
            main_context_menu.get.user_id = null;
        }
    }

    // Wait for the initial page to finish loading, then restore the scroll position if possible.
    async finish_load_and_restore_scroll_pos(old_media_id)
    {
        // Before we can set the scroll position, we need to wait for the initial page load to finish
        // so we can create thumbnails to scroll to.
        let restore_scroll_pos_id = this.restore_scroll_pos_id = new Object();
        await this.data_source.load_page(this.data_source.initial_page, { cause: "initial scroll" });

        // Stop if we were called again while we were waiting, or if we were cancelled.
        if(restore_scroll_pos_id !== this.restore_scroll_pos_id || !this._active)
            return;

        // If the media ID isn't in the list, this might be a manga page beyond the first that
        // isn't displayed, so try the first page instead.
        if(old_media_id != null && this.get_thumbnail_for_media_id(old_media_id) == null)
            old_media_id = helpers.get_media_id_first_page(old_media_id);

        // Create the initial thumbnails.  This will happen automatically, but we need to do it now so
        // we can scroll to them.
        this.refresh_images({ forced_media_id: old_media_id });

        // If we have no saved scroll position or previous ID, scroll to the top.
        let args = helpers.args.location;
        if(args.state.scroll == null && old_media_id == null)
        {
            console.log("Scroll to top for new search");
            this.scroll_container.scrollTop = 0;
            return;
        }

        // If we have a previous media ID, try to scroll to it.
        if(old_media_id != null)
        {
            // If we were displaying an image, pulse it to make it easier to find your place.
            this.pulse_thumbnail(old_media_id);
        
            // If we're navigating backwards or toggling, and we're switching from the image UI to thumbnails,
            // try to scroll the search screen to the image that was displayed.
            if(this.scroll_to_media_id(old_media_id))
            {
                console.log("Restored scroll position to:", old_media_id);
                return;
            }

            console.log("Couldn't restore scroll position for:", old_media_id);
        }

        if(this.restore_scroll_position(args.state.scroll?.scroll_position))
            console.log("Restored scroll position from history");
    }

    // Schedule storing the scroll position, resetting the timer if it's already running.
    schedule_store_scroll_position()
    {
        if(this.scroll_position_timer != -1)
        {
            clearTimeout(this.scroll_position_timer);
            this.scroll_position_timer = -1;
        }

        this.scroll_position_timer = setTimeout(() => {
            this.store_scroll_position();
        }, 100);
    }

    // Save the current scroll position, so it can be restored from history.
    store_scroll_position()
    {
        let args = helpers.args.location;
        args.state.scroll = {
            scroll_position: this.save_scroll_position(),
            nearby_media_ids: this.get_nearby_media_ids({all: true}),
        };
        helpers.set_page_url(args, false, "viewing-page", { send_popstate: false });
    }

    // Cancel any call to restore_scroll_pos that's waiting for data.
    cancel_restore_scroll_pos()
    {
        this.restore_scroll_pos_id = null;
    }

    get active()
    {
        return this._active;
    }

    data_source_updated = () =>
    {
        this.refresh_ui();

        // Don't load or refresh images if we're in the middle of set_active.
        if(this.activating)
            return;

        this.refresh_images();
        this.load_data_source_page();
    }

    // Return all media IDs currently loaded in the data source, and the page
    // each one is on.
    get_data_source_media_ids()
    {
        let media_ids = [];
        let media_id_pages = {};
        if(this.data_source == null)
            return [media_ids, media_id_pages];

        let id_list = this.data_source.id_list;
        let min_page = id_list.get_lowest_loaded_page();
        let max_page = id_list.get_highest_loaded_page();
        for(let page = min_page; page <= max_page; ++page)
        {
            let media_ids_on_page = id_list.media_ids_by_page.get(page);
            console.assert(media_ids_on_page != null);

            // Create an image for each ID.
            for(let media_id of media_ids_on_page)
            {
                // If this is a multi-page post and manga expansion is enabled, add a thumbnail for
                // each page.  We can only do this if the data source registers thumbnail info from
                // its results, not if we have to look it up asynchronously, but almost all data sources
                // do.
                let media_ids_on_page = this.get_expanded_pages(media_id);
                if(media_ids_on_page != null)
                {
                    for(let page_media_id of media_ids_on_page)
                    {
                        media_ids.push(page_media_id);
                        media_id_pages[page_media_id] = page;
                    }
                    continue;
                }

                media_ids.push(media_id);
                media_id_pages[media_id] = page;
            }
        }

        return [media_ids, media_id_pages];
    }

    // If media_id is an expanded multi-page post, return the pages.  Otherwise, return null.
    get_expanded_pages(media_id)
    {
        if(!this.is_media_id_expanded(media_id))
            return null;

        let info = thumbnail_data.singleton().get_illust_data_sync(media_id);
        if(info == null || info.pageCount <= 1)
            return null;

        let results = [];
        let { type, id } = helpers.parse_media_id(media_id);
        for(let manga_page = 0; manga_page < info.pageCount; ++manga_page)
        {
            let page_media_id = helpers.encode_media_id({type, id, page: manga_page});
            results.push(page_media_id);
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
    // If forced_media_id is set and it's in the search results, always include it in the results,
    // extending the list to include it.  If forced_media_id is set and we also have thumbs already
    // loaded, we'll extend the range to include both.  If this would result in too many images
    // being added at once, we'll remove previously loaded thumbs so forced_media_id takes priority.
    //
    // If we have no nearby thumbs and no ID to force load, it's an initial load, so we'll just
    // start at the beginning.
    //
    // The result is always a contiguous subset of media IDs from the data source.
    get_media_ids_to_display({all_media_ids, forced_media_id, columns})
    {
        if(all_media_ids.length == 0)
            return [];

        let [first_nearby_media_id, last_nearby_media_id] = this.get_nearby_media_ids();
        let [first_loaded_media_id, last_loaded_media_id] = this.get_loaded_media_ids();

        // If we're restoring a scroll position, state.scroll_nearby_media_ids is a list of
        // the IDs that were nearby when it was saved.  For the initial refresh, load the same
        // range of nearby media IDs.
        let args = helpers.args.location;
        if(first_nearby_media_id == null && args.state.scroll?.nearby_media_ids != null)
        {
            // nearby_media_ids is all media IDs that were nearby.  Not all of them may be
            // in the list now, eg. if we're only loading page 2 but some images from page 1
            // were nearby before, so find the biggest matching range.
            let first = helpers.find_first(args.state.scroll.nearby_media_ids, all_media_ids);
            let last = helpers.find_last(args.state.scroll.nearby_media_ids, all_media_ids);
            if(first != null && last != null)
            {
                first_nearby_media_id = first;
                last_nearby_media_id = last;
            }
        }

        // The indices of each related media_id.  These can all be -1.  Note that it's
        // possible for nearby entries to not be in the data source, if the data source
        // was just refreshed and entries were removed.
        let first_nearby_media_id_idx = all_media_ids.indexOf(first_nearby_media_id);
        let last_nearby_media_id_idx = all_media_ids.indexOf(last_nearby_media_id);
        let first_loaded_media_id_idx = all_media_ids.indexOf(first_loaded_media_id);
        let last_loaded_media_id_idx = all_media_ids.indexOf(last_loaded_media_id);
        let forced_media_id_idx = all_media_ids.indexOf(forced_media_id);

        // Figure out the range of all_media_ids that we want to have loaded.
        let start_idx = 999999;
        let end_idx = 0;

        // If there are visible thumbs, extend the range to include them.
        if(first_nearby_media_id_idx != -1)
            start_idx = Math.min(start_idx, first_nearby_media_id_idx);
        if(last_nearby_media_id_idx != -1)
            end_idx = Math.max(end_idx, last_nearby_media_id_idx);

        // If we have a media ID to display, extend the range to include it.
        if(forced_media_id_idx != -1)
        {
            start_idx = Math.min(start_idx, forced_media_id_idx);
            end_idx = Math.max(end_idx, forced_media_id_idx);
        }

        // If we have a range, extend it outwards in both directions to load images
        // around it.
        if(start_idx != 999999)
        {
            start_idx -= 10;
            end_idx += 10;
        }

        // If there are thumbs already loaded, extend the range to include them.  Do this
        // after extending the range above.
        if(first_loaded_media_id_idx != -1)
            start_idx = Math.min(start_idx, first_loaded_media_id_idx);
        if(last_loaded_media_id_idx != -1)
            end_idx = Math.max(end_idx, last_loaded_media_id_idx);

        // If we don't have anything, start at the beginning.
        if(start_idx == 999999)
        {
            start_idx = 0;
            end_idx = 0;
        }

        // Clamp the range.
        start_idx = Math.max(start_idx, 0);
        end_idx = Math.min(end_idx, all_media_ids.length-1);
        end_idx = Math.max(start_idx, end_idx); // make sure start_idx <= end_idx

        // If we're forcing an image to be included, and we also have images already
        // loaded, we can end up with a huge range if the two are far apart.  For example,
        // if an image is loaded from a search, the user navigates for a long time in the
        // image view and then returns to the search, we'll load the image he ended up on
        // all the way to the images that were loaded before.  Check the number of images
        // we're adding, and if it's too big, ignore the previously loaded thumbs and just
        // load IDs around forced_media_id.
        if(forced_media_id_idx != -1)
        {
            // See how many thumbs this would cause us to load.
            let loaded_thumb_ids = new Set();
            for(let node of this.get_loaded_thumbs())
                loaded_thumb_ids.add(node.dataset.id);
    
            let loading_thumb_count = 0;
            for(let thumb_id of all_media_ids.slice(start_idx, end_idx+1))
            {
                if(!loaded_thumb_ids.has(thumb_id))
                    loading_thumb_count++;
            }

            if(loading_thumb_count > 100)
            {
                console.log("Reducing loading_thumb_count from", loading_thumb_count);

                start_idx = forced_media_id_idx - 10;
                end_idx = forced_media_id_idx + 10;
                start_idx = Math.max(start_idx, 0);
                end_idx = Math.min(end_idx, all_media_ids.length-1);
            }
        }

        // Snap the start of the range to the column count, so images always stay on the
        // same column if we add entries to the beginning of the list.  This only works if
        // the data source provides all IDs at once, but if it doesn't then we won't
        // auto-load earlier images anyway.
        if(columns != null)
            start_idx -= start_idx % columns;

        let media_ids = all_media_ids.slice(start_idx, end_idx+1);
        /*
        console.log(
            "Nearby range:", first_nearby_media_id_idx, "to", last_nearby_media_id_idx,
            "Loaded range:", first_loaded_media_id_idx, "to", last_loaded_media_id_idx,
            "Forced idx:", forced_media_id_idx,
            "Returning:", start_idx, "to", end_idx);
*/
        // Load thumbnail info for the results.  We don't wait for this to finish.
        this.load_thumbnail_data_for_media_ids(all_media_ids, start_idx, end_idx);

        return media_ids;
    }

    load_thumbnail_data_for_media_ids(all_media_ids, start_idx, end_idx)
    {
        // Stop if the range is already loaded.
        let media_ids = all_media_ids.slice(start_idx, end_idx+1);
        if(thumbnail_data.singleton().are_all_media_ids_loaded_or_loading(media_ids))
            return;

        // Make a list of IDs that need to be loaded, removing ones that are already
        // loaded.
        let media_ids_to_load = [];
        for(let media_id of media_ids)
        {
            if(!thumbnail_data.singleton().is_media_id_loaded_or_loading(media_id))
                media_ids_to_load.push(media_id);
        }

        if(media_ids_to_load.length == 0)
            return;

        // Try not to request thumbnail info in tiny chunks.  If we load them as they
        // scroll on, we'll make dozens of requests for 4-5 thumbnails each and spam
        // the API.  Avoid this by extending the list outwards, so we load a bigger chunk
        // in one request and then stop for a while.
        //
        // Don't do this for the local API.  Making lots of tiny requests is harmless
        // there since it's all local, and requesting file info causes the file to be
        // scanned if it's not yet cached, so it's better to make fine-grained requests.
        let min_to_load = this.data_source?.name == "vview"? 10: 30;

        let load_start_idx = start_idx;
        let load_end_idx = end_idx;
        while(media_ids_to_load.length < min_to_load && (load_start_idx >= 0 || load_end_idx < all_media_ids.length))
        {
            let media_id = all_media_ids[load_start_idx];
            if(media_id != null && !thumbnail_data.singleton().is_media_id_loaded_or_loading(media_id))
                media_ids_to_load.push(media_id);

            media_id = all_media_ids[load_end_idx];
            if(media_id != null && !thumbnail_data.singleton().is_media_id_loaded_or_loading(media_id))
                media_ids_to_load.push(media_id);

            load_start_idx--;
            load_end_idx++;
        }

        thumbnail_data.singleton().get_thumbnail_info(media_ids_to_load);
    }

    // Return the first and last media IDs that are nearby (or all of them if all is true).
    get_nearby_media_ids({all=false}={})
    {
        let nearby_thumbs = Array.from(this.container.querySelectorAll(`[data-id][data-nearby]:not([data-special])`));
        nearby_thumbs = nearby_thumbs.map((thumb) => thumb.dataset.id);
        if(all)
            return nearby_thumbs;
        else
            return [nearby_thumbs[0], nearby_thumbs[nearby_thumbs.length-1]];
    }

    // Return the first and last media IDs that's currently loaded into thumbs.
    get_loaded_media_ids()
    {
        let loaded_thumbs = this.container.querySelectorAll(`[data-id]:not([data-special]`);
        let first_loaded_media_id = loaded_thumbs[0]?.dataset?.id;
        let last_loaded_media_id = loaded_thumbs[loaded_thumbs.length-1]?.dataset?.id;
        return [first_loaded_media_id, last_loaded_media_id];
    }

    refresh_images = ({forced_media_id=null}={}) =>
    {
        if(this.data_source == null)
            return;
        
        let manga_view = this.data_source?.name == "manga";

        // Update the thumbnail size style.  This also tells us the number of columns being
        // displayed.
        let ul = this.container.querySelector(".thumbnails");
        let thumbnail_size = settings.get(manga_view? "manga-thumbnail-size":"thumbnail-size", 4);
        thumbnail_size = thumbnail_size_slider_widget.thumbnail_size_for_value(thumbnail_size);

        let {columns, padding, max_width, max_height, container_width} = helpers.make_thumbnail_sizing_style(ul, {
            wide: true,
            size: thumbnail_size,
            ratio: this.data_source.get_thumbnail_aspect_ratio(),

            // Limit the number of columns on most views, so we don't load too much data at once.
            // Allow more columns on the manga view, since that never loads more than one image.
            // Allow unlimited columns for local images.
            max_columns: manga_view? 15: 
                this.data_source?.name == "vview"? 100:5,

            // Set a minimum padding to make sure there's room for the popup text to fit between images.
            min_padding: 15,
        });

        this.container.style.setProperty('--thumb-width', `${max_width}px`);
        this.container.style.setProperty('--thumb-height', `${max_height}px`);
        this.container.style.setProperty('--thumb-padding', `${padding}px`);
        this.container.style.setProperty('--container-width', `${container_width}px`);

        // Save the scroll position relative to the first thumbnail.  Do this before making
        // any changes.
        let saved_scroll = this.save_scroll_position();

        // Remove special:previous-page if it's in the list.  It'll confuse the insert logic.
        // We'll add it at the end if it should be there.
        let special = this.container.querySelector(`.thumbnails > [data-special]`);
        if(special)
            special.remove();

        // Get all media IDs from the data source.
        let [all_media_ids, media_id_pages] = this.get_data_source_media_ids();

        // Sanity check: there should never be any duplicate media IDs from the data source.
        // Refuse to continue if there are duplicates, since it'll break our logic badly and
        // can cause infinite loops.  This is always a bug.
        if(all_media_ids.length != (new Set(all_media_ids)).size)
            throw Error("Duplicate media IDs");

        // Remove any thumbs that aren't present in all_media_ids, so we only need to 
        // deal with adding thumbs below.  For example, this simplifies things when
        // a manga post is collapsed.
        {
            let media_id_set = new Set(all_media_ids);
            for(let thumb of this.container.querySelectorAll(`[data-id]`))
            {
                let thumb_media_id = thumb.dataset.id;
                if(!media_id_set.has(thumb_media_id))
                    thumb.remove();
            }
        }

        // Get the thumbnail media IDs to display.
        let media_ids = this.get_media_ids_to_display({
            all_media_ids,
            columns,
            forced_media_id,
        });

        // Add thumbs.
        //
        // Most of the time we're just adding thumbs to the list.  Avoid removing or recreating
        // thumbs that aren't actually changing, which reduces flicker.
        //
        // Do this by looking for a range of thumbnails that matches a range in media_ids.
        // If we're going to display [0,1,2,3,4,5,6,7,8,9], and the current thumbs are [4,5,6],
        // then 4,5,6 matches and can be reused.  We'll add [0,1,2,3] to the beginning and [7,8,9]
        // to the end.
        //
        // Most of the time we're just appending.  The main time that we add to the beginning is
        // the "load previous results" button.

        // Make a dictionary of all illust IDs and pages, so we can look them up quickly.
        let media_id_index = {};
        for(let i = 0; i < media_ids.length; ++i)
        {
            let media_id = media_ids[i];
            media_id_index[media_id] = i;
        }

        let get_node_idx = function(node)
        {
            if(node == null)
                return null;

            let media_id = node.dataset.id;
            return media_id_index[media_id];
        }

        // Find the first match (4 in the above example).
        let first_matching_node = ul.firstElementChild;
        while(first_matching_node && get_node_idx(first_matching_node) == null)
            first_matching_node = first_matching_node.nextElementSibling;

        // If we have a first_matching_node, walk forward to find the last matching node (6 in
        // the above example).
        let last_matching_node = first_matching_node;
        if(last_matching_node != null)
        {
            // Make sure the range is contiguous.  first_matching_node and all nodes through last_matching_node
            // should match a range exactly.  If there are any missing entries, stop.
            let next_expected_idx = get_node_idx(last_matching_node) + 1;
            while(last_matching_node && get_node_idx(last_matching_node.nextElementSibling) == next_expected_idx)
            {
                last_matching_node = last_matching_node.nextElementSibling;
                next_expected_idx++;
            }
        }

        // When we remove thumbs, we'll cache them here, so if we end up reusing it we don't have
        // to recreate it.
        let removed_nodes = {};
        function remove_node(node)
        {
            node.remove();
            removed_nodes[node.dataset.id] = node;
        }

        // If we have a range, delete all items outside of it.  Otherwise, just delete everything.
        while(first_matching_node && first_matching_node.previousElementSibling)
            remove_node(first_matching_node.previousElementSibling);

        while(last_matching_node && last_matching_node.nextElementSibling)
            remove_node(last_matching_node.nextElementSibling);

        if(!first_matching_node && !last_matching_node)
        {
            while(ul.firstElementChild != null)
                remove_node(ul.firstElementChild);
        }

        // If we have a matching range, add any new elements before it.
        if(first_matching_node)
        {
           let first_idx = get_node_idx(first_matching_node);
           for(let idx = first_idx - 1; idx >= 0; --idx)
           {
               let media_id = media_ids[idx];
               let search_page = media_id_pages[media_id];
               let node = this.create_thumb(media_id, search_page, { cached_nodes: removed_nodes });
               first_matching_node.insertAdjacentElement("beforebegin", node);
               first_matching_node = node;
           }
        }

        // Add any new elements after the range.  If we don't have a range, just add everything.
        let last_idx = -1;
        if(last_matching_node)
           last_idx = get_node_idx(last_matching_node);

        for(let idx = last_idx + 1; idx < media_ids.length; ++idx)
        {
            let media_id = media_ids[idx];
            let search_page = media_id_pages[media_id];
            let node = this.create_thumb(media_id, search_page, { cached_nodes: removed_nodes });
            ul.appendChild(node);
        }

        // If this data source supports a start page and we started after page 1, add the "load more"
        // button at the beginning.
        if(this.data_source && this.data_source.initial_page > 1)
        {
            // Reuse the node if we removed it earlier.
            if(special == null)
                special = this.create_thumb("special:previous-page", null, { cached_nodes: removed_nodes });
            ul.insertAdjacentElement("afterbegin", special);
        }

        this.restore_scroll_position(saved_scroll);
    }

    // Start loading data pages that we need to display visible thumbs, and start
    // loading thumbnail data for nearby thumbs.
    async load_data_source_page()
    {
        // We load pages when the last thumbs on the previous page are loaded, but the first
        // time through there's no previous page to reach the end of.  Always make sure the
        // first page is loaded (usually page 1).
        let load_page = null;
        if(this.data_source && !this.data_source.is_page_loaded_or_loading(this.data_source.initial_page))
            load_page = this.data_source.initial_page;
        else
        {
            // If the last thumb in the list is visible, we need the next page to continue.
            // Note that since get_nearby_thumbnails returns thumbs before they actually scroll
            // into view, this will happen before the last thumb is actually visible to the user.
            let elements = this.get_nearby_thumbnails();
            if(elements.length > 0 && elements[elements.length-1].nextElementSibling == null)
            {
                let last_element = elements[elements.length-1];
                load_page = parseInt(last_element.dataset.searchPage)+1;
            }
        }

        // Hide "no results" if it's shown while we load data.
        this.container.querySelector(".no-results").hidden = true;

        if(load_page != null)
        {
            var result = await this.data_source.load_page(load_page, { cause: "thumbnails" });

            // If this page didn't load, it probably means we've reached the end, so stop trying
            // to load more pages.
            if(!result)
                this.disable_loading_more_pages = true;
        }

        // If we have no IDs and nothing is loading, the data source is empty (no results).
        if(this.data_source?.no_results)
            this.container.querySelector(".no-results").hidden = false;
        
        this.set_visible_thumbs();
    }

    // Handle clicks on the "load previous results" button.
    //
    // If we let the regular click handling in main_controller.set_current_data_source do this,
    // it'll notice that the requested page isn't loaded and create a new data source.  We know
    // we can view the previous page, so special case this so we don't lose the pages that are
    // already loaded.
    //
    // This can also trigger for the "return to start" button if we happen to be on page 2.
    thumbnail_onclick = async(e) =>
    {
        let page_count_box = e.target.closest(".expand-button");
        if(page_count_box)
        {
            e.preventDefault();
            e.stopPropagation();
            let id_node = page_count_box.closest("[data-id]");
            let media_id = id_node.dataset.id;
            this.set_media_id_expanded(media_id, !this.is_media_id_expanded(media_id));
            return;
        }

        // This only matters if the data source supports start pages.
        if(!this.data_source.supports_start_page)
            return;

        let a = e.target.closest("A");
        if(a == null)
            return;

        if(a.classList.contains("load-previous-page-link"))
        {
            let page = this.data_source.id_list.get_lowest_loaded_page() - 1;
            this.load_page(page);

            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }

    // See if we can load page in-place.  Return true if we were able to, and the click that
    // requested it should be cancelled, or false if we can't and it should be handled as a
    // regular navigation.
    async load_page(page)
    {
        // We can only add pages that are immediately before or after the pages we currently have.
        let min_page = this.data_source.id_list.get_lowest_loaded_page();
        let max_page = this.data_source.id_list.get_highest_loaded_page();
        if(page < min_page-1)
            return false;
        if(page > max_page+1)
            return false;
        
        console.log("Loading page:", page);
        await this.data_source.load_page(page, { cause: "previous page" });
        return true;
    }

    // Save the current scroll position relative to the first visible thumbnail.
    // The result can be used with restore_scroll_position.
    save_scroll_position()
    {
        let first_visible_thumb_node = this.get_first_visible_thumb();
        if(first_visible_thumb_node == null)
            return null;

        return {
            saved_scroll: helpers.save_scroll_position(this.scroll_container, first_visible_thumb_node),
            media_id: first_visible_thumb_node.dataset.id,
        }
    }

    // Restore the scroll position from a position saved by save_scroll_position.
    restore_scroll_position(scroll)
    {
        if(scroll == null)
            return false;

        // Find the thumbnail for the media_id the scroll position was saved at.
        let restore_scroll_position_node = this.get_thumbnail_for_media_id(scroll.media_id);
        if(restore_scroll_position_node == null)
            return false;

        helpers.restore_scroll_position(this.scroll_container, restore_scroll_position_node, scroll.saved_scroll);
        return true;
    }

    // Set whether the given thumb is expanded.
    //
    // We can store a thumb being explicitly expanded or explicitly collapsed, overriding the
    // current default.
    set_media_id_expanded(media_id, new_value)
    {
        let page = helpers.media_id_to_illust_id_and_page(media_id)[1];
        media_id = helpers.get_media_id_first_page(media_id);

        this.expanded_media_ids.set(media_id, new_value);
        this.save_expanded_media_ids();

        // This will cause thumbnails to be added or removed, so refresh.
        this.refresh_images();

        // Refresh whether we're showing the expansion border.  refresh_images sets this when it's
        // created, but it doesn't handle refreshing it.
        let thumb = this.get_thumbnail_for_media_id(media_id);
        this.refresh_expanded_thumb(thumb);

        if(!new_value)
        {
            media_id = helpers.get_media_id_first_page(media_id);

            // If we're collapsing a manga post on the first page, we know we don't need to
            // scroll since the user clicked the first page.  Leave it where it is so we don't
            // move the button he clicked around.  If we're collapsing a later page, scroll
            // the first page onscreen so we don't end up in a random scroll position two pages down.
            if(page != 0)
                this.scroll_to_media_id(helpers.get_media_id_first_page(media_id));
        }
    }

    // Set whether thumbs are expanded or collapsed by default.
    toggle_expanding_media_ids_by_default()
    {
        // If the new setting is the same as the expand_manga_thumbnails setting, just
        // remove expand-thumbs.  Otherwise, set it to the overridden setting.
        let args = helpers.args.location;
        let new_value = !this.media_ids_expanded_by_default;
        if(new_value == settings.get("expand_manga_thumbnails"))
            args.hash.delete("expand-thumbs");
        else
            args.hash.set("expand-thumbs", new_value? "1":"0");

        // Clear manually expanded/unexpanded thumbs, and navigate to the new setting.
        delete args.state.expanded_media_ids;
        helpers.set_page_url(args, true, "viewing-page");
    }

    load_expanded_media_ids()
    {
        // Load expanded_media_ids.
        let args = helpers.args.location;
        let media_ids = args.state.expanded_media_ids ?? {};
        this.expanded_media_ids = new Map(Object.entries(media_ids));

        // Load media_ids_expanded_by_default.
        let expand_thumbs = args.hash.get("expand-thumbs");
        if(expand_thumbs == null)
            this.media_ids_expanded_by_default = settings.get("expand_manga_thumbnails");
        else
            this.media_ids_expanded_by_default = expand_thumbs == "1";
    }

    // Store this.expanded_media_ids to history.
    save_expanded_media_ids()
    {
        let args = helpers.args.location;
        args.state.expanded_media_ids = Object.fromEntries(this.expanded_media_ids);
        helpers.set_page_url(args, false, "viewing-page", { send_popstate: false });
    }

    is_media_id_expanded(media_id)
    {
        // Never expand manga posts on data sources that include manga pages themselves.
        // This can result in duplicate media IDs.
        if(this.data_source?.includes_manga_pages)
            return false;

        media_id = helpers.get_media_id_first_page(media_id);

        // Only illust IDs can be expanded.
        let { type } = helpers.parse_media_id(media_id);
        if(type != "illust")
            return false;

        // Check if the user has manually expanded or collapsed the image.
        if(this.expanded_media_ids.has(media_id))
            return this.expanded_media_ids.get(media_id);

        // The media ID hasn't been manually expanded or unexpanded.  If we're not expanding
        // by default, it's unexpanded.
        if(!this.media_ids_expanded_by_default)
            return false;

        // If the image is muted, never expand it by default, even if we're set to expand by default.
        // We'll just show a wall of muted thumbs.
        let info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(info != null)
        {
            let muted_tag = muting.singleton.any_tag_muted(info.tagList);
            let muted_user = muting.singleton.is_muted_user_id(info.userId);
            if(muted_tag || muted_user)
                return false;
        }

        // Otherwise, it's expanded by default if it has more than one page.
        if(info == null || info.pageCount == 1)
            return false;

        return true;
    }

    // Refresh the expanded-thumb class on thumbnails after expanding or unexpanding a manga post.
    refresh_expanded_thumb(thumb)
    {
        if(thumb == null)
            return;

        // Don't set expanded-thumb on the manga view, since it's always expanded.
        let media_id = thumb.dataset.id;
        let show_expanded = !this.data_source?.includes_manga_pages && this.is_media_id_expanded(media_id);
        helpers.set_class(thumb, "expanded-thumb", show_expanded);

        let info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);        
        let [illust_id, illust_page] = helpers.media_id_to_illust_id_and_page(media_id);
        
        helpers.set_class(thumb, "expanded-manga-post", show_expanded);
        helpers.set_class(thumb, "first-manga-page", illust_page == 0);

        // Show the page count if this is a multi-page post (unless we're on the
        // manga view itself).
        if(info.pageCount > 1 && this.data_source?.name != "manga")
        {
            let pageCountBox = thumb.querySelector(".manga-info-box");
            pageCountBox.hidden = false;

            let text = show_expanded? `${illust_page+1}/${info.pageCount}`:info.pageCount;
            thumb.querySelector(".manga-info-box .page-count").textContent = text;
            thumb.querySelector(".manga-info-box .page-count").hidden = false;

            let page_count_box2 = thumb.querySelector(".show-manga-pages-button");
            page_count_box2.hidden = false;
            page_count_box2.href = `/artworks/${illust_id}#ppixiv?manga=1`;
        }
    }

    // Refresh all expanded thumbs.  This is only needed if the default changes.
    refresh_expanded_thumb_all()
    {
        for(let thumb of this.get_loaded_thumbs())
            this.refresh_expanded_thumb(thumb);
    }

    // Refresh the highlight for the "expand all posts" button.
    refresh_expand_manga_posts_button()
    {
        let enabled = this.media_ids_expanded_by_default;
        let button = this.container.querySelector(".expand-manga-posts");
        button.dataset.popup = enabled? "Collapse manga posts":"Expand manga posts";
        button.querySelector(".material-icons").innerText = enabled? "close_fullscreen":"open_in_full";
        
        // Hide the button if the data source can never return manga posts to be expanded, or
        // if it's the manga page itself which always expands.
        button.hidden =
            !this.data_source?.can_return_manga ||
            this.data_source?.includes_manga_pages;
    }

    refresh_refresh_search_from_page()
    {
        // Refresh the "refresh from page #" button popup.
        let start_page = this.data_source.get_start_page(helpers.args.location);
        this.container.querySelector(".refresh-search-from-page-button").dataset.popup = `Refresh search from page ${start_page}`;
    }

    update_from_settings = () =>
    {
        this.load_expanded_media_ids(); // in case expand_manga_thumbnails has changed
        this.set_visible_thumbs();
        this.refresh_images();
        this.refresh_expanded_thumb_all();

        document.body.dataset.theme = "dark"; //settings.get("theme");
        helpers.set_class(document.body, "disable-thumbnail-panning", settings.get("disable_thumbnail_panning") || ppixiv.ios);
        helpers.set_class(document.body, "disable-thumbnail-zooming", settings.get("disable_thumbnail_zooming") || ppixiv.ios);
        helpers.set_class(document.body, "ui-on-hover", settings.get("ui-on-hover") && !ppixiv.ios);
        // helpers.set_class(this.container.querySelector(".recent-history-link"), "disabled", !ppixiv.recently_seen_illusts.get().enabled);
        this.refresh_expand_manga_posts_button();

        // Flush the top UI transition, so it doesn't animate weirdly when toggling ui-on-hover.
        for(let box of document.querySelectorAll(".top-ui-box"))
        {
            box.classList.add("disable-transition");
            box.offsetHeight;
            box.classList.remove("disable-transition");
        }
    }

    // Set the URL for all loaded thumbnails that are onscreen.
    //
    // This won't trigger loading any data (other than the thumbnails themselves).
    set_visible_thumbs({force=false}={})
    {
        // Make a list of IDs that we're assigning.
        var elements = this.get_nearby_thumbnails();
        for(var element of elements)
        {
            let media_id = element.dataset.id;
            if(media_id == null)
                continue;

            let [illust_id, illust_page] = helpers.media_id_to_illust_id_and_page(media_id);

            let { id: thumb_id, type: thumb_type } = helpers.parse_media_id(media_id);

            // For illustrations, get thumbnail info.  If we don't have it yet, skip the image (leave it pending)
            // and we'll come back once we have it.
            if(thumb_type == "illust" || thumb_type == "file" || thumb_type == "folder")
            {
                // Get thumbnail info.
                var info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
                if(info == null)
                    continue;
            }
            
            // Leave it alone if it's already been loaded.
            if(!force && !("pending" in element.dataset))
                continue;

            // Why is this not working in FF?  It works in the console, but not here.  Sandboxing
            // issue?
            // delete element.dataset.pending;
            element.removeAttribute("data-pending");

            if(thumb_type == "user" || thumb_type == "bookmarks")
            {
                // This is a user thumbnail rather than an illustration thumbnail.  It just shows a small subset
                // of info.
                let user_id = thumb_id;

                var link = element.querySelector("a.thumbnail-link");
                if(thumb_type == "user")
                    link.href = `/users/${user_id}/artworks#ppixiv`;
                else
                    link.href = `/users/${user_id}/bookmarks/artworks#ppixiv`;

                link.dataset.userId = user_id;

                let quick_user_data = thumbnail_data.singleton().get_quick_user_data(user_id);
                if(quick_user_data == null)
                {
                    // We should always have this data for users if the data source asked us to display this user.
                    throw "Missing quick user data for user ID " + user_id;
                }
                
                var thumb = element.querySelector(".thumb");
                thumb.src = quick_user_data.profileImageUrl;

                var label = element.querySelector(".thumbnail-label");
                label.hidden = false;
                label.querySelector(".label").innerText = quick_user_data.userName;

                continue;
            }

            if(thumb_type != "illust" && thumb_type != "file" && thumb_type != "folder")
                throw "Unexpected thumb type: " + thumb_type;

            // Set this thumb.
            let { page } = helpers.parse_media_id(media_id);
            let url = info.previewUrls[page];
            var thumb = element.querySelector(".thumb");

            // Check if this illustration is muted (blocked).
            var muted_tag = muting.singleton.any_tag_muted(info.tagList);
            var muted_user = muting.singleton.is_muted_user_id(info.userId);
            if(muted_tag || muted_user)
            {
                // The image will be obscured, but we still shouldn't load the image the user blocked (which
                // is something Pixiv does wrong).  Load the user profile image instead.
                thumb.src = thumbnail_data.singleton().get_profile_picture_url(info.userId);
                element.classList.add("muted");

                let muted_label = element.querySelector(".muted-label");

                // Quick hack to look up translations, since we're not async:
                (async() => {
                    if(muted_tag)
                        muted_tag = await tag_translations.get().get_translation(muted_tag);
                    muted_label.textContent = muted_tag? muted_tag:info.userName;
                })();

                // We can use this if we want a "show anyway' UI.
                thumb.dataset.mutedUrl = url;
            }
            else
            {
                thumb.src = url;
                element.classList.remove("muted");

                // Try to set up the aspect ratio.
                this.thumb_image_load_finished(element, { cause: "setup" });
            }

            // Set the link.  Setting dataset.mediaId will allow this to be handled with in-page
            // navigation, and the href will allow middle click, etc. to work normally.
            var link = element.querySelector("a.thumbnail-link");
            if(thumb_type == "folder")
            {
                // This is a local directory.  We only expect to see this while on the local
                // data source.  The folder link retains any search parameters in the URL.
                let args = helpers.args.location;
                local_api.get_args_for_id(media_id, args);
                link.href = args.url;

                element.querySelector(".manga-info-box").hidden = false;
            }
            else
            {
                link.href = helpers.get_url_for_id(media_id).url;
            }

            link.dataset.mediaId = media_id;
            link.dataset.userId = info.userId;

            element.querySelector(".ugoira-icon").hidden = info.illustType != 2 && info.illustType != "video";

            helpers.set_class(element, "dot", helpers.tags_contain_dot(info));

            // Set expanded-thumb if this is an expanded manga post.  This is also updated in
            // set_media_id_expanded.  Set the border to a random-ish value to try to make it
            // easier to see the boundaries between manga posts.  It's hard to guarantee that it
            // won't be the same color as a neighboring post, but that's rare.  Using the illust
            // ID means the color will always be the same.  The saturation is a bit low so these
            // colors aren't blinding.
            this.refresh_expanded_thumb(element);
            helpers.set_class(link, "first-page", illust_page == 0);
            helpers.set_class(link, "last-page", illust_page == info.pageCount-1);
            link.style.borderBottomColor = `hsl(${illust_id}deg 50% 50%)`;

            this.refresh_bookmark_icon(element);

            // Set the label.  This is only actually shown in following views.
            var label = element.querySelector(".thumbnail-label");
            if(thumb_type == "folder")
            {
                // The ID is based on the filename.  Use it to show the directory name in the thumbnail.
                let parts = media_id.split("/");
                let basename = parts[parts.length-1];
                let label = element.querySelector(".thumbnail-label");
                label.hidden = false;
                label.querySelector(".label").innerText = basename;
            } else {
                label.hidden = true;
            }
        }        

        if(this.data_source != null)
        {
            // Set the link for the first page and previous page buttons.  Most of the time this is handled
            // by our in-page click handler.
            let page = this.data_source.get_start_page(helpers.args.location);
            let previous_page_link = this.container.querySelector("a.load-previous-page-link");
            if(previous_page_link)
            {
                let args = helpers.args.location;
                this.data_source.set_start_page(args, page-1);
                previous_page_link.href = args.url;
            }
        }
    }

    // Set things up based on the image dimensions.  We can do this immediately if we know the
    // thumbnail dimensions already, otherwise we'll do it based on the thumbnail once it loads.
    thumb_image_load_finished(element, { cause })
    {
        if(element.dataset.thumbLoaded)
            return;

        let media_id = element.dataset.id;
        let [illust_id, illust_page] = helpers.media_id_to_illust_id_and_page(media_id);
        let thumb = element.querySelector(".thumb");

        // Try to use thumbnail info first.  Preferring this makes things more consistent,
        // since naturalWidth may or may not be loaded depending on browser cache.
        let width, height;
        if(illust_page == 0)
        {
            let info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
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
        // but it can be different on the manga page.
        let thumb_aspect_ratio = thumb.offsetWidth / thumb.offsetHeight;
        // console.log(`Thumbnail ${media_id} loaded at ${cause}: ${width} ${height} ${thumb.src}`);
        helpers.set_thumbnail_panning_direction(element, width, height, thumb_aspect_ratio);
    }

    // Refresh the thumbnail for media_id.
    //
    // This is used to refresh the bookmark icon when changing a bookmark.
    refresh_thumbnail = (media_id) =>
    {
        // If this is a manga post, refresh all thumbs for this media ID, since bookmarking
        // a manga post is shown on all pages if it's expanded.
        let thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(thumbnail_info == null)
            return;

        for(let page = 0; page < thumbnail_info.pageCount; ++page)
        {
            media_id = helpers.get_media_id_for_page(media_id, page);
            let thumbnail_element = this.get_thumbnail_for_media_id(media_id);
            if(thumbnail_element != null)
                this.refresh_bookmark_icon(thumbnail_element);
        }
    }

    // Set the bookmarked heart for thumbnail_element.  This can change if the user bookmarks
    // or un-bookmarks an image.
    refresh_bookmark_icon(thumbnail_element)
    {
        if(this.data_source && this.data_source.name == "manga")
            return;

        var media_id = thumbnail_element.dataset.id;
        if(media_id == null)
            return;

        // Get thumbnail info.
        var thumbnail_info = thumbnail_data.singleton().get_one_thumbnail_info(media_id);
        if(thumbnail_info == null)
            return;

        var show_bookmark_heart = thumbnail_info.bookmarkData != null;
        if(this.data_source != null && !this.data_source.show_bookmark_icons)
            show_bookmark_heart = false;
        
        thumbnail_element.querySelector(".heart.public").hidden = !show_bookmark_heart || thumbnail_info.bookmarkData.private;
        thumbnail_element.querySelector(".heart.private").hidden = !show_bookmark_heart || !thumbnail_info.bookmarkData.private;
    }

    // Force all thumbnails to refresh after the mute list changes, to refresh mutes.
    refresh_after_mute_change = () =>
    {
        // Force the update to refresh thumbs that have already been created.
        this.set_visible_thumbs({force: true});

        // Refresh the user ID-dependant UI so we refresh the mute/unmute button.
        this.refresh_ui_for_user_id();
    }

    // Return a list of thumbnails that are either visible, or close to being visible
    // (so we load thumbs before they actually come on screen).
    get_nearby_thumbnails()
    {
        // If the container has a zero height, that means we're hidden and we don't want to load
        // thumbnail data at all.
        if(this.container.offsetHeight == 0)
            return [];

        // Don't include data-special, which are non-thumb entries like "load previous results".
        return this.container.querySelectorAll(`.thumbnails > [data-id][data-nearby]:not([data-special])`);
    }

    get_loaded_thumbs()
    {
        return this.container.querySelectorAll(`.thumbnails > [data-id]:not([data-special])`);
    }

    // Create a thumb placeholder.  This doesn't load the image yet.
    //
    // media_id is the illustration this will be if it's displayed, or null if this
    // is a placeholder for pages we haven't loaded.  page is the page this illustration
    // is on (whether it's a placeholder or not).
    //
    // cached_nodes is a dictionary of previously-created nodes that we can reuse.
    create_thumb(media_id, search_page, { cached_nodes })
    {
        if(cached_nodes[media_id] != null)
        {
            let result = cached_nodes[media_id];
            delete cached_nodes[media_id];
            return result;
        }

        let entry = null;
        if(media_id == "special:previous-page")
        {
            entry = this.create_template({ name: "load-previous-results", html: `
                <div class="thumbnail-load-previous">
                    <div class=load-previous-buttons>
                        <a class="load-previous-button load-previous-page-link" href=#>
                            Load previous results
                        </a>
                    </div>
                </div>
            `});
        }
        else
        {
            entry = this.create_template({ name: "template-thumbnail", html: `
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

                            <div class=manga-info-box style="cursor: pointer;" hidden>
                                <a class=show-manga-pages-button hidden>
                                    <span style="font-size: 16px;" class="material-icons">pages</span>
                                </a>

                                <span class=expand-button>
                                    <span class=page-icon>
                                        <img class=regular src="ppixiv:resources/page-icon.png">
                                        <img class=hover src="ppixiv:resources/page-icon-hover.png">
                                    </span>
                                    <span class=page-count hidden>1234</span>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class=muted-text>
                        <span>Muted:</span>
                        <span class=muted-label></span>
                    </div>
                </div>
            `});
        }

        // If this is a non-thumb entry, mark it so we ignore it for "nearby thumb" handling, etc.
        if(media_id == "special:previous-page")
            entry.dataset.special = 1;

        // Mark that this thumb hasn't been filled in yet.
        entry.dataset.pending = true;
        entry.dataset.id = media_id;

        if(search_page != null)
            entry.dataset.searchPage = search_page;
        for(let observer of this.intersection_observers)
            observer.observe(entry);
        return entry;
    }

    // This is called when thumbnail_data has loaded more thumbnail info.
    thumbs_loaded = (e) =>
    {
        this.set_visible_thumbs();
    }

    // Scroll to media_id if it's available.  This is called when we display the thumbnail view
    // after coming from an illustration.
    scroll_to_media_id(media_id)
    {
        let thumb = this.get_thumbnail_for_media_id(media_id);
        if(thumb == null)
            return false;

        this.scroll_container.scrollTop = thumb.offsetTop + thumb.offsetHeight/2 - this.scroll_container.offsetHeight/2;
        return true;
    };

    pulse_thumbnail(media_id)
    {
        let thumb = this.get_thumbnail_for_media_id(media_id);
        if(thumb == null)
            return;

        this.stop_pulsing_thumbnail();

        this.flashing_image = thumb;
        thumb.classList.add("flash");
    };

    // Work around a bug in CSS animations: even if animation-iteration-count is 1,
    // the animation will play again if the element is hidden and displayed again, which
    // causes previously-flashed thumbnails to flash every time we exit and reenter
    // thumbnails.
    stop_pulsing_thumbnail()
    {
        if(this.flashing_image == null)
            return;

        this.flashing_image.classList.remove("flash");
        this.flashing_image = null;
    };

    // Handle submitting searches on the user search page.
    submit_user_search = (e) =>
    {
        let search = this.container.querySelector(".user-search-box input.search-users").value;
        let url = new URL("/search_user.php#ppixiv", ppixiv.location);
        url.searchParams.append("nick", search);
        url.searchParams.append("s_mode", "s_usr");
        helpers.set_page_url(url, true);
    }
    
    handle_onkeydown(e)
    {
        // Pressing ^F while on the local search focuses the search box.
        if(this.data_source.name == "vview" && e.key.toUpperCase() == "F" && e.ctrlKey)
        {
            this.container.querySelector(".local-tag-search-box input").focus();
            e.preventDefault();
            e.stopPropagation();
        }
    }
};

