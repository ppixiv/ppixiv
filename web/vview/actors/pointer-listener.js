// The pointer API is sadistically awful.  Only the first pointer press is sent by pointerdown.
// To get others, you have to register pointermove and get spammed with all mouse movement.
// You have to register pointermove when a button is pressed in order to see other buttons
// without keeping a pointermove event running all the time.  You also have to use e.buttons
// instead of e.button, because pointermove doesn't tell you what buttons changed, making e.button
// meaningless.
//
// Who designed this?  This isn't some ancient IE6 legacy API.  How do you screw up a mouse
// event API this badly?

import { helpers } from 'vview/misc/helpers.js';

export default class PointerListener
{
    // The global handler is used to track button presses and mouse movement globally,
    // primarily to implement pointer_listener.check().

    // The latest mouse position seen by install_global_handler.
    static latest_mouse_page_position = [window.innerWidth/2, window.innerHeight/2];
    static latest_mouse_client_position = [window.innerWidth/2, window.innerHeight/2];
    static buttons = 0;
    static button_pointer_ids = new Map();
    static pointer_type = "mouse";
    static install_global_handler()
    {
        window.addEventListener("pointermove", (e) => {
            PointerListener.latest_mouse_page_position = [e.pageX, e.pageY];
            PointerListener.latest_mouse_client_position = [e.clientX, e.clientY];
            this.pointer_type = e.pointerType;
        }, { passive: true, capture: true });

        new PointerListener({
            element: window,
            button_mask: 0xFFFF, // everything
            capture: true,
            callback: (e) => {
                if(e.pressed)
                {
                    PointerListener.buttons |= 1 << e.mouseButton;
                    PointerListener.button_pointer_ids.set(e.mouseButton, e.pointerId);
                }
                else
                {
                    PointerListener.buttons &= ~(1 << e.mouseButton);
                    PointerListener.button_pointer_ids.delete(e.mouseButton);
                }
            }
        });
    }

    // callback(event) will be called each time buttons change.  The event will be the event
    // that actually triggered the state change, and can be preventDefaulted, etc.
    //
    // To disable, include {signal: AbortSignal} in options.
    constructor({element, callback, button_mask=1, ...options}={})
    {
        this.element = element;
        this.button_mask = button_mask;
        this.pointermove_registered = false;
        this.buttons_down = 0;
        this.callback = callback;
        this.event_options = options;

        let handling_right_click = (button_mask & 2) != 0;
        this.blocking_context_menu_until_timer = false;
        if(handling_right_click)
            window.addEventListener("contextmenu", this.oncontextmenu, this.event_options);

        if(options.signal)
        {
            options.signal.addEventListener("abort", (e) => {
                // If we have a block_contextmenu_timer timer running when we're cancelled, remove it.
                if(this.block_contextmenu_timer != null)
                    realClearTimeout(this.block_contextmenu_timer);
            });
        }
        
        this.element.addEventListener("pointerdown", this.onpointerevent, this.event_options);
        this.element.addEventListener("simulatedpointerdown", this.onpointerevent, this.event_options);
    }

    // Register events that we only register while one or more buttons are pressed.
    //
    // We only register pointermove as needed, so we don't get called for every mouse
    // movement, and we only register pointerup as needed so we don't register a ton
    // of events on window.
    register_events_while_pressed(enable)
    {
        if(this.pointermove_registered)
            return;
        this.pointermove_registered = true;
        this.element.addEventListener("pointermove", this.onpointermove, this.event_options);

        // These need to go on window, so if a mouse button is pressed and that causes
        // the element to be hidden, we still get the pointerup.
        window.addEventListener("pointerup", this.onpointerevent, this.event_options);
        window.addEventListener("pointercancel", this.onpointerevent, this.event_options);
    }

    unregister_events_while_pressed(enable)
    {
        if(!this.pointermove_registered)
            return;
        this.pointermove_registered = false;
        this.element.removeEventListener("pointermove", this.onpointermove, this.event_options);
        window.removeEventListener("pointerup", this.onpointerevent, this.event_options);
        window.removeEventListener("pointercancel", this.onpointerevent, this.event_options);
    }

    button_changed(buttons, event)
    {
        // We need to register pointermove to see presses past the first.
        if(buttons)
            this.register_events_while_pressed();
        else
            this.unregister_events_while_pressed();

        let old_buttons_down = this.buttons_down;
        this.buttons_down = buttons;
        for(let button = 0; button < 5; ++button)
        {
            let mask = 1 << button;

            // Ignore this if it's not a button change for a button in our mask.
            if(!(mask & this.button_mask))
                continue;
            let was_pressed = old_buttons_down & mask;
            let is_pressed = this.buttons_down & mask;

            if(was_pressed == is_pressed)
                continue;

            // Pass the button in event.mouseButton, and whether it was pressed or released in event.pressed.
            // Don't use e.button, since it's in a different order than e.buttons.
            event.mouseButton = button;
            event.pressed = is_pressed;
            this.callback(event);

            // Remove event.mouseButton so it doesn't appear for unrelated event listeners.
            delete event.mouseButton;
            delete event.pressed;

            // Right-click handling
            if(button == 1)
            {
                // If this is a right-click press and the user prevented the event, block the context
                // menu when this button is released.
                if(is_pressed && event.defaultPrevented)
                    this.block_context_menu_until_release = true;

                // If this is a right-click release and the user prevented the event (or the corresponding
                // press earlier), block the context menu briefly.  There seems to be no other way to do
                // this: cancelling pointerdown or pointerup don't prevent actions like they should,
                // contextmenu happens afterwards, and there's no way to know if a contextmenu event
                // is coming other than waiting for an arbitrary amount of time.
                if(!is_pressed && (event.defaultPrevented || this.block_context_menu_until_release))
                {
                    this.block_context_menu_until_release = false;
                    this.block_context_menu_until_timer();
                }
            }
        }
    }

    onpointerevent = (e) =>
    {
        this.button_changed(e.buttons, e);
    }

    onpointermove = (e) =>
    {
        // Short-circuit processing pointermove if button is -1, which means it's just
        // a move (the only thing this event should even be used for).
        if(e.button == -1)
            return;

        this.button_changed(e.buttons, e);
    }

    oncontextmenu = (e) =>
    {
        // Prevent oncontextmenu if RMB was pressed and cancelled, or if we're blocking
        // it after release.
        if(this.block_context_menu_until_release || this.blocking_context_menu_until_timer)
        {
            // console.log("stop context menu (waiting for timer)");
            e.preventDefault();
            e.stopPropagation();
        }
    }        

    // Block contextmenu for a while.
    block_context_menu_until_timer()
    {
        // console.log("Waiting for timer before releasing context menu");

        this.blocking_context_menu_until_timer = true;
        if(this.block_contextmenu_timer != null)
        {
            realClearTimeout(this.block_contextmenu_timer);
            this.block_contextmenu_timer = null;
        }

        this.block_contextmenu_timer = realSetTimeout(() => {
            this.block_contextmenu_timer = null;

            // console.log("Releasing context menu after timer");
            this.blocking_context_menu_until_timer = false;
        }, 50);
    }

    // Check if any buttons are pressed that were missed while the element wasn't visible.
    //
    // This can be used if the element becomes visible, and we want to see any presses
    // already happening that are over the element.
    //
    // This requires install_global_handler.
    check_missed_clicks()
    {
        // If no buttons are pressed that this listener cares about, stop.
        if(!(this.button_mask & PointerListener.buttons))
            return;

        // See if the cursor is over our element.
        let node_under_cursor = document.elementFromPoint(PointerListener.latest_mouse_client_position[0], PointerListener.latest_mouse_client_position[1]);
        if(node_under_cursor == null || !helpers.is_above(this.element, node_under_cursor))
            return;

        // Simulate a pointerdown on this element for each button that's down, so we can
        // send the corresponding pointerId for each button.
        for(let button = 0; button < 8; ++button)
        {
            // Skip this button if it's not down.
            let mask = 1 << button;
            if(!(mask & PointerListener.buttons))
                continue;

            // Add this button's mask to the listener's last seen mask, so it only sees this
            // button being added.  This way, each button event is sent with the correct
            // pointerId.
            let new_button_mask = this.buttons_down;
            new_button_mask |= mask;
            let e = new MouseEvent("simulatedpointerdown", {
                buttons: new_button_mask,
                pageX: PointerListener.latest_mouse_page_position[0],
                pageY: PointerListener.latest_mouse_page_position[1],
                clientX: PointerListener.latest_mouse_page_position[0],
                clientY: PointerListener.latest_mouse_page_position[1],
                timestamp: performance.now(),
            });
            e.pointerId = PointerListener.button_pointer_ids.get(button);

            this.element.dispatchEvent(e);
        }
    }
}
