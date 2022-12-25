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

    async setUserIdAndDataSource({userId, dataSource})
    {
        // If we're viewing ourself (our own bookmarks page), hide this.
        if(userId == ppixiv.pixivInfo.userId)
        userId = null;

        // Load info for this user.
        this._showingUserId = userId;
        let userInfo = await ppixiv.userCache.getUserInfoFull(userId);

        // Stop if the user ID changed since we started this request.
        if(userId != this._showingUserId)
            return;

        let extraLinks = this.getExtraLinks({ userInfo, dataSource });

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
                a.addEventListener("click", async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
    
                    if(ppixiv.muting.isUserIdMuted(userId))
                        ppixiv.muting.unmuteUserId(userId);
                    else
                        await ppixiv.muting.addMute(userId, null, {type: "user"});
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

    getExtraLinks({ userInfo, dataSource })
    {
        // Make a list of links to add to the top corner.
        //
        // If we reach our limit for the icons we can fit, we'll cut off at the end, so put
        // higher-priority links earlier.
        let extraLinks = [];
        if(userInfo != null)
        {
            let muted = ppixiv.muting.isUserIdMuted(userInfo.userId);
            extraLinks.push({
                type: "mute",
                label: `${muted? "Unmute":"Mute"} ${userInfo?.name || "this user"}`,
            });
    
            extraLinks.push({
                url: new URL(`/messages.php?receiver_id=${userInfo.userId}`, ppixiv.plocation),
                type: "contact-link",
                label: "Send a message",
            });
            
            extraLinks.push({
                url: new URL(`/users/${userInfo.userId}/following#ppixiv`, ppixiv.plocation),
                type: "following-link",
                label: `View ${userInfo.name}'s followed users`,
            });

            extraLinks.push({
                url: new URL(`/users/${userInfo.userId}/bookmarks/artworks#ppixiv`, ppixiv.plocation),
                type: "bookmarks-link",
                label: userInfo? `View ${userInfo.name}'s bookmarks`:`View bookmarks`,
            });

            extraLinks.push({
                url: new URL(`/discovery/users#ppixiv?user_id=${userInfo.userId}`, ppixiv.plocation),
                type: "similar-artists",
                label: "Similar artists",
            });
        }

        // Set the pawoo link.
        let pawooUrl = userInfo?.social?.pawoo?.url;
        if(pawooUrl != null)
        {
            extraLinks.push({
                url: pawooUrl,
                type: "pawoo-icon",
                label: "Pawoo",
            });
        }

        // Add the twitter link if there's one in the profile.
        let twitterUrl = userInfo?.social?.twitter?.url;
        if(twitterUrl != null)
        {
            extraLinks.push({
                url: twitterUrl,
                type: "twitter-icon",
            });
        }

        // Set the circle.ms link.
        let circlemsUrl = userInfo?.social?.circlems?.url;
        if(circlemsUrl != null)
        {
            extraLinks.push({
                url: circlemsUrl,
                type: "circlems-icon",
                label: "Circle.ms",
            });
        }

        // Set the webpage link.
        //
        // If the webpage link is on a known site, disable the webpage link and add this to the
        // generic links list, so it'll use the specialized icon.
        let webpageUrl = userInfo?.webpage;
        if(webpageUrl != null)
        {
            let type = this.findLinkImageType(webpageUrl);
            extraLinks.push({
                url: webpageUrl,
                type: type || "webpage-link",
                label: "Webpage",
            });
        }

        // Find any other links in the user's profile text.
        if(userInfo != null)
        {
            let div = document.createElement("div");
            div.innerHTML = userInfo.commentHtml;

            let limit = 4;
            for(let link of div.querySelectorAll("a"))
            {
                extraLinks.push({url: helpers.pixiv.fixPixivLink(link.href)});

                // Limit these in case people have a ton of links in their profile.
                limit--;
                if(limit == 0)
                    break;
            }
        }

        // Let the data source add more links.  For Fanbox links this is usually delayed
        // since it requires an extra API call, so put this at the end to prevent the other
        // buttons from shifting around.
        if(dataSource != null)
            dataSource.addExtraLinks(extraLinks);

        // Map from link types to icons:
        let linkTypes = {
            ["default-icon"]: "ppixiv:link",
            ["shopping-cart"]: "mat:shopping_cart",
            ["twitter-icon"]: "ppixiv:twitter",
            ["fanbox-icon"]: "resources/icon-fanbox.svg",
            ["booth-icon"]: "ppixiv:booth",
            ["webpage-link"]: "mat:home",
            ["pawoo-icon"]: "resources/icon-pawoo.svg",
            ["circlems-icon"]: "resources/icon-circlems.svg",
            ["twitch-icon"]: "ppixiv:twitch",
            ["contact-link"]: "mat:mail",
            ["following-link"]: "resources/followed-users-eye.svg",
            ["bookmarks-link"]: "mat:star",
            ["similar-artists"]: "ppixiv:suggestions",
            ["request"]: "mat:paid",
            ["mute"]: "block",
        };

        let filteredLinks = [];
        let seenLinks = {};
        for(let link of extraLinks)
        {
            // Filter duplicate links.
            if(link.url && seenLinks[link.url])
                continue;

            seenLinks[link.url] = true;

            if(link.url)
            {
                try {
                    link.url = new URL(link.url);
                } catch(e) {
                    console.log("Couldn't parse profile URL:", link.url);
                    continue;
                }
            }

            // Guess link types that weren't supplied.
            if(link.type == null)
            {
                let { type } = link;
                if(type == null)
                    type = this.findLinkImageType(link.url);

                if(type == null)
                    type = "default-icon";

                link.type = type;
            }

            // Fill in the icon.
            link.icon = linkTypes[link.type];

            filteredLinks.push(link);
        }
    
        return filteredLinks;
    }

    // Use different icons for sites where you can give the artist money.  This helps make
    // the string of icons more meaningful (some artists have a lot of them).
    findLinkImageType(url)
    {
        url = new URL(url);

        let altIcons = {
            "shopping-cart": [
                "dlsite.com",
                "fantia.jp",
                "skeb.jp",
                "ko-fi.com",
                "dmm.co.jp",
            ],
            "twitter-icon": [
                "twitter.com",
            ],
            "fanbox-icon": [
                "fanbox.cc",
            ],
            "booth-icon": [
                "booth.pm",
            ],
            "twitch-icon": [
                "twitch.tv",
            ],
        };

        // Special case for old Fanbox URLs that were under the Pixiv domain.
        if((url.hostname == "pixiv.net" || url.hostname == "www.pixiv.net") && url.pathname.startsWith("/fanbox/"))
            return "fanbox-icon";

        for(let alt in altIcons)
        {
            // "domain.com" matches domain.com and *.domain.com.
            for(let domain of altIcons[alt])
            {
                if(url.hostname == domain)
                    return alt;

                if(url.hostname.endsWith("." + domain))
                    return alt;
            }
        }
        return null;
    };
};
