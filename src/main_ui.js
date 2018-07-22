// Display messages in the popup widget.  This is a singleton.
class message_widget
{
    static get singleton()
    {
        if(message_widget._singleton == null)
            message_widget._singleton = new message_widget();
        return message_widget._singleton;
    }

    constructor()
    {
        this.container = document.body.querySelector(".hover-message");
        this.timer = null;
    }

    show(message)
    {
        this.clear_timer();

        this.container.querySelector(".message").innerHTML = message;

        this.container.classList.add("show");
        setTimeout(function() {
            this.container.classList.remove("show");
        }.bind(this), 3000);
    }

    clear_timer()
    {
        if(this.timer != null)
        {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    hide()
    {
        this.clear_timer();
        this.container.classList.remove("show");
    }
}

class avatar_widget
{
    // options:
    // parent: node to add ourself to (required)
    // changed_callback: called when a follow or unfollow completes
    // big: if true, show the big avatar instead of the small one
    constructor(options)
    {
        this.options = options;
        this.clicked_follow = this.clicked_follow.bind(this);

        this.root = helpers.create_from_template(".template-avatar");
        helpers.set_class(this.root, "big", this.options.big);

        // Show the favorite UI when hovering over the avatar icon.
        var avatar_popup = this.root; //container.querySelector(".avatar-popup");
        avatar_popup.addEventListener("mouseover", function(e) { helpers.set_class(avatar_popup, "popup-visible", true); }.bind(this));
        avatar_popup.addEventListener("mouseout", function(e) { helpers.set_class(avatar_popup, "popup-visible", false); }.bind(this));

        avatar_popup.querySelector(".follow-button.public").addEventListener("click", this.clicked_follow.bind(this, false), false);
        avatar_popup.querySelector(".follow-button.private").addEventListener("click", this.clicked_follow.bind(this, true), false);
        avatar_popup.querySelector(".unfollow-button").addEventListener("click", this.clicked_follow.bind(this, true), false);
        this.element_follow_folder = avatar_popup.querySelector(".folder");

        // Follow publically when enter is pressed on the follow folder input.
        helpers.input_handler(avatar_popup.querySelector(".folder"), this.clicked_follow.bind(this, false));

        this.options.parent.appendChild(this.root);
    }

    set_from_user_data(user_data)
    {
        this.user_data = user_data;

        // We can't tell if we're followed privately or not, only that we're following.
        helpers.set_class(this.root, "followed", this.user_data.isFollowed);

        this.root.querySelector(".avatar-link").href = "/member_illust.php?id=" + user_data.userId;

        // If we don't have an image because we're loaded from a source that doesn't give us them,
        // just hide the avatar image.  Note that this image is low-res even though there's usually
        // a larger version available (grr).
        var element_author_avatar = this.root.querySelector(".avatar");
        var key = this.options.big? "imageBig":"image";
        if(user_data[key])
            element_author_avatar.src = user_data[key];
    }
    
    follow(follow_privately)
    {
        if(this.user_data == null)
            return;

        var username = this.user_data.name;
        var tags = this.element_follow_folder.value;
        helpers.rpc_post_request("/bookmark_add.php", {
            mode: "add",
            type: "user",
            user_id: this.user_data.userId,
            tag: tags,
            restrict: follow_privately? 1:0,
            format: "json",
        }, function(result) {
            if(result == null)
                return;

            // This doesn't return any data.  Record that we're following and refresh the UI.
            this.user_data.isFollowed = true;
            this.set_from_user_data(this.user_data);

            var message = "Followed " + username;
            if(follow_privately)
                message += " privately";
            message_widget.singleton.show(message);
        
            if(this.options.changed_callback)
                this.options.changed_callback();

        }.bind(this));
    }

    unfollow()
    {
        if(this.user_data == null)
            return;

        var username = this.user_data.name;

        helpers.rpc_post_request("/rpc_group_setting.php", {
            mode: "del",
            type: "bookuser",
            id: this.user_data.userId,
        }, function(result) {
            if(result == null)
                return;

            // Record that we're no longer following and refresh the UI.
            this.user_data.isFollowed = false;
            this.set_from_user_data(this.user_data);

            message_widget.singleton.show("Unfollowed " + username);

            if(this.options.changed_callback)
                this.options.changed_callback();
        }.bind(this));
    }

    // Note that in some cases we'll only have the user's ID and name, so we won't be able
    // to tell if we're following.
    clicked_follow(follow_privately, e)
    {
        e.preventDefault();
        e.stopPropagation();

        if(this.user_data == null)
            return;

        if(this.user_data.isFollowed)
        {
            // Unfollow the user.
            this.unfollow();
            return;
        }

        // Follow the user.
        this.follow(follow_privately);
    }
};

// A list of tags, with translations in popups where available.
class tag_widget
{
    // options:
    // parent: node to add ourself to (required)
    // format_link: a function to format a tag to a URL
    constructor(options)
    {
        this.options = options;
        this.container = this.options.parent;
        this.tag_list_container = this.options.parent.appendChild(document.createElement("div"));
        this.tag_list_container.classList.add("tag-list-widget");
    };

    format_tag_link(tag)
    {
        if(this.options.format_link)
            return this.options.format_link(tag);

        var search_url = new URL("/search.php", window.location.href);
        search_url.search = "s_mode=s_tag_full&word=" + tag.tag;
        search_url.hash = "#ppixiv";
        return search_url.toString();
    };

    set(tags)
    {
        // Remove any old tag list and create a new one.
        helpers.remove_elements(this.tag_list_container);

        var tags = tags.tags;
        for(var tag of tags)
        {
            var a = this.tag_list_container.appendChild(document.createElement("a"));
            a.classList.add("tag");
            a.classList.add("box-link");

            // They really can't decide how to store tag translations:
            var popup = null;
            if(tag.translation && tag.translation.en)
                popup = tag.translation.en;
            else if(tag.romaji != null && tag.romaji != "")
                popup = tag.romaji;
            else if(tag.tag_translation != null & tag.tag_translation != "")
                popup = tag.tag_translation;

            var tag_text = tag.tag;

            if(popup && false)
            {
                var swap = tag_text;
                tag_text = popup;
                popup = swap;
            }

            if(popup)
            {
                a.classList.add("popup");
                a.dataset.popup = popup;
            }

            a.dataset.tag = tag_text;
            a.dataset.translatedTag = popup;

            a.textContent = tag_text;

            a.href = this.format_tag_link(tag);
        }

    }
};

// A widget for refreshing bookmark tags.
//
// Pages don't tell us what our bookmark tags are so we can display them.  This
// lets us sync our bookmark tag list with the tags the user has.
class refresh_bookmark_tag_widget
{
    constructor(container)
    {
        this.onclick = this.onclick.bind(this);

        this.container = container;
        this.running = false;
        this.container.addEventListener("click", this.onclick);
    }

    onclick(e)
    {
        if(this.running)
            return;

        this.running = true;
        helpers.set_class(this.container,"spin", this.running);

        helpers.load_data_in_iframe("/bookmark.php", function(document) {
            this.running = false;
            // For some reason, if we disable the spin in this callback, the icon skips
            // for a frame every time (at least in Firefox).  There's no actual processing
            // skip and it doesn't happen if we set the class from a timer.
            setTimeout(function() {
                helpers.set_class(this.container,"spin", this.running);
            }.bind(this), 100);

            var bookmark_tags = [];
            for(var element of document.querySelectorAll("#bookmark_list a[href*='bookmark.php']"))
            {
                var tag = new URL(element.href).searchParams.get("tag");
                if(tag != null)
                    bookmark_tags.push(tag);
            }
            helpers.set_recent_bookmark_tags(bookmark_tags);

            window.dispatchEvent(new Event("bookmark-tags-changed"));
        }.bind(this));
    }
}

// The main UI.  This handles creating the viewers and the global UI.
var main_ui = function(data_source)
{
    if(debug_show_ui) document.body.classList.add("force-ui");

    this.onwheel = this.onwheel.bind(this);
    this.refresh_ui = this.refresh_ui.bind(this);
    this.onkeydown = this.onkeydown.bind(this);
    this.clicked_bookmark = this.clicked_bookmark.bind(this);
    this.clicked_like = this.clicked_like.bind(this);
    this.shown_page_changed = this.shown_page_changed.bind(this);
    this.clicked_download = this.clicked_download.bind(this);
    this.image_data_loaded = this.image_data_loaded.bind(this);
    this.clicked_bookmark_tag_selector = this.clicked_bookmark_tag_selector.bind(this);
    this.refresh_bookmark_tag_highlights = this.refresh_bookmark_tag_highlights.bind(this);
    this.window_onpopstate = this.window_onpopstate.bind(this);
    this.set_image_from_thumbnail = this.set_image_from_thumbnail.bind(this);
    this.toggle_thumbnail_view = this.toggle_thumbnail_view.bind(this);
    this.data_source_updated = this.data_source_updated.bind(this);

    this.current_illust_id = -1;
    this.latest_navigation_direction_down = true;

    this.data_source = data_source;
    this.data_source.add_update_listener(this.data_source_updated);

    window.addEventListener("popstate", this.window_onpopstate);

    document.head.appendChild(document.createElement("title"));
    this.document_icon = document.head.appendChild(document.createElement("link"));
    this.document_icon.setAttribute("rel", "icon");
   
    helpers.add_style('body .noise-background { background-image: url("' + binary_data['noise.png'] + '"); };');
    helpers.add_style('body.light .noise-background { background-image: url("' + binary_data['noise-light.png'] + '"); };');
    helpers.add_style('.ugoira-icon { background-image: url("' + binary_data['play-button.svg'] + '"); };');
    helpers.add_style('.page-icon { background-image: url("' + binary_data['page-icon.png'] + '"); };');
    helpers.add_style('.refresh-icon:after { content: url("' + binary_data['refresh-icon.svg'] + '"); };');
    
    helpers.add_style(resources['main.css']);

    // Create the page.
    this.container = document.body.appendChild(helpers.create_node(resources['main.html']));

    new hide_mouse_cursor_on_idle(this.container.querySelector(".image-container"));

    this.thumbnail_view = new thumbnail_view(this.container.querySelector(".thumbnail-container"), this.set_image_from_thumbnail);
    this.thumbnail_view.set_data_source(this.data_source);

    new refresh_bookmark_tag_widget(this.container.querySelector(".refresh-bookmark-tags"));

    this.avatar_widget = new avatar_widget({
        parent: this.container.querySelector(".avatar-popup"),
        changed_callback: this.refresh_ui,
    });

    // Show the bookmark UI when hovering over the bookmark icon.
    var bookmark_popup = this.container.querySelector(".bookmark-button");
    bookmark_popup.addEventListener("mouseover", function(e) { helpers.set_class(bookmark_popup, "popup-visible", true); }.bind(this));
    bookmark_popup.addEventListener("mouseout", function(e) { helpers.set_class(bookmark_popup, "popup-visible", false); }.bind(this));

    bookmark_popup.querySelector(".heart").addEventListener("click", this.clicked_bookmark.bind(this, false), false);
    bookmark_popup.querySelector(".bookmark-button.public").addEventListener("click", this.clicked_bookmark.bind(this, false), false);
    bookmark_popup.querySelector(".bookmark-button.private").addEventListener("click", this.clicked_bookmark.bind(this, true), false);
    bookmark_popup.querySelector(".unbookmark-button").addEventListener("click", this.clicked_bookmark.bind(this, true), false);
    this.element_bookmark_tag_list = bookmark_popup.querySelector(".bookmark-tag-list");

    // Bookmark publically when enter is pressed on the bookmark tag input.
    helpers.input_handler(bookmark_popup.querySelector(".bookmark-tag-list"), this.clicked_bookmark.bind(this, false));


    bookmark_popup.querySelector(".bookmark-tag-selector").addEventListener("click", this.clicked_bookmark_tag_selector);
    this.element_bookmark_tag_list.addEventListener("input", this.refresh_bookmark_tag_highlights);

    // stopPropagation on mousewheel movement inside the bookmark popup, so we allow the scroller to move
    // rather than changing images.
    bookmark_popup.addEventListener("wheel", function(e) { e.stopPropagation(); });

    this.container.querySelector(".download-button").addEventListener("click", this.clicked_download);
    this.container.querySelector(".show-thumbnails-button").addEventListener("click", this.toggle_thumbnail_view);

    window.addEventListener("bookmark-tags-changed", this.refresh_ui);

    this.element_title = this.container.querySelector(".title");
    this.element_author = this.container.querySelector(".author");
    this.element_bookmarked = this.container.querySelector(".bookmark-button");

    this.element_liked = this.container.querySelector(".like-button");
    this.element_liked.addEventListener("click", this.clicked_like, false);

    this.tag_widget = new tag_widget({
        parent: this.container.querySelector(".tag-list"),
    });
    this.element_tags = this.container.querySelector(".tag-list");
    this.element_comment = this.container.querySelector(".description");

    this.container.addEventListener("wheel", this.onwheel);
    window.addEventListener("keydown", this.onkeydown);

    // A bar showing how far along in an image sequence we are:
    this.manga_page_bar = new progress_bar(this.container.querySelector(".ui-box")).controller();
    this.progress_bar = new progress_bar(this.container.querySelector(".loading-progress-bar"));
    this.seek_bar = new seek_bar(this.container.querySelector(".ugoira-seek-bar"));

    helpers.add_clicks_to_search_history(document.body);
    this.refresh_ui();
    
    // Load the initial state.
    this.load_current_state();
}

main_ui.prototype.download_types = ["image", "ZIP", "MKV"];

main_ui.prototype.window_onpopstate = function(e)
{
    // The URL changed, eg. because the user navigated, so load the new state.
    console.log("History state changed");
    this.load_current_state();
}

main_ui.prototype.load_current_state = function()
{
    this.data_source.load_from_current_state(function() {
        // Don't load the default image if the thumbnail view is enabled.
        if(this.thumbnail_view.enabled)
            return;

        // Show the default image.
        var show_illust_id = this.data_source.get_default_illust_id();
        console.log("Showing initial image", show_illust_id);
        this.show_image(show_illust_id);
    }.bind(this));

    this.refresh_ui();
}

// This is called when the user clicks a thumbnail in the thumbnail view to display it.
//
// Normally when we go from one image to another, we leave the previous image viewer in
// place until we have image data for the new image, so we don't flash a black screen.
// That looks ugly when coming from the thumbnail list, since we show whatever previous
// image was being viewed briefly.  Instead, remove the viewer immediately.
main_ui.prototype.set_image_from_thumbnail = function(illust_id)
{
    this.stop_displaying_image();
    
    // Add this to history, since we want browser back to go back to the thumbnails.
    this.show_image(illust_id, false, true /* do add to history */);
}

// Show an image.
//
// If the illustration has multiple pages and show_last_page is true, show the last page
// instead of the first.  This is used when navigating backwards.
//
// If add_to_history is true, we're loading an image because the user navigated to it (eg.
// pressing pgdn), so we should add it to history.  If it's false, we're loading it because
// the history state was changed (eg. browser back), so we shouldn't add a new state.
main_ui.prototype.show_image = function(illust_id, show_last_page, add_to_history)
{
    this.cancel_async_navigation();
    
    // Remember that this is the image we want to be displaying.
    this.wanted_illust_id = illust_id;
    this.wanted_illust_last_page = show_last_page;

    // Tell the preloader about the current image.
    image_preloader.singleton.set_current_image(illust_id);

    // Update the address bar with the new image.
    this.data_source.set_current_illust_id(illust_id, add_to_history);

    // Load info for this image if needed.
    image_data.singleton().get_image_info(illust_id, this.image_data_loaded);
}

// If we started navigating to a new image and were delayed to load data (either to load
// the image or to load a new page), cancel it and stay where we are.
main_ui.prototype.cancel_async_navigation = function()
{
    // If we previously set a pending navigation, this navigation overrides it.
    this.pending_navigation = null;

    // If show_image started loading a new image, unset it.  If add_to_history was
    // true, we won't remove the history entry.
    this.wanted_illust_id = this.current_illust_id;
    if(this.current_illust_id != -1)
        this.data_source.set_current_illust_id(this.current_illust_id, false);
}


// Stop displaying any image (and cancel any wanted navigation), putting us back
// to where we were before displaying any images.
//
// This will also prevent the next image displayed from triggering speculative
// loading, which we don't want to do when clicking an image in the thumbnail
// view.
main_ui.prototype.stop_displaying_image = function()
{
    if(this.viewer != null)
    {
        this.viewer.shutdown();
        this.viewer = null;
    }

    this.wanted_illust_id = null;
    this.wanted_illust_last_page = null;
    this.current_illust_id = -1;
    this.refresh_ui();
}

main_ui.prototype.image_data_loaded = function(illust_data)
{
    var illust_id = illust_data.illustId;

    // If this isn't image data for the image we want to be showing, ignore it.
    if(this.wanted_illust_id != illust_id)
        return;

    console.log("Showing image", illust_id);
    
    var want_last_page = this.wanted_illust_last_page;

    // If true, this is the first image we're displaying.
    var first_image_displayed = this.current_illust_id == -1;

    this.wanted_illust_id = null;
    this.wanted_illust_last_page = null;

    if(illust_id == this.current_illust_id)
    {
        console.log("Image ID not changed");
        return;
    }

    // Speculatively load the next image, which is what we'll show if you press page down, so
    // advancing through images is smoother.
    //
    // We don't do this when showing the first image, since the most common case is simply
    // viewing a single image and not navigating to any others, so this avoids making
    // speculative loads every time you load a single illustration.
    if(!first_image_displayed)
    {
        // Let image_preloader handle speculative loading.  If preload_illust_id is null,
        // we're telling it that we don't need to load anything.
        var preload_illust_id = this.data_source.id_list.get_neighboring_illust_id(illust_id, this.latest_navigation_direction_down);
        image_preloader.singleton.set_speculative_image(preload_illust_id);
    }

    this.current_illust_id = illust_id;
    this.current_illust_data = illust_data;

    this.refresh_ui();

    var illust_data = this.current_illust_data;
    
    // If the image has the ドット絵 tag, enable nearest neighbor filtering.
    helpers.set_class(document.body, "dot", helpers.tags_contain_dot(illust_data));

    // Dismiss any message when changing images.
    message_widget.singleton.hide();
   
    // If we're showing something else, remove it.
    if(this.viewer != null)
    {
        this.viewer.shutdown();
        this.viewer = null;
    }

    this.manga_page_bar.set(null);

    var image_container = this.container.querySelector(".image-container");

    // Check if this image is muted.
    var muted_tag = main.any_tag_muted(illust_data.tags.tags);
    var muted_user = main.is_muted_user_id(illust_data.userId);
    if(muted_tag || muted_user)
    {
        this.viewer = new viewer_muted(image_container, illust_data);
        return;
    }
 
    // Create the image viewer.
    var progress_bar = this.progress_bar.controller();
    if(illust_data.illustType == 2)
        this.viewer = new viewer_ugoira(image_container, illust_data, this.seek_bar, function(value) {
            progress_bar.set(value);
        }.bind(this));
    else
    {
        this.viewer = new viewer_images(image_container, illust_data, {
            page_changed: this.shown_page_changed,
            progress_bar: progress_bar,
            manga_page_bar: this.manga_page_bar,
            show_last_image: want_last_page,
        });
    }
}

// This is called when the page of a multi-page illustration sequence changes.
main_ui.prototype.shown_page_changed = function(page, total_pages, url)
{
    this.cancel_async_navigation();
}

main_ui.prototype.data_source_updated = function()
{
    this.refresh_ui();
}

// Refresh the UI for the current image.
main_ui.prototype.refresh_ui = function()
{
    // Don't refresh if the thumbnail view is active.  We're not visible, and we'll just
    // step over its page title, etc.
    if(this.thumbnail_view.enabled)
        return;
    
    // Pull out info about the user and illustration.
    var illust_id = this.current_illust_id;

    // Update the disable UI button to point at the current image's illustration page.
    var disable_button = this.container.querySelector(".disable-ui-button");
    disable_button.href = "/member_illust.php?mode=medium&illust_id=" + illust_id + "#no-ppixiv";

    // If we're not showing an image yet, hide the UI and don't try to update it.
    helpers.set_class(this.container.querySelector(".ui"), "disabled", illust_id == -1);
    if(illust_id == -1)
    {
        helpers.set_page_title("Loading...");
        return;
    }

    var illust_data = this.current_illust_data;
    var user_data = illust_data.userInfo;

    var page_title = "";
    if(illust_data.bookmarkData)
        page_title += "★";
    page_title += user_data.name + " - " + illust_data.illustTitle;
    helpers.set_page_title(page_title);

    helpers.set_page_icon(user_data.isFollowed? binary_data['favorited_icon.png']:binary_data['regular_pixiv_icon.png']);

    // Show the author if it's someone else's post, or the edit link if it's ours.
    var our_post = global_data.user_id == user_data.userId;
    this.container.querySelector(".author-block").hidden = our_post;
    this.container.querySelector(".edit-post").hidden = !our_post;
    this.container.querySelector(".edit-post").href = "/member_illust_mod.php?mode=mod&illust_id=" + illust_id;

    this.avatar_widget.set_from_user_data(user_data);

    // Set the popup for the thumbnails button based on the label of the data source.
    this.container.querySelector(".show-thumbnails-button").dataset.popup = this.data_source.get_displaying_text();

    this.element_author.textContent = user_data.name;
    this.element_author.href = "/member_illust.php?id=" + user_data.userId;

    this.container.querySelector(".similar-illusts-button").href = "/bookmark_detail.php?illust_id=" + illust_id + "#ppixiv";

    this.element_title.textContent = illust_data.illustTitle;
    this.element_title.href = "/member_illust.php?mode=medium&illust_id=" + illust_id;

    // Fill in the post info text.
    var set_info = function(query, text)
    {
        var node = this.container.querySelector(query);
        node.innerText = text;
        node.hidden = text == "";
    }.bind(this);

    var seconds_old = (new Date() - new Date(illust_data.createDate)) / 1000;
    set_info(".post-info > .post-age", helpers.age_to_string(seconds_old) + " ago");

    var info = "";
    if(illust_data.illustType != 2 && illust_data.pageCount == 1)
    {
        // Add the resolution and file type for single images.
        var ext = helpers.get_extension(illust_data.urls.original).toUpperCase();
        info += illust_data.width + "x" + illust_data.height + " " + ext;
    }
    set_info(".post-info > .image-info", info);

    var duration = "";
    if(illust_data.illustType == 2)
    {
        var seconds = 0;
        for(var frame of illust_data.ugoiraMetadata.frames)
            seconds += frame.delay / 1000;

        var duration = seconds.toFixed(duration >= 10? 0:1);
        duration += seconds == 1? " second":" seconds";
    }
    set_info(".post-info > .ugoira-duration", duration);
    set_info(".post-info > .ugoira-frames", illust_data.illustType == 2? (illust_data.ugoiraMetadata.frames.length + " frames"):"");

    // Add the page count for manga.
    set_info(".post-info > .page-count", illust_data.pageCount == 1? "":(illust_data.pageCount + " pages"));

    // The comment (description) can contain HTML.
    this.element_comment.hidden = illust_data.illustComment == "";
    this.element_comment.innerHTML = illust_data.illustComment;
    helpers.fix_pixiv_links(this.element_comment);

    // Set the download button popup text.
    var download_type = this.get_download_type_for_image();
    var download_button = this.container.querySelector(".download-button");
    download_button.hidden = download_type == null;
    if(download_type != null)
        download_button.dataset.popup = "Download " + download_type;

    helpers.set_class(document.body, "bookmarked", illust_data.bookmarkData);

    helpers.set_class(this.element_bookmarked, "bookmarked-public", illust_data.bookmarkData && !illust_data.bookmarkData.private);
    helpers.set_class(this.element_bookmarked, "bookmarked-private", illust_data.bookmarkData && illust_data.bookmarkData.private);
    helpers.set_class(this.element_liked, "liked", illust_data.likeData);
    this.element_liked.dataset.popup = illust_data.likeCount + " likes";
    this.element_bookmarked.querySelector(".popup").dataset.popup = illust_data.bookmarkCount + " bookmarks";

    this.tag_widget.set(illust_data.tags);

    this.refresh_bookmark_tag_list();
}

main_ui.prototype.is_download_type_available = function(download_type)
{
    var illust_data = this.current_illust_data;
    
    // Single image downloading only works for single images.
    if(download_type == "image")
        return illust_data.illustType != 2 && illust_data.pageCount == 1;

    // ZIP downloading only makes sense for image sequences.
    if(download_type == "ZIP")
        return illust_data.illustType != 2 && illust_data.pageCount > 1;

    // MJPEG only makes sense for videos.
    if(download_type == "MKV")
    {
        if(illust_data.illustType != 2)
            return false;

        // All of these seem to be JPEGs, but if any are PNG, disable MJPEG exporting.
        // We could encode to JPEG, but if there are PNGs we should probably add support
        // for APNG.
        if(illust_data.ugoiraMetadata.mime_type != "image/jpeg")
            return false;

        return true;
    }
    throw "Unknown download type " + download_type;
};

main_ui.prototype.get_download_type_for_image = function()
{
    for(var i = 0; i < this.download_types.length; ++i)
    {
        var type = this.download_types[i];
        if(this.is_download_type_available(type))
            return type;
    }

    return null;
}

main_ui.prototype.onwheel = function(e)
{
    // Don't intercept wheel scrolling over the description box.
    if(e.target == this.element_comment)
        return;

    // Let the viewer handle the input first.
    if(this.viewer && this.viewer.onwheel)
    {
        this.viewer.onwheel(e);
        if(e.defaultPrevented)
            return;
    }


    var down = e.deltaY > 0;
    this.move(down);
}

main_ui.prototype.onkeydown = function(e)
{
    if(e.keyCode == 27) // escape
    {
        e.preventDefault();
        e.stopPropagation();

        this.toggle_thumbnail_view();

        return;
    }

    // Don't handle image viewer shortcuts when the thumbnail view is open on top of it.
    if(this.thumbnail_view.enabled)
        return;
    
    // Let the viewer handle the input first.
    if(this.viewer && this.viewer.onkeydown)
    {
        this.viewer.onkeydown(e);
        if(e.defaultPrevented)
            return;
    }

    if(e.keyCode == 66) // b
    {
        // b to bookmark publically, B to bookmark privately, ^B to remove a bookmark.
        //
        // Use a separate hotkey to remove bookmarks, rather than toggling like the bookmark
        // button does, so you don't have to check whether an image is bookmarked.  You can
        // just press B to bookmark without worrying about accidentally removing a bookmark
        // instead.
        e.stopPropagation();
        e.preventDefault();

        var illust_id = this.current_illust_id;
        var illust_data = this.current_illust_data;

        if(e.ctrlKey)
        {
            // Remove the bookmark.
            if(illust_data.bookmarkData == null)
            {
                message_widget.singleton.show("Image isn't bookmarked");
                return;
            }

            this.bookmark_remove();
            return;
        }

        if(illust_data.bookmarkData)
        {
            message_widget.singleton.show("Already bookmarked (^B to remove bookmark)");
            return;
        }
        
        this.bookmark_add(e.shiftKey);
        return;
    }

    if(e.keyCode == 70) // f
    {
        // f to follow publically, F to follow privately, ^F to unfollow.
        e.stopPropagation();
        e.preventDefault();

        var illust_data = this.current_illust_data;
        if(illust_data == null)
            return;

        var user_data = illust_data.userInfo.isFollowed;
        if(e.ctrlKey)
        {
            // Remove the bookmark.
            if(!illust_data.userInfo.isFollowed)
            {
                message_widget.singleton.show("Not following this user");
                return;
            }

            this.avatar_widget.unfollow();
            return;
        }

        if(illust_data.userInfo.isFollowed)
        {
            message_widget.singleton.show("Already following (^F to unfollow)");
            return;
        }
        
        this.avatar_widget.follow(e.shiftKey);
        return;
    }
    
    if(e.ctrlKey || e.altKey)
        return;

    switch(e.keyCode)
    {
    case 66: // b

    case 86: // l
        e.stopPropagation();
        this.clicked_like(e);
        return;

    case 33: // pgup
        e.preventDefault();
        e.stopPropagation();

        this.move(false);
        break;

    case 34: // pgdn
        e.preventDefault();
        e.stopPropagation();

        this.move(true);
        break;
    }
}

main_ui.prototype.toggle_thumbnail_view = function()
{
    this.thumbnail_view.set_enabled(!this.thumbnail_view.enabled, true);

    // Scroll to the current illustration.
    if(this.current_illust_id != -1 && this.thumbnail_view.enabled)
        this.thumbnail_view.scroll_to_illust_id(this.current_illust_id);

    // If we started in the thumbnail view, we didn't load any image, so make sure we
    // display something now.
    if(!this.thumbnail_view.enabled)
        this.load_current_state();

    // If we're enabling the thumbnail, pulse the image that was just being viewed (or
    // loading to be viewed), to
    // make it easier to find your place.
    if(this.thumbnail_view.enabled)
    {
        if(this.current_illust_id != -1)
            this.thumbnail_view.pulse_thumbnail(this.current_illust_id);
        else if(this.wanted_illust_id != -1)
            this.thumbnail_view.pulse_thumbnail(this.wanted_illust_id);
    }
}

main_ui.prototype.move = function(down)
{
    // Remember whether we're navigating forwards or backwards, for preloading.
    this.latest_navigation_direction_down = down;

    this.cancel_async_navigation();

    // Get the next (or previous) illustration after the current one.
    var new_illust_id = this.data_source.id_list.get_neighboring_illust_id(this.current_illust_id, down);
    if(new_illust_id == null)
    {
        // That page isn't loaded.  Try to load it.
        var next_page = this.data_source.id_list.get_page_for_neighboring_illust(this.current_illust_id, down);

        if(next_page == null)
        {
            // We should normally know which page the illustration we're currently viewing is on.
            console.warn("Don't know the next page for illust", this.current_illust_id);
            return;
        }

        console.log("Loading the next page of results:", next_page);

        // The page shouldn't already be loaded.  Double-check to help prevent bugs that might
        // spam the server requesting the same page over and over.
        if(this.data_source.id_list.is_page_loaded(next_page))
        {
            console.error("Page", next_page, "is already loaded");
            return;
        }

        // Ask the data source to load it.
        var pending_navigation = function()
        {
            // If this.pending_navigation is no longer set to this function, we navigated since
            // we requested this load and this navigation is stale, so stop.
            if(this.pending_navigation != pending_navigation)
            {
                console.log("Aborting stale navigation");
                return;
            }

            this.pending_navigation = null;

            // If we do have an image displayed, navigate up or down based on our most recent navigation
            // direction.  This simply retries the navigation now that we have data.
            console.log("Retrying navigation after data load");
            this.move(down);

        }.bind(this);
        this.pending_navigation = pending_navigation;

        if(!this.data_source.load_page(next_page, this.pending_navigation))
        {
            console.log("Reached the end of the list");
            return false;
        }

        return true;
    }

    // Show the new image.  If we're navigating up and there are multiple pages, show
    // the last page instead of the first.
    //
    // We could add to history here, but we don't since it ends up creating way too
    // many history states.
    var show_last_page = !down;
    this.show_image(new_illust_id, show_last_page, false /* don't add to history */);
    return true;
}

main_ui.prototype.clicked_download = function(e)
{
    var clicked_button = e.target.closest(".download-button");
    if(clicked_button == null)
        return;

    e.preventDefault();
    e.stopPropagation();

    var illust_data = this.current_illust_data;

    var download_type = this.get_download_type_for_image();
    if(download_type == null)
    {
        console.error("No download types are available");
        retunr;
    }

    console.log("Download", this.current_illust_id, "with type", download_type);

    if(download_type == "MKV")
    {
        new ugoira_downloader_mjpeg(illust_data, this.progress_bar.controller());
        return;
    }

    if(download_type != "image" && download_type != "ZIP")
    {
        console.error("Unknown download type " + download_type);
        return;
    }

    // Download all images.
    var images = [];
    for(var page = 0; page < illust_data.pageCount; ++page)
        images.push(helpers.get_url_for_page(illust_data, page, "original"));

    var user_data = illust_data.userInfo;
    helpers.download_urls(images, function(results) {
        // If there's just one image, save it directly.
        if(images.length == 1)
        {
            var url = images[0];
            var buf = results[0];
            var blob = new Blob([results[0]]);
            var ext = helpers.get_extension(url);
            var filename = user_data.name + " - " + illust_data.illustId + " - " + illust_data.illustTitle + "." + ext;
            helpers.save_blob(blob, filename);
            return;
        }

        // There are multiple images, and since browsers are stuck in their own little world, there's
        // still no way in 2018 to save a batch of files to disk, so ZIP the images.
        console.log(results);
   
        var filenames = [];
        for(var i = 0; i < images.length; ++i)
        {
            var url = images[i];
            var blob = results[i];

            var ext = helpers.get_extension(url);
            var filename = i.toString().padStart(3, '0') + "." + ext;
            filenames.push(filename);
        }

        // Create the ZIP.
        var zip = new create_zip(filenames, results);
        var filename = user_data.name + " - " + illust_data.illustId + " - " + illust_data.illustTitle + ".zip";
        helpers.save_blob(zip, filename);
    }.bind(this));
    return;
}

main_ui.prototype.clicked_bookmark = function(private_bookmark, e)
{
    e.preventDefault();
    e.stopPropagation();

    var illust_id = this.current_illust_id;
    var illust_data = this.current_illust_data;
    if(illust_data.bookmarkData)
    {
        // The illustration is already bookmarked, so remove the bookmark.
        this.bookmark_remove();
        return;
    }

    // Add a new bookmark.
    this.bookmark_add(private_bookmark);
}

main_ui.prototype.bookmark_add = function(private_bookmark)
{
    var illust_id = this.current_illust_id;
    var illust_data = this.current_illust_data;

    var input_list = this.element_bookmarked.querySelector(".bookmark-tag-list");
    var tags = this.element_bookmark_tag_list.value;
    var tag_list = tags == ""? []:tags.split(" ");

    helpers.update_recent_bookmark_tags(tag_list);

    helpers.post_request("/ajax/illusts/bookmarks/add", {
        "illust_id": illust_id,
        "tags": tag_list,
        "comment": "",
        "restrict": private_bookmark? 1:0,
    }, function(result) {
        if(result == null || result.error)
            return;

        // Clear the tag list after saving a bookmark.  Otherwise, it's too easy to set a tag for one
        // image, then forget to unset it later.
        this.element_bookmark_tag_list.value = null;

        // last_bookmark_id seems to be the ID of the new bookmark.  We need to store this correctly
        // so the unbookmark button works.
        console.log("New bookmark id:", result.body.last_bookmark_id, illust_id);

        illust_data.bookmarkData = {
            "id": result.body.last_bookmark_id,
            "private": private_bookmark,
        }

        illust_data.bookmarkCount++;

        // Refresh the UI if we're still on the same post.
        if(this.current_illust_id == illust_id)
            this.refresh_ui();

        message_widget.singleton.show(private_bookmark? "Bookmarked privately":"Bookmarked");
    }.bind(this));
}

main_ui.prototype.bookmark_remove = function()
{
    var illust_id = this.current_illust_id;
    var illust_data = this.current_illust_data;
    var bookmark_id = illust_data.bookmarkData.id;
    console.log("Remove bookmark", bookmark_id);

    helpers.rpc_post_request("/rpc/index.php", {
        mode: "delete_illust_bookmark",
        bookmark_id: bookmark_id,
    }, function(result) {
        if(result == null || result.error)
            return;

        console.log("Removing bookmark finished");
        illust_data.bookmarkData = false;
        illust_data.bookmarkCount--;

        message_widget.singleton.show("Bookmark removed");

        // Refresh the UI if we're still on the same post.
        if(this.current_illust_id == illust_id)
            this.refresh_ui();
    }.bind(this));
}

// Refresh the list of recent bookmark tags.
main_ui.prototype.refresh_bookmark_tag_list = function()
{
    var bookmark_tags = this.container.querySelector(".bookmark-tag-selector");
    helpers.remove_elements(bookmark_tags);

    var recent_bookmark_tags = helpers.get_recent_bookmark_tags();
    recent_bookmark_tags.sort();
    for(var i = 0; i < recent_bookmark_tags.length; ++i)
    {
        var tag = recent_bookmark_tags[i];
        var entry = helpers.create_from_template(".template-bookmark-tag-entry");
        entry.dataset.tag = tag;
        bookmark_tags.appendChild(entry);
        entry.querySelector(".tag-name").innerText = tag;
    }

    this.refresh_bookmark_tag_highlights();
}

// Update which tags are highlighted in the bookmark tag list.
main_ui.prototype.refresh_bookmark_tag_highlights = function()
{
    var bookmark_tags = this.container.querySelector(".bookmark-tag-selector");
    
    var tags = this.element_bookmark_tag_list.value;
    var tags = tags.split(" ");
    var tag_entries = bookmark_tags.querySelectorAll(".bookmark-tag-entry");
    for(var i = 0; i < tag_entries.length; ++i)
    {
        var entry = tag_entries[i];
        var tag = entry.dataset.tag;
        var highlight_entry = tags.indexOf(tag) != -1;
        helpers.set_class(entry, "enabled", highlight_entry);
    }
}

main_ui.prototype.clicked_bookmark_tag_selector = function(e)
{
    var clicked_tag_entry = e.target.closest(".bookmark-tag-entry");
    var tag = clicked_tag_entry.dataset.tag;

    var clicked_remove = e.target.closest(".remove");
    if(clicked_remove)
    {
        // Remove the clicked tag from the recent list.
        e.preventDefault();
        e.stopPropagation();

        var recent_bookmark_tags = helpers.get_recent_bookmark_tags();
        var idx = recent_bookmark_tags.indexOf(tag);
        if(idx != -1)
            recent_bookmark_tags.splice(idx, 1);
        helpers.set_recent_bookmark_tags(recent_bookmark_tags);
        this.refresh_bookmark_tag_list();
        return;
    }

    // Toggle the clicked tag.
    var tags = this.element_bookmark_tag_list.value;
    var tags = tags == ""? []:tags.split(" ");
    var idx = tags.indexOf(tag);
    if(idx != -1)
    {
        // Remove this tag from the list.
        tags.splice(idx, 1);
    }
    else
    {
        // Add this tag to the list.
        tags.push(tag);
    }

    this.element_bookmark_tag_list.value = tags.join(" ");
    this.refresh_bookmark_tag_highlights();
}

main_ui.prototype.clicked_like = function(e)
{
    e.preventDefault();
    e.stopPropagation();

    var illust_id = this.current_illust_id;
    console.log("Clicked like on", illust_id);

    var illust_data = this.current_illust_data;
    if(illust_data.likeData)
    {
        message_widget.singleton.show("Already liked this image");
        return;
    }
    
    helpers.post_request("/ajax/illusts/like", {
        "illust_id": illust_id,
    }, function() {
        // Update the data (even if it's no longer being viewed).
        illust_data.likeData = true;
        illust_data.likeCount++;

        // Refresh the UI if we're still on the same post.
        if(this.current_illust_id == illust_id)
            this.refresh_ui();

        message_widget.singleton.show("Illustration liked");
    }.bind(this));
}
