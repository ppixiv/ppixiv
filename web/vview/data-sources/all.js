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
    url = helpers.pixiv.getUrlWithoutLanguage(url);

    if(ppixiv.native)
    {
        let args = new helpers.args(url);
        if(args.path == "/similar")
            return allDataSources.VViewSimilar;
        else
            return allDataSources.VView;
    }

    let firstPart = helpers.pixiv.getPageTypeFromUrl(url);
    if(firstPart == "artworks")
    {
        let args = new helpers.args(url);
        if(args.hash.get("manga"))
            return allDataSources.MangaPages;
        else
            return allDataSources.Illust;
    }
    else if(firstPart == "users")
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
        let mode = helpers.strings.getPathPart(url, 2);
        if(mode == "following")
            return allDataSources.FollowedUsers;

        if(mode != "bookmarks")
            return allDataSources.Artist;

        // If show-all=0 isn't in the hash, and we're not viewing someone else's bookmarks,
        // we're viewing all bookmarks, so use allDataSources.BookmarksMerged.  Otherwise,
        // use allDataSources.bookmarks.
        let args = new helpers.args(url);
        let user_id = helpers.strings.getPathPart(url, 1);
        if(user_id == null)
            user_id = ppixiv.pixivInfo.userId;
        let viewingOwnBookmarks = user_id == ppixiv.pixivInfo.userId;
        let bothPublicAndPrivate = viewingOwnBookmarks && args.hash.get("show-all") != "0";
        return bothPublicAndPrivate? allDataSources.BookmarksMerged:allDataSources.Bookmarks;

    }
    else if(url.pathname == "/new_illust.php" || url.pathname == "/new_illust_r18.php")
        return allDataSources.NewPostsByEveryone;
    else if(url.pathname == "/bookmark_new_illust.php" || url.pathname == "/bookmark_new_illust_r18.php")
        return allDataSources.NewPostsByFollowing;
    else if(firstPart == "tags")
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
    else if(firstPart == "")
    {
        // Data sources that don't have a corresponding Pixiv page:
        let args = new helpers.args(url);
        if(args.hashPath == "/edits")
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

    // If removeSearchPage is true, the data source page number in url will be
    // ignored, returning to page 1.  This only matters for data sources that support
    // a start page.
    removeSearchPage=false,
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
    let canonicalUrl = helpers.getCanonicalUrl(url, { removeSearchPage: true }).url.toString();
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
    let baseUrl = helpers.getCanonicalUrl(url, { removeSearchPage }).url.toString();
    let source = new dataSourceClass(baseUrl);

    dataSourcesByUrl[canonicalUrl] = source;
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
