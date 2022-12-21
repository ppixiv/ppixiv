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
import { helpers } from 'vview/ppixiv-imports.js';

export default class DataSource_Rankings extends DataSource
{
    constructor(url)
    {
        super(url);

        this.max_page = 999999;
    }
    
    get name() { return "rankings"; }

    // A Pixiv classic: two separate, vaguely-similar ways of doing the same thing on desktop
    // and mobile (and a third, mobile apps).  It's like they use the same backend but are
    // implemented by two people who never talk to each other.  The desktop version is
    // preferred since it gives us thumbnail data, where the mobile version only gives
    // thumbnail IDs that we have to look up, but the desktop version can't be accessed
    // from mobile.
    async load_data_mobile({ date, mode, content, page })
    {
        let data = {
            mode,
            page,
            type: content,
        };

        if(date)
            data.date = date;

        let result = await helpers.get_request("/touch/ajax/ranking/illust", data);
        let this_date = result.body.rankingDate;

        function format_date(date)
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
        let next_date = new Date(this_date);
        let prev_date = new Date(this_date);
        next_date.setDate(next_date.getDate() + 1);
        prev_date.setDate(prev_date.getDate() - 1);

        next_date = format_date(next_date);
        prev_date = format_date(prev_date);

        // This version doesn't indicate the last page, and just keeps loading until it gets
        // an empty response.  It also doesn't indicate the first page where a ranking type
        // starts.  For example, AI results begin on 2022-10-31.  I'm not sure how to guess
        // the last page.  Are these dates UTC or JST?  Are new results available at exactly
        // midnight?
        let last_page = false;

        let media_ids = [];
        for(let item of result.body.ranking)
            media_ids.push(helpers.illust_id_to_media_id("" + item.illustId));

        return { media_ids, this_date, next_date, prev_date, last_page };
    }

    async load_data_desktop({ date, mode, content, page })
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
        let this_date = result.date;

        let next_date = result.next_date;
        let prev_date = result.prev_date;
        let last_page = !result.next;

        // Fix next_date and prev_date being false instead of null if there's no previous
        // or next date.
        if(!next_date)
            next_date = null;
        if(!prev_date)
            prev_date = null;

        // This is "YYYYMMDD".  Reformat it to YYYY-MM-DD.
        if(this_date.length == 8)
        {
            let year = this_date.slice(0,4);
            let month = this_date.slice(4,6);
            let day = this_date.slice(6,8);
            this_date = year + "/" + month + "/" + day;
        }

        // This API doesn't return aiType, but we can fill it in ourself since we know whether
        // we're on an AI rankings page or not.
        let is_ai = mode == "daily_ai" || mode == "daily_r18_ai";
        for(let illust of result.contents)
            illust.aiType = is_ai? 2:1;
        
        // This returns a struct of data that's like the thumbnails data response,
        // but it's not quite the same.
        let media_ids = [];
        for(var item of result.contents)
            media_ids.push(helpers.illust_id_to_media_id("" + item.illust_id));

        // Register this as thumbnail data.
        await ppixiv.media_cache.add_media_infos_partial(result.contents, "rankings");

        return { media_ids, this_date, next_date, prev_date, last_page };
    }

    load_data_for_platform(options)
    {
        if(ppixiv.mobile)
            return this.load_data_mobile(options);
        else
            return this.load_data_desktop(options);
    }

    async load_page_internal(page)
    {
        // Stop if we already know this is past the end.
        if(page > this.max_page)
            return;

        let query_args = this.url.searchParams;
        let date = query_args.get("date");
        let mode = query_args.get("mode") ?? "daily";
        let content = query_args.get("content") ?? "all";

        let { media_ids, this_date, next_date, prev_date, last_page } = await this.load_data_for_platform({ date, mode, content, page });

        if(last_page)
            this.max_page = Math.min(page, this.max_page);

        this.today_text ??= this_date;
        this.prev_date = prev_date;
        this.next_date = next_date;
        this.dispatchEvent(new Event("_refresh_ui"));

        // Register the new page of data.
        this.add_page(page, media_ids);
    };

    // This gives a tiny number of results per page on mobile.
    get estimated_items_per_page() { return ppixiv.mobile? 18:50; }

    get page_title() { return "Rankings"; }
    get_displaying_text() { return "Rankings"; }

    get ui()
    {
        return class extends Widget
        {
            constructor({data_source, ...options})
            {
                super({ ...options, template: `
                    <div class="ranking-data-source box-button-row">
                        <div class="box-button-row date-row">
                            ${ helpers.create_box_link({label: "Next day", popup: "Show the next day",     data_type: "new-illust-type-illust", classes: ["nav-tomorrow"] }) }
                            <span class=nav-today></span>
                            ${ helpers.create_box_link({label: "Previous day", popup: "Show the previous day",     data_type: "new-illust-type-illust", classes: ["nav-yesterday"] }) }
                        </div>

                        <div class=box-button-row>
                            ${ helpers.create_box_link({label: "Ranking type",    popup: "Rankings to display", classes: ["mode-button"] }) }
                            ${ helpers.create_box_link({label: "Contents",    popup: "Content type to display", classes: ["content-type-button"] }) }
                        </div>

                        <div class="box-button-row modes"></div>
                    </div>
                `});

                this.data_source = data_source;

                data_source.addEventListener("_refresh_ui", () => this.refresh_dates(), this._signal);
                this.refresh_dates();

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
                let ranking_types = {
                    //                       Overall    Illust     Ugoira
                    //                            R18        R18        R18       
                    "daily":     { content: ["o", "o*", "i", "i*", "u", "u*"],                label: "Daily",    popup: "Daily rankings",  },

                    // Weekly also has "r18g" for most content types.
                    "weekly":    { content: ["o", "o*", "i", "i*", "u", "u*", "o**", "i**"],  label: "Weekly",   popup: "Weekly rankings",  },
                    "monthly":   { content: ["o",       "i"],                                 label: "Monthly",  popup: "Monthly rankings",  },
                    "rookie":    { content: ["o",       "i"],                                 label: "Rookie",   popup: "Rookie rankings" },
                    "original":  { content: ["o"],                                            label: "Original", popup: "Original rankings" },
                    "daily_ai":  { content: ["o", "o*"],                                      label: "AI",       popup: "Show AI works" },
                    "male":      { content: ["o", "o*"],                                      label: "Male",     popup: "Popular with men"      },
                    "female":    { content: ["o", "o*"],                                      label: "Female",   popup: "Popular with women"       },
                };

                // Given a content selection ("all", "illust", "manga", "ugoira") and an ages selection, return
                // the shorthand key for this combination, such as "i*".
                function content_key_for(content, ages)
                {
                    let keys = { "all": "o", "illust": "i", "manga": "i" /* same as illust */, "ugoira": "u" };
                    let content_key = keys[content];

                    // Append * for r18 and ** for r18g.
                    if(ages == "r18")
                        content_key += "*";
                    else if(ages == "r18g")
                        content_key += "**";

                    return content_key;
                }

                // Given a mode ("daily") and an ages selection ("r18"), return the combined mode,
                // eg. "daily_r18".
                function mode_with_ages(mode, ages)
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

                let current_args = new helpers.args(this.url);

                // The current content type: all, illust, manga, ugoira
                let current_content = current_args.query.get("content") || "all";

                // The current mode: daily, weekly, etc.
                let current_mode = current_args.query.get("mode") || "daily";
                if(current_mode == "r18g") // work around Pixiv inconsistency
                    current_mode = "weekly_r18g";

                // "all", "r18", "r18g"
                let current_ages = current_mode.indexOf("r18g") != -1? "r18g":
                    current_mode.indexOf("r18") != -1? "r18":"all";
                
                // Strip _r18 or _r18g out of current_mode, so current_mode is the base mode, ignoring the
                // ages selection.
                current_mode = current_mode.replace("_r18g", "").replace("_r18", "");

                // The key for the current mode:
                let content_key = content_key_for(current_content, current_ages);
                console.log(`Rankings content mode: ${current_content}, ages: ${current_ages}, key: ${content_key}`);

                let mode_container = this.querySelector(".modes");

                // Create the R18 and R18G buttons.  If we're on a selection where toggling this doesn't exist,
                // pick a default.
                for(let ages_toggle of ["r18", "r18g"])
                {
                    let target_mode = current_mode;

                    let current_ranking_type = ranking_types[current_mode];
                    console.assert(current_ranking_type, current_mode);
                    let { content } = current_ranking_type;

                    let button = helpers.create_box_link({
                        label: ages_toggle.toUpperCase(),
                        popup: `Show ${ages_toggle.toUpperCase()} works`,
                        classes: [ages_toggle],
                        as_element: true,
                    });
                    mode_container.appendChild(button);

                    // If toggling this would put us in a mode that doesn't exist, default to "daily" for R18 and
                    // "weekly" for R18G, since those combinations always exist.  The buttons aren't disabled or
                    // removed since it makes it confusing to find them.
                    let content_key_for_mode = content_key_for(current_content, ages_toggle);
                    if(content.indexOf(content_key_for_mode) == -1)
                        target_mode = ages_toggle == "r18"? "daily":"weekly";

                    let mode_enabled = mode_with_ages(target_mode, ages_toggle);
                    let mode_disabled = mode_with_ages(target_mode, "all");

                    data_source.set_item(button, {
                        fields: {mode: mode_enabled},
                        toggle: true,
                        classes: [ages_toggle], // only show if enabled
                        adjust_url: (args) => {
                            // If we're in R18, clicking this would remove the mode field entirely.  Instead,
                            // switch to the all-ages link.
                            if(current_ages == ages_toggle)
                                args.query.set("mode", mode_disabled);
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
                            data_source.set_item(dropdown, {
                                type: "content-" + content, // content-all, content-illust, etc
                                fields: {content},
                                default_values: {content: "all"},
                                adjust_url: (args) => {
                                    if(content == current_content)
                                        return;

                                    // If the current mode and ages combination doesn't exist in the content type
                                    // this link will switch to, also reset the mode to daily, since it exists for
                                    // all "all-ages" modes.
                                    let current_ranking_type = ranking_types[current_mode];
                                    console.assert(current_ranking_type, current_mode);
                                    let switching_to_content_key = content_key_for(content, current_ages);
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
                        for(let [mode, {content, label, popup}] of Object.entries(ranking_types))
                        {
                            console.assert(content, mode);

                            mode = mode_with_ages(mode, current_ages);

                            // Skip this mode if it's not available in the selected content and ages combination.
                            if(content.indexOf(content_key) == -1)
                                continue;

                            let button = helpers.create_box_link({
                                label,
                                popup,
                                as_element: true,
                            });
                            dropdown.container.appendChild(button);

                            data_source.set_item(button, {
                                fields: {mode},
                                default_values: {mode: "daily"},
                            });
                        }

                        return dropdown;
                    }
                });
            }

            refresh_dates = () =>
            {
                if(this.data_source.today_text)
                    this.querySelector(".nav-today").innerText = this.data_source.today_text;
        
                // This UI is greyed rather than hidden before we have the dates, so the UI doesn't
                // shift around as we load.
                let yesterday = this.querySelector(".nav-yesterday");
                helpers.set_class(yesterday, "disabled", this.data_source.prev_date == null);
                if(this.data_source.prev_date)
                {
                    let url = new URL(this.data_source.url);
                    url.searchParams.set("date", this.data_source.prev_date);
                    yesterday.href = url;
                }
        
                let tomorrow = this.querySelector(".nav-tomorrow");
                helpers.set_class(tomorrow, "disabled", this.data_source.next_date == null);
                if(this.data_source.next_date)
                {
                    let url = new URL(this.data_source.url);
                    url.searchParams.set("date", this.data_source.next_date);
                    tomorrow.href = url;
                }
            }            
        }
    }
}
