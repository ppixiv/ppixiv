import Widget from '/vview/widgets/widget.js';
import Actions from '/vview/misc/actions.js';
import AsyncLookup from '/vview/actors/async-lookup.js';
import { DropdownBoxOpener } from '/vview/widgets/dropdown.js';
import { ConfirmPrompt, TextPrompt } from '/vview/widgets/prompts.js';
import { helpers } from '/vview/misc/helpers.js';

// AsyncLookup to look up user info from a user ID.
export class GetUserInfo extends AsyncLookup
{
    constructor({
        // The data this widget needs.  This can be:
        // - userId - Just the ID itself
        // - partial - Partial user info.
        // - full - Full user info.  This is less likely to be available from cache.
        //
        //   This can be mediaId (nothing but the ID), full or partial.
        //
        // This can change dynamically.  Some widgets need media info only when viewing a manga
        // page.
        neededData="full",

        ...options
    })
    {
        super({...options});

        this._neededData = neededData;
        if(!(this._neededData instanceof Function))
            this._neededData = () => neededData;

        // Refresh when the user data changes.  We don't watch for changes to media IDs since
        // we don't expect the user for an image to change.
        ppixiv.userCache.addEventListener("usermodified", (e) => {
            if(e.userId == this._id)
                this.refresh();
        }, this._signal);
    }

    async _refreshInner()
    {
        if(this.hasShutdown)
            return;

        let userId = this._id;
        let info = { userId: this._id };
        
        // If we have a user ID and we want user info (not just the user ID itself), load it.
        let neededData = this._neededData();
        if(this._id != null && neededData != "userId")
        {
            let full = neededData == "full";

            // See if we have the data the widget wants already.
            info.userInfo = ppixiv.userCache.getUserInfoSync(this._id, { full });

            // If we need to load data, clear the widget while we load, so we don't show the old
            // data while we wait for data.  Skip this if we don't need to load, so we don't clear
            // and reset the widget.  This can give the widget an illust ID without data, which is
            // OK.
            if(info.userInfo == null)
            {
                await this._onrefresh(info);

                // Don't make API requests for data if we're not visible to the user.
                if(!this._loadWhileNotVisible && !this.actuallyVisibleRecursively)
                    return;

                info.userInfo = await ppixiv.userCache.getUserInfo(this._id, { full });
            }
        }

        // Stop if the media ID changed while we were async.
        if(this._id != userId)
            return;

        await this._onrefresh(info);
    }    
}

// Async lookups to get user IDs from media IDs.
//
// If a media ID is a user ("user:1234"), return it.  If it's an illust, look up the illust
// and return its author's user ID.
export class GetUserIdFromMediaId extends AsyncLookup
{
    constructor({
        ...options
    })
    {
        super({...options});

        this._id = null;
    }

    async _refreshInner()
    {
        let mediaId = this._id;
        this._info = { };
        
        if(this._id != null)
        {
            // If the media ID is a user ID, use it.
            let { type, id } = helpers.mediaId.parse(mediaId);
            if(type == "user")
                this._info.userId = id;
            else
            {
                // See if we can get media ID synchronously.
                let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(this._id, { full: false });
                this._info.userId = mediaInfo?.userId;

                if(this._info.userId == null)
                {
                    await this._onrefresh(this._info);

                    // Don't make API requests for data if we're not visible to the user.
                    if(!this._loadWhileNotVisible && !this.actuallyVisibleRecursively)
                        return;

                    mediaInfo = await ppixiv.mediaCache.getMediaInfo(this._id, { full: false });
                    this._info.userId = mediaInfo?.userId;
                }
            }
        }

        // Stop if the media ID changed while we were async.
        if(this._id != mediaId)
            return;

        await this._onrefresh(this._info);
    }    
}

export class AvatarWidget extends Widget
{
    constructor({
        // This is called when the follow dropdown visibility changes.
        dropdownvisibilitychanged=() => { },
        clickAction="dropdown",

        ...options
    }={})
    {
        super({...options, template: `
            <a href=# class=avatar-widget data-scroll-to-top>
                <canvas class=avatar></canvas>

                <div class=follow-icon>
                </div>
            </a>
        `});

        this.options = options;
        if(clickAction != "dropdown" && clickAction != "author")
            throw new Error(`Invalid avatar widget mode: ${clickAction}`);

        this.getUserInfo = new GetUserInfo({
            parent: this,
            onrefresh: (args) => this.onrefresh(args),
        });

        let avatarElement = this.root.querySelector(".avatar");
        let avatarLink = this.root;

        this.followDropdownOpener = new DropdownBoxOpener({
            button: avatarLink,
            onvisibilitychanged: dropdownvisibilitychanged,
            asDialog: ppixiv.mobile,
            createDropdown: ({...options}) => {
                return new FollowWidget({
                    ...options,
                    userId: this.userId,
                    close: () => this.followDropdownOpener.visible = false,
                });
            },
        });

        avatarLink.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if(clickAction == "dropdown")
                this.followDropdownOpener.visible = !this.followDropdownOpener.visible;
            else if(clickAction == "author")
            {
                let args = new helpers.args(`/users/${this.userId}#ppixiv`);
                helpers.navigate(args, { scrollToTop: true });
            }
        });

        // Clicking the avatar used to go to the user page, but now it opens the follow dropdown.
        // Allow doubleclicking it instead, to keep it quick to go to the user.
        avatarLink.addEventListener("dblclick", (e) => {
            e.preventDefault();
            e.stopPropagation();

            let args = new helpers.args(`/users/${this.userId}/artworks#ppixiv`);
            helpers.navigate(args, { scrollToTop: true });
        });

        // A canvas filter for the avatar.  This has no actual filters.  This is just to kill off any
        // annoying GIF animations in people's avatars.
        this.img = document.createElement("img");
        this._baseFilter = new ImageCanvasFilter(this.img, avatarElement);
        
        this.root.dataset.mode = this.options.mode;

        new CreepyEyeWidget({
            container: this.root.querySelector(".follow-icon"),
            pointerTarget: this.root,
        });
    }

    visibilityChanged()
    {
        super.visibilityChanged();

        this.refresh();
    }

    // Return the dropdown if it's open.
    get userDropdownWidget()
    {
        return this.followDropdownOpener.dropdown;
    }

    get userId()
    {
        return this.getUserInfo.id;
    }

    async setUserId(userId)
    {
        // Close the dropdown if the user is changing.
        if(this.getUserInfo.id != userId && this.followDropdownOpener)
            this.followDropdownOpener.visible = false;

        this.getUserInfo.id =  userId;
        this.refresh();
    }

    onrefresh({userId, userInfo})
    {
        if(userId == null || userId == -1)
        {
            // Set the avatar image to a blank image, so it doesn't flash the previous image
            // the next time we display it.  It should never do this, since we set a new image
            // before displaying it, but Chrome doesn't do this correctly at least with canvas.
            this.img.src = helpers.other.blankImage;
            return;
        }

        // If we've seen this user's profile image URL from thumbnail data, we can use it to
        // start loading the avatar without waiting for user info to finish loading.
        let cachedProfileUrl = ppixiv.mediaCache.userProfileUrls[userId];
        this.img.src = cachedProfileUrl ?? userInfo?.imageBig ?? helpers.other.blankImage;

        // Set up stuff that we don't need user info for.
        this.root.href = `/users/${userId}/artworks#ppixiv`;

        // Hide the popup in dropdown mode, since it covers the dropdown.
        if(this.options.mode == "dropdown")
            this.root.querySelector(".avatar").classList.remove("popup");

        // Clear stuff we need user info for, so we don't show old data while loading.
        helpers.html.setClass(this.root, "followed", false);
        this.root.querySelector(".avatar").dataset.popup = "";

        this.root.querySelector(".follow-icon").hidden = !(userInfo?.isFollowed ?? false);
        this.root.querySelector(".avatar").dataset.popup = userInfo?.name ?? "";
    }
};

// Filter an image to a canvas.
//
// When an image loads, draw it to a canvas of the same size, optionally applying filter
// effects.
//
// If baseFilter is supplied, it's a filter to apply to the top copy of the image.
// If overlay(ctx, img) is supplied, it's a function to draw to the canvas.  This can
// be used to mask the top copy.
class ImageCanvasFilter
{
    constructor(img, canvas, baseFilter, overlay)
    {
        this.img = img;
        this.canvas = canvas;
        this._baseFilter = baseFilter || "";
        this.overlay = overlay;
        this.ctx = this.canvas.getContext("2d");

        this.img.addEventListener("load", this._updateCanvas);

        // For some reason, browsers can't be bothered to implement onloadstart, a seemingly
        // fundamental progress event.  So, we have to use a mutation observer to tell when
        // the image is changed, to make sure we clear it as soon as the main image changes.
        this.observer = new MutationObserver((mutations) => {
            for(let mutation of mutations) {
                if(mutation.type == "attributes")
                {
                    if(mutation.attributeName == "src")
                    {
                        this._updateCanvas();
                    }
                }
            }
        });

        this.observer.observe(this.img, { attributes: true });
        
        this._updateCanvas();
    }

    clear()
    {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this._currentUrl = helpers.other.blankImage;
    }

    _updateCanvas = () =>
    {
        // The URL for the image we're rendering.  If the image isn't complete, use the blank image
        // URL instead, since we're just going to clear.
        let currentUrl = this.img.src;
        if(!this.img.complete)
            currentUrl = helpers.other.blankImage;

        if(currentUrl == this._currentUrl)
            return;

        helpers.html.setClass(this.canvas, "loaded", false);

        this.canvas.width = this.img.naturalWidth;
        this.canvas.height = this.img.naturalHeight;
        this.clear();

        this._currentUrl = currentUrl;

        // If we're rendering the blank image (or an incomplete image), stop.
        if(currentUrl == helpers.other.blankImage)
            return;

        // Draw the image onto the canvas.
        this.ctx.save();
        this.ctx.filter = this._baseFilter;
        this.ctx.drawImage(this.img, 0, 0);
        this.ctx.restore();

        // Composite on top of the base image.
        this.ctx.save();

        if(this.overlay)
            this.overlay(this.ctx, this.img);

        this.ctx.restore();
        
        // Use destination-over to draw the image underneath the overlay we just drew.
        this.ctx.globalCompositeOperation = "destination-over";
        this.ctx.drawImage(this.img, 0, 0);
        helpers.html.setClass(this.canvas, "loaded", true);
    }
}

// A pointless creepy eye.  Looks away from the mouse cursor when hovering over
// the unfollow button.
class CreepyEyeWidget extends Widget
{
    constructor({
        pointerTarget,
        ...options
    }={})
    {
        super({...options, template: `
            <ppixiv-inline src="resources/eye-icon.svg"></ppixiv-inline>
        `});

        pointerTarget.addEventListener("mouseover", this.onevent, { capture: true, ...this._signal });
        pointerTarget.addEventListener("mouseout", this.onevent, { capture: true, ...this._signal });
        pointerTarget.addEventListener("pointermove", this.onevent, { capture: true, ...this._signal });
    }

    onevent = (e) =>
    {

        // We're set to pointer-events: none so we don't steal clicks from our container, so we have
        // to figure out if the cursor is over us manually.
        let { left, top, right, bottom } = this.root.getBoundingClientRect();
        this.hover =
            left <= e.clientX && e.clientX <= right &&
            top <= e.clientY && e.clientY <= bottom;

        if(e.type == "mouseover")
            this.hover = true;
        if(e.type == "mouseout")
            this.hover = false;

        let eyeMiddle = this.root.querySelector(".middle");
        if(!this.hover)
        {
            eyeMiddle.style.transform = "";
            return;
        }
        let mouse = [e.clientX, e.clientY];

        let bounds = this.root.getBoundingClientRect();
        let eye = [bounds.x + bounds.width/2, bounds.y + bounds.height/2];

        let vectorLength = (vec) =>Math.sqrt(vec[0]*vec[0] + vec[1]*vec[1]);

        // Normalize to get a direction vector.
        let normalizeVector = (vec) =>
        {
            let length = vectorLength(vec);
            if(length < 0.0001)
                return [0,0];
            return [vec[0]/length, vec[1]/length];
        };

        let pos = [mouse[0] - eye[0], mouse[1] - eye[1]];
        pos = normalizeVector(pos);

        if(Math.abs(pos[0]) < 0.5)
        {
            let negative = pos[0] < 0;
            pos[0] = 0.5;
            if(negative)
                pos[0] *= -1;
        }
//        pos[0] = 1 - ((1-pos[0]) * (1-pos[0]));
        pos[0] *= -3;
        pos[1] *= -6;
        eyeMiddle.style.transform = "translate(" + pos[0] + "px, " + pos[1] + "px)";
    }
}

// Dropdown to follow and unfollow users
class FollowWidget extends Widget
{
    constructor({
        userId=null,

        // This is called if we want to close our container.
        close=() => { },
        ...options
    })
    {
        super({
            ...options, template: `
            <div class="follow-widget vertical-list">
                ${helpers.createBoxLink({ label: "", icon: "mat:palette", classes: ["view-posts"], dataset: {scrollToTop: true} })}

                <!-- Buttons for following, unfollowing, and changing privacy. -->
                ${helpers.createBoxLink({ label: "Follow", icon: "public", classes: ["follow-button-public"] })}
                ${helpers.createBoxLink({ label: "Follow privately", icon: "lock", classes: ["follow-button-private"] })}
                ${helpers.createBoxLink({ label: "Unfollow", icon: "delete", classes: ["unfollow-button"]})}

                ${helpers.createBoxLink({
                    label: "Change follow to private",
                    icon: "mat:hourglass_full",
                    classes: ["follow-placeholder", "disabled"],
                })}

                <!-- Buttons for toggling a follow between public and private.  This is separate
                    from the buttons above, since it comes after to make sure that the unfollow
                    button is above the toggle buttons. -->
                ${helpers.createBoxLink({ label: "Change follow to public", icon: "public",classes: ["toggle-follow-button-public"] })}
                ${helpers.createBoxLink({ label: "Change follow to private",icon: "lock", classes: ["toggle-follow-button-private"] })}

                ${helpers.createBoxLink({ label: "Follow tags", icon: "mat:bookmark", classes: ["follow-tags", "premium-only"] })}
            </div>
        `});

        this.userId = userId;
        this.close = close;
        this.data = { };

        this.viewPosts = this.querySelector(".view-posts");
        this.root.querySelector(".follow-button-public").addEventListener("click", (e) => this._clickedFollow(false));
        this.root.querySelector(".follow-button-private").addEventListener("click", (e) => this._clickedFollow(true));
        this.root.querySelector(".toggle-follow-button-public").addEventListener("click", (e) => this._clickedFollow(false));
        this.root.querySelector(".toggle-follow-button-private").addEventListener("click", (e) => this._clickedFollow(true));
        this.root.querySelector(".unfollow-button").addEventListener("click", (e) => this._clickedUnfollow());

        // Refresh if the user we're displaying changes.
        ppixiv.userCache.addEventListener("usermodified", this._userChanged, this._signal);
        ppixiv.muting.addEventListener("mutes-changed", () => this.refresh(), this._signal);

        this.followTagDropdownOpener = new DropdownBoxOpener({
            button: this.querySelector(".follow-tags"),
            clickToOpen: true,
            createDropdown: ({...options}) => {
                return new FollowTagWidget({
                    ...options,
                    userId: this.userId,
                });
            },
        });

        this.loadUser();
    }

    _userChanged = ({userId}) =>
    {
        if(!this.visible || userId != this.userId)
            return;

        this.loadUser();
    };

    async loadUser()
    {
        if(!this.visible)
            return;

        // Refresh with no data.
        this.data = { };
        this.refresh();

        // If user info is already loaded, use it and refresh now, otherwise request it.
        let userInfo = ppixiv.userCache.getUserInfoSync(this.userId);
        if(userInfo)
            this.data.userInfo = userInfo;
        else
            userInfo = ppixiv.userCache.getUserInfo(this.userId);

        // Do the same for the user profile.  If we're requesting both of these, they'll run
        // in parallel.
        let userProfile = ppixiv.userCache.getUserProfileSync(this.userId);
        if(userProfile)
            this.data.userProfile = userProfile;
        else
            userProfile = ppixiv.userCache.getUserProfile(this.userId);

        // Refresh with any data we just got.  This usually fills in most of the dropdown quickly,
        // and we'll refresh for the rest.
        this.refresh();

        // We only want to request follow info if we're following.  If we already have user info,
        // request follow info, so we start this request earlier if we can.
        if(this.data.userInfo?.isFollowed)
            this._requestFollowInfo();

        // If we had to request the user info or profile, wait for them to complete and refresh again.
        if(userInfo)
            this.data.userInfo = await userInfo;
        if(userProfile)
            this.data.userProfile = await userProfile;

        // Refresh again now that we have user info and the profile.
        this.refresh();

        // In case we didn't have user info earlier, request follow info now.  It's OK for us to
        // do this twice (the request won't be duplicated).
        if(this.data.userInfo?.isFollowed)
            this._requestFollowInfo();

        // Request the user's Booth URL.  This won't start until we have follow info, so there's no
        // benefit to doing this earlier.
        this._requestBoothInfo();
    }

    // Request user follow info to find out if we're following publically or privately, and
    // refresh.
    async _requestFollowInfo()
    {
        let followInfo = await ppixiv.userCache.getUserFollowInfo(this.userId);
        this.data.followingPrivately = followInfo?.followingPrivately;
        this.refresh();
    }

    // Request the user's Booth link and refresh.
    async _requestBoothInfo()
    {
        this.data.boothUrl = await ppixiv.userCache.getUserBoothUrl(this.userId);
        this.refresh();
    }

    // Refresh the UI with as much data as we have.  This data comes in a bunch of little pieces,
    // so we get it incrementally.
    refresh()
    {
        this.viewPosts.href = `/users/${this.userId}#ppixiv`;

        let { followingPrivately=null, ...otherUserInfo } = this.data;
        if(!this.visible)
            return;

        let userInfo = ppixiv.userCache.getUserInfoSync(this.userId);
        this.viewPosts.querySelector(".label").textContent = userInfo?.name ?? "";

        let infoLinksContainer = this.root;
        for(let link of this.querySelectorAll(".info-link, .separator"))
            link.remove();

        if(userInfo)
        {
            let links = this._getInfoLinksForUser({userInfo, ...otherUserInfo});
            links = this._filterLinks(links);

            for(let {url, label, type, icon, disabled} of links)
            {
                if(type == "separator")
                {
                    let separator = document.createElement("div");
                    separator.classList.add("separator");
                    infoLinksContainer.appendChild(separator);
                    continue;
                }

                let button = helpers.createBoxLink({
                    asElement: true,
                    label,
                    icon,
                    link: url,
                    classes: ["info-link"],
                });
                if(disabled)
                    button.classList.add("disabled");

                if(type == "mute")
                {
                    button.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._clickedMute();
                    });
                }

                infoLinksContainer.appendChild(button);
            }
        }

        this.root.querySelector(".follow-button-public").hidden = true;
        this.root.querySelector(".follow-button-private").hidden = true;
        this.root.querySelector(".toggle-follow-button-public").hidden = true;
        this.root.querySelector(".toggle-follow-button-private").hidden = true;
        this.root.querySelector(".unfollow-button").hidden = true;
        this.root.querySelector(".follow-placeholder").hidden = true;

        let following = userInfo?.isFollowed;
        if(following != null)
        {
            if(following)
            {
                // If we know whether we're following privately or publically, we can show the
                // button to change the follow mode.  If we don't have that yet, we can only show
                // unfollow.
                if(followingPrivately != null)
                {
                    this.root.querySelector(".toggle-follow-button-public").hidden = !followingPrivately;
                    this.root.querySelector(".toggle-follow-button-private").hidden = followingPrivately;
                }
                else
                {
                    // If we don't know this yet, show a placeholder where the toggle button will go to
                    // prevent other entries from shifting around as we load.
                    this.root.querySelector(".follow-placeholder").hidden = false;
                }

                this.root.querySelector(".unfollow-button").hidden = false;
            }
            else
            {
                this.root.querySelector(".follow-button-public").hidden = false;
                this.root.querySelector(".follow-button-private").hidden = false;
            }
        }

        // If we've loaded follow tags, fill in the list.
        for(let element of this.root.querySelectorAll(".follow-tag"))
            element.remove();
    }

    async _clickedFollow(followPrivately)
    {
        this.close();

        await Actions.follow(this.userId, followPrivately);

        // The public/private follow state needs to be refreshed explicitly.
        this._requestFollowInfo();
    }

    async _clickedUnfollow()
    {
        this.close();

        // Confirm unfollowing when on mobile.
        if(ppixiv.mobile)
        {
            let userInfo = ppixiv.userCache.getUserInfoSync(this.userId);
            let result = await (new ConfirmPrompt({ header: userInfo? `Unfollow ${userInfo.name}?`:"Unfollow?" })).result;
            if(!result)
                return;
        }

        await Actions.unfollow(this.userId);
    }

    async _clickedMute()
    {
        if(ppixiv.muting.isUserIdMuted(this.userId))
            ppixiv.muting.unmuteUserId(this.userId);
        else
            await ppixiv.muting.addMute(this.userId, null, {type: "user"});
    }

    // Return info links for the given user.  This is used by data sources with contents
    // related to a specific user.
    _getInfoLinksForUser({ userInfo, userProfile, boothUrl }={})
    {
        if(userInfo == null)
            return [];

        let extraLinks = [];

        extraLinks.push({
            url: new URL(`/discovery/users#ppixiv?user_id=${userInfo.userId}`, ppixiv.plocation),
            type: "similar-artists",
            label: "Similar artists",
        });

        extraLinks.push({
            url: new URL(`/users/${userInfo.userId}/following#ppixiv`, ppixiv.plocation),
            type: "following-link",
            label: `View followed users`,
        });

        extraLinks.push({
            url: new URL(`/users/${userInfo.userId}/bookmarks/artworks#ppixiv`, ppixiv.plocation),
            type: "bookmarks-link",
            label: `View bookmarks`,
        });

        extraLinks.push({
            url: new URL(`/messages.php?receiver_id=${userInfo.userId}`, ppixiv.plocation),
            type: "contact-link",
            label: "Send a message",
        });

        let muted = ppixiv.muting.isUserIdMuted(userInfo.userId);
        extraLinks.unshift({
            type: "mute",
            label: `${muted? "Unmute":"Mute"} this user`,
            icon: "mat:block",
        });

        let acceptRequest = userProfile?.body?.request?.showRequestTab;
        if(acceptRequest)
        {
            extraLinks.push({
                url: new URL(`/users/${this.userId}/request#no-ppixiv`, ppixiv.plocation),
                type: "request",
                label: "Accepting requests",
            });
        }

        // Add a separator before user profile links.
        extraLinks.push({ type: "separator" });

        // Add entries from userInfo.social.
        let knownSocialKeys = {
            circlems: {
                label: "Circle.ms",
            },
        };

        let social = userInfo?.social ?? [];
        for(let [key, {url}] of Object.entries(social))
        {
            let data = knownSocialKeys[key] ?? { };
            data.label ??= helpers.strings.titleCase(key);
            extraLinks.push({ url, ...data });
        }

        // Set the webpage link.
        //
        // If the webpage link is on a known site, disable the webpage link and add this to the
        // generic links list, so it'll use the specialized icon.
        let webpageUrl = userInfo?.webpage;
        if(webpageUrl != null)
        {
            extraLinks.push({
                url: webpageUrl,
                label: "Webpage",
                type: this._findLinkImageType(webpageUrl) ?? "webpage-link",
            });
        }

        // Find any other links in the user's profile text.
        let div = document.createElement("div");
        div.innerHTML = userInfo.commentHtml;

        for(let link of div.querySelectorAll("a"))
        {
            let url = helpers.pixiv.fixPixivLink(link.href);
            
            try {
                url = new URL(url);
            } catch(e) {
                console.log("Couldn't parse profile URL:", url);
                continue;
            }

            // Figure out a label to use.
            let label = url.hostname;
            let imageType = this._findLinkImageType(url);
            if(imageType == "booth")
                label = "Booth";
            else if(imageType == "fanbox")
                label = "Fanbox";
            else if(label.startsWith("www."))
                label = label.substr(4);

            extraLinks.push({
                url,
                label,
            });
        }

        // See if there's a Fanbox link.
        //
        // For some reason Pixiv supports links to Twitter and Pawoo natively in the profile, but Fanbox
        // can only be linked in this weird way outside the regular user profile info.
        let pickups = userProfile?.body?.pickup ?? [];
        for(let pickup of pickups)
        {
            if(pickup.type != "fanbox")
                continue;

            // Remove the Google analytics junk from the URL.
            let url = new URL(pickup.contentUrl);
            url.search = "";
            extraLinks.push({url, type: "fanbox", label: "Fanbox"});
            break;
        }

        // Add the Booth link if we have one.  If we know there will be one but it's still loading,
        // add a placeholder so the menu doesn't move around when it finishes loading.
        if(boothUrl)
            extraLinks.push({url: boothUrl, label: "Booth"});
        else if(userProfile?.body?.externalSiteWorksStatus?.booth)
            extraLinks.push({url: window.location, label: "Booth", icon: "mat:hourglass_full", disabled: true});

        // Allow hooks to add additional links.
        window.vviewHooks?.addUserLinks?.({ extraLinks, userInfo, userProfile });

        return extraLinks;
    }

    // Fill in link icons and remove duplicates.
    _filterLinks(extraLinks)
    {
        // Map from link types to icons:
        let linkTypes = {
            // Generic types:
            ["default-icon"]: "ppixiv:link",
            ["shopping-cart"]: "mat:shopping_cart",
            ["webpage-link"]: "mat:home",
            ["commercial"]: "mat:paid",

            // Site-specific ones.  The distinction is mostly arbitrary, but this tries to
            // use mat:shopping_cart for sites where you purchase something specific, like
            // Booth and Amazon, and mat:paid for other types of paid things, like subscriptions
            // and commissions.
            ["posts"]: "mat:palette",
            ["twitter"]: "ppixiv:twitter",
            ["fanbox"]: "mat:paid",
            ["request"]: "mat:paid",

            ["booth"]: "mat:shopping_cart",

            ["twitch"]: "ppixiv:twitch",
            ["contact-link"]: "mat:mail",
            ["following-link"]: "mat:visibility",
            ["bookmarks-link"]: "mat:star",
            ["similar-artists"]: "ppixiv:suggestions",
            ["mute"]: "block",
        };

        // Sort 
        let filteredLinks = [];
        let seenLinks = {};
        let seenTypes = {};
        for(let {type, url, label, ...other} of extraLinks)
        {
            if(type == "separator")
            {
                filteredLinks.push({ type });
                continue;
            }
            
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
            type ??= this._findLinkImageType(url);
            type ??= "default-icon";

            // A lot of users have links duplicated in their profile and profile text.
            if(seenTypes[type] && type != "default-icon" && type != "shopping-cart" && type != "webpage-link")
                continue;

            seenTypes[type] = true;

            // Fill in the icon.
            let icon = linkTypes[type];

            // If this is a Twitter link, parse out the ID.  We do this here so this works
            // both for links in the profile text and the profile itself.
            if(type == "twitter")
            {
                let parts = url.pathname.split("/");
                label = parts.length > 1? ("@" + parts[1]):"Twitter";
            }

            filteredLinks.push({ url, type, icon, label, ...other });
        }

        // Remove the last entry if it's a separator with nothing to separate.
        if(filteredLinks.length && filteredLinks[filteredLinks.length-1].type == "separator")
            filteredLinks.splice(filteredLinks.length-1, 1);

        return filteredLinks;
    }

    _findLinkImageType(url)
    {
        url = new URL(url);

        let altIcons = {
            "shopping-cart": [
                "dlsite.com",
                "skeb.jp",
                "ko-fi.com",
                "dmm.co.jp",
            ],
            "commercial": [
                "fantia.jp",
            ],
            "twitter": [
                "twitter.com",
            ],
            "fanbox": [
                "fanbox.cc",
            ],
            "booth": [
                "booth.pm",
            ],
            "twitch": [
                "twitch.tv",
            ],
        };

        // Special case for old Fanbox URLs that were under the Pixiv domain.
        if((url.hostname == "pixiv.net" || url.hostname == "www.pixiv.net") && url.pathname.startsWith("/fanbox/"))
            return "fanbox";

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
};

// A dropdown to select follow tags.  This is in a separate submenu, since it
// needs to be loaded separately and it causes the top user menu to move around
// too much.  This also makes more sense if the user has lots of follow tags.
class FollowTagWidget extends Widget
{
    constructor({ userId, ...options })
    {
        super({
            ...options, template: `<div class=vertical-list></div>`
        });

        this.userId = userId;
        this.load();

        // Refresh if our user changes, so we update tag highlights as they're edited.
        ppixiv.userCache.addEventListener("usermodified", ({userId}) => {
            if(userId == this.userId)
                this.load();
        }, this._signal);
    }

    async load()
    {
        // Get user info to see if we're followed, get our full follow tag list, and any
        // tags this user is followed with.  This will all usually be in cache.
        let userInfo = await ppixiv.userCache.getUserInfo(this.userId);

        let selectedTags = new Set();
        if(userInfo?.isFollowed)
        {
            let followInfo = await ppixiv.userCache.getUserFollowInfo(this.userId);
            selectedTags = followInfo.tags;
        }

        let allTags = await ppixiv.userCache.loadAllUserFollowTags();

        let followTagList = this.root;
        helpers.html.removeElements(followTagList);

        let addTagButton = helpers.createBoxLink({
            label: "Add new tag",
            icon: "add_circle",
            classes: ["follow-tag"],
            asElement: true,
        });
        addTagButton.addEventListener("click", (e) => this._addFollowTag());
        followTagList.appendChild(addTagButton);

        allTags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        for(let tag of allTags)
        {
            let button = helpers.createBoxLink({
                label: tag,
                classes: ["follow-tag"],
                icon: "bookmark",
                asElement: true,
            });

            // True if the user is bookmarked with this tag.
            let selected = selectedTags.has(tag);
            helpers.html.setClass(button, "selected", selected);

            followTagList.appendChild(button);

            button.addEventListener("click", (e) => {
                this._toggleFollowTag(tag);
            });
        }
    }
    
    async _addFollowTag()
    {
        let prompt = new TextPrompt({ title: "New folder:" });
        let folder = await prompt.result;
        if(folder == null)
            return; // cancelled

        await this._toggleFollowTag(folder);
    }

    async _toggleFollowTag(tag)
    {
        // Make a copy of userId, in case it changes while we're async.
        let userId = this.userId;

        // If the user isn't followed, the first tag is added by following.
        let userData = await ppixiv.userCache.getUserInfo(userId);
        if(!userData.isFollowed)
        {
            // We're not following, so follow the user with default privacy and the
            // selected tag.
            await Actions.follow(userId, null, { tag });
            return;
        }

        // We're already following, so update the existing tags.
        let followInfo = await ppixiv.userCache.getUserFollowInfo(userId);
        if(followInfo == null)
        {
            console.log("Error retrieving follow info to update tags");
            return;
        }

        let tagWasSelected = followInfo.tags.has(tag);
        Actions.changeFollowTags(userId, {tag: tag, add: !tagWasSelected});
    }
}
