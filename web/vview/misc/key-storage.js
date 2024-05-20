
// Originally from https://gist.github.com/wilsonpage/01d2eb139959c79e0d9a
export default class KeyStorage
{
    constructor(storeName, {upgradeDb=null, version=1}={})
    {
        this._dbName = storeName;
        this._upgradeDb = upgradeDb;
        this._storeName = storeName;
        this._version = version;
        this._failed = false;
    }

    // Open the database, run func, then close the database.
    //
    // If you open a database with IndexedDB and then leave it open, like you would with
    // any other database, any attempts to add stores (which you can do seamlessly with
    // any other database) will permanently wedge the database.  We have to open it and
    // close it around every op.
    //
    // If the database can't be opened, func won't be called and null will be returned.
    async dbOp(func)
    {
        // Stop early if we've already failed, so we don't log an error for each op.
        if(this._failed)
            return null;

        let db;
        try {
            db = await this._openDatabase();
        } catch(e) {
            console.log("Couldn't open database:", e);
            this._failed = true;
            return null;
        }
        
        try {
            return await func(db);
        } finally {
            db.close();
        }
    }

    async getDbVersion()
    {
        let dbs = await indexedDB.databases();
        for(let db of dbs)
        {
            if(db.name == this._dbName)
                return db.version;
        }

        return 0;
    }

    _openDatabase()
    {
        return new Promise((resolve, reject) => {
            let request = indexedDB.open(this._dbName, this._version);

            // If this happens, another tab has the database open.
            request.onblocked = e => {
                console.error("Database blocked:", e);
            };

            request.onupgradeneeded = e => {
                // If we have a upgradeDb function, let it handle the upgrade.  Otherwise, we're
                // just creating the initial database and we're not doing anything special with it.
                let db = e.target.result;
                if(this._upgradeDb)
                    this._upgradeDb(e);
                else
                    db.createObjectStore(this._storeName);
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

    getStore(db, mode="readwrite")
    {
        let transaction = db.transaction(this._storeName, mode);
        return transaction.objectStore(this._storeName);
    }

    static awaitRequest(request)
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

    static asyncStoreGet(store, key)
    {
        return new Promise((resolve, reject) => {
            let request = store.get(key);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = reject;
        });
    }

    async get(key, store)
    {
        return await this.dbOp(async (db) => {
            return await KeyStorage.asyncStoreGet(this.getStore(db), key);
        });
    }

    // Retrieve the values for a list of keys.  Return a dictionary of {key: value}.
    async multiGet(keys)
    {
        return await this.dbOp(async (db) => {
            let store = this.getStore(db, "readonly");

            let promises = [];
            for(let key of keys)
                promises.push(KeyStorage.asyncStoreGet(store, key));
            return await Promise.all(promises);
        }) ?? {};
    }

    static asyncStoreSet(store, key, value)
    {
        return new Promise((resolve, reject) => {
            let request = store.put(value, key);
            request.onsuccess = resolve;
            request.onerror = reject;
        });
    }
    
    async set(key, value)
    {
        return await this.dbOp(async (db) => {
            return KeyStorage.asyncStoreSet(this.getStore(db), key, value);
        });
    }

    // Given a dictionary, set all key/value pairs.
    async multiSet(data, { overwrite=true }={})
    {
        return await this.dbOp(async (db) => {
            let store = this.getStore(db);

            async function setKey(key, value)
            {
                if(!overwrite)
                {
                    let existingKey = await store.getKey(key);
                    if(existingKey !== undefined)
                    {
                        // Key already exists, skip to the next iteration
                        return null;
                    }
                }

                let request = store.put(value, key);
                await KeyStorage.awaitRequest(request);
            }

            let promises = [];
            for(let [key, value] of Object.entries(data))
                promises.push(setKey(key, value));
    
            await Promise.all(promises);
        });
    }

    async multiSetValues(data)
    {
        return await this.dbOp(async (db) => {
            let store = this.getStore(db);
            let promises = [];
            for(let item of data)
            {
                let request = store.put(item);
                promises.push(KeyStorage.awaitRequest(request));
            }
            return Promise.all(promises);
        });
    }

    async delete(key)
    {
        return await this.dbOp(async (db) => {
            let store = this.getStore(db);
            return KeyStorage.awaitRequest(store.delete(key));
        });
    }

    // Delete a list of keys.
    async multiDelete(keys)
    {
        return await this.dbOp(async (db) => {
            let store = this.getStore(db);
            let promises = [];
            for(let key of keys)
            {
                let request = store.delete(key);
                promises.push(KeyStorage.awaitRequest(request));
            }
            return Promise.all(promises);
        });
    }

    // Delete all keys.
    async clear()
    {
        return await this.dbOp(async (db) => {
            let store = this.getStore(db);
            await store.clear();
        });
    }
}
