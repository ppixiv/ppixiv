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

        this.clear_timer();

        this.container.querySelector(".message").innerHTML = message;

        this.container.classList.add("show");
        this.container.classList.remove("centered");
        this.timer = realSetTimeout(() => {
            this.container.classList.remove("show");
        }, 3000);
    }

    clear_timer()
    {
        if(this.timer != null)
        {
            realClearTimeout(this.timer);
            this.timer = null;
        }
    }

    hide()
    {
        this.clear_timer();
        this.container.classList.remove("show");
    }
}
