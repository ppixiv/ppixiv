// Try to guess the full URL for an image from its preview image and user ID.
//
// The most annoying thing about Pixiv's API is that thumbnail info doesn't include
// image URLs.  This means you have to wait for image data to load before you can
// start loading the image at all, and the API call to get image data often takes
// as long as the image load itself.  This makes loading images take much longer
// than it needs to.
//
// We can mostly guess the image URL from the thumbnail URL, but we don't know the
// extension.  Try to guess.  Keep track of which formats we've seen from each user
// as we see them.  If we've seen a few posts from a user and they have a consistent
// file type, guess that the user always uses that format.
//
// This tries to let us start loading images earlier, without causing a ton of 404s
// from wrong guesses.

import KeyStorage from "/vview/misc/key-storage.js";
import { helpers } from "/vview/misc/helpers.js";

export default class GuessImageURL {
	constructor() {
		this.db = new KeyStorage("ppixiv-file-types", {
			upgradeDb: this.upgradeDb,
		});
	}

	upgradeDb = (e) => {
		let db = e.target.result;
		let store = db.createObjectStore("ppixiv-file-types", {
			keyPath: "illust_id_and_page",
		});

		// This index lets us look up the number of entries for a given user and filetype
		// quickly.
		//
		// page is included in this so we can limit the search to just page 1.  This is so
		// a single 100-page post doesn't overwhelm every other post a user makes: we only
		// use page 1 when guessing a user's preferred file type.
		store.createIndex("user_id_and_filetype", ["user_id", "page", "ext"]);
	};

	// Store info about an image that we've loaded data for.
	addInfo(imageData) {
		// Everyone else now uses imageData.illustId and imageData.media_id.  We
		// still just use .id  here, since this is only used for Pixiv images and it's
		// not worth a migration to change the primary key.
		/* imageData = {
            id: imageData.illustId,
            ...imageData,
        }
        */

		// Store one record per page.
		const pages = [];
		for (let page = 0; page < imageData.pageCount; ++page) {
			const illustId = imageData.illustId;
			const mediaId = helpers.mediaId.fromIllustId(imageData.illustId, page);
			const url = imageData?.mangaPages?.[page].urls.original;
			const parts = url.split(".");
			const ext = parts[parts.length - 1];

			pages.push({
				illust_id_and_page: mediaId,
				illust_id: illustId,
				page: page,
				user_id: imageData.userId,
				url: url,
				ext: ext,
			});
		}

		// We don't need to wait for this to finish, but return the promise in case
		// the caller wants to.
		return this.db.multiSetValues(pages);
	}

	// Return the number of images by the given user that have the given file type,
	// eg. "jpg".
	//
	// We have a dedicated index for this, so retrieving the count is fast.
	async _getFiletypeCountForUser(store, userId, filetype) {
		let index = store.index("user_id_and_filetype");
		let query = IDBKeyRange.only([userId, 0 /* page */, filetype]);
		return await KeyStorage.awaitRequest(index.count(query));
	}

	// Try to guess the user's preferred file type.  Returns "jpg", "png" or null.
	guessFileTypeForUserId(userId) {
		return this.db.dbOp(async (db) => {
			let store = this.db.getStore(db);

			// Get the number of posts by this user with both file types.
			let jpg = await this._getFiletypeCountForUser(store, userId, "jpg");
			let png = await this._getFiletypeCountForUser(store, userId, "png");

			// Wait until we've seen a few images from this user before we start guessing.
			if (jpg + png < 3) return null;

			// If a user's posts are at least 90% one file type, use that type.
			let jpegFraction = jpg / (jpg + png);
			if (jpegFraction > 0.9) {
				console.debug(`User ${userId} posts mostly JPEGs`);
				return "jpg";
			} else if (jpegFraction < 0.1) {
				console.debug(`User ${userId} posts mostly PNGs`);
				return "png";
			} else {
				console.debug(
					`Not guessing file types for ${userId} due to too much variance`,
				);
				return null;
			}
		});
	}

	async _getStoredRecord(mediaId) {
		return this.db.dbOp(async (db) => {
			let store = this.db.getStore(db);
			let record = await KeyStorage.asyncStoreGet(store, mediaId);
			if (record == null) return null;
			else return record.url;
		});
	}

	async guessUrl(mediaId) {
		// Guessed preloading is disabled if we're using an image size limit, since
		// it's too early to tell which image we'll end up using.
		if (ppixiv.settings.get("image_size_limit") != null) return null;

		// If this is a local URL, we always have the image URL and we don't need to guess.
		let { type, page } = helpers.mediaId.parse(mediaId);
		console.assert(type != "folder");
		if (type == "file") {
			let thumb = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
			if (thumb?.illustType == "video") return null;
			else return thumb?.mangaPages[page]?.urls?.original;
		}

		// If we already have illust info, use it.
		let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId);
		if (mediaInfo != null) return mediaInfo.mangaPages[page].urls.original;

		// If we've stored this URL, use it.
		let storedUrl = await this._getStoredRecord(mediaId);
		if (storedUrl != null) return storedUrl;

		// Get thumbnail data.  We need the thumbnail URL to figure out the image URL.
		let thumb = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
		if (thumb == null) return null;

		// Don't bother guessing file types for animations.
		if (thumb.illustType == 2) return null;

		// Try to make a guess at the file type.
		let guessedFileType = await this.guessFileTypeForUserId(thumb.userId);
		if (guessedFileType == null) return null;

		// Convert the thumbnail URL to the equivalent original URL:
		// https://i.pximg.net/c/540x540_70  /img-master/img/2021/01/01/01/00/02/12345678_p0_master1200.jpg
		// to
		// https://i.pximg.net             /img-original/img/2021/01/01/01/00/02/12345678_p0.jpg
		let url = thumb.previewUrls[page];
		url = url.replace("/c/540x540_70/", "/");
		url = url.replace("/img-master/", "/img-original/");
		url = url.replace("_master1200.", ".");
		url = url.replace(/jpg$/, guessedFileType);
		return url;
	}

	// This is called if a guessed preload fails to load.  This either means we
	// guessed wrong, or if we came from a cached URL in the database, that the
	// user reuploaded the image with a different file type.
	async guessedUrlIncorrect(mediaId) {
		// If this was a stored URL, remove it from the database.
		await this.db.multiDelete([mediaId]);
	}
}
