"use strict";

// Bootstrap in debug mode.  This loads each script separately as a @resource
// directly from the local filesystem.  This lets us read the scripts directly
// so we can edit and refresh and not need to build anything most of the time.
(function() {
    console.log("ppixiv bootstrap");
    
    // Some really grotesque libraries that Pixiv uses intercept console.log, which
    // is completely broken: it results in every log written to the console coming
    // from "vendors~pixiv~spa", so you can't tell where any logs come from.  This
    // doesn't affect unsafeWindow.

    // This contains the initial info we need to load.
    let environment = JSON.parse(GM_getResourceText("build/environment.js"));
    let source_list = environment.source_files;

    // Load each source file.
    for(let path of source_list)
    {
        let source = GM_getResourceText(path);
        if(source == null)
        {
            console.log("Source file missing:", path);
            return;
        }

        // Add sourceURL to each file, so they show meaningful filenames in logs.
        // Since we're loading the files as-is and line numbers don't change, we
        // don't need a source map.
        source += "\n";
        source += "//# sourceURL=" + environment.source_root + path + "\n";

        // Run the source file with "this" set to unsafeWindow, so it runs the same way
        // as a regular user script.
        function load_source_file() { eval(source); }
        load_source_file.call(unsafeWindow);
    }
})();

