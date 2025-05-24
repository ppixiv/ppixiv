import * as math from "/vview/util/math.js";
import * as strings from "/vview/util/strings.js";
import * as html from "/vview/util/html.js";
import * as other from "/vview/util/other.js";
import Args from "/vview/util/args.js";
import * as mediaId from "/vview/util/media-id.js";
import * as pixiv from "/vview/util/pixiv.js";
import * as pixivRequest from "/vview/util/pixiv-request.js";

export class helpers {
	static getIconClassAndName(iconName) {
		let [iconSet, name] = iconName.split(":");
		if (name == null) {
			name = iconSet;
			iconSet = "mat";
		}

		let iconClass = "material-icons";
		if (iconSet == "ppixiv") iconClass = "ppixiv-icon";
		else if (iconSet == "mat") iconClass = "material-icons";

		return [iconClass, name];
	}

	// Create a font icon.  iconName is an icon set and name, eg. "mat:lightbulb"
	// for material icons or "ppixiv:icon" for our icon set.  If no icon set is
	// specified, material icons is used.
	static createIcon(
		iconName,
		{ asElement = false, classes = [], align = null, dataset = {} } = {},
	) {
		let [iconClass, name] = helpers.getIconClassAndName(iconName);

		let icon = document.createElement("span");
		icon.classList.add("font-icon");
		icon.classList.add(iconClass);
		icon.setAttribute("translate", "no");
		icon.lang = "icon";
		icon.innerText = name;

		for (let className of classes) icon.classList.add(className);
		if (align != null) icon.style.verticalAlign = align;
		for (let [key, value] of Object.entries(dataset)) icon.dataset[key] = value;

		if (asElement) return icon;
		else return icon.outerHTML;
	}

	// Find <ppixiv-inline> elements inside root, and replace them with elements
	// from resources:
	//
	// <ppixiv-inline src=image.svg></ppixiv-inline>
	//
	// Also replace <img src="ppixiv:name"> with resource text.  This is used for images.
	static _resource_cache = {};
	static replaceInlines(root) {
		for (let element of root.querySelectorAll("img")) {
			let src = element.getAttribute("src");
			if (!src || !src.startsWith("ppixiv:")) continue;

			let name = src.substr(7);
			let resource = ppixiv.resources[name];
			if (resource == null) {
				console.warn('Unknown resource "' + name + '" in', element);
				resource = other.blankImage;
			}
			element.setAttribute("src", resource);

			// Put the original URL on the element for diagnostics.
			element.dataset.originalUrl = src;
		}

		for (let element of root.querySelectorAll("ppixiv-inline")) {
			let src = element.getAttribute("src");

			// Import the cached node to make a copy, then replace the <ppixiv-inline> element
			// with it.
			let node = helpers.createInlineIcon(src);
			element.replaceWith(node);

			// Copy attributes from the <ppixiv-inline> node to the newly created node which
			// is replacing it.  This can be used for simple things, like setting the id.
			for (let attr of element.attributes) {
				if (attr.name === "src") continue;

				if (node.hasAttribute(attr.name)) {
					console.warn("Node", node, "already has attribute", attr);
					continue;
				}

				node.setAttribute(attr.name, attr.value);
			}
		}
	}

	// Create a general-purpose box link.
	static createBoxLink({
		label,
		link = null,
		classes = "",
		icon = null,
		popup = null,

		// If set, this is an extra explanation line underneath the label.
		explanation = null,

		// By default, return HTML as text, which is used to add these into templates, which
		// is the more common usage.  If asElement is true, an element will be returned instead.
		asElement = false,

		// Helpers for ScreenSearch:
		dataset = {},
		dataType = null,
	}) {
		if (!this._cachedBoxLinkTemplate) {
			// We always create an anchor, even if we don't have a link.  Browsers just treat it as
			// a span when there's no href attribute.
			//
			// label-box encloses the icon and label, so they're aligned to each other with text spacing,
			// which is needed to get text to align with font icons.  The resulting box is then spaced as
			// a unit within box-link's flexbox.
			let html = `
                <a class=box-link>
                    <div class=label-box>
                        <span hidden class=icon></span>
                        <span hidden class=label></span>
                        <vv-container class=widget-box></vv-container>
                    </div>
                    <span hidden class=explanation></span>
                </a>
            `;

			this._cachedBoxLinkTemplate = document.createElement("template");
			this._cachedBoxLinkTemplate.innerHTML = html;
		}
		let node = helpers.html.createFromTemplate(this._cachedBoxLinkTemplate);

		if (label != null) {
			node.querySelector(".label").hidden = false;
			node.querySelector(".label").innerText = label;
		}
		if (link) node.href = link;

		for (let className of classes || []) {
			if (className.length) node.classList.add(className);
		}

		if (popup) {
			node.classList.add("popup");
			node.dataset.popup = popup;
		}

		if (icon != null) {
			let [iconClass, iconName] = helpers.getIconClassAndName(icon);
			let iconElement = node.querySelector(".icon");
			iconElement.classList.add(iconClass);
			iconElement.classList.add("font-icon");
			iconElement.hidden = false;
			iconElement.innerText = iconName;
			iconElement.lang = "icon";

			// .with.text is set for icons that have text next to them, to enable padding
			// and spacing.
			if (label != null) iconElement.classList.add("with-text");
		}

		if (explanation != null) {
			let explanation_node = node.querySelector(".explanation");
			explanation_node.hidden = false;
			explanation_node.innerText = explanation;
		}

		if (dataType != null) node.dataset.type = dataType;
		for (let [key, value] of Object.entries(dataset)) node.dataset[key] = value;

		if (asElement) return node;
		else return node.outerHTML;
	}

	static createInlineIcon(src) {
		// Parse this element if we haven't done so yet.
		if (!this._resource_cache[src]) {
			// Find the resource.
			let resource = ppixiv.resources[src];
			if (resource == null) {
				console.error(`Unknown resource ${src}`);
				return null;
			}

			// resource is HTML.  Parse it by adding it to a <div>.
			let div = document.createElement("div");
			div.innerHTML = resource;
			let node = div.firstElementChild;
			node.remove();

			// Stash the source path on the node.  This is just for debugging to make
			// it easy to tell where things came from.
			node.dataset.ppixivResource = src;

			// Cache the result, so we don't re-parse the node every time we create one.
			this._resource_cache[src] = node;
		}

		let node = this._resource_cache[src];
		return document.importNode(node, true);
	}

	// Prompt to save a blob to disk.  For some reason, the really basic FileSaver API disappeared from
	// the web.
	static saveBlob(blob, filename) {
		let blobUrl = URL.createObjectURL(blob);

		let a = document.createElement("a");
		a.hidden = true;
		a.href = blobUrl;
		a.download = filename;
		document.body.appendChild(a);

		a.click();

		// Clean up.
		//
		// If we revoke the URL now, or with a small timeout, Firefox sometimes just doesn't show
		// the save dialog, and there's no way to know when we can, so just use a large timeout.
		realSetTimeout(() => {
			window.URL.revokeObjectURL(blobUrl);
			a.remove();
		}, 1000);
	}

	// Input elements have no way to tell when edits begin or end.  The input event tells
	// us when the user changes something, but it doesn't tell us when drags begin and end.
	// This is important for things like undo: you want to save undo the first time a slider
	// value changes during a drag, but not every time, or if the user clicks the slider but
	// doesn't actually move it.
	//
	// This adds events:
	//
	// editbegin
	// edit
	// editend
	//
	// edit events are always surrounded by editbegin and editend.  If the user makes multiple
	// edits in one action (eg. moving an input slider), they'll be sent in the same begin/end
	// block.
	//
	// This is only currently used for sliders, and doesn't handle things like keyboard navigation
	// since that gets overridden by other UI anyway.
	//
	// signal can be an AbortSignal to remove these event listeners.
	static watchEdits(input, { signal } = {}) {
		let dragging = false;
		let insideEdit = false;
		input.addEventListener(
			"mousedown",
			(e) => {
				if (e.button != 0 || dragging) return;
				dragging = true;
			},
			{ signal },
		);

		input.addEventListener(
			"mouseup",
			(e) => {
				if (e.button != 0 || !dragging) return;
				dragging = false;

				if (insideEdit) {
					insideEdit = false;
					input.dispatchEvent(new Event("editend"));
				}
			},
			{ signal },
		);

		input.addEventListener(
			"input",
			(e) => {
				// Send an editbegin event if we haven't yet.
				let send_editend = false;
				if (!insideEdit) {
					insideEdit = true;
					input.dispatchEvent(new Event("editbegin"));

					// If we're not dragging, this is an isolated edit, so send editend immediately.
					send_editend = !dragging;
				}

				// The edit event is like input, but surrounded by editbegin/editend.
				input.dispatchEvent(new Event("edit"));

				if (send_editend) {
					insideEdit = false;
					input.dispatchEvent(new Event("editend"));
				}
			},
			{ signal },
		);
	}

	// Force all external links to target=_blank on mobile.
	//
	// This improves links on iOS, especially when running as a PWA: the link will open in a nested Safari
	// context and then return to us without reloading when the link is closed.
	//
	// We currently only look at links when they're first added to the document and don't listen for
	// changes to href.
	static forceTargetBlankOnElement(node) {
		if (node.href == "" || node.getAttribute("target") == "_blank") return;

		let url;
		try {
			url = new URL(node.href);

			if (url.origin == document.location.origin) return;
		} catch (e) {
			// Ignore invalid URLs.
			return;
		}

		node.setAttribute("target", "_blank");
	}

	static forceTargetBlank() {
		if (!ppixiv.mobile) return;

		function updateNode(node) {
			if (node.querySelectorAll == null) return;

			helpers.forceTargetBlankOnElement(node);
			for (let a of node.querySelectorAll("A:not([target='_blank'])"))
				helpers.forceTargetBlankOnElement(a);
		}
		updateNode(document.documentElement);

		let observer = new MutationObserver((mutations) => {
			for (let mutation of mutations) {
				for (let node of mutation.addedNodes) updateNode(node);
			}
		});
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true,
		});
	}

	// Work around iOS Safari weirdness.  If a drag from the left or right edge of the
	// screen causes browser navigation, the underlying window position jumps, which
	// causes us to see pointer movement that didn't actually happen.  If this happens
	// during a drag, it causes the drag to move horizontally by roughly the screen
	// width.
	static shouldIgnoreHorizontalDrag(event) {
		// If there are no other history entries, we don't need to do this, since browser back
		// can't trigger.
		if (!ppixiv.ios || window.history.length <= 1) return false;

		// Ignore this event if it's close to the left or right edge of the screen.
		let width = 25;
		return event.clientX < width || event.clientX > window.innerWidth - width;
	}

	static async hideBodyDuringRequest(func) {
		// This hack tries to prevent the browser from flickering content in the wrong
		// place while switching to and from fullscreen by hiding content while it's changing.
		// There's no reliable way to tell when changing opacity has actually been displayed
		// since displaying frames isn't synchronized with toggling fullscreen, so we just
		// wait briefly based on testing.
		document.body.style.opacity = 0;
		let waitPromise = null;
		try {
			// Wait briefly for the opacity change to be drawn.
			let delay = 50;
			let start = Date.now();

			while (Date.now() - start < delay) await helpers.other.vsync();

			// Start entering or exiting fullscreen.
			waitPromise = func();

			start = Date.now();
			while (Date.now() - start < delay) await helpers.other.vsync();
		} finally {
			document.body.style.opacity = 1;
		}

		// Wait for requestFullscreen to finish after restoring opacity, so if it's waiting
		// to request permission we won't leave the window blank the whole time.  We'll just
		// flash black briefly.
		await waitPromise;
	}

	static isFullscreen() {
		// In VVbrowser, use our native interface.
		let vvbrowser = this._vvbrowser();
		if (vvbrowser) return vvbrowser.getFullscreen();

		if (document.fullscreenElement != null) return true;

		// Work around a dumb browser bug: document.fullscreen is false if fullscreen is set by something other
		// than the page, like pressing F11, making it a pain to adjust the UI for fullscreen.  Try to detect
		// this by checking if the window size matches the screen size.  This requires working around even more
		// ugliness:
		//
		// - We have to check innerWidth rather than outerWidth.  In fullscreen they should be the same since
		// there's no window frame, but in Chrome, the inner size is 16px larger than the outer size.
		// - innerWidth is scaled by devicePixelRatio, so we have to factor that out.  Since this leads to
		// fractional values, we also need to threshold the result.
		//
		// If only there was an API that could just tell us whether we're fullscreened.  Maybe it could be called
		// "document.fullscreen".  We can only dream...
		let windowWidth = window.innerWidth * devicePixelRatio;
		let windowHeight = window.innerHeight * devicePixelRatio;
		if (
			Math.abs(windowWidth - window.screen.width) < 2 &&
			Math.abs(windowHeight - window.screen.height) < 2
		)
			return true;

		// In Firefox, outer size is correct, so check it too.  This makes us detect fullscreen if inner dimensions
		// are reduced by panels in fullscreen.
		if (
			window.outerWidth == window.screen.width &&
			window.outerHeight == window.screen.height
		)
			return true;

		return false;
	}

	// If we're in VVbrowser, return the host object implemented in VVbrowserInterface.cpp.  Otherwise,
	// return null.
	static _vvbrowser({ sync = true } = {}) {
		if (sync) return window.chrome?.webview?.hostObjects?.sync?.vvbrowser;
		else return window.chrome?.webview?.hostObjects?.vvbrowser;
	}

	static async toggleFullscreen() {
		await helpers.hideBodyDuringRequest(async () => {
			// If we're in VVbrowser:
			let vvbrowser = this._vvbrowser();
			if (vvbrowser) {
				vvbrowser.setFullscreen(!helpers.isFullscreen());
				return;
			}

			// Otherwise, use the regular fullscreen API.
			if (helpers.isFullscreen()) document.exitFullscreen();
			else document.documentElement.requestFullscreen();
		});
	}

	// Return true if url1 and url2 are the same, ignoring any language prefix on the URLs.
	static areUrlsEquivalent(url1, url2) {
		if (url1 == null || url2 == null) return false;

		url1 = helpers.pixiv.getUrlWithoutLanguage(url1);
		url2 = helpers.pixiv.getUrlWithoutLanguage(url2);
		return url1.toString() == url2.toString();
	}

	static setPageTitle(title) {
		let title_element = document.querySelector("title");
		if (title_element.textContent == title) return;

		// Work around a Chrome bug: changing the title by modifying textContent occasionally flickers
		// a default title.  It seems like it's first assigning "", triggering the default, and then
		// assigning the new value.  This becomes visible especially on high refresh-rate monitors.
		// Work around this by adding a new title element with the new text and then removing the old
		// one, which prevents this from happening.  This is easy to see by monitoring title change
		// messages in VVbrowser.
		let new_title = document.createElement("title");
		new_title.textContent = title;
		document.head.appendChild(new_title);
		title_element.remove();

		document.dispatchEvent(new Event("windowtitlechanged"));
	}

	static setPageIcon(url) {
		document.querySelector("link[rel='icon']").href = url;
	}

	// Given a list of tags, return the URL to use to search for them.  This differs
	// depending on the current page.
	static getArgsForTagSearch(tags, url) {
		url = helpers.pixiv.getUrlWithoutLanguage(url);

		let type = helpers.pixiv.getPageTypeFromUrl(url);
		if (type == "tags") {
			// If we're on search already, just change the search tag, so we preserve other settings.
			// /tags/tag/artworks -> /tag/new tag/artworks
			let parts = url.pathname.split("/");
			parts[2] = encodeURIComponent(tags);
			url.pathname = parts.join("/");
		} else {
			// If we're not, change to search and remove the rest of the URL.
			url = new URL(
				"/tags/" + encodeURIComponent(tags) + "/artworks#ppixiv",
				url,
			);
		}

		// Don't include things like the current page in the URL.
		let args = helpers.getCanonicalUrl(url);
		return args;
	}

	// Return a canonical URL for a data source.  If the canonical URL is the same,
	// the same instance of the data source should be used.
	//
	// A single data source is used eg. for a particular search and search flags.  If
	// flags are changed, such as changing filters, a new data source instance is created.
	// However, some parts of the URL don't cause a new data source to be used.  Return
	// a URL with all unrelated parts removed, and with query and hash parameters sorted
	// alphabetically.
	static getCanonicalUrl(
		url,
		{
			// If false, we'll leave the search page and current image in the URL so the data
			// source will start where it left off.
			startAtBeginning = true,
		} = {},
	) {
		// Make a copy of the URL.
		url = new URL(url);

		// Remove /en from the URL if it's present.
		url = helpers.pixiv.getUrlWithoutLanguage(url);

		let args = new helpers.args(url);

		// Remove parts of the URL that don't affect which data source instance is used.
		//
		// If p=1 is in the query, it's the page number, which doesn't affect the data source.
		if (startAtBeginning) args.query.delete("p");

		// The manga page doesn't affect the data source.
		args.hash.delete("page");

		// #view=thumbs controls which view is active.
		args.hash.delete("view");

		// illust_id in the hash is always just telling us which image within the current
		// data source to view.  data_sources.current_illust is different and is handled in
		// the subclass.
		if (startAtBeginning) args.hash.delete("illust_id");

		// These are for temp view and don't affect the data source.
		args.hash.delete("virtual");
		args.hash.delete("temp-view");

		// This is for overriding muting.
		args.hash.delete("view-muted");

		// Ignore filenames for local IDs.
		if (startAtBeginning) args.hash.delete("file");

		// slideshow is used by the viewer and doesn't affect the data source.
		args.hash.delete("slideshow");

		// Sort query and hash parameters.
		args.query = helpers.other.sortQueryParameters(args.query);
		args.hash = helpers.other.sortQueryParameters(args.hash);

		return args;
	}

	// Add a basic event handler for an input:
	//
	// - When enter is pressed, submit will be called.
	// - Event propagation will be stopped, so global hotkeys don't trigger.
	//
	// Note that other event handlers on the input will still be called.
	static inputHandler(input, submit) {
		input.addEventListener("keydown", function (e) {
			// Always stopPropagation, so inputs aren't handled by main input handling.
			e.stopPropagation();

			// Note that we need to use e.key here and not e.code.  For enter presses
			// that are IME confirmations, e.code is still "Enter", but e.key is "Process",
			// which prevents it triggering this.
			if (e.key == "Enter") submit(e);
		});
	}

	// Navigate to args, which can be a URL object or a helpers.args.
	static navigate(
		args,
		{
			// If true, push the navigation onto browser history.  If false, replace the current
			// state.
			addToHistory = true,

			// popstate.navigationCause is set to this.  This allows event listeners to determine
			// what caused a navigation.  For browser forwards/back, this won't be present.
			cause = "navigation",

			// When navigating from an image to a search, by default we try to scroll to the image
			// we came from.  If scrollToTop is true, scroll to the top of the search instead.
			scrollToTop = false,

			// We normally synthesize window.onpopstate, so listeners for navigation will see this
			// as a normal navigation.  If this is false, don't do this.
			sendPopstate = true,
		} = {},
	) {
		if (args instanceof URL) args = new helpers.args(args);

		// Store the previous URL for comparison.  Normalize it with args, so comparing it with
		// toString() is reliable if the escaping is different, such as different %1E case or
		// not escaping spaces as +.
		let old_url = new helpers.args(ppixiv.plocation).toString();

		// Use the history state from args if it exists.
		let history_data = {
			...args.state,
		};

		// If the state wouldn't change at all, don't set it, so we don't add junk to
		// history if the same link is clicked repeatedly.  Comparing state via JSON
		// is OK here since JS will maintain key order.
		if (
			args.url.toString() == old_url &&
			JSON.stringify(history_data) == JSON.stringify(history.state)
		)
			return;

		// console.log("Changing state to", args.url.toString());
		if (addToHistory)
			ppixiv.phistory.pushState(history_data, "", args.url.toString());
		else ppixiv.phistory.replaceState(history_data, "", args.url.toString());

		// Chrome is broken.  After replacing state for a while, it starts logging
		//
		// "Throttling history state changes to prevent the browser from hanging."
		//
		// This is completely broken: it triggers with state changes no faster than the
		// user can move the mousewheel (much too sensitive), and it happens on replaceState
		// and not just pushState (which you should be able to call as fast as you want).
		//
		// People don't think things through.
		// console.log("Set URL to", ppixiv.plocation.toString(), addToHistory);

		if (ppixiv.plocation.toString() != old_url) {
			if (sendPopstate) {
				// Browsers don't send onpopstate for history changes, but we want them, so
				// send a synthetic one.
				// console.log("Dispatching popstate:", ppixiv.plocation.toString());
				let event = new PopStateEvent("pp:popstate");

				// Set initialNavigation to true.  This indicates that this event is for a new
				// navigation, and not from browser forwards/back.
				event.navigationCause = cause;
				event.scrollToTop = scrollToTop;

				window.dispatchEvent(event);
			}

			// Always dispatch pp:statechange.  This differs from popstate (pp:popstate) in that it's
			// always sent for all state changes.  This is used when we have UI that wants to refresh
			// based on the current location, even if it's an in-place update for the same location where
			// we don't send popstate.
			window.dispatchEvent(new PopStateEvent("pp:statechange"));
		}
	}

	static getTitleForIllust(mediaInfo) {
		if (mediaInfo == null) return null;

		let pageTitle = "";

		if (!helpers.mediaId.isLocal(mediaInfo.mediaId)) {
			// For Pixiv images, use the username and title, and indicate if the image is bookmarked.
			// We don't show bookmarks in the title for local images, since it's less useful.
			if (mediaInfo.bookmarkData) pageTitle += "★";

			pageTitle += mediaInfo.userName + " - " + mediaInfo.illustTitle;
			return pageTitle;
		} else {
			// For local images, put the filename at the front, and the two parent directories after
			// it.  For example, "books/Book Name/001" will be displayed a "001 - books/Book Name".
			// This is consistent with the title we use in the search view.
			let { id } = helpers.mediaId.parse(mediaInfo.mediaId);
			let name = helpers.strings.getPathSuffix(id, 1, 0); // filename
			let parent = helpers.strings.getPathSuffix(id, 2, 1); // parent directories
			pageTitle += `${name} - ${parent}`;
		}

		return pageTitle;
	}

	static setTitle(mediaInfo) {
		let pageTitle = helpers.getTitleForIllust(mediaInfo) ?? "Loading...";
		helpers.setPageTitle(pageTitle);
	}

	static setIcon({ vview = false } = {}) {
		if (ppixiv.native || vview)
			helpers.setPageIcon(ppixiv.resources["resources/vview-icon.png"]);
		else
			helpers.setPageIcon(ppixiv.resources["resources/regular-pixiv-icon.png"]);
	}

	static setTitleAndIcon(mediaInfo) {
		helpers.setTitle(mediaInfo);
		helpers.setIcon();
	}

	// Return 1 if the given keydown event should zoom in, -1 if it should zoom
	// out, or null if it's not a zoom keypress.
	static isZoomHotkey(e) {
		if (!e.ctrlKey) return null;

		if (e.code == "NumpadAdd" || e.code == "Equal") /* = */ return +1;
		if (e.code == "NumpadSubtract" || e.code == "Minus") /* - */ return -1;
		return null;
	}
}

// A convenience wrapper for setTimeout:
export class Timer {
	constructor(func) {
		this.func = func;
	}

	_runFunc = () => {
		this.func();
	};

	clear() {
		if (this.id == null) return;

		realClearTimeout(this.id);
		this.id = null;
	}

	set(ms) {
		this.clear();
		this.id = realSetTimeout(this._runFunc, ms);
	}
}

// Polyfill movementX and movementY for iOS < 17.
export class PointerEventMovement {
	constructor() {
		// If the browser supports movementX (everyone except for iOS Safari), this isn't
		// needed.
		if ("movementX" in new PointerEvent("test")) return;

		this.last_pointer_positions = {};

		window.addEventListener("pointerdown", (e) => this.pointerdown(e), {
			capture: true,
		});
		window.addEventListener("pointermove", (e) => this.pointerdown(e), {
			capture: true,
		});
		window.addEventListener("pointerup", (e) => this.pointerup(e), {
			capture: true,
		});
		window.addEventListener("pointercancel", (e) => this.pointerup(e), {
			capture: true,
		});
	}

	pointerdown(e) {
		// If this is the first event for this pointerId, store the current position.  Otherwise,
		// store the previous position.
		let previousX = this.last_pointer_positions[e.pointerId]?.x ?? e.screenX;
		let previousY = this.last_pointer_positions[e.pointerId]?.y ?? e.screenY;

		this.last_pointer_positions[e.pointerId] = { x: e.screenX, y: e.screenY };
		e.movementX = e.screenX - previousX;
		e.movementY = e.screenY - previousY;
	}

	pointerup(e) {
		delete this.last_pointer_positions[e.pointerId];
		e.movementX = e.movementY = 0;
	}
}

// This is like pointer_listener, but for watching for keys being held down.
// This isn't meant to be used for single key events.
class GlobalKeyListener {
	constructor() {
		this.keys_pressed = new Set();
		this.listeners = new Map(); // by key

		// Listen to keydown on bubble, so we don't see key presses that were stopped
		// by the original target, but listen to keyup on capture.
		window.addEventListener("keydown", (e) => {
			if (this.keys_pressed.has(e.key)) return;

			this.keys_pressed.add(e.key);
			this._callListenersForKey(e.key, true);
		});

		window.addEventListener(
			"keyup",
			(e) => {
				if (!this.keys_pressed.has(e.key)) return;

				this.keys_pressed.delete(e.key);
				this._callListenersForKey(e.key, false);
			},
			true,
		);

		window.addEventListener("blur", (e) => {
			this.releaseAllKeys();
		});

		// If the context menu is shown, release all keys, since browsers forget to send
		// keyup events when the context menu is open.
		window.addEventListener("contextmenu", async (e) => {
			// This is a pain.  We need to handle this event as late as possible, to let
			// all other handlers have a chance to preventDefault.  If we check it now,
			// contextmenu handlers (like blocking_context_menu_until_timer) can be registered
			// after us, and we won't see their preventDefault.
			//
			// This really wants an option for event listeners that causes it to be run after
			// other event handlers, but doesn't allow it to preventDefault, for event handlers
			// that specifically want to know if an event ended up being prevented.  But that
			// doesn't exist, so instead we just sleep to exit to the event loop, and look at
			// the event after it's completed.
			await helpers.other.sleep(0);
			if (e.defaultPrevented) return;

			this.releaseAllKeys();
		});
	}

	releaseAllKeys() {
		for (let key of this.keys_pressed) this._callListenersForKey(key, false);

		this.keys_pressed.clear();
	}

	_getListenersForKey(key, { create = false } = {}) {
		if (!this.listeners.has(key)) {
			if (!create) return [];
			this.listeners.set(key, new Set());
		}

		return this.listeners.get(key);
	}

	_registerListener(key, listener) {
		let listeners_for_key = this._getListenersForKey(key, { create: true });
		listeners_for_key.add(listener);

		// If key is already pressed, run the callback.  Defer this so we don't call
		// it while the caller is still registering.
		realSetTimeout(() => {
			// Stop if the listener was unregistered before we got here.
			if (!this._getListenersForKey(key).has(listener)) return;

			if (this.keys_pressed.has(key)) listener.keyChanged(true);
		}, 0);
	}

	_unregisterListener(key, listener) {
		let listeners_for_key = this._getListenersForKey(key, { create: false });
		if (listeners_for_key) listeners_for_key.delete(listener);
	}

	_callListenersForKey(key, down) {
		let listeners_for_key = this._getListenersForKey(key, { create: false });
		if (listeners_for_key == null) return;

		for (let key_listener of listeners_for_key.values())
			key_listener.keyChanged(down);
	}
}

export class KeyListener {
	static singleton = null;
	constructor(key, callback, { signal = null } = {}) {
		if (KeyListener.singleton == null)
			KeyListener.singleton = new GlobalKeyListener();

		this.callback = callback;
		this.pressed = false;

		KeyListener.singleton._registerListener(key, this);

		if (signal) {
			signal.addEventListener("abort", (e) => {
				KeyListener.singleton._unregisterListener(key, this);
			});
		}
	}

	keyChanged = (pressed) => {
		if (this.pressed == pressed) return;
		this.pressed = pressed;

		this.callback(pressed);
	};
}

// A helper to run an async function and abort a previous call if it's still running.
//
// async function func({args, signal}) { signal.throwIfAborted(); }
// this.runner = new GuardedRunner();
// this.runner.call(func, { args });
// this.runner.call(func, { args }); // aborts the previous call
// this.runner.abort(); // also aborts the previous call
// await this.runner.promise; // wait for the most recent call
export class GuardedRunner {
	constructor({ signal } = {}) {
		this._abort = null;
		this._promise = null;

		if (signal) signal.addEventListener("abort", () => this.abort());
	}

	call(func, { ...args }) {
		// If a previous call is still running, abort it.
		if (this._abort) this.abort();

		// Create an AbortController for this call.
		let abort = (this._abort = new AbortController());
		args = { ...args, signal: abort.signal };

		// Run the function.
		let promise = (this._promise = this._runIgnoringAborts(func, args));
		promise.finally(() => {
			if (this._abort == abort) this._abort = null;
			if (this._promise == promise) this._promise = null;
		});
		return promise;
	}

	// If a call is running, return its promise, otherwise return null.
	get promise() {
		return this._promise;
	}

	// Return true if a call is running.
	get isRunning() {
		return this._abort != null;
	}

	async _runIgnoringAborts(func, args) {
		try {
			return await func(args);
		} catch (e) {
			if (e.name == "AbortError") return;

			throw e;
		}
	}

	abort() {
		if (this._abort) {
			this._abort.abort();

			// Clear this._abort synchronously so isRunning is false when we return, and doesn't
			// have to wait for the exception to resolve.
			this._abort = null;
			this._promise = null;
		}
	}
}

export class FixedDOMRect extends DOMRect {
	constructor(left, top, right, bottom) {
		super(left, top, right - left, bottom - top);
	}

	// Allow editing the rect as a pair of x1,y1/x2,y2 coordinates, which is more natural
	// than x,y and width,height.  x1 and y1 can be greater than x2 and y2 if the rect is
	// inverted (width or height are negative).
	get x1() {
		return this.x;
	}
	get y1() {
		return this.y;
	}
	get x2() {
		return this.x + this.width;
	}
	get y2() {
		return this.y + this.height;
	}
	set x1(value) {
		this.width += this.x - value;
		this.x = value;
	}
	set y1(value) {
		this.height += this.y - value;
		this.y = value;
	}
	set x2(value) {
		this.width = value - super.x;
	}
	set y2(value) {
		this.height = value - super.y;
	}

	get middleHorizontal() {
		return (super.right + super.left) / 2;
	}
	get middleVertical() {
		return (super.top + super.bottom) / 2;
	}

	// Return a new FixedDOMRect with the edges pushed outwards by value.
	extendOutwards(value) {
		return new FixedDOMRect(
			this.left - value,
			this.top - value,
			this.right + value,
			this.bottom + value,
		);
	}

	// Crop this rect to fit within outer.
	cropTo(outer) {
		return new FixedDOMRect(
			helpers.math.clamp(this.x1, outer.x1, outer.x2),
			helpers.math.clamp(this.y1, outer.y1, outer.y2),
			helpers.math.clamp(this.x2, outer.x1, outer.x2),
			helpers.math.clamp(this.y2, outer.y1, outer.y2),
		);
	}
}

// Add:
//
// await controller.signal.wait()
//
// to wait for an AbortSignal to be aborted.
AbortSignal.prototype.wait = function () {
	if (this.aborted) return;

	if (this._promise == null) {
		this._promise = new Promise((accept) => {
			this._promise_accept = accept;
		});

		this.addEventListener(
			"abort",
			(e) => {
				this._promise_accept();
			},
			{ once: true },
		);
	}
	return this._promise;
};

// A helper for exponential backoff delays.
export class SafetyBackoffTimer {
	constructor({
		// Reset the backoff after this much time elapses without requiring a backoff.
		resetAfter = 60,

		// The maximum backoff delay time, in seconds.
		maxBackoff = 30,

		// The exponent for backoff.  Each successive backup waits for exponent^error count.
		exponent = 1.5,
	} = {}) {
		this.resetAfterMs = resetAfter * 1000;
		this.maxBackoffTime = maxBackoff * 1000;
		this.exponent = exponent;
		this.reset();
	}

	reset() {
		this.reset_at = Date.now() + this.resetAfterMs;
		this.backoff_count = 0;
	}

	async wait() {
		// If enough time has passed without a backoff, reset.
		if (Date.now() >= this.reset_at) this.reset();

		this.reset_at = Date.now() + this.resetAfterMs;
		this.backoff_count++;

		let delay_ms = Math.pow(this.exponent, this.backoff_count) * 1000;
		delay_ms = Math.min(delay_ms, this.maxBackoffTime);
		console.log("wait for", delay_ms);
		await helpers.other.sleep(delay_ms);
	}
}

// This is a wrapper to treat a classList as a set of flags that can be monitored.
//
// let flags = ClassFlags(element);
// flags.set("enabled", true);        // class="enabled"
// flags.set("selected", true);       // class="enabled selected"
// flags.set("enabled", false);       // class="selected"
//
//
export class ClassFlags extends EventTarget {
	// This class can be used on anything, but it's normally used on <html> for document-wide
	// flags.
	static get get() {
		if (this.singleton == null)
			this.singleton = new ClassFlags(document.documentElement);
		return this.singleton;
	}

	constructor(element) {
		super();

		this.element = element;

		// Use a MutationObserver, so we'll see changes whether they're made by us or something
		// else.
		let observer = new MutationObserver((mutations) => {
			// If we have multiple mutation records, we only need to process the first one, comparing
			// the first oldValue to the current value.
			let mutation = mutations[0];

			let old_classes = mutation.oldValue ?? "";
			let old_set = new Set(old_classes.split(" "));
			let new_set = this.element.classList;
			for (let name of new_set)
				if (!old_set.has(name)) this.broadcast(name, true);

			for (let name of old_set)
				if (!new_set.contains(name)) this.broadcast(name, false);
		});

		observer.observe(element, {
			attributeFilter: ["class"],
			attributeOldValue: true,
		});
	}

	get(name) {
		return this.element.classList.contains(name);
	}

	set(name, value) {
		// Update the class.  The mutation observer will handle broadcasting the change.
		helpers.html.setClass(this.element, name, value);

		return true;
	}

	// Dispatch an event for a change to the given key.
	broadcast(name, value) {
		let e = new Event(name);
		e.value = value;
		this.dispatchEvent(e);
	}
}

// A simple wakeup event.
class WakeupEvent {
	constructor() {
		this._signal = new AbortController();
	}

	// Wait until a call to wake().
	async wait() {
		await this._signal.signal.wait();
	}

	// Wake all current waiters.
	wake() {
		this._signal.abort();
		this._signal = new AbortController();
	}
}

// This keeps track of open UI that the user is interacting with which should
// prevent us from auto-advancing images in the slideshow.  This allows us to
// pause the slideshow or prevent it from advancing while the context menu or
// settings are open.
export class OpenWidgets extends EventTarget {
	static get singleton() {
		if (this._singleton == null) this._singleton = new this();
		return this._singleton;
	}

	constructor() {
		super();

		this._openWidgets = new Set();

		this.event = new WakeupEvent();
	}

	// If true, there are no open widgets or dialogs that should prevent the image from
	// changing automatically.
	get empty() {
		return this._openWidgets.size == 0;
	}

	// A shortcut to add or remove a widget.
	set(widget, value) {
		if (value) this.add(widget);
		else this.remove(widget);
	}

	// We're also an event target, so you can register to find out when dialogs are opened
	// and closed.
	_broadcastChanged() {
		this.dispatchEvent(new Event("changed"));
	}

	// Add an open widget to the list.
	add(widget) {
		let wasEmpty = this.empty;
		this._openWidgets.add(widget);
		if (wasEmpty) this._broadcastChanged();
	}

	// Remove an open UI from the list, possibly waking up callers to waitUntilEmpty.
	async remove(widget) {
		if (!this._openWidgets.has(widget)) return;

		this._openWidgets.delete(widget);

		if (this.event.size > 0) return;

		// Another widget might be added immediately after this one is removed, so don't wake
		// listeners immediately.  Yield to the event loop, and check after anything else on
		// the stack has finished.
		await null;

		// Let any listeners know that our empty status has changed.  Do this before checking
		// if we're empty, in case this causes somebody to open another dialog.
		this._broadcastChanged();

		if (this.event.size > 0) return;

		this.event.wake();
	}

	async waitUntilEmpty() {
		while (!this.empty) await this.event.wait();
	}

	// Return all open widgets.
	get_all() {
		return this._openWidgets;
	}
}

// These are used all over the place, so we add them here to avoid having to import them
// everywhere.  Eventually this module should just be a collection of these modules and
// everything else should be in submodules.
helpers.math = math;
helpers.strings = strings;
helpers.html = html;
helpers.other = other;
helpers.args = Args;
helpers.mediaId = mediaId;
helpers.pixiv = pixiv;
helpers.pixivRequest = pixivRequest;
