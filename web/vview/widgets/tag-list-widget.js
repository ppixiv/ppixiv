// A list of tags, with translations in popups where available.

import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

export default class TagListWidget extends Widget
{
    constructor({...options})
    {
        super({...options});
    };

    format_tag_link(tag)
    {
        return helpers.get_args_for_tag_search(tag, ppixiv.plocation);
    };

    async set(tags)
    {
        this.tags = tags;
        this.refresh();
    }

    async refresh()
    {
        if(this.tags == null)
            return;

        // Short circuit if the tag list isn't changing, since IndexedDB is really slow.
        if(this.last_tags != null && JSON.stringify(this.last_tags) == JSON.stringify(this.tags))
            return;

        // Look up tag translations.
        let tag_list = this.tags;
        let translated_tags = await ppixiv.tag_translations.get_translations(tag_list, "en");
        
        // Stop if the tag list changed while we were reading tag translations.
        if(tag_list != this.tags)
            return;

        this.last_tags = this.tags;

        // Remove any old tag list and create a new one.
        helpers.remove_elements(this.container);

        for(let tag of tag_list)
        {
            let translated_tag = tag;
            if(translated_tags[tag])
                translated_tag = translated_tags[tag];

            let a = helpers.create_box_link({
                label: translated_tag,
                classes: ["tag-entry"],
                link: this.format_tag_link(tag),
                as_element: true,
            });

            this.container.appendChild(a);

            a.dataset.tag = tag;
        }
    }
}
