// The "Muted Users" and "Muted Tags" settings pages.

import Widget from 'vview/widgets/widget.js';
import { TextPrompt } from 'vview/widgets/prompts.js';
import DialogWidget from 'vview/widgets/dialog.js';
import { helpers } from 'vview/misc/helpers.js';

export class EditMutedTagsWidget extends Widget
{
    constructor({
        muteType, // "tags" or "users"
        ...options})
    {
        super({...options, template: `
            <div class=muted-tags-popup>
                <span class=add-muted-user-box>
                    Users can be muted from their user page, or by right-clicking an image and clicking
                    ${ helpers.createIcon("settings") }.
                </span>

                <span class=non-premium-mute-warning>
                    ${ helpers.createBoxLink({label: "Note",      icon: "warning",  classes: ["mute-warning-button"] }) }
                </span>

                <div class=mute-warning>
                    <div>
                        You can mute any number of tags and users.
                    </div>
                    <p>
                    <div>
                        However, since you don't have Premium, mutes will only be saved in your browser
                        and can't be saved to your Pixiv account.  They will be lost if you change
                        browsers or clear site data.
                    </div>
                </div>

                <div class=add-muted-tag-box> <!-- prevent full-line button styling -->
                    ${ helpers.createBoxLink({label: "Add",      icon: "add",  classes: ["add-muted-tag"] }) }
                </div>

                <div class=mute-list></div>
            </div>
        `});

        this._muteType = muteType;

        this.root.querySelector(".add-muted-tag-box").hidden = muteType != "tag";
        this.root.querySelector(".add-muted-user-box").hidden = muteType != "user";
        this.root.querySelector(".add-muted-tag").addEventListener("click", this._clickedAddMutedTag);
        this.root.querySelector(".mute-warning-button").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            let muteWarning = this.root.querySelector(".mute-warning");
            muteWarning.hidden = !muteWarning.hidden;
        });

        // Hide the warning for non-premium users if the user does have premium.
        this.root.querySelector(".non-premium-mute-warning").hidden = ppixiv.pixivInfo.premium;
    }

    visibilityChanged()
    {
        super.visibilityChanged();

        if(this.visible)
        {
            this.root.querySelector(".mute-warning").hidden = true;
            this.refresh();
        }

        // Clear the username cache when we're hidden, so we'll re-request it the next time
        // we're viewed.
        if(!this.visible)
            this._clearMutedUserIdCache();
    }

    refresh = async() =>
    {
        if(!this.visible)
            return;

        if(this._muteType == "tag")
            await this._refreshForTags();
        else
            await this._refrehsForUsers();
    }

    createEntry()
    {
        return this.createTemplate({name: "muted-tag-entry", html: `
            <div class=muted-tag>
                <a href=# class="remove-mute clickable">
                    ${ helpers.createIcon("delete") }
                </a>
                <span class=tag-name></span>
            </div>
        `});
    }

    _refreshForTags = async() =>
    {
        // Do a batch lookup of muted tag translations.
        let tagsToTranslate = [...ppixiv.muting.pixivMutedTags];
        for(let mute of ppixiv.muting.extraMutes)
        {
            if(mute.type == "tag")
                tagsToTranslate.push(mute.value);
        }

        let translatedTags = await ppixiv.tagTranslations.getTranslations(tagsToTranslate);

        let createMutedTagEntry = (tag, tagListContainer) =>
        {
            let entry = this.createEntry();
            entry.dataset.tag = tag;

            let label = tag;
            let tagTranslation = translatedTags[tag];
            if(tagTranslation)
                label = `${tagTranslation} (${tag})`;
            entry.querySelector(".tag-name").innerText = label;
            tagListContainer.appendChild(entry);

            return entry;
        };

        let mutedTagList = this.root.querySelector(".mute-list");
        helpers.html.removeElements(mutedTagList);
        for(let {type, value: tag} of ppixiv.muting.extraMutes)
        {
            if(type != "tag")
                continue;
            let entry = createMutedTagEntry(tag, mutedTagList);

            entry.querySelector(".remove-mute").addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                ppixiv.muting.removeExtraMute(tag, {type: "tag"});
                this.refresh();
            });
        }

        for(let tag of ppixiv.muting.pixivMutedTags)
        {
            let entry = createMutedTagEntry(tag, mutedTagList);

            entry.querySelector(".remove-mute").addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();

                await ppixiv.muting.removePixivMute(tag, {type: "tag"});
                this.refresh();
            });
        }
    }

    _refrehsForUsers = async() =>
    {
        let createMutedTagEntry = (userId, username, tagListContainer) =>
        {
            let entry = this.createEntry();
            entry.dataset.userId = userId;

            entry.querySelector(".tag-name").innerText = username;
            tagListContainer.appendChild(entry);

            return entry;
        };

        let mutedUserList = this.root.querySelector(".mute-list");
        helpers.html.removeElements(mutedUserList);

        for(let {type, value: userId, label: username} of ppixiv.muting.extraMutes)
        {
            if(type != "user")
                continue;
    
            let entry = createMutedTagEntry(userId, username, mutedUserList);

            entry.querySelector(".remove-mute").addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                ppixiv.muting.removeExtraMute(userId, {type: "user"});
                this.refresh();
            });
        }

        // We already know the muted user IDs, but we need to load the usernames for display.
        // If we don't have this yet, start the load and refresh once we have it.
        let userIdToUsername = this._cachedMutedUserIdToUsername;
        if(userIdToUsername == null)
        {
            this._getMutedUserIdToUsername().then(() => {
                console.log("Refreshing after muted user load");
                this.refresh();
            });
        }
        else
        {
            // Now that we have usernames, Sort Pixiv mutes by username.
            let mutes = ppixiv.muting.pixivMutedUserIds;
            mutes.sort((lhs, rhs) => {
                lhs = userIdToUsername[lhs] || "";
                rhs = userIdToUsername[rhs] || "";
                return lhs.localeCompare(rhs);
            });

            for(let userId of mutes)
            {
                let entry = createMutedTagEntry(userId, userIdToUsername[userId], mutedUserList);

                entry.querySelector(".remove-mute").addEventListener("click", async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    await ppixiv.muting.removePixivMute(userId, {type: "user"});
                    this.refresh();
                });
            }
        }
    }

    _clearMutedUserIdCache()
    {
        this._cachedMutedUserIdToUsername = null;
    }

    // Return a dictionary of muted user IDs to usernames.
    _getMutedUserIdToUsername()
    {
        // If this completed previously, just return the cached results.
        if(this._cachedMutedUserIdToUsername)
            return this._cachedMutedUserIdToUsername;
            
        // If this is already running, return the existing promise and don't start another.
        if(this._mutedUserIdToUsernamePromise)
            return this._mutedUserIdToUsernamePromise;

        let promise = this._getMutedUserIdToUsernameInner();
        this._mutedUserIdToUsernamePromise = promise;
        this._mutedUserIdToUsernamePromise.finally(() => {
            // Clear _mutedUserIdToUsernamePromise when it finishes.
            if(this._mutedUserIdToUsernamePromise == promise)
                this._mutedUserIdToUsernamePromise = null;
        });
        return this._mutedUserIdToUsernamePromise;
    }

    async _getMutedUserIdToUsernameInner()
    {
        // Users muted with Pixiv.  We already have the list, but we need to make an API
        // request to get usernames to actually display.
        let result = await helpers.pixivRequest.get("/ajax/mute/items", { context: "setting" });
        if(result.error)
        {
            ppixiv.message.show(result.message);
            this._cachedMutedUserIdToUsername = {};
            return this._cachedMutedUserIdToUsername;
        }

        let userIdToUsername = {};
        for(let item of result.body.mute_items)
        {
            // We only care about user mutes here.
            if(item.type == "user")
                userIdToUsername[item.value] = item.label;
        }

        this._cachedMutedUserIdToUsername = userIdToUsername;
        return this._cachedMutedUserIdToUsername;
    }

    // Add to our muted tag list.
    _clickedAddMutedTag = async (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        let prompt = new TextPrompt({ title: "Tag to mute:" });
        let tag = await prompt.result;
        if(tag == null || tag == "")
            return; // cancelled

        // If the user has premium, use the regular Pixiv mute list.  Otherwise, add the tag
        // to extra mutes.  We never add anything to the Pixiv mute list for non-premium users,
        // since it's limited to only one entry.
        if(ppixiv.pixivInfo.premium)
            await ppixiv.muting.addPixivMute(tag, {type: "tag"});
        else
            await ppixiv.muting.addExtraMute(tag, tag, {type: "tag"});
        this.refresh();
    };
}

// A popup for editing mutes related for a post (the user and the post's tags).
export class MutedTagsForPostDialog extends DialogWidget
{
    constructor({
        mediaId,
        userId,
        ...options})
    {
        super({...options, classes: "muted-tags-popup", header: "Edit mutes", dialogType: "small", template: `
            <div style="display: flex; align-items: center;">
                <span class=non-premium-mute-warning>
                    ${ helpers.createBoxLink({label: "Note",      icon: "warning",  classes: ["mute-warning-button", "clickable"] }) }
                </span>
            </div>

            <div class=mute-warning hidden>
                <div>
                    You can mute any number of tags and users.
                </div>
                <p>
                <div>
                    However, since you don't have Premium, mutes will only be saved in your browser
                    and can't be saved to your Pixiv account.  They will be lost if you change
                    browsers or clear site data.
                </div>
            </div>

            <div class=post-mute-list></div>
        `});

        this._mediaId = mediaId;
        this._userId = userId;

        this.root.querySelector(".close-button").addEventListener("click", (e) => {
            this.shutdown();
        }, { signal: this.shutdownSignal.signal });

        this.root.querySelector(".mute-warning-button").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            let muteWarning = this.root.querySelector(".mute-warning");
            muteWarning.hidden = !muteWarning.hidden;

        });

        // Hide the warning for non-premium users if the user does have premium.
        this.root.querySelector(".non-premium-mute-warning").hidden = ppixiv.pixivInfo.premium;

        this.refresh();
    }
    
    refresh = async() =>
    {
        if(this._mediaId != null)
        {
            // We have a media ID.  Load its info to get the tag list, and use the user ID and
            // username from it.
            let mediaInfo = await ppixiv.mediaCache.getMediaInfo(this._mediaId, { full: false });
            await this._refreshForData(mediaInfo.tagList, mediaInfo.userId, mediaInfo.userName);
        }
        else
        {
            // We only have a user ID, so look up the user to get the username.  Don't display
            // any tags.
            let userInfo = await ppixiv.userCache.getUserInfo(this._userId);
            await this._refreshForData([], this._userId, userInfo.name);
        }       
    }

    async _refreshForData(tags, userId, username)
    {
        // Do a batch lookup of muted tag translations.
        let translatedTags = await ppixiv.tagTranslations.getTranslations(tags);

        let createEntry = (label, isMuted) =>
        {
            let entry = this.createTemplate({name: "muted-tag-or-user-entry", html: `
                <div class=entry>
                    ${ helpers.createBoxLink({label: "Mute",      classes: ["toggle-mute"] }) }
                    <span class=tag-name></span>
                </div>
            `});

            helpers.html.setClass(entry, "muted", isMuted);
            entry.querySelector(".toggle-mute .label").innerText = isMuted? "Muted":"Mute";
            entry.querySelector(".tag-name").innerText = label;
            mutedList.appendChild(entry);

            return entry;
        };    
    
        let mutedList = this.root.querySelector(".post-mute-list");
        helpers.html.removeElements(mutedList);

        // Add an entry for the user.
        {
            let isMuted = ppixiv.muting.isUserIdMuted(userId);
            let entry = createEntry(`User: ${username}`, isMuted);

            entry.querySelector(".toggle-mute").addEventListener("click", async (e) => {
                if(isMuted)
                {
                    ppixiv.muting.removeExtraMute(userId, {type: "user"});
                    await ppixiv.muting.removePixivMute(userId, {type: "user"});
                } else {
                    await ppixiv.muting.addMute(userId, username, {type: "user"});
                }
                
                this.refresh();
            });
        }

        // Add each tag on the image.
        for(let tag of tags)
        {
            let isMuted = ppixiv.muting.anyTagMuted([tag]);

            let label = tag;
            let tagTranslation = translatedTags[tag];
            if(tagTranslation)
                label = `${tagTranslation} (${tag})`;

            let entry = createEntry(label, isMuted);

            entry.querySelector(".toggle-mute").addEventListener("click", async (e) => {
                if(isMuted)
                {
                    ppixiv.muting.removeExtraMute(tag, {type: "tag"});
                    await ppixiv.muting.removePixivMute(tag, {type: "tag"});
                } else {
                    await ppixiv.muting.addMute(tag, tag, {type: "tag"});
                }

                this.refresh();
            });
        }
    }
}
