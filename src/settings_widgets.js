ppixiv.settings_widgets = {
    create({ global_options })
    {
        // Each settings widget.  Doing it this way lets us move widgets around in the
        // menu without moving big blocks of code around.
        return {
            thumbnail_size: () => {
                let button = new menu_option_button({
                    ...global_options,
                    label: "Thumbnail size",
                    buttons: [
                        new thumbnail_size_slider_widget({
                            ...global_options,
                            parent: this,
                            container: this.container,
                            setting: "thumbnail-size",
                            classes: ["size-slider"],
                            min: 0,
                            max: 7,
                        }),
                    ],
                });
        
                button.container.querySelector(".size-slider").style.flexGrow = .25;
            },

            manga_thumbnail_size: () => {
                let button = new menu_option_button({
                    ...global_options,
                    label: "Thumbnail size (manga)",
                    buttons: [
                        new thumbnail_size_slider_widget({
                            ...global_options,
                            parent: this,
                            container: this.container,
                            setting: "manga-thumbnail-size",
                            classes: ["size-slider"],
                            min: 0,
                            max: 7,
                        }),
                    ],
                });
        
                button.container.querySelector(".size-slider").style.flexGrow = .25;
            },

            disabled_by_default: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Disabled by default",
                    setting: "disabled-by-default",
                    explanation_enabled: "Go to Pixiv by default.",
                    explanation_disabled: "Go here by default.",
                });
            },
    
            no_hide_cursor: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Hide cursor",
                    setting: "no-hide-cursor",
                    invert_display: true,
                    explanation_enabled: "Hide the cursor while the mouse isn't moving.",
                    explanation_disabled: "Don't hide the cursor while the mouse isn't moving.",
                });
            },
    
            invert_popup_hotkey: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Shift-right-click to show the popup menu",
                    setting: "invert-popup-hotkey",
                    explanation_enabled: "Shift-right-click to open the popup menu",
                    explanation_disabled: "Right click opens the popup menu",
                });
            },

            ctrl_opens_popup: () => {
                    return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Hold ctrl to show the popup menu",
                    setting: "ctrl_opens_popup",
                    explanation_enabled: "Pressing Ctrl shows the popup menu (for laptops)",
                });
            },

            ui_on_hover: () => {
                new menu_option_toggle_setting({
                    ...global_options,
                    label: "Hover to show search box",
                    setting: "ui-on-hover",
                    refresh: this.update_from_settings,
                    explanation_enabled: "Only show the search box when hovering over it",
                    explanation_disabled: "Always show the search box",
                });
            },

            invert_scrolling: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Invert image panning",
                    setting: "invert-scrolling",
                    explanation_enabled: "Dragging down moves the image down",
                    explanation_disabled: "Dragging down moves the image up",
                });
            },

            theme: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Light mode",
                    setting: "theme",
                    on_value: "light",
                    off_value: "dark",
                    explanation_enabled: "FLASHBANG",
                });
            },
    
            disable_translations: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Show tag translations when available",
                    setting: "disable-translations",
                    invert_display: true,
                });
            },
    
            disable_thumbnail_panning: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Pan thumbnails while hovering over them",
                    setting: "disable_thumbnail_panning",
                    invert_display: true,
                });
            },
    
            disable_thumbnail_zooming: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Zoom out thumbnails while hovering over them",
                    setting: "disable_thumbnail_zooming",
                    invert_display: true,
                });
            },
    
            bookmark_privately_by_default: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Bookmark and follow privately by default",
                    setting: "bookmark_privately_by_default",
                    explanation_disabled: "Pressing Ctrl-B will bookmark publically",
                    explanation_enabled: "Pressing Ctrl-B will bookmark privately",
                });
            },

            limit_slideshow_framerate: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Limit slideshows to 60 FPS",
                    setting: "slideshow_framerate",
                    on_value: 60,
                    off_value: null,
                });
            },

            import_extra_data: () => {
                return new menu_option_row({
                    ...global_options,
                    label: "Image edits",
                    items: [
                        new menu_option_button({
                            icon: "file_upload",
                            label: "Import",
                            onclick: () => ppixiv.extra_image_data.get.import(),
                        }),
                        new menu_option_button({
                            icon: "file_download",
                            label: "Export",
                            onclick: () => ppixiv.extra_image_data.get.export(),
                        }),
                    ],
                });
            },

            stage_slideshow: () => {
                return new menu_option_row({
                    ...global_options,
                    label: "Bookmark slideshow",
                    items: [
                        new menu_option_button({
                            icon: "wallpaper",
                            label: "Go",
                            onclick: () => {
                                // Close the settings dialog.
                                global_options.close_settings();

                                ppixiv.slideshow_staging_dialog.show();
                            },
                        }),
                    ],
                });
            },

            quick_view: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Quick view",
                    setting: "quick_view",
                    explanation_enabled: "Navigate to images immediately when the mouse button is pressed",
    
                    check: () => {
                        // Only enable changing this option when using a mouse.  It has no effect
                        // on touchpads.
                        if(ppixiv.pointer_listener.pointer_type == "mouse")
                            return true;
    
                        message_widget.singleton.show("Quick View is only supported when using a mouse.");
                        return false;
                    },
                });
            },
    
            auto_pan: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Pan images",
                    setting: "auto_pan",
                    explanation_enabled: "Pan images while viewing them (drag the image to stop)",
                });
            },

            auto_pan_speed: () => {
                let button;
                let slider = new menu_option_slider_setting({
                    ...global_options,
                    setting: "auto_pan_duration",
                    list: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60],
                    classes: ["size-slider"],

                    // Refresh the label when the value changes.
                    refresh: function() { button.refresh(); },
                });

                button = new menu_option_button({
                    ...global_options,
                    label: "Time per image",
                    get_label: () => {
                        let seconds = settings.get("auto_pan_duration");;
                        return `Pan duration: ${seconds} ${seconds != 1? "seconds":"second"}`;                                        
                    },
                    buttons: [slider],
                });
        
                button.container.querySelector(".size-slider").style.flexGrow = .25;
            },

            slideshow_speed: () => {
                let button;
                let slider = new menu_option_slider_setting({
                    ...global_options,
                    setting: "slideshow_duration",
                    list: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180],
                    classes: ["size-slider"],
                    
                    // Refresh the label when the value changes.
                    refresh: function() { button.refresh(); },
                });

                button = new menu_option_button({
                    ...global_options,
                    label: "Time per image",
                    get_label: () => {
                        let seconds = settings.get("slideshow_duration");;
                        return `Slideshow duration: ${seconds} ${seconds != 1? "seconds":"second"}`;
                    },
                    buttons: [slider],
                });
        
                button.container.querySelector(".size-slider").style.flexGrow = .25;
            },

            slideshow_default_animation: () => {
                return new ppixiv.menu_option_options_setting({
                    ...global_options,
                    setting: "slideshow_default",
                    label: "Slideshow mode",
                    values: ["pan", "contain"],
                    explanation: (value) => {
                        switch(value)
                        {
                        case "pan": return "Pan the image left-to-right or top-to-bottom";
                        case "contain": return "Fade in and out without panning";
                        }
                    },
                });
            },

            slideshow_skips_manga: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Slideshow skips manga pages",
                    setting: "slideshow_skips_manga",
                    explanation_enabled: "Slideshow mode will only show the first page.",
                    explanation_disabled: "Slideshow mode will show all pages.",
                });
            },

            expand_manga_posts: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Expand manga posts in search results",
                    setting: "expand_manga_thumbnails",
                });
            },

            no_recent_history: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Remember recent history",
                    setting: "no_recent_history",
                    invert_display: true,
                    explanation_enabled: "Remember recently seen thumbnails",
                    explanation_disabled: "Don't remember recently seen thumbnails",
                });
            },
    
            view_mode: () => {
                new menu_option_toggle_setting({
                    ...global_options,
                    label: "Return to the top when changing images",
                    setting: "view_mode",
                    on_value: "manga",
                    off_value: "illust",
                });
            },
            link_tabs: () => {
                return new link_tabs_popup({
                    ...global_options,
                });
            },
            enable_linked_tabs: () => {
                return new menu_option_toggle_setting({
                    ...global_options,
                    label: "Enabled",
                    setting: "linked_tabs_enabled",
                });
            },
            unlink_all_tabs: () => {
                return new menu_option_button({
                    ...global_options,
                    label: "Unlink all tabs",
                    onclick: () => {
                        settings.set("linked_tabs", []);
                    },
                });
            },
            muted_tags: () => {
                return new muted_tags_popup({
                    mute_type: "tag",
                    ...global_options,
                });
            },
            muted_users: () => {
                return new muted_tags_popup({
                    mute_type: "user",
                    ...global_options,
                });
            },
        };
    }
}

ppixiv.settings_dialog = class extends ppixiv.dialog_widget
{
    constructor({show_page="thumbnail", ...options}={})
    {
        super({
            ...options,
            dialog_class: "settings-dialog",
            header: "Settings",

        template: `
            <div class=sections></div>
            <div class=items></div>
        `});

        this.pages = {};
        this.page_buttons = new Map();

        this.add_settings();

        this.show_page(show_page);
    }

    shutdown()
    {
        super.shutdown();

        this.visible = false;
        this.container.remove();

        this.link_tabs.shutdown();
    }

    add_settings()
    {
        this.items = this.container.querySelector(".items");

        // Options that we pass to all menu_options:
        let global_options = {
            container: this.items,
            parent: this,
            classes: ["settings-row"],

            // Share our shutdown signal with the widgets, so their event listeners will be
            // shut down when we shut down.
            shutdown_signal: this.shutdown_signal,
        };

        let settings_widgets = ppixiv.settings_widgets.create({ global_options });

        this.create_page("thumbnail", "Thumbnail options", global_options, { settings_list: true });

        settings_widgets.thumbnail_size();
        if(!ppixiv.native)
            settings_widgets.manga_thumbnail_size();
        if(!ppixiv.mobile)
        {
            settings_widgets.disable_thumbnail_panning();
            settings_widgets.disable_thumbnail_zooming();
            settings_widgets.quick_view();
            settings_widgets.ui_on_hover();
        }
        
        if(!ppixiv.native)
            settings_widgets.expand_manga_posts();

        this.create_page("image", "Image viewing", global_options, { settings_list: true });
        settings_widgets.auto_pan();
        settings_widgets.auto_pan_speed();
        settings_widgets.slideshow_speed();
        settings_widgets.slideshow_default_animation();
        if(!ppixiv.native) // native mode doesn't support manga pages
            settings_widgets.slideshow_skips_manga();
        
        settings_widgets.view_mode();
        if(!ppixiv.mobile)
        {
            settings_widgets.invert_scrolling();
            settings_widgets.no_hide_cursor();
        }
        
        if(!ppixiv.native)
        {
            this.create_page("tag_muting", "Muted tags", global_options);
            this.muted_tags = settings_widgets.muted_tags();

            this.create_page("user_muting", "Muted users", global_options);
            this.muted_users = settings_widgets.muted_users();
        }

        this.create_page("linked_tabs", "Linked tabs", global_options, { settings_list: true });
        this.link_tabs = settings_widgets.link_tabs({visible: false});
        settings_widgets.enable_linked_tabs();
        settings_widgets.unlink_all_tabs();

        this.create_page("other", "Other", global_options, { settings_list: true });
        settings_widgets.disable_translations();

        if(!ppixiv.native)
            settings_widgets.disabled_by_default();
            
        if(!ppixiv.mobile)
        {
            // Firefox's contextmenu behavior is broken, so hide this option.
            if(navigator.userAgent.indexOf("Firefox/") == -1)
                settings_widgets.invert_popup_hotkey();

            settings_widgets.ctrl_opens_popup();
        }

        // settings_widgets.theme();
        settings_widgets.bookmark_privately_by_default();
        settings_widgets.limit_slideshow_framerate();

        // Chrome supports showOpenFilePicker, but Firefox doesn't.  That API has been around in
        // Chrome for a year and a half, so I haven't implemented an alternative for Firefox.
        if(!ppixiv.native && window.showOpenFilePicker != null)
            settings_widgets.import_extra_data();

        settings_widgets.stage_slideshow();

        // Hidden for now (not very useful)
        // settings_widgets.no_recent_history();

        // Add allow-wrap to all top-level box links that we just created, so the
        // settings menu scales better.  Don't recurse into nested buttons.
        for(let box_link of this.items.querySelectorAll(".settings-page > .box-link"))
            box_link.classList.add("allow-wrap");
    }

    create_page(id, title, global_options, {settings_list=false}={})
    {
        let page = this.create_template({name: "settings-page", html: `
            <div class=settings-page>
            </div>
        `});

        // If settings_list is true, this page is a list of options, like the thumbnail options
        // page.  This class enables styling for these lists.  If it's another type of settings
        // page with its own styling, this is disabled.
        if(settings_list)
            page.classList.add("settings-list");

        this.items.appendChild(page);
        global_options.container = page;

        let page_button = this.create_template({
            html: helpers.create_box_link({
                label: title,
                classes: ["settings-page-button"],
            }),
        });

        page.hidden = true;
        page_button.addEventListener("click", (e) => {
            this.show_page(id);
        });
        this.container.querySelector(".sections").appendChild(page_button);

        this.pages[id] = {
            page,
            page_button,
            title,
        };
        this.page_buttons.set(page, page_button);
        if(this.pages.length == 1)
            this.show_page(page);

        return page;
    }

    show_page(id)
    {
        if(this.visible_page != null)
        {
            helpers.set_class(this.visible_page.page_button, "selected", false);
            this.visible_page.page.hidden = true;
        }

        this.visible_page = this.pages[id];
        this.visible_page.page.hidden = false;
        
        helpers.set_class(this.visible_page.page_button, "selected", true);
        if(this.visible_page && !this.phone)
            this.header = this.visible_page.title;

        this.refresh();
    }

    refresh()
    {
        this.link_tabs.visible = this.visible && this.visible_page == this.pages.linked_tabs;
        if(this.muted_tags)
            this.muted_tags.visible = this.visible && this.visible_page == this.pages.tag_muting;
        if(this.muted_users)
            this.muted_users.visible = this.visible && this.visible_page == this.pages.user_muting;
    }

    visibility_changed()
    {
        super.visibility_changed();

        // Note that we need to refresh even if we're not visible, since we need to tell things
        // like this.link_tabs that they're no longer visible.
        this.refresh();
    }
};