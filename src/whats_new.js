// This should be inside whats_new, but Firefox is in the dark ages and doesn't support class fields.
let _update_history = [
    {
        version: 79,
        text:
            "Added support for viewing new R-18 works by followed users."
    },
    {
        version: 77,
        text:
            "Added user searching." +
            "<p>" +
            "Commercial/subscription links in user profiles (Fanbox, etc.) now use a different icon."
    },
    {
        version: 74,
        text:
            "Viewing your followed users by tag is now supported." +
            "<p>" +
            "You can now view other people who bookmarked an image, to see what else they've bookmarked. " +
            "This is available from the top-left hover menu."
    },
    {
        version: 72,
        text:
            "The followed users page now remembers which page you were on if you reload the page, to make " +
            "it easier to browse your follows if you have a lot of them." +
            "<p>" +
            "Returning to followed users now flashes who you were viewing like illustrations do," +
            "to make it easier to pick up where you left off." +
            "<p>" +
            "Added a browser back button to the context menu, to make navigation easier in fullscreen " +
            "when the browser back button isn't available."
    },
    {
        version: 68,
        text:
            "You can now go to either the first manga page or the page list from search results. " +
            "Click the image to go to the first page, or the page count to go to the page list." +
            "<p>" +
            "Our button is now in the bottom-left when we're disabled, since Pixiv now puts a menu " +
            "button in the top-left and we were covering it up."
    },
    {
        version: 65,
        text:
            "Bookmark viewing now remembers which page you were on if the page is reloaded." +
            "<p>"+
            "Zooming is now in smaller increments, to make it easier to zoom to the level you want."
    },
    {
        version: 57,
        text:
            "Search for similar artists.  Click the recommendations item at the top of the artist page, " +
            "or in the top-left when viewing an image." +
            "<p>"+
            "You can also now view suggested artists."
    },
    {
        version: 56,
        text:
            "Tag translations are now supported.  This can be turned off in preferences. " +
            "<p>" +
            "Added quick tag search editing.  After searching for a tag, click the edit button " +
            "to quickly add and remove tags."
    },
    {
        version: 55,
        text:
            "The \"original\" view is now available in Rankings." +
            "<p>" +
            "Hiding the mouse cursor can now be disabled in preferences.",
    },
    {
        version: 49,
        text:
            "Add \"Hover to show UI\" preference, which is useful for low-res monitors."
    },
    {
        version: 47,
        text:
            "You can now view the users you're following with \"Followed Users\".  This shows each " +
            "user's most recent post."
    },
];

class whats_new
{
    // Return the newest revision that exists in history.  This is always the first
    // history entry.
    static latest_history_revision()
    {
        return _update_history[0].version;
    }

    constructor(container)
    {
        this.container = container;

        this.refresh();

        this.container.querySelector(".close-button").addEventListener("click", (e) => { this.hide(); });

        // Close if the container is clicked, but not if something inside the container is clicked.
        this.container.addEventListener("click", (e) => {
            if(e.target != this.container)
                return;

            this.hide();
        });

        // Hide on any state change.
        window.addEventListener("popstate", (e) => {
            this.hide();
        });                

        this.show();
    }

    refresh()
    {
        let items_box = this.container.querySelector(".items");

        // Not really needed, since our contents never change
        helpers.remove_elements(items_box);

        let item_template = document.body.querySelector(".template-version-history-item");
        for(let update of _update_history)
        {
            let entry = helpers.create_from_template(item_template);
            entry.querySelector(".rev").innerText = "r" + update.version;
            entry.querySelector(".text").innerHTML = update.text;
            items_box.appendChild(entry);
        }
    }

    show()
    {
        this.container.hidden = false;
    }

    hide()
    {
        this.container.hidden = true;
    }
};

