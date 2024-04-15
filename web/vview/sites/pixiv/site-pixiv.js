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
import Series from '/vview/sites/pixiv/data-sources/series.js';
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
    Series,
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

export default class SitePixiv extends Site.Site
{
    async init()
    {
        helpers.html.setClass(document.body, "pixiv", true);

        // Pixiv scripts that use meta-global-data remove the element from the page after
        // it's parsed for some reason.  Try to get global info from document, and if it's
        // not there, re-fetch the page to get it.
        if(!this._loadGlobalInfoFromDocument(document))
        {
            if(!await this._loadGlobalDataAsync())
                return;
        }

        // Remove Pixiv's content from the page and move it into a dummy document.
        let html = document.createElement("document");
        if(!ppixiv.native)
        {
            helpers.html.moveChildren(document.head, html);
            helpers.html.moveChildren(document.body, html);
        }

        // Check that we found pixivTests.
        if(!ppixiv.native && ppixiv.pixivInfo?.pixivTests == null)
            console.log("pixivTests not available");

        // Set the .premium class on body if this is a premium account, to display features
        // that only work with premium.
        helpers.html.setClass(document.body, "premium", ppixiv.pixivInfo.premium);

        // These are used to hide buttons that the user has disabled.
        helpers.html.setClass(document.body, "hide-r18", !ppixiv.pixivInfo.include_r18);
        helpers.html.setClass(document.body, "hide-r18g", !ppixiv.pixivInfo.include_r18g);

        // See if the page has preload data.  This sometimes contains illust and user info
        // that the page will display, which lets us avoid making a separate API call for it.
        let preload = document.querySelector("#meta-preload-data");
        if(preload != null)
        {
            preload = JSON.parse(preload.getAttribute("content"));
            for(let preloadUserId in preload.user)
                ppixiv.userCache.addUserData(preload.user[preloadUserId]);
            for(let preloadMediaId in preload.illust)
                ppixiv.mediaCache.addPixivFullMediaInfo(preload.illust[preloadMediaId]);
        }

        return true;
    }

    // Load Pixiv's global info from doc.  This can be the document, or a copy of the
    // document that we fetched separately.  Return true on success.
    _loadGlobalInfoFromDocument(doc)
    {
        // When running locally, just load stub data, since this isn't used.
        if(ppixiv.native)
        {
            this._initGlobalData({
                csrfToken: "no token",
                userId: "no id" ,
                premium: true,
                mutes: [],
                contentMode: 2,
            });
    
            return true;
        }

        // Stop if we already have this.
        if(ppixiv.pixivInfo)
            return true;

        // #meta-pixiv-tests seems to contain info about features/misfeatures that are only enabled
        // on some users.  Grab this if it's available, so we can tell if recaptcha_follow_user is
        // enabled for this user.  This can also come from script#__NEXT_DATA__ below.
        let pixivTests = null;
        let pixivTestsElement = doc.querySelector("#meta-pixiv-tests");
        if(pixivTestsElement)
            pixivTests = JSON.parse(pixivTestsElement.getAttribute("content"));

        if(ppixiv.mobile)
        {
            // On mobile we can get most of this from meta#init-config.  However, it doesn't include
            // mutes, and we'd still need to wait for a /touch/ajax/user/self/status API call to get those.
            // Since it doesn't actually save us from having to wait for an API call, we just let it
            // use the regular fallback.
            let initConfig = document.querySelector("meta#init-config");
            if(initConfig)
            {
                let config = JSON.parse(initConfig.getAttribute("content"));
                this._initGlobalData({
                    pixivTests,
                    csrfToken: config["pixiv.context.postKey"],
                    userId: config["pixiv.user.id"], 
                    premium: config["pixiv.user.premium"] == "1",
                    mutes: null, // mutes missing on mobile
                    contentMode: config["pixiv.user.x_restrict"],
                    recaptchaKey: config["pixiv.context.recaptchaEnterpriseScoreSiteKey"],

                    // We'd also need to make a user/self/status call to get this.  This is only used to
                    // show or hide the search filter and the actual filtering happens server-side, so
                    // for now we don't bother.
                    hideAiWorks: false,
                });

                return true;
            }
        }

        // This format is used on at least /new_illust.php.
        let globalData = doc.querySelector("#meta-global-data");
        if(globalData != null)
            globalData = JSON.parse(globalData.getAttribute("content"));

        if(globalData == null)
        {
            // /request has its own special tag.
            let nextData = doc.querySelector("script#__NEXT_DATA__");
            if(nextData != null)
            {
                nextData = JSON.parse(nextData.innerText);
                globalData = nextData.props.pageProps;
                pixivTests = globalData.activeABTests;
            }
        }

        if(globalData == null)
            return false;

        // Discard this if it doesn't have login info.
        if(globalData.userData == null)
            return false;

        this._initGlobalData({
            csrfToken: globalData.token,
            userId: globalData.userData.id ,
            premium: globalData.userData.premium,
            mutes: globalData.mute,
            hideAiWorks: globalData.userData.hideAiWorks,
            contentMode: globalData.userData.xRestrict,
            pixivTests,
            recaptchaKey: globalData?.miscData?.grecaptcha?.recaptchaEnterpriseScoreSiteKey,
        });

        return true;
    }

    // This is called if we're on a page that didn't give us init data.  We'll load it from
    // a page that does.
    async _loadGlobalDataAsync()
    {
        console.assert(!ppixiv.native);

        console.log("Reloading page to get init data");

        // Use the requests page to get init data.  This is handy since it works even if the
        // site thinks we're mobile, so it still works if we're testing with DevTools set to
        // mobile mode.
        let result = await helpers.pixivRequest.fetchDocument("/request");

        console.log("Finished loading init data");
        if(this._loadGlobalInfoFromDocument(result))
            return true;

        // The user is probably not logged in.  If this happens on this code path, we
        // can't restore the page.
        //
        // window.ppixivShowLoggedOut is set by app-startup to let us share cooldown
        // logic.
        console.log("Couldn't find context data.  Are we logged in?");
        window.ppixivShowLoggedOut(true);

        // Redirect to no-ppixiv, to reload the page disabled so we don't leave the user
        // on a blank page.  If this is a page where Pixiv itself requires a login (which
        // is most of them), the initial page request will redirect to the login page before
        // we launch, but we can get here for a few pages.
        let disabledUrl = new URL(document.location);
        if(disabledUrl.hash != "#no-ppixiv")
        {
            disabledUrl.hash = "#no-ppixiv";
            document.location = disabledUrl.toString();

            // Make sure we reload after changing this.
            document.location.reload();
        }

        return false;
    }

    _initGlobalData({
        userId,
        csrfToken,
        premium,
        mutes,
        hideAiWorks=false,
        contentMode,
        pixivTests={},
        recaptchaKey=null,
    }={})
    {
        if(mutes)
        {
            let pixivMutedTags = [];
            let pixivMutedUserIds = [];
            for(let mute of mutes)
            {
                if(mute.type == 0)
                    pixivMutedTags.push(mute.value);
                else if(mute.type == 1)
                    pixivMutedUserIds.push(mute.value);
            }
            ppixiv.muting.setMutes({pixivMutedTags, pixivMutedUserIds});
        }
        else
        {
            // This page doesn't tell us the user's mutes.  Load from cache if possible, and request
            // the mute list from the server.  This normally only happens on mobile.
            console.assert(ppixiv.mobile);
            ppixiv.muting.loadCachedMutes();
            ppixiv.muting.fetchMutes();
        }

        ppixiv.pixivInfo = {
            userId,
            include_r18: contentMode >= 1,
            include_r18g: contentMode >= 2,
            premium,
            hideAiWorks,
            pixivTests,
            recaptchaKey,
        };

        // Give pixivRequest the CSRF token and user ID.
        helpers.pixivRequest.setPixivRequestInfo({csrfToken, userId});
    };

    async setInitialUrl()
    {
        let args = helpers.args.location;

        // If we're active but we're on a page that isn't directly supported, redirect to
        // a supported page.  This should be synced with Startup.refresh_disabled_ui.
        if(this.getDataSourceForUrl(ppixiv.plocation) == null)
            args = new helpers.args("/ranking.php?mode=daily#ppixiv");

        // If the URL hash doesn't start with #ppixiv, the page was loaded with the base Pixiv
        // URL, and we're active by default.  Add #ppixiv to the URL.  If we don't do this, we'll
        // still work, but none of the URLs we create will have #ppixiv, so we won't handle navigation
        // directly and the page will reload on every click.  Do this before we create any of our
        // UI, so our links inherit the hash.
        if(!helpers.args.isPPixivUrl(args.url))
            args.hash = "#ppixiv";

        helpers.navigate(args, { addToHistory: false, cause: "initial" });
    }

    getDataSourceForUrl(url)
    {
        url = new URL(url);
        url = helpers.pixiv.getUrlWithoutLanguage(url);
        let args = new helpers.args(url);

        args = new helpers.args(url);
        let parts = url.pathname.split("/");
        let firstPathSegment = parts[1];

        if(firstPathSegment == "artworks")
        {
            if(args.hash.get("manga"))
                return allDataSources.MangaPages;
            else
                return allDataSources.Illust;
        }
        else if(firstPathSegment == "user" && parts[3] == "series")
            return allDataSources.Series;
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
