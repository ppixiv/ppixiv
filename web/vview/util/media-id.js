// Helpers for working with media IDs.

// Encode a media ID.
//
// These represent single images, videos, etc. that we can view.  Examples:
//
// illust:1234-0          - The first page of Pixiv illust ID 1234
// illust:1234-12         - Pixiv illust ID 1234, page 12.  Pages are zero-based.
// user:1000              - Pixiv user 1000.
// folder:/images         - A directory in the local API.
// file:/images/image.jpg - A file in the local API.
//
// IDs with the local API are already in this format, and Pixiv illust IDs and pages are
// converted to it.
export function encodeMediaId({type, id, page=null}={})
{
    if(type == "illust")
    {
        if(page == null)
            page = 0;
        id  += "-" + page;
    }

    return type + ":" + id;
}


// Media IDs are parsed by the thousands, and this can have a small performance
// impact.  Cache the results, so we only parse any given media ID once.
let _mediaIdCache = new Map();
export function parse(mediaId)
{
    let cache = _mediaIdCache.get(mediaId);
    if(cache == null)
    {
        cache = _parseMediaIdInner(mediaId);
        _mediaIdCache.set(mediaId, cache);
    }

    // Return a new object and not the cache, since the returned value might be
    // modified.
    return { type: cache.type, id: cache.id, page: cache.page };
}

export function _parseMediaIdInner(mediaId)
{
    // If this isn't an illust, a media ID is the same as an illust ID.
    let { type, id } = _splitId(mediaId);
    if(type != "illust")
        return { type: type, id: id, page: 0 };

    // If there's no hyphen in the ID, it's also the same.
    if(mediaId.indexOf("-") == -1)
        return { type: type, id: id, page: 0 };

    // Split out the page.
    let parts = id.split("-");
    let page = parts[1];
    page = parseInt(page);
    id = parts[0];
    
    return { type: type, id: id, page: page };
}


// Split a "type:id" into its two parts.
//
// If there's no colon, this is a Pixiv illust ID, so set type to "illust".
function _splitId(id)
{
    if(id == null)
        return { }

    let parts = id.split(":");
    let type = parts.length < 2?  "illust": parts[0];
    let actual_id = parts.length < 2? id: parts.splice(1).join(":"); // join the rest
    return {
        type: type,
        id: actual_id,
    }
}

// Return a media ID from a Pixiv illustration ID and page number.
export function fromIllustId(illustId, page)
{
    if(illustId == null)
        return null;
        
    let { type, id } = _splitId(illustId);

    // Pages are only used for illusts.  For other types, the page should always
    // be null or 0, and we don't include it in the media ID.
    if(type == "illust")
    {
        id += "-";
        id += page || 0;
    }
    else
    {
        console.assert(page == null || page == 0);
    }

    return type + ":" + id;
}

// Convert a media ID to a Pixiv illust ID and manga page.
export function toIllustIdAndPage(mediaId)
{
    let { type, id, page } = parse(mediaId);
    if(type != "illust")
        return [mediaId, 0];
    
    return [id, page];
}

// Return true if mediaId is an ID for the local API.
export function isLocal(mediaId)
{
    let { type } = parse(mediaId);
    return type == "file" || type == "folder";
}


// Given a media ID, return the same media ID for the first page.
//
// Some things don't interact with pages, such as illust info loads, and
// only store data with the ID of the first page.
export function getMediaIdFirstPage(mediaId)
{
    return this.getMediaIdForPage(mediaId, 0);
}

export function getMediaIdForPage(mediaId, page=0)
{
    if(mediaId == null)
        return null;
        
    let id = parse(mediaId);
    id.page = page;
    return encodeMediaId(id);
}
