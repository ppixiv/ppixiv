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
            container = container.root;

        if(parent == null)
        {
            let parentSearchNode = container;
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

        this.root = this.createTemplate({html: template});
        if(container != null)
        {
            if(containerPosition == "replace")
                container.replaceWith(this.root);
            else
                container.insertAdjacentElement(containerPosition, this.root);
        }

        this.root.classList.add("widget");
        this.root.dataset.widget = this.className;
        this.root.widget = this;

        // Set _visible without calling applyVisibility.  We'll do that in afterInit so it
        // happens after the subclass is constructed.
        this._visible = visible;

        helpers.other.defer(() => {
            if(this.hasShutdown)
                return;

            this.afterInit();
        });
    }

    // This is called asynchronously after construction, and can be used for initialization
    // that should happen after the subclass is fully set up.
    afterInit()
    {
        this.applyVisibility();
        this.visibilityChanged();
        this.refresh();
    }

    // Use widget.root instead of widget.container.
    get container()
    {
        console.warn("Deprecated widget.container");
        return this.root;
    }

    async refresh()
    {
    }

    // Set whether the widget should be visible.
    //
    // This is usually only set by a widget's parent and not the widget itself, and tells us
    // whether we should be visible.  The widget may not become visible or hidden immediately
    // if it's animated.
    //
    // This only knows about this actor.  To find out if an actor and all of its ancestors are
    // visible, use visibleRecursively.
    get visible()
    {
        return this._visible;
    }

    set visible(value)
    {
        if(value == this.visible)
            return;

        this._visible = value;
        this.callVisibilityChanged();
    }

    // Return true if this widget is actually visible in the document.  If visible is false but
    // we're still animating away, we're actually still visible until the animation finishes.
    //
    // This only knows about this actor.  To find out if an actor and all of its ancestors are
    // actually visible, use actuallyVisibleRecursively.
    get actuallyVisible()
    {
        return this.visible;
    }

    visibilityChanged()
    {
        super.visibilityChanged();
        this.applyVisibility();
    }

    shutdown()
    {
        super.shutdown();

        this.root.remove();
    }

    // Show or hide the widget.
    //
    // By default the widget is visible based on the value of this.visible, but the
    // subclass can override this.
    applyVisibility()
    {
        helpers.html.setClass(this.root, "hidden-widget", !this._visible);
    }

    // This is called (via callVisibilityChanged) when visible, actuallyVisible or their recursive
    // versions may have changed value.
    visibilityChanged()
    {
        super.visibilityChanged();

        this.applyVisibility();

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

    querySelector(selector) { return this.root.querySelector(selector); }
    querySelectorAll(selector) { return this.root.querySelectorAll(selector); }
    closest(selector) { return this.root.closest(selector); }

    // Return an array of all DOM roots within this tree.  This is a list of DOM nodes which
    // contain all DOM nodes within the widget.
    //
    // Most of the time, a widget's only DOM root is its own root.  However, if a widget
    // contains a dropdown or other type of child widget which lives somewhere else in the
    // tree, that's also a root.
    //
    // This allows detecting if things like pointer events are anywhere within a widget's tree.
    getRoots()
    {
        let result = [this.root];

        // Any node whose root isn't within its parent widget's root is a new root node,
        // since it's not a DOM descendant of its parent.
        for(let widget of this.descendents())
        {
            if(helpers.html.isAbove(widget.parent.root, widget.root))
                result.push(widget.root);
        }

        return result;
    }
}
