
// Artist suggestions take a random sample of followed users, and query suggestions from them.
// The followed user list normally comes from /discovery/users.
//
// This can also be used to view recommendations based on a specific user.  Note that if we're
// doing this, we don't show things like the artist's avatar in the corner, so it doesn't look
// like the images we're showing are by that user.

import DataSource from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_DiscoverUsers extends DataSource
{
    get name() { return "discovery_users"; }

    constructor(url)
    {
        super(url);

        let args = new helpers.args(this.url);
        let userId = args.hash.get("user_id");
        if(userId != null)
            this.showingUserId = userId;

        this.seenUserIds = {};
    }

    get usersPerPage() { return 20; }
    get estimatedItemsPerPage()
    {
        let illustsPerUser = this.showingUserId != null? 3:5;
        return this.usersPerPage + (usersPerPage * illustsPerUser);
    }
    
    async loadPageInternal(page)
    {
        // If we're showing similar users, only show one page, since the API returns the
        // same thing every time.
        if(this.showingUserId && page > 1)
            return;

        if(this.showingUserId != null)
        {
            // Make sure the user info is loaded.
            this.userInfo = await ppixiv.userCache.getUserInfo(this.showingUserId, { full: true });

            // Update to refresh our page title, which uses user_info.
            this.callUpdateListeners();
        }
 
        // Get suggestions.  Each entry is a user, and contains info about a small selection of
        // images.
        let result;
        if(this.showingUserId != null)
        {
            result = await helpers.pixivRequest.get(`/ajax/user/${this.showingUserId}/recommends`, {
                userNum: this.usersPerPage,
                workNum: 8,
                isR18: true,
                lang: "en"
            });
        } else {
            result = await helpers.pixivRequest.get("/ajax/discovery/users", {
                limit: this.usersPerPage,
                lang: "en",
            });

            // This one includes tag translations.
            ppixiv.tagTranslations.addTranslationsDict(result.body.tagTranslation);
        }

        if(result.error)
            throw "Error reading suggestions: " + result.message;

        await ppixiv.mediaCache.addMediaInfosPartial(result.body.thumbnails.illust, "normal");

        for(let user of result.body.users)
        {
            ppixiv.userCache.addUserData(user);

            // Register this as quick user data, for use in thumbnails.
            ppixiv.extraCache.addQuickUserData(user, "recommendations");
        }

        // Pixiv's motto: "never do the same thing the same way twice"
        // ajax/user/#/recommends is body.recommendUsers and user.illustIds.
        // discovery/users is body.recommendedUsers and user.recentIllustIds.
        let recommendedUsers = result.body.recommendUsers || result.body.recommendedUsers;
        let mediaIds = [];
        for(let user of recommendedUsers)
        {
            // Each time we load a "page", we're actually just getting a new randomized set of recommendations
            // for our seed, so we'll often get duplicate results.  Ignore users that we've seen already.  IllustIdList
            // will remove dupes, but we might get different sample illustrations for a duplicated artist, and
            // those wouldn't be removed.
            if(this.seenUserIds[user.userId])
                continue;
            this.seenUserIds[user.userId] = true;

            mediaIds.push("user:" + user.userId);
            
            let illustIds = user.illustIds || user.recentIllustIds;
            for(let illustId of illustIds)
                mediaIds.push(helpers.mediaId.fromIllustId(illustId));
        }

        // Register the new page of data.
        await this.addPage(page, mediaIds);
    }

    get estimatedItemsPerPage() { return 30; }
    get pageTitle()
    {
        if(this.showingUserId == null)
            return "Recommended Users";

        if(this.userInfo)
            return this.userInfo.name;
        else
            return "Loading...";
    }
    
    getDisplayingText()
    {
        if(this.showingUserId == null)
            return "Recommended Users";

        if(this.userInfo)
            return "Similar artists to " + this.userInfo.name;
        else
            return "Illustrations";
    };
};
