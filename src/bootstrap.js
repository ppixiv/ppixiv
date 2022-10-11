// Note that this file doesn't use strict, because JS language developers remove
// useful features without a second thought.  "with" may not be used often, but
// it's an important part of the language.

(() => {
    // If we're in a release build, we're inside
    // (function () {
    //     with(this)
    //     {
    //         ...
    //     }
    // }.exec({});
    //
    // The empty {} object is our environment.  It can be assigned to as "this" at the
    // top level of scripts, and it's included in scope using with(this) so it's searched
    // as a global scope.
    
    // Our source files are stored as text, so we can attach sourceURL to them to give them
    // useful filenames.  "this" is set to the ppixiv context, and we load them out here so
    // we don't have many locals being exposed as globals during the eval.  We also need to
    // do this out here in order ot use with.
    let _load_source_file = function(__pixiv, __source) {
        let script = document.createElement("script");
        script.id = path;
        script.textContent = __source;
        window.document.head.appendChild(script);
    };

    new class
    {
        constructor()
        {
            // If this is an iframe, don't do anything.
            if(window.top != window.self)
                return;

            // Don't activate for things like sketch.pixiv.net.
            if(window.location.hostname != "www.pixiv.net")
                return;

            // GM_info isn't a property on window in all script managers, so we can't check it
            // safely with window.GM_info?.scriptHandler.  Instead, try to check it and catch
            // the exception if GM_info isn't there for some reason.
            try {
                if(GM_info?.scriptHandler == "Greasemonkey")
                {
                    console.info("ppixiv doesn't work with GreaseMonkey.  GreaseMonkey hasn't been updated in a long time, try TamperMonkey instead.");
                    return;
                }

                console.log("ppixiv is running in", GM_info?.scriptHandler, GM_info?.version);
            } catch(e) {
                console.error(e);
            }
    
            // Set global to unsafeWindow if we're sandboxed, otherwise window.
            let global = window;
            try {
                global = unsafeWindow;
            } catch(e) {
            }

            let env = global;

            // Make sure that we're not loaded more than once.  This can happen if we're installed in
            // multiple script managers, or if the release and debug versions are enabled simultaneously.
            if(global.loaded_ppixiv)
            {
                console.error("ppixiv has been loaded twice.  Is it loaded in multiple script managers?");
                return;
            }

            global.loaded_ppixiv = true;

            console.log(`ppixiv r${env.version} bootstrap`);

            let setup = env.resources["setup.js"];
            let source_list = setup.source_files;

            global.ppixiv = env;
            env.native = false;
            env.ios = navigator.platform.indexOf('iPhone') != -1 || navigator.platform.indexOf('iPad') != -1;
            env.android = navigator.userAgent.indexOf('Android') != -1;
            env.mobile = env.ios || env.android;

            // Load each source file.
            for(let path of source_list)
            {
                let source = env.resources[path];
                if(!source)
                {
                    console.error("Source file missing:", path);
                    continue;
                }

                _load_source_file(env, path, source);
            }

            // Load the stylesheet into a URL.  This is just so we behave the same
            // as bootstrap_native.
            for(let [name, data] of Object.entries(env.resources))
            {
                if(!name.endsWith(".scss"))
                    continue;

                let blob = new Blob([data]);
                let blobURL = URL.createObjectURL(blob);
                env.resources[name] = blobURL;
            }
    
            // Create the main controller.
            env.main_controller = new ppixiv.MainController();
        }
    }(this);
})();

