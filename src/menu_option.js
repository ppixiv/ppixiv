"use strict";

// Simple menu settings widgets.
ppixiv.menu_option = class extends widget
{
    static add_settings(container)
    {
        // Options that we pass to all menu_options:
        let global_options = {
            consume_clicks: true,
            container: container,
            parent: this,
        };

        if(container.closest(".screen-manga-container"))
        {
            new thumbnail_size_slider_widget({
                ...global_options,
                label: "Thumbnail size",
                setting: "manga-thumbnail-size",
                min: 0,
                max: 7,
            });
        }

        if(container.closest(".screen-search-container"))
        {
            new thumbnail_size_slider_widget({
                ...global_options,
                label: "Thumbnail size",
                setting: "thumbnail-size",
                min: 0,
                max: 7,
            });
        }
        
        new menu_option_toggle({
            ...global_options,
            label: "Disabled by default",
            setting: "disabled-by-default",
        });

        new menu_option_toggle({
            ...global_options,
            label: "Hide cursor",
            setting: "no-hide-cursor",
            invert_display: true,
        });

        // Firefox's contextmenu behavior is broken, so hide this option.
        if(navigator.userAgent.indexOf("Firefox/") == -1)
        {
            new menu_option_toggle({
                ...global_options,
                label: "Hold shift to open context menu",
                setting: "invert-popup-hotkey",
            });
        }

        new menu_option_toggle({
            ...global_options,
            label: "Hover to show UI",
            setting: "ui-on-hover",
            onchange: this.update_from_settings,
        });

        new menu_option_toggle({
            ...global_options,
            label: "Invert scrolling while zoomed",
            setting: "invert-scrolling",
        });
 
        new menu_option_toggle_light_theme({
            ...global_options,
            label: "Light mode",
            setting: "theme",
        });

        new menu_option_toggle({
            ...global_options,
            label: "Show translations",
            setting: "disable-translations",
            invert_display: true,
        });
 
        new menu_option_toggle({
            ...global_options,
            label: "Thumbnail panning",
            setting: "disable_thumbnail_panning",
            invert_display: true,
        });

        new menu_option_toggle({
            ...global_options,
            label: "Thumbnail zooming",
            setting: "disable_thumbnail_zooming",
            invert_display: true,
        });

        new menu_option_toggle({
            ...global_options,
            label: "Quick view",
            setting: "quick_view",

            check: () => {
                // Only enable changing this option when using a mouse.  It has no effect
                // on touchpads.
                if(ppixiv.pointer_listener.pointer_type == "mouse")
                    return true;

                message_widget.singleton.show("Quick View is only supported when using a mouse.");
                return false;
            },
        });
        new menu_option_toggle({
            ...global_options,
            label: "Remember recent history",
            setting: "no_recent_history",
            invert_display: true,
        });

        new menu_option_row({
            ...global_options,
            items: [
                new menu_option_toggle({
                    ...global_options,
                    label: "Linked tabs",
                    setting: "linked_tabs_enabled",
                }),
                new menu_option_button({
                    ...global_options,
                    label: "Edit",
                    classes: ["small-font"],
                    no_icon_padding: true,

                    // Let this button close the menu.
                    consume_clicks: false,

                    onclick: (e) => {
                        main_controller.singleton.link_tabs_popup.visible = true;
                        return true;
                    },
                }),
            ],
        });

/*        new menu_option_toggle({
            container: container,
            label: "Touchpad mode",
            setting: "touchpad-mode",
        }); */

    }

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
    constructor({url=null, onclick=null, consume_clicks=false, ...options})
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
                <span class=icon>
                </span>
                <span class=label></span>
            </{type}>
        `});

        this.onclick_handler = onclick;
        this.onclick = this.onclick.bind(this);
        this._enabled = true;
        this.consume_clicks = consume_clicks;

        // If an icon was provided, add it.
        if(options.icon)
        {
            let node = helpers.create_ppixiv_inline(options.icon);
            let icon = this.container.querySelector(".icon");
            icon.appendChild(node);
        }

        // If no_icon_padding is set, hide the icon.  This is used when we don't want
        // icon padding on the left.
        if(options.no_icon_padding)
            this.container.querySelector(".icon").hidden = true;

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
    constructor({setting=null, ...options})
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
    }

    get value()
    {
        return settings.get(this.setting);
    }

    set value(value)
    {
        settings.set(this.setting, value);
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
                <div class="box-section">
                    <span class=label></span>
                </div>
                <div class="box-section">
                    <input class=thumbnail-size type=range>
                </div>
            </div>
        `});

        this.oninput = this.oninput.bind(this);

        this.container.addEventListener("input", this.oninput);
        this.container.addEventListener("click", (e) => { e.stopPropagation(); });
        this.container.querySelector(".label").innerText = options.label;

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

        this.onwheel = this.onwheel.bind(this);
        this.onkeydown = this.onkeydown.bind(this);
        this.setting = setting;

        var view = this.container.closest(".screen");
        view.addEventListener("wheel", this.onwheel, { passive: false });
        view.addEventListener("keydown", this.onkeydown);

        this.refresh();
    }

    get min_value() { return this.options.min; }
    get max_value() { return this.options.max; }

    onkeydown(e)
    {
        var zoom = helpers.is_zoom_hotkey(e);
        if(zoom != null)
        {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.move(zoom < 0);
        }
    }

    onwheel(e)
    {
        if(!e.ctrlKey)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();

        this.move(e.deltaY > 0);
    }

    // Increase or decrease zoom.
    move(down)
    {
        var value = this._slider_value;
        value += down?-1:+1;
        value = helpers.clamp(value, 0, 5);
        this._slider_value = value;
        this.value = this._slider_value;
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
