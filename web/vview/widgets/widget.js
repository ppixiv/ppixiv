// A basic widget base class.
import Actor from 'vview/actors/actor.js';
import { helpers } from 'vview/misc/helpers.js';

export default class Widget extends Actor
{
    // Find the widget containing a node.
    static fromNode(node, { allowNone=false }={})
    {
        if(node == null && allowNone)
            return null;

        // The top node for the widget has the widget class.
        let widgetTopNode = node.closest(".widget");
        if(widgetTopNode == null)
        {
            if(allowNone)
                return null;

            console.log("Node wasn't in a widget:", node);
            throw new Error("Node wasn't in a widget:", node);
        }

        console.assert(widgetTopNode.widget != null);
        return widgetTopNode.widget;
    }

    constructor({
        container,
        template=null,
        contents=null,
        visible=true,
        parent=null,

        // An insertAdjacentElement position (beforebegin, afterbegin, beforeend, afterend) indicating
        // where our contents should be inserted relative to container.  This can also be "replace", which
        // will replace container.
        containerPosition="beforeend",
        ...options}={})
    {
        // If container is a widget instead of a node, use the container's root node.
        if(container != null && container instanceof Widget)
            container = container.container;

        if(parent == null)
        {
            let parentSearchNode = container;
            if(contents)
                parentSearchNode = contents.parentNode;
            if(parentSearchNode == null && parent == null)
                console.warn("Can't search for parent");
            if(parentSearchNode)
            {
                let parentWidget = Widget.fromNode(parentSearchNode, { allowNone: true });
                if(parent != null && parent !== parentWidget)
                {
                    console.assert(parent === parentWidget);
                    console.log("Found:", parentWidget);
                    console.log("Expected:", parent);
                }
                parent = parentWidget;
            }
        }

        super({container, parent, ...options});

        // We must have either a template or contents.
        if(template)
        {
            console.assert(contents == null);
            this.container = this.createTemplate({html: template});
            if(container != null)
            {
                if(containerPosition == "replace")
                    container.replaceWith(this.container);
                else
                    container.insertAdjacentElement(containerPosition, this.container);
            }
        }
        else
        {
            // contents is a widget that's already created.  The container is always
            // the parent of contents, so container shouldn't be specified in this mode.
            console.assert(container == null);
            console.assert(contents != null);
            this.container = contents;
        }

        this.container.classList.add("widget");
        this.container.widget = this;

        // visible is the initial visibility.  We can't just set this.visible here, since
        // it'll call refresh and visibilityChanged, and the subclass isn't ready for those
        // to be called since it hasn't initialized yet.  Set this._visible directly, and
        // defer the initial refresh.
        this._visible = visible;
        this.applyVisibility();

        helpers.defer(() => {
            this.visibilityChanged();
            this.refresh();
        });
    }

    async refresh()
    {
    }

    get visible()
    {
        return this._visible;
    }

    set visible(value)
    {
        if(value == this.visible)
            return;

        this._visible = value;
        this.applyVisibility();

        this.visibilityChanged();

        // Let descendants know that visibleRecursively may have changed.
        this._callVisibleRecursivelyChanged();
    }

    shutdown()
    {
        super.shutdown();

        this.container.remove();
    }

    // Show or hide the widget.
    //
    // By default the widget is visible based on the value of this.visible, but the
    // subclass can override this.
    applyVisibility()
    {
        helpers.setClass(this.container, "hidden-widget", !this._visible);
    }

    // this.visible sets whether or not we want to be visible, but other things might influence
    // it too, like animations.  Setting visible = false on an animated widget will start its
    // hide animation, but actuallyVisible will return true until the animation finishes.
    get actuallyVisible()
    {
        return this.visible;
    }

    // This is called when actuallyVisible changes.  The subclass can override this.
    visibilityChanged()
    {
        if(this.actuallyVisible)
        {
            // Create an AbortController that will be aborted when the widget is hidden.
            if(this.visibilityAbort == null)
                this.visibilityAbort = new AbortController;
        } else {
            if(this.visibilityAbort)
                this.visibilityAbort.abort();

            this.visibilityAbort = null;
        }
    }

    querySelector(selector) { return this.container.querySelector(selector); }
    querySelectorAll(selector) { return this.container.querySelectorAll(selector); }
    closest(selector) { return this.container.closest(selector); }
}
