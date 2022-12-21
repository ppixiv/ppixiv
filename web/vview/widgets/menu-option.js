import Widget from 'vview/widgets/widget.js';
import { CheckboxWidget } from 'vview/widgets/simple.js';
import { helpers } from 'vview/misc/helpers.js';

// Simple menu settings widgets.
export class MenuOption extends Widget
{
    constructor({
        classes=[],
        refresh=null,
        ...options
    })
    {
        super(options);
        for(let class_name of classes)
            this.container.classList.add(class_name);

        this.onrefresh = refresh;
    }

    refresh()
    {
        if(this.onrefresh)
            this.onrefresh();

        this.refresh_explanation();
    }

    // The current explanation text.  The subclass can override this.
    get explanation_text() { return null; }

    // Update the explanation text, if any.
    refresh_explanation()
    {
        let text = this.explanation_text;
        if(typeof(text) == "function")
            text = text();

        let explanation = this.container.querySelector(".explanation");
        if(explanation == null)
            return;

        explanation.hidden = text == null;
        explanation.innerText = text;
    }
}

// A container for multiple options on a single row.
export class MenuOptionRow extends MenuOption
{
    constructor({
        label=null,
         ...options})
    {
        super({...options, template: `
            <div class=box-link-row>
                <span class=label-box style="flex: 1;" hidden></span>
            </div>
        `});

        if(label != null)
        {
            let span = this.container.querySelector(".label-box");
            span.hidden = false;
            span.innerText = label;
        }
    }
}

export class MenuOptionButton extends MenuOption
{
    constructor({
        url=null,
        label,
        get_label=null,
        onclick=null,
        explanation_enabled=null,
        explanation_disabled=null,
        popup=null,
        icon=null,
        ...options})
    {
        super({...options, template: `
            ${helpers.create_box_link({
                label,
                icon: icon,
                link: url,
                popup,
                classes: ["menu-toggle"],
                explanation: "", // create the explanation field
            })}
        `});

        // Set the box-link label to flex, to push buttons to the right:
        this.container.querySelector(".label-box").style.flex = "1";

        this.onclick_handler = onclick;
        this._enabled = true;
        this.explanation_enabled = explanation_enabled;
        this.explanation_disabled = explanation_disabled;
        this.get_label = get_label;

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

    get explanation_text()
    {
        return this.enabled? this.explanation_enabled:this.explanation_disabled;
    }

    onclick = (e) =>
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
            // XXX: check callers
            // e.preventDefault();
            this.onclick_handler(e);
        }
    }
}

// A simpler button, used for sub-buttons such as "Edit".
export class MenuOptionNestedButton extends MenuOption
{
    constructor({
        onclick=null,
        label,
        ...options})
    {
        super({...options, template: helpers.create_box_link({label: "",   classes: ["clickable"] })});

        this.container.querySelector(".label").innerText = label;
        this.container.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
    
            onclick(e);
        });
    }
}

export class MenuOptionToggle extends MenuOptionButton
{
    constructor({
        checked=false,
        ...options
    })
    {
        super({...options});

        this.checkbox = new CheckboxWidget({ container: this.container });
        this.checkbox.checked = checked;
    }

    // The subclass overrides this to get and store its value.
    get value() { return false; }
    set value(value) { }

    get explanation_text()
    {
        return this.value? this.explanation_enabled:this.explanation_disabled;
    }
}

export class MenuOptionToggleSetting extends MenuOptionToggle
{
    constructor({
        setting=null,
        onclick=null,

        // Most settings are just booleans, but this can be used to toggle between
        // string keys.  This can make adding more values to the option easier later
        // on.  A default value should be set in settings.js if this is used.
        on_value=true,
        off_value=false,
        ...options})
    {
        super({...options,
            onclick: (e) => {
                if(this.options && this.options.check && !this.options.check())
                    return;
        
                this.value = !this.value;

                // Call the user's onclick, if any.
                if(onclick)
                    onclick(e);
            },
        });

        this.setting = setting;
        this.on_value = on_value;
        this.off_value = off_value;
        if(this.setting)
            ppixiv.settings.addEventListener(this.setting, this.refresh.bind(this), { signal: this.shutdown_signal.signal });
    }

    refresh()
    {
        super.refresh();

        var value = this.value;
        if(this.options.invert_display)
            value = !value;

        this.checkbox.checked = value;
    }

    get value()
    {
        return ppixiv.settings.get(this.setting) == this.on_value;
    }

    set value(value)
    {
        ppixiv.settings.set(this.setting, value? this.on_value:this.off_value);
    }
}

export class MenuOptionSlider extends MenuOption
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

    oninput = (e) =>
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

            // Check for exact matches, so the list can contain strings.
            if(value == v)
                return idx;

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

export class MenuOptionSliderSetting extends MenuOptionSlider
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
        return ppixiv.settings.get(this.setting);
    }

    set value(value)
    {
        ppixiv.settings.set(this.setting, value);
        this.refresh();
    }
};

// A menu option widget for settings that come from a list of options.  This would
// make more sense as a dropdown, but for now it uses a slider.
export class MenuOptionOptionsSetting extends MenuOptionButton
{
    constructor({setting,
        label,
        values,
        explanation,
        ...options})
    {
        super({
            ...options,
            label: label,
        });

        this.get_explanation = explanation;

        this.setting = setting;
        this.values = values;
        this.slider = new MenuOptionSliderSetting({
            container: this.container,
            label: "xxx",
            setting: setting,
            min: 0,
            max: values.length,
            list: values,
            classes: ["slider"],
            
            // Refresh the label when the value changes.
            refresh: () => { this.refresh(); },
        });
    

        this.container.querySelector(".slider").style.flexGrow = .25;        
    }

    get explanation_text()
    {
        return this.get_explanation(this.slider.value);
    }
};

// A widget to control the thumbnail size slider.
export class MenuOptionsThumbnailSizeSlider extends MenuOptionSliderSetting
{
    constructor({...options})
    {
        super(options);

        this.refresh();
    }

    // Increase or decrease zoom.
    move(down)
    {
        ppixiv.settings.adjust_zoom(this.setting, down);
    }

    get value()
    {
        let value = super.value;
        if(typeof(value) != "number" || isNaN(value))
            value = 4;
        return value;
    }
    set value(value) { super.value = value;  }
    static thumbnail_size_for_value(value)
    {
        return 100 * Math.pow(1.3, value);
    }
}
