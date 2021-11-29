"use strict";

// Helpers for the local API.
ppixiv.local_api = class
{
    static get local_url()
    {
        let url = settings.get("local_api_url");
        if(url == null)
            return null;
        return new URL(url);
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

    // Run a search against the local API.
    //
    // The results will be registered as thumbnail info and returned.
    static async list(path="", {...options})
    {
        let result = await local_api.local_post_request(`/api/list/${path}`, {
            ...options,
        });

        if(!result.success)
        {
            console.error("Error reading directory:", result.reason);
            return null;
        }

        for(let illust of result.results)
            ppixiv.local_api.adjust_illust_info(illust);

        thumbnail_data.singleton().loaded_thumbnail_info(result.results, "internal");
        return result;
    }

    static async bookmark_add(illust_id, options)
    {
        let illust_info = await thumbnail_data.singleton().get_or_load_illust_data(illust_id);
        let bookmark_options = { };
        if(options.tags != null)
            bookmark_options.tags = options.tags;

        // Remember whether this is a new bookmark or an edit.
        let was_bookmarked = illust_info.bookmarkData != null;

        let result = await local_api.local_post_request(`/api/bookmark/add/${illust_id}`, {
            ...bookmark_options,
        });
        if(!result.success)
            return;

        // Update bookmark tags and thumbnail data.
        image_data.singleton().update_cached_bookmark_image_tags(illust_id, result.bookmark.tags);

        thumbnail_data.singleton().update_illust_data(illust_id, {
            bookmarkData: result.bookmark
        });

        let { type } = helpers.parse_id(illust_id);
        
        message_widget.singleton.show(
            was_bookmarked? "Bookmark edited":
            type == "folder"? "Bookmarked folder":"Bookmarked",
        );
        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }

    static async bookmark_remove(illust_id)
    {
        let illust_info = await thumbnail_data.singleton().get_or_load_illust_data(illust_id);
        if(illust_info.bookmarkData == null)
        {
            console.log("Not bookmarked");
            return;
        }

        let result = await local_api.local_post_request(`/api/bookmark/delete/${illust_id}`);
        if(!result.success)
            return;

        thumbnail_data.singleton().update_illust_data(illust_id, {
            bookmarkData: null
        });

        message_widget.singleton.show("Bookmark removed");

        image_data.singleton().call_illust_modified_callbacks(illust_id);
    }

    // Given a local ID, return the separated directory and filename.  id is
    // the id result of helpers.parse_id when type is "file".
    static split_local_id(id)
    {
        let idx = id.lastIndexOf("/");
        let directory = id.substr(0, idx);
        let filename = id.substr(idx+1);
        return { directory: directory, filename: filename };
    }

    // The local data source URL has three parts: the search root in hash_path,
    // the path currently being viewed in the hash argument "path", and the file
    // being viewed (if any) in "file".  "path" is relative to hash_path if it's
    // underneath it, otherwise it's absolute.  If the user clicks a folder or
    // illust in a search, we leave hash_path alone and only change path and file.
    static get_args_for_id(illust_id, args)
    {
        if(args.path != "/local/")
        {
            // Navigating to a local URL from somewhere else.  The search options
            // are unrelated, so just reset the URL.
            // XXX: untested
            args.path = "/local/";
            args.query = new URLSearchParams();
            args.hash = new URLSearchParams();
            args.hash_path = "";
        }

        args.query.delete("p");

        // Split "folder:/path/to/file.jpg" into "folder" and "/path/to/file.jpg":
        let { type, id } = helpers.parse_id(illust_id);

        let path;
        if(type == "file")
        {
            // For files, split off the basename and put it in "file".
            let { directory, filename } = local_api.split_local_id(id);
            path = directory;
            args.hash.set("file", filename);
        }
        else
        {
            path = id;
            args.hash.delete("file");
        }

        // If there's no search active, just set this as the new hash_path.  The
        // path argument is only used for searches.
        let { search_options } = local_api.get_search_options_for_args(args);
        if(search_options == null)
        {
            args.hash_path = path;
            args.hash.delete("path");
            return args;
        }

        // We're in a search.  hash_path is the root of the search, so we don't want to
        // change that.  Put the path in the path argument.
        //
        // Hack to check if path is a prefix of root, preventing a root of "/abcd" from
        // matching "/abcdef".
        let root = args.hash_path;
        if((path + "/").startsWith(root + "/"))
        {
            // The path is underneath the search root.  Use a relative path to keep the
            // URL shorter.
            path = path.substr(root.length + 1);
        }
        
        if(path != "")
            args.hash.set("path", path);
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
        let file = args.hash.get("file");
        if(path != null)
        {
            // The path can be relative or absolute.  See set_current_illust_id.
            if(path.startsWith("/"))
                root = path;
            else
            {
                if(!root.endsWith("/"))
                    root += "/";
                root += path;
            }
        }

        if(file == null || get_folder)
            return "folder:" + root;
        else
            return "file:" + root + "/" + file;
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

        if(title)
            title += ` inside ${search_root}`;

        // Clear search_options if it has no keys, to indicate that we're not in a search.
        if(Object.keys(search_options).length == 0)
        {
            search_options = null;

            // When there's no search, just show the current path as the title.
            let folder_id = local_api.get_local_id_from_args(args, { get_folder: true });
            let { id } = helpers.parse_id(folder_id);
            title = helpers.get_path_suffix(id);
        }

        return { search_options: search_options, title: title };
    }
}
