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
    //
    // If we're in a debug build, this script runs standalone, and we set up the environment
    // here.
    console.log("ppixiv bootstrap");
    
    // When we're loading in development mode, we get our source files as text instead
    // of functions.  _make_load_source_file converts the source file into a function
    // that's like the one we'd get in a release build.  Note that any locals we declare
    // here will be visible to code, since this is executed in our scope.
    //
    // We can't do this inside the class, because we need with to do this.
    let _make_load_source_file = function(__pixiv, __source) {
        const ppixiv = __pixiv;
        with(ppixiv)
        {
            return eval(__source);
        }
    };

    new class
    {
        constructor(env)
        {
            // If env is the window, this script was run directly, which means this is a
            // development build and we need to do some extra setup.  If this is a release build,
            // the environment will be set up already.
            if(env === window)
                this.devel_setup();
            else
                this.env = env;

            this.launch();
        }

        devel_setup()
        {
            // In a development build, our source and binary assets are in @resources, and we need
            // to pull them out into an environment manually.
            let env = {};
            env.resources = {};
        
            env.resources["output/setup.js"] = JSON.parse(GM_getResourceText("output/setup.js"));
            let setup = env.resources["output/setup.js"];
            let source_list = setup.source_files;

            // Add the file containing binary resources to the list.
            source_list.unshift("output/resources.js");

            for(let path of source_list)
            {
                // Load the source file.
                let source = GM_getResourceText(path);
                if(source == null)
                {
                    // launch() will show an error for this, so don't do it here too.
                    continue;
                }

                // Add sourceURL to each file, so they show meaningful filenames in logs.
                // Since we're loading the files as-is and line numbers don't change, we
                // don't need a source map.
                source += "\n";
                source += "//# sourceURL=" + setup.source_root + path + "\n";

                env.resources[path] = _make_load_source_file.bind(null, env, source);
            }

            this.env = env;
        }

        launch()
        {
            let setup = this.env.resources["output/setup.js"];
            let source_list = setup.source_files;
            unsafeWindow.ppixiv = this.env;

            // Each resources["src.js"] is a function to call when we're ready for that
            // script to load.  Set "this" to the environment.
            for(let path of source_list)
            {
                let func = this.env.resources[path];
                if(!func)
                {
                    console.error("Source file missing:", path);
                    continue;
                }

                func.call(this.env);
            }
        }
    }(this);
})();

