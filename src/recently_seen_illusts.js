"use strict";

ppixiv.recently_seen_illusts = class
{
    // Return the singleton, creating it if needed.
    static get()
    {
        if(recently_seen_illusts._singleton == null)
            recently_seen_illusts._singleton = new recently_seen_illusts();
        return recently_seen_illusts._singleton;
    };

    constructor()
    {
        this.db = new key_storage("ppixiv-recent-illusts", { db_upgrade: this.db_upgrade });

        settings.register_change_callback("no_recent_history", this.update_from_settings);
        this.update_from_settings();
    }

    get enabled()
    {
        return !settings.get("no_recent_history");
    }

    update_from_settings = () =>
    {
        // If the user disables recent history, clear our storage.
        if(!this.enabled)
        {
            console.log("Clearing history");
            this.clear();
        }
    }

    db_upgrade = (e) => {
        // Create our object store with an index on last_seen.
        let db = e.target.result;
        let store = db.createObjectStore("ppixiv-recent-illusts");
        store.createIndex("last_seen", "last_seen");
    }
    
    async add_illusts(illust_ids)
    {
        // Clean up old illusts.  We don't need to wait for this.
        this.purge_old_illusts();

        // Stop if we're not enabled.
        if(!this.enabled)
            return;
        
        let time = Date.now();
        let data = {};
        let idx = 0;
        for(let illust_id of illust_ids)
        {
            data[illust_id] = {
                // Nudge the time back slightly as we go, so illustrations earlier in the list will
                // be treated as older.  This causes them to sort earlier in the recent illustrations
                // view.  If we don't do this, they'll be displayed in an undefined order.
                last_seen: time - idx,
            };
            idx++;
        }

        // Batch write:
        await this.db.multi_set(data);
    }

    async clear()
    {
    }

    // Given a dictionary, set all key/value pairs.
    async get_recent_illusts()
    {
        return await this.get_stored_illusts("new");
    }

    // Clean up IDs that haven't been seen in a while.
    async purge_old_illusts()
    {
        let ids_to_delete = await this.get_stored_illusts("old");
        if(ids_to_delete.length == 0)
            return;

        await this.db.multi_delete(ids_to_delete);
    }

    // Get illusts in the database.  If which is "new", return ones that we want to display
    // to the user.  If it's "old", return ones that should be deleted.
    async get_stored_illusts(which="new")
    {
        return await this.db.db_op(async (db) => {
            let store = this.db.get_store(db);

            // Read illustrations seen within the last hour, newest first.
            let index = store.index("last_seen");
            let starting_from = Date.now() - (60*60*1000);
            let query = which == "new"? IDBKeyRange.lowerBound(starting_from):IDBKeyRange.upperBound(starting_from);
            let cursor = index.openCursor(query, "prev");

            let results = [];
            for await (let entry of cursor)
                results.push(entry.primaryKey);

            return results;
        });
    }

    // Clear history.
    async clear()
    {
        return await this.db.clear();
    }
}

