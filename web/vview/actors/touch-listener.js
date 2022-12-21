// PointerListener is complicated because it deals with overlapping LMB and RMB presses,
// and a bunch of browser weirdness around context menus and other things that a lot of
// UI doesn't need.  touch_listener is a simpler interface that only listens for left-clicks.
// Touch inputs will see multitouch if the multi flag is true.
export default class TouchListener
{
    // callback(event) will be called each time buttons change.  The event will be the event
    // that actually triggered the state change, and can be preventDefaulted, etc.
    constructor({
        element,
        callback,
        multi=false,
        signal,
    }={})
    {
        this.element = element;
        this.callback = callback;
        this.multi = multi;
        this.pressed_pointer_ids = new Set();        
        this.event_options = { };
        if(signal)
            this.event_options.signal = signal;

        this.element.addEventListener("pointerdown", this.onpointerevent, this.event_options);
    }

    // Register events that we only register while one or more buttons are pressed.
    //
    // We only register pointermove as needed, so we don't get called for every mouse
    // movement, and we only register pointerup as needed so we don't register a ton
    // of events on window.
    _update_events_while_pressed()
    {
        if(this.pressed_pointer_ids.size > 0)
        {
            // These need to go on window, so if a mouse button is pressed and that causes
            // the element to be hidden, we still get the pointerup.
            window.addEventListener("pointerup", this.onpointerevent, { capture: true, ...this.event_options });
            window.addEventListener("pointercancel", this.onpointerevent, { capture: true, ...this.event_options });
            window.addEventListener("blur", this.onblur, this.event_options);
        } else {
            window.removeEventListener("pointerup", this.onpointerevent, { capture: true, ...this.event_options });
            window.removeEventListener("pointercancel", this.onpointerevent, { capture: true, ...this.event_options });
            window.removeEventListener("blur", this.onblur, this.event_options);
        }
    }

    onblur = (event) =>
    {
        // Work around an iOS Safari bug: horizontal navigation drags don't always cancel pointer
        // events.  It sends pointerdown, but then never sends pointerup or pointercancel when it
        // takes over the drag, so it looks like the touch stays pressed forever.  This seems
        // to happen on forwards navigation but not back.
        //
        // If this happens, we get a blur event, so if we get a blur event and we were still pressed,
        // send an emulated pointercancel event to end the drag.
        for(let pointer_id of this.pressed_pointer_ids)
        {
            console.warn(`window.blur for ${pointer_id} fired without a pointer event being cancelled, simulating it`);
            this.onpointerevent(new PointerEvent("pointercancel", {
                pointerId: pointer_id,
                button: 0,
                buttons: 0,
            }));
        }
    }

    onpointerevent = (event) =>
    {
        let is_pressed = event.type == "pointerdown";

        // Stop if this doesn't change the state of this pointer.
        if(this.pressed_pointer_ids.has(event.pointerId) == is_pressed)
            return;

        // If this is a multitouch and multi isn't enabled, ignore it.
        if(!this.multi && is_pressed && this.pressed_pointer_ids.size > 0)
            return;

        // We need to register pointermove to see presses past the first.
        if(is_pressed)
            this.pressed_pointer_ids.add(event.pointerId);
        else
            this.pressed_pointer_ids.delete(event.pointerId);
        this._update_events_while_pressed();

        event.pressed = is_pressed;
        this.callback(event);
        delete event.pressed;
    }
}
