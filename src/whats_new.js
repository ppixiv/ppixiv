"use strict";

// This should be inside whats_new, but Firefox is in the dark ages and doesn't support class fields.
let _update_history = [
    {
        version: 139,
        text: `
            Added a panning/slideshow editor, to edit how an image will pan and zoom during
            slideshows.  Right-click and enable
            ${ helpers.create_icon("settings") } ${ helpers.create_icon("brush") } Image Editing, then
            ${ helpers.create_icon("wallpaper") } Edit Panning while viewing an image.
            <p>
            Added a button to ${ helpers.create_icon("restart_alt") }
            Refresh the search from the current page.  The ${ helpers.create_icon("refresh") }
            Refresh button now always restarts from the beginning.
        `,
    },
    {
        version: 133,
        text: `
            Pressing Ctrl-P now toggles image panning.
            <p>        
            Added image cropping for trimming borders from images.
            Enable ${ helpers.create_icon("settings") } Image Editing in the context menu to
            display the editor.
            <p>
            The page number is now shown over expanded manga posts while hovering over
            the image, so you can collapse long posts without having to scroll back up.
        `,
    },
    {
        version: 132,
        text: `
            Improved following users, allowing changing a follow to public or private and
            adding support for follow tags.
        `,
    },
    {
        version: 129,
        text: `
            Added a new way of viewing manga posts.
            <p>
            You can now view manga posts in search results.  Click the page count in the corner of
            thumbnails to show all manga pages.  You can also click ${ helpers.create_icon("open_in_full") }
            in the top menu to expand everything, or turn it on everywhere in settings.
        `,
    }, {
        version: 126,
        text: `
            Muted tags and users can now be edited from the preferences menu.
            <p>            
            Any number of tags can be muted.  If you don't have Premium, mutes will be
            saved to the browser instead of to your Pixiv account.
        `,
    }, {
        version: 123,
        text: `
            Added support for viewing completed requests.
            <p>
            Disabled light mode for now.  It's a pain to maintain two color schemes and everyone
            is probably using dark mode anyway.  If you really want it, let me know on GitHub.
        `,
    },
    {
        version: 121,
        text: `
Added a slideshow mode.  Click ${ helpers.create_icon("wallpaper") } at the top.
<p>
Added an option to pan images as they're viewed.
<p>
Double-clicking images now toggles fullscreen.
<p>
The background is now fully black when viewing an image, for better contrast.  Other screens are still dark grey.
<p>
Added an option to bookmark privately by default, such as when bookmarking by selecting
a bookmark tag.
<p>
Reworked the animation UI.
        `,
    },

    {
        version: 117,
        text: `
        Added Linked Tabs.  Enable linked tabs in preferences to show images
on more than one monitor as they're being viewed (try it with a portrait monitor).
<p>
        Showing the popup menu when Ctrl is pressed is now optional.
`,
    },
    {
        version: 112,
        text: `
Added Send to Tab to the context menu, which allows quickly sending an image to
another tab.
<p>
Added a More Options dropdown to the popup menu.  This includes some things that
were previously only available from the hover UI.  Send to Tab is also in here.
<p>
Disabled the "Similar Illustrations" lightbulb button on thumbnails.  It can now be
accessed from the popup menu, along with a bunch of other ways to get image recommendations.
        `
    },
    {
        version: 110,
        text: `
Added Quick View.  This views images immediately when the mouse is pressed,
and images can be panned with the same press.
<p>
This can be enabled in preferences, and may become the default in a future release.
`
    },
    {
        version: 109,
        boring: true,
        text: `Added a visual marker on thumbnails to show the last image you viewed.`
    },
    {
        version: 104,
        text:
            "Bookmarks can now be shuffled, to view them in random order. " +
            "<p>" +
            "Bookmarking an image now always likes it, like Pixiv's mobile app. " +
            "(Having an option for this didn't seem useful.)" +
            "<p>" +
            "Added a Recent History search, to show recent search results.  This can be turned " +
            "off in settings."
    },
    {
        version: 102,
        boring: true,
        text:
            "Animations now start playing much faster."
    },
    {
        version: 100,
        text:
            "Enabled auto-liking images on bookmark by default, to match the Pixiv mobile apps. " + 
            "If you've previously changed this in preferences, your setting should stay the same." +
            "<p>" +
            "Added a download button for the current page when viewing manga posts."
    },
    {
        version: 97,
        text:
            "Holding Ctrl now displays the popup menu, to make it easier to use for people on touchpads.<p>" +
            "<p>" + 
            "Keyboard hotkeys reworked, and can now be used while hovering over search results.<p>" +
            "<pre>" +
	    "Ctrl-V           - like image\n" +
	    "Ctrl-B           - bookmark\n" +
	    "Ctrl-Alt-B       - bookmark privately\n" +
	    "Ctrl-Shift-B     - remove bookmark\n" +
	    "Ctrl-Alt-Shift-M - add bookmark tag\n" +
	    "Ctrl-F           - follow\n" +
	    "Ctrl-Alt-F       - follow privately\n" +
	    "Ctrl-Shift-F     - unfollow\n" +
	    "</pre>"
    },
    {
        version: 89,
        text:
            "Reworked zooming to make it more consistent and easier to use.<p>" +
            "<p>" +
            "You can now zoom images to 100% to view them at actual size."
    },
    {
        version: 82,
        text:
            "Press Ctrl-Alt-Shift-B to bookmark an image with a new tag."
    },
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

ppixiv.whats_new = class extends ppixiv.dialog_widget
{
    // Return the newest revision that exists in history.  This is always the first
    // history entry.
    static latest_history_revision()
    {
        return _update_history[0].version;
    }

    // Return the latest interesting history entry.
    //
    // We won't highlight the "what's new" icon for boring history entries.
    static latest_interesting_history_revision()
    {
        for(let history of _update_history)
        {
            if(history.boring)
                continue;

            return history.version;
        }

        // We shouldn't get here.
        throw Error("Couldn't find anything interesting");
    }

    constructor({...options}={}) 
    {
        super({...options, classes: "whats-new-box", template: `
            <div class=header>Updates</div>
            <div class="scroll items"></div>
        `});

        this.refresh();
    }

    refresh()
    {
        let items_box = this.container.querySelector(".items");

        // Not really needed, since our contents never change
        helpers.remove_elements(items_box);

        for(let update of _update_history)
        {
            let entry = this.create_template({name: "item", html: `
                <div>
                    <div class=rev></div>
                    <div class=text></span>
                </div>
            `});
            entry.querySelector(".rev").innerText = "r" + update.version;
            entry.querySelector(".text").innerHTML = update.text;
            items_box.appendChild(entry);
        }
    }
};

