import Widget from 'vview/widgets/widget.js';
import { IllustWidget } from 'vview/widgets/illust-widgets.js';
import { DropdownBoxOpener } from 'vview/widgets/dropdown.js';
import { helpers } from 'vview/misc/helpers.js';
import LocalAPI from 'vview/misc/local-api.js';

// local_search_box_widget and LocalSearchDropdownWidget are dumb copy-pastes
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
                            ${ helpers.create_icon("clear") }
                        </span>

                        <span class="submit-local-search-button right-side-button">
                            ${ helpers.create_icon("search") }
                        </span>
                    </div>
                </div>
            `
        });

        this.inputElement = this.container.querySelector(".input-field-container > input");

        this.dropdownOpener = new DropdownBoxOpener({
            button: this.inputElement,

            create_box: ({...options}) => {
                return new LocalSearchDropdownWidget({
                    input_element: this.container,
                    focus_parent: this.container,
                    ...options,
                });
            },

            close_for_click: (e) => {
                // Ignore clicks inside our container.
                if(helpers.is_above(this.container, e.target))
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
        this.clearSearchButton = this.container.querySelector(".clear-local-search-button");
        this.clearSearchButton.addEventListener("click", (e) => {
            this.inputElement.value = "";
            this.inputElement.dispatchEvent(new Event("submit"));
        });
        this.container.querySelector(".submit-local-search-button").addEventListener("click", (e) => {
            this.inputElement.dispatchEvent(new Event("submit"));
        });

        this.inputElement.addEventListener("input", (e) => {
            this.refreshClearButtonVisibility();
        });

        // Search submission:
        helpers.input_handler(this.inputElement, this.submitSearch);

        window.addEventListener("pp:popstate", (e) => { this.refreshFromLocation(); });
        this.refreshFromLocation();
        this.refreshClearButtonVisibility();
    }

    // Hide if our tree becomes hidden.
    on_visible_recursively_changed()
    {
        super.on_visible_recursively_changed();

        if(!this.visible_recursively)
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
        LocalAPI.navigate_to_tag_search(tags);

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
    constructor({input_element, focus_parent, ...options})
    {
        super({...options, template: `
            <div class="search-history input-dropdown">
                <div class="input-dropdown-contents input-dropdown-list">
                    <!-- template-tag-dropdown-entry instances will be added here. -->
                </div>
            </div>
        `});

        this.inputElement = input_element;

        // While we're open, we'll close if the user clicks outside focus_parent.
        this.focus_parent = focus_parent;

        // Refresh the dropdown when the search history changes.
        window.addEventListener("recent-local-searches-changed", this.populate_dropdown);

        this.container.addEventListener("click", this.dropdownClick);

        // input-dropdown is resizable.  Save the size when the user drags it.
        this.input_dropdown = this.container.querySelector(".input-dropdown-list");

        // Restore input-dropdown's width.
        let refresh_dropdown_width = () => {
            let width = ppixiv.settings.get("tag-dropdown-width", "400");
            width = parseInt(width);
            if(isNaN(width))
                width = 400;
            this.container.style.setProperty('--width', `${width}px`);
        };

        let observer = new MutationObserver((mutations) => {
            // resize sets the width.  Use this instead of offsetWidth, since offsetWidth sometimes reads
            // as 0 here.
            ppixiv.settings.set("tag-dropdown-width", this.input_dropdown.style.width);
        });
        observer.observe(this.input_dropdown, { attributes: true });

        // Restore input-dropdown's width.
        refresh_dropdown_width();

        // Sometimes the popup closes when searches are clicked and sometimes they're not.  Make sure
        // we always close on navigation.
        this.container.addEventListener("click", (e) => {
            if(e.defaultPrevented)
                return;
            let a = e.target.closest("A");
            if(a == null)
                return;

            this.inputElement.blur();
            this.hide();
        });

        this._load();
    }

    dropdownClick = (e) =>
    {
        var remove_entry = e.target.closest(".remove-history-entry");
        if(remove_entry != null)
        {
            // Clicked X to remove a tag from history.
            e.stopPropagation();
            e.preventDefault();

            let tag = e.target.closest(".entry").dataset.tag;
            remove_recent_local_search(tag);
            return;
        }

        // Close the dropdown if the user clicks a tag (but not when clicking
        // remove-history-entry).
        if(e.target.closest(".tag"))
            this.hide();
    }

    _load()
    {
        // Fill in the dropdown before displaying it.
        this.populate_dropdown();
    }

    createEntry(search)
    {
        let entry = this.create_template({name: "tag-dropdown-entry", html: `
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
        args.hash_path = "/";
        args.hash.set("search", search);
        entry.href = args.url;
        return entry;
    }

    // Populate the tag dropdown.
    populate_dropdown = () =>
    {
        let tag_searches = ppixiv.settings.get("local_searches") || [];
        tag_searches.sort();

        let list = this.container.querySelector(".input-dropdown-list");
        helpers.remove_elements(list);

        for(let tag of tag_searches)
        {
            var entry = this.createEntry(tag);
            entry.classList.add("history");
            list.appendChild(entry);
        }
    }
}

// A button to show an image in Explorer.
//
// This requires view_in_explorer.pyw be set up.
export class ViewInExplorerWidget extends IllustWidget
{
    constructor({...options})
    {
        super({...options});

        this.enabled = false;

        // Ignore clicks on the button if it's disabled.
        this.container.addEventListener("click", (e) => {
            if(this.enabled)
                return;

            e.preventDefault();
            e.stopPropagation();
        });
    }

    refresh_internal({ media_id, media_info })
    {
        // Hide the button if we're not on a local image.
        this.container.closest(".button-container").hidden = !helpers.is_media_id_local(media_id);
        
        let path = media_info?.localPath;
        this.enabled = media_info?.localPath != null;
        helpers.set_class(this.container.querySelector("A.button"), "enabled", this.enabled);
        if(path == null)
            return;

        path = path.replace(/\\/g, "/");

        // We have to work around some extreme jankiness in the URL API.  If we create our
        // URL directly and then try to fill in the pathname, it won't let us change it.  We
        // have to create a file URL, fill in the pathname, then replace the scheme after
        // converting to a string.  Web!
        let url = new URL("file:///");
        url.pathname = path;
        url = url.toString();
        url = url.replace("file:", "vviewinexplorer:")

        let a = this.container.querySelector("A.local-link");
        a.href = url;

        // Set the popup for the type of ID.
        let { type } = helpers.parse_media_id(media_id);
        let popup = type == "file"? "View file in Explorer":"View folder in Explorer";
        a.dataset.popup = popup;
    }
}
