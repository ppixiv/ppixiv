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

    // Firefox developers aren't really trying anymore, are they?
    if(!Element.prototype.scrollIntoViewIfNeeded)
    {
        // https://stackoverflow.com/a/42543908/136829 with fixed default:
        function getScrollParent(element, includeHidden)
        {
            let style = getComputedStyle(element);
            let excludeStaticParent = style.position === "absolute";
            let overflowRegex = includeHidden ? /(auto|scroll|hidden)/ : /(auto|scroll)/;
        
            if(style.position === "fixed")
                return document.body;
            for (let parent = element; (parent = parent.parentElement);)
            {
                style = getComputedStyle(parent);
                if(excludeStaticParent && style.position === "static")
                    continue;

                if(overflowRegex.test(style.overflow + style.overflowY + style.overflowX))
                    return parent;
            }
        
            return document.scrollingElement;
        }
        
        // Cleaned up from https://gist.github.com/hsablonniere/2581101 and uses getScrollParent to
        // get the scroll parent:
        Element.prototype.scrollIntoViewIfNeeded = function (centerIfNeeded=true)
        {
            let parent = getScrollParent(this);
            let parentComputedStyle = window.getComputedStyle(parent, null);
            let parentBorderTopWidth = parseInt(parentComputedStyle.getPropertyValue('border-top-width'));
            let parentBorderLeftWidth = parseInt(parentComputedStyle.getPropertyValue('border-left-width'));
            let overTop = this.offsetTop - parent.offsetTop < parent.scrollTop;
            let overBottom = (this.offsetTop - parent.offsetTop + this.clientHeight - parentBorderTopWidth) > (parent.scrollTop + parent.clientHeight);
            let overLeft = this.offsetLeft - parent.offsetLeft < parent.scrollLeft;
            let overRight = (this.offsetLeft - parent.offsetLeft + this.clientWidth - parentBorderLeftWidth) > (parent.scrollLeft + parent.clientWidth);
            let alignWithTop = overTop && !overBottom;
        
            if ((overTop || overBottom) && centerIfNeeded)
                parent.scrollTop = this.offsetTop - parent.offsetTop - parent.clientHeight / 2 - parentBorderTopWidth + this.clientHeight / 2;
        
            if ((overLeft || overRight) && centerIfNeeded)
                parent.scrollLeft = this.offsetLeft - parent.offsetLeft - parent.clientWidth / 2 - parentBorderLeftWidth + this.clientWidth / 2;
        
            if ((overTop || overBottom || overLeft || overRight) && !centerIfNeeded)
                this.scrollIntoView(alignWithTop);
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