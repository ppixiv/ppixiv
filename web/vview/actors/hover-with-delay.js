// Add delays to hovering and unhovering.  The class "hover" will be set when the mouse
// is over the element (equivalent to the :hover selector), with a given delay before the
// state changes.
//
// This is used when hovering the top bar when in ui-on-hover mode, to delay the transition
// before the UI disappears.  transition-delay isn't useful for this, since it causes weird
// hitches when the mouse enters and leaves the area quickly.
import Actor from '/vview/actors/actor.js';
import { helpers } from '/vview/misc/helpers.js';

export default class HoverWithDelay extends Actor
{
    constructor({
        parent,
        element,
        enterDelay=0,
        exitDelay=0,
    }={})
    {
        super({ parent });

        this.element = element;
        this.enterDelay = enterDelay * 1000.0;
        this.exitDelay = exitDelay * 1000.0;
        this.timer = -1;
        this.pendingHover = null;

        element.addEventListener("mouseenter", (e) => this.onHoverChanged(true), this._signal);
        element.addEventListener("mouseleave", (e) => this.onHoverChanged(false), this._signal);
    }

    onHoverChanged(hovering)
    {
        // If we already have this event queued, just let it continue.
        if(this.pendingHover != null && this.pendingHover == hovering)
            return;

        // If the opposite event is pending, cancel it.
        if(this.hoverTimeout != null)
        {
            realClearTimeout(this.hoverTimeout);
            this.hoverTimeout = null;
        }

        this.realHoverState = hovering;
        this.pendingHover = hovering;
        let delay = hovering? this.enterDelay:this.exitDelay;
        this.hoverTimeout = realSetTimeout(() => {
            this.pendingHover = null;
            this.hoverTimeout = null;
            helpers.html.setClass(this.element, "hover", this.realHoverState);
        }, delay);
    }
}
