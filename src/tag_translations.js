"use strict";

ppixiv.tag_translations = class
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
        this.db = new key_storage("ppixiv-tag-translations");
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

    // A shortcut to retrieve one translation.  If no translation is available, returns the
    // original tag.
    async get_translation(tag, language="en")
    {
        let translated_tags = await tag_translations.get().get_translations([tag], "en");
        if(translated_tags[tag])
            return translated_tags[tag];
        else
            return tag;
    }
}

// This updates the pp_tag_translations IDB store to ppixiv-tag-translations.
//
// The older database code kept the database open all the time.  That's normal in every
// database in the world, except for IDB where it'll wedge everything (even the Chrome
// inspector window) if you try to change object stores.  Read it out and write it to a
// new database, so users upgrading don't have to restart their browser to get tag translations
// back.
//
// This doesn't delete the old database, since for some reason that fires versionchange, which
// might make other tabs misbehave since they're not expecting it.  We can add some code to
// clean up the old database later on when we can assume everybody has done this migration.
ppixiv.update_translation_storage = class
{
    static run()
    {
        let update = new this();
        update.update();
    }

    constructor()
    {
        this.name = "pp_tag_translations";
    }

    async db_op(func)
    {
        let db = await this.open_database();
        try {
            return await func(db);
        } finally {
            db.close();
        }
    }

    open_database()
    {
        return new Promise((resolve, reject) => {
            let request = indexedDB.open("ppixiv");

            request.onsuccess = e => { resolve(e.target.result); };
            request.onerror = e => { resolve(null); };
        });
    }

    async_store_get(store)
    {
        return new Promise((resolve, reject) => {
            let request = store.getAll();
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = reject;
        });
    }

    async update()
    {
        // If the ppixiv-tag-translations database exists, assume this migration has already been done.
        // First see if the old database exists and the new one doesn't.
        let found = false;
        for(let db of await indexedDB.databases())
        {
            if(db.name == "ppixiv-tag-translations")
                return;
            if(db.name == "ppixiv")
                found = true;
        }
        if(!found)
            return;

        console.log("Migrating translation database");

        // Open the old db.
        return await this.db_op(async (db) => {
            if(db == null)
                return;

            let transaction = db.transaction(this.name, "readonly");
            let store = transaction.objectStore(this.name);

            let results = await this.async_store_get(store);
            let translations = [];

            for(let result of results)
            {
                try {
                    if(!result.tag || !result.translation)
                        continue;
                    let data = {
                        tag: result.tag,
                        translation: { },
                    };
                    if(result.romaji)
                        data.romaji = result.romaji;
                    let empty = true;
                    for(let lang in result.translation)
                    {
                        let translated = result.translation[lang];
                        if(!translated)
                            continue;
                        data.translation[lang] = translated;
                        empty = false;
                    }
                    if(empty)
                        continue;

                    translations.push(data);
                } catch(e) {
                    // Tolerate errors, in case there's weird junk in this database.
                    console.log("Error updating tag:", result);
                }
            }

            await tag_translations.get().add_translations(translations);
        });
    }

    // Set the innerText of an element to tag, translating it if possible.
    //
    // This is async to look up the tag translation, but it's safe to release this
    // without awaiting.
    async set_translated_tag(element, tag)
    {
        element.dataset.tag = tag;
        tag = await this.get_translation(muted_tag);

        // Stop if another call was made here while we were async.
        if(tag.dataset.tag != tag)
            return;

        element.innerText = tag;
    }
}

