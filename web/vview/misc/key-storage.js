
// Originally from https://gist.github.com/wilsonpage/01d2eb139959c79e0d9a
export default class KeyStorage
{
    constructor(store_name, {db_upgrade=null, version=1}={})
    {
        this.db_name = store_name;
        this.db_upgrade = db_upgrade;
        this.store_name = store_name;
        this.version = version;
        this.failed = false;
    }

    // Open the database, run func, then close the database.
    //
    // If you open a database with IndexedDB and then leave it open, like you would with
    // any other database, any attempts to add stores (which you can do seamlessly with
    // any other database) will permanently wedge the database.  We have to open it and
    // close it around every op.
    //
    // If the database can't be opened, func won't be called and null will be returned.
    async db_op(func)
    {
        // Stop early if we've already failed, so we don't log an error for each op.
        if(this.failed)
            return null;

        let db;
        try {
            db = await this.open_database();
        } catch(e) {
            console.log("Couldn't open database:", e);
            this.failed = true;
            return null;
        }
        
        try {
            return await func(db);
        } finally {
            db.close();
        }
    }

    async get_db_version()
    {
        let dbs = await indexedDB.databases();
        for(let db of dbs)
        {
            if(db.name == this.db_name)
                return db.version;
        }

        return 0;
    }

    open_database()
    {
        return new Promise((resolve, reject) => {
            let request = indexedDB.open(this.db_name, this.version);

            // If this happens, another tab has the database open.
            request.onblocked = e => {
                console.error("Database blocked:", e);
            };

            request.onupgradeneeded = e => {
                // If we have a db_upgrade function, let it handle the upgrade.  Otherwise, we're
                // just creating the initial database and we're not doing anything special with it.
                let db = e.target.result;
                if(this.db_upgrade)
                    this.db_upgrade(e);
                else
                    db.createObjectStore(this.store_name);
            };

            request.onsuccess = e => {
                let db = e.target.result;
                resolve(db);
            };

            request.onerror = e => {
                reject(request.error);
            };
        });
    }

    get_store(db, mode="readwrite")
    {
        let transaction = db.transaction(this.store_name, mode);
        return transaction.objectStore(this.store_name);
    }

    static await_request(request)
    {
        return new Promise((resolve, reject) => {
            let abort = new AbortController;
            request.addEventListener("success", (e) => {
                abort.abort();
                resolve(request.result);
            }, { signal: abort.signal });

            request.addEventListener("error", (e) => {
                abort.abort();
                reject(request.result);
            }, { signal: abort.signal });
        });        
    }

    static async_store_get(store, key)
    {
        return new Promise((resolve, reject) => {
            var request = store.get(key);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = reject;
        });
    }

    async get(key, store)
    {
        return await this.db_op(async (db) => {
            return await KeyStorage.async_store_get(this.get_store(db), key);
        });
    }

    // Retrieve the values for a list of keys.  Return a dictionary of {key: value}.
    async multi_get(keys)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db, "readonly");

            let promises = [];
            for(let key of keys)
                promises.push(KeyStorage.async_store_get(store, key));
            return await Promise.all(promises);
        }) ?? {};
    }

    static async_store_set(store, key, value)
    {
        return new Promise((resolve, reject) => {
            var request = store.put(value, key);
            request.onsuccess = resolve;
            request.onerror = reject;
        });
    }
    
    async set(key, value)
    {
        return await this.db_op(async (db) => {
            return KeyStorage.async_store_set(this.get_store(db), key, value);
        });
    }

    // Given a dictionary, set all key/value pairs.
    async multi_set(data)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);

            let promises = [];
            for(let [key, value] of Object.entries(data))
            {
                let request = store.put(value, key);
                promises.push(KeyStorage.await_request(request));
            }
            await Promise.all(promises);
        });
    }

    async multi_set_values(data)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);
            let promises = [];
            for(let item of data)
            {
                let request = store.put(item);
                promises.push(KeyStorage.await_request(request));
            }
            return Promise.all(promises);
        });
    }

    async delete(key)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);
            return KeyStorage.await_request(store.delete(key));
        });
    }

    // Delete a list of keys.
    async multi_delete(keys)
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);
            let promises = [];
            for(let key of keys)
            {
                let request = store.delete(key);
                promises.push(KeyStorage.await_request(request));
            }
            return Promise.all(promises);
        });
    }

    // Delete all keys.
    async clear()
    {
        return await this.db_op(async (db) => {
            let store = this.get_store(db);
            await store.clear();
        });
    }
}
