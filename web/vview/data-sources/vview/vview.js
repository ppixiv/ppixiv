import Widget from 'vview/widgets/widget.js';
import DataSource, { TagDropdownWidget } from 'vview/data-sources/data-source.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/ppixiv-imports.js';

export default class DataSource_VView extends DataSource
{
    get name() { return "vview"; }
    get is_vview() { return true; }
    get can_return_manga() { return false; }

    constructor(url)
    {
        super(url);

        this.reached_end = false;
        this.prev_page_uuid = null;
        this.next_page_uuid = null;
        this.next_page_offset = null;
        this.bookmark_tag_counts = null;
        this._all_pages_loaded = false;

        this.load_page(this.initial_page, { cause: "preload" });
    }

    get supports_start_page() { return true; }

    // If we've loaded all pages, this is true to let the context menu know it
    // should display page numbers.
    get all_pages_loaded() { return this._all_pages_loaded; }

    async load_page_internal(page)
    {
        // If the last result was at the end, stop.
        if(this.reached_end)
            return;

        this.fetch_bookmark_tag_counts();
        
        // We should only be called in one of three ways: a start page (any page, but only if we have
        // nothing loaded), or a page at the start or end of pages we've already loaded.  Figure out which
        // one this is.  "page" is set to result.next of the last page to load the next page, or result.prev
        // of the first loaded page to load the previous page.
        let lowest_page = this.id_list.getLowestLoadedPage();
        let highest_page = this.id_list.getHighestLoadedPage();
        let page_uuid = null;
        let loading_direction;
        if(page == lowest_page - 1)
        {
            // Load the previous page.
            page_uuid = this.prev_page_uuid;
            loading_direction = "backwards";
        }
        else if(page == highest_page + 1)
        {
            // Load the next page.
            page_uuid = this.next_page_uuid;
            loading_direction = "forwards";
        }
        else if(this.next_page_offset == null)
        {
            loading_direction = "initial";
        }
        else
        {
            // This isn't our start page, and it doesn't match up with our next or previous page.
            console.error(`Loaded unexpected page ${page} (${lowest_page}...${highest_page})`);
            return;
        }
    
        if(this.next_page_offset == null)
        {
            // We haven't loaded any pages yet, so we can't resume the search in-place.  Set next_page_offset
            // to the approximate offset to skip to this page number.
            this.next_page_offset = this.estimated_items_per_page * (page-1);
        }

        // Use the search options if there's no path.  Otherwise, we're navigating inside
        // the search, so just view the contents of where we navigated to.
        let args = new helpers.args(this.url);
        let { search_options } = local_api.get_search_options_for_args(args);
        let folder_id = local_api.get_local_id_from_args(args, { get_folder: true });

        let order = args.hash.get("order");

        // If we have no search options, we're viewing a single directory.  Load the whole
        // ID list with /ids.  This only returns media IDs, but returns the entire directory,
        // and we can register the whole thing as one big page.  This lets us handle local
        // files better: if you load a random file in a big directory and then back out to
        // the search, we can show the file you were on instead of going back to the top.
        // screen_search will load media info as needed when they're actually displayed.
        //
        // If we have access restrictions (eg. we're guest and can only access certain tags),
        // this API is disabled, since all listings are bookmark searches.
        if(search_options == null && !local_api.local_info.bookmark_tag_searches_only)
        {
            console.log("Loading folder contents:", folder_id);
            let result_ids = await local_api.local_post_request(`/api/ids/${folder_id}`, {
                ...search_options,
                ids_only: true,

                order: args.hash.get("order"),
            });
            if(!result_ids.success)
            {
                ppixiv.message.show("Error reading directory: " + result_ids.reason);
                return;
            }
    
            this.reached_end = true;
            this._all_pages_loaded = true;            
            this.add_page(page, result_ids.ids);
            return;
        }

        // Note that this registers the results with media_info automatically.
        let result = await local_api.list(folder_id, {
            ...search_options,

            order: order,

            // If we have a next_page_uuid, use it to load the next page.
            page: page_uuid,
            limit: this.estimated_items_per_page,

            // This is used to approximately resume the search if next_page_uuid has expired.
            skip: this.next_page_offset,
        });

        if(!result.success)
        {
            ppixiv.message.show("Error reading directory: " + result.reason);
            return result;
        }

        // If we got a local path, store it to allow copying it to the clipboard.
        this.local_path = result.local_path;

        // Update the next and previous page IDs.  If we're loading backwards, always update
        // the previous page.  If we're loading forwards, always update the next page.  If
        // either of these are null, update both.
        if(loading_direction == "backwards" || loading_direction == "initial")
            this.prev_page_uuid = result.pages.prev;

        if(loading_direction == "forwards" || loading_direction == "initial")
            this.next_page_uuid = result.pages.next;

        this.next_page_offset = result.next_offset;

        // If next is null, we've reached the end of the results.
        if(result.pages.next == null)
            this.reached_end = true;

        let found_media_ids = [];
        for(let thumb of result.results)
            found_media_ids.push(thumb.mediaId);

        this.add_page(page, found_media_ids);
    };

    // Override can_load_page.  If we've already loaded a page, we've cached the next
    // and previous page UUIDs and we don't want to load anything else, even if the first
    // page we loaded had no results.
    can_load_page(page)
    {
        // next_page_offset is null if we haven't tried to load anything yet.
        if(this.next_page_offset == null)
            return true;

        // If we've loaded pages 5-6, we can load anything between pages 4 and 7.
        let lowest_page = this.id_list.getLowestLoadedPage();
        let highest_page = this.id_list.getHighestLoadedPage();
        return page >= lowest_page && page <= highest_page+1;
    }

    get viewing_folder()
    {
        let args = new helpers.args(this.url);
        return local_api.get_local_id_from_args(args, { get_folder: true });
    }

    get page_title() { return this.get_displaying_text(); }

    set_page_icon()
    {
        helpers.set_icon({vview: true});
    }

    get_displaying_text()
    {
        let args = new helpers.args(this.url);
        return local_api.get_search_options_for_args(args).title;
    }

    // Put the illust ID in the hash instead of the path.  Pixiv doesn't care about this,
    // and this avoids sending the user's filenames to their server as 404s.
    set_current_media_id(mediaId, args)
    {
        local_api.get_args_for_id(mediaId, args);
    }

    get_media_id_from_url(args)
    {
        // If the URL points to a file, return it.  If no image is being viewed this will give
        // the folder we're in, which shouldn't be returned here.
        let illust_id = local_api.get_local_id_from_args(args);
        if(illust_id == null || !illust_id.startsWith("file:"))
            return null;
        return illust_id;
    }

    get_current_media_id(args)
    {
        return this.get_media_id_from_url(args) ?? this.id_list.getFirstId();
    }

    get ui()
    {
        return class extends Widget
        {
            constructor({data_source, ...options})
            {
                super({ ...options, data_source, template: `
                    <div>
                        <vv-container class=tag-search-box-container></vv-container>

                        <div class="box-button-row">
                            <span class="popup icon-button copy-local-path" data-popup="Copy local path to clipboard">
                                ${ helpers.create_icon("content_copy") }
                            </span>

                            ${ helpers.create_box_link({popup: "Close search", icon: "exit_to_app",  classes: ["clear-local-search"] }) }
                            ${ helpers.create_box_link({label: "Bookmarks",           popup: "Show bookmarks",                       data_type: "local-bookmarks-only" }) }

                            <div class=local-bookmark-tags-box>
                                ${ helpers.create_box_link({label: "Tags",    icon: "ppixiv:tag", classes: ["bookmark-tags-button"] }) }
                            </div>

                            ${ helpers.create_box_link({ label: "Type",          classes: ["file-type-button"] }) }
                            ${ helpers.create_box_link({ label: "Aspect ratio",  classes: ["aspect-ratio-button"] }) }
                            ${ helpers.create_box_link({ label: "Image size",    classes: ["image-size-button"] }) }
                            ${ helpers.create_box_link({ label: "Order",         classes: ["sort-button"] }) }
                        </div>
                    </div>
                `});

                this.data_source = data_source;

                // The search history dropdown for local searches.
                new ppixiv.LocalSearchBoxWidget({ container: this.querySelector(".tag-search-box-container") });
        
                data_source.setup_dropdown(this.querySelector(".file-type-button"), [{
                    create_options: { label: "All",           data_type: "local-type-all", dataset: { default: "1"} },
                    setup_options: { fields: {"#type": null} },
                }, {
                    create_options: { label: "Videos",        data_type: "local-type-videos" },
                    setup_options: { fields: {"#type": "videos"} },
                }, {
                    create_options: { label: "Images",        data_type: "local-type-images" },
                    setup_options: { fields: {"#type": "images"} },
                }]);

                data_source.setup_dropdown(this.querySelector(".aspect-ratio-button"), [{
                    create_options: { label: "All",           data_type: "local-aspect-ratio-all", dataset: { default: "1"} },
                    setup_options: { fields: {"#aspect-ratio": null} },
                }, {
                    create_options: { label: "Landscape",     data_type: "local-aspect-ratio-landscape" },
                    setup_options: { fields: {"#aspect-ratio": `3:2...`} },
                }, {
                    create_options: { label: "Portrait",      data_type: "local-aspect-ratio-portrait" },
                    setup_options: { fields: {"#aspect-ratio": `...2:3`} },
                }]);

                data_source.setup_dropdown(this.querySelector(".image-size-button"), [{
                    create_options: { label: "All",           dataset: { default: "1"} },
                    setup_options: { fields: {"#pixels": null} },
                }, {
                    create_options: { label: "High-res" },
                    setup_options: { fields: {"#pixels": "4000000..."} },
                }, {
                    create_options: { label: "Medium-res" },
                    setup_options: { fields: {"#pixels": "1000000...3999999"} },
                }, {
                    create_options: { label: "Low-res" },
                    setup_options: { fields: {"#pixels": "...999999"} },
                }]);

                data_source.setup_dropdown(this.querySelector(".sort-button"), [{
                    create_options: { label: "Name",           dataset: { default: "1"} },
                    setup_options: { fields: {"#order": null} },
                }, {
                    create_options: { label: "Name (inverse)" },
                    setup_options: { fields: {"#order": "-normal"} },
                }, {
                    create_options: { label: "Newest" },
                    setup_options: { fields: {"#order": "-ctime"} },

                }, {
                    create_options: { label: "Oldest" },
                    setup_options: { fields: {"#order": "ctime"} },

                }, {
                    create_options: { label: "New bookmarks" },
                    setup_options: { fields: {"#order": "bookmarked-at"},
                        // If a bookmark sort is selected, also enable viewing bookmarks.
                        adjust_url: (args) => args.hash.set("bookmarks", 1),
                    },
                }, {
                    create_options: { label: "Old bookmarks" },
                    setup_options: { fields: {"#order": "-bookmarked-at"},
                        adjust_url: (args) => args.hash.set("bookmarks", 1),
                    },
                }, {
                    create_options: { label: "Shuffle", icon: "shuffle" },
                    setup_options: { fields: {"#order": "shuffle"}, toggle: true },
                }]);

                class bookmark_tag_dropdown extends TagDropdownWidget
                {
                    refresh_tags()
                    {
                        // Clear the tag list.
                        for(let tag of this.container.querySelectorAll(".following-tag"))
                            tag.remove();

                        // Stop if we don't have the tag list yet.
                        if(this.data_source.bookmark_tag_counts == null)
                            return;

                        this.add_tag_link(null); // All
                        this.add_tag_link(""); // Uncategorized

                        let all_tags = Object.keys(this.data_source.bookmark_tag_counts);
                        all_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
                        for(let tag of all_tags)
                        {
                            // Skip uncategorized, which is always placed at the beginning.
                            if(tag == "")
                                continue;

                            if(this.data_source.bookmark_tag_counts[tag] == 0)
                                continue;

                            this.add_tag_link(tag);
                        }
                    }

                    add_tag_link(tag)
                    {
                        let tag_count = this.data_source.bookmark_tag_counts[tag];

                        let tag_name = tag;
                        if(tag_name == null)
                            tag_name = "All bookmarks";
                        else if(tag_name == "")
                            tag_name = "Untagged";

                        // Show the bookmark count in the popup.
                        let popup = null;
                        if(tag_count != null)
                            popup = tag_count + (tag_count == 1? " bookmark":" bookmarks");

                        let a = helpers.create_box_link({
                            label: tag_name,
                            classes: ["following-tag"],
                            data_type: "following-tag",
                            popup,
                            link: "#",
                            as_element: true,
                        });
                        if(tag_name == "All bookmarks")
                            a.dataset.default = 1;

                            this.data_source.set_item(a, {
                            fields: {"#bookmark-tag": tag},
                        });

                        this.container.appendChild(a);
                    }
                }

                this.tag_dropdown = new DropdownMenuOpener({
                    button: this.querySelector(".bookmark-tags-button"),
                    create_box: ({...options}) => new bookmark_tag_dropdown({ data_source, ...options }),
                });

                // Hide the bookmark box if we're not showing bookmarks.
                this.querySelector(".local-bookmark-tags-box").hidden = !data_source.bookmark_search_active;

                data_source.addEventListener("_refresh_ui", () => {
                    // Refresh the displayed label in case we didn't have it when we created the widget.
                    this.tag_dropdown.set_button_popup_highlight();
                }, this._signal);

                let clear_local_search_button = this.querySelector(".clear-local-search");
                clear_local_search_button.addEventListener("click", (e) => {
                    // Get the URL for the current folder and set it to a new URL, so it removes search
                    // parameters.
                    let mediaId = local_api.get_local_id_from_args(data_source.args, { get_folder: true });
                    let args = new helpers.args("/", ppixiv.plocation);
                    local_api.get_args_for_id(mediaId, args);
                    helpers.navigate(args);
                });

                let search_active = local_api.get_search_options_for_args(data_source.args).search_options != null;
                helpers.set_class(clear_local_search_button, "disabled", !search_active);

                this.querySelector(".copy-local-path").addEventListener("click", (e) => {
                    this.copy_link();
                });

                // Hide the "copy local path" button if we don't have one.
                this.querySelector(".copy-local-path").hidden = data_source.local_path == null;

                data_source.set_item(this.container, { type: "local-bookmarks-only", fields: {"#bookmarks": "1"}, toggle: true,
                    adjust_url: (args) => {
                        // If the button is exiting bookmarks, remove bookmark-tag too.
                        if(!args.hash.has("bookmarks"))
                            args.hash.delete("bookmark-tag");
                    }
                });

                // If we're only allowed to do bookmark searches, hide the bookmark search button.
                this.querySelector('[data-type="local-bookmarks-only"]').hidden = local_api.local_info.bookmark_tag_searches_only;
            }
        }
    }

    // We're doing a bookmark search if the bookmark filter is enabled, or if
    // we're restricted to listing tagged bookmarks.
    get bookmark_search_active()
    {
        return this.args.hash.has("bookmarks") || local_api.local_info.bookmark_tag_searches_only;
    }

    async fetch_bookmark_tag_counts()
    {
        if(this.fetched_bookmark_tag_counts)
            return;
        this.fetched_bookmark_tag_counts = true;

        // We don't need to do this if we're not showing bookmarks.
        if(!this.bookmark_search_active)
            return;

        let result = await local_api.local_post_request(`/api/bookmark/tags`);
        if(!result.success)
        {
            console.log("Error fetching bookmark tag counts");
            return;
        }

        this.bookmark_tag_counts = result.tags;
        this.dispatchEvent(new Event("_refresh_ui"));
    }

    copy_link()
    {
        // The user clicked the "copy local link" button.
        navigator.clipboard.writeText(this.local_path);
    }
}
