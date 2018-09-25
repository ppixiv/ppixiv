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
        this.container.classList.remove("centered");
        this.timer = setTimeout(function() {
            this.container.classList.remove("show");
        }.bind(this), 3000);
    }

    // Center the current message instead of showing it at the bottom.
    center()
    {
        this.container.classList.add("centered");
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

        var is_us = user_data.userId == global_data.user_id;
        this.root.hidden = is_us;
        if(is_us)
            return;

        // We can't tell if we're followed privately or not, only that we're following.
        helpers.set_class(this.root, "followed", this.user_data.isFollowed);

        this.root.querySelector(".avatar-link").href = "/member_illust.php?id=" + user_data.userId + "#ppixiv";

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

