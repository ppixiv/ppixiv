// The "More..." dropdown menu shown in the options menu.

import { SettingsDialog, SettingsPageDialog } from 'vview/widgets/settings-widgets.js';
import { SendImagePopup } from 'vview/misc/send-image.js';
import { MenuOptionButton, MenuOptionToggle, MenuOptionToggleSetting } from 'vview/widgets/menu-option.js';
import { MutedTagsForPostDialog } from 'vview/widgets/mutes.js';
import Actions from 'vview/misc/actions.js';
import { IllustWidget } from 'vview/widgets/illust-widgets.js';
import { helpers } from 'vview/misc/helpers.js';
import LocalAPI from 'vview/misc/local-api.js';

export default class MoreOptionsDropdown extends IllustWidget
{
    get needed_data() { return "partial"; }

    constructor({
        // If true, show less frequently used options that are hidden by default to reduce
        // clutter.
        show_extra=false,

        ...options
    })
    {
        super({...options,
            template: `
                <div class="more-options-dropdown">
                    <div class="options vertical-list" style="min-width: 13em;"></div>
                </div>
        `});


        this.show_extra = show_extra;
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
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Similar illustrations",
                    icon: "ppixiv:suggestions",
                    requires_image: true,
                    onclick: () => {
                        this.parent.hide();

                        let [illust_id] = helpers.media_id_to_illust_id_and_page(this.media_id);
                        let args = new helpers.args(`/bookmark_detail.php?illust_id=${illust_id}#ppixiv?recommendations=1`);
                        helpers.navigate(args);
                    }
                });
            },
            similar_artists: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Similar artists",
                    icon: "ppixiv:suggestions",
                    requires_user: true,
                    onclick: () => {
                        this.parent.hide();

                        let args = new helpers.args(`/discovery/users#ppixiv?user_id=${this.user_id}`);
                        helpers.navigate(args);
                    }
                });
            },

            similar_local_images: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Similar images",
                    icon: "ppixiv:suggestions",
                    requires_image: true,
                    onclick: () => {
                        this.parent.hide();

                        let args = new helpers.args("/");
                        args.path = "/similar";
                        args.hash_path = "/#/";
                        let { id } = helpers.parse_media_id(this.media_id);
                        args.hash.set("search_path", id);
                        helpers.navigate(args);
                    }
                });
            },
            
            similar_bookmarks: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Similar bookmarks",
                    icon: "ppixiv:suggestions",
                    requires_image: true,
                    onclick: () => {
                        this.parent.hide();

                        let [illust_id] = helpers.media_id_to_illust_id_and_page(this.media_id);
                        let args = new helpers.args(`/bookmark_detail.php?illust_id=${illust_id}#ppixiv`);
                        helpers.navigate(args);
                    }
                });
            },

            index_folder: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Index similarity",
                    icon: "ppixiv:suggestions",
                    hide_if_unavailable: true,
                    requires: ({media_id}) => {
                        if(media_id == null)
                            return false;
                        let { type } = helpers.parse_media_id(media_id);
                        return type == "folder";
                    },

                    onclick: () => {
                        this.parent.hide();
                        LocalAPI.index_folder(this.media_id);
                    }
                });
            },

            edit_mutes: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Edit mutes",

                    // Only show this entry if we have at least a media ID or a user ID.
                    requires: ({media_id, user_id}) => { return media_id != null || user_id != null; },

                    icon: "mat:block",

                    onclick: async () => {
                        this.parent.hide();
                        new MutedTagsForPostDialog({
                            media_id: this.media_id,
                            user_id: this.user_id,
                        });
                    }
                });
            },

            refresh_image: () => {
                return new MenuOptionButton({
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

            share_image: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Share image",
                    icon: "mat:share",

                    // This requires an image and support for the share API.
                    requires: ({media_id}) => {
                        if(navigator.share == null)
                            return false;
                        if(media_id == null || helpers.is_media_id_local(media_id))
                            return false;

                        let media_info = ppixiv.media_cache.get_media_info_sync(media_id, { full: false });
                        return media_info && media_info.illustType != 2;
                    },

                    onclick: async () => {
                        let illust_data = await ppixiv.media_cache.get_media_info(this._media_id, { full: true });
                        let page = helpers.parse_media_id(this.media_id).page;
                        let { url } = ppixiv.media_cache.get_main_image_url(illust_data, page);

                        let title = `${illust_data.userName} - ${illust_data.illustId}`;
                        if(illust_data.mangaPages.length > 1)
                        {
                            let manga_page = helpers.parse_media_id(this._media_id).page;
                            title += " #" + (manga_page + 1);
                        }

                        title += `.${helpers.get_extension(url)}`;
                        navigator.share({
                            url,
                            title,
                        });
                    }
                });
            },

            download_image: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Download image",
                    icon: "mat:download",
                    hide_if_unavailable: true,
                    requires_image: true,
                    available: () => { return this.media_info && Actions.isDownloadTypeAvailable("image", this.media_info); },
                    onclick: () => {
                        Actions.downloadIllust(this.media_id, "image");
                        this.parent.hide();
                    }
                });
            },

            download_manga: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Download manga ZIP",
                    icon: "mat:download",
                    hide_if_unavailable: true,
                    requires_image: true,
                    available: () => { return this.media_info && Actions.isDownloadTypeAvailable("ZIP", this.media_info); },
                    onclick: () => {
                        Actions.downloadIllust(this.media_id, "ZIP");
                        this.parent.hide();
                    }
                });
            },

            download_video: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Download video MKV",
                    icon: "mat:download",
                    hide_if_unavailable: true,
                    requires_image: true,
                    available: () => { return this.media_info && Actions.isDownloadTypeAvailable("MKV", this.media_info); },
                    onclick: () => {
                        Actions.downloadIllust(this.media_id, "MKV");
                        this.parent.hide();
                    }
                });
            },

            send_to_tab: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Send to tab",
                    classes: ["button-send-image"],
                    icon: "mat:open_in_new",
                    requires_image: true,
                    onclick: () => {
                        new SendImagePopup({ media_id: this.media_id });
                        this.parent.hide();
                    }
                });
            },

            toggleSlideshow: () => {
                return new MenuOptionToggle({
                    ...shared_options,
                    label: "Slideshow",
                    icon: "mat:wallpaper",
                    requires_image: true,
                    checked: helpers.args.location.hash.get("slideshow") == "1",
                    onclick: () => {
                        ppixiv.app.toggleSlideshow();
                        this.refresh();
                    },
                });
            },

            toggle_loop: () => {
                return new MenuOptionToggle({
                    ...shared_options,
                    label: "Loop",
                    checked: helpers.args.location.hash.get("slideshow") == "loop",
                    icon: "mat:replay_circle_filled",
                    requires_image: true,
                    hide_if_unavailable: true,
                    onclick: () => {
                        ppixiv.app.loopSlideshow();
                        this.refresh();
                    },
                });
            },

            linked_tabs: () => {
                let widget = new MenuOptionToggleSetting({
                    container: option_box,
                    label: "Linked tabs",
                    setting: "linked_tabs_enabled",
                    icon: "mat:link",
                });
                
                new MenuOptionButton({
                    container: widget.container.querySelector(".checkbox"),
                    container_position: "beforebegin",
                    label: "Edit",
                    classes: ["small-font"],

                    onclick: (e) => {
                        e.stopPropagation();

                        new SettingsPageDialog({ settings_page: "linked_tabs" });

                        this.parent.hide();
                        return true;
                    },
                });

                return widget;
            },

            image_editing: () => {
                return new MenuOptionToggleSetting({
                    ...shared_options,
                    label: "Image editing",
                    icon: "mat:brush",
                    setting: "image_editing",
                    requires_image: true,

                    onclick: () => {
                        // When editing is turned off, clear the editing mode too.
                        let enabled = ppixiv.settings.get("image_editing");
                        if(!enabled)
                            ppixiv.settings.set("image_editing_mode", null);
                    },
                });
            },

            open_settings: () => {
                return new MenuOptionButton({
                    ...shared_options,
                    label: "Settings",
                    icon: "mat:settings",
                    onclick: () => {
                        new SettingsDialog();
                        this.parent.hide();
                    }
                });
            },

            exit: () => {
                return new MenuOptionButton({
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
            if(this.show_extra)
                this.menu_options.push(menu_options.similar_bookmarks());
            
            this.menu_options.push(menu_options.download_image());
            this.menu_options.push(menu_options.download_manga());
            this.menu_options.push(menu_options.download_video());
            this.menu_options.push(menu_options.edit_mutes());

            // This is hidden by default since it's special-purpose: it shares the image URL, not the
            // page URL, which is used for special-purpose iOS shortcuts stuff that probably nobody else
            // cares about.
            if(ppixiv.settings.get("show_share"))
                this.menu_options.push(menu_options.share_image());
        }
        else
        {
            this.menu_options.push(menu_options.similar_local_images());
        }

        if(ppixiv.send_image.enabled)
        {
            this.menu_options.push(menu_options.send_to_tab());
            this.menu_options.push(menu_options.linked_tabs());
        }

        // These are in the top-level menu on mobile.  Don't show these if we're on the search
        // view either, since they want to actually be on the illust view, not hovering a thumbnail.
        let screen_name = ppixiv.app.get_displayed_screen({ name: true })
        if(!ppixiv.mobile && screen_name == "illust")
        {
            this.menu_options.push(menu_options.toggleSlideshow());
            this.menu_options.push(menu_options.toggle_loop());
        }
        if(!ppixiv.mobile)
            this.menu_options.push(menu_options.image_editing());
        if(ppixiv.native)
            this.menu_options.push(menu_options.index_folder());
        if(this.show_extra || ppixiv.native)
            this.menu_options.push(menu_options.refresh_image());

        // Add settings for mobile.  On desktop, this is available in a bunch of other
        // higher-profile places.
        if(ppixiv.mobile)
            this.menu_options.push(menu_options.open_settings());

        if(!ppixiv.native && !ppixiv.mobile)
            this.menu_options.push(menu_options.exit());
    }

    setUserId(user_id)
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

        this.media_info = media_info;

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
