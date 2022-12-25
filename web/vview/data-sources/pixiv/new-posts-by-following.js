import DataSource, { TagDropdownWidget } from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';

// bookmark_new_illust.php, bookmark_new_illust_r18.php
export default class DataSource_NewPostsByFollowing extends DataSource
{
    get name() { return "new_works_by_following"; }
    get pageTitle() { return "Following"; }
    getDisplayingText() { return "Following"; }
    get ui() { return UI; }

    constructor(url)
    {
        super(url);
        this.bookmarkTags = [];
    }

    get supportsStartPage() { return true; }

    async loadPageInternal(page)
    {
        let currentTag = this.url.searchParams.get("tag") || "";
        let r18 = this.url.pathname == "/bookmark_new_illust_r18.php";
        let result = await helpers.pixivRequest.get("/ajax/follow_latest/illust", {
            p: page,
            tag: currentTag,
            mode: r18? "r18":"all",
        });

        let data = result.body;

        // Add translations.
        ppixiv.tagTranslations.addTranslationsDict(data.tagTranslation);

        // Store bookmark tags.
        this.bookmarkTags = data.page.tags;
        this.bookmarkTags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.callUpdateListeners();

        // Populate thumbnail data with this data.
        await ppixiv.mediaCache.addMediaInfosPartial(data.thumbnails.illust, "normal");

        let mediaIds = [];
        for(let illust of data.thumbnails.illust)
            mediaIds.push(helpers.mediaId.fromIllustId(illust.id));

        // Register the new page of data.
        this.addPage(page, mediaIds);
    }
};

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div>
                <div class=box-button-row>
                    ${ helpers.createBoxLink({label: "R18",    popup: "Show only R18 works",   dataType: "bookmarks-new-illust-ages-r18", classes: ["r18"] }) }
                    ${ helpers.createBoxLink({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["follow-tag-button", "premium-only"] }) }
                </div>
            </div>
        `});

        this.dataSource = dataSource;

        class FollowTagDropdown extends TagDropdownWidget
        {
            refreshTags()
            {
                // Refresh the bookmark tag list.
                let currentTag = dataSource.url.searchParams.get("tag") || "All tags";

                for(let tag of this.root.querySelectorAll(".tag-entry"))
                    tag.remove();

                this.addTagLink("All tags");
                for(let tag of dataSource.bookmarkTags)
                    this.addTagLink(tag);

                // If we don't have the tag list yet because we're still loading the page, fill in
                // the current tag, to reduce flicker as the page loads.
                if(dataSource.bookmarkTags.length == 0 && currentTag != "All tags")
                    this.addTagLink(currentTag);
            }

            addTagLink(tag)
            {
                // Work around Pixiv always returning a follow tag named "null" for some users.
                if(tag == "null")
                    return;

                let label = tag;
                if(tag == "All tags")
                    tag = null;

                let a = helpers.createBoxLink({
                    label,
                    classes: ["tag-entry"],
                    link: "#",
                    asElement: true,
                    dataType: "following-tag",
                });

                if(label == "All tags")
                    a.dataset.default = 1;

                dataSource.setItem(a, { fields: {"tag": tag} });

                this.root.appendChild(a);
            };
        };
        
        // Create the follow tag dropdown.
        new DropdownMenuOpener({
            button: this.querySelector(".follow-tag-button"),
            createBox: ({...options}) => new FollowTagDropdown({dataSource, ...options}),
        });

        dataSource.setItem(this.root, {
            type: "bookmarks-new-illust-ages-r18",
            toggle: true,
            urlFormat: "path",
            fields: {"/path": "bookmark_new_illust_r18.php"},
            defaults: {"/path": "bookmark_new_illust.php"},
        });
    }
}
