import Widget from 'vview/widgets/widget.js';
import WidgetDragger from 'vview/actors/widget-dragger.js';
import { helpers, OpenWidgets } from 'vview/misc/helpers.js';

export default class DialogWidget extends Widget
{
    // The stack of dialogs currently open:
    static active_dialogs = [];

    static get top_dialog()
    {
        return this.active_dialogs[this.active_dialogs.length-1];
    }

    static _update_block_touch_scrolling()
    {
        if(!ppixiv.ios)
            return;

        // This is really annoying.  No matter how much you shout at iOS to not scroll the document,
        // whether with overflow: hidden, inert or pointer-events: none, it ignores you and scrolls
        // the document underneath the dialog.  The only way I've found to prevent this is by cancelling
        // touchmove (touchstart doesn't work).
        //
        // Note that even touch-action: none doesn't work.  It seems to interpret it as "don't let touches
        // on this element scroll" instead of "this element shouldn't scroll with touch": touches on child
        // elements will still propagate up and scroll the body, which is useless.
        //
        // This hack partially works, but the body still scrolls when it shouldn't if an area is dragged
        // which is set to overflow: auto or overflow: scroll but doesn't actually scroll.  We can't tell
        // that it isn't scrolling, and iOS seems to blindly propagate any touch on a potentially-scrollable
        // element up to the nearest scrollable one.
        if(DialogWidget.active_dialogs.length == 0)
        {
            if(this._remove_touch_scroller_events != null)
            {
                this._remove_touch_scroller_events.abort();
                this._remove_touch_scroller_events = null;
            }
            return;
        }

        // At least one dialog is open.  Start listening to touchmove if we're not already.
        if(this._remove_touch_scroller_events)
            return;

        this._remove_touch_scroller_events = new AbortController();
        window.addEventListener("touchmove", (e) => {
            // Block this movement if it's not inside the topmost open dialog.
            let top_dialog = DialogWidget.top_dialog;
            let dialog = top_dialog.container.querySelector(".dialog");
            if(!helpers.is_above(dialog, e.target))
                e.preventDefault();
        }, { capture: true, passive: false, signal: this._remove_touch_scroller_events.signal });
    }

    constructor({
        classes=null,
        container=null,
        // "normal" is used for larger dialogs, like settings.
        // "small" is used for smaller popups like text entry.
        dialog_type="normal",

        dialog_class=null,

        // The header text:
        header=null,

        // Most dialogs have a close button and allow the user to navigate away.  To
        // disable this and control visibility directly, set this to false.
        allow_close=true,

        // Most dialogs that can be closed have a close button in the corner.  If this is
        // false we'll hide that button, but you can still exit by clicking the background.
        // This is used for very simple dialogs.
        show_close_button=true,

        // If false, this dialog may be large, like settings, and we'll display it in fullscreen
        // on small screens.  If true, weit's a small dialog like a confirmation prompt, and we'll
        // always show it as a floating dialog.  The default is true if dialog_type == "small",
        // otherwise false.
        small=null,

        // If true, the close button shows a back icon instead of an X.
        back_icon=false,

        // The drag direction to close the dialog if the dialog can be dragged to close.
        drag_direction=null,

        template,
        ...options
    })
    {
        if(small == null)
            small = dialog_type == "small";

        // By default, regular dialogs scroll and drag right, so they don't conflict with vertical
        // scrollers.  Small dialogs currently drag down, since animating a small dialog like a
        // text entry horizontally looks weird.
        if(drag_direction == null)
            drag_direction = small? "down":"right";

        // Most dialogs are added to the body element.
        if(container == null)
            container = document.body;
        
        console.assert(dialog_type == "normal" || dialog_type == "small");

        if(dialog_class == null)
            dialog_class = dialog_type == "normal"? "dialog-normal":"dialog-small";

        let close_icon = back_icon? "arrow_back_ios_new":"close";
        
        super({
            container,
            template: `
                <div class="${dialog_class}">
                    <div class="dialog ${classes ?? ""}">
                        <div class=header>
                            <div class="close-button-container">
                                <div class="close-button icon-button">
                                    ${ helpers.create_icon(close_icon) }
                                </div>
                            </div>

                            <span class=header-text></span>

                            <div class=center-header-helper></div>
                        </div>
                        <div class="scroll vertical-scroller">
                            ${ template }
                        </div>
                    </div>
                </div>
            `,
            ...options,
        });

        // Dialogs are always used once and not reused, so they should never be created invisible.
        if(!this.visible)
            throw new Error("Dialog shouldn't be hidden");

        this.small = small;
        helpers.set_class(this.container, "small", this.small);
        helpers.set_class(this.container, "large", !this.small);

        this.refresh_fullscreen();
        window.addEventListener("resize", this.refresh_fullscreen, { signal: this.shutdown_signal.signal });

        // Create the dragger that will control animations.  Animations are only used on mobile.
        if(ppixiv.mobile)
        {
            // drag_direction is the direction to close.  We're giving it to WidgetDragger,
            // which takes the direction ti open, so reverse it.
            drag_direction = {
                down: "up", up: "down", left: "right", right: "left",
            }[drag_direction];

            this.dialog_dragger = new WidgetDragger({
                name: "close-dialog",
                node: this.container,
                drag_node: this.container,
                visible: false,
                size: 150,
                animated_property: "--dialog-visible",

                // Call create_animation again each time this is queried, so the animation can change to
                // adjust to the screen size if needed.
                animations: () => this.create_animation().animation,
                direction: drag_direction,
                onafterhidden: () => this.visibility_changed(),

                // Ignore vertical drags.
                confirm_drag: ({event}) => {
                    if(!this.drag_to_exit)
                        return false;

                    let horizontal = Math.abs(event.movementX) > Math.abs(event.movementY);
                    let want_horizontal = drag_direction == "left" || drag_direction == "right";
                    return horizontal == want_horizontal;
                },

                // Set dragging while dragging the dialog to disable the scroller.
                onactive: () => this.container.classList.add("dragging-dialog"),
                oninactive: () => this.container.classList.remove("dragging-dialog"),
            });
        
            this.dialog_dragger.show();
        }

        // By default, dialogs with vertical or horizontal animations are also draggable.  Only
        // animated dialogs can drag to exit.
        // this.drag_to_exit = this.dialog_dragger != null && this.animation != "fade";
        this.drag_to_exit = true;

        // If we're not the first dialog on the stack, make the previous dialog inert, so it'll ignore inputs.
        let old_top_dialog = DialogWidget.top_dialog;
        if(old_top_dialog)
            old_top_dialog.container.inert = true;

        // Add ourself to the stack.
        DialogWidget.active_dialogs.push(this);

        // Register ourself as an important visible widget, so the slideshow won't move on
        // while we're open.
        OpenWidgets.singleton.set(this, true);

        if(!header && !show_close_button)
            this.container.querySelector(".header").hidden = true;

        this.allow_close = allow_close;
        this.container.querySelector(".close-button").hidden = !allow_close || !show_close_button;
        this.header = header;

        window.addEventListener("keydown", this._onkeypress.bind(this), { signal: this.shutdown_signal.signal });

        if(this.allow_close)
        {
            // Close if the container is clicked, but not if something inside the container is clicked.
            this.container.addEventListener("click", (e) => {
                if(e.target != this.container)
                    return;

                this.visible = false;
            });

            let close_button = this.container.querySelector(".close-button");
            if(close_button)
                close_button.addEventListener("click", (e) => { this.visible = false; });

            // Hide if the top-level screen changes, so we close if the user exits the screen with browser
            // navigation but not if the viewed image is changing from something like the slideshow.  Call
            // shutdown() directly instead of setting visible, since we don't want to trigger animations here.
            window.addEventListener("screenchanged", (e) => {
                this.shutdown();
            }, { signal: this.shutdown_signal.signal });

            if(this._close_on_popstate)
            {
                // Hide on any state change.
                window.addEventListener("pp:popstate", (e) => {
                    this.shutdown();
                }, { signal: this.shutdown_signal.signal });
            }
        }

        DialogWidget._update_block_touch_scrolling();
    }

    // The subclass can override this to disable automatically closing on popstate.
    get _close_on_popstate() { return true; }

    set header(value)
    {
        this.container.querySelector(".header-text").textContent = value ?? "";
    }

    refresh_fullscreen = () =>
    {
        helpers.set_class(this.container, "fullscreen", helpers.is_phone() && !this.small);
    }

    visibility_changed()
    {
        super.visibility_changed();

        // Remove the widget when it's hidden.  If we're animating, we'll do this after transitionend.
        if(!this.actually_visible)
            this.shutdown();
    }

    _onkeypress(e)
    {
        let idx = DialogWidget.active_dialogs.indexOf(this);
        if(idx == -1)
        {
            console.error("Widget isn't in active_dialogs during keypress:", this);
            return;
        }

        // Ignore keypresses if we're not the topmost dialog.
        if(idx != DialogWidget.active_dialogs.length-1)
            return;

        if(this.handle_keydown(e))
        {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    // This can be overridden by the implementation.
    handle_keydown(e)
    {
        if(this.allow_close && e.key == "Escape")
        {
            this.visible = false;
            return true;
        }

        return false;
    }

    get actually_visible()
    {
        // If we have an animator, it determines whether we're visible.
        if(this.dialog_dragger)
            return this.dialog_dragger.visible;
        else
            return super.visible;
    }

    async apply_visibility()
    {
        if(this.dialog_dragger == null || this._visible)
        {
            super.apply_visibility();
            return;
        }

        // We're being hidden and we have an animation.  Tell the dragger to run our hide
        // animation.  We'll shut down when it finishes.
        this.dialog_dragger.hide();
    }

    // Calling shutdown() directly will remove the dialog immediately.  To remove it and allow
    // animations to run, set visible to false, and the dialog will shut down when the animation
    // finishes.
    shutdown()
    {
        // Remove ourself from active_dialogs.
        let idx = DialogWidget.active_dialogs.indexOf(this);
        if(idx == -1)
            console.error("Widget isn't in active_dialogs when shutting down:", this);
        else
            DialogWidget.active_dialogs.splice(idx, 1);

        // Tell OpenWidgets that we're no longer open.
        OpenWidgets.singleton.set(this, false);

        DialogWidget._update_block_touch_scrolling();

        // If we were covering another dialog, unset inert on the previous dialog.
        let new_top_dialog = DialogWidget.top_dialog;
        if(new_top_dialog)
            new_top_dialog.container.inert = false;

        super.shutdown();
    }
}
