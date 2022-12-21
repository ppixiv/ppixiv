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

import KeyStorage from 'vview/misc/key-storage.js';
import { helpers } from 'vview/misc/helpers.js';

export default class GuessImageURL
{
    constructor()
    {
        this.db = new KeyStorage("ppixiv-file-types", { db_upgrade: this.db_upgrade });
    }

    db_upgrade = (e) =>
    {
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
    }

    // Store info about an image that we've loaded data for.
    add_info(image_data)
    {
        // Everyone else now uses image_data.illustId and image_data.media_id.  We
        // still just use .id  here, since this is only used for Pixiv images and it's
        // not worth a migration to change the primary key.
        /* image_data = {
            id: image_data.illustId,
            ...image_data,
        }
        */

        // Store one record per page.
        let pages = [];
        for(let page = 0; page < image_data.pageCount; ++page)
        {
            let illust_id = image_data.illustId;
            let media_id = helpers.illust_id_to_media_id(image_data.illustId, page);
            let url = image_data.mangaPages[page].urls.original;
            let parts = url.split(".");
            let ext = parts[parts.length-1];
    
            pages.push({
                illust_id_and_page: media_id,
                illust_id: illust_id,
                page: page,
                user_id: image_data.userId,
                url: url,
                ext: ext,
            });
        }

        // We don't need to wait for this to finish, but return the promise in case
        // the caller wants to.
        return this.db.multi_set_values(pages);
    }

    // Return the number of images by the given user that have the given file type,
    // eg. "jpg".
    //
    // We have a dedicated index for this, so retrieving the count is fast.
    async get_filetype_count_for_user(store, user_id, filetype)
    {
        let index = store.index("user_id_and_filetype");
        let query = IDBKeyRange.only([user_id, 0 /* page */, filetype]);
        return await KeyStorage.await_request(index.count(query));
    }

    // Try to guess the user's preferred file type.  Returns "jpg", "png" or null.
    guess_filetype_for_user_id(user_id)
    {
        return this.db.db_op(async (db) => {
            let store = this.db.get_store(db);

            // Get the number of posts by this user with both file types.
            let jpg = await this.get_filetype_count_for_user(store, user_id, "jpg");
            let png = await this.get_filetype_count_for_user(store, user_id, "png");

            // Wait until we've seen a few images from this user before we start guessing.
            if(jpg+png < 3)
                return null;

            // If a user's posts are at least 90% one file type, use that type.
            let jpg_fraction = jpg / (jpg+png);
            if(jpg_fraction > 0.9)
            {
                console.debug(`User ${user_id} posts mostly JPEGs`);
                return "jpg";
            }
            else if(jpg_fraction < 0.1)
            {
                console.debug(`User ${user_id} posts mostly PNGs`);
                return "png";
            }
            else
            {
                console.debug(`Not guessing file types for ${user_id} due to too much variance`);
                return null;
            }
        });
    }

    async get_stored_record(media_id)
    {
        return this.db.db_op(async (db) => {
            let store = this.db.get_store(db);
            let record = await KeyStorage.async_store_get(store, media_id);
            if(record == null)
                return null;
            else
                return record.url;
        });
    }

    async guess_url(media_id)
    {
        // Guessed preloading is disabled if we're using an image size limit, since
        // it's too early to tell which image we'll end up using.
        if(ppixiv.settings.get("image_size_limit") != null)
            return null;

        // If this is a local URL, we always have the image URL and we don't need to guess.
        let { type, page } = helpers.parse_media_id(media_id);
        console.assert(type != "folder");
        if(type == "file")
        {
            let thumb = ppixiv.media_cache.get_media_info_sync(media_id, { full: false });
            if(thumb?.illustType == "video")
                return null;
            else
                return thumb?.mangaPages[page]?.urls?.original;
        }
    
        // If we already have illust info, use it.
        let illust_info = ppixiv.media_cache.get_media_info_sync(media_id);
        if(illust_info != null)
            return illust_info.mangaPages[page].urls.original;

        // If we've stored this URL, use it.
        let stored_url = await this.get_stored_record(media_id);
        if(stored_url != null)
            return stored_url;
        
        // Get thumbnail data.  We need the thumbnail URL to figure out the image URL.
        let thumb = ppixiv.media_cache.get_media_info_sync(media_id, { full: false });
        if(thumb == null)
            return null;

        // Don't bother guessing file types for animations.
        if(thumb.illustType == 2)
            return null;

        // Try to make a guess at the file type.
        let guessed_filetype = await this.guess_filetype_for_user_id(thumb.userId);
        if(guessed_filetype == null)
            return null;
    
        // Convert the thumbnail URL to the equivalent original URL:
        // https://i.pximg.net/c/540x540_70  /img-master/img/2021/01/01/01/00/02/12345678_p0_master1200.jpg
        // to
        // https://i.pximg.net             /img-original/img/2021/01/01/01/00/02/12345678_p0.jpg
        let url = thumb.previewUrls[page];
        url = url.replace("/c/540x540_70/", "/");
        url = url.replace("/img-master/", "/img-original/");
        url = url.replace("_master1200.", ".");
        url = url.replace(/jpg$/, guessed_filetype);
        return url;
    }

    // This is called if a guessed preload fails to load.  This either means we
    // guessed wrong, or if we came from a cached URL in the database, that the
    // user reuploaded the image with a different file type.
    async guessed_url_incorrect(media_id)
    {
        // If this was a stored URL, remove it from the database.
        await this.db.multi_delete([media_id]);
    }
}
