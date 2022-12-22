// This handles querying whether a tag or a user is muted.
//
// The "mutes-changed" event is fired here when any mute list is modified.

import { helpers } from 'vview/misc/helpers.js';

export default class Muting extends EventTarget
{
    constructor()
    {
        super();

        this._mutedTags = [];
        this._mutedUserIds = [];

        // This is used to tell other tabs when mutes change, so adding mutes takes effect without
        // needing to reload all other tabs.
        this._syncMutesChannel = new BroadcastChannel("ppixiv:mutes-changed");
        this._syncMutesChannel.addEventListener("message", this._receivedMessage);
    }

    get pixivMutedTags() { return this._mutedTags; }
    get pixivMutedUserIds() { return this._mutedUserIds; }

    // Set the list of tags and users muted via Pixiv's settings.
    setMutes({pixivMutedTags, pixivMutedUserIds}={})
    {
        if(pixivMutedTags == null && pixivMutedUserIds == null)
            return;

        if(pixivMutedTags != null)
            this._mutedTags = pixivMutedTags;
        if(pixivMutedUserIds != null)
            this._mutedUserIds = pixivMutedUserIds;

        this._storeMutes();
        this._fireMutesChanged();
    }

    // Extra mutes have a similar format to the /ajax/mute/items API:
    //
    // [{
    //     "type": "tag", // or user
    //     "value": "tag or user ID",
    //     "label": "tag or username"   
    // ]}
    get extraMutes()
    {
        return ppixiv.settings.get("extraMutes");
    }

    set extraMutes(mutedUsers)
    {
        ppixiv.settings.set("extraMutes", mutedUsers);
        this._fireMutesChanged();
    }

    // Shortcut to get just extra muted tags:
    get _extraMutedTags()
    {
        let tags = [];
        for(let mute of this.extraMutes)
            if(mute.type == "tag")
                tags.push(mute.value);
        return tags;
    }

    // Fire mutes-changed to let UI know that a mute list has changed.
    _fireMutesChanged()
    {
        // If either of these are null, we're still being initialized.  Don't fire events yet.
        if(this.pixivMutedTags == null || this.pixivMutedUserIds == null)
            return;

        this.dispatchEvent(new Event("mutes-changed"));

        // Tell other tabs that mutes have changed.
        this._broadcastMutes();
    }

    _broadcastMutes()
    {
        // Don't do this if we're inside _broadcastMutes because another tab sent this to us.
        if(this._handlingBroadcastMutes)
            return;

        this._syncMutesChannel.postMessage({
            pixivMutedTags: this.pixivMutedTags,
            pixivMutedUserIds: this.pixivMutedUserIds,
        });
    }

    _receivedMessage = (e) =>
    {
        let data = e.data;

        if(this._handlingBroadcastMutes)
        {
            console.error("recursive");
            return;
        }

        // Don't fire the event if nothing is actually changing.  This happens a lot when new tabs
        // are opened and they broadcast current mutes.
        if(JSON.stringify(this.pixivMutedTags) == JSON.stringify(data.pixivMutedTags) &&
           JSON.stringify(this.pixivMutedUserIds) == JSON.stringify(data.pixivMutedUserIds))
            return;
        
        this._handlingBroadcastMutes = true;
        try {
            this.setMutes({pixivMutedTags: data.pixivMutedTags, pixivMutedUserIds: data.pixivMutedUserIds});
        } finally {
            this._handlingBroadcastMutes = false;
        }
    };

    isUserIdMuted(user_id)
    {
        if(this._mutedUserIds.indexOf(user_id) != -1)
            return true;
        
        for(let {value: muted_user_id} of this.extraMutes)
        {
            if(user_id == muted_user_id)
                return true;
        }
        return false;
    };

    // Unmute user_id.
    //
    // This checks both Pixiv's unmute list and our own, so it can always be used if
    // isUserIdMuted is true.
    async unmuteUserId(user_id)
    {
        this.removeExtraMute(user_id, {type: "user"});

        if(this._mutedUserIds.indexOf(user_id) != -1)
            await this.removePixivMute(user_id, {type: "user"});
    }

    // Return true if any tag in tagList is muted.
    anyTagMuted(tagList)
    {
        let _extraMutedTags = this._extraMutedTags;

        for(let tag of tagList)
        {
            if(tag.tag)
                tag = tag.tag;
            if(this._mutedTags.indexOf(tag) != -1 || _extraMutedTags.indexOf(tag) != -1)
                return tag;
        }
        return null;
    }

    // Return true if the user is able to add to the Pixiv mute list.
    get _canAddPixivMutes()
    {
        // Non-premium users can only have one mute, and that's shared across both tags and users.
        let total_mutes = this.pixivMutedTags.length + this.pixivMutedUserIds.length;
        return ppixiv.pixivInfo.premium || total_mutes == 0;
    }

    // Pixiv doesn't include mutes in the initialization data for pages on mobile.  We load
    // it with an API call, but we don't want to wait for that to return and delay every page
    // load.  However, we also don't want to not have mute info and possibly show muted images
    // briefly on startup.  Work around this by caching mutes to storage, and using the cached
    // mutes while we're waiting to receive them.
    _storeMutes()
    {
        // This is only needed for mobile.
        if(!ppixiv.mobile)
            return;

        ppixiv.settings.set("cached_mutes", {
            tags: this._mutedTags,
            user_ids: this._mutedUserIds,
        });
    }

    // Load mutes cached by _storeMutes.  This is only used until we load the mute list, and
    // is only used on mobile.
    loadCachedMutes()
    {
        // This is only needed for mobile.
        if(!ppixiv.mobile)
            return;

        let cachedMutes = ppixiv.settings.get("cached_mutes");
        if(cachedMutes == null)
        {
            console.log("No cached mutes to load");
            return;
        }

        let { tags, user_ids } = cachedMutes;
        this._mutedTags = tags;
        this._mutedUserIds = user_ids;
    }

    // Request the user's mute list.  This is only used on mobile.
    async fetchMutes()
    {
        // Load the real mute list.
        let data = await helpers.getRequest(`/touch/ajax/user/self/status?lang=en`);
        if(data.error)
        {
            console.log("Error loading user info:", data.message);
            return;
        }

        let mutes = data.body.user_status.mutes;

        let pixivMutedTags = [];
        for(let [tag, info] of Object.entries(mutes.tags))
        {
            // "enabled" seems to always be true.
            if(info.enabled)
                pixivMutedTags.push(tag);
        }

        let pixivMutedUserIds = [];
        for(let [user_id, info] of Object.entries(mutes.users))
        {
            if(info.enabled)
            pixivMutedUserIds.push(user_id);
        }

        this.setMutes({pixivMutedTags, pixivMutedUserIds});
    }

    // If the user has premium, add to Pixiv mutes.  Otherwise, add to extra mutes.
    async addMute(value, label, {type})
    {
        if(ppixiv.pixivInfo.premium)
        {
            await this.addPixivMute(value, {type: type});
        }
        else
        {
            if(type == "user" && label == null)
            {
                // We need to know the user's username to add to our local mute list.
                let user_data = await ppixiv.userCache.getUserInfo(value);
                label = user_data.name;
            }
            
            await this.addExtraMute(value, label, {type: type});
        }
    }

    // Mute a user or tag using the Pixiv mute list.  type must be "tag" or "user".
    async addPixivMute(value, {type})
    {
        console.log(`Adding ${value} to the Pixiv ${type} mute list`);

        if(!this._canAddPixivMutes)
        {
            ppixiv.message.show("The Pixiv mute list is full.");
            return;
        }

        // Stop if the value is already in the list.
        let muteList = type == "tag"? "pixivMutedTags":"pixivMutedUserIds";
        let mutes = this[muteList];

        if(mutes.indexOf(value) != -1)
            return;

        // Get the label.  If this is a tag, the label is the same as the tag, otherwise
        // get the user's username.  We only need this for the message we'll display at the
        // end.
        let label = value;
        if(type == "user")
            label = (await ppixiv.userCache.getUserInfo(value)).name;

        // Note that this doesn't return an error if the mute list is full.  It returns success
        // and silently does nothing.
        let result = await helpers.rpcPostRequest("/ajax/mute/items/add", {
            context: "illust",
            type: type,
            value: value,
        });

        if(result.error)
        {
            ppixiv.message.show(result.message);
            return;
        }

        // The API call doesn't return the updated list, so we have to update it manually.
        mutes.push(value);

        // Pixiv sorts the muted tag list, so mute it here to match.
        if(type == "tag")
            mutes.sort();

        let update = { };
        update[muteList] = mutes;
        this.setMutes(update);

        ppixiv.message.show(`Muted the ${type} ${label}`);
    }

    // Remove item from the Pixiv mute list.  type must be "tag" or "user".
    async removePixivMute(value, {type})
    {
        console.log(`Removing ${value} from the Pixiv muted ${type} list`);

        // Get the label.  If this is a tag, the label is the same as the tag, otherwise
        // get the user's username.  We only need this for the message we'll display at the
        // end.
        let label = value;
        if(type == "user")
            label = (await ppixiv.userCache.getUserInfo(value)).name;

        let result = await helpers.rpcPostRequest("/ajax/mute/items/delete", {
            context: "illust",
            type: type,
            value: value,
        });

        if(result.error)
        {
            ppixiv.message.show(result.message);
            return;
        }

        // The API call doesn't return the updated list, so we have to update it manually.
        let muteList = type == "tag"? "pixivMutedTags":"pixivMutedUserIds";
        let mutes = this[muteList];
        let idx = mutes.indexOf(value);
        if(idx != -1)
            mutes.splice(idx, 1);

        let update = { };
        update[muteList] = mutes;
        this.setMutes(update);

        ppixiv.message.show(`Unmuted the ${type} ${label}`);
    }
    
    // value is a tag name or user ID.  label is the tag or username.  type must be
    // "tag" or "user".
    async addExtraMute(value, label, {type})
    {
        console.log(`Adding ${value} (${label}) to the extra muted ${type} list`);

        // Stop if the item is already in the list.
        let mutes = this.extraMutes;
        for(let {value: muted_value, type: muted_type} of mutes)
            if(value == muted_value && type == muted_type)
            {
                console.log("Item is already muted");
                return;
            }
        
        mutes.push({
            type: type,
            value: value,
            label: label,
        });
        mutes.sort((lhs, rhs) => { return lhs.label.localeCompare(rhs.label); });
        this.extraMutes = mutes;
        ppixiv.message.show(`Muted the ${type} ${label}`);
    }

    async removeExtraMute(value, {type})
    {
        console.log(`Removing ${value} from the extra muted ${type} list`);

        let mutes = this.extraMutes;

        for(let idx = 0; idx < mutes.length; ++idx)
        {
            let mute = mutes[idx];
            if(mute.type == type && mute.value == value)
            {
                ppixiv.message.show(`Unmuted the ${mute.type} ${mute.label}`);
                mutes.splice(idx, 1);
                break;
            }
        }

        this.extraMutes = mutes;
    }
}
