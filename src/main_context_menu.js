// A global right-click popup menu.
//
// This is only active when right clicking over items with the context-menu-target
// class.
//
// Not all items are available all the time.  This is a singleton class, so it's easy
// for different parts of the UI to tell us when they're active.
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
        this.menu.querySelector(".button-zoom").addEventListener("click", this.clicked_zoom_toggle.bind(this));

        for(var button of this.menu.querySelectorAll(".button-zoom-level"))
            button.addEventListener("click", this.clicked_zoom_level.bind(this));
    }

    shutdown()
    {
        this.mode_observer.disconnect();
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

    // Override onmousedown to decide whether a click is over an element where we
    // should open the context menu.
    //
    // The context menu is installed globally, but we only want the context menu
    // to open over certain elements, like the image view.  Right clicking links
    // in the UI, etc. should use the standard context menu.
    onmousedown(e)
    {
        if(this.displayed_menu == null && e.target.closest(".context-menu-target") == null)
            return;
        return super.onmousedown(e);
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

    clicked_zoom_toggle(e)
    {
        if(!this._is_zoom_ui_enabled)
            return;
        
        this._on_click_viewer.set_zoom_center(e.clientX, e.clientY);
        this._on_click_viewer.locked_zoom = !this._on_click_viewer.locked_zoom;
        this.refresh();
    }

    clicked_zoom_level(e)
    {
        if(!this._is_zoom_ui_enabled)
            return;

        var level = parseInt(e.currentTarget.dataset.level);

        // If the zoom level that's already selected is clicked and we're already zoomed,
        // just toggle zoom as if the toggle zoom button was pressed.
        if(this._on_click_viewer.zoom_level == level && this._on_click_viewer.locked_zoom)
        {
            this.on_click_viewer.locked_zoom = false;
            this.refresh();
            return;
        }

        // Each zoom button enables zoom lock, since otherwise changing the zoom level would
        // only have an effect when click-dragging, so it looks like the buttons don't do anything.
        this._on_click_viewer.set_zoom_center(e.clientX, e.clientY);
        this._on_click_viewer.zoom_level = level;
        this._on_click_viewer.locked_zoom = true;
        this.refresh();
    }
}

