// The image UI for mobile.

import Widget from 'vview/widgets/widget.js';
import { BookmarkButtonWidget } from 'vview/widgets/illust-widgets.js';
import MoreOptionsDropdown from 'vview/widgets/more-options-dropdown.js';
import { BookmarkTagListWidget } from 'vview/widgets/bookmark-tag-list.js';
import { AvatarWidget } from 'vview/widgets/user-widgets.js';
import { IllustWidget } from 'vview/widgets/illust-widgets.js';
import DialogWidget from 'vview/widgets/dialog.js';
import LocalAPI from 'vview/misc/local-api.js';
import WidgetDragger from 'vview/actors/widget-dragger.js';
import IsolatedTapHandler from 'vview/actors/isolated-tap-handler.js';
import { helpers, ClassFlags, OpenWidgets } from 'vview/misc/helpers.js';

// The container for the mobile image UI.  This just creates and handles displaying
// the tabs.
export default class MobileImageUI extends Widget
{
    constructor({
        // This node receives our drag animation property.  This goes on the screen instead of
        // us, so the video UI can see it too.
        transitionTarget,

        ...options
    })
    {
        super({...options, template: `
            <div class=mobile-illust-ui-container>
                <div class=context-menu-image-info-container></div>
            </div>
        `});
        
        this.transitionTarget = transitionTarget;

        this.infoWidget = new ImageInfoWidget({
            container: this.root.querySelector(".context-menu-image-info-container"),
        });

        this.page = new IllustBottomMenuBar({
            container: this.root,
        });
        
        this.dragger = new WidgetDragger({
            parent: this,
            name: "menu-dragger",
            // Put the --menu-bar-pos property up high, since the video UI also uses it.
            nodes: [this.transitionTarget],
            dragNode: this.root.parentNode,
            size: () => 150,
            animatedProperty: "--menu-bar-pos",
            direction: "down",

            oncancelled: ({otherDragger}) => {
                if(!this.dragger.visible)
                    return;

                // Hide the menu if another dragger starts, so we hide if the image changer, pan/zoom,
                // etc. begin.  We do it this way and not with a ClickOutsideListener so we don't
                // close when a new menu drag starts.
                this.dragger.hide();

                // Prevent IsolatedTapHandler, so it doesn't trigger from this press and reopen us.
                IsolatedTapHandler.preventTaps();
            },
            onbeforeshown: () => this.visibilityChanged(),
            onafterhidden: () => this.visibilityChanged(),
            onactive: () => this.visibilityChanged(),
            oninactive: () => this.visibilityChanged(),
        });

        this._mediaId = null;

        this.refresh();
    }

    // Hide if our tree becomes hidden.
    visibleRecursivelyChanged()
    {
        super.visibleRecursivelyChanged();

        if(!this.visibleRecursively)
            this.hide();
    }

    set mediaId(mediaId)
    {
        if(this._mediaId == mediaId)
            return;

        // We'll apply the media ID to our children in refresh().
        this._mediaId = mediaId;

        this.refresh();
    }
    get mediaId() { return this._mediaId; }

    setDataSource(dataSource)
    {
        this.page.setDataSource(dataSource);
    }

    get actuallyVisible()
    {
        return this.dragger.visible;
    }
    
    visibilityChanged()
    {
        super.visibilityChanged();

        let visible = this.actuallyVisible;

        // Only hide if we're actually not visible, so we're hidden if we're offscreen but
        // visible for transitions.
        this.root.hidden = !visible;

        helpers.html.setClass(document.documentElement, "illust-menu-visible", visible);

        // This enables pointer-events only when the animation is finished.  This avoids problems
        // with iOS sending clicks to the button when it wasn't pressable when the touch started.
        helpers.html.setClass(this.root, "fully-visible", visible && !this.dragger.isAnimationPlaying);

        this.refresh();
    }

    show()
    {
        this.dragger.show();        
    }

    hide()
    {
        this.dragger.hide();        
    }

    toggle()
    {
        if(this.dragger.visible)
            this.hide();
        else
            this.show();
    }

    refresh()
    {
        // Don't refresh while we're hiding, so we don't flash the next page's info while we're
        // hiding right after the page is dragged.  This shouldn't happen when displaying, since
        // our media ID should be set before show() is called.
        if(this.dragger.isAnimationPlaying)
            return;

        this.infoWidget.setMediaId(this._mediaId);
        this.page.mediaId = this._mediaId;

        // Set data-mobile-ui-visible if we're fully visible so other UIs can tell if this UI is
        // open.
        let fullyVisible = this.dragger.position == 1;
        ClassFlags.get.set("mobile-ui-visible", fullyVisible);

        // Add ourself to OpenWidgets if we're visible at all.
        let visible = this.actuallyVisible;
        OpenWidgets.singleton.set(this, visible);

        this.page.refresh();
    }
}

class IllustBottomMenuBar extends Widget
{
    constructor({template, ...options})
    {
        super({...options, visible: true, template: `
            <div class=mobile-illust-ui-page>
                <div class="item button-toggle-slideshow enabled">
                    ${ helpers.createIcon("mat:wallpaper") }
                    <span class=label>Slideshow</span>
                </div>

                <div class="item button-toggle-loop enabled">
                    ${ helpers.createIcon("mat:replay_circle_filled") }
                    <span class=label>Loop</span>
                </div>

                <vv-container class="bookmark-button-container"></vv-container>

                <div class="item button-similar enabled">
                    ${ helpers.createIcon("ppixiv:suggestions") }
                    <span class=label>Similar</span>
                </div>

                <div class="item button-view-manga enabled">
                    ${ helpers.createIcon("ppixiv:thumbnails") }
                    <span class=label>Pages</span>
                </div>

                <div class="item button-more enabled">
                    ${ helpers.createIcon("settings") }
                    <span class=label>More...</span>
                </div>
            </div>
        `});

        this._mediaId = null;

        this.root.querySelector(".button-view-manga").addEventListener("click", this.clickedViewManga);

        this.toggleSlideshowButton = this.root.querySelector(".button-toggle-slideshow");
        this.toggleSlideshowButton.addEventListener("click", (e) => {
            ppixiv.app.toggleSlideshow();
            this.parent.hide();
            this.refresh();
        });

        this.toggleLoopButton = this.root.querySelector(".button-toggle-loop");
        this.toggleLoopButton.addEventListener("click", (e) => {
            ppixiv.app.loopSlideshow();
            this.parent.hide();
            this.refresh();
        });
        
        this.root.querySelector(".button-more").addEventListener("click", (e) => {
            new MoreOptionsDialog({
                mediaId: this._mediaId
            });

            this.parent.hide();
        });

        this.buttonBookmark = this.root.querySelector(".bookmark-button-container");
        this.bookmarkButtonWidget = new ImageBookmarkedWidget({ container: this.buttonBookmark });

        this.buttonSlider = this.root.querySelector(".button-similar");
        this.buttonSlider.hidden = ppixiv.native;
        this.buttonSlider.addEventListener("click", (e) => {
            let [illustId] = helpers.mediaId.toIllustIdAndPage(this._mediaId);
            let args = new helpers.args(`/bookmark_detail.php?illust_id=${illustId}#ppixiv?recommendations=1`);
            helpers.navigate(args);
        });

        this.buttonBookmark.addEventListener("click", (e) => {
            new BookmarkTagDialog({
                mediaId: this._mediaId
            });
            
            this.parent.hide();
        });

        // This tells widgets that want to be above us how tall we are.
        helpers.html.setHeightAsProperty(this.root, "--menu-bar-height", {
            target: this.closest(".screen"),
            ...this._signal
        });
    }

    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        this.dataSource = dataSource;

        this.refresh();
    }

    set mediaId(mediaId)
    {
        if(this._mediaId == mediaId)
            return;

        this._mediaId = mediaId;
        this.refresh();
    }

    refresh()
    {
        super.refresh();

        // If we're not visible, don't refresh an illust until we are, so we don't trigger
        // data loads.  Do refresh even if we're hidden if we have no illust to clear
        // the previous illust's display even if we're not visible, so it's not visible the
        // next time we're displayed.
        if(!this.visible && this._mediaId != null)
            return

        let buttonViewManga = this.root.querySelector(".button-view-manga");
        buttonViewManga.dataset.popup = "View manga pages";
        buttonViewManga.hidden = !ppixiv.app.navigateOutEnabled;

        helpers.html.setClass(this.toggleSlideshowButton, "selected", ppixiv.app.slideshowMode == "1");
        helpers.html.setClass(this.toggleLoopButton, "selected", ppixiv.app.slideshowMode == "loop");
        helpers.html.setClass(this.root.querySelector(".button-bookmark"), "enabled", true);

        // If we're visible, tell widgets what we're viewing.  Don't do this if we're not visible, so
        // they don't load data unnecessarily.  Don't set these back to null if we're hidden, so they
        // don't blank themselves while we're still fading out.
        if(this.visible)
        {
            let mediaId = this._mediaId;
            this.bookmarkButtonWidget.setMediaId(mediaId);
        }
    }

    // Return the illust ID whose parent the parent button will go to.
    get folderIdForParent()
    {
        return this._mediaId || this.dataSource?.viewingFolder;
    }

    // Return the folder ID that the parent button goes to.
    // XXX: merge somewhere with ContextMenu
    get parentFolderId()
    {
        let folder_id = this.folderIdForParent;
        let isLocal = helpers.mediaId.isLocal(folder_id);
        if(!isLocal)
            return null;

        // Go to the parent of the item that was clicked on. 
        let parentFolderId = LocalAPI.getParentFolder(folder_id);

        // If the user right-clicked a thumbnail and its parent is the folder we're
        // already displaying, go to the parent of the folder instead (otherwise we're
        // linking to the page we're already on).  This makes the parent button make
        // sense whether you're clicking on an image in a search result (go to the
        // location of the image), while viewing an image (also go to the location of
        // the image), or in a folder view (go to the folder's parent).
        let currentlyDisplayingId = LocalAPI.getLocalIdFromArgs(helpers.args.location);
        if(parentFolderId == currentlyDisplayingId)
            parentFolderId = LocalAPI.getParentFolder(parentFolderId);

        return parentFolderId;
    }

    clickedViewManga = (e) =>
    {
        ppixiv.app.navigateOut();
    }
}

// IllustBottomMenuBar's bookmark button.
class ImageBookmarkedWidget extends IllustWidget
{
    constructor({ ...options })
    {
        super({
            ...options,
            template: `
                <div class="item button-bookmark public">
                    <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                
                    <vv-container class="button-bookmark-icon"></vv-container>
                    <span class=label>Bookmark</span>
                </div>
            `
        });
    }

    get neededData() { return "partial"; }

    refreshInternal({ mediaInfo })
    {
        let bookmarked = mediaInfo?.bookmarkData != null;
        let privateBookmark = mediaInfo?.bookmarkData?.private;

        helpers.html.setClass(this.root,  "enabled",     mediaInfo != null);
        helpers.html.setClass(this.root,  "bookmarked",  bookmarked);
        helpers.html.setClass(this.root,  "public",      !privateBookmark);
    }
}

class BookmarkTagDialog extends DialogWidget
{
    constructor({mediaId, ...options})
    {
        super({...options, dialogClass: "mobile-tag-list", header: "Bookmark illustration", template: `
            <div class=menu-bar>
                <vv-container class=public-bookmark></vv-container>
                <vv-container class=private-bookmark></vv-container>
                <vv-container class=remove-bookmark></vv-container>
            </div>
        `});

        this.tagListWidget = new BookmarkTagListWidget({
            container: this.root.querySelector(".scroll"),
            containerPosition: "afterbegin",
        });

        this.publicBookmark = new BookmarkButtonWidget({
            container: this.root.querySelector(".public-bookmark"),
            template: `
                <div class="button-bookmark public item">
                    <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                </div>
            `,

            bookmarkType: "public",

            // Instead of deleting the bookmark, save tag changes when these bookmark buttons
            // are clicked.
            toggleBookmark: false,

            // Close if a bookmark button is clicked.
            bookmarkTagListWidget: this.tagListWidget,
        });
        this.publicBookmark.addEventListener("bookmarkedited", () => this.visible = false);

        let privateBookmark = this.root.querySelector(".private-bookmark");
        privateBookmark.hidden = ppixiv.native;
        if(!ppixiv.native)
        {
            this.privateBookmark = new BookmarkButtonWidget({
                container: privateBookmark,
                template: `
                    <div class="button-bookmark private item">
                        <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                    </div>
                `,
                bookmarkType: "private",
                toggleBookmark: false,
                bookmarkTagListWidget: this.tagListWidget,
            });
            this.privateBookmark.addEventListener("bookmarkedited", () => this.visible = false);
        }

        let deleteBookmark = this.root.querySelector(".remove-bookmark");
        this.deleteBookmark = new BookmarkButtonWidget({
            container: deleteBookmark,
            template: `
                <div class="button-bookmark item icon-button">
                    ${ helpers.createIcon("mat:delete") }
                </div>
            `,

            bookmarkType: "delete",
            bookmarkTagListWidget: this.tagListWidget,
        });
        this.deleteBookmark.addEventListener("bookmarkedited", () => this.visible = false);

        this.tagListWidget.setMediaId(mediaId);
        this.publicBookmark.setMediaId(mediaId);
        this.deleteBookmark.setMediaId(mediaId);
        if(this.privateBookmark)
            this.privateBookmark.setMediaId(mediaId);
    }

    visibilityChanged()
    {
        super.visibilityChanged();

        // Let the tag list know when it's hidden, so it knows to save changes.
        this.tagListWidget.visible = this.actuallyVisible;
    }
}

class MoreOptionsDialog extends DialogWidget
{
    constructor({template, mediaId, ...options})
    {
        super({...options, header: "More", classes: ['mobile-illust-ui-dialog'], template: `
            <div class=box>
            </div>
        `});

        this.moreOptionsWidget = new MoreOptionsDropdown({
            container: this.root.querySelector(".box"),
        });
        this.moreOptionsWidget.setMediaId(mediaId);
    }

    // moreOptionsWidget items can call hide() on us when it's clicked.
    hide()
    {
        this.visible = false;
    }
}

class ImageInfoWidget extends IllustWidget
{
    constructor({...options})
    {
        super({ ...options, template: `
            <div class=image-info>
                <div class=info-text>
                    <div class=title-text-block>
                        <span class=folder-block hidden>
                            <span class=folder-text></span>
                            <span class=slash">/</span>
                        </span>
                        <span class=title hidden></span>
                    </div>
                    <div class=page-count hidden></div>
                    <div class=image-info-text hidden></div>
                    <div class="post-age popup" hidden></div>
                    <div class=mobile-tag-overlay>
                        <div class=bookmark-tags></div>
                    </div>
                </div>

                <div class=avatar></div>
            </div>
        `});

        this.avatarWidget = new AvatarWidget({
            container: this.root.querySelector(".avatar"),
            mode: "dropdown",
            interactive: false,
        });
        this.root.querySelector(".avatar").hidden = ppixiv.native;
    }

    get neededData()
    {
        // We need illust info if we're viewing a manga page beyond page 1, since
        // early info doesn't have that.  Most of the time, we only need early info.
        if(this._page == null || this._page == 0)
            return "partial";
        else
            return "full";
    }

    set showPageNumber(value)
    {
        this._showPageNumber = value;
        this.refresh();
    }

    refreshInternal({ mediaId, mediaInfo })
    {
        this.root.hidden = mediaInfo == null;
        if(this.root.hidden)
            return;

        this.avatarWidget.setUserId(mediaInfo?.userId);

        let tagWidget = this.root.querySelector(".bookmark-tags");
        helpers.html.removeElements(tagWidget);

        let isLocal = helpers.mediaId.isLocal(this._mediaId);
        let tags = isLocal? mediaInfo.bookmarkData?.tags:mediaInfo.tagList;
        tags ??= [];
        for(let tag of tags)
        {
            let entry = this.createTemplate({name: "tag-entry", html: `
                <a href=# class="mobile-ui-tag-entry">
                    ${ helpers.createIcon("ppixiv:tag", { classes: ["bookmark-tag-icon"] }) }
                    <span class=tag-name></span>
                </a>
            `});

            entry.href = helpers.getArgsForTagSearch(tag, ppixiv.plocation);
            entry.querySelector(".tag-name").innerText = tag;
            tagWidget.appendChild(entry);
        }

        let setInfo = (query, text) =>
        {
            let node = this.root.querySelector(query);
            node.innerText = text;
            node.hidden = text == "";
        };
        
        // Add the page count for manga.  If the data source is dataSource.vview, show
        // the index of the current file if it's loaded all results.
        let currentPage = this._page;
        let pageCount = mediaInfo.pageCount;
        let showPageNumber = this._showPageNumber;
        if(this.dataSource?.name == "vview" && this.dataSource.allPagesLoaded)
        {
            let { page } = this.dataSource.idList.getPageForMediaId(mediaId);
            let ids = this.dataSource.idList.mediaIdsByPage.get(page);
            if(ids != null)
            {
                currentPage = ids.indexOf(mediaId);
                pageCount = ids.length;
                showPageNumber = true;
            }
        }

        let pageText = "";
        if(pageCount > 1)
        {
            if(showPageNumber || currentPage > 0)
                pageText = `Page ${currentPage+1}/${pageCount}`;
            else
                pageText = `${pageCount} pages`;
        }
        setInfo(".page-count", pageText);

        setInfo(".title", mediaInfo.illustTitle);
    
        let showFolder = helpers.mediaId.isLocal(this._mediaId);
        this.root.querySelector(".folder-block").hidden = !showFolder;
        if(showFolder)
        {
            let {id} = helpers.mediaId.parse(this._mediaId);
            this.root.querySelector(".folder-text").innerText = helpers.strings.getPathSuffix(id, 1, 1); // parent directory
        }

        // If we're on the first page then we only requested early info, and we can use the dimensions
        // on it.  Otherwise, get dimensions from mangaPages from illust data.  If we're displaying a
        // manga post and we don't have illust data yet, we don't have dimensions, so hide it until
        // it's loaded.
        let info = "";
        
        let { width, height } = ppixiv.mediaCache.getImageDimensions(mediaInfo, this._mediaId);
        if(width != null && height != null)
            info += width + "x" + height;
        setInfo(".image-info-text", info);

        let secondsOld = (new Date() - new Date(mediaInfo.createDate)) / 1000;
        let age = helpers.strings.ageToString(secondsOld);
        this.root.querySelector(".post-age").dataset.popup = helpers.strings.dateToString(mediaInfo.createDate);
        setInfo(".post-age", age);
    }

    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        this.dataSource = dataSource;
        this.refresh();
    }
}
