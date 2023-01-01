import Widget from 'vview/widgets/widget.js';
import { CheckboxWidget, SliderWidget } from 'vview/widgets/simple.js';
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
        for(let className of classes)
            this.root.classList.add(className);

        this.onrefresh = refresh;
    }

    refresh()
    {
        if(this.onrefresh)
            this.onrefresh();

        this.refreshExplanation();
    }

    // The current explanation text.  The subclass can override this.
    get explanationText() { return null; }

    // Update the explanation text, if any.
    refreshExplanation()
    {
        let text = this.explanationText;
        if(typeof(text) == "function")
            text = text();

        let explanation = this.root.querySelector(".explanation");
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
            let span = this.root.querySelector(".label-box");
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
        getLabel=null,
        onclick=null,
        explanationEnabled=null,
        explanationDisabled=null,
        popup=null,
        icon=null,
        ...options})
    {
        super({...options, template: `
            ${helpers.createBoxLink({
                label,
                icon: icon,
                link: url,
                popup,
                classes: ["menu-toggle"],
                explanation: "", // create the explanation field
            })}
        `});

        this._clickHandler = onclick;
        this._enabled = true;
        this.explanationEnabled = helpers.other.makeFunction(explanationEnabled);
        this.explanationDisabled = helpers.other.makeFunction(explanationDisabled ?? explanationEnabled);
        this.getLabel = getLabel;

        if(this._clickHandler != null)
            this.root.classList.add("clickable");

        this.root.querySelector(".label").innerText = label;
        this.root.addEventListener("click", this.onclick);
    }

    refresh()
    {
        super.refresh();

        if(this.getLabel)
            this.root.querySelector(".label").innerText = this.getLabel();
    }

    set enabled(value)
    {
        helpers.html.setClass(this.root, "disabled", !value);
        this._enabled = value;
    }

    get enabled()
    {
        return this._enabled;
    }

    get explanationText()
    {
        return this.enabled? this.explanationEnabled():this.explanationDisabled();
    }

    onclick = (e) =>
    {
        if(!this._enabled)
        {
            // Always preventDefault if we're disabled.
            e.preventDefault();
            return;
        }

        if(this._clickHandler)
        {
            // XXX: check callers
            // e.preventDefault();
            this._clickHandler(e);
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
        super({...options, template: helpers.createBoxLink({label: "",   classes: ["clickable"] })});

        this.root.querySelector(".label").innerText = label;
        this.root.addEventListener("click", (e) => {
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

        this.checkbox = new CheckboxWidget({ container: this.querySelector(".widget-box") });
        this.checkbox.checked = checked;
    }

    // The subclass overrides this to get and store its value.
    get value() { return false; }
    set value(value) { }

    get explanationText()
    {
        return this.value? this.explanationEnabled:this.explanationDisabled;
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
        onValue=true,
        offValue=false,
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
        this.onValue = onValue;
        this.offValue = offValue;
        if(this.setting)
            ppixiv.settings.addEventListener(this.setting, this.refresh.bind(this), { signal: this.shutdownSignal.signal });
    }

    refresh()
    {
        super.refresh();

        let value = this.value;
        if(this.options.invertDisplay)
            value = !value;

        this.checkbox.checked = value;
    }

    get value()
    {
        return ppixiv.settings.get(this.setting) == this.onValue;
    }

    set value(value)
    {
        ppixiv.settings.set(this.setting, value? this.onValue:this.offValue);
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
            <vv-container class=menu-slider></vv-container>
        `});

        this.slider = new SliderWidget({
            container: this.root,
            onchange: ({value}) => {
                this.value = this.sliderValue;
            }
        });

        this.list = list;
        if(this.list != null)
        {
            min = 0;
            max = this.list.length - 1;
        }

        this.slider.min = min;
        this.slider.max = max;
    }
    
    refresh()
    {
        this.sliderValue = this.value;
        super.refresh();
    }

    get value()
    {
        return parseInt(super.value);
    }
    
    set value(value)
    {
        super.value = value;
    }

    _sliderIndexToValue(value)
    {
        if(this.list == null)
            return value;
        return this.list[value];
    }

    _valueToSliderIndex(value)
    {
        if(this.list == null)
            return value;

        let closestIndex = -1;
        let closestDistance = null;
        for(let idx = 0; idx < this.list.length; ++idx)
        {
            let v = this.list[idx];

            // Check for exact matches, so the list can contain strings.
            if(value == v)
                return idx;

            let distance = Math.abs(value - v);
            if(closestDistance == null || distance < closestDistance)
            {
                closestIndex = idx;
                closestDistance = distance;
            }
        }
        return closestIndex;
    }

    set sliderValue(value)
    {
        value = this._valueToSliderIndex(value);

        if(this.slider.value == value)
            return;

        this.slider.value = value;
    }

    get sliderValue()
    {
        let value = parseInt(this.slider.value);
        value = this._sliderIndexToValue(value);
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

    get minValue() { return this.options.min; }
    get maxValue() { return this.options.max; }

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

        this._getExplanation = explanation;

        this.setting = setting;
        this.values = values;
        this.slider = new MenuOptionSliderSetting({
            container: this.root.querySelector(".widget-box"),
            label: "xxx",
            setting: setting,
            min: 0,
            max: values.length,
            list: values,
            
            // Refresh the label when the value changes.
            refresh: () => { this.refresh(); },
        });
    }

    get explanationText()
    {
        return this._getExplanation(this.slider.value);
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
        ppixiv.settings.adjustZoom(this.setting, down);
    }

    get value()
    {
        let value = super.value;
        if(typeof(value) != "number" || isNaN(value))
            value = 4;
        return value;
    }
    set value(value) { super.value = value;  }
    static thumbnailSizeForValue(value)
    {
        return 100 * Math.pow(1.3, value);
    }
}
