"use strict";

// Simple menu settings widgets.
ppixiv.menu_option = class
{
    static add_settings(container)
    {
        if(container.closest(".screen-manga-container"))
        {
            new thumbnail_size_slider_widget(container, {
                label: "Thumbnail size",
                setting: "manga-thumbnail-size",
                min: 0,
                max: 7,
            });
        }

        if(container.closest(".screen-search-container"))
        {
            new thumbnail_size_slider_widget(container, {
                label: "Thumbnail size",
                setting: "thumbnail-size",
                min: 0,
                max: 7,
            });
        }
        
        new menu_option_toggle(container, {
            label: "Disabled by default",
            setting: "disabled-by-default",
        });

        new menu_option_toggle(container, {
            label: "Hide cursor",
            setting: "no-hide-cursor",
            invert_display: true,
        });

        // Firefox's contextmenu behavior is broken, so hide this option.
        if(navigator.userAgent.indexOf("Firefox/") == -1)
        {
            new menu_option_toggle(container, {
                label: "Hold shift to open context menu",
                setting: "invert-popup-hotkey",
            });
        }

        new menu_option_toggle(container, {
            label: "Hover to show UI",
            setting: "ui-on-hover",
            onchange: this.update_from_settings,
        });

        new menu_option_toggle(container, {
            label: "Invert scrolling while zoomed",
            setting: "invert-scrolling",
        });
 
        new menu_option_toggle_light_theme(container, {
            label: "Light mode",
            setting: "theme",
        });

        new menu_option_toggle(container, {
            label: "Show translations",
            setting: "disable-translations",
            invert_display: true,
        });
 
        new menu_option_toggle(container, {
            label: "Thumbnail panning",
            setting: "disable_thumbnail_panning",
            invert_display: true,
        });

        new menu_option_toggle(container, {
            label: "Thumbnail zooming",
            setting: "disable_thumbnail_zooming",
            invert_display: true,
        });

        new menu_option_toggle(container, {
            label: "Quick view",
            setting: "quick_view",
        });
        new menu_option_toggle(container, {
            label: "Remember recent history",
            setting: "no_recent_history",
            invert_display: true,
        });
        new menu_option_button(container, {
            label: "Link tabs",
            onclick: () => {
                main_controller.singleton.link_tabs_popup.visible = true;
            }
        });


/*        new menu_option_toggle(container, {
            label: "Touchpad mode",
            setting: "touchpad-mode",
        }); */

    }

    constructor(container, options)
    {
        this.refresh = this.refresh.bind(this);

        this.container = container;
        this.options = options;

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

ppixiv.menu_option_toggle = class extends ppixiv.menu_option
{
    constructor(container, options)
    {
        super(container, options);

        this.onclick = this.onclick.bind(this);

        this.item = helpers.create_from_template(".template-menu-toggle");
        this.container.appendChild(this.item);
        this.item.addEventListener("click", this.onclick);
        this.item.querySelector(".label").innerText = options.label;

        this.refresh();
    }

    refresh()
    {
        super.refresh();

        var value = this.value;
        if(this.options.invert_display)
            value = !value;
        
        this.item.querySelector(".on").hidden = !value;
        this.item.querySelector(".off").hidden = value;
    }

    onclick(e)
    {
        e.preventDefault();
        e.stopPropagation();

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
    constructor(container, options)
    {
        super(container, options);

        this.oninput = this.oninput.bind(this);

        this.item = helpers.create_from_template(".template-menu-slider");
        this.item.addEventListener("input", this.oninput);
        this.item.addEventListener("click", (e) => { e.stopPropagation(); });
        this.item.querySelector(".label").innerText = options.label;

        this.slider = this.item.querySelector("input");
        this.slider.min = this.options.min;
        this.slider.max = this.options.max;
        this.container.appendChild(this.item);
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
    constructor(container, options)
    {
        super(container, options);

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

class menu_option_button extends ppixiv.menu_option
{
    constructor(container, options)
    {
        super(container, options);

        this.item = helpers.create_from_template(".template-menu-button");
        this.container.appendChild(this.item);
        this.item.querySelector(".label").innerText = options.label;

        this.item.addEventListener("click", (e) => {
            this.options.onclick();
        });
    }
}
