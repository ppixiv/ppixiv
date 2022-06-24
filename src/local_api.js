"use strict";

// Helpers for the local API.
ppixiv.local_api = class
{
    static get local_url()
    {
        // If we're running natively, the API is on the same URL as we are.
        if(ppixiv.native)
            return new URL("/", document.location);

        let url = settings.get("local_api_url");
        if(url == null)
            return null;
        return new URL(url);
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
        let url = ppixiv.local_api.local_url;
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
        return ppixiv.local_api.local_url != null;
    }

    // Load image info from the local API.
    static async load_media_info(media_id)
    {
        let illust_data = await local_api.local_post_request(`/api/illust/${media_id}`);
        if(illust_data.success)
            local_api.adjust_illust_info(illust_data.illust);

        return illust_data;
    }

    // Fill in some redundant fields in.  The local API doesn't use mangaPages,
    // but we fill it in from urls so we can treat it the same way.
    static adjust_illust_info(illust)
    {
        let { type } = helpers.parse_media_id(illust.id);
        if(type == "folder")
        {
            illust.mangaPages = [];
            illust.pageCount = 0;

            // These metadata fields don't exist for folders.  Set them to null so thumbnail_data._check_illust_data doesn't complain.
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
    }

    // This is called early in initialization.  If we're running natively and
    // the URL is empty, navigate to a default directory, so we don't start off
    // on an empty page every time.
    static async set_initial_url()
    {
        if(!ppixiv.native || document.location.hash != "")
            return;

        // If we're limited to tag searches, we don't view folders.  Just set the URL
        // to "/".
        if(this.local_info.bookmark_tag_searches_only)
        {
            let args = helpers.args.location;
            args.hash_path = "/";
            helpers.set_page_url(args, false, "initial");
            return;
        }

        // Read the folder list.  If we have any mounts, navigate to the first one.  Otherwise,
        // show folder:/ as a fallback.
        let illust_id = "folder:/";
        let result = await local_api.list(illust_id);
        if(result.results.length)
            illust_id = result.results[0].id;

        let args = helpers.args.location;
        local_api.get_args_for_id(illust_id, args);
        helpers.set_page_url(args, false, "initial");
    }

    // Run a search against the local API.
    //
    // The results will be registered as thumbnail info and returned.
    static async list(path="", {...options}={})
    {
        let result = await local_api.local_post_request(`/api/list/${path}`, {
            ...options,
        });

        if(!result.success)
        {
            console.error("Error reading directory:", result.reason);
            return result;
        }

        for(let illust of result.results)
            ppixiv.local_api.adjust_illust_info(illust);

        await thumbnail_data.singleton().loaded_thumbnail_info(result.results, "internal");
        return result;
    }

    static loading_media_ids = {};
    static is_media_id_loading(media_id)
    {
        return this.loading_media_ids[media_id];
    }

    // This is like thumbnail_data.loaded_thumbnail_info().
    static async load_media_ids(media_ids)
    {
        // Filter out IDs that are already loading or loaded.
        let media_ids_to_load = [];
        for(let media_id of media_ids)
        {
            if(thumbnail_data.singleton().is_media_id_loaded_or_loading(media_id))
                continue;

            media_ids_to_load.push(media_id);
            this.loading_media_ids[media_id] = true;
        }

        if(media_ids_to_load.length == 0)
            return;

        let result = await local_api.local_post_request(`/api/illusts`, {
            ids: media_ids_to_load,
        });

        for(let media_id of media_ids)
        {
            delete this.loading_media_ids[media_id];
        }

        if(!result.success)
        {
            console.error("Error reading IDs:", result.reason);
            return;
        }

        for(let illust of result.results)
            ppixiv.local_api.adjust_illust_info(illust);

        await thumbnail_data.singleton().loaded_thumbnail_info(result.results, "internal");

        // Broadcast that we have new thumbnail data available.
        window.dispatchEvent(new Event("thumbnailsloaded"));
    }

    static async bookmark_add(media_id, options)
    {
        let illust_info = await thumbnail_data.singleton().get_or_load_illust_data(media_id);
        let bookmark_options = { };
        if(options.tags != null)
            bookmark_options.tags = options.tags;

        // Remember whether this is a new bookmark or an edit.
        let was_bookmarked = illust_info.bookmarkData != null;

        let result = await local_api.local_post_request(`/api/bookmark/add/${media_id}`, {
            ...bookmark_options,
        });
        if(!result.success)
        {
            message_widget.singleton.show(`Couldn't edit bookmark: ${result.reason}`);
            return;
        }

        // Update bookmark tags and thumbnail data.
        image_data.singleton().update_cached_bookmark_image_tags(media_id, result.bookmark.tags);
        image_data.singleton().update_media_info(media_id, {
            bookmarkData: result.bookmark
        });

        let { type } = helpers.parse_media_id(media_id);
        
        message_widget.singleton.show(
            was_bookmarked? "Bookmark edited":
            type == "folder"? "Bookmarked folder":"Bookmarked",
        );
        image_data.singleton().call_illust_modified_callbacks(media_id);
    }

    static async bookmark_remove(media_id)
    {
        let illust_info = await thumbnail_data.singleton().get_or_load_illust_data(media_id);
        if(illust_info.bookmarkData == null)
        {
            console.log("Not bookmarked");
            return;
        }

        let result = await local_api.local_post_request(`/api/bookmark/delete/${media_id}`);
        if(!result.success)
        {
            message_widget.singleton.show(`Couldn't remove bookmark: ${result.reason}`);
            return;
        }

        image_data.singleton().update_media_info(media_id, {
            bookmarkData: null
        });

        message_widget.singleton.show("Bookmark removed");

        image_data.singleton().call_illust_modified_callbacks(media_id);
    }
    
    static async load_recent_bookmark_tags()
    {
        let result = await local_api.local_post_request(`/api/bookmark/tags`);
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

    // The local data source URL has three parts: the root, the path, and the file
    // being viewed (if any).  The path can be absolute or relative to root.  The
    // file be absolute or relative to path.
    //
    // Root is args.hash_path, path is args.hash.get("path"), and file is args.hash.get("file").
    // 
    // When searching, the root is the directory that was searched.  If a folder is
    // clicked inside search results, it goes in the path, leaving the root alone so we're
    // still in the search.  If a file is clicked inside search results, it goes in
    // file.  These are all usually paths relative to the previous part, but they're allowed
    // to be absolute.
    //
    // Changes to root and path result in a new data source.
    //
    // Examples:
    //
    // #ppixiv/images/pictures?path=vacation/day1
    //
    // The user searched inside /images/pictures, and is currently viewing the folder
    // /images/pictures/vacation/day1.
    //
    // #ppixiv/images/pictures?file=vacation/image.jpg
    //
    // The user searched inside /images/pictures, and is currently viewing the image
    // vacation/image.jpg.  There's no path, which means the image was listed directly in the
    // search results.  We're showing that a search is active, but the current view is
    // a folder inside the search, not the search itself.  This case is important: since
    // the path hasn't changed, the data source is still the search, so you can mousewheel
    // within the search.
    //
    // #ppixiv/images/pictures?path=vacation/day1&file=image.jpg
    //
    // The user searched inside /images/pictures, navigated to the folder vacation/day1 in
    // the results, then viewed image.jpg from there.  The data source is the folder.
    //
    // When no search is active, we never use path.  We just put the folder inside the
    // root.
    //
    // It's tricky to figure out where to edit the URL, but combining them is simple:
    // hash_path + path + file.
    static get_args_for_id(media_id, args)
    {
        if(args.path != local_api.path)
        {
            // Navigating to a local URL from somewhere else.  The search options
            // are unrelated, so just reset the URL.
            // XXX: untested
            args.path = local_api.path;
            args.query = new URLSearchParams();
            args.hash = new URLSearchParams();
            args.hash_path = "";
        }

        // The path previously on args:
        let args_root = args.hash_path || "";
        let args_path = args.hash.get("path") || "";
        // let args_file = args.hash.get("file") || "";
        
        // The new path to set:
        let { type, id: path } = helpers.parse_media_id(media_id);

        if(type == "file")
        {
            // Put the relative path to new_path from root/path in "file".
            let folder = helpers.path.get_child(args_root, args_path);
            let filename = helpers.path.get_relative_path(folder, path);
            args.hash.set("file", filename);
            return args;
        }

        // This is a folder.  Remove any file in the URL.
        args.hash.delete("file");

        // Remove the page when linking to a folder.  Don't do this for files, since the
        // page should be left in place when viewing an image.
        args.query.delete("p");

        // If we're going to a folder and the current page is shuffled, don't shuffle the
        // folder we're going to.  If the user shuffled folder:/books and then clicked a
        // random book, he probably doesn't want the pages in the book shuffled too.  Don't
        // do this if we're going to a file, since it doesn't matter and we don't want to
        // cause the data source to change.
        if(args.hash.get("order") == "shuffle")
            args.hash.delete("order");

        // If a search isn't active, just put the folder in the root and remove any path.
        let search_active = local_api.get_search_options_for_args(args).search_options != null;
        if(!search_active)
        {
            args.hash_path = path;
            args.hash.delete("path");
            return args;
        }
       
        // When in a search, leave hash_path alone, and put the relative path to the folder
        // in path.  hash_path can be empty if bookmarked was forced on by get_search_options_for_args.
        let relative_path = helpers.path.get_relative_path(args.hash_path || "/", path);
        if(relative_path != "")
            args.hash.set("path", relative_path);
        else
            args.hash.delete("path");

        return args;
    }

    // The search root is the top of the current search, which is where the
    // tree view starts.  This is just the hash path.
    // XXX: move this into the tree
    static get_search_root_from_args(args, search_options)
    {
        // If there's no search active, the root is always the top.
        if(search_options == null)
            return "folder:/";

        return "folder:" + args.hash_path;
    }

    // Get the local file or folder ID from a URL.
    //
    // Normally, a URL is a file if a "file" hash arg is present, otherwise it's
    // a folder.  If get_folder is true, return the folder, ignoring any file argument.
    static get_local_id_from_args(args, { get_folder=false }={})
    {
        // Combine the hash path and the filename to get the local ID.
        let root = args.hash_path;
        let path = args.hash.get("path");
        if(path != null)
        {
            // The path can be relative or absolute.
            root = helpers.path.get_child(root, path)
        }

        let file = args.hash.get("file");
        if(file == null || get_folder)
            return "folder:" + root;

        // The file can also be relative or absolute.
        if(!file.startsWith("/"))
            file = helpers.path.get_child(root, file)

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
        else if(args.hash.has("bookmarks") || local_api.local_info.bookmark_tag_searches_only)
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
            let folder_id = local_api.get_local_id_from_args(args, { get_folder: true });
            let { id } = helpers.parse_media_id(folder_id);
            title = helpers.get_path_suffix(id);
        }

        return { search_options: search_options, title: title };
    }

    // Given a folder ID, return its parent.  If folder_id is the root, return null.
    static get_parent_folder(media_id)
    {
        if(media_id == "folder:/")
            return null;

        // media_id can be a file or a folder.  We always return a folder.
        let { id } = helpers.parse_media_id(media_id);

        let parts = id.split("/");
        if(parts.length == 2)
            return "folder:/"; // return folder:/, not folder:

        parts.splice(parts.length-1, 1);
        return "folder:" + parts.join("/");
    }

    // Navigate to the top of local search.  This is the "Local Search" button in the
    // search menu.
    //
    // We don't want to just navigate to folder:/, since most people will only have one
    // library mounted, so the first thing they'll always see is a page with their one
    // folder on it that they have to click into.  Instead, load the library list, and
    // open the top of the first one.
    static async show_local_search(e)
    {
        e.preventDefault();

        let result = await local_api.list("folder:/");
        if(!result.success)
        {
            console.error("Error reading libraries:", result.reason);
            return;
        }

        let libraries = result.results;
        if(libraries.length == 0)
        {
            alert("No libraries are available");
            return;
        }

        let folder_id = libraries[0].id;
        let args = new helpers.args("/", ppixiv.location);
        local_api.get_args_for_id(folder_id, args);
        helpers.set_page_url(args.url, true /* add to history */, "navigation");
    }

    // Load access info.  We always reload when this changes, eg. due to logging in
    // or out, so we cache this at startup.
    static async load_local_info()
    {
        if(ppixiv.local_api.local_url == null)
            return;

        this._cached_api_info = await local_api.local_post_request(`/api/info`);
    }

    static get local_info()
    {
        let info = this._cached_api_info;
        if(ppixiv.local_api.local_url == null)
            info = { success: false, code: "disabled" };
            
        return {
            // True if the local API is enabled at all.
            enabled: ppixiv.local_api.local_url != null,
            
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
        let info = await local_api.local_post_request(`/api/info`);
        return info.local;
    }

    // Return true if we're logged out and guest access is disabled, so we need to log
    // in to continue.
    static async login_required()
    {
        // If we're not logged in and guest access is disabled, all API calls will
        // fail with access-denied.  Call api/info to check this.
        let info = await local_api.local_post_request(`/api/info`);
        return !info.success && info.code == 'access-denied';
    }

    // Return true if we're logged in as a non-guest user.
    static async logged_in()
    {
        let info = await local_api.local_post_request(`/api/info`);
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
}

// LocalBroadcastChannel implements the same API as BroadcastChannel, but sends messages
// over the local WebSockets connection.  This allows sending messages across browsers and
// machines.  If the local API isn't enabled, this is just a wrapper around BroadcastChannel.
ppixiv.LocalBroadcastChannel = class extends EventTarget
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
            this.singleton = new LocalBroadcastChannelConnection;
        return this.singleton;
    }

    constructor()
    {
        super();

        // This is only used if the local API is enabled.
        if(!local_api.is_enabled())
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
        this.browser_id = settings.get("browser_id");
        if(this.browser_id == null)
        {
            this.browser_id = helpers.create_uuid();
            settings.set("browser_id", this.browser_id);
            console.log("Assigned broadcast browser ID:", this.browser_id);
        }

        this.connect();
    }

    connect()
    {
        // Close the connection if it's still open.
        this.disconnect();

        let url = new URL("/ws", local_api.local_url);
        url.protocol = "ws";

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
                clearTimeout(this.reconnect_id);
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
        
        this.reconnect_id = setTimeout(() => {
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
            clearTimeout(this.reconnect_id);
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
        console.log("WebSockets connection closed");
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
        if(!local_api.is_enabled())
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
