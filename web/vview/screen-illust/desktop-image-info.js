// This handles the desktop overlay UI on the illustration page.

import Widget from "/vview/widgets/widget.js";
import {
	BookmarkButtonWidget,
	LikeButtonWidget,
} from "/vview/widgets/illust-widgets.js";
import { BookmarkTagDropdownOpener } from "/vview/widgets/bookmark-tag-list.js";
import { AvatarWidget } from "/vview/widgets/user-widgets.js";
import { SettingsDialog } from "/vview/widgets/settings-widgets.js";
import Actions from "/vview/misc/actions.js";
import TagListWidget from "/vview/widgets/tag-list-widget.js";
import LocalAPI from "/vview/misc/local-api.js";
import { getUrlForMediaId } from "/vview/misc/media-ids.js";
import { helpers, ClassFlags } from "/vview/misc/helpers.js";

export default class DesktopImageInfo extends Widget {
	constructor({ ...options }) {
		super({
			...options,
			visible: false,
			template: `
<div class=image-ui>
    <div class=hover-sphere>
        <svg viewBox="0 0 1 1" preserveAspectRatio="none">
            <circle class=hover-circle cx="0.5" cy="0.5" r=".5" fill-opacity="0" />
        </svg>
    </div>

    <div class=ui-box>
        <div class=avatar-popup></div>

        <div class=ui-title-box>
            <div>
                <span class="title-block">
                    <!-- Put the title and author in separate inline-blocks, to encourage
                        the browser to wrap between them if possible, putting the author
                        on its own line if they won't both fit, but still allowing the
                        title to wrap if it's too long by itself. -->
                    <span style="display: inline-block;" class="title-font">
                        <a class="title"></a>
                    </span>
                    <span style="display: inline-block;" class="author-block title-font">
                        <span style="font-size: 12px;">by</span>
                        <a class="author" data-scroll-to-top></a>
                    </span>
                    <span style="display: inline-block;" class=folder-block>
                        <span style="font-size: 12px;">in</span>
                        <a class="folder-text title-font"></a>
                    </span>

                    <a class=edit-post href=#>Edit post</a>
                </span>
            </div>
        </div>

        <div class=button-row style='padding-block-end: 14px;'>
            <a class="icon-button disable-ui-button popup pixiv-only" data-popup="Return to Pixiv" href="#no-ppixiv">
                ${helpers.createIcon("ppixiv:pixiv")}
            </a>

            <div class="view-manga-button popup" data-popup="View manga pages">
                <div class="icon-button">
                    ${helpers.createIcon("ppixiv:thumbnails")}
                </div>
            </div>

            <div class="download-button download-image-button popup pixiv-only" data-download="image" data-popup="Download image">
                <div class="icon-button button enabled">
                    <ppixiv-inline src="resources/download-icon.svg"></ppixiv-inline>
                </div>
            </div>

            <div class="download-button download-manga-button popup pixiv-only" data-download="ZIP" data-popup="Download ZIP of all images">
                <div class="icon-button button enabled">
                    <ppixiv-inline src="resources/download-manga-icon.svg"></ppixiv-inline>
                </div>
            </div>

            <div class="download-button download-video-button popup pixiv-only" data-download="MKV" data-popup="Download MKV">
                <div class="icon-button button enabled">
                    <ppixiv-inline src="resources/download-icon.svg"></ppixiv-inline>
                </div>
            </div>

			<vv-container class=bookmark-button-container data-bookmark-type=public></vv-container>

            <vv-container class="bookmark-button-container button-container" data-bookmark-type=private></vv-container>

            <div style="position: relative;">
                <div class="button icon-button button-bookmark-tags popup" data-popup="Bookmark tags">
                    ${helpers.createIcon("ppixiv:tag")}
                    <div style="position: absolute; bottom: 2px; left: 4px;">
                        <div class=tag-dropdown-arrow hidden></div>
                    </div>
                </div>
            </div>

            <vv-container class="button-like-container button-container"></vv-container>

            <a class="similar-illusts-button popup pixiv-only" data-popup="Similar illustrations" href=# hidden>
                <div class=icon-button>
                    ${helpers.createIcon("ppixiv:suggestions")}
                </div>
            </a>

            <a class="similar-artists-button popup pixiv-only" data-popup="Similar artists" href=# hidden>
                <div class=icon-button>
                    ${helpers.createIcon("ppixiv:suggestions")}
                </div>
            </a>

            <a class="similar-bookmarks-button popup pixiv-only" data-popup="Similar bookmarks" href=# hidden>
                <div class=icon-button>
                    ${helpers.createIcon("ppixiv:suggestions")}
                </div>
            </a>

            <div class="image-settings-menu-box popup" data-popup="Preferences">
                <div class="icon-button preferences-button">
                    ${helpers.createIcon("settings")}
                </div>
            </div>
        </div>
        <div class=post-info>
            <div class="post-age popup" hidden></div>
            <div class=image-info hidden></div>
            <div class=page-count hidden></div>
            <div class=ugoira-duration hidden></div>
            <div class=ugoira-frames hidden></div>
        </div>

        <vv-container class=tag-list-container></vv-container>

        <div class=description></div>
    </div>
</div>
        `,
		});

		// ui-box is the real container.  THe outer div is just so hover-sphere isn't inside
		// the scroller.
		this.ui_box = this.root.querySelector(".ui-box");

		this.avatarWidget = new AvatarWidget({
			container: this.root.querySelector(".avatar-popup"),
			dropdownVisibilityChanged: () => {
				this.refreshOverlayUiVisibility();
			},
		});

		this.tagListWidget = new TagListWidget({
			container: this.root.querySelector(".tag-list-container"),
		});

		ppixiv.mediaCache.addEventListener("mediamodified", this.refresh, {
			signal: this.shutdownSignal,
		});

		this.likeButton = new LikeButtonWidget({
			container: this.root.querySelector(".button-like-container"),
			template: `
                <div class="button icon-button button-like enabled popup button-container" style="position: relative;">
                    <ppixiv-inline src="resources/like-button.svg"></ppixiv-inline>
                </div>
            `,
		});

		// The bookmark buttons, and clicks in the tag dropdown:
		this.bookmarkButtons = [];
		for (const a of this.root.querySelectorAll("[data-bookmark-type]")) {
			this.bookmarkButtons.push(
				new BookmarkButtonWidget({
					container: a,
					template: `
						<div class="button icon-button button-bookmark popup ${a.dataset.bookmarkType}">
							<ppixiv-inline src="resources/${a.dataset.bookmarkType === "private" ? "heart-icon-private" : "heart-icon"}.svg"></ppixiv-inline>
						</div>
						`,
					bookmarkType: a.dataset.bookmarkType,
				}),
			);
		}

		const bookmarkTagsButton = this.root.querySelector(".button-bookmark-tags");
		this.bookmarkTagsDropdownOpener = new BookmarkTagDropdownOpener({
			parent: this,
			bookmarkTagsButton,
			bookmarkButtons: this.bookmarkButtons,

			// The dropdown affects visibility, so refresh when it closes.
			onVisibilityChanged: () => {
				this.refreshOverlayUiVisibility();
			},
		});

		for (let button of this.root.querySelectorAll(".download-button"))
			button.addEventListener("click", this.clickedDownload);
		this.root
			.querySelector(".download-manga-button")
			.addEventListener("click", this.clickedDownload);
		this.root
			.querySelector(".view-manga-button")
			.addEventListener("click", (e) => {
				if (this.mediaId == null) return;

				let args = getUrlForMediaId(this.mediaId, { manga: true });
				helpers.navigate(args);
			});

		// Don't propagate wheel events if the contents can scroll, so moving the scroller doesn't change the
		// image.  Most of the time the contents will fit, so allow changing the page if there's no need to
		// scroll.
		this.ui_box.addEventListener(
			"wheel",
			(e) => {
				if (this.ui_box.scrollHeight > this.ui_box.offsetHeight)
					e.stopPropagation();
			},
			{ passive: false },
		);

		this.root
			.querySelector(".preferences-button")
			.addEventListener("click", (e) => {
				new SettingsDialog();
			});

		// Show on hover.
		this.ui_box.addEventListener("mouseenter", (e) => {
			this.hoveringOverBox = true;
			this.refreshOverlayUiVisibility();
		});
		this.ui_box.addEventListener("mouseleave", (e) => {
			this.hoveringOverBox = false;
			this.refreshOverlayUiVisibility();
		});

		let hoverCircle = this.querySelector(".hover-circle");
		hoverCircle.addEventListener("mouseenter", (e) => {
			this.hoveringOverSphere = true;
			this.refreshOverlayUiVisibility();
		});
		hoverCircle.addEventListener("mouseleave", (e) => {
			this.hoveringOverSphere = false;
			this.refreshOverlayUiVisibility();
		});
		ppixiv.settings.addEventListener("image_editing", () => {
			this.refreshOverlayUiVisibility();
		});
		ppixiv.settings.addEventListener("image_editing_mode", () => {
			this.refreshOverlayUiVisibility();
		});
		ClassFlags.get.addEventListener(
			"hide-ui",
			() => this.refreshOverlayUiVisibility(),
			this._signal,
		);

		this.refreshOverlayUiVisibility();
	}

	refreshOverlayUiVisibility() {
		// Hide widgets inside the hover UI when it's hidden.
		let visible = this.hoveringOverBox || this.hoveringOverSphere;

		// Don't show the hover UI while editing, since it can get in the way of trying to
		// click the image.
		let editing =
			ppixiv.settings.get("image_editing") &&
			ppixiv.settings.get("image_editing_mode") != null;
		if (editing) visible = false;

		// Stay visible if the bookmark tag dropdown or the follow dropdown are visible.
		if (
			this.bookmarkTagsDropdownOpener?.visible ||
			this.avatarWidget.followDropdownOpener.visible
		)
			visible = true;

		if (ClassFlags.get.get("hide-ui")) visible = false;

		// Tell the image UI when it's visible.
		this.visible = visible;

		// Hide the UI's container too when we're editing, so the hover boxes don't get in
		// the way.
		this.root.hidden = editing || ppixiv.mobile;
	}

	applyVisibility() {
		helpers.html.setClass(
			this.root.querySelector(".ui-box"),
			"ui-hidden",
			!this._visible,
		);
	}

	visibilityChanged() {
		super.visibilityChanged();

		this.refresh();
	}

	set dataSource(dataSource) {
		if (this._dataSource == dataSource) return;

		this._dataSource = dataSource;
		this.refresh();
	}

	get mediaId() {
		return this._mediaId;
	}

	set mediaId(mediaId) {
		if (this._mediaId == mediaId) return;
		this._mediaId = mediaId;

		this.refresh();
	}

	get displayedPage() {
		return helpers.mediaId.parse(this._mediaId).page;
	}

	handleKeydown(e) {}

	refresh = async () => {
		helpers.html.setClass(this.root, "disabled", !this.visible);

		// Don't do anything if we're not visible.
		if (!this.visible) return;

		// Update widget illust IDs.
		this.likeButton.setMediaId(this._mediaId);
		for (let button of this.bookmarkButtons) button.setMediaId(this._mediaId);
		this.bookmarkTagsDropdownOpener.setMediaId(this._mediaId);

		if (this._mediaId == null) return;

		// Try to fill in as much of the UI as we can without waiting for the info to load.
		this._setPostInfo();

		// We need image info to update.
		let mediaId = this._mediaId;
		let mediaInfo = await ppixiv.mediaCache.getMediaInfo(this._mediaId);

		// Check if anything changed while we were loading.
		if (mediaInfo == null || mediaId != this._mediaId || !this.visible) return;

		// Fill in the post info text.
		this._setPostInfo();
	};

	// Set all fields that we can from partial media info.  This lets us refresh most of the UI
	// without waiting for the full info to finish loading.
	_setPostInfo() {
		// Get all data that we've loaded so far.  This can return full or partial info, so we need
		// to check mediaInfo.full in each place we're accessing full data fields.
		let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(this._mediaId, {
			full: false,
			safe: false,
		});
		if (mediaInfo == null) return;

		let [illustId] = helpers.mediaId.toIllustIdAndPage(this._mediaId);
		let userId = mediaInfo.userId;

		// Show the author if it's someone else's post, or the edit link if it's ours.
		let ourPost = ppixiv.pixivInfo?.userId == userId;
		this.querySelector(".author-block").hidden = ourPost;
		this.querySelector(".edit-post").hidden = !ourPost;
		this.querySelector(".edit-post").href =
			"/member_illust_mod.php?mode=mod&illust_id=" + illustId;

		// Update the disable UI button to point at the current image's illustration page.
		let disableButton = this.querySelector(".disable-ui-button");
		disableButton.href = `/artworks/${illustId}#no-ppixiv`;

		this.avatarWidget.setUserId(userId);
		this.avatarWidget.visible = userId != null;
		this.tagListWidget.set(mediaInfo);

		let elementTitle = this.root.querySelector(".title");
		elementTitle.textContent = mediaInfo.illustTitle;
		elementTitle.href = getUrlForMediaId(this._mediaId).url;

		// Show the folder if we're viewing a local image.
		let folderTextElement = this.root.querySelector(".folder-text");
		let showFolder = helpers.mediaId.isLocal(this._mediaId);
		if (showFolder) {
			let { id } = helpers.mediaId.parse(this.mediaId);
			folderTextElement.innerText = helpers.strings.getPathSuffix(id, 2, 1); // last two parent directories

			let parentFolderId = LocalAPI.getParentFolder(id);
			let args = new helpers.args("/", ppixiv.plocation);
			LocalAPI.getArgsForId(parentFolderId, args);
			folderTextElement.href = args.url;
		}

		// If the author name or folder are empty, hide it instead of leaving it empty.
		this.root.querySelector(".author-block").hidden = mediaInfo.userName == "";
		this.root.querySelector(".folder-block").hidden = !showFolder;

		let elementAuthor = this.root.querySelector(".author");
		elementAuthor.href = `/users/${userId}#ppixiv`;
		if (mediaInfo.userName != "")
			elementAuthor.textContent = mediaInfo.userName;

		this.root.querySelector(".similar-illusts-button").href =
			"/bookmark_detail.php?illust_id=" +
			illustId +
			"#ppixiv?recommendations=1";
		this.root.querySelector(".similar-artists-button").href =
			"/discovery/users#ppixiv?user_id=" + userId;
		this.root.querySelector(".similar-bookmarks-button").href =
			"/bookmark_detail.php?illust_id=" + illustId + "#ppixiv";

		// Pixiv image descriptions can contain HTML, which we don't need to check.  Don't
		// display local image descriptions as HTML, since they come directly from image
		// files and we don't do any verification of their contents.
		let elementComment = this.root.querySelector(".description");
		elementComment.hidden = !mediaInfo.full || mediaInfo.illustComment == "";
		if (ppixiv.native)
			elementComment.innerText = mediaInfo.full ? mediaInfo.illustComment : "";
		else
			elementComment.innerHTML = mediaInfo.full ? mediaInfo.illustComment : "";

		helpers.pixiv.fixPixivLinks(elementComment);
		if (!ppixiv.native) helpers.pixiv.makePixivLinksInternal(elementComment);

		// Set the download button popup text.
		let downloadImageButton = this.root.querySelector(".download-image-button");
		downloadImageButton.hidden = !Actions.isDownloadTypeAvailable(
			"image",
			mediaInfo,
		);

		let downloadMangaButton = this.root.querySelector(".download-manga-button");
		downloadMangaButton.hidden = !Actions.isDownloadTypeAvailable(
			"ZIP",
			mediaInfo,
		);

		let downloadVideoButton = this.root.querySelector(".download-video-button");
		downloadVideoButton.hidden = !Actions.isDownloadTypeAvailable(
			"MKV",
			mediaInfo,
		);

		let postInfoContainer = this.root.querySelector(".post-info");

		let setInfo = (query, text) => {
			let node = postInfoContainer.querySelector(query);
			node.innerText = text;
			node.hidden = text == "";
		};

		let seconds_old = (new Date() - new Date(mediaInfo.createDate)) / 1000;
		setInfo(".post-age", helpers.strings.ageToString(seconds_old));
		postInfoContainer.querySelector(".post-age").dataset.popup =
			helpers.strings.dateToString(mediaInfo.createDate);

		let info = "";

		// Add the resolution and file type if available.
		if (this.displayedPage != null && mediaInfo.full) {
			let pageInfo = mediaInfo.mangaPages[this.displayedPage];
			info += pageInfo.width + "x" + pageInfo.height;

			// For illusts, add the image type.  Don't do this for animations.
			if (mediaInfo.illustType != 2) {
				let url = new URL(pageInfo.urls?.original);
				let ext = helpers.strings.getExtension(url.pathname).toUpperCase();
				if (ext) info += " " + ext;
			}
		}

		setInfo(".image-info", info);

		let duration = "";
		if (mediaInfo.full && mediaInfo.ugoiraMetadata) {
			let seconds = 0;
			for (let frame of mediaInfo.ugoiraMetadata.frames)
				seconds += frame.delay / 1000;

			duration = seconds.toFixed(duration >= 10 ? 0 : 1);
			duration += seconds == 1 ? " second" : " seconds";
		}
		setInfo(".ugoira-duration", duration);
		setInfo(
			".ugoira-frames",
			mediaInfo.full && mediaInfo.ugoiraMetadata
				? mediaInfo.ugoiraMetadata.frames.length + " frames"
				: "",
		);

		// Add the page count for manga.
		let pageText = "";
		if (mediaInfo.pageCount > 1 && this.displayedPage != null)
			pageText = "Page " + (this.displayedPage + 1) + "/" + mediaInfo.pageCount;
		setInfo(".page-count", pageText);
	}

	clickedDownload = (e) => {
		if (this._mediaId == null) return;

		let clickedButton = e.target.closest(".download-button");
		if (clickedButton == null) return;

		e.preventDefault();
		e.stopPropagation();

		let downloadType = clickedButton.dataset.download;
		Actions.downloadIllust(this._mediaId, downloadType, this.displayedPage);
	};
}
