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
        this._lastScrollY = 0;
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

    // Reset scrolledForwards to the given direction and clear scroll history.  If resetTo is null, use
    // the default.  onchange will be called if onchange is true.  
    reset({resetTo=null, callOnchange=true}={})
    {
        if(resetTo == null)
            resetTo = this._defaultValue;

        // Set this direction by simulating a drag in that direction, so we only set the
        // direction if it would normally be possible.
        this._motion = resetTo? this._threshold:-this._thresholdUp;

        this._updateScrolledForwards({callOnchange});

        this._motion = 0;
    }

    // Return true if the most recent scroll was positive (down or right), or false if it was
    // negative.
    get scrolledForwards()
    {
        return this._scrolledForwards;
    }

    get _currentScrollPosition()
    {
        // Ignore scrolls past the edge, to avoid being confused by iOS's overflow scrolling.
        return helpers.math.clamp(this._scroller.scrollTop, 0, this._scroller.scrollHeight-this._scroller.offsetHeight);
    }

    _refreshAfterScroll({force=false, callOnchange=true}={})
    {
        // If scrollHeight changed, content may have been added or removed to the scroller, so
        // we don't know if we've actually been scrolling up or down.  Ignore a single scroll
        // event after the scroller changes, so we don't treat a big content change as a scroll.
        if(!force && this._lastScrollHeight != this._scroller.scrollHeight)
        {
            console.log("Ignoring scroll after scroller change");
            this._lastScrollHeight = this._scroller.scrollHeight;
            this._lastScrollY = this._currentScrollPosition;
            return;
        }

        let newScrollPosition = this._currentScrollPosition;
        let delta = newScrollPosition - this._lastScrollY;
        this._lastScrollY = newScrollPosition;

        // If scrolling changed direction, reset motion.
        if(delta > 0 != this._motion > 0)
            this._motion = 0;
        this._motion += delta;

        this._updateScrolledForwards({callOnchange});
    }

    // Update this._scrolledForwards after a change to this._motion.
    _updateScrolledForwards({callOnchange})
    {
        let newScrollTop = this._currentScrollPosition;
        let newScrollBottom = newScrollTop + this._scroller.offsetHeight;

        // If we've moved far enough in either direction, set it as the scrolling direction.
        let scrolledForwards = this._scrolledForwards;

        if(this._motion <= -this._thresholdUp)
            scrolledForwards = false;
        else if(Math.abs(this._motion) >= this._threshold)
            scrolledForwards = true;

        // If we're at the very top or very bottom, the user can't scroll any further to reach
        // the threshold, so force the direction to up or down.  This also keeps the navigation
        // bar hidden if we're at the bottom, so it doesn't overlap content.
        if(newScrollTop == 0)
            scrolledForwards = false;
        else if(newScrollBottom >= this._scroller.scrollHeight - 1)
            scrolledForwards = true;

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

        if(callOnchange)
            this._onchange(this);
    }

    // Return true if we think it's possible to move the scroller, ignoring overscroll.
    get _canScroll()
    {
        return this._scroller.scrollHeight > this._scroller.offsetHeight;
    }
}

// Call onchange when a node has children added or removed.
//
// Treat children of display: contents nodes as direct children of the node.  They have no
// layout of their own, and we're doing this to track resizes of the layout children of a
// node.  If we don't do this, we won't see scroller size changes inside display: contents
// nodes directly inside the scroller.
class ImmediateChildrenListener extends Actor
{
    constructor({
        root,
        onchange,
        ...options
    }={})
    {
        super({ ...options });

        this._onchange = onchange;
        this._watching = new Set();

        this._mutationObserver = new MutationObserver((mutations) => {
            for(let mutation of mutations)
            {
                for(let node of mutation.addedNodes)
                    this._nodeAdded(node, { isRoot: false });

                for(let node of mutation.removedNodes)
                    this._nodeRemoved(node);
            }
        });
        this.shutdownSignal.signal.addEventListener("abort", () => this._mutationObserver.disconnect());

        this._nodeAdded(root, { isRoot: true });
    }

    // A node we're watching had a child added (or we're adding the root).
    _nodeAdded(node, { isRoot })
    {
        if(!isRoot)
            this._onchange({node, added: true});

        // If an added node is display: contents, it doesn't have layout, and we need
        // to watch its children in the same way we're watching the root.  We don't
        // support display changing to or from contents.
        let isContents = getComputedStyle(node).display == "contents";
        if(isRoot || isContents)
        {
            console.assert(!this._watching.has(node));
            this._watching.add(node);
            this._mutationObserver.observe(node, { childList: true });

            for(let child of node.children)
                this._nodeAdded(child, {isRoot: false});
        }
    }

    // A node we're watching had a child removed.
    _nodeRemoved(node)
    {
        this._onchange({node, added: false});

        let isContents = getComputedStyle(node).display == "contents";
        if(isRoot || isContents)
        {
            console.assert(this._watching.has(node));
            this._watching.remove(node);
            this._mutationObserver.unobserve(node, { childList: true });

            for(let child of node.children)
            {
                this._nodeRemoved(child);
            }
        }
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

        // The ResizeObserver watches for size changes to children which could cause the scroll
        // size to change.
        this._resizeObserver = new ResizeObserver(() => {
            this.onchange(this);
        });
        this.shutdownSignal.signal.addEventListener("abort", () => this._resizeObserver.disconnect());

        this._childrenListener = new ImmediateChildrenListener({
            parent: this,
            root: scroller,
            onchange: ({ node, added }) =>
            {
                if(added)
                    this._resizeObserver.observe(node);
                else
                    this._resizeObserver.unobserve(node);
            }
        });
    }
}
