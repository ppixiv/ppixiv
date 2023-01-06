import DataSource from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

export default class DataSource_SearchUsers extends DataSource
{
    get name() { return "search-users"; }
    get allowExpandingMangaPages() { return false; }
  
    async loadPageInternal(page)
    {
        if(!this.username)
            return;

        // This API only returns 10 results per page  This search only seems useful for looking
        // for somebody specific, so just load the first page to prevent spamming the API.
        if(page > 1)
            return;

        // Use the mobile API for this.  THe desktop site has no API and has to be scraped, and if
        // we're on mobile we can't access the desktop page, but the mobile site's API works either
        // way.
        let result = await helpers.pixivRequest.get("/touch/ajax/search/users", {
            nick: this.username,
            s_mode: "s_usr",
            p: page,
            lang: "en",
        });

        if(result.error)
        {
            ppixiv.message.show("Error reading search: " + result.message);
            return;
        }

        // This returns images for each user, but that doesn't seem useful (this is a user search,
        // not discovery), and the format is different from everything else, so it's a bit of a pain
        // to use.  Just return users.
        let mediaIds = [];
        for(let user of result.body.users)
        {
            ppixiv.extraCache.addQuickUserData({
                userId: user.user_id,
                userName: user.user_name,
                profileImageUrl: user.profile_img.main,
            });

            mediaIds.push(`user:${user.user_id}`);
        }

        return { mediaIds };
    }

    get username()
    {
        return this.url.searchParams.get("nick") ?? "";
    }

    get ui()
    {
        return UI;
    }
    
    get hasNoResults()
    {
        // Don't display "No Results" while we're still waiting for the user to enter a search.
        if(!this.username)
            return false;

        return super.hasNoResults;
    }

    get pageTitle()
    {
        let search = this.username;
        if(search)
            return "Search users: " + search;
        else
            return "Search users";
    }

    getDisplayingText()
    {
        return this.pageTitle;
    }
}

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div class="search-box">
                <div class="user-search-box input-field-container hover-menu-box">
                    <input class=search-users placeholder="Search users">
                    <span class="search-submit-button right-side-button">
                        ${ helpers.createIcon("search") }
                    </span>
                </div>
            </div>
        `});

        this.dataSource = dataSource;

        this.querySelector(".user-search-box .search-submit-button").addEventListener("click", this.submitUserSearch);
        helpers.inputHandler(this.querySelector(".user-search-box input.search-users"), this.submitUserSearch);

        this.querySelector(".search-users").value = dataSource.username;
    }

    // Handle submitting searches on the user search page.
    submitUserSearch = (e) =>
    {
        let search = this.querySelector(".user-search-box input.search-users").value;
        let url = new URL("/search_user.php#ppixiv", ppixiv.plocation);
        url.searchParams.append("nick", search);
        url.searchParams.append("s_mode", "s_usr");
        helpers.navigate(url);
    }
}
