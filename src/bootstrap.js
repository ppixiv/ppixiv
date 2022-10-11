(() => {
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
        console.log("ppixiv is running in", GM_info?.scriptHandler, GM_info?.version);
    } catch(e) {
    }

    // Make sure that we're not loaded more than once.  This can happen if we're installed in
    // multiple script managers, or if the release and debug versions are enabled simultaneously.
    if(document.documentElement.dataset.ppixivLoaded)
    {
        console.error("ppixiv has been loaded twice.  Is it loaded in multiple script managers?");
        return;
    }

    document.documentElement.dataset.ppixivLoaded = "1";

    console.log(`ppixiv r${env.version} bootstrap`);

    let init = env.resources["init.js"];

    // "env" here is the environment dictionary which was defined earlier in the script.
    // See build_ppixiv.py.  Fill in a few runtime fields.
    env.native = false;
    env.ios = navigator.platform.indexOf('iPhone') != -1 || navigator.platform.indexOf('iPad') != -1;
    env.android = navigator.userAgent.indexOf('Android') != -1;
    env.mobile = env.ios || env.android;

    function run_script(source)
    {
        let script = document.createElement("script");
        script.textContent = source;
        document.documentElement.appendChild(script);
        script.remove();
    }

    // The environment becomes window.ppixiv.
    run_script(`window.ppixiv = ${JSON.stringify(env)}`);

    // Load each source file.
    for(let path of init.source_files)
    {
        let source = env.resources[path];
        if(!source)
        {
            console.error("Source file missing:", path);
            continue;
        }

        run_script(`with(ppixiv) { ${source} }`);
    }

    // Create the main controller.
    run_script(`ppixiv.main_controller = new ppixiv.MainController();`);
})();

