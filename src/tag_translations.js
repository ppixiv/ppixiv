class tag_translations
{
    // Return the singleton, creating it if needed.
    static get()
    {
        if(tag_translations._singleton == null)
            tag_translations._singleton = new tag_translations();
        return tag_translations._singleton;
    };

    constructor()
    {
        this.db = new key_storage("pp_tag_translations");
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
            data[tag.tag] = {
                tag: tag.tag,
                translation: translation,
                romaji: tag.romaji,
            };
        }

        // Batch write:
        await this.db.multi_set(data);
    }

    async get_tag_info(tags)
    {
        // If the user has disabled translations, don't return any.
        if(settings.get("disable-translations"))
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

    async get_translations(tags, language)
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
            let prefix_and_tag = helpers.split_tag_prefixes(tag);
            tag_list.push(prefix_and_tag[1]);
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
}

