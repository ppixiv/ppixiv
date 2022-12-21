// bookmark.php
// /users/12345/bookmarks
//
// If id is in the query, we're viewing another user's bookmarks.  Otherwise, we're
// viewing our own.
//
// Pixiv currently serves two unrelated pages for this URL, using an API-driven one
// for viewing someone else's bookmarks and a static page for viewing your own.  We
// always use the API in either case.
//
// For some reason, Pixiv only allows viewing either public or private bookmarks,
// and has no way to just view all bookmarks.
import DataSource, { TagDropdownWidget } from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/ppixiv-imports.js';

export class DataSource_BookmarksBase extends DataSource
{
    get name() { return "bookmarks"; }
  
    constructor(url)
    {
        super(url);

        this.bookmark_tag_counts = [];

        // The subclass sets this once it knows the number of bookmarks in this search.
        this.total_bookmarks = -1;
    }

    async load_page_internal(page)
    {
        this.fetch_bookmark_tag_counts();
        
        // Load the user's info.  We don't need to wait for this to finish.
        let user_info_promise = user_cache.get_user_info_full(this.viewingUserId);
        user_info_promise.then((user_info) => {
            // Stop if we were deactivated before this finished.
            if(!this.active)
                return;

            this.user_info = user_info;
            this.call_update_listeners();
        });

        await this.continue_loading_page_internal(page);
    };

    get supports_start_page()
    {
        // Disable start pages when we're shuffling pages anyway.
        return !this.shuffle;
    }

    get displaying_tag()
    {
        let url = helpers.get_url_without_language(this.url);
        let parts = url.pathname.split("/");
        if(parts.length < 6)
            return null;

        // Replace 未分類 with "" for uncategorized.
        let tag = decodeURIComponent(parts[5]);
        if(tag == "未分類")
            return "";
        return tag;
    }

    // If we haven't done so yet, load bookmark tags for this bookmark page.  This
    // happens in parallel with with page loading.
    async fetch_bookmark_tag_counts()
    {
        if(this.fetched_bookmark_tag_counts)
            return;
        this.fetched_bookmark_tag_counts = true;

        // If we have cached bookmark counts for ourself, load them.
        if(this.viewing_own_bookmarks() && DataSource_BookmarksBase.cached_bookmark_tag_counts != null)
            this.load_bookmark_tag_counts(DataSource_BookmarksBase.cached_bookmark_tag_counts);
        
        // Fetch bookmark tags.  We can do this in parallel with everything else.
        var url = "/ajax/user/" + this.viewingUserId + "/illusts/bookmark/tags";
        var result = await helpers.get_request(url, {});

        // Cache this if we're viewing our own bookmarks, so we can display them while
        // navigating bookmarks.  We'll still refresh it as each page loads.
        if(this.viewing_own_bookmarks())
            DataSource_BookmarksBase.cached_bookmark_tag_counts = result.body;

        this.load_bookmark_tag_counts(result.body);
    }

    load_bookmark_tag_counts(result)
    {
        let public_bookmarks = this.viewing_public;
        let private_bookmarks = this.viewing_private;

        // Reformat the tag list into a format that's easier to work with.
        let tags = { };
        for(let privacy of ["public", "private"])
        {
            let public_tags = privacy == "public";
            if((public_tags && !public_bookmarks) ||
              (!public_tags && !private_bookmarks))
                continue;

            let tag_counts = result[privacy];
            for(let tag_info of tag_counts)
            {
                let tag = tag_info.tag;

                // Rename "未分類" (uncategorized) to "".
                if(tag == "未分類")
                    tag = "";
                
                if(tags[tag] == null)
                    tags[tag] = 0;

                // Add to the tag count.
                tags[tag] += tag_info.cnt;
            }
        }

        // Fill in total_bookmarks from the tag count.  We'll get this from the search API,
        // but we can have it here earlier if we're viewing our own bookmarks and
        // cached_bookmark_tag_counts is filled in.  We can't do this when viewing all bookmarks
        // (summing the counts will give the wrong answer whenever multiple tags are used on
        // one bookmark).
        let displaying_tag = this.displaying_tag;
        if(displaying_tag != null && this.total_bookmarks == -1)
        {
            let count = tags[displaying_tag];
            if(count != null)
                this.total_bookmarks = count;
        }

        // Sort tags by count, so we can trim just the most used tags.  Use the count for the
        // display mode we're in.
        var all_tags = Object.keys(tags);
        all_tags.sort(function(lhs, rhs) {
            return tags[lhs].count - tags[lhs].count;
        });

        if(!this.viewing_own_bookmarks())
        {
            // Trim the list when viewing other users.  Some users will return thousands of tags.
            all_tags.splice(20);
        }

        all_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.bookmark_tag_counts = {};
        for(let tag of all_tags)
            this.bookmark_tag_counts[tag] = tags[tag];

        // Update the UI with the tag list.
        this.dispatchEvent(new Event("_refresh_ui"));
    }
    
    // Get API arguments to query bookmarks.
    //
    // If force_rest isn't null, it's either "show" (public) or "hide" (private), which
    // overrides the search parameters.
    get_bookmark_query_params(page, force_rest)
    {
        var query_args = this.url.searchParams;
        var rest = query_args.get("rest") || "show";
        if(force_rest != null)
            rest = force_rest;

        let tag = this.displaying_tag;
        if(tag == "")
            tag = "未分類"; // Uncategorized
        else if(tag == null)
            tag = "";

        // Load 20 results per page, so our page numbers should match the underlying page if
        // the UI is disabled.
        return {
            tag: tag,
            offset: (page-1)*this.estimated_items_per_page,
            limit: this.estimated_items_per_page,
            rest: rest, // public or private (no way to get both)
        };
    }

    async request_bookmarks(page, rest)
    {
        let data = this.get_bookmark_query_params(page, rest);
        let url = `/ajax/user/${this.viewingUserId}/illusts/bookmarks`;
        let result = await helpers.get_request(url, data);

        if(this.viewing_own_bookmarks())
        {
            // This request includes each bookmark's tags.  Register those with image_data,
            // so the bookmark tag dropdown can display tags more quickly.
            for(let illust of result.body.works)
            {
                let bookmark_id = illust.bookmarkData.id;
                let tags = result.body.bookmarkTags[bookmark_id] || [];

                // illust.id is an int if this image is deleted.  Convert it to a string so it's
                // like other images.
                let mediaId = helpers.illust_id_to_media_id(illust.id.toString());
                extra_cache.singleton().update_cached_bookmark_image_tags(mediaId, tags);
            }
        }

        // Store whether there are any results.  Do this before filtering deleted images,
        // so we know the results weren't empty even if all results on this page are deleted.
        result.body.empty = result.body.works.length == 0;
        result.body.works = DataSource_BookmarksBase.filter_deleted_images(result.body.works);

        return result.body;
    }

    // This is implemented by the subclass to do the main loading.
    async continue_loading_page_internal(page)
    {
        throw "Not implemented";
    }

    get page_title()
    {
        if(!this.viewing_own_bookmarks())
        {
            if(this.user_info)
                return this.user_info.name + "'s Bookmarks";
            else
                return "Loading...";
        }

        return "Bookmarks";
    }

    get_displaying_text()
    {
        if(!this.viewing_own_bookmarks())
        {
            if(this.user_info)
                return this.user_info.name + "'s Bookmarks";
            return "User's Bookmarks";
        }

        let args = new helpers.args(this.url);
        let public_bookmarks = this.viewing_public;
        let private_bookmarks = this.viewing_private;
        let viewing_all = public_bookmarks && private_bookmarks;
        var displaying = "";

        if(this.total_bookmarks != -1)
            displaying += this.total_bookmarks + " ";

        displaying += viewing_all? "Bookmark":
            private_bookmarks? "Private Bookmark":"Public Bookmark";

        // English-centric pluralization:
        if(this.total_bookmarks != 1)
            displaying += "s";

        var tag = this.displaying_tag;
        if(tag == "")
            displaying += ` / untagged`;
        else if(tag != null)
            displaying += ` / ${tag}`;

        return displaying;
    };

    // Return true if we're viewing publig and private bookmarks.  These are overridden
    // in bookmarks_merged.
    get viewing_public()
    {
        let args = new helpers.args(this.url);
        return args.query.get("rest") != "hide";
    }

    get viewing_private()
    {
        let args = new helpers.args(this.url);
        return args.query.get("rest") == "hide";
    }

    get ui()
    {
        return class extends Widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div class=box-button-row>
                        <div class=box-button-row>
                            <!-- These are hidden if you're viewing somebody else's bookmarks. -->
                            <span class=bookmarks-public-private style="margin-right: 25px;">
                                ${ helpers.create_box_link({label: "All",        popup: "Show all bookmarks",       data_type: "all" }) }
                                ${ helpers.create_box_link({label: "Public",     popup: "Show public bookmarks",    data_type: "public" }) }
                                ${ helpers.create_box_link({label: "Private",    popup: "Show private bookmarks",   data_type: "private" }) }
                            </span>

                            ${ helpers.create_box_link({ popup: "Shuffle", icon: "shuffle",   data_type: "order-shuffle" }) }
                        </div>

                        ${ helpers.create_box_link({label: "All bookmarks",    popup: "Bookmark tags",  icon: "ppixiv:tag", classes: ["bookmark-tag-button"] }) }
                    </div>
                `});

                this.data_source = data_source;

                // Refresh the displayed label in case we didn't have it when we created the widget.
                this.data_source.addEventListener("_refresh_ui", () => this.tag_dropdown.set_button_popup_highlight(), this._signal);

                // The public/private button only makes sense when viewing your own bookmarks.
                let public_private_button_container = this.querySelector(".bookmarks-public-private");
                public_private_button_container.hidden = !this.data_source.viewing_own_bookmarks();

                // Set up the public and private buttons.  The "all" button also removes shuffle, since it's not
                // supported there.
                this.data_source.set_item(public_private_button_container, { type: "all", fields: {"#show-all": 1, "#shuffle": null}, default_values: {"#show-all": 1} });
                this.data_source.set_item(this.container, { type: "public", fields: {rest: null, "#show-all": 0}, default_values: {"#show-all": 1} });
                this.data_source.set_item(this.container, { type: "private", fields: {rest: "hide", "#show-all": 0}, default_values: {"#show-all": 1} });

                // Shuffle isn't supported for merged bookmarks.  If we're on #show-all, make the shuffle button
                // also switch to public bookmarks.  This is easier than graying it out and trying to explain it
                // in the popup, and better than hiding it which makes it hard to find.
                let args = new helpers.args(this.data_source.url);
                let show_all = args.hash.get("show-all") != "0";
                let set_public = show_all? { rest: null, "#show-all": 0 }:{};
                this.data_source.set_item(this.container, {type: "order-shuffle", fields: {"#shuffle": 1, ...set_public}, toggle: true, default_values: {"#shuffle": null, "#show-all": 1}});

                class bookmark_tags_dropdown extends TagDropdownWidget
                {
                    refresh_tags()
                    {
                        for(let tag of this.container.querySelectorAll(".tag-entry"))
                            tag.remove();

                        this.add_tag_link(null); // All
                        this.add_tag_link(""); // Uncategorized

                        let all_tags = Object.keys(data_source.bookmark_tag_counts);
                        all_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
                        for(let tag of all_tags)
                        {
                            // Skip uncategorized, which is always placed at the beginning.
                            if(tag == "")
                                continue;

                            if(data_source.bookmark_tag_counts[tag] == 0)
                                continue;

                            this.add_tag_link(tag);
                        }
                    }                    

                    add_tag_link(tag)
                    {
                        let label;
                        if(tag == null)
                            label = "All bookmarks";
                        else if(tag == "")
                            label = "Untagged";
                        else
                            label = tag;

                        let a = helpers.create_box_link({
                            label,
                            classes: ["tag-entry"],
                            popup: data_source.bookmark_tag_counts[tag],
                            link: "#",
                            as_element: true,
                            data_type: "bookmark-tag",
                        });

                        if(label == "All bookmarks")
                            a.dataset.default = 1;

                        if(tag == "")
                            tag = "未分類"; // Uncategorized

                        data_source.set_item(a, {
                            url_format: "users/id/bookmarks/type/tag",
                            fields: {"/tag": tag},
                        });

                        this.container.appendChild(a);
                    };
                };

                // Create the bookmark tag dropdown.
                this.tag_dropdown = new DropdownMenuOpener({
                    button: this.querySelector(".bookmark-tag-button"),
                    create_box: ({...options}) => new bookmark_tags_dropdown({data_source, ...options}),
                });
            }
        };
    }

    get uiInfo()
    {
        return {
            userId: this.viewing_own_bookmarks()? null:this.viewingUserId,
        }
    }

    get viewingUserId()
    {
        // /users/13245/bookmarks
        //
        // This is currently only used for viewing other people's bookmarks.  Your own bookmarks are still
        // viewed with /bookmark.php with no ID.
        return helpers.get_path_part(this.url, 1);
    };

    // Return true if we're viewing our own bookmarks.
    viewing_own_bookmarks()
    {
        return this.viewingUserId == window.global_data.user_id;
    }

    // Don't show bookmark icons for the user's own bookmarks.  Every image on that page
    // is bookmarked, so it's just a lot of noise.
    get show_bookmark_icons()
    {
        return !this.viewing_own_bookmarks();
    }

    // Bookmark results include deleted images.  These are weird and a bit broken:
    // the post ID is an integer instead of a string (which makes more sense but is
    // inconsistent with other results) and the data is mostly empty or garbage.
    // Check isBookmarkable to filter these out.
    static filter_deleted_images(images)
    {
        let result = [];
        for(let image of images)
        {
            if(!image.isBookmarkable)
            {
                console.log("Discarded deleted bookmark " + image.id);
                continue;
            }
            result.push(image);
        }
        return result;
    }
}

// Normal bookmark querying.  This can only retrieve public or private bookmarks,
// and not both.
export class Bookmarks extends DataSource_BookmarksBase
{
    get shuffle()
    {
        let args = new helpers.args(this.url);
        return args.hash.has("shuffle");
    }

    async continue_loading_page_internal(page)
    {
        let page_to_load = page;
        if(this.shuffle)
        {
            // We need to know the number of pages in order to shuffle, so load the first page.
            // This is why we don't support this for merged bookmark loading: we'd need to load
            // both first pages, then both first shuffled pages, so we'd be making four bookmark
            // requests all at once.
            if(this.total_shuffled_bookmarks == null)
            {
                let result = await this.request_bookmarks(1, null);

                this.total_shuffled_bookmarks = result.total;
                this.total_pages = Math.ceil(this.total_shuffled_bookmarks / this.estimated_items_per_page);

                // Create a shuffled page list.
                this.shuffled_pages = [];
                for(let p = 1; p <= this.total_pages; ++p)
                    this.shuffled_pages.push(p);

                helpers.shuffle_array(this.shuffled_pages);
            }

            if(page < this.shuffled_pages.length)
                page_to_load = this.shuffled_pages[page];
        }

        let result = await this.request_bookmarks(page_to_load, null);

        var media_ids = [];
        for(let illust_data of result.works)
            media_ids.push(helpers.illust_id_to_media_id(illust_data.id)); 

        // If we're shuffling, shuffle the individual illustrations too.
        if(this.shuffle)
            helpers.shuffle_array(media_ids);
        
        await ppixiv.media_cache.add_media_infos_partial(result.works, "normal");

        // Register the new page of data.  If we're shuffling, use the original page number, not the
        // shuffled page.
        //
        // If media_ids is empty but result.empty is false, we had results in the list but we
        // filtered them all out.  Set allowEmpty to true in this case so we add the empty page,
        // or else it'll look like we're at the end of the results when we know we aren't.
        this.add_page(page, media_ids, {
            allowEmpty: !result.empty,
        });

        // Remember the total count, for display.
        this.total_bookmarks = result.total;
    }
};

// Merged bookmark querying.  This makes queries for both public and private bookmarks,
// and merges them together.
export class BookmarksMerged extends DataSource_BookmarksBase
{
    get viewing_public() { return true; }
    get viewing_private() { return true; }

    constructor(url)
    {
        super(url);

        this.max_page_per_type = [-1, -1]; // public, private
        this.bookmark_illust_ids = [[], []]; // public, private
        this.bookmark_totals = [0, 0]; // public, private
    }

    async continue_loading_page_internal(page)
    {
        // Request both the public and private bookmarks on the given page.  If we've
        // already reached the end of either of them, don't send that request.
        let request1 = this.request_bookmark_type(page, "show");
        let request2 = this.request_bookmark_type(page, "hide");

        // Wait for both requests to finish.
        await Promise.all([request1, request2]);

        // Both requests finished.  Combine the two lists of illust IDs into a single page
        // and register it.
        let media_ids = [];
        for(var i = 0; i < 2; ++i)
            if(this.bookmark_illust_ids[i] != null && this.bookmark_illust_ids[i][page] != null)
                media_ids = media_ids.concat(this.bookmark_illust_ids[i][page]);
        
        this.add_page(page, media_ids);

        // Combine the two totals.
        this.total_bookmarks = this.bookmark_totals[0] + this.bookmark_totals[1];
    }

    async request_bookmark_type(page, rest)
    {
        var is_private = rest == "hide"? 1:0;
        var max_page = this.max_page_per_type[is_private];
        if(max_page != -1 && page > max_page)
        {
            // We're past the end.
            console.log("page", page, "beyond", max_page, rest);
            return;
        }

        let result = await this.request_bookmarks(page, rest);

        // Put higher (newer) bookmarks first.
        result.works.sort(function(lhs, rhs)
        {
            return parseInt(rhs.bookmarkData.id) - parseInt(lhs.bookmarkData.id);
        });

        var media_ids = [];
        for(let illust_data of result.works)
            media_ids.push(helpers.illust_id_to_media_id(illust_data.id));

        await ppixiv.media_cache.add_media_infos_partial(result.works, "normal");

        // If there are no results, remember that this is the last page, so we don't
        // make more requests for this type.  Use the "empty" flag for this and not
        // whether there are any media IDs, in case there were IDs but they're all
        // deleted.
        if(result.empty)
        {
            if(this.max_page_per_type[is_private] == -1)
                this.max_page_per_type[is_private] = page;
            else
                this.max_page_per_type[is_private] = Math.min(page, this.max_page_per_type[is_private]);
            // console.log("max page for", is_private? "private":"public", this.max_page_per_type[is_private]);
        }

        // Store the IDs.  We don't register them here.
        this.bookmark_illust_ids[is_private][page] = media_ids;

        // Remember the total count, for display.
        this.bookmark_totals[is_private] = result.total;
    }
}
