"use strict";


ppixiv.settings_dialog = class extends ppixiv.dialog_widget
{
    constructor({...options})
    {
        super({...options, visible: true, template: `
            <div class="settings-dialog dialog">
                <div class=content>
                    <div class=scroll>
                        <div class=header>Settings</div>
                        <div class=items style="
                            display: flex;
                            flex-direction: column;
                        "></div>
                    </div>

                    <div class=close-button>
                        <ppixiv-inline src="resources/close-button.svg"></ppixiv-inline>
                    </div>
                </div>
            </div>
        `});

        this.container.querySelector(".close-button").addEventListener("click", (e) => { this.hide(); });

        this.add_settings();

        // Close if the container is clicked, but not if something inside the container is clicked.
        this.container.addEventListener("click", (e) => {
            if(e.target != this.container)
                return;

            this.visible = false;
        });

        // Hide on any state change.
        window.addEventListener("popstate", (e) => {
            this.visible = false;
        });
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
        let container = this.container.querySelector(".scroll .items")

        // Options that we pass to all menu_options:
        let global_options = {
            container: container,
            parent: this,
            classes: ["settings-row"],
        };

        // Each settings widget.  Doing it this way lets us move widgets around in the
        // menu without moving big blocks of code around.
        let settings_widgets = {
            thumbnail_size: () => {
                let thumb_size_slider = new menu_option_button({
                    ...global_options,
                    label: "Thumbnail size",
                    show_checkbox: false,
                });
        
                thumb_size_slider.container.querySelector(".buttons").hidden = false;
                thumb_size_slider.container.querySelector(".buttons").style.flexGrow = .5;
                return new thumbnail_size_slider_widget({
                    ...global_options,
                    parent: thumb_size_slider,
                    container: thumb_size_slider.container.querySelector(".buttons"),
                    setting: "thumbnail-size",
                    min: 0,
                    max: 7,
                });
            },

            manga_thumbnail_size: () => {
                let manga_size_slider = new menu_option_button({
                    ...global_options,
                    label: "Thumbnail size (manga)",
                    show_checkbox: false,
                });
        
                manga_size_slider.container.querySelector(".buttons").hidden = false;
                manga_size_slider.container.querySelector(".buttons").style.flexGrow = .5;
                return new thumbnail_size_slider_widget({
                    ...global_options,
                    parent: manga_size_slider,
                    container: manga_size_slider.container.querySelector(".buttons"),
                    setting: "manga-thumbnail-size",
                    min: 0,
                    max: 7,
                });
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
                    label: "Invert scrolling while zoomed",
                    setting: "invert-scrolling",
                    explanation_enabled: "Dragging down moves the image down",
                    explanation_disabled: "Dragging down moves the image up",
                });
            },

            theme: () => {
                return new menu_option_toggle_light_theme({
                    ...global_options,
                    label: "Light mode",
                    setting: "theme",
                    explanation_enabled: "FLASHBANG",
                });
            },
    
            disable_translations: () => {
                return new menu_option_toggle({
                    ...global_options,
                    label: "Show translations",
                    setting: "disable-translations",
                    invert_display: true,
                    explanation_enabled: "Show tag translations when available",
                    explanation_disabled: "Don't show tag translations",
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
                return new menu_option_toggle({
                    ...global_options,
                    label: "Pan back to the top when changing images",
                    setting: "view_mode",
                    on_value: "manga",
                    off_value: "illust",
                });
            },
    
            linked_tabs_enabled: () => {
                let linked_tabs = new menu_option_toggle({
                    ...global_options,
                    label: "Linked tabs",
                    setting: "linked_tabs_enabled",
                    explanation_enabled: "View images in multiple tabs",
                    explanation_disabled: "View images in multiple tabs",
                });
                
                linked_tabs.container.querySelector(".buttons").hidden = false;
                return new menu_option_button({
                    ...global_options,
                    parent: linked_tabs,
                    container: linked_tabs.container.querySelector(".buttons"),
                    label: "Edit",
                    classes: ["button"],
                    show_checkbox: false,
    
                    onclick: (e) => {
                        this.visible = false;
    
                        main_controller.singleton.link_tabs_popup.visible = true;
                        return true;
                    },
                });
            },
        };

        settings_widgets.thumbnail_size();
        settings_widgets.manga_thumbnail_size();
        settings_widgets.disabled_by_default();
        settings_widgets.no_hide_cursor();

        // Firefox's contextmenu behavior is broken, so hide this option.
        if(navigator.userAgent.indexOf("Firefox/") == -1)
            settings_widgets.invert_popup_hotkey();

        settings_widgets.ctrl_opens_popup();
        settings_widgets.ui_on_hover();
        settings_widgets.invert_scrolling();
        settings_widgets.theme();
        settings_widgets.disable_translations();
        settings_widgets.disable_thumbnail_panning();
        settings_widgets.disable_thumbnail_zooming();
        settings_widgets.quick_view();

        settings_widgets.view_mode();
        settings_widgets.linked_tabs_enabled();

        // Hidden for now (not very useful)
        // settings_widgets.no_recent_history();
    }
};

// Simple menu settings widgets.
ppixiv.menu_option = class extends widget
{
    constructor({classes=[], ...options})
    {
        super(options);
        for(let class_name of classes)
            this.container.classList.add(class_name);

        this.refresh = this.refresh.bind(this);
    }

    refresh()
    {
        if(this.options.onchange)
            this.options.onchange();
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
        onclick=null,
        show_checkbox=true,
        explanation_enabled=null,
        explanation_disabled=null,
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
                <div class=label-box>
                    <span class=label></span>
                    <span class=explanation hidden></span>
                </div>
                <div class=buttons hidden></div>
                <span class=icon></span>
            </{type}>
        `});

        this.onclick = this.onclick.bind(this);

        this.onclick_handler = onclick;
        this._enabled = true;
        this.explanation_enabled = explanation_enabled;
        this.explanation_disabled = explanation_disabled;

        // If an icon was provided, add it.
        if(options.icon)
        {
            let node = helpers.create_ppixiv_inline(options.icon);
            let icon = this.container.querySelector(".icon");
            icon.appendChild(node);
        }

        if(!show_checkbox)
            this.container.querySelector(".icon").hidden = true;

        if(this.onclick_handler != null)
            this.container.classList.add("clickable");

        this.container.querySelector(".label").innerText = options.label;
        this.container.addEventListener("click", this.onclick);
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

ppixiv.menu_option_toggle = class extends ppixiv.menu_option_button
{
    constructor({
        setting=null,

        // Most settings are just booleans, but this can be used to toggle between
        // string keys.  This can make adding more values to the option easier later
        // on.  A default value should be set in settings.js if this is used.
        on_value=true,
        off_value=false,
        ...options})
    {
        super({...options,
            icon: "resources/checkbox.svg",
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
            settings.register_change_callback(this.setting, this.refresh);
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

// A special case for the theme, which is just a light/dark toggle but stored
// as a string.
class menu_option_toggle_light_theme extends menu_option_toggle
{
    get value()
    {
        var value = super.value;
        return value == "light";
    }

    set value(value)
    {
        super.value = value? "light":"dark";
    }
}

class menu_option_slider extends ppixiv.menu_option
{
    constructor({...options})
    {
        super({...options, template: `
            <div class="menu-slider thumbnail-size-box">
                <input class=thumbnail-size type=range>
            </div>
        `});

        this.oninput = this.oninput.bind(this);

        this.container.addEventListener("input", this.oninput);
        this.container.addEventListener("click", (e) => { e.stopPropagation(); });

        this.slider = this.container.querySelector("input");
        this.slider.min = this.options.min;
        this.slider.max = this.options.max;
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

    set _slider_value(value)
    {
        if(this.slider.value == value)
            return;

        this.slider.value = value;
    }

    get _slider_value()
    {
        return parseInt(this.slider.value);
    }
}


// A widget to control the thumbnail size slider.
ppixiv.thumbnail_size_slider_widget = class extends menu_option_slider
{
    constructor({setting, ...options})
    {
        super(options);

        this.setting = setting;

        this.refresh();
    }

    get min_value() { return this.options.min; }
    get max_value() { return this.options.max; }

    // Increase or decrease zoom.
    move(down)
    {
        settings.adjust_zoom(this.setting, down);
    }

    get value()
    {
        let value = settings.get(this.setting);
        if(typeof(value) != "number" || isNaN(value))
            value = 4;
        return value;
    }
    
    set value(value)
    {
        settings.set(this.setting, value);
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
