// PointerListener is complicated because it deals with overlapping LMB and RMB presses,
// and a bunch of browser weirdness around context menus and other things that a lot of
// UI doesn't need.  TouchListener is a simpler interface that only listens for left-clicks.
// Touch inputs will see multitouch if the multi flag is true.
import Actor from 'vview/actors/actor.js';

export default class TouchListener extends Actor
{
    // callback(event) will be called each time buttons change.  The event will be the event
    // that actually triggered the state change, and can be preventDefaulted, etc.
    constructor({
        element,
        parent,
        callback,
        multi=false,
    }={})
    {
        super({ parent });

        this.element = element;
        this.callback = callback;
        this.multi = multi;
        this.pressedPointerIds = new Set();        

        this.element.addEventListener("pointerdown", this.onpointerevent, this._signal);
    }

    // Register events that we only register while one or more buttons are pressed.
    //
    // We only register pointermove as needed, so we don't get called for every mouse
    // movement, and we only register pointerup as needed so we don't register a ton
    // of events on window.
    _updateEventsWhilePressed()
    {
        if(this.pressedPointerIds.size > 0)
        {
            // These need to go on window, so if a mouse button is pressed and that causes
            // the element to be hidden, we still get the pointerup.
            window.addEventListener("pointerup", this.onpointerevent, { capture: true, ...this._signal });
            window.addEventListener("pointercancel", this.onpointerevent, { capture: true, ...this._signal });
            window.addEventListener("blur", this.onblur, this._signal);
        } else {
            window.removeEventListener("pointerup", this.onpointerevent, { capture: true });
            window.removeEventListener("pointercancel", this.onpointerevent, { capture: true });
            window.removeEventListener("blur", this.onblur);
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
        for(let pointerId of this.pressedPointerIds)
        {
            console.warn(`window.blur for ${pointerId} fired without a pointer event being cancelled, simulating it`);
            this.onpointerevent(new PointerEvent("pointercancel", {
                pointerId,
                button: 0,
                buttons: 0,
            }));
        }
    }

    onpointerevent = (event) =>
    {
        let isPressed = event.type == "pointerdown";

        // Stop if this doesn't change the state of this pointer.
        if(this.pressedPointerIds.has(event.pointerId) == isPressed)
            return;

        // If this is a multitouch and multi isn't enabled, ignore it.
        if(!this.multi && isPressed && this.pressedPointerIds.size > 0)
            return;

        // We need to register pointermove to see presses past the first.
        if(isPressed)
            this.pressedPointerIds.add(event.pointerId);
        else
            this.pressedPointerIds.delete(event.pointerId);
        this._updateEventsWhilePressed();

        event.pressed = isPressed;
        this.callback(event);
        delete event.pressed;
    }
}
