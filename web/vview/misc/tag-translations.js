import KeyStorage from 'vview/misc/key-storage.js';
import { helpers } from 'vview/misc/helpers.js';

export default class TagTranslations
{
    constructor()
    {
        this.db = new KeyStorage("ppixiv-tag-translations");

        // Firefox's private mode is broken: instead of making storage local to the session and
        // not saved to disk, it just disables IndexedDB entirely, which is lazy and breaks pages.
        // Keep a copy of tags we've seen in this session to work around this  This isn't a problem
        // in other browsers.
        this.cache = new Map();
    }

    // Store a list of tag translations.
    // 
    // tag_list is a dictionary:
    // {
    //     original_tag: {
    //         en: "english tag",
    //     }
    // }
    async add_translations_dict(tags)
    {
        let translations = [];
        for(let tag of Object.keys(tags))
        {
            let tag_info = tags[tag];
            let tag_translation = {};
            for(let lang of Object.keys(tag_info))
            {
                if(tag_info[lang] == "")
                    continue;
                tag_translation[lang] = tag_info[lang];
            }

            if(Object.keys(tag_translation).length > 0)
            {
                translations.push({
                    tag: tag,
                    translation: tag_translation,
                });
            }
        }

        this.add_translations(translations);
    }
    
    // Store a list of tag translations.
    // 
    // tag_list is a list of
    // {
    //     tag: "original tag",
    //     translation: {
    //         en: "english tag",
    //     },
    // }
    //
    // This is the same format that Pixiv uses in newer APIs.  Note that we currently only store
    // English translations.
    async add_translations(tag_list)
    {
        let data = {};
        for(let tag of tag_list)
        {
            // If a tag has no keys and no romanization, skip it so we don't fill our database
            // with useless entries.

            if((tag.translation == null || Object.keys(tag.translation).length == 0) && tag.romaji == null)
                continue;

            // Remove empty translation values.
            let translation = {};
            for(let lang of Object.keys(tag.translation || {}))
            {
                let value = tag.translation[lang];
                if(value != "")
                    translation[lang] = value;
            }

            // Store the tag data that we care about.  We don't need to store post-specific info
            // like "deletable".
            let tag_info = {
                tag: tag.tag,
                translation: translation,
            };
            if(tag.romaji)
                tag_info.romaji = tag.romaji;
            data[tag.tag] = tag_info;

            if(translation.en)
                this.cache.set(tag.tag, translation.en);
        }

        // Batch write:
        await this.db.multi_set(data);
    }

    async get_tag_info(tags)
    {
        // If the user has disabled translations, don't return any.
        if(ppixiv.settings.get("disable-translations"))
            return {};

        let result = {};
        let translations = await this.db.multi_get(tags);
        for(let i = 0; i < tags.length; ++i)
        {
            if(translations[i] == null)
                continue;
            result[tags[i]] = translations[i];
        }
        return result;
    }

    async get_translations(tags, language="en")
    {
        let info = await this.get_tag_info(tags);
        let result = {};
        for(let tag of tags)
        {
            if(info[tag] == null || info[tag].translation == null)
                continue;

            // Skip this tag if we don't have a translation for this language.
            let translation = info[tag].translation[language];
            if(translation == null)
                continue;

            result[tag] = translation;
        }

        // See if we have cached translations for tags not in the database.
        for(let tag of tags)
        {
            if(result[tag])
                continue;
            result[tag] = this.cache.get(tag);
        }

        return result;
    }

    // Given a tag search, return a translated search.
    async translate_tag_list(tags, language)
    {
        // Pull out individual tags, removing -prefixes.
        let split_tags = helpers.split_search_tags(tags);
        let tag_list = [];
        for(let tag of split_tags)
        {
            let [prefix, unprefixed_tag] = helpers.split_tag_prefixes(tag);
            tag_list.push(unprefixed_tag);
        }

        // Get translations.
        let translated_tags = await this.get_translations(tag_list, language);

        // Put the search back together.
        let result = [];
        for(let one_tag of split_tags)
        {
            let prefix_and_tag = helpers.split_tag_prefixes(one_tag);
            let prefix = prefix_and_tag[0];
            let tag = prefix_and_tag[1];
            if(translated_tags[tag])
                tag = translated_tags[tag];
            result.push(prefix + tag);
        }
        return result;
    }

    // A shortcut to retrieve one translation.  If no translation is available, returns the
    // original tag.
    async get_translation(tag, language="en")
    {
        let translated_tags = await this.get_translations([tag], "en");
        if(translated_tags[tag])
            return translated_tags[tag];
        else
            return tag;
    }

    // Set the innerText of an element to tag, translating it if possible.
    //
    // This is async to look up the tag translation, but it's safe to release this
    // without awaiting.
    async set_translated_tag(element, tag)
    {
        let original_tag = tag;
        element.dataset.tag = original_tag;
        tag = await this.get_translation(tag);

        // Stop if another call was made here while we were async.
        if(element.dataset.tag != original_tag)
            return;

        element.innerText = tag;
    }
}
