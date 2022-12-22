// Early setup.  If we're running in a user script, this is the entry point for regular
// app code that isn't running in the script sandbox, where we interact with the page
// normally and don't need to worry about things like unsafeWindow.
// 
// If we're running on Pixiv, this checks if we want to be active, and handles adding the
// the "start ppixiv" button.  If the app is running, it starts it.  This also handles
// shutting down Pixiv's scripts before we get started.
class AppStartup
{
    constructor(init)
    {
        this.init = init;
        this.initialSetup();
    }

    async initialSetup()
    {
        window.ppixiv = this.init;

        console.log(`${ppixiv.native? "vview":"ppixiv"} setup`);
        console.log("Browser:", navigator.userAgent);
        
        // "Stay" for iOS leaves a <script> node containing ourself in the document.  Remove it for
        // consistency with other script managers.
        for(let node of document.querySelectorAll("script[id *= 'Stay']"))
            node.remove();

        // See if we're active, and watch for us becoming active or inactive.
        this.active = this._activeForCurrentUrl();
        window.addEventListener("popstate", (e) => this._windowPopstate(e), { capture: true });

        // If we're not active, just see if we need to add our button, and stop without messing
        // around with the page more than we need to.
        if(!this.active)
        {
            this.setupDisabledUi();
            return;
        }

        // Run _cleanupEnvironment.  This will try to prevent the underlying page scripts from
        // making network requests or creating elements, and apply other irreversible cleanups
        // that we don't want to do before we know we're going to proceed.
        this._cleanupEnvironment();

        await this.loadModules();

        // Run the app.
        let { default: App } = await ppixiv.importModule("vview/app.js");

        console.log("Launching app");
        new App();
    }
    
    async loadModules()
    {
        // this.init.modules is a mapping from module names to resource paths containing
        // the module source.  Make a module name -> source mapping to load the modules.
        let scripts = { };
        for(let [moduleName, modulePath] of Object.entries(this.init.modules))
        {
            let source = this.init.resources[modulePath];
            scripts[moduleName] = { source };

            // Delete the module source from resources.  We don't need it anymore.
            delete this.init.resources[modulePath];
        }

        let useShim = false;
        if(!HTMLScriptElement.supports("importmap"))
            useShim = true;
            useShim = true;

        let moduleProcessorClass = useShim? ModuleImporter_Babel:ModuleImporter_Native;
        //moduleProcessorClass = ModuleImporter_ESModuleShims;

        let processor = new moduleProcessorClass();
        ppixiv.importModule = processor.import;

        await processor.load(scripts);

        // Force all scripts to be imported.  This is just so we catch errors early.
        for(let path of Object.keys(scripts))
        {
            try {
                await ppixiv.importModule(path);
            } catch(e) {
                console.error(`Error loading ${path}`, e);
            }
        }
    }

    // Block until DOMContentLoaded.
    _waitForContentLoaded()
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
    async setupDisabledUi(loggedOut=false)
    {
        console.log("ppixiv is currently disabled");
        await this._waitForContentLoaded();

        // On most pages, we show our button in the top corner to enable us on that page.  Clicking
        // it on a search page will switch to us on the same search.
        let disabledUi = document.createElement("div");
        disabledUi.innerHTML = `
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
                    <img src=${this.ppixivIcon}>
                </a>
            </div>
        `;
        disabledUi = disabledUi.firstElementChild;

        this.refreshDisabledUi(disabledUi);

        document.body.appendChild(disabledUi);

        // Newer Pixiv pages update the URL without navigating, so refresh our button with the current
        // URL.  We should be able to do this in popstate, but that API has a design error: it isn't
        // called on pushState, only on user navigation, so there's no way to tell when the URL changes.
        // This results in the URL changing when it's clicked, but that's better than going to the wrong
        // page.
        disabledUi.addEventListener("focus", (e) => this.refreshDisabledUi(disabledUi), { capture: true });
        window.addEventListener("pp:popstate", (e) => this.refreshDisabledUi(disabledUi), { capture: true });

        if(this._urlSupported(window.location))
        {
            // Remember that we're disabled in this tab.  This way, clicking the "return
            // to Pixiv" button will remember that we're disabled.  We do this on page load
            // rather than when the button is clicked so this works when middle-clicking
            // the button to open a regular Pixiv page in a tab.
            //
            // Only do this if we're available and disabled, which means the user disabled us.
            // If we wouldn't be available on this page at all, don't store it.
            this._storeDisabled(true);
        }

        // If we're showing this and we know we're logged out, show a message on click.
        // This doesn't work if we would be inactive anyway, since we don't know whether
        // we're logged in, so the user may need to click the button twice before actually
        // seeing this message.
        if(loggedOut)
        {
            disabledUi.querySelector("a").addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                this.showLoggedOutMessage(true);
            });
        }
    }

    showLoggedOutMessage(force)
    {
        // Unless forced, don't show the message if we've already shown it recently.
        // A session might last for weeks, so we don't want to force it to only be shown
        // once, but we don't want to show it repeatedly.
        let lastShown = window.sessionStorage.showedLogoutMessage || 0;
        let timeSinceShown = Date.now() - lastShown;
        let hoursSinceShown = timeSinceShown / (60*60*1000);
        if(!force && hoursSinceShown < 6)
            return;

        window.sessionStorage.showedLogoutMessage = Date.now();

        alert("Please log in to use ppixiv.");
    }

    refreshDisabledUi(disabledUi)
    {
        // If we're on a page that we don't support, like the top page, rewrite the link to switch to
        // a page we do support.  Otherwise, replace the hash with #ppixiv.
        if(this._urlSupported(window.location))
        {
            let url = new URL(window.location);
            url.hash = "#ppixiv";
            disabledUi.querySelector("a").href = url;
        }
        else
        {
            // This should be synced with MainController.setup.
            disabledUi.querySelector("a").href = "/ranking.php?mode=daily#ppixiv";
        }
    }

    // Return true if we're currently active.
    //
    // This is cached at the start of the page and doesn't change unless the page is reloaded.
    _activeForCurrentUrl()
    {
        if(ppixiv.native)
            return true;

        // If the hash is empty, use the default.
        if(window.location.hash == "")
            return this._activeByDefault();

        // If we have a hash and it's not #ppixiv, then we're explicitly disabled.
        if(!window.location.hash.startsWith("#ppixiv"))
            return false;

        // We have a #ppixiv hash, so we're available as long as we support this page.
        return this._urlSupported(window.location);
    };

    _windowPopstate = (e) =>
    {
        let currently_active = this._activeForCurrentUrl();
        if(this.active == currently_active)
            return;

        // Stop propagation, so other listeners don't see this.  For example, this prevents
        // the thumbnail viewer from turning on or off as a result of us changing the hash
        // to "#no-ppixiv".
        e.stopImmediatePropagation();

        if(this.active == currently_active)
            return;
        
        this._storeDisabled(!currently_active);
        
        // The active state changed.  Remember the new state and reload the page.
        console.log("Active state changed");
        document.location.reload();
    }

    // Remember if we're enabled or disabled in this tab.
    _storeDisabled(disabled)
    {
        if(disabled)
            window.sessionStorage.ppixiv_disabled = 1;
        else
            delete window.sessionStorage.ppixiv_disabled;
    }

    // Return true if we're active by default on the current page.
    _activeByDefault()
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
        let pathname = this._getPathWithoutLanguage(window.location.pathname);
        if(pathname == "/")
            return true;

        // Activate by default if a data source is available for this page.
        return this._urlSupported(window.location);
    }

    // helpers.getPathWithoutLanguage:
    _getPathWithoutLanguage(path)
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
    _urlSupported(url)
    {
        if(ppixiv.native)
            return true;

        url = new URL(url);
        let pathname = this._getPathWithoutLanguage(url.pathname);

        let parts = pathname.split("/");
        let firstPart = parts[1]; // helpers.getPageTypeFromUrl
        if(firstPart == "artworks")
            return true; // manga, current_illust
        else if(firstPart == "users")
            return true; // follows, artist, bookmarks, bookmarks_merged, bookmarks
        else if(pathname == "/new_illust.php" || pathname == "/new_illust_r18.php")
            return true; // new_illust
        else if(pathname == "/bookmark_new_illust.php" || pathname == "/bookmark_new_illust_r18.php")
            return true; // new_works_by_following
        else if(firstPart == "tags")
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
        else if(firstPart == "" && window.location.hash.startsWith("#ppixiv/edits"))
            return true; // edited_images
        else
            return false;
    }

    // Try to stop the underlying page from doing things (it just creates unnecessary network
    // requests and spams errors to the console), and undo damage to the environment that it
    // might have done before we were able to start.
    _cleanupEnvironment()
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
            window.realClearTimeout = window.clearTimeout.bind(window);
            window.realSetInterval = window.setInterval.bind(window);
            window.realClearInterval = window.clearInterval.bind(window);
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
        function unwrapFunc(obj, name, { ignore_missing=false }={})
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
            unwrapFunc(window, "fetch");
            unwrapFunc(window, "setTimeout");
            unwrapFunc(window, "setInterval");
            unwrapFunc(window, "clearInterval");
            unwrapFunc(window, "requestAnimationFrame");
            unwrapFunc(window, "cancelAnimationFrame");
            unwrapFunc(EventTarget.prototype, "addEventListener");
            unwrapFunc(EventTarget.prototype, "removeEventListener");
            unwrapFunc(XMLHttpRequest.prototype, "send");
        } catch(e) {
            console.error("Error unwrapping environment", e);
        }

        // Delete owned properties on an object.  This removes wrappers around class functions
        // like document.addEventListener, so it goes back to the browser implementation, and
        // freezes the object to prevent them from being added in the future.
        function deleteOverrides(obj)
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
            deleteOverrides(window.history);
            deleteOverrides(window.document);

            // Pixiv wraps console.log, etc., which breaks all logging since it causes them to all
            // appear to come from the wrapper.  Remove these if they're present and try to prevent
            // it from happening later.
            for(let name of Object.keys(window.console))
                unwrapFunc(console, name, { ignore_missing: true });
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

        window.realClearInterval = window.clearInterval.bind(window);
        window.clearInterval = () => { };

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
            if(type == "script")
            {
                // Let es-module-shims create script nodes.
                let stack = (new Error()).stack;
                if(stack.indexOf("es-module-shims") != -1)
                    return origCreateElement.apply(this, arguments);
            }

            // Prevent the underlying site from creating new script and style elements.
            if(type == "script" || type == "style")
            {
                // console.warn("Disabling createElement " + type);
                class ElementDisabled extends Error { };
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
    ppixivIcon = 
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

// This loads a dictionary of modules:
//
// {
//     "module/path": "module source"
// }
//
// The modules can then be imported, and import each other with their given paths.
// This allows us to load modules packaged within our user script, and import then
// mostly normally.
//
// One limitation is that relative paths won't work.  All imports need to use the
// path given when the module is loaded.  This is a limitation of import maps.
//
// See ModuleImporter_Babel for a polyfill for browsers that don't support import maps.
class ModuleImporter
{
    load(scripts) { }
    import = async(modulePath) => { }
};

// Native importing using import maps.
class ModuleImporter_Native extends ModuleImporter
{
    constructor()
    {
        super();

        this._knownModules = new Set();
    }

    load(scripts)
    {
        let imports = { };
        for(let [path, {source}] of Object.entries(scripts))
        {
            let blob = new Blob([source], { type: "application/javascript" });
            let blobURL = URL.createObjectURL(blob);
            imports[path] = blobURL;
            this._knownModules.add(path);
        }

        // Generate an import map for our scripts.
        let importMap = document.realCreateElement("script");
        importMap.type = "importmap";
        importMap.textContent = JSON.stringify({ imports }, null, 4);
        document.head.appendChild(importMap);
    }

    import = async(modulePath) =>
    {
        // This code path uses the browser's built-in import maps, but we still expect to see
        // all imports during loading.
        if(!this._knownModules.has(modulePath))
            throw new TypeError("Dynamic module doesn't exist: " + modulePath);

        return import(modulePath);
    }
}

// Polyfill module importing using es-module-shims.
class ModuleImporter_ESModuleShims extends ModuleImporter
{
    constructor()
    {
        super();

        this._knownModules = new Set();
    }

    async load(scripts)
    {
        await ModuleImporter_ESModuleShims._fetch();

        let imports = { };
        for(let [path, {source}] of Object.entries(scripts))
        {
            let blob = new Blob([source], { type: "application/javascript" });
            let blobURL = URL.createObjectURL(blob);
            imports[path] = blobURL;
            this._knownModules.add(path);
        }

        importShim.addImportMap({ imports });
    }

    import = async(modulePath) =>
    {
        if(!this._knownModules.has(modulePath))
            throw new TypeError("Dynamic module doesn't exist: " + modulePath);

        return importShim(modulePath);
    }

    // Fetch es-module-shims.
    static _fetch()
    {
        window.esmsInitOptions = {
            shimMode: true,
            polyfillEnable: false,
            fetch: realFetch,
        };

        // Stop if already loaded.
        if(window.importShim)
            return;

        // If we're already loading it, return the running fetch.
        if(this._loadPromise)
            return this._loadPromise;

        console.log("Loading es-module-shims...");
        return this._loadPromise = new Promise((accept, reject) => {
            let script = document.realCreateElement("script");
            script.src = "https://ga.jspm.io/npm:es-module-shims@1.6.2/dist/es-module-shims.js",
            script.crossOrigin = true;
            script.integrity = "sha256-qMzFFbCAdUdIDwpL8SROqDq2B2+x40ejMIe2czNPwD0=";
            document.head.appendChild(script);

            script.onload = () => {
                accept();
            };
            script.onerror = (e) => {
                reject(e);
            };
        });
    }    
}

// Polyfill module importing using a custom Babel parser.
//
// This implements importing of blobs as modules directly using a custom Babel parser.
// This only exists because we can't use es-module-shims everywhere.  It has a few
// drawbacks:
//
// - Babel is big: 3-5 MB.  Because of this, we only fetch it if we're going to use it
// and don't package it with the script.
// - Babel is slow.  It's meant for build-time parsing more than client-side parsing like
// this.  It can take a couple seconds to parse everything.
//
// This implementation isn't complete and doesn't currently handle import cycles, but we
// don't have any.
class ModuleImporter_Babel extends ModuleImporter
{
    constructor()
    {
        super();

        this._info = new Map();
    }

    static async loadBabel()
    {
        if(this.Babel)
            return this.Babel;

        let Babel = await this._fetch();
        Babel.disableScriptTags();
        return Babel;
    }

    // Fetch Babel if it wasn't packaged.
    static _fetch()
    {
        // Stop if Babel is already loaded.
        if(window.Babel)
            return window.Babel;

        // If we're already loading it, return the running fetch.
        if(this._loadPromise)
            return this._loadPromise;

        console.log("Loading Babel...");
        return this._loadPromise = new Promise((accept, reject) => {
            let babel = document.realCreateElement("script");
            babel.src = "https://unpkg.com/@babel/standalone@7.20.6/babel.js";
            babel.crossOrigin = true;
            
            // The entire rest of the world uses base64 to encode SHA hashes.
            babel.integrity = "sha256-zPE9CoD1Tjcxc1WB5hd9X2p/h4seD2gnUg0IOmOrO/c=";
            document.head.appendChild(babel);
            babel.onload = () => {
                console.log("Loaded Babel");

                // Take the interface out of globals and return it.
                let Babel = window.Babel;
                delete window.Babel;
                accept(Babel);
            };
            babel.onerror = (e) => {
                reject(e);
            };
        });
    }

    // Load a set of scripts.  Return a mapping from script names to blob URLs.
    async load(scripts)
    {
        let Babel = await ModuleImporter_Babel.loadBabel();
        Babel.registerPlugin("find-exports", ModuleImporter_Babel.findExportsPlugin);
        Babel.registerPlugin("remap-imports", ModuleImporter_Babel.remapImportsPlugin);

        // This accumulates mappings from paths to blob URLs, and is global because it's
        // used by stubs.
        window._importMappings ??= { };

        // Pass 1: find exports
        for(let [path, { source }] of Object.entries(scripts))
        {
            let scriptInfo = {
                imports: [],
                exports: [],
            };

            Babel.transform(source, {
                filename: path,
                plugins: [['find-exports', {
                    info: this._info,
                    scriptPath: path,
                    scriptInfo,
                }]],

                // We don't need code output from this pass.
                code: false,
            });

            this._info.set(path, scriptInfo);
        }

        // Check that all imports exist.
        for(let [path, info] of this._info.entries())
        {
            for(let importPath of info.imports)
            {
                let info = this._info.get(importPath);
                if(info == null)
                    throw new Error(`${path} import ${importPath} doesn't exist`);
            }
        }

        // Check for recursive imports.  This is possible to import with some shenanigans, but
        // it's a pain and I don't need it just yet.
        let checkForRecursion = (path, stack) =>
        {
            let alreadyOnStack = stack.indexOf(path) != -1;
            stack.push(path);

            try {
                if(alreadyOnStack)
                    throw new Error("Import recursion detected: " + stack.join(" -> "));
        
                let info = this._info.get(path);
                console.assert(info);
                for(let importPath of info.imports)
                    checkForRecursion(importPath, stack);
            } finally {
                stack.pop();
            }
        }

        for(let path of this._info.keys())
            checkForRecursion(path, []);
        
        // Create a shim loader for each file.
        for(let path of Object.keys(scripts))
            this._generateImportWrapper(path);

        // Pass 2: remap imports
        //
        // This could reuse the AST from the first pass, but it's not worth it.  It doesn't make much
        // of a difference, and it breaks the source map output.
        for(let [path, {source}] of Object.entries(scripts))
        {
            let scriptInfo = this._info.get(path);

            let result = Babel.transform(source, {
                filename: path,
                plugins: [['remap-imports', {
                    info: this._info,
                    scriptPath: path,
                    scriptInfo,
                    allScriptInfo: this._info,
                }]],
                sourceType: "module",
                generatorOpts: {
                    sourceFileName: path,
                    sourceMaps: "inline",

                    // Make sure Babel doesn't try to fetch remote source maps.
                    inputSourceMap: false,

                    parserOpts: { foo: 1 },
                }
            });

            let { code, map } = result;

            // Why isn't Babel filling this in?
            map.file = path;

            // object -> JSON -> UTF-8 -> base64
            //
            // How is there still no usable base64 API?
            map = JSON.stringify(map, null, 4);

            let encodedSourceMap = ModuleImporter_Babel.encodeBase64(map);
            let sourceMap = `//# sourceMappingURL=data:application/json;base64,${encodedSourceMap}`
            code += "\n";
            code += sourceMap;

            let blob = new Blob([code], { type: "application/javascript" });
            scriptInfo.blobURL = URL.createObjectURL(blob);
            // console.log("Real URL:", path, scriptInfo.blobURL);

            // Store this blob URL so it can be imported by stubs.
            window._importMappings[path] = scriptInfo.blobURL;
        }
    }

    // Dynamically import a loaded module.
    import = async(modulePath) =>
    {
        let module_info = this._info.get(modulePath);
        if(module_info == null)
            throw new TypeError("Dynamic module doesn't exist: " + modulePath);

        return await import(module_info.importWrapperURL);
    }

    // This finds the exports in each script.
    static findExportsPlugin = ({ types }) =>
    {
        return {
            visitor: {
                ExportDeclaration: (path, { opts }) =>
                {
                    // XXX: these are all probably the wrong way to get these
                    let { scriptInfo } = opts;

                    // export function foo()
                    if(path.node.declaration?.id)
                    {
                        // console.log(`${scriptPath} exports declaration:`, path.node.declaration.id.name);
                        scriptInfo.exports.push(path.node.declaration.id.name);
                    }

                    // export { foo, bar }
                    let specs = path.node.specifiers;
                    if(specs != null)
                    {
                        for(let spec of specs)
                        {
                            // console.log(`${scriptPath} exports:`, spec.exported.name);
                            scriptInfo.exports.push(spec.exported.name);
                        }
                    }
                },

                // Remember if this module has a default export.
                ExportDefaultDeclaration: (path, { opts }) => {
                    let { scriptPath, scriptInfo } = opts;
                    // console.log(`${scriptPath} exports default`);
                    scriptInfo.exportsDefault = true;
                },

                ImportDeclaration: (path, { opts }) =>
                {
                    const source = path.get('source');
                    if(source.node === null)
                        return;

                    let { scriptPath, scriptInfo } = opts;
                    let importPath = source.node.value;
                    scriptInfo.imports.push(importPath);
                },

            }
        }
    }

    // Remap imports in each script to blob URLs.
    static remapImportsPlugin = ({ types }) =>
    {
        return {
            visitor: {
                ImportDeclaration: (path, { opts }) =>
                {
                    let { allScriptInfo } = opts;
                    const source = path.get('source');
                    if(source.node === null)
                        return;

                    // If we've already processed imports for this file and have a blob URL for it, just
                    // use it.
                    let importPath = source.node.value;
                    let importInfo = allScriptInfo.get(importPath);

                    if(importInfo == null)
                    {
                        let { start } = path.node.loc;
                        throw new Error(`${start.line}: import "${importPath}" doesn't exist`);
                    }

                    console.assert(importInfo.importWrapperURL);
                    source.replaceWith(types.stringLiteral(importInfo.importWrapperURL));
                },
            }
        };
    }

    _generateImportWrapper(importPath)
    {
        let importInfo = this._info.get(importPath);
        let { exports, exportsDefault } = importInfo;

        // Import the module this is a stub for.
        let importStub = ``;

        importStub += "try {\n";

        importStub += `
// Stub for ${importPath}
let url = window._importMappings[${JSON.stringify(importPath)}];
// console.log("Importing (for ${importPath}):", url);
var module = await import(url);
// console.log("Imported ${importPath}");
        `;
        importStub += '} catch(e) { console.log("buh", e); }';

        // Re-export its named exports:
        if(exports.length > 0)
        {
            importStub += `
let { ${exports.join(", ")} } = module;
export { ${exports.join(", ")} };
            `;
        }

        // Re-export its default export:
        if(exportsDefault)
        {
            importStub += `
let _default = module.default;
export default _default;
`;
        }

        // Add a dummy source URL, so these make sense in the inspector.
        importStub += `//# sourceURL=${window.origin}/shims/${importPath}`;

        let stubBlob = new Blob([importStub], { type: "application/javascript" });
        let importWrapperURL = URL.createObjectURL(stubBlob);
        // console.log("Import wrapper URL:", importPath, importWrapperURL);
        importInfo.importWrapperURL = importWrapperURL;
    }

    static base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

    // 2022 and we still don't have a usable base64 API
    static encodeBase64(utf8)
    {
        let base64Chars = this.base64Chars;
        let encoder = new TextEncoder();
        let bytes = encoder.encode(utf8);

        let result = "";
        let i = 0;
        while(i < bytes.length)
        {
            let chr1 = bytes[i++];
            let chr2 = bytes[i++];
            let chr3 = bytes[i++];

            let enc1 = chr1 >> 2;
            let enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
            let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
            let enc4 = chr3 & 63;

            result += base64Chars[enc1] + base64Chars[enc2] + base64Chars[enc3] + base64Chars[enc4];
        }

        if((bytes.length % 3) == 2)
        {
            result = result.slice(0, result.length-1);
            result += '=';
        }
        else if((bytes.length % 3) == 1)
        {
            result = result.slice(0, result.length-2);
            result += '==';
        }
        return result;
    }
}

// Start up.
//new AppStartup();
