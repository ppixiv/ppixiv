// Return info links for the given user.  This is used by data sources with contents
// related to a specific user.
export function getInfoLinksForUser({ userInfo })
{
    // Make a list of links to add to the top corner.
    //
    // If we reach our limit for the icons we can fit, we'll cut off at the end, so put
    // higher-priority links earlier.
    let extraLinks = [];
    if(userInfo != null)
    {
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
        let type = findLinkImageType(webpageUrl);
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

    return extraLinks;
}

// Fill in link icons and remove duplicates.
export function filterLinks(extraLinks)
{
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
    for(let {type, url, ...other} of extraLinks)
    {
        // Filter duplicate links.
        if(url && seenLinks[url])
            continue;

        seenLinks[url] = true;

        // Filter out entries with invalid URLs.
        if(url)
        {
            try {
                url = new URL(url);
            } catch(e) {
                console.log("Couldn't parse profile URL:", url);
                continue;
            }
        }

        // Guess link types that weren't supplied.
        type ??= findLinkImageType(url);
        type ??= "default-icon";

        // Fill in the icon.
        let icon = linkTypes[type];

        filteredLinks.push({ url, type, icon, ...other });
    }

    return filteredLinks;
}

// Use different icons for sites where you can give the artist money.  This helps make
// the string of icons more meaningful (some artists have a lot of them).
function findLinkImageType(url)
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
}
