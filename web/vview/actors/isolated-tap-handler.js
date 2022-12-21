
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
    static prevent_taps()
    {
        for(let handler of IsolatedTapHandler.handlers)
        {
            handler._clear_presses();
        }
    }

    constructor({ node, callback, delay=350, signal=null }={})
    {
        signal ??= (new AbortController()).signal;
        this.signal = signal;

        this.node = node;
        this.callback = callback;
        this.last_pointer_down_at = -99999;
        this.delay = delay;
        this._timeout_id = -1;
        this._pressed = false;
        this._all_presses = new Set();

        IsolatedTapHandler.handlers.add(this);
        this.signal.addEventListener("abort", () => IsolatedTapHandler.handlers.delete(this));

        this._event_names_during_touch = ["pointerup", "pointercancel", "pointermove", "blur", "dblclick"];
        this.node.addEventListener("pointerdown", this._handle_event, { signal });
    }

    // Start listening to events that we only listen to during a press, since these have to go
    // on window.
    _register_events()
    {
        for(let type of this._event_names_during_touch)
            window.addEventListener(type, this._handle_event, { capture: true, signal: this.signal });
    }

    _unregister_events()
    {
        for(let type of this._event_names_during_touch)
            this.node.removeEventListener(type, this._handle_event, { capture: true });
    }

    _handle_event = (e) =>
    {
        if(e.type == "blur")
        {
            // iOS sometimes doesn't cancel events properly on gestures, so discard any press on
            // blur and clear our press list.
            this._clear_presses();
            return;
        }

        // Keep track of pointer events, since they forgot to include it on pointer events.
        // We won't know if there are multitouch events on other nodes.
        if(e.type == "pointerdown")
            this._all_presses.add(e.pointerId);
        else if(e.type == "pointerup" || e.type == "pointercancel")
            this._all_presses.delete(e.pointerId);

        // If we see pointer events for a different pointer, unqueue our event.
        if(this._pressed && e.pointerId != this._press_event.pointerId)
        {
            // console.log("Cancelling for multitouch");
            this._unqueue_event();
            return;
        }

        // Cancel if we see a dblclick.  This is important because iOS doesn't always send pointer
        // events for double-taps.
        if(e.type == "dblclick")
        {
            // console.log("Cancelling for dblclick");
            this._unqueue_event();
        }

        if(e.type == "pointercancel")
        {
            this._clear_presses();
            return;
        }

        if(e.type == "pointerdown")
        {
            // If this isn't the first touch on the element, ignore it.
            if(this._all_presses.size > 1)
            {
                // console.log("Ignoring press during multitouch");
                return;
            }

            // Start watching the other events.
            this._register_events();

            this._unqueue_event();

            let now = Date.now();
            let time_since_last_press = now - this.last_pointer_down_at;
            this.last_pointer_down_at = Date.now();
            if(time_since_last_press < this.delay)
            {
                // If we get a pointerdown quickly after another, this is just cancelling any queued
                // event that we started, since this means it isn't an isolated tap.
                // console.log("Cancelled");
                return;
            }

            // If this is a pointerdown and we haven't seen another pointerdown in at least
            // our delay, start a new potential press.
            // console.log("Starting pointer monitoring");
            this._check_events = [];
            this._pressed = true;
            
            // Keep the initial press event so we can pass it to the callback.
            this._press_event = e;

            this._queue_event();
        }

        // Any pointer movement cancels the tap.  Mobile browsers already threshold pointer movement,
        // so we don't need to do it.
        if(e.type == "pointermove")
        {
            this._unqueue_event();
            return;
        }

        if(e.type == "pointerup")
        {
            this._unregister_events();
            this._pressed = false;
        }

        // We need to know if any of these events are handled, even if they're in event handlers
        // that trigger after us.  Just keep a list of all of them and we'll check them when the
        // timer expires.
        this._check_events.push(e);
    }

    _clear_presses()
    {
        this._unqueue_event();
        this._all_presses.clear();
        this._pressed = false;
    }

    _queue_event = () =>
    {
        if(this._timeout_id != -1)
            return;

        this._timeout_id = realSetTimeout(() => {
            if(this.signal.aborted)
                return;

            this._timeout_id = -1;

            // If the press is still held, this isn't an isolated press.
            if(this._pressed)
            {
                // console.log("Held too long");
                return;
            }

            // If any pointer event for this press was cancelled, that means something handled
            // something about the press, so don't use it.
            for(let event of this._check_events)
            {
                if(event.defaultPrevented || event.cancelBubble)
                {
                    // console.log("Press was handled:", event);
                    return;
                }

                // If partially_handled is set, it means something was done with the event
                // that didn't want to cancel the event, but does want to prevent us from
                // treating it as an isolated tap.  For example, if click_outside_listener
                // triggers to close the viewer menu it won't prevent the event, but we don't
                // want it to be an isolated tap.
                if(event.partially_handled)
                {
                    // console.log("Press handled by click_outside_listener");
                    return;
                }
            }

            this.callback(this._press_event);
        }, this.delay);
    }

    _unqueue_event = () =>
    {
        if(this._timeout_id == -1)
            return;
        realClearTimeout(this._timeout_id);
        this._timeout_id= -1;
    }
}
