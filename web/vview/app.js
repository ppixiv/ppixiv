import InstallPolyfills from "/vview/misc/polyfills.js";
import WhatsNew from "/vview/widgets/whats-new.js";
import SavedSearchTags from "/vview/misc/saved-search-tags.js";
import TagTranslations from "/vview/misc/tag-translations.js";
import ScreenIllust from "/vview/screen-illust/screen-illust.js";
import ScreenSearch from "/vview/screen-search/screen-search.js";
import ContextMenu from "/vview/context-menu.js";
import Muting from "/vview/misc/muting.js";
import SendImage, {
	LinkThisTabPopup,
	SendHerePopup,
} from "/vview/misc/send-image.js";
import Settings from "/vview/misc/settings.js";
import { SlideshowStagingDialog } from "/vview/widgets/settings-widgets.js";
import DialogWidget from "/vview/widgets/dialog.js";
import MessageWidget from "/vview/widgets/message-widget.js";
import MediaCache from "/vview/misc/media-cache.js";
import UserCache from "/vview/misc/user-cache.js";
import ExtraCache from "/vview/misc/extra-cache.js";
import { helpers, PointerEventMovement } from "/vview/misc/helpers.js";
import * as Recaptcha from "/vview/util/recaptcha.js";
import * as Hooks from "/vview/util/hooks.js";
import ExtraImageData from "/vview/misc/extra-image-data.js";
import GuessImageURL from "/vview/misc/guess-image-url.js";
import ImageTranslations from "/vview/misc/image-translation.js";
import PointerListener from "/vview/actors/pointer-listener.js";
import VirtualHistory from "/vview/util/virtual-history.js";
import SiteNative from "/vview/sites/native/site-native.js";
import SitePixiv from "/vview/sites/pixiv/site-pixiv.js";
import { getResources } from "/vview/app-resources.js";

import appCss from "/resources/css/main.scss";

// This is the main top-level app controller.
export default class App {
	constructor() {
		ppixiv.app = this;
		this.setup();
	}

	// This is where the actual UI starts.
	async setup() {
		console.log(`${ppixiv.native ? "vview" : "ppixiv"} controller setup`);

		// Hide the bright white document until we've loaded our stylesheet.
		if (!ppixiv.native) this._temporarilyHideDocument();

		// Wait for DOMContentLoaded.
		await helpers.other.waitForContentLoaded();

		// Init hooks if any.
		await Hooks.init(this);

		// Install polyfills.
		InstallPolyfills();

		// Create singletons.
		ppixiv.phistory = new VirtualHistory({ permanent: ppixiv.mobile });
		ppixiv.settings = new Settings();
		ppixiv.mediaCache = new MediaCache();
		ppixiv.userCache = new UserCache();
		ppixiv.extraImageData = new ExtraImageData();
		ppixiv.extraCache = new ExtraCache();
		ppixiv.sendImage = new SendImage();
		ppixiv.tagTranslations = new TagTranslations();
		ppixiv.guessImageUrl = new GuessImageURL();
		ppixiv.muting = new Muting();
		ppixiv.imageTranslations = new ImageTranslations();

		// Set up the PointerListener singleton.
		PointerListener.installGlobalHandler();

		// Set up iOS movementX/movementY handling.
		new PointerEventMovement();

		// Window focus:
		let refreshFocus = () => {
			helpers.html.setClass(document.body, "focused", document.hasFocus());
		};
		window.addEventListener("focus", refreshFocus);
		window.addEventListener("blur", refreshFocus);
		refreshFocus();

		// Don't restore the scroll position.  We handle this ourself.
		window.history.scrollRestoration = "manual"; // not phistory

		if (ppixiv.mobile) {
			// On mobile, disable long press opening the context menu and starting drags.
			window.addEventListener("contextmenu", (e) => {
				e.preventDefault();
			});
			window.addEventListener("dragstart", (e) => {
				e.preventDefault();
			});

			helpers.forceTargetBlank();
		}

		// Create the site singleton for the site we're on.
		if (ppixiv.site == null) {
			if (ppixiv.native) ppixiv.site = new SiteNative();
			else ppixiv.site = new SitePixiv();
		}

		if (!(await ppixiv.site.init())) return;

		// See if we want to adjust the initial URL.
		await ppixiv.site.setInitialUrl();

		window.addEventListener("click", this._windowClickCapture);
		window.addEventListener("popstate", this._windowRedirectPopstate, true);
		window.addEventListener("pp:popstate", this._windowPopstate);

		window.addEventListener("keyup", this._redirectEventToScreen, true);
		window.addEventListener("keydown", this._redirectEventToScreen, true);
		window.addEventListener("keypress", this._redirectEventToScreen, true);

		window.addEventListener("keydown", this._windowKeydown);

		// Dark Reader is terrible rubbish.  Don't use it.
		let disableDarkReader = document.realCreateElement("meta");
		disableDarkReader.name = "darkreader-lock";
		document.head.appendChild(disableDarkReader);

		// Load image resources into blobs.
		this.loadResourceBlobs();

		// Load our icon font.  var() doesn't work for font-face src, so we have to do
		// this manually.
		helpers.html.addStyle(
			"ppixiv-font",
			`
            @font-face {
                font-family: 'ppixiv';
                src: url(${ppixiv.resources["resources/ppixiv.woff"]}) format('woff');
                font-weight: normal;
                font-style: normal;
                font-display: block;
            }
        `,
		);

		// Add the main stylesheet.
		document.head.appendChild(helpers.html.createStyle(appCss, { id: "main" }));

		// If we're running natively, index.html included an initial stylesheet to set the background
		// color.  Remove it now that we have our real stylesheet.
		let initialStylesheet = document.querySelector("#initial-style");
		if (initialStylesheet) initialStylesheet.remove();

		// If we don't have a viewport tag, add it.  This makes Safari work more sanely when
		// in landscape.  If we're native, this is already set, and we want to use the existing
		// one or Safari doesn't always set the frame correctly.
		if (ppixiv.ios && document.querySelector("meta[name='viewport']") == null) {
			// Set the viewport.
			let meta = document.createElement("meta");
			meta.setAttribute("name", "viewport");
			meta.setAttribute(
				"content",
				"viewport-fit=cover, initial-scale=1, user-scalable=no",
			);
			document.head.appendChild(meta);
		}

		// Add <meta name=theme-color> to tell iOS how to color the UI.  If "Allow Website Tinting" is
		// enabled and the navigation bar is hidden, Safari tries to guess the UI color and sometimes
		// randomly gets it wrong.  We always want black.
		{
			let meta = document.createElement("meta");
			meta.setAttribute("name", "theme-color");
			meta.setAttribute("content", "#000");
			document.head.appendChild(meta);
		}

		// Now that we've cleared the document and added our style so our background color is
		// correct, we can unhide the document.
		this._undoTemporarilyHideDocument();

		// Device properties.  Do this after cleaning up the document, since it can create nodes.
		this._setDeviceProperties();
		ppixiv.settings.addEventListener("display_mode", this._setDeviceProperties);
		window.addEventListener("orientationchange", this._setDeviceProperties);
		new ResizeObserver(this._setDeviceProperties).observe(
			document.documentElement,
		);

		// Message popups:
		ppixiv.message = new MessageWidget({ container: document.body });

		// Load Recaptcha if it's required by Pixiv.
		Recaptcha.load();

		// Create the shared title.  This is set by helpers.setPageTitle.
		if (document.querySelector("title") == null)
			document.head.appendChild(document.createElement("title"));

		// Create the shared page icon.  This is set by setPageIcon.
		let documentIcon = document.head.appendChild(
			document.createElement("link"),
		);
		documentIcon.setAttribute("rel", "icon");

		// See if this is a slideshow staging window.  If it is, show the instruction dialog
		// and don't load screens.
		if (window.opener?.slideshowStagingDialog == window) {
			new SlideshowStagingDialog();
			return;
		}

		this.addClicksToSearchHistory(document.body);

		// Create the popup menu.
		if (!ppixiv.mobile)
			this._contextMenu = new ContextMenu({ container: document.body });

		LinkThisTabPopup.setup();
		SendHerePopup.setup();

		// Set the whats-new-updated class.
		WhatsNew.handleLastViewedVersion();

		// Create the screens.
		this._screenSearch = new ScreenSearch({
			container: document.body,
			visible: false,
		});
		this._screenIllust = new ScreenIllust({
			container: document.body,
			visible: false,
		});
		this._currentScreen = null;

		// Create the data source for this page.
		this.setCurrentDataSource({ cause: "initialization" });
	}

	// Pixiv puts listeners on popstate which we can't always remove, and can get confused and reload
	// the page when it sees navigations that don't work.
	//
	// Try to work around this by capturing popstate events and stopping the event, then redirecting
	// them to our own pp:popstate event, which is what we listen for.  This prevents anything other than
	// a capturing listener from seeing popstate.
	_windowRedirectPopstate = (e) => {
		e.stopImmediatePropagation();

		let e2 = new Event("pp:popstate");
		e.target.dispatchEvent(e2);
	};

	_windowPopstate = (e) => {
		// Set the current data source and state.
		this.setCurrentDataSource({
			cause: e.navigationCause || "history",
			scrollToTop: e.scrollToTop,
		});
	};

	_setDeviceProperties = () => {
		let insets = helpers.html.getSafeAreaInsets();

		helpers.html.setClass(document.documentElement, "mobile", ppixiv.mobile);
		let firefox =
			navigator.userAgent.indexOf("Gecko/") != -1 ||
			navigator.userAgent.indexOf("Firefox/") != -1;
		helpers.html.setClass(document.documentElement, "firefox", firefox);
		helpers.html.setClass(
			document.documentElement,
			"macos",
			navigator.userAgent.indexOf("Macintosh") != -1,
		); // at least Safari or Chrome
		helpers.html.setClass(document.documentElement, "ios", ppixiv.ios);
		helpers.html.setClass(document.documentElement, "android", ppixiv.android);
		helpers.html.setClass(
			document.documentElement,
			"phone",
			helpers.other.isPhone(),
		);
		document.documentElement.dataset.orientation = window.orientation ?? "0";
		helpers.html.setDataSet(
			document.documentElement.dataset,
			"hasBottomInset",
			insets.bottom > 0,
		);

		// Set has-overlaid-scrollbars if we think the browser has overlay scrollbars.  This
		// is used to figure out if scrollbar-gutter: both-edges adds padding or if we need to
		// do it ourself.  This used to be easy using overflow: overlay, but Google in their infinite
		// lack of wisdom removed that, leaving no way of enabling overlay scrollbars and no way
		// of knowing if scrollbar-gutter adds padding or not other than a manual test like this.
		// They didn't think this through at all.
		let testOverlayScrollbars = document.realCreateElement("div");
		testOverlayScrollbars.classList.add("overlay-scrollbar-tester");
		testOverlayScrollbars.style.position = "absolute";
		testOverlayScrollbars.style.visibility = "hidden";
		testOverlayScrollbars.style.scrollbarGutter = "stable both-edges";
		testOverlayScrollbars.style.overflowY = "auto";
		testOverlayScrollbars.style.width = "100px";
		testOverlayScrollbars.style.height = "100px";
		document.body.appendChild(testOverlayScrollbars);

		let hasOverlayScrollbars =
			testOverlayScrollbars.offsetWidth == testOverlayScrollbars.scrollWidth;
		helpers.html.setClass(
			document.documentElement,
			"has-overlay-scrollbars",
			hasOverlayScrollbars,
		);

		testOverlayScrollbars.remove();

		// Set the fullscreen mode.  See the device styling rules in main.scss for more
		// info.
		let displayMode = ppixiv.settings.get("display_mode", "auto");
		if (["auto", "normal", "notch", "safe"].indexOf(displayMode) == -1)
			displayMode = "auto";

		if (displayMode == "auto") displayMode = this.autoDisplayMode;

		document.documentElement.dataset.displayMode = displayMode;
	};

	// Return the display mode that will be used if "auto" is selected.
	//
	// Try to figure out if we're on a device with a notch.  There's no way to query this,
	// and if we're on an iPhone we can't even directly query which model it is, so we have
	// to guess.  For iPhones, assume that we have a notch if we have a bottom inset, since
	// all current iPhones with a notch also have a bottom inset for the ugly pointless white
	// line at the bottom of the screen.
	//
	// We'd like to default to notch mode if we're in a current iPhone in top navigation bar
	// mode, but that's hard to detect.
	get autoDisplayMode() {
		let insets = helpers.html.getSafeAreaInsets();
		if (ppixiv.ios && navigator.platform.indexOf("iPhone") != -1) {
			if (insets.bottom > 0) return "notch";

			// Work around an iOS bug: when running in Safari (not as a PWA) in landscape with the
			// toolbar hidden, the content always overlaps the navigation line, but it doesn't report
			// it in the safe area.  This causes us to not detect notch mode.  It does report the notch
			// safe area on the left or right, and incorrectly reports a matching safe area on the right
			// (there's nothing there to need a safe area), so check for this as a special case.
			if (
				!navigator.standalone &&
				insets.left > 20 &&
				insets.right == insets.left
			)
				return "notch";
		}

		return "normal";
	}

	get currentDataSource() {
		return this._dataSource;
	}

	// Create a data source for the current URL and activate it.
	//
	// This is called on startup, and in onpopstate where we might be changing data sources.
	async setCurrentDataSource(args) {
		// If we're called again before a previous call finishes, let the previous call
		// finish first.
		let token = (this._setCurrentDataSourceToken = new Object());

		// Wait for any other running setCurrentDataSource calls to finish.
		while (this._setCurrentDataSourcePromise != null)
			await this._setCurrentDataSourcePromise;

		// If token doesn't match anymore, another call was made, so ignore this call.
		if (token !== this._setCurrentDataSourceToken) return;

		let promise = (this._setCurrentDataSourcePromise =
			this._setCurrentDataSource(args));
		promise.finally(() => {
			if (promise == this._setCurrentDataSourcePromise)
				this._setCurrentDataSourcePromise = null;
		});
		return promise;
	}

	async _setCurrentDataSource({
		cause,
		refresh,
		scrollToTop,
		startAtBeginning,
	}) {
		let args = helpers.args.location;

		// Get the data source for the current URL.  If refresh is true, force a new data
		// source to be created instead of reusing an existing one.
		let dataSource = ppixiv.site.createDataSourceForUrl(ppixiv.plocation, {
			force: refresh,
			startAtBeginning,
		});

		// Figure out which screen to display.
		let newScreenName = args.hash.get("view") ?? dataSource.defaultScreen;
		console.assert(
			newScreenName == "illust" || newScreenName == "search",
			newScreenName,
		);
		let newScreen =
			newScreenName == "illust" ? this._screenIllust : this._screenSearch;

		// Remember what we were displaying before we start changing things.
		let oldScreen = this._currentScreen;

		// The media ID we're displaying if we're going to ScreenIllust.  If this is slideshow=first,
		// this will be null.
		let mediaId = null;
		if (newScreen.screenType == "illust")
			mediaId = dataSource.getUrlMediaId(args);

		// If we're going back to the start of the search, update the page URL to put it back
		// at the start too, and remove any saved scroll position.
		if (startAtBeginning) {
			delete args.state.scroll;
			dataSource.setStartPage(args, 1);
			helpers.navigate(args, {
				addToHistory: false,
				cause: "refresh-data-source",
				sendPopstate: false,
			});
		}

		// See if there's a media ID we want the new screen to display.  If the data source
		// is able to scan its results in advance, it can set the start page so it includes
		// this ID, so the search will start naturally around it.  ScreenSearch will display
		// images around it and navigating ScreenIllust will move around it.  (If we have
		// an image but the data source can't start there, we'll fall back on putting this
		// image at the beginning.)
		//
		// If scrollToTop (data-scroll-to-top) is set, skip this since we want to return to
		// the top of the search.
		let targetMediaId = null;
		if (!scrollToTop) {
			if (newScreen.screenType == "search") {
				if (oldScreen?.screenType == "illust") {
					// When going from illust -> search, target the image that was being displayed, so
					// we can scroll to it.
					targetMediaId = oldScreen?.displayedMediaId;
				} else {
					// Otherwise, if ScreenSearch has saved the scroll position, try to include
					// the image it wants to scroll to.
					targetMediaId = newScreen.getTargetMediaId(args);
				}
			} else if (newScreen.screenType == "illust") {
				// Use the image we'll be displaying.
				targetMediaId = mediaId;
			}
		}

		// Init the data source.
		await dataSource.init({ targetMediaId });

		// If slideshow=first, this is starting a slideshow at whichever image is first in the
		// results.  Set the media ID now that the data source is initialized and can look up
		// pages.
		if (
			newScreen.screenType == "illust" &&
			args.hash.get("slideshow") == "first"
		) {
			mediaId = await this.getMediaIdForSlideshow({ dataSource });
			if (mediaId == null) {
				// The search for this slideshow didn't return any images.  This can happen
				// from a saved slideshow link if the user's login creds are gone.  We can't
				// show the illust view without an illust, so navigate to the search equivalent
				// so the UI works to let the user log back in.
				ppixiv.message.show("Couldn't find a slideshow image to view");

				let args = helpers.args.location;
				args.hash.set("view", "search");
				args.hash.delete("slideshow");
				helpers.navigate(args, {
					addToHistory: true,
					cause: "slideshow-failed",
				});
				return;
			}

			console.log("Starting slideshow at:", mediaId);
			args.hash.set("slideshow", "1");
			dataSource.setUrlMediaId(mediaId, args);
			helpers.navigate(args, {
				addToHistory: false,
				cause: "start-slideshow",
				sendPopstate: false,
			});
		}

		// If the data source is changing, set it up.
		if (this._dataSource != dataSource) {
			if (this._dataSource != null) {
				// Shut down the old data source.
				this._dataSource.shutdown();

				// If the old data source was transient, discard it.
				if (this._dataSource.transient)
					ppixiv.site.discardDataSource(this._dataSource);
			}

			this._dataSource = dataSource;

			if (this._dataSource != null) this._dataSource.startup();
		}

		// If we're entering ScreenSearch, ignore clicks for a while.  See _windowClickCapture.
		if (newScreen.screenType === "search")
			this._ignoreClicksUntil = Date.now() + 100;

		console.debug(
			`Showing screen: ${newScreen.screenType}, data source: ${this._dataSource.name}, cause: ${cause}, media ID: ${mediaId ?? "(none)"}, scroll to: ${targetMediaId}`,
		);

		this._currentScreen = newScreen;

		if (newScreen !== oldScreen) {
			// Let the screens know whether they're current.  Screens don't use visible
			// directly (visibility is controlled by animations instead), but this lets
			// visibleRecursively know if the hierarchy is visible.
			if (oldScreen) oldScreen.visible = false;
			if (newScreen) newScreen.visible = true;

			let e = new Event("screenchanged");
			e.newScreen = newScreen.screenType;
			window.dispatchEvent(e);
		}

		// The data source is set separately from activation because scrollSearchToMediaId can set
		// the screen's data source before it's visible for transitions.
		newScreen.setDataSource(dataSource, { targetMediaId });

		if (this._contextMenu) {
			this._contextMenu.setDataSource(this._dataSource);

			// If we're showing a media ID, use it.  Otherwise, see if the screen is
			// showing one.
			let displayedMediaId = mediaId;
			displayedMediaId ??= newScreen.displayedMediaId;
			this._contextMenu.setMediaId(displayedMediaId);
		}

		// Tell translations the media ID we're viewing.
		ppixiv.imageTranslations.setDisplayedMediaId(mediaId);

		// Restore state from history if this is an initial load (which may be
		// restoring a tab), for browser forward/back, or if we're exiting from
		// quick view (which is like browser back).  This causes the pan/zoom state
		// to be restored.
		let restoreHistory =
			cause == "initialization" ||
			cause == "history" ||
			cause == "leaving-virtual";

		// Activate the new screen.
		await newScreen.activate({
			mediaId,
			cause,
			restoreHistory,
		});

		// Deactivate the old screen.
		if (oldScreen != null && oldScreen != newScreen) oldScreen.deactivate();
	}

	getRectForMediaId(mediaId) {
		return this._screenSearch.getRectForMediaId(mediaId);
	}

	// Return the URL to display a media ID.
	getMediaURL(mediaId, { screen = "illust", tempView = false } = {}) {
		console.assert(mediaId != null, "Invalid illust_id", mediaId);

		let args = helpers.args.location;

		// Check if this is a local ID.
		if (helpers.mediaId.isLocal(mediaId)) {
			if (helpers.mediaId.parse(mediaId).type == "folder") {
				// If we're told to show a folder: ID, always go to the search page, not the illust page.
				screen = "search";

				// When navigating to a subdirectory, discard the search filters.  If we're viewing bookmarks
				// and we click a bookmarked folder, we want to see contents of the bookmarked folder, not
				// bookmarks within the bookmark.
				args = new helpers.args("/");
			}
		}

		// If this is a user ID, just go to the user page.
		let { type, id } = helpers.mediaId.parse(mediaId);
		if (type == "user") return new helpers.args(`/users/${id}/artworks#ppixiv`);

		let oldMediaId = this._dataSource.getUrlMediaId(args);

		// Update the URL to display this mediaId.  This stays on the same data source,
		// so displaying an illust won't cause a search to be made in the background or
		// have other side-effects.
		this._setActiveScreenInUrl(args, screen);
		this._dataSource.setUrlMediaId(mediaId, args);

		if (tempView) {
			args.hash.set("virtual", "1");
			args.hash.set("temp-view", "1");
		} else {
			args.hash.delete("virtual");
			args.hash.delete("temp-view");
		}

		// If we were viewing a muted image and we're navigating away from it, remove view-muted so
		// we're muting images again.  Don't do this if we're navigating between pages of the same post.
		let [illustId] = helpers.mediaId.toIllustIdAndPage(mediaId);
		let [oldIllustId] = helpers.mediaId.toIllustIdAndPage(oldMediaId);
		if (illustId != oldIllustId) args.hash.delete("view-muted");

		return args;
	}

	// Show an illustration by ID.
	//
	// This actually just sets the history URL.  We'll do the rest of the work in popstate.
	showMediaId(mediaId, { addToHistory = false, ...options } = {}) {
		let args = this.getMediaURL(mediaId, options);
		helpers.navigate(args, { addToHistory });
	}

	// Return the displayed screen instance or name.
	getDisplayedScreen() {
		return this._currentScreen?.screenType;
	}

	// If we're viewing an illustration, return its media ID.
	//
	// Most of the time, we tell the screen and widgets what to display.  This is used for
	// edge cases where we just need to know the current ID.
	get displayedMediaId() {
		if (this._currentScreen?.screenType != "illust" || this._dataSource == null)
			return null;

		let args = helpers.args.location;
		return this._dataSource.getUrlMediaId(args);
	}

	_setActiveScreenInUrl(args, screen) {
		// If this is the default, just remove it.
		if (screen == this._dataSource.defaultScreen) args.hash.delete("view");
		else args.hash.set("view", screen);

		// If we're going to the search screen, remove the page and illust ID.
		if (screen == "search") {
			args.hash.delete("page");
			args.hash.delete("illust_id");
		}

		// If we're going somewhere other than illust, remove zoom state, so
		// it's not still around the next time we view an image.
		if (screen != "illust") delete args.state.zoom;
	}

	// This is called by ScreenIllust when it wants ScreenSearch to try to display a
	// media ID in a data source, so it's ready for a transition to start.  This only
	// has an effect if search isn't already active.
	scrollSearchToMediaId(dataSource, mediaId) {
		if (this._currentScreen.screenType == "search") return;

		this._screenSearch.setDataSource(dataSource, { targetMediaId: mediaId });
	}

	// Navigate to args.
	//
	// This is called when the illust view wants to pop itself and return to a search
	// instead of pushing a search in front of it.  If args is the previous history state,
	// we'll just go back to it, otherwise we'll replace the current state.  This is only
	// used when permanent navigation is enabled, otherwise we can't see what the previous
	// state was.
	navigateFromIllustToSearch(args) {
		// If phistory.permanent isn't active, just navigate normally.  This is only used
		// on mobile.
		if (!ppixiv.phistory.permanent) {
			helpers.navigate(args);
			return;
		}

		// Compare the canonical URLs, so we'll return to the entry in history even if the search
		// page doesn't match.
		let previousUrl = ppixiv.phistory.previousStateUrl;
		let canonicalPreviousUrl = previousUrl
			? helpers.getCanonicalUrl(previousUrl)
			: null;
		let canonicalNewUrl = helpers.getCanonicalUrl(args.url);
		let sameUrl = helpers.areUrlsEquivalent(
			canonicalPreviousUrl,
			canonicalNewUrl,
		);
		if (sameUrl) {
			console.log("Navigated search is last in history, going there instead");
			ppixiv.phistory.back();
		} else {
			helpers.navigate(args, { addToHistory: false });
		}
	}

	// This captures clicks at the window level, allowing us to override them.
	//
	// When the user left clicks on a link that also goes into one of our screens,
	// rather than loading a new page, we just set up a new data source, so we
	// don't have to do a full navigation.
	//
	// This only affects left clicks (middle clicks into a new tab still behave
	// normally).
	//
	// This also handles redirecting navigation to ppixiv.VirtualHistory on iOS.
	_windowClickCapture = (e) => {
		// Only intercept regular left clicks.
		if (e.button != 0 || e.metaKey || e.ctrlKey || e.altKey) return;

		if (!(e.target instanceof Element)) return;

		// We're taking the place of the default behavior.  If somebody called preventDefault(),
		// stop.
		if (e.defaultPrevented) return;

		// Look up from the target for a link.
		let a = e.target.closest("A");
		if (a == null || !a.hasAttribute("href")) return;

		// If this isn't a #ppixiv URL, let it run normally.
		let url = new URL(a.href, document.href);
		if (!helpers.args.isPPixivUrl(url)) return;

		// Stop all handling for this link.
		e.preventDefault();
		e.stopImmediatePropagation();

		// Work around an iOS bug.  After dragging out of an image, Safari sometimes sends a click
		// to the thumbnail that appears underneath the drag, even though it wasn't the element that
		// received the pointer events.  Stopping the pointerup event doesn't prevent this.  This
		// causes us to sometimes navigate into a random image after transitioning back out into
		// search results.  Prevent this by ignoring clicks briefly after changing to the search
		// screen.
		if (
			ppixiv.ios &&
			this._ignoreClicksUntil != null &&
			Date.now() < this._ignoreClicksUntil
		) {
			console.log(
				`Ignoring click while activating screen: ${this._ignoreClicksUntil - Date.now()}`,
			);
			return;
		}

		// If this is a link to an image (usually /artworks/#), navigate to the image directly.
		// This way, we actually use the URL for the illustration on this data source instead of
		// switching to /artworks.  This also applies to local image IDs, but not folders.
		url = helpers.pixiv.getUrlWithoutLanguage(url);
		let { mediaId } = this.getMediaIdAtElement(a);
		if (mediaId) {
			let args = new helpers.args(a.href);
			let screen = args.hash.has("view") ? args.hash.get("view") : "illust";
			this.showMediaId(mediaId, {
				screen: screen,
				addToHistory: true,
			});

			return;
		}

		helpers.navigate(url, {
			// If a link has the data-scroll-to-top attribute, remember that we want to scroll
			// to the top of the search instead of restoring the position.
			scrollToTop: a.dataset.scrollToTop, // data-scroll-to-top
		});
	};

	// Redirect keyboard events that didn't go into the active screen.
	_redirectEventToScreen = (e) => {
		let screen = this._currentScreen;
		if (screen == null) return;

		// If a dialog is open, leave inputs alone.
		if (DialogWidget.activeDialogs.length > 0) return;

		// If the event is going to an element inside the screen already, just let it continue.
		if (helpers.html.isAbove(screen.root, e.target)) return;

		// If the keyboard input didn't go to an element inside the screen, redirect
		// it to the screen.
		let e2 = new e.constructor(e.type, e);
		if (!screen.root.dispatchEvent(e2)) {
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
	};

	_windowKeydown = (e) => {
		// Ignore keypresses if we haven't set up the screen yet.
		let screen = this._currentScreen;
		if (screen == null) return;

		// If a dialog is open, leave inputs alone and don't process hotkeys.
		if (DialogWidget.activeDialogs.length > 0) return;

		// Let the screen handle the input.
		screen.handleKeydown(e);
	};

	// Return the media ID under element.
	getMediaIdAtElement(element) {
		if (element == null) return {};

		// Illustration search results have both the media ID and the user ID on it.
		let mediaElement = element.closest("[data-media-id]");
		if (mediaElement) return { mediaId: mediaElement.dataset.mediaId };

		let userElement = element.closest("[data-user-id]");
		if (userElement) return { mediaId: `user:${userElement.dataset.userId}` };

		return {};
	}

	// Load binary resources into blob URLs, so we don't copy images into every
	// place they're used.
	loadResourceBlobs() {
		// ppixiv.resources maps from resource names to URLs.  Fetch text resources like
		// HTML and SVG, and leave binaries as URLs.  Unless we're running natively or
		// in debug, these are all blob URLs.
		ppixiv.resources = {};

		for (let [path, value] of Object.entries(getResources())) {
			let filename = new URL(path, ppixiv.plocation).pathname;
			let binary = filename.endsWith(".png") || filename.endsWith(".woff");
			if (!binary) {
				// Just store text resources directly.
				ppixiv.resources[path] = value;
				continue;
			}

			let blob = new Blob([value]);
			let url = URL.createObjectURL(blob);
			ppixiv.resources[path] = url;
		}
	}

	_temporarilyHideDocument() {
		if (document.documentElement == null) return;

		document.documentElement.style.filter = "brightness(0)";
		document.documentElement.style.backgroundColor = "#000";
	}

	_undoTemporarilyHideDocument() {
		document.documentElement.style.filter = "";
		document.documentElement.style.backgroundColor = "";
	}

	// When viewing an image, toggle the slideshow on or off.
	toggleSlideshow() {
		// Add or remove slideshow=1 from the hash.
		if (this._currentScreen.screenType != "illust") return;

		let args = helpers.args.location;
		let enabled = args.hash.get("slideshow") == "1"; // not hold
		if (enabled) args.hash.delete("slideshow");
		else args.hash.set("slideshow", "1");

		helpers.navigate(args, { addToHistory: false, cause: "toggle slideshow" });
	}

	get slideshowMode() {
		return helpers.args.location.hash.get("slideshow");
	}

	loopSlideshow() {
		if (this._currentScreen.screenType != "illust") return;

		let args = helpers.args.location;
		let enabled = args.hash.get("slideshow") == "loop";
		if (enabled) args.hash.delete("slideshow");
		else args.hash.set("slideshow", "loop");

		helpers.navigate(args, { addToHistory: false, cause: "loop" });
	}

	// Return the URL args to display a slideshow from the current page.
	//
	// This is usually used from a search, and displays a slideshow for the current
	// search.  It can also be called while on an illust from SlideshowStagingDialog.
	get slideshowURL() {
		let args = this._dataSource.args;
		args.hash.set("slideshow", "first");
		args.hash.set("view", "illust");
		return args;
	}

	// When loading slideshowURL, try to find a starting image for the slideshow.
	async getMediaIdForSlideshow({ dataSource }) {
		// Load the initial page so we can look for an ID.
		await dataSource.loadPage(dataSource.initialPage);

		let mediaId = dataSource.idList.getFirstId();
		if (mediaId == null) return null;

		// The ID must be illust or file.  Make sure we don't set it to a folder.
		let { type } = helpers.mediaId.parse(mediaId);
		if (type != "file" && type != "illust") {
			console.log("Can't display ID as slideshow:", mediaId);
			return null;
		}

		return mediaId;
	}

	// Watch for clicks on links inside node.  If a search link is clicked, add it to the
	// recent search list.
	addClicksToSearchHistory(node) {
		node.addEventListener("click", function (e) {
			if (e.defaultPrevented) return;
			if (e.target.tagName != "A" || !e.target.hasAttribute("href")) return;

			// Only look at "/tags/TAG" URLs.
			let url = new URL(e.target.href);
			url = helpers.pixiv.getUrlWithoutLanguage(url);

			let parts = url.pathname.split("/");
			let firstPart = parts[1];
			if (firstPart != "tags") return;

			let tag = helpers.pixiv.getSearchTagsFromUrl(url);
			// console.log("Adding to tag search history:", tag);
			SavedSearchTags.add(tag);
		});
	}
}
