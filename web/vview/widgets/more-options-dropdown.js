// The "More..." dropdown menu shown in the options menu.

import { SettingsDialog, SettingsPageDialog } from '/vview/widgets/settings-widgets.js';
import { SendImagePopup } from '/vview/misc/send-image.js';
import { MenuOptionButton, MenuOptionToggle, MenuOptionToggleSetting } from '/vview/widgets/menu-option.js';
import { MutedTagsForPostDialog } from '/vview/widgets/mutes.js';
import { MenuOptionToggleImageTranslation } from '/vview/misc/image-translation.js';
import Actions from '/vview/misc/actions.js';
import { IllustWidget } from '/vview/widgets/illust-widgets.js';
import { helpers } from '/vview/misc/helpers.js';
import LocalAPI from '/vview/misc/local-api.js';

export default class MoreOptionsDropdown extends IllustWidget
{
    get neededData() { return "partial"; }

    constructor({
        // If true, show less frequently used options that are hidden by default to reduce
        // clutter.
        showExtra=false,

        ...options
    })
    {
        super({...options,
            template: `
                <div class="more-options-dropdown">
                    <div class="options vertical-list" style="min-width: 13em;"></div>
                </div>
        `});


        this.showExtra = showExtra;
        this._menuOptions = [];
    }

    _createMenuOptions()
    {
        let optionBox = this.root.querySelector(".options");
        let sharedOptions = {
            container: optionBox,
            parent: this,
        };

        for(let item of this._menuOptions)
            item.root.remove();

        let menuOptions = {
            similarIllustrations: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Similar illustrations",
                    icon: "ppixiv:suggestions",
                    requiresImage: true,
                    onclick: () => {
                        this.parent.hide();

                        let [illustId] = helpers.mediaId.toIllustIdAndPage(this.mediaId);
                        let args = new helpers.args(`/bookmark_detail.php?illust_id=${illustId}#ppixiv?recommendations=1`);
                        helpers.navigate(args);
                    }
                });
            },
            similarArtists: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Similar artists",
                    icon: "ppixiv:suggestions",
                    requiresUser: true,
                    onclick: () => {
                        this.parent.hide();

                        let args = new helpers.args(`/discovery/users#ppixiv?user_id=${this._effectiveUserId}`);
                        helpers.navigate(args);
                    }
                });
            },

            similarLocalImages: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Similar images",
                    icon: "ppixiv:suggestions",
                    requiresImage: true,
                    onclick: () => {
                        this.parent.hide();

                        let args = new helpers.args("/");
                        args.path = "/similar";
                        args.hashPath = "/#/";
                        let { id } = helpers.mediaId.parse(this.mediaId);
                        args.hash.set("search_path", id);
                        helpers.navigate(args);
                    }
                });
            },
            
            similarBookmarks: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Similar bookmarks",
                    icon: "ppixiv:suggestions",
                    requiresImage: true,
                    onclick: () => {
                        this.parent.hide();

                        let [illustId] = helpers.mediaId.toIllustIdAndPage(this.mediaId);
                        let args = new helpers.args(`/bookmark_detail.php?illust_id=${illustId}#ppixiv`);
                        helpers.navigate(args);
                    }
                });
            },

            indexFolderForSimilaritySearch: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Index similarity",
                    icon: "ppixiv:suggestions",
                    hideIfUnavailable: true,
                    requires: ({mediaId}) => {
                        if(mediaId == null)
                            return false;

                        let { type } = helpers.mediaId.parse(mediaId);
                        return type == "folder";
                    },

                    onclick: () => {
                        this.parent.hide();
                        LocalAPI.indexFolderForSimilaritySearch(this.mediaId);
                    }
                });
            },

            toggleUpscaling: () => {
                return new MenuOptionToggleSetting({
                    ...sharedOptions,
                    label: "GPU upscaling",
                    icon: "mat:zoom_out_map",
                    requiresImage: true,
                    setting: "upscaling",
                });
            },

            editMutes: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Edit mutes",

                    // Only show this entry if we have at least a media ID or a user ID.
                    requires: ({mediaId, userId}) => { return mediaId != null || userId != null; },

                    icon: "mat:block",

                    onclick: async () => {
                        this.parent.hide();
                        new MutedTagsForPostDialog({
                            mediaId: this.mediaId,
                            userId: this._effectiveUserId,
                        });
                    }
                });
            },

            refreshImage: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Refresh image",
                    requiresImage: true,
                    icon: "mat:refresh",

                    onclick: async () => {
                        this.parent.hide();
                        ppixiv.mediaCache.refreshMediaInfo(this.mediaId, { refreshFromDisk: true });
                    }
                });
            },

            shareImage: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Share image",
                    icon: "mat:share",

                    // This requires an image and support for the share API.
                    requires: ({mediaId}) => {
                        if(navigator.share == null)
                            return false;
                        if(mediaId == null || helpers.mediaId.isLocal(mediaId))
                            return false;

                        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
                        return mediaInfo && mediaInfo.illustType != 2;
                    },

                    onclick: async () => {
                        let mediaInfo = await ppixiv.mediaCache.getMediaInfo(this._mediaId, { full: true });
                        let page = helpers.mediaId.parse(this.mediaId).page;
                        let { url } = mediaInfo.getMainImageUrl(page);

                        let title = `${mediaInfo.userName} - ${mediaInfo.illustId}`;
                        if(mediaInfo.mangaPages.length > 1)
                        {
                            let mangaPage = helpers.mediaId.parse(this._mediaId).page;
                            title += " #" + (mangaPage + 1);
                        }

                        title += `.${helpers.strings.getExtension(url)}`;
                        navigator.share({
                            url,
                            title,
                        });
                    }
                });
            },

            downloadImage: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Download image",
                    icon: "mat:download",
                    hideIfUnavailable: true,
                    requiresImage: true,
                    available: () => { return this.mediaInfo && Actions.isDownloadTypeAvailable("image", this.mediaInfo); },
                    onclick: () => {
                        Actions.downloadIllust(this.mediaId, "image");
                        this.parent.hide();
                    }
                });
            },

            downloadManga: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Download manga ZIP",
                    icon: "mat:download",
                    hideIfUnavailable: true,
                    requiresImage: true,
                    available: () => { return this.mediaInfo && Actions.isDownloadTypeAvailable("ZIP", this.mediaInfo); },
                    onclick: () => {
                        Actions.downloadIllust(this.mediaId, "ZIP");
                        this.parent.hide();
                    }
                });
            },

            downloadVideo: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Download video MKV",
                    icon: "mat:download",
                    hideIfUnavailable: true,
                    requiresImage: true,
                    available: () => { return this.mediaInfo && Actions.isDownloadTypeAvailable("MKV", this.mediaInfo); },
                    onclick: () => {
                        Actions.downloadIllust(this.mediaId, "MKV");
                        this.parent.hide();
                    }
                });
            },

            sendToTab: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
                    label: "Send to tab",
                    classes: ["button-send-image"],
                    icon: "mat:open_in_new",
                    requiresImage: true,
                    onclick: () => {
                        new SendImagePopup({ mediaId: this.mediaId });
                        this.parent.hide();
                    }
                });
            },

            toggleSlideshow: () => {
                return new MenuOptionToggle({
                    ...sharedOptions,
                    label: "Slideshow",
                    icon: "mat:wallpaper",
                    requiresImage: true,
                    checked: helpers.args.location.hash.get("slideshow") == "1",
                    onclick: () => {
                        ppixiv.app.toggleSlideshow();
                        this.refresh();
                    },
                });
            },

            toggleLoop: () => {
                return new MenuOptionToggle({
                    ...sharedOptions,
                    label: "Loop",
                    checked: helpers.args.location.hash.get("slideshow") == "loop",
                    icon: "mat:replay_circle_filled",
                    requiresImage: true,
                    hideIfUnavailable: true,
                    onclick: () => {
                        ppixiv.app.loopSlideshow();
                        this.refresh();
                    },
                });
            },

            linkedTabs: () => {
                let widget = new MenuOptionToggleSetting({
                    container: optionBox,
                    label: "Linked tabs",
                    setting: "linked_tabs_enabled",
                    icon: "mat:link",
                });
                
                new MenuOptionButton({
                    container: widget.root.querySelector(".checkbox"),
                    containerPosition: "beforebegin",
                    icon: "mat:settings",
                    classes: ["small-font"],

                    onclick: (e) => {
                        e.stopPropagation();

                        new SettingsPageDialog({ settingsPage: "linkedTabs" });

                        this.parent.hide();
                        return true;
                    },
                });

                return widget;
            },

            imageEditing: () => {
                return new MenuOptionToggleSetting({
                    ...sharedOptions,
                    label: "Image editing",
                    icon: "mat:brush",
                    setting: "image_editing",
                    requiresImage: true,

                    onclick: () => {
                        // When editing is turned off, clear the editing mode too.
                        let enabled = ppixiv.settings.get("image_editing");
                        if(!enabled)
                            ppixiv.settings.set("image_editing_mode", null);
                    },
                });
            },

            openSettings: () => {
                return new MenuOptionButton({
                    ...sharedOptions,
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
                    ...sharedOptions,
                    label: "Return to Pixiv",
                    icon: "mat:logout",
                    url: "#no-ppixiv",
                });
            },

            toggleTranslations: () => {
                let isEnabled = () => {
                    if(this.mediaId == null || this.mediaInfo == null)
                        return false;

                    // Disable this for animations.
                    return this.mediaInfo.illustType != 2;
                };

                let widget = new MenuOptionToggleImageTranslation({
                    ...sharedOptions,
                    requires: () => isEnabled(),
                    mediaId: this.mediaId,
                    label: "Translate",
                    icon: "mat:translate",
                });

                new MenuOptionButton({
                    container: widget.root.querySelector(".checkbox"),
                    containerPosition: "beforebegin",
                    icon: "mat:settings",
                    classes: ["small-font"],

                    onclick: (e) => {
                        e.stopPropagation();

                        // Don't show the per-image options dialog if translations aren't supported for
                        // this image.
                        if(!isEnabled())
                            return;

                        new SettingsPageDialog({ settingsPage: "translationOverride" });

                        this.parent.hide();
                        return true;
                    },
                });

                return widget;
            },
        };

        let screenName = ppixiv.app.getDisplayedScreen();
        this._menuOptions = [];
        if(!ppixiv.native)
        {
            this._menuOptions.push(menuOptions.similarIllustrations());
            this._menuOptions.push(menuOptions.similarArtists());
            if(this.showExtra)
                this._menuOptions.push(menuOptions.similarBookmarks());
            
            this._menuOptions.push(menuOptions.downloadImage());
            this._menuOptions.push(menuOptions.downloadManga());
            this._menuOptions.push(menuOptions.downloadVideo());
            this._menuOptions.push(menuOptions.editMutes());

            // This is hidden by default since it's special-purpose: it shares the image URL, not the
            // page URL, which is used for special-purpose iOS shortcuts stuff that probably nobody else
            // cares about.
            if(ppixiv.settings.get("show_share"))
                this._menuOptions.push(menuOptions.shareImage());
        }
        else
        {
            this._menuOptions.push(menuOptions.similarLocalImages());
        }

        if(screenName == "illust" && ppixiv.imageTranslations.supported)
            this._menuOptions.push(menuOptions.toggleTranslations());

        if(ppixiv.sendImage.enabled)
        {
            this._menuOptions.push(menuOptions.sendToTab());
            this._menuOptions.push(menuOptions.linkedTabs());
        }

        // These are in the top-level menu on mobile.  Don't show these if we're on the search
        // view either, since they want to actually be on the illust view, not hovering a thumbnail.
        if(screenName == "illust")
        {
            this._menuOptions.push(menuOptions.toggleSlideshow());
            this._menuOptions.push(menuOptions.toggleLoop());
        }
        if(!ppixiv.mobile)
            this._menuOptions.push(menuOptions.imageEditing());
        if(ppixiv.native)
        {
            this._menuOptions.push(menuOptions.indexFolderForSimilaritySearch());
            this._menuOptions.push(menuOptions.toggleUpscaling());
        }
        if(this.showExtra || ppixiv.native)
            this._menuOptions.push(menuOptions.refreshImage());

        // Add settings for mobile.  On desktop, this is available in a bunch of other
        // higher-profile places.
        if(ppixiv.mobile)
            this._menuOptions.push(menuOptions.openSettings());

        if(!ppixiv.native && !ppixiv.mobile)
            this._menuOptions.push(menuOptions.exit());

        window.vviewHooks?.dropdownMenuOptions?.({ moreOptionsDropdown: this, sharedOptions });
    }

    setUserId(userId)
    {
        this._userId = userId;
        this.refresh();
    }

    visibilityChanged()
    {
        if(this.visible)
            this.refresh();
    }

    // If a user ID was specified explicitly, return it.  Otherwise, return mediaId's user if we know it.
    get _effectiveUserId()
    {
        return this._userId ?? this.mediaInfo?.userId;
    }

    async refreshInternal({ mediaId, mediaInfo })
    {
        if(!this.visible)
            return;

        this._createMenuOptions();

        this.mediaInfo = mediaInfo;

        for(let option of this._menuOptions)
        {
            let enable = true;
    
            // Enable or disable buttons that require an image.
            if(option.options.requiresImage && mediaId == null)
                enable = false;
            if(option.options.requiresUser && this._effectiveUserId == null)
                enable = false;
            if(option.options.requires && !option.options.requires({mediaId, userId: this._effectiveUserId}))
                enable = false;
            if(enable && option.options.available)
                enable = option.options.available();
            option.enabled = enable;

            // Some options are hidden when they're unavailable, because they clutter
            // the menu too much.
            if(option.options.hideIfUnavailable)
                option.root.hidden = !enable;
        }
    }
}
