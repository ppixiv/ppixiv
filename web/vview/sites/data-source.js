import Widget from "/vview/widgets/widget.js";
import { DropdownMenuOpener } from "/vview/widgets/dropdown.js";
import IllustIdList from "/vview/sites/illust-id-list.js";
import LocalAPI from "/vview/misc/local-api.js";
import { helpers, SafetyBackoffTimer } from "/vview/misc/helpers.js";

export default class DataSource extends EventTarget {
	constructor({ url }) {
		super();

		this.url = new URL(url);
		this._resetLoadedPages();
	}

	_resetLoadedPages() {
		this.idList = new IllustIdList();
		this.loadingPages = {};
		this.loadedPages = {};
		this.firstEmptyPage = -1;
	}

	async init() {
		// If this data source supports a start page, store the page we started on.
		let args = new helpers.args(this.url);

		this.initialPage = this.getStartPage(args);
		// if(this.initialPage > 1)
		//    console.log("Starting at page", this.initialPage);
	}

	// If a data source returns a name, we'll display any .data-source-specific elements in
	// the thumbnail view with that name.
	get name() {
		return null;
	}

	toString() {
		return `${this.name}`;
	}

	// If true, allow expanding manga pages in results.  If this is false, manga pages are never
	// expanded and the button to enable it will be disabled.
	//
	// This should be false for data sources that don't return images, such as user searches, since
	// there will never be images to expand.  It must be false for data sources that can return
	// manga pages themselves, since expanding manga pages is incompatible with manga pages being
	// included in results.
	get allowExpandingMangaPages() {
		return true;
	}

	// Return true if all pages have been loaded.
	get loadedAllPages() {
		return this.firstEmptyPage != -1;
	}

	// Return this data source's URL as a helpers.args.
	get args() {
		return new helpers.args(this.url);
	}

	// startup() is called when the data source becomes active, and shutdown is called when
	// it's done.  This can be used to add and remove event handlers on the UI.
	startup() {
		this.active = true;
	}

	shutdown() {
		this.active = false;
	}

	// Return the URL to use to return to this search.  For most data sources, this is the URL
	// it was initialized with.
	get searchUrl() {
		return this.url;
	}

	// This returns the widget class that can be instantiated for this data source's UI.
	get ui() {
		return null;
	}

	// Load the given page.  Return true if the page was loaded.
	loadPage(page, { cause } = {}) {
		// Note that we don't remove entries from loadingPages when they finish, so
		// future calls to loadPage will still return a promise for that page that will
		// resolve immediately.
		let result = this.loadedPages[page] || this.loadingPages[page];
		if (result == null) {
			result = this._loadPageAsync(page, { cause });
			this.loadingPages[page] = result;
			result.finally(() => {
				// Move the load from loadingPages to loadedPages.
				delete this.loadingPages[page];
				this.loadedPages[page] = result;
			});
		}

		return result;
	}

	// Return true if the given page is either loaded, or currently being loaded by a call to loadPage.
	isPageLoadedOrLoading(page) {
		if (this.idList.isPageLoaded(page)) return true;
		if (this.loadedPages[page] || this.loadingPages[page]) return true;
		return false;
	}

	// Return true if any page is currently loading.
	get isAnyPageLoading() {
		for (let page in this.loadingPages)
			if (this.loadingPages[page]) return true;

		return false;
	}

	// Return true if the data source can load the given page.
	canLoadPage(page) {
		if (page < 1) return false;

		// Most data sources can load any page if they haven't loaded a page yet.  Once
		// a page is loaded, they only load contiguous pages.
		if (!this.idList.anyPagesLoaded) return true;

		// If we know a page is empty, don't try to load pages beyond it.
		if (this.firstEmptyPage != -1 && page >= this.firstEmptyPage) return false;

		// If we've loaded pages 5-6, we can load anything between pages 4 and 7.
		let lowestPage = this.idList.getLowestLoadedPage();
		let highestPage = this.idList.getHighestLoadedPage();
		return page >= lowestPage - 1 && page <= highestPage + 1;
	}

	async _loadPageAsync(page, { cause }) {
		// Stop if this page is outside the range this data source can load.
		if (!this.canLoadPage(page)) {
			// console.log(`Data source can't load page ${page}`);
			return;
		}

		// If the page is already loaded, stop.
		if (this.idList.isPageLoaded(page)) return true;

		console.debug(`Load page ${page} for: ${cause}`);

		// Before starting, await at least once so we get pushed to the event loop.  This
		// guarantees that loadPage has a chance to store us in this.loadingPages before
		// we do anything that might have side-effects of starting another load.
		await null;

		// Run the actual load.
		let { mediaIds, allowEmpty } = (await this.loadPageInternal(page)) ?? {};

		// Register the page if media IDs were returned.
		if (mediaIds) await this.addPage(page, mediaIds, { allowEmpty });

		// Reduce the start page, which will update the "load more results" button if any.
		if (this.supportsStartPage && page < this.initialPage)
			this.initialPage = page;

		// If there were no results, then we've loaded the last page.  Don't try to load
		// any pages beyond this.
		if (!this.idList.mediaIdsByPage.has(page)) {
			console.log("No data on page", page);
			if (this.firstEmptyPage == -1 || page < this.firstEmptyPage)
				this.firstEmptyPage = page;
		} else if (this.idList.mediaIdsByPage.get(page).length == 0) {
			// A page was added, but it was empty.  This is rare and can only happen if the
			// data source explicitly adds an empty page, and means there was an empty search
			// page that wasn't at the end.  This breaks the search view's logic (it expects
			// to get something back to trigger another load).  Work around this by starting
			// the next page.
			//
			// This is very rare.  Use a strong backoff, so if this happens repeatedly for some
			// reason, we don't hammer the API loading pages infinitely and get users API blocked.
			this.emptyPageLoadBackoff ??= new SafetyBackoffTimer();

			console.log(
				`Load was empty, but not at the end.  Delaying before loading the next page...`,
			);
			await this.emptyPageLoadBackoff.wait();

			console.log(`Continuing load from ${page + 1}`);
			return await this.loadPage(page + 1);
		}

		return true;
	}

	// If a URL for this data source contains a media ID to view, return it.  Otherwise, return
	// null.
	getUrlMediaId(args) {
		// Most data sources for Pixiv store the media ID in the hash, separated into the
		// illust ID and page.
		let illustId = args.hash.get("illust_id");
		if (illustId == null) return null;

		let page = this.getUrlMangaPage(args);
		return helpers.mediaId.fromIllustId(illustId, page);
	}

	// If the URL specifies a manga page, return it, otherwise return 0.
	getUrlMangaPage(args) {
		if (!args.hash.has("page")) return 0;

		// Pages are 1-based in URLs, but 0-based internally.
		return parseInt(args.hash.get("page")) - 1;
	}

	// Set args to include the media ID being viewed.  This is usually a media ID that the
	// data source returned.
	setUrlMediaId(mediaId, args) {
		let [illustId, page] = helpers.mediaId.toIllustIdAndPage(mediaId);
		if (this.supportsStartPage) {
			// Store the page the illustration is on in the hash, so if the page is reloaded while
			// we're showing an illustration, we'll start on that page.  If we don't do this and
			// the user clicks something that came from page 6 while the top of the search results
			// were on page 5, we'll start the search at page 5 if the page is reloaded and not find
			// the image, which is confusing.
			let { page: originalPage } = this.idList.getPageForMediaId(illustId);
			if (originalPage != null) this.setStartPage(args, originalPage);
		}

		// By default, put the illust ID and page in the hash.
		args.hash.set("illust_id", illustId);

		if (page == null) args.hash.delete("page");
		else args.hash.set("page", page + 1);
	}

	// Store the current page in the URL.
	//
	// This is only used if supportsStartPage is true.
	setStartPage(args, page) {
		// Remove the page for page 1 to keep the initial URL clean.
		if (page == 1) args.query.delete("p");
		else args.query.set("p", page);
	}

	getStartPage(args) {
		// If the data source doesn't support this, the start page is always 1.
		if (!this.supportsStartPage) return 1;

		let page = args.query.get("p") || "1";
		return parseInt(page) || 1;
	}

	// Return the page title to use.
	get pageTitle() {
		return "Pixiv";
	}

	// Set the page icon.
	setPageIcon() {
		helpers.setIcon();
	}

	// If true, "No Results" will be displayed.
	get hasNoResults() {
		return this.idList.getFirstId() == null && !this.isAnyPageLoading;
	}

	// This is implemented by the subclass.
	async loadPageInternal(page) {
		throw "Not implemented";
	}

	// Return the estimated number of items per page.
	get estimatedItemsPerPage() {
		// Most newer Pixiv pages show a grid of 6x8 images.  Try to match it, so page numbers
		// line up.
		return 48;
	}

	// Return the screen that should be displayed by default, if no "view" field is in the URL.
	get defaultScreen() {
		return "search";
	}

	// If we're viewing a page specific to a user (an illustration or artist page), return
	// the user ID we're viewing.  This can change when refreshing the UI.
	get viewingUserId() {
		return null;
	}

	// If a data source is transient, it'll be discarded when the user navigates away instead of
	// reused.
	get transient() {
		return false;
	}

	// Some data sources can restart the search at a page.
	get supportsStartPage() {
		return false;
	}

	// Most searches will only auto-load forwards and display "Load Previous Results" at the top.
	// If this is true, the search is allowed to automatically load backwards too.
	get autoLoadPreviousPages() {
		return false;
	}

	// Return the "15 / 100" page text to use.  This is only used by DataSource_VView.
	getPageTextForMediaId(mediaId) {
		return null;
	}

	// Register a page of data.
	async addPage(page, mediaIds, { ...options } = {}) {
		// If an image view is reloaded, it may no longer be on the same page in the underlying
		// search.  New posts might have pushed it onto another page, or the search might be
		// random.  This is confusing if you're trying to mousewheel navigate to other images.
		//
		// Work around this by making sure the initial image is on the initial page.  If we load
		// the first page and the image we were on isn't there anymore, insert it into the results.
		// It's probably still in the results somewhere, but we can't tell where.
		//
		// This allows the user to navigate to neighboring images normally.  We'll go to different
		// images, but at least we can still navigate, and we can get back to where we started
		// if the user navigates down and then back up.  If the image shows up in real results later,
		// it'll be filtered out.
		let initialMediaId = this.getUrlMediaId(this.args);

		// If this data source doesn't return manga pages, always use the first page.
		if (this.allowExpandingMangaPages)
			initialMediaId = helpers.mediaId.getMediaIdForPage(initialMediaId, 0);

		if (
			page == this.initialPage &&
			initialMediaId != null &&
			this.idList.getPageForMediaId(initialMediaId).page == null &&
			mediaIds.indexOf(initialMediaId) == -1
		) {
			// Make sure the media ID has info before adding it to the list.
			if (
				await ppixiv.mediaCache.getMediaInfo(initialMediaId, { full: false })
			) {
				console.log(
					`Adding initial media ID ${initialMediaId} to initial page ${this.initialPage}`,
				);
				mediaIds = [initialMediaId, ...mediaIds];
			}
		}

		// Verify that all results have media info registered.
		for (let mediaId of mediaIds) {
			let { type, id } = helpers.mediaId.parse(mediaId);
			if (type == "user" || type == "bookmarks") {
				if (ppixiv.extraCache.getQuickUserData(id) == null) {
					console.error(
						`Data source returned ${mediaId} without registering user info`,
						this,
					);
					throw new Error(`Data source returned didn't register user info`);
				}
			} else {
				if (
					ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false }) == null
				) {
					console.error(
						`Data source returned ${mediaId} without registering media info`,
						this,
					);
					throw new Error(`Data source returned didn't register media info`);
				}
			}
		}

		this.idList.addPage(page, mediaIds, { ...options });

		// Send pageadded asynchronously to let listeners know we added the page.
		let e = new Event("pageadded");
		e.dataSource = this;
		helpers.other.defer(() => this.dispatchEvent(e));
	}

	// Send the "updated" event when we want to tell our parent that something has changed.
	// This is used when we've added a new page and the search view might want to refresh,
	// if the page title should be refreshed, etc.  Internal updates don't need to call this.
	callUpdateListeners() {
		this.dispatchEvent(new Event("updated"));
	}

	// Return info useful for the container's UI elements:
	//
	// {
	//     mediaId,                   // media ID associated with the search, for restoring search scroll position
	//     imageUrl,                  // URL for an image related to this search
	//     imageLinkUrl,              // a URL where imageUrl should link to
	//     userId,                    // a user ID whose avatar should be displayed
	//     mobileTitle,               // an alternate title for the mobile search menu
	//     headerStripURL,            // a URL to an image to show at the top of the search
	// }
	//
	// If this changes, the "updated" event will be sent to the data source.
	get uiInfo() {
		return {};
	}

	createAndSetButton(parent, createOptions, setupOptions) {
		let button = helpers.createBoxLink({
			asElement: true,
			...createOptions,
		});
		parent.appendChild(button);
		this.setItem(button, setupOptions);
		return button;
	}

	// Create a common search dropdown.  button is options to createBoxLink, and items
	// is options to setItem.
	setupDropdown(button, items) {
		return new DropdownMenuOpener({
			button,
			createDropdown: ({ ...options }) => {
				let dropdown = new Widget({
					...options,
					template: `<div class=vertical-list></div>`,
				});

				for (let { createOptions, setupOptions } of items)
					this.createAndSetButton(dropdown.root, createOptions, setupOptions);

				return dropdown;
			},
		});
	}

	// A helper for setting up UI links.  Find the link with the given type,
	// set all {key: value} entries as query parameters, and remove any query parameters
	// where value is null.  Set .selected if the resulting URL matches the current one.
	//
	// If defaults is present, it tells us the default key that will be used if
	// a key isn't present.  For example, search.php?s_mode=s_tag is the same as omitting
	// s_mode.  We prefer to omit it rather than clutter the URL with defaults, but we
	// need to know this to figure out whether an item is selected or not.
	//
	// If a key begins with #, it's placed in the hash rather than the query.
	setItem(link, { type = null, ...options } = {}) {
		// If no type is specified, link itself is the link.
		if (type != null) {
			link = link.querySelector(`[data-type='${type}']`);
			if (link == null) {
				console.warn("Couldn't find button with selector", type);
				return;
			}
		}

		// The URL we're adjusting:
		let args = new helpers.args(this.url);

		// Adjust the URL for this button.
		let { args: newArgs, buttonIsSelected } = this.setItemInUrl(args, options);

		helpers.html.setClass(link, "selected", buttonIsSelected);

		link.href = newArgs.url.toString();
	}

	// Apply a search filter button to a search URL, activating or deactivating a search
	// filter.  Return { args, buttonIsSelected }.
	setItemInUrl(
		args,
		{
			// The fields selected when this button is activated.  For example: { sort: "alpha" }
			fields = null,

			// An optional set of default fields: the values that will be used if the key isn't
			// present.
			defaults = null,

			// If true, pressing this button toggles its keys on and off instead of always setting
			// them.
			toggle = false,

			// If provided, this allows modifying URLs that put parameters in URL segments instead
			// of the query where they belong.  If urlFormat is "abc/def/ghi", a key of "/abc" will modify
			// the first segment, and so on.
			urlFormat = null,

			// This can be used to adjust the link's URL without affecting anything else.
			adjustUrl = null,
		} = {},
	) {
		// Ignore the language prefix on the URL if any, so it doesn't affect urlFormat.
		args.path = helpers.pixiv.getPathWithoutLanguage(args.path);

		// If urlParts is provided, create a map from "/segment" to a segment number like "/1" that
		// args.set uses.
		let urlParts = {};
		if (urlFormat != null) {
			let parts = urlFormat.split("/");
			for (let idx = 0; idx < parts.length; ++idx)
				urlParts["/" + parts[idx]] = "/" + idx;
		}

		// Collect data for each key.
		let fieldData = {};
		for (let [key, value] of Object.entries(fields)) {
			let originalKey = key;

			let defaultValue = null;
			if (defaults && key in defaults) defaultValue = defaults[key];

			// Convert path keys in fields from /path to their path index.
			if (key.startsWith("/")) {
				if (urlParts[key] == null) {
					console.warn(`URL key ${key} not specified in URL: ${args}`);
					continue;
				}

				key = urlParts[key];
			}

			fieldData[key] = {
				value,
				originalKey,
				defaultValue,
			};
		}

		// This button is selected if all of the keys it sets are present in the URL.
		let buttonIsSelected = true;

		for (let [key, { value, defaultValue }] of Object.entries(fieldData)) {
			// The value we're setting in the URL:
			let thisValue = value ?? defaultValue;

			// The value currently in the URL:
			let selectedValue = args.get(key) ?? defaultValue;

			// If the URL didn't have the key we're setting, then it isn't selected.
			if (thisValue != selectedValue) buttonIsSelected = false;

			// If the value we're setting is the default, delete it instead.
			if (defaults != null && thisValue == defaultValue) value = null;

			args.set(key, value);
		}

		// If this is a toggle and the button is selected, set the fields to their default,
		// turning this into an "off" button.
		if (toggle && buttonIsSelected) {
			for (let [key, { defaultValue }] of Object.entries(fieldData))
				args.set(key, defaultValue);
		}

		// Don't include the page number in search buttons, so clicking a filter goes
		// back to page 1.
		args.set("p", null);

		if (adjustUrl) adjustUrl(args);

		return { args, buttonIsSelected };
	}

	// Return true of the thumbnail view should show bookmark icons for this source.
	get showBookmarkIcons() {
		return true;
	}

	// Return the next or previous image to navigate to from mediaId.  If we're at the end of
	// the loaded results, load the next or previous page.  If mediaId is null, return the first
	// image.  This only returns illusts, not users or folders.
	//
	// This currently won't load more than one page.  If we load a page and it only has users,
	// we won't try another page.
	async getOrLoadNeighboringMediaId(mediaId, next, options = {}) {
		// See if it's already loaded.
		let newMediaId = this.idList.getNeighboringMediaId(mediaId, next, options);
		if (newMediaId != null) return newMediaId;

		// We didn't have the new illustration, so we may need to load another page of search results.
		// See if we know which page mediaId is on.
		let page =
			mediaId != null ? this.idList.getPageForMediaId(mediaId).page : null;

		// Find the page this illustration is on.  If we don't know which page to start on,
		// use the initial page.
		if (page != null) {
			page += next ? +1 : -1;
			if (page < 1) return null;
		} else {
			// If we don't know which page mediaId is on, start from initialPage.
			page = this.initialPage;
		}

		// Short circuit if we already know this is past the end.  This just avoids spamming
		// logs.
		if (!this.canLoadPage(page)) return null;

		console.debug("Loading the next page of results:", page);

		// The page shouldn't already be loaded.  Double-check to help prevent bugs that might
		// spam the server requesting the same page over and over.
		if (this.idList.isPageLoaded(page)) {
			console.error(`Page ${page} is already loaded`);
			return null;
		}

		// Load a page.
		const newPageLoaded = await this.loadPage(page, {
			cause: "illust navigation",
		});
		if (!newPageLoaded) return null;

		// Now that we've loaded data, try to find the new image again.
		console.debug("Finishing navigation after data load");
		return this.idList.getNeighboringMediaId(mediaId, next, options);
	}

	// Get the next or previous image to fromMediaId.  If we're at the end, loop back
	// around to the other end.  options is the same as getOrLoadNeighboringMediaId.
	async getOrLoadNeighboringMediaIdWithLoop(fromMediaId, next, options = {}) {
		// See if we can keep moving in this direction.
		let mediaId = await this.getOrLoadNeighboringMediaId(
			fromMediaId,
			next,
			options,
		);
		if (mediaId) return mediaId;

		// We're out of results in this direction.  If we're moving backwards, only loop
		// if we have all results.  Otherwise, we'll go to the last loaded image, but if
		// the user then navigates forwards, he'll just go to the next image instead of
		// where he came from, which is confusing.
		if (!next && !this.loadedAllPages) {
			console.log("Not looping backwards since we don't have all pages");
			return null;
		}

		return next ? this.idList.getFirstId() : this.idList.getLastId();
	}
}

// This is a base class for data sources that work by loading a regular Pixiv page
// and scraping it.
//
// All of these work the same way.  We keep the current URL (ignoring the hash) synced up
// as a valid page URL that we can load.  If we change pages or other search options, we
// modify the URL appropriately.
export class DataSourceFromPage extends DataSource {
	constructor(url) {
		super(url);

		this.itemsPerPage = 1;
		this.originalUrl = url;
	}

	get estimatedItemsPerPage() {
		return this.itemsPerPage;
	}

	async loadPageInternal(page) {
		// Our page URL looks like eg.
		//
		// https://www.pixiv.net/bookmark.php?p=2
		//
		// possibly with other search options.  Request the current URL page data.
		let url = new URL(this.url);

		// Update the URL with the current page.
		url.searchParams.set("p", page);

		console.log("Loading:", url.toString());

		let doc = await helpers.pixivRequest.fetchDocument(url);

		let mediaIds = this.parseDocument(doc);
		if (mediaIds == null) {
			// The most common case of there being no data in the document is loading
			// a deleted illustration.  See if we can find an error message.
			console.error("No data on page");
			return;
		}

		// Assume that if the first request returns 10 items, all future pages will too.  This
		// is usually correct unless we happen to load the last page last.  Allow this to increase
		// in case that happens.  (This is only used by the thumbnail view.)
		if (this.itemsPerPage == 1)
			this.itemsPerPage = Math.max(mediaIds.length, this.itemsPerPage);

		return { mediaIds };
	}

	// Parse the loaded document and return the media IDs.
	parseDocument(doc) {
		throw "Not implemented";
	}
}

// This extends DataSource with local pagination.
//
// A few API calls just return all results as a big list of IDs.  We can handle loading
// them all at once, but it results in a very long scroll box, which makes scrolling
// awkward.  This artificially paginates the results.
export class DataSourceFakePagination extends DataSource {
	async loadPageInternal(page) {
		if (this.pages == null) {
			let mediaIds = await this.loadAllResults();
			this.pages = PaginateMediaIds(mediaIds, this.estimatedItemsPerPage);
		}

		let mediaIds = this.pages[page - 1] || [];
		return { mediaIds };
	}

	// Implemented by the subclass.  Load all results, and return the resulting IDs.
	async loadAllResults() {
		throw "Not implemented";
	}
}

// Split a list of media IDs into pages.
//
// In general it's safe for a data source to return a lot of data, and the search view
// will handle incremental loading, but this can be used to split large results apart.
export function PaginateMediaIds(mediaIds, itemsPerPage) {
	// Paginate the big list of results.
	let pages = [];
	let page = null;
	for (let mediaId of mediaIds) {
		if (page == null) {
			page = [];
			pages.push(page);
		}
		page.push(mediaId);
		if (page.length == itemsPerPage) page = null;
	}
	return pages;
}

// A helper widget for dropdown lists of tags which refreshes when the data source is updated.
export class TagDropdownWidget extends Widget {
	constructor({ dataSource, ...options }) {
		super({
			...options,
			template: `<div class="data-source-tag-list vertical-list"></div>`,
		});

		this.dataSource = dataSource;

		this.dataSource.addEventListener(
			"updated",
			() => this.refreshTags(),
			this._signal,
		);
		this.refreshTags();
	}

	refreshTags() {}
}
