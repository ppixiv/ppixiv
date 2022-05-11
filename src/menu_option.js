"use strict";


ppixiv.settings_dialog = class extends ppixiv.dialog_widget
{
    constructor({show_page="thumbnail", ...options})
    {
        super({...options, visible: true, template: `
            <div class="settings-dialog dialog">
                <div class=content>
                    <div class=header>Settings</div>

                    <div class=box>
                        <div class=sections></div>
                        <div class=items>
                        </div>
                    </div>

                    <div class=close-button>
                        <ppixiv-inline src="resources/close-button.svg"></ppixiv-inline>
                    </div>
                </div>
            </div>
        `});

        this.pages = {};
        this.page_buttons = new Map();

        this.container.querySelector(".close-button").addEventListener("click", (e) => {
            this.shutdown();
        }, { signal: this.shutdown_signal.signal });

        this.add_settings();

        // Close if the container is clicked, but not if something inside the container is clicked.
        this.container.addEventListener("click", (e) => {
            if(e.target != this.container)
                return;

            this.shutdown();
        }, { signal: this.shutdown_signal.signal });

        // Hide on any state change.
        window.addEventListener("popstate", (e) => {
            this.shutdown();
        }, { signal: this.shutdown_signal.signal });

        this.show_page(show_page);
    }

    shutdown()
    {
        super.shutdown();

        this.visible = false;
        this.container.remove();

        this.link_tabs.shutdown();
    }

    visibility_changed()
    {
        super.visibility_changed();

        if(!this.visible)
        {
            // Remove the widget when it's hidden.
            this.container.remove();
        }
    }

    add_settings()
    {
        this.items = this.container.querySelector(".items");

        // Options that we pass to all menu_options:
        let global_options = {
            container: this.items,
            parent: this,
            classes: ["settings-row"],

            // Share our shutdown signal with the widgets, so their event listeners will be
            // shut down when we shut down.
            shutdown_signal: this.shutdown_signal,
        };

        // Each settings widget.  Doing it this way lets us move widgets around in the
        // menu without moving big blocks of code around.
        let settings_widgets = {
            thumbnail_size: () => {
                let button = new menu_option_button({
                    ...global_options,
                    label: "Thumbnail size",
                    buttons: [
                        new thumbnail_size_slider_widget({
                            ...global_options,
                            parent: this,
                            container: this.container,
                            setting: "thumbnail-size",
                            classes: ["size-slider"],
                            min: 0,
                            max: 7,
                        }),
                    ],
                });
        
                button.container.querySelector(".size-slider").style.flexGrow = .25;
            },

            manga_thumbnail_size: () => {
                let button = new menu_option_button({
                    ...global_options,
                    label: "Thumbnail size (manga)",
                    buttons: [
                        new thumbnail_size_slider_widget({
                            ...global_options,
                            parent: this,
                            container: this.container,
                            setting: "manga-thumbnail-size",
                            classes: ["size-slider"],
                            min: 0,
                            max: 7,
                        }),
                    ],
                });
        
                button.container.querySelector(".size-slider").style.flexGrow = .25;
            },

            disabled_by_default: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Disabled by default",
                    setting: "disabled-by-default",
                    explanation_enabled: "Go to Pixiv by default.",
                    explanation_disabled: "Go here by default.",
                });
            },
    
            no_hide_cursor: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Hide cursor",
                    setting: "no-hide-cursor",
                    invert_display: true,
                    explanation_enabled: "Hide the cursor while the mouse isn't moving.",
                    explanation_disabled: "Don't hide the cursor while the mouse isn't moving.",
                });
            },
    
            invert_popup_hotkey: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Shift-right-click to show the popup menu",
                    setting: "invert-popup-hotkey",
                    explanation_enabled: "Shift-right-click to open the popup menu",
                    explanation_disabled: "Right click opens the popup menu",
                });
            },

            ctrl_opens_popup: () => {
                    return new menu_option_toggle({
                    ...global_options,
                    label: "Hold ctrl to show the popup menu",
                    setting: "ctrl_opens_popup",
                    explanation_enabled: "Pressing Ctrl shows the popup menu (for laptops)",
                });
            },

            ui_on_hover: () => {
                new menu_option_toggle({
                    ...global_options,
                    label: "Hover to show search box",
                    setting: "ui-on-hover",
                    onchange: this.update_from_settings,
                    explanation_enabled: "Only show the search box when hovering over it",
                    explanation_disabled: "Always show the search box",
                });
            },

            invert_scrolling: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Invert image panning",
                    setting: "invert-scrolling",
                    explanation_enabled: "Dragging down moves the image down",
                    explanation_disabled: "Dragging down moves the image up",
                });
            },

            theme: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Light mode",
                    setting: "theme",
                    on_value: "light",
                    off_value: "dark",
                    explanation_enabled: "FLASHBANG",
                });
            },
    
            disable_translations: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Show tag translations when available",
                    setting: "disable-translations",
                    invert_display: true,
                });
            },
    
            disable_thumbnail_panning: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Pan thumbnails while hovering over them",
                    setting: "disable_thumbnail_panning",
                    invert_display: true,
                });
            },
    
            disable_thumbnail_zooming: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Zoom out thumbnails while hovering over them",
                    setting: "disable_thumbnail_zooming",
                    invert_display: true,
                });
            },
    
            bookmark_privately_by_default: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Bookmark privately by default",
                    setting: "bookmark_privately_by_default",
                    explanation_disabled: "Pressing Ctrl-B will bookmark publically",
                    explanation_enabled: "Pressing Ctrl-B will bookmark privately",
                });
            },

            quick_view: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Quick view",
                    setting: "quick_view",
                    explanation_enabled: "Navigate to images immediately when the mouse button is pressed",
    
                    check: () => {
                        // Only enable changing this option when using a mouse.  It has no effect
                        // on touchpads.
                        if(ppixiv.pointer_listener.pointer_type == "mouse")
                            return true;
    
                        message_widget.singleton.show("Quick View is only supported when using a mouse.");
                        return false;
                    },
                });
            },
    
            auto_pan: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Pan images",
                    setting: "auto_pan",
                    //<span class="material-icons">animation</span>
                    explanation_enabled: "Pan images while viewing them (drag the image to stop)",
                });
            },

            auto_pan_speed: () => {
                let button;
                let slider = new menu_option_slider_setting({
                    ...global_options,
                    setting: "auto_pan_duration",
                    list: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60],
                    classes: ["size-slider"],

                    // Refresh the label when the value changes.
                    onchange: function() { button.refresh(); },
                });

                button = new menu_option_button({
                    ...global_options,
                    label: "Time per image",
                    get_label: () => {
                        let seconds = settings.get("auto_pan_duration");;
                        return `Pan duration: ${seconds} ${seconds != 1? "seconds":"second"}`;                                        
                    },
                    buttons: [slider],
                });
        
                button.container.querySelector(".size-slider").style.flexGrow = .25;
            },

            slideshow_speed: () => {
                let button;
                let slider = new menu_option_slider_setting({
                    ...global_options,
                    setting: "slideshow_duration",
                    list: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180],
                    classes: ["size-slider"],
                    
                    // Refresh the label when the value changes.
                    onchange: function() { button.refresh(); },
                });

                button = new menu_option_button({
                    ...global_options,
                    label: "Time per image",
                    get_label: () => {
                        let seconds = settings.get("slideshow_duration");;
                        return `Slideshow duration: ${seconds} ${seconds != 1? "seconds":"second"}`;
                    },
                    buttons: [slider],
                });
        
                button.container.querySelector(".size-slider").style.flexGrow = .25;
            },

            slideshow_skips_manga: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Slideshow skips manga pages",
                    setting: "slideshow_skips_manga",
                    explanation_enabled: "Slideshow mode will only show the first page.",
                    explanation_disabled: "Slideshow mode will show all pages.",
                });
            },

            no_recent_history: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Remember recent history",
                    setting: "no_recent_history",
                    invert_display: true,
                    explanation_enabled: "Remember recently seen thumbnails",
                    explanation_disabled: "Don't remember recently seen thumbnails",
                });
            },
    
            view_mode: () => {
                new menu_option_toggle({
                    ...global_options,
                    label: "Return to the top when changing images",
                    setting: "view_mode",
                    on_value: "manga",
                    off_value: "illust",
                });
            },
            link_tabs: () => {
                return new link_tabs_popup({
                    ...global_options,
                });
            },
            enable_linked_tabs: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Enabled",
                    setting: "linked_tabs_enabled",
                });
            },
            unlink_all_tabs: () => {
                return new menu_option_button({
                    ...global_options,
                    label: "Unlink all tabs",
                    onclick: () => {
                        settings.set("linked_tabs", []);
                    },
                });
            },
            muted_tags: () => {
                return new muted_tags_popup({
                    mute_type: "tag",
                    ...global_options,
                });
            },
            muted_users: () => {
                return new muted_tags_popup({
                    mute_type: "user",
                    ...global_options,
                });
            },
        };

        this.create_page("thumbnail", "Thumbnail options", global_options);

        settings_widgets.thumbnail_size();
        if(!ppixiv.native)
            settings_widgets.manga_thumbnail_size();
        settings_widgets.disable_thumbnail_panning();
        settings_widgets.disable_thumbnail_zooming();
        settings_widgets.quick_view();
        settings_widgets.ui_on_hover();

        this.create_page("image", "Image viewing", global_options);
        settings_widgets.auto_pan();
        settings_widgets.auto_pan_speed();
        settings_widgets.slideshow_speed();
        if(!ppixiv.native) // native mode doesn't support manga pages
            settings_widgets.slideshow_skips_manga();
        
        settings_widgets.view_mode();
        settings_widgets.invert_scrolling();
        settings_widgets.no_hide_cursor();
        
        this.create_page("tag_muting", "Muted tags", global_options);
        this.muted_tags = settings_widgets.muted_tags();

        this.create_page("user_muting", "Muted users", global_options);
        this.muted_users = settings_widgets.muted_users();

        this.create_page("linked_tabs", "Linked tabs", global_options);
        this.link_tabs = settings_widgets.link_tabs();
        settings_widgets.enable_linked_tabs();
        settings_widgets.unlink_all_tabs();

        this.create_page("other", "Other", global_options);
        settings_widgets.disable_translations();

        if(!ppixiv.native)
            settings_widgets.disabled_by_default();
            
        // Firefox's contextmenu behavior is broken, so hide this option.
        if(navigator.userAgent.indexOf("Firefox/") == -1)
            settings_widgets.invert_popup_hotkey();

        settings_widgets.ctrl_opens_popup();
        // settings_widgets.theme();
        settings_widgets.bookmark_privately_by_default();


        // Hidden for now (not very useful)
        // settings_widgets.no_recent_history();
    }

    create_page(id, title, global_options)
    {
        let page = this.create_template({name: "settings-page", html: `
            <div class=settings-page>
            </div>
        `});

        this.items.appendChild(page);
        global_options.container = page;

        let page_button = this.create_template({name: "settings-page-button", html: `
            <div class=box-link>
            </div>
        `});
        page_button.innerText = title;
        page.hidden = true;
        page_button.addEventListener("click", (e) => {
            this.show_page(id);
        });
        this.container.querySelector(".sections").appendChild(page_button);

        this.pages[id] = {
            page: page,
            page_button: page_button,
        };
        this.page_buttons.set(page, page_button);
        if(this.pages.length == 1)
            this.show_page(page);

        return page;
    }

    show_page(id)
    {
        if(this.visible_page != null)
        {
            helpers.set_class(this.visible_page.page_button, "selected", false);
            this.visible_page.page.hidden = true;
        }

        this.visible_page = this.pages[id];
        this.visible_page.page.hidden = false;
        
        helpers.set_class(this.visible_page.page_button, "selected", true);

        this.refresh();
    }

    refresh()
    {
        this.link_tabs.visible = this.visible && this.visible_page == this.pages.linked_tabs;
        this.muted_tags.visible = this.visible && this.visible_page == this.pages.tag_muting;
        this.muted_users.visible = this.visible && this.visible_page == this.pages.user_muting;
    }

    visibility_changed()
    {
        super.visibility_changed();
        this.refresh();
    }
};

// Simple menu settings widgets.
ppixiv.menu_option = class extends widget
{
    constructor({
        classes=[],
        onchange=null,
        ...options
    })
    {
        super(options);
        for(let class_name of classes)
            this.container.classList.add(class_name);

        this.refresh = this.refresh.bind(this);
        this.onchange = onchange;
    }

    refresh()
    {
        if(this.onchange)
            this.onchange();
    }            
}

// A container for multiple options on a single row.
ppixiv.menu_option_row = class extends ppixiv.menu_option
{
    constructor({items, ...options})
    {
        super({...options, template: `
            <div class=box-link-row>
            </div>
        `});

        // Add items.
        let row = this.container;
        let first = true;
        for(let item of items)
        {
            let item_container = item.container;
            item_container.remove();
            row.appendChild(item_container);

            // If we have more than one item, add a flex spacer after the first.            
            if(first)
            {
                first = false;
                let div = document.createElement("div");
                div.style.flex = "1";
                row.appendChild(div);
            }
        }
    }
}

ppixiv.menu_option_button = class extends ppixiv.menu_option
{
    constructor({
        url=null,
        label,
        get_label=null,
        onclick=null,
        explanation_enabled=null,
        explanation_disabled=null,
        buttons=[],
        ...options})
    {
        // If we've been given a URL, make this a link.  Otherwise, make it a div and
        // onclick will handle it.
        let type = "div";
        let href = "";
        if(url != null)
        {
            type = "a";
            href = `href="${encodeURI(url)}"`;
        }

        super({...options, template: `
            <${type} ${href} class="menu-toggle box-link">
                <span class=icon hidden></span>
                <div class=label-box>
                    <span class=label></span>
                    <span class=explanation hidden></span>
                </div>
                <div style="flex: 1;"></div>
            </{type}>
        `});

        this.onclick = this.onclick.bind(this);

        this.onclick_handler = onclick;
        this._enabled = true;
        this.explanation_enabled = explanation_enabled;
        this.explanation_disabled = explanation_disabled;
        this.get_label = get_label;

        // If an icon was provided, add it.
        if(options.icon)
        {
            // This can be a resource name, or an element, usually created with helpers.create_icon.
            let node = options.icon;
            if(!(node instanceof HTMLElement))
                node = helpers.create_ppixiv_inline(node);

            let icon = this.container.querySelector(".icon");
            icon.appendChild(node);
            icon.hidden = false;
        }

        // Add items.
        for(let item of buttons)
        {
            // Move the button in.
            let item_container = item.container;
            item_container.remove();
            this.container.appendChild(item_container);
        }

        // If a button was provided, add it.
        if(options.button)
        {
            let node = helpers.create_ppixiv_inline(options.button);
            this.container.appendChild(node);
        }

        if(this.onclick_handler != null)
            this.container.classList.add("clickable");


        this.container.querySelector(".label").innerText = label;
        this.container.addEventListener("click", this.onclick);
    }

    refresh()
    {
        super.refresh();

        if(this.get_label)
            this.container.querySelector(".label").innerText = this.get_label();
    }

    set enabled(value)
    {
        helpers.set_class(this.container, "disabled", !value);
        this._enabled = value;
    }

    get enabled()
    {
        return this._enabled;
    }

    onclick(e)
    {
        // If consume_clicks is true, stopPropagation to stop the menu we're inside from
        // closing.
        if(this.consume_clicks)
            e.stopPropagation();

        if(!this._enabled)
        {
            // Always preventDefault if we're disabled.
            e.preventDefault();
            return;
        }

        if(this.onclick_handler)
        {
            e.preventDefault();
            this.onclick_handler(e);
        }
    }
}

// A simpler button, used for sub-buttons such as "Edit".
ppixiv.menu_option_nested_button = class extends ppixiv.menu_option
{
    constructor({
        onclick=null,
        label,
        ...options})
    {
        super({...options, template: `
            <div class="box-link clickable">
                <div class=label-box>
                    <span class=label></span>
                </div>
            </div>
        `});

        this.container.querySelector(".label").innerText = label;
        this.container.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
    
            onclick(e);
        });
    }
}

ppixiv.menu_option_toggle = class extends ppixiv.menu_option_button
{
    constructor({
        setting=null,
        buttons=[],

        // Most settings are just booleans, but this can be used to toggle between
        // string keys.  This can make adding more values to the option easier later
        // on.  A default value should be set in settings.js if this is used.
        on_value=true,
        off_value=false,
        ...options})
    {
        super({...options,
            button: "resources/checkbox.svg",
            buttons: buttons,
            onclick: (e) => {
                if(this.options && this.options.check && !this.options.check())
                    return;
        
                this.value = !this.value;
            },
        });

        this.setting = setting;
        this.on_value = on_value;
        this.off_value = off_value;
        if(this.setting)
            settings.changes.addEventListener(this.setting, this.refresh, { signal: this.shutdown_signal.signal });
    }

    refresh()
    {
        super.refresh();

        var value = this.value;
        if(this.options.invert_display)
            value = !value;

        // element.hidden doesn't work on SVG:
        this.container.querySelector(".checkbox").style.display = value? "":"none";

        // Update the explanation text.
        let text = value? this.explanation_enabled:this.explanation_disabled;
        let explanation = this.container.querySelector(".explanation");
        explanation.hidden = text == null;
        explanation.innerText = text;
    }

    get value()
    {
        return settings.get(this.setting) == this.on_value;
    }

    set value(value)
    {
        settings.set(this.setting, value? this.on_value:this.off_value);
    }
}

class menu_option_slider extends ppixiv.menu_option
{
    constructor({
        min=null,
        max=null,

        // If set, this is a list of allowed values.
        list=null,
        ...options
    })
    {
        super({...options, template: `
            <div class="menu-slider thumbnail-size-box">
                <span class=value></span>
                <input class=thumbnail-size type=range>
            </div>
        `});

        this.oninput = this.oninput.bind(this);
        this.list = list;

        this.container.addEventListener("input", this.oninput);
        this.container.addEventListener("click", (e) => { e.stopPropagation(); });

        this.slider = this.container.querySelector("input");
        if(this.list != null)
        {
            this.slider.min = 0;
            this.slider.max = this.list.length - 1;
        }
        else
        {
            this.slider.min = min;
            this.slider.max = max;
        }
    }
    
    refresh()
    {
        this._slider_value = this.value;
        super.refresh();
    }

    oninput(e)
    {
        this.value = this._slider_value;
    }

    get value()
    {
        return parseInt(super.value);
    }
    
    set value(value)
    {
        super.value = value;
    }

    _slider_index_to_value(value)
    {
        if(this.list == null)
            return value;
        return this.list[value];
    }

    _value_to_slider_index(value)
    {
        if(this.list == null)
            return value;

        let closest_idx = -1;
        let closest_distance = null;
        for(let idx = 0; idx < this.list.length; ++idx)
        {
            let v = this.list[idx];
            let distance = Math.abs(value - v);
            if(closest_distance == null || distance < closest_distance)
            {
                closest_idx = idx;
                closest_distance = distance;
            }
        }
        return closest_idx;
    }

    set _slider_value(value)
    {
        value = this._value_to_slider_index(value);

        if(this.slider.value == value)
            return;

        this.slider.value = value;
    }

    get _slider_value()
    {
        let value = parseInt(this.slider.value);
        value = this._slider_index_to_value(value);
        return value;
    }
}


ppixiv.menu_option_slider_setting = class extends menu_option_slider
{
    constructor({setting, ...options})
    {
        super(options);

        this.setting = setting;
    }

    get min_value() { return this.options.min; }
    get max_value() { return this.options.max; }

    get value()
    {
        return settings.get(this.setting);
    }

    set value(value)
    {
        settings.set(this.setting, value);
        this.refresh();
    }
};

// A widget to control the thumbnail size slider.
ppixiv.thumbnail_size_slider_widget = class extends menu_option_slider_setting
{
    constructor({...options})
    {
        super(options);

        this.refresh();
    }

    // Increase or decrease zoom.
    move(down)
    {
        settings.adjust_zoom(this.setting, down);
    }

    get value()
    {
        let value = super.value;
        if(typeof(value) != "number" || isNaN(value))
            value = 4;
        return value;
    }
    set value(value) { super.value = value; 
    }
    static thumbnail_size_for_value(value)
    {
        return 100 * Math.pow(1.3, value);
    }

    get thumbnail_size()
    {
        return thumbnail_size_slider_widget.thumbnail_size_for_value(this.slider.value);
    }
};
