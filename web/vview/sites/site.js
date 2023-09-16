import { helpers } from '/vview/misc/helpers.js';

// Each site we support has a singleton Site class.  We currently only support
// using a single site (the site we're on) and only create its singleton.
export class Site
{
    createDataSourceForUrl({ url, args })
    {
        throw new Error("Not implemented");
    }
}

// Register a Site singleton for a hostname.
let sitesByHostname = { };
export function registerSite(hostname, site)
{
    sitesByHostname[hostname] = site;
}

let dataSourcesByUrl = {};

// Return the data source for a URL, or null if the page isn't supported.
export function getDataSourceForUrl(url)
{
    // url is usually document.location, which for some reason doesn't have .searchParams.
    url = new URL(url);
    let args = new helpers.args(url);

    let site = sitesByHostname[url.hostname];
    if(site == null)
        throw Error(`Unknown hostname: ${url.hostname}`);

    return site.createDataSourceForUrl({ url, args });
}

// Create the data source for a given URL.
//
// If we've already created a data source for this URL, the same one will be
// returned.
export function createDataSourceForUrl(url, {
    // If force is true, we'll always create a new data source, replacing any
    // previously created one.
    force=false,

    // If startAtBeginning is true, the data source page number in url will be
    // ignored, returning to page 1.  This only matters for data sources that support
    // a start page.
    startAtBeginning=false,
}={})
{
    let args = new helpers.args(url);

    let dataSourceClass = getDataSourceForUrl(url);
    if(dataSourceClass == null)
    {
        console.error("Unexpected path:", url.pathname);
        return;
    }

    // Canonicalize the URL to see if we already have a data source for this URL.  We only
    // keep one data source around for each canonical URL (eg. search filters).
    let canonicalUrl = helpers.getCanonicalUrl(url, { startAtBeginning: true }).url.toString();
    if(!force && canonicalUrl in dataSourcesByUrl)
    {
        // console.log("Reusing data source for", url.toString());
        let dataSource = dataSourcesByUrl[canonicalUrl];
        if(dataSource)
        {
            // If the URL has a page number in it, only return it if this data source can load the
            // page the caller wants.  If we have a data source that starts at page 10 and the caller
            // wants page 1, the data source probably won't be able to load it since pages are always
            // contiguous.
            let page = dataSource.getStartPage(args);
            if(!dataSource.canLoadPage(page))
                console.log(`Not using cached data source because it can't load page ${page}`);
            else
                return dataSource;
        }
    }
    
    // The search page isn't part of the canonical URL, but keep it in the URL we create
    // the data source with, so it starts at the current page.
    let baseUrl = helpers.getCanonicalUrl(url, { startAtBeginning }).url.toString();
    let dataSource = new dataSourceClass(baseUrl);
    dataSourcesByUrl[canonicalUrl] = dataSource;
    return dataSource;
}

// If we have the given data source cached, discard it, so it'll be recreated
// the next time it's used.
export function discardDataSource(dataSource)
{
    let urlsToRemove = [];
    for(let url in dataSourcesByUrl)
    {
        if(dataSourcesByUrl[url] === dataSource)
            urlsToRemove.push(url);
    }

    for(let url of urlsToRemove)
        delete dataSourcesByUrl[url];
}
