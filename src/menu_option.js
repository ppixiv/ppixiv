"use strict";

// Simple menu settings widgets.
ppixiv.menu_option = class extends widget
{
    static add_settings(container)
    {
        if(container.closest(".screen-manga-container"))
        {
            new thumbnail_size_slider_widget({
                container: container,
                label: "Thumbnail size",
                setting: "manga-thumbnail-size",
                min: 0,
                max: 7,
            });
        }

        if(container.closest(".screen-search-container"))
        {
            new thumbnail_size_slider_widget({
                container: container,
                label: "Thumbnail size",
                setting: "thumbnail-size",
                min: 0,
                max: 7,
            });
        }
        
        new menu_option_toggle({
            container: container,
            label: "Disabled by default",
            setting: "disabled-by-default",
        });

        new menu_option_toggle({
            container: container,
            label: "Hide cursor",
            setting: "no-hide-cursor",
            invert_display: true,
        });

        // Firefox's contextmenu behavior is broken, so hide this option.
        if(navigator.userAgent.indexOf("Firefox/") == -1)
        {
            new menu_option_toggle({
                container: container,
                label: "Hold shift to open context menu",
                setting: "invert-popup-hotkey",
            });
        }

        new menu_option_toggle({
            container: container,
            label: "Hover to show UI",
            setting: "ui-on-hover",
            onchange: this.update_from_settings,
        });

        new menu_option_toggle({
            container: container,
            label: "Invert scrolling while zoomed",
            setting: "invert-scrolling",
        });
 
        new menu_option_toggle_light_theme({
            container: container,
            label: "Light mode",
            setting: "theme",
        });

        new menu_option_toggle({
            container: container,
            label: "Show translations",
            setting: "disable-translations",
            invert_display: true,
        });
 
        new menu_option_toggle({
            container: container,
            label: "Thumbnail panning",
            setting: "disable_thumbnail_panning",
            invert_display: true,
        });

        new menu_option_toggle({
            container: container,
            label: "Thumbnail zooming",
            setting: "disable_thumbnail_zooming",
            invert_display: true,
        });

        new menu_option_toggle({
            container: container,
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
            container: container,
            label: "Remember recent history",
            setting: "no_recent_history",
            invert_display: true,
        });
        new menu_option_button({
            container: container,
            label: "Link tabs",
            onclick: () => {
                main_controller.singleton.link_tabs_popup.visible = true;
            }
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

        if(this.options.setting)
            settings.register_change_callback(this.options.setting, this.refresh);
    }

    get value()
    {
        return settings.get(this.options.setting);
    }

    set value(value)
    {
        settings.set(this.options.setting, value);
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
            console.log("xxx", item);
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
    constructor({url=null, onclick=null, ...options})
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

    refresh()
    {
        super.refresh();
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
        // Don't stopPropagation, so things like dropdown_menu_opener see the click and
        // know to hide the menu.
        e.preventDefault();

        if(!this._enabled)
            return;

        if(this.onclick_handler && this.this.onclick_handler(e))
            return;

        this.clicked(e);
    }

    clicked(e)
    {
    }
}

ppixiv.menu_option_toggle = class extends ppixiv.menu_option_button
{
    constructor({...options})
    {
        super({...options,
            icon: "resources/checkbox.svg",
        });
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

    clicked(e)
    {
        if(this.options && this.options.check && !this.options.check())
            return;

        this.value = !this.value;
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
    constructor(options)
    {
        super(options);

        this.onwheel = this.onwheel.bind(this);
        this.onkeydown = this.onkeydown.bind(this);

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
        var value = super.value;
        if(typeof(value) != "number" || isNaN(value))
            value = 4;
        return value;
    }
    
    set value(value)
    {
        super.value = value;
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
