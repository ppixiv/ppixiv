// A basic widget base class.
import Actor from 'vview/actors/actor.js';
import { helpers } from 'vview/misc/helpers.js';

export default class Widget extends Actor
{
    // Find the widget containing a node.
    static from_node(node, { allow_none=false }={})
    {
        if(node == null && allow_none)
            return null;

        // The top node for the widget has the widget class.
        let widget_top_node = node.closest(".widget");
        if(widget_top_node == null)
        {
            if(allow_none)
                return null;

            console.log("Node wasn't in a widget:", node);
            throw new Error("Node wasn't in a widget:", node);
        }

        console.assert(widget_top_node.widget != null);
        return widget_top_node.widget;
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
        container_position="beforeend",
        ...options}={})
    {
        // If container is a widget instead of a node, use the container's root node.
        if(container != null && container instanceof Widget)
            container = container.container;

        if(parent == null)
        {
            let parent_search_node = container;
            if(contents)
                parent_search_node = contents.parentNode;
            if(parent_search_node == null && parent == null)
                console.warn("Can't search for parent");
            if(parent_search_node)
            {
                let parent_widget = Widget.from_node(parent_search_node, { allow_none: true });
                if(parent != null && parent !== parent_widget)
                {
                    console.assert(parent === parent_widget);
                    console.log("Found:", parent_widget);
                    console.log("Expected:", parent);
                }
                parent = parent_widget;
            }
        }

        super({container, parent, ...options});

        // We must have either a template or contents.
        if(template)
        {
            console.assert(contents == null);
            this.container = this.create_template({html: template});
            if(container != null)
            {
                if(container_position == "replace")
                    container.replaceWith(this.container);
                else
                    container.insertAdjacentElement(container_position, this.container);
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
        // it'll call refresh and visibility_changed, and the subclass isn't ready for those
        // to be called since it hasn't initialized yet.  Set this._visible directly, and
        // defer the initial refresh.
        this._visible = visible;
        this.apply_visibility();

        helpers.defer(() => {
            this.visibility_changed();
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
        this.apply_visibility();

        this.visibility_changed();

        // Let descendants know that visible_recursively may have changed.
        this._call_on_visible_recursively_changed();
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
    apply_visibility()
    {
        helpers.set_class(this.container, "hidden-widget", !this._visible);
    }

    // this.visible sets whether or not we want to be visible, but other things might influence
    // it too, like animations.  Setting visible = false on an animated widget will start its
    // hide animation, but actually_visible will return true until the animation finishes.
    get actually_visible()
    {
        return this.visible;
    }

    // This is called when actually_visible changes.  The subclass can override this.
    visibility_changed()
    {
        if(this.actually_visible)
        {
            // Create an AbortController that will be aborted when the widget is hidden.
            if(this.visibility_abort == null)
                this.visibility_abort = new AbortController;
        } else {
            if(this.visibility_abort)
                this.visibility_abort.abort();

            this.visibility_abort = null;
        }
    }

    querySelector(selector) { return this.container.querySelector(selector); }
    querySelectorAll(selector) { return this.container.querySelectorAll(selector); }
    closest(selector) { return this.container.closest(selector); }
}
