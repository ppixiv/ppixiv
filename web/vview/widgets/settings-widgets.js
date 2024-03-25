import Widget from '/vview/widgets/widget.js';
import { MenuOptionButton, MenuOptionRow, MenuOptionOptionsSetting, MenuOptionsThumbnailSizeSlider } from '/vview/widgets/menu-option.js';
import { MenuOptionSliderSetting, MenuOptionToggleSetting } from '/vview/widgets/menu-option.js';
import { createTranslationSettingsWidgets } from '/vview/misc/image-translation.js';
   
import { EditMutedTagsWidget } from '/vview/widgets/mutes.js';
import { LinkTabsPopup } from '/vview/misc/send-image.js';
import DialogWidget from '/vview/widgets/dialog.js';
import PointerListener from '/vview/actors/pointer-listener.js';
import { helpers } from '/vview/misc/helpers.js';
import WhatsNew from '/vview/widgets/whats-new.js';
import { ConfirmPrompt } from '/vview/widgets/prompts.js';
import LocalAPI from '/vview/misc/local-api.js';

function createSettingsWidget({ globalOptions })
{
    // Each settings widget.  Doing it this way lets us move widgets around in the
    // menu without moving big blocks of code around.
    return {
        thumbnailSize: () => {
            let button = new MenuOptionButton({
                ...globalOptions,
                label: "Thumbnail size",
            });

            new MenuOptionsThumbnailSizeSlider({
                container: button.querySelector(".widget-box"),
                setting: "thumbnail-size",
                classes: ["size-slider"],
                min: 0,
                max: 7,
            });
        },

        disabledByDefault: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Disabled by default",
                setting: "disabled-by-default",
                explanationEnabled: "Go to Pixiv by default.",
                explanationDisabled: "Go here by default.",
            });
        },

        noHideCursor: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Hide cursor",
                setting: "no-hide-cursor",
                invertDisplay: true,
                explanationEnabled: "Hide the cursor while the mouse isn't moving.",
                explanationDisabled: "Don't hide the cursor while the mouse isn't moving.",
            });
        },

        invertPopupHotkey: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Shift-right-click to show the popup menu",
                setting: "invert-popup-hotkey",
                explanationEnabled: "Shift-right-click to open the popup menu",
                explanationDisabled: "Right click opens the popup menu",
            });
        },

        ctrlOpensPopup: () => {
                return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Hold ctrl to show the popup menu",
                setting: "ctrl_opens_popup",
                explanationEnabled: "Pressing Ctrl shows the popup menu (for laptops)",
            });
        },

        uiOnHover: () => {
            new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Hover to show search box",
                setting: "ui-on-hover",
                explanationEnabled: "Only show the search box when hovering over it",
                explanationDisabled: "Always show the search box",
            });
        },

        invertScrolling: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Invert image panning",
                setting: "invert-scrolling",
                explanationEnabled: "Dragging down moves the image down",
                explanationDisabled: "Dragging down moves the image up",
            });
        },

        disableTranslations: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Show tag translations",
                setting: "disable-translations",
                invertDisplay: true,
            });
        },

        thumbnailStyle: () => {
            return new MenuOptionOptionsSetting({
                ...globalOptions,
                setting: "thumbnail_style",
                label: "Thumbnail style",
                values: {
                    aspect: "Aspect",
                    square: "Square",
                },
            });
        },

        disableThumbnailPanning: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Pan thumbnails while hovering over them",
                setting: "disable_thumbnail_panning",
                invertDisplay: true,
                shouldBeVisible: () => ppixiv.settings.get("thumbnail_style") != "aspect",
            });
        },

        disableThumbnailZooming: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Zoom out thumbnails while hovering over them",
                setting: "disable_thumbnail_zooming",
                invertDisplay: true,
                shouldBeVisible: () => ppixiv.settings.get("thumbnail_style") != "aspect",
            });
        },

        enableTransitions: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Use transitions",
                setting: "animations_enabled",
            });
        },

        bookmarkPrivatelyByDefault: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Bookmark and follow privately",
                setting: "bookmark_privately_by_default",
                explanationDisabled: ppixiv.mobile? null: "Pressing Ctrl-B will bookmark publically",
                explanationEnabled: ppixiv.mobile? null: "Pressing Ctrl-B will bookmark privately",
            });
        },

        limitSlideshowFramerate: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Limit slideshows to 60 FPS",
                setting: "slideshow_framerate",
                onValue: 60,
                offValue: null,
            });
        },

        importExtraData: () => {
            let widget = new MenuOptionRow({
                ...globalOptions,
                label: "Image edits",
            });

            new MenuOptionButton({
                icon: "file_upload",
                label: "Import",
                container: widget.root,
                onclick: () => ppixiv.extraImageData.import(),
            });

            new MenuOptionButton({
                icon: "file_download",
                label: "Export",
                container: widget.root,
                onclick: () => ppixiv.extraImageData.export(),
            });
            return widget;
        },

        stageSlideshow: () => {
            let widget = new MenuOptionRow({
                ...globalOptions,
                label: "Bookmark slideshow",
            });

            new MenuOptionButton({
                icon: "wallpaper",
                label: "Go",
                container: widget.root,
                onclick: () => {
                    // Close the settings dialog.
                    globalOptions.closeSettings();

                    SlideshowStagingDialog.show();
                },
            });

            return widget;
        },

        quickView: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Quick view",
                setting: "quick_view",
                explanationEnabled: "Navigate to images immediately when the mouse button is pressed",

                check: () => {
                    // Only enable changing this option when using a mouse.  It has no effect
                    // on touchpads.
                    if(PointerListener.pointerType == "mouse")
                        return true;

                    ppixiv.message.show("Quick View is only supported when using a mouse.");
                    return false;
                },
            });
        },

        autoPan: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Pan images",
                setting: "auto_pan",
                explanationEnabled: "Pan images while viewing them (drag the image to stop)",
            });
        },

        autoPanSpeed: () => {
            let button = new MenuOptionButton({
                ...globalOptions,
                label: "Time per image",
                getLabel: () => "Pan duration",
                explanationEnabled: (value) => {
                    let seconds = ppixiv.settings.get("auto_pan_duration");;
                    return `${seconds} ${seconds != 1? "seconds":"second"}`;                                        
                },
            });

            new MenuOptionSliderSetting({
                container: button.querySelector(".widget-box"),
                setting: "auto_pan_duration",
                list: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60],
                classes: ["size-slider"],

                // Refresh the label when the value changes.
                refresh: () => button.refresh(),
            });

            return button;
        },

        slideshowSpeed: () => {
            let button = new MenuOptionButton({
                ...globalOptions,
                label: "Time per image",
                getLabel: () => "Slideshow duration",
                explanationEnabled: (value) => {
                    let seconds = ppixiv.settings.get("slideshow_duration");;
                    return `${seconds} ${seconds != 1? "seconds":"second"}`;
                },
            });
    
            new MenuOptionSliderSetting({
                container: button.querySelector(".widget-box"),
                setting: "slideshow_duration",
                list: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180],
                classes: ["size-slider"],
                
                // Refresh the label when the value changes.
                refresh: () => { button.refresh(); },
            });
        },

        slideshowDefaultAnimation: () => {
            return new MenuOptionOptionsSetting({
                ...globalOptions,
                setting: "slideshow_default",
                label: "Slideshow mode",
                values: {
                    pan: "Pan",
                    contain: "Fade",
                },
                explanation: (value) => {
                    switch(value)
                    {
                    case "pan": return "Pan the image left-to-right or top-to-bottom";
                    case "contain": return "Fade in and out without panning";
                    }
                },
            });
        },

        slideshowSkipsManga: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Slideshow skips manga pages",
                setting: "slideshow_skips_manga",
                explanationEnabled: "Slideshow mode will only show the first page.",
                explanationDisabled: "Slideshow mode will show all pages.",
            });
        },

        displayMode: () => {
            return new MenuOptionOptionsSetting({
                ...globalOptions,
                setting: "display_mode",
                label: "Display mode",
                values: {
                    auto: "Automatic",
                    normal: "Fill the screen",
                    notch: "Rounded display",
                    safe: "Avoid the status bar",
                },
            });
        },

        expandMangaPosts: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Expand manga posts",
                setting: "expand_manga_thumbnails",
            });
        },

        viewMode: () => {
            new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Return to the top when changing images",
                setting: "view_mode",
                onValue: "manga",
                offValue: "illust",
            });
        },

        pixivCdn: () => {
            let values = { };
            for(let [setting, {name}] of Object.entries(helpers.pixiv.pixivImageHosts))
                values[setting] = name;

            return new MenuOptionOptionsSetting({
                ...globalOptions,
                setting: "pixiv_cdn",
                label: "Pixiv image host",
                values,
            });
        },

        preloadManga: () => {
            let values = {
                full: "All pages",
                partial: "Nearby pages",
                thumbnails: "Thumbnails only",
            };

            return new MenuOptionOptionsSetting({
                ...globalOptions,
                setting: "preload_manga",
                label: "Preload manga",
                values,
            });
        },

        openPixiv: () => {
            return new MenuOptionButton({
                ...globalOptions,
                label: "Open Pixiv",
                onclick: () => {
                    // On mobile, open Pixiv in a new window.  In Safari this will give a new
                    // tab where browser back will close the tab and return here.  This keeps
                    // it from becoming a browser navigation, so we don't enable back/forward
                    // gestures for the tab if possible.
                    let url = new URL("#no-ppixiv", window.location);
                    window.open(url);
                },
            });
        },

        linkTabs: () => {
            let widget = new LinkTabsPopup({
                ...globalOptions,
            });

            // Tell the widget when it's no longer visible.
            globalOptions.pageRemovedSignal.addEventListener("abort", () => { widget.visible = false; });
            return widget;
        },
        enableLinkedTabs: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Enabled",
                setting: "linkedTabs_enabled",
            });
        },
        unlinkAllTabs: () => {
            return new MenuOptionButton({
                ...globalOptions,
                label: "Unlink all tabs",
                onclick: () => {
                    ppixiv.settings.set("linked_tabs", []);
                },
            });
        },
        mutedTags: () => {
            let widget = new EditMutedTagsWidget({
                muteType: "tag",
                ...globalOptions,
            });

            // Tell the widget when it's no longer visible.
            globalOptions.pageRemovedSignal.addEventListener("abort", () => { widget.visible = false; });

            return widget;
        },
        mutedUsers: () => {
            let widget = new EditMutedTagsWidget({
                muteType: "user",
                ...globalOptions,
            });

            // Tell the widget when it's no longer visible.
            globalOptions.pageRemovedSignal.addEventListener("abort", () => { widget.visible = false; });

            return widget;
        },
        whatsNew: async() => {
            let widget = new WhatsNew({
                ...globalOptions,
            });

            globalOptions.pageRemovedSignal.addEventListener("abort", () => { widget.visible = false; });

            return widget;
        },

        nativeLogin: () => {
            return new MenuOptionButton({
                ...globalOptions,
                label: LocalAPI.localInfo.logged_in? "Log out":"Login",
                onclick: async() => {
                    let { logged_in } = LocalAPI.localInfo;
                    if(!logged_in)
                    {
                        LocalAPI.redirectToLogin();
                        return;
                    }

                    let prompt = new ConfirmPrompt({ header: "Log out?" });
                    let result = await prompt.result;
                    console.log(result);

                    if(result)
                        LocalAPI.logout();
                },
            });
        },
    };
}

let pageTitles = {
    thumbnail:  "Thumbnail options",
    image:"Image viewing",
    tagMuting: "Muted tags",
    userMuting: "Muted users",
    linkedTabs: "Linked tabs",
    translation: "Translation",
    translationOverride: "Translation",
    other: "Other",
    whatsNew: "What's New",
};

export class SettingsDialog extends DialogWidget
{
    constructor({showPage="thumbnail", ...options}={})
    {
        super({
            ...options,
            dialogClass: "settings-dialog",
            classes: ["settings-window"],
            header: "Settings",

            template: `
                <div class="sections vertical-scroller"></div>
                <div class="items vertical-scroller"></div>
            `
        });

        this.phone = helpers.other.isPhone();
        helpers.html.setClass(this.root, "phone", this.phone);
        this._pageButtons = {};

        // If we're using a phone UI, we're showing items by opening a separate dialog.  The
        // page contents block will be empty, so hide it to let the options center.
        this.root.querySelector(".items").hidden = this.phone;

        this.addPages();

        // If we're not on the phone UI, show the default page.
        showPage ??= "thumbnail";

        if(!this.phone)
            this.showPage(showPage);
    }

    addPages()
    {
        this._createPageButton("thumbnail");
        this._createPageButton("image");

        if(!ppixiv.native)
        {
            this._createPageButton("tagMuting");
            this._createPageButton("userMuting");
        }

        if(ppixiv.imageTranslations.supported)
            this._createPageButton("translation");

        if(ppixiv.sendImage.enabled)
            this._createPageButton("linkedTabs");

        this._createPageButton("other");
        this._createPageButton("whatsNew");
    }

    _createPageButton(name)
    {
        let pageButton = this.createTemplate({
            html: helpers.createBoxLink({
                label: pageTitles[name],
                classes: ["settings-page-button"],
            }),
        });
        pageButton.dataset.page = name;

        pageButton.addEventListener("click", (e) => {
            this.showPage(name);
        });
        this.root.querySelector(".sections").appendChild(pageButton);
        this._pageButtons[name] = pageButton;

        // Mark all buttons as selected on the phone UI so they're always highlighted.
        if(this.phone)
            helpers.html.setClass(pageButton, "selected", true);

        return pageButton;
    }

    showPage(settingsPage)
    {
        // If we're on a phone, create a dialog to show the page.
        if(this.phone)
        {
            this._hideAndShowPageDialog(settingsPage);
            return;
        }

        // Create the page in our items container.        
        if(this._visiblePageName == settingsPage)
            return;

        // Remove the widget page or dialog if it still exists.
        if(this._pageWidget != null)
            this._pageWidget.shutdown();
        console.assert(this._pageWidget == null);

        this._visiblePageName = settingsPage;

        if(settingsPage == null)
            return;

        this._pageWidget = this._createPage(settingsPage);
        helpers.html.setClass(this._pageButtons[settingsPage], "selected", true);
        if(!this.phone)
            this.header = pageTitles[settingsPage];

        this._pageWidget.shutdownSignal.addEventListener("abort", () => {
            this._pageWidget = null;
            helpers.html.setClass(this._pageButtons[settingsPage], "selected", false);
        });
    }

    // Hide ourself and show a settings page in a dialog.  When the page closes, open
    // ourselves again.
    async _hideAndShowPageDialog(settingsPage)
    {
        this.visible = false;

        // If this triggered a transition, wait for it to finish.  Overlapping the opening
        // and closing would be fine, but it's hard to overlap them the other way when the
        // page is closing, and it looks better to have the transition look the same both
        // ways.
        await this.visibilityChangePromise();

        let dialog = new SettingsPageDialog({ settingsPage });
        dialog.shutdownSignal.addEventListener("abort", () => {
            new SettingsDialog();
        });
    }

    _createPage(settingsPage)
    {
        let pageWidget = new Widget({
            container: this.root.querySelector(".items"),
            template: `
                <div class=settings-page></div>
            `
        });

        SettingsDialog._fillPage({
            settingsPage,
            pageWidget,
            pageContainer: pageWidget.root,
        });

        return pageWidget;
    }

    static _fillPage({ settingsPage, pageWidget, pageContainer })
    {
        // Set settings-list if this page is a list of options, like the thumbnail options page.
        // This class enables styling for these lists.  If it's another type of settings page
        // with its own styling, this is disabled.
        let isSettingsList = settingsPage != "tagMuting" && settingsPage != "userMuting";
        if(isSettingsList)
            pageContainer.classList.add("settings-list");

        // Options that we pass to all menu options:
        let globalOptions = {
            classes: ["settings-row"],
            container: pageContainer,
            pageRemovedSignal: pageWidget.shutdownSignal,

            // Settings widgets can call this to close the window.
            closeSettings: () => {
                this.visible = false;
            },
        };

        // This gives us a dictionary of functions we can use to create each settings widget.
        let settingsWidgets = createSettingsWidget({ globalOptions });

        let pages = {
            thumbnail: () =>
            {
                settingsWidgets.thumbnailSize();
                settingsWidgets.thumbnailStyle();
                if(!ppixiv.mobile)
                {
                    settingsWidgets.disableThumbnailPanning();
                    settingsWidgets.disableThumbnailZooming();
                    settingsWidgets.quickView();
                    settingsWidgets.uiOnHover();
                }
                
                if(!ppixiv.native)
                    settingsWidgets.expandMangaPosts();
            },
            image: () => {
                settingsWidgets.autoPan();
                settingsWidgets.autoPanSpeed();
                settingsWidgets.slideshowSpeed();
                settingsWidgets.slideshowDefaultAnimation();
                if(!ppixiv.native) // native mode doesn't support manga pages
                    settingsWidgets.slideshowSkipsManga();

                if(ppixiv.mobile)
                    settingsWidgets.displayMode();
                
                settingsWidgets.viewMode();
                if(!ppixiv.mobile)
                {
                    settingsWidgets.invertScrolling();
                    settingsWidgets.noHideCursor();
                }
            },

            tagMuting: () => {
                settingsWidgets.mutedTags();
            },

            userMuting: () => {
                settingsWidgets.mutedUsers();
            },

            linkedTabs: () => {
                settingsWidgets.linkTabs();
                settingsWidgets.unlinkAllTabs();
            },

            // ImageTranslations handles these settings.  translationOverride is the settings override version
            // when we're viewing an image.
            translation: () => createTranslationSettingsWidgets({ globalOptions, editOverrides: false }),
            translationOverride: () => createTranslationSettingsWidgets({ globalOptions, editOverrides: true }),

            other: () => {
                if(ppixiv.native && !LocalAPI.localInfo.local)
                    settingsWidgets.nativeLogin();

                settingsWidgets.disableTranslations();

                if(!ppixiv.native && !ppixiv.mobile)
                    settingsWidgets.disabledByDefault();
                    
                if(!ppixiv.mobile)
                {
                    // Firefox's contextmenu behavior is broken, so hide this option.
                    if(navigator.userAgent.indexOf("Firefox/") == -1)
                        settingsWidgets.invertPopupHotkey();
        
                    settingsWidgets.ctrlOpensPopup();
                    settingsWidgets.enableTransitions();
                }
        
                settingsWidgets.bookmarkPrivatelyByDefault();

                if(!ppixiv.mobile)
                    settingsWidgets.limitSlideshowFramerate();
        
                if(!ppixiv.native)
                {
                    settingsWidgets.pixivCdn();
                    settingsWidgets.preloadManga();
                }

                if(!ppixiv.native && ppixiv.mobile)
                    settingsWidgets.openPixiv();

                // Chrome supports showOpenFilePicker, but Firefox doesn't.  That API has been around in
                // Chrome for a year and a half, so I haven't implemented an alternative for Firefox.
                if(!ppixiv.native && window.showOpenFilePicker != null)
                    settingsWidgets.importExtraData();
        
                // Slideshow staging isn't useful on mobile with Pixiv since we can't run ourself as
                // a PWA.
                if(ppixiv.native || !ppixiv.mobile)
                    settingsWidgets.stageSlideshow();
            },

            whatsNew: () => {
                settingsWidgets.whatsNew();
            },
        };

        let createPage = pages[settingsPage];
        if(createPage == null)
        {
            console.error(`Invalid settings page: ${settingsPage}`);
            return;
        }

        createPage();
        
        // Add allow-wrap to all top-level box links that we just created, so the
        // settings menu scales better.  Don't recurse into nested buttons.
        for(let boxLink of pageContainer.querySelectorAll(".settings-page > .box-link"))
            boxLink.classList.add("allow-wrap");
    }
};

// This is used when we're on the phone UI to show a single settings page.
export class SettingsPageDialog extends DialogWidget
{
    constructor({
        settingsPage,
        ...options}={})
    {
        super({
            header: pageTitles[settingsPage],

            ...options,
            dialogClass: "settings-dialog-page",

            // This is a nested dialog and closing it goes back to settings, so show
            // a back button instead of a close button.
            backIcon: true,
            template: ``
        });

        this._settingsContainer = this.querySelector(".scroll");
        this._settingsContainer.classList.add("settings-page");

        SettingsDialog._fillPage({
            settingsPage,
            pageWidget: this,
            pageContainer: this._settingsContainer,
        });
    }
};


// Open a tab that can be used to bookmark a slideshow or save to home screen.
//
// This is made tricky by iOS limitations: it tries to save the URL the page was originally
// loaded with, not the current URL.  To work around this, we have to open the URL in a new
// tab with the URL we want.
//
// On mobile this is meant to run the page in PWA mode.  This won't work with Pixiv, since
// user scripts don't work in that mode.  Pixiv also has a manifest that'll force the URL
// to the root, which also makes this not work.  So, this is only really useful with vview,
// but it can technically be used on desktop too.
export class SlideshowStagingDialog extends DialogWidget
{
    static show()
    {
        let slideshowArgs = ppixiv.app.slideshowURL;
        if(slideshowArgs == null)
            return;

        let url = slideshowArgs.toString();

        // Open a tab for the dialog.  Storing the dialog as window.slideshowStagingDialog
        // tells the dialog that it's a staging dialog without having to put anything in the
        // URL.
        window.slideshowStagingDialog = window.open(url);
    }

    constructor({...options}={})
    {
        // Nobody can agree on terminology for this, and this text should be short and clear,
        // so tweak it based on the platform.
        let text = ppixiv.mobile? `
            Add this page to your home screen for a slideshow of the current search.
        `: `
            Install this page as an app for a slideshow bookmark for the current search.
        `;
        super({...options, showCloseButton: false, header: "Slideshow", template: `
            <div class=items style="font-size: 1.5rem; text-align: center;">
                ${text}
            </div>
        `});

        this.url = helpers.args.location;
        document.title = window.opener.document.title;

        // If we see an appinstalled event when in Chrome, it stole the tab and turned it into
        // a standalone window.  Clear slideshowStagingDialog and reload the page to turn into
        // the bookmarked window.  Only do this on desktop, since this doesn't happen on mobile
        // so this reload is confusing.
        window.addEventListener("appinstalled", (e) => {
            if(ppixiv.mobile)
                return;

            window.opener.slideshowStagingDialog = null;
            window.location.reload();
        });

        // Close the tab if the dialog is closed.  There's nothing left on the screen.
        // We're usually able to do this, since we opened the tab ourself.
        this.shutdownSignal.addEventListener("abort", () => window.close());
    }

    visibilityChanged()
    {
        super.visibilityChanged();

        if(!this.visible)
        {
            // If the URL is still pointing at the slideshow, back out to restore the original
            // URL.  This is needed if we're exiting from the user clicking out of the dialog,
            // but don't do it if we're exiting from browser back.
            if(helpers.args.location.toString() == this.url.toString())
                ppixiv.phistory.back();
        }
    }
}
