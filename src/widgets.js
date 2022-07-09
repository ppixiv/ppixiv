"use strict";

// A basic widget base class.
ppixiv.widget = class
{
    constructor({
        container,
        template=null,
        contents=null,
        parent=null,
        visible=true,
        shutdown_signal=null,
        ...options}={})
    {
        this.options = options;
        this.templates = {};

        // If our parent is passing us a shared shutdown signal, use it.  Otherwise, create
        // our own.
        this.shutdown_signal = shutdown_signal || new AbortController();

        // We must have either a template or contents.
        if(template)
        {
            console.assert(contents == null);
            this.container = this.create_template({html: template});
            if(container != null)
                container.appendChild(this.container);
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

        this.parent = parent;

        // If we're visible, we'll unhide below.
        this.have_set_initial_visibility = false;

        // Let the caller finish, then refresh.
        helpers.yield(() => {
            this.refresh();

            // If we're initially visible, set ourselves visible now.  Skip this if something
            // else modifies visible first.
            if(visible && !this.have_set_initial_visibility)
            {
                this.have_set_initial_visibility = true;
                this.visible = true;
            }
        });
    }

    // Create an element from template HTML.  If name isn't null, the HTML will be cached
    // using name as a key.
    create_template({name=null, html, make_svg_unique=true})
    {
        let template = name? this.templates[name]:null;
        if(!template)
        {
            template = document.createElement("template");
            template.innerHTML = html;
            helpers.replace_inlines(template.content);
            
            this.templates[name] = template;
        }

        return helpers.create_from_template(template, { make_svg_unique });
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
        this.have_set_initial_visibility = true;

        if(value == this.visible)
            return;

        this._visible = value;
        this.refresh_visibility();

        this.visibility_changed();
    }

    shutdown()
    {
        // Signal shutdown_signal to remove event listeners.
        console.assert(this.shutdown_signal != null);
        this.shutdown_signal.abort();
        this.shutdown_signal = null;

        this.container.remove();
    }

    // Show or hide the widget.
    //
    // By default the widget is visible based on the value of this.visible, but the
    // subclass can override this.
    refresh_visibility()
    {
        helpers.set_class(this.container, "visible-widget", this._visible);
    }

    // The subclass can override this.
    visibility_changed()
    {
        if(this.visible)
        {
            console.assert(this.visibility_abort == null);

            // Create an AbortController that will be aborted when the widget is hidden.
            this.visibility_abort = new AbortController;
        } else {
            if(this.visibility_abort)
                this.visibility_abort.abort();

            this.visibility_abort = null;
        }
    }
}

ppixiv.dialog_widget = class extends ppixiv.widget
{
    constructor({
        classes=null,
        container=null,
        // "normal" is used for larger dialogs, like settings.
        // "small" is used for smaller popups like text entry.
        dialog_type="normal",

        // Most dialogs have a close button and allow the user to navigate away.  To
        // disable this and control visibility directly, set this to false.
        allow_close=true,

        // Most dialogs that can be closed have a close button in the corner.  If this is
        // false we'll hide that button, but you can still exit by clicking the background.
        // This is used for very simple dialogs.
        show_close_button=true,

        // Most dialogs are created when they're needed, and removed and discarded when the
        // user exits.  To disable this and allow a dialog to be reused, set this to false.
        remove_on_exit=true,

        template,
        ...options
    })
    {
        // Most dialogs are added to the body element.
        if(container == null)
            container = document.body;
        
        console.assert(dialog_type == "normal" || dialog_type == "small");

        super({
            container,
            template: `
                <div class="dialog">
                    <div class="content ${classes ?? ""}" data-dialog-type="${dialog_type}">
                        ${ template }

                        <div class="close-button icon-button">
                            ${ helpers.create_icon("close") }
                        </div>
                    </div>
                </div>
            `,
            ...options,
        });

        this.allow_close = allow_close;
        this.remove_on_exit = remove_on_exit;
        this.container.querySelector(".close-button").hidden = !allow_close || !show_close_button;

        if(this.allow_close)
        {
            // Close if the container is clicked, but not if something inside the container is clicked.
            this.container.addEventListener("click", (e) => {
                if(e.target != this.container)
                    return;

                this.visible = false;
            });

            let close_button = this.container.querySelector(".close-button");
            if(close_button)
                close_button.addEventListener("click", (e) => { this.visible = false;; });
        }
    }

    visibility_changed()
    {
        super.visibility_changed();

        // This disables global key handling and hotkeys.
        if(this.visible)
            document.body.dataset.popupOpen = "1";
        else
            delete document.body.dataset.popupOpen;

        // Register ourself as an important visible widget, so the slideshow won't move on
        // while we're open.
        ppixiv.OpenWidgets.singleton.set(this, this.visible);

        if(this.allow_close)
        {
            if(this.visible)
            {
                // Hide if the top-level screen changes, so we close if the user exits the screen with browser
                // navigation but not if the viewed image is changing from something like the slideshow.
                window.addEventListener("screenchanged", (e) => {
                    this.visible = false;
                }, { signal: this.visibility_abort.signal });

                // Hide on any state change.
                window.addEventListener("popstate", (e) => {
                    this.visible = false;
                }, { signal: this.visibility_abort.signal });
            }
        }

        // Remove the widget when it's hidden.
        if(!this.visible && this.remove_on_exit)
            this.container.remove();
    }
}

// A widget that shows info for a particular media_id.
//
// A media_id can be set, and we'll refresh when it changes.
ppixiv.illust_widget = class extends ppixiv.widget
{
    constructor(options)
    {
        super(options);

        // Refresh when the image data changes.
        ppixiv.media_cache.addEventListener("mediamodified", this.refresh.bind(this), { signal: this.shutdown_signal.signal });
    }

    // The data this widget needs.  This can be media_id (nothing but the ID), full or partial.
    //
    // This can change dynamically.  Some widgets need illust_info only when viewing a manga
    // page.
    get needed_data() { return "full"; }

    set_media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;

        let [illust_id, page] = helpers.media_id_to_illust_id_and_page(media_id);
        this._page = page;
        this.refresh();
    }
    
    get media_id() { return this._media_id; }

    async refresh()
    {
        // Grab the illust info.
        let media_id = this._media_id;
        let info = { media_id: this._media_id };
        
        // If we have a media ID and we want media info (not just the media ID itself), load
        // the info.
        if(this._media_id != null && this.needed_data != "media_id")
        {
            let full = this.needed_data == "full";

            // See if we have the data the widget wants already.
            info.media_info = ppixiv.media_cache.get_media_info_sync(this._media_id, { full });

            // If we need to load data, clear the widget while we load, so we don't show the old
            // data while we wait for data.  Skip this if we don't need to load, so we don't clear
            // and reset the widget.  This can give the widget an illust ID without data, which is
            // OK.
            if(info.media_info == null)
                await this.refresh_internal(info);

            info.media_info = await ppixiv.media_cache.get_media_info(this._media_id, { full });
        }

        // Stop if the media ID changed while we were async.
        if(this._media_id != media_id)
            return;

        await this.refresh_internal(info);
    }

    async refresh_internal({ media_id, media_info })
    {
        throw "Not implemented";
    }
}

// Display messages in the popup widget.  This is a singleton.
ppixiv.message_widget = class extends widget
{
    static get singleton()
    {
        if(message_widget._singleton == null)
            message_widget._singleton = new message_widget({container: document.body});
        return message_widget._singleton;
    }
    
    constructor(options)
    {
        super({...options, template: `
            <div class=hover-message>
                <div class=message></div>
            </div>`,
        });

        this.timer = null;
    }

    show(message)
    {
        console.assert(message != null);

        this.clear_timer();

        this.container.querySelector(".message").innerHTML = message;

        this.container.classList.add("show");
        this.container.classList.remove("centered");
        this.timer = setTimeout(() => {
            this.container.classList.remove("show");
        }, 3000);
    }

    clear_timer()
    {
        if(this.timer != null)
        {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    hide()
    {
        this.clear_timer();
        this.container.classList.remove("show");
    }
}

// Call a callback on any click not inside a list of nodes.
//
// This is used to close dropdown menus.
ppixiv.click_outside_listener = class
{
    constructor(node_list, callback)
    {
        this.node_list = node_list;
        this.callback = callback;

        window.addEventListener("pointerdown", this.window_onpointerdown, { capture: true });
    }

    // Return true if node is below any node in node_list.
    is_node_in_list(node)
    {
        for(let ancestor of this.node_list)
        {
            if(helpers.is_above(ancestor, node))
                return true;
        }
        return false;
    }

    window_onpointerdown = (e) =>
    {
        // Close the popup if anything outside the dropdown is clicked.  Don't
        // prevent the click event, so the click still happens.
        //
        // If this is a click inside the box or our button, ignore it.
        if(this.is_node_in_list(e.target))
            return;

        this.callback(e.target);
    }

    shutdown()
    {
        window.removeEventListener("pointerdown", this.window_onpointerdown, { capture: true });
    }
}

// Show popup menus when a button is clicked.
ppixiv.dropdown_menu_opener = class
{
    static create_handlers(container)
    {
        for(let button of container.querySelectorAll(".popup-menu-box-button"))
            dropdown_menu_opener.create_handler(button);
    }

    // A shortcut for creating an opener for our common button/popup layout.
    static create_handler(button)
    {
        let box = button.nextElementSibling;
        if(box == null || !box.classList.contains("popup-menu-box"))
        {
            console.error("Couldn't find menu box for", button);
            return;
        }
        new dropdown_menu_opener(button, box);
    }

    // When button is clicked, show box.
    constructor(button, box)
    {
        this.button = button;
        this.box = box;

        // Store references between the two parts.
        this.button.dropdownMenuBox = box;
        this.box.dropdownMenuButton = button;

        this.visible = false;

        this.button.addEventListener("click", (e) => { this.button_onclick(e); });

        // We manually position the dropdown, so we need to reposition them if
        // the window size changes.
        window.addEventListener("resize", (e) => { this.align_to_button(); });

        // Hide popups when any containing view is hidden.
        new view_hidden_listener(this.button, (e) => {
            this.visible = false;
        });
    }

    // The viewhidden event is sent when the enclosing view is no longer visible, and
    // all menus in it should be hidden.
    onviewhidden(e)
    {
        this.visible = false;
    }

    get visible()
    {
        return !this.box.hidden;
    }

    set visible(value)
    {
        if(this.box.hidden == !value)
            return;

        this.box.hidden = !value;
        helpers.set_class(this.box, "popup-visible", value);

        if(value)
        {
            this.align_to_button();

            this.listener = new click_outside_listener([this.button, this.box], () => {
                this.visible = false;
            });

            if(this.close_on_click_inside)
                this.box.addEventListener("click", this.box_onclick);
        }
        else
        {
            if(this.listener)
            {
                this.listener.shutdown();
                this.listener = null;
            }

            this.box.removeEventListener("click", this.box_onclick);
        }

        // If we're inside a .top-ui-box container (the UI that sits at the top of the screen), set
        // .force-open on that element while we're open.
        let top_ui_box = this.box.closest(".top-ui-box");
        if(top_ui_box)
            helpers.set_class(top_ui_box, "force-open", value);
    }

    align_to_button()
    {
        if(!this.visible)
            return;

        // Use getBoundingClientRect to figure out the position, since it works
        // correctly with CSS transforms.  Figure out how far off we are and move
        // by that amount.  This works regardless of what our relative position is.
        let {left: box_x, top: box_y} = this.box.getBoundingClientRect(document.body);
        let {left: button_x, top: button_y, height: box_height} = this.button.getBoundingClientRect(document.body);

        // Align to the bottom of the button.
        button_y += box_height;

        let move_right_by = button_x - box_x;
        let move_down_by = button_y - box_y;
        let x = this.box.offsetLeft + move_right_by;
        let y = this.box.offsetTop + move_down_by;

        this.box.style.left = `${x}px`;
        this.box.style.top = `${y}px`;

        helpers.set_max_height(this.box, { bottom_padding: 10 });
    }

    // Return true if this popup should close when clicking inside it.  If false,
    // the menu will stay open until something else closes it.
    get close_on_click_inside()
    {
        return true;
    }

    // Close the popup when something inside is clicked.  This can be prevented with
    // stopPropagation, or with the keep-menu-open class.
    box_onclick = (e) =>
    {
        if(e.target.closest(".keep-menu-open"))
            return;

        this.visible = false;
    }

    // Toggle the popup when the button is clicked.
    button_onclick(e)
    {
        e.preventDefault();
        e.stopPropagation();
        this.visible = !this.visible;
    }
};

ppixiv.checkbox_widget = class extends ppixiv.widget
{
    constructor({
        value=false,
        ...options})
    {
        super({...options, template: `
            ${ helpers.create_icon("", { classes: ["checkbox"] }) }
        `});

        this._checked = true;
    };

    set checked(value)
    {
        if(this._checked == value)
            return;

        this._checked = value;
        this.refresh();
    }
    get checked() { return this._checked; }

    async refresh()
    {
        this.container.innerText = this.checked? "check_box":"check_box_outline_blank";
    }
};

// A pointless creepy eye.  Looks away from the mouse cursor when hovering over
// the unfollow button.
ppixiv.creepy_eye_widget = class
{
    constructor(eye)
    {
        this.eye = eye;

        this.eye.addEventListener("mouseenter", this.onevent);
        this.eye.addEventListener("mouseleave", this.onevent);
        this.eye.addEventListener("mousemove", this.onevent);
        this.eye_middle = this.eye.querySelector(".middle");
    }

    onevent = (e) =>
    {
        if(e.type == "mouseenter")
            this.hover = true;
        if(e.type == "mouseleave")
            this.hover = false;

        if(!this.hover)
        {
            this.eye_middle.style.transform = "";
            return;
        }
        var mouse = [e.clientX, e.clientY];

        var bounds = this.eye.getBoundingClientRect();
        var eye = [bounds.x + bounds.width/2, bounds.y + bounds.height/2];

        var vector_length = function(vec)
        {
            return Math.sqrt(vec[0]*vec[0] + vec[1]*vec[1]);
        }
        // Normalize to get a direction vector.
        var normalize_vector = function(vec)
        {
            var length = vector_length(vec);
            if(length < 0.0001)
                return [0,0];
            return [vec[0]/length, vec[1]/length];
        };

        var pos = [mouse[0] - eye[0], mouse[1] - eye[1]];
        pos = normalize_vector(pos);

        if(Math.abs(pos[0]) < 0.5)
        {
            var negative = pos[0] < 0;
            pos[0] = 0.5;
            if(negative)
                pos[0] *= -1;
        }
//        pos[0] = 1 - ((1-pos[0]) * (1-pos[0]));
        pos[0] *= -3;
        pos[1] *= -6;
        this.eye_middle.style.transform = "translate(" + pos[0] + "px, " + pos[1] + "px)";
    }
}

ppixiv.avatar_widget = class extends widget
{
    // options:
    // parent: node to add ourself to (required)
    // changed_callback: called when a follow or unfollow completes
    // big: if true, show the big avatar instead of the small one
    constructor(options)
    {
        super({...options, template: `
            <div class=avatar-widget-follow-container>
                <a href=# class=avatar-link style="position: relative;">
                    <canvas class=avatar></canvas>

                    <div class=follow-icon>
                        <ppixiv-inline src="resources/eye-icon.svg"></ppixiv-inline>
                    </div>
                </a>

                <div class=follow-box></div>
            </div>
        `});

        this.options = options;
        if(this.options.mode != "dropdown" && this.options.mode != "overlay")
            throw "Invalid avatar widget mode";

        helpers.set_class(this.container, "big", this.options.big);

        user_cache.singleton().user_modified_callbacks.register(this.user_changed);

        let element_author_avatar = this.container.querySelector(".avatar");
        let avatar_link = this.container.querySelector(".avatar-link");

        let box = this.container.querySelector(".follow-box");
        this.follow_widget = new ppixiv.follow_widget({
            container: box,
            parent: this,
            open_button: avatar_link,
        });

        avatar_link.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.follow_widget.visible = !this.follow_widget.visible;
        }, {
            // Hack: capture this event so we get clicks even over the eye widget.  We can't
            // set it to pointer-events: none since it reacts to mouse movement.
            capture: true,
        });

        // Clicking the avatar used to go to the user page, but now it opens the follow dropdown.
        // Allow doubleclicking it instead, to keep it quick to go to the user.
        avatar_link.addEventListener("dblclick", (e) => {
            e.preventDefault();
            e.stopPropagation();

            let args = new helpers.args(`/users/${this.user_id}/artworks#ppixiv`);
            helpers.set_page_url(args, true /* add_to_history */, "navigation");
        });

        // A canvas filter for the avatar.  This has no actual filters.  This is just to kill off any
        // annoying GIF animations in people's avatars.
        this.img = document.createElement("img");
        this.base_filter = new image_canvas_filter(this.img, element_author_avatar);
        
        this.container.dataset.mode = this.options.mode;

        // Show the favorite UI when hovering over the avatar icon.
        let avatar_popup = this.container; //container.querySelector(".avatar-popup");
        if(this.options.mode == "dropdown")
        {
            avatar_popup.addEventListener("mouseover", (e) => { helpers.set_class(avatar_popup, "popup-visible", true); });
            avatar_popup.addEventListener("mouseout", (e) => { helpers.set_class(avatar_popup, "popup-visible", false); });
        }

        new creepy_eye_widget(this.container.querySelector(".follow-icon .eye-image"));
    }

    shutdown()
    {
        user_cache.singleton().user_modified_callbacks.unregister(this.user_changed);
    }

    visibility_changed()
    {
        super.visibility_changed();

        this.refresh();
    }

    // Refresh when the user changes.
    user_changed = (user_id) =>
    {
        if(this.user_id == null || this.user_id != user_id)
            return;

        this.set_user_id(this.user_id);
    }

    async set_user_id(user_id)
    {
        this.user_id = user_id;
        this.follow_widget.user_id = user_id;
        this.refresh();
    }

    async refresh()
    {
        if(this.user_id == null || this.user_id == -1)
        {
            this.user_data = null;
            this.container.classList.add("loading");

            // Set the avatar image to a blank image, so it doesn't flash the previous image
            // the next time we display it.  It should never do this, since we set a new image
            // before displaying it, but Chrome doesn't do this correctly at least with canvas.
            this.img.src = helpers.blank_image;
            return;
        }

        // If we've seen this user's profile image URL from thumbnail data, start loading it
        // now.  Otherwise, we'll have to wait until user info finishes loading.
        let cached_profile_url = ppixiv.media_cache.user_profile_urls[this.user_id];
        if(cached_profile_url)
            this.img.src = cached_profile_url;

        // Set up stuff that we don't need user info for.
        this.container.querySelector(".avatar-link").href = `/users/${this.user_id}/artworks#ppixiv`;

        // Hide the popup in dropdown mode, since it covers the dropdown.
        if(this.options.mode == "dropdown")
            this.container.querySelector(".avatar").classList.remove("popup");

        // Clear stuff we need user info for, so we don't show old data while loading.
        helpers.set_class(this.container, "followed", false);
        this.container.querySelector(".avatar").dataset.popup = "";

        this.container.classList.remove("loading");
        this.container.querySelector(".follow-icon").hidden = true;

        let user_data = await user_cache.singleton().get_user_info(this.user_id);
        this.user_data = user_data;
        if(user_data == null)
            return;

        this.container.querySelector(".follow-icon").hidden = !this.user_data.isFollowed;
        this.container.querySelector(".avatar").dataset.popup = this.user_data.name;

        // If we don't have an image because we're loaded from a source that doesn't give us them,
        // just hide the avatar image.
        let key = "imageBig";
        if(this.user_data[key])
            this.img.src = this.user_data[key];
        else
            this.img.src = helpers.blank_image;
    }
};

ppixiv.follow_widget = class extends widget
{
    constructor({
        // The button used to open this widget.  We close on clicks outside of our box, but
        // we won't close if this button is clicked, so toggling the widget works properly.
        open_button=null,

        ...options
    })
    {
        super({
            visible: false,

            ...options, template: `
            <div class="follow-container" style="
                background-color: #000;
            ">
                ${helpers.create_box_link({
                    label: "View posts",
                    icon: "image",
                    classes: ["view-posts"],
                })}

                <!-- Buttons for following and unfollowing: -->
                ${helpers.create_box_link({
                    label: "Follow",
                    icon: "public",
                    classes: ["follow-button-public"],
                })}

                ${helpers.create_box_link({
                    label: "Follow privately",
                    icon: "lock",
                    classes: ["follow-button-private"],
                })}

                ${helpers.create_box_link({
                    label: "Unfollow",
                    icon: "delete",
                    classes: ["unfollow-button"],
                })}

                <!-- Buttons for toggling a follow between public and private.  This is separate
                     from the buttons above, since it comes after to make sure that the unfollow
                     button is above the toggle buttons. -->
                ${helpers.create_box_link({
                    label: "Change to public",
                    icon: "public",
                    classes: ["toggle-follow-button-public"],
                })}

                ${helpers.create_box_link({
                    label: "Change to private",
                    icon: "lock",
                    classes: ["toggle-follow-button-private"],
                })}

                <!-- A separator before follow tags.  Hide this if the user doesn't have premium,
                     since he won't have access to tags and this will be empty. -->
                <div class="separator premium-only"><div></div></div>

                ${helpers.create_box_link({
                    label: "Add new tag",
                    icon: "add_circle",
                    classes: ["premium-only", "add-follow-tag"],
                })}
            </div>
        `});

        this.open_button = open_button;
        this._user_id = null;

        this.container.querySelector(".follow-button-public").addEventListener("click", (e) => { this.clicked_follow(false); });
        this.container.querySelector(".follow-button-private").addEventListener("click", (e) => { this.clicked_follow(true); });
        this.container.querySelector(".toggle-follow-button-public").addEventListener("click", (e) => { this.clicked_follow(false); });
        this.container.querySelector(".toggle-follow-button-private").addEventListener("click", (e) => { this.clicked_follow(true); });
        this.container.querySelector(".unfollow-button").addEventListener("click", (e) => { this.clicked_unfollow(); });

        this.container.querySelector(".add-follow-tag").addEventListener("click", (e) => {
            this.add_follow_tag();
        });

        // Refresh if the user we're displaying changes.
        user_cache.singleton().user_modified_callbacks.register(this.user_changed);

        // Close if our container closes.
        new view_hidden_listener(this.container, (e) => {
            this.visible = false;
        });
    }

    user_changed = (user_id) =>
    {
        if(!this.visible || user_id != this.user_id)
            return;

        this.refresh();
    };

    set user_id(value)
    {
        if(this._user_id == value)
            return;

        this._user_id = value;
        if(value == null)
            this.visible = false;
    }
    get user_id() { return this._user_id; }

    visibility_changed()
    {
        super.visibility_changed();

        if(this.visible)
        {
            this.refresh();

            // Close on clicks outside of our menu.  Include our parent's button which opens
            // us, so we don't close when it's going to toggle us.
            this.click_outside_listener = new click_outside_listener([this.container, this.open_button], () => {
                this.visible = false;
            });
        }
        else
        {
            if(this.click_outside_listener)
            {
                this.click_outside_listener.shutdown();
                this.click_outside_listener = null;
            }
        }
    }

    async refresh()
    {
        if(!this.visible)
            return;

        // Fit the tag scroll box within however much space we have available.
        helpers.set_max_height(this.container, { max_height: 400, bottom_padding: 10 });

        if(this.refreshing)
        {
            console.error("Already refreshing");
            return;
        }

        this.refreshing = true;
        try {
            if(this._user_id == null)
            {
                console.log("Follow widget has no user ID");
                return;
            }
            
            // Refresh with no data.
            this.refresh_with_data();

            // Refresh with whether we're followed or not, so the follow/unfollow UI is
            // displayed as early as possible.
            let user_info = await user_cache.singleton().get_user_info(this.user_id);
            if(!this.visible)
                return;

            this.refresh_with_data({ user_info, following: user_info.isFollowed });
            
            if(!user_info.isFollowed)
            {
                // We're not following, so just load the follow tag list.
                let all_tags = await user_cache.singleton().load_all_user_follow_tags();
                this.refresh_with_data({ user_info, following: user_info.isFollowed, all_tags, selected_tags: new Set() });
                return;
            }

            // Get full follow info to find out if the follow is public or private, and which
            // tags are selected.
            let follow_info = await user_cache.singleton().get_user_follow_info(this.user_id);
            let all_tags = await user_cache.singleton().load_all_user_follow_tags();
            this.refresh_with_data({user_info, following: true, following_privately: follow_info?.following_privately, all_tags, selected_tags: follow_info?.tags});
        } finally {
            this.refreshing = false;
        }
    }

    // Refresh the UI with as much data as we have.  This data comes in a bunch of little pieces,
    // so we get it incrementally.
    refresh_with_data({user_info=null, following=null, following_privately=null, all_tags=null, selected_tags=null}={})
    {
        if(!this.visible)
            return;

        this.container.querySelector(".follow-button-public").hidden = true;
        this.container.querySelector(".follow-button-private").hidden = true;
        this.container.querySelector(".toggle-follow-button-public").hidden = true;
        this.container.querySelector(".toggle-follow-button-private").hidden = true;
        this.container.querySelector(".unfollow-button").hidden = true;
        this.container.querySelector(".add-follow-tag").hidden = true;
        this.container.querySelector(".separator").hidden = true;
        
        let view_text = user_info != null? `View ${user_info.name}'s posts`:`View posts`;
        this.container.querySelector(".view-posts .label").innerText = view_text;
        this.container.querySelector(".view-posts").href = `/users/${this._user_id}/artworks#ppixiv`;

        // If following is null, we're still waiting for the initial user data request
        // and we don't have any data yet.  
        if(following == null)
            return;

        if(following)
        {
            // If we know whether we're following privately or publically, we can show the
            // button to change the follow mode.  If we don't have that yet, we can only show
            // unfollow.
            if(following_privately != null)
            {
                this.container.querySelector(".toggle-follow-button-public").hidden = !following_privately;
                this.container.querySelector(".toggle-follow-button-private").hidden = following_privately;
            }

            this.container.querySelector(".unfollow-button").hidden = false;
        }
        else
        {
            this.container.querySelector(".follow-button-public").hidden = false;
            this.container.querySelector(".follow-button-private").hidden = false;
        }

        // If we've loaded follow tags, fill in the list.
        let follow_tags = this.container.querySelectorAll(".follow-tag");
        for(let element of follow_tags)
            element.remove();

        if(all_tags != null)
        {
            // Show the separator and "add tag" button once we have the tag list.
            this.container.querySelector(".add-follow-tag").hidden = false;
            this.container.querySelector(".separator").hidden = false;

            all_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
            for(let tag of all_tags)
            {
                let button = helpers.create_box_link({
                    label: tag,
                    classes: ["follow-tag"],
                    icon: "bookmark",
                    as_element: true,
                });
    
                // True if the user is bookmarked with this tag.
                let selected = selected_tags.has(tag);
                helpers.set_class(button, "selected", selected);

                this.container.appendChild(button);

                button.addEventListener("click", (e) => {
                    this.toggle_follow_tag(tag);
                });
            }
        }
    }

    async clicked_follow(follow_privately)
    {
        await actions.follow(this._user_id, follow_privately);
    }

    async clicked_unfollow()
    {
        await actions.unfollow(this._user_id);
    }

    async add_follow_tag()
    {
        let prompt = new text_prompt({ title: "New folder:" });
        let folder = await prompt.result;
        if(folder == null)
            return; // cancelled

        await this.toggle_follow_tag(folder);
    }

    async toggle_follow_tag(tag)
    {
        // Make a copy of user_id, in case it changes while we're async.
        let user_id = this.user_id;

        // If the user isn't followed, the first tag is added by following.
        let user_data = await user_cache.singleton().get_user_info(user_id);
        if(!user_data.isFollowed)
        {
            // We're not following, so follow the user with default privacy and the
            // selected tag.
            await actions.follow(user_id, null, { tag });
            return;
        }

        // We're already following, so update the existing tags.
        let follow_info = await user_cache.singleton().get_user_follow_info(user_id);
        if(follow_info == null)
        {
            console.log("Error retrieving follow info to update tags");
            return;
        }

        let tag_was_selected = follow_info.tags.has(tag);
        actions.change_follow_tags(user_id, {tag: tag, add: !tag_was_selected});
    }
};

// A list of tags, with translations in popups where available.
ppixiv.tag_widget = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({...options});
    };

    format_tag_link(tag)
    {
        return page_manager.singleton().get_args_for_tag_search(tag, ppixiv.location);
    };

    async set(tags)
    {
        this.tags = tags;
        this.refresh();
    }

    async refresh()
    {
        if(this.tags == null)
            return;

        // Short circuit if the tag list isn't changing, since IndexedDB is really slow.
        if(this.last_tags != null && JSON.stringify(this.last_tags) == JSON.stringify(this.tags))
            return;

        // Look up tag translations.
        let tag_list = this.tags;
        let translated_tags = await tag_translations.get().get_translations(tag_list, "en");
        
        // Stop if the tag list changed while we were reading tag translations.
        if(tag_list != this.tags)
            return;

        this.last_tags = this.tags;

        // Remove any old tag list and create a new one.
        helpers.remove_elements(this.container);

        for(let tag of tag_list)
        {
            let translated_tag = tag;
            if(translated_tags[tag])
                translated_tag = translated_tags[tag];

            let a = helpers.create_box_link({
                label: translated_tag,
                classes: ["tag-entry"],
                link: this.format_tag_link(tag),
                as_element: true,
            });

            this.container.appendChild(a);

            a.dataset.tag = tag;
        }
    }
};

// A popup for inputting text.
//
// This is currently special purpose for the add tag prompt.
ppixiv.text_prompt = class extends ppixiv.dialog_widget
{
    constructor({
        title,
        ...options
    }={})
    {
        super({...options, classes: "text-entry-popup", dialog_type: "small", template: `
            <div class=header></div>
            <div class=input-box>
                <input>
                <span class=submit-button>+</span>
            </div>
        `});
        
        this.result = new Promise((completed, cancelled) => {
            this._completed = completed;
        });

        this.input = this.container.querySelector("input");
        this.input.value = "";

        this.container.querySelector(".header").innerText = title;
        this.container.querySelector(".submit-button").addEventListener("click", this.submit);
    }

    onkeydown = (e) =>
    {
        if(e.key == "Escape")
        {
            e.preventDefault();
            e.stopPropagation();
            this.visible = false;
        }

        if(e.key == "Enter")
        {
            e.preventDefault();
            e.stopPropagation();
            this.submit();
        }
    }

    visibility_changed()
    {
        super.visibility_changed();

        if(this.visible)
        {
            window.addEventListener("keydown", this.onkeydown, { signal: this.visibility_abort.signal });

            // Focus when we become visible.
            this.input.focus();
        }
        else
        {
            // If we didn't complete by now, cancel.
            this._completed(null);
        }
    }

    // Close the popup and call the completion callback with the result.
    submit = () =>
    {
        let result = this.input.value;
        this._completed(result);

        this.visible = false;
    }
}

// Widget for editing bookmark tags.
ppixiv.bookmark_tag_list_widget = class extends ppixiv.illust_widget
{
    get needed_data() { return "media_id"; }

    constructor({...options})
    {
        super({...options, template: `
            <div class="bookmark-tag-list">
                <div class=tag-list>
                    <div class=tag-list-buttons>
                        <div class=add-tag>
                            <div class=icon-button>
                                ${ helpers.create_icon("add") }
                            </div>
                        </div>

                        <div class=sync-tags>
                            <div class=icon-button>
                                ${ helpers.create_icon("refresh") }
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `});

        this.displaying_media_id = null;

        this.container.addEventListener("click", this.clicked_bookmark_tag, true);

        this.container.querySelector(".add-tag").addEventListener("click", async (e) => {
            await actions.add_new_tag(this._media_id);
        });

        this.container.querySelector(".sync-tags").addEventListener("click", async (e) => {
            var bookmark_tags = await actions.load_recent_bookmark_tags();
            helpers.set_recent_bookmark_tags(bookmark_tags);
        });

        ppixiv.media_cache.illust_modified_callbacks.register(this.refresh.bind(this));
        settings.register_change_callback("recent-bookmark-tags", this.refresh.bind(this));
    }

    // Return an array of tags selected in the tag dropdown.
    get selected_tags()
    {
        var tag_list = [];
        var bookmark_tags = this.container;
        for(var entry of bookmark_tags.querySelectorAll(".popup-bookmark-tag-entry"))
        {
            if(!entry.classList.contains("selected"))
                continue;
            tag_list.push(entry.dataset.tag);
        }
        return tag_list;
    }

    // Override setting media_id to save tags when we're closed.  Otherwise, media_id will already
    // be cleared when we close and we won't be able to save.
    set_media_id(media_id)
    {
        // If we're hiding and were previously visible, save changes.
        if(media_id == null)
            this.save_current_tags();

        super.set_media_id(media_id);
    }
    
    async visibility_changed()
    {
        super.visibility_changed();

        if(this.visible)
        {
            // We only load existing bookmark tags when the tag list is open, so refresh.
            await this.refresh();
        }
        else
        {
            // Note that this.skip_save is set by our caller who isn't async, so
            // this will only be set until the first time we await.
            if(!this.skip_save)
            {
                // Save any selected tags when the dropdown is closed.
                this.save_current_tags();
            }

            // Clear the tag list when the menu closes, so it's clean on the next refresh.
            this.clear_tag_list();

            this.displaying_media_id = null;
        }
    }

    clear_tag_list()
    {
        // Make a copy of children when iterating, since it doesn't handle items being deleted
        // while iterating cleanly.
        let bookmark_tags = this.container.querySelector(".tag-list");
        for(let element of [...bookmark_tags.children])
        {
            if(element.classList.contains("tag-toggle") || element.classList.contains("loading"))
                element.remove();
        }
    }

    async refresh_internal({ media_id })
    {
        // If we're refreshing the same illust that's already refreshed, store which tags were selected
        // before we clear the list.
        let old_selected_tags = this.displaying_media_id == media_id? this.selected_tags:[];

        this.displaying_media_id = null;

        let bookmark_tags = this.container.querySelector(".tag-list");
        this.clear_tag_list();

        if(media_id == null || !this.visible)
            return;

        // Create a temporary entry to show loading while we load bookmark details.
        let entry = document.createElement("span");
        entry.classList.add("loading");
        bookmark_tags.appendChild(entry);
        entry.innerText = "Loading...";

        // If the tag list is open, populate bookmark details to get bookmark tags.
        // If the image isn't bookmarked this won't do anything.
        let active_tags = await extra_cache.singleton().load_bookmark_details(media_id);

        // Remember which illustration's bookmark tags are actually loaded.
        this.displaying_media_id = media_id;

        // Remove elements again, in case another refresh happened while we were async
        // and to remove the loading entry.
        this.clear_tag_list();
        
        // If we're refreshing the list while it's open, make sure that any tags the user
        // selected are still in the list, even if they were removed by the refresh.  Put
        // them in active_tags, so they'll be marked as active.
        for(let tag of old_selected_tags)
        {
            if(active_tags.indexOf(tag) == -1)
                active_tags.push(tag);
        }

        let shown_tags = [];

        let recent_bookmark_tags = Array.from(helpers.get_recent_bookmark_tags()); // copy
        for(let tag of recent_bookmark_tags)
            if(shown_tags.indexOf(tag) == -1)
                shown_tags.push(tag);

        // Add any tags that are on the bookmark but not in recent tags.
        for(let tag of active_tags)
            if(shown_tags.indexOf(tag) == -1)
                shown_tags.push(tag);

        shown_tags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));

        for(let tag of shown_tags)
        {
            let entry = this.create_template({name: "tag-entry", html: `
                <div class="popup-bookmark-tag-entry tag-toggle">
                    <span class=tag-name></span>
                </div>
            `});

            entry.dataset.tag = tag;
            bookmark_tags.appendChild(entry);
            entry.querySelector(".tag-name").innerText = tag;

            let active = active_tags.indexOf(tag) != -1;
            helpers.set_class(entry, "selected", active);
        }
    }

    // Save the selected bookmark tags to the current illust.
    async save_current_tags()
    {
        // Store the ID and tag list we're saving, since they can change when we await.
        let media_id = this._media_id;
        let new_tags = this.selected_tags;
        if(media_id == null)
            return;

        // Only save tags if we're refreshed to the current illust ID, to make sure we don't save
        // incorrectly if we're currently waiting for the async refresh.
        if(media_id != this.displaying_media_id)
            return;

        // Get the tags currently on the bookmark to compare.
        let old_tags = await extra_cache.singleton().load_bookmark_details(media_id);

        var equal = new_tags.length == old_tags.length;
        for(let tag of new_tags)
        {
            if(old_tags.indexOf(tag) == -1)
                equal = false;
        }
        // If the selected tags haven't changed, we're done.
        if(equal)
            return;
        
        // Save the tags.  If the image wasn't bookmarked, this will create a public bookmark.
        console.log("Tag list closing and tags have changed:", old_tags, "->", new_tags);
        await actions.bookmark_add(this._media_id, {
            tags: new_tags,
        });
    }

    // Toggle tags on click.  We don't save changes until we're closed.
    clicked_bookmark_tag = async(e) =>
    {
        let a = e.target.closest(".popup-bookmark-tag-entry");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // Toggle this tag.  Don't actually save it immediately, so if we make multiple
        // changes we don't spam requests.
        let tag = a.dataset.tag;
        helpers.set_class(a, "selected", !a.classList.contains("selected"));
    }
}

// A bookmark tag list in a dropdown.
//
// The base class is a simple widget.  This subclass handles some of the trickier
// bits around closing the dropdown correctly.
ppixiv.bookmark_tag_list_dropdown_widget = class extends ppixiv.bookmark_tag_list_widget
{
    constructor({...options})
    {
        super({...options});

        this.container.classList.add("popup-bookmark-tag-dropdown");

        // Close if our containing widget is closed.
        // XXX not if we're in the mobile menu
        new view_hidden_listener(this.container, (e) => {
            this.visible = false;
        });
    }

    async refresh_internal({ media_id })
    {
        // Make sure the dropdown is hidden if we have no image.
        if(media_id == null)
            this.visible = false;

        await super.refresh_internal({ media_id });

        // Fit the tag scroll box within however much space we have available.
        if(this.visible)
            helpers.set_max_height(this.container.querySelector(".tag-list"), { max_height: 400, bottom_padding: 10 });
    }

    // Hide the dropdown without committing anything.  This happens if a bookmark
    // button is pressed to remove a bookmark: if we just close the dropdown normally,
    // we'd readd the bookmark.
    async hide_without_sync()
    {
        this.skip_save = true;
        try {
            this.visible = false;
        } finally {
            this.skip_save = false;
        }
    }

}

ppixiv.more_options_dropdown_widget = class extends ppixiv.illust_widget
{
    get needed_data() { return "partial"; }

    constructor({
        visible=false,
        ...options
    })
    {
        super({...options,
            visible,
            template: `
                <div class="more-options-dropdown">
                    <div class="options vertical-list" style="min-width: 13em;"></div>
                </div>
        `});

        this.menu_options = [];
    }

    create_menu_options()
    {
        let option_box = this.container.querySelector(".options");
        let shared_options = {
            container: option_box,
            parent: this,
        };

        for(let item of this.menu_options)
            item.container.remove();

        let menu_options = {
            similar_illustrations: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Similar illustrations",
                    icon: "ppixiv:suggestions",
                    requires_image: true,
                    onclick: () => {
                        this.parent.hide();

                        let [illust_id] = helpers.media_id_to_illust_id_and_page(this.media_id);
                        let args = new helpers.args(`/bookmark_detail.php?illust_id=${illust_id}#ppixiv?recommendations=1`);
                        helpers.set_page_url(args, true /* add_to_history */, "navigation");
                    }
                });
            },
            similar_artists: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Similar artists",
                    icon: "ppixiv:suggestions",
                    requires_user: true,
                    onclick: () => {
                        this.parent.hide();

                        let args = new helpers.args(`/discovery/users#ppixiv?user_id=${this.user_id}`);
                        helpers.set_page_url(args, true /* add_to_history */, "navigation");
                    }
                });
            },

            similar_bookmarks: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Similar bookmarks",
                    icon: "ppixiv:suggestions",
                    requires_image: true,
                    onclick: () => {
                        this.parent.hide();

                        let [illust_id] = helpers.media_id_to_illust_id_and_page(this.media_id);
                        let args = new helpers.args(`/bookmark_detail.php?illust_id=${illust_id}#ppixiv`);
                        helpers.set_page_url(args, true /* add_to_history */, "navigation");
                    }
                });
            },

            edit_mutes: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Edit mutes",

                    // Only show this entry if we have at least a media ID or a user ID.
                    requires: ({media_id, user_id}) => { return media_id != null || user_id != null; },

                    icon: "mat:block",

                    onclick: async () => {
                        this.parent.hide();
                        new muted_tags_for_post_popup({
                            media_id: this.media_id,
                            user_id: this.user_id,
                        });
                    }
                });
            },

            refresh_image: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Refresh image",

                    requires_image: true,

                    icon: "mat:refresh",

                    onclick: async () => {
                        this.parent.hide();
                        ppixiv.media_cache.refresh_media_info(this.media_id);
                    }
                });
            },

            // XXX: hook into progress bar
            download_image: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Download image",
                    icon: "mat:download",
                    hide_if_unavailable: true,
                    requires_image: true,
                    available: () => { return this.thumbnail_data && actions.is_download_type_available("image", this.thumbnail_data); },
                    onclick: () => {
                        actions.download_illust(this.media_id, "image");
                        this.parent.hide();
                    }
                });
            },

            download_manga: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Download manga ZIP",
                    icon: "mat:download",
                    hide_if_unavailable: true,
                    requires_image: true,
                    available: () => { return this.thumbnail_data && actions.is_download_type_available("ZIP", this.thumbnail_data); },
                    onclick: () => {
                        actions.download_illust(this.media_id, "ZIP");
                        this.parent.hide();
                    }
                });
            },

            download_video: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Download video MKV",
                    icon: "mat:download",
                    hide_if_unavailable: true,
                    requires_image: true,
                    available: () => { return this.thumbnail_data && actions.is_download_type_available("MKV", this.thumbnail_data); },
                    onclick: () => {
                        actions.download_illust(this.media_id, "MKV");
                        this.parent.hide();
                    }
                });
            },

            send_to_tab: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Send to tab",
                    classes: ["button-send-image"],
                    icon: "mat:open_in_new",
                    requires_image: true,
                    onclick: () => {
                        main_controller.singleton.send_image_popup.show_for_illust(this.media_id);
                        this.parent.hide();
                    }
                });
            },

            toggle_slideshow: () => {
                return new menu_option_toggle({
                    ...shared_options,
                    label: "Slideshow",
                    icon: "mat:wallpaper",
                    requires_image: true,
                    checked: helpers.args.location.hash.get("slideshow") == "1",
                    onclick: () => {
                        main_controller.singleton.toggle_slideshow();
                        this.refresh();
                    }
                });
            },

            linked_tabs: () => {
                return new menu_option_toggle_setting({
                    container: option_box,
                    parent: this,
                    label: "Linked tabs",
                    setting: "linked_tabs_enabled",
                    icon: "mat:link",
                    buttons: [
                        new menu_option_button({
                            container: option_box,
                            parent: this,
                            label: "Edit",
                            classes: ["small-font"],

                            onclick: (e) => {
                                e.stopPropagation();

                                new ppixiv.settings_dialog({ show_page: "linked_tabs" });

                                this.parent.hide();
                                return true;
                            },
                        }),
                    ],
                });
            },

            image_editing: () => {
                return new menu_option_toggle_setting({
                    ...shared_options,
                    label: "Image editing",
                    icon: "mat:brush",
                    setting: "image_editing",
                    requires_image: true,

                    onclick: () => {
                        // When editing is turned off, clear the editing mode too.
                        let enabled = settings.get("image_editing");
                        if(!enabled)
                            settings.set("image_editing_mode", null);
                    },
                });
            },

            open_settings: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Settings",
                    icon: "mat:settings",
                    onclick: () => {
                        new ppixiv.settings_dialog();
                        this.parent.hide();
                    }
                });
            },

            exit: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Return to Pixiv",
                    icon: "mat:logout",
                    url: "#no-ppixiv",
                });
            },
        };

        this.menu_options = [];
        if(!ppixiv.native)
        {
            this.menu_options.push(menu_options.similar_illustrations());
            this.menu_options.push(menu_options.similar_artists());
            this.menu_options.push(menu_options.similar_bookmarks());
            
            this.menu_options.push(menu_options.download_image());
            this.menu_options.push(menu_options.download_manga());
            this.menu_options.push(menu_options.download_video());
            this.menu_options.push(menu_options.edit_mutes());
        }

        this.menu_options.push(menu_options.send_to_tab());
        this.menu_options.push(menu_options.linked_tabs());

        // This is in the top-level menu on mobile.
        if(!ppixiv.mobile)
            this.menu_options.push(menu_options.toggle_slideshow());
        this.menu_options.push(menu_options.image_editing());
        this.menu_options.push(menu_options.refresh_image());

        // Add settings for mobile.  On desktop, this is available in a bunch of other
        // higher-profile places.
        if(ppixiv.mobile)
            this.menu_options.push(menu_options.open_settings());

        if(!ppixiv.native)
            this.menu_options.push(menu_options.exit());
    }

    set_user_id(user_id)
    {
        this.user_id = user_id;
        this.refresh();
    }

    visibility_changed()
    {
        if(this.visible)
            this.refresh();
    }

    async refresh_internal({ media_id, media_info })
    {
        if(!this.visible)
            return;

        this.create_menu_options();

        this.thumbnail_data = media_info;

        for(let option of this.menu_options)
        {
            let enable = true;
    
            // Enable or disable buttons that require an image.
            if(option.options.requires_image && media_id == null)
                enable = false;
            if(option.options.requires_user && this.user_id == null)
                enable = false;
            if(option.options.requires && !option.options.requires({media_id: media_id, user_id: this.user_id}))
                enable = false;
            if(enable && option.options.available)
                enable = option.options.available();
            option.enabled = enable;

            // Some options are hidden when they're unavailable, because they clutter
            // the menu too much.
            if(option.options.hide_if_unavailable)
                option.container.hidden = !enable;
        }
    }
}

// A button in the context menu that shows and hides a dropdown.
ppixiv.toggle_dropdown_menu_widget = class extends ppixiv.illust_widget
{
    // We only need an illust ID and no info.
    get needed_data() { return "media_id"; }

    constructor({bookmark_tag_widget, require_image=false, ...options})
    {
        super(options);

        this.bookmark_tag_widget = bookmark_tag_widget;
        this.require_image = require_image;

        this.container.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Ignore clicks if this button isn't enabled.
            if(this.require_image && !this.container.classList.contains("enabled"))
                return;
            
            this.bookmark_tag_widget.visible = !this.bookmark_tag_widget.visible;
        });
    }

    refresh_internal({ media_id })
    {
        if(this.require_image)
            helpers.set_class(this.container, "enabled", media_id != null);
    }
}

ppixiv.bookmark_button_widget = class extends ppixiv.illust_widget
{
    get needed_data() { return "partial"; }

    constructor({bookmark_type, bookmark_tag_widget, ...options})
    {
        super({...options});

        this.bookmark_type = bookmark_type;
        this.bookmark_tag_widget = bookmark_tag_widget;

        this.container.addEventListener("click", this.clicked_bookmark);

        ppixiv.media_cache.illust_modified_callbacks.register(this.refresh.bind(this));
    }

    refresh_internal({ media_id, media_info })
    {
        // If this is a local image, we won't have a bookmark count, so set local-image
        // to remove our padding for it.  We can get media_id before media_info.
        let is_local =  helpers.is_media_id_local(media_id);
        helpers.set_class(this.container,  "has-like-count", !is_local);

        let { type } = helpers.parse_media_id(media_id);

        // Hide the private bookmark button for local IDs.
        if(this.bookmark_type == "private")
            this.container.closest(".button-container").hidden = is_local;

        let bookmarked = media_info?.bookmarkData != null;
        let private_bookmark = this.bookmark_type == "private";
        let our_bookmark_type = media_info?.bookmarkData?.private == private_bookmark;

        // Set up the bookmark buttons.
        helpers.set_class(this.container,  "enabled",     media_info != null);
        helpers.set_class(this.container,  "bookmarked",  our_bookmark_type);
        helpers.set_class(this.container,  "will-delete", our_bookmark_type);
        
        // Set the tooltip.
        this.container.dataset.popup =
            media_info == null? "":
            !bookmarked && this.bookmark_type == "folder"? "Bookmark folder":
            !bookmarked && this.bookmark_type == "private"? "Bookmark privately":
            !bookmarked && this.bookmark_type == "public" && type == "folder"? "Bookmark folder":
            !bookmarked && this.bookmark_type == "public"? "Bookmark image":
            our_bookmark_type? "Remove bookmark":
            "Change bookmark to " + this.bookmark_type;
    }
    
    // Clicked one of the top-level bookmark buttons or the tag list.
    clicked_bookmark = async(e) =>
    {
        // See if this is a click on a bookmark button.
        let a = e.target.closest(".button-bookmark");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // If the tag list dropdown is open, make a list of tags selected in the tag list dropdown.
        // If it's closed, leave tag_list null so we don't modify the tag list.
        let tag_list = null;
        if(this.bookmark_tag_widget && this.bookmark_tag_widget.visible)
            tag_list = this.bookmark_tag_widget.selected_tags;

        // If we have a tag list dropdown, close it before saving the bookmark.
        //
        // When the tag list bookmark closes, it'll save the bookmark with its current tags
        // if they're different, creating the bookmark if needed.  If we leave it open when
        // we save, it's possible to click the private bookmark button in the context menu,
        // then release the right mouse button to close the context menu before the bookmark
        // finishes saving.  The tag list won't know that the bookmark is already being saved
        // and will save.  This can cause private bookmarks to become public bookmarks.  Just
        // tell the tag list to close without saving, since we're committing the tag list now.
        if(this.bookmark_tag_widget)
            this.bookmark_tag_widget.hide_without_sync();

        // If the image is bookmarked and the same privacy button was clicked, remove the bookmark.
        let illust_data = await media_cache.get_media_info(this._media_id, { full: false });
        
        let private_bookmark = this.bookmark_type == "private";
        if(illust_data.bookmarkData && illust_data.bookmarkData.private == private_bookmark)
        {
            let media_id = this._media_id;
            await actions.bookmark_remove(this._media_id);

            // If the current image changed while we were async, stop.
            if(media_id != this._media_id)
                return;
            
            // Hide the tag dropdown after unbookmarking, without saving any tags in the
            // dropdown (that would readd the bookmark).
            if(this.bookmark_tag_widget)
                this.bookmark_tag_widget.hide_without_sync();
            
            return;
        }

        // Add or edit the bookmark.
        await actions.bookmark_add(this._media_id, {
            private: private_bookmark,
            tags: tag_list,
        });
    }
}

ppixiv.bookmark_count_widget = class extends ppixiv.illust_widget
{
    constructor(options)
    {
        super(options);

        ppixiv.media_cache.illust_modified_callbacks.register(this.refresh.bind(this));
    }

    refresh_internal({ media_info })
    {
        this.container.textContent = media_info? media_info.bookmarkCount:"---";
    }
}

ppixiv.like_button_widget = class extends ppixiv.illust_widget
{
    get needed_data() { return "media_id"; }

    constructor(options)
    {
        super(options);

        this.container.addEventListener("click", this.clicked_like);

        ppixiv.media_cache.illust_modified_callbacks.register(this.refresh.bind(this));
    }

    async refresh_internal({ media_id })
    {
        // Hide the like button for local IDs.
        this.container.closest(".button-container").hidden = helpers.is_media_id_local(media_id);

        let liked_recently = media_id != null? extra_cache.singleton().get_liked_recently(media_id):false;
        helpers.set_class(this.container, "liked", liked_recently);
        helpers.set_class(this.container, "enabled", !liked_recently);

        this.container.dataset.popup = this._media_id == null? "":
            liked_recently? "Already liked image":"Like image";
    }
    
    clicked_like = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(this._media_id != null)
            actions.like_image(this._media_id);
    }
}

ppixiv.like_count_widget = class extends ppixiv.illust_widget
{
    constructor(options)
    {
        super(options);
        ppixiv.media_cache.illust_modified_callbacks.register(this.refresh.bind(this));
    }

    async refresh_internal({ media_info })
    {
        this.container.textContent = media_info? media_info.likeCount:"---";
    }
}
