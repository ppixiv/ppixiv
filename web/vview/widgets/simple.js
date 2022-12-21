import Widget from 'vview/widgets/widget.js';
import { helpers } from 'vview/ppixiv-imports.js';

export class CheckboxWidget extends Widget
{
    constructor({
        value=false,
        ...options})
    {
        super({...options, template: `
            ${ helpers.create_icon("", { classes: ["checkbox"] }) }
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
        this.container.innerText = this.checked? "check_box":"check_box_outline_blank";
    }
}
