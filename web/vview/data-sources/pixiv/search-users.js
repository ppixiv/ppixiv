import { DataSourceFromPage } from 'vview/data-sources/data-source.js';
import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/ppixiv-imports.js';

export default class DataSource_SearchUsers extends DataSourceFromPage
{
    get name() { return "search-users"; }
    get can_return_manga() { return false; }
  
    parse_document(doc)
    {
        var illust_ids = [];
        for(let item of doc.querySelectorAll(".user-recommendation-items .user-recommendation-item"))
        {
            let username = item.querySelector(".title").innerText;
            let user_id = item.querySelector(".follow").dataset.id;
            let profile_image = item.querySelector("._user-icon").dataset.src;

            extra_cache.singleton().add_quick_user_data({
                user_id: user_id,
                user_name: username,
                profile_img: profile_image,
            }, "user_search");

            illust_ids.push("user:" + user_id);
        }
        return illust_ids;
    }

    get username()
    {
        return this.url.searchParams.get("nick");
    }

    get ui()
    {
        return class extends Widget
        {
            constructor({ data_source, ...options })
            {
                super({ ...options, template: `
                    <div class="search-box">
                        <div class="user-search-box input-field-container hover-menu-box">
                            <input class=search-users placeholder="Search users">
                            <span class="search-submit-button right-side-button">
                                ${ helpers.create_icon("search") }
                            </span>
                        </div>
                    </div>
                `});

                this.data_source = data_source;

                this.querySelector(".user-search-box .search-submit-button").addEventListener("click", this.submit_user_search);
                helpers.input_handler(this.querySelector(".user-search-box input.search-users"), this.submit_user_search);

                this.querySelector(".search-users").value = data_source.username;
            }

            // Handle submitting searches on the user search page.
            submit_user_search = (e) =>
            {
                let search = this.querySelector(".user-search-box input.search-users").value;
                let url = new URL("/search_user.php#ppixiv", ppixiv.plocation);
                url.searchParams.append("nick", search);
                url.searchParams.append("s_mode", "s_usr");
                helpers.navigate(url);
            }
        }
    }
    
    get no_results()
    {
        // Don't display "No Results" while we're still waiting for the user to enter a search.
        if(!this.username)
            return false;

        return super.no_results;
    }

    get page_title()
    {
        let search = this.username;
        if(search)
            return "Search users: " + search;
        else
            return "Search users";
    };

    get_displaying_text()
    {
        return this.page_title;
    };
}
