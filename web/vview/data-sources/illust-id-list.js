// A list of illustration IDs by page.
//
// Store the list of illustration IDs returned from a search, eg. bookmark.php?p=3,
// and allow looking up the next or previous ID for an illustration.  If we don't have
// data for the next or previous illustration, return the page that should be loaded
// to make it available.
//
// We can have gaps in the pages we've loaded, due to history navigation.  If you load
// page 1, then jump to page 3, we'll figure out that to get the illustration before the
// first one on page 3, we need to load page 2.
//
// One edge case is when the underlying search changes while we're viewing it.  For example,
// if we're viewing page 2 with ids [1,2,3,4,5], and when we load page 3 it has ids
// [5,6,7,8,9], that usually means new entries were added to the start since we started.
// We don't want the same ID to occur twice, so we'll detect if this happens, and clear
// all other pages.  That way, we'll reload the previous pages with the updated data if
// we navigate back to them.

import { helpers } from 'vview/misc/helpers.js';

export default class IllustIdList
{
    constructor()
    {
        this.mediaIdsByPage = new Map();
    };

    getAllMediaIds()
    {
        // Make a list of all IDs we already have.
        let allIds = [];
        for(let [page, ids] of this.mediaIdsByPage)
            allIds = allIds.concat(ids);
        return allIds;
    }

    get anyPagesLoaded()
    {
        return this.mediaIdsByPage.size != 0;
    }

    getLowestLoadedPage()
    {
        // Give a default in case mediaIdsByPage is empty, so we don't return infinity.
        return Math.min(999999, ...this.mediaIdsByPage.keys());
    }

    getHighestLoadedPage()
    {
        return Math.max(0, ...this.mediaIdsByPage.keys());
    }

    // Add a page of results.
    //
    // If the page cache has been invalidated, return false.  This happens if we think the
    // results have changed too much for us to reconcile it.
    add_page(page, mediaIds, {
        // If mediaIds is empty, that normally means we're past the end of the results, so we
        // don't add the page.  That way, can_load_page() will return false for future pages.
        // If allowEmpty is true, allow adding empty pages.  This is used when we have an empty
        // page but we know we're not actually at the end.
        allowEmpty=false,
    }={})
    {
        // Sanity check:
        for(let mediaId of mediaIds)
            if(mediaId == null)
                console.warn("Null illust_id added");

        if(this.mediaIdsByPage.has(page))
        {
            console.warn("Page", page, "was already loaded");
            return true;
        }

        // Make a list of all IDs we already have.
        let all_illusts = this.getAllMediaIds();

        // For fast-moving pages like new_illust.php, we'll very often get a few entries at the
        // start of page 2 that were at the end of page 1 when we requested it, because new posts
        // have been added to page 1 that we haven't seen.  Remove any duplicate IDs.
        let ids_to_remove = [];
        for(let new_id of mediaIds)
        {
            if(all_illusts.indexOf(new_id) != -1)
                ids_to_remove.push(new_id);
        }

        if(ids_to_remove.length > 0)
            console.log("Removing duplicate illustration IDs:", ids_to_remove.join(", "));
        mediaIds = mediaIds.slice();
        for(let newId of ids_to_remove)
        {
            let idx = mediaIds.indexOf(newId);
            mediaIds.splice(idx, 1);
        }

        // If there's nothing on this page, don't add it, so this doesn't increase
        // getHighestLoadedPage().
        if(!allowEmpty && mediaIds.length == 0)
            return;

        this.mediaIdsByPage.set(page, mediaIds);
    };

    // Return the page number mediaId is on and the index within the page.
    //
    // If check_first_page is true and mediaId isn't in the list, try the first page
    // of mediaId too, so if we're looking for page 3 of a manga post and the data
    // source only contains the first page, we'll use that.
    getPageForMediaId(mediaId, { check_first_page=true }={})
    {
        for(let [page, ids] of this.mediaIdsByPage)
        {
            let idx = ids.indexOf(mediaId);
            if(idx != -1)
                return { page, idx, mediaId };
        }

        if(!check_first_page)
            return { };

        // Try the first page.
        mediaId = helpers.get_media_id_first_page(mediaId);
        for(let [page, ids] of this.mediaIdsByPage)
        {
            let idx = ids.indexOf(mediaId);
            if(ids.indexOf(mediaId) != -1)
                return { page, idx, mediaId };
        }

        return { };
    };

    // Return the next or previous illustration.  If we don't have that page, return null.
    //
    // This only returns illustrations, skipping over any special entries like user:12345.
    // If illust_id is null, start at the first loaded illustration.
    getNeighboringMediaId(mediaId, next, options={})
    {
        for(let i = 0; i < 100; ++i) // sanity limit
        {
            mediaId = this._getNeighboringMediaIdInternal(mediaId, next, options);
            if(mediaId == null)
                return null;

            // If it's not an illustration, keep looking.
            let { type } = helpers.parse_media_id(mediaId);
            if(type == "illust" || type == "file")
                return mediaId;
        }
        return null;
    }

    // The actual logic for getNeighboringMediaId, except for skipping entries.
    //
    // manga tells us how to handle manga pages:
    // - "normal": Navigate manga pages normally.
    // - "skip-to-first": Skip past manga pages, and always go to the first page of the
    //   next or previous image.
    // - "skip-past": Skip past manga pages.  If we're navigating backwards, go to the
    //   last page of the previous image, like we would normally.
    _getNeighboringMediaIdInternal(mediaId, next, { manga='normal' }={})
    {
        console.assert(manga == 'normal' || manga == 'skip-to-first' || manga == 'skip-past');

        if(mediaId == null)
            return this.getFirstId();

        // If we're navigating forwards and we're not skipping manga pages, grab media info to
        // get the page count to see if we're at the end. 
        let id = helpers.parse_media_id(mediaId);
        if(id.type == "illust" && manga == 'normal')
        {
            // If we're navigating backwards and we're past page 1, just go to the previous page.
            if(!next && id.page > 0)
            {
                id.page--;
                return helpers.encode_media_id(id);
            }

            // If we're navigating forwards, grab illust data to see if we can navigate to the
            // next page.
            if(next)
            {
                let info = ppixiv.media_cache.get_media_info_sync(mediaId, { full: false });
                if(info == null)
                {
                    // This can happen if we're viewing a deleted image, which has no illust info.
                    console.log("Thumbnail info missing for", mediaId);
                }
                else
                {
                    let [old_illust_id, old_page] = helpers.media_id_to_illust_id_and_page(mediaId);
                    if(old_page < info.pageCount - 1)
                    {
                        // There are more pages, so just navigate to the next page.
                        id.page++;
                        return helpers.encode_media_id(id);
                    }
                }
            }
        }

        let { page, idx } = this.getPageForMediaId(mediaId);
        if(page == null)
            return null;

        // Find the next or previous page that isn't empty, skipping over empty pages.
        let newMediaId = null;
        while(newMediaId == null)
        {
            let ids = this.mediaIdsByPage.get(page);
            let new_idx = idx + (next? +1:-1);
            if(new_idx >= 0 && new_idx < ids.length)
            {
                // Navigate to the next or previous image on the same page.
                newMediaId = ids[new_idx];
                break;
            }
            
            if(next)
            {
                // Get the first illustration on the next page, or null if that page isn't loaded.
                page++;
                ids = this.mediaIdsByPage.get(page);
                if(ids == null)
                    return null;
                newMediaId = ids[0];
            }
            else
            {
                // Get the last illustration on the previous page, or null if that page isn't loaded.
                page--;
                ids = this.mediaIdsByPage.get(page);
                if(ids == null)
                    return null;
                newMediaId = ids[ids.length-1];
            }
        }

        // If we're navigating backwards and we're not in skip-to-first mode, get the last page on newMediaId.
        if(!next && manga != 'skip-to-first' && helpers.parse_media_id(newMediaId).type == "illust")
        {
            let info = ppixiv.media_cache.get_media_info_sync(newMediaId, { full: false });
            if(info == null)
            {
                console.log("Thumbnail info missing for", mediaId);
                return null;
            }

            newMediaId = helpers.get_media_id_for_page(newMediaId, info.pageCount - 1);
        }

        return newMediaId;
    };
    
    // Return the first ID, or null if we don't have any.
    getFirstId()
    {
        if(this.mediaIdsByPage.size == 0)
            return null;

        let first_page = this.getLowestLoadedPage();
        return this.mediaIdsByPage.get(first_page)[0];
    }

    // Return the last ID, or null if we don't have any.
    getLastId()
    {
        if(this.mediaIdsByPage.size == 0)
            return null;

        let last_page = this.getHighestLoadedPage();
        let ids = this.mediaIdsByPage.get(last_page);
        return ids[ids.length-1];
    }

    // Return true if the given page is loaded.
    isPageLoaded(page)
    {
        return this.mediaIdsByPage.has(page);
    }
};
