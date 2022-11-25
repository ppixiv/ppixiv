"use strict";

// Get and set values in localStorage.
//
// When a setting changes, an event with the name of the setting is dispatched.
ppixiv.Settings = class extends EventTarget
{
    constructor()
    {
        super();

        this.sticky_settings = { };
        this.session_settings = { };
        this.defaults = { };

        // We often read settings repeatedly in inner loops, which can become a bottleneck
        // if we decode the JSON-encoded settings from localStorage every time.  However, we
        // don't want to cache them aggressively, since changes to settings in one tab should
        // take effect in others immediately.  This caches the decoded value of settings, but
        // is cleared as soon as we return to the event loop, so we only cache settings briefly.
        this.cache = { };

        // If a setting has no saved value, it'll be cached as no_value.  This is different from
        // null, since null is a valid saved value.
        this.no_value = new Object();

        // Register settings.
        this.configure("zoom-mode", { sticky: true });
        this.configure("zoom-level", { sticky: true });
        this.configure("linked_tabs", { session: true });
        this.configure("linked_tabs_enabled", { session: true, default_value: true });
        this.configure("volume", { default_value: 1 });
        this.configure("view_mode", { default_value: "illust" });
        this.configure("image_editing", { session: true });
        this.configure("image_editing_mode", { session: true });
        this.configure("inpaint_create_lines", { session: true });
        this.configure("slideshow_duration", { default_value: 15 });
        this.configure("auto_pan_duration", { default_value: 3 });
        this.configure("extra_mutes", { default_value: [] });
        this.configure("slideshow_skips_manga", { default_value: false });
        this.configure("expand_manga_thumbnails", { default_value: false });
        this.configure("slideshow_framerate", { default_value: 60 });
        this.configure("animations_enabled", { default_value: ppixiv.mobile });

        // If not null, this limits the size of loaded images.
        this.configure("image_size_limit", { default_value: ppixiv.mobile? 4000*4000:null });
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
    configure(key, {sticky=false, session=false, default_value=null})
    {
        if(sticky)
        {
            // Create the key if it doesn't exist.
            if(this.sticky_settings[key] === undefined)
                this.sticky_settings[key] = null;
        }

        if(session)
            this.session_settings[key] = true;

        if(default_value != null)
            this.defaults[key] = default_value;
    }

    _get_storage_for_key(key)
    {
        if(this.session_settings[key])
            return sessionStorage;
        else
            return localStorage;
    }

    // Wait until we return to the event loop, then clear any cached settings.
    async _queue_clear_cache()
    {
        if(this._clear_cache_queued || Object.keys(this.cache).length == 0)
            return;

        this._clear_cache_queued = true;
        try {
            await helpers.sleep(0);
            this.cache = {};
        } finally {
            this._clear_cache_queued = false;
        }
    }

    _cache_value(key, value)
    {
        // If we're being called by page_manager before we're actually active, don't cache
        // settings.
        if(helpers.setTimeout == null)
            return;
            
        this.cache[key] = value;
        this._queue_clear_cache();
    }

    _get_from_storage(key, default_value)
    {
        // See if we have a cached value.
        if(key in this.cache)
        {
            let value = this.cache[key];
            if(value === this.no_value)
                return default_value;
            else
                return value;
        }

        let storage = this._get_storage_for_key(key);

        let setting_key = "_ppixiv_" + key;
        if(!(setting_key in storage))
        {
            this._cache_value(key, this.no_value);
            return default_value;
        }

        let result = storage[setting_key];
        try {
            let value = JSON.parse(result);
            this._cache_value(key, value);
            return value;
        } catch(e) {
            // Recover from invalid values in storage.
            console.warn(e);
            console.log("Removing invalid setting:", result);
            delete storage.storage_key;
            return default_value;
        }
    }

    get(key, default_value)
    {
        if(key in this.defaults)
            default_value = this.defaults[key];

        // If this is a sticky setting and we've already read it, use our loaded value.
        if(this.sticky_settings[key])
            return this.sticky_settings[key];

        let result = this._get_from_storage(key, default_value);

        // If this is a sticky setting, remember it for reuse.  This will store the default value
        // if there's no stored setting.
        if(this.sticky_settings[key] !== undefined)
            this.sticky_settings[key] = result;

        return result;
    }

    // Handle migrating settings that have changed.
    migrate()
    {
    }

    set(key, value)
    {
        let storage = this._get_storage_for_key(key);

        // JSON.stringify incorrectly serializes undefined as "undefined", which isn't
        // valid JSON.  We shouldn't be doing this anyway.
        if(value === undefined)
            throw "Key can't be set to undefined: " + key;

        // If this is a sticky setting, replace its value.
        if(this.sticky_settings[key] !== undefined)
            this.sticky_settings[key] = value;

        var setting_key = "_ppixiv_" + key;
        storage[setting_key] = JSON.stringify(value);

        // Update the cached value.
        this._cache_value(key, value);

        let event = new Event(key);
        this.dispatchEvent(event);
    }

    // Adjust a zoom setting up or down.
    adjust_zoom(setting, down)
    {
        let value = this.get(setting);
        if(typeof(value) != "number" || isNaN(value))
            value = 4;

        value += down?-1:+1;
        value = helpers.clamp(value, 0, 7);
        this._slider_value = value;
        this.value = this._slider_value;

        this.set(setting, value);
    }
}
