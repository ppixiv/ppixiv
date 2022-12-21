// /tags
//
// The new tag search UI is a bewildering mess:
// 
// - Searching for a tag goes to "/tags/TAG/artworks".  This searches all posts with the
// tag.  The API query is "/ajax/search/artworks/TAG".  The "top" tab is highlighted, but
// it's not actually on that tab and no tab button goes back here.  "Illustrations, Manga,
// Ugoira" in search options also goes here.
// 
// - The "Illustrations" tab goes to "/tags/TAG/illustrations".  The API is
// "/ajax/search/illustrations/TAG?type=illust_and_ugoira".  This is almost identical to
// "artworks", but excludes posts marked as manga.  "Illustrations, Ugoira"  in search
// options also goes here.
// 
// - Clicking "manga" goes to "/tags/TAG/manga".  The API is "/ajax/search/manga" and also
// sets type=manga.  This is "Manga" in the search options.  This page is also useless.
//
// The "manga only" and "exclude manga" pages are useless, since Pixiv doesn't make any
// useful distinction between "manga" and "illustrations with more than one page".  We
// only include them for completeness.
// 
// - You can search for just animations, but there's no button for it in the UI.  You
// have to pick it from the dropdown in search options.  This one is "illustrations?type=ugoira".
// Why did they keep using type just for one search mode?  Saying "type=manga" or any
// other type fails, so it really is just used for this.
// 
// - Clicking "Top" goes to "/tags/TAG" with no type.  This is a completely different
// page and API, "/ajax/search/top/TAG".  It doesn't actually seem to be a rankings
// page and just shows the same thing as the others with a different layout, so we
// ignore this and treat it like "artworks".
import DataSource, { TagDropdownWidget } from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import TagListWidget from 'vview/widgets/tag-list-widget.js';
import SavedSearchTags from 'vview/misc/saved-search-tags.js';
import { TagSearchBoxWidget } from 'vview/widgets/tag-search-dropdown.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_Search extends DataSource
{
    get name() { return "search"; }

    constructor(url)
    {
        super(url);

        // Add the search tags to tag history.  We only do this at the start when the
        // data source is created, not every time we navigate back to the search.
        let tag = this._search_tags;
        if(tag)
            SavedSearchTags.add(tag);

        this.cache_search_title();
    }

    get supports_start_page() { return true; }

    get no_results()
    {
        // Don't display "No Results" while we're still waiting for the user to enter a tag.
        if(!this._search_tags)
            return false;

        return super.no_results;
    }

    get _search_tags()
    {
        return helpers._get_search_tags_from_url(this.url);
    }

    // Return the search type from the URL.  This is one of "artworks", "illustrations"
    // or "novels" (not supported).  It can also be omitted, which is the "top" page,
    // but that gives the same results as "artworks" with a different page layout, so
    // we treat it as "artworks".
    get _search_type()
    {
        // ["", "tags", tag list, type]
        let url = helpers.get_url_without_language(this.url);
        let parts = url.pathname.split("/");
        if(parts.length >= 4)
            return parts[3];
        else
            return "artworks";
    }

    startup()
    {
        super.startup();

        // Refresh our title when translations are toggled.
        ppixiv.settings.addEventListener("disable-translations", this.cache_search_title);
    }

    shutdown()
    {
        super.shutdown();
        ppixiv.settings.removeEventListener("disable-translations", this.cache_search_title);
    }

    cache_search_title = async() =>
    {
        this.title = "Search: ";
        let tags = this._search_tags;
        if(tags)
        {
            tags = await ppixiv.tag_translations.translate_tag_list(tags, "en");
            var tag_list = document.createElement("span");
            for(let tag of tags)
            {
                // Force "or" lowercase.
                if(tag.toLowerCase() == "or")
                    tag = "or";
                
                var span = document.createElement("span");
                span.innerText = tag;
                span.classList.add("word");
                if(tag == "or")
                    span.classList.add("or");
                else if(tag == "(" || tag == ")")
                    span.classList.add("paren");
                else
                    span.classList.add("tag");
                
                tag_list.appendChild(span);
            }

            this.title += tags.join(" ");
            this.displaying_tags = tag_list;
        }
        
        // Update our page title.
        this.call_update_listeners();
    }

    async load_page_internal(page)
    {
        let args = { };
        this.url.searchParams.forEach((value, key) => { args[key] = value; });

        args.p = page;

        // "artworks" and "illustrations" are different on the search page: "artworks" uses "/tag/TAG/artworks",
        // and "illustrations" is "/tag/TAG/illustrations?type=illust_and_ugoira".
        let search_type = this._search_type;
        let search_mode = this.get_url_search_mode();
        let api_search_type = null;
        if(search_mode == "all")
        {
            // "artworks" doesn't use the type field.
            api_search_type = "artworks";
        }
        else if(search_mode == "illust")
        {
            api_search_type = "illustrations";
            args.type = "illust_and_ugoira";
        }
        else if(search_mode == "manga")
        {
            api_search_type = "manga";
            args.type = "manga";
        }
        else if(search_mode == "ugoira")
        {
            api_search_type = "illustrations";
            args.type = "ugoira";
        }
        else
            console.error("Invalid search type:", search_type);

        let tag = this._search_tags;

        // If we have no tags, we're probably on the "/tags" page, which is just a list of tags.  Don't
        // run a search with no tags.
        if(!tag)
        {
            console.log("No search tags");
            return;
        }

        var url = "/ajax/search/" + api_search_type + "/" + encodeURIComponent(tag);

        var result = await helpers.get_request(url, args);
        let body = result.body;

        // Store related tags.  Only do this the first time and don't change it when we read
        // future pages, so the tags don't keep changing as you scroll around.
        if(this.related_tags == null)
        {
            this.related_tags = body.relatedTags;
            this.dispatchEvent(new Event("_refresh_ui"));
        }

        // Add translations.
        let translations = [];
        for(let tag of Object.keys(body.tagTranslation))
        {
            translations.push({
                tag: tag,
                translation: body.tagTranslation[tag],
            });
        }
        ppixiv.tag_translations.add_translations(translations);

        // /tag/TAG/illustrations returns results in body.illust.
        // /tag/TAG/artworks returns results in body.illustManga.
        // /tag/TAG/manga returns results in body.manga.
        let illusts = body.illust || body.illustManga || body.manga;
        illusts = illusts.data;

        // Populate thumbnail data with this data.
        await ppixiv.media_cache.add_media_infos_partial(illusts, "normal");

        let media_ids = [];
        for(let illust of illusts)
            media_ids.push(helpers.illust_id_to_media_id(illust.id));

        // Register the new page of data.
        this.add_page(page, media_ids);
    }

    get page_title()
    {
        return this.title;
    }

    get_displaying_text()
    {
        return this.displaying_tags ?? "Search works";
    };

    // Return the search mode, which is selected by the "Type" search option.  This generally
    // corresponds to the underlying page's search modes.
    get_url_search_mode()
    {
        // "/tags/tag/illustrations" has a "type" parameter with the search type.  This is used for
        // "illust" (everything except animations) and "ugoira".
        let search_type = this._search_type;
        if(search_type == "illustrations")
        {
            let query_search_type = this.url.searchParams.get("type");
            if(query_search_type == "ugoira") return "ugoira";
            if(query_search_type == "illust") return "illust";

            // If there's no parameter, show everything.
            return "all";
        }
        
        if(search_type == "artworks")
            return "all";
        if(search_type == "manga")
            return "manga";

        // Use "all" for unrecognized types.
        return "all";
    }

    // Return URL with the search mode set to mode.
    set_url_search_mode(url, mode)
    {
        url = new URL(url);
        url = helpers.get_url_without_language(url);

        // Only "ugoira" searches use type in the query.  It causes an error in other modes, so remove it.
        if(mode == "illust")
            url.searchParams.set("type", "illust");
        else if(mode == "ugoira")
            url.searchParams.set("type", "ugoira");
        else
            url.searchParams.delete("type");

        let search_type = "artworks";
        if(mode == "manga")
            search_type = "manga";
        else if(mode == "ugoira" || mode == "illust")
            search_type = "illustrations";

        // Set the type in the URL.
        let parts = url.pathname.split("/");
        parts[3] = search_type;
        url.pathname = parts.join("/");
        return url;
    }

    get ui()
    {
        return class extends Widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class=tag-search-with-related-tags>
                            <vv-container class=tag-search-box-container></vv-container>

                            ${ helpers.create_box_link({label: "Related tags",    icon: "bookmark", classes: ["related-tags-button"] }) }
                        </div>

                        <div class="box-button-row search-options-row">
                            ${ helpers.create_box_link({label: "Ages",    classes: ["ages-button"] }) }
                            ${ helpers.create_box_link({label: "Sort",    classes: ["sort-button"] }) }
                            ${ helpers.create_box_link({label: "Type",    classes: [["search-type-button"]] }) }
                            ${ helpers.create_box_link({label: "Search mode",    classes: ["search-mode-button"] }) }
                            ${ helpers.create_box_link({label: "Image size",    classes: ["image-size-button"] }) }
                            ${ helpers.create_box_link({label: "Aspect ratio",    classes: ["aspect-ratio-button"] }) }
                            ${ helpers.create_box_link({label: "Bookmarks",    classes: ["bookmark-count-button", "premium-only"] }) }
                            ${ helpers.create_box_link({label: "Time",    classes: ["time-ago-button"] }) }
                            ${ helpers.create_box_link({label: "Reset", popup: "Clear all search options", classes: ["reset-search"] }) }
                        </div>
                    </div>
                `});

                this.data_source = data_source;
                this.data_source.addEventListener("_refresh_ui", () => this.refresh(), this._signal);

                class related_tag_dropdown extends TagDropdownWidget
                {
                    constructor({...options})
                    {
                        super({...options});

                        this.relatedTagWidget = new TagListWidget({
                            contents: this.container,
                        });

                        this.refresh_tags();
                    }

                    refresh_tags()
                    {
                        if(this.data_source.related_tags && this.relatedTagWidget)
                            this.relatedTagWidget.set(this.data_source.related_tags);
                    }
                };

                this.tag_dropdown = new DropdownMenuOpener({
                    button: this.querySelector(".related-tags-button"),
                    create_box: ({...options}) => new related_tag_dropdown({ data_source, ...options }),
                });

                data_source.setup_dropdown(this.querySelector(".ages-button"), [{
                    create_options: { label: "All",  dataset: { default: true } },
                    setup_options: { fields: {mode: null} },
                }, {
                    create_options: { label: "All ages" },
                    setup_options: { fields: {mode: "safe"} },
                }, {
                    create_options: { label: "R18", classes: ["r18"] },
                    setup_options: { fields: {mode: "r18"} },
                }]);

                data_source.setup_dropdown(this.querySelector(".sort-button"), [{
                    create_options: { label: "Newest",              dataset: { default: true } },
                    setup_options: { fields: {order: null}, default_values: {order: "date_d"} }
                }, {
                    create_options: { label: "Oldest" },
                    setup_options: { fields: {order: "date"} }
                }, {
                    create_options: { label: "Popularity",          classes: ["premium-only"] },
                    setup_options: { fields: {order: "popular_d"} }
                }, {
                    create_options: { label: "Popular with men",    classes: ["premium-only"] },
                    setup_options: { fields: {order: "popular_male_d"} }
                }, {
                    create_options: { label: "Popular with women",  classes: ["premium-only"] },
                    setup_options:  { fields: {order: "popular_female_d"} }
                }]);

                let url_format = "tags/tag/type";
                data_source.setup_dropdown(this.querySelector(".search-type-button"), [{
                    create_options: { label: "All",             dataset: { default: true } },
                    setup_options: {
                        url_format,
                        fields: {"/type": "artworks", type: null},
                    }
                }, {
                    create_options: { label: "Illustrations" },
                    setup_options: {
                        url_format,
                        fields: {"/type": "illustrations", type: "illust"},
                    }
                }, {
                    create_options: { label: "Manga" },
                    setup_options: {
                        url_format,
                        fields: {"/type": "manga", type: null},
                    }
                }, {
                    create_options: { label: "Animations" },
                    setup_options: {
                        url_format,
                        fields: {"/type": "illustrations", type: "ugoira"},
                    }
                }]);

                data_source.setup_dropdown(this.querySelector(".search-mode-button"), [{
                    create_options: { label: "Tag",               dataset: { default: true } },
                    setup_options: { fields: {s_mode: null}, default_values: {s_mode: "s_tag"} },
                }, {
                    create_options: { label: "Exact tag match" },
                    setup_options:  { fields: {s_mode: "s_tag_full"} },
                }, {
                    create_options: { label: "Text search" },
                    setup_options:  { fields: {s_mode: "s_tc"} },
                }]);

                data_source.setup_dropdown(this.querySelector(".image-size-button"), [{
                    create_options: { label: "All",               dataset: { default: true } },
                    setup_options: { fields: {wlt: null, hlt: null, wgt: null, hgt: null} },
                }, {
                    create_options: { label: "High-res" },
                    setup_options: { fields: {wlt: 3000, hlt: 3000, wgt: null, hgt: null} },
                }, {
                    create_options: { label: "Medium-res" },
                    setup_options: { fields: {wlt: 1000, hlt: 1000, wgt: 2999, hgt: 2999} },
                }, {
                    create_options: { label: "Low-res" },
                    setup_options: { fields: {wlt: null, hlt: null, wgt: 999, hgt: 999} },
                }]);

                data_source.setup_dropdown(this.querySelector(".aspect-ratio-button"), [{
                    create_options: {label: "All",               icon: "", dataset: { default: true } },
                    setup_options: { fields: {ratio: null} },
                }, {
                    create_options: {label: "Landscape",         icon: "panorama" },
                    setup_options: { fields: {ratio: "0.5"} },
                }, {
                    create_options: {label: "Portrait",          icon: "portrait" },
                    setup_options: { fields: {ratio: "-0.5"} },
                }, {
                    create_options: {label: "Square",            icon: "crop_square" },
                    setup_options: { fields: {ratio: "0"} },
                }]);

                // The Pixiv search form shows 300-499, 500-999 and 1000-.  That's not
                // really useful and the query parameters let us filter differently, so we
                // replace it with a more useful "minimum bookmarks" filter.
                data_source.setup_dropdown(this.querySelector(".bookmark-count-button"), [{
                    create_options: { label: "All",               data_type: "bookmarks-all",    dataset: { default: true } },
                    setup_options: { fields: {blt: null, bgt: null} },
                }, {
                    create_options: { label: "100+",              data_type: "bookmarks-100" },
                    setup_options: { fields: {blt: 100, bgt: null} },
                }, {
                    create_options: { label: "250+",              data_type: "bookmarks-250" },
                    setup_options: { fields: {blt: 250, bgt: null} },
                }, {
                    create_options: { label: "500+",              data_type: "bookmarks-500" },
                    setup_options: { fields: {blt: 500, bgt: null} },
                }, {
                    create_options: { label: "1000+",             data_type: "bookmarks-1000" },
                    setup_options: { fields: {blt: 1000, bgt: null} },
                }, {
                    create_options: { label: "2500+",             data_type: "bookmarks-2500" },
                    setup_options: { fields: {blt: 2500, bgt: null} },
                }, {
                    create_options: { label: "5000+",             data_type: "bookmarks-5000" },
                    setup_options: { fields: {blt: 5000, bgt: null} },
                }]);

                // The time-ago dropdown has a custom layout, so create it manually.
                new DropdownMenuOpener({
                    button: this.querySelector(".time-ago-button"),
                    create_box: ({...options}) => {
                        let dropdown = new Widget({
                            ...options,
                            template: `
                                <div class=vertical-list>
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
                            `,
                        });

                        // The time filter is a range, but I'm not sure what time zone it filters in
                        // (presumably either JST or UTC).  There's also only a date and not a time,
                        // which means you can't actually filter "today", since there's no way to specify
                        // which "today" you mean.  So, we offer filtering starting at "this week",
                        // and you can just use the default date sort if you want to see new posts.
                        // For "this week", we set the end date a day in the future to make sure we
                        // don't filter out posts today.
                        data_source.set_item(dropdown, { type: "time-all", fields: {scd: null, ecd: null} });

                        let format_date = (date) =>
                        {
                            return (date.getYear() + 1900).toFixed().padStart(2, "0") + "-" +
                                    (date.getMonth() + 1).toFixed().padStart(2, "0") + "-" +
                                    date.getDate().toFixed().padStart(2, "0");
                        };

                        let set_date_filter = (name, start, end) =>
                        {
                            let start_date = format_date(start);
                            let end_date = format_date(end);
                            data_source.set_item(dropdown, { type: name, fields: {scd: start_date, ecd: end_date} });
                        };

                        let tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
                        let last_week = new Date(); last_week.setDate(last_week.getDate() - 7);
                        let last_month = new Date(); last_month.setMonth(last_month.getMonth() - 1);
                        let last_year = new Date(); last_year.setFullYear(last_year.getFullYear() - 1);
                        set_date_filter("time-week", last_week, tomorrow);
                        set_date_filter("time-month", last_month, tomorrow);
                        set_date_filter("time-year", last_year, tomorrow);
                        for(let years_ago = 1; years_ago <= 7; ++years_ago)
                        {
                            let start_year = new Date(); start_year.setFullYear(start_year.getFullYear() - years_ago - 1);
                            let end_year = new Date(); end_year.setFullYear(end_year.getFullYear() - years_ago);
                            set_date_filter("time-years-ago-" + years_ago, start_year, end_year);
                        }

                        // The "reset search" button removes everything in the query except search terms, and resets
                        // the search type.
                        let box = this.querySelector(".reset-search");
                        let url = new URL(this.data_source.url);
                        let tag = helpers._get_search_tags_from_url(url);
                        url.search = "";
                        if(tag == null)
                            url.pathname = "/tags";
                        else
                            url.pathname = "/tags/" + encodeURIComponent(tag) + "/artworks";
                        box.href = url;

                        return dropdown;
                    },
                });

                // Create the tag dropdown for the search page input.
                this.tag_search_box = new TagSearchBoxWidget({ container: this.querySelector(".tag-search-box-container") });

                // Fill the search box with the current tag.
                //
                // Add a space to the end, so another tag can be typed immediately after focusing an existing search.
                let search = this.data_source._search_tags;
                if(search)
                    search += " ";
                this.querySelector(".tag-search-box .input-field-container > input").value = search;
            }

            refresh()
            {
                super.refresh();

                helpers.set_class(this.querySelector(".related-tags-button"), "disabled", this.data_source.related_tags == null);
            }
        }
    }
}
