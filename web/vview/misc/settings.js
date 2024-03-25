// Get and set values in localStorage.
//
// When a setting changes, an event with the name of the setting is dispatched.

import { helpers } from '/vview/misc/helpers.js';

export default class Settings extends EventTarget
{
    constructor()
    {
        super();

        this.stickySettings = { };
        this.sessionSettings = { };
        this.defaults = { };

        // We often read settings repeatedly in inner loops, which can become a bottleneck
        // if we decode the JSON-encoded settings from localStorage every time.  However, we
        // don't want to cache them aggressively, since changes to settings in one tab should
        // take effect in others immediately.  This caches the decoded value of settings, but
        // is cleared as soon as we return to the event loop, so we only cache settings briefly.
        this.cache = { };

        // If a setting has no saved value, it'll be cached as no_value.  This is different from
        // null, since null is a valid saved value.
        this.noValue = new Object();

        // Register settings.
        this.configure("zoom-mode", { sticky: true });
        this.configure("zoom-level", { sticky: true });
        this.configure("linked_tabs", { session: true });
        this.configure("linked_tabs_enabled", { session: true, defaultValue: true });
        this.configure("volume", { defaultValue: 1 });
        this.configure("view_mode", { defaultValue: "illust" });
        this.configure("image_editing", { session: true });
        this.configure("image_editing_mode", { session: true });
        this.configure("inpaint_create_lines", { session: true });
        this.configure("slideshow_duration", { defaultValue: 15 });
        this.configure("auto_pan", { defaultValue: ppixiv.mobile });
        this.configure("auto_pan_duration", { defaultValue: 3 });
        this.configure("slideshow_default", { defaultValue: "pan" });        
        this.configure("upscaling", { defaultValue: false });
        this.configure("extraMutes", { defaultValue: [] });
        this.configure("slideshow_skips_manga", { defaultValue: false });
        this.configure("pixiv_cdn", { defaultValue: "pixiv" }); // see helpers.pixiv.pixivImageHosts
        this.configure("preload_manga", { defaultValue: ppixiv.mobile? "thumbnails":"full" });

        // Default to aspect ratio thumbs unless we're on a phone.
        this.configure("thumbnail_style", { defaultValue: helpers.other.isPhone()? "square":"aspect" });
        this.configure("expand_manga_thumbnails", { defaultValue: false });
        this.configure("slideshow_framerate", { defaultValue: 60 });
        this.configure("animations_enabled", { defaultValue: ppixiv.mobile });

        // If not null, this limits the size of loaded images.
        this.configure("image_size_limit", { defaultValue: ppixiv.mobile? 4000*4000:null });

        // Translation settings:
        this.configure("translation_api_url", { defaultValue: "https://api.cotrans.touhou.ai" });
        this.configure("translation_low_res", { defaultValue: false });
        this.configure("translation_size", { defaultValue: "M" });
        this.configure("translation_translator", { defaultValue: "deepl" });
        this.configure("translation_direction", { defaultValue: "auto" });
        this.configure("translation_language", { defaultValue: "ENG" });

        // Run any one-time settings migrations.
        this.migrate();
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
    configure(key, {sticky=false, session=false, defaultValue=null})
    {
        if(sticky)
        {
            // Create the key if it doesn't exist.
            if(this.stickySettings[key] === undefined)
                this.stickySettings[key] = null;
        }

        if(session)
            this.sessionSettings[key] = true;

        if(defaultValue != null)
            this.defaults[key] = defaultValue;
    }

    _getStorageForKey(key)
    {
        if(this.sessionSettings[key])
            return sessionStorage;
        else
            return localStorage;
    }

    // Wait until we return to the event loop, then clear any cached settings.
    async _queueClearCache()
    {
        if(this._clearCacheQueued || Object.keys(this.cache).length == 0)
            return;

        this._clearCacheQueued = true;
        try {
            await helpers.other.sleep(0);
            this.cache = {};
        } finally {
            this._clearCacheQueued = false;
        }
    }

    _cacheValue(key, value)
    {
        this.cache[key] = value;
        this._queueClearCache();
    }

    _getFromStorage(key, defaultValue)
    {
        // See if we have a cached value.
        if(key in this.cache)
        {
            let value = this.cache[key];
            if(value === this.noValue)
                return defaultValue;
            else
                return value;
        }

        let storage = this._getStorageForKey(key);

        let settingKey = "_ppixiv_" + key;
        if(!(settingKey in storage))
        {
            this._cacheValue(key, this.noValue);
            return defaultValue;
        }

        let result = storage[settingKey];
        try {
            let value = JSON.parse(result);
            this._cacheValue(key, value);
            return value;
        } catch(e) {
            // Recover from invalid values in storage.
            console.warn(e);
            console.log("Removing invalid setting:", result);
            delete storage.storage_key;
            return defaultValue;
        }
    }

    get(key, defaultValue)
    {
        if(key in this.defaults)
            defaultValue = this.defaults[key];

        // If this is a sticky setting and we've already read it, use our loaded value.
        if(this.stickySettings[key])
            return this.stickySettings[key];

        let result = this._getFromStorage(key, defaultValue);

        // If this is a sticky setting, remember it for reuse.  This will store the default value
        // if there's no stored setting.
        if(this.stickySettings[key] !== undefined)
            this.stickySettings[key] = result;

        return result;
    }

    // Handle migrating settings that have changed.
    migrate()
    {
    }

    set(key, value)
    {
        let storage = this._getStorageForKey(key);

        // JSON.stringify incorrectly serializes undefined as "undefined", which isn't
        // valid JSON.  We shouldn't be doing this anyway.
        if(value === undefined)
            throw "Key can't be set to undefined: " + key;

        // If this is a sticky setting, replace its value.
        if(this.stickySettings[key] !== undefined)
            this.stickySettings[key] = value;

        let settingKey = "_ppixiv_" + key;
        storage[settingKey] = JSON.stringify(value);

        // Update the cached value.
        this._cacheValue(key, value);

        // Dispatch the setting name for listeners who want to know when a setting changes.
        this.dispatchEvent(new Event(key));

        // Dispatch "all" for listeners who want to know when any setting changes.
        this.dispatchEvent(new Event("all"));
    }

    // Adjust a zoom setting up or down.
    adjustZoom(setting, down)
    {
        let value = this.get(setting);
        if(typeof(value) != "number" || isNaN(value))
            value = 4;

        value += down?-1:+1;
        value = helpers.math.clamp(value, 0, 7);
        this.sliderValue = value;
        this.value = this.sliderValue;

        this.set(setting, value);
    }
}
