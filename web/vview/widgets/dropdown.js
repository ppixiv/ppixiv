import Actor from 'vview/actors/actor.js';
import Widget from 'vview/widgets/widget.js';
import ClickOutsideListener from 'vview/widgets/click-outside-listener.js';
import { helpers } from 'vview/misc/helpers.js';

// A helper to display a dropdown aligned to another node.
export class DropdownBoxOpener extends Actor
{
    constructor({
        button,

        // The dropdown will be closed on clicks outside of the dropdown unless this returns
        // false.
        close_for_click=(e) => true,

        // This is called when button is clicked and should return a widget to display.  The
        // widget will be shut down when it's dismissed.
        create_box=null,

        onvisibilitychanged=() => { },

        ...options
    })
    {
        // Find a parent widget above the button.
        let parent = Widget.from_node(button);

        super({
            parent,
            ...options,
        });

        this.button = button;
        this.close_for_click = close_for_click;
        this.onvisibilitychanged = onvisibilitychanged;
        this.create_box = create_box;

        this.box = null;

        this._visible = true;
        this.visible = false;

        // Refresh the position if the box width changes.  Don't refresh on any ResizeObserver
        // call, since that'll recurse and end up refreshing constantly.
        this._box_width = 0;
    }

    onwindowresize = (e) =>
    {
        this._align_to_button();
    };

    // Hide if our tree becomes hidden.
    on_visible_recursively_changed()
    {
        super.on_visible_recursively_changed();

        if(!this.visible_recursively)
            this.visible = false;
    }

    get visible()
    {
        return this._visible;
    }

    set visible(value)
    {
        if(this._visible == value)
            return;

        this._visible = value;

        if(value)
        {
            this.box_widget = this.create_box({
                container: document.body,
            });

            // Stop if no widget was created.
            if(this.box_widget == null)
            {
                this._visible = false;
                return;
            }

            this.box_widget.container.classList.add("dropdown-box");
            this.box = this.box_widget.container;

            this.listener = new ClickOutsideListener([this.button, this.box], (target, {event}) => {
                if(!this.close_for_click(event))
                    return;

                this.visible = false;
            });

            if(this.close_on_click_inside)
                this.box.addEventListener("click", this.box_onclick);

            this._resize_observer = new ResizeObserver(() => {
                if(this._box_width == this.box.offsetWidth)
                    return;
    
                this._box_width = this.box.offsetWidth;
                this._align_to_button();
            });
            this._resize_observer.observe(this.box);
        
            // We manually position the dropdown, so we need to reposition them if
            // the window size changes.
            window.addEventListener("resize", this.onwindowresize, this._signal);

            this._align_to_button();
        }
        else
        {
            if(!this.box)
                return;

            this.box.removeEventListener("click", this.box_onclick);

            this._cleanup();

            if(this.box_widget)
            {
                this.box_widget.shutdown();
                this.box_widget = null;
            }
        }

        this.onvisibilitychanged(this);
    }

    _cleanup()
    {
        if(this._resize_observer)
        {
            this._resize_observer.disconnect();
            this._resize_observer = null;
        }

        if(this.listener)
        {
            this.listener.shutdown();
            this.listener = null;
        }

        window.removeEventListener("resize", this.onwindowresize);
    }

    _align_to_button()
    {
        if(!this.visible)
            return;

        // The amount of padding to leave relative to the button we're aligning to.
        let horizontal_padding = 4, vertical_padding = 8;

        // Use getBoundingClientRect to figure out the position, since it works
        // correctly with CSS transforms.  Figure out how far off we are and move
        // by that amount.  This works regardless of what our relative position is.
        //let {left: box_x, top: box_y} = this.box.getBoundingClientRect(document.body);
        let {left: button_x, top: button_y, height: box_height} = this.button.getBoundingClientRect();

        // Align to the left of the button.  Nudge left slightly for padding.
        let x = button_x - horizontal_padding;

        // If the right edge of the box is offscreen, push the box left.  Leave a bit of
        // padding on desktop, so the dropdown isn't flush with the edge of the window.
        // On mobile, allow the box to be flush with the edge.
        let padding = ppixiv.mobile? 0:4;
        let right_edge = x + this._box_width;
        x -= Math.max(right_edge - (window.innerWidth - padding), 0);

        // Don't push the left edge past the left edge of the screen.
        x = Math.max(x, 0);

        let y = button_y;

        this.box.style.left = `${x}px`;

        // Put the dropdown below the button if we're on the top half of the screen, otherwise
        // put it above.
        if(y < window.innerHeight / 2)
        {
            // Align to the bottom of the button, adding a bit of padding.
            y += box_height + vertical_padding;
            this.box.style.top = `${y}px`;
            this.box.style.bottom = "";

            // Set the box's maxHeight so it doesn't cross the bottom of the screen.
            // On desktop, add a bit of padding so it's not flush against the edge.
            let height = window.innerHeight - y - padding;
            this.box.style.maxHeight = `${height}px`;
        }
        else
        {
            y -= vertical_padding;

            // Align to the top of the button.
            this.box.style.top = "";
            this.box.style.bottom = `calc(100% - ${y}px)`;

            // Set the box's maxHeight so it doesn't cross the top of the screen.
            let height = y - padding;
            this.box.style.maxHeight = `${height}px`;
        }
    }

    shutdown()
    {
        super.shutdown();

        this._cleanup();
    }

    // Return true if this popup should close when clicking inside it.  If false,
    // the menu will stay open until something else closes it.
    get close_on_click_inside() { return false; }
}

// A specialization of DropdownBoxOpener for buttons that open dropdowns containing
// lists of buttons, which we use a lot for data source UIs.
export class DropdownMenuOpener extends DropdownBoxOpener
{
    // When button is clicked, show box.
    constructor({
        create_box=null,

        ...options
    })
    {
        super({
            // Wrap create_box() to add the popup-menu-box class.
            create_box: (...args) => {
                let widget = create_box(...args);
                widget.container.classList.add("popup-menu-box");
                return widget;
            },

            ...options
        });

        this.button.addEventListener("click", (e) => this.button_onclick(e), this._signal);

        this.set_button_popup_highlight();
    }

    get close_on_click_inside() { return true; }

    set visible(value)
    {
        super.visible = value;

        if(this.box)
        {
            // If we're inside a .top-ui-box container (the UI that sits at the top of the screen), set
            // .force-open on that element while we're open.
            let top_ui_box = this.box.closest(".top-ui-box");
            if(top_ui_box)
                helpers.set_class(top_ui_box, "force-open", value);
        }
    }

    get visible() { return super.visible; }

    // Close the popup when something inside is clicked.  This can be prevented with
    // stopPropagation, or with the keep-menu-open class.
    box_onclick = (e) =>
    {
        if(e.target.closest(".keep-menu-open"))
            return;

        this.visible = false;
    }

    // Toggle the popup when the button is clicked.
    button_onclick(e)
    {
        e.preventDefault();
        e.stopPropagation();
        this.visible = !this.visible;
    }

    // Set the text and highlight on button based on the contents of the box.
    //
    // The data_source dropdowns originally created all of their contents, then we set the
    // button text by looking at the contents.  We now create the popups on demand, but we
    // still want to set the button based on the selection.  Do this by creating a temporary
    // dropdown so we can see what gets set.  This is tightly tied to data_source.set_item.
    set_button_popup_highlight()
    {
        let temp_box = this.create_box({container: document.body});
        DropdownMenuOpener.set_active_popup_highlight_from(this.button, temp_box.container);
        temp_box.shutdown();
    }

    static set_active_popup_highlight_from(button, box)
    {
        // Find the selected item in the dropdown, if any.
        let selected_item = box.querySelector(".selected");
        let selected_default = selected_item == null || selected_item.dataset["default"];

        // If an explicit default button exists, there's usually always something selected in the
        // list: either a filter is selected or the default is.  If a list has a default button
        // but nothing is selected at all, that means we're not on any of the available selections
        // (we don't even match the default).  For example, this can happen if "This Week" is selected,
        // but some time has passed, so the time range the "This Week" menu item points to doesn't match
        // the search.  (That means we're viewing "some week in the past", but we don't have a menu item
        // for it.)
        //
        // If this happens, show the dropdown as selected, even though none of its items are active, to
        // indicate that a filter really is active and the user can reset it.
        let item_has_default = box.querySelector("[data-default]") != null;
        if(item_has_default && selected_item == null)
            selected_default = false;

        helpers.set_class(button, "selected", !selected_default);
        helpers.set_class(box, "selected", !selected_default);

        // If an option is selected, replace the menu button text with the selection's label.
        if(!selected_default)
        {
            // The short label is used to try to keep these labels from causing the menu buttons to
            // overflow the container, and for labels like "2 years ago" where the menu text doesn't
            // make sense.
            //
            // If we don't have a selected item, we're in the item_has_default case (see above).
            let text = selected_item?.dataset?.shortLabel;
            let selected_label = selected_item?.querySelector(".label")?.innerText;
            let label = button.querySelector(".label");
            label.innerText = text ?? selected_label ?? "Other";
        }
    }    
}
