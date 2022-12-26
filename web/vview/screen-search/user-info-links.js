import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/misc/helpers.js';

// A strip of links for user info, shown at the top-right corner of the search UI.
export default class UserInfoLinks extends Widget
{
    constructor(options)
    {
        super({
            ...options,
            template: `
                <div class=button-row>
                </div>
            `
        });
    }

    async setDataSource(dataSource)
    {
        if(dataSource == this.dataSource)
            return;

        if(this._removeDataSourceListener)
            this._removeDataSourceListener.abort();

        this.dataSource = dataSource;

        this._removeDataSourceListener = new AbortController();
        if(this.dataSource)
            this.dataSource.addEventListener("updated", () => this.refresh(), { signal: this._removeDataSourceListener.signal });

        this.refresh();
    }

    shutdown()
    {
        if(this._removeDataSourceListener)
            this._removeDataSourceListener.abort();
        super.shutdown();
    }

    refresh()
    {
        let extraLinks = this.dataSource.getInfoLinks();

        // If the data source has a user ID, add the mute entry to the end.
        let userId = this.dataSource?.viewingUserId;
        if(userId && userId != ppixiv.pixivInfo.userId)
        {
            // If user info isn't available yet, continue without it and refresh if when becomes available.
            let userInfo = ppixiv.userCache.getUserInfoSync(userId, { afterLoad: () => this.refresh() });

            let muted = ppixiv.muting.isUserIdMuted(userId);
            extraLinks.unshift({
                type: "mute",
                label: `${muted? "Unmute":"Mute"} ${userInfo?.name || "this user"}`,
                icon: "mat:block",
            });
        }

        // Remove any extra buttons that we added earlier.
        let row = this.root;
        for(let div of row.querySelectorAll(".extra-profile-link-button"))
            div.remove();
        
        for(let {url, label, type, icon} of extraLinks)
        {
            let entry = this.createTemplate({name: "extra-link", html: `
                <div class=extra-profile-link-button>
                    <a href=# class="extra-link icon-button popup popup-bottom" rel="noreferer noopener"></a>
                </div>
            `});

            let iconNode;
            if(icon.endsWith(".svg"))
                iconNode = helpers.createInlineIcon(icon);
            else
                iconNode = helpers.createIcon(icon, { asElement: true });

            iconNode.classList.add(type);
            entry.querySelector(".extra-link").appendChild(iconNode);

            let a = entry.querySelector(".extra-link");
            if(url)
                a.href = url;

            // If this is a Twitter link, parse out the ID.  We do this here so this works
            // both for links in the profile text and the profile itself.
            if(type == "twitter-icon")
            {
                let parts = url.pathname.split("/");
                label = parts.length > 1? ("@" + parts[1]):"Twitter";
            }

            if(type == "mute")
            {
                a.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._clickedMute();
                });
            }

            if(label == null)
                label = a.href;
            a.dataset.popup = decodeURIComponent(label);

            // Add the node at the start, so earlier links are at the right.  This makes the
            // more important links less likely to move around.
            row.insertAdjacentElement("afterbegin", entry);
        }
    }

    async _clickedMute()
    {
        let userId = this.dataSource?.viewingUserId;
        if(ppixiv.muting.isUserIdMuted(userId))
            ppixiv.muting.unmuteUserId(userId);
        else
            await ppixiv.muting.addMute(userId, null, {type: "user"});
    }
};
