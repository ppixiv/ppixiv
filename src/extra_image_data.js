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
                promises[media_id] = key_storage.async_store_get(store, media_id);
            return await helpers.await_map(promises);
        });
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
        });
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
        });
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
        });
    }
}
