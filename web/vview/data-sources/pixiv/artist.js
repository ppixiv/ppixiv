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
import SavedSearchTags from 'vview/misc/saved-search-tags.js';
import * as InfoLinks from 'vview/data-sources/info-links.js';
import { AvatarWidget } from 'vview/widgets/user-widgets.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSources_Artist extends DataSource
{
    get name() { return "artist"; }
    get ui() { return UI; }

    constructor(url)
    {
        super(url);

        this.fanboxUrl = null;
        this.boothUrl = null;
    }

    get supportsStartPage() { return true; }

    get viewingUserId()
    {
        // /users/13245
        return helpers.strings.getPathPart(this.url, 1);
    };

    // Return "artworks" (all), "illustrations" or "manga".
    get viewingType()
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
        let url = helpers.pixiv.getUrlWithoutLanguage(this.url);
        let parts = url.pathname.split("/");
        return parts[3] || "artworks";
    }

    async loadPageInternal(page)
    {
        // We'll load translations for all tags if the tag dropdown is opened, but for now
        // just load the translation for the selected tag, so it's available for the button text.
        let currentTag = this.currentTag;
        if(currentTag != null)
        {
            this.translatedTags = await ppixiv.tagTranslations.getTranslations([currentTag], "en");
            this.callUpdateListeners();
        }

        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        this.userInfo = await ppixiv.userCache.getUserInfoFull(this.viewingUserId);

        // Update to refresh our page title, which uses userInfo.
        this.callUpdateListeners();

        let args = new helpers.args(this.url);
        let tag = args.query.get("tag") || "";
        if(tag == "")
        {
            // If we're not filtering by tag, use the profile/all request.  This returns all of
            // the user's illust IDs but no thumb data.
            //
            // We can use the "illustmanga" code path for this by leaving the tag empty, but
            // we do it this way since that's what the site does.
            if(this.pages == null)
            {
                let allMediaIds = await this.loadAllResults();
                this.pages = PaginateMediaIds(allMediaIds, this.estimatedItemsPerPage);
            }

            // Tell media_cache to start loading these media IDs.  This will happen anyway if we don't
            // do it here, but we know these posts are all from the same user ID, so kick it off here
            // to hint batchGetMediaInfoPartial to use the user-specific API.  Don't wait for this
            // to complete, since we don't need to and it'll cause the search view to take longer to
            // appear.
            let mediaIds = this.pages[page-1] || [];
            ppixiv.mediaCache.batchGetMediaInfoPartial(mediaIds, { userId: this.viewingUserId });

            // Register this page.
            this.addPage(page, mediaIds);
        }
        else
        {
            // We're filtering by tag.
            let type = args.query.get("type");

            // For some reason, this API uses a random field in the URL for the type instead of a normal
            // query parameter.
            let typeForUrl =
                type == null? "illustmanga":
                type == "illust"?"illusts":
                "manga";

            let requestUrl = "/ajax/user/" + this.viewingUserId + "/" + typeForUrl + "/tag";
            let result = await helpers.pixivRequest.get(requestUrl, {
                tag: tag,
                offset: (page-1)*48,
                limit: 48,
            });

            // This data doesn't have profileImageUrl or userName.  That's presumably because it's
            // used on user pages which get that from user data, but this seems like more of an
            // inconsistency than an optimization.  Fill it in for mediaInfo.
            for(let item of result.body.works)
            {
                item.userName = this.userInfo.name;
                item.profileImageUrl = this.userInfo.imageBig;
            }

            let mediaIds = [];
            for(let illustData of result.body.works)
                mediaIds.push(helpers.mediaId.fromIllustId(illustData.id)); 

            await ppixiv.mediaCache.addMediaInfosPartial(result.body.works, "normal");

            // Register the new page of data.
            this.addPage(page, mediaIds);
        }
    }
    
    _getInfoLinks()
    {
        let links = InfoLinks.getInfoLinksForUser({userInfo: this.userInfo});

        // Add the Fanbox link to the list if we have one.
        if(this.fanboxUrl)
            links.push({url: this.fanboxUrl, label: "Fanbox"});
        if(this.boothUrl)
            links.push({url: this.boothUrl, label: "Booth"});

        if(this.acceptingRequests)
        {
            links.push({
                url: new URL(`/users/${this.viewingUserId}/request#no-ppixiv`, ppixiv.plocation),
                type: "request",
                label: "Accepting requests",
            });
        }

        return links;
    }

    async loadAllResults()
    {
        let type = this.viewingType;

        let result = await helpers.pixivRequest.get("/ajax/user/" + this.viewingUserId + "/profile/all", {});

        // Remember if this user is accepting requests, so we can add a link.
        this.acceptingRequests = result.body.request.showRequestTab;

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
            this.fanboxUrl = url.toString();
        }
        this.callUpdateListeners();

        // If this user has a linked Booth account, look it up.  Only do this if the profile indicates
        // that it exists.  Don't wait for this to complete.
        if(result.body?.externalSiteWorksStatus?.booth)
            this.loadBooth();

        let illustIds = [];
        if(type == "artworks" || type == "illustrations")
            for(let illustId in result.body.illusts)
                illustIds.push(illustId);
        if(type == "artworks" || type == "manga")
            for(let illustId in result.body.manga)
                illustIds.push(illustId);

        // Sort the two sets of IDs back together, putting higher (newer) IDs first.
        illustIds.sort((lhs, rhs) => parseInt(rhs) - parseInt(lhs));

        let mediaIds = [];
        for(let illustId of illustIds)
            mediaIds.push(helpers.mediaId.fromIllustId(illustId));

        return mediaIds;
    };

    async loadBooth()
    {
        let bootRequest = await helpers.pixivRequest.get("https://api.booth.pm/pixiv/shops/show.json", {
            pixiv_user_id: this.viewingUserId,
            adult: "include",
            limit: 24,
        });

        let booth = await bootRequest;
        if(booth.error)
        {
            console.log(`Error reading Booth profile for ${this.viewingUserId}`);
            return;
        }

        this.boothUrl = booth.body.url;
        this.callUpdateListeners();
    }

    // If we're filtering a follow tag, return it.  Otherwise, return null.
    get currentTag()
    {
        let args = new helpers.args(this.url);
        return args.query.get("tag");
    }

    get uiInfo()
    {
        return {
            userId: this.viewingUserId,

            // Override the title on the mobile search menu.
            mobileTitle: this.userInfo?.name? `Artist: ${this.userInfo?.name}`:`Artist`,
        }
    }

    // This is called when the tag list dropdown is opened.
    async tagListOpened()
    {
        // Get user info.  We probably have this on this.userInfo, but that async load
        // might not be finished yet.
        let userInfo = await ppixiv.userCache.getUserInfoFull(this.viewingUserId);
        console.log("Loading tags for user", userInfo.userId);

        // Load this artist's common tags.
        this.postTags = await this.getUserTags(userInfo);

        // Mark the tags in this.postTags that the user has searched for recently, so they can be
        // marked in the UI.
        let userTagSearch = SavedSearchTags.getAllUsedTags();
        for(let tag of this.postTags)
            tag.recent = userTagSearch.has(tag.tag);

        // Move tags that this artist uses to the top if the user has searched for them recently.
        this.postTags.sort((lhs, rhs) => {
            if(rhs.recent != lhs.recent)
                return rhs.recent - lhs.recent;
            else
                return rhs.cnt - lhs.cnt;
        });

        let tags = [];
        for(let tagInfo of this.postTags)
            tags.push(tagInfo.tag);
        this.translatedTags = await ppixiv.tagTranslations.getTranslations(tags, "en");

        // Refresh the tag list now that it's loaded.
        this.callUpdateListeners();
    }

    async getUserTags(userInfo)
    {
        if(userInfo.frequentTags)
            return Array.from(userInfo.frequentTags);

        let result = await helpers.pixivRequest.get("/ajax/user/" + userInfo.userId + "/illustmanga/tags", {});
        if(result.error)
        {
            console.error("Error fetching tags for user " + userInfo.userId + ": " + result.error);
            userInfo.frequentTags = [];
            return Array.from(userInfo.frequentTags);
        }

        // Sort most frequent tags first.
        result.body.sort(function(lhs, rhs) {
            return rhs.cnt - lhs.cnt;
        })

        // Store translations.
        let translations = [];
        for(let tagInfo of result.body)
        {
            if(tagInfo.tag_translation == "")
                continue;

            translations.push({
                tag: tagInfo.tag,
                translation: {
                    en: tagInfo.tag_translation,
                },
            });
        }
        ppixiv.tagTranslations.addTranslations(translations);

        // Cache the results on the user info.
        userInfo.frequentTags = result.body;
        return Array.from(userInfo.frequentTags);
    }

    get pageTitle()
    {
        if(this.userInfo)
            return this.userInfo.name;
        else
            return "Loading...";
    }

    getDisplayingText()
    {
        if(this.userInfo)
            return this.userInfo.name + "'s Illustrations";
        else
            return "Illustrations";
    };
}

class UI extends Widget
{
    constructor({dataSource, ...options})
    {
        super({ ...options, template: `
            <div>
                <div class="box-button-row search-options-row">
                    ${ helpers.createBoxLink({label: "Works",    popup: "Show all works",            dataType: "artist-works" }) }
                    ${ helpers.createBoxLink({label: "Illusts",  popup: "Show illustrations only",   dataType: "artist-illust" }) }
                    ${ helpers.createBoxLink({label: "Manga",    popup: "Show manga only",           dataType: "artist-manga" }) }
                    ${ helpers.createBoxLink({label: "Tags",     popup: "Tags", icon: "bookmark", classes: ["member-tags-button"] }) }
                </div>

                <vv-container class=avatar-container></vv-container>
            </div>
        `});

        this.dataSource = dataSource;

        dataSource.addEventListener("updated", () => {
            // Refresh the displayed label in case we didn't have it when we created the widget.
            this.tagDropdown.setButtonPopupHighlight();
        }, this._signal);

        dataSource.setPathItem(this.root, "artist-works", 2, "artworks");
        dataSource.setPathItem(this.root, "artist-illust", 2, "illustrations");
        dataSource.setPathItem(this.root, "artist-manga", 2, "manga");

        // On mobile, create our own avatar display for the search popup.
        if(ppixiv.mobile)
        {
            let avatarWidget = new AvatarWidget({
                container: this.root.querySelector(".avatar-container"),
                big: true,
                mode: "dropdown",
            });
            avatarWidget.setUserId(dataSource.viewingUserId);
        }

        class TagDropdown extends TagDropdownWidget
        {
            refreshTags()
            {
                // Refresh the post tag list.
                helpers.html.removeElements(this.root);

                if(dataSource.postTags != null)
                {
                    this.addTagLink({ tag: "All" });
                    for(let tagInfo of dataSource.postTags || [])
                        this.addTagLink(tagInfo);
                }
                else
                {
                    // Tags aren't loaded yet.  We'll be refreshed after tagListOpened loads tags.
                    // If a tag is selected, fill in just that tag so the button text works.
                    let span = document.createElement("span");
                    span.innerText = "Loading...";
                    this.root.appendChild(span);

                    this.addTagLink({ tag: "All" });

                    let currentTag = dataSource.currentTag;
                    if(currentTag != null)
                        this.addTagLink({ tag: currentTag });
                }
            }

            addTagLink(tagInfo)
            {
                // Skip tags with very few posts.  This list includes every tag the author
                // has ever used, and ends up being pages long with tons of tags that were
                // only used once.
                if(tagInfo.tag != "All" && tagInfo.cnt < 5)
                    return;

                let tag = tagInfo.tag;
                let translatedTag = tag;
                if(dataSource.translatedTags && dataSource.translatedTags[tag])
                    translatedTag = dataSource.translatedTags[tag];

                let classes = ["tag-entry"];

                // If the user has searched for this tag recently, add the recent tag.  This is added
                // in tagListOpened.
                if(tagInfo.recent)
                    classes.push("recent");

                let a = helpers.createBoxLink({
                    label: translatedTag,
                    classes,
                    popup: tagInfo?.cnt,
                    link: "#",
                    asElement: true,
                    dataType: "artist-tag",
                });

                dataSource.setItem(a, { fields: {"tag": tag != "All"? tag:null} });

                if(tag == "All")
                    a.dataset["default"] = 1;

                this.root.appendChild(a);
            };
        };

        this.tagDropdown = new DropdownMenuOpener({
            button: this.querySelector(".member-tags-button"),
            createBox: ({...options}) => new TagDropdown({dataSource, ...options}),
            onvisibilitychanged: (opener) => {
                // Populate the tags dropdown if it's opened, so we don't load user tags for every user page.
                if(opener.visible);
                    dataSource.tagListOpened();
            }
        });
    }
}
