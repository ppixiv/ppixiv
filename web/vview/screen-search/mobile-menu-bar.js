import Widget from '/vview/widgets/widget.js';
import CreateSearchMenu from '/vview/screen-search/search-menu.js';
import { SettingsDialog } from '/vview/widgets/settings-widgets.js';
import { DataSource_BookmarksBase } from '/vview/sites/pixiv/data-sources/bookmarks.js';
import DialogWidget from '/vview/widgets/dialog.js';
import LocalAPI from '/vview/misc/local-api.js';
import { helpers } from '/vview/misc/helpers.js';

// The bottom navigation bar for mobile, showing the current search and exposing a smaller
// action bar when open.  This vaguely follows the design language of iOS Safari.
export default class MobileSearchUI extends Widget
{
    constructor(options)
    {
        super({
            ...options,
            template: `
            <div class=mobile-navigation-bar>
                <div class="header-contents button-row">
                    <div class="icon-button back-button disabled">
                        ${ helpers.createIcon("mat:arrow_back_ios_new") }
                    </div>

                    <div class="icon-button refresh-search-button">
                        ${ helpers.createIcon("refresh") }
                    </div>

                    <div class="icon-button menu">
                        ${ helpers.createIcon("search") }
                    </div>

                    <div class="icon-button slideshow">
                        ${ helpers.createIcon("wallpaper") }
                    </div>

                    <div class="icon-button preferences-button">
                        ${ helpers.createIcon("settings") }
                    </div>
                </div>
            </div>
        `});

        this.root.querySelector(".refresh-search-button").addEventListener("click", () => this.parent.refreshSearch());
        this.root.querySelector(".preferences-button").addEventListener("click", (e) => new SettingsDialog());
        this.root.querySelector(".slideshow").addEventListener("click", (e) => helpers.navigate(ppixiv.app.slideshowURL));
        this.root.querySelector(".menu").addEventListener("click", (e) => new MobileEditSearchDialog());

        this.root.querySelector(".back-button").addEventListener("click", () => {
            if(ppixiv.native)
            {
                if(this.parent.displayedMediaId == null)
                    return;

                let parentFolderId = LocalAPI.getParentFolder(this.parent.displayedMediaId);

                let args = helpers.args.location;
                LocalAPI.getArgsForId(parentFolderId, args);
                helpers.navigate(args);
            }
            else if(ppixiv.phistory.permanent)
            {
                ppixiv.phistory.back();
            }
        });
    }

    applyVisibility()
    {
        helpers.html.setClass(this.root, "shown", this._visible);
    }

    refreshUi()
    {
        // The back button navigate to parent locally, otherwise it's browser back if we're in
        // permanent history mode.
        let backButton = this.root.querySelector(".back-button");
        let showBackButton;
        if(ppixiv.native)
            showBackButton = LocalAPI.getParentFolder(this.parent.displayedMediaId) != null;
        else if(ppixiv.phistory.permanent)
            showBackButton = ppixiv.phistory.length > 1;
        helpers.html.setClass(backButton, "disabled", !showBackButton);
    }
}

// This dialog shows the search filters that are in the header box on desktop.
class MobileEditSearchDialog extends DialogWidget
{
    constructor({...options}={})
    {
        super({...options,
            dialogClass: "edit-search-dialog",
            header: "Search",
            template: `
                <div class="search-selection vertical-list">
                </div>
            `
        });

        // Create the menu items.  This is the same as the dropdown list for desktop.
        let optionBox = this.root.querySelector(".search-selection");
        CreateSearchMenu(optionBox);

        this.root.addEventListener("click", (e) => {
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

        this.searchUrl = helpers.args.location;

        this.refresh();
    }

    get activeRow()
    {
        // The active row is the one who would load a data source of the same class as the current one.
        let currentDataSource = this.dataSource;

        for(let button of this.root.querySelectorAll(".navigation-button"))
        {
            let url = new URL(button.href);
            let dataSourceClass = ppixiv.site.getDataSourceForUrl(url);

            if(currentDataSource instanceof dataSourceClass)
                return button;

            // Hack: the bookmarks row corresponds to multiple subclasses.  All of them should
            // map back to the bookmarks row.
            if(currentDataSource instanceof DataSource_BookmarksBase &&
               dataSourceClass.prototype instanceof DataSource_BookmarksBase)
               return button;
        }

        throw new Error("Couldn't match data source for", currentDataSource.__proto__);
    }

    refresh()
    {
        let activeRow = this.activeRow;
        for(let button of this.root.querySelectorAll(".navigation-button"))
            helpers.html.setClass(button, "selected", button == activeRow);

        // Show this row if it's hidden.  Some rows are only displayed while they're in use.
        activeRow.widget.visible = true;

        // If this is the artist row, set the title based on the artist name.
        if(activeRow.classList.contains("artist-row"))
        {
            let title = this.dataSource.uiInfo.mobileTitle;
            if(title)
                activeRow.querySelector(".label").innerText = title;
        }
        this._recreateUi();
    }

    // We always show the primary data source.
    get dataSource()
    {
        return ppixiv.app.currentDataSource;
    }

    _recreateUi()
    {
        // Create the UI.
        let position = this.activeRow;
        let row = position.closest(".box-link-row");
        if(row)
            position = row;
    }

    // Tell DialogWidget not to close us on popstate.  It'll still close us if the screen changes.
    get _closeOnPopstate() { return false; }
}
