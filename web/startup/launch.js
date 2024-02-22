// This is an alternative userscript loader.  It's intended to be used with iOS userscript managers,
// and can be ignored most of the time.  This normally lives at https://ppixiv.org/launch.js.
//
// The user script is normally loaded with a @require directive.  However, current iOS script managers
// have broken caching and auto-updating, so that doesn't work well.  This is an alternative loader
// that loads and runs the @require manually.

// Cache the main script URL.
function getCodeURL() { return localStorage._ppixiv_last_seen_source_url; }
function setCodeURL(url) { localStorage._ppixiv_last_seen_source_url = url; }

// This is the entry point called by the userscript stub that's loading us.  Return the code, which
// the caller should eval().  We don't execute it here since we want the code to be run in the context
// of the userscript and not in this module.  This gives it access to things like GM_info, and makes
// sure it isn't polluted with our context.
export async function launch({ devel=false }={})
{
    // For production builds, if we already have a known version, try to load it from cache first.
    // If we have a code URL but it isn't cached, don't fetch it into cache here, since we might as
    // well check for the most recent version if we're going to have to download it anyway.
    let knownSourceUrl = getCodeURL();
    if(!devel && knownSourceUrl)
    {
        // console.info(`Trying to fetch ppixiv from: ${knownSourceUrl}`);
        let code = await fetchFromCache(knownSourceUrl, { load: false });
        if(code != null)
        {
            // Fetch the latest version, so it'll be available the next time the page is loaded.
            // Don't await here.
            fetchLatestVersion({ devel });

            return code;
        }
    }

    console.log("Loading current ppixiv version");
    return await fetchLatestVersion({ devel });
}

// Load and return the code for the latest version.
async function fetchLatestVersion({ devel=false }={})
{
    // The regular top-level user script that we'll look at to find the source URL for the current version:
    let topUrl = devel? "https://ppixiv.org/beta/ppixiv.user.js":"https://ppixiv.org/latest/ppixiv.user.js";

    // In devel, always revalidate this request, so we'll see changes immediately.  Otherwise, use normal caching.
    let cache = devel? "no-cache":"default";
    let topScript = await fetchFile(topUrl, {
        cache,
    });
    if(topScript == null)
        return;

    let sourceUrl = getSourceUrlFromScript(topScript);
    if(sourceUrl == null)
    {
        console.info("Couldn't find the update URL for ppixiv.");
        console.log(topScript);
        return;
    }

    // Release versions contain the version number in the URL, so we don't have to worry about caching.  In
    // development it's common to push updates to the devel build repeatedly without changing the version.
    // To avoid loading the previous version out of cache, use the SRE hash to bust cache by moving it from
    // the hash to the query.  The hash itself isn't used here.
    sourceUrl = new URL(sourceUrl);
    sourceUrl.search = sourceUrl.hash.substr(1);
    sourceUrl.hash = "";

    // Save the URL, so we can load it in the future without having to look it up.
    setCodeURL(sourceUrl);

    return await fetchFromCache(sourceUrl);
}

async function fetchFile(url, args={})
{
    let response = await fetch(url, {
        // Explicitly omit the Referer header.  Modern browsers only include the origin and not the full
        // URL anyway, but since this is important for privacy, let's set it explicitly.  The Origin header
        // will still be included.
        referrer: "",
        referrerPolicy: "no-referrer",
        ...args,
    });

    if(!response.ok)
    {
        console.info(`Couldn't load ${url}: ${response.status}`);
        return null;
    }
    return await response.text();
}

// Fetch url from cache.  If true and the URL isn't cached, load it.
async function fetchFromCache(url, {
    load=true
}={})
{
    let cache = await caches.open("ppixiv-launcher");
    let response = await cache.match(url);
    if(response && response.ok)
        return await response.text();

    if(!load)
        return null;

    // Clear all other keys in the cache, so we remove any old cached versions.
    let keys = await cache.keys();
    for(let key of keys)
    {
        console.log(`Removing old cached ppixiv version: ${key.url}`);
        await cache.delete(key);
    }

    // Cache the new version.
    await cache.add(url);

    response = await cache.match(url);
    if(response && response.ok)
        return await response.text();
    else
        return null;
}

// Find the @require inside the script containing the main script URL.
function getSourceUrlFromScript(topScript)
{
    for(let [tag, value] of parseUserScriptHeader(topScript))
    {
        switch(tag)
        {
        case "require":
            // Currently the only @require is our script, but in case others are added later, check
            // that this is the right one.
            if(value.indexOf(".user.js") == -1)
                continue;

            return value;
        }
    }
    return null;
}

// Parse the ==UserScript== header, returning an array of [key, value] pairs.
function parseUserScriptHeader(code)
{
    let results = [];
    for(let line of code.split("\n"))
    {
        if(line == "// ==/UserScript==")
            break;

        // Parse "@tag value".
        let parts = line.match(/\/\/ @([a-z]+)\s+(.*)/)
        if(parts == null)
            continue;

        let [, tag, value] = parts;
        results.push([tag, value]);
    }
    return results;
}
