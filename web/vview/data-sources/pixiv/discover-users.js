
// Artist suggestions take a random sample of followed users, and query suggestions from them.
// The followed user list normally comes from /discovery/users.
//
// This can also be used to view recommendations based on a specific user.  Note that if we're
// doing this, we don't show things like the artist's avatar in the corner, so it doesn't look
// like the images we're showing are by that user.

import DataSource from 'vview/data-sources/data-source.js';
import { helpers } from 'vview/ppixiv-imports.js';

export default class DataSource_DiscoverUsers extends DataSource
{
    get name() { return "discovery_users"; }

    constructor(url)
    {
        super(url);

        let args = new helpers.args(this.url);
        let user_id = args.hash.get("user_id");
        if(user_id != null)
            this.showing_user_id = user_id;

        this.original_url = url;
        this.seen_user_ids = {};
    }

    get users_per_page() { return 20; }
    get estimated_items_per_page()
    {
        let illusts_per_user = this.showing_user_id != null? 3:5;
        return this.users_per_page + (users_per_page * illusts_per_user);
    }
    
    async load_page_internal(page)
    {
        // If we're showing similar users, only show one page, since the API returns the
        // same thing every time.
        if(this.showing_user_id && page > 1)
            return;

        if(this.showing_user_id != null)
        {
            // Make sure the user info is loaded.
            this.user_info = await ppixiv.user_cache.get_user_info_full(this.showing_user_id);

            // Update to refresh our page title, which uses user_info.
            this.call_update_listeners();
        }
 
        // Get suggestions.  Each entry is a user, and contains info about a small selection of
        // images.
        let result;
        if(this.showing_user_id != null)
        {
            result = await helpers.get_request(`/ajax/user/${this.showing_user_id}/recommends`, {
                userNum: this.users_per_page,
                workNum: 8,
                isR18: true,
                lang: "en"
            });
        } else {
            result = await helpers.get_request("/ajax/discovery/users", {
                limit: this.users_per_page,
                lang: "en",
            });

            // This one includes tag translations.
            ppixiv.tag_translations.add_translations_dict(result.body.tagTranslation);
        }

        if(result.error)
            throw "Error reading suggestions: " + result.message;

        await ppixiv.media_cache.add_media_infos_partial(result.body.thumbnails.illust, "normal");

        for(let user of result.body.users)
        {
            ppixiv.user_cache.add_user_data(user);

            // Register this as quick user data, for use in thumbnails.
            ppixiv.extra_cache.singleton().add_quick_user_data(user, "recommendations");
        }

        // Pixiv's motto: "never do the same thing the same way twice"
        // ajax/user/#/recommends is body.recommendUsers and user.illustIds.
        // discovery/users is body.recommendedUsers and user.recentIllustIds.
        let recommended_users = result.body.recommendUsers || result.body.recommendedUsers;
        let media_ids = [];
        for(let user of recommended_users)
        {
            // Each time we load a "page", we're actually just getting a new randomized set of recommendations
            // for our seed, so we'll often get duplicate results.  Ignore users that we've seen already.  id_list
            // will remove dupes, but we might get different sample illustrations for a duplicated artist, and
            // those wouldn't be removed.
            if(this.seen_user_ids[user.userId])
                continue;
            this.seen_user_ids[user.userId] = true;

            media_ids.push("user:" + user.userId);
            
            let illustIds = user.illustIds || user.recentIllustIds;
            for(let illust_id of illustIds)
                media_ids.push(helpers.illust_id_to_media_id(illust_id));
        }

        // Register the new page of data.
        this.add_page(page, media_ids);
    }

    get estimated_items_per_page() { return 30; }
    get page_title()
    {
        if(this.showing_user_id == null)
            return "Recommended Users";

        if(this.user_info)
            return this.user_info.name;
        else
            return "Loading...";
    }
    
    get_displaying_text()
    {
        if(this.showing_user_id == null)
            return "Recommended Users";

        if(this.user_info)
            return "Similar artists to " + this.user_info.name;
        else
            return "Illustrations";
    };
};
