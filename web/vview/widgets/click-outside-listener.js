// Call a callback on any click not inside a list of nodes.
//
// This is used to close dropdown menus.

import Actor from 'vview/actors/actor.js';
import { helpers } from 'vview/ppixiv-imports.js';

export default class ClickOutsideListener extends Actor
{
    constructor(nodeList, callback)
    {
        super({});

        this.nodeList = nodeList;
        this.callback = callback;

        new ppixiv.pointer_listener({
            element: document.documentElement,
            button_mask: 0xFFFF,
            callback: this.windowPointerdown,
            ...this._signal,
        });
    }

    // Return true if node is below any node in nodeList.
    _isNodeInList(node)
    {
        for(let ancestor of this.nodeList)
        {
            if(helpers.is_above(ancestor, node))
                return true;
        }
        return false;
    }

    windowPointerdown = (e) =>
    {
        if(!e.pressed)
            return;
        
        // Close the popup if anything outside the dropdown is clicked.  Don't
        // prevent the click event, so the click still happens.
        //
        // If this is a click inside the box or our button, ignore it.
        if(this._isNodeInList(e.target))
            return;

        // We don't cancel this event, but set a property on it to let IsolatedTapHandler
        // know this press shouldn't be treated as an isolated tap.
        e.partially_handled = true;

        this.callback(e.target, {event: e});
    }
}
