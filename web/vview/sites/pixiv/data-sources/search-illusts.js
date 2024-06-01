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
import DataSource from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import SavedSearchTags from '/vview/misc/saved-search-tags.js';
import { TagSearchBoxWidget } from '/vview/widgets/tag-search-dropdown.js';
import { DropdownMenuOpener } from '/vview/widgets/dropdown.js';
import { helpers } from '/vview/misc/helpers.js';

export default class DataSource_Search extends DataSource
{
    get name() { return "search"; }
    get ui() { return UI; }

    constructor(args)
    {
        super(args);

        // Add the search tags to tag history.  We only do this at the start when the
        // data source is created, not every time we navigate back to the search.
        let tag = this._searchTags;
        if(tag)
            SavedSearchTags.add(tag);

        this.cacheSearchTitle();
    }

    get supportsStartPage() { return true; }

    get hasNoResults()
    {
        // Don't display "No Results" while we're still waiting for the user to enter a tag.
        if(!this._searchTags)
            return false;

        return super.hasNoResults;
    }

    get _searchTags()
    {
        return helpers.pixiv.getSearchTagsFromUrl(this.url);
    }

    // Return the search type from the URL.  This is one of "artworks", "illustrations"
    // or "novels" (not supported).  It can also be omitted, which is the "top" page,
    // but that gives the same results as "artworks" with a different page layout, so
    // we treat it as "artworks".
    get _searchType()
    {
        // ["", "tags", tag list, type]
        let url = helpers.pixiv.getUrlWithoutLanguage(this.url);
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
        ppixiv.settings.addEventListener("disable-translations", this.cacheSearchTitle);
    }

    shutdown()
    {
        super.shutdown();
        ppixiv.settings.removeEventListener("disable-translations", this.cacheSearchTitle);
    }

    cacheSearchTitle = async() =>
    {
        this.title = "Search: ";
        let tags = this._searchTags;
        if(tags)
        {
            tags = await ppixiv.tagTranslations.translateTagList(tags, "en");
            let tagList = document.createElement("vv-container");
            for(let tag of tags)
            {
                // Force "or" lowercase.
                if(tag.toLowerCase() == "or")
                    tag = "or";
                
                let span = document.createElement("span");
                span.innerText = tag;
                span.classList.add("word");
                if(tag == "or")
                    span.classList.add("or");
                else if(tag == "(" || tag == ")")
                    span.classList.add("paren");
                else
                    span.classList.add("tag");
                
                tagList.appendChild(span);
            }

            this.title += tags.join(" ");
            this.displayingTags = tagList;
        }
        
        // Update our page title.
        this.callUpdateListeners();
    }

    async loadPageInternal(page)
    {
        let args = { };
        this.url.searchParams.forEach((value, key) => { args[key] = value; });

        args.p = page;

        // "artworks" and "illustrations" are different on the search page: "artworks" uses "/tag/TAG/artworks",
        // and "illustrations" is "/tag/TAG/illustrations?type=illust_and_ugoira".
        let searchType = this._searchType;
        let searchMode = this.getUrlSearchMode();
        let apiSearchType = null;
        if(searchMode == "all")
        {
            // "artworks" doesn't use the type field.
            apiSearchType = "artworks";
        }
        else if(searchMode == "illust")
        {
            apiSearchType = "illustrations";
            args.type = "illust_and_ugoira";
        }
        else if(searchMode == "manga")
        {
            apiSearchType = "manga";
            args.type = "manga";
        }
        else if(searchMode == "ugoira")
        {
            apiSearchType = "illustrations";
            args.type = "ugoira";
        }
        else
            console.error("Invalid search type:", searchType);

        let tag = this._searchTags;

        // If we have no tags, we're probably on the "/tags" page, which is just a list of tags.  Don't
        // run a search with no tags.
        if(!tag)
        {
            console.log("No search tags");
            return;
        }

        let url = "/ajax/search/" + apiSearchType + "/" + encodeURIComponent(tag);

        let result = await helpers.pixivRequest.get(url, args);
        let body = result.body;

        // Store related tags.  Only do this the first time and don't change it when we read
        // future pages, so the tags don't keep changing as you scroll around.
        if(this.relatedTags == null)
        {
            this.relatedTags = body.relatedTags;
            this.callUpdateListeners();
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
        ppixiv.tagTranslations.addTranslations(translations);

        // /tag/TAG/illustrations returns results in body.illust.
        // /tag/TAG/artworks returns results in body.illustManga.
        // /tag/TAG/manga returns results in body.manga.
        let illusts = body.illust || body.illustManga || body.manga;
        illusts = illusts.data;

        // Populate thumbnail data with this data.
        let mediaIds = await ppixiv.mediaCache.addMediaInfosPartial(illusts, "normal");
        return { mediaIds };
    }

    get pageTitle()
    {
        return this.title;
    }

    getDisplayingText()
    {
        return this.displayingTags ?? "Search works";
    };

    // Return the search mode, which is selected by the "Type" search option.  This generally
    // corresponds to the underlying page's search modes.
    getUrlSearchMode()
    {
        // "/tags/tag/illustrations" has a "type" parameter with the search type.  This is used for
        // "illust" (everything except animations) and "ugoira".
        let searchType = this._searchType;
        if(searchType == "illustrations")
        {
            let querySearchType = this.url.searchParams.get("type");
            if(querySearchType == "ugoira") return "ugoira";
            if(querySearchType == "illust") return "illust";

            // If there's no parameter, show everything.
            return "all";
        }
        
        if(searchType == "artworks")
            return "all";
        if(searchType == "manga")
            return "manga";

        // Use "all" for unrecognized types.
        return "all";
    }

    // Return URL with the search mode set to mode.
    setUrlSearchMode(url, mode)
    {
        url = new URL(url);
        url = helpers.pixiv.getUrlWithoutLanguage(url);

        // Only "ugoira" searches use type in the query.  It causes an error in other modes, so remove it.
        if(mode == "illust")
            url.searchParams.set("type", "illust");
        else if(mode == "ugoira")
            url.searchParams.set("type", "ugoira");
        else
            url.searchParams.delete("type");

        let searchType = "artworks";
        if(mode == "manga")
            searchType = "manga";
        else if(mode == "ugoira" || mode == "illust")
            searchType = "illustrations";

        // Set the type in the URL.
        let parts = url.pathname.split("/");
        parts[3] = searchType;
        url.pathname = parts.join("/");
        return url;
    }
}

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div>
                <div class=tag-search-with-related-tags>
                    <vv-container class=tag-search-box-container></vv-container>
                </div>

                <div class=box-button-row>
                    ${ helpers.createBoxLink({label: "Ages",    classes: ["ages-button"] }) }
                    ${ helpers.createBoxLink({label: "Sort",    classes: ["sort-button"] }) }
                    ${ helpers.createBoxLink({label: "Type",    classes: [["search-type-button"]] }) }
                    ${ helpers.createBoxLink({label: "Search mode",    classes: ["search-mode-button"] }) }
                    ${ helpers.createBoxLink({label: "Image size",    classes: ["image-size-button"] }) }
                    ${ helpers.createBoxLink({label: "Aspect ratio",    classes: ["aspect-ratio-button"] }) }
                    ${ helpers.createBoxLink({label: "Bookmarks",    classes: ["bookmark-count-button", "premium-only"] }) }
                    ${ helpers.createBoxLink({label: "Time",    classes: ["time-ago-button"] }) }
                    ${ helpers.createBoxLink({label: "Hide AI",    popup: "Show only R18 works",   dataType: "hide-ai" }) }
                    ${ helpers.createBoxLink({label: "Reset", popup: "Clear all search options", classes: ["reset-search"] }) }
                </div>
            </div>
        `});

        this.dataSource = dataSource;
        this.dataSource.addEventListener("updated", () => this.refresh(), this._signal);

        dataSource.setupDropdown(this.querySelector(".ages-button"), [{
            createOptions: { label: "All",  dataset: { default: true } },
            setupOptions: { fields: {mode: null} },
        }, {
            createOptions: { label: "All ages" },
            setupOptions: { fields: {mode: "safe"} },
        }, {
            createOptions: { label: "R18", classes: ["r18"] },
            setupOptions: { fields: {mode: "r18"} },
        }]);

        dataSource.setupDropdown(this.querySelector(".sort-button"), [{
            createOptions: { label: "Newest",              dataset: { default: true } },
            setupOptions: { fields: {order: null}, defaults: {order: "date_d"} }
        }, {
            createOptions: { label: "Oldest" },
            setupOptions: { fields: {order: "date"} }
        }, {
            createOptions: { label: "Popularity",          classes: ["premium-only"] },
            setupOptions: { fields: {order: "popular_d"} }
        }, {
            createOptions: { label: "Popular with men",    classes: ["premium-only"] },
            setupOptions: { fields: {order: "popular_male_d"} }
        }, {
            createOptions: { label: "Popular with women",  classes: ["premium-only"] },
            setupOptions:  { fields: {order: "popular_female_d"} }
        }]);

        let urlFormat = "tags/tag/type";
        dataSource.setupDropdown(this.querySelector(".search-type-button"), [{
            createOptions: { label: "All",             dataset: { default: true } },
            setupOptions: {
                urlFormat,
                fields: {"/type": "artworks", type: null},
            }
        }, {
            createOptions: { label: "Illustrations" },
            setupOptions: {
                urlFormat,
                fields: {"/type": "illustrations", type: "illust"},
            }
        }, {
            createOptions: { label: "Manga" },
            setupOptions: {
                urlFormat,
                fields: {"/type": "manga", type: null},
            }
        }, {
            createOptions: { label: "Animations" },
            setupOptions: {
                urlFormat,
                fields: {"/type": "illustrations", type: "ugoira"},
            }
        }]);

        dataSource.setItem(this.root, {
            type: "hide-ai",
            toggle: true,
            fields: {ai_type: "1"},
        });

        // Hide "Hide AI" if the user's global setting hides it.  This API doesn't really
        // make sense, it would be a lot cleaner if the global setting just set the default.
        if(ppixiv.pixivInfo.hideAiWorks)
            this.root.querySelector(`[data-type='hide-ai']`).hidden = true;

        dataSource.setupDropdown(this.querySelector(".search-mode-button"), [{
            createOptions: { label: "Tag",               dataset: { default: true } },
            setupOptions: { fields: {s_mode: null}, defaults: {s_mode: "s_tag"} },
        }, {
            createOptions: { label: "Exact tag match" },
            setupOptions:  { fields: {s_mode: "s_tag_full"} },
        }, {
            createOptions: { label: "Text search" },
            setupOptions:  { fields: {s_mode: "s_tc"} },
        }]);

        dataSource.setupDropdown(this.querySelector(".image-size-button"), [{
            createOptions: { label: "All",               dataset: { default: true } },
            setupOptions: { fields: {wlt: null, hlt: null, wgt: null, hgt: null} },
        }, {
            createOptions: { label: "High-res" },
            setupOptions: { fields: {wlt: 3000, hlt: 3000, wgt: null, hgt: null} },
        }, {
            createOptions: { label: "Medium-res" },
            setupOptions: { fields: {wlt: 1000, hlt: 1000, wgt: 2999, hgt: 2999} },
        }, {
            createOptions: { label: "Low-res" },
            setupOptions: { fields: {wlt: null, hlt: null, wgt: 999, hgt: 999} },
        }]);

        dataSource.setupDropdown(this.querySelector(".aspect-ratio-button"), [{
            createOptions: {label: "All",               icon: "", dataset: { default: true } },
            setupOptions: { fields: {ratio: null} },
        }, {
            createOptions: {label: "Landscape",         icon: "panorama" },
            setupOptions: { fields: {ratio: "0.5"} },
        }, {
            createOptions: {label: "Portrait",          icon: "portrait" },
            setupOptions: { fields: {ratio: "-0.5"} },
        }, {
            createOptions: {label: "Square",            icon: "crop_square" },
            setupOptions: { fields: {ratio: "0"} },
        }]);

        // The Pixiv search form shows 300-499, 500-999 and 1000-.  That's not
        // really useful and the query parameters let us filter differently, so we
        // replace it with a more useful "minimum bookmarks" filter.
        dataSource.setupDropdown(this.querySelector(".bookmark-count-button"), [{
            createOptions: { label: "All",               dataType: "bookmarks-all",    dataset: { default: true } },
            setupOptions: { fields: {blt: null, bgt: null} },
        }, {
            createOptions: { label: "100+",              dataType: "bookmarks-100" },
            setupOptions: { fields: {blt: 100, bgt: null} },
        }, {
            createOptions: { label: "250+",              dataType: "bookmarks-250" },
            setupOptions: { fields: {blt: 250, bgt: null} },
        }, {
            createOptions: { label: "500+",              dataType: "bookmarks-500" },
            setupOptions: { fields: {blt: 500, bgt: null} },
        }, {
            createOptions: { label: "1000+",             dataType: "bookmarks-1000" },
            setupOptions: { fields: {blt: 1000, bgt: null} },
        }, {
            createOptions: { label: "2500+",             dataType: "bookmarks-2500" },
            setupOptions: { fields: {blt: 2500, bgt: null} },
        }, {
            createOptions: { label: "5000+",             dataType: "bookmarks-5000" },
            setupOptions: { fields: {blt: 5000, bgt: null} },
        }]);

        // The time-ago dropdown has a custom layout, so create it manually.
        new DropdownMenuOpener({
            button: this.querySelector(".time-ago-button"),
            createDropdown: ({...options}) => {
                let dropdown = new Widget({
                    ...options,
                    template: `
                        <div class=vertical-list>
                            ${ helpers.createBoxLink({label: "All",               dataType: "time-all",  dataset: { default: true } }) }
                            ${ helpers.createBoxLink({label: "This week",         dataType: "time-week", dataset: { shortLabel: "Weekly" } }) }
                            ${ helpers.createBoxLink({label: "This month",        dataType: "time-month" }) }
                            ${ helpers.createBoxLink({label: "This year",         dataType: "time-year" }) }

                            <div class=years-ago>
                                ${ helpers.createBoxLink({label: "1",             dataType: "time-years-ago-1", dataset: { shortLabel: "1 year" } }) }
                                ${ helpers.createBoxLink({label: "2",             dataType: "time-years-ago-2", dataset: { shortLabel: "2 years" } }) }
                                ${ helpers.createBoxLink({label: "3",             dataType: "time-years-ago-3", dataset: { shortLabel: "3 years" } }) }
                                ${ helpers.createBoxLink({label: "4",             dataType: "time-years-ago-4", dataset: { shortLabel: "4 years" } }) }
                                ${ helpers.createBoxLink({label: "5",             dataType: "time-years-ago-5", dataset: { shortLabel: "5 years" } }) }
                                ${ helpers.createBoxLink({label: "6",             dataType: "time-years-ago-6", dataset: { shortLabel: "6 years" } }) }
                                ${ helpers.createBoxLink({label: "7",             dataType: "time-years-ago-7", dataset: { shortLabel: "7 years" } }) }
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
                dataSource.setItem(dropdown, { type: "time-all", fields: {scd: null, ecd: null} });

                let formatDate = (date) =>
                {
                    return (date.getYear() + 1900).toFixed().padStart(2, "0") + "-" +
                            (date.getMonth() + 1).toFixed().padStart(2, "0") + "-" +
                            date.getDate().toFixed().padStart(2, "0");
                };

                let setDateFilter = (name, start, end) =>
                {
                    let startDate = formatDate(start);
                    let endDate = formatDate(end);
                    dataSource.setItem(dropdown, { type: name, fields: {scd: startDate, ecd: endDate} });
                };

                let tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
                let lastWeek = new Date(); lastWeek.setDate(lastWeek.getDate() - 7);
                let lastMonth = new Date(); lastMonth.setMonth(lastMonth.getMonth() - 1);
                let lastYear = new Date(); lastYear.setFullYear(lastYear.getFullYear() - 1);
                setDateFilter("time-week", lastWeek, tomorrow);
                setDateFilter("time-month", lastMonth, tomorrow);
                setDateFilter("time-year", lastYear, tomorrow);
                for(let yearsAgo = 1; yearsAgo <= 7; ++yearsAgo)
                {
                    let startYear = new Date(); startYear.setFullYear(startYear.getFullYear() - yearsAgo - 1);
                    let endYear = new Date(); endYear.setFullYear(endYear.getFullYear() - yearsAgo);
                    setDateFilter("time-years-ago-" + yearsAgo, startYear, endYear);
                }

                // The "reset search" button removes everything in the query except search terms, and resets
                // the search type.
                let box = this.querySelector(".reset-search");
                let url = new URL(this.dataSource.url);
                let tag = helpers.pixiv.getSearchTagsFromUrl(url);
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
        this.tagSearchBox = new TagSearchBoxWidget({
            container: this.querySelector(".tag-search-box-container"),
            dataSource: this.dataSource,
        });

        // Fill the search box with the current tag.
        //
        // Add a space to the end, so another tag can be typed immediately after focusing an existing search.
        let search = this.dataSource._searchTags;
        if(search)
            search += " ";
        this.querySelector(".tag-search-box .input-field-container > input").value = search;
    }
}
