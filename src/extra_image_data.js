"use strict";

// This database is used to store extra metadata for Pixiv images.  It's similar
// to the metadata files in the local database.
//
// Data is stored by media ID, with a separate record for each manga page.  We
// have an index on the illust ID, so we can fetch all pages for an illust ID quickly.
ppixiv.extra_image_data = class
{
    // Return the singleton, creating it if needed.
    static get get()
    {
        if(extra_image_data._singleton == null)
            extra_image_data._singleton = new extra_image_data();
        return extra_image_data._singleton;
    };

    constructor()
    {
        // This is only needed for storing data for Pixiv images.  We don't need it if
        // we're native.
        if(ppixiv.native)
            return;

        this.db = new key_storage("ppixiv-image-data", { db_upgrade: this.db_upgrade });
    }

    db_upgrade = (e) => {
        // Create our object store with an index on illust_id.
        let db = e.target.result;
        let store = db.createObjectStore("ppixiv-image-data");
        store.createIndex("illust_id", "illust_id");
        store.createIndex("edited_at", "edited_at");
    }

    async save_illust(media_id, data)
    {
        if(this.db == null)
            return;

        // Request permission storage the first time the user saves image edits.  Browsers
        // seem to handle not spamming requests for this, but for safety we only do this once
        // per session.  We don't need to wait for this.
        if(!this.requested_persistent_storage && navigator.storage?.persist)
        {
            this.requested_persistent_storage = true;
            navigator.storage.persist();
        }

        await this.db.set(media_id, data);
    }

    async delete_illust(media_id)
    {
        if(this.db == null)
            return;

        await this.db.delete(media_id);
    }

    // Return extra data for the given media IDs if we have it, as a media_id: data dictionary.
    async load_illust_data(media_ids)
    {
        if(this.db == null)
            return {};

        return await this.db.db_op(async (db) => {
            let store = this.db.get_store(db);

            // Load data in bulk.
            let promises = {};
            for(let media_id of media_ids)
            {
                let data = key_storage.async_store_get(store, media_id);
                if(data)
                    promises[media_id] = data;
            }
            return await helpers.await_map(promises);
        }) ?? {};
    }

    // Return data for all pages of illust_id.
    async load_all_pages_for_illust(illust_id)
    {
        if(this.db == null)
            return {};

        return await this.db.db_op(async (db) => {
            let store = this.db.get_store(db);
            let index = store.index("illust_id");
            let query = IDBKeyRange.only(illust_id);
            let cursor = index.openCursor(query);

            let results = {};
            for await (let entry of cursor)
            {
                let media_id = entry.primaryKey;
                results[media_id] = entry.value;
            }
    
            return results;
        }) ?? {};
    }

    // Batch load a list of illust_ids.  The results are returned mapped by illust_id.
    async batch_load_all_pages_for_illust(illust_ids)
    {
        if(this.db == null)
            return {};

        return await this.db.db_op(async (db) => {
            let store = this.db.get_store(db);
            let index = store.index("illust_id");

            let promises = {};
            for(let illust_id of illust_ids)
            {
                let query = IDBKeyRange.only(illust_id);
                let cursor = index.openCursor(query);
                promises[illust_id] = (async() => {
                    let results = {};
                    for await (let entry of cursor)
                    {
                        let media_id = entry.primaryKey;
                        results[media_id] = entry.value;
                    }
                    return results;
                })();
            }

            return await helpers.await_map(promises);
        }) ?? {};
    }

    // Return the media ID of all illust IDs.
    //
    // Note that we don't use an async iterator for this, since it might not be closed
    // until it's GC'd and we need to close the database consistently.
    async get_all_edited_images({sort="time"}={})
    {
        console.assert(sort == "time" || sort == "id");
        if(this.db == null)
            return [];
        
        return await this.db.db_op(async (db) => {
            let store = this.db.get_store(db);
            let index = sort == "time"? store.index("edited_at"):store;
            let cursor = index.openKeyCursor(null, sort == "time"? "prev":"next"); // descending for time
            let results = [];
            for await (let entry of cursor)
            {
                let media_id = entry.primaryKey;
                results.push(media_id);
            }
    
            return results;
        }) ?? [];
    }

    // Export the database contents to allow the user to back it up.
    async export()
    {
        if(this.db == null)
            throw new Error("extra_image_data is disabled");
        
        let data = await this.db.db_op(async (db) => {
            let store = this.db.get_store(db);
            let cursor = store.openCursor();
            let results = [];
            for await (let entry of cursor)
            {
                // We store pages in the key as a media_id.  Add it to the exported value.
                results.push({
                    media_id: entry.key,
                    ...entry.value,
                });
            }
    
            return results;
        }) ?? [];

        let exported_data = {
            type: "ppixiv-image-data",
            data,
        };

        if(exported_data.data.length == 0)
        {
            message_widget.singleton.show("No edited images to export.");
            return;
        }

        let json = JSON.stringify(exported_data, null, 4);
        let blob = new Blob([json], { type: "application/json" });
        helpers.save_blob(blob, "ppixiv image edits.json");
    }

    // Import data exported by export().  This will overwrite any overlapping entries, but entries
    // won't be deleted if they don't exist in the input.
    async import()
    {
        if(this.db == null)
            throw new Error("extra_image_data is disabled");

        // This API is annoying: it throws an exception (rejects the promise) instead of
        // returning null.  Exceptions should be used for unusual errors, not for things
        // like the user cancelling a file dialog.
        let files;
        try {
            files = await window.showOpenFilePicker({
                multiple: false,
                types: [{
                    description: 'Exported image edits',
                    accept: {
                        'application/json': ['.json'],
                    }
                }],
            });
        } catch(e) {
            return;
        }

        let file = await files[0].getFile();
        let data = JSON.parse(await file.text());
        if(data.type != "ppixiv-image-data")
        {
            message_widget.singleton.show(`The file "${file.name}" doesn't contain exported image edits.`);
            return;
        }

        let data_by_media_id = {};
        for(let entry of data.data)
        {
            let media_id = entry.media_id;
            delete entry.media_id;
            data_by_media_id[media_id] = entry;
        }

        console.log(`Importing data:`, data);
        await this.db.multi_set(data_by_media_id);

        // Tell image_data that we've replaced extra data, so any loaded images are updated.
        for(let [media_id, data] of Object.entries(data_by_media_id))
            media_cache.replace_extra_data(media_id, data);

        message_widget.singleton.show(`Imported edits for ${data.data.length} ${data.data.length == 1? "image":"images"}.`);
    }
}
