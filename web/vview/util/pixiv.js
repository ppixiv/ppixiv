import Args from 'vview/util/args.js';


// Return true if the given illust_data.tags contains the pixel art (ドット絵) tag.
export function tagsContainDot(tagList)
{
    if(tagList == null)
        return false;

    for(let tag of tagList)
        if(tag.indexOf("ドット") != -1)
            return true;

    return false;
}

// Some of Pixiv's URLs have languages prefixed and some don't.  Ignore these and remove
// them to make them simpler to parse.
export function getPathWithoutLanguage(path)
{
    if(/^\/..\//.exec(path))
        return path.substr(3);
    else        
        return path;
}

export function getUrlWithoutLanguage(url)
{
    url.pathname = getPathWithoutLanguage(url.pathname);
    return url;
}

// Split a Pixiv tag search into a list of tags.
export function splitSearchTags(search)
{
    // Replace full-width spaces with regular spaces.  Pixiv treats this as a delimiter.
    search = search.replace("　", " ");

    // Make sure there's a single space around parentheses, so parentheses are treated as their own item.
    // This makes it easier to translate tags inside parentheses, and style parentheses separately.
    search = search.replace(/ *([\(\)]) */g, " $1 ");

    // Remove repeated spaces.
    search = search.replace(/ +/g, " ");

    return search.split(" ");
}

// Find the real link inside Pixiv's silly jump.php links.
export function fixPixivLink(link)
{
    // These can either be /jump.php?url or /jump.php?url=url.
    let url = new URL(link);
    if(url.pathname != "/jump.php")
        return link;
    if(url.searchParams.has("url"))
        return url.searchParams.get("url");
    else
    {
        let target = url.search.substr(1); // remove "?"
        target = decodeURIComponent(target);
        return target;
    }
}

export function fixPixivLinks(root)
{
    for(let a of root.querySelectorAll("A[target='_blank']"))
        a.target = "";

    for(let a of root.querySelectorAll("A"))
    {
        if(a.relList == null)
            a.rel += " noreferrer noopener"; // stupid Edge
        else
        {
            a.relList.add("noreferrer");
            a.relList.add("noopener");
        }
    }

    for(let a of root.querySelectorAll("A[href*='jump.php']"))
        a.href = fixPixivLink(a.href);
}

// Find all links to Pixiv pages, and set a #ppixiv anchor.
//
// This allows links to images in things like image descriptions to be loaded
// internally without a page navigation.
export function makePixivLinksInternal(root)
{
    for(let a of root.querySelectorAll("A"))
    {
        let url = new URL(a.href, ppixiv.plocation);
        if(url.hostname != "pixiv.net" && url.hostname != "www.pixiv.net" || url.hash != "")
            continue;

        url.hash = "#ppixiv";
        a.href = url.toString();
    }
}

// Get the search tags from an "/en/tags/TAG" search URL.
export function getSearchTagsFromUrl(url)
{
    url = getUrlWithoutLanguage(url);
    let parts = url.pathname.split("/");

    // ["", "tags", tag string, "search type"]
    let tags = parts[2] || "";
    return decodeURIComponent(tags);
}

// From a URL like "/en/tags/abcd", return "tags".
export function getPageTypeFromUrl(url)
{
    url = new URL(url);
    url = getUrlWithoutLanguage(url);
    let parts = url.pathname.split("/");
    return parts[1];
}
    

// The inverse of getArgsForTagSearch:
export function getTagSearchFromArgs(url)
{
    url = getUrlWithoutLanguage(url);
    let type = getPageTypeFromUrl(url);
    if(type != "tags")
        return null;

    let parts = url.pathname.split("/");
    return decodeURIComponent(parts[2]);
}

// Change the host for a Pixiv image URL from i.pximg.net to i-cf.pximg.net.
export function adjustImageUrlHostname(url)
{
    if(url.hostname == "i.pximg.net")
        url.hostname = "i-cf.pximg.net";
}

// Given a low-res thumbnail URL from thumbnail data, return a high-res thumbnail URL.
// If page isn't 0, return a URL for the given manga page.
export function getHighResThumbnailUrl(url, page=0)
{
    // Some random results on the user recommendations page also return this:
    //
    // /c/540x540_70/custom-thumb/img/.../12345678_custom1200.jpg
    //
    // Replace /custom-thumb/' with /img-master/ first, since it makes matching below simpler.
    url = url.replace("/custom-thumb/", "/img-master/");

    // path should look like
    //
    // /c/250x250_80_a2/img-master/img/.../12345678_square1200.jpg
    //
    // where 250x250_80_a2 is the resolution and probably JPEG quality.  We want
    // the higher-res thumbnail (which is "small" in the full image data), which
    // looks like:
    //
    // /c/540x540_70/img-master/img/.../12345678_master1200.jpg
    //
    // The resolution field is changed, and "square1200" is changed to "master1200".
    url = new URL(url, ppixiv.plocation);
    let path = url.pathname;
    let re = /(\/c\/)([^\/]+)(.*)(square1200|master1200|custom1200).jpg/;
    let match = re.exec(path);
    if(match == null)
    {
        console.warn("Couldn't parse thumbnail URL:", path);
        return url.toString();
    }

    url.pathname = match[1] + "540x540_70" + match[3] + "master1200.jpg";

    if(page != 0)
    {
        // Manga URLs end with:
        //
        // /c/540x540_70/custom-thumb/img/.../12345678_p0_master1200.jpg
        //
        // p0 is the page number.
        url.pathname = url.pathname.replace("_p0_master1200", "_p" + page + "_master1200");
    }

    this.adjustImageUrlHostname(url);

    return url.toString();
}
