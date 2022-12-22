// This gathers the various data sources, so they can be referenced by name, and
// handles creating and caching data source instances.

import Discovery from 'vview/data-sources/pixiv/discover-illusts.js';
import DiscoverUsers from 'vview/data-sources/pixiv/discover-users.js';
import SimilarIllusts from 'vview/data-sources/pixiv/similar-illusts.js';
import Rankings from 'vview/data-sources/pixiv/rankings.js';
import Artist from 'vview/data-sources/pixiv/artist.js';
import Illust from 'vview/data-sources/pixiv/illust.js';
import FollowedUsers from 'vview/data-sources/pixiv/followed-users.js';
import MangaPages from 'vview/data-sources/pixiv/manga-pages.js';
import SearchIllusts from 'vview/data-sources/pixiv/search-illusts.js';
import NewPostsByFollowing from 'vview/data-sources/pixiv/new-posts-by-following.js';
import NewPostsByEveryone from 'vview/data-sources/pixiv/new-posts-by-everyone.js';
import RelatedFavorites from 'vview/data-sources/pixiv/related-favorites.js';
import SearchUsers from 'vview/data-sources/pixiv/search-users.js';
import CompletedRequests from 'vview/data-sources/pixiv/completed-requests.js';
import EditedImages from 'vview/data-sources/pixiv/edited-images.js';
import VView from 'vview/data-sources/vview/vview.js';
import VViewSimilar from 'vview/data-sources/vview/similar.js';
import { Bookmarks, BookmarksMerged } from 'vview/data-sources/pixiv/bookmarks.js';

import { helpers } from 'vview/misc/helpers.js';

let allDataSources = {
    Discovery,
    SimilarIllusts,
    DiscoverUsers,
    Rankings,
    Artist,
    Illust,
    MangaPages,
    Bookmarks,
    BookmarksMerged,
    NewPostsByEveryone,
    NewPostsByFollowing,
    SearchIllusts,
    FollowedUsers,
    RelatedFavorites,
    SearchUsers,
    CompletedRequests,
    EditedImages,
    VView,
    VViewSimilar,
};

let dataSourcesByUrl = {};

// Return the data source for a URL, or null if the page isn't supported.
export function getDataSourceForUrl(url)
{
    // url is usually document.location, which for some reason doesn't have .searchParams.
    url = new URL(url);
    url = helpers.get_url_without_language(url);

    if(ppixiv.native)
    {
        let args = new helpers.args(url);
        if(args.path == "/similar")
            return allDataSources.VViewSimilar;
        else
            return allDataSources.VView;
    }

    let first_part = helpers.get_page_type_from_url(url);
    if(first_part == "artworks")
    {
        let args = new helpers.args(url);
        if(args.hash.get("manga"))
            return allDataSources.MangaPages;
        else
            return allDataSources.Illust;
    }
    else if(first_part == "users")
    {
        // This is one of:
        //
        // /users/12345
        // /users/12345/artworks
        // /users/12345/illustrations
        // /users/12345/manga
        // /users/12345/bookmarks
        // /users/12345/following
        //
        // All of these except for bookmarks are handled by allDataSources.Artist.
        let mode = helpers.get_path_part(url, 2);
        if(mode == "following")
            return allDataSources.FollowedUsers;

        if(mode != "bookmarks")
            return allDataSources.Artist;

        // Handle a special case: we're called by early_controller just to find out if
        // the current page is supported or not.  This happens before window.global_data
        // exists, so we can't check if we're viewing our own bookmarks or someone else's.
        // In this case we don't need to, since the caller just wants to see if we return
        // a data source or not.
        if(window.global_data == null)
            return allDataSources.Bookmarks;

        // If show-all=0 isn't in the hash, and we're not viewing someone else's bookmarks,
        // we're viewing all bookmarks, so use allDataSources.BookmarksMerged.  Otherwise,
        // use allDataSources.bookmarks.
        let args = new helpers.args(url);
        let user_id = helpers.get_path_part(url, 1);
        if(user_id == null)
            user_id = window.global_data.user_id;
        let viewingOwnBookmarks = user_id == window.global_data.user_id;
        let both_public_and_private = viewingOwnBookmarks && args.hash.get("show-all") != "0";
        return both_public_and_private? allDataSources.BookmarksMerged:allDataSources.Bookmarks;

    }
    else if(url.pathname == "/new_illust.php" || url.pathname == "/new_illust_r18.php")
        return allDataSources.NewPostsByEveryone;
    else if(url.pathname == "/bookmark_new_illust.php" || url.pathname == "/bookmark_new_illust_r18.php")
        return allDataSources.NewPostsByFollowing;
    else if(first_part == "tags")
        return allDataSources.SearchIllusts;
    else if(url.pathname == "/discovery")
        return allDataSources.Discovery;
    else if(url.pathname == "/discovery/users")
        return allDataSources.DiscoverUsers;
    else if(url.pathname == "/bookmark_detail.php")
    {
        // If we've added "recommendations" to the hash info, this was a recommendations link.
        let args = new helpers.args(url);
        if(args.hash.get("recommendations"))
            return allDataSources.SimilarIllusts;
        else
            return allDataSources.RelatedFavorites;
    }
    else if(url.pathname == "/ranking.php")
        return allDataSources.Rankings;
    else if(url.pathname == "/search_user.php")
        return allDataSources.SearchUsers;
    else if(url.pathname.startsWith("/request/complete"))
        return allDataSources.CompletedRequests;
    else if(first_part == "")
    {
        // Data sources that don't have a corresponding Pixiv page:
        let args = new helpers.args(url);
        if(args.hash_path == "/edits")
            return allDataSources.EditedImages;
        else
            return null;
    }
    else
        return null;
}

// Create the data source for a given URL.
//
// If we've already created a data source for this URL, the same one will be
// returned.
export function createDataSourceForUrl(url, {
    // If force is true, we'll always create a new data source, replacing any
    // previously created one.
    force=false,

    // If remove_search_page is true, the data source page number in url will be
    // ignored, returning to page 1.  This only matters for data sources that support
    // a start page.
    remove_search_page=false,
}={})
{
    let args = new helpers.args(url);

    let data_source_class = getDataSourceForUrl(url);
    if(data_source_class == null)
    {
        console.error("Unexpected path:", url.pathname);
        return;
    }

    // Canonicalize the URL to see if we already have a data source for this URL.  We only
    // keep one data source around for each canonical URL (eg. search filters).
    let canonical_url = helpers.get_canonical_url(url, { remove_search_page: true }).url.toString();
    if(!force && canonical_url in dataSourcesByUrl)
    {
        // console.log("Reusing data source for", url.toString());
        let dataSource = dataSourcesByUrl[canonical_url];
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
    let base_url = helpers.get_canonical_url(url, { remove_search_page }).url.toString();
    let source = new data_source_class(base_url);

    dataSourcesByUrl[canonical_url] = source;
    return source;
}

// If we have the given data source cached, discard it, so it'll be recreated
// the next time it's used.
export function discardDataSource(dataSource)
{
    let urls_to_remove = [];
    for(let url in dataSourcesByUrl)
    {
        if(dataSourcesByUrl[url] === dataSource)
            urls_to_remove.push(url);
    }

    for(let url of urls_to_remove)
        delete dataSourcesByUrl[url];
}
