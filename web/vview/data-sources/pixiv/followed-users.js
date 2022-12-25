import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_Follows extends DataSource
{
    get name() { return "following"; }
    get supportsStartPage() { return true;}
    get ui() { return UI; }
  
    constructor(url)
    {
        super(url);

        this.followTags = [];
    }

    get viewingUserId()
    {
        if(helpers.strings.getPathPart(this.url, 0) == "users")
        {
            // New URLs (/users/13245/follows)
            return helpers.strings.getPathPart(this.url, 1);
        }
        
        let queryArgs = this.url.searchParams;
        let userId = queryArgs.get("id");
        if(userId == null)
            return ppixiv.pixivInfo.userId;
        
        return userId;
    };

    async loadPageInternal(page)
    {
        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        this.userInfo = await ppixiv.userCache.getUserInfoFull(this.viewingUserId);

        // Update to refresh our page title, which uses userInfo.
        this.callUpdateListeners();

        let queryArgs = this.url.searchParams;
        let rest = queryArgs.get("rest") || "show";
        let acceptingRequests = queryArgs.get("acceptingRequests") || "0";

        let url = "/ajax/user/" + this.viewingUserId + "/following";
        let args = {
            offset: this.estimatedItemsPerPage*(page-1),
            limit: this.estimatedItemsPerPage,
            rest: rest,
            acceptingRequests,
        };
        if(queryArgs.get("tag"))
            args.tag = queryArgs.get("tag");
        let result = await helpers.pixivRequest.get(url, args);

        // Store following tags.
        this.followTags = result.body.followUserTags;
        this.followTags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.callUpdateListeners();

        // Make a list of the first illustration for each user.
        let illusts = [];
        for(let followedUser of result.body.users)
        {
            if(followedUser == null)
                continue;

            // Register this as quick user data, for use in thumbnails.
            ppixiv.extraCache.addQuickUserData(followedUser, "following");

            if(!followedUser.illusts.length)
            {
                console.log("Can't show followed user that has no posts:", followedUser.userId);
                continue;
            }

            let illust = followedUser.illusts[0];
            illusts.push(illust);

            // We'll register this with MediaCache below.  These results don't have profileImageUrl
            // and only put it in the enclosing user, so copy it over.
            illust.profileImageUrl = followedUser.profileImageUrl;
        }

        let mediaIds = [];
        for(let illust of illusts)
            mediaIds.push("user:" + illust.userId);

        await ppixiv.mediaCache.addMediaInfosPartial(illusts, "normal");

        // Register the new page of data.
        this.addPage(page, mediaIds);
    }

    get uiInfo()
    {
        return {
            userId: this.viewingSelf? null:this.viewingUserId,
        }
    }

    get viewingSelf()
    {
        return this.viewingUserId == ppixiv.pixivInfo.userId;
    }

    get pageTitle()
    {
        if(!this.viewingSelf)
        {
            if(this.userInfo)
                return this.userInfo.name + "'s Follows";
            return "User's follows";
        }

        let queryArgs = this.url.searchParams;
        let privateFollows = queryArgs.get("rest") == "hide";
        return privateFollows? "Private follows":"Followed users";
    };

    getDisplayingText()
    {
        if(!this.viewingSelf)
        {
            if(this.userInfo)
                return this.userInfo.name + "'s followed users";
            return "User's followed users";
        }

        let queryArgs = this.url.searchParams;
        let privateFollows = queryArgs.get("rest") == "hide";
        return privateFollows? "Private follows":"Followed users";
    };
}

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div>
                <div class=box-button-row>
                    <div class=box-button-row>
                        <vv-container class=follows-public-private style="margin-right: 25px;">
                            ${ helpers.createBoxLink({label: "Public",    popup: "Show publically followed users",   dataType: "public-follows" }) }
                            ${ helpers.createBoxLink({label: "Private",    popup: "Show privately followed users",   dataType: "private-follows" }) }
                        </vv-container>

                        ${ helpers.createBoxLink({ popup: "Accepting requests", icon: "paid",   dataType: "accepting-requests" }) }
                    </div>

                    ${ helpers.createBoxLink({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["follow-tags-button", "premium-only"] }) }
                </div>
            </div>
        `});

        this.dataSource = dataSource;

        // The public/private button only makes sense when viewing your own follows.
        let publicPrivateButtonContainer = this.querySelector(".follows-public-private");
        publicPrivateButtonContainer.hidden = !dataSource.viewingSelf;

        dataSource.setItem(this.container, { type: "public-follows", fields: {rest: "show"}, defaults: {rest: "show"} });
        dataSource.setItem(this.container, { type: "private-follows", fields: {rest: "hide"}, defaults: {rest: "show"} });
        dataSource.setItem(this.container, { type: "accepting-requests", toggle: true, fields: {acceptingRequests: "1"}, defaults: {acceptingRequests: "0"}});

        class FollowTabDropdown extends Widget
        {
            constructor()
            {
                super({
                    ...options,
                    template: `<div class="follow-tag-list vertical-list"></div>`,
                });

                dataSource.addEventListener("updated", () => this.refreshFollowingTags(), this._signal);
                this.refreshFollowingTags();
            }

            refreshFollowingTags()
            {
                let tagList = this.container;
                for(let tag of tagList.querySelectorAll(".tag-entry"))
                    tag.remove();

                // Refresh the bookmark tag list.  Remove the page number from these buttons.
                let currentTag = dataSource.url.searchParams.get("tag") || "All tags";

                let addTagLink = (tag) =>
                {
                    // Work around Pixiv always returning a follow tag named "null" for some users.
                    if(tag == "null")
                        return;

                    let a = helpers.createBoxLink({
                        label: tag,
                        classes: ["tag-entry"],
                        link: "#",
                        asElement: true,
                        dataType: "following-tag",
                    });

                    if(tag == "All tags")
                    {
                        tag = null;
                        a.dataset.default = 1;
                    }

                    dataSource.setItem(a, { fields: {"tag": tag} });

                    tagList.appendChild(a);
                };

                addTagLink("All tags");
                for(let tag of dataSource.followTags)
                    addTagLink(tag);

                // If we don't have the tag list yet because we're still loading the page, fill in
                // the current tag, to reduce flicker as the page loads.
                if(dataSource.followTags.length == 0 && currentTag != "All tags")
                    addTagLink(currentTag);
            }
        }
        // Create the follow tag dropdown.
        new DropdownMenuOpener({
            button: this.querySelector(".follow-tags-button"),
            createBox: ({...options}) => new FollowTabDropdown({dataSource, ...options}),
        });
    }
}
