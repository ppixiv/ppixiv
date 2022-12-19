// Early setup.  If we're running in a user script, this is the entry point for regular
// app code that isn't running in the script sandbox, where we interact with the page
// normally and don't need to worry about things like unsafeWindow.
// 
// If we're running on Pixiv, this checks if we want to be active, and handles adding the
// the "start ppixiv" button.  If the app is running, it starts it.  This also handles
// shutting down Pixiv's scripts before we get started.
ppixiv.AppStartup = class
{
    constructor()
    {
        this.initial_setup();
    }

    async initial_setup()
    {
        // "Stay" for iOS leaves a <script> node containing ourself in the document.  Remove it for
        // consistency with other script managers.
        for(let node of document.querySelectorAll("script[id *= 'Stay']"))
            node.remove();

        // See if we're active, and watch for us becoming active or inactive.
        this.active = this._active_for_current_url();
        window.addEventListener("popstate", (e) => this._window_popstate(e), { capture: true });

        // If we're not active, just see if we need to add our button, and stop without messing
        // around with the page more than we need to.
        if(!this.active)
        {
            this.setup_disabled_ui();
            return;
        }

        // Run _cleanup_environment.  This will try to prevent the underlying page scripts from
        // making network requests or creating elements, and apply other irreversible cleanups
        // that we don't want to do before we know we're going to proceed.
        this._cleanup_environment();

        // Run the app.
        new ppixiv.App();
    }
    
    // Block until DOMContentLoaded.
    _wait_for_content_loaded()
    {
        return new Promise((accept, reject) => {
            if(document.readyState != "loading")
            {
                accept();
                return;
            }

            window.addEventListener("DOMContentLoaded", (e) => accept(), { capture: true, once: true });
        });
    }

    // When we're disabled, but available on the current page, add the button to enable us.
    async setup_disabled_ui(logged_out=false)
    {
        console.log("ppixiv is currently disabled");
        await this._wait_for_content_loaded();

        // On most pages, we show our button in the top corner to enable us on that page.  Clicking
        // it on a search page will switch to us on the same search.
        let disabled_ui = document.createElement("div");
        disabled_ui.innerHTML = `
            <div class=ppixiv-disabled-ui>
                <!-- The top-level template must contain only one node and we only create one
                    of these, so we just put this style in here. -->
                <style>
                .ppixiv-disabled-ui {
                    position: fixed;
                    bottom: 10px;
                    left: 16px;
                }
                .ppixiv-disabled-ui > a {
                    border: none;
                    display: block;
                    width: 46px;
                    height: 44px;
                    cursor: pointer;
                    background-color: transparent;
                    opacity: 0.7;
                    text-decoration: none;
                }
                .ppixiv-disabled-ui > a:hover {
                    opacity: 1;
                }
                </style>

                <a href="#ppixiv">
                    <img src=${this.ppixiv_icon}>
                </a>
            </div>
        `;
        disabled_ui = disabled_ui.firstElementChild;

        this.refresh_disabled_ui(disabled_ui);

        document.body.appendChild(disabled_ui);

        // Newer Pixiv pages update the URL without navigating, so refresh our button with the current
        // URL.  We should be able to do this in popstate, but that API has a design error: it isn't
        // called on pushState, only on user navigation, so there's no way to tell when the URL changes.
        // This results in the URL changing when it's clicked, but that's better than going to the wrong
        // page.
        disabled_ui.addEventListener("focus", (e) => this.refresh_disabled_ui(disabled_ui), { capture: true });
        window.addEventListener("pp:popstate", (e) => this.refresh_disabled_ui(disabled_ui), { capture: true });

        if(this._url_supported(window.location))
        {
            // Remember that we're disabled in this tab.  This way, clicking the "return
            // to Pixiv" button will remember that we're disabled.  We do this on page load
            // rather than when the button is clicked so this works when middle-clicking
            // the button to open a regular Pixiv page in a tab.
            //
            // Only do this if we're available and disabled, which means the user disabled us.
            // If we wouldn't be available on this page at all, don't store it.
            this._store_ppixiv_disabled(true);
        }

        // If we're showing this and we know we're logged out, show a message on click.
        // This doesn't work if we would be inactive anyway, since we don't know whether
        // we're logged in, so the user may need to click the button twice before actually
        // seeing this message.
        if(logged_out)
        {
            disabled_ui.querySelector("a").addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                this.show_logged_out_message(true);
            });
        }
    }

    refresh_disabled_ui(disabled_ui)
    {
        // If we're on a page that we don't support, like the top page, rewrite the link to switch to
        // a page we do support.  Otherwise, replace the hash with #ppixiv.
        if(this._url_supported(window.location))
        {
            let url = new URL(window.location);
            url.hash = "#ppixiv";
            disabled_ui.querySelector("a").href = url;
        }
        else
        {
            // This should be synced with MainController.setup.
            disabled_ui.querySelector("a").href = "/ranking.php?mode=daily#ppixiv";
        }
    }

    // Return true if we're currently active.
    //
    // This is cached at the start of the page and doesn't change unless the page is reloaded.
    _active_for_current_url()
    {
        if(ppixiv.native)
            return true;

        // If the hash is empty, use the default.
        if(window.location.hash == "")
            return this._active_by_default();

        // If we have a hash and it's not #ppixiv, then we're explicitly disabled.
        if(!window.location.hash.startsWith("#ppixiv"))
            return false;

        // We have a #ppixiv hash, so we're available as long as we support this page.
        return this._url_supported(window.location);
    };

    _window_popstate = (e) =>
    {
        let currently_active = this._active_for_current_url();
        if(this.active == currently_active)
            return;

        // Stop propagation, so other listeners don't see this.  For example, this prevents
        // the thumbnail viewer from turning on or off as a result of us changing the hash
        // to "#no-ppixiv".
        e.stopImmediatePropagation();

        if(this.active == currently_active)
            return;
        
        this._store_ppixiv_disabled(!currently_active);
        
        // The active state changed.  Remember the new state and reload the page.
        console.log("Active state changed");
        document.location.reload();
    }

    // Remember if we're enabled or disabled in this tab.
    _store_ppixiv_disabled(disabled)
    {
        if(disabled)
            window.sessionStorage.ppixiv_disabled = 1;
        else
            delete window.sessionStorage.ppixiv_disabled;
    }

    // Return true if we're active by default on the current page.
    _active_by_default()
    {
        if(ppixiv.native || ppixiv.mobile)
            return true;

        // If the disabled-by-default setting is enabled, disable by default until manually
        // turned on.  This is used too early to access the settings class, so just access
        // it directly.
        let disabled_by_default = localStorage["_ppixiv_disabled-by-default"] == "true";
        if(disabled_by_default)
            return false;

        // If this is set, the user clicked the "return to Pixiv" button.  Stay disabled
        // in this tab until we're reactivated.
        if(window.sessionStorage.ppixiv_disabled)
            return false;

        // Activate by default on the top page, even though it's not a real data source.  We'll
        // redirect to a supported page.
        let pathname = this._get_path_without_language(window.location.pathname);
        if(pathname == "/")
            return true;

        // Activate by default if a data source is available for this page.
        return this._url_supported(window.location);
    }

    // helpers.get_path_without_language:
    _get_path_without_language(path)
    {
        if(/^\/..\//.exec(path))
            return path.substr(3);
        else        
            return path;
    }

    // Return true if it's possible for us to be active on this page.
    //
    // This matches data_source.get_data_source_for_url, but only figures out whether
    // we recognize the URL or not, so we don't need as many URL helpers.
    _url_supported(url)
    {
        url = new URL(url);
        let pathname = this._get_path_without_language(url.pathname);

        let parts = pathname.split("/");
        let first_part = parts[1]; // helpers.get_page_type_from_url
        if(first_part == "artworks")
            return true; // manga, current_illust
        else if(first_part == "users")
            return true; // follows, artist, bookmarks, bookmarks_merged, bookmarks
        else if(pathname == "/new_illust.php" || pathname == "/new_illust_r18.php")
            return true; // new_illust
        else if(pathname == "/bookmark_new_illust.php" || pathname == "/bookmark_new_illust_r18.php")
            return true; // new_works_by_following
        else if(first_part == "tags")
            return true; // search
        else if(pathname == "/discovery")
            return true; // discovery
        else if(pathname == "/discovery/users")
            return true; // discovery_users
        else if(pathname == "/bookmark_detail.php")
            return true; // related_illusts, related_favorites
        else if(pathname == "/ranking.php")
            return true; // rankings
        else if(pathname == "/search_user.php")
            return true; // search_users
        else if(pathname.startsWith("/request/complete"))
            return true; // completed_requests
        else if(pathname.startsWith(local_api.path))
            return true; // vview, vview_similar
        else if(first_part == "" && window.location.hash.startsWith("#ppixiv/edits"))
            return true; // edited_images
        else
            return false;
    }

    // Try to stop the underlying page from doing things (it just creates unnecessary network
    // requests and spams errors to the console), and undo damage to the environment that it
    // might have done before we were able to start.
    _cleanup_environment()
    {
        window.realRequestAnimationFrame = window.requestAnimationFrame.bind(window);

        if(ppixiv.native)
        {
            // We're running in a local environment and not on Pixiv, so we don't need to do
            // this stuff.  Just add stubs for the functions we'd set up here.
            window.HTMLDocument.prototype.realCreateElement = window.HTMLDocument.prototype.createElement;
            window.realRequestAnimationFrame = window.requestAnimationFrame.bind(window);
            window.realCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
            window.realSetTimeout = window.setTimeout.bind(window);
            window.realSetInterval = window.setInterval.bind(window);
            window.realClearTimeout = window.clearTimeout.bind(window);
            window.realImage = window.Image;
            window.realFetch = window.fetch;
            window.MessagePort.prototype.realPostMessage = window.MessagePort.prototype.postMessage;

            return;
        }

        // Newer Pixiv pages run a bunch of stuff from deferred scripts, which install a bunch of
        // nastiness (like searching for installed polyfills--which we install--and adding wrappers
        // around them).  Break this by defining a webpackJsonp property that can't be set.  It
        // won't stop the page from running everything, but it keeps it from getting far enough
        // for the weirder scripts to run.
        //
        // Also, some Pixiv pages set an onerror to report errors.  Disable it if it's there,
        // so it doesn't send errors caused by this script.  Remove _send and _time, which
        // also send logs.  It might have already been set (TamperMonkey in Chrome doesn't
        // implement run-at: document-start correctly), so clear it if it's there.
        for(let key of ["onerror", "onunhandledrejection", "_send", "_time", "webpackJsonp", "touchJsonp"])
        {
            window[key] = null;

            // Use an empty setter instead of writable: false, so errors aren't triggered all the time.
            Object.defineProperty(window, key, {
                get: function() { return null; },
                set: function(value) { },
            });
        }

        // Try to unwrap functions that might have been wrapped by page scripts.
        function unwrap_func(obj, name, { ignore_missing=false }={})
        {
            // Both prototypes and instances might be wrapped.  If this is an instance, look
            // at the prototype to find the original.
            let orig_func = obj.__proto__ && obj.__proto__[name]? obj.__proto__[name]:obj[name];
            if(!orig_func)
            {
                if(!ignore_missing)
                    console.log("Couldn't find function to unwrap:", name);
                return;
            }

            if(!orig_func.__sentry_original__)
                return;

            while(orig_func.__sentry_original__)
                orig_func = orig_func.__sentry_original__;
            obj[name] = orig_func;
        }

        try {
            unwrap_func(window, "fetch");
            unwrap_func(window, "setTimeout");
            unwrap_func(window, "setInterval");
            unwrap_func(window, "clearInterval");
            unwrap_func(window, "requestAnimationFrame");
            unwrap_func(window, "cancelAnimationFrame");
            unwrap_func(EventTarget.prototype, "addEventListener");
            unwrap_func(EventTarget.prototype, "removeEventListener");
            unwrap_func(XMLHttpRequest.prototype, "send");
        } catch(e) {
            console.error("Error unwrapping environment", e);
        }

        // Delete owned properties on an object.  This removes wrappers around class functions
        // like document.addEventListener, so it goes back to the browser implementation, and
        // freezes the object to prevent them from being added in the future.
        function delete_overrides(obj)
        {
            for(let prop of Object.getOwnPropertyNames(obj))
            {
                try {
                    delete obj[prop];
                } catch(e) {
                    // A couple properties like document.location are normal and can't be deleted.
                }
            }

            try {
                Object.freeze(obj);
            } catch(e) {
                console.error(`Error freezing ${obj}: ${e}`);
            }
        }

        try {
            // We might get here before the mangling happens, which means it might happen
            // in the future.  Freeze the objects to prevent this.
            Object.freeze(EventTarget.prototype);

            // Delete wrappers on window.history set by the site, and freeze it so they can't
            // be added.
            delete_overrides(window.history);
            delete_overrides(window.document);

            // Pixiv wraps console.log, etc., which breaks all logging since it causes them to all
            // appear to come from the wrapper.  Remove these if they're present and try to prevent
            // it from happening later.
            for(let name of Object.keys(window.console))
                unwrap_func(console, name, { ignore_missing: true });
            Object.freeze(window.console);

            // Some Pixiv pages load jQuery and spam a bunch of error due to us stopping
            // their scripts.  Try to replace jQuery's exception hook with an empty one to
            // silence these.  This won't work if jQuery finishes loading after we do, but
            // that's not currently happening, so this is all we do for now.
            if("jQuery" in window)
                jQuery.Deferred.exceptionHook = () => { };
        } catch(e) {
            console.error("Error unwrapping environment", e);
        }

        // Try to kill the React scheduler that Pixiv uses.  It uses a MessageChannel to run itself,
        // so we can disable it by disabling MessagePort.postmessage.  This seems to happen early
        // enough to prevent the first scheduler post from happening.
        //
        // Store the real postMessage, so we can still use it ourself.
        try {
            window.MessagePort.prototype.realPostMessage = window.MessagePort.prototype.postMessage;
            window.MessagePort.prototype.postMessage = (msg) => { };
        } catch(e) {
            console.error("Error disabling postMessage", e);
        }

        // Disable requestAnimationFrame.  This can also be used by the React scheduler.
        window.realRequestAnimationFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (func) => { };

        window.realCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
        window.cancelAnimationFrame = (id) => { };

        // Disable the page's timers.  This helps prevent things like GTM from running.
        window.realSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (f, ms) => { return -1; };

        window.realSetInterval = window.setInterval.bind(window);
        window.setInterval = (f, ms) => { return -1; };

        window.realClearTimeout = window.clearTimeout.bind(window);
        window.clearTimeout = () => { };

        try {
            window.addEventListener = Window.prototype.addEventListener.bind(window);
            window.removeEventListener = Window.prototype.removeEventListener.bind(window);
        } catch(e) {
            // This fails on iOS.  That's OK, since Pixiv's mobile site doesn't mess
            // with these (and since we can't write to these, it wouldn't be able to either).
        }

        window.realImage = window.Image;
        window.Image = function() { };

        // Replace window.fetch with a dummy to prevent some requests from happening.  Store it
        // in realFetch so we can use it.
        window.realFetch = window.fetch;

        class dummy_fetch
        {
            sent() { return this; }
        };
        dummy_fetch.prototype.ok = true;
        window.fetch = function() { return new dummy_fetch(); };

        // We don't use XMLHttpRequest.  Disable it to make sure the page doesn't.
        window.XMLHttpRequest = function() { };

        // Similarly, prevent it from creating script and style elements.  Sometimes site scripts that
        // we can't disable keep running and do things like loading more scripts or adding stylesheets.
        // Use realCreateElement to bypass this.
        let origCreateElement = window.HTMLDocument.prototype.createElement;
        window.HTMLDocument.prototype.realCreateElement = window.HTMLDocument.prototype.createElement;
        window.HTMLDocument.prototype.createElement = function(type, options)
        {
            // Prevent the underlying site from creating new script and style elements.
            if(type == "script" || type == "style")
            {
                // console.warn("Disabling createElement " + type);
                throw new ElementDisabled("Element disabled");
            }
            return origCreateElement.apply(this, arguments);
        };

        // Catch and discard ElementDisabled.
        //
        // This is crazy: the error event doesn't actually receive the unhandled exception.
        // We have to examine the message to guess whether an error is ours.
        window.addEventListener("error", (e) => {
            if(e.message && e.message.indexOf("Element disabled") == -1)
                return;

            e.preventDefault();
            e.stopPropagation();
        }, true);

        // We have to hit things with a hammer to get Pixiv's scripts to stop running, which
        // causes a lot of errors.  Silence all errors that have a stack within Pixiv's sources,
        // as well as any errors from ElementDisabled.
        window.addEventListener("error", (e) => {
            let silence_error = false;
            if(e.filename && e.filename.indexOf("s.pximg.net") != -1)
                silence_error = true;

            if(silence_error)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
        }, true);

        window.addEventListener("unhandledrejection", (e) => {
            let silence_error = false;
            if(e.reason && e.reason.stack && e.reason.stack.indexOf("s.pximg.net") != -1)
                silence_error = true;
            if(e.reason && e.reason.message == "Element disabled")
                silence_error = true;

            if(silence_error)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
        }, true);
    }

    // This is activate-icon.png.  It's stored here so we can access it without needing
    // access to our script resources.
    ppixiv_icon = 
        'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAC4AAAAsCAYAAAAacYo8AAAACXBIWXMAAC4jAAAuIwF4pT92AAAG' + 
        'U2lUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0w' + 
        'TXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRh' + 
        'LyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNS42LWMxNDIgNzkuMTYwOTI0LCAyMDE3LzA3LzEz' + 
        'LTAxOjA2OjM5ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3Jn' + 
        'LzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0i' + 
        'IiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRw' + 
        'Oi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMu' + 
        'YWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNv' + 
        'bS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9z' + 
        'VHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ0Mg' + 
        'KFdpbmRvd3MpIiB4bXA6Q3JlYXRlRGF0ZT0iMjAxOC0wNi0yN1QwMjoyMjoyOS0wNTowMCIgeG1w' + 
        'Ok1vZGlmeURhdGU9IjIwMTgtMDYtMjdUMDI6MjY6MjAtMDU6MDAiIHhtcDpNZXRhZGF0YURhdGU9' + 
        'IjIwMTgtMDYtMjdUMDI6MjY6MjAtMDU6MDAiIGRjOmZvcm1hdD0iaW1hZ2UvcG5nIiBwaG90b3No' + 
        'b3A6Q29sb3JNb2RlPSIzIiBwaG90b3Nob3A6SUNDUHJvZmlsZT0ic1JHQiBJRUM2MTk2Ni0yLjEi' + 
        'IHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6MWU4MmI3MjgtOTVjNi1mNzQyLWJjOWQtMjIwMTM5' + 
        'NzJkNDBlIiB4bXBNTTpEb2N1bWVudElEPSJhZG9iZTpkb2NpZDpwaG90b3Nob3A6N2ZkYzUwY2It' + 
        'YjgzMy1hNzQzLTllMjYtNzQ1NmM4NDFlNjM0IiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9Inht' + 
        'cC5kaWQ6MzMyMzRmNjktNjk2OS1jNjQ1LWI0MjgtYmM1NDUwYTM3NDAzIj4gPHhtcE1NOkhpc3Rv' + 
        'cnk+IDxyZGY6U2VxPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0iY3JlYXRlZCIgc3RFdnQ6aW5zdGFu' + 
        'Y2VJRD0ieG1wLmlpZDozMzIzNGY2OS02OTY5LWM2NDUtYjQyOC1iYzU0NTBhMzc0MDMiIHN0RXZ0' + 
        'OndoZW49IjIwMTgtMDYtMjdUMDI6MjI6MjktMDU6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFk' + 
        'b2JlIFBob3Rvc2hvcCBDQyAoV2luZG93cykiLz4gPHJkZjpsaSBzdEV2dDphY3Rpb249ImNvbnZl' + 
        'cnRlZCIgc3RFdnQ6cGFyYW1ldGVycz0iZnJvbSBhcHBsaWNhdGlvbi92bmQuYWRvYmUucGhvdG9z' + 
        'aG9wIHRvIGltYWdlL3BuZyIvPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiIHN0RXZ0Omlu' + 
        'c3RhbmNlSUQ9InhtcC5paWQ6MWU4MmI3MjgtOTVjNi1mNzQyLWJjOWQtMjIwMTM5NzJkNDBlIiBz' + 
        'dEV2dDp3aGVuPSIyMDE4LTA2LTI3VDAyOjI2OjIwLTA1OjAwIiBzdEV2dDpzb2Z0d2FyZUFnZW50' + 
        'PSJBZG9iZSBQaG90b3Nob3AgQ0MgKFdpbmRvd3MpIiBzdEV2dDpjaGFuZ2VkPSIvIi8+IDwvcmRm' + 
        'OlNlcT4gPC94bXBNTTpIaXN0b3J5PiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6' + 
        'eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PmQ/KUAAAAQhSURBVFiF7ZlNTxtHGMd/s/aaGGqD' + 
        'HRRLwQergko+lJhW4pJDqdQLpzSfoOHqU/sJGj5By8VXkk8QcuqlUtxjckBWLxxaqVYFVQnCdWiD' + 
        'Yy/e6WG8Zr07a68X8xIpfwmtZp6Z2d8+fuaZF4SUkvdRxnUDRNV7Cx4HEEJMbsRKpwTMAc7TUb33' + 
        '16ScqEUd3gltIaW8GHil8zXwBbCGgg2rKvAc2KGcqIftdDHwSmcN+AZ4NF7HQO0AW5QT1VENo4FX' + 
        'Oo+A74GCzizaDWg3EN1TOGsNGuNJZOI2cioL8eSwD9ignGhOBnwIsGgdIt4dIlqvwbaGj+O8fCqL' + 
        'TC+pj/Cr2YPfiQ6uJtoPqPj1ARtv9vyeHUMymcPOfAqGqTNvUE488fUZCV7pPEZ52SfRbmAcvYwM' + 
        'PKB4Evv2Z0gzrbP64IPBK5054BkaLzsKAy6TOWR60Qek7WuYdO/cD4r9FXf6dMDjA01UaLxgMP82' + 
        'PeXhwDML2JnlfvnjuzESpqBjSQ6ObNpk6ebXVagd76pGtoVxvIudu68bchtY8Vaer5xqAnqha8BG' + 
        'WOhufh07s0wmZbBaNFktmszPGqSnBfOzBvcW46wWVTzLZA45s9DvK6wTxH913bClHpsGXBm2PdA7' + 
        'lBMrKI8PB777Fd38er+8lI8Nbe/A25nlAS8bJ78HdfHNNcfj2576GiE93c2vg2EiWodhmvf1+Sc9' + 
        'z7vngG0h3h7omhd6K3RfDvimq64JPBy2CPjUi9FxFHP9KO45Id4FOuCBu+CA/4jaAAFUx9k7GEcv' + 
        'Eda/YZtrNRDr7UZQs9LAewF63nVCY26cl040p4NaffUrcMldOM8qaoOzCTydHEVIeVbfML/gYB4v' + 
        'Jx5PkiesjDd74RqqdaYG13gCerWnwkG0G+EzkmsFvRZwBxrb0s4PaaZGjhEf2SKCXu1ZTN8SLMwb' + 
        'ZFLnvvnzsMvfDbtfjv31s7+zYQbtFuvuwqWAG//8yulskd/2TaDrtx/vBoaHTN4JGrbqLlwKuHh7' + 
        'QEy/Ao6UnM4HmZ67CzfqekJOZYNORXXviehSwN0brnEk54pBpk1vxURDJbb/U+S+dmY56BRU1R3h' + 
        'bkSoyI8KA/sVl5rAQ53hUiZnaBkm9mxxGPSXQbvUSODSTGGnlzBO9yOf8uXMAnZqKeicWUdtrWtB' + 
        '/aN53DCR6UW66UWEdQKt1+p51lLPINiprDqy3cpd6FIoOrgbxkyDmcZ7yy6sE7DPem1SQauhW3Xg' + 
        'u6CLIK+igteALdSpZA3NHj4gQ+i0AzwNC+woKnizl6KeAM4laAm4h7qmK6E/kDRRH10DfkGlumYU' + 
        'gMlkFXUIqU5krJC6EXk8ij6AX7WGg6sL0AcaS6E3Ia9Nozz+B/Ctpr4AvKDS0dmuRKOyytYIe21C' + 
        'HGNLfPjP8hXrf5SZd4NRInfBAAAAAElFTkSuQmCC';
}

