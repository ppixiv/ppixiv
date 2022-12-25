// Early setup.  If we're running in a user script, this is the entry point for regular
// app code that isn't running in the script sandbox, where we interact with the page
// normally and don't need to worry about things like unsafeWindow.
// 
// If we're running on Pixiv, this checks if we want to be active, and handles adding the
// the "start ppixiv" button.  If the app is running, it starts it.  This also handles
// shutting down Pixiv's scripts before we get started.
//
// For vview, this is the main entry point.
class AppStartup
{
    constructor({env, rootUrl})
    {
        this.initialSetup({env, rootUrl});
    }

    // We can either be given a startup environment, or a server URL where we can fetch one.
    // If we're running in a user script then the environment is packaged into the script, and
    // if we're running on vview or a user script development environment we'll have a URL.
    // We'll always be given one or the other.  This lets us skip the extra stuff in bootstrap.js
    // when we're running natively, and just start directly.
    async initialSetup({env, rootUrl})
    {
        let native = location.hostname != "pixiv.net" && location.hostname != "www.pixiv.net";
        let ios = navigator.platform.indexOf('iPhone') != -1 || navigator.platform.indexOf('iPad') != -1;
        let android = navigator.userAgent.indexOf('Android') != -1;
        let mobile = ios || android;

        // If we weren't given an environment, fetch it from rootUrl.
        if(env == null)
        {
            if(rootUrl == null)
            {
                alert("Unexpected error: no environment or root URL");
                return;
            }

            // init.js gives us the list of source and resource files to load.  If we're running
            // natively, just fetch it normally.  If we're running as a user script (this is used
            // for debugging), use a sync XHR to try to mimic the regular environment as closely
            // as possible.  This avoids going async and letting page scripts run.
            let url = new URL("/vview/init.js", rootUrl);
            let request = await fetch(url);
            env = await request.json();
        }

        // Set up the global object.
        window.ppixiv = {
            resources: env.resources,
            version: env.version,
            native, mobile, ios, android,
        };
    
        console.log(`${native? "vview":"ppixiv"} setup`);
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

        let { modules } = env;
        await this.loadAndLaunchApp({modules});
    }
    
    async loadAndLaunchApp({modules})
    {
        /*
        let useShim = false;
        if(!HTMLScriptElement.supports || !HTMLScriptElement.supports("importmap"))
            useShim = true;

        let ModuleImporterClass = useShim? ModuleImporter_Compat:ModuleImporter_Native;
*/
        // For now we don't use the native importer, since it doesn't make much difference and
        // using the compat loader during development makes the environment more consistent,
        // so problems are caught more quickly.
        let ModuleImporterClass = ModuleImporter_Compat;

        // Load our modules.
        let importer = new ModuleImporterClass();
        if(!await importer.load(modules))
            return;

        // Run the app.
        console.log("Launching app");
        let { default: App } = await importer.import("vview/app.js");
        new App();
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
                    <img src=${ppixiv.resources['resources/activate-icon.png']}>
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

    // helpers.pixiv.getPathWithoutLanguage:
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
        let firstPart = parts[1]; // helpers.pixiv.getPageTypeFromUrl
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
            // Prevent the underlying site from creating these elements.
            if(type == "script" || type == "style" || type == "iframe")
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
        for(let [path, url] of Object.entries(scripts))
        {
            imports[path] = url;
            this._knownModules.add(path);
        }

        // Generate an import map for our scripts.
        let importMap = document.realCreateElement("script");
        importMap.type = "importmap";
        importMap.textContent = JSON.stringify({ imports }, null, 4);
        document.head.appendChild(importMap);

        // Preload the modules.  We don't need to leave these nodes in the document.
        for(let url of Object.values(scripts))
        {
            let link = document.createElement("link");
            link.rel = "modulepreload";
            link.href = url;
            document.head.appendChild(link);
            link.remove();
        }

        return true;
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

// A lightweight, very limited compatibility layer for importing modules in browsers that don't
// support import maps.
//
// - Circular imports aren't supported.  Supporting this is complex and we don't use them.
// - Syntax parsing is a trivial regex, so import statements must be on a single line at the
//   top of the file.  The parsing is simplistic and stops when it reaches a line that isn't
//   an import, blank or a line comment to stop it from matching things later in the file,
//   like import statements inside strings.
class ModuleImporter_Compat extends ModuleImporter
{
    async load(scripts)
    {
        this.blobs = {};

        // Fetch the scripts.
        let sources = { };
        for(let [path, url] of Object.entries(scripts))
            sources[path] = realFetch(url);
        await Promise.all(Object.values(sources));

        for(let [path, source] of Object.entries(sources))
        {
            let response = await source;
            sources[path] = await response.text();
        }
        
        // Create each script.
        for(let path of Object.keys(sources))
        {
            let success = await this._createScript(path, { sources, scriptUrls: scripts, stack: [] });
            if(!success)
                return false;
        }
        return true;
    }
    
    // Create the script with the given path, recursively creating its dependencies if they haven't
    // been created yet.
    async _createScript(path, { sources, scriptUrls, stack })
    {
        // Stop if we've already created this script.
        if(this.blobs[path] != null)
            return true;

        // Find this script's dependencies.
        let source = sources[path];
        let moduleDeps = this._getDependencies(source);

        // Recursively create this script's dependencies.
        try {
            stack.push(path);
            
            // path shouldn't already have been on the stack.  This check is done here so
            // we can see the repeated path just by looking at stack.
            if(stack.indexOf(path) != stack.length-1)
            {
                console.error("Import recursion:", stack);
                throw new Error("Internal error: recursion detected");
            }

            for(let depPath of moduleDeps)
            {
                if(sources[depPath] == null)
                {
                    console.error(`${path} imports nonexistant module: ${depPath}`);
                    return false;
                }

                let success = await this._createScript(depPath, { sources, scriptUrls, stack });
                if(!success)
                    return false;
            }
        } finally {
            if(stack[stack.length-1] != path)
                throw new Error("Internal error: stack mismatch");
            stack.pop(path);
        }

        // Replace this script's imports with the blob URLs we created.
        let lines = source.split('\n');
        for(let lineNo = 0; lineNo < lines.length; ++lineNo)
        {
            let line = lines[lineNo];
            line = line.trim();
            let re = /^(import.* from) ?['"](.+)['"];?$/;
            let match = line.match(re);
            if(match == null)
            {
                // Stop if this isn't a blank or a single-line comment.
                if(!line.match(/^\/\//) && line != '')
                    break;

                continue;
            }

            let importStatement = match[1];    // import name from
            let importPath = match[2];         // file/path.js

            let importBlobUrl = this.blobs[importPath];
            if(importBlobUrl == null)
            {
                console.log(path, "deps:", moduleDeps);
                throw new Error(`Internal error: ${path} missing ${importPath}`);
            }

            lines[lineNo] = `${importStatement} "${importBlobUrl}" /* ${importPath} */;`;
        }
        source = lines.join("\n");

        // We can either leave the file alone, add a source map, or add a source URL.
        //
        // The source files already have a sourceURL, so they display a useful filename in devtools.
        // This is either encoded into the user script, or added by the local server.  It's done this
        // way so the source URLs exist regardless of how the scripts are loaded.
        //
        // However, iOS Safari has a really ugly bug: it doesn't use sourceURL for scripts loaded
        // from blob URLs, so this doesn't work.  It's critical that we have meaningful filenames
        // in logs, so we jump hoops to work around this by adding a source map, which does work.
        // This isn't too hard to do, since it's a 1:1 mapping to source and there's only one source
        // file per file.
        if(ppixiv.ios)
        {
            // Remove the cache timestamp from the URL's query.
            let sourceUrl = new URL(scriptUrls[path]);
            sourceUrl.search = "";
    
            // Encode the source map.
            let map = this._createOneToOneSourceMap(sourceUrl, source);
            map = JSON.stringify(map, null, 4);

            // Load the source map with a blob URL, so it doesn't clutter the devtools source view.
            // This doesn't work in Chrome for some reason (only data: URLs do), but we only need
            // this for iOS.  The data URL code path is left here in case it's useful.
            if(!ppixiv.ios)
            {
                let encodedSourceMap = ModuleImporter_Compat.encodeBase64(map);
                source += `\n//# sourceMappingURL=data:application/json;base64,${encodedSourceMap}`;
            }
            else
            {
                let sourceMapBlob = new Blob([map], { type: "application/json" });
                let sourceMapUrl = URL.createObjectURL(sourceMapBlob);
                source += `\n//# sourceMappingURL=${sourceMapUrl}\n`;
            }
        }

        // Load this script into a blob.
        let blob = new Blob([source], { type: "application/javascript" });
        let url = URL.createObjectURL(blob);
        this.blobs[path] = url;

        // Create the script.
        let script = document.realCreateElement("script");
        script.type = "module";
        script.src = url;
        script.dataset.modulePath = path;
        document.head.append(script);

        // We can't get errors from the script node directly.  Import the script so we receive
        // any errors that the module raised.  These errors will usually be logged to the console
        // twice, but this keeps us from continuing on and triggering them over and over.
        //
        // Top-level errors when importing modules sometimes cause errors to not use the source
        // map, so log any error with the module path to make these easier to debug.  Don't raise
        // errors, just return false on failure.
        try {
            await this.import(path);
        } catch(e) {
            console.error(`Error importing ${path}:`, e);
            return false;
        }

        return true;
    }

    // Create a source map that maps each line of source to the same line of path.
    _createOneToOneSourceMap(path, source)
    {
        // Each segment of a source map encodes [column,source idx,line idx,source column idx],
        // where each value is relative to the previous segment if there is one.  We're just
        // encoding [0,0,0,0] for the first line and [0,0,1,0] for each line after it.  We
        // don't need to do actual VLC encoding since there are only two things we encode.
        // 'AAAA' encodes [0,0,0,0] and 'AACA' encodes [0,0,1,0].
        let firstLine = 'AAAA', nextLine = 'AACA';
        let lineMappings = [];
        let lines = source.split("\n");
        for(let lineIdx = 0; lineIdx < lines.length; ++lineIdx)
            lineMappings.push(lineIdx == 0? firstLine:nextLine);

        return {
            version: 3,
            file: path.toString(),
            sources: [path],
            sourcesContent: [source],
            names: [],
            mappings: lineMappings.join(';'),
        };
    }

    // Return the paths imported by the given module source.
    _getDependencies(source)
    {
        let deps = [];

        let lines = source.split('\n');
        for(let lineNo = 0; lineNo < lines.length; ++lineNo)
        {
            let line = lines[lineNo];
            line = line.trim();
            let re = /^import.* from ['"](.+)['"];?$/;
            let match = line.match(re);
            if(match == null)
            {
                // Stop if this isn't a blank or a single-line comment.
                if(!line.match(/^\/\//) && line != '')
                    break;

                continue;
            }

            let importPath = match[1];
            deps.push(importPath);
        }

        return deps;
    }

    import = (modulePath) =>
    {
        let url = this.blobs[modulePath];
        if(url == null)
            throw Error(`Unknown module path: ${modulePath}`);

        return import(url);
    }
    static base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

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
