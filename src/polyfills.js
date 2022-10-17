"use strict";

ppixiv.install_polyfills = function()
{
    // Make IDBRequest an async generator.
    //
    // Note that this will clobber onsuccess and onerror on the IDBRequest.
    if(!IDBRequest.prototype[Symbol.asyncIterator])
    {
        // This is awful (is there no syntax sugar to make this more readable?), but it
        // makes IDBRequests much more sane to use.
        IDBRequest.prototype[Symbol.asyncIterator] = function() {
            return {
                next: () => {
                    return new Promise((accept, reject) => {
                        this.onsuccess = (e) => {
                            let entry = e.target.result;
                            if(entry == null)
                            {
                                accept({ done: true });                                    
                                return;
                            }

                            accept({ value: entry, done: false });
                            entry.continue();
                        }

                        this.onerror = (e) => {
                            reject(e);
                        };
                    });
                }
            };
        };
    }
};

// Install early polyfills.  These can be needed before other scripts run, so they're installed
// immediately rather than waiting for install_polyfills.
(() => {
    // iOS doesn't have BroadcastChannel.  It's annoying to have to check for this early, since
    // these are often created statically, so install a dummy.
    if(window.BroadcastChannel == null)
    {
        window.BroadcastChannel = class extends EventTarget
        {
            // This allows us to tell that this isn't a real implementation.
            static fake = true;

            postMessage() { }
        };
    }
})();