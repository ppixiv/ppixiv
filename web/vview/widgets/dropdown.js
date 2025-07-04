import Actor from '/vview/actors/actor.js';
import Widget from '/vview/widgets/widget.js';
import Dialog from '/vview/widgets/dialog.js';
import ClickOutsideListener from '/vview/widgets/click-outside-listener.js';
import { helpers, OpenWidgets } from '/vview/misc/helpers.js';

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
        createDropdown=null,

        onvisibilitychanged=() => { },

        // If true (or a function that returns true), open the dropdown as a dialog instead.
        //
        // On mobile, dropdowns will always open as dialogs if they're inside another dialog.
        asDialog=() => false,

        // If true, clicking the button toggles the dropdown.
        clickToOpen=false,

        // If null, the widget containing the button is our parent.
        parent=null,

        ...options
    })
    {
        // Find a parent widget above the button.
        parent ??= Widget.fromNode(button);

        super({
            parent,
            ...options,
        });

        this.button = button;
        this.shouldCloseForClick = shouldCloseForClick;
        this.onvisibilitychanged = onvisibilitychanged;
        this.createDropdown = createDropdown;

        if(asDialog instanceof Function)
            this.asDialog = asDialog;
        else
            this.asDialog = () => asDialog;

        this._dropdown = null;
        this._visible = false;

        // Refresh the position if the box width changes.  Don't refresh on any ResizeObserver
        // call, since that'll recurse and end up refreshing constantly.
        this._boxWidth = 0;

        if(clickToOpen)
            this.button.addEventListener("click", (e) => this.visible = !this.visible, this._signal);
    }

    onwindowresize = (e) =>
    {
        this._alignToButton();
    };

    // Hide if our tree becomes hidden.
    visibilityChanged()
    {
        super.visibilityChanged();

        if(!this.visibleRecursively)
            this.visible = false;
    }

    get visible()
    {
        return this._visible;
    }

    // If the dropdown is open, return it.
    get dropdown()
    {
        return this._dropdown;
    }

    set visible(value)
    {
        if(this._visible == value)
            return;

        this._visible = value;

        // If we're inside ScreenSearch's top-ui-box container, set .force-open on that element
        // while we're open.  This prevents it from being hidden while a dropdown inside it is
        // open.
        let topUiBox = this.parent.closest(".top-ui-box");
        if(topUiBox)
            helpers.html.setClass(topUiBox, "force-open", value);

        // Register this as an open widget to pause slideshows.
        OpenWidgets.singleton.set(this, value);

        if(value)
        {
            let asDialog = this.asDialog();
            if(window.ppixiv?.mobile)
            {
                // Always open dropdowns as dialogs if we're on mobile and inside another dialog.
                for(let node of this.ancestors())
                {
                    if(node instanceof Dialog)
                    {
                        console.log("Opening dropdown as a dialog because we're inside another dialog:", node);
                        asDialog = true;
                        break;
                    }
                }
            }

            // Normally, the dropdown's container is the document so we can position it easily, and
            // we're its parent.  If we're opening it in a dialog then the dialog is its container and
            // parent, and the dialog owns the dropdown.
            let container = document.body;
            let parent = this;
            this._dropdownDialog = null;
            if(asDialog)
            {
                parent = this._dropdownDialog = new Dialog({
                    parent: this,
                    template: `<div></div>`,
                });
                this._dropdownDialog.shutdownSignal.addEventListener("abort", (e) => {
                    // Ignore this if it's from a previous dialog that we discarded.
                    if(e.target != this._dropdownDialog?.shutdownSignal)
                        return;

                    console.log("Dialog dropdown closed");

                    // The dropdown shut itself down and the dropdown with it.  Clear them so
                    // we don't try to shut them down again.
                    this._dropdownDialog = null;
                    this._dropdown = null;

                    this.visible = false;
                });
                container = this._dropdownDialog.querySelector(".scroll");
            }

            this._dropdown = this.createDropdown({ container, parent });

            // Stop if no widget was created.
            if(this._dropdown == null)
            {
                this._visible = false;

                // If we created a dialog, remove it since we're not going to use it.
                if(this._dropdownDialog)
                {
                    this._dropdownDialog.shutdown();
                    this._dropdownDialog = null;
                }
                return;
            }

            if(!asDialog)
            {
                this._dropdown.root.classList.add("dropdown-box");

                this.listener = new ClickOutsideListener([this.button, this._dropdown], (target, {event}) => {
                    if(!this.shouldCloseForClick(event))
                        return;

                    this.visible = false;
                });

                this._resizeObserver = new ResizeObserver(() => {
                    if(this._boxWidth == this._dropdown.root.offsetWidth)
                        return;
        
                    this._boxWidth = this._dropdown.root.offsetWidth;
                    this._alignToButton();
                });
                this._resizeObserver.observe(this._dropdown.root);

                // We manually position the dropdown, so we need to reposition them if
                // the window size changes.
                window.addEventListener("resize", this.onwindowresize, this._signal);

                this._alignToButton();
            }

            if(this.closeOnClickInside)
                this._dropdown.root.addEventListener("click", this.boxClicked);
        }
        else
        {
            // If we have a dialog, tell the dialog to hide itself and discard it.  It'll
            // shut the dropdown and itself down after any transitions complete.
            if(this._dropdownDialog)
            {
                this._dropdownDialog.visible = false;
                this._dropdownDialog = null;
                this._dropdown = null;
                return;
            }

            this._cleanup();

            if(this._dropdown)
            {
                this._dropdown.shutdown();
                this._dropdown = null;
            }
        }

        this.onvisibilitychanged(this);
    }

    _cleanup()
    {
        this.visible = false;

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
        OpenWidgets.singleton.set(this, false);
    }

    _alignToButton()
    {
        if(!this.visible)
            return;

        // This isn't used when displaying as a dialog.
        if(this._dropdownDialog)
            return;

        // The amount of padding to leave relative to the button we're aligning to.
        let horizontalPadding = 4, verticalPadding = 8;

        // Figure out the z-index of the button we're positioning relative to, and put
        // ourselves over it.
        let buttonParent = this.button;
        this._dropdown.root.style.zIndex = 1;
        while(buttonParent)
        {
            let { zIndex } = getComputedStyle(buttonParent);
            if(zIndex != "auto")
            {
                zIndex = parseInt(zIndex);
                this._dropdown.root.style.zIndex = zIndex + 1;
                break;
            }

            buttonParent = buttonParent.offsetParent;
        }

        // Use getBoundingClientRect to figure out the position, since it works
        // correctly with CSS transforms.  Figure out how far off we are and move
        // by that amount.  This works regardless of what our relative position is.
        //let {left: box_x, top: box_y} = this._dropdown.root.getBoundingClientRect(document.body);
        let {left: buttonX, top: buttonY, height: boxHeight} = this.button.getBoundingClientRect();

        // Align to the left of the button.  Nudge left slightly for padding.
        let x = buttonX - horizontalPadding;

        // If the right edge of the box is offscreen, push the box left.  Leave a bit of
        // padding on desktop, so the dropdown isn't flush with the edge of the window.
        // On mobile, allow the box to be flush with the edge.
        let padding = window.ppixiv?.mobile? 0:4;
        let rightEdge = x + this._boxWidth;
        x -= Math.max(rightEdge - (window.innerWidth - padding), 0);

        // Don't push the left edge past the left edge of the screen.
        x = Math.max(x, 0);

        let y = buttonY;

        this._dropdown.root.style.left = `${x}px`;

        // Put the dropdown below the button if we're on the top half of the screen, otherwise
        // put it above.
        if(y < window.innerHeight / 2)
        {
            // Align to the bottom of the button, adding a bit of padding.
            y += boxHeight + verticalPadding;
            this._dropdown.root.style.top = `${y}px`;
            this._dropdown.root.style.bottom = "";

            // Set the box's maxHeight so it doesn't cross the bottom of the screen.
            // On desktop, add a bit of padding so it's not flush against the edge.
            let height = window.innerHeight - y - padding;
            this._dropdown.root.style.maxHeight = `${height}px`;
        }
        else
        {
            y -= verticalPadding;

            // Align to the top of the button.
            this._dropdown.root.style.top = "";
            this._dropdown.root.style.bottom = `calc(100% - ${y}px)`;

            // Set the box's maxHeight so it doesn't cross the top of the screen.
            let height = y - padding;
            this._dropdown.root.style.maxHeight = `${height}px`;
        }
    }

    shutdown()
    {
        this._cleanup();

        // Call the base shutdown() after cleaning up so our shutdown signal isn't fired
        // until after we're done cleaning up.
        super.shutdown();
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
        createDropdown=null,

        ...options
    })
    {
        super({
            // Wrap createDropdown() to add the popup-menu-box class.
            createDropdown: (...args) => {
                let widget = createDropdown(...args);
                widget.root.classList.add("popup-menu-box");
                return widget;
            },

            ...options
        });

        this.button.addEventListener("click", (e) => this._buttonClicked(e), this._signal);

        this.setButtonPopupHighlight();
    }

    get closeOnClickInside() { return true; }

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
        let tempBox = this.createDropdown({container: document.body});
        DropdownMenuOpener.setActivePopupHighlightFrom(this.button, tempBox.root);
        tempBox.shutdown();
    }

    static setActivePopupHighlightFrom(button, box)
    {
        // Find the selected item in the dropdown, if any.
        let selectedItem = box.querySelector(".selected");
        let selectedDefault = selectedItem == null || selectedItem.dataset["default"];

        // If an explicit default button exists, there's usually something selected in the
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

        helpers.html.setClass(button, "selected", !selectedDefault);
        helpers.html.setClass(box, "selected", !selectedDefault);

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
