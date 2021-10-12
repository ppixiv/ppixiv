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
    
    // Our source files are stored as text, so we can attach sourceURL to them to give them
    // useful filenames.  "this" is set to the ppixiv context, and we load them out here so
    // we don't have many locals being exposed as globals during the eval.  We also need to
    // do this out here in order ot use with.
    let _load_source_file = function(__pixiv, __source) {
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

                env.resources[path] = source;
            }

            this.env = env;
        }

        launch()
        {
            let setup = this.env.resources["output/setup.js"];
            let source_list = setup.source_files;
            unsafeWindow.ppixiv = this.env;

            // Load each source file.
            for(let path of source_list)
            {
                let source = this.env.resources[path];
                if(!source)
                {
                    console.error("Source file missing:", path);
                    continue;
                }

                _load_source_file(this.env, source);
            }
        }
    }(this);
})();

