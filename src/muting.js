"use strict";

// This handles querying whether a tag or a user is muted.
//
// The "mutes-changed" event is fired here when any mute list is modified.
ppixiv.muting = class extends EventTarget
{
    static get singleton()
    {
        if(muting._singleton == null)
            muting._singleton = new muting();
        return muting._singleton;
    };

    constructor()
    {
        super();

        // This is used to tell other tabs when mutes change, so adding mutes takes effect without
        // needing to reload all other tabs.
        this.sync_mutes_channel = new BroadcastChannel("ppixiv:mutes-changed");
        this.sync_mutes_channel.addEventListener("message", this.received_message);
    }

    // Set the list of tags and users muted via Pixiv's settings.
    get pixiv_muted_tags() { return this.muted_tags; }
    set pixiv_muted_tags(muted_tags) { this.muted_tags = muted_tags; this.fire_mutes_changed(); }

    get pixiv_muted_user_ids() { return this.muted_user_ids; }
    set pixiv_muted_user_ids(muted_user_ids) { this.muted_user_ids = muted_user_ids; this.fire_mutes_changed(); }

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
            this.pixiv_muted_tags = data.pixiv_muted_tags;
            this.pixiv_muted_user_ids = data.pixiv_muted_user_ids;
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
        actions.remove_extra_mute(user_id, {type: "user"});

        if(this.muted_user_ids.indexOf(user_id) != -1)
            await actions.remove_pixiv_mute(user_id, {type: "user"});
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
}

// The "Muted Users" and "Muted Tags" settings pages.
ppixiv.muted_tags_popup = class extends ppixiv.widget
{
    constructor({
        mute_type, // "tags" or "users"
        ...options})
    {
        super({...options, template: `
            <div class=muted-tags-popup>
                <span class=add-muted-user-box>
                    Users can be muted from their user page, or by right-clicking an image and clicking
                    ${ helpers.create_icon("settings") }.
                </span>

                <span class=non-premium-mute-warning>
                    ${ helpers.create_box_link({label: "Note",      icon: "warning",  classes: ["mute-warning-button"] }) }
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
                    ${ helpers.create_box_link({label: "Add",      icon: "add",  classes: ["add-muted-tag"] }) }
                </div>

                <div class=mute-list></div>
            </div>
        `});

        this.mute_type = mute_type;

        this.container.querySelector(".add-muted-tag-box").hidden = mute_type != "tag";
        this.container.querySelector(".add-muted-user-box").hidden = mute_type != "user";
        this.container.querySelector(".add-muted-tag").addEventListener("click", this.click_add_muted_tag);
        this.container.querySelector(".mute-warning-button").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            let mute_warning = this.container.querySelector(".mute-warning");
            mute_warning.hidden = !mute_warning.hidden;

        });

        // Hide the warning for non-premium users if the user does have premium.
        this.container.querySelector(".non-premium-mute-warning").hidden = window.global_data.premium;
    }

    visibility_changed()
    {
        super.visibility_changed();

        if(this.visible)
        {
            this.container.querySelector(".mute-warning").hidden = true;
            this.refresh();
        }

        // Clear the username cache when we're hidden, so we'll re-request it the next time
        // we're viewed.
        if(!this.visible)
            this.clear_muted_user_id_cache();
    }

    refresh = async() =>
    {
        if(!this.visible)
            return;

        if(this.mute_type == "tag")
            await this.refresh_for_tags();
        else
            await this.refresh_for_users();
    }

    create_entry()
    {
        return this.create_template({name: "muted-tag-entry", html: `
            <div class=muted-tag>
                <a href=# class="remove-mute clickable">
                    ${ helpers.create_icon("delete") }
                </a>
                <span class=tag-name></span>
            </div>
        `});
    }

    refresh_for_tags = async() =>
    {
        // Do a batch lookup of muted tag translations.
        let tags_to_translate = [...muting.singleton.pixiv_muted_tags];
        for(let mute of muting.singleton.extra_mutes)
        {
            if(mute.type == "tag")
                tags_to_translate.push(mute.value);
        }

        let translated_tags = await tag_translations.get().get_translations(tags_to_translate);

        let create_muted_tag_entry = (tag, tag_list_container) =>
        {
            let entry = this.create_entry();
            entry.dataset.tag = tag;

            let label = tag;
            let tag_translation = translated_tags[tag];
            if(tag_translation)
                label = `${tag_translation} (${tag})`;
            entry.querySelector(".tag-name").innerText = label;
            tag_list_container.appendChild(entry);

            return entry;
        };

        let muted_tag_list = this.container.querySelector(".mute-list");
        helpers.remove_elements(muted_tag_list);
        for(let {type, value: tag} of muting.singleton.extra_mutes)
        {
            if(type != "tag")
                continue;
            let entry = create_muted_tag_entry(tag, muted_tag_list);

            entry.querySelector(".remove-mute").addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                actions.remove_extra_mute(tag, {type: "tag"});
                this.refresh();
            });
        }

        for(let tag of muting.singleton.pixiv_muted_tags)
        {
            let entry = create_muted_tag_entry(tag, muted_tag_list);

            entry.querySelector(".remove-mute").addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();

                await actions.remove_pixiv_mute(tag, {type: "tag"});
                this.refresh();
            });
        }
    }

    refresh_for_users = async() =>
    {
        let create_muted_user_entry = (user_id, username, tag_list_container) =>
        {
            let entry = this.create_entry();
            entry.dataset.user_id = user_id;

            entry.querySelector(".tag-name").innerText = username;
            tag_list_container.appendChild(entry);

            return entry;
        };

        let muted_user_list = this.container.querySelector(".mute-list");
        helpers.remove_elements(muted_user_list);

        for(let {type, value: user_id, label: username} of muting.singleton.extra_mutes)
        {
            if(type != "user")
                continue;
    
            let entry = create_muted_user_entry(user_id, username, muted_user_list);

            entry.querySelector(".remove-mute").addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                actions.remove_extra_mute(user_id, {type: "user"});
                this.refresh();
            });
        }

        // We already know the muted user IDs, but we need to load the usernames for display.
        // If we don't have this yet, start the load and refresh once we have it.
        let user_id_to_username = this.cached_muted_user_id_to_username;
        if(user_id_to_username == null)
        {
            this.get_muted_user_id_to_username().then(() => {
                console.log("Refreshing after muted user load");
                this.refresh();
            });
        }
        else
        {
            // Now that we have usernames, Sort Pixiv mutes by username.
            let mutes = muting.singleton.pixiv_muted_user_ids;
            mutes.sort((lhs, rhs) => {
                lhs = user_id_to_username[lhs] || "";
                rhs = user_id_to_username[rhs] || "";
                return lhs.localeCompare(rhs);
            });

            for(let user_id of mutes)
            {
                let entry = create_muted_user_entry(user_id, user_id_to_username[user_id], muted_user_list);

                entry.querySelector(".remove-mute").addEventListener("click", async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    await actions.remove_pixiv_mute(user_id, {type: "user"});
                    this.refresh();
                });
            }
        }
    }

    clear_muted_user_id_cache()
    {
        this.cached_muted_user_id_to_username = null;
    }

    // Return a dictionary of muted user IDs to usernames.
    get_muted_user_id_to_username()
    {
        // If this completed previously, just return the cached results.
        if(this.cached_muted_user_id_to_username)
            return this.cached_muted_user_id_to_username;
            
        // If this is already running, return the existing promise and don't start another.
        if(this.get_muted_user_id_to_username_promise)
            return this.get_muted_user_id_to_username_promise;

        let promise = this.get_muted_user_id_to_username_inner();
        this.get_muted_user_id_to_username_promise = promise;
        this.get_muted_user_id_to_username_promise.finally(() => {
            // Clear get_muted_user_id_to_username_promise when it finishes.
            if(this.get_muted_user_id_to_username_promise == promise)
                this.get_muted_user_id_to_username_promise = null;
        });
        return this.get_muted_user_id_to_username_promise;
    }

    async get_muted_user_id_to_username_inner()
    {
        // Users muted with Pixiv.  We already have the list, but we need to make an API
        // request to get usernames to actually display.
        let result = await helpers.rpc_get_request("/ajax/mute/items", { context: "setting" });
        if(result.error)
        {
            message_widget.singleton.show(result.message);
            this.cached_muted_user_id_to_username = {};
            return this.cached_muted_user_id_to_username;
        }

        let user_id_to_username = {};
        for(let item of result.body.mute_items)
        {
            // We only care about user mutes here.
            if(item.type == "user")
                user_id_to_username[item.value] = item.label;
        }

        this.cached_muted_user_id_to_username = user_id_to_username;
        return this.cached_muted_user_id_to_username;
    }

    // Add to our muted tag list.
    click_add_muted_tag = async (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        let prompt = new text_prompt({ title: "Tag to mute:" });
        let tag = await prompt.result;
        if(tag == null || tag == "")
            return; // cancelled

        // If the user has premium, use the regular Pixiv mute list.  Otherwise, add the tag
        // to extra mutes.  We never add anything to the Pixiv mute list for non-premium users,
        // since it's limited to only one entry.
        if(window.global_data.premium)
            await actions.add_pixiv_mute(tag, {type: "tag"});
        else
            await actions.add_extra_mute(tag, tag, {type: "tag"});
        this.refresh();
    };

    async remove_pixiv_muted_tag(tag)
    {
        await actions.remove_pixiv_mute(tag, {type: "tag"});
        this.refresh();
    }
}

// A popup for editing mutes related for a post (the user and the post's tags).
ppixiv.muted_tags_for_post_popup = class extends ppixiv.dialog_widget
{
    constructor({
        media_id,
        user_id,
        ...options})
    {
        super({...options, classes: "muted-tags-popup", header: "Edit mutes", dialog_type: "small", template: `
            <div style="display: flex; align-items: center;">
                <span class=non-premium-mute-warning>
                    ${ helpers.create_box_link({label: "Note",      icon: "warning",  classes: ["mute-warning-button", "clickable"] }) }
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

        this.media_id = media_id;
        this.user_id = user_id;

        this.container.querySelector(".close-button").addEventListener("click", (e) => {
            this.shutdown();
        }, { signal: this.shutdown_signal.signal });

        this.container.querySelector(".mute-warning-button").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            let mute_warning = this.container.querySelector(".mute-warning");
            mute_warning.hidden = !mute_warning.hidden;

        });

        // Hide the warning for non-premium users if the user does have premium.
        this.container.querySelector(".non-premium-mute-warning").hidden = window.global_data.premium;

        this.refresh();
    }
    
    refresh = async() =>
    {
        if(this.media_id != null)
        {
            // We have a media ID.  Load its info to get the tag list, and use the user ID and
            // username from it.
            let illust_data = await media_cache.get_media_info(this.media_id, { full: false });
            await this.refresh_for_data(illust_data.tagList, illust_data.userId, illust_data.userName);
        }
        else
        {
            // We only have a user ID, so look up the user to get the username.  Don't display
            // any tags.
            let user_info = await user_cache.get_user_info(this.user_id);
            await this.refresh_for_data([], this.user_id, user_info.name);
        }       
    }

    async refresh_for_data(tags, user_id, username)
    {
        // Do a batch lookup of muted tag translations.
        let translated_tags = await tag_translations.get().get_translations(tags);

        let create_entry = (label, is_muted) =>
        {
            let entry = this.create_template({name: "muted-tag-or-user-entry", html: `
                <div class=entry>
                    ${ helpers.create_box_link({label: "Mute",      classes: ["toggle-mute"] }) }
                    <span class=tag-name></span>
                </div>
            `});

            helpers.set_class(entry, "muted", is_muted);
            entry.querySelector(".toggle-mute .label").innerText = is_muted? "Muted":"Mute";
            entry.querySelector(".tag-name").innerText = label;
            muted_list.appendChild(entry);

            return entry;
        };    
    
        let muted_list = this.container.querySelector(".post-mute-list");
        helpers.remove_elements(muted_list);

        // Add an entry for the user.
        {
            let is_muted = muting.singleton.is_muted_user_id(user_id);
            let entry = create_entry(`User: ${username}`, is_muted);

            entry.querySelector(".toggle-mute").addEventListener("click", async (e) => {
                if(is_muted)
                {
                    actions.remove_extra_mute(user_id, {type: "user"});
                    await actions.remove_pixiv_mute(user_id, {type: "user"});
                } else {
                    await actions.add_mute(user_id, username, {type: "user"});
                }
                
                this.refresh();
            });
        }

        // Add each tag on the image.
        for(let tag of tags)
        {
            let is_muted = muting.singleton.any_tag_muted([tag]);

            let label = tag;
            let tag_translation = translated_tags[tag];
            if(tag_translation)
                label = `${tag_translation} (${tag})`;

            let entry = create_entry(label, is_muted);

            entry.querySelector(".toggle-mute").addEventListener("click", async (e) => {
                if(is_muted)
                {
                    actions.remove_extra_mute(tag, {type: "tag"});
                    await actions.remove_pixiv_mute(tag, {type: "tag"});
                } else {
                    await actions.add_mute(tag, tag, {type: "tag"});
                }

                this.refresh();
            });
        }
    }
}
