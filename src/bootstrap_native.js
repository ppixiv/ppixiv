// NativeLoader handles loading our source files and resources from the local server,
// and returns them in the same format that we package them in the user script for bootstrap.js.
// This is loaded before bootstrap.js when we're loading in these environments, and not
// included in release ppixiv builds.
//
// Note that this is loaded with eval if we're in the debug user script, so we need to set
// this on window directly.
window.NativeLoader = class
{
    static load(native, mobile)
    {
        let loader = new this(native, mobile);
        return loader.load_resources();
    }

    constructor(native, mobile)
    {
        this.native = native;
        this.mobile = mobile;

        // Figure out our native server URL.
        //
        // If window.vviewURL is set, use it.  Otherwise, if we're running natively then the
        // server is the current URL.  Otherwise, fall back on localhost, which is used for
        // development when running on Pixiv.
        this.root_url = window.vviewURL;
        this.root_url ??= native? window.location:"http://127.0.0.1:8235";
    }

    async load_resources()
    {
        // init.js gives us the list of source and resource files to load.
        let result = await this.get(new URL("/client/init.js", this.root_url));
        let init = JSON.parse(result);
        
        // Fetch each source file.  Do this in parallel.
        let source_fetches = {};
        for(let path of init.source_files)
            source_fetches[path] = this.fetch_source(path);

        for(let path of Object.values(init.modules))
            source_fetches[path] = this.fetch_source(path, { add_source_url: false });

        for(let [path, url] of Object.entries(init.resources))
            source_fetches[path] = this.load_resource(path, url);

        // Wait for all fetches to complete.
        let results = await Promise.all(Object.values(source_fetches));
        let keys = Object.keys(source_fetches);
        let resources = {};
        for(let idx = 0; idx < keys.length; ++idx)
        {
            let key = keys[idx];
            resources[key] = results[idx];
        }
        
        return {
            resources,
            init,
            version: 'native',
        };
    }

    async load_resource(path, url)
    {
        url = new URL(url, this.root_url);

        // Just load binary resources as URLs.  This lets them be cached normally.
        //
        // If we're not native (we're running on Pixiv), don't do this for PNGs, since Chrome
        // spams the console with mixed content warnings that weren't thought out very well.
        // (Why is it warning about insecure connections to localhost?)
        let filename = (new URL(path, this.root_url)).pathname;
        let binary = filename.endsWith(".png") || filename.endsWith(".woff");
        if(this.native && binary)
            return url;

        // Other resources are loaded as text resources.  This is needed for SVG because we
        // sometimes need to preprocess them, so we can't just point at their URL.
        // let source_fetch = await fetch(url);
        let data = await this.get(url, { as_url: binary });
        if(data == null)
            return null;

        if(binary)
        {
            // Load any binary resources into object URLs.
            return data;
        }

        // Add sourceURL to source files.  Remove the mtime query so it doesn't clutter logs.
        let source_url = new URL(url);
        source_url.search = "";

        if(url.pathname.endsWith(".js"))
        {
            data += "\n";
            data += `//# sourceURL=${source_url}\n`; // split so browsers don't interpret this line as a sourceURL
        }

        return data;
    }

    async fetch_source(path)
    {
        // Load the source file.
        let url = new URL(path, this.root_url);
        let data = await this.get(url);
        if(data == null)
            return;

        // Add sourceURL to source files.  Remove the mtime query so it doesn't clutter logs.
        let source_url = new URL(url);
        source_url.search = "";
        data += "\n";
        data += `//` + `# sourceURL=${source_url}\n`; // split so browsers don't interpret this line as a sourceURL
        return data;
    }

    // When we load into Pixiv with the regular loader (bootstrap.js), we're always loading
    // synchronously, since everything is packaged into the user script.  Here we're loading
    // for development and downloading the source files from the local server.  To make this
    // behave the same as the regular script, we need to load the files synchronously.  Otherwise,
    // the site will have a chance to start running, and it'll start setting up event handlers
    // and other things that we won't be able to remove.
    //
    // Browser developers assume that if they can't think of a use case for something, it doesn't
    // exist, and that they should life make difficult for anyone who needs to do something they
    // didn't think of.  As a result, they've intentionally made sync XHR hard to use: it won't
    // let us set responseType: blob for loading binary resources.  We work around this by requesting
    // a data URL from the local server instead.  It'll be loaded into a blob later in the same way
    // it is with the packaged script.
    //
    // We don't need to be sync if we're running natively, since we're not racing against a website
    // loading, so we switch back to normal async fetch if possible.  It avoids browsers screaming
    // bloody murder about sync XHR, and it loads a bit faster.
    //
    // We also don't do this if we're running on iOS.  It's very slow, and since the mobile site doesn't
    // do all the weird stuff the desktop site does, it's not as important.
    async get(url, { as_url=false }={})
    {
        if(this.native || this.mobile)
        {
            let result = await fetch(new URL(url, this.root_url));
            if(as_url)
            {
                let blob = await result.blob();
                return URL.createObjectURL(blob);
            }
            else
                return await result.text();
        }
        else
        {
            // If the caller wants a data URL, add data=1 to the URL.
            if(as_url)
            {
                let query = new URLSearchParams(url.search);
                query.set("data", "1");
                url = new URL(url);
                url.search = query.toString();
            }    
    
            let xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.send();
            
            return xhr.response;
        }
    }
}
