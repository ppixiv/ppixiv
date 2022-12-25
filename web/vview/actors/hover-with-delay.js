// Add delays to hovering and unhovering.  The class "hover" will be set when the mouse
// is over the element (equivalent to the :hover selector), with a given delay before the
// state changes.
//
// This is used when hovering the top bar when in ui-on-hover mode, to delay the transition
// before the UI disappears.  transition-delay isn't useful for this, since it causes weird
// hitches when the mouse enters and leaves the area quickly.
import { helpers } from 'vview/misc/helpers.js';

export default class HoverWithDelay
{
    constructor(element, delay_enter, delay_exit)
    {
        this.element = element;
        this.delay_enter = delay_enter * 1000.0;
        this.delay_exit = delay_exit * 1000.0;
        this.timer = -1;
        this.pending_hover = null;

        element.addEventListener("mouseenter", (e) => { this.real_hover_changed(true); });
        element.addEventListener("mouseleave", (e) => { this.real_hover_changed(false); });
    }

    real_hover_changed(hovering)
    {
        // If we already have this event queued, just let it continue.
        if(this.pending_hover != null && this.pending_hover == hovering)
            return;

        // If the opposite event is pending, cancel it.
        if(this.hover_timeout != null)
        {
            realClearTimeout(this.hover_timeout);
            this.hover_timeout = null;
        }

        this.real_hover_state = hovering;
        this.pending_hover = hovering;
        let delay = hovering? this.delay_enter:this.delay_exit;
        this.hover_timeout = realSetTimeout(() => {
            this.pending_hover = null;
            this.hover_timeout = null;
            helpers.html.setClass(this.element, "hover", this.real_hover_state);
        }, delay);
    }
}
