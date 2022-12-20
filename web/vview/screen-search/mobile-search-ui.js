import { helpers } from 'vview/ppixiv-imports.js';
import CreateSearchMenu from 'vview/screen-search/search-menu.js';

// The bottom navigation bar for mobile, showing the current search and exposing a smaller
// action bar when open.  This vaguely follows the design language of iOS Safari.
export default class MobileSearchUI extends ppixiv.widget
{
    constructor(options)
    {
        super({
            ...options,
            template: `
            <div class=mobile-navigation-bar>
                <div class="header-contents button-row">
                    <div class="icon-button back-button disabled">
                        ${ helpers.create_icon("mat:arrow_back_ios_new") }
                    </div>

                    <div class="icon-button refresh-search-button">
                        ${ helpers.create_icon("refresh") }
                    </div>

                    <div class="icon-button menu">
                        ${ helpers.create_icon("search") }
                    </div>

                    <div class="icon-button slideshow">
                        ${ helpers.create_icon("wallpaper") }
                    </div>

                    <div class="icon-button preferences-button">
                        ${ helpers.create_icon("settings") }
                    </div>
                </div>
            </div>
        `});

        this.container.querySelector(".refresh-search-button").addEventListener("click", () => this.parent.refreshSearch());
        this.container.querySelector(".preferences-button").addEventListener("click", (e) => new ppixiv.settings_dialog());
        this.container.querySelector(".slideshow").addEventListener("click", (e) => helpers.navigate(ppixiv.app.slideshowURL));
        this.container.querySelector(".menu").addEventListener("click", (e) => new mobile_edit_search_dialog());

        this.container.querySelector(".back-button").addEventListener("click", () => {
            if(ppixiv.native)
            {
                if(this.parent.displayedMediaId == null)
                    return;

                let parent_folder_id = ppixiv.local_api.get_parent_folder(this.parent.displayedMediaId);

                let args = helpers.args.location;
                ppixiv.local_api.get_args_for_id(parent_folder_id, args);
                helpers.navigate(args);
            }
            else if(ppixiv.phistory.permanent)
            {
                ppixiv.phistory.back();
            }
        });
    }

    apply_visibility()
    {
        helpers.set_class(this.container, "shown", this._visible);
    }

    refreshUi()
    {
        // The back button navigate to parent locally, otherwise it's browser back if we're in
        // permanent history mode.
        let back_button = this.container.querySelector(".back-button");
        let show_back_button;
        if(ppixiv.native)
            show_back_button = ppixiv.local_api.get_parent_folder(this.parent.displayedMediaId) != null;
        else if(ppixiv.phistory.permanent)
            show_back_button = ppixiv.phistory.length > 1;
        helpers.set_class(back_button, "disabled", !show_back_button);
    }
}

// This dialog shows the search filters that are in the header box on desktop.
class mobile_edit_search_dialog extends ppixiv.dialog_widget
{
    constructor({...options}={})
    {
        super({...options,
            dialog_class: "edit-search-dialog",
            header: "Search",
            template: `
                <div class="search-selection vertical-list">
                </div>
            `
        });

        // Create the menu items.  This is the same as the dropdown list for desktop.
        let option_box = this.container.querySelector(".search-selection");
        CreateSearchMenu(option_box);

        this.container.addEventListener("click", (e) => {
            let a = e.target.closest("A");
            if(a == null)
                return;

            // Hide the dialog when any of the menu links are clicked.
            this.visible = false;

            // Don't actually navigate for clicks on rows with the disable-clicks class, since they
            // don't go anywhere.  They just refer to the search we're already on.
            if(a.classList.contains("disable-clicks"))
                e.preventDefault();
        });

        this.search_url = helpers.args.location;

        this.refresh();
    }

    get active_row()
    {
        // The active row is the one who would load a data source of the same class as the current one.
        let current_data_source = this.data_source;

        for(let button of this.container.querySelectorAll(".navigation-button"))
        {
            let url = new URL(button.href);
            let data_source_class = ppixiv.data_source.get_data_source_for_url(url);

            if(current_data_source instanceof data_source_class)
                return button;

            // Hack: the bookmarks row corresponds to multiple subclasses.  All of them should
            // map back to the bookmarks row.
            if(current_data_source instanceof ppixiv.data_source_bookmarks_base &&
               data_source_class.prototype instanceof ppixiv.data_source_bookmarks_base)
               return button;
        }

        throw new Error("Couldn't match data source for", current_data_source.__proto__);
    }

    refresh()
    {
        let active_row = this.active_row;
        for(let button of this.container.querySelectorAll(".navigation-button"))
            helpers.set_class(button, "selected", button == active_row);

        // Show this row if it's hidden.  Some rows are only displayed while they're in use.
        active_row.widget.visible = true;

        // If this is the artist row, set the title based on the artist name.
        if(active_row.classList.contains("artist-row"))
        {
            let data_source_is_artist = this.data_source instanceof ppixiv.data_sources.artist;
            if(data_source_is_artist)
            {
                let username = this.data_source.user_info?.name;
                active_row.querySelector(".label").innerText = username? `Artist: ${username}`:`Artist`;
            }
        }
        this.recreate_ui();
    }

    // We always show the primary data source.
    get data_source()
    {
        return ppixiv.app.data_source;
    }

    recreate_ui()
    {
        // Create the UI.
        let position = this.active_row;
        let row = position.closest(".box-link-row");
        if(row)
            position = row;
    }

    // Tell dialog_widget not to close us on popstate.  It'll still close us if the screen changes.
    get _close_on_popstate() { return false; }
}
