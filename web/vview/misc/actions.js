// Global actions.
import { TextPrompt } from "/vview/widgets/prompts.js";
import LocalAPI from "/vview/misc/local-api.js";
import RecentBookmarkTags from "/vview/misc/recent-bookmark-tags.js";
import PixivUgoiraDownloader from "/vview/misc/pixiv-ugoira-downloader.js";
import CreateZIP from "/vview/misc/create-zip.js";
import * as Recaptcha from "/vview/util/recaptcha.js";
import { downloadPixivImage } from "/vview/util/gm-download.js";
import { helpers } from "/vview/misc/helpers.js";

// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
export default class Actions {
	// Set a bookmark.  Any existing bookmark will be overwritten.
	static async _bookmarkAddInternal(mediaId, options) {
		let illustId = helpers.mediaId.toIllustIdAndPage(mediaId)[0];
		let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, {
			full: false,
		});

		if (options == null) options = {};

		// If auto-like is enabled, like an image when we bookmark it.
		if (!options.disableAutoLike) {
			console.log("Automatically liking image with bookmark");
			Actions.likeImage(mediaId, true /* quiet */);
		}

		// Remember whether this is a new bookmark or an edit.
		let wasBookmarked = mediaInfo.bookmarkData != null;

		let request = {
			illust_id: illustId,
			tags: options.tags || [],
			restrict: options.private ? 1 : 0,
		};
		let result = await helpers.pixivRequest.post(
			"/ajax/illusts/bookmarks/add",
			request,
		);

		// If this is a new bookmark, last_bookmark_id is the new bookmark ID.
		// If we're editing an existing bookmark, last_bookmark_id is null and the
		// bookmark ID doesn't change.
		let newBookmarkId = result.body.last_bookmark_id;
		if (newBookmarkId == null)
			newBookmarkId = mediaInfo.bookmarkData ? mediaInfo.bookmarkData.id : null;
		if (newBookmarkId == null) throw "Didn't get a bookmark ID";

		// Store the ID of the new bookmark, so the unbookmark button works.
		mediaInfo.bookmarkData = {
			id: newBookmarkId,
			private: !!request.restrict,
		};

		// Broadcast that this illust was bookmarked.  This is for my own external
		// helper scripts.
		let e = new Event("bookmarked");
		e.illustId = illustId;
		window.dispatchEvent(e);

		// Even if we weren't given tags, we still know that they're unset, so set tags so
		// we won't need to request bookmark details later.
		ppixiv.extraCache.updateCachedBookmarkTags(mediaId, request.tags);
		console.log(
			`Updated bookmark data for ${mediaId}: id: ${newBookmarkId}, tags: ${
				request.restrict ? "private" : "public"
			} ${request.tags.join(" ")}`,
		);

		if (!wasBookmarked) {
			// If we have full illust data loaded, increase its bookmark count locally.
			let fullMediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId);
			if (fullMediaInfo) fullMediaInfo.bookmarkCount++;
		}

		ppixiv.message.show(
			wasBookmarked
				? "Bookmark edited"
				: options.private
					? "Bookmarked privately"
					: "Bookmarked",
		);
	}

	// Create or edit a bookmark.
	//
	// Create or edit a bookmark.  options can contain any of the fields tags or private.
	// Fields that aren't specified will be left unchanged on an existing bookmark.
	//
	// This is a headache.  Pixiv only has APIs to create a new bookmark (overwriting all
	// existing data), except for public/private which can be changed in-place, and we need
	// to do an extra request to retrieve the tag list if we need it.  We try to avoid
	// making the extra bookmark details request if possible.
	static async bookmarkAdd(mediaId, options) {
		if (helpers.mediaId.isLocal(mediaId))
			return await this._localBookmarkAdd(mediaId, options);

		if (options == null) options = {};

		// If bookmark_privately_by_default is enabled and private wasn't specified
		// explicitly, set it to true.
		if (
			options.private == null &&
			ppixiv.settings.get("bookmark_privately_by_default")
		)
			options.private = true;

		let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, {
			full: false,
		});

		console.log(`Add bookmark for ${mediaId}, options:`, options);

		// This is a mess, since Pixiv's APIs are all over the place.
		//
		// If the image isn't already bookmarked, just use bookmarkAdd.
		if (mediaInfo.bookmarkData == null) {
			console.log("Initial bookmark");
			if (options.tags != null)
				RecentBookmarkTags.updateRecentBookmarkTags(options.tags);

			return await Actions._bookmarkAddInternal(mediaId, options);
		}

		// Special case: If we're not setting anything, then we just want this image to
		// be bookmarked.  Since it is, just stop.
		if (options.tags == null && options.private == null) {
			console.log("Already bookmarked");
			return;
		}

		// Special case: If all we're changing is the private flag, use bookmarkSetPrivate
		// so we don't fetch bookmark details.
		if (options.tags == null && options.private != null) {
			// If the image is already bookmarked, use bookmarkSetPrivate to edit the
			// existing bookmark.  This won't auto-like.
			console.log("Only editing private field", options.private);
			return await Actions.bookmarkSetPrivate(mediaId, options.private);
		}

		// If we're modifying tags, we need bookmark details loaded, so we can preserve
		// the current privacy status.  This will insert the info into mediaInfo.bookmarkData.
		let bookmarkTags = await ppixiv.extraCache.loadBookmarkDetails(mediaId);

		let bookmarkParams = {
			// Don't auto-like if we're editing an existing bookmark.
			disableAutoLike: true,
		};

		if ("private" in options) bookmarkParams.private = options.private;
		else bookmarkParams.private = mediaInfo.bookmarkData.private;

		if ("tags" in options) bookmarkParams.tags = options.tags;
		else bookmarkParams.tags = bookmarkTags;

		// Only update recent tags if we're modifying tags.
		if (options.tags != null) {
			// Only add new tags to recent tags.  If a bookmark has tags "a b" and is being
			// changed to "a b c", only add "c" to recently-used tags, so we don't bump tags
			// that aren't changing.
			for (let tag of options.tags) {
				let isNewTag = bookmarkTags.indexOf(tag) == -1;
				if (isNewTag) RecentBookmarkTags.updateRecentBookmarkTags([tag]);
			}
		}

		return await Actions._bookmarkAddInternal(mediaId, bookmarkParams);
	}

	static async bookmarkRemove(mediaId) {
		if (helpers.mediaId.isLocal(mediaId))
			return await this._localBookmarkRemove(mediaId);

		let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, {
			full: false,
		});
		if (mediaInfo.bookmarkData == null) {
			console.log("Not bookmarked");
			return;
		}

		let bookmarkId = mediaInfo.bookmarkData.id;

		console.log("Remove bookmark", bookmarkId);

		let result = await helpers.pixivRequest.post(
			"/ajax/illusts/bookmarks/remove",
			{
				bookmarkIds: [bookmarkId],
			},
		);

		console.log("Removing bookmark finished");
		mediaInfo.bookmarkData = null;

		// If we have full image data loaded, update the like count locally.
		let fullMediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId);
		if (fullMediaInfo) fullMediaInfo.bookmarkCount--;

		ppixiv.extraCache.updateCachedBookmarkTags(mediaId, null);

		ppixiv.message.show("Bookmark removed");
	}

	static async _localBookmarkAdd(mediaId, options) {
		let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, {
			full: false,
		});
		let bookmarkOptions = {};
		if (options.tags != null) bookmarkOptions.tags = options.tags;

		// Remember whether this is a new bookmark or an edit.
		let wasBookmarked = mediaInfo.bookmarkData != null;

		let result = await LocalAPI.localPostRequest(
			`/api/bookmark/add/${mediaId}`,
			{
				...bookmarkOptions,
			},
		);
		if (!result.success) {
			ppixiv.message.show(`Couldn't edit bookmark: ${result.reason}`);
			return;
		}

		// Update bookmark tags and thumbnail data.
		ppixiv.extraCache.updateCachedBookmarkTags(mediaId, result.bookmark.tags);
		mediaInfo.bookmarkData = result.bookmark;

		let { type } = helpers.mediaId.parse(mediaId);

		ppixiv.message.show(
			wasBookmarked
				? "Bookmark edited"
				: type == "folder"
					? "Bookmarked folder"
					: "Bookmarked",
		);
	}

	static async _localBookmarkRemove(mediaId) {
		let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, {
			full: false,
		});
		if (mediaInfo.bookmarkData == null) {
			console.log("Not bookmarked");
			return;
		}

		let result = await LocalAPI.localPostRequest(
			`/api/bookmark/delete/${mediaId}`,
		);
		if (!result.success) {
			ppixiv.message.show(`Couldn't remove bookmark: ${result.reason}`);
			return;
		}

		mediaInfo.bookmarkData = null;

		ppixiv.message.show("Bookmark removed");
	}

	// Change an existing bookmark to public or private.
	static async bookmarkSetPrivate(mediaId, private_bookmark) {
		if (helpers.mediaId.isLocal(mediaId)) return;

		let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, {
			full: false,
		});
		if (!mediaInfo.bookmarkData) {
			console.log(`Illust ${mediaId} wasn't bookmarked`);
			return;
		}

		let bookmarkId = mediaInfo.bookmarkData.id;

		let result = await helpers.pixivRequest.post(
			"/ajax/illusts/bookmarks/edit_restrict",
			{
				bookmarkIds: [bookmarkId],
				bookmarkRestrict: private_bookmark ? "private" : "public",
			},
		);

		// Update bookmark info.
		mediaInfo.bookmarkData = {
			id: bookmarkId,
			private: private_bookmark,
		};

		ppixiv.message.show(
			private_bookmark ? "Bookmarked privately" : "Bookmarked",
		);
	}

	// Show a prompt to enter tags, so the user can add tags that aren't already in the
	// list.  Add the bookmarks to recents, and bookmark the image with the entered tags.
	static async addNewBookmarkTag(mediaId) {
		console.log("Show tag prompt");

		let prompt = new TextPrompt({ title: "New tag:" });
		let tags = await prompt.result;
		if (tags == null) return; // cancelled

		// Split the new tags.
		tags = tags.split(" ");
		tags = tags.filter((value) => {
			return value != "";
		});

		// This should already be loaded, since the only way to open this prompt is
		// in the tag dropdown.
		let bookmarkTags = await ppixiv.extraCache.loadBookmarkDetails(mediaId);

		// Add each tag the user entered to the tag list to update it.
		let activeTags = [...bookmarkTags];

		for (let tag of tags) {
			if (activeTags.indexOf(tag) != -1) continue;

			// Add this tag to recents.  bookmarkAdd will add recents too, but this makes sure
			// that we add all explicitly entered tags to recents, since bookmarkAdd will only
			// add tags that are new to the image.
			RecentBookmarkTags.updateRecentBookmarkTags([tag]);
			activeTags.push(tag);
		}
		console.log("All tags:", activeTags);

		// Edit the bookmark.
		if (helpers.mediaId.isLocal(mediaId))
			await Actions._localBookmarkAdd(mediaId, { tags: activeTags });
		else await Actions.bookmarkAdd(mediaId, { tags: activeTags });
	}

	// If quiet is true, don't print any messages.
	static async likeImage(mediaId, quiet) {
		if (helpers.mediaId.isLocal(mediaId)) return;

		let illustId = helpers.mediaId.toIllustIdAndPage(mediaId)[0];

		console.log("Clicked like on", mediaId);

		if (ppixiv.extraCache.getLikedRecently(mediaId)) {
			if (!quiet) ppixiv.message.show("Already liked this image");
			return;
		}

		let result = await helpers.pixivRequest.post("/ajax/illusts/like", {
			illust_id: illustId,
		});

		// If is_liked is true, we already liked the image, so this had no effect.
		let wasAlreadyLiked = result.body.is_liked;

		// Remember that we liked this image recently.
		ppixiv.extraCache.addLikedRecently(mediaId);

		// If we have illust data, increase the like count locally.  Don't load it
		// if it's not loaded already.
		let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId);
		if (!wasAlreadyLiked && mediaInfo) mediaInfo.likeCount++;

		if (!quiet) {
			if (wasAlreadyLiked) ppixiv.message.show("Already liked this image");
			else ppixiv.message.show("Illustration liked");
		}
	}

	// Follow userId with the given privacy and tag list.
	//
	// The follow editing API has a bunch of quirks.  You can call bookmarkAdd on a user
	// you're already following, but it'll only update privacy and not tags.  Editing tags
	// is done with following_user_tag_add/following_user_tag_delete (and can only be done
	// one at a time).
	//
	// A tag can only be set with this call if the caller knows we're not already following
	// the user, eg. if the user clicks a tag in the follow dropdown for an unfollowed user.
	// If we're editing an existing follow's tag, use changeFollowTags below.  We do handle
	// changing privacy here.
	static async follow(userId, followPrivately, { tag = null } = {}) {
		if (userId == -1) return;

		// We need to do this differently depending on whether we were already following the user.
		let userInfo = await ppixiv.userCache.getUserInfo(userId, { full: true });
		if (userInfo.isFollowed) {
			// If we were already following, we're just updating privacy.  We don't update follow
			// tags for existing follows this way.
			console.assert(tag == null);
			return await Actions.changeFollowPrivacy(userId, followPrivately);
		}

		// This is a new follow.
		//
		// If bookmark_privately_by_default is enabled and private wasn't specified
		// explicitly, set it to true.
		if (
			followPrivately == null &&
			ppixiv.settings.get("bookmark_privately_by_default")
		)
			followPrivately = true;

		let followArgs = {
			mode: "add",
			type: "user",
			user_id: userId,
			tag: tag ?? "",
			restrict: followPrivately ? 1 : 0,
			format: "json",
		};

		// Pixiv enables recaptcha for follows only for some users.  If it's enabled for this user,
		// get a token for the follow.
		let useRecaptcha = ppixiv.pixivInfo?.pixivTests?.recaptcha_follow_user;
		if (useRecaptcha) {
			console.log("Requesting recaptcha token for follow");
			let token = await Recaptcha.getRecaptchaToken("www/follow_user");
			if (token == null) {
				ppixiv.message.show(
					"Couldn't get Recaptcha token for following a user",
				);
				return;
			}

			followArgs.recaptcha_enterprise_score_token = token;
		}

		// This doesn't return any data, but returns a 400 Bad Request if something fails.
		let result = await helpers.pixivRequest.rpcPost(
			"/bookmark_add.php",
			followArgs,
		);
		if (result.error) {
			ppixiv.message.show(`Error following user ${userId}: ${result.message}`);
			return;
		}

		// Cache follow info for this new follow.  Since we weren't followed before, we know
		// we can just create a new entry.
		let tagSet = new Set();
		if (tag != null) {
			tagSet.add(tag);
			ppixiv.userCache.addCachedUserFollowTags(tag);
		}
		let info = {
			tags: tagSet,
			followingPrivately: followPrivately,
		};

		ppixiv.userCache.updateCachedFollowInfo(userId, true, info);

		let message = "Followed " + userInfo.name;
		if (followPrivately) message += " privately";
		ppixiv.message.show(message);
	}

	// Change the privacy status of a user we're already following.
	static async changeFollowPrivacy(userId, followPrivately) {
		let data = await helpers.pixivRequest.rpcPost(
			"/ajax/following/user/restrict_change",
			{
				user_id: userId,
				restrict: followPrivately ? 1 : 0,
			},
		);

		if (data.error) {
			ppixiv.message.show(`Error changing follow privacy: ${data.message}`);
			return;
		}

		// If we had cached follow info, update it with the new privacy.
		let info = ppixiv.userCache.getUserFollowInfoSync(userId);
		if (info != null) {
			console.log("Updating cached follow privacy");
			info.followingPrivately = followPrivately;
			ppixiv.userCache.updateCachedFollowInfo(userId, true, info);
		}

		let userInfo = await ppixiv.userCache.getUserInfo(userId);
		let message = `Now following ${userInfo.name} ${followPrivately ? "privately" : "publically"}`;
		ppixiv.message.show(message);
	}

	// Add or remove a follow tag for a user we're already following.  The API only allows
	// editing one tag per call.
	static async changeFollowTags(userId, { tag, add }) {
		let data = await helpers.pixivRequest.rpcPost(
			add ? "/ajax/following/user/tag_add" : "/ajax/following/user/tag_delete",
			{
				user_id: userId,
				tag,
			},
		);

		if (data.error) {
			ppixiv.message.show(`Error editing follow tags: ${data.message}`);
			return;
		}

		let userInfo = await ppixiv.userCache.getUserInfo(userId);
		let message = add
			? `Added the tag "${tag}" to ${userInfo.name}`
			: `Removed the tag "${tag}" from ${userInfo.name}`;
		ppixiv.message.show(message);

		// Get follow info so we can update the tag list.  This will usually already be loaded,
		// since the caller will have had to load it to show the UI in the first place.
		let followInfo = await ppixiv.userCache.getUserFollowInfo(userId);
		if (followInfo == null) {
			ppixiv.message.show("Error retrieving follow info to update tags");
			return;
		}

		if (add) {
			followInfo.tags.add(tag);

			// Make sure the tag is in the full tag list too.
			ppixiv.userCache.addCachedUserFollowTags(tag);
		} else followInfo.tags.delete(tag);

		ppixiv.userCache.updateCachedFollowInfo(userId, true, followInfo);
	}

	static async unfollow(userId) {
		if (userId == -1) return;

		let result = await helpers.pixivRequest.rpcPost("/rpc_group_setting.php", {
			mode: "del",
			type: "bookuser",
			id: userId,
		});

		let userData = await ppixiv.userCache.getUserInfo(userId);

		// Record that we're no longer following and refresh the UI.
		ppixiv.userCache.updateCachedFollowInfo(userId, false);

		ppixiv.message.show("Unfollowed " + userData.name);
	}

	// Image downloading
	//
	// Download mediaInfo.
	static async downloadIllust(mediaId, downloadType) {
		let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId);
		let userInfo = await ppixiv.userCache.getUserInfo(mediaInfo.userId);
		console.log(`Download ${mediaId} with type $[downloadType}`);

		if (downloadType == "MKV") {
			new PixivUgoiraDownloader(mediaInfo);
			return;
		}

		if (downloadType !== "image" && downloadType != "ZIP") {
			console.error("Unknown download type " + downloadType);
			return;
		}

		// If we're in ZIP mode, download all images in the post.
		let pages = [];
		for (let page = 0; page < mediaInfo.mangaPages.length; ++page)
			pages.push(page);

		// If we're in image mode for a manga post, only download the requested page.
		const mangaPage = helpers.mediaId.parse(mediaId).page;
		if (downloadType === "image") pages = [mangaPage];

		// ppixiv.message.show(
		// 	pages.length > 1
		// 		? `Downloading ${pages.length} pages...`
		// 		: `Downloading image...`,
		// );

		const results = [];
		try {
			for (const page of pages) {
				const pageMediaId = helpers.mediaId.getMediaIdForPage(mediaId, page);

				// If translations for this image are enabled, try to save the image with translations.
				// If translations are disabled for this image, this will be null.
				const translatedCanvas =
					await ppixiv.imageTranslations.getTranslatedImage(pageMediaId);
				if (translatedCanvas != null) {
					let blob = await helpers.other.canvasToBlob(translatedCanvas, {
						type: "image/jpeg",
						quality: 0.95,
					});
					let result = await blob.arrayBuffer();
					result.extension = "jpg";
					results.push(result);
					continue;
				}

				// Download the image normally.
				let url = mediaInfo.mangaPages[page].urls.original;
				let result = await downloadPixivImage(url);
				result.extension = helpers.strings.getExtension(url);
				results.push(result);
			}
		} catch (e) {
			ppixiv.message.show(e.toString());
			return;
		}

		ppixiv.message.hide();

		// If there's just one image, save it directly.
		if (pages.length == 1) {
			let blob = new Blob([results[0]]);
			let ext = results[0].extension;
			let isMangaPage =
				mediaInfo.mangaPages.length > 1 && downloadType == "image";
			let filename = this.generateFilename(
				mediaInfo,
				userInfo,
				ext,
				mangaPage,
				isMangaPage,
			);
			helpers.saveBlob(blob, filename);
			return;
		}

		// There are multiple images, and since browsers are stuck in their own little world, there's
		// still no way in 2018 to save a batch of files to disk, so ZIP the images.
		let filenames = [];
		for (let i = 0; i < pages.length; ++i) {
			let ext = results[i].extension;
			let filename = i.toString().padStart(3, "0") + "." + ext;
			filenames.push(filename);
		}

		// Create the ZIP.
		let zip = new CreateZIP(filenames, results);
		let filename =
			userInfo.name +
			" - " +
			mediaInfo.illustId +
			" - " +
			mediaInfo.illustTitle +
			".zip";
		helpers.saveBlob(zip, filename);
	}

	static generateFilename(mediaInfo, userInfo, ext, mangaPage, isMangaPage) {
		if (ppixiv.settings.get("restore_download_filename")) {
			// {pid}_p{page_number}.{ext}
			let filename = mediaInfo.illustId + "_p0";
			if (isMangaPage) filename = mediaInfo.illustId + "_p" + (mangaPage + 1);
			return filename + "." + ext;
		} else {
			// {userName}-{pid} #{pageNumber}-{illustTitle}.{ext}
			let filename = userInfo.name + " - " + mediaInfo.illustId;
			if (isMangaPage) filename += " #" + (mangaPage + 1);
			return filename + " - " + mediaInfo.illustTitle + "." + ext;
		}
	}

	static isDownloadTypeAvailable(downloadType, mediaInfo) {
		if (ppixiv.mobile) return false;

		// Single image downloading works for single images and manga pages.
		if (downloadType === "image") return mediaInfo.illustType !== 2;

		// ZIP downloading only makes sense for image sequences.
		if (downloadType === "ZIP")
			return mediaInfo.illustType !== 2 && mediaInfo.pageCount > 1;

		// MJPEG only makes sense for videos.
		if (downloadType === "MKV") return mediaInfo.illustType === 2;

		throw `Unknown download type ${downloadType}`;
	}

	static async loadRecentBookmarkTags() {
		if (ppixiv.native) return await LocalAPI.loadRecentBookmarkTags();

		const url = `/ajax/user/${ppixiv.pixivInfo.userId}/illusts/bookmark/tags`;
		const result = await helpers.pixivRequest.get(url, {});
		const bookmarkTags = [];
		const addTag = (tag) => {
			// Ignore "untagged".
			if (tag.tag === "未分類") return;

			if (bookmarkTags.indexOf(tag.tag) === -1) bookmarkTags.push(tag.tag);
		};

		for (const tag of result.body.public) addTag(tag);

		for (const tag of result.body.private) addTag(tag);

		return bookmarkTags;
	}
}
