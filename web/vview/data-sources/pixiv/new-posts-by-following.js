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
        let result = await helpers.get_request("/ajax/follow_latest/illust", {
            p: page,
            tag: currentTag,
            mode: r18? "r18":"all",
        });

        let data = result.body;

        // Add translations.
        ppixiv.tag_translations.add_translations_dict(data.tagTranslation);

        // Store bookmark tags.
        this.bookmarkTags = data.page.tags;
        this.bookmarkTags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.dispatchEvent(new Event("_refresh_ui"));

        // Populate thumbnail data with this data.
        await ppixiv.media_cache.add_media_infos_partial(data.thumbnails.illust, "normal");

        let mediaIds = [];
        for(let illust of data.thumbnails.illust)
            mediaIds.push(helpers.illust_id_to_media_id(illust.id));

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
                    ${ helpers.create_box_link({label: "R18",    popup: "Show only R18 works",   data_type: "bookmarks-new-illust-ages-r18", classes: ["r18"] }) }
                    ${ helpers.create_box_link({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["follow-tag-button", "premium-only"] }) }
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

                for(let tag of this.container.querySelectorAll(".tag-entry"))
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

                let a = helpers.create_box_link({
                    label,
                    classes: ["tag-entry"],
                    link: "#",
                    as_element: true,
                    data_type: "following-tag",
                });

                if(label == "All tags")
                    a.dataset.default = 1;

                dataSource.setItem(a, { fields: {"tag": tag} });

                this.container.appendChild(a);
            };
        };
        
        // Create the follow tag dropdown.
        new DropdownMenuOpener({
            button: this.querySelector(".follow-tag-button"),
            create_box: ({...options}) => new FollowTagDropdown({dataSource, ...options}),
        });

        dataSource.setItem(this.container, {
            type: "bookmarks-new-illust-ages-r18",
            toggle: true,
            urlFormat: "path",
            fields: {"/path": "bookmark_new_illust_r18.php"},
            defaults: {"/path": "bookmark_new_illust.php"},
        });
    }
}
