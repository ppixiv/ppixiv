// A popup for inputting text.
import DialogWidget from 'vview/widgets/dialog.js';
import { helpers } from 'vview/ppixiv-imports.js';

export class TextPrompt extends DialogWidget
{
    static async prompt(options)
    {
        let prompt = new this(options);
        return await prompt.result;
    }

    constructor({
        title,
        value="",
        ...options
    }={})
    {
        super({...options, dialog_class: "text-entry-popup", small: true, header: title, template: `
            <div class=input-box>
                <div class=editor contenteditable></div>
                <span class=submit-button>${ helpers.create_icon("mat:check") }</span>
            </div>
        `});
        
        this.result = new Promise((completed, cancelled) => {
            this._completed = completed;
        });

        this.input = this.container.querySelector(".editor");

        // Set text by creating a node manually, since textContent won't create a node if value is "".
        this.input.appendChild(document.createTextNode(value));

        this.container.querySelector(".submit-button").addEventListener("click", this.submit);
    }

    handle_keydown = (e) =>
    {
        if(super.handle_keydown(e))
            return true;

        // The escape key is handled by DialogWidget.
        if(e.key == "Enter")
        {
            this.submit();
            return true;
        }

        return false;
    }

    visibility_changed()
    {
        super.visibility_changed();

        if(this.visible)
        {
            window.addEventListener("keydown", this.onkeydown, { signal: this.visibility_abort.signal });

            // Focus when we become visible.
            this.input.focus();

            // Move the cursor to the end.
            let size = this.input.firstChild.length;
            window.getSelection().setBaseAndExtent(this.input.firstChild, size, this.input.firstChild, size);
        }
        else
        {
            // If we didn't complete by now, cancel.
            this._completed(null);
        }
    }

    // Close the popup and call the completion callback with the result.
    submit = () =>
    {
        let result = this.input.textContent;
        this._completed(result);

        this.visible = false;
    }
}

export class confirm_prompt extends DialogWidget
{
    static async prompt(options)
    {
        let prompt = new this(options);
        return await prompt.result;
    }

    constructor({
        header,
        text,
        ...options
    }={})
    {
        super({...options, dialog_class: "confirm-dialog", allow_close: false, small: true, header,
        template: `
            <div class=text hidden></div>
            <div class=input-box>
                ${helpers.create_box_link({
                    label: "Yes",
                    icon: "image",
                    classes: ["yes"],
                })}

                ${helpers.create_box_link({
                    label: "No",
                    icon: "image",
                    classes: ["no"],
                })}
            </div>
        `});
        
        if(text)
        {
            let text_node = this.container.querySelector(".text");
            text_node.innerText = text;
            text_node.hidden = false;
        }

        this.result = new Promise((completed, cancelled) => {
            this._completed = completed;
        });

        this.container.querySelector(".yes").addEventListener("click", () => this.submit(true), { signal: this.shutdown_signal.signal });
        this.container.querySelector(".no").addEventListener("click", () => this.submit(false), { signal: this.shutdown_signal.signal });
    }

    onkeydown = (e) =>
    {
        if(e.key == "Escape")
        {
            e.preventDefault();
            e.stopPropagation();
            this.submit(false);
        }

        if(e.key == "Enter")
        {
            e.preventDefault();
            e.stopPropagation();
            this.submit(true);
        }
    }

    visibility_changed()
    {
        super.visibility_changed();

        if(this.visible)
        {
            window.addEventListener("keydown", this.onkeydown, { signal: this.visibility_abort.signal });
        }
        else
        {
            // If we didn't complete by now, cancel.
            this._completed(null);
        }
    }

    // Close the popup and call the completion callback with the result.
    submit = (result) =>
    {
        this._completed(result);

        this.visible = false;
    }
}
