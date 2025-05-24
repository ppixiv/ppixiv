// A global right-click popup menu.
//
// This is only active when right clicking over items with the context-menu-target
// class.
//
// Not all items are available all the time.  This is a singleton class, so it's easy
// for different parts of the UI to tell us when they're active.
//
// This also handles mousewheel zooming.

import Widget from "/vview/widgets/widget.js";
import {
	BookmarkButtonWidget,
	LikeButtonWidget,
} from "/vview/widgets/illust-widgets.js";
import { HideMouseCursorOnIdle } from "/vview/misc/hide-mouse-cursor-on-idle.js";
import { BookmarkTagDropdownOpener } from "/vview/widgets/bookmark-tag-list.js";
import {
	AvatarWidget,
	GetUserIdFromMediaId,
} from "/vview/widgets/user-widgets.js";
import MoreOptionsDropdown from "/vview/widgets/more-options-dropdown.js";
import FixChromeClicks from "/vview/misc/fix-chrome-clicks.js";
import { ViewInExplorerWidget } from "/vview/widgets/local-widgets.js";
import { IllustWidget } from "/vview/widgets/illust-widgets.js";
import PointerListener from "/vview/actors/pointer-listener.js";
import { DropdownBoxOpener } from "/vview/widgets/dropdown.js";
import ClickOutsideListener from "/vview/widgets/click-outside-listener.js";
import Actions from "/vview/misc/actions.js";
import { getUrlForMediaId } from "/vview/misc/media-ids.js";
import LocalAPI from "/vview/misc/local-api.js";
import { GetMediaInfo } from "/vview/widgets/illust-widgets.js";
import {
	helpers,
	ClassFlags,
	KeyListener,
	OpenWidgets,
} from "/vview/misc/helpers.js";

const ContextMenuTemplate = `
<div id="popup-context-menu">
	<div id="context-menu-image-info">
		<vv-container class="context-menu-item avatar-widget-container data-popup=" Loading..."></vv-container>
		<div id="context-menu-image-info-container context-menu-item"></div>
	</div>
	<div id="context-menu-buttons-group">
		<vv-container class="context-menu-item button-bookmark" data-bookmark-type=public data-popup="Bookmark Image">
			<ppixiv-inline class="ctx-icon" src="resources/heart-icon.svg"></ppixiv-inline>
		</vv-container>

		<vv-container class="context-menu-item button-bookmark-private button-bookmark" data-bookmark-type=private
			data-popup="Bookmark Privately">
			<ppixiv-inline class="ctx-icon" src="resources/heart-icon-private.svg"></ppixiv-inline>
		</vv-container>

		<div class="context-menu-item button button-bookmark-tags" data-popup="Bookmark tags" style="display:none">
			${helpers.createIcon("ppixiv:tag")}
		</div>

		<vv-container class="context-menu-item button-container button-like-container" data-popup="Like Image">
			<ppixiv-inline class="ctx-icon" src="resources/like-button.svg"></ppixiv-inline>
		</vv-container>

		<div class="context-menu-item button button-fullscreen enabled" data-popup="Fullscreen" style="display:none">
			<ppixiv-inline class="ctx-icon" src="resources/fullscreen.svg"></ppixiv-inline>
		</div>

		<div class="context-menu-item button requires-zoom button-zoom" data-popup="Mousewheel to zoom"
			style="display:none">
			<ppixiv-inline src="resources/zoom-plus.svg"></ppixiv-inline>
			<ppixiv-inline src="resources/zoom-minus.svg"></ppixiv-inline>
		</div>

		<div class="context-menu-item button requires-zoom button-zoom-level" data-level="cover"
			data-popup="Zoom to cover" style="display:none">
			<ppixiv-inline class="ctx-icon" src="resources/zoom-full.svg" style="margin-right: 4px;"></ppixiv-inline>
		</div>

		<div class="context-menu-item button requires-zoom button-zoom-level" data-level="actual"
			data-popup="Zoom to actual size">
			<ppixiv-inline class="ctx-icon" src="resources/zoom-actual.svg"></ppixiv-inline>
		</div>

		<a href=# class="button button-view-manga context-menu-item" data-popup="View manga pages">
			${helpers.createIcon("ppixiv:thumbnails", { classes: ["manga"] })}
			${helpers.createIcon("mat:menu_book", { classes: ["series"] })}
		</a>

		<div class="context-menu-item button button-more enabled" data-popup="More...">
			${helpers.createIcon("settings")}
		</div>

		<div class="context-menu-item button button-browser-back enabled" data-popup="Back">
			<ppixiv-inline class="ctx-icon" src="resources/exit-icon.svg" style="transform: scaleX(-1); margin-right: 4px;">
			</ppixiv-inline>
		</div>

		<div class="context-menu-item button button-parent-folder enabled" data-popup="Parent folder" hidden>
			${helpers.createIcon("folder")}
		</div>

		<div class="context-menu-item view-in-explorer" hidden></div>
	</div>
</div>
`;

export default class ContextMenu extends Widget {
	// Names for buttons, for storing in this._buttonsDown.
	buttons = ["lmb", "rmb", "mmb"];

	constructor({ ...options }) {
		super({
			...options,
			template: ContextMenuTemplate,
		});

		this.visible = false;
		this.hide = this.hide.bind(this);
		this._currentViewer = null;
		this._mediaId = null;

		this._buttonsDown = {};

		if (ppixiv.mobile) return; //skip for mobile ui

		this.getUserIdFromMediaId = new GetUserIdFromMediaId({
			parent: this,
			onrefresh: ({ userId }) => {
				this._cachedUserId = userId;
				this.refresh();
			},
		});

		this.root.ontransitionend = () => this.callVisibilityChanged();

		this._initButtonListener();

		this._buttonViewManga = this.root.querySelector(".button-view-manga");

		this._buttonFullscreen = this.root.querySelector(".button-fullscreen");
		this._buttonFullscreen.addEventListener("click", this._clickedFullscreen);

		this.root
			.querySelector(".button-zoom")
			.addEventListener("click", this._clickedToggleZoom);
		this.root
			.querySelector(".button-browser-back")
			.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();

				ppixiv.phistory.back();
			});

		this.root.addEventListener("click", this._handleLinkClick);
		this.root
			.querySelector(".button-parent-folder")
			.addEventListener("click", this.clicked_go_to_parent);

		for (const button of this.root.querySelectorAll(".button-zoom-level"))
			button.addEventListener("click", this._clickedZoomLevel);

		this.avatarWidget = new AvatarWidget({
			container: this.root.querySelector(".avatar-widget-container"),
			mode: "overlay",
		});

		this._createMoreOptionsButtons();

		this.getMediaInfo = this._getMediaInfo();

		this.illustWidgets = this._createIllustWidget();

		this._createCtxMenuItemDescription();

		this.refresh();
	}

	_initButtonListener() {
		this.pointerListener = new PointerListener({
			element: window,
			buttonMask: 0b11,
			callback: this.pointerEvent,
		});

		window.addEventListener("keydown", this._onKeyEvent); // ctx menu event
		window.addEventListener("keyup", this._onKeyEvent);

		new KeyListener("Control", this._ctrlWasPressed); // listen ctrl event

		new FixChromeClicks(this.root); // fix chromium glitch

		// refresh img cache when page navigating
		window.addEventListener("pp:popstate", (e) => {
			if (this._clickedMediaId == null) return;

			this._setTemporaryIllust(null);
		});
	}

	_createCtxMenuItemDescription() {
		const elements = this.root.querySelectorAll(".context-menu-item");

		for (const element of elements) {
			// Ensure single attachment
			if (element._descriptionObserverAttached) continue;
			element._descriptionObserverAttached = true;

			// Create or reuse description element
			let descEl = element.querySelector(".context-menu-item-description");
			if (!descEl) {
				descEl = document.createElement("span");
				descEl.className = "context-menu-item-description";
				element.appendChild(descEl);
			}

			// Initial text from data-popup
			descEl.textContent = element.dataset.popup || "";

			// Observe data-popup changes dynamically
			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (
						mutation.type === "attributes" &&
						mutation.attributeName === "data-popup"
					) {
						descEl.textContent = element.dataset.popup || "";
					}
				}
			});
			observer.observe(element, { attributes: true });
		}
	}

	_updateAuthorName(mediaId) {
		const authorName = this.root.querySelector(".avatar-widget-container");
		if (authorName) {
			const name =
				this._userInfo?.name ??
				(!helpers.mediaId.isLocal(mediaId) ? "---" : "");
			authorName.dataset.popup = name;
		}
	}

	_createMoreOptionsButtons() {
		// Set up the more options dropdown.
		const moreOptionsButton = this.root.querySelector(".button-more");
		this._moreOptionsDropdownOpener = new DropdownBoxOpener({
			button: moreOptionsButton,

			createDropdown: ({ ...options }) => {
				const dropdown = new MoreOptionsDropdown({
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
			this._moreOptionsDropdownOpener.visible =
				!this._moreOptionsDropdownOpener.visible;
		});
	}

	_getMediaInfo() {
		const mediaInfo = new GetMediaInfo({
			parent: this,
			neededData: "full",
			onrefresh: async ({ mediaInfo }) => {
				this._createManageViewButton(mediaInfo);
			},
		});
		return mediaInfo;
	}

	_createManageViewButton(mediaInfo) {
		const seriesId = mediaInfo?.seriesNavData?.seriesId;
		this._buttonViewManga.hidden = !(
			mediaInfo?.pageCount > 1 || seriesId != null
		);

		this._buttonViewManga.dataset.popup =
			mediaInfo == null
				? ""
				: seriesId != null
					? "View series"
					: "View manga pages";

		const enabled = seriesId != null || mediaInfo?.pageCount > 1;
		helpers.html.setClass(this._buttonViewManga, "enabled", enabled);
		this._buttonViewManga.style.pointerEvents = enabled ? "" : "none";

		this._buttonViewManga.querySelector(".manga").hidden = seriesId != null;
		this._buttonViewManga.querySelector(".series").hidden = seriesId == null;

		// Set the manga page or series link.
		if (enabled) {
			if (seriesId != null) {
				const args = new helpers.args("/", ppixiv.plocation);
				args.path = `/user/${mediaInfo.userId}/series/${seriesId}`;
				this._buttonViewManga.href = args.url.toString();
			} else {
				const args = getUrlForMediaId(mediaInfo?.mediaId, { manga: true });
				this._buttonViewManga.href = args.url.toString();
			}
		}
	}

	_createIllustWidget() {
		const illustWidgets = [
			this.avatarWidget,
			new LikeButtonWidget({
				container: this.root.querySelector(".button-like-container"),
				template: `
                    <div class="button button-like enabled" style="position: relative;">
                    </div>
                `,
			}),
			new ImageInfoWidget({
				container: document?.getElementById?.(
					"context-menu-image-info-container",
				),
			}),
		];

		if (ppixiv.native) {
			const viewInExplorer = this.root.querySelector(".view-in-explorer");
			viewInExplorer.hidden = false;
			illustWidgets.push(
				new ViewInExplorerWidget({
					container: viewInExplorer,
				}),
			);
		}

		// The bookmark buttons, and clicks in the tag dropdown:
		this.bookmarkButtons = [];
		for (const a of this.root.querySelectorAll("[data-bookmark-type]")) {
			// The bookmark buttons, and clicks in the tag dropdown:
			const bookmarkWidget = new BookmarkButtonWidget({
				container: a,
				// position: relative positions the bookmark count.
				template: `
                    <div class="button button-bookmark ${a.dataset.bookmarkType}">
                    </div>
                `,
				bookmarkType: a.dataset.bookmarkType,
			});

			this.bookmarkButtons.push(bookmarkWidget);
			illustWidgets.push(bookmarkWidget);
		}

		// Set up the bookmark tags dropdown.
		this.bookmarkTagsDropdownOpener = new BookmarkTagDropdownOpener({
			parent: this,
			bookmarkTagsButton: this.root.querySelector(".button-bookmark-tags"),
			bookmarkButtons: this.bookmarkButtons,
		});
		illustWidgets.push(this.bookmarkTagsDropdownOpener);
		return illustWidgets;
	}

	_isContextMenuOpen(element) {
		const target = element.closest("[data-context-menu-target]");
		if (target == null || target.dataset.contextMenuTarget === "off")
			return false;
		return true;
	}

	pointerEvent = (e) => {
		if (e.pressed) {
			if (!this.visible && !this._isContextMenuOpen(e.target)) return;

			if (!this.visible && e.mouseButton !== 1) return;

			const buttonName = this.buttons[e.mouseButton];
			if (buttonName != null) this._buttonsDown[buttonName] = true;
			if (e.mouseButton !== 1) return;

			// support firefox shift press event
			this.shiftWasPressed = e.shiftKey;
			if (
				navigator.userAgent.indexOf("Firefox/") === -1 &&
				ppixiv.settings.get("invert-popup-hotkey")
			)
				this.shiftWasPressed = !this.shiftWasPressed;
			if (this.shiftWasPressed) return;

			e.preventDefault();
			e.stopPropagation();

			if (this.touchpadMode && this.visible) this.hide();
			else this.show({ x: e.clientX, y: e.clientY, target: e.target });
		} else {
			// release event
			if (!this.visible) return;

			const buttonName = this.buttons[e.mouseButton];
			if (buttonName != null) this._buttonsDown[buttonName] = false;

			this._hideIfAllButtonsReleased();
		}
	};

	// If true, RMB toggles the menu instead of displaying while held, and we'll also hide the
	// menu if the mouse moves too far away.
	get touchpadMode() {
		return ppixiv.settings.get("touchpad_mode", false);
	}

	_onKeyEvent = (e) => {
		if (e.repeat) return;

		// Don't eat inputs if we're inside an input.
		if (e.target.closest("input, textarea, [contenteditable]")) return;

		// Let the subclass handle events.
		if (this._handleKeyEvent(e)) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
	};

	_getHoveredElement() {
		const x = PointerListener.latestMouseClientPosition[0];
		const y = PointerListener.latestMouseClientPosition[1];
		return document.elementFromPoint(x, y);
	}

	_ctrlWasPressed = (down) => {
		if (!ppixiv.settings.get("ctrl_opens_popup")) return;

		this._buttonsDown.Control = down;

		if (down) {
			const x = PointerListener.latestMouseClientPosition[0];
			const y = PointerListener.latestMouseClientPosition[1];
			const node = this._getHoveredElement();
			this.show({ x, y, target: node });
		} else {
			this._hideIfAllButtonsReleased();
		}
	};

	// This is called on mouseup, and when keyboard shortcuts are released.  Hide the menu if all buttons
	// that can open the menu have been released.
	_hideIfAllButtonsReleased() {
		if (this.touchpadMode) return;

		if (
			!this._buttonsDown.lmb &&
			!this._buttonsDown.rmb &&
			!this._buttonsDown.Control
		)
			this.hide();
	}

	_windowBlur = (e) => {
		this.hide();
	};

	show({ x, y, target }) {
		// See if the click is inside a ViewerImages.
		const widget = Widget.fromNode(target, { allowNone: true });
		this._currentViewer = null;
		if (widget) {
			// To avoid importing ViewerImages here, just look for a widget in the tree
			// with zoomToggle.
			for (const parent of widget.ancestors({ includeSelf: true })) {
				if (parent.zoomToggle != null) {
					this._currentViewer = parent;
					break;
				}
			}
		}

		// If RMB is pressed while dragging LMB, stop dragging the window when we
		// show the popup.
		if (this._currentViewer != null) this._currentViewer.stopDragging();
		// See if an element representing a user and/or an illust was under the cursor.
		let mediaId;
		if (target != null) {
			const result = ppixiv.app.getMediaIdAtElement(target);
			if (result != null) {
				({ mediaId } = result);
				this._setTemporaryIllust(mediaId);
			}
		}

		if (this.visible) return;

		this.pointerListener.checkMissedClicks();

		this.displayedMenu = this.root;
		this.visible = true;
		this.applyVisibility();
		OpenWidgets.singleton.set(this, true);

		// Disable popup UI while a context menu is open.
		ClassFlags.get.set("hide-ui", true);

		window.addEventListener("blur", this._windowBlur);

		// Disable all dragging while the context menu is open, since drags cause browsers to
		// forget to send mouseup events, which throws things out of whack.  We don't use
		// drag and drop and there's no real reason to use it while the context menu is open.
		window.addEventListener("dragstart", this.cancelEvent, true);

		// In touchpadMode, close the popup if anything outside is clicked.
		if (this.touchpadMode && this.clickOutsideListener == null) {
			this.clickOutsideListener = new ClickOutsideListener([this.root], () => {
				this.hide();
			});
		}

		let centeredElement = this.elementToCenter;
		if (centeredElement == null) centeredElement = this.displayedMenu;

		// The center of the centered element, relative to the menu.  Shift the center
		// down a bit in the button.
		const pos = helpers.html.getRelativePosition(
			centeredElement,
			this.displayedMenu,
		);
		pos[0] += centeredElement.offsetWidth / 2;
		pos[1] += (centeredElement.offsetHeight * 3) / 4;
		x -= pos[0];
		y -= pos[1];

		this.popupPosition = { x, y };
		this.setCurrentPosition();

		// Adjust the fade-in so it's centered around the centered element.
		this.displayedMenu.style.transformOrigin = `${pos[0]}px ${pos[1]}px`;

		HideMouseCursorOnIdle.disableAll("contextMenu");

		// Make sure we're up to date if we deferred an update while hidden.
		this.refresh();
	}

	setCurrentPosition() {
		let { x, y } = this.popupPosition;

		if (this._currentViewer == null) {
			// If we can't zoom, adjust the popup position so it doesn't go over the right and
			// bottom of the screen, with a bit of padding so we're not flush with the edge and
			// so the popup text is visible.
			//
			// If zooming is enabled (we're viewing an image), always align to the same place,
			// so the cursor is always over the zoom toggle button.
			const windowWidth = window.innerWidth - 4;
			const windowHeight = window.innerHeight - 20;
			x = helpers.math.clamp(
				x,
				0,
				windowWidth - this.displayedMenu.offsetWidth,
			);
			y = helpers.math.clamp(
				y,
				0,
				windowHeight - this.displayedMenu.offsetHeight,
			);
		}

		this.displayedMenu.style.left = `${x}px`;
		this.displayedMenu.style.top = `${y}px`;
	}

	get hideTemporarily() {
		return this._hiddenTemporarily;
	}

	set hideTemporarily(value) {
		this._hiddenTemporarily = value;
		this.callVisibilityChanged();
	}

	// True if the widget is active (eg. RMB is pressed) and we're not hidden
	// by a zoom.
	get actuallyVisible() {
		if (this.visible) return true;

		// We're still visible if we're becoming hidden but we still have animations running.
		if (this.root.getAnimations().length > 0) return true;

		return false;
	}

	visibilityChanged(value) {
		super.visibilityChanged(value);
		OpenWidgets.singleton.set(this, this.visible);

		if (this.visible)
			window.addEventListener("wheel", this.onwheel, {
				capture: true,

				// Work around Chrome intentionally breaking event listeners.  Remember when browsers
				// actually made an effort to not break things?
				passive: false,
			});
		else window.removeEventListener("wheel", this.onwheel, true);
	}

	applyVisibility() {
		const visible = this.visible && !this._hiddenTemporarily;
		helpers.html.setClass(this.root, "hidden-widget", !visible);
		helpers.html.setClass(this.root, "visible", visible);
	}

	hide() {
		// For debugging, this can be set to temporarily force the context menu to stay open.
		if (window.keepContextMenuOpen) return;

		if (!this.visible) return;

		this.visible = false;
		this._hiddenTemporarily = false;
		this.applyVisibility();
		OpenWidgets.singleton.set(this, false);

		this.displayedMenu = null;
		HideMouseCursorOnIdle.enableAll("contextMenu");
		this._buttonsDown = {};
		ClassFlags.get.set("hide-ui", false);
		window.removeEventListener("blur", this._windowBlur);
		window.removeEventListener("dragstart", this.cancelEvent, true);

		if (this.clickOutsideListener) {
			this.clickOutsideListener.shutdown();
			this.clickOutsideListener = null;
		}
	}

	cancelEvent = (e) => {
		e.preventDefault();
		e.stopPropagation();
	};

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
	_handleLinkClick = (e) => {
		// Do nothing if opening the popup while holding ctrl is disabled.
		if (!ppixiv.settings.get("ctrl_opens_popup")) return;

		const a = e.target.closest("A");
		if (a == null) return;

		// If a previous event handler called preventDefault on this click, ignore it.
		if (e.defaultPrevented) return;

		// Only change ctrl-clicks.
		if (e.altKey || e.shiftKey || !e.ctrlKey) return;

		e.preventDefault();
		e.stopPropagation();

		const url = new URL(a.href, ppixiv.plocation);
		helpers.navigate(url);
	};

	// Return the media ID active in the context menu, or null if none.
	//
	// If we're opened by right clicking on an illust, we'll show that image's
	// info.  Otherwise, we'll show the info for the illust we're on, if any.
	get _effectiveMediaId() {
		const mediaId = this._clickedMediaId ?? this._mediaId;
		if (mediaId == null) return null;

		// Don't return users this way.  They'll be returned by _effectiveUserId.
		const { type } = helpers.mediaId.parse(mediaId);
		if (type === "user") return null;

		return mediaId;
	}

	get _effectiveUserId() {
		// See if getUserIdFromMediaId has loaded the user ID.
		return this.getUserIdFromMediaId.info.userId;
	}

	setMediaId(mediaId) {
		if (this._mediaId === mediaId) return;

		this._mediaId = mediaId;
		this.getUserIdFromMediaId.id = this._clickedMediaId ?? this._mediaId;
		this.refresh();
	}

	// Put the zoom toggle button under the cursor, so right-left click is a quick way
	// to toggle zoom lock.
	get elementToCenter() {
		// This is the one to keep, was previously duplicated
		return this.displayedMenu.querySelector(".button-zoom");
	}

	get _isZoomUiEnabled() {
		return (
			this._currentViewer != null && this._currentViewer.slideshowMode == null
		);
	}

	setDataSource(dataSource) {
		if (this.dataSource === dataSource) return;

		this.dataSource = dataSource;

		for (const widget of this.illustWidgets) {
			if (widget.setDataSource) widget.setDataSource(dataSource);
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
	_handleKeyEventForImage(e) {
		// These hotkeys require an image, which we have if we're viewing an image or if the user
		// was hovering over an image in search results.  We might not have the illust info yet,
		// but we at least need an illust ID.
		let mediaId = this._effectiveMediaId;
		const screenName = ppixiv.app.getDisplayedScreen();

		// If there's no effective media ID, the user is pressing a key while the context menu isn't
		// open.  If the cursor is over a search thumbnail, use its media ID if any, to allow hovering
		// over a thumbnail and using bookmark, etc. hotkeys.  This isn't needed when ctrl_opens_popup
		// is open since we'll already have _effectiveMediaId.
		if (mediaId == null) {
			const node = this._getHoveredElement();
			mediaId = ppixiv.app.getMediaIdAtElement(node).mediaId;
		}

		// Escape when on the illust view backs out to the search:
		if (
			e.code === "Escape" &&
			!e.ctrlKey &&
			!e.altKey &&
			!e.shiftKey &&
			screenName === "illust"
		) {
			ppixiv.phistory.back();
			return true;
		}

		// Handle VVbrowser-specific hotkeys.
		if (LocalAPI.isVVbrowser()) {
			// Handle alt-left and alt-right for navigation.  This isn't done by VVBrowser itself.
			// Don't use phistory here.  It doesn't handle forwards navigation, and we know
			// we're not in phistory permanent mode since VVbrowser isn't used on mobile.
			if (e.altKey && e.key === "ArrowLeft") {
				navigation.back();
				e.preventDefault();
			} else if (e.altKey && e.key === "ArrowRight") {
				navigation.forward();
				e.preventDefault();
			}
		}

		// All of these hotkeys require Ctrl.
		if (!e.ctrlKey) return;

		if (e.key.toUpperCase() === "V") {
			if (mediaId == null) return;

			Actions.likeImage(mediaId);

			return true;
		}

		if (e.key.toUpperCase() === "B") {
			(async () => {
				if (mediaId == null) return;

				const mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, {
					full: false,
				});

				// Ctrl-Shift-Alt-B: add a bookmark tag
				if (e.altKey && e.shiftKey) {
					Actions.addNewBookmarkTag(mediaId);
					return;
				}

				// Ctrl-Shift-B: unbookmark
				if (e.shiftKey) {
					if (mediaInfo.bookmarkData == null) {
						ppixiv.message.show("Image isn't bookmarked");
						return;
					}

					Actions.bookmarkRemove(mediaId);
					return;
				}

				// Ctrl-B: bookmark with default privacy
				// Ctrl-Alt-B: bookmark privately
				let bookmarkPrivately = null;
				if (e.altKey) bookmarkPrivately = true;

				if (mediaInfo.bookmarkData != null) {
					ppixiv.message.show("Already bookmarked (^B to remove bookmark)");
					return;
				}

				Actions.bookmarkAdd(mediaId, {
					private: bookmarkPrivately,
				});
			})();

			return true;
		}

		if (e.key.toUpperCase() === "P") {
			const enable = !ppixiv.settings.get("auto_pan", false);
			ppixiv.settings.set("auto_pan", enable);

			ppixiv.message.show(`Image panning ${enable ? "enabled" : "disabled"}`);
			return true;
		}

		if (e.key.toUpperCase() === "S") {
			// Go async to get media info if it's not already available.
			(async () => {
				if (mediaId == null) return;

				// Download the image or video by default.  If alt is pressed and the image has
				// multiple pages, download a ZIP instead.
				const mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, {
					full: false,
				});
				let downloadType = "image";
				if (Actions.isDownloadTypeAvailable("image", mediaInfo))
					downloadType = "image";
				else if (Actions.isDownloadTypeAvailable("MKV", mediaInfo))
					downloadType = "MKV";

				if (e.altKey && Actions.isDownloadTypeAvailable("ZIP", mediaInfo))
					downloadType = "ZIP";

				Actions.downloadIllust(mediaId, downloadType);
			})();

			return true;
		}

		return false;
	}

	_handleKeyEventForUser(e) {
		// These hotkeys require a user, which we have if we're viewing an image, if the user
		// was hovering over an image in search results, or if we're viewing a user's posts.
		// We might not have the user info yet, but we at least need a user ID.
		const userId = this._effectiveUserId;

		// All of these hotkeys require Ctrl.
		if (!e.ctrlKey) return;

		if (e.key.toUpperCase() === "F") {
			(async () => {
				if (userId == null) return;

				const userInfo = this._userInfo;
				if (userInfo == null) return;

				// Ctrl-Shift-F: unfollow
				if (e.shiftKey) {
					if (!userInfo.isFollowed) {
						ppixiv.message.show("Not following this user");
						return;
					}

					await Actions.unfollow(userId);
					return;
				}

				// Ctrl-F: follow with default privacy
				// Ctrl-Alt-F: follow privately
				//
				// It would be better to check if we're following publically or privately to match the hotkey, but
				// Pixiv doesn't include that information.
				let followPrivately = null;
				if (e.altKey) followPrivately = true;

				if (userInfo.isFollowed) {
					ppixiv.message.show("Already following this user");
					return;
				}

				await Actions.follow(userId, followPrivately);
			})();

			return true;
		}

		return false;
	}

	_handleKeyEvent(e) {
		if (e.type !== "keydown") return false;

		if (e.altKey && e.key === "Enter") {
			helpers.toggleFullscreen();
			return true;
		}

		if (this._isZoomUiEnabled) {
			// Ctrl-0 toggles zoom, similar to the browser Ctrl-0 reset zoom hotkey.
			if (e.code === "Digit0" && e.ctrlKey) {
				e.preventDefault();
				e.stopImmediatePropagation();
				this._currentViewer.zoomToggle();
				return;
			}

			const zoom = helpers.isZoomHotkey(e);
			if (zoom != null) {
				e.preventDefault();
				e.stopImmediatePropagation();
				this._handleZoomEvent(e, zoom < 0);
				return true;
			}
		}

		// Check image and user hotkeys.
		if (this._handleKeyEventForImage(e)) return true;

		if (this._handleKeyEventForUser(e)) return true;

		return false;
	}

	onwheel = (e) => {
		// RMB-wheel zooming is confusing in toggle mode.
		if (this.touchpadMode) return;

		// Stop if zooming isn't enabled.
		if (!this._isZoomUiEnabled) return;

		// Stop if the user dropdown is open.
		const userDropdown = this.avatarWidget.userDropdownWidget;
		if (userDropdown) {
			// If the input isn't inside the dropdown, prevent the input so we don't navigate
			// while the dropdown is open.  Otherwise, leave it alone to allow scrolling the
			// dropdown.  This includes submenus (the bookmark tag dropdown).
			const targetWidget = Widget.fromNode(e.target);
			if (targetWidget) {
				if (!userDropdown.isAncestorOf(targetWidget)) {
					e.preventDefault();
					e.stopImmediatePropagation();
				}
			}
			return;
		}

		// Only mousewheel zoom if the popup menu is visible.
		if (!this.visible) return;

		// We want to override almost all mousewheel events while the popup menu is open, but
		// don't override scrolling the popup menu's tag list.
		if (e.target.closest(".popup-bookmark-tag-dropdown")) return;

		e.preventDefault();
		e.stopImmediatePropagation();

		const down = e.deltaY > 0;
		this._handleZoomEvent(e, down);
	};

	// Handle both mousewheel and control-+/- zooming.
	_handleZoomEvent(e, down) {
		e.preventDefault();
		e.stopImmediatePropagation();

		if (!this.hideTemporarily) {
			// Hide the popup menu.  It remains open, so hide() will still be called when
			// the right mouse button is released and the overall flow remains unchanged, but
			// the popup itself will be hidden.
			this.hideTemporarily = true;
		}

		// If e is a keyboard event, use null to use the center of the screen.
		const keyboard = e instanceof KeyboardEvent;
		const x = keyboard ? null : e.clientX;
		const y = keyboard ? null : e.clientY;

		this._currentViewer.zoomAdjust(down, { x, y });

		this.refresh();
	}

	// Set an alternative illust ID to show.  This is effective until the context menu is hidden.
	// This is used to remember what the cursor was over when the context menu was opened when in
	// the search view.
	_setTemporaryIllust(mediaId) {
		if (this._clickedMediaId === mediaId) return;

		this._clickedMediaId = mediaId;
		this.getUserIdFromMediaId.id = this._clickedMediaId ?? this._mediaId;
		this.refresh();
	}

	// Update selection highlight for the context menu.
	refresh() {
		const mediaId = this._effectiveMediaId;
		if (this.visible) this.getMediaInfo.id = mediaId;

		// If we're not visible, don't refresh an illust until we are, so we don't trigger
		// data loads.  Do refresh even if we're hidden if we have no illust to clear
		// the previous illust's display even if we're not visible, so it's not visible the
		// next time we're displayed.
		if (!this.visible && mediaId != null) return;

		const userId = this._effectiveUserId;

		ppixiv.userCache
			.getUserInfo(userId, {
				full: true,
			})
			.then((userInfo) => {
				this._userInfo = userInfo;
			});

		this._updateAuthorName(mediaId);

		helpers.html.setClass(
			this._buttonFullscreen,
			"selected",
			helpers.isFullscreen(),
		);

		// Enable the zoom buttons if we're in the image view and we have an ViewerImages.
		for (const element of this.root.querySelectorAll(".button.requires-zoom"))
			helpers.html.setClass(element, "enabled", this._isZoomUiEnabled);

		// If we're visible, tell widgets what we're viewing.  Don't do this if we're not visible, so
		// they don't load data unnecessarily.  Don't set these back to null if we're hidden, so they
		// don't blank themselves while we're still fading out.
		if (this.visible) {
			for (const widget of this.illustWidgets) {
				if (widget.setMediaId) widget.setMediaId(mediaId);
				if (widget.setUserId) widget.setUserId(userId);

				// If _clickedMediaId is set, we're open for a search result image the user right-clicked
				// on.  Otherwise, we're open for the image actually being viewed.  Tell ImageInfoWidget
				// to show the current manga page if we're on a viewed image, but not if we're on a search
				// result.
				const showingViewedImage = this._clickedMediaId == null;
				widget.showPageNumber = showingViewedImage;
			}

			// If we're on a local ID, show the parent folder button.  Otherwise, show the
			// author button.  We only show one or the other of these.
			//
			// If we don't have an illust ID, see if the data source has a folder ID, so this
			// works when right-clicking outside thumbs on search pages.
			const folderButton = this.root.querySelector(".button-parent-folder");
			const authorButton = this.root.querySelector(".avatar-widget-container");

			const isLocal = helpers.mediaId.isLocal(this._folderIdForParent);
			folderButton.hidden = !isLocal;
			authorButton.hidden = isLocal;
			helpers.html.setClass(
				folderButton,
				"enabled",
				this._parentFolderId != null,
			);
			this.querySelector(".button-bookmark-private").hidden = isLocal;
		}

		if (this._isZoomUiEnabled) {
			helpers.html.setClass(
				this.root.querySelector(".button-zoom"),
				"selected",
				this._currentViewer.getLockedZoom(),
			);

			const zoomLevel = this._currentViewer.getZoomLevel();
			for (const button of this.root.querySelectorAll(".button-zoom-level"))
				helpers.html.setClass(
					button,
					"selected",
					this._currentViewer.getLockedZoom() &&
						button.dataset.level === zoomLevel,
				);
		}
	}

	_clickedFullscreen = async (e) => {
		e.preventDefault();
		e.stopPropagation();

		await helpers.toggleFullscreen();
		this.refresh();
	};

	// "Zoom lock", zoom as if we're holding the button constantly
	_clickedToggleZoom = (e) => {
		e.preventDefault();
		e.stopPropagation();

		if (!this._isZoomUiEnabled) return;

		this._currentViewer.zoomToggle({ x: e.clientX, y: e.clientY });
		this.refresh();
	};

	_clickedZoomLevel = (e) => {
		e.preventDefault();
		e.stopPropagation();

		if (!this._isZoomUiEnabled) return;

		this._currentViewer.zoomSetLevel(e.currentTarget.dataset.level, {
			x: e.clientX,
			y: e.clientY,
		});
		this.refresh();
	};

	// Return the illust ID whose parent the parent button will go to.
	get _folderIdForParent() {
		if (this._effectiveMediaId != null) return this._effectiveMediaId;

		const dataSourceMediaId = this.dataSource?.uiInfo.mediaId;
		if (helpers.mediaId.isLocal(dataSourceMediaId)) return dataSourceMediaId;

		return null;
	}

	// Return the folder ID that the parent button goes to.
	get _parentFolderId() {
		const folderId = this._folderIdForParent;
		const isLocal = helpers.mediaId.isLocal(folderId);
		if (!isLocal) return null;

		// Go to the parent of the item that was clicked on.
		let parentFolderId = LocalAPI.getParentFolder(folderId);

		// If the user right-clicked a thumbnail and its parent is the folder we're
		// already displaying, go to the parent of the folder instead (otherwise we're
		// linking to the page we're already on).  This makes the parent button make
		// sense whether you're clicking on an image in a search result (go to the
		// location of the image), while viewing an image (also go to the location of
		// the image), or in a folder view (go to the folder's parent).
		const currentlyDisplayingId = LocalAPI.getLocalIdFromArgs(
			helpers.args.location,
		);
		if (parentFolderId === currentlyDisplayingId)
			parentFolderId = LocalAPI.getParentFolder(parentFolderId);

		return parentFolderId;
	}

	clicked_go_to_parent = (e) => {
		e.preventDefault();

		const parentFolderId = this._parentFolderId;
		if (parentFolderId == null) return;

		const args = new helpers.args("/", ppixiv.plocation);
		LocalAPI.getArgsForId(parentFolderId, args);
		helpers.navigate(args.url);
	};
}

class ImageInfoWidget extends IllustWidget {
	constructor({ showTitle = false, ...options }) {
		super({
			...options,
			template: `
	           <div class="context-menu-image-info-widget">
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
	       `,
		});

		this.showTitle = showTitle;
	}

	get neededData() {
		// We need illust info if we're viewing a manga page beyond page 1, since
		// early info doesn't have that.  Most of the time, we only need early info.
		const mangaPage = this.mangaPage;
		if (mangaPage == null || mangaPage === 0) return "partial";
		return "full";
	}

	set showPageNumber(value) {
		this._showPageNumber = value;
		this.refresh();
	}

	refreshInternal({ mediaId, mediaInfo }) {
		this.root.hidden = mediaInfo == null;
		if (this.root.hidden) return;

		const setInfo = (query, text) => {
			const node = this.root.querySelector(query);
			node.innerText = text;
			node.hidden = text === "";
		};

		// Add the page count for manga.  If the data source is dataSource.vview, show
		// the index of the current file if it's loaded all results.
		const pageCount = mediaInfo.pageCount;
		let pageText = this.dataSource.getPageTextForMediaId(mediaId);
		if (pageText == null && pageCount > 1) {
			const currentPage = this.mangaPage;
			if (this._showPageNumber || currentPage > 0)
				pageText = `Page ${currentPage + 1}/${pageCount}`;
			else pageText = `${pageCount} pages`;
		}
		setInfo(".page-count", pageText ?? "");

		if (this.showTitle) {
			setInfo(".title", mediaInfo.illustTitle);

			const showFolder = helpers.mediaId.isLocal(this._mediaId);
			this.root.querySelector(".folder-block").hidden = !showFolder;
			if (showFolder) {
				const { id } = helpers.mediaId.parse(this._mediaId);
				this.root.querySelector(".folder-text").innerText =
					helpers.strings.getPathSuffix(id, 1, 1); // parent directory
			}
		}

		// If we're on the first page then we only requested early info, and we can use the dimensions
		// on it.  Otherwise, get dimensions from mangaPages from illust data.  If we're displaying a
		// manga post and we don't have illust data yet, we don't have dimensions, so hide it until
		// it's loaded.
		let info = "";
		const { width, height } = ppixiv.mediaCache.getImageDimensions(
			mediaInfo,
			this._mediaId,
		);
		if (width != null && height != null) info += `${width}x${height}`;
		setInfo(".image-info", info);

		const secondsOld = (new Date() - new Date(mediaInfo.createDate)) / 1000;
		const age = helpers.strings.ageToString(secondsOld);
		this.root.querySelector(".post-age").dataset.popup =
			helpers.strings.dateToString(mediaInfo.createDate);
		setInfo(".post-age", age);
	}

	setDataSource(dataSource) {
		if (this.dataSource === dataSource) return;

		this.dataSource = dataSource;
		this.refresh();
	}
}
