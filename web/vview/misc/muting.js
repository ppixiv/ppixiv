// This handles querying whether a tag or a user is muted.
//
// The "mutes-changed" event is fired here when any mute list is modified.

import { helpers } from 'vview/misc/helpers.js';

export default class Muting extends EventTarget
{
    constructor()
    {
        super();

        this.muted_tags = [];
        this.muted_user_ids = [];

        // This is used to tell other tabs when mutes change, so adding mutes takes effect without
        // needing to reload all other tabs.
        this.sync_mutes_channel = new BroadcastChannel("ppixiv:mutes-changed");
        this.sync_mutes_channel.addEventListener("message", this.received_message);
    }

    get pixiv_muted_tags() { return this.muted_tags; }
    get pixiv_muted_user_ids() { return this.muted_user_ids; }

    // Set the list of tags and users muted via Pixiv's settings.
    set_mutes({pixiv_muted_tags, pixiv_muted_user_ids}={})
    {
        if(pixiv_muted_tags == null && pixiv_muted_user_ids == null)
            return;

        if(pixiv_muted_tags != null)
            this.muted_tags = pixiv_muted_tags;
        if(pixiv_muted_user_ids != null)
            this.muted_user_ids = pixiv_muted_user_ids;

        this._store_mutes();
        this.fire_mutes_changed();
    }

    // Extra mutes have a similar format to the /ajax/mute/items API:
    //
    // [{
    //     "type": "tag", // or user
    //     "value": "tag or user ID",
    //     "label": "tag or username"   
    // ]}
    get extra_mutes()
    {
        return ppixiv.settings.get("extra_mutes");
    }

    set extra_mutes(muted_users)
    {
        ppixiv.settings.set("extra_mutes", muted_users);
        this.fire_mutes_changed();
    }

    // Shortcut to get just extra muted tags:
    get extra_muted_tags()
    {
        let tags = [];
        for(let mute of this.extra_mutes)
            if(mute.type == "tag")
                tags.push(mute.value);
        return tags;
    }

    // Fire mutes-changed to let UI know that a mute list has changed.
    fire_mutes_changed()
    {
        // If either of these are null, we're still being initialized.  Don't fire events yet.
        if(this.pixiv_muted_tags == null || this.pixiv_muted_user_ids == null)
            return;

        this.dispatchEvent(new Event("mutes-changed"));

        // Tell other tabs that mutes have changed.
        this.broadcast_mutes();
    }

    broadcast_mutes()
    {
        // Don't do this if we're inside broadcast_mutes because another tab sent this to us.
        if(this.handling_broadcast_mutes)
            return;

        this.sync_mutes_channel.postMessage({
            pixiv_muted_tags: this.pixiv_muted_tags,
            pixiv_muted_user_ids: this.pixiv_muted_user_ids,
        });
    }

    received_message = (e) =>
    {
        let data = e.data;

        if(this.handling_broadcast_mutes)
        {
            console.error("recursive");
            return;
        }

        // Don't fire the event if nothing is actually changing.  This happens a lot when new tabs
        // are opened and they broadcast current mutes.
        if(JSON.stringify(this.pixiv_muted_tags) == JSON.stringify(data.pixiv_muted_tags) &&
           JSON.stringify(this.pixiv_muted_user_ids) == JSON.stringify(data.pixiv_muted_user_ids))
            return;
        
        this.handling_broadcast_mutes = true;
        try {
            this.set_mutes({pixiv_muted_tags: data.pixiv_muted_tags, pixiv_muted_user_ids: data.pixiv_muted_user_ids});
        } finally {
            this.handling_broadcast_mutes = false;
        }
    };

    is_muted_user_id(user_id)
    {
        if(this.muted_user_ids.indexOf(user_id) != -1)
            return true;
        
        for(let {value: muted_user_id} of this.extra_mutes)
        {
            if(user_id == muted_user_id)
                return true;
        }
        return false;
    };

    // Unmute user_id.
    //
    // This checks both Pixiv's unmute list and our own, so it can always be used if
    // is_muted_user_id is true.
    async unmute_user_id(user_id)
    {
        this.remove_extra_mute(user_id, {type: "user"});

        if(this.muted_user_ids.indexOf(user_id) != -1)
            await this.remove_pixiv_mute(user_id, {type: "user"});
    }

    // Return true if any tag in tag_list is muted.
    any_tag_muted(tag_list)
    {
        let extra_muted_tags = this.extra_muted_tags;

        for(let tag of tag_list)
        {
            if(tag.tag)
                tag = tag.tag;
            if(this.muted_tags.indexOf(tag) != -1 || extra_muted_tags.indexOf(tag) != -1)
                return tag;
        }
        return null;
    }

    // Return true if the user is able to add to the Pixiv mute list.
    get can_add_pixiv_mutes()
    {
        // Non-premium users can only have one mute, and that's shared across both tags and users.
        let total_mutes = this.pixiv_muted_tags.length + this.pixiv_muted_user_ids.length;
        return window.global_data.premium || total_mutes == 0;
    }

    // Pixiv doesn't include mutes in the initialization data for pages on mobile.  We load
    // it with an API call, but we don't want to wait for that to return and delay every page
    // load.  However, we also don't want to not have mute info and possibly show muted images
    // briefly on startup.  Work around this by caching mutes to storage, and using the cached
    // mutes while we're waiting to receive them.
    _store_mutes()
    {
        // This is only needed for mobile.
        if(!ppixiv.mobile)
            return;

        ppixiv.settings.set("cached_mutes", {
            tags: this.muted_tags,
            user_ids: this.muted_user_ids,
        });
    }

    // Load mutes cached by _store_mutes.  This is only used until we load the mute list, and
    // is only used on mobile.
    load_cached_mutes()
    {
        // This is only needed for mobile.
        if(!ppixiv.mobile)
            return;

        let cached_mutes = ppixiv.settings.get("cached_mutes");
        if(cached_mutes == null)
        {
            console.log("No cached mutes to load");
            return;
        }

        let { tags, user_ids } = cached_mutes;
        this.muted_tags = tags;
        this.muted_user_ids = user_ids;
    }

    // Request the user's mute list.  This is only used on mobile.
    async fetch_mutes()
    {
        // Load the real mute list.
        let data = await helpers.get_request(`/touch/ajax/user/self/status?lang=en`);
        if(data.error)
        {
            console.log("Error loading user info:", data.message);
            return;
        }

        let mutes = data.body.user_status.mutes;

        let pixiv_muted_tags = [];
        for(let [tag, info] of Object.entries(mutes.tags))
        {
            // "enabled" seems to always be true.
            if(info.enabled)
                pixiv_muted_tags.push(tag);
        }

        let pixiv_muted_user_ids = [];
        for(let [user_id, info] of Object.entries(mutes.users))
        {
            if(info.enabled)
            pixiv_muted_user_ids.push(user_id);
        }

        this.set_mutes({pixiv_muted_tags, pixiv_muted_user_ids});
    }

    // If the user has premium, add to Pixiv mutes.  Otherwise, add to extra mutes.
    async add_mute(value, label, {type})
    {
        if(window.global_data.premium)
        {
            await this.add_pixiv_mute(value, {type: type});
        }
        else
        {
            if(type == "user" && label == null)
            {
                // We need to know the user's username to add to our local mute list.
                let user_data = await ppixiv.user_cache.get_user_info(value);
                label = user_data.name;
            }
            
            await this.add_extra_mute(value, label, {type: type});
        }
    }

    // Mute a user or tag using the Pixiv mute list.  type must be "tag" or "user".
    async add_pixiv_mute(value, {type})
    {
        console.log(`Adding ${value} to the Pixiv ${type} mute list`);

        if(!this.can_add_pixiv_mutes)
        {
            ppixiv.message.show("The Pixiv mute list is full.");
            return;
        }

        // Stop if the value is already in the list.
        let mute_list = type == "tag"? "pixiv_muted_tags":"pixiv_muted_user_ids";
        let mutes = this[mute_list];

        if(mutes.indexOf(value) != -1)
            return;

        // Get the label.  If this is a tag, the label is the same as the tag, otherwise
        // get the user's username.  We only need this for the message we'll display at the
        // end.
        let label = value;
        if(type == "user")
            label = (await ppixiv.user_cache.get_user_info(value)).name;

        // Note that this doesn't return an error if the mute list is full.  It returns success
        // and silently does nothing.
        let result = await helpers.rpc_post_request("/ajax/mute/items/add", {
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
        update[mute_list] = mutes;
        this.set_mutes(update);

        ppixiv.message.show(`Muted the ${type} ${label}`);
    }

    // Remove item from the Pixiv mute list.  type must be "tag" or "user".
    async remove_pixiv_mute(value, {type})
    {
        console.log(`Removing ${value} from the Pixiv muted ${type} list`);

        // Get the label.  If this is a tag, the label is the same as the tag, otherwise
        // get the user's username.  We only need this for the message we'll display at the
        // end.
        let label = value;
        if(type == "user")
            label = (await ppixiv.user_cache.get_user_info(value)).name;

        let result = await helpers.rpc_post_request("/ajax/mute/items/delete", {
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
        let mute_list = type == "tag"? "pixiv_muted_tags":"pixiv_muted_user_ids";
        let mutes = this[mute_list];
        let idx = mutes.indexOf(value);
        if(idx != -1)
            mutes.splice(idx, 1);

        let update = { };
        update[mute_list] = mutes;
        this.set_mutes(update);

        ppixiv.message.show(`Unmuted the ${type} ${label}`);
    }
    
    // value is a tag name or user ID.  label is the tag or username.  type must be
    // "tag" or "user".
    async add_extra_mute(value, label, {type})
    {
        console.log(`Adding ${value} (${label}) to the extra muted ${type} list`);

        // Stop if the item is already in the list.
        let mutes = this.extra_mutes;
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
        this.extra_mutes = mutes;
        ppixiv.message.show(`Muted the ${type} ${label}`);
    }

    async remove_extra_mute(value, {type})
    {
        console.log(`Removing ${value} from the extra muted ${type} list`);

        let mutes = this.extra_mutes;

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

        this.extra_mutes = mutes;
    }
}
