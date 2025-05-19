// - User illustrations
//
// /users/# 
// /users/#/artworks
// /users/#/illustrations
// /users/#/manga
//
// We prefer to link to the /artworks page, but we handle /users/# as well.

import DataSource, { PaginateMediaIds, TagDropdownWidget } from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import SavedSearchTags from '/vview/misc/saved-search-tags.js';
import { DropdownMenuOpener } from '/vview/widgets/dropdown.js';
import { helpers } from '/vview/misc/helpers.js';

export default class DataSources_Artist extends DataSource
{
    get name() { return "artist"; }
    get ui() { return UI; }

    constructor({url, ...args})
    {
        // Work around Pixiv's weird tag URLs.  They put tags as a path component, eg. "/users/1234/artworks/tag".
        // This is awkward for us since we treat the "/users/1234" page the same as "/users/1234/artworks",
        // and we can't put tags in that URL since it has no third component.  Work around this by
        // translating /users/1234 to /users/1234/artworks internally.
        url = new URL(url);

        let parts = url.pathname.split("/");
        if(parts.length == 3) // /users/1234
        {
            parts.push("artworks");
            url.pathname = parts.join("/");
        }

        url = url.toString();
        super({url, ...args});
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

        // Make sure the user info is loaded.  Don't wait for this to finish here, so we can start
        // other requests in parallel.
        let userInfoPromise = this._loadUserInfo();

        let args = new helpers.args(this.url);
        let tag = this.currentTag;
        if(tag == null)
        {
            // If we're not filtering by tag, use the profile/all request.  This returns all of
            // the user's illust IDs but no thumb data.
            //
            // We can use the "illustmanga" code path for this by leaving the tag empty, but
            // we do it this way since that's what the site does.
            if(this.pages == null)
            {
                let allMediaIds = await this.loadAllResults();
                if(args.hash.get("order") == "oldest")        
                    allMediaIds.reverse();

                this.pages = PaginateMediaIds(allMediaIds, this.estimatedItemsPerPage);
            }

            // Load media info for this page.
            let mediaIds = this.pages[page-1] || [];
            await ppixiv.mediaCache.batchGetMediaInfoPartial(mediaIds, { userId: this.viewingUserId });
            return { mediaIds };
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

            let requestUrl = `/ajax/user/${this.viewingUserId}/${typeForUrl}/tag`;
            let result = await helpers.pixivRequest.get(requestUrl, {
                tag: tag,
                offset: (page-1)*48,
                limit: 48,
            });

            // Wait until we have user info.  Doing this here allows the two API requests to run
            // in parallel, but we need the result below.
            await userInfoPromise;

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

            return { mediaIds };
        }
    }
    
    async _loadUserInfo()
    {
        this.userInfo = await ppixiv.userCache.getUserInfo(this.viewingUserId, { full: true });
        this.callUpdateListeners();
    }

    async loadAllResults()
    {
        let type = this.viewingType;

        let result = await helpers.pixivRequest.get(`/ajax/user/${this.viewingUserId}/profile/all`);

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

    // If we're filtering a follow tag, return it.  Otherwise, return null.
    get currentTag()
    {
        // This used to use a nice, clean query argument, but for some reason Pixiv changed it to use
        // a path field at some point.
        let args = new helpers.args(helpers.pixiv.getUrlWithoutLanguage(this.url));

        let tag = args.get("/3"); // /users/12345/type/tags
        if(tag == null)
            tag = args.query.get("tag");

        return tag;
    }

    get uiInfo()
    {
        let headerStripURL = this.userInfo?.background?.url;
        if(headerStripURL)
        {
            headerStripURL = new URL(headerStripURL);
            helpers.pixiv.adjustImageUrlHostname(headerStripURL);
        }

        return {
            mediaId: `user:${this.viewingUserId}`,
            userId: this.viewingUserId,

            // Override the title on the mobile search menu.
            mobileTitle: this.userInfo?.name? `Artist: ${this.userInfo?.name}`:`Artist`,

            headerStripURL,
        }
    }

    // This is called when the tag list dropdown is opened.
    async tagListOpened()
    {
        // Get user info.  We probably have this on this.userInfo, but that async load
        // might not be finished yet.
        let userInfo = await ppixiv.userCache.getUserInfo(this.viewingUserId, { full: true });
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

        let result = await helpers.pixivRequest.get("/ajax/user/" + userInfo.userId + "/illustmanga/tags", { all: "1"});
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
                <div class="box-button-row" style="align-items: flex-start">
                    ${ helpers.createBoxLink({label: "Search mode",    classes: ["search-type-button"] }) }
                    ${ helpers.createBoxLink({label: "Newest",         classes: ["sort-button"] }) }
                    ${ helpers.createBoxLink({label: "Tags",     popup: "Tags", icon: "bookmark", classes: ["member-tags-button"] }) }
                </div>
            </div>
        `});

        this.dataSource = dataSource;

        dataSource.addEventListener("updated", () => {
            // Refresh the displayed label in case we didn't have it when we created the widget.
            this.tagDropdown.setButtonPopupHighlight();
        }, this._signal);

        let urlFormat = "users/id/type/tag";
        dataSource.setupDropdown(this.querySelector(".search-type-button"), [{
            createOptions: { label: "Works" },
            setupOptions:  { urlFormat, fields: {"/type": "artworks"} },
        }, {
            createOptions: { label: "Illusts" },
            setupOptions:  { urlFormat, fields: {"/type": "illustrations"} },
        }, {
            createOptions: { label: "Manga" },
            setupOptions:  { urlFormat, fields: {"/type": "manga"} },
        }]);

        // Sorts are currently only supported when viewing all bookmarks, not when searching
        // by tag.
        let sortButton = this.querySelector(".sort-button");
        let tag = dataSource.currentTag;
        sortButton.hidden = tag != null;
        dataSource.setupDropdown(sortButton, [{
            createOptions: { label: "Newest",              dataset: { default: true } },
            setupOptions: { fields: {"#order": null}, defaults: {"#order": "newest"} }
        }, {
            createOptions: { label: "Oldest" },
            setupOptions: { fields: {"#order": "oldest"} }
        }]);

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
                // only used once.  Always include recently-used tags.
                if(tagInfo.tag != "All" && tagInfo.cnt < 5 && !tagInfo.recent)
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

                dataSource.setItem(a, { urlFormat, fields: {"/tag": tag != "All"? tag:null} });

                if(tag == "All")
                    a.dataset["default"] = 1;

                this.root.appendChild(a);
            };
        };

        this.tagDropdown = new DropdownMenuOpener({
            button: this.querySelector(".member-tags-button"),
            createDropdown: ({...options}) => new TagDropdown({dataSource, ...options}),
            onvisibilitychanged: (opener) => {
                // Populate the tags dropdown if it's opened, so we don't load user tags for every user page.
                if(opener.visible);
                    dataSource.tagListOpened();
            }
        });
    }
}
