import DataSource, { TagDropdownWidget } from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { DropdownMenuOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/ppixiv-imports.js';

// bookmark_new_illust.php, bookmark_new_illust_r18.php
export default class DataSource_NewPostsByFollowing extends DataSource
{
    get name() { return "new_works_by_following"; }

    constructor(url)
    {
        super(url);
        this.bookmark_tags = [];
    }

    get supports_start_page() { return true; }

    async load_page_internal(page)
    {
        let current_tag = this.url.searchParams.get("tag") || "";
        let r18 = this.url.pathname == "/bookmark_new_illust_r18.php";
        let result = await helpers.get_request("/ajax/follow_latest/illust", {
            p: page,
            tag: current_tag,
            mode: r18? "r18":"all",
        });

        let data = result.body;

        // Add translations.
        ppixiv.tag_translations.add_translations_dict(data.tagTranslation);

        // Store bookmark tags.
        this.bookmark_tags = data.page.tags;
        this.bookmark_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.dispatchEvent(new Event("_refresh_ui"));

        // Populate thumbnail data with this data.
        await ppixiv.media_cache.add_media_infos_partial(data.thumbnails.illust, "normal");

        let media_ids = [];
        for(let illust of data.thumbnails.illust)
            media_ids.push(helpers.illust_id_to_media_id(illust.id));

        // Register the new page of data.
        this.add_page(page, media_ids);
    }
    
    get page_title()
    {
        return "Following";
    }

    get_displaying_text()
    {
        return "Following";
    };

    get ui()
    {
        return class extends Widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div>
                        <div class=box-button-row>
                            ${ helpers.create_box_link({label: "R18",    popup: "Show only R18 works",   data_type: "bookmarks-new-illust-ages-r18", classes: ["r18"] }) }
                            ${ helpers.create_box_link({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["follow-tag-button", "premium-only"] }) }
                        </div>
                    </div>
                `});

                this.data_source = data_source;

                class follow_tag_dropdown extends TagDropdownWidget
                {
                    refresh_tags()
                    {
                        // Refresh the bookmark tag list.
                        let current_tag = data_source.url.searchParams.get("tag") || "All tags";

                        for(let tag of this.container.querySelectorAll(".tag-entry"))
                            tag.remove();

                        this.add_tag_link("All tags");
                        for(let tag of data_source.bookmark_tags)
                            this.add_tag_link(tag);

                        // If we don't have the tag list yet because we're still loading the page, fill in
                        // the current tag, to reduce flicker as the page loads.
                        if(data_source.bookmark_tags.length == 0 && current_tag != "All tags")
                            this.add_tag_link(current_tag);
                    }

                    add_tag_link(tag)
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

                        data_source.set_item(a, { fields: {"tag": tag} });

                        this.container.appendChild(a);
                    };
                };
                
                // Create the follow tag dropdown.
                new DropdownMenuOpener({
                    button: this.querySelector(".follow-tag-button"),
                    create_box: ({...options}) => new follow_tag_dropdown({data_source, ...options}),
                });

                data_source.set_item(this.container, {
                    type: "bookmarks-new-illust-ages-r18",
                    toggle: true,
                    url_format: "path",
                    fields: {"/path": "bookmark_new_illust_r18.php"},
                    default_values: {"/path": "bookmark_new_illust.php"},
                });
            }
        }
    }
};
