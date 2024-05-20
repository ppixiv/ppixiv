import KeyStorage from '/vview/misc/key-storage.js';
import { helpers } from '/vview/misc/helpers.js';

export default class TagTranslations
{
    constructor()
    {
        this._db = new KeyStorage("ppixiv-tag-translations");

        // Firefox's private mode is broken: instead of making storage local to the session and
        // not saved to disk, it just disables IndexedDB entirely, which is lazy and breaks pages.
        // Keep a copy of tags we've seen in this session to work around this  This isn't a problem
        // in other browsers.
        this._cache = new Map();
    }

    // Return true if translations are enabled by the user.
    get enabled()
    {
        return !ppixiv.settings.get("disable-translations");
    }

    // Store a list of tag translations.
    // 
    // tags is a dictionary:
    // {
    //     original_tag: {
    //         en: "english tag",
    //     }
    // }
    async addTranslationsDict(tags, { overwrite=true }={})
    {
        let translations = [];
        for(let tag of Object.keys(tags))
        {
            let tagInfo = tags[tag];
            let tagTranslation = {};
            for(let lang of Object.keys(tagInfo))
            {
                if(tagInfo[lang] == "")
                    continue;
                tagTranslation[lang] = tagInfo[lang];
            }

            if(Object.keys(tagTranslation).length > 0)
            {
                translations.push({
                    tag: tag,
                    translation: tagTranslation,
                });
            }
        }

        this.addTranslations(translations, { overwrite });
    }
    
    // Store a list of tag translations.
    // 
    // tagList is a list of
    // {
    //     tag: "original tag",
    //     translation: {
    //         en: "english tag",
    //     },
    // }
    //
    // This is the same format that Pixiv uses in newer APIs.  Note that we currently only store
    // English translations.
    //
    // If overwrite is false, only overwrite translations that already exist.
    async addTranslations(tagList, { overwrite=true }={})
    {
        let data = {};
        for(let tag of tagList)
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
            let tagInfo = {
                tag: tag.tag,
                translation: translation,
            };
            if(tag.romaji)
                tagInfo.romaji = tag.romaji;
            data[tag.tag] = tagInfo;

            let exists = this._cache.get(tag.tag);
            if(translation.en && (overwrite || !exists))
                this._cache.set(tag.tag, translation.en);
        }

        // Batch write:
        await this._db.multiSet(data, { overwrite });
    }

    async getTagInfo(tags)
    {
        // If the user has disabled translations, don't return any.
        if(!this.enabled)
            return {};

        let result = {};
        let translations = await this._db.multiGet(tags);
        for(let i = 0; i < tags.length; ++i)
        {
            if(translations[i] == null)
                continue;
            result[tags[i]] = translations[i];
        }
        return result;
    }

    async getTranslations(tags, language="en")
    {
        if(!this.enabled)
            return {};

        let info = await this.getTagInfo(tags);
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
            result[tag] = this._cache.get(tag);
        }

        return result;
    }

    // Given a tag search, return a translated search.
    async translateTagList(tags, language)
    {
        // Pull out individual tags, removing -prefixes.
        let splitTags = helpers.pixiv.splitSearchTags(tags);
        let tagList = [];
        for(let tag of splitTags)
        {
            let [prefix, unprefixedTag] = helpers.pixiv.splitTagPrefixes(tag);
            tagList.push(unprefixedTag);
        }

        // Get translations.
        let translatedTags = await this.getTranslations(tagList, language);

        // Put the search back together.
        let result = [];
        for(let oneTag of splitTags)
        {
            let prefixAndTag = helpers.pixiv.splitTagPrefixes(oneTag);
            let prefix = prefixAndTag[0];
            let tag = prefixAndTag[1];
            if(translatedTags[tag])
                tag = translatedTags[tag];
            result.push(prefix + tag);
        }
        return result;
    }

    // A shortcut to retrieve one translation.  If no translation is available, returns the
    // original tag.
    async getTranslation(tag, language="en")
    {
        let result = this._cache.get(tag);
        if(result != null)
            return result;

        let translatedTags = await this.getTranslations([tag], "en");
        if(translatedTags[tag])
            return translatedTags[tag];
        else
            return tag;
    }
}
