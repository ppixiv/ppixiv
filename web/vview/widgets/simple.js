import Widget from 'vview/widgets/widget.js';
import DragHandler from 'vview/misc/drag-handler.js';
import { helpers } from 'vview/misc/helpers.js';

export class CheckboxWidget extends Widget
{
    constructor({
        value=false,
        ...options})
    {
        super({...options, template: `
            ${ helpers.createIcon("", { classes: ["checkbox"] }) }
        `});

        this._checked = true;
    };

    set checked(value)
    {
        if(this._checked == value)
            return;

        this._checked = value;
        this.refresh();
    }
    get checked() { return this._checked; }

    async refresh()
    {
        this.root.innerText = this.checked? "check_box":"check_box_outline_blank";
    }
}

// A minimal replacement for <input type=range>.  HTML sliders are broken on iOS (they're
// very hard to drag), and for some reason Edge's sliders are grey and always look disabled.
export class SliderWidget extends Widget
{
    constructor({
        value=0,
        min=0,
        max=10,
        onchange=({value}) => { },
        ...options
    })
    {
        super({...options,
            template: `
            <div class=slider>
                <div class=track-left></div>
                <div class=track-right></div>
                <div class=thumb></div>
            </div>
            `,
        });

        this._value = value;
        this._min = min;
        this._max = max;
        this._onchange = onchange;

        this.dragger = new DragHandler({
            parent: this,
            name: "slider",
            deferredStart: () => false,
            element: this.parent.root,
            ondragstart: (args) => this._ondrag(args),
            ondrag: (args) => this._ondrag(args),
        });
    }

    get value() { return this._value; }
    get min() { return this._min; }
    get max() { return this._max; }
    set value(value)
    {
        if(this._value == value)
            return;
        this._value = value;
        this.refresh();
    }

    set min(value)
    {
        if(this._min == value)
            return;
        this._min = value;
        this.refresh();
    }

    set max(value)
    {
        if(this._max == value)
            return;
        this._max = value;
        this.refresh();
    }

    _ondrag({event})
    {
        let { left, right } = this.root.getBoundingClientRect();
        let newValue = helpers.math.scaleClamp(event.clientX, left, right, this._min, this._max);
        newValue = Math.round(newValue);
        if(this._value == newValue)
            return true;

        this._value = newValue;
        this.refresh();

        this._onchange({ value: this._value });
        return true;
    }

    refresh()
    {
        let percent = helpers.math.scaleClamp(this._value, this._min, this._max, 0, 100);
        this.root.style.setProperty("--fill", `${percent}%`);
    }
}
