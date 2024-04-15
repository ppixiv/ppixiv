// Helpers for the local API.

import Path from '/vview/util/path.js';
import { helpers } from '/vview/misc/helpers.js';

export default class LocalAPI
{
    static get localUrl()
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

    static async localPostRequest(pathname, data={}, options={})
    {
        let url = LocalAPI.localUrl;
        if(url == null)
            throw Error("Local API isn't enabled");

        url.pathname = encodeURI(pathname);
        let result = await helpers.pixivRequest.sendPixivRequest({
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
    static isEnabled()
    {
        return LocalAPI.localUrl != null;
    }

    // Return true if we're running in VVbrowser.
    static isVVbrowser()
    {
        return navigator.userAgent.indexOf("VVbrowser/")  != -1;
    }

    // Load image info from the local API.
    //
    // If refreshFromDisk and this is a local file, ask the server to ignore cache and
    // refresh from disk, even if it thinks it's not necessary.
    static async loadMediaInfo(mediaId, { refreshFromDisk=false }={})
    {
        let mediaInfo = await LocalAPI.localPostRequest(`/api/illust/${mediaId}`, {
            refresh_from_disk: refreshFromDisk,
        });

        return mediaInfo;
    }

    static async loadRecentBookmarkTags()
    {
        let result = await LocalAPI.localPostRequest(`/api/bookmark/tags`);
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

    // The local data source URL has two parts: the path and the file being viewed (if any).
    // The file be absolute or relative to path.
    //
    // Path is args.hashPath, and file is args.hash.get("file").
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
    static getArgsForId(mediaId, args)
    {
        // If we're navigating from a special page like /similar, ignore the previous
        // URL and create a new one.  Those pages can have their own URL formats.
        if(args.path != LocalAPI.path || args.path != "/")
        {
            args.path = LocalAPI.path;
            args.query = new URLSearchParams();
            args.hash = new URLSearchParams();
            args.hashPath = "/";
        }

        // The new path to set:
        let { type, id: path } = helpers.mediaId.parse(mediaId);

        if(type == "file")
        {
            // If file isn't underneath hashPath, set hashPath to the file's parent directory.
            if(!args.hashPath || !Path.isRelativeTo(path, args.hashPath))
            {
                let parentFolderMediaId = LocalAPI.getParentFolder(mediaId);
                args.hashPath = helpers.mediaId.parse(parentFolderMediaId).id;;
            }

            // Put the relative path from hashPath to file in "file".  
            let relativePath = Path.getRelativePath(args.hashPath, path);
            args.hash.set("file", relativePath);
            return args;
        }

        // This is a folder.  Remove any file in the URL.
        args.hash.delete("file");

        // Remove the page when linking to a folder.  Don't do this for files, since the
        // page should be left in place when viewing an image.
        args.query.delete("p");

        args.hashPath = path;
        return args;
    }

    // Get the local file or folder ID from a URL.
    //
    // Normally, a URL is a file if a "file" hash arg is present, otherwise it's
    // a folder.  If getFolder is true, return the folder, ignoring any file argument.
    static getLocalIdFromArgs(args, { getFolder=false }={})
    {
        // Combine the hash path and the filename to get the local ID.
        let root = args.hashPath;

        let file = args.hash.get("file");
        if(file == null || getFolder)
            return "folder:" + root;

        // The file can also be relative or absolute.
        if(!file.startsWith("/"))
            file = Path.getChild(root, file)

        return "file:" + file;
    }

    // Return the API search options and title for the given URL.
    static getSearchOptionsForArgs(args)
    {
        let searchOptions = { };
        let title = null;
        let search_root = helpers.strings.getPathSuffix(args.hashPath, 2);

        if(args.hash.has("search"))
        {
            searchOptions.search = args.hash.get("search");
            title = "Search: " + searchOptions.search;
        }

        if(args.hash.has("bookmark-tag"))
        {
            searchOptions.bookmarked = true;
            searchOptions.bookmark_tags = args.hash.get("bookmark-tag");
            if(searchOptions.bookmark_tags != "")
                title = `Bookmarks tagged ${searchOptions.bookmark_tags}`;
            else
                title = `Untagged bookmarks`;
        }
        // We always enable bookmark searching if that's all we're allowed to do.
        else if(args.hash.has("bookmarks") || LocalAPI.localInfo.bookmark_tag_searches_only)
        {
            searchOptions.bookmarked = true;
            title = "Bookmarks";
        }

        if(args.hash.has("type"))
        {
            searchOptions.media_type = args.hash.get("type");
            if(!title)
                title = helpers.strings.titleCase(searchOptions.media_type);
        }

        if(args.hash.has("aspect-ratio"))
        {
            let range = args.hash.get("aspect-ratio");
            searchOptions.aspect_ratio = helpers.strings.parseRange(range);
        }

        if(args.hash.has("pixels"))
        {
            let range = args.hash.get("pixels");
            searchOptions.total_pixels = helpers.strings.parseRange(range);
        }

        if(title == null)
            title = "Search";

        title += ` inside ${search_root}`;

        // Clear searchOptions if it has no keys, to indicate that we're not in a search.
        if(Object.keys(searchOptions).length == 0)
        {
            searchOptions = null;

            // When there's no search, just show the current path as the title.
            let folder_id = LocalAPI.getLocalIdFromArgs(args, { getFolder: true });
            let { id } = helpers.mediaId.parse(folder_id);
            title = helpers.strings.getPathSuffix(id);
        }

        return { searchOptions, title: title };
    }

    // Given a folder ID, return its parent.  If folder_id is the root, return null.
    static getParentFolder(mediaId)
    {
        if(mediaId == null || mediaId == "folder:/")
            return null;

        // mediaId can be a file or a folder.  We always return a folder.
        let { id } = helpers.mediaId.parse(mediaId);

        let parts = id.split("/");
        if(parts.length == 2)
            return "folder:/"; // return folder:/, not folder:

        parts.splice(parts.length-1, 1);
        return "folder:" + parts.join("/");
    }

    // Load access info.  We always reload when this changes, eg. due to logging in
    // or out, so we cache this at startup.
    static async loadLocalInfo()
    {
        if(LocalAPI.localUrl == null)
            return;

        this._cachedApiInfo = await LocalAPI.localPostRequest(`/api/info`);
    }

    static get localInfo()
    {
        let info = this._cachedApiInfo;
        if(LocalAPI.localUrl == null)
            info = { success: false, code: "disabled" };
            
        return {
            // True if the local API is enabled at all.
            enabled: LocalAPI.localUrl != null,
            
            // True if we're running on localhost.  If we're local, we're always logged
            // in and we won't show the login/logout buttons.
            local: info.success && info.local,

            // True if we're logged in as a non-guest user.
            logged_in: info.success && info.username != "guest",

            // True if we're logged out and guest access is disabled, so we need to log
            // in to continue.
            loginRequired: !info.success && info.code == 'access-denied',

            // True if we can only do bookmark tag searches.
            bookmark_tag_searches_only: info.tags != null,
        }
    }

    // Return true if we're running on localhost.  If we're local, we're always logged
    // in and we won't show the login/logout buttons.
    static async isLocal()
    {
        let info = await LocalAPI.localPostRequest(`/api/info`);
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
    static shouldPreloadThumbs(mediaId, url)
    {
        if(ppixiv.mobile)
            return true;

        if(!helpers.mediaId.isLocal(mediaId))
            return true;

        // If we know the image was viewed in search results recently, it should be cached, so
        // there's no harm in using it.  We could query whether the URL is cached with fetch's
        // cache: only-if-cached argument, but that causes browsers to obnoxiously spam the console
        // with errors every time it fails.  That doesn't make sense (errors are normal with
        // only-if-cached) and the log spam is too annoying to use it here.
        if(url != null && LocalAPI._wasThumbnailLoadedRecently(url))
            return true;

        // We're on desktop, the image is local, and the thumbnail hasn't been loaded recently.
        return false;
    }

    // Return true if we're logged out and guest access is disabled, so we need to log
    // in to continue.
    static async loginRequired()
    {
        // If we're not logged in and guest access is disabled, all API calls will
        // fail with access-denied.  Call api/info to check this.
        let info = await LocalAPI.localPostRequest(`/api/info`);
        return !info.success && info.code == 'access-denied';
    }

    // Return true if we're logged in as a non-guest user.
    static async loggedIn()
    {
        let info = await LocalAPI.localPostRequest(`/api/info`);
        console.log(info);
        return info.success && info.username != "guest";
    }

    // Log out if we're logged in, and redirect to the login page.
    static redirectToLogin()
    {
        let query = new URLSearchParams();
        query.set("url", document.location.href);

        // Replace the current history entry.  This pushes any history state to the
        // login page.  It'll preserve it after logging in and redirecting back here,
        // so we'll try to retain it.
        let loginUrl = "/resources/auth.html?" + query.toString();
        window.history.replaceState(history.state, "", loginUrl.toString());
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
    static addRecentLocalSearch(tag)
    {
        let recentTags = ppixiv.settings.get("local_searches") || [];
        let idx = recentTags.indexOf(tag);
        if(idx != -1)
            recentTags.splice(idx, 1);
        recentTags.unshift(tag);

        ppixiv.settings.set("local_searches", recentTags);
        window.dispatchEvent(new Event("recent-local-searches-changed"));
    }

    // Navigate to a search, usually entered into the tag search box.
    static navigateToTagSearch(tags, { addToHistory=true}={})
    {
        tags = tags.trim();

        if(tags.length == 0)
            tags = null;

        // Add this tag to the recent search list.
        if(addToHistory && tags)
            LocalAPI.addRecentLocalSearch(tags);

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

    static async indexFolderForSimilaritySearch(mediaId)
    {
        let { type, id } = helpers.mediaId.parse(mediaId);
        if(type != "folder")
        {
            console.log(`Not a folder: ${mediaId}`);
            return;
        }

        let result = await LocalAPI.localPostRequest(`/api/similar/index`, {
            path: id,
        });
        if(!result.success)
        {
            ppixiv.message.show(`Error indexing ${id}: ${result.reason}`);
            return;
        }

        ppixiv.message.show(`Begun indexing ${id} for similarity searching`);
    }

    // Remember that we've loaded a thumbnail this session.
    static thumbnailWasLoaded(url)
    {
        this._thumbnailsLoadedRecently ??= new Set();
        this._thumbnailsLoadedRecently.add(url);
    }

    // Return true if we've loaded a thumbnail this session.  This is used to optimize image display.
    static _wasThumbnailLoadedRecently(url)
    {
        return this._thumbnailsLoadedRecently && this._thumbnailsLoadedRecently.has(url);
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
        this.broadcastChannel = new BroadcastChannel(this.name);
        this.broadcastChannel.addEventListener("message", this.receivedBroadcastChannelMessage);
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
        this.broadcastChannel.postMessage(data);
    }

    close()
    {
        LocalBroadcastChannelConnection.get.removeEventListener(this.name, this.receivedWebSocketsMessage);
        this.broadcastChannel.removeEventListener("message", this.receivedBroadcastChannelMessage);
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
        if(!LocalAPI.isEnabled())
            return;

        // If messages are sent while we're still connecting, or if the buffer is full,
        // they'll be buffered until we can send it.  Buffered messages will be discarded
        // if connecting fails.
        this._sendBuffer = [];
        this._reconnectionAttempts = 0;
        
        // If we're disconnected, try to reconnect immediately if the window gains focus.
        window.addEventListener("focus", () => {
            this._queueReconnect({ reset: true });
        });

        // Store a random ID in localStorage to identify this browser.  This is sent to the
        // WebSockets server, so it knows not to send broadcasts to clients running in the
        // same browser, which will receive the messages much faster through a regular
        // BroadcastChannel.
        this._browserId = ppixiv.settings.get("browser_id");
        if(this._browserId == null)
        {
            this._browserId = helpers.other.createUuid();
            ppixiv.settings.set("browser_id", this._browserId);
            console.log("Assigned broadcast browser ID:", this._browserId);
        }

        this.connect();
    }

    connect()
    {
        // Close the connection if it's still open.
        this.disconnect();

        let url = new URL("/ws", LocalAPI.localUrl);
        url.protocol = document.location.protocol == "https:"? "wss":"ws";

        this.ws = new WebSocket(url);
        this.ws.onopen = this.wsOpened;
        this.ws.onclose = this.wsClosed;
        this.ws.onerror = this.wsError;
        this.ws.onmessage = this.wsMessageReceived;
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
    _queueReconnect({reset=false}={})
    {
        if(this.ws != null)
            return;

        if(!reset && this.reconnectId != null)
            return;

        if(reset)
        {
            // Cancel any queued reconnection.
            if(this.reconnectId != null)
            {
                realClearTimeout(this.reconnectId);
                this.reconnectId = null;
            }
        }

        if(reset)
            this._reconnectionAttempts = 0;
        else
            this._reconnectionAttempts++;

        this._reconnectionAttempts = Math.min(this._reconnectionAttempts, 5);
        let reconnectDelay = Math.pow(this._reconnectionAttempts, 2);
        // console.log("Reconnecting in", reconnectDelay);
        
        this.reconnectId = realSetTimeout(() => {
            this.reconnectId = null;
            this.connect();
        }, reconnectDelay*1000);
    }

    wsOpened = async(e) =>
    {
        console.log("WebSockets connection opened");

        // Cancel any queued reconnection.
        if(this.reconnectId != null)
        {
            realClearTimeout(this.reconnectId);
            this.reconnectId = null;
        }

        this._reconnectionAttempts = 0;

        // Tell the server our browser ID.  This is used to prevent sending messages back
        // to the same browser.
        this._sendRaw({
            'command': 'init',
            'browser_id': this._browserId,
        });

        // Send any data that was buffered while we were still connecting.
        this._sendBufferedData();
    }

    wsClosed = async(e) =>
    {
        console.log("WebSockets connection closed", e, e.wasClean, e.reason);
        this.disconnect();
        this._queueReconnect();
    }

    // We'll also get onclose on connection error, so we don't need to _queueReconnect
    // here.
    wsError = (e) =>
    {
        console.log("WebSockets connection error");
    }

    wsMessageReceived = (e) =>
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
        if(!LocalAPI.isEnabled())
            return;
        
        let data = {
            'command': 'send-broadcast',
            'browser_id': this._browserId,
            'message': {
                'channel': channel,
                'data': message,
            },
        };

        this._sendBuffer.push(data);
        this._sendBufferedData();
    }

    // Send a raw message directly, without buffering.
    _sendRaw(data)
    {
        this.ws.send(JSON.stringify(data, null, 4));
    }

    // Send data buffered in _sendBuffer.
    _sendBufferedData()
    {
        if(this.ws == null)
            return;

        while(this._sendBuffer.length > 0)
        {
            // This API wasn't thought through.  It tells us how much data is buffered, but not
            // what the maximum buffer size is.  If the buffer fills, instead of returning an
            // error, it just unceremoniously kills the connection.  There's also no event to
            // tell us that buffered data has been sent, so you'd have to poll on a timer.  It's
            // a mess.
            if(this.ws.bufferedAmount > 1024*1024 || this.ws.readyState != 1)
                break;

            // Send the next buffered message.
            let data = this._sendBuffer.shift();
            this._sendRaw(data);
        }
    }
}
