// Watch for scrolls on a scroller, and call onchange when the user scrolls up or down.  This
// allows for an approximation of iOS's behavior of hiding navigation bars while scrolling down,
// then showing them if you scroll up.
//
// We can't mimic the behavior completely.  iOS hides navigation bars as you scroll, and then
// snaps to fully open or closed when you release the scroll.  There's no way to tell when a touch
// scroll ends, since scrolls cancel the touch and take it over completely.  No event is sent when
// the touch is released or when momentum scrolls settle.  Instead, we just watch for scrolling
// a minimum amount in the same direction,  This at least prevents the UI from appearing and disappearing
// too rapidly if the scroller is moved up and down quickly.

import Actor from 'vview/actors/actor.js';
import { helpers } from 'vview/misc/helpers.js';

export default class ScrollListener extends Actor
{
    constructor({
        scroller,

        // The minimum amount of movement in the same direction before it's treated as
        // a direction change.
        threshold=50,

        // If not null, the threshold when dragging up.  This allows dragging down to
        // hide the UI to have a longer threshold than dragging up to display it.  If this
        // is null, threshold is used.
        thresholdUp=10,

        // The initial value of scrolledForwards.  This is also the value used if it's not
        // possible to scroll.
        defaultValue=false,

        // If set, we always consider the scroller dragged up until we're past the height of
        // this node.  This allows keeping sticky UI visible until we've scrolled far enough
        // that the content below it will fill its space when it's hidden.
        stickyUiNode=null,

        // This is called when this.direction changes.
        onchange = (listener) => { },
        ...options
    })
    {
        super({ ...options });

        this._scroller = scroller;
        this._threshold = threshold;
        this._thresholdUp = thresholdUp ?? threshold;
        this._onchange = onchange;
        this._motion = 0;
        this._defaultValue = defaultValue;
        this._scrolledForwards = false;
        this._stickyUiNode = stickyUiNode;
        this._scroller.addEventListener("scroll", () => this._refreshAfterScroll(), this._signal);

        // If we've been given a sticky UI node, refresh if its height changes.
        if(this._stickyUiNode)
        {
            this._resizeObserver = new ResizeObserver(() => {
                this._refreshAfterScroll();
            });
            this.shutdownSignal.signal.addEventListener("abort", () => this._resizeObserver.disconnect());
            this._resizeObserver.observe(this._stickyUiNode);
        }

        // Use ScrollDimensionsListener to detect changes to scrollHeight.  This is needed so if
        // elements are removed and the scroller becomes no longer scrollable, we reset to the default
        // state (usually causing the UI to be visible).  Otherwise, it would be impossible to scroll
        // to show the UI if this happens.
        new ScrollDimensionsListener({
            scroller,
            parent: this,
            onchange: () => {
                this._refreshAfterScroll({force: true});
            },
        });

        this.reset({callOnchange: false});
    }

    // Reset scrolledForwards to the default and clear scroll history.  onchange will be
    // called if onchange is true.
    reset({callOnchange=true}={})
    {
        this._scrolledForwards = this._defaultValue;
        this._lastScrollY = this._scroller.scrollTop;
        this._lastScrollHeight = this._scroller.scrollHeight;

        if(callOnchange)
            this._onchange(this);
    }

    // Return true if the most recent scroll was positive (down or right), or false if it was
    // negative.
    get scrolledForwards()
    {
        return this._scrolledForwards;
    }

    _refreshAfterScroll({force=false}={})
    {
        // If scrollHeight changed, content may have been added or removed to the scroller, so
        // we don't know if we've actually been scrolling up or down.  Ignore a single scroll
        // event after the scroller changes, so we don't treat a big content change as a scroll.
        if(!force && this._lastScrollHeight != this._scroller.scrollHeight)
        {
            console.log("Ignoring scroll after scroller change");
            this._lastScrollHeight = this._scroller.scrollHeight;
            return;
        }

        // If the scroller's scrollHeight changed since the last scroll, ignore 
        // Ignore scrolls past the edge, to avoid being confused by iOS's overflow scrolling.
        let newScrollTop = helpers.math.clamp(this._scroller.scrollTop, 0, this._scroller.scrollHeight-this._scroller.offsetHeight);
        let delta = newScrollTop - this._lastScrollY;
        this._lastScrollY = newScrollTop;

        // If scrolling changed direction, reset motion.
        if(delta > 0 != this._motion > 0)
            this._motion = 0;
        this._motion += delta;

        // If we've moved far enough in either direction, set it as the scrolling direction.
        let scrolledForwards = this._scrolledForwards;
        if(this._motion < -this._thresholdUp)
            scrolledForwards = false;
        else if(Math.abs(this._motion) > this._threshold)
            scrolledForwards = true;

        // If we're at the very top or very bottom, the user can't scroll any further to reach
        // the threshold, so force the direction to up or down.
        if(newScrollTop == 0)
            scrolledForwards = false;
        else if(newScrollTop >= this._scroller.scrollHeight - 1)
            scrolledForwards = true;

        if(!ppixiv.ios)
        {
            // If we're at the very top or very bottom, the user can't scroll any further to reach
            // the threshold, so force the direction to up or down.  This isn't needed on iOS, since
            // overscroll means we can always scroll.
            if(newScrollTop == 0)
                scrolledForwards = false;
            else if(newScrollTop >= this._scroller.scrollHeight - 1)
                scrolledForwards = true;
        }

        if(this._stickyUiNode)
        {
            if(newScrollTop < this._stickyUiNode.offsetHeight)
                scrolledForwards = false;
        }

        // If it's not possible to scroll the scroller, always use the default.
        if(!this._canScroll)
            scrolledForwards = this._defaultValue;

        if(this._scrolledForwards == scrolledForwards)
            return;

        // Update the scroll direction.
        this._scrolledForwards = scrolledForwards;
        this._onchange(this);
    }

    // Return true if we think it's possible to move the scroller, ignoring overscroll.
    get _canScroll()
    {
        return this._scroller.scrollHeight > this._scroller.offsetHeight;
    }
}

// There seems to be no quick way to tell when scrollHeight or scrollWidth change on a
// scroller.  We have to watch for resizes on all children.
class ScrollDimensionsListener extends Actor
{
    constructor({
        scroller,
        onchange = (listener) => { },
        ...options
    }={})
    {
        super({ ...options });

        this.onchange = onchange;

        // Create a MutationOBserver to watch for children being added or removed from the scroller.
        // We only need to look at immediate children.
        this._mutationObserver = new MutationObserver((mutations) => {
            for(let mutation of mutations)
            {
                for(let node of mutation.addedNodes)
                    this._resizeObserver.observe(node);
                for(let node of mutation.removedNodes)
                    this._resizeObserver.unobserve(node);
            }
        });
        this._mutationObserver.observe(scroller, { childList: true });
        this.shutdownSignal.signal.addEventListener("abort", () => this._mutationObserver.disconnect());

        // The ResizeObserver watches for size changes to children which could cause the scroll
        // size to change.
        this._resizeObserver = new ResizeObserver(() => {
            this.onchange(this);
        });
        this.shutdownSignal.signal.addEventListener("abort", () => this._resizeObserver.disconnect());

        // Add children that already exist to the ResizeObserver.
        for(let node of scroller.children)
            this._resizeObserver.observe(node);
    }
}
