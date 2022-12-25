// A list of tags, with translations in popups where available.

import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

export default class TagListWidget extends Widget
{
    constructor({...options})
    {
        super({...options});
    };

    formatTagLink(tag)
    {
        return helpers.getArgsForTagSearch(tag, ppixiv.plocation);
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
        if(this._currentTags != null && JSON.stringify(this._currentTags) == JSON.stringify(this.tags))
            return;

        // Look up tag translations.
        let tagList = this.tags;
        let translatedTags = await ppixiv.tagTranslations.getTranslations(tagList, "en");
        
        // Stop if the tag list changed while we were reading tag translations.
        if(tagList != this.tags)
            return;

        this._currentTags = this.tags;

        // Remove any old tag list and create a new one.
        helpers.html.removeElements(this.container);

        for(let tag of tagList)
        {
            let translatedTag = tag;
            if(translatedTags[tag])
                translatedTag = translatedTags[tag];

            let a = helpers.createBoxLink({
                label: translatedTag,
                classes: ["tag-entry"],
                link: this.formatTagLink(tag),
                asElement: true,
            });

            this.container.appendChild(a);

            a.dataset.tag = tag;
        }
    }
}
