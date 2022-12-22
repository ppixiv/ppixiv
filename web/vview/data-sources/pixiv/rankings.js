// /ranking.php
//
// This one has an API, and also formats the first page of results into the page.
// They have completely different formats, and the page is updated dynamically (unlike
// the pages we scrape), so we ignore the page for this one and just use the API.
//
// An exception is that we load the previous and next days from the page.  This is better
// than using our current date, since it makes sure we have the same view of time as
// the search results.

import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_Rankings extends DataSource
{
    get name() { return "rankings"; }
    get pageTitle() { return "Rankings"; }
    getDisplayingText() { return "Rankings"; }
    get ui() { return UI; }

    // This gives a tiny number of results per page on mobile.
    get estimatedItemsPerPage() { return ppixiv.mobile? 18:50; }

    constructor(url)
    {
        super(url);

        this.maxPage = 999999;
    }
    
    // A Pixiv classic: two separate, vaguely-similar ways of doing the same thing on desktop
    // and mobile (and a third, mobile apps).  It's like they use the same backend but are
    // implemented by two people who never talk to each other.  The desktop version is
    // preferred since it gives us thumbnail data, where the mobile version only gives
    // thumbnail IDs that we have to look up, but the desktop version can't be accessed
    // from mobile.
    async loadDataMobile({ date, mode, content, page })
    {
        let data = {
            mode,
            page,
            type: content,
        };

        if(date)
            data.date = date;

        let result = await helpers.get_request("/touch/ajax/ranking/illust", data);
        let thisDate = result.body.rankingDate;

        function formatDate(date)
        {
            let year = date.getUTCFullYear();
            let month = date.getUTCMonth() + 1;
            let day = date.getUTCDate();
            return year + "-" + 
                month.toString().padStart(2, '0') + "-" +
                day.toString().padStart(2, '0');
        }

        // This API doesn't tell us the previous and next ranking dates, so we have to figure
        // it out ourself.
        let nextDate = new Date(thisDate);
        let prevDate = new Date(thisDate);
        nextDate.setDate(nextDate.getDate() + 1);
        prevDate.setDate(prevDate.getDate() - 1);

        nextDate = formatDate(nextDate);
        prevDate = formatDate(prevDate);

        // This version doesn't indicate the last page, and just keeps loading until it gets
        // an empty response.  It also doesn't indicate the first page where a ranking type
        // starts.  For example, AI results begin on 2022-10-31.  I'm not sure how to guess
        // the last page.  Are these dates UTC or JST?  Are new results available at exactly
        // midnight?
        let lastPage = false;

        let mediaIds = [];
        for(let item of result.body.ranking)
            mediaIds.push(helpers.illust_id_to_media_id("" + item.illustId));

        return { mediaIds, thisDate, nextDate, prevDate, lastPage };
    }

    async loadDataDesktop({ date, mode, content, page })
    {
        let data = {
            content,
            mode,
            format:  "json",
            p: page,
        };

        if(date)
            data.date = date;

        let result = await helpers.get_request("/ranking.php", data);
        let thisDate = result.date;

        let nextDate = result.next_date;
        let prevDate = result.prev_date;
        let lastPage = !result.next;

        // Fix nextDate and prevDate being false instead of null if there's no previous
        // or next date.
        if(!nextDate)
            nextDate = null;
        if(!prevDate)
            prevDate = null;

        // This is "YYYYMMDD".  Reformat it to YYYY-MM-DD.
        if(thisDate.length == 8)
        {
            let year = thisDate.slice(0,4);
            let month = thisDate.slice(4,6);
            let day = thisDate.slice(6,8);
            thisDate = year + "/" + month + "/" + day;
        }

        // This API doesn't return aiType, but we can fill it in ourself since we know whether
        // we're on an AI rankings page or not.
        let isAI = mode == "daily_ai" || mode == "daily_r18_ai";
        for(let illust of result.contents)
            illust.aiType = isAI? 2:1;
        
        // This returns a struct of data that's like the thumbnails data response,
        // but it's not quite the same.
        let mediaIds = [];
        for(let item of result.contents)
            mediaIds.push(helpers.illust_id_to_media_id("" + item.illust_id));

        // Register this as thumbnail data.
        await ppixiv.media_cache.add_media_infos_partial(result.contents, "rankings");

        return { mediaIds, thisDate, nextDate, prevDate, lastPage };
    }

    loadDataForPlatform(options)
    {
        if(ppixiv.mobile)
            return this.loadDataMobile(options);
        else
            return this.loadDataDesktop(options);
    }

    async loadPageInternal(page)
    {
        // Stop if we already know this is past the end.
        if(page > this.maxPage)
            return;

        let queryArgs = this.url.searchParams;
        let date = queryArgs.get("date");
        let mode = queryArgs.get("mode") ?? "daily";
        let content = queryArgs.get("content") ?? "all";

        let { mediaIds, thisDate, nextDate, prevDate, lastPage } = await this.loadDataForPlatform({ date, mode, content, page });

        if(lastPage)
            this.maxPage = Math.min(page, this.maxPage);

        this.today_text ??= thisDate;
        this.prevDate = prevDate;
        this.nextDate = nextDate;
        this.dispatchEvent(new Event("_refresh_ui"));

        // Register the new page of data.
        this.addPage(page, mediaIds);
    };
}

class UI extends Widget
{
    constructor({dataSource, ...options})
    {
        super({ ...options, template: `
            <div class="ranking-data-source box-button-row">
                <div class="box-button-row date-row">
                    ${ helpers.create_box_link({label: "Previous day", popup: "Show the previous day",     data_type: "new-illust-type-illust", classes: ["nav-yesterday"] }) }
                    <span class=nav-today></span>
                    ${ helpers.create_box_link({label: "Next day", popup: "Show the next day",     data_type: "new-illust-type-illust", classes: ["nav-tomorrow"] }) }
                </div>

                <div class=box-button-row>
                    ${ helpers.create_box_link({label: "Ranking type",    popup: "Rankings to display", classes: ["mode-button"] }) }
                    ${ helpers.create_box_link({label: "Contents",    popup: "Content type to display", classes: ["content-type-button"] }) }
                </div>

                <div class="box-button-row modes"></div>
            </div>
        `});

        this.dataSource = dataSource;

        dataSource.addEventListener("_refresh_ui", () => this.refreshDates(), this._signal);
        this.refreshDates();

        /*
         * Pixiv has a fixed list of rankings, but it displays them as a set of buttons
         * based on the current selection, showing which rankings are available in the current
         * category.
         *     
         * These are the available ranking modes, and whether they're available in overall,
         * content=illust/manga (these have the same selections) and content=ugoira, and
         * whether there are R18 rankings.  R18 rankings have the same mode name with "_r18"
         * appended.  (Except for AI which puts it in the middle, because Pixiv.)
         *
         * Be careful: Pixiv's UI has buttons in some filters that don't actually exist in the
         * mode it's in, which actually redirect out of the content mode, such as "popular among
         * male users" in "Illustrations" mode which actually goes back to "Overall".
         *
         * o: overall (all) o*: overall R18      o**: overall R18G
         * i: illust/manga  i*: illust/manga R18 i**: illust/manga R18G
         * u: ugoira        u*: ugoira R18
         */
        let rankingTypes = {
            //                       Overall    Illust     Ugoira
            //                            R18        R18        R18       
            "daily":     { content: ["o", "o*", "i", "i*", "u", "u*"],                label: "Daily",    popup: "Daily rankings" },

            // Weekly also has "r18g" for most content types.
            "weekly":    { content: ["o", "o*", "i", "i*", "u", "u*", "o**", "i**"],  label: "Weekly",   popup: "Weekly rankings" },
            "monthly":   { content: ["o",       "i"],                                 label: "Monthly",  popup: "Monthly rankings" },
            "rookie":    { content: ["o",       "i"],                                 label: "Rookie",   popup: "Rookie rankings" },
            "original":  { content: ["o"],                                            label: "Original", popup: "Original rankings" },
            "daily_ai":  { content: ["o", "o*"],                                      label: "AI",       popup: "Show AI works" },
            "male":      { content: ["o", "o*"],                                      label: "Male",     popup: "Popular with men" },
            "female":    { content: ["o", "o*"],                                      label: "Female",   popup: "Popular with women" },
        };

        // Given a content selection ("all", "illust", "manga", "ugoira") and an ages selection, return
        // the shorthand key for this combination, such as "i*".
        function contentKeyFor(content, ages)
        {
            let keys = { "all": "o", "illust": "i", "manga": "i" /* same as illust */, "ugoira": "u" };
            let contentKey = keys[content];

            // Append * for r18 and ** for r18g.
            if(ages == "r18")
                contentKey += "*";
            else if(ages == "r18g")
                contentKey += "**";

            return contentKey;
        }

        // Given a mode ("daily") and an ages selection ("r18"), return the combined mode,
        // eg. "daily_r18".
        function modeWithAges(mode, ages)
        {
            if(ages == "r18")
                mode += "_r18"; // daily_r18
            else if(ages == "r18g")
                mode += "_r18g"; // daily_r18g

            // Seriously, guys?
            if(mode == "daily_ai_r18")
                mode = "daily_r18_ai";
            else if(mode == "weekly_r18g")
                mode = "r18g";

            return mode;
        }

        let currentArgs = new helpers.args(this.url);

        // The current content type: all, illust, manga, ugoira
        let currentContent = currentArgs.query.get("content") || "all";

        // The current mode: daily, weekly, etc.
        let currentMode = currentArgs.query.get("mode") || "daily";
        if(currentMode == "r18g") // work around Pixiv inconsistency
            currentMode = "weekly_r18g";

        // "all", "r18", "r18g"
        let currentAges = currentMode.indexOf("r18g") != -1? "r18g":
            currentMode.indexOf("r18") != -1? "r18":"all";
        
        // Strip _r18 or _r18g out of currentMode, so currentMode is the base mode, ignoring the
        // ages selection.
        currentMode = currentMode.replace("_r18g", "").replace("_r18", "");

        // The key for the current mode:
        let contentKey = contentKeyFor(currentContent, currentAges);
        console.log(`Rankings content mode: ${currentContent}, ages: ${currentAges}, key: ${contentKey}`);

        let modeContainer = this.querySelector(".modes");

        // Create the R18 and R18G buttons.  If we're on a selection where toggling this doesn't exist,
        // pick a default.
        for(let agesToggle of ["r18", "r18g"])
        {
            let targetMode = currentMode;

            let current_ranking_type = rankingTypes[currentMode];
            console.assert(current_ranking_type, currentMode);
            let { content } = current_ranking_type;

            let button = helpers.create_box_link({
                label: agesToggle.toUpperCase(),
                popup: `Show ${agesToggle.toUpperCase()} works`,
                classes: [agesToggle],
                as_element: true,
            });
            modeContainer.appendChild(button);

            // If toggling this would put us in a mode that doesn't exist, default to "daily" for R18 and
            // "weekly" for R18G, since those combinations always exist.  The buttons aren't disabled or
            // removed since it makes it confusing to find them.
            let contentKeyForMode = contentKeyFor(currentContent, agesToggle);
            if(content.indexOf(contentKeyForMode) == -1)
                targetMode = agesToggle == "r18"? "daily":"weekly";

            let modeEnabled = modeWithAges(targetMode, agesToggle);
            let modeDisabled = modeWithAges(targetMode, "all");

            dataSource.setItem(button, {
                fields: {mode: modeEnabled},
                toggle: true,
                classes: [agesToggle], // only show if enabled
                adjustUrl: (args) => {
                    // If we're in R18, clicking this would remove the mode field entirely.  Instead,
                    // switch to the all-ages link.
                    if(currentAges == agesToggle)
                        args.query.set("mode", modeDisabled);
                }
            });
        }

        // Create the content dropdown.
        new DropdownMenuOpener({
            button: this.querySelector(".content-type-button"),
            create_box: ({...options}) => {
                let dropdown = new Widget({
                    ...options,
                    template: `
                        <div class="vertical-list">
                            ${ helpers.create_box_link({label: "All",           popup: "Show all works",           data_type: "content-all" }) }
                            ${ helpers.create_box_link({label: "Illustrations", popup: "Show illustrations only",  data_type: "content-illust" }) }
                            ${ helpers.create_box_link({label: "Animations",    popup: "Show animations only",     data_type: "content-ugoira" }) }
                            ${ helpers.create_box_link({label: "Manga",         popup: "Show manga only",          data_type: "content-manga" }) }
                        </div>
                    `,
                });

                // Set up the content links.
                // grr: this doesn't work with the dropdown text
                for(let content of ["all", "illust", "ugoira", "manga"])
                {
                    dataSource.setItem(dropdown, {
                        type: "content-" + content, // content-all, content-illust, etc
                        fields: {content},
                        defaults: {content: "all"},
                        adjustUrl: (args) => {
                            if(content == currentContent)
                                return;

                            // If the current mode and ages combination doesn't exist in the content type
                            // this link will switch to, also reset the mode to daily, since it exists for
                            // all "all-ages" modes.
                            let current_ranking_type = rankingTypes[currentMode];
                            console.assert(current_ranking_type, currentMode);
                            let switching_to_content_key = contentKeyFor(content, currentAges);
                            if(current_ranking_type.content.indexOf(switching_to_content_key) == -1)
                                args.query.set("mode", "daily");
                        },
                    });
                }

                return dropdown;
            },
        });

        // Create the mode dropdown.
        new DropdownMenuOpener({
            button: this.querySelector(".mode-button"),
            create_box: ({...options}) => {
                let dropdown = new Widget({
                    ...options,
                    template: `
                        <div class="vertical-list">
                        </div>
                    `
                });

                // Create mode links for rankings that exist in the current content and ages selection.
                for(let [mode, {content, label, popup}] of Object.entries(rankingTypes))
                {
                    console.assert(content, mode);

                    mode = modeWithAges(mode, currentAges);

                    // Skip this mode if it's not available in the selected content and ages combination.
                    if(content.indexOf(contentKey) == -1)
                        continue;

                    let button = helpers.create_box_link({
                        label,
                        popup,
                        as_element: true,
                    });
                    dropdown.container.appendChild(button);

                    dataSource.setItem(button, {
                        fields: {mode},
                        defaults: {mode: "daily"},
                    });
                }

                return dropdown;
            }
        });
    }

    refreshDates = () =>
    {
        if(this.dataSource.today_text)
            this.querySelector(".nav-today").innerText = this.dataSource.today_text;

        // This UI is greyed rather than hidden before we have the dates, so the UI doesn't
        // shift around as we load.
        let yesterday = this.querySelector(".nav-yesterday");
        helpers.set_class(yesterday, "disabled", this.dataSource.prevDate == null);
        if(this.dataSource.prevDate)
        {
            let url = new URL(this.dataSource.url);
            url.searchParams.set("date", this.dataSource.prevDate);
            yesterday.href = url;
        }

        let tomorrow = this.querySelector(".nav-tomorrow");
        helpers.set_class(tomorrow, "disabled", this.dataSource.nextDate == null);
        if(this.dataSource.nextDate)
        {
            let url = new URL(this.dataSource.url);
            url.searchParams.set("date", this.dataSource.nextDate);
            tomorrow.href = url;
        }
    }            
}
