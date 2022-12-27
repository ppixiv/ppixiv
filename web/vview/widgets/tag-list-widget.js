// A list of tags, with translations in popups where available.

import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

export default class TagListWidget extends Widget
{
    constructor({...options})
    {
        super({
            ...options,
            template: `
                <div class="tag-list box-button-row"></div>
            `
        });
    };

    formatTagLink(tag)
    {
        return helpers.getArgsForTagSearch(tag, ppixiv.plocation);
    };

    async set(mediaInfo)
    {
        this.mediaInfo = mediaInfo;
        this.refresh();
    }

    async refresh()
    {
        if(this.mediaInfo == null)
            return;

        let tags = [];
        let showR18 = this.mediaInfo == 1;
        let showR18G = this.mediaInfo == 1;
        for(let tag of this.mediaInfo.tagList)
        {
            // If R-18 is in the list, remove it so we can add them in the position we want.
            // This should always match xRestrict, but we check both just to be safe.
            if(tag == "R-18")
                showR18 = true;
            else if(tag == "R-18G")
                showR18G = true;
            else
                tags.push({tag});
        }

        // Add "AI" to the list.
        let showAI = this.mediaInfo.aiType == 2;
        if(showAI)
            tags.splice(0, 0, {ai: true});
        
        if(showR18G)
            tags.splice(0, 0, {tag: "R-18G"});
        else if(showR18)
            tags.splice(0, 0, {tag: "R-18"});

        // Short circuit if the tag list isn't changing, since IndexedDB is really slow.
        if(this._currentTags != null && JSON.stringify(this._currentTags) == JSON.stringify(tags))
            return;

        // Look up tag translations.
        let tagList = tags;
        let translatedTags = await ppixiv.tagTranslations.getTranslations(this.mediaInfo.tagList, "en");
        
        // Stop if the tag list changed while we were reading tag translations.
        if(tagList != tags)
            return;

        this._currentTags = tags;

        // Remove any old tag list and create a new one.
        helpers.html.removeElements(this.root);

        for(let {tag, ai} of tagList)
        {
            if(ai)
                tag = "AI-generated";

            let translatedTag = tag;
            if(translatedTags[tag])
                translatedTag = translatedTags[tag];

            let link = this.formatTagLink(tag);
            if(ai)
                link = null;

            let a = helpers.createBoxLink({
                label: translatedTag,
                classes: ["tag-entry"],
                link,
                asElement: true,
            });

            this.root.appendChild(a);

            a.dataset.tag = tag;
        }
    }
}
