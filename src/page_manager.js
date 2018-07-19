// This handles:
//
// - Keeping track of whether we're active or not.  If we're inactive, we turn off
// and let the page run normally.
// - Storing state in the address bar.
//
// We're active by default on illustration pages, and inactive by default on others.
//
// If we're active, we'll store our state in the hash as "#ppixiv/...".  The start of
// the hash will always be "#ppixiv", so we can tell it's our data.  If we're on a page
// where we're inactive by default, this also remembers that we've been activated.
//
// If we're inactive on a page where we're active by default, we'll always put something
// other than "#ppixiv" in the address bar.  It doesn't matter what it is.  This remembers
// that we were deactivated, and remains deactivated even if the user clicks an anchor
// in the page that changes the hash.
//
// If we become active or inactive after the page loads, we refresh the page.
//
// We have two sets of query parameters: args stored in the URL query, and args stored in
// the hash.  For example, in:
//
// https://www.pixiv.net/bookmark.php?p=2#ppixiv?illust_id=1234
//
// our query args are p=2, and our hash args are illust_id=1234.  We use query args to
// store state that exists in the underlying page, and hash args to store state that
// doesn't, so the URL remains valid for the actual Pixiv page if our UI is turned off.

class page_manager
{
    constructor()
    {
        this.window_popstate = this.window_popstate.bind(this);
        window.addEventListener("popstate", this.window_popstate, true);

        this.active = this._active_internal();
    };

    // Return the singleton, creating it if needed.
    static singleton()
    {
        if(page_manager._singleton == null)
            page_manager._singleton = new page_manager();
        return page_manager._singleton;
    };

    // Disable us, reloading the page to display it normally.
    disable()
    {
        document.location.hash = "no-ppixiv";
    };

    // Enable us, reloading the page if needed.
    enable()
    {
        document.location.hash = "ppixiv";
    };

    // Return the data source for a URL, or null if the page isn't supported.
    get_data_source_for_url(url)
    {
        // url is usually document.location, which for some reason doesn't have .searchParams.
        var url = new unsafeWindow.URL(url);

        // Note that member_illust.php is both illustration pages (mode=medium&illust_id) and author pages (id=).
        if(url.pathname == "/member_illust.php" && url.searchParams.get("mode") == "medium")
            return data_source_current_illust;
        if(url.pathname == "/member_illust.php" && url.searchParams.get("id") != null)
            return data_source_artist;
        else if(url.pathname == "/bookmark.php" && url.searchParams.get("type") == null)
            return data_source_bookmarks;
        else if(url.pathname == "/new_illust.php" || url.pathname == "/new_illust_r18.php")
            return data_source_new_illust;
        else if(url.pathname == "/bookmark_new_illust.php")
            return data_source_bookmarks_new_illust;
        else if(url.pathname == "/search.php")
            return data_source_search;
        else if(url.pathname == "/discovery")
            return data_source_discovery;
        else if(url.pathname == "/bookmark_detail.php")
            return data_source_related_illusts;
        else if(url.pathname == "/ranking.php")
            return data_source_rankings;
        else
            return null;
    };

    // Return true if it's possible for us to be active on this page.
    available()
    {
        // We support the page if it has a data source.
        return this.get_data_source_for_url(document.location) != null;
    };

    window_popstate(e)
    {
        var currently_active = this._active_internal();
        if(this.active != currently_active)
        {
            // Stop propagation, so other listeners don't see this.  For example, this prevents
            // the thumbnail viewer from turning on or off as a result of us changing the hash
            // to "#no-ppixiv".
            e.stopImmediatePropagation();

            console.log("Active state changed");

            // The URL has changed and caused us to want to activate or deactivate.  Reload the
            // page.
            //
            // We'd prefer to reload with cache, like a regular navigation, but Firefox seems
            // to reload without cache no matter what we do, even though document.location.reload
            // is only supposed to bypass cache on reload(true).  There doesn't seem to be any
            // reliable workaround.
            document.location.reload();
        }
    };

    // Return true if we're active by default on the current page.
    active_by_default()
    {
        return this.available();
    };

    // Return true if we're currently active.
    //
    // This is cached at the start of the page and doesn't change unless the page is reloaded.
    _active_internal()
    {
        // If the hash is empty, use the default.
        if(document.location.hash == "")
            return this.active_by_default();

        // If we have a hash and it's not #ppixiv, then we're explicitly disabled.  If we
        // # do have a #ppixiv hash, we're explicitly enabled.
        return this.parse_hash() != null;
    };

    // Parse our data out of the hash, returning a URL.  If the hash isn't one of ours,
    // return null.
    parse_hash()
    {
        var ppixiv_url = document.location.hash.startsWith("#ppixiv");
        if(!ppixiv_url)
            return null;

        // Parse the hash of the current page as a path.  For example, if
        // the hash is #ppixiv/foo/bar?baz, parse it as /ppixiv/foo/bar?baz.
        var adjusted_url = document.location.hash.replace(/#/, "/");
        return new URL(adjusted_url, window.location);
    };

    // Get the arguments stored in the URL hash.
    get_hash_args()
    {
        var url = this.parse_hash();
        if(url == null)
            return new unsafeWindow.URLSearchParams();

        var query = url.search;
        if(!query.startsWith("?"))
            return new unsafeWindow.URLSearchParams();

        query = query.substr(1);

        // Use unsafeWindow.URLSearchParams to work around https://bugzilla.mozilla.org/show_bug.cgi?id=1414602.
        var params = new unsafeWindow.URLSearchParams(query);
        return params;
    };

    // Get the arguments stored in the URL query.
    get_query_args()
    {
        // Why is there no searchParams on document.location?
        return new unsafeWindow.URL(document.location).searchParams;
    }

    // Update the URL.  If add_to_history is true, add a new history state.  Otherwise,
    // replace the current one.
    set_args(query_params, hash_params, add_to_history)
    {
        var url = new URL(document.location);
        url.search = query_params.toString();
        url.hash = "#ppixiv";
        var hash_string = hash_params.toString();
        if(hash_string != "")
            url.hash += "?" + hash_string;

        // console.log("Changing state to", url.toString());
        if(add_to_history)
            history.pushState(null, "", url.toString());
        else
            history.replaceState(null, "", url.toString());
    }

    // Given a list of tags, return the URL to use to search for them.  This differs
    // depending on the current page.
    get_url_for_tag_search(tags)
    {
        var url = new URL(document.location);

        if(url.pathname == "/search.php")
        {
            // If we're on search already, preserve other settings so we just change the
            // search tag.  Just remove the page number.
            url.searchParams.delete("p");
        } else {
            // If we're not, change to search and remove the rest of the URL.
            url = new URL("/search.php#ppixiv", document.location);
        }
        
        url.searchParams.set("word", tags);
        return url;
    }
}

