// Actor is the base class for the actor tree.  Actors can have parent and child actors.
// Shutting down an actor will shut down its children.  Each actor has an AbortSignal
// which is aborted when the actor shuts down, so event listeners, fetches, etc. can be
// shut down with the actor.
//
// Most actors are widgets and should derive from ppixiv.widget.  The base actor class
// doesn't have HTML content or add itself to the DOM tree.  Non-widget actors are used
// for helpers that want to live in the actor tree, but don't have content of their own.
import { helpers } from 'vview/misc/helpers.js';

export default class Actor extends EventTarget
{
    // If true, stack traces will be logged if shutdown() is called more than once.  This takes
    // a stack trace on each shutdown, so it's only enabled when needed.
    static debug_shutdown = false;

    // A list of top-level actors (actors with no parent).  This is just for debugging.
    static top_actors = [];

    // Dump the actor tree to the console.
    static dump_actors({parent=null}={})
    {
        let actors = parent? parent.child_actors:Actor.top_actors;

        let grouped = false;
        if(parent)
        {
            // If this parent has any children, create a logging group.  Otherwise, just log it normally.
            if(actors.length == 0)
                console.log(parent);
            else
            {
                console.group(parent);
                grouped = true;
            }
        }

        try {
            for(let actor of actors)
                Actor.dump_actors({parent: actor});
        } finally {
            // Only remove the logging group if we created one.
            if(grouped)
                console.groupEnd();
        }
    }

    constructor({
        container,
        
        // The parent actor, if any.
        parent=null,

        // The actor will be shut down if this is aborted.
        signal=null,
        ...options
    }={})
    {
        super();
        
        this.options = options;

        this.child_actors = [];

        this.parent = parent;

        // Create our shutdown_signal.  We'll abort this if we're shut down to shut down our children.
        // This is always shut down by us when shutdown() is called (it isn't used to shut us down).
        this.shutdown_signal = new AbortController();

        // If we weren't given a shutdown signal explicitly and we have a parent actor, inherit
        // its signal, so we'll shut down when the parent does.
        if(signal == null && this.parent != null)
            signal = this.parent.shutdown_signal.signal;

        // If we were given a parent shutdown signal, shut down if it aborts.
        if(signal)
            signal.addEventListener("abort", () => this.shutdown(), { once: true, ...this._signal });

        // Register ourself in our parent's child list.
        if(this.parent)
            this.parent._child_added(this);
        else
            Actor.top_actors.push(this);
    }

    shutdown()
    {
        if(Actor.debug_shutdown && !this._previous_shutdown_stack)
        {
            try {
                throw new Error();
            } catch(e) {
                this._previous_shutdown_stack = e.stack;
            }
        }

        // We should only be shut down once, so shutdown_signal shouldn't already be signalled.
        if(this.shutdown_signal.signal.aborted)
        {
            console.error("Actor has already shut down:", this);
            if(this._previous_shutdown_stack)
                console.log("Previous shutdown stack:", this._previous_shutdown_stack);
            return;
        }

        // This will shut down everything associated with this actor, as well as any child actors.
        this.shutdown_signal.abort();

        // All of our children should have shut down and removed themselves from our child list.
        if(this.child_actors.length != 0)
        {
            for(let child of this.child_actors)
                console.warn("Child of", this, "didn't shut down:", child);
        }

        // If we have a parent, remove ourself from it.  Otherwise, remove ourself from
        // top_actors.
        if(this.parent)
            this.parent._child_removed(this);
        else
        {
            let idx = Actor.top_actors.indexOf(this);
            console.assert(idx != -1);
            Actor.top_actors.splice(idx, 1);
        }
    }

    // Create an element from template HTML.  If name isn't null, the HTML will be cached
    // using name as a key.
    create_template({name=null, html, make_svg_unique=true})
    {
        // Cache templates on the class.  This doesn't share cache between subclasses, but
        // it lets us reuse templates between instances.
        let cls = this.__proto__;
        cls.templates ??= {};
        let template = name? cls.templates[name]:null;
        if(!template)
        {
            template = document.createElement("template");
            template.innerHTML = html;
            helpers.replace_inlines(template.content);
            
            cls.templates[name] = template;
        }

        return helpers.create_from_template(template, { make_svg_unique });
    }

    // For convenience, return options to add to an event listener and other objects that
    // take an AbortSignal to shut down when the rest of the actor does.
    //
    // node.addEventListener("event", func, this._signal);
    // node.addEventListener("event", func, { capture: true, ...this._signal });
    get _signal()
    {
        return { signal: this.shutdown_signal.signal };
    }

    _child_added(child)
    {
        this.child_actors.push(child);
    }

    _child_removed(child)
    {
        let idx = this.child_actors.indexOf(child);
        if(idx == -1)
        {
            console.warn("Actor wasn't in the child list:", child);
            return;
        }

        this.child_actors.splice(idx, 1);
    }

    // Yield all parents of this node.  If include_self is true, yield ourself too.
    *ancestors({include_self=false}={})
    {
        if(include_self)
            yield this;

        let count = 0;
        let parent = this.parent;
        while(parent != null)
        {
            yield parent;
            parent = parent.parent;

            count++;
            if(count > 10000)
                throw new Error("Recursion detected");
        }
    }

    // Return an array of all ancestors.  If include_self is true, yield ourself too.
    ancestors({include_self=false}={})
    {
        let result = [];
        if(include_self)
            result.push(result);

        let node = this.parent;
        while(node)
        {
            result.push(node);
            node = node.parent;
        }

        return result;
    }

    // Yield all descendants of this node, depth-first.  If include_self is true, yield ourself too.
    *descendents({include_self=false}={})
    {
        if(include_self)
            yield this;

        for(let child of this.child_actors)
        {
            yield child;
            for(let child_descendants of child.descendents())
                yield child_descendants;
        }
    }

    // Non-widget actors are always visible.
    get visible() { return true; }

    // Return true if we and all of our ancestors are visible.
    //
    // This is based on this.visible.  For widgets that animate on and off, this becomes false
    // as soon as the widget begins hiding (this.visible becomes false), without waiting for the
    // animation to finish (this.actually_visible).  This allows child widgets to animate away
    // along with the parent.
    get visible_recursively()
    {
        for(let node of this.ancestors({include_self: true}))
        {
            if(!node.visible)
                return false;
        }

        return true;
    }

    // Call on_visible_recursively_changed on the hierarchy.
    _call_on_visible_recursively_changed()
    {
        for(let actor of this.descendents({include_self: true}))
        {
            if(actor.on_visible_recursively_changed)
                actor.on_visible_recursively_changed(this);
        }
    }

    // This is called when visible_recursively may have changed.
    on_visible_recursively_changed() { }
}
