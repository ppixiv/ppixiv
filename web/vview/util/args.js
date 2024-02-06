export default class Args
{
    constructor(url)
    {
        if(url == null)
            throw ValueError("url must not be null");

        url = new URL(url, ppixiv.plocation);

        this.path = url.pathname;
        this.query = url.searchParams;
        let { path: hashPath, query: hash_query } = Args.getHashArgs(url);
        this.hash = hash_query;
        this.hashPath = hashPath;

        // History state is only available when we come from the current history state,
        // since URLs don't have state.
        this.state = { };
    }

    // Return true if url is one of ours.
    static isPPixivUrl(url)
    {
        // If we're native, all URLs on this origin are ours.
        if(ppixiv.native)
            return new URL(url).origin == document.location.origin;
        else
            return url.hash.startsWith("#ppixiv");
    }

    static getHashArgs(url)
    {
        if(!this.isPPixivUrl(url))
            return { path: "", query: new URLSearchParams() };

        // The hash looks like:
        //
        // #ppixiv/a/b/c?foo&bar
        //
        // /a/b/c is the hash path.  foo&bar are the hash args.
        // Parse the hash of the current page as a path.  For example, if
        // the hash is #ppixiv/foo/bar?baz, parse it as /ppixiv/foo/bar?baz.
        // The pathname portion of this (with /ppixiv removed) is the hash path,
        // and the query portion is the hash args.
        //
        // If the hash is #ppixiv/abcd, the hash path is "/abcd".
        // Remove #ppixiv:
        let hashPath = url.hash;
        if(hashPath.startsWith("#ppixiv"))
            hashPath = hashPath.substr(7);
        else if(hashPath.startsWith("#"))
            hashPath = hashPath.substr(1);

        // See if we have hash args.
        let idx = hashPath.indexOf('?');
        let query = null;
        if(idx != -1)
        {
            query = hashPath.substr(idx+1);
            hashPath = hashPath.substr(0, idx);
        }

        // We encode spaces as + in the URL, but decodeURIComponent doesn't, so decode
        // that first.  Actual '+' is always escaped as %2B.
        hashPath = hashPath.replace(/\+/g, " ");
        hashPath = decodeURIComponent(hashPath);

        if(query == null)
            return { path: hashPath, query: new URLSearchParams() };
        else
            return { path: hashPath, query: new URLSearchParams(query) };
    }

    static encodeURLPart(regex, part)
    {
        return part.replace(regex, (c) => {
            // encodeURIComponent(sic) encodes non-ASCII characters.  We don't need to.
            let ord = c.charCodeAt(0);
            if(ord >= 128)
                return c;

            // Regular URL escaping wants to escape spaces as %20, which is silly since
            // it's such a common character in filenames.  Escape them as + instead, like
            // things like AWS do.  The escaping is different, but it's still a perfectly
            // valid URL.  Note that the API doesn't decode these, we only use it in the UI.
            if(c == " ")
                return "+";

            let hex = ord.toString(16).padStart('0', 2);
            return "%" + hex;
        });
    }

    // Both "encodeURI" and "encodeURIComponent" are wrong for encoding hashes.
    // The first doesn't escape ?, and the second escapes lots of things we
    // don't want to, like forward slash.
    static encodeURLHash(hash)
    {
        return Args.encodeURLPart(/[^A-Za-z0-9-_\.!~\*'()/:\[\]\^#=&]/g, hash);
    }

    // This one escapes keys in hash parameters.  This is the same as encodeURLHash,
    // except it also encodes = and &.
    static encodeHashParam(param)
    {
        return Args.encodeURLPart(/[^A-Za-z0-9-_\.!~\*'()/:\[\]\^#]/g, param);
    }

    // Encode a URLSearchParams for hash parameters.
    //
    // We can use URLSearchParams.toString(), but that escapes overaggressively and
    // gives us nasty, hard to read URLs.  There's no reason to escape forward slash
    // in query parameters.
    static encodeHashParams(params)
    {
        let values = [];
        for(let key of params.keys())
        {
            let key_values = params.getAll(key);
            for(let value of key_values)
            {
                key = Args.encodeHashParam(key);
                value = Args.encodeHashParam(value);
                values.push(key + "=" + value);
            }
        }

        return values.join("&");
    }

    // Return the args for the current page.
    static get location()
    {
        let result = new this(ppixiv.plocation);

        // Include history state as well.  Make a deep copy, so changing this doesn't
        // modify history.state.
        result.state = JSON.parse(JSON.stringify(ppixiv.phistory.state)) || { };

        return result;
    }

    get url()
    {
        let url = new URL(ppixiv.plocation);
        url.pathname = this.path;
        url.search = this.query.toString();

        // Set the hash portion of url to args, as a ppixiv url.
        //
        // For example, if this.hashPath is "a/b/c" and this.hash is { a: "1", b: "2" },
        // set the hash to #ppixiv/a/b/c?a=1&b=2.
        url.hash = ppixiv.native? "#":"#ppixiv";
        if(this.hashPath != "")
        {
            if(!this.hashPath.startsWith("/"))
                url.hash += "/";
            url.hash += Args.encodeURLHash(this.hashPath);
        }

        let hash_string = Args.encodeHashParams(this.hash);
        if(hash_string != "")
            url.hash += "?" + hash_string;

        return url;
    }

    toString() { return this.url.toString(); }

    // Helpers to get and set arguments which can be in either the query,
    // the hash or the path.  Examples:
    //
    // get("page")        - get the query parameter "page"
    // get("#page")       - get the hash parameter "page"
    // get("/1")          - get the first path parameter
    // set("page", 10)    - set the query parameter "page" to "10"
    // set("#page", 10)   - set the hash parameter "page" to "10"
    // set("/1", 10)      - set the first path parameter to "10"
    // set("page", null)  - remove the query parameter "page"
    get(key)
    {
        let hash = key.startsWith("#");
        let path = key.startsWith("/");
        if(hash || path)
            key = key.substr(1);

        if(path)
            return this.getPathnameSegment(parseInt(key));

        let params = hash? this.hash:this.query;
        return params.get(key);
    }

    set(key, value)
    {
        let hash = key.startsWith("#");
        let path = key.startsWith("/");
        if(hash || path)
            key = key.substr(1);
            
        if(path)
        {
            this.setPathnameSegment(parseInt(key), value);
            return;
        }

        let params = hash? this.hash:this.query;
        if(value != null)
            params.set(key, value);
        else
            params.delete(key);
    }

    // Return the pathname segment with the given index.  If the path is "/abc/def", "abc" is
    // segment 0.  If idx is past the end, return null.
    getPathnameSegment(idx)
    {
        // The first pathname segment is always empty, since the path always starts with a slash.
        idx++;
        let parts = this.path.split("/");
        if(idx >= parts.length)
            return null;

        return decodeURIComponent(parts[idx]);
    }

    // Set the pathname segment with the given index.  If the path is "/abc/def", setting
    // segment 0 to "ghi" results in "/ghi/def".
    //
    // If idx is at the end, a new segment will be added.  If it's more than one beyond the
    // end a warning will be printed, since this usually shouldn't result in pathnames with
    // empty segments.  If value is null, remove the segment instead.
    setPathnameSegment(idx, value)
    {
        idx++;
        let parts = this.path.split("/");
        if(value != null)
        {
            value = encodeURIComponent(value);

            if(idx < parts.length)
                parts[idx] = value;
            else if(idx == parts.length)
                parts.push(value);
            else
                console.warn(`Can't set pathname segment ${idx} to ${value} past the end: ${this.toString()}`);
        } else {
            if(idx == parts.length-1)
                parts.pop();
            else if(idx < parts.length-1)
                console.warn(`Can't remove pathname segment ${idx} in the middle: ${this.toString()}`);
        }

        this.path = parts.join("/");
    }
}
