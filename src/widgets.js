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
        ...options}={})
    {
        this.options = options;
        this.templates = {};

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
    create_template({name=null, html})
    {
        let template = name? this.templates[name]:null;
        if(!template)
        {
            template = document.createElement("template");
            template.innerHTML = html;
            helpers.replace_inlines(template.content);
            
            this.templates[name] = template;
        }

        return helpers.create_from_template(template);
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
        // Dialogs are hidden by default.
        visible=false,
        ...options
    })
    {
        super({
            visible: visible,
            ...options,
        });
    }


    visibility_changed()
    {
        super.visibility_changed();

        // This disables global key handling and hotkeys.
        if(this.visible)
            document.body.dataset.popupOpen = "1";
        else
            delete document.body.dataset.popupOpen;
    }
}

// A widget that shows info for a particular illust_id.
//
// An illust_id can be set, and we'll refresh when it changes.
ppixiv.illust_widget = class extends ppixiv.widget
{
    constructor(options)
    {
        super(options);

        // Refresh when the image data changes.
        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    // The data this widget needs.  This can be illust_id (nothing but the ID), illust_info,
    // or thumbnail info.
    //
    // This can change dynamically.  Some widgets need illust_info only when viewing a manga
    // page.
    get needed_data()
    {
        return "illust_info";
    }

    set_media_id(media_id)
    {
        if(this._media_id == media_id)
            return;

        this._media_id = media_id;

        let [illust_id, page] = helpers.media_id_to_illust_id_and_page(media_id);
        this._page = page;
        this.refresh();
    }
    
    get illust_id() { throw "FIXME"; } // making sure all uses of this are removed
    get media_id() { return this._media_id; }

    async refresh()
    {
        // Grab the illust info.
        let media_id = this._media_id;
        let info = { media_id: this._media_id };
        
        if(this._media_id != null)
        {
            // See if we have the data the widget wants already.
            info.thumbnail_data = thumbnail_data.singleton().get_illust_data_sync(this._media_id);
            info.illust_data = image_data.singleton().get_media_info_sync(this._media_id);
            let load_needed = false;
            switch(this.needed_data)
            {
            case "thumbnail":
                info.thumbnail_data = thumbnail_data.singleton().get_illust_data_sync(this._media_id);
                if(info.thumbnail_data == null)
                    load_needed = true;
                break;
            case "illust_info":
                info.illust_data = image_data.singleton().get_media_info_sync(this._media_id);
                if(info.illust_data == null)
                    load_needed = true;
                break;
            }

            // If we need to load data, clear the widget while we load, so we don't show the old
            // data while we wait for data.  Skip this if we don't need to load, so we don't clear
            // and reset the widget.  This can give the widget an illust ID without data, which is
            // OK.
            if(load_needed)
                await this.refresh_internal(info);

            switch(this.needed_data)
            {
            case "media_id":
                break; // nothing
            case "thumbnail":
                info.thumbnail_data = await thumbnail_data.singleton().get_or_load_illust_data(this._media_id);
                break;
            case "illust_info":
                info.illust_data = await image_data.singleton().get_media_info(this._media_id);
                break;
            default:
                throw new Error("Unknown: " + this.needed_data);
            }
        }

        // Stop if the media ID changed while we were async.
        if(this._media_id != media_id)
            return;

        await this.refresh_internal(info);
    }

    async refresh_internal({ media_id, illust_id, illust_data, thumbnail_data })
    {
        throw "Not implemented";
    }
}

// Display messages in the popup widget.  This is a singleton.
ppixiv.message_widget = class
{
    static get singleton()
    {
        if(message_widget._singleton == null)
            message_widget._singleton = new message_widget();
        return message_widget._singleton;
    }

    constructor()
    {
        this.container = document.body.querySelector(".hover-message");
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
        this.window_onmousedown = this.window_onmousedown.bind(this);

        this.node_list = node_list;
        this.callback = callback;

        window.addEventListener("mousedown", this.window_onmousedown, true);
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

    window_onmousedown(e)
    {
        // Close the popup if anything outside the dropdown is clicked.  Don't
        // prevent the click event, so the click still happens.
        //
        // If this is a click inside the box or our button, ignore it.
        if(this.is_node_in_list(e.target))
            return;

        this.callback();
    }

    shutdown()
    {
        window.removeEventListener("mousedown", this.window_onmousedown, true);
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
        this.box_onclick = this.box_onclick.bind(this);

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
    }

    // Return true if this popup should close when clicking inside it.  If false,
    // the menu will stay open until something else closes it.
    get close_on_click_inside()
    {
        return true;
    }

    // Close the popup when something inside is clicked.  This can be prevented with
    // stopPropagation, or with the keep-menu-open class.
    box_onclick(e)
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

// A pointless creepy eye.  Looks away from the mouse cursor when hovering over
// the unfollow button.
ppixiv.creepy_eye_widget = class
{
    constructor(eye)
    {
        this.onevent = this.onevent.bind(this);

        this.eye = eye;

        this.eye.addEventListener("mouseenter", this.onevent);
        this.eye.addEventListener("mouseleave", this.onevent);
        this.eye.addEventListener("mousemove", this.onevent);
        this.eye_middle = this.eye.querySelector(".middle");
    }

    onevent(e)
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
        var mouse = [e.pageX, e.pageY];

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
            <div class="follow-container">
                <a href=# class=avatar-link style="position: relative;">
                    <div class="avatar popup popup-bottom">
                        <canvas class=main></canvas>
                        <canvas class=highlight></canvas>
                    </div>

                    <div class=follow-buttons>
                        <!-- We either show the following icon if we're already following (which acts as the unfollow
                            button), or the public and private follow buttons.  The follow button is only shown on hover. -->
                        <div class="follow-icon follow-button public bottom-left popup popup-bottom" data-popup="Follow publically">
                            <ppixiv-inline src="resources/eye-icon.svg"></ppixiv-inline>
                        </div>
                        <div class="follow-icon follow-button private bottom-right popup popup-bottom" data-popup="Follow privately">
                            <ppixiv-inline src="resources/eye-icon.svg"></ppixiv-inline>
                        </div>
                        <div class="follow-icon following-icon unfollow-button bottom-right popup popup-bottom" data-popup="Unfollow">
                            <ppixiv-inline src="resources/eye-icon.svg"></ppixiv-inline>
                        </div>
                    </div>
                </a>
                <div class="popup-menu-box hover-menu-box follow-popup">
                    <div class=hover-area></div>
                    <div class=not-following>
                        <div class="button follow-button public">
                            Follow
                        </div>
                        <div class="button follow-button private">
                            Follow&nbsp;Privately
                        </div>
                        <input class="folder premium-only" placeholder="Folder">
                        </input>
                    </div>
                </div>
            </div>
        `});

        this.options = options;
        if(this.options.mode != "dropdown" && this.options.mode != "overlay")
            throw "Invalid avatar widget mode";

        this.clicked_follow = this.clicked_follow.bind(this);
        this.user_changed = this.user_changed.bind(this);

        helpers.set_class(this.container, "big", this.options.big);

        image_data.singleton().user_modified_callbacks.register(this.user_changed);

        let element_author_avatar = this.container.querySelector(".avatar");

        this.img = document.createElement("img");

        // A canvas filter for the avatar.  This has no actual filters.  This is just to kill off any
        // annoying GIF animations in people's avatars.
        this.base_filter = new image_canvas_filter(this.img, element_author_avatar.querySelector("canvas.main"));

        // The actual highlight filter:
        this.highlight_filter = new image_canvas_filter(this.img, element_author_avatar.querySelector("canvas.highlight"), "brightness(150%)", (ctx, img) => {
            ctx.globalCompositeOperation = "destination-in";

            let feather = 25;
            let radius = 15;
            ctx.filter = "blur(" + feather + "px)";
            helpers.draw_round_rect(ctx, feather, feather + this.img.naturalHeight/2, this.img.naturalWidth - feather*2, this.img.naturalHeight - feather*2, radius);
            ctx.fill();
        });
        
        this.container.dataset.mode = this.options.mode;

        // Show the favorite UI when hovering over the avatar icon.
        let avatar_popup = this.container; //container.querySelector(".avatar-popup");
        if(this.options.mode == "dropdown")
        {
            avatar_popup.addEventListener("mouseover", function(e) { helpers.set_class(avatar_popup, "popup-visible", true); }.bind(this));
            avatar_popup.addEventListener("mouseout", function(e) { helpers.set_class(avatar_popup, "popup-visible", false); }.bind(this));
        }

        new creepy_eye_widget(this.container.querySelector(".unfollow-button .eye-image"));

        for(let button of avatar_popup.querySelectorAll(".follow-button.public"))
            button.addEventListener("click", this.clicked_follow.bind(this, false), false);
        for(let button of avatar_popup.querySelectorAll(".follow-button.private"))
            button.addEventListener("click", this.clicked_follow.bind(this, true), false);
        for(let button of avatar_popup.querySelectorAll(".unfollow-button"))
            button.addEventListener("click", this.clicked_follow.bind(this, true), false);
        this.element_follow_folder = avatar_popup.querySelector(".folder");

        // Follow publically when enter is pressed on the follow folder input.
        helpers.input_handler(avatar_popup.querySelector(".folder"), this.clicked_follow.bind(this, false));
    }

    shutdown()
    {
        image_data.singleton().user_modified_callbacks.unregister(this.user_changed);
    }

    visibility_changed()
    {
        super.visibility_changed();

        this.refresh();
    }
    
    // Refresh when the user changes.
    user_changed(user_id)
    {
        if(this.user_id == null || this.user_id != user_id)
            return;

        this.set_user_id(this.user_id);
    }

    async set_user_id(user_id)
    {
        this.user_id = user_id;
        this.refresh();
    }

    async refresh()
    {
        if(this.user_id == null)
        {
            this.user_data = null;
            this.container.classList.add("loading");

            // Set the avatar image to a blank image, so it doesn't flash the previous image
            // the next time we display it.  It should never do this, since we set a new image
            // before displaying it, but Chrome doesn't do this correctly at least with Canvas.
            this.img.src = helpers.blank_image;
            return;
        }

        // If we've seen this user's profile image URL from thumbnail data, start loading it
        // now.  Otherwise, we'll have to wait until user info finishes loading.
        let cached_profile_url = thumbnail_data.singleton().user_profile_urls[this.user_id];
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
        this.container.querySelector(".follow-buttons").hidden = true;
        this.container.querySelector(".follow-popup").hidden = true;

        this.container.classList.remove("loading");

        let user_data = await image_data.singleton().get_user_info(this.user_id);
        this.user_data = user_data;
        if(user_data == null)
            return;

        helpers.set_class(this.container, "self", this.user_id == global_data.user_id);

        // We can't tell if we're followed privately or not, only that we're following.
        helpers.set_class(this.container, "followed", this.user_data.isFollowed);

        this.container.querySelector(".avatar").dataset.popup = "View " + this.user_data.name + "'s posts";

        // If we don't have an image because we're loaded from a source that doesn't give us them,
        // just hide the avatar image.
        let key = "imageBig";
        if(this.user_data[key])
            this.img.src = this.user_data[key];
        else
            this.img.src = helpers.blank_image;

        this.container.querySelector(".follow-buttons").hidden = false;
        this.container.querySelector(".follow-popup").hidden = false;
    }
    
    async follow(follow_privately)
    {
        if(this.user_id == null)
            return;

        var tags = this.element_follow_folder.value;
        await actions.follow(this.user_id, follow_privately, tags);
    }

    async unfollow()
    {
        if(this.user_id == null)
            return;

        await actions.unfollow(this.user_id);
    }

    // Note that in some cases we'll only have the user's ID and name, so we won't be able
    // to tell if we're following.
    clicked_follow(follow_privately, e)
    {
        e.preventDefault();
        e.stopPropagation();

        if(this.user_data == null)
            return;

        if(this.user_data.isFollowed)
        {
            // Unfollow the user.
            this.unfollow();
            return;
        }

        // Follow the user.
        this.follow(follow_privately);
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
        return page_manager.singleton().get_url_for_tag_search(tag, ppixiv.location);
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
        this.last_tags = this.tags;

        // Look up tag translations.
        let tag_list = this.tags;
        let translated_tags = await tag_translations.get().get_translations(tag_list, "en");
        
        // Stop if the tag list changed while we were reading tag translations.
        if(tag_list != this.tags)
            return;

        // Remove any old tag list and create a new one.
        helpers.remove_elements(this.container);

        for(let tag of tag_list)
        {
            let a = this.container.appendChild(document.createElement("a"));
            a.classList.add("tag");
            a.classList.add("box-link");

            let popup = null;
            let translated_tag = tag;
            if(translated_tags[tag])
                translated_tag = translated_tags[tag];

            a.dataset.tag = tag;
            a.textContent = translated_tag;

            a.href = this.format_tag_link(tag);
        }
    }
};

// A popup for inputting text.
//
// This is currently special purpose for the add tag prompt.
ppixiv.text_prompt = class extends ppixiv.dialog_widget
{
    constructor({...options}={})
    {
        super({...options,
            container: document.body,
            visible: true,
            template: `
            <div class="tag-entry-popup">
                <div class=strip>
                    <div class=box>
                        <div class=close-button>X</div>
                        <div style="margin-bottom: 4px;">
                            New tag:
                        </div>
                        <div class=tag-input-box>
                            <input class=add-tag-input>
                            <span class=submit-button>+</span>
                        </div>
                    </div>
                </div>
            </div>
        `});
        
        this.submit = this.submit.bind(this);
        this.onkeydown = this.onkeydown.bind(this);

        this.result = new Promise((completed, cancelled) => {
            this._completed = completed;
            this._cancelled = cancelled;
        });

        this.input = this.container.querySelector("input.add-tag-input");
        this.input.value = "";

        this.container.querySelector(".close-button").addEventListener("click", (e) => { this.visible = false; });
        this.container.querySelector(".submit-button").addEventListener("click", this.submit);

        this.container.addEventListener("click", (e) => {
            // Clicks that aren't inside the box close the dialog.
            if(e.target.closest(".box") != null)
                return;

            e.preventDefault();
            e.stopPropagation();
            this.visible = false;
        });
    }

    onkeydown(e)
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
            // Remove the widget when it's hidden.
            this.container.remove();

            // If we didn't complete by now, cancel.
            this._cancelled("Cancelled by user");
        }
    }

    // Close the popup and call the completion callback with the result.
    submit()
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
            <div class=popup-bookmark-tag-dropdown>
                <div class=tag-list></div> <!-- tag list is inserted here -->
                <div class=tag-right-button-strip>
                    <div class="tag-button popup add-tag" data-popup="Add a different tag" style="padding: 12px 8px; text-align: center;">
                        <div class=grey-icon>
                            +
                        </div>
                    </div>
                    <div class="tag-button popup sync-tags" data-popup="Load common tags from bookmarks" style="padding: 4px 8px; ">
                        <div class=grey-icon>
                            <ppixiv-inline src="resources/refresh-icon.svg"></ppixiv-inline>
                        </div>
                    </div>
                </div>
            </div>
        `});

        this.displaying_media_id = null;

        this.container.addEventListener("click", this.clicked_bookmark_tag.bind(this), true);

        this.container.querySelector(".add-tag").addEventListener("click", async (e) => {
            await actions.add_new_tag(this._media_id);
        });

        this.container.querySelector(".sync-tags").addEventListener("click", async (e) => {
            var bookmark_tags = await actions.load_recent_bookmark_tags();
            helpers.set_recent_bookmark_tags(bookmark_tags);
        });

        // Close if our containing widget is closed.
        new view_hidden_listener(this.container, (e) => {
            this.visible = false;
        });

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
        settings.register_change_callback("recent-bookmark-tags", this.refresh.bind(this));
    }

    // Return an array of tags selected in the tag dropdown.
    get selected_tags()
    {
        var tag_list = [];
        var bookmark_tags = this.container;
        for(var entry of bookmark_tags.querySelectorAll(".popup-bookmark-tag-entry"))
        {
            if(!entry.classList.contains("active"))
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
            var bookmark_tags = this.container.querySelector(".tag-list");
            helpers.remove_elements(bookmark_tags);
            this.displaying_media_id = null;
        }
    }

    async refresh_internal({ media_id })
    {
        // If we're refreshing the same illust that's already refreshed, store which tags were selected
        // before we clear the list.
        let old_selected_tags = this.displaying_media_id == media_id? this.selected_tags:[];

        this.displaying_media_id = null;

        let bookmark_tags = this.container.querySelector(".tag-list");
        helpers.remove_elements(bookmark_tags);

        // Make sure the dropdown is hidden if we have no image.
        if(media_id == null)
            this.visible = false;

        if(media_id == null || !this.visible)
            return;

        // Fit the tag scroll box within however much space we have available.
        helpers.set_max_height(this.container.querySelector(".tag-list"), { max_height: 400, bottom_padding: 10 });

        // Create a temporary entry to show loading while we load bookmark details.
        let entry = document.createElement("span");
        bookmark_tags.appendChild(entry);
        entry.innerText = "Loading...";

        // If the tag list is open, populate bookmark details to get bookmark tags.
        // If the image isn't bookmarked this won't do anything.
        let active_tags = await image_data.singleton().load_bookmark_details(media_id);

        // Remember which illustration's bookmark tags are actually loaded.
        this.displaying_media_id = media_id;

        // Remove elements again, in case another refresh happened while we were async
        // and to remove the loading entry.
        helpers.remove_elements(bookmark_tags);
        
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

        shown_tags.sort((lhs, rhs) => {
            lhs = lhs.toLowerCase();
            rhs = rhs.toLowerCase();
            return lhs.localeCompare(rhs);
        });

        for(let tag of shown_tags)
        {
            let entry = this.create_template({name: "tag-entry", html: `
                <div class=popup-bookmark-tag-entry>
                    <span class=tag-name></span>
                </div>
            `});

            entry.dataset.tag = tag;
            bookmark_tags.appendChild(entry);
            entry.querySelector(".tag-name").innerText = tag;

            let active = active_tags.indexOf(tag) != -1;
            helpers.set_class(entry, "active", active);
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
        let old_tags = await image_data.singleton().load_bookmark_details(media_id);

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
        console.log("Tag list closing and tags have changed");
        console.log("Old tags:", old_tags);
        console.log("New tags:", new_tags);

        await actions.bookmark_add(this._media_id, {
            tags: new_tags,
        });
    }

    // Toggle tags on click.  We don't save changes until we're closed.
    async clicked_bookmark_tag(e)
    {
        let a = e.target.closest(".popup-bookmark-tag-entry");
        if(a == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        // Toggle this tag.  Don't actually save it immediately, so if we make multiple
        // changes we don't spam requests.
        let tag = a.dataset.tag;
        helpers.set_class(a, "active", !a.classList.contains("active"));
    }
}

ppixiv.more_options_dropdown_widget = class extends ppixiv.illust_widget
{
    get needed_data() { return "thumbnail"; }

    constructor(options)
    {
        super({...options,
            visible: false,
            template: `
<div class=popup-more-options-dropdown>
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
                    icon: "resources/related-illusts.svg",
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
                    icon: "resources/related-illusts.svg",
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
                    icon: "resources/related-illusts.svg",
                    requires_image: true,
                    onclick: () => {
                        this.parent.hide();

                        let [illust_id] = helpers.media_id_to_illust_id_and_page(this.media_id);
                        let args = new helpers.args(`/bookmark_detail.php?illust_id=${illust_id}#ppixiv`);
                        helpers.set_page_url(args, true /* add_to_history */, "navigation");
                    }
                });
            },
    
            // XXX: hook into progress bar
            download_image: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Download image",
                    icon: "resources/download-icon.svg",
                    hide_if_unavailable: true,
                    requires_image: true,
                    available: () => { return this.thumbnail_data && actions.is_download_type_available("image", this.thumbnail_data); },
                    onclick: () => {
                        actions.download_illust(this.media_id, null, "image");
                        this.parent.hide();
                    }
                });
            },

            download_manga: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Download manga ZIP",
                    icon: "resources/download-manga-icon.svg",
                    hide_if_unavailable: true,
                    requires_image: true,
                    available: () => { return this.thumbnail_data && actions.is_download_type_available("ZIP", this.thumbnail_data); },
                    onclick: () => {
                        actions.download_illust(this.media_id, null, "ZIP");
                        this.parent.hide();
                    }
                });
            },

            download_video: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Download video MKV",
                    icon: "resources/download-icon.svg",
                    hide_if_unavailable: true,
                    requires_image: true,
                    available: () => { return this.thumbnail_data && actions.is_download_type_available("MKV", this.thumbnail_data); },
                    onclick: () => {
                        actions.download_illust(this.media_id, null, "MKV");
                        this.parent.hide();
                    }
                });
            },

            send_to_tab: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Send to tab",
                    classes: ["button-send-image"],
                    icon: "resources/send-to-tab.svg",
                    requires_image: true,
                    onclick: () => {
                        main_controller.singleton.send_image_popup.show_for_illust(this.media_id);
                        this.parent.hide();
                    }
                });
            },

            toggle_slideshow: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Slideshow",
                    icon: helpers.create_icon("wallpaper", "16px"),
                    requires_image: true,
                    onclick: () => {
                        // Add or remove slideshow=1 from the hash.
                        let args = helpers.args.location;
                        let enabled = args.hash.get("slideshow") == "1";
                        if(enabled)
                            args.hash.delete("slideshow");
                        else
                            args.hash.set("slideshow", "1");
        
                        helpers.set_page_url(args, false, "toggle slideshow");

                        this.parent.hide();
                    }
                });
            },

            linked_tabs: () => {
                return new menu_option_toggle({
                    container: option_box,
                    parent: this,
                    label: "Linked tabs",
                    setting: "linked_tabs_enabled",
                    icon: helpers.create_icon("link", "16px"),
                    buttons: [
                        new menu_option_button({
                            container: option_box,
                            parent: this,
                            label: "Edit",
                            classes: ["small-font"],
                            no_icon_padding: true,

                            onclick: (e) => {
                                main_controller.singleton.link_tabs_popup.visible = true;
                                this.parent.hide();
                                return true;
                            },
                        }),
                    ],
                });
            },

            edit_inpainting: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Edit image",
                    icon: helpers.create_icon("brush", "16px"),
                    hide_if_unavailable: true,
                    requires: ({media_id}) => {
                        return media_id != null && helpers.is_media_id_local(media_id);
                    },
                    onclick: () => {
                        settings.set("image_editing", !settings.get("image_editing", false));
                    }
                });
            },

            exit: () => {
                return new menu_option_button({
                    ...shared_options,
                    label: "Return to Pixiv",
                    icon: "resources/pixiv-icon.svg",
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
        }

        this.menu_options.push(menu_options.send_to_tab());
        this.menu_options.push(menu_options.linked_tabs());
        this.menu_options.push(menu_options.toggle_slideshow());
        this.menu_options.push(menu_options.edit_inpainting());

        if(!ppixiv.native)
            this.menu_options.push(menu_options.exit());

        // Close if our containing widget is closed.
        new view_hidden_listener(this.container, (e) => {
            this.visible = false;
        });
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

    async refresh_internal({ media_id, thumbnail_data })
    {
        if(!this.visible)
            return;

        this.create_menu_options();

        this.thumbnail_data = thumbnail_data;

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
    get needed_data() { return "thumbnail"; }

    constructor({bookmark_type, bookmark_tag_widget, ...options})
    {
        super({...options});

        this.bookmark_type = bookmark_type;
        this.bookmark_tag_widget = bookmark_tag_widget;

        this.container.addEventListener("click", this.clicked_bookmark.bind(this));

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    refresh_internal({ media_id, thumbnail_data })
    {
        // If this is a local image, we won't have a bookmark count, so set local-image
        // to remove our padding for it.  We can get media_id before thumbnail_data.
        let is_local =  helpers.is_media_id_local(media_id);
        helpers.set_class(this.container,  "has-like-count", !is_local);

        let { type } = helpers.parse_media_id(media_id);

        // Hide the private bookmark button for local IDs.
        if(this.bookmark_type == "private")
            this.container.closest(".button-container").hidden = is_local;

        let bookmarked = thumbnail_data?.bookmarkData != null;
        let private_bookmark = this.bookmark_type == "private";
        let our_bookmark_type = thumbnail_data?.bookmarkData?.private == private_bookmark;

        // Set up the bookmark buttons.
        helpers.set_class(this.container,  "enabled",     thumbnail_data != null);
        helpers.set_class(this.container,  "bookmarked",  our_bookmark_type);
        helpers.set_class(this.container,  "will-delete", our_bookmark_type);
        
        // Set the tooltip.
        this.container.dataset.popup =
            thumbnail_data == null? "":
            !bookmarked && this.bookmark_type == "folder"? "Bookmark folder":
            !bookmarked && this.bookmark_type == "private"? "Bookmark privately":
            !bookmarked && this.bookmark_type == "public" && type == "folder"? "Bookmark folder":
            !bookmarked && this.bookmark_type == "public"? "Bookmark image":
            our_bookmark_type? "Remove bookmark":
            "Change bookmark to " + this.bookmark_type;
    }
    
    // Clicked one of the top-level bookmark buttons or the tag list.
    async clicked_bookmark(e)
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
        let illust_data = await thumbnail_data.singleton().get_or_load_illust_data(this._media_id);
        
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

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    refresh_internal({ illust_data })
    {
        this.container.textContent = illust_data? illust_data.bookmarkCount:"---";
    }
}

ppixiv.like_button_widget = class extends ppixiv.illust_widget
{
    get needed_data() { return "media_id"; }

    constructor(options)
    {
        super(options);

        this.container.addEventListener("click", this.clicked_like);

        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    async refresh_internal({ media_id })
    {
        // Hide the like button for local IDs.
        this.container.closest(".button-container").hidden = helpers.is_media_id_local(media_id);

        let liked_recently = media_id != null? image_data.singleton().get_liked_recently(media_id):false;
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
        image_data.singleton().illust_modified_callbacks.register(this.refresh.bind(this));
    }

    async refresh_internal({ illust_data })
    {
        this.container.textContent = illust_data? illust_data.likeCount:"---";
    }
}
