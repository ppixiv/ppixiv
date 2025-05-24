// Early setup.  If we're running in a user script, this is the entry point for regular
// app code that isn't running in the script sandbox, where we interact with the page
// normally and don't need to worry about things like unsafeWindow.
// If we're running on Pixiv, this checks if we want to be active, and handles adding the
// the "start ppixiv" button.  If the app is running, it starts it.  This also handles
// shutting down Pixiv's scripts before we get started.
//
// For vview, this is the main entry point.
// XXX: split out vview further, it doesn't need almost any of this
import App from "/vview/app.js";
import activateIcon from "/resources/favicon.png";

class AppStartupNative {
	constructor() {
		let ios =
			navigator.platform.indexOf("iPhone") != -1 ||
			navigator.platform.indexOf("iPad") != -1;
		let android = navigator.userAgent.indexOf("Android") != -1;
		let mobile = ios || android;

		// Set up the global object.
		window.ppixiv = {
			native: true,
			mobile,
			ios,
			android,
		};

		console.log(`vview setup: ${VVIEW_VERSION}`);
		console.log("Browser:", navigator.userAgent);

		this._cleanupEnvironment();

		// Run the app.
		console.log("Launching app");
		new App({});
	}

	// We're running in a local environment, so we don't need to do the cleanup that's
	// needed when running on Pixiv.  Just add stubs for the functions we'd set up.
	_cleanupEnvironment() {
		window.Document.prototype.realCreateElement =
			window.Document.prototype.createElement;
		window.realRequestAnimationFrame =
			window.requestAnimationFrame.bind(window);
		window.realCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
		window.realSetTimeout = window.setTimeout.bind(window);
		window.realClearTimeout = window.clearTimeout.bind(window);
		window.realSetInterval = window.setInterval.bind(window);
		window.realClearInterval = window.clearInterval.bind(window);
		window.realImage = window.Image;
		window.realFetch = window.fetch;
		window.MessagePort.prototype.realPostMessage =
			window.MessagePort.prototype.postMessage;
	}
}

class AppStartup {
	constructor() {
		this.initialSetup();
	}

	async initialSetup() {
		let native =
			location.hostname != "pixiv.net" && location.hostname != "www.pixiv.net";
		if (native) {
			new AppStartupNative();
			return;
		}

		let ios =
			navigator.platform.indexOf("iPhone") != -1 ||
			navigator.platform.indexOf("iPad") != -1;
		let android = navigator.userAgent.indexOf("Android") != -1;
		let mobile = ios || android;

		if (window.ppixiv) {
			// Make sure that we're not loaded more than once.  This can happen if we're installed in
			// multiple script managers, or if the release and debug versions are enabled simultaneously.
			console.error(
				"ppixiv has been loaded twice.  Is it loaded in multiple script managers?",
			);
			return;
		}

		// Set up the global object.
		window.ppixiv = {
			native: false,
			mobile,
			ios,
			android,
		};

		console.debug("Browser:", navigator.userAgent);

		// "Stay" for iOS leaves a <script> node containing ourself in the document.  Remove it for
		// consistency with other script managers.
		for (let node of document.querySelectorAll("script[id *= 'Stay']"))
			node.remove();

		// See if we're active, and watch for us becoming active or inactive.
		this.active = this._activeForCurrentUrl();
		window.addEventListener("popstate", (e) => this._windowPopstate(e), {
			capture: true,
		});

		// If we're not active, just see if we need to add our button, and stop without messing
		// around with the page more than we need to.
		if (!this.active) {
			this.setupDisabledUi();
			return;
		}

		// Set a dark background color early to try to prevent flashbangs if the page is rendered
		// before we get styles set up.
		document.documentElement.style.backgroundColor = "#000";

		// Run _cleanupEnvironment.  This will try to prevent the underlying page scripts from
		// making network requests or creating elements, and apply other irreversible cleanups
		// that we don't want to do before we know we're going to proceed.
		this._cleanupEnvironment();

		// Wait for DOMContentLoaded to make sure document.head and document.body are ready.
		// Suppress errors while we wait, since Pixiv's pages might be spamming a bunch of errors.
		this.suppressingErrors = true;
		await this._waitForContentLoaded();
		this.suppressingErrors = false;

		// Set ppixivShowLoggedOut to let the app show the "log back in" message.
		window.ppixivShowLoggedOut = this.showLoggedOutMessage.bind(this);

		// Run the app.
		new App();
	}

	// Block until DOMContentLoaded.
	_waitForContentLoaded() {
		return new Promise((accept, reject) => {
			if (document.readyState != "loading") {
				accept();
				return;
			}

			window.addEventListener("DOMContentLoaded", (e) => accept(), {
				capture: true,
				once: true,
			});
		});
	}

	// When we're disabled, but available on the current page, add the button to enable us.
	async setupDisabledUi(loggedOut = false) {
		console.log("ppixiv is currently disabled");

		// On mobile, only show the button if we're logged out, to give a way to ask the
		// user to log in.  Otherwise, we're enabled by default and the only way we should
		// get here is if the user explicitly opened Pixiv from the menu.
		if (!loggedOut && ppixiv.mobile) return;

		await this._waitForContentLoaded();

		// On most pages, we show our button in the top corner to enable us on that page.  Clicking
		// it on a search page will switch to us on the same search.
		let activateIconUrl = URL.createObjectURL(new Blob([activateIcon]));
		let disabledUi = document.createElement("div");
		disabledUi.innerHTML = `
            <div class=ppixiv-disabled-ui>
                <!-- The top-level template must contain only one node and we only create one
                    of these, so we just put this style in here. -->
                <style>
                .ppixiv-disabled-ui {
                    position: fixed;
                    bottom: 10px;
                    left: 16px;
                    z-index: 10;
                }
                .ppixiv-disabled-ui > a {
                    border: none;
                    display: block;
                    width: 46px;
                    height: 44px;
                    cursor: pointer;
                    background-color: transparent;
                    opacity: 0.7;
                    text-decoration: none;
                }
                .ppixiv-disabled-ui > a:hover {
                    opacity: 1;
                }
                </style>

                <a href="#ppixiv">
                    <img src=${activateIconUrl}>
                </a>
            </div>
        `;
		disabledUi = disabledUi.firstElementChild;

		this.refreshDisabledUi(disabledUi);

		document.body.appendChild(disabledUi);

		// Newer Pixiv pages update the URL without navigating, so refresh our button with the current
		// URL.  We should be able to do this in popstate, but that API has a design error: it isn't
		// called on pushState, only on user navigation, so there's no way to tell when the URL changes.
		// This results in the URL changing when it's clicked, but that's better than going to the wrong
		// page.
		disabledUi.addEventListener(
			"focus",
			(e) => this.refreshDisabledUi(disabledUi),
			{ capture: true },
		);
		window.addEventListener(
			"pp:popstate",
			(e) => this.refreshDisabledUi(disabledUi),
			{ capture: true },
		);

		if (this._urlSupported(window.location)) {
			// Remember that we're disabled in this tab.  This way, clicking the "return
			// to Pixiv" button will remember that we're disabled.  We do this on page load
			// rather than when the button is clicked so this works when middle-clicking
			// the button to open a regular Pixiv page in a tab.
			//
			// Only do this if we're available and disabled, which means the user disabled us.
			// If we wouldn't be available on this page at all, don't store it.
			this._storeDisabled(true);
		}

		// If we're showing this and we know we're logged out, show a message on click.
		// This doesn't work if we would be inactive anyway, since we don't know whether
		// we're logged in, so the user may need to click the button twice before actually
		// seeing this message.
		if (loggedOut) {
			disabledUi.querySelector("a").addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();

				this.showLoggedOutMessage(true);
			});
		}
	}

	showLoggedOutMessage(force) {
		// Unless forced, don't show the message if we've already shown it recently.
		// A session might last for weeks, so we don't want to force it to only be shown
		// once, but we don't want to show it repeatedly.
		let lastShown = window.sessionStorage.showedLogoutMessage || 0;
		let timeSinceShown = Date.now() - lastShown;
		let hoursSinceShown = timeSinceShown / (60 * 60 * 1000);
		if (!force && hoursSinceShown < 6) return;

		window.sessionStorage.showedLogoutMessage = Date.now();

		alert("Please log in to use ppixiv.");
	}

	refreshDisabledUi(disabledUi) {
		// If we're on a page that we don't support, like the top page, rewrite the link to switch to
		// a page we do support.  Otherwise, replace the hash with #ppixiv.
		if (this._urlSupported(window.location)) {
			let url = new URL(window.location);
			// url.hash = "#ppixiv";
			disabledUi.querySelector("a").href = url;
		} else {
			// This should be synced with MainController.setup.
			disabledUi.querySelector("a").href = "/ranking.php?mode=daily#ppixiv";
		}
	}

	// Return true if we're currently active.
	//
	// This is cached at the start of the page and doesn't change unless the page is reloaded.
	_activeForCurrentUrl() {
		if (ppixiv.native) return true;

		// If the hash is empty, use the default.
		if (window.location.hash === "") return this._activeByDefault();

		// If we have a hash and it's not #ppixiv, then we're explicitly disabled.
		if (!window.location.hash.startsWith("#ppixiv")) return false;

		// We have a #ppixiv hash, so we're available as long as we support this page.
		return this._urlSupported(window.location);
	}

	_windowPopstate = (e) => {
		const currently_active = this._activeForCurrentUrl();
		if (this.active === currently_active) return;

		// Stop propagation, so other listeners don't see this.  For example, this prevents
		// the thumbnail viewer from turning on or off as a result of us changing the hash
		// to "#no-ppixiv".
		e.stopImmediatePropagation();

		if (this.active === currently_active) return;

		this._storeDisabled(!currently_active);

		// The active state changed.  Remember the new state and reload the page.
		console.log("Active state changed");
		document.location.reload();
	};

	// Remember if we're enabled or disabled in this tab.
	_storeDisabled(disabled) {
		if (disabled) window.sessionStorage.ppixiv_disabled = 1;
		else delete window.sessionStorage.ppixiv_disabled;
	}

	// Return true if we're active by default on the current page.
	_activeByDefault() {
		if (ppixiv.native) return true;

		// If the disabled-by-default setting is enabled, disable by default until manually
		// turned on.  This is used too early to access the settings class, so just access
		// it directly.
		let disabled_by_default =
			localStorage["_ppixiv_disabled-by-default"] == "true";
		if (disabled_by_default) return false;

		// If this is set, the user clicked the "return to Pixiv" button.  Stay disabled
		// in this tab until we're reactivated.
		if (window.sessionStorage.ppixiv_disabled) return false;

		// Activate by default on the top page, even though it's not a real data source.  We'll
		// redirect to a supported page.
		let pathname = this._getPathWithoutLanguage(window.location.pathname);
		if (pathname == "/") return true;

		// Activate by default if a data source is available for this page.
		return this._urlSupported(window.location);
	}

	// helpers.pixiv.getPathWithoutLanguage:
	_getPathWithoutLanguage(path) {
		if (/^\/..\//.exec(path)) return path.substr(3);
		else return path;
	}

	// Return true if it's possible for us to be active on this page.
	//
	// This matches data_source.get_data_source_for_url, but only figures out whether
	// we recognize the URL or not, so we don't need as many URL helpers.
	_urlSupported(url) {
		if (ppixiv.native) return true;

		url = new URL(url);
		const pathname = this._getPathWithoutLanguage(url.pathname);

		const parts = pathname.split("/");
		const firstPart = parts[1]; // helpers.pixiv.getPageTypeFromUrl
		if (firstPart === "artworks") return true;
		if (firstPart === "user" && parts[3] === "series") return true;
		if (firstPart === "users") return true; // follows, artist, bookmarks, bookmarks_merged, bookmarks
		if (pathname === "/new_illust.php" || pathname === "/new_illust_r18.php")
			return true; // new_illust
		if (
			pathname === "/bookmark_new_illust.php" ||
			pathname === "/bookmark_new_illust_r18.php"
		)
			return true; // new_works_by_following
		if (firstPart === "tags") return true; // search
		if (pathname === "/discovery") return true; // discovery
		if (pathname === "/discovery/users") return true; // discovery_users
		if (pathname === "/bookmark_detail.php") return true; // related_illusts, related_favorites
		if (pathname === "/ranking.php") return true; // rankings
		if (pathname === "/search_user.php") return true; // search_users
		if (pathname.startsWith("/request/complete")) return true; // completed_requests
		if (firstPart === "" && window.location.hash.startsWith("#ppixiv/edits"))
			return true; // edited_images
		return false;
	}

	// Try to stop the underlying page from doing things (it just creates unnecessary network
	// requests and spams errors to the console), and undo damage to the environment that it
	// might have done before we were able to start.
	_cleanupEnvironment() {
		window.realRequestAnimationFrame =
			window.requestAnimationFrame.bind(window);

		// We disable a bunch of APIs below, but we want to allow recaptcha to call them.  This is
		// done by looking at the stack to see if stack frames in recaptcha's URLs exist.  There
		// isn't a standard way to do this, so we just look for it anywhere in the string.
		function isAllowed(type) {
			let e = new Error();
			let { stack } = e;
			let allowedHosts = ["recaptcha.net", "www.gstatic.com/recaptcha"];
			for (let host of allowedHosts) {
				if (stack.indexOf(host) != -1) {
					// console.log(`Allowing ${type} for ${host}`);
					return true;
				}
			}
			return false;
		}

		// Try to prevent Sentry from initializing (if it hasn't already) by defining its
		// singleton and making it read-only.  It amy have already run.
		window.__SENTRY__ = {};
		Object.freeze(window.__SENTRY__);

		// Newer Pixiv pages run a bunch of stuff from deferred scripts, which install a bunch of
		// nastiness (like searching for installed polyfills--which we install--and adding wrappers
		// around them).  Break this by defining a webpackJsonp property that can't be set.  It
		// won't stop the page from running everything, but it keeps it from getting far enough
		// for the weirder scripts to run.
		//
		// Also, some Pixiv pages set an onerror to report errors.  Disable it if it's there,
		// so it doesn't send errors caused by this script.  Remove _send and _time, which
		// also send logs.  It might have already been set (TamperMonkey in Chrome doesn't
		// implement run-at: document-start correctly), so clear it if it's there.
		for (let key of [
			"onerror",
			"onunhandledrejection",
			"_send",
			"_time",
			"webpackJsonp",
			"touchJsonp",
		]) {
			if (key == "onerror" || key == "onunhandledrejection") {
				window[key] = (message, source, lineno, colno, error) => {
					// To suppress the console error, onerror wants us to return true and
					// onunhandledrejection wants us to return false.
					let returnToSuppressError = key == "onerror";

					if (!this.suppressingErrors) return !returnToSuppressError;
					else return returnToSuppressError;
				};
			}

			// Use an empty setter instead of writable: false, so errors aren't triggered all the time.
			Object.defineProperty(window, key, {
				get: function () {
					return null;
				},
				set: function (value) {},
			});
		}

		// Try to unwrap functions that might have been wrapped by page scripts.
		function unwrapFunc(obj, name, { ignore_missing = false } = {}) {
			// Both prototypes and instances might be wrapped.  If this is an instance, look
			// at the prototype to find the original.
			let orig_func =
				obj.__proto__ && obj.__proto__[name] ? obj.__proto__[name] : obj[name];
			if (!orig_func) {
				if (!ignore_missing)
					console.log("Couldn't find function to unwrap:", name);
				return;
			}

			if (!orig_func.__sentry_original__) return;

			while (orig_func.__sentry_original__)
				orig_func = orig_func.__sentry_original__;
			obj[name] = orig_func;
		}

		try {
			unwrapFunc(window, "fetch");
			unwrapFunc(window, "setTimeout");
			unwrapFunc(window, "setInterval");
			unwrapFunc(window, "clearInterval");
			unwrapFunc(window, "requestAnimationFrame");
			unwrapFunc(window, "cancelAnimationFrame");
			unwrapFunc(EventTarget.prototype, "addEventListener");
			unwrapFunc(EventTarget.prototype, "removeEventListener");
			unwrapFunc(XMLHttpRequest.prototype, "send");
		} catch (e) {
			console.error("Error unwrapping environment", e);
		}

		// Delete owned properties on an object.  This removes wrappers around class functions
		// like document.addEventListener, so it goes back to the browser implementation, and
		// freezes the object to prevent them from being added in the future.
		function deleteOverrides(obj) {
			for (let prop of Object.getOwnPropertyNames(obj)) {
				try {
					delete obj[prop];
				} catch (e) {
					// A couple properties like document.location are normal and can't be deleted.
				}
			}

			try {
				Object.freeze(obj);
			} catch (e) {
				console.warn(`Error freezing ${obj}: ${e}`);
			}
		}

		try {
			// We might get here before the mangling happens, which means it might happen
			// in the future.  Freeze the objects to prevent this.
			Object.freeze(EventTarget.prototype);

			// Delete wrappers on window.history set by the site, and freeze it so they can't
			// be added.
			deleteOverrides(window.history);
			deleteOverrides(window.document);

			// Pixiv wraps console.log, etc., which breaks all logging since it causes them to all
			// appear to come from the wrapper.  Remove these if they're present and try to prevent
			// it from happening later.
			for (let name of Object.keys(window.console))
				unwrapFunc(console, name, { ignore_missing: true });
			Object.freeze(window.console);

			// Some Pixiv pages load jQuery and spam a bunch of error due to us stopping
			// their scripts.  Try to replace jQuery's exception hook with an empty one to
			// silence these.  This won't work if jQuery finishes loading after we do, but
			// that's not currently happening, so this is all we do for now.
			if ("jQuery" in window) jQuery.Deferred.exceptionHook = () => {};
		} catch (e) {
			console.error("Error unwrapping environment", e);
		}

		// Try to kill the React scheduler that Pixiv uses.  It uses a MessageChannel to run itself,
		// so we can disable it by disabling MessagePort.postmessage.  This seems to happen early
		// enough to prevent the first scheduler post from happening.
		//
		// Store the real postMessage, so we can still use it ourself.
		try {
			window.MessagePort.prototype.realPostMessage =
				window.MessagePort.prototype.postMessage;
			window.MessagePort.prototype.postMessage = function (...args) {
				if (!isAllowed("postMessage")) return -1;
				return window.MessagePort.prototype.realPostMessage.apply(this, args);
			};
		} catch (e) {
			console.error("Error disabling postMessage", e);
		}

		// blockFunction(window, "func", "realFunc") renames window.func to window.realFunc, and replaces
		// window.func with a dummy.
		function blockFunction(obj, name, realName) {
			let func = obj[name];
			console.assert(func != null);
			window[realName] = func;

			window[name] = function (...args) {
				// Check to see if the caller is whitelisted.
				if (!isAllowed(name)) return -1;
				return func.apply(this, args);
			};
		}

		// Disable requestAnimationFrame.  This can also be used by the React scheduler.
		blockFunction(window, "requestAnimationFrame", "realRequestAnimationFrame");
		blockFunction(window, "cancelAnimationFrame", "realCancelAnimationFrame");

		// Disable the page's timers.  This helps prevent things like GTM from running.
		blockFunction(window, "setTimeout", "realSetTimeout");
		blockFunction(window, "setInterval", "realSetInterval");
		blockFunction(window, "clearTimeout", "realClearTimeout");
		blockFunction(window, "clearInterval", "realClearInterval");

		try {
			window.addEventListener = Window.prototype.addEventListener.bind(window);
			window.removeEventListener =
				Window.prototype.removeEventListener.bind(window);
		} catch (e) {
			// This fails on iOS.  That's OK, since Pixiv's mobile site doesn't mess
			// with these (and since we can't write to these, it wouldn't be able to either).
		}

		window.realImage = window.Image;
		window.Image = function () {};

		// Replace window.fetch with a dummy to prevent some requests from happening.  Store it
		// in realFetch so we can use it.
		window.realFetch = window.fetch;

		class dummy_fetch {
			sent() {
				return this;
			}
		}
		dummy_fetch.prototype.ok = true;
		window.fetch = function () {
			return new dummy_fetch();
		};

		// We don't use XMLHttpRequest.  Disable it to make sure the page doesn't.
		window.XMLHttpRequest = function () {};

		// Similarly, prevent it from creating script and style elements.  Sometimes site scripts that
		// we can't disable keep running and do things like loading more scripts or adding stylesheets.
		// Use realCreateElement to bypass this.
		const origCreateElement = window.Document.prototype.createElement;
		window.Document.prototype.realCreateElement =
			window.Document.prototype.createElement;
		window.Document.prototype.createElement = function (type, options) {
			// Prevent the underlying site from creating these elements.
			if (type === "script" || type === "style" || type === "iframe") {
				if (!isAllowed("createElement")) {
					console.warn(`Disabling createElement ${type}`);
				}
			}
			return origCreateElement.apply(this, arguments);
		};

		// We have to hit things with a hammer to get Pixiv's scripts to stop running, which
		// causes a lot of errors.  Silence all errors that have a stack within Pixiv's sources.
		window.addEventListener(
			"error",
			(e) => {
				let silence_error = false;
				if (e.filename && e.filename.indexOf("s.pximg.net") != -1)
					silence_error = true;

				if (silence_error) {
					e.preventDefault();
					e.stopImmediatePropagation();
					return;
				}
			},
			true,
		);

		window.addEventListener(
			"unhandledrejection",
			(e) => {
				let silence_error = false;
				if (
					e.reason &&
					e.reason.stack &&
					e.reason.stack.indexOf("s.pximg.net") != -1
				)
					silence_error = true;
				if (e.reason && e.reason.message == "Element disabled")
					silence_error = true;

				if (silence_error) {
					e.preventDefault();
					e.stopImmediatePropagation();
					return;
				}
			},
			true,
		);
	}
}

new AppStartup();
