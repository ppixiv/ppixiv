// A popup for inputting text.
import DialogWidget from '/vview/widgets/dialog.js';
import { helpers } from '/vview/misc/helpers.js';

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
        super({...options, dialogClass: "text-entry-popup", small: true, header: title, template: `
            <div class=input-box>
                <div class=editor contenteditable></div>
                <span class=submit-button>${ helpers.createIcon("mat:check") }</span>
            </div>
        `});
        
        this.result = new Promise((completed, cancelled) => {
            this._completed = completed;
        });

        this.input = this.root.querySelector(".editor");

        // Set text by creating a node manually, since textContent won't create a node if value is "".
        this.input.appendChild(document.createTextNode(value));

        this.root.querySelector(".submit-button").addEventListener("click", this.submit);
    }

    _handleKeydown = (e) =>
    {
        if(super._handleKeydown(e))
            return true;

        // The escape key is handled by DialogWidget.
        if(e.key == "Enter")
        {
            this.submit();
            return true;
        }

        return false;
    }

    visibilityChanged()
    {
        super.visibilityChanged();

        if(this.visible)
        {
            window.addEventListener("keydown", this.onkeydown, { signal: this.visibilityAbort.signal });

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

export class ConfirmPrompt extends DialogWidget
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
        super({...options, dialogClass: "confirm-dialog", allowClose: false, small: true, header,
        template: `
            <div class=text hidden></div>
            <div class=input-box>
                ${helpers.createBoxLink({
                    label: "Yes",
                    icon: "image",
                    classes: ["yes"],
                })}

                ${helpers.createBoxLink({
                    label: "No",
                    icon: "image",
                    classes: ["no"],
                })}
            </div>
        `});
        
        if(text)
        {
            let textNode = this.root.querySelector(".text");
            textNode.innerText = text;
            textNode.hidden = false;
        }

        this.result = new Promise((completed, cancelled) => {
            this._completed = completed;
        });

        this.root.querySelector(".yes").addEventListener("click", () => this.submit(true), { signal: this.shutdownSignal });
        this.root.querySelector(".no").addEventListener("click", () => this.submit(false), { signal: this.shutdownSignal });
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

    visibilityChanged()
    {
        super.visibilityChanged();

        if(this.visible)
        {
            window.addEventListener("keydown", this.onkeydown, { signal: this.visibilityAbort.signal });
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
