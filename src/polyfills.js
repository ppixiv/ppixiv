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

    // Add commitStylesIfPossible to Animation.
    //
    // Animation.commitStyles throws an exception in some cases.  This is almost never useful and
    // it's a pain to have to wrap every call in an exception handler, so this converts it to a
    // return value.
    Animation.prototype.commitStylesIfPossible = function()
    {
        try {
            this.commitStyles();
            return true;
        } catch(e) {
            console.error(e);
            return false;
        }
    }

    // Firefox still doesn't support inert.  We simulate it with a pointer-events: none style, so
    // implement the attribute.
    if(!("inert" in document.documentElement))
    {
        Object.defineProperty(HTMLElement.prototype, "inert", {
            get: function() { return this.hasAttribute("inert"); },
            set: function(value) {
                if(value)
                    this.setAttribute("inert", "inert");
                else
                    this.removeAttribute("inert", "inert");
            },
        });
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