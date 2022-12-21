// - User illustrations
//
// /users/# 
// /users/#/artworks
// /users/#/illustrations
// /users/#/manga
//
// We prefer to link to the /artworks page, but we handle /users/# as well.

import DataSource, { PaginateMediaIds, TagDropdownWidget } from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/ppixiv-imports.js';

export default class DataSources_Artist extends DataSource
{
    get name() { return "artist"; }
  
    constructor(url)
    {
        super(url);

        this.fanbox_url = null;
        this.booth_url = null;
    }

    get supports_start_page() { return true; }

    get viewingUserId()
    {
        // /users/13245
        return helpers.get_path_part(this.url, 1);
    };

    // Return "artworks" (all), "illustrations" or "manga".
    get viewing_type()
    {
        // The URL is one of:
        //
        // /users/12345
        // /users/12345/artworks
        // /users/12345/illustrations
        // /users/12345/manga
        //
        // The top /users/12345 page is the user's profile page, which has the first page of images, but
        // instead of having a link to page 2, it only has "See all", which goes to /artworks and shows you
        // page 1 again.  That's pointless, so we treat the top page as /artworks the same.  /illustrations
        // and /manga filter those types.
        let url = helpers.get_url_without_language(this.url);
        let parts = url.pathname.split("/");
        return parts[3] || "artworks";
    }

    async load_page_internal(page)
    {
        // We'll load translations for all tags if the tag dropdown is opened, but for now
        // just load the translation for the selected tag, so it's available for the button text.
        let current_tag = this.current_tag;
        if(current_tag != null)
        {
            this.translated_tags = await ppixiv.tag_translations.get_translations([current_tag], "en");
            this.call_update_listeners();
        }

        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        this.user_info = await ppixiv.user_cache.get_user_info_full(this.viewingUserId);

        // Update to refresh our page title, which uses user_info.
        this.call_update_listeners();

        let args = new helpers.args(this.url);
        var tag = args.query.get("tag") || "";
        if(tag == "")
        {
            // If we're not filtering by tag, use the profile/all request.  This returns all of
            // the user's illust IDs but no thumb data.
            //
            // We can use the "illustmanga" code path for this by leaving the tag empty, but
            // we do it this way since that's what the site does.
            if(this.pages == null)
            {
                let all_media_ids = await this.load_all_results();
                this.pages = PaginateMediaIds(all_media_ids, this.estimated_items_per_page);
            }

            // Tell media_cache to start loading these media IDs.  This will happen anyway if we don't
            // do it here, but we know these posts are all from the same user ID, so kick it off here
            // to hint batch_get_media_info_partial to use the user-specific API.  Don't wait for this
            // to complete, since we don't need to and it'll cause the search view to take longer to
            // appear.
            let media_ids = this.pages[page-1] || [];
            ppixiv.media_cache.batch_get_media_info_partial(media_ids, { user_id: this.viewingUserId });

            // Register this page.
            this.add_page(page, media_ids);
        }
        else
        {
            // We're filtering by tag.
            var type = args.query.get("type");

            // For some reason, this API uses a random field in the URL for the type instead of a normal
            // query parameter.
            var type_for_url =
                type == null? "illustmanga":
                type == "illust"?"illusts":
                "manga";

            var request_url = "/ajax/user/" + this.viewingUserId + "/" + type_for_url + "/tag";
            var result = await helpers.get_request(request_url, {
                tag: tag,
                offset: (page-1)*48,
                limit: 48,
            });

            // This data doesn't have profileImageUrl or userName.  That's presumably because it's
            // used on user pages which get that from user data, but this seems like more of an
            // inconsistency than an optimization.  Fill it in for media_info.
            for(var item of result.body.works)
            {
                item.userName = this.user_info.name;
                item.profileImageUrl = this.user_info.imageBig;
            }

            var media_ids = [];
            for(var illust_data of result.body.works)
                media_ids.push(helpers.illust_id_to_media_id(illust_data.id)); 

            await ppixiv.media_cache.add_media_infos_partial(result.body.works, "normal");

            // Register the new page of data.
            this.add_page(page, media_ids);
        }
    }
    
    add_extra_links(links)
    {
        // Add the Fanbox link to the list if we have one.
        if(this.fanbox_url)
            links.push({url: this.fanbox_url, label: "Fanbox"});
        if(this.booth_url)
            links.push({url: this.booth_url, label: "Booth"});

        if(this.accepting_requests)
        {
            links.push({
                url: new URL(`/users/${this.viewingUserId}/request#no-ppixiv`, ppixiv.plocation),
                type: "request",
                label: "Accepting requests",
            });
        }
    }

    async load_all_results()
    {
        let type = this.viewing_type;

        let result = await helpers.get_request("/ajax/user/" + this.viewingUserId + "/profile/all", {});

        // Remember if this user is accepting requests, so we can add a link.
        this.accepting_requests = result.body.request.showRequestTab;

        // See if there's a Fanbox link.
        //
        // For some reason Pixiv supports links to Twitter and Pawoo natively in the profile, but Fanbox
        // can only be linked in this weird way outside the regular user profile info.
        for(let pickup of result.body.pickup)
        {
            if(pickup.type != "fanbox")
                continue;

            // Remove the Google analytics junk from the URL.
            let url = new URL(pickup.contentUrl);
            url.search = "";
            this.fanbox_url = url.toString();
        }
        this.call_update_listeners();

        // If this user has a linked Booth account, look it up.  Only do this if the profile indicates
        // that it exists.  Don't wait for this to complete.
        if(result.body?.externalSiteWorksStatus?.booth)
            this.load_booth();

        var illust_ids = [];
        if(type == "artworks" || type == "illustrations")
            for(var illust_id in result.body.illusts)
                illust_ids.push(illust_id);
        if(type == "artworks" || type == "manga")
            for(var illust_id in result.body.manga)
                illust_ids.push(illust_id);

        // Sort the two sets of IDs back together, putting higher (newer) IDs first.
        illust_ids.sort(function(lhs, rhs)
        {
            return parseInt(rhs) - parseInt(lhs);
        });

        var media_ids = [];
        for(let illust_id of illust_ids)
            media_ids.push(helpers.illust_id_to_media_id(illust_id));

        return media_ids;
    };

    async load_booth()
    {
        let booth_request = await helpers.get_request("https://api.booth.pm/pixiv/shops/show.json", {
            pixiv_user_id: this.viewingUserId,
            adult: "include",
            limit: 24,
        });

        let booth = await booth_request;
        if(booth.error)
        {
            console.log(`Error reading Booth profile for ${this.viewingUserId}`);
            return;
        }

        this.booth_url = booth.body.url;
        this.call_update_listeners();
    }

    // If we're filtering a follow tag, return it.  Otherwise, return null.
    get current_tag()
    {
        let args = new helpers.args(this.url);
        return args.query.get("tag");
    }

    get ui()
    {
        return class extends Widget
        {
            constructor({data_source, ...options})
            {
                super({ ...options, template: `
                    <div>
                        <div class="box-button-row search-options-row">
                            ${ helpers.create_box_link({label: "Works",    popup: "Show all works",            data_type: "artist-works" }) }
                            ${ helpers.create_box_link({label: "Illusts",  popup: "Show illustrations only",   data_type: "artist-illust" }) }
                            ${ helpers.create_box_link({label: "Manga",    popup: "Show manga only",           data_type: "artist-manga" }) }
                            ${ helpers.create_box_link({label: "Tags",     popup: "Tags", icon: "bookmark", classes: ["member-tags-button"] }) }
                        </div>

                        <vv-container class=avatar-container></vv-container>
                    </div>
                `});

                this.data_source = data_source;

                data_source.addEventListener("_refresh_ui", () => {
                    // Refresh the displayed label in case we didn't have it when we created the widget.
                    this.tag_dropdown.set_button_popup_highlight();
                }, this._signal);

                data_source.set_path_item(this.container, "artist-works", 2, "artworks");
                data_source.set_path_item(this.container, "artist-illust", 2, "illustrations");
                data_source.set_path_item(this.container, "artist-manga", 2, "manga");

                // On mobile, create our own avatar display for the search popup.
                if(ppixiv.mobile)
                {
                    let avatar_container = this.container.querySelector(".avatar-container");
                    this.avatar_widget = new avatar_widget({
                        container: avatar_container,
                        big: true,
                        mode: "dropdown",
                    });
                    this.avatar_widget.set_user_id(data_source.viewingUserId);
                }

                class tag_dropdown extends TagDropdownWidget
                {
                    refresh_tags()
                    {
                        // Refresh the post tag list.
                        helpers.remove_elements(this.container);

                        if(data_source.post_tags != null)
                        {
                            this.add_tag_link({ tag: "All" });
                            for(let tag_info of data_source.post_tags || [])
                                this.add_tag_link(tag_info);
                        }
                        else
                        {
                            // Tags aren't loaded yet.  We'll be refreshed after tag_list_opened loads tags.
                            // If a tag is selected, fill in just that tag so the button text works.
                            var span = document.createElement("span");
                            span.innerText = "Loading...";
                            this.container.appendChild(span);

                            this.add_tag_link({ tag: "All" });

                            let current_tag = data_source.current_tag;
                            if(current_tag != null)
                                this.add_tag_link({ tag: current_tag });
                        }
                    }

                    add_tag_link(tag_info)
                    {
                        // Skip tags with very few posts.  This list includes every tag the author
                        // has ever used, and ends up being pages long with tons of tags that were
                        // only used once.
                        if(tag_info.tag != "All" && tag_info.cnt < 5)
                            return;

                        let tag = tag_info.tag;
                        let translated_tag = tag;
                        if(data_source.translated_tags && data_source.translated_tags[tag])
                            translated_tag = data_source.translated_tags[tag];

                        let classes = ["tag-entry"];

                        // If the user has searched for this tag recently, add the recent tag.  This is added
                        // in tag_list_opened.
                        if(tag_info.recent)
                            classes.push("recent");

                        let a = helpers.create_box_link({
                            label: translated_tag,
                            classes,
                            popup: tag_info?.cnt,
                            link: "#",
                            as_element: true,
                            data_type: "artist-tag",
                        });

                        data_source.set_item(a, { fields: {"tag": tag != "All"? tag:null} });

                        if(tag == "All")
                            a.dataset["default"] = 1;

                        this.container.appendChild(a);
                    };
                };

                this.tag_dropdown = new DropdownMenuOpener({
                    button: this.querySelector(".member-tags-button"),
                    create_box: ({...options}) => new tag_dropdown({data_source, ...options}),
                    onvisibilitychanged: (opener) => {
                        // Populate the tags dropdown if it's opened, so we don't load user tags for every user page.
                        if(opener.visible);
                            data_source.tag_list_opened();
                    }
                });
            }
        }
    }

    get uiInfo()
    {
        return {
            userId: this.viewingUserId,
        }
    }

    // This is called when the tag list dropdown is opened.
    async tag_list_opened()
    {
        // Get user info.  We probably have this on this.user_info, but that async load
        // might not be finished yet.
        let user_info = await ppixiv.user_cache.get_user_info_full(this.viewingUserId);
        console.log("Loading tags for user", user_info.userId);

        // Load this artist's common tags.
        this.post_tags = await this.get_user_tags(user_info);

        // Mark the tags in this.post_tags that the user has searched for recently, so they can be
        // marked in the UI.
        let user_tag_searches = ppixiv.SavedSearchTags.get_all_used_tags();
        for(let tag of this.post_tags)
            tag.recent = user_tag_searches.has(tag.tag);

        // Move tags that this artist uses to the top if the user has searched for them recently.
        this.post_tags.sort((lhs, rhs) => {
            if(rhs.recent != lhs.recent)
                return rhs.recent - lhs.recent;
            else
                return rhs.cnt - lhs.cnt;
        });

        let tags = [];
        for(let tag_info of this.post_tags)
            tags.push(tag_info.tag);
        this.translated_tags = await ppixiv.tag_translations.get_translations(tags, "en");

        // Refresh the tag list now that it's loaded.
        this.dispatchEvent(new Event("_refresh_ui"));
    }

    async get_user_tags(user_info)
    {
        if(user_info.frequentTags)
            return Array.from(user_info.frequentTags);

        var result = await helpers.get_request("/ajax/user/" + user_info.userId + "/illustmanga/tags", {});
        if(result.error)
        {
            console.error("Error fetching tags for user " + user_info.userId + ": " + result.error);
            user_info.frequentTags = [];
            return Array.from(user_info.frequentTags);
        }

        // Sort most frequent tags first.
        result.body.sort(function(lhs, rhs) {
            return rhs.cnt - lhs.cnt;
        })

        // Store translations.
        let translations = [];
        for(let tag_info of result.body)
        {
            if(tag_info.tag_translation == "")
                continue;

            translations.push({
                tag: tag_info.tag,
                translation: {
                    en: tag_info.tag_translation,
                },
            });
        }
        ppixiv.tag_translations.add_translations(translations);

        // Cache the results on the user info.
        user_info.frequentTags = result.body;
        return Array.from(user_info.frequentTags);
    }

    get page_title()
    {
        if(this.user_info)
            return this.user_info.name;
        else
            return "Loading...";
    }

    get_displaying_text()
    {
        if(this.user_info)
            return this.user_info.name + "'s Illustrations";
        else
            return "Illustrations";
    };
}
