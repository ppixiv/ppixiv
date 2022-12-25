import Widget from 'vview/widgets/widget.js';
import { MenuOptionButton, MenuOptionRow, MenuOptionOptionsSetting, MenuOptionsThumbnailSizeSlider } from 'vview/widgets/menu-option.js';
import { MenuOptionSliderSetting, MenuOptionToggleSetting } from 'vview/widgets/menu-option.js';
   
import { EditMutedTagsWidget } from 'vview/widgets/mutes.js';
import { LinkTabsPopup } from 'vview/misc/send-image.js';
import DialogWidget from 'vview/widgets/dialog.js';
import PointerListener from 'vview/actors/pointer-listener.js';
import { helpers } from 'vview/misc/helpers.js';
import WhatsNew from "vview/widgets/whats-new.js";

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
                container: button.container,
                setting: "thumbnail-size",
                classes: ["size-slider"],
                min: 0,
                max: 7,
            }),
    
            button.container.querySelector(".size-slider").style.flexGrow = .25;
        },

        mangaThumbnailSize: () => {
            let button = new MenuOptionButton({
                ...globalOptions,
                label: "Thumbnail size (manga)",
            });

            new MenuOptionsThumbnailSizeSlider({
                container: button.container,
                setting: "manga-thumbnail-size",
                classes: ["size-slider"],
                min: 0,
                max: 7,
            }),
    
            button.container.querySelector(".size-slider").style.flexGrow = .25;
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

        theme: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Light mode",
                setting: "theme",
                onValue: "light",
                offValue: "dark",
                explanationEnabled: "FLASHBANG",
            });
        },

        disableTranslations: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Show tag translations when available",
                setting: "disable-translations",
                invertDisplay: true,
            });
        },

        disableThumbnailPanning: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Pan thumbnails while hovering over them",
                setting: "disable_thumbnail_panning",
                invertDisplay: true,
            });
        },

        disableThumbnailZooming: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Zoom out thumbnails while hovering over them",
                setting: "disable_thumbnail_zooming",
                invertDisplay: true,
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
                label: "Bookmark and follow privately by default",
                setting: "bookmark_privately_by_default",
                explanationDisabled: "Pressing Ctrl-B will bookmark publically",
                explanationEnabled: "Pressing Ctrl-B will bookmark privately",
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
                container: widget.container,
                onclick: () => ppixiv.extraImageData.import(),
            });

            new MenuOptionButton({
                icon: "file_download",
                label: "Export",
                container: widget.container,
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
                container: widget.container,
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
                getLabel: () => {
                    let seconds = ppixiv.settings.get("auto_pan_duration");;
                    return `Pan duration: ${seconds} ${seconds != 1? "seconds":"second"}`;                                        
                },
            });

            new MenuOptionSliderSetting({
                container: button,
                setting: "auto_pan_duration",
                list: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60],
                classes: ["size-slider"],

                // Refresh the label when the value changes.
                refresh: () => button.refresh(),
            });

            button.container.querySelector(".size-slider").style.flexGrow = .25;
    
            return button;
        },

        slideshowSpeed: () => {
            let button = new MenuOptionButton({
                ...globalOptions,
                label: "Time per image",
                getLabel: () => {
                    let seconds = ppixiv.settings.get("slideshow_duration");;
                    return `Slideshow duration: ${seconds} ${seconds != 1? "seconds":"second"}`;
                },
            });
    
            new MenuOptionSliderSetting({
                container: button,
                setting: "slideshow_duration",
                list: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180],
                classes: ["size-slider"],
                
                // Refresh the label when the value changes.
                refresh: () => { button.refresh(); },
            });

            button.container.querySelector(".size-slider").style.flexGrow = .25;
        },

        slideshowDefaultAnimation: () => {
            return new MenuOptionOptionsSetting({
                ...globalOptions,
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

        slideshowSkipsManga: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Slideshow skips manga pages",
                setting: "slideshow_skips_manga",
                explanationEnabled: "Slideshow mode will only show the first page.",
                explanationDisabled: "Slideshow mode will show all pages.",
            });
        },

        expandMangaPosts: () => {
            return new MenuOptionToggleSetting({
                ...globalOptions,
                label: "Expand manga posts in search results",
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
    };
}

let pageTitles = {
    thumbnail:  "Thumbnail options",
    image:"Image viewing",
    tagMuting: "Muted tags",
    userMuting: "Muted users",
    linkedTabs: "Linked tabs",
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

        this.phone = helpers.is_phone();
        helpers.setClass(this.container, "phone", this.phone);
        this._pageButtons = {};

        // If we're using a phone UI, we're showing items by opening a separate dialog.  The
        // page contents block will be empty, so hide it to let the options center.
        this.container.querySelector(".items").hidden = this.phone;

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
        this.container.querySelector(".sections").appendChild(pageButton);
        this._pageButtons[name] = pageButton;

        return pageButton;
    }

    showPage(name)
    {
        if(this._visiblePageName == name)
            return;

        // Remove the widget page or dialog if it still exists.
        if(this._pageWidget != null)
            this._pageWidget.shutdown();
        console.assert(this._pageWidget == null);

        this._visiblePageName = name;

        if(name != null)
        {
            this._pageWidget = this._createPage(name);
            helpers.setClass(this._pageButtons[name], "selected", true);
            if(!this.phone)
                this.header = pageTitles[name];

            this._pageWidget.shutdownSignal.signal.addEventListener("abort", () => {
                this._pageWidget = null;
                helpers.setClass(this._pageButtons[name], "selected", false);
            });
        }
    }

    _createPage(settingsPage)
    {
        // If we're on a phone, create a dialog to show the page.  Otherwise, create the page in our
        // items container.
        if(this.phone)
            return new SettingsPageDialog({ settingsPage });

        let pageWidget = new Widget({
            container: this.container.querySelector(".items"),
            template: `
                <div class=settings-page></div>
            `
        });

        SettingsDialog._fillPage({
            settingsPage,
            pageWidget,
            pageContainer: pageWidget.container,
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
            pageRemovedSignal: pageWidget.shutdownSignal.signal,

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
                if(!ppixiv.native)
                    settingsWidgets.mangaThumbnailSize();
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

            other: () => {
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
        
                // settingsWidgets.theme();
                settingsWidgets.bookmarkPrivatelyByDefault();
                settingsWidgets.limitSlideshowFramerate();
        
                // Chrome supports showOpenFilePicker, but Firefox doesn't.  That API has been around in
                // Chrome for a year and a half, so I haven't implemented an alternative for Firefox.
                if(!ppixiv.native && window.showOpenFilePicker != null)
                    settingsWidgets.importExtraData();
        
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


// Set the page URL to a slideshow, but don't actually start the slideshow.  This lets the
// user bookmark the slideshow URL before the illust ID changes from "*" to an actual ID.
// This is mostly just a workaround for an iOS UI bug: there's no way to create a home
// screen bookmark for a link, only for a URL that's already loaded.
//
// This is usually used from the search screen, but there's currently no good place to put
// it there, so it's inside the settings menu and technically can be accessed while viewing
// an image.
class SlideshowStagingDialog extends DialogWidget
{
    static show()
    {
        let slideshowArgs = ppixiv.app.slideshowURL;
        if(slideshowArgs == null)
            return;

        // Set the slideshow URL without sending popstate, so it'll be the current browser URL
        // that can be bookmarked but we won't actually navigate to it.  We don't want to navigate
        // to it since that'll change the placeholder "*" illust ID to a real illust ID, which
        // isn't what we want to bookmark.
        helpers.navigate(slideshowArgs, { sendPopstate: false });

        new SlideshowStagingDialog();
    }

    constructor({...options}={})
    {
        super({...options, header: "Slideshow",
        template: `
            <div class=items>
                This page can be bookmarked. or added to the home screen on iOS.<br>
                <br>
                The bookmark will begin a slideshow with the current search.
            </div>
        `});

        this.url = helpers.args.location;
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
