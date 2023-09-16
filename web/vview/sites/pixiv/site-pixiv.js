import { helpers } from '/vview/misc/helpers.js';
import * as Site from '/vview/sites/site.js';

import Discovery from '/vview/sites/pixiv/data-sources/discover-illusts.js';
import DiscoverUsers from '/vview/sites/pixiv/data-sources/discover-users.js';
import SimilarIllusts from '/vview/sites/pixiv/data-sources/similar-illusts.js';
import Rankings from '/vview/sites/pixiv/data-sources/rankings.js';
import Artist from '/vview/sites/pixiv/data-sources/artist.js';
import Illust from '/vview/sites/pixiv/data-sources/illust.js';
import FollowedUsers from '/vview/sites/pixiv/data-sources/followed-users.js';
import MangaPages from '/vview/sites/pixiv/data-sources/manga-pages.js';
import SearchIllusts from '/vview/sites/pixiv/data-sources/search-illusts.js';
import NewPostsByFollowing from '/vview/sites/pixiv/data-sources/new-posts-by-following.js';
import NewPostsByEveryone from '/vview/sites/pixiv/data-sources/new-posts-by-everyone.js';
import RelatedFavorites from '/vview/sites/pixiv/data-sources/related-favorites.js';
import SearchUsers from '/vview/sites/pixiv/data-sources/search-users.js';
import CompletedRequests from '/vview/sites/pixiv/data-sources/completed-requests.js';
import EditedImages from '/vview/sites/pixiv/data-sources/edited-images.js';
import { Bookmarks, BookmarksMerged } from '/vview/sites/pixiv/data-sources/bookmarks.js';

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
};

class SitePixiv extends Site.Site
{
    createDataSourceForUrl({ url, args })
    {
        url = helpers.pixiv.getUrlWithoutLanguage(url);

        args = new helpers.args(url);
        let firstPathSegment = helpers.pixiv.getPageTypeFromUrl(url);

        if(firstPathSegment == "artworks")
        {
            if(args.hash.get("manga"))
                return allDataSources.MangaPages;
            else
                return allDataSources.Illust;
        }
        else if(firstPathSegment == "users")
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
            let userId = helpers.strings.getPathPart(url, 1);
            if(userId == null)
                userId = ppixiv.pixivInfo.userId;
            let viewingOwnBookmarks = userId == ppixiv.pixivInfo.userId;
            let bothPublicAndPrivate = viewingOwnBookmarks && args.hash.get("show-all") != "0";
            return bothPublicAndPrivate? allDataSources.BookmarksMerged:allDataSources.Bookmarks;

        }
        else if(url.pathname == "/new_illust.php" || url.pathname == "/new_illust_r18.php")
            return allDataSources.NewPostsByEveryone;
        else if(url.pathname == "/bookmark_new_illust.php" || url.pathname == "/bookmark_new_illust_r18.php")
            return allDataSources.NewPostsByFollowing;
        else if(firstPathSegment == "tags")
            return allDataSources.SearchIllusts;
        else if(url.pathname == "/discovery")
            return allDataSources.Discovery;
        else if(url.pathname == "/discovery/users")
            return allDataSources.DiscoverUsers;
        else if(url.pathname == "/bookmark_detail.php")
        {
            // If we've added "recommendations" to the hash info, this was a recommendations link.
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
        else if(firstPathSegment == "")
        {
            // Data sources that don't have a corresponding Pixiv page:
            if(args.hashPath == "/edits")
                return allDataSources.EditedImages;
            else
                return null;
        }
        else
            return null;
    }
}

export function register()
{
    if(ppixiv.native)
        return;

    Site.registerSite("www.pixiv.net", new SitePixiv());
}
