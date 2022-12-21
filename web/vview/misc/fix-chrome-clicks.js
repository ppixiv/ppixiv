// Fix Chrome's click behavior.
//
// Work around odd, obscure click behavior in Chrome: releasing the right mouse
// button while the left mouse button is held prevents clicks from being generated
// when the left mouse button is released (even if the context menu is cancelled).
// This causes lost inputs when quickly right-left clicking our context menu.
//
// Unfortunately, we have to reimplement the click event in order to do this.
// We only attach this handler where it's really needed (the popup menu).
//
// We mimic Chrome's click detection behavior: an element is counted as a click if
// the mouseup event is an ancestor of the element that was clicked, or vice versa.
// This is different from Firefox which uses the distance the mouse has moved.
import { helpers } from 'vview/misc/helpers.js';

export default class FixChromeClicks
{
    constructor(container)
    {
        // Don't do anything if we're not in Chrome.
        this.enabled = navigator.userAgent.indexOf("Chrome") != -1 && !ppixiv.mobile;
        if(!this.enabled)
            return;

        this.container = container;
        this.pressedNode = null;

        // Since the pointer events API is ridiculous and doesn't send separate pointerdown
        // events for each mouse button, we have to listen to all clicks in window in order
        // to find out if button 0 is pressed.  If the user presses button 2 outside of our
        // container we still want to know about button 0, but that button 0 event might happen
        // in another element that we don't care about.
        this.container.addEventListener("pointerdown", this.onpointer, true);
        this.container.addEventListener("pointerup", this.onpointer, true);
        this.container.addEventListener("pointermove", this.onpointer, true);
        this.container.addEventListener("contextmenu", this.oncontextmenu);
        this.container.addEventListener("click", this.onclick, true);
    }

    // We have to listen on window as well as our container for events, since a
    // mouse up might happen on another node after the mouse down happened in our
    // node.  We only register these while a button is pressed in our node, so we
    // don't have global pointer event handlers installed all the time.
    startWaitingForRelease()
    {
        if(this.pressedNode != null)
        {
            console.warn("Unexpected call to startWaitingForRelease");
            return;
        }
        window.addEventListener("pointerup", this.onpointer, true);
        window.addEventListener("pointermove", this.onpointer, true);
    }

    stopWaitingForRelease()
    {
        if(this.pressedNode == null)
            return;

        window.removeEventListener("pointerup", this.onpointer, true);
        window.removeEventListener("pointermove", this.onpointer, true);
        this.pressedNode = null;
    }

    // The pointer events API is nonsensical: button presses generate pointermove
    // instead of pointerdown or pointerup if another button is already pressed.  That's
    // completely useless, so we have to just listen to all of them the same way and
    // deduce what's happening from the button mask.
    onpointer = (e) =>
    {
        if(e.type == "pointerdown")
        {
            // Start listening to move events.  We only need this while a button
            // is pressed.
            this.startWaitingForRelease();
        }

        if(e.buttons & 1)
        {
            // The primary button is pressed, so remember what element we were on.
            if(this.pressedNode == null)
            {
                // console.log("mousedown", e.target.id);
                this.pressedNode = e.target;
            }
            return;
        }

        if(this.pressedNode == null)
            return;

        var pressedNode = this.pressedNode;

        // The button was released.  Unregister our temporary event listeners.
        this.stopWaitingForRelease();

        // console.log("released:", e.target.id, "after click on", pressedNode.id);

        var releasedNode = e.target;
        var clickTarget = null;
        if(helpers.is_above(releasedNode, pressedNode))
            clickTarget = releasedNode;
        else if(helpers.is_above(pressedNode, releasedNode))
            clickTarget = pressedNode;

        if(clickTarget == null)
        {
            // console.log("No target for", pressedNode, "and", releasedNode);
            return;
        }

        // If the click target is above our container, stop.
        if(helpers.is_above(clickTarget, this.container))
            return;

        // Why is cancelling the event not preventing mouse events and click events?
        e.preventDefault();
        // console.log("do click on", clickTarget.id, e.defaultPrevented, e.type);
        this.sendClickEvent(clickTarget, e);
    }

    oncontextmenu = (e) =>
    {
        if(this.pressedNode != null && !e.defaultPrevented)
        {
            console.log("Not sending click because the context menu was opened");
            this.pressedNode = null;
        }
    }

    // Cancel regular mouse clicks.
    //
    // Pointer events is a broken API.  It sends mouse button presses as pointermove
    // if another button is already pressed, which already doesn't make sense and
    // makes it a headache to use.  But, to make things worse, pointermove is defined
    // as having the same default event behavior as mousemove, despite the fact that it
    // can correspond to a mouse press or release.  Also, preventDefault just seems to
    // be broken in Chrome and has no effect.
    //
    // So, we just cancel all button 0 click events that weren't sent by us.
    onclick = (e) =>
    {
        if(e.button != 0)
            return;

        // Ignore synthetic events.
        if(!e.isTrusted)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();
    }

    sendClickEvent(target, sourceEvent)
    {
        var e = new MouseEvent("click", sourceEvent);
        e.synthetic = true;
        target.dispatchEvent(e);
    }

    shutdown()
    {
        if(!this.enabled)
            return;

        this.stopWaitingForRelease();
        this.pressedNode = null;

        this.container.removeEventListener("pointerup", this.onpointer, true);
        this.container.removeEventListener("pointerdown", this.onpointer, true);
        this.container.removeEventListener("pointermove", this.onpointer, true);
        this.container.removeEventListener("contextmenu", this.oncontextmenu);
        this.container.removeEventListener("click", this.onclick, true);
    }
}

