"use strict";

// Get and set values in localStorage.
ppixiv.settings = class
{
    static sticky_settings = { };
    static session_settings = { };

    static get_change_callback_list(key)
    {
        if(settings._callbacks == null)
            settings._callbacks = {};
        var callbacks = settings._callbacks[key];
        if(callbacks == null)
            callbacks = settings._callbacks[key] = new callback_list();
        return callbacks;
    }

    // Configure settings.  This is used for properties of settings that we need to
    // know at startup, so we know where to find them.
    //
    // Sticky settings are saved and loaded like other settings, but once a setting is loaded,
    // changes made by other tabs won't affect this instance.  This is used for things like zoom
    // settings, where we want to store the setting, but we don't want each tab to clobber every
    // other tab every time it's changed.
    //
    // Session settings are stored in sessionStorage instead of localStorage.  These are
    // local to the tab.  They'll be copied into new tabs if a tab is duplicated, but they're
    // otherwise isolated, and lost when the tab is closed.
    static configure(key, {sticky=false, session=false})
    {
        if(sticky)
        {
            // Create the key if it doesn't exist.
            if(settings.sticky_settings[key] === undefined)
                settings.sticky_settings[key] = null;
        }

        if(session)
            this.session_settings[key] = true;
    }

    static _get_storage_for_key(key)
    {
        if(this.session_settings[key])
            return sessionStorage;
        else
            return localStorage;
    }

    static _get_from_storage(key, default_value)
    {
        let storage = this._get_storage_for_key(key);

        key = "_ppixiv_" + key;
        if(!(key in storage))
            return default_value;

        let result = storage[key];
        try {
            return JSON.parse(result);
        } catch(e) {
            // Recover from invalid values in storage.
            console.warn(e);
            console.log("Removing invalid setting:", result);
            delete storage.storage_key;
            return default_value;
        }
    }

    static get(key, default_value)
    {
        // If this is a sticky setting and we've already read it, use our loaded value.
        if(settings.sticky_settings[key])
            return settings.sticky_settings[key];

        let result = settings._get_from_storage(key, default_value);

        // If this is a sticky setting, remember it for reuse.  This will store the default value
        // if there's no stored setting.
        if(settings.sticky_settings[key] !== undefined)
            settings.sticky_settings[key] = result;

        return result;
    }

    // Handle migrating settings that have changed.
    static migrate()
    {
        // Change auto-like to !disable-auto-like.
        let value = settings.get("auto-like", null);
        if(value != null)
        {
            this.set("disable-auto-like", !value);
            delete localStorage["_ppixiv_auto-like"];
        }
    }

    static set(key, value)
    {
        let storage = this._get_storage_for_key(key);

        // JSON.stringify incorrectly serializes undefined as "undefined", which isn't
        // valid JSON.  We shouldn't be doing this anyway.
        if(value === undefined)
            throw "Key can't be set to undefined: " + key;

        // If this is a sticky setting, replace its value.
        if(settings.sticky_settings[key] !== undefined)
            settings.sticky_settings[key] = value;

        var setting_key = "_ppixiv_" + key;

        var value = JSON.stringify(value);
        storage[setting_key] = value;

        // Call change listeners for this key.
        settings.get_change_callback_list(key).call(key);
    }

    static register_change_callback(key, callback)
    {
        settings.get_change_callback_list(key).register(callback);
    }

    static unregister_change_callback(key, callback)
    {
        settings.get_change_callback_list(key).unregister(callback);
    }
}

// Register settings.
ppixiv.settings.configure("zoom-mode", { sticky: true });
ppixiv.settings.configure("zoom-level", { sticky: true });

