import Widget from '/vview/widgets/widget.js';
import { IllustWidget } from '/vview/widgets/illust-widgets.js';
import { DropdownBoxOpener } from '/vview/widgets/dropdown.js';
import { helpers } from '/vview/misc/helpers.js';
import LocalAPI from '/vview/misc/local-api.js';

// LocalSearchBoxWidget and LocalSearchDropdownWidget are dumb copy-pastes
// of TagSearchBoxWidget and TagSearchDropdownWidget.  They're simpler and
// much less used, and it didn't seem worth creating a shared base class for these.
export class LocalSearchBoxWidget extends Widget
{
    constructor({...options})
    {
        super({
            ...options, template: `
                <div class="search-box local-tag-search-box">
                    <div class="input-field-container hover-menu-box">
                        <input placeholder="Search files" size=1 autocorrect=off>

                        <span class="clear-local-search-button right-side-button">
                            ${ helpers.createIcon("clear") }
                        </span>

                        <span class="submit-local-search-button right-side-button">
                            ${ helpers.createIcon("search") }
                        </span>
                    </div>
                </div>
            `
        });

        this.inputElement = this.root.querySelector(".input-field-container > input");

        this.dropdownOpener = new DropdownBoxOpener({
            button: this.inputElement,

            createDropdown: ({...options}) => {
                return new LocalSearchDropdownWidget({
                    inputElement: this.root,
                    focusParent: this.root,
                    ...options,
                });
            },

            shouldCloseForClick: (e) => {
                // Ignore clicks inside our container.
                if(helpers.html.isAbove(this.root, e.target))
                    return false;

                return true;
            },
        });

        this.inputElement.addEventListener("keydown", (e) => {
            // Exit the search box if escape is pressed.
            if(e.key == "Escape")
            {
                this.dropdownOpener.visible = false;
                this.inputElement.blur();
            }
        });

        this.inputElement.addEventListener("focus", () => this.dropdownOpener.visible = true);
        this.inputElement.addEventListener("submit", this.submitSearch);
        this.clearSearchButton = this.root.querySelector(".clear-local-search-button");
        this.clearSearchButton.addEventListener("click", (e) => {
            this.inputElement.value = "";
            this.inputElement.dispatchEvent(new Event("submit"));
        });
        this.root.querySelector(".submit-local-search-button").addEventListener("click", (e) => {
            this.inputElement.dispatchEvent(new Event("submit"));
        });

        this.inputElement.addEventListener("input", (e) => {
            this.refreshClearButtonVisibility();
        });

        // Search submission:
        helpers.inputHandler(this.inputElement, this.submitSearch);

        window.addEventListener("pp:popstate", (e) => { this.refreshFromLocation(); });
        this.refreshFromLocation();
        this.refreshClearButtonVisibility();
    }

    // Hide if our tree becomes hidden.
    visibilityChanged()
    {
        super.visibilityChanged();

        if(!this.visibleRecursively)
            this.dropdownOpener.visible = false;
    }

    // SEt the text box from the current URL.
    refreshFromLocation()
    {
        let args = helpers.args.location;
        this.inputElement.value = args.hash.get("search") || "";
        this.refreshClearButtonVisibility();
    }

    refreshClearButtonVisibility()
    {
        this.clearSearchButton.hidden = this.inputElement.value == "";
    }

    submitSearch = (e) =>
    {
        let tags = this.inputElement.value;
        LocalAPI.navigateToTagSearch(tags);

        // If we're submitting by pressing enter on an input element, unfocus it and
        // close any widgets inside it (tag dropdowns).
        if(e.target instanceof HTMLInputElement)
        {
            e.target.blur();
            this.dropdownOpener.visible = false;
        }
    }
}

class LocalSearchDropdownWidget extends Widget
{
    constructor({inputElement, focusParent, ...options})
    {
        super({...options, template: `
            <div class="search-history input-dropdown">
                <div class="input-dropdown-contents input-dropdown-list">
                    <!-- template-tag-dropdown-entry instances will be added here. -->
                </div>
            </div>
        `});

        this.inputElement = inputElement;

        // While we're open, we'll close if the user clicks outside focusParent.
        this.focusParent = focusParent;

        // Refresh the dropdown when the search history changes.
        window.addEventListener("recent-local-searches-changed", this._populateDropdown);

        this.root.addEventListener("click", this.dropdownClick);

        // input-dropdown is resizable.  Save the size when the user drags it.
        this._inputDropdown = this.root.querySelector(".input-dropdown-list");

        // Restore input-dropdown's width.
        let refreshDropdownWidth = () => {
            let width = ppixiv.settings.get("tag-dropdown-width", "400");
            width = parseInt(width);
            if(isNaN(width))
                width = 400;
            this.root.style.setProperty('--width', `${width}px`);
        };

        let observer = new MutationObserver((mutations) => {
            // resize sets the width.  Use this instead of offsetWidth, since offsetWidth sometimes reads
            // as 0 here.
            ppixiv.settings.set("tag-dropdown-width", this._inputDropdown.style.width);
        });
        observer.observe(this._inputDropdown, { attributes: true });

        // Restore input-dropdown's width.
        refreshDropdownWidth();

        this._load();
    }

    dropdownClick = (e) =>
    {
        let removeEntry = e.target.closest(".remove-history-entry");
        if(removeEntry != null)
        {
            // Clicked X to remove a tag from history.
            e.stopPropagation();
            e.preventDefault();

            let tag = e.target.closest(".entry").dataset.tag;
            this._removeRecentLocalSearch(tag);
            return;
        }

        // Close the dropdown if the user clicks a tag (but not when clicking
        // remove-history-entry).
        if(e.target.closest(".tag"))
            this.hide();
    }

    _removeRecentLocalSearch(search)
    {
        // Remove tag from the list.  There should normally only be one.
        let recentTags = ppixiv.settings.get("local_searches") || [];
        while(1)
        {
            let idx = recentTags.indexOf(search);
            if(idx == -1)
                break;
            recentTags.splice(idx, 1);
        }
        ppixiv.settings.set("local_searches", recentTags);
        window.dispatchEvent(new Event("recent-local-searches-changed"));
    }
        
    _load()
    {
        // Fill in the dropdown before displaying it.
        this._populateDropdown();
    }

    createEntry(search)
    {
        let entry = this.createTemplate({name: "tag-dropdown-entry", html: `
            <a class=entry href=#>
                <span class=search></span>
                <span class="right-side-buttons">
                    <span class="remove-history-entry right-side-button keep-menu-open">X</span>
                </span>
            </a>
        `});
        entry.dataset.tag = search;

        let span = document.createElement("span");
        span.innerText = search;

        entry.querySelector(".search").appendChild(span);

        let args = new helpers.args("/", ppixiv.plocation);
        args.path = LocalAPI.path;
        args.hashPath = "/";
        args.hash.set("search", search);
        entry.href = args.url;
        return entry;
    }

    // Populate the tag dropdown.
    _populateDropdown = () =>
    {
        let tagSearches = ppixiv.settings.get("local_searches") || [];
        tagSearches.sort();

        let list = this.root.querySelector(".input-dropdown-list");
        helpers.html.removeElements(list);

        for(let tag of tagSearches)
        {
            let entry = this.createEntry(tag);
            entry.classList.add("history");
            list.appendChild(entry);
        }
    }
}

// A button to show an image in Explorer.
//
// This requires vview_scheme.pyw be set up.
export class ViewInExplorerWidget extends IllustWidget
{
    constructor({...options})
    {
        super({
            ...options,
            template: `
                <a href=# class="button private popup local-link">
                    ${ helpers.createIcon("description") }
                </a>
            `
        });

        this.enabled = false;

        this.root.addEventListener("click", (e) => {
            // Ignore clicks on the button if it's disabled.
            if(!this.enabled)
            {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // On alt-click, copy the path.
            if(e.altKey)
            {
                e.preventDefault();
                e.stopPropagation();

                let { mediaInfo } = this.getMediaInfo.info;
                let localPath = mediaInfo?.localPath;
                console.log("f", localPath);
                navigator.clipboard.writeText(localPath);
                ppixiv.message.show("Path copied to clipboard");
                return;
            }
        });
    }

    refreshInternal({ mediaId, mediaInfo })
    {
        let path = mediaInfo?.localPath;
        this.enabled = mediaInfo?.localPath != null;
        helpers.html.setClass(this.root, "enabled", this.enabled);
        if(path == null)
            return;

        path = path.replace(/\\/g, "/");

        // We have to work around some extreme jankiness in the URL API.  If we create our
        // URL directly and then try to fill in the pathname, it won't let us change it.  We
        // have to create a file URL, fill in the pathname, then replace the scheme after
        // converting to a string.  Web!
        let url = new URL("vview://view-in-explorer");
        url.search = path;
        url = url.toString();

        let a = this.root;
        a.href = url;
        console.log(url.toString());

        // Set the popup for the type of ID.
        let { type } = helpers.mediaId.parse(mediaId);
        let popup = type == "file"? "View file in Explorer":"View folder in Explorer";
        a.dataset.popup = popup;
    }
}
