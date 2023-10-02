// The pointer API is sadistically awful.  Only the first pointer press is sent by pointerdown.
// To get others, you have to register pointermove and get spammed with all mouse movement.
// You have to register pointermove when a button is pressed in order to see other buttons
// without keeping a pointermove event running all the time.  You also have to use e.buttons
// instead of e.button, because pointermove doesn't tell you what buttons changed, making e.button
// meaningless.
//
// Who designed this?  This isn't some ancient IE6 legacy API.  How do you screw up a mouse
// event API this badly?

import { helpers } from '/vview/misc/helpers.js';

export default class PointerListener
{
    // The global handler is used to track button presses and mouse movement globally,
    // primarily to implement PointerListener.check().

    // The latest mouse position seen by installGlobalHandler.
    static latestMousePagePosition = [window.innerWidth/2, window.innerHeight/2];
    static latestMouseClientPosition = [window.innerWidth/2, window.innerHeight/2];
    static pointerType = "mouse";
    static _buttons = 0;
    static _buttonPointerIds = new Map();
    static installGlobalHandler()
    {
        window.addEventListener("pointermove", (e) => {
            PointerListener.latestMousePagePosition = [e.pageX, e.pageY];
            PointerListener.latestMouseClientPosition = [e.clientX, e.clientY];
            this.pointerType = e.pointerType;
        }, { passive: true, capture: true });

        new PointerListener({
            element: window,
            buttonMask: 0xFFFF, // everything
            capture: true,
            callback: (e) => {
                if(e.pressed)
                {
                    PointerListener._buttons |= 1 << e.mouseButton;
                    PointerListener._buttonPointerIds.set(e.mouseButton, e.pointerId);
                }
                else
                {
                    PointerListener._buttons &= ~(1 << e.mouseButton);
                    PointerListener._buttonPointerIds.delete(e.mouseButton);
                }
            }
        });
    }

    // callback(event) will be called each time buttons change.  The event will be the event
    // that actually triggered the state change, and can be preventDefaulted, etc.
    //
    // To disable, include {signal: AbortSignal} in options.
    constructor({element, callback, buttonMask=1, ...options}={})
    {
        this.element = element;
        this.buttonMask = buttonMask;
        this._pointermoveRegistered = false;
        this.buttonsDown = 0;
        this.callback = callback;
        this._eventOptions = options;

        let handlingRightClick = (buttonMask & 2) != 0;
        this._blockingContextMenuUntilTimer = false;
        if(handlingRightClick)
            window.addEventListener("contextmenu", this.oncontextmenu, this._eventOptions);

        if(options.signal)
        {
            options.signal.addEventListener("abort", (e) => {
                // If we have a blockContextmenuTimer timer running when we're cancelled, remove it.
                if(this.blockContextmenuTimer != null)
                    realClearTimeout(this.blockContextmenuTimer);
            });
        }
        
        this.element.addEventListener("pointerdown", this.onpointerevent, this._eventOptions);
        this.element.addEventListener("simulatedpointerdown", this.onpointerevent, this._eventOptions);
    }

    // Register events that we only register while one or more buttons are pressed.
    //
    // We only register pointermove as needed, so we don't get called for every mouse
    // movement, and we only register pointerup as needed so we don't register a ton
    // of events on window.
    _registerEventsWhilePressed(enable)
    {
        if(this._pointermoveRegistered)
            return;
        this._pointermoveRegistered = true;
        this.element.addEventListener("pointermove", this.onpointermove, this._eventOptions);

        // These need to go on window, so if a mouse button is pressed and that causes
        // the element to be hidden, we still get the pointerup.
        window.addEventListener("pointerup", this.onpointerevent, this._eventOptions);
        window.addEventListener("pointercancel", this.onpointerevent, this._eventOptions);
    }

    _unregisterEventsWhilePressed(enable)
    {
        if(!this._pointermoveRegistered)
            return;
        this._pointermoveRegistered = false;
        this.element.removeEventListener("pointermove", this.onpointermove, this._eventOptions);
        window.removeEventListener("pointerup", this.onpointerevent, this._eventOptions);
        window.removeEventListener("pointercancel", this.onpointerevent, this._eventOptions);
    }

    _buttonChanged(buttons, event)
    {
        // If shift is held, ignore this event. This is used to drag images outside the browser
        if(event.shiftKey) return;
        // We need to register pointermove to see presses past the first.
        if(buttons)
            this._registerEventsWhilePressed();
        else
            this._unregisterEventsWhilePressed();

        let oldButtonsDown = this.buttonsDown;
        this.buttonsDown = buttons;
        for(let button = 0; button < 5; ++button)
        {
            let mask = 1 << button;

            // Ignore this if it's not a button change for a button in our mask.
            if(!(mask & this.buttonMask))
                continue;
            let wasPressed = oldButtonsDown & mask;
            let isPressed = this.buttonsDown & mask;

            if(wasPressed == isPressed)
                continue;

            // Pass the button in event.mouseButton, and whether it was pressed or released in event.pressed.
            // Don't use e.button, since it's in a different order than e.buttons.
            event.mouseButton = button;
            event.pressed = isPressed;
            this.callback(event);

            // Remove event.mouseButton so it doesn't appear for unrelated event listeners.
            delete event.mouseButton;
            delete event.pressed;

            // Right-click handling
            if(button == 1)
            {
                // If this is a right-click press and the user prevented the event, block the context
                // menu when this button is released.
                if(isPressed && event.defaultPrevented)
                    this._blockContextMenuUntilRelease = true;

                // If this is a right-click release and the user prevented the event (or the corresponding
                // press earlier), block the context menu briefly.  There seems to be no other way to do
                // this: cancelling pointerdown or pointerup don't prevent actions like they should,
                // contextmenu happens afterwards, and there's no way to know if a contextmenu event
                // is coming other than waiting for an arbitrary amount of time.
                if(!isPressed && (event.defaultPrevented || this._blockContextMenuUntilRelease))
                {
                    this._blockContextMenuUntilRelease = false;
                    this._blockContextMenuUntilTimer();
                }
            }
        }
    }

    onpointerevent = (e) =>
    {
        this._buttonChanged(e.buttons, e);
    }

    onpointermove = (e) =>
    {
        // Short-circuit processing pointermove if button is -1, which means it's just
        // a move (the only thing this event should even be used for).
        if(e.button == -1)
            return;

        this._buttonChanged(e.buttons, e);
    }

    oncontextmenu = (e) =>
    {
        // Prevent oncontextmenu if RMB was pressed and cancelled, or if we're blocking
        // it after release.
        if(this._blockContextMenuUntilRelease || this._blockingContextMenuUntilTimer)
        {
            // console.log("stop context menu (waiting for timer)");
            e.preventDefault();
            e.stopPropagation();
        }
    }        

    // Block contextmenu for a while.
    _blockContextMenuUntilTimer()
    {
        // console.log("Waiting for timer before releasing context menu");

        this._blockingContextMenuUntilTimer = true;
        if(this.blockContextmenuTimer != null)
        {
            realClearTimeout(this.blockContextmenuTimer);
            this.blockContextmenuTimer = null;
        }

        this.blockContextmenuTimer = realSetTimeout(() => {
            this.blockContextmenuTimer = null;

            // console.log("Releasing context menu after timer");
            this._blockingContextMenuUntilTimer = false;
        }, 50);
    }

    // Check if any buttons are pressed that were missed while the element wasn't visible.
    //
    // This can be used if the element becomes visible, and we want to see any presses
    // already happening that are over the element.
    //
    // This requires installGlobalHandler.
    checkMissedClicks()
    {
        // If no buttons are pressed that this listener cares about, stop.
        if(!(this.buttonMask & PointerListener.buttons))
            return;

        // See if the cursor is over our element.
        let nodeUnderCursor = document.elementFromPoint(PointerListener.latestMouseClientPosition[0], PointerListener.latestMouseClientPosition[1]);
        if(nodeUnderCursor == null || !helpers.html.isAbove(this.element, nodeUnderCursor))
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
            let newButtonMask = this.buttonsDown;
            newButtonMask |= mask;
            let e = new MouseEvent("simulatedpointerdown", {
                buttons: newButtonMask,
                pageX: PointerListener.latestMousePagePosition[0],
                pageY: PointerListener.latestMousePagePosition[1],
                clientX: PointerListener.latestMousePagePosition[0],
                clientY: PointerListener.latestMousePagePosition[1],
                timestamp: performance.now(),
            });
            e.pointerId = PointerListener._buttonPointerIds.get(button);

            this.element.dispatchEvent(e);
        }
    }
}
