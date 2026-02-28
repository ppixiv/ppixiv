import KeyStorage from '/vview/misc/key-storage.js';
import { helpers } from '/vview/misc/helpers.js';

// This database is used to store extra metadata for Pixiv images.  It's similar
// to the metadata files in the local database.
//
// Data is stored by media ID, with a separate record for each manga page.  We
// have an index on the illust ID, so we can fetch all pages for an illust ID quickly.
export default class ExtraImageData
{
    constructor()
    {
        // This is only needed for storing data for Pixiv images.  We don't need it if
        // we're native.
        if(ppixiv.native)
            return;

        this.db = new KeyStorage("ppixiv-image-data", { upgradeDb: this.upgradeDb });
    }

    upgradeDb = (e) => {
        // Create our object store with an index on illust_id.
        let db = e.target.result;
        let store = db.createObjectStore("ppixiv-image-data");
        store.createIndex("illust_id", "illust_id");
        store.createIndex("edited_at", "edited_at");
    }

    async updateMediaId(mediaId, data)
    {
        if(this.db == null)
            return;

        // Request permission storage the first time the user saves image edits.  Browsers
        // seem to handle not spamming requests for this, but for safety we only do this once
        // per session.  We don't need to wait for this.
        if(!this._requestedPersistentStorage && navigator.storage?.persist)
        {
            this._requestedPersistentStorage = true;
            navigator.storage.persist();
        }

        await this.db.set(mediaId, data);
    }

    async deleteMediaId(mediaId)
    {
        if(this.db == null)
            return;

        await this.db.delete(mediaId);
    }

    // Return extra data for the given media IDs if we have it, as a mediaId: data dictionary.
    async loadMediaId(mediaIds)
    {
        if(this.db == null)
            return {};

        return await this.db.dbOp(async (db) => {
            let store = this.db.getStore(db);

            // Load data in bulk.
            let promises = {};
            for(let mediaId of mediaIds)
            {
                let data = KeyStorage.asyncStoreGet(store, mediaId);
                if(data)
                    promises[mediaId] = data;
            }
            return await helpers.other.awaitMap(promises);
        }) ?? {};
    }

    // Return data for all pages of mediaId.
    async loadAllPagesForIllust(illustId)
    {
        if(this.db == null)
            return {};

        return await this.db.dbOp(async (db) => {
            let store = this.db.getStore(db);
            let index = store.index("illust_id");
            let query = IDBKeyRange.only(illustId);
            let cursor = index.openCursor(query);

            let results = {};
            for await (let entry of cursor)
            {
                let mediaId = entry.primaryKey;
                results[mediaId] = entry.value;
            }
    
            return results;
        }) ?? {};
    }

    // Batch load a list of illustIds.  The results are returned mapped by illustId.
    async batchLoadAllPagesForIllust(illustIds)
    {
        if(this.db == null)
            return {};

        return await this.db.dbOp(async (db) => {
            let store = this.db.getStore(db);
            let index = store.index("illust_id");

            let promises = {};
            for(let illustId of illustIds)
            {
                let query = IDBKeyRange.only(illustId);
                let cursor = index.openCursor(query);
                promises[illustId] = (async() => {
                    let results = {};
                    for await (let entry of cursor)
                    {
                        let mediaId = entry.primaryKey;
                        results[mediaId] = entry.value;
                    }
                    return results;
                })();
            }

            return await helpers.other.awaitMap(promises);
        }) ?? {};
    }

    // Return the media ID of all illust IDs.
    //
    // Note that we don't use an async iterator for this, since it might not be closed
    // until it's GC'd and we need to close the database consistently.
    async getAllEditedImages({sort="time"}={})
    {
        console.assert(sort == "time" || sort == "id");
        if(this.db == null)
            return [];
        
        return await this.db.dbOp(async (db) => {
            let store = this.db.getStore(db);
            let index = sort == "time"? store.index("edited_at"):store;
            let cursor = index.openKeyCursor(null, sort == "time"? "prev":"next"); // descending for time
            let results = [];
            for await (let entry of cursor)
            {
                let mediaId = entry.primaryKey;
                results.push(mediaId);
            }
    
            return results;
        }) ?? [];
    }

    // Export the database contents to allow the user to back it up.
    async export()
    {
        if(this.db == null)
            throw new Error("ExtraImageData is disabled");
        
        let data = await this.db.dbOp(async (db) => {
            let store = this.db.getStore(db);
            let cursor = store.openCursor();
            let results = [];
            for await (let entry of cursor)
            {
                // We store pages in the key as a media ID.  Add it to the exported value.
                results.push({
                    media_id: entry.key,
                    ...entry.value,
                });
            }
    
            return results;
        }) ?? [];

        return data;
    }

    // Import data exported by export().  This will overwrite any overlapping entries, but entries
    // won't be deleted if they don't exist in the input.
    async import(data)
    {
        if(this.db == null)
            throw new Error("ExtraImageData is disabled");

        let dataByMediaId = {};
        for(let entry of data)
        {
            let mediaId = entry.media_id;
            delete entry.media_id;
            dataByMediaId[mediaId] = entry;
        }

        console.log(`Importing image edits:`, data);
        await this.db.multiSet(dataByMediaId);

        // Tell MediaCache that we've replaced extra data, so any loaded images are updated.
        for(let [mediaId, data] of Object.entries(dataByMediaId))
            ppixiv.mediaCache.replaceExtraData(mediaId, data);

        return { count: data.length };
    }
}
