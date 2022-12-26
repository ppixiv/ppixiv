// A global right-click popup menu.
//
// This is only active when right clicking over items with the context-menu-target
// class.
//
// Not all items are available all the time.  This is a singleton class, so it's easy
// for different parts of the UI to tell us when they're active.
//
// This also handles mousewheel zooming.

import Widget from 'vview/widgets/widget.js';
import { BookmarkButtonWidget, LikeButtonWidget } from 'vview/widgets/illust-widgets.js';
import { HideMouseCursorOnIdle } from 'vview/misc/hide-mouse-cursor-on-idle.js';
import { BookmarkTagDropdownOpener } from 'vview/widgets/bookmark-tag-list.js';
import { AvatarWidget } from 'vview/widgets/user-widgets.js';
import MoreOptionsDropdown from 'vview/widgets/more-options-dropdown.js';
import FixChromeClicks from 'vview/misc/fix-chrome-clicks.js';
import { ViewInExplorerWidget } from 'vview/widgets/local-widgets.js';
import { IllustWidget } from 'vview/widgets/illust-widgets.js';
import PointerListener from 'vview/actors/pointer-listener.js';
import { DropdownBoxOpener } from 'vview/widgets/dropdown.js';
import ClickOutsideListener from 'vview/widgets/click-outside-listener.js';
import Actions from 'vview/misc/actions.js';
import { getUrlForMediaId } from 'vview/misc/media-ids.js'
import LocalAPI from 'vview/misc/local-api.js';
import { helpers, ClassFlags, KeyListener, OpenWidgets } from 'vview/misc/helpers.js';

export default class ContextMenu extends Widget
{
    // Names for buttons, for storing in this._buttonsDown.
    buttons = ["lmb", "rmb", "mmb"];

    constructor({...options})
    {
        super({...options, template: `
            <div class=popup-context-menu>
                <div class=button-strip>
                    <div class="button-block shift-right">
                        <div class="button button-view-manga" data-popup="View manga pages">
                            ${ helpers.createIcon("ppixiv:thumbnails") }
                        </div>
                    </div>

                    <div class=button-block>
                        <div class="button button-fullscreen enabled" data-popup="Fullscreen">
                            <ppixiv-inline src="resources/fullscreen.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <div class=context-menu-image-info-container></div>
                </div>
                <div class=button-strip>
                    <div class=button-block>
                        <div class="button button-browser-back enabled" data-popup="Back" style="transform: scaleX(-1);">
                            <ppixiv-inline src="resources/exit-icon.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <div class=button-block>
                        <div class="button requires-zoom button-zoom" data-popup="Mousewheel to zoom">
                            <ppixiv-inline src="resources/zoom-plus.svg"></ppixiv-inline>
                            <ppixiv-inline src="resources/zoom-minus.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <div class=button-block>
                        <div class="button requires-zoom button-zoom-level" data-level="cover" data-popup="Zoom to cover">
                            <ppixiv-inline src="resources/zoom-full.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <div class=button-block>
                        <div class="button requires-zoom button-zoom-level" data-level="actual" data-popup="Zoom to actual size">
                            <ppixiv-inline src="resources/zoom-actual.svg"></ppixiv-inline>
                        </div>
                    </div>
                    <div class=button-block>
                        <div class="button button-more enabled" data-popup="More...">
                            ${ helpers.createIcon("settings") }
                        </div>
                    </div>
                </div>
                <div class=button-strip>
                    <div class=button-block>
                        <div class="avatar-widget-container"></div>

                        <div class="button button-parent-folder enabled" data-popup="Parent folder" hidden>
                            ${ helpers.createIcon("folder") }
                        </div>
                    </div>

                    <div class="button-block button-container view-in-explorer" hidden></div>

                    <div class="button-block button-container">
                        <vv-container class=button-bookmark data-bookmark-type=public></vv-container>
                    </div>

                    <div class="button-block button-container">
                        <vv-container class=button-bookmark data-bookmark-type=private></vv-container>
                    </div>
                    
                    <div class=button-block>
                        <div class="button button-bookmark-tags" data-popup="Bookmark tags">
                            ${ helpers.createIcon("ppixiv:tag") }
                        </div>
                    </div>

                    <div class="button-block button-container">
                        <vv-container class=button-like-container></vv-container>
                    </div>
                </div>

                <div class=tooltip-display>
                    <div class=tooltip-display-text></div>
                </div>
            </div>
        `});

        this.visible = false;
        this.hide = this.hide.bind(this);
        this._currentViewer = null;
        this._mediaId = null;

        // Whether the left and right mouse buttons are pressed:
        this._buttonsDown = {};

        // This UI isn't used on mobile, but we're still created so other code doesn't need
        // to check if we exist.
        if(ppixiv.mobile)
            return;
            
        this.pointerListener = new PointerListener({
            element: window,
            buttonMask: 0b11,
            callback: this.pointerevent,
        });
        
        window.addEventListener("keydown", this._onKeyEvent);
        window.addEventListener("keyup", this._onKeyEvent);

        // Use KeyListener to watch for ctrl being held.
        new KeyListener("Control", this._ctrlWasPressed);

        // Work around glitchiness in Chrome's click behavior (if we're in Chrome).
        new FixChromeClicks(this.root);

        this.root.addEventListener("mouseover", this.onmouseover, true);
        this.root.addEventListener("mouseout", this.onmouseout, true);

        // If the page is navigated while the popup menu is open, clear the ID the
        // user clicked on, so we refresh and show the default.
        window.addEventListener("pp:popstate", (e) => {
            if(this._clickedMediaId == null)
                return;

            this._setTemporaryIllust(null);
        });

        this._buttonViewManga = this.root.querySelector(".button-view-manga");
        this._buttonViewManga.addEventListener("click", this._clickedViewManga);

        this._buttonFullscreen = this.root.querySelector(".button-fullscreen");
        this._buttonFullscreen.addEventListener("click", this._clickedFullscreen);

        this.root.querySelector(".button-zoom").addEventListener("click", this._clickedToggleZoom);
        this.root.querySelector(".button-browser-back").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            ppixiv.phistory.back();
        });

        this.root.addEventListener("click", this._handleLinkClick);
        this.root.querySelector(".button-parent-folder").addEventListener("click", this.clicked_go_to_parent);

        for(let button of this.root.querySelectorAll(".button-zoom-level"))
            button.addEventListener("click", this._clickedZoomLevel);

        this.avatarWidget = new AvatarWidget({
            container: this.root.querySelector(".avatar-widget-container"),
            mode: "overlay",
        });

        // Set up the more options dropdown.
        let moreOptionsButton = this.root.querySelector(".button-more");
        this._moreOptionsDropdownOpener = new DropdownBoxOpener({
            button: moreOptionsButton,

            createBox: ({...options}) => {
                let dropdown = new MoreOptionsDropdown({
                    ...options,
                    parent: this,
                    showExtra: this.altPressed,
                });

                dropdown.root.classList.add("popup-more-options-dropdown");
                dropdown.setMediaId(this._effectiveMediaId);
                dropdown.setUserId(this._effectiveUserId);

                return dropdown;
            },
        });

        moreOptionsButton.addEventListener("click", (e) => {
            // Show rarely-used options if alt was pressed.
            this.altPressed = e.altKey;
            this._moreOptionsDropdownOpener.visible = !this._moreOptionsDropdownOpener.visible;
        });

        this.illustWidgets = [
            this.avatarWidget,
            new LikeButtonWidget({
                container: this.root.querySelector(".button-like-container"),
                template: `
                    <div class="button button-like enabled" style="position: relative;">
                        <ppixiv-inline src="resources/like-button.svg"></ppixiv-inline>
                    </div>
                `
            }),
            new ImageInfoWidget({
                container: this.root.querySelector(".context-menu-image-info-container"),
            }),
        ];

        if(ppixiv.native)
        {
            let viewInExplorer = this.root.querySelector(".view-in-explorer");
            viewInExplorer.hidden = false;
            this.illustWidgets.push(new ViewInExplorerWidget({
                container: viewInExplorer,
            }));
        }

        // The bookmark buttons, and clicks in the tag dropdown:
        this.bookmarkButtons = [];
        for(let a of this.root.querySelectorAll("[data-bookmark-type]"))
        {
            
            // The bookmark buttons, and clicks in the tag dropdown:
            let bookmarkWidget = new BookmarkButtonWidget({
                container: a,
                // position: relative positions the bookmark count.
                template: `
                    <div class="button button-bookmark ${a.dataset.bookmarkType}">
                        <ppixiv-inline src="resources/heart-icon.svg"></ppixiv-inline>
                    </div>
                `,
                bookmarkType: a.dataset.bookmarkType,
            });

            this.bookmarkButtons.push(bookmarkWidget);
            this.illustWidgets.push(bookmarkWidget);
        }

        // Set up the bookmark tags dropdown.
        this.bookmarkTagsDropdownOpener = new BookmarkTagDropdownOpener({
            parent: this,
            bookmarkTagsButton: this.root.querySelector(".button-bookmark-tags"),
            bookmarkButtons: this.bookmarkButtons,
        });
        this.illustWidgets.push(this.bookmarkTagsDropdownOpener);

        this.refresh();
    }

    _contextMenuEnabledForElement(element)
    {
        let target = element.closest("[data-context-menu-target]");
        if(target == null || target.dataset.contextMenuTarget == "off")
            return false;
        else
            return true;
    }

    pointerevent = (e) =>
    {
        if(e.pressed)
        {
            if(!this.visible && !this._contextMenuEnabledForElement(e.target))
                return;
            
            if(!this.visible && e.mouseButton != 1)
                return;

            let buttonName = this.buttons[e.mouseButton];
            if(buttonName != null)
                this._buttonsDown[buttonName] = true;
            if(e.mouseButton != 1)
                return;

            // If invert-popup-hotkey is true, hold shift to open the popup menu.  Otherwise,
            // hold shift to suppress the popup menu so the browser context menu will open.
            //
            // Firefox doesn't cancel the context menu if shift is pressed.  This seems like a
            // well-intentioned but deeply confused attempt to let people override pages that
            // block the context menu, making it impossible for us to let you choose context
            // menu behavior and probably making it impossible for games to have sane keyboard
            // behavior at all.
            this.shiftWasPressed = e.shiftKey;
            if(navigator.userAgent.indexOf("Firefox/") == -1 && ppixiv.settings.get("invert-popup-hotkey"))
                this.shiftWasPressed = !this.shiftWasPressed;
            if(this.shiftWasPressed)
                return;

            e.preventDefault();
            e.stopPropagation();

            if(this.toggleMode && this.visible)
                this.hide();
            else
                this.show({x: e.clientX, y: e.clientY, target: e.target});
        } else {
            // Releasing the left or right mouse button hides the menu if both the left
            // and right buttons are released.  Pressing right, then left, then releasing
            // right won't close the menu until left is also released.  This prevents lost
            // inputs when quickly right-left clicking.
            if(!this.visible)
                return;

            let buttonName = this.buttons[e.mouseButton];
            if(buttonName != null)
                this._buttonsDown[buttonName] = false;

            this._hideIfAllButtonsReleased();
        }
    }

    // If true, RMB toggles the menu instead of displaying while held, and we'll also hide the
    // menu if the mouse moves too far away.
    get toggleMode()
    {
        return ppixiv.settings.get("touchpad-mode", false);
    }

    // The subclass can override this to handle key events.  This is called whether the menu
    // is open or not.
    _handleKeyEvent(e) { return false; }

    _onKeyEvent = (e) =>
    {
        if(e.repeat)
            return;

        // Don't eat inputs if we're inside an input.
        if(e.target.closest("input, textarea, [contenteditable]"))
            return;

        // Let the subclass handle events.
        if(this._handleKeyEvent(e))
        {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }

    _getHoveredElement()
    {
        let x = PointerListener.latestMouseClientPosition[0];
        let y = PointerListener.latestMouseClientPosition[1];
        return document.elementFromPoint(x, y);
    }

    _ctrlWasPressed = (down) =>
    {
        if(!ppixiv.settings.get("ctrl_opens_popup"))
            return;

        this._buttonsDown["Control"] = down;

        if(down)
        {
            let x = PointerListener.latestMouseClientPosition[0];
            let y = PointerListener.latestMouseClientPosition[1];
            let node = this._getHoveredElement();
            this.show({x, y, target: node});
        } else {
            this._hideIfAllButtonsReleased();
        }
    }

    // This is called on mouseup, and when keyboard shortcuts are released.  Hide the menu if all buttons
    // that can open the menu have been released.
    _hideIfAllButtonsReleased()
    {
        if(this.toggleMode)
            return;

        if(!this._buttonsDown["lmb"] && !this._buttonsDown["rmb"] && !this._buttonsDown["Control"])
            this.hide();
    }

    _windowBlur = (e) =>
    {
        this.hide();
    }

    // Return the element that should be under the cursor when the menu is opened.
    get elementToCenter()
    {
        return null;
    }

    show({x, y, target})
    {
        // See if the click is inside a ViewerImages.
        let widget = Widget.fromNode(target, { allowNone: true });
        this._currentViewer = null;
        if(widget)
        {
            // To avoid importing ViewerImages here, just look for a widget in the tree
            // with zoomToggle.
            for(let parent of widget.ancestors({includeSelf: true}))
            {
                if(parent.zoomToggle != null)
                {
                    this._currentViewer = parent;
                    break;
                }
            }
        }


        // If RMB is pressed while dragging LMB, stop dragging the window when we
        // show the popup.
        if(this._currentViewer != null)
            this._currentViewer.stopDragging();

        // See if an element representing a user and/or an illust was under the cursor.
        if(target != null)
        {
            let { mediaId } = ppixiv.app.getMediaIdAtElement(target);
            this._setTemporaryIllust(mediaId);
        }

        if(this.visible)
            return;

        this.pointerListener.checkMissedClicks();

        this.displayedMenu = this.root;
        this.visible = true;
        this.applyVisibility();

        // Disable popup UI while a context menu is open.
        ClassFlags.get.set("hide-ui", true);
        
        window.addEventListener("blur", this._windowBlur);

        // Disable all dragging while the context menu is open, since drags cause browsers to
        // forget to send mouseup events, which throws things out of whack.  We don't use
        // drag and drop and there's no real reason to use it while the context menu is open.
        window.addEventListener("dragstart", this.cancelEvent, true);

        // In toggle mode, close the popup if anything outside is clicked.
        if(this.toggleMode && this.clickOutsideListener == null)
        {
            this.clickOutsideListener = new ClickOutsideListener([this.root], () => {
                this.hide();
            });
        }

        let centeredElement = this.elementToCenter;
        if(centeredElement == null)
            centeredElement = this.displayedMenu;

        // The center of the centered element, relative to the menu.  Shift the center
        // down a bit in the button.
        let pos = helpers.html.getRelativePosition(centeredElement, this.displayedMenu);
        pos[0] += centeredElement.offsetWidth / 2;
        pos[1] += centeredElement.offsetHeight * 3 / 4;
        x -= pos[0];
        y -= pos[1];

        this.popupPosition = { x, y };
        this.setCurrentPosition();

        // Start listening for the window moving.
        this.addWindowMovementListeners();

        // Adjust the fade-in so it's centered around the centered element.
        this.displayedMenu.style.transformOrigin = (pos[0]) + "px " + (pos[1]) + "px";

        HideMouseCursorOnIdle.disableAll("contextMenu");

        // Make sure we're up to date if we deferred an update while hidden.
        this.refresh();
    }

    setCurrentPosition()
    {
        let { x, y } = this.popupPosition;

        if(this._currentViewer == null)
        {
            // If we can't zoom, adjust the popup position so it doesn't go over the right and
            // bottom of the screen, with a bit of padding so we're not flush with the edge and
            // so the popup text is visible.
            //
            // If zooming is enabled (we're viewing an image), always align to the same place,
            // so the cursor is always over the zoom toggle button.
            let windowWidth = window.innerWidth - 4;
            let windowHeight = window.innerHeight - 20;
            x = helpers.math.clamp(x, 0, windowWidth - this.displayedMenu.offsetWidth);
            y = helpers.math.clamp(y, 0, windowHeight - this.displayedMenu.offsetHeight);
        }

        this.displayedMenu.style.left = `${x}px`;
        this.displayedMenu.style.top = `${y}px`;
    }

    // Try to keep the context menu in the same place on screen when we toggle fullscreen.
    //
    // To do this, we need to know when the position of the client area on the screen changes.
    // There are no APIs to query this directly (window.screenX/screenY don't work, those are
    // the position of the window rather than the client area).  Figure it out by watching
    // mouse events, and comparing the client and screen position of the cursor.  If it's 100x50, the
    // client area is at 100x50 on the screen.
    //
    // It's not perfect, but it helps keep the context menu from being way off in another part
    // of the screen after toggling fullscreen.
    addWindowMovementListeners()
    {
        // Firefox doesn't send any mouse events at all when the window moves (not even focus
        // changes), which makes this look weird since it doesn't update until the mouse moves.
        // Just disable it on Firefox.
        if(navigator.userAgent.indexOf("Firefox/") != -1)
            return;

        if(this.removeWindowMovementListeners != null)
            return;

        this.lastOffset = null;
        let controller = new AbortController();
        let signal = controller.signal;

        signal.addEventListener("abort", () => {
            this.removeWindowMovementListeners = null;
        });

        // Call this.removeWindowMovementListeners() to turn this back off.
        this.removeWindowMovementListeners = controller.abort.bind(controller);

        // Listen for hover events too.  We don't get mousemouve events if the window changes
        // but the mouse doesn't move, but the hover usually does change.
        for(let event of ["mouseenter", "mouseleave", "mousemove", "mouseover", "mouseout"])
        {
            window.addEventListener(event, this._onMousePositionChanged, { capture: true, signal });
        }
    }

    _onMousePositionChanged = (e) => {
        if(!this.visible)
            throw new Error("Expected to be visible");

        // The position of the client area onscreen.  If we have client scaling, this is
        // in client units.
        let windowX = e.screenX/window.devicePixelRatio - e.clientX;
        let windowY = e.screenY/window.devicePixelRatio - e.clientY;

        // Stop if it hasn't changed.  screenX/devicePixelRatio can be fractional and not match up
        // with clientX exactly, so ignore small changes.
        if(this.lastOffset != null &&
            Math.abs(windowX - this.lastOffset.x) <= 1 &&
            Math.abs(windowY - this.lastOffset.y) <= 1)
            return;

        let previous = this.lastOffset;
        this.lastOffset = { x: windowX, y: windowY };
        if(previous == null)
            return;

        // If the window has moved by 20x10, move the context menu by -20x-10.
        let windowDeltaX = windowX - previous.x;
        let windowDeltaY = windowY - previous.y;

        this.popupPosition.x -= windowDeltaX;
        this.popupPosition.y -= windowDeltaY;
        this.setCurrentPosition();
    };
    
    // If element is within a button that has a tooltip set, show it.
    _showTooltipForElement(element)
    {
        if(element != null)
            element = element.closest("[data-popup]");
        
        if(this._tooltipElement == element)
            return;

        this._tooltipElement = element;
        this._refreshTooltip();

        if(this._tooltipObserver)
        {
            this._tooltipObserver.disconnect();
            this._tooltipObserver = null;
        }

        if(this._tooltipElement == null)
            return;

        // Refresh the tooltip if the popup attribute changes while it's visible.
        this._tooltipObserver = new MutationObserver((mutations) => {
            for(let mutation of mutations) {
                if(mutation.type == "attributes")
                {
                    if(mutation.attributeName == "data-popup")
                        this._refreshTooltip();
                }
            }
        });
        
        this._tooltipObserver.observe(this._tooltipElement, { attributes: true });
    }

    _refreshTooltip()
    {
        let element = this._tooltipElement;
        if(element != null)
            element = element.closest("[data-popup]");
        this.root.querySelector(".tooltip-display").hidden = element == null;
        if(element != null)
            this.root.querySelector(".tooltip-display-text").dataset.popup = element.dataset.popup;
    }

    onmouseover = (e) =>
    {
        this._showTooltipForElement(e.target);
    }

    onmouseout = (e) =>
    {
        this._showTooltipForElement(e.relatedTarget);
    }

    get hideTemporarily()
    {
        return this._hiddenTemporarily;
    }

    set hideTemporarily(value)
    {
        this._hiddenTemporarily = value;
        this.applyVisibility();
    }

    // True if the widget is active (eg. RMB is pressed) and we're not hidden
    // by a zoom.
    get actuallyVisible()
    {
        return this.visible && !this._hiddenTemporarily;
    }

    visibilityChanged()
    {
        super.visibilityChanged();
        this.applyVisibility();
        OpenWidgets.singleton.set(this, this.visible);
    }

    applyVisibility()
    {
        let visible = this.actuallyVisible;
        helpers.html.setClass(this.root, "hidden-widget", !visible);
        helpers.html.setClass(this.root, "visible", visible);
    }

    hide()
    {
        // For debugging, this can be set to temporarily force the context menu to stay open.
        if(window.keepContextMenuOpen)
            return;

        this._clickedMediaId = null;
        this.cachedUserId = null;

        // Don't refresh yet, so we try to not change the display while it fades out.
        // We'll do the refresh the next time we're displayed.
        // this.refresh();

        if(!this.visible)
            return;

        this.visible = false;
        this._hiddenTemporarily = false;
        this.applyVisibility();

        this.displayedMenu = null;
        HideMouseCursorOnIdle.enableAll("contextMenu");
        this._buttonsDown = {};
        ClassFlags.get.set("hide-ui", false);
        window.removeEventListener("blur", this._windowBlur);
        window.removeEventListener("dragstart", this.cancelEvent, true);

        if(this.clickOutsideListener)
        {
            this.clickOutsideListener.shutdown();
            this.clickOutsideListener = null;
        }

        if(this.removeWindowMovementListeners)
            this.removeWindowMovementListeners();
    }

    cancelEvent = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();
    }

    // Override ctrl-clicks inside the context menu.
    //
    // This is a bit annoying.  Ctrl-clicking a link opens it in a tab, but we allow opening the
    // context menu by holding ctrl, which means all clicks are ctrl-clicks if you use the popup
    // that way.  We work around this by preventing ctrl-click from opening links in a tab and just
    // navigate normally.  This is annoying since some people might like opening tabs that way, but
    // there's no other obvious solution other than changing the popup menu hotkey.  That's not a
    // great solution since it needs to be on Ctrl or Alt, and Alt causes other problems, like showing
    // the popup menu every time you press alt-left.
    //
    // This only affects links inside the context menu, which is currently only the author link, and
    // most people probably use middle-click anyway, so this will have to do.
    _handleLinkClick = (e) =>
    {
        // Do nothing if opening the popup while holding ctrl is disabled.
        if(!ppixiv.settings.get("ctrl_opens_popup"))
            return;

        let a = e.target.closest("A");
        if(a == null)
            return;

        // If a previous event handler called preventDefault on this click, ignore it.
        if(e.defaultPrevented)
            return;

        // Only change ctrl-clicks.
        if(e.altKey || e.shiftKey || !e.ctrlKey)
            return;

        e.preventDefault();
        e.stopPropagation();

        let url = new URL(a.href, ppixiv.plocation);
        helpers.navigate(url);
    }

    visibilityChanged(value)
    {
        super.visibilityChanged(value);

        if(this.visible)
            window.addEventListener("wheel", this.onwheel, {
                capture: true,

                // Work around Chrome intentionally breaking event listeners.  Remember when browsers
                // actually made an effort to not break things?
                passive: false,
            });
        else
            window.removeEventListener("wheel", this.onwheel, true);
    }

    // Return the media ID active in the context menu, or null if none.
    //
    // If we're opened by right clicking on an illust, we'll show that image's
    // info.  Otherwise, we'll show the info for the illust we're on, if any.
    get _effectiveMediaId()
    {
        let mediaId = this._clickedMediaId ?? this._mediaId;
        if(mediaId == null)
            return null;

        // Don't return users this way.  They'll be returned by _effectiveUserId.
        let { type } = helpers.mediaId.parse(mediaId);
        if(type == "user")
            return null;

        return mediaId;
    }

    get _effectiveUserId()
    {
        let mediaId = this._clickedMediaId ?? this._mediaId;
        if(mediaId == null)
            return null;

        // If the media ID is a user, use it.
        let { type, id } = helpers.mediaId.parse(mediaId);
        if(type == "user")
            return id;

        // See if _loadUserId has loaded the user ID.
        if(this._cachedUserId)
            return this._cachedUserId;

        return null;
    }

    set cachedUserId(user_id)
    {
        if(this._cachedUserId == user_id)
            return;

        this._cachedUserId = user_id;
        this.refresh();
    }

    // If our media ID is an illust, load its info to get the user ID.
    async _loadUserId()
    {
        let mediaId = this._effectiveMediaId;
        if(!this.visible)
        {
            this.cachedUserId = null;
            return;
        }

        let user_id = await ppixiv.userCache.getUserIdForMediaId(mediaId);

        // Stop if the media ID changed.
        if(mediaId != this._effectiveMediaId)
            return;

        this.cachedUserId = user_id;
    }

    setMediaId(mediaId)
    {
        if(this._mediaId == mediaId)
            return;

        this._mediaId = mediaId;
        this.refresh();
    }

    // Put the zoom toggle button under the cursor, so right-left click is a quick way
    // to toggle zoom lock.
    get elementToCenter()
    {
        return this.displayedMenu.querySelector(".button-zoom");
    }
        
    get _isZoomUiEnabled()
    {
        return this._currentViewer != null && this._currentViewer.slideshowMode == null;
    }

    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        this.dataSource = dataSource;

        for(let widget of this.illustWidgets)
        {
            if(widget.setDataSource)
                widget.setDataSource(dataSource);
        }

        this.refresh();
    }

    // Handle key events.  This is called whether the context menu is open or closed, and handles
    // global hotkeys.  This is handled here because it has a lot of overlapping functionality with
    // the context menu.
    //
    // The actual actions may happen async, but this always returns synchronously since the keydown/keyup
    // event needs to be defaultPrevented synchronously.
    //
    // We always return true for handled hotkeys even if we aren't able to perform them currently, so
    // keys don't randomly revert to default actions.
    _handleKeyEventForImage(e)
    {
        // These hotkeys require an image, which we have if we're viewing an image or if the user
        // was hovering over an image in search results.  We might not have the illust info yet,
        // but we at least need an illust ID.
        let mediaId = this._effectiveMediaId;

        // If there's no effective media ID, the user is pressing a key while the context menu isn't
        // open.  If the cursor is over a search thumbnail, use its media ID if any, to allow hovering
        // over a thumbnail and using bookmark, etc. hotkeys.  This isn't needed when ctrl_opens_popup
        // is open since we'll already have _effectiveMediaId.
        if(mediaId == null)
        {
            let node = this._getHoveredElement();
            mediaId = ppixiv.app.getMediaIdAtElement(node).mediaId;
        }

        // All of these hotkeys require Ctrl.
        if(!e.ctrlKey)
            return;

        if(e.key.toUpperCase() == "V")
        {
            (async() => {
                if(mediaId == null)
                    return;

                Actions.likeImage(mediaId);
            })();

            return true;
        }

        if(e.key.toUpperCase() == "B")
        {
            (async() => {
                if(mediaId == null)
                    return;

                let mediaInfo = ppixiv.mediaCache.getMediaInfo(mediaId, { full: false });

                // Ctrl-Shift-Alt-B: add a bookmark tag
                if(e.altKey && e.shiftKey)
                {
                    Actions.addNewBookmarkTag(mediaId);
                    return;
                }

                // Ctrl-Shift-B: unbookmark
                if(e.shiftKey)
                {
                    if(mediaInfo.bookmarkData == null)
                    {
                        ppixiv.message.show("Image isn't bookmarked");
                        return;
                    }

                    Actions.bookmarkRemove(mediaId);
                    return;
                }

                // Ctrl-B: bookmark with default privacy
                // Ctrl-Alt-B: bookmark privately
                let bookmarkPrivately = null;
                if(e.altKey)
                    bookmarkPrivately = true;

                if(mediaInfo.bookmarkData != null)
                {
                    ppixiv.message.show("Already bookmarked (^B to remove bookmark)");
                    return;
                }

                Actions.bookmarkAdd(mediaId, {
                    private: bookmarkPrivately
                });
            })();
            
            return true;
        }

        if(e.key.toUpperCase() == "P")
        {
            let enable = !ppixiv.settings.get("auto_pan", false);
            ppixiv.settings.set("auto_pan", enable);

            ppixiv.message.show(`Image panning ${enable? "enabled":"disabled"}`);
            return true;
        }

        if(e.key.toUpperCase() == "S")
        {
            // Go async to get media info if it's not already available.
            (async() => {
                if(mediaId == null)
                    return;

                // Download the image or video by default.  If alt is pressed and the image has
                // multiple pages, download a ZIP instead.
                let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, { full: false });
                let downloadType = "image";
                if(Actions.isDownloadTypeAvailable("image", mediaInfo))
                    downloadType = "image";
                else if(Actions.isDownloadTypeAvailable("MKV", mediaInfo))
                    downloadType = "MKV";

                if(e.altKey && Actions.isDownloadTypeAvailable("ZIP", mediaInfo))
                    downloadType = "ZIP";
    
                Actions.downloadIllust(mediaId, downloadType);
            })();

            return true;
        }

        return false;
    }

    _handleKeyEventForUser(e)
    {
        // These hotkeys require a user, which we have if we're viewing an image, if the user
        // was hovering over an image in search results, or if we're viewing a user's posts.
        // We might not have the user info yet, but we at least need a user ID.
        let user_id = this._effectiveUserId;

        // All of these hotkeys require Ctrl.
        if(!e.ctrlKey)
            return;

        if(e.key.toUpperCase() == "F")
        {
            (async() => {
                if(user_id == null)
                    return;

                let userInfo = await ppixiv.userCache.getUserInfoFull(user_id);
                if(userInfo == null)
                    return;

                // Ctrl-Shift-F: unfollow
                if(e.shiftKey)
                {
                    if(!userInfo.isFollowed)
                    {
                        ppixiv.message.show("Not following this user");
                        return;
                    }

                    await Actions.unfollow(user_id);
                    return;
                }
            
                // Ctrl-F: follow with default privacy
                // Ctrl-Alt-F: follow privately
                //
                // It would be better to check if we're following publically or privately to match the hotkey, but
                // Pixiv doesn't include that information.
                let followPrivately = null;
                if(e.altKey)
                    followPrivately = true;

                if(userInfo.isFollowed)
                {
                    ppixiv.message.show("Already following this user");
                    return;
                }
            
                await Actions.follow(user_id, followPrivately);
            })();

            return true;
        }

        return false;
    }

    _handleKeyEvent(e)
    {
        if(e.type != "keydown")
            return false;

        if(e.altKey && e.key == "Enter")
        {
            helpers.toggleFullscreen();
            return true;
        }

        if(this._isZoomUiEnabled)
        {
            // Ctrl-0 toggles zoom, similar to the browser Ctrl-0 reset zoom hotkey.
            if(e.code == "Digit0" && e.ctrlKey)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._currentViewer.zoomToggle();
                return;
            }

            let zoom = helpers.isZoomHotkey(e);
            if(zoom != null)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._handleZoomEvent(e, zoom < 0);
                return true;
            }
        }

        // Check image and user hotkeys.
        if(this._handleKeyEventForImage(e))
            return true;

        if(this._handleKeyEventForUser(e))
            return true;
        
        return false;
    }

    onwheel = (e) =>
    {
        // RMB-wheel zooming is confusing in toggle mode.
        if(this.toggleMode)
            return;

        // Stop if zooming isn't enabled.
        if(!this._isZoomUiEnabled)
            return;

        // Only mousewheel zoom if the popup menu is visible.
        if(!this.visible)
            return;

        // We want to override almost all mousewheel events while the popup menu is open, but
        // don't override scrolling the popup menu's tag list.
        if(e.target.closest(".popup-bookmark-tag-dropdown"))
            return;

        e.preventDefault();
        e.stopImmediatePropagation();
        
        let down = e.deltaY > 0;
        this._handleZoomEvent(e, down);
    }
    
    // Handle both mousewheel and control-+/- zooming.
    _handleZoomEvent(e, down)
    {
        e.preventDefault();
        e.stopImmediatePropagation();

        if(!this.hideTemporarily)
        {
            // Hide the popup menu.  It remains open, so hide() will still be called when
            // the right mouse button is released and the overall flow remains unchanged, but
            // the popup itself will be hidden.
            this.hideTemporarily = true;
        }

        // If e is a keyboard event, use null to use the center of the screen.
        let keyboard = e instanceof KeyboardEvent;
        let x = keyboard? null:e.clientX;
        let y = keyboard? null:e.clientY;

        this._currentViewer.zoomAdjust(down, {x, y});
        
        this.refresh();
    }

    // Set an alternative illust ID to show.  This is effective until the context menu is hidden.
    // This is used to remember what the cursor was over when the context menu was opened when in
    // the search view.
    _setTemporaryIllust(mediaId)
    {
        if(this._clickedMediaId == mediaId)
            return;

        this._clickedMediaId = mediaId;
        this.cachedUserId = null;

        this.refresh();
    }

    // Update selection highlight for the context menu.
    refresh()
    {
        // If we're not visible, don't refresh an illust until we are, so we don't trigger
        // data loads.  Do refresh even if we're hidden if we have no illust to clear
        // the previous illust's display even if we're not visible, so it's not visible the
        // next time we're displayed.
        let mediaId = this._effectiveMediaId;
        if(!this.visible && mediaId != null)
            return;

        // If we haven't loaded the user ID yet, start it now.  This is async and we won't wait
        // for it here.  It'll call refresh() again when it finishes.
        this._loadUserId();
            
        let user_id = this._effectiveUserId;
        let info = mediaId? ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false }):null;

        this._buttonViewManga.dataset.popup = "View manga pages";
        helpers.html.setClass(this._buttonViewManga, "enabled", info?.pageCount > 1);
        helpers.html.setClass(this._buttonFullscreen, "selected", helpers.isFullscreen());

        this._refreshTooltip();

        // Enable the zoom buttons if we're in the image view and we have an ViewerImages.
        for(let element of this.root.querySelectorAll(".button.requires-zoom"))
            helpers.html.setClass(element, "enabled", this._isZoomUiEnabled);

        // If we're visible, tell widgets what we're viewing.  Don't do this if we're not visible, so
        // they don't load data unnecessarily.  Don't set these back to null if we're hidden, so they
        // don't blank themselves while we're still fading out.
        if(this.visible)
        {
            for(let widget of this.illustWidgets)
            {
                if(widget.setMediaId)
                    widget.setMediaId(mediaId);
                if(widget.setUserId)
                    widget.setUserId(user_id);

                // If _clickedMediaId is set, we're open for a search result image the user right-clicked
                // on.  Otherwise, we're open for the image actually being viewed.  Tell ImageInfoWidget
                // to show the current manga page if we're on a viewed image, but not if we're on a search
                // result.
                let showingViewedImage = (this._clickedMediaId == null);
                widget.showPageNumber = showingViewedImage;
            }

            // If we're on a local ID, show the parent folder button.  Otherwise, show the
            // author button.  We only show one or the other of these.
            //
            // If we don't have an illust ID, see if the data source has a folder ID, so this
            // works when right-clicking outside thumbs on search pages.
            let folderButton = this.root.querySelector(".button-parent-folder");
            let authorButton = this.root.querySelector(".avatar-widget-container");

            let isLocal = helpers.mediaId.isLocal(this._folderIdForParent);
            folderButton.hidden = !isLocal;
            authorButton.hidden = isLocal;
            helpers.html.setClass(folderButton, "enabled", this._parentFolderId != null);
        }

        if(this._isZoomUiEnabled)
        {
            helpers.html.setClass(this.root.querySelector(".button-zoom"), "selected", this._currentViewer.getLockedZoom());

            let zoomLevel = this._currentViewer.getZoomLevel();
            for(let button of this.root.querySelectorAll(".button-zoom-level"))
                helpers.html.setClass(button, "selected", this._currentViewer.getLockedZoom() && button.dataset.level == zoomLevel);
        }
    }

    _clickedViewManga = (e) =>
    {
        if(!this._buttonViewManga.classList.contains("enabled"))
            return;

        let args = getUrlForMediaId(this._effectiveMediaId, { manga: true });
        helpers.navigate(args);
    }

    _clickedFullscreen = async (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        await helpers.toggleFullscreen();
        this.refresh();
    }

    // "Zoom lock", zoom as if we're holding the button constantly
    _clickedToggleZoom = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(!this._isZoomUiEnabled)
            return;
        
        this._currentViewer.zoomToggle({x: e.clientX, y: e.clientY})
        this.refresh();
    }

    _clickedZoomLevel = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(!this._isZoomUiEnabled)
            return;

        this._currentViewer.zoomSetLevel(e.currentTarget.dataset.level, {x: e.clientX, y: e.clientY});
        this.refresh();
    }

    // Return the illust ID whose parent the parent button will go to.
    get _folderIdForParent()
    {
        return this._effectiveMediaId || this.dataSource.viewingFolder;
    }

    // Return the folder ID that the parent button goes to.
    get _parentFolderId()
    {
        let folderId = this._folderIdForParent;
        let isLocal = helpers.mediaId.isLocal(folderId);
        if(!isLocal)
            return null;

        // Go to the parent of the item that was clicked on. 
        let _parentFolderId = LocalAPI.getParentFolder(folderId);

        // If the user right-clicked a thumbnail and its parent is the folder we're
        // already displaying, go to the parent of the folder instead (otherwise we're
        // linking to the page we're already on).  This makes the parent button make
        // sense whether you're clicking on an image in a search result (go to the
        // location of the image), while viewing an image (also go to the location of
        // the image), or in a folder view (go to the folder's parent).
        let currentlyDisplayingId = LocalAPI.getLocalIdFromArgs(helpers.args.location);
        if(_parentFolderId == currentlyDisplayingId)
            _parentFolderId = LocalAPI.getParentFolder(_parentFolderId);

        return _parentFolderId;
    }

    clicked_go_to_parent = (e) =>
    {
        e.preventDefault();
            
        let _parentFolderId = this._parentFolderId;
        if(_parentFolderId == null)
            return;

        let args = new helpers.args("/", ppixiv.plocation);
        LocalAPI.getArgsForId(_parentFolderId, args);
        helpers.navigate(args.url);
    }
}

class ImageInfoWidget extends IllustWidget
{
    constructor({
        showTitle=false,
        ...options})
    {
        super({ ...options, template: `
            <div class=context-menu-image-info>
                <div class=title-text-block>
                    <span class=folder-block hidden>
                        <span class=folder-text></span>
                        <span class=slash">/</span>
                    </span>
                    <span class=title hidden></span>
                </div>
                <div class=page-count hidden></div>
                <div class=image-info hidden></div>
                <div class="post-age popup" hidden></div>
            </div>
        `});

        this.showTitle = showTitle;
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

        if(this.showTitle)
        {
            setInfo(".title", mediaInfo.illustTitle);
        
            let showFolder = helpers.mediaId.isLocal(this._mediaId);
            this.root.querySelector(".folder-block").hidden = !showFolder;
            if(showFolder)
            {
                let {id} = helpers.mediaId.parse(this._mediaId);
                this.root.querySelector(".folder-text").innerText = helpers.strings.getPathSuffix(id, 1, 1); // parent directory
            }
        }

        // If we're on the first page then we only requested early info, and we can use the dimensions
        // on it.  Otherwise, get dimensions from mangaPages from illust data.  If we're displaying a
        // manga post and we don't have illust data yet, we don't have dimensions, so hide it until
        // it's loaded.
        let info = "";
        let { width, height } = ppixiv.mediaCache.getImageDimensions(mediaInfo, this._mediaId);
        if(width != null && height != null)
            info += width + "x" + height;
        setInfo(".image-info", info);

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
