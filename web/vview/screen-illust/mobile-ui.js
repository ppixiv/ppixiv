// The image UI for mobile.

import Widget from 'vview/widgets/widget.js';
import { BookmarkButtonWidget } from 'vview/widgets/illust-widgets.js';
import MoreOptionsDropdown from 'vview/widgets/more-options-dropdown.js';
import { BookmarkTagListWidget } from 'vview/widgets/bookmark-tag-list.js';
import { AvatarWidget } from 'vview/widgets/user-widgets.js';
import { IllustWidget, GetMediaInfo } from 'vview/widgets/illust-widgets.js';
import DialogWidget from 'vview/widgets/dialog.js';
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
                <div class=mobile-illust-ui-page>
                    <div class=avatar></div>

                    <div class=menu-bar>
                        <div class="item button-info enabled">
                            ${ helpers.createIcon("mat:info") }
                            <span class=label>Info</span>
                        </div>

                        <vv-container class="bookmark-button-container"></vv-container>

                        <div class="item button-view-manga enabled">
                            ${ helpers.createIcon("ppixiv:thumbnails") }
                            <span class=label>Pages</span>
                        </div>

                        <div class="item button-more enabled">
                            ${ helpers.createIcon("settings") }
                            <span class=label>More...</span>
                        </div>
                    </div>
                </div>
            </div>
        `});
        
        this.transitionTarget = transitionTarget;

        this.avatarWidget = new AvatarWidget({
            container: this.root.querySelector(".avatar"),
            mode: "dropdown",
        });
        this.root.querySelector(".avatar").hidden = ppixiv.native;

        // Get the user ID to load the avatar.
        this.getMediaInfo = new GetMediaInfo({
            parent: this,
            neededData: "partial",
            onrefresh: async({mediaInfo}) => {
                this.avatarWidget.visible = mediaInfo != null;
                this.avatarWidget.setUserId(mediaInfo?.userId);
            },
        });

        this.dragger = new WidgetDragger({
            parent: this,
            name: "menu-dragger",
            // Put the --menu-bar-pos property up high, since the video UI also uses it.
            nodes: [this.transitionTarget],
            dragNode: this.root.parentNode,
            size: () => this.querySelector(".menu-bar").offsetHeight,
            animatedProperty: "--menu-bar-pos",
            direction: "up",

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
            onbeforeshown: () => this.callVisibilityChanged(),
            onafterhidden: () => this.callVisibilityChanged(),
            onactive: () => this.callVisibilityChanged(),
            oninactive: () => this.callVisibilityChanged(),
        });

        this._mediaId = null;

        this.querySelector(".button-view-manga").addEventListener("click", this.clickedViewManga);

        this.querySelector(".button-more").addEventListener("click", (e) => {
            new MoreOptionsDialog({
                mediaId: this._mediaId
            });

            this.dragger.hide();            
        });

        this.querySelector(".button-info").addEventListener("click", (e) => {
            new MobileIllustInfoDialog({
                mediaId: this._mediaId
            });

            this.dragger.hide();            
        });

        this.buttonBookmark = this.querySelector(".bookmark-button-container");
        this.bookmarkButtonWidget = new ImageBookmarkedWidget({ container: this.buttonBookmark });

        this.buttonBookmark.addEventListener("click", (e) => {
            new BookmarkTagDialog({
                mediaId: this._mediaId
            });
            
            this.dragger.hide();            
        });

        // This tells widgets that want to be above us how tall we are.
        helpers.html.setHeightAsProperty(this.querySelector(".menu-bar"), "--menu-bar-height", {
            target: this.closest(".screen"),
            ...this._signal
        });

        this.refresh();
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

    // We control our own visibility based on the dragger.
    get visible()
    {
        return this.dragger.visible;
    }

    get actuallyVisible()
    {
        return this.dragger.visible;
    }
    
    visibilityChanged()
    {
        super.visibilityChanged();

        // Hide if our tree becomes hidden.
        if(!this.visibleRecursively)
            this.hide();

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

        // Don't refresh while we're hiding, so we don't flash the next page's info while we're
        // hiding right after the page is dragged.  This shouldn't happen when displaying, since
        // our media ID should be set before show() is called.
        if(this.dragger.isAnimationPlaying)
            return;

        this.getMediaInfo.mediaId = this._mediaId;

        // Set data-mobile-ui-visible if we're fully visible so other UIs can tell if this UI is
        // open.
        let fullyVisible = this.dragger.position == 1;
        ClassFlags.get.set("mobile-ui-visible", fullyVisible);

        // Add ourself to OpenWidgets if we're visible at all.
        let visible = this.actuallyVisible;
        OpenWidgets.singleton.set(this, visible);

        // If we're not visible, don't refresh an illust until we are, so we don't trigger
        // data loads.  Do refresh even if we're hidden if we have no illust to clear
        // the previous illust's display even if we're not visible, so it's not visible the
        // next time we're displayed.
        if(!this.visible && this._mediaId != null)
            return

        let buttonViewManga = this.root.querySelector(".button-view-manga");
        buttonViewManga.dataset.popup = "View manga pages";
        buttonViewManga.hidden = !ppixiv.app.navigateOutEnabled;

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
        if(this.tagListWidget)
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

class MobileIllustInfoDialog extends DialogWidget
{
    constructor({mediaId, dataSource, ...options})
    {
        super({...options, header: "More", classes: ['mobile-illust-ui-dialog'], template: `
            <div class=mobile-image-info>
                <div class=author-block>
                    <vv-container class=avatar></vv-container>
                    <div class=author></div>
                </div>
                <div class=page-count hidden></div>
                <div class=image-info-text hidden></div>
                <div class=post-age hidden></div>
                <div class=bookmark-tags></div>
                <div class=description></div>

            </div>
        `});

        this.dataSource = dataSource;

        this.avatarWidget = new AvatarWidget({
            container: this.root.querySelector(".avatar"),
            mode: "dropdown",
        });
        this.root.querySelector(".avatar").hidden = ppixiv.native;

        this.getMediaInfo = new GetMediaInfo({
            parent: this,
            mediaId,
            onrefresh: async(info) => this.refreshInternal(info),
        });
    }

    refreshInternal({ mediaId, mediaInfo })
    {
        this.root.hidden = mediaInfo == null;
        if(this.root.hidden)
            return;

        this.querySelector(".author").textContent = `by ${mediaInfo?.userName}`;
        this.avatarWidget.setUserId(mediaInfo?.userId);

        let tagWidget = this.root.querySelector(".bookmark-tags");
        helpers.html.removeElements(tagWidget);

        let isLocal = helpers.mediaId.isLocal(mediaId);
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
        let showPageNumber = false;
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

        this.header = mediaInfo.illustTitle;
    
        // If we're on the first page then we only requested early info, and we can use the dimensions
        // on it.  Otherwise, get dimensions from mangaPages from illust data.  If we're displaying a
        // manga post and we don't have illust data yet, we don't have dimensions, so hide it until
        // it's loaded.
        let info = "";
        
        let { width, height } = ppixiv.mediaCache.getImageDimensions(mediaInfo, mediaId);
        if(width != null && height != null)
            info += width + "x" + height;
        setInfo(".image-info-text", info);

        let secondsOld = (new Date() - new Date(mediaInfo.createDate)) / 1000;
        let age = helpers.strings.ageToString(secondsOld);
        this.root.querySelector(".post-age").dataset.popup = helpers.strings.dateToString(mediaInfo.createDate);
        setInfo(".post-age", age);

        let elementComment = this.querySelector(".description");
        elementComment.hidden = mediaInfo.illustComment == "";
        elementComment.innerHTML = mediaInfo.illustComment;
        helpers.pixiv.fixPixivLinks(elementComment);
        if(!ppixiv.native)
            helpers.pixiv.makePixivLinksInternal(elementComment);
    }

    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        this.dataSource = dataSource;
        this.refresh();
    }
}
