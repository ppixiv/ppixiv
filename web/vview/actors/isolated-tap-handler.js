
// Detect isolated taps: single taps that don't become double-taps or drags, or
// are handled by something else.  This is a common mobile UI, but there's no
// event for it.
//
// We watch for taps where we see the release and no other events for our duration.
// This means the press is released quickly (not a long press or one where the user
// hesitated intenting to drag), there wasn't another press to make it a double-tap,
// and where none of the events are handled by anything else.
//
// We have to make assumptions about how long the double-click delay is.  If we
// guess too short we'll signal when a double-click could actually still happen,
// and if we guess too long we'll be less responsive.  The delay should be adjusted
// depending on how much of a problem false positives are.  For displaying the
// illust menu this can be a bit lower, since it'll just display the menu which will
// be immediately hidden by the second tap.
//
// This doesn't currently detect if the tap was on something that had a default
// action, like a link, since we only use this for taps on the image view.
export default class IsolatedTapHandler
{
    static handlers = new Set();

    // If any running IsolatedTapHandler saw a pointerdown and is about to run,
    // cancel it.  This can be used to prevent isolated taps in places where it's
    // hard to access a pointer event related to it.
    static preventTaps()
    {
        for(let handler of IsolatedTapHandler.handlers)
        {
            handler._clearPresses();
        }
    }

    constructor({ node, callback, delay=350, signal=null }={})
    {
        signal ??= (new AbortController()).signal;
        this.signal = signal;

        this._node = node;
        this._callback = callback;
        this._lastPointerDownAt = -99999;
        this._delay = delay;
        this._timeoutId = -1;
        this._pressed = false;
        this._allPresses = new Set();

        IsolatedTapHandler.handlers.add(this);
        this.signal.addEventListener("abort", () => IsolatedTapHandler.handlers.delete(this));

        this._eventNamesDuringTouch = ["pointerup", "pointercancel", "pointermove", "blur", "dblclick"];
        this._node.addEventListener("pointerdown", this._handleEvent, { signal });
    }

    // Start listening to events that we only listen to during a press, since these have to go
    // on window.
    _registerEvents()
    {
        for(let type of this._eventNamesDuringTouch)
            window.addEventListener(type, this._handleEvent, { capture: true, signal: this.signal });
    }

    _unregisterEvents()
    {
        for(let type of this._eventNamesDuringTouch)
            this._node.removeEventListener(type, this._handleEvent, { capture: true });
    }

    _handleEvent = (e) =>
    {
        if(e.type == "blur")
        {
            // iOS sometimes doesn't cancel events properly on gestures, so discard any press on
            // blur and clear our press list.
            this._clearPresses();
            return;
        }

        // Keep track of pointer events, since they forgot to include it on pointer events.
        // We won't know if there are multitouch events on other nodes.
        if(e.type == "pointerdown")
            this._allPresses.add(e.pointerId);
        else if(e.type == "pointerup" || e.type == "pointercancel")
            this._allPresses.delete(e.pointerId);

        // If we see pointer events for a different pointer, unqueue our event.
        if(this._pressed && e.pointerId != this._pressEvent.pointerId)
        {
            // console.log("Cancelling for multitouch");
            this._unqueueEvent();
            return;
        }

        // Cancel if we see a dblclick.  This is important because iOS doesn't always send pointer
        // events for double-taps.
        if(e.type == "dblclick")
        {
            // console.log("Cancelling for dblclick");
            this._unqueueEvent();
        }

        if(e.type == "pointercancel")
        {
            this._clearPresses();
            return;
        }

        if(e.type == "pointerdown")
        {
            // If this isn't the first touch on the element, ignore it.
            if(this._allPresses.size > 1)
            {
                // console.log("Ignoring press during multitouch");
                return;
            }

            // Start watching the other events.
            this._registerEvents();

            this._unqueueEvent();

            let now = Date.now();
            let timeSinceLastPress = now - this._lastPointerDownAt;
            this._lastPointerDownAt = Date.now();
            if(timeSinceLastPress < this._delay)
            {
                // If we get a pointerdown quickly after another, this is just cancelling any queued
                // event that we started, since this means it isn't an isolated tap.
                // console.log("Cancelled");
                return;
            }

            // If this is a pointerdown and we haven't seen another pointerdown in at least
            // our delay, start a new potential press.
            // console.log("Starting pointer monitoring");
            this._checkEvents = [];
            this._pressed = true;
            
            // Keep the initial press event so we can pass it to the callback.
            this._pressEvent = e;

            this._queueEvent();
        }

        // Any pointer movement cancels the tap.  Mobile browsers already threshold pointer movement,
        // so we don't need to do it.
        if(e.type == "pointermove")
        {
            this._unqueueEvent();
            return;
        }

        if(e.type == "pointerup")
        {
            this._unregisterEvents();
            this._pressed = false;
        }

        // We need to know if any of these events are handled, even if they're in event handlers
        // that trigger after us.  Just keep a list of all of them and we'll check them when the
        // timer expires.
        this._checkEvents.push(e);
    }

    _clearPresses()
    {
        this._unqueueEvent();
        this._allPresses.clear();
        this._pressed = false;
    }

    _queueEvent = () =>
    {
        if(this._timeoutId != -1)
            return;

        this._timeoutId = realSetTimeout(() => {
            if(this.signal.aborted)
                return;

            this._timeoutId = -1;

            // If the press is still held, this isn't an isolated press.
            if(this._pressed)
            {
                // console.log("Held too long");
                return;
            }

            // If any pointer event for this press was cancelled, that means something handled
            // something about the press, so don't use it.
            for(let event of this._checkEvents)
            {
                if(event.defaultPrevented || event.cancelBubble)
                {
                    // console.log("Press was handled:", event);
                    return;
                }

                // If partiallyHandled is set, it means something was done with the event
                // that didn't want to cancel the event, but does want to prevent us from
                // treating it as an isolated tap.  For example, if ClickOutsideListener
                // triggers to close the viewer menu it won't prevent the event, but we don't
                // want it to be an isolated tap.
                if(event.partiallyHandled)
                {
                    // console.log("Press handled by ClickOutsideListener");
                    return;
                }
            }

            this._callback(this._pressEvent);
        }, this._delay);
    }

    _unqueueEvent = () =>
    {
        if(this._timeoutId == -1)
            return;

        realClearTimeout(this._timeoutId);
        this._timeoutId = -1;
    }
}
