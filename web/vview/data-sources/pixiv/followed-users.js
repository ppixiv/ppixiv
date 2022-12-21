import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_Follows extends DataSource
{
    get name() { return "following"; }
    get can_return_manga() { return false; }
  
    constructor(url)
    {
        super(url);

        this.follow_tags = [];
    }

    get supports_start_page()
    {
        return true;
    }

    get viewingUserId()
    {
        if(helpers.get_path_part(this.url, 0) == "users")
        {
            // New URLs (/users/13245/follows)
            return helpers.get_path_part(this.url, 1);
        }
        
        var query_args = this.url.searchParams;
        let user_id = query_args.get("id");
        if(user_id == null)
            return window.global_data.user_id;
        
        return user_id;
    };

    async load_page_internal(page)
    {
        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        this.user_info = await ppixiv.user_cache.get_user_info_full(this.viewingUserId);

        // Update to refresh our page title, which uses user_info.
        this.call_update_listeners();

        var query_args = this.url.searchParams;
        var rest = query_args.get("rest") || "show";
        let acceptingRequests = query_args.get("acceptingRequests") || "0";

        var url = "/ajax/user/" + this.viewingUserId + "/following";
        let args = {
            offset: this.estimated_items_per_page*(page-1),
            limit: this.estimated_items_per_page,
            rest: rest,
            acceptingRequests,
        };
        if(query_args.get("tag"))
            args.tag = query_args.get("tag");
        let result = await helpers.get_request(url, args);

        // Store following tags.
        this.follow_tags = result.body.followUserTags;
        this.follow_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.dispatchEvent(new Event("_refresh_ui"));

        // Make a list of the first illustration for each user.
        var illusts = [];
        for(let followed_user of result.body.users)
        {
            if(followed_user == null)
                continue;

            // Register this as quick user data, for use in thumbnails.
            ppixiv.extra_cache.add_quick_user_data(followed_user, "following");

            // XXX: user:user_id
            if(!followed_user.illusts.length)
            {
                console.log("Can't show followed user that has no posts:", followed_user.userId);
                continue;
            }

            let illust = followed_user.illusts[0];
            illusts.push(illust);

            // We'll register this with media_info below.  These results don't have profileImageUrl
            // and only put it in the enclosing user, so copy it over.
            illust.profileImageUrl = followed_user.profileImageUrl;
        }

        var media_ids = [];
        for(let illust of illusts)
            media_ids.push("user:" + illust.userId);

        await ppixiv.media_cache.add_media_infos_partial(illusts, "normal");

        // Register the new page of data.
        this.add_page(page, media_ids);
    }

    get ui()
    {
        return class extends Widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class=box-button-row>
                            <div class=box-button-row>
                                <vv-container class=follows-public-private style="margin-right: 25px;">
                                    ${ helpers.create_box_link({label: "Public",    popup: "Show publically followed users",   data_type: "public-follows" }) }
                                    ${ helpers.create_box_link({label: "Private",    popup: "Show privately followed users",   data_type: "private-follows" }) }
                                </vv-container>

                                ${ helpers.create_box_link({ popup: "Accepting requests", icon: "paid",   data_type: "accepting-requests" }) }
                            </div>

                            ${ helpers.create_box_link({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["follow-tags-button", "premium-only"] }) }
                        </div>
                    </div>
                `});

                this.data_source = data_source;

                // The public/private button only makes sense when viewing your own follows.
                let public_private_button_container = this.querySelector(".follows-public-private");
                public_private_button_container.hidden = !data_source.viewing_self;

                data_source.set_item(this.container, { type: "public-follows", fields: {rest: "show"}, default_values: {rest: "show"} });
                data_source.set_item(this.container, { type: "private-follows", fields: {rest: "hide"}, default_values: {rest: "show"} });
                data_source.set_item(this.container, { type: "accepting-requests", toggle: true, fields: {acceptingRequests: "1"}, default_values: {acceptingRequests: "0"}});

                class follow_tag_dropdown extends Widget
                {
                    constructor()
                    {
                        super({
                            ...options,
                            template: `<div class="follow-tag-list vertical-list"></div>`,
                        });

                        data_source.addEventListener("_refresh_ui", () => this.refresh_following_tags(), this._signal);
                        this.refresh_following_tags();
                    }

                    refresh_following_tags()
                    {
                        let tag_list = this.container;
                        for(let tag of tag_list.querySelectorAll(".tag-entry"))
                            tag.remove();
        
                        // Refresh the bookmark tag list.  Remove the page number from these buttons.
                        let current_tag = data_source.url.searchParams.get("tag") || "All tags";
        
                        let add_tag_link = (tag) =>
                        {
                            // Work around Pixiv always returning a follow tag named "null" for some users.
                            if(tag == "null")
                                return;
        
                            let a = helpers.create_box_link({
                                label: tag,
                                classes: ["tag-entry"],
                                link: "#",
                                as_element: true,
                                data_type: "following-tag",
                            });
        
                            if(tag == "All tags")
                            {
                                tag = null;
                                a.dataset.default = 1;
                            }
        
                            data_source.set_item(a, { fields: {"tag": tag} });
        
                            tag_list.appendChild(a);
                        };
        
                        add_tag_link("All tags");
                        for(let tag of data_source.follow_tags)
                            add_tag_link(tag);
        
                        // If we don't have the tag list yet because we're still loading the page, fill in
                        // the current tag, to reduce flicker as the page loads.
                        if(data_source.follow_tags.length == 0 && current_tag != "All tags")
                            add_tag_link(current_tag);
                    }
                }
                // Create the follow tag dropdown.
                new DropdownMenuOpener({
                    button: this.querySelector(".follow-tags-button"),
                    create_box: ({...options}) => new follow_tag_dropdown({data_source, ...options}),
                });
            }
        }
    }

    get uiInfo()
    {
        return {
            userId: this.viewing_self? null:this.viewingUserId,
        }
    }

    get viewing_self()
    {
        return this.viewingUserId == window.global_data.user_id;
    }

    get page_title()
    {
        if(!this.viewing_self)
        {
            if(this.user_info)
                return this.user_info.name + "'s Follows";
            return "User's follows";
        }

        var query_args = this.url.searchParams;
        var private_follows = query_args.get("rest") == "hide";
        return private_follows? "Private follows":"Followed users";
    };

    get_displaying_text()
    {
        if(!this.viewing_self)
        {
            if(this.user_info)
                return this.user_info.name + "'s followed users";
            return "User's followed users";
        }

        var query_args = this.url.searchParams;
        var private_follows = query_args.get("rest") == "hide";
        return private_follows? "Private follows":"Followed users";
    };
}
