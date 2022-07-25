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
                    <div class="icon-button toggle-local-navigation-button popup" data-popup="Show navigation" hidden>
                        ${ helpers.create_icon("mat:keyboard_double_arrow_left") }
                    </div>

                    <a class="icon-button disable-ui-button popup pixiv-only" data-popup="Return to Pixiv" href="#no-ppixiv">
                        ${ helpers.create_icon("ppixiv:pixiv") }
                    </a>

                    <!-- These login/logout buttons are only used by the local API. -->
                    <div class="login-button icon-button popup" data-popup="Login" hidden>
                        ${ helpers.create_icon("login") }
                    </div>

                    <div class="logout-button icon-button popup" data-popup="Logout" hidden>
                        ${ helpers.create_icon("logout") }
                    </div>

                    <!-- Containing block for :hover highlights on the button: -->
                    <div class=pixiv-only>
                        <div class="icon-button popup-menu-box-button popup parent-highlight" data-popup="Search">
                            ${ helpers.create_icon("menu") }
                        </div>

                        <div hidden class="main-search-menu popup-menu-box vertical-list"></div>
                    </div>

                    <div class="refresh-search-button icon-button popup" data-popup="Refresh">
                        ${ helpers.create_icon("refresh") }
                    </div>

                    <div class="refresh-search-from-page-button icon-button popup" data-popup="Refresh from page">
                        ${ helpers.create_icon("restart_alt") }
                    </div>

                    <div class="expand-manga-posts icon-button popup">
                        ${ helpers.create_icon("") /* filled in by refresh_expand_manga_posts_button */ }
                    </div>

                    <div class="icon-button whats-new-button popup" data-popup="What's New">
                        ${ helpers.create_icon("ppixiv:whats_new") }
                    </div>

                    <a class="slideshow icon-button popup" data-popup="Slideshow" href="#">
                        ${ helpers.create_icon("wallpaper") }
                    </a>

                    <div class="settings-menu-box popup" data-popup="Preferences">
                        <div class="parent-highlight icon-button preferences-button">
                            ${ helpers.create_icon("settings") }
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

                        ${ helpers.create_box_link({ popup: "Accepting requests", icon: "paid",   data_type: "accepting-requests" }) }
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
                                    ${ helpers.create_icon("search") }
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
                            ${ helpers.create_icon("search") }
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
                                ${ helpers.create_icon("clear") }
                            </span>

                            <span class="submit-local-search-button right-side-button">
                                ${ helpers.create_icon("search") }
                            </span>
                        </div>
                    </div>

                    <div class="box-button-row">
                        <span class="popup icon-button copy-local-path" data-popup="Copy local path to clipboard">
                            ${ helpers.create_icon("content_copy") }
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
                            ${ helpers.create_box_link({label: "New bookmarks", data_type: "local-sort-bookmark-created-at-desc" }) }
                            ${ helpers.create_box_link({label: "Old bookmarks", data_type: "local-sort-bookmark-created-at-asc" }) }
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

                    <div class=thumbnail-container-box></div>
                </div>
            </div>
        `});

        user_cache.addEventListener("usermodified", this.refresh_ui, { signal: this.shutdown_signal.signal });        

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
 
        this.container.querySelector(".refresh-search-button").addEventListener("click", this.refresh_search);
        this.container.querySelector(".refresh-search-from-page-button").addEventListener("click", this.refresh_search_from_page);
        this.container.querySelector(".whats-new-button").addEventListener("click", this.whats_new);
        this.container.querySelector(".expand-manga-posts").addEventListener("click", (e) => {
            this.search_view.toggle_expanding_media_ids_by_default();
        });

        // Set up login/logout buttons for native.
        if(ppixiv.native)
        {
            let { logged_in, local } = local_api.local_info;
            this.container.querySelector(".login-button").hidden = local || logged_in;
            this.container.querySelector(".logout-button").hidden = local || !logged_in;
            this.container.querySelector(".login-button").addEventListener("click", () => { local_api.redirect_to_login(); });
            this.container.querySelector(".logout-button").addEventListener("click", () => {
                if(confirm("Log out?"))
                    local_api.logout();
            });
        }

        // Clear recent illusts:
        this.container.querySelector("[data-type='clear-recents']").addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();

            await ppixiv.recently_seen_illusts.get().clear();
            this.refresh_search();
        });

        this.container.querySelector(".preferences-button").addEventListener("click", (e) => {
            new ppixiv.settings_dialog();
        });

        settings.addEventListener("theme", this.update_from_settings, { signal: this.shutdown_signal.signal });
        settings.addEventListener("ui-on-hover", this.update_from_settings, { signal: this.shutdown_signal.signal });
        settings.addEventListener("no-hide-cursor", this.update_from_settings, { signal: this.shutdown_signal.signal });
        settings.addEventListener("no_recent_history", this.update_from_settings, { signal: this.shutdown_signal.signal });
        settings.addEventListener("expand_manga_thumbnails", this.update_from_settings, { signal: this.shutdown_signal.signal });
        muting.singleton.addEventListener("mutes-changed", this.refresh_ui_for_user_id);

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
            
        if(ppixiv.local_api.is_enabled() && !local_api.local_info.bookmark_tag_searches_only)
        {
            // False if the user has hidden the navigation tree.  Default to false on mobile, since
            // it takes up a lot of screen space.
            this.local_navigation_visible = !ppixiv.mobile;

            this.local_nav_widget = new ppixiv.local_navigation_widget({
                parent: this,
                container: local_navigation_box,
            });

            this.toggle_local_navigation_button = this.container.querySelector(".toggle-local-navigation-button");
            this.toggle_local_navigation_button.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.local_navigation_visible = !this.local_navigation_visible;
                this.refresh_ui();
                
                // Refresh the search view, so it updates the columns to fill the extra space.
                this.search_view.refresh_images();
            });        
        }

        // Hack: if the local API isn't enabled, hide the local navigation box completely.  This shouldn't
        // be needed since it'll hide itself, but this prevents it from flashing onscreen and animating
        // away when the page loads.  That'll still happen if you have the local API enabled and you're on
        // a Pixiv page, but this avoids the visual glitch for most users.  I'm not sure how to fix this
        // cleanly.
        local_navigation_box.hidden = !ppixiv.local_api.is_enabled();

        this.container.querySelector(".copy-local-path").addEventListener("click", (e) => {
            this.data_source.copy_link();
        });

        // Handle submitting searches on the user search page.
        this.container.querySelector(".user-search-box .search-submit-button").addEventListener("click", this.submit_user_search);
        helpers.input_handler(this.container.querySelector(".user-search-box input.search-users"), this.submit_user_search);

        /*
         * Add a slight delay before hiding the UI.  This allows opening the UI by swiping past the top
         * of the window, without it disappearing as soon as the mouse leaves the window.  This doesn't
         * affect opening the UI.
         */
        new hover_with_delay(this.container.querySelector(".top-ui-box"), 0, 0.25);

        this.search_view = new search_view({
            parent: this,
            container: this.container.querySelector(".thumbnail-container-box"),
            onstartpagechanged: () => {
                this.refresh_refresh_search_from_page();
            },
        });
        
        this.update_from_settings();
        this.refresh_whats_new_button();
    }

    update_from_settings = () =>
    {
        document.documentElement.dataset.theme = "dark"; //settings.get("theme");
        helpers.set_class(document.body, "ui-on-hover", settings.get("ui-on-hover") && !ppixiv.mobile);
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
        ];


        let create_option = (option) => {
            let button = new menu_option_button({
                container: option_box,
                parent: this,
                onclick: option.onclick,
                ...option
            })

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

    get active()
    {
        return this._active;
    }

    async set_active(active, { data_source, old_media_id })
    {
        if(this._active == active && this.data_source == data_source)
            return;

        this._active = active;

        await super.set_active(active);
        
        if(active)
        {
            console.log("Showing search, came from media ID:", old_media_id);
            this.set_data_source(data_source);

            this.initial_refresh_ui();
            this.refresh_ui();
        }
        else
        {
            main_context_menu.get.user_id = null;
        }

        await this.search_view.set_active(active, { data_source, old_media_id });
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        // Remove listeners from the old data source.
        if(this.data_source != null)
            this.data_source.remove_update_listener(this.data_source_updated);

        this.data_source = data_source;

        if(this.data_source == null)
        {
            this.refresh_ui();
            return;
        }

        // Disable the avatar widget unless the data source enables it.
        this.avatar_container.hidden = true;
        this.avatar_widget.set_user_id(null);

        // Listen to the data source loading new pages, so we can refresh the list.
        this.data_source.add_update_listener(this.data_source_updated);
        this.refresh_ui();
    };

    data_source_updated = () =>
    {
        this.refresh_ui();
    }

    refresh_search = () =>
    {
        main_controller.refresh_current_data_source({remove_search_page: true});
    }

    refresh_search_from_page = () =>
    {
        main_controller.refresh_current_data_source({remove_search_page: false});
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

        new whats_new();
    }

    initial_refresh_ui()
    {
        if(this.data_source == null)
            return;

        let ui_box = this.container.querySelector(".thumbnail-ui-box");
        this.data_source.initial_refresh_thumbnail_ui(ui_box, this);

        // Only show the "refresh from page" button if the data source supports start
        // pages.  If it doesn't, the two refresh buttons are equivalent.
        this.container.querySelector(".refresh-search-from-page-button").hidden = !this.data_source.supports_start_page;
    }

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

        // Refresh whether we're showing the local navigation widget and toggle button.
        let local_search_active = this.data_source?.name == "vview" && !local_api?.local_info?.bookmark_tag_searches_only;
        helpers.set_dataset(this.container.dataset, "showNavigation", local_search_active && this.local_navigation_visible);
        if(this.toggle_local_navigation_button)
        {
            this.toggle_local_navigation_button.hidden = this.local_nav_widget == null || !local_search_active;
            this.toggle_local_navigation_button.querySelector(".font-icon").innerText = this.local_navigation_visible?
                "keyboard_double_arrow_left":"keyboard_double_arrow_right";
        }

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
    refresh_ui_for_user_id = async() =>
    {
        // If we're viewing ourself (our own bookmarks page), hide the user-related UI.
        var initial_user_id = this.viewing_user_id;
        var user_id = initial_user_id == window.global_data.user_id? null:initial_user_id;

        var user_info = await user_cache.get_user_info_full(user_id);

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
            ["request"]: "mat:paid",
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
                    <a href=# class="extra-link icon-button popup popup-bottom" rel="noreferer noopener"></a>
                </div>
            `});

            let image_name = link_types[type];
            let icon;
            if(image_name.endsWith(".svg"))
                icon = helpers.create_ppixiv_inline(image_name);
            else
                icon = helpers.create_icon(image_name, { as_element: true });

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
                    <span class="extra-link icon-button popup popup-bottom" rel="noreferer noopener">
                        ${ helpers.create_icon("block") }
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
        let node = this.container.querySelector("A.slideshow");
        node.href = page_manager.singleton().slideshow_url.url;
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

    // Handle submitting searches on the user search page.
    submit_user_search = (e) =>
    {
        let search = this.container.querySelector(".user-search-box input.search-users").value;
        let url = new URL("/search_user.php#ppixiv", ppixiv.location);
        url.searchParams.append("nick", search);
        url.searchParams.append("s_mode", "s_usr");
        helpers.set_page_url(url, true);
    }
    
    async handle_onkeydown(e)
    {
        if(e.repeat)
            return;

        if(this.data_source.name == "vview")
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
                local_api.navigate_to_tag_search(text, {add_to_history: false});
            }
        }
    }

    // Refresh the highlight for the "expand all posts" button.
    refresh_expand_manga_posts_button()
    {
        let enabled = this.search_view.media_ids_expanded_by_default;
        let button = this.container.querySelector(".expand-manga-posts");
        button.dataset.popup = enabled? "Collapse manga posts":"Expand manga posts";
        button.querySelector(".font-icon").innerText = enabled? "close_fullscreen":"open_in_full";
        
        // Hide the button if the data source can never return manga posts to be expanded, or
        // if it's the manga page itself which always expands.
        button.hidden =
            !this.data_source?.can_return_manga ||
            this.data_source?.includes_manga_pages;
    }

    refresh_refresh_search_from_page()
    {
        // Refresh the "refresh from page #" button popup.  This is updated by search_view
        // as the user scrolls.
        let start_page = this.data_source.get_start_page(helpers.args.location);
        this.container.querySelector(".refresh-search-from-page-button").dataset.popup = `Refresh search from page ${start_page}`;
    }
}

// Set the page URL to a slideshow, but don't actually start the slideshow.  This lets the
// user bookmark the slideshow URL before the illust ID changes from "*" to an actual ID.
// This is mostly just a workaround for an iOS UI bug: there's no way to create a home
// screen bookmark for a link, only for a URL that's already loaded.
//
// This is usually used from the search screen, but there's currently no good place to put
// it there, so it's inside the settings menu and technically can be accessed while viewing
// an image.
ppixiv.slideshow_staging_dialog = class extends ppixiv.dialog_widget
{
    static show()
    {
        let slideshow_args = page_manager.singleton().slideshow_url;
        if(slideshow_args == null)
            return;

        // Set the slideshow URL without sending popstate, so it'll be the current browser URL
        // that can be bookmarked but we won't actually navigate to it.  We don't want to navigate
        // to it since that'll change the placeholder "*" illust ID to a real illust ID, which
        // isn't what we want to bookmark.
        helpers.set_page_url(slideshow_args, true, "navigation", { send_popstate: false });

        new slideshow_staging_dialog();
    }

    constructor({...options}={})
    {
        super({...options, template: `
            <div class=header>Slideshow</div>
            <div class=items>
                This page can be bookmarked. or added to the home screen on iOS.<br>
                <br>
                The bookmark will begin a slideshow with the current search.
            </div>
        `});

        this.url = helpers.args.location;
    }

    visibility_changed()
    {
        super.visibility_changed();

        if(!this.visible)
        {
            // If the URL is still pointing at the slideshow, back out to restore the original
            // URL.  This is needed if we're exiting from the user clicking out of the dialog,
            // but don't do it if we're exiting from browser back.
            if(helpers.args.location.toString() == this.url.toString())
                history.back();
        }
    }
};

