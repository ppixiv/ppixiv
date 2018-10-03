// A global right-click popup menu.
//
// This is only active when right clicking over items with the context-menu-target
// class.
//
// Not all items are available all the time.  This is a singleton class, so it's easy
// for different parts of the UI to tell us when they're active.
//
// This also handles alt-mousewheel zooming.
class main_context_menu extends popup_context_menu
{
    // Return the singleton.
    static get get()
    {
        return main_context_menu._singleton;
    }

    constructor(container)
    {
        super(container);

        if(main_context_menu._singleton != null)
            throw "Singleton already exists";
        main_context_menu._singleton = this;

        this.onwheel = this.onwheel.bind(this);
        this.onkeydown = this.onkeydown.bind(this);
        this.on_click_viewer = null;

        // Refresh the menu when the view changes.
        this.mode_observer = new MutationObserver(function(mutationsList, observer) {
            for(var mutation of mutationsList) {
                if(mutation.type == "attributes")
                {
                    if(mutation.attributeName == "data-current-view")
                        this.refresh();
                }
            }
        }.bind(this));

        this.mode_observer.observe(document.body, {
            attributes: true, childList: false, subtree: false
        });

        this.refresh();

        this.menu.querySelector(".button-return-to-search").addEventListener("click", this.clicked_return_to_search.bind(this));
        this.menu.querySelector(".button-fullscreen").addEventListener("click", this.clicked_fullscreen.bind(this));
        this.menu.querySelector(".button-zoom").addEventListener("click", this.clicked_zoom_toggle.bind(this));
        window.addEventListener("wheel", this.onwheel, true);
        window.addEventListener("keydown", this.onkeydown);

        for(var button of this.menu.querySelectorAll(".button-zoom-level"))
            button.addEventListener("click", this.clicked_zoom_level.bind(this));
    }

    shutdown()
    {
        this.mode_observer.disconnect();
        window.removeEventListener("wheel", this.onwheel, true);
        super.shutdown();
    }

    get on_click_viewer()
    {
        return this._on_click_viewer;
    }
    set on_click_viewer(viewer)
    {
        this._on_click_viewer = viewer;
        this.refresh();
    }

    // Put the zoom toggle button under the cursor, so right-left click is a quick way
    // to toggle zoom lock.
    get element_to_center()
    {
        return this.displayed_menu.querySelector(".button-zoom");
    }
        
    get _is_zoom_ui_enabled()
    {
        var view = document.body.dataset.currentView;
        return view == "illust" && this._on_click_viewer != null;
    }

    set_data_source(data_source)
    {
        if(this.data_source == data_source)
            return;

        this.data_source = data_source;
        this.refresh();
    }

    onkeydown(e)
    {
        var zoom = helpers.is_zoom_hotkey(e);
        if(zoom != null)
        {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.handle_zoom_event(e, zoom < 0);
        }
    }

    onwheel(e)
    {
        // Stop if zooming isn't enabled.
        if(!this._is_zoom_ui_enabled)
            return;

        // Only mousewheel zoom if control is pressed, or if the popup menu is visible.
        if(!e.ctrlKey && !this.visible)
            return;

        var down = e.deltaY > 0;
        this.handle_zoom_event(e, down);
    }
    
    // Handle both mousewheel and control-+/- zooming.
    handle_zoom_event(e, down)
    {
        e.preventDefault();
        e.stopImmediatePropagation();

        if(!this.hide_temporarily)
        {
            // Hide the poopup menu.  It remains open, so hide() will still be called when
            // the right mouse button is released and the overall flow remains unchanged, but
            // the popup itself will be hidden.
            this.hide_temporarily = true;
        }

        // If e is a keyboard event, e.pageX is null and this will be the center of the screen.
        let center = this._on_click_viewer.get_image_position(e.pageX, e.pageY);
        
        // If mousewheel zooming is used while not zoomed, turn on zooming and set
        // a 1x zoom factor, so we zoom relative to the previously unzoomed image.
        if(!this._on_click_viewer.zoom_active)
        {
            this._on_click_viewer.zoom_level = 4; // level 4 is 1x
            this._on_click_viewer.locked_zoom = true;
            this._on_click_viewer.relative_zoom_level = 0;
            this.refresh();
        }

        this._on_click_viewer.relative_zoom_level += down? -1:+1;

        // As a special case, if we're in 1x zoom from above and we return to 1x relative zoom
        // (eg. the user mousewheeled up and then back down), switch to another zoom mode.
        // Otherwise, if you zoom up and then back down, the zoom level is left at 1x, so click
        // zooming seems to be broken.  We don't know what the old zoom setting was to restore it,
        // so we just switch to fill zoom.
        if(this._on_click_viewer.relative_zoom_level == 0 && this._on_click_viewer.zoom_level == 4)
        {
            this._on_click_viewer.zoom_level = 0;
            this._on_click_viewer.locked_zoom = false;
        }

        this._on_click_viewer.set_image_position(e.pageX, e.pageY, center);
        this.refresh();
    }

    hide()
    {
        super.hide();
    }

    // Update selection highlight for the context menu.
    refresh()
    {
        var view = document.body.dataset.currentView;

        // Update the tooltip for the thumbnail toggle button.
        var navigate_out_label = main_controller.singleton.navigate_out_label;
        var title = navigate_out_label != null? ("Return to " + navigate_out_label):"";
        this.menu.querySelector(".button-return-to-search").dataset.tooltip = title;
        helpers.set_class(this.menu.querySelector(".button-return-to-search"), "enabled", navigate_out_label != null);
        this.refresh_tooltip();

        // Enable the zoom buttons if we're in the image view and we have an on_click_viewer.
        for(var element of this.menu.querySelectorAll(".zoom-strip .button"))
            helpers.set_class(element, "enabled", this._is_zoom_ui_enabled);

        if(this._is_zoom_ui_enabled)
        {
            helpers.set_class(this.menu.querySelector(".button-zoom"), "selected", this._on_click_viewer.locked_zoom);

            var zoom_level = this._on_click_viewer.zoom_level;
            for(var button of this.menu.querySelectorAll(".button-zoom-level"))
                helpers.set_class(button, "selected", parseInt(button.dataset.level) == zoom_level);
        }
    }

    clicked_return_to_search(e)
    {
        main_controller.singleton.navigate_out();
    }

    clicked_fullscreen(e)
    {
        if(!document.fullscreenElement)
            document.documentElement.requestFullscreen();
        else
            document.exitFullscreen(); 
    }

    clicked_zoom_toggle(e)
    {
        if(!this._is_zoom_ui_enabled)
            return;
        
        let center = this._on_click_viewer.get_image_position(e.pageX, e.pageY);
        this._on_click_viewer.locked_zoom = !this._on_click_viewer.locked_zoom;
        this._on_click_viewer.set_image_position(e.pageX, e.pageY, center);

        this.refresh();
    }

    clicked_zoom_level(e)
    {
        if(!this._is_zoom_ui_enabled)
            return;

        var level = parseInt(e.currentTarget.dataset.level);

        // If the zoom level that's already selected is clicked and we're already zoomed,
        // just toggle zoom as if the toggle zoom button was pressed.
        if(this._on_click_viewer.zoom_level == level && this._on_click_viewer.relative_zoom_level == 0 && this._on_click_viewer.locked_zoom)
        {
            this.on_click_viewer.locked_zoom = false;
            this.refresh();
            return;
        }


        let center = this._on_click_viewer.get_image_position(e.pageX, e.pageY);
        
        // Each zoom button enables zoom lock, since otherwise changing the zoom level would
        // only have an effect when click-dragging, so it looks like the buttons don't do anything.
        this._on_click_viewer.zoom_level = level;
        this._on_click_viewer.locked_zoom = true;
        this._on_click_viewer.relative_zoom_level = 0;

        this._on_click_viewer.set_image_position(e.pageX, e.pageY, center);
        
        this.refresh();
    }
}

