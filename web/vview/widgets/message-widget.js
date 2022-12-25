import Widget from 'vview/widgets/widget.js';

// Display messages in the popup widget.  This is a singleton.
export default class MessageWidget extends Widget
{
    constructor(options)
    {
        super({...options, template: `
            <div class=hover-message>
                <div class=message></div>
            </div>`,
        });

        this.timer = null;

        // Dismiss messages when changing screens.
        window.addEventListener("screenchanged", (e) => this.hide(), this._signal);
    }

    show(message)
    {
        console.assert(message != null);

        this.clearTimer();

        this.root.querySelector(".message").innerHTML = message;

        this.root.classList.add("show");
        this.root.classList.remove("centered");
        this.timer = realSetTimeout(() => {
            this.root.classList.remove("show");
        }, 3000);
    }

    clearTimer()
    {
        if(this.timer != null)
        {
            realClearTimeout(this.timer);
            this.timer = null;
        }
    }

    hide()
    {
        this.clearTimer();
        this.root.classList.remove("show");
    }
}
