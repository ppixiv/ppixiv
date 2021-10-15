"use strict";

// Get and set values in localStorage.
ppixiv.settings = class
{
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

    static _get_from_storage(key, default_value)
    {
        key = "_ppixiv_" + key;

        if(!(key in localStorage))
            return default_value;

        let result = localStorage[key];
        try {
            return JSON.parse(result);
        } catch(e) {
            // Recover from invalid values in localStorage.
            console.warn(e);
            console.log("Removing invalid setting:", result);
            delete localStorage.storage_key;
            return default_value;
        }
    }

    static get(key, default_value)
    {
        // If this is a session setting and we've already read it, use our loaded value.
        if(settings.session_settings[key])
            return settings.session_settings[key];

        let result = settings._get_from_storage(key, default_value);

        // If this is a session setting, remember it for reuse.  This will store the default value
        // if there's no stored setting.
        if(settings.session_settings[key] !== undefined)
            settings.session_settings[key] = result;

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
        // JSON.stringify incorrectly serializes undefined as "undefined", which isn't
        // valid JSON.  We shouldn't be doing this anyway.
        if(value === undefined)
            throw "Key can't be set to undefined: " + key;

        // If this is a session setting, replace its value.
        if(settings.session_settings[key] !== undefined)
            settings.session_settings[key] = value;

        var setting_key = "_ppixiv_" + key;

        var value = JSON.stringify(value);
        localStorage[setting_key] = value;

        // Call change listeners for this key.
        settings.get_change_callback_list(key).call(key);
    }

    // Mark a setting as per-session.  These are saved and loaded like other settings, but
    // once a setting is loaded, changes made by other tabs won't affect this instance.
    // This is used for things like zoom settings, where we want to store the setting, but
    // we don't want each tab to clobber every other tab every time it's changed.
    static set_per_session(key)
    {
        // Create the key if it doesn't exist.
        if(settings.session_settings[key] === undefined)
            settings.session_settings[key] = null;
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


