// Helpers for the local API.

import Path from 'vview/util/path.js';
import { helpers } from 'vview/misc/helpers.js';

export default class LocalAPI
{
    static get local_url()
    {
        // If we're running natively, the API is on the same URL as we are.
        if(!ppixiv.native)
            return null;

        return new URL("/", document.location);
    }

    // Return the URL path used by the UI.
    static get path()
    {
        // When running natively, the path is just /.
        if(ppixiv.native)
            return "/";
        else
            return "/local/";
    }

    static async local_post_request(pathname, data={}, options={})
    {
        let url = LocalAPI.local_url;
        if(url == null)
            throw Error("Local API isn't enabled");

        url.pathname = encodeURI(pathname);
        var result = await helpers.send_pixiv_request({
            method: "POST",
            url: url.toString(),
            responseType: "json",
            data: JSON.stringify(data),
            signal: options.signal,
        });
    
        // If the result isn't valid JSON, we'll get a null result.
        if(result == null)
            result = { error: true, reason: "Invalid response" };
    
        return result;
    }   

    // Return true if the local API is enabled.
    static is_enabled()
    {
        return LocalAPI.local_url != null;
    }

    // Return true if we're running in VVbrowser.
    static is_vvbrowser()
    {
        return navigator.userAgent.indexOf("VVbrowser/")  != -1;
    }

    // Load image info from the local API.
    //
    // If refresh_from_disk and this is a local file, ask the server to ignore cache and
    // refresh from disk, even if it thinks it's not necessary.
    static async load_media_info(media_id, { refresh_from_disk=false }={})
    {
        let illust_data = await LocalAPI.local_post_request(`/api/illust/${media_id}`, {
            refresh_from_disk,
        });
        if(illust_data.success)
            LocalAPI.adjust_illust_info(illust_data.illust);

        return illust_data;
    }

    // Fill in some redundant fields.  The local API doesn't use mangaPages,
    // but we fill it in from urls so we can treat it the same way.
    static adjust_illust_info(illust)
    {
        let { type } = helpers.parse_media_id(illust.mediaId);
        if(type == "folder")
        {
            illust.mangaPages = [];
            illust.pageCount = 0;

            // These metadata fields don't exist for folders.  Set them to null so media_info._check_illust_data doesn't complain.
            illust.width = illust.height = illust.userName = null;
            illust.illustType = 1;
        }
        else
        {
            illust.mangaPages = [{
                width: illust.width,
                height: illust.height,
                urls: illust.urls,
            }];
            illust.pageCount = 1;
        }

        // illustId is only for Pixiv images.  Set it so media_info._check_illust_data doesn't complain.
        illust.illustId = null;

        // Local media info is always full.
        illust.full = true;

        // Local images don't use aiType.
        illust.aiType = 0;
    }

    static async load_recent_bookmark_tags()
    {
        let result = await LocalAPI.local_post_request(`/api/bookmark/tags`);
        if(!result.success)
        {
            console.log("Error fetching bookmark tag counts");
            return;
        }

        let tags = [];
        for(let tag of Object.keys(result.tags))
        {
            // Skip "untagged".
            if(tag == "")
                continue;
            tags.push(tag);
        }

        tags.sort();
        return tags;
    }

    // Given a local ID, return the separated directory and filename.  id is
    // the id result of helpers.parse_media_id when type is "file".
    static split_local_id(id)
    {
        let idx = id.lastIndexOf("/");
        let directory = id.substr(0, idx);
        let filename = id.substr(idx+1);
        return { directory: directory, filename: filename };
    }

    // The local data source URL has two parts: the path and the file being viewed (if any).
    // The file be absolute or relative to path.
    //
    // Path is args.hash_path, and file is args.hash.get("file").
    // 
    // Changes to path result in a new data source, but changes to the file don't.
    //
    // Examples:
    //
    // #/images/pictures?path=vacation/day1
    //
    // The user searched inside /images/pictures, and is currently viewing the folder
    // /images/pictures/vacation/day1.
    //
    // #/images/pictures?file=vacation/image.jpg
    //
    // The user searched inside /images/pictures, and is currently viewing the image
    // vacation/image.jpg.  This case is important: the path hasn't changed, so the data
    // source is still the search, so you can mousewheel within the search.
    static get_args_for_id(media_id, args)
    {
        // If we're navigating from a special page like /similar, ignore the previous
        // URL and create a new one.  Those pages can have their own URL formats.
        if(args.path != LocalAPI.path || args.path != "/")
        {
            args.path = LocalAPI.path;
            args.query = new URLSearchParams();
            args.hash = new URLSearchParams();
            args.hash_path = "/";
        }

        // The path previously on args:
        let args_root = args.hash_path || "";
        
        // The new path to set:
        let { type, id: path } = helpers.parse_media_id(media_id);

        if(type == "file")
        {
            // Put the relative path to new_path from root/path in "file".
            let filename = Path.get_relative_path(args_root, path);
            args.hash.set("file", filename);
            return args;
        }

        // This is a folder.  Remove any file in the URL.
        args.hash.delete("file");

        // Remove the page when linking to a folder.  Don't do this for files, since the
        // page should be left in place when viewing an image.
        args.query.delete("p");

        args.hash_path = path;
        return args;
    }

    // Get the local file or folder ID from a URL.
    //
    // Normally, a URL is a file if a "file" hash arg is present, otherwise it's
    // a folder.  If get_folder is true, return the folder, ignoring any file argument.
    static get_local_id_from_args(args, { get_folder=false }={})
    {
        // Combine the hash path and the filename to get the local ID.
        let root = args.hash_path;

        let file = args.hash.get("file");
        if(file == null || get_folder)
            return "folder:" + root;

        // The file can also be relative or absolute.
        if(!file.startsWith("/"))
            file = Path.get_child(root, file)

        return "file:" + file;
    }

    // Return the API search options and title for the given URL.
    static get_search_options_for_args(args)
    {
        let search_options = { };
        let title = null;
        let search_root = helpers.get_path_suffix(args.hash_path, 2);

        if(args.hash.has("search"))
        {
            search_options.search = args.hash.get("search");
            title = "Search: " + search_options.search;
        }

        if(args.hash.has("bookmark-tag"))
        {
            search_options.bookmarked = true;
            search_options.bookmark_tags = args.hash.get("bookmark-tag");
            if(search_options.bookmark_tags != "")
                title = `Bookmarks tagged ${search_options.bookmark_tags}`;
            else
                title = `Untagged bookmarks`;
        }
        // We always enable bookmark searching if that's all we're allowed to do.
        else if(args.hash.has("bookmarks") || LocalAPI.local_info.bookmark_tag_searches_only)
        {
            search_options.bookmarked = true;
            title = "Bookmarks";
        }

        if(args.hash.has("type"))
        {
            search_options.media_type = args.hash.get("type");
            if(!title)
                title = helpers.title_case(search_options.media_type);
        }

        if(args.hash.has("aspect-ratio"))
        {
            let range = args.hash.get("aspect-ratio");
            search_options.aspect_ratio = helpers.parse_range(range);
        }

        if(args.hash.has("pixels"))
        {
            let range = args.hash.get("pixels");
            search_options.total_pixels = helpers.parse_range(range);
        }

        if(title == null)
            title = "Search";

        title += ` inside ${search_root}`;

        // Clear search_options if it has no keys, to indicate that we're not in a search.
        if(Object.keys(search_options).length == 0)
        {
            search_options = null;

            // When there's no search, just show the current path as the title.
            let folder_id = LocalAPI.get_local_id_from_args(args, { get_folder: true });
            let { id } = helpers.parse_media_id(folder_id);
            title = helpers.get_path_suffix(id);
        }

        return { search_options: search_options, title: title };
    }

    // Given a folder ID, return its parent.  If folder_id is the root, return null.
    static get_parent_folder(media_id)
    {
        if(media_id == null || media_id == "folder:/")
            return null;

        // media_id can be a file or a folder.  We always return a folder.
        let { id } = helpers.parse_media_id(media_id);

        let parts = id.split("/");
        if(parts.length == 2)
            return "folder:/"; // return folder:/, not folder:

        parts.splice(parts.length-1, 1);
        return "folder:" + parts.join("/");
    }

    // Return true if this is a URL for slideshow staging.  See screen_illust.load_first_image.
    static is_slideshow_staging(args)
    {
        // If file is "*", this is a "first image" placeholder.  Don't treat it as a local ID.
        return args.hash.get("file") == "*";
    }

    // Load access info.  We always reload when this changes, eg. due to logging in
    // or out, so we cache this at startup.
    static async load_local_info()
    {
        if(LocalAPI.local_url == null)
            return;

        this._cached_api_info = await LocalAPI.local_post_request(`/api/info`);
    }

    static get local_info()
    {
        let info = this._cached_api_info;
        if(LocalAPI.local_url == null)
            info = { success: false, code: "disabled" };
            
        return {
            // True if the local API is enabled at all.
            enabled: LocalAPI.local_url != null,
            
            // True if we're running on localhost.  If we're local, we're always logged
            // in and we won't show the login/logout buttons.
            local: info.success && info.local,

            // True if we're logged in as a non-guest user.
            logged_in: info.success && info.username != "guest",

            // True if we're logged out and guest access is disabled, so we need to log
            // in to continue.
            login_required: !info.success && info.code == 'access-denied',

            // True if we can only do bookmark tag searches.
            bookmark_tag_searches_only: info.tags != null,
        }
    }

    // Return true if we're running on localhost.  If we're local, we're always logged
    // in and we won't show the login/logout buttons.
    static async is_local()
    {
        let info = await LocalAPI.local_post_request(`/api/info`);
        return info.local;
    }

    // Return true if we should load thumbnails for image viewing.
    //
    // We normally preload thumbnails for images, so we have something to display immediately
    // when we view an image.  This is useful on Pixiv, since they have all of their thumbs
    // cached and loading them is free.
    //
    // However, if we're local and running on desktop, the browser is usually running on the
    // same PC as the server, and the server doesn't have thumbnails cached, so requesting it
    // will cause the image to be decoded and resized in the server.  That means we'll just end
    // up decoding every image twice if we do this.
    //
    // If we're local but running on mobile, do preload thumbs.  It's important to have images
    // viewable at least in preview as quickly as possible to minimize gaps in the mobile UI,
    // and the PC running the server is probably much faster than a tablet, which may take some
    // time to decode larger images.
    static should_preload_thumbs(media_id, url)
    {
        if(ppixiv.mobile)
            return true;

        if(!helpers.is_media_id_local(media_id))
            return true;

        // If we know the image was viewed in search results recently, it should be cached, so
        // there's no harm in using it.  We could query whether the URL is cached with fetch's
        // cache: only-if-cached argument, but that causes browsers to obnoxiously spam the console
        // with errors every time it fails.  That doesn't make sense (errors are normal with
        // only-if-cached) and the log spam is too annoying to use it here.
        if(LocalAPI.was_thumbnail_loaded_recently(url))
            return true;

        // We're on desktop, the image is local, and the thumbnail hasn't been loaded recently.
        return false;
    }

    // Return true if we're logged out and guest access is disabled, so we need to log
    // in to continue.
    static async login_required()
    {
        // If we're not logged in and guest access is disabled, all API calls will
        // fail with access-denied.  Call api/info to check this.
        let info = await LocalAPI.local_post_request(`/api/info`);
        return !info.success && info.code == 'access-denied';
    }

    // Return true if we're logged in as a non-guest user.
    static async logged_in()
    {
        let info = await LocalAPI.local_post_request(`/api/info`);
        console.log(info);
        return info.success && info.username != "guest";
    }

    // Log out if we're logged in, and redirect to the login page.
    static redirect_to_login()
    {
        let query = new URLSearchParams();
        query.set("url", document.location.href);

        // Replace the current history entry.  This pushes any history state to the
        // login page.  It'll preserve it after logging in and redirecting back here,
        // so we'll try to retain it.
        let login_url = "/client/resources/auth.html?" + query.toString();
        window.history.replaceState(history.state, "", login_url.toString());
        document.location.reload();
    }

    // Log out and reload the page.
    static logout()
    {
        document.cookie = `auth_token=; max-age=0; path=/`;
        document.location.reload();
    }

    // This stores searches like SavedSearchTags.  It's simpler, since this is the
    // only place these searches are added.
    static add_recent_local_search(tag)
    {
        var recent_tags = ppixiv.settings.get("local_searches") || [];
        var idx = recent_tags.indexOf(tag);
        if(idx != -1)
            recent_tags.splice(idx, 1);
        recent_tags.unshift(tag);

        ppixiv.settings.set("local_searches", recent_tags);
        window.dispatchEvent(new Event("recent-local-searches-changed"));
    }

    // Navigate to a search, usually entered into the tag search box.
    static navigate_to_tag_search(tags, { add_to_history=true}={})
    {
        tags = tags.trim();

        if(tags.length == 0)
            tags = null;

        // Add this tag to the recent search list.
        if(add_to_history && tags)
            LocalAPI.add_recent_local_search(tags);

        // Run the search.  We expect to be on the local data source when this is called.
        let args = new helpers.args(ppixiv.plocation);
        console.assert(args.path == LocalAPI.path);
        if(tags)
            args.hash.set("search", tags);
        else
            args.hash.delete("search");
        args.set("p", null);
        helpers.navigate(args);
    }

    static async index_folder(media_id)
    {
        let { type, id } = helpers.parse_media_id(media_id);
        if(type != "folder")
        {
            console.log(`Not a folder: ${media_id}`);
            return;
        }

        let result = await LocalAPI.local_post_request(`/api/similar/index`, {
            path: id,
        });
        if(!result.success)
        {
            message_widget.singleton.show(`Error indexing ${id}: ${result.reason}`);
            return;
        }

        message_widget.singleton.show(`Begun indexing ${id} for similarity searching`);
    }

    // Remember that we've loaded a thumbnail this session.
    static thumbnail_loaded(url)
    {
        this._thumbnails_loaded_recently ??= new Set();
        this._thumbnails_loaded_recently.add(url);
    }

    // Return true if we've loaded a thumbnail this session.  This is used to optimize image display.
    static was_thumbnail_loaded_recently(url)
    {
        return this._thumbnails_loaded_recently && this._thumbnails_loaded_recently.has(url);
    }
}

// LocalBroadcastChannel implements the same API as BroadcastChannel, but sends messages
// over the local WebSockets connection.  This allows sending messages across browsers and
// machines.  If the local API isn't enabled, this is just a wrapper around BroadcastChannel.
export class LocalBroadcastChannel extends EventTarget
{
    constructor(name)
    {
        super();

        this.name = name;

        LocalBroadcastChannelConnection.get.addEventListener(this.name, this.receivedWebSocketsMessage);

        // Create a regular BroadcastChannel.  Other tabs in the same browser will receive
        // messages through this, so they don't need to round-trip through WebSockets.
        this.broadcast_channel = new BroadcastChannel(this.name);
        this.broadcast_channel.addEventListener("message", this.receivedBroadcastChannelMessage);
    }

    // Handle a message received over WebSockets.
    receivedWebSocketsMessage = (e) =>
    {
        let event = new MessageEvent("message", { data: e.data });
        this.dispatchEvent(event);
    }

    // Handle a message received over BroadcastChannel.
    receivedBroadcastChannelMessage = (e) =>
    {
        let event = new MessageEvent("message", { data: e.data });
        this.dispatchEvent(event);
    }

    postMessage(data)
    {
        LocalBroadcastChannelConnection.get.send(this.name, data);
        this.broadcast_channel.postMessage(data);
    }

    close()
    {
        LocalBroadcastChannelConnection.get.removeEventListener(this.name, this.receivedWebSocketsMessage);
        this.broadcast_channel.removeEventListener("message", this.receivedBroadcastChannelMessage);
    }
};

// This creates a single WebSockets connection to the local server.  An event is dispatched
// with the name of the channel when a WebSockets message is received.
class LocalBroadcastChannelConnection extends EventTarget
{
    static get get()
    {
        if(this.singleton == null)
            this.singleton = new LocalBroadcastChannelConnection();
        return this.singleton;
    }

    constructor()
    {
        super();

        // This is only used if the local API is enabled.
        if(!LocalAPI.is_enabled())
            return;

        // If messages are sent while we're still connecting, or if the buffer is full,
        // they'll be buffered until we can send it.  Buffered messages will be discarded
        // if connecting fails.
        this.send_buffer = [];
        this.reconnection_attempts = 0;
        
        // If we're disconnected, try to reconnect immediately if the window gains focus.
        window.addEventListener("focus", () => {
            this.queue_reconnect({ reset: true });
        });

        // Store a random ID in localStorage to identify this browser.  This is sent to the
        // WebSockets server, so it knows not to send broadcasts to clients running in the
        // same browser, which will receive the messages much faster through a regular
        // BroadcastChannel.
        this.browser_id = ppixiv.settings.get("browser_id");
        if(this.browser_id == null)
        {
            this.browser_id = helpers.create_uuid();
            ppixiv.settings.set("browser_id", this.browser_id);
            console.log("Assigned broadcast browser ID:", this.browser_id);
        }

        this.connect();
    }

    connect()
    {
        // Close the connection if it's still open.
        this.disconnect();

        let url = new URL("/ws", LocalAPI.local_url);
        url.protocol = document.location.protocol == "https:"? "wss":"ws";

        this.ws = new WebSocket(url);
        this.ws.onopen = this.ws_opened;
        this.ws.onclose = this.ws_closed;
        this.ws.onerror = this.ws_error;
        this.ws.onmessage = this.ws_message_received;
    }

    disconnect()
    {
        if(this.ws == null)
            return;

        this.ws.close();
        this.ws = null;
    }

    // Queue a reconnection after a connection error.  If reset is true, reset reconnection
    // attempts and attempt to reconnect immediately.
    queue_reconnect({reset=false}={})
    {
        if(this.ws != null)
            return;

        if(!reset && this.reconnect_id != null)
            return;

        if(reset)
        {
            // Cancel any queued reconnection.
            if(this.reconnect_id != null)
            {
                realClearTimeout(this.reconnect_id);
                this.reconnect_id = null;
            }
        }

        if(reset)
            this.reconnection_attempts = 0;
        else
            this.reconnection_attempts++;

        this.reconnection_attempts = Math.min(this.reconnection_attempts, 5);
        let reconnect_delay = Math.pow(this.reconnection_attempts, 2);
        // console.log("Reconnecting in", reconnect_delay);
        
        this.reconnect_id = realSetTimeout(() => {
            this.reconnect_id = null;
            this.connect();
        }, reconnect_delay*1000);
    }

    ws_opened = async(e) =>
    {
        console.log("WebSockets connection opened");

        // Cancel any queued reconnection.
        if(this.reconnect_id != null)
        {
            realClearTimeout(this.reconnect_id);
            this.reconnect_id = null;
        }

        this.reconnection_attempts = 0;

        // Tell the server our browser ID.  This is used to prevent sending messages back
        // to the same browser.
        this.send_raw({
            'command': 'init',
            'browser_id': this.browser_id,
        });

        // Send any data that was buffered while we were still connecting.
        this.send_buffered_data();
    }

    ws_closed = async(e) =>
    {
        console.log("WebSockets connection closed", e, e.wasClean, e.reason);
        this.disconnect();
        this.queue_reconnect();
    }

    // We'll also get onclose on connection error, so we don't need to queue_reconnect
    // here.
    ws_error = (e) =>
    {
        console.log("WebSockets connection error");
    }

    ws_message_received = (e) =>
    {
        let message = JSON.parse(e.data);
        if(message.command != "receive-broadcast")
        {
            console.error(`Unknown WebSockets command: ${message.command}`);
            return;
        }

        let event = new MessageEvent(message.message.channel, { data: message.message.data });
        this.dispatchEvent(event);
    };

    // Send a WebSockets message on the given channel name.
    send(channel, message)
    {
        if(!LocalAPI.is_enabled())
            return;
        
        let data = {
            'command': 'send-broadcast',
            'browser_id': this.browser_id,
            'message': {
                'channel': channel,
                'data': message,
            },
        };

        this.send_buffer.push(data);
        this.send_buffered_data();
    }

    // Send a raw message directly, without buffering.
    send_raw(data)
    {
        this.ws.send(JSON.stringify(data, null, 4));
    }

    // Send data buffered in send_buffer.
    send_buffered_data()
    {
        if(this.ws == null)
            return;

        while(this.send_buffer.length > 0)
        {
            // This API wasn't thought through.  It tells us how much data is buffered, but not
            // what the maximum buffer size is.  If the buffer fills, instead of returning an
            // error, it just unceremoniously kills the connection.  There's also no event to
            // tell us that buffered data has been sent, so you'd have to poll on a timer.  It's
            // a mess.
            if(this.ws.bufferedAmount > 1024*1024 || this.ws.readyState != 1)
                break;

            // Send the next buffered message.
            let data = this.send_buffer.shift();
            this.send_raw(data);
        }
    }
}
