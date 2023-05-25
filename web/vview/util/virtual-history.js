// VirtualHistory is an implementation for document.location and window.history.  It
// does a couple things:
//
// It allows setting a temporary, virtual URL as the document location.  This is used
// by linked tabs to preview a URL without affecting browser history.
//
// Optionally, it can also replace browser history and navigation entirely.  This is
// used on mobile to work around some problems:
//
// - If there's any back or forwards history, it's impossible to disable the left and
// right swipe gesture for browser back and forwards, even if you're running as a PWA,
// and it's very easy to accidentally navigate back when you're trying to swipe up or
// down at the edge of the screen.  This eliminates them entirely on iOS.  (Android
// still has them, because Android's system gestures are broken.)
// - iOS has a limit of 100 replaceState calls in 30 seconds.  That doesn't make much
// sense, since it's trivial for a regular person navigating quickly to reach that in
// normal usage, and replaceState doesn't navigate the page so it shouldn't be limited
// at all.
// 
// We only enter this mode on mobile when we think we're running as a PWA without browser
// UI.  The main controller will handle intercepting clicks on links and redirecting them
// here.  If we're not doing this, this will only be used for virtual navigations.

import Args from '/vview/util/args.js';

export default class VirtualHistory
{
    constructor({
        // If true, we're using this for all navigation and never using browser navigation.
        permanent=false
    }={})
    {
        this.permanent = permanent;
        this.virtualUrl = null;

        // If we're in permanent mode, copy the browser state to our first history state.
        if(this.permanent)
        {
            this.history = [];
            this.history.push({
                url: new URL(window.location),
                state: window.history.state
            });

            // If we're permanent, we never expect to see popstate events coming from the
            // browser.  Listen for these and warn about them.
            window.addEventListener("popstate", (e) => {
                if(e.isTrusted)
                    console.warn("Unexpected popstate:", e);
            }, true);
        }

        // ppixiv.plocation can be accessed like document.location.
        Object.defineProperty(ppixiv, "plocation", {
            get: () => {
                // If we're not using a virtual location, return document.location.
                // Otherwise, return virtual_url.  Always return a copy of virtual_url,
                // since the caller can modify it and it should only change through
                // explicit history changes.
                if(this.virtualUrl != null)
                    return new URL(this.virtualUrl);

                if(!this.permanent)
                    return new URL(document.location);

                return new URL(this._latestHistory.url);
            },
            set: (value) => {
                // We could support assigning ppixiv.plocation, but we always explicitly
                // pushState.  Just throw an exception if we get here accidentally.
                throw Error("Can't assign to ppixiv.plocation");

                /*
                if(this.virtual)
                {
                    // If we're virtual, replace the virtual URL.
                    this.virtualUrl = new URL(value, this.virtualUrl);
                    this.broadcastPopstate();
                    return;
                }

                if(!this.permanent)
                {
                    document.location = value;
                    return;
                }
                
                this.replaceState(null, "", value);
                this.broadcastPopstate();

                */
            },
        });
    }

    get virtual()
    {
        return this.virtualUrl != null;
    }

    get _latestHistory()
    {
        return this.history[this.history.length-1];
    }

    urlIsVirtual(url)
    {
        // Push a virtual URL by putting #virtual=1 in the hash.
        let args = new Args(url);
        return args.hash.get("virtual");
    }

    // Return the URL we'll go to if we go back.
    get previousStateUrl()
    {
        if(this.history.length < 2)
            return null;

        return this.history[this.history.length-2].url;
    }

    get previousStateArgs()
    {
        let url = this.previousStateUrl;
        if(url == null)
            return null;

        return new Args(url);
    }

    get length()
    {
        if(!this.permanent)
            return window.history.length;
        
        return this.history.length;
    }

    pushState(state, title, url)
    {
        url = new URL(url, document.location);

        let virtual = this.urlIsVirtual(url);
        if(virtual)
        {
            // We don't support a history of virtual locations.  Once we're virtual, we
            // can only replaceState or back out to the real location.
            if(this.virtualUrl)
                throw Error("Can't push a second virtual location");

            // Note that browsers don't dispatch popstate on pushState (which makes no sense at all),
            // so we don't here either to match.
            this._virtualState = state;
            this._virtualTitle = title;
            this.virtualUrl = url;
            return;
        }

        // We're pushing a non-virtual location, so we're no longer virtual if we were before.
        this.virtualUrl = null; 

        if(!this.permanent)
            return window.history.pushState(state, title, url);

        this.history.push({ state, url });

        this._updateBrowserState();
    }

    replaceState(state, title, url)
    {
        url = new URL(url, document.location);
        let virtual = this.urlIsVirtual(url);
        
        if(virtual)
        {
            // We can only replace a virtual location with a virtual location.  
            // We can't replace a real one with a virtual one, since we can't edit
            // history like that.
            if(this.virtualUrl == null)
                throw Error("Can't replace a real history entry with a virtual one");

            this.virtualUrl = url;
            return;
        }

        // If we're replacing a virtual location with a real one, pop the virtual location
        // and push the new state instead of replacing.  Otherwise, replace normally.
        if(this.virtualUrl != null)
        {
            this.virtualUrl = null;
            return this.pushState(state, title, url);
        }

        if(!this.permanent)
            return window.history.replaceState(state, title, url);

        this.history.pop();
        this.history.push({ state, url });
        this._updateBrowserState();
    }

    get state()
    {
        if(this.virtual)
            return this._virtualState;

        if(!this.permanent)
            return window.history.state;
        
        return this._latestHistory.state;
    }

    set state(value)
    {
        if(this.virtual)
            this._virtualState = value;

        if(!this.permanent)
            window.history.state = value;
        this._latestHistory.state = value;
    }
    
    back()
    {
        // If we're backing out of a virtual URL, clear it to return to the real one.
        if(this.virtualUrl)
        {
            this.virtualUrl = null;
            this.broadcastPopstate({cause: "leaving-virtual"});
            return;
        }

        if(!this.permanent)
        {
            window.history.back();
            return;
        }


        if(this.history.length == 1)
            return;

        this.history.pop();
        this.broadcastPopstate();
        this._updateBrowserState();
    }

    broadcastPopstate({cause}={})
    {
        let e = new PopStateEvent("pp:popstate");
        if(cause)
            e.navigationCause = cause;
        window.dispatchEvent(e);
    }

    // If we're permanent, we're not using the browser location ourself and we don't push
    // to browser history, but we do store the current URL and state, so the browser address
    // bar (if any) updates and we'll restore the latest state on reload if possible.
    _updateBrowserState()
    {
        if(!this.permanent)
            return;

        try {
            window.history.replaceState(this.state, "", this._latestHistory.url);
        } catch(e) {
            // iOS has a truly stupid bug: it thinks that casually flipping through pages more
            // than a few times per second (100 / 30 seconds) is something it should panic about,
            // and throws a SecurityError.
            console.log("Error setting browser history (ignored)", e);
        }
    }
}
