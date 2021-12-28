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

        url.pathname = pathname;
        var result = await helpers.send_pixiv_request({
            method: "POST",
            url: url.toString(),
            responseType: "json",
            data: JSON.stringify(data),
            signal: options.signal,
        });
    
        // If the result isn't valid JSON, we'll get a null result.
        if(result == null)
            result = { error: true, message: "Invalid response" };
    
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
        illust.mangaPages = [{
            width: illust.width,
            height: illust.height,
            urls: illust.urls,
        }];

        illust.pageCount = 1;
    }

    // This is called early in initialization.  If we're running natively and
    // the URL is empty, navigate to a default directory, so we don't start off
    // on an empty page every time.
    static async set_initial_url()
    {
        if(!ppixiv.native || document.location.hash != "")
            return;

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

        thumbnail_data.singleton().loaded_thumbnail_info(result.results, "internal");
        return result;
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
            return;

        // Update bookmark tags and thumbnail data.
        image_data.singleton().update_cached_bookmark_image_tags(media_id, result.bookmark.tags);

        thumbnail_data.singleton().update_illust_data(media_id, {
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
            return;

        thumbnail_data.singleton().update_illust_data(media_id, {
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
        // in path.
        let relative_path = helpers.path.get_relative_path(args.hash_path, path);
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
        else if(args.hash.has("bookmarks"))
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

        if(title)
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
}
