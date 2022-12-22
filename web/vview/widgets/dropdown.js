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
        shouldCloseForClick=(e) => true,

        // This is called when button is clicked and should return a widget to display.  The
        // widget will be shut down when it's dismissed.
        createBox=null,

        onvisibilitychanged=() => { },

        ...options
    })
    {
        // Find a parent widget above the button.
        let parent = Widget.fromNode(button);

        super({
            parent,
            ...options,
        });

        this.button = button;
        this.shouldCloseForClick = shouldCloseForClick;
        this.onvisibilitychanged = onvisibilitychanged;
        this.createBox = createBox;

        this.box = null;

        this._visible = true;
        this.visible = false;

        // Refresh the position if the box width changes.  Don't refresh on any ResizeObserver
        // call, since that'll recurse and end up refreshing constantly.
        this._boxWidth = 0;
    }

    onwindowresize = (e) =>
    {
        this._alignToButton();
    };

    // Hide if our tree becomes hidden.
    visibleRecursivelyChanged()
    {
        super.visibleRecursivelyChanged();

        if(!this.visibleRecursively)
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
            this.boxWidget = this.createBox({
                container: document.body,
                parent: this,
            });

            // Stop if no widget was created.
            if(this.boxWidget == null)
            {
                this._visible = false;
                return;
            }

            this.boxWidget.container.classList.add("dropdown-box");
            this.box = this.boxWidget.container;

            this.listener = new ClickOutsideListener([this.button, this.box], (target, {event}) => {
                if(!this.shouldCloseForClick(event))
                    return;

                this.visible = false;
            });

            if(this.closeOnClickInside)
                this.box.addEventListener("click", this.boxClicked);

            this._resizeObserver = new ResizeObserver(() => {
                if(this._boxWidth == this.box.offsetWidth)
                    return;
    
                this._boxWidth = this.box.offsetWidth;
                this._alignToButton();
            });
            this._resizeObserver.observe(this.box);
        
            // We manually position the dropdown, so we need to reposition them if
            // the window size changes.
            window.addEventListener("resize", this.onwindowresize, this._signal);

            this._alignToButton();
        }
        else
        {
            if(!this.box)
                return;

            this.box.removeEventListener("click", this.boxClicked);

            this._cleanup();

            if(this.boxWidget)
            {
                this.boxWidget.shutdown();
                this.boxWidget = null;
            }
        }

        this.onvisibilitychanged(this);
    }

    _cleanup()
    {
        if(this._resizeObserver)
        {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        if(this.listener)
        {
            this.listener.shutdown();
            this.listener = null;
        }

        window.removeEventListener("resize", this.onwindowresize);
    }

    _alignToButton()
    {
        if(!this.visible)
            return;

        // The amount of padding to leave relative to the button we're aligning to.
        let horizontalPadding = 4, verticalPadding = 8;

        // Use getBoundingClientRect to figure out the position, since it works
        // correctly with CSS transforms.  Figure out how far off we are and move
        // by that amount.  This works regardless of what our relative position is.
        //let {left: box_x, top: box_y} = this.box.getBoundingClientRect(document.body);
        let {left: buttonX, top: buttonY, height: boxHeight} = this.button.getBoundingClientRect();

        // Align to the left of the button.  Nudge left slightly for padding.
        let x = buttonX - horizontalPadding;

        // If the right edge of the box is offscreen, push the box left.  Leave a bit of
        // padding on desktop, so the dropdown isn't flush with the edge of the window.
        // On mobile, allow the box to be flush with the edge.
        let padding = ppixiv.mobile? 0:4;
        let rightEdge = x + this._boxWidth;
        x -= Math.max(rightEdge - (window.innerWidth - padding), 0);

        // Don't push the left edge past the left edge of the screen.
        x = Math.max(x, 0);

        let y = buttonY;

        this.box.style.left = `${x}px`;

        // Put the dropdown below the button if we're on the top half of the screen, otherwise
        // put it above.
        if(y < window.innerHeight / 2)
        {
            // Align to the bottom of the button, adding a bit of padding.
            y += boxHeight + verticalPadding;
            this.box.style.top = `${y}px`;
            this.box.style.bottom = "";

            // Set the box's maxHeight so it doesn't cross the bottom of the screen.
            // On desktop, add a bit of padding so it's not flush against the edge.
            let height = window.innerHeight - y - padding;
            this.box.style.maxHeight = `${height}px`;
        }
        else
        {
            y -= verticalPadding;

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
    get closeOnClickInside() { return false; }
}

// A specialization of DropdownBoxOpener for buttons that open dropdowns containing
// lists of buttons, which we use a lot for data source UIs.
export class DropdownMenuOpener extends DropdownBoxOpener
{
    // When button is clicked, show box.
    constructor({
        createBox=null,

        ...options
    })
    {
        super({
            // Wrap createBox() to add the popup-menu-box class.
            createBox: (...args) => {
                let widget = createBox(...args);
                widget.container.classList.add("popup-menu-box");
                return widget;
            },

            ...options
        });

        this.button.addEventListener("click", (e) => this._buttonClicked(e), this._signal);

        this.setButtonPopupHighlight();
    }

    get closeOnClickInside() { return true; }

    set visible(value)
    {
        super.visible = value;

        if(this.box)
        {
            // If we're inside a .top-ui-box container (the UI that sits at the top of the screen), set
            // .force-open on that element while we're open.
            let top_ui_box = this.box.closest(".top-ui-box");
            if(top_ui_box)
                helpers.setClass(top_ui_box, "force-open", value);
        }
    }

    get visible() { return super.visible; }

    // Close the popup when something inside is clicked.  This can be prevented with
    // stopPropagation, or with the keep-menu-open class.
    boxClicked = (e) =>
    {
        if(e.target.closest(".keep-menu-open"))
            return;

        this.visible = false;
    }

    // Toggle the popup when the button is clicked.
    _buttonClicked(e)
    {
        e.preventDefault();
        e.stopPropagation();
        this.visible = !this.visible;
    }

    // Set the text and highlight on button based on the contents of the box.
    //
    // The data source dropdowns originally created all of their contents, then we set the
    // button text by looking at the contents.  We now create the popups on demand, but we
    // still want to set the button based on the selection.  Do this by creating a temporary
    // dropdown so we can see what gets set.  This is tightly tied to DataSource.setItem.
    setButtonPopupHighlight()
    {
        let tempBox = this.createBox({container: document.body});
        DropdownMenuOpener.setActivePopupHighlightFrom(this.button, tempBox.container);
        tempBox.shutdown();
    }

    static setActivePopupHighlightFrom(button, box)
    {
        // Find the selected item in the dropdown, if any.
        let selectedItem = box.querySelector(".selected");
        let selectedDefault = selectedItem == null || selectedItem.dataset["default"];

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
        let itemHasDefault = box.querySelector("[data-default]") != null;
        if(itemHasDefault && selectedItem == null)
            selectedDefault = false;

        helpers.setClass(button, "selected", !selectedDefault);
        helpers.setClass(box, "selected", !selectedDefault);

        // If an option is selected, replace the menu button text with the selection's label.
        if(!selectedDefault)
        {
            // The short label is used to try to keep these labels from causing the menu buttons to
            // overflow the container, and for labels like "2 years ago" where the menu text doesn't
            // make sense.
            //
            // If we don't have a selected item, we're in the itemHasDefault case (see above).
            let text = selectedItem?.dataset?.shortLabel;
            let selectedLabel = selectedItem?.querySelector(".label")?.innerText;
            let label = button.querySelector(".label");
            label.innerText = text ?? selectedLabel ?? "Other";
        }
    }    
}
