import Widget from 'vview/widgets/widget.js';
import Actions from 'vview/misc/actions.js';
import { DropdownBoxOpener } from 'vview/widgets/dropdown.js';
import { TextPrompt } from 'vview/widgets/prompts.js';
import { helpers } from 'vview/misc/helpers.js';

export class AvatarWidget extends Widget
{
    constructor({
        // If true, show the big avatar instead of the small one.
        big=false,

        // If true, handle clicks and show the follow dropdown.  If false, this is just an
        // avatar image.
        interactive=true,

        // This is called when the follow dropdown visibility changes.
        dropdownvisibilitychanged=() => { },

        ...options
    }={})
    {
        super({...options, template: `
            <div class=avatar-widget-follow-container>
                <a href=# class=avatar-link>
                    <canvas class=avatar></canvas>

                    <div class=follow-icon>
                        <ppixiv-inline src="resources/eye-icon.svg"></ppixiv-inline>
                    </div>
                </a>
            </div>
        `});

        this.options = options;
        if(this.options.mode != "dropdown" && this.options.mode != "overlay")
            throw "Invalid avatar widget mode";

        helpers.html.setClass(this.container, "big", big);

        ppixiv.userCache.addEventListener("usermodified", this._userChanged, { signal: this.shutdownSignal.signal });

        let avatarElement = this.container.querySelector(".avatar");
        let avatarLink = this.container.querySelector(".avatar-link");

        if(interactive)
        {
            this.followDropdownOpener = new DropdownBoxOpener({
                button: avatarLink,
                onvisibilitychanged: dropdownvisibilitychanged,
                createBox: ({...options}) => {
                    return new FollowWidget({
                        ...options,
                        userId: this.userId,
                    });
                },
            });

            avatarLink.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.followDropdownOpener.visible = !this.followDropdownOpener.visible;
            }, {
                // Hack: capture this event so we get clicks even over the eye widget.  We can't
                // set it to pointer-events: none since it reacts to mouse movement.
                capture: true,
            });

            // Clicking the avatar used to go to the user page, but now it opens the follow dropdown.
            // Allow doubleclicking it instead, to keep it quick to go to the user.
            avatarLink.addEventListener("dblclick", (e) => {
                e.preventDefault();
                e.stopPropagation();

                let args = new helpers.args(`/users/${this.userId}/artworks#ppixiv`);
                helpers.navigate(args);
            });
        }

        // A canvas filter for the avatar.  This has no actual filters.  This is just to kill off any
        // annoying GIF animations in people's avatars.
        this.img = document.createElement("img");
        this._baseFilter = new ImageCanvasFilter(this.img, avatarElement);
        
        this.container.dataset.mode = this.options.mode;

        // Show the favorite UI when hovering over the avatar icon.
        let avatarPopup = this.container; //container.querySelector(".avatar-popup");
        if(this.options.mode == "dropdown")
        {
            avatarPopup.addEventListener("mouseover", (e) => { helpers.html.setClass(avatarPopup, "popup-visible", true); });
            avatarPopup.addEventListener("mouseout", (e) => { helpers.html.setClass(avatarPopup, "popup-visible", false); });
        }

        new CreepyEyeWidget({
            container: this.container.querySelector(".follow-icon .eye-image")
        });
    }

    visibilityChanged()
    {
        super.visibilityChanged();

        this.refresh();
    }

    // Refresh when the user changes.
    _userChanged = ({user_id}) =>
    {
        if(this.userId == null || this.userId != user_id)
            return;

        this.setUserId(this.userId);
    }

    async setUserId(user_id)
    {
        // Close the dropdown if the user is changing.
        if(this.userId != user_id && this.followDropdownOpener)
            this.followDropdownOpener.visible = false;

        this.userId = user_id;
        this.refresh();
    }

    async refresh()
    {
        if(this.userId == null || this.userId == -1)
        {
            this.userData = null;
            this.container.classList.add("loading");

            // Set the avatar image to a blank image, so it doesn't flash the previous image
            // the next time we display it.  It should never do this, since we set a new image
            // before displaying it, but Chrome doesn't do this correctly at least with canvas.
            this.img.src = helpers.other.blankImage;
            return;
        }

        // If we've seen this user's profile image URL from thumbnail data, start loading it
        // now.  Otherwise, we'll have to wait until user info finishes loading.
        let cachedProfileUrl = ppixiv.mediaCache.userProfileUrls[this.userId];
        if(cachedProfileUrl)
            this.img.src = cachedProfileUrl;

        // Set up stuff that we don't need user info for.
        this.container.querySelector(".avatar-link").href = `/users/${this.userId}/artworks#ppixiv`;

        // Hide the popup in dropdown mode, since it covers the dropdown.
        if(this.options.mode == "dropdown")
            this.container.querySelector(".avatar").classList.remove("popup");

        // Clear stuff we need user info for, so we don't show old data while loading.
        helpers.html.setClass(this.container, "followed", false);
        this.container.querySelector(".avatar").dataset.popup = "";

        this.container.classList.remove("loading");
        this.container.querySelector(".follow-icon").hidden = true;

        let userData = await ppixiv.userCache.getUserInfo(this.userId);
        this.userData = userData;
        if(userData == null)
            return;

        this.container.querySelector(".follow-icon").hidden = !this.userData.isFollowed;
        this.container.querySelector(".avatar").dataset.popup = this.userData.name;

        // If we don't have an image because we're loaded from a source that doesn't give us them,
        // just hide the avatar image.
        let key = "imageBig";
        if(this.userData[key])
            this.img.src = this.userData[key];
        else
            this.img.src = helpers.other.blankImage;
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
        ...options
    }={})
    {
        super({...options, template: `
            <ppixiv-inline src="resources/eye-icon.svg"></ppixiv-inline>
        `});

        this.container.addEventListener("mouseenter", this.onevent);
        this.container.addEventListener("mouseleave", this.onevent);
        this.container.addEventListener("mousemove", this.onevent);
    }

    onevent = (e) =>
    {
        if(e.type == "mouseenter")
            this.hover = true;
        if(e.type == "mouseleave")
            this.hover = false;

        let eyeMiddle = this.container.querySelector(".middle");

        if(!this.hover)
        {
            eyeMiddle.style.transform = "";
            return;
        }
        let mouse = [e.clientX, e.clientY];

        let bounds = this.container.getBoundingClientRect();
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
        ...options
    })
    {
        super({
            ...options, template: `
            <div class="follow-container vertical-list">
                ${helpers.createBoxLink({
                    label: "View posts",
                    icon: "image",
                    classes: ["view-posts"],
                })}

                <!-- Buttons for following and unfollowing: -->
                ${helpers.createBoxLink({
                    label: "Follow",
                    icon: "public",
                    classes: ["follow-button-public"],
                })}

                ${helpers.createBoxLink({
                    label: "Follow privately",
                    icon: "lock",
                    classes: ["follow-button-private"],
                })}

                ${helpers.createBoxLink({
                    label: "Unfollow",
                    icon: "delete",
                    classes: ["unfollow-button"],
                })}

                <!-- Buttons for toggling a follow between public and private.  This is separate
                     from the buttons above, since it comes after to make sure that the unfollow
                     button is above the toggle buttons. -->
                ${helpers.createBoxLink({
                    label: "Change to public",
                    icon: "public",
                    classes: ["toggle-follow-button-public"],
                })}

                ${helpers.createBoxLink({
                    label: "Change to private",
                    icon: "lock",
                    classes: ["toggle-follow-button-private"],
                })}

                <!-- A separator before follow tags.  Hide this if the user doesn't have premium,
                     since he won't have access to tags and this will be empty. -->
                <div class="separator premium-only"><div></div></div>

                ${helpers.createBoxLink({
                    label: "Add new tag",
                    icon: "add_circle",
                    classes: ["premium-only", "add-follow-tag"],
                })}

                <vv-container class=follow-tag-list></vv-container>
            </div>
        `});

        this._userId = userId;

        this.container.querySelector(".follow-button-public").addEventListener("click", (e) => this._clickedFollow(false));
        this.container.querySelector(".follow-button-private").addEventListener("click", (e) => this._clickedFollow(true));
        this.container.querySelector(".toggle-follow-button-public").addEventListener("click", (e) => this._clickedFollow(false));
        this.container.querySelector(".toggle-follow-button-private").addEventListener("click", (e) => this._clickedFollow(true));
        this.container.querySelector(".unfollow-button").addEventListener("click", (e) => this._clickedUnfollow());
        this.container.querySelector(".add-follow-tag").addEventListener("click", (e) => this._addFollowTag());

        // Refresh if the user we're displaying changes.
        ppixiv.userCache.addEventListener("usermodified", this._userChanged, this._signal);
    }

    _userChanged = ({user_id}) =>
    {
        if(!this.visible || user_id != this.userId)
            return;

        this.refresh();
    };

    set userId(value)
    {
        if(this._userId == value)
            return;

        this._userId = value;
        if(value == null)
            this.visible = false;
    }
    get userId() { return this._userId; }

    async refresh()
    {
        if(!this.visible)
            return;

        if(this.refreshing)
        {
            console.error("Already refreshing");
            return;
        }

        this.refreshing = true;
        try {
            if(this._userId == null)
            {
                console.log("Follow widget has no user ID");
                return;
            }
            
            // Refresh with no data.
            this._refreshWithData();

            // Refresh with whether we're followed or not, so the follow/unfollow UI is
            // displayed as early as possible.
            let userInfo = await ppixiv.userCache.getUserInfo(this.userId);
            if(!this.visible)
                return;

            this._refreshWithData({ userInfo, following: userInfo.isFollowed });
            
            if(!userInfo.isFollowed)
            {
                // We're not following, so just load the follow tag list.
                let allTags = await ppixiv.userCache.loadAllUserFollowTags();
                this._refreshWithData({ userInfo, following: userInfo.isFollowed, allTags, selectedTags: new Set() });
                return;
            }

            // Get full follow info to find out if the follow is public or private, and which
            // tags are selected.
            let followInfo = await ppixiv.userCache.getUserFollowInfo(this.userId);
            let allTags = await ppixiv.userCache.loadAllUserFollowTags();
            this._refreshWithData({userInfo, following: true, followingPrivately: followInfo?.followingPrivately, allTags, selectedTags: followInfo?.tags});
        } finally {
            this.refreshing = false;
        }
    }

    // Refresh the UI with as much data as we have.  This data comes in a bunch of little pieces,
    // so we get it incrementally.
    _refreshWithData({userInfo=null, following=null, followingPrivately=null, allTags=null, selectedTags=null}={})
    {
        if(!this.visible)
            return;

        this.container.querySelector(".follow-button-public").hidden = true;
        this.container.querySelector(".follow-button-private").hidden = true;
        this.container.querySelector(".toggle-follow-button-public").hidden = true;
        this.container.querySelector(".toggle-follow-button-private").hidden = true;
        this.container.querySelector(".unfollow-button").hidden = true;
        this.container.querySelector(".add-follow-tag").hidden = true;
        this.container.querySelector(".separator").hidden = true;
        
        let viewText = userInfo != null? `View ${userInfo.name}'s posts`:`View posts`;
        this.container.querySelector(".view-posts .label").innerText = viewText;
        this.container.querySelector(".view-posts").href = `/users/${this._userId}/artworks#ppixiv`;

        // If following is null, we're still waiting for the initial user data request
        // and we don't have any data yet.  
        if(following == null)
            return;

        if(following)
        {
            // If we know whether we're following privately or publically, we can show the
            // button to change the follow mode.  If we don't have that yet, we can only show
            // unfollow.
            if(followingPrivately != null)
            {
                this.container.querySelector(".toggle-follow-button-public").hidden = !followingPrivately;
                this.container.querySelector(".toggle-follow-button-private").hidden = followingPrivately;
            }

            this.container.querySelector(".unfollow-button").hidden = false;
        }
        else
        {
            this.container.querySelector(".follow-button-public").hidden = false;
            this.container.querySelector(".follow-button-private").hidden = false;
        }

        // If we've loaded follow tags, fill in the list.
        for(let element of this.container.querySelectorAll(".follow-tag"))
            element.remove();

        if(allTags != null)
        {
            // Show the separator and "add tag" button once we have the tag list.
            this.container.querySelector(".add-follow-tag").hidden = false;
            this.container.querySelector(".separator").hidden = false;

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

                this.container.appendChild(button);

                button.addEventListener("click", (e) => {
                    this._toggleFollowTag(tag);
                });
            }
        }
    }

    async _clickedFollow(followPrivately)
    {
        await Actions.follow(this._userId, followPrivately);
    }

    async _clickedUnfollow()
    {
        await Actions.unfollow(this._userId);
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
};
