import { helpers } from '/vview/misc/helpers.js';
import widget from '/vview/widgets/widget.js';

let updateHistory = [
    {
        version: 236,
        text: `
            Added a manga progress bar at the bottom of the image view (disabled by
            default).  This can be enabled in settings under "Image Viewing".            
        `,
    },
    {
        version: 229,
        text: `
            Select "Translate" from the context menu while viewing an image to enable translation
            using <a href=https://cotrans.touhou.ai/>Cotrans</a> (experimental).
            <p>
            Added support for viewing Pixiv image series.
        `,
    },

    {
        version: 218,
        text: `
            Added support for the "Hide AI works" filter on searches.
        `,
    },

    {
        version: 210,
        text: `
            Aspect ratio thumbnails are now used by default.  Square thumbs can be selected in
            settings.
        `,
    },

    {
        version: 198,
        text: `
            Artist links have been moved to the avatar dropdown, and can be accessed directly
            from the popup menu.
            <p>
            "AI-generated" is now displayed as a tag.
        `,
    },
    {
        version: 172,
        text: `
            Added support for AI rankings.
        `,
    },
    {
        version: 168,
        text: `
            Images tagged as "AI" are now marked in search results.  There are too many of
            these flooding the site, but this gives an alternative to muting them.
            <p>
            Slideshows are now limited to 60 FPS by default.  <span class=explanation-button data-explanation=chrome-fps>(Why?)</span>
            This can be disabled in settings.

            <div class="explanation-target chrome-fps" hidden>
                Chrome has problems with high refresh rate monitors, and can cause other windows to
                stutter when animations are running on another monitor.  Slideshows are usually
                gradual pans anyway, so limiting the framerate avoids this problem without affecting
                the result very much.
            </div>
        `,
    },
    {
        version: 164,
        boring: true,
        text: `
            Search autocomplete now works for searches with multiple tags.
        `,
    },
    {
        version: 162,
        text: `
            Search tags can now be saved in the search dropdown separately from recents and grouped
            together.
            <p>
            Added "Loop" in the more options dropdown to loop the current image.
        `,
    },
    {
        version: 153,
        boring: true,
        text: `
            Pressing Ctrl-S now saves the current image or video, and Ctrl-Alt-S saves a
            ZIP of the current manga post.
            <p>
            Fixed hotkeys in search results, so hotkeys like Ctrl-B work when hovering over
            thumbnails.
        `,
    },
    {
        version: 152,
        boring: true,
        text: `
            Tags that have been searched for recently now appear at the top of the artist
            tag list.
        `,
    },
    {
        version: 151,
        boring: true,
        text: `
            Navigating through images with the mousewheel now skips past manga pages if the image
            is muted.
        `,
    },
    {
        version: 145,
        text: `
            Added support for viewing followed users who are accepting requests, and a link from
            the user to the request page.  This feature is still being rolled out by Pixiv and may
            not be available for all users immediately.
        `,
    },
    {
        version: 142,
        boring: true,
        text: `
            The slideshow can now be set to fade through images without panning.
            <p>
            Thumbnail panning now stops after a while if there's no mouse movement,
            so it doesn't keep going forever.
        `,
    },
    {
        version: 139,
        text: `
            Added a panning/slideshow editor, to edit how an image will pan and zoom during
            slideshows.  Right-click and enable
            ${ helpers.createIcon("settings") } ${ helpers.createIcon("brush") } Image Editing, then
            ${ helpers.createIcon("wallpaper") } Edit Panning while viewing an image.
            <p>
            Added a button to ${ helpers.createIcon("restart_alt") }
            Refresh the search from the current page.  The ${ helpers.createIcon("refresh") }
            Refresh button now always restarts from the beginning.
        `,
    },
    {
        version: 133,
        text: `
            Pressing Ctrl-P now toggles image panning.
            <p>        
            Added image cropping for trimming borders from images.
            Enable ${ helpers.createIcon("settings") } Image Editing in the context menu to
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
            thumbnails to show all manga pages.  You can also click ${ helpers.createIcon("open_in_full") }
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
Added a slideshow mode.  Click ${ helpers.createIcon("wallpaper") } at the top.
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
        text: `
            Bookmarks can now be shuffled, to view them in random order.
            <p>
            Bookmarking an image now always likes it, like Pixiv's mobile app.
            (Having an option for this didn't seem useful.)
            <p>
            Added a Recent History search, to show recent search results.  This can be turned
            off in settings.
        `
    },
    {
        version: 102,
        boring: true,
        text: "Animations now start playing much faster."
    },
    {
        version: 100,
        text: `
            Enabled auto-liking images on bookmark by default, to match the Pixiv mobile apps.
            If you've previously changed this in preferences, your setting should stay the same.
            <p>
            Added a download button for the current page when viewing manga posts.
        `
    },
    {
        version: 97,
        text: `
            Holding Ctrl now displays the popup menu, to make it easier to use for people on touchpads.<p>
            <p>
            Keyboard hotkeys reworked, and can now be used while hovering over search results.<p>
    <pre>
    Ctrl-V           - like image
    Ctrl-B           - bookmark
    Ctrl-Alt-B       - bookmark privately
    Ctrl-Shift-B     - remove bookmark
    Ctrl-Alt-Shift-M - add bookmark tag
    Ctrl-F           - follow
    Ctrl-Alt-F       - follow privately
    Ctrl-Shift-F     - unfollow</pre>
        `
    },
    {
        version: 89,
        text: `
            Reworked zooming to make it more consistent and easier to use.<p>
            <p>
            You can now zoom images to 100% to view them at actual size.
        `
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
        text: `
            Added user searching.
            <p>
            Commercial/subscription links in user profiles (Fanbox, etc.) now use a different icon.
        `
    },
    {
        version: 74,
        text: `
            Viewing your followed users by tag is now supported.
            <p>
            You can now view other people who bookmarked an image, to see what else they've bookmarked. 
            This is available from the top-left hover menu.
        `
    },
    {
        version: 72,
        text: `
            The followed users page now remembers which page you were on if you reload the page, to make 
            it easier to browse your follows if you have a lot of them.
            <p>
            Returning to followed users now flashes who you were viewing like illustrations do,
            to make it easier to pick up where you left off.
            <p>
            Added a browser back button to the context menu, to make navigation easier in fullscreen 
            when the browser back button isn't available.
        `
    },
    {
        version: 68,
        text: `
            You can now go to either the first manga page or the page list from search results. 
            Click the image to go to the first page, or the page count to go to the page list.
            <p>
            Our button is now in the bottom-left when we're disabled, since Pixiv now puts a menu 
            button in the top-left and we were covering it up.
        `
    },
    {
        version: 65,
        text: `
            Bookmark viewing now remembers which page you were on if the page is reloaded.
            <p>
            Zooming is now in smaller increments, to make it easier to zoom to the level you want.
        `
    },
    {
        version: 57,
        text: `
            Search for similar artists.  Click the recommendations item at the top of the artist page, 
            or in the top-left when viewing an image.
            <p>
            You can also now view suggested artists.
        `
    },
    {
        version: 56,
        text: `
            Tag translations are now supported.  This can be turned off in preferences.
            <p>
            Added quick tag search editing.  After searching for a tag, click the edit button
            to quickly add and remove tags.
        `
    },
    {
        version: 55,
        text: `
            The \"original\" view is now available in Rankings.
            <p>
            Hiding the mouse cursor can now be disabled in preferences.
        `
    },
    {
        version: 49,
        text: `
            Add \"Hover to show UI\" preference, which is useful for low-res monitors.
        `
    },
    {
        version: 47,
        text: `
            You can now view the users you're following with \"Followed Users\".  This shows each
            user's most recent post.
        `
    },
];

export default class WhatsNew extends widget
{
    // Return the newest revision that exists in history.  This is always the first
    // history entry.
    static latestHistoryRevision()
    {
        return updateHistory[0].version;
    }

    // Return the latest interesting history entry.
    //
    // We won't highlight the "what's new" icon for boring history entries.
    static latestInterestingHistoryRevision()
    {
        for(let history of updateHistory)
        {
            if(history.boring)
                continue;

            return history.version;
        }

        // We shouldn't get here.
        throw Error("Couldn't find anything interesting");
    }

    // Set html[data-whats-new-updated] for highlights when there are What's New updates.
    // This updates automatically if whats-new-last-viewed-version is updated.
    static handleLastViewedVersion()
    {
        let refresh = () => {
            let lastViewedVersion = ppixiv.settings.get("whats-new-last-viewed-version", 0);
    
            // This was stored as a string before, since it came from GM_info.script.version.  Make
            // sure it's an integer.
            lastViewedVersion = parseInt(lastViewedVersion);
    
            let newUpdates = lastViewedVersion < WhatsNew.latestInterestingHistoryRevision();
            helpers.html.setDataSet(document.documentElement.dataset, "whatsNewUpdated", newUpdates);
        };
        refresh();
        ppixiv.settings.addEventListener("whats-new-last-viewed-version", refresh);
    }

    constructor({...options}={}) 
    {
        super({...options, dialogClass: "whats-new-dialog", header: "Updates", template: `
            <div class=whats-new-dialog>
                <div class=contents>
                </div>
            </div>
        `});

        this.root.addEventListener("click", this.onclick);
        ppixiv.settings.set("whats-new-last-viewed-version", WhatsNew.latestHistoryRevision());

        this.refresh();
    }

    onclick = (e) =>
    {
        let explanationButton = e.target.closest(".explanation-button");
        if(explanationButton)
        {
            e.preventDefault();
            e.stopPropagation();
            let name = e.target.dataset.explanation;
            let target = this.root.querySelector(`.${name}`);
            target.hidden = false;
        }
    }

    refresh()
    {
        let itemsBox = this.root.querySelector(".contents");
        for(let node of itemsBox.querySelectorAll(".item"))
            node.remove();

        let githubTopURL = "https://github.com/ppixiv/ppixiv/";

        for(let idx = 0; idx < updateHistory.length; ++idx)
        {
            let update = updateHistory[idx];
            let previousUpdate = updateHistory[idx+1];
            let entry = this.createTemplate({name: "item", html: `
                <div class=item>
                    <a class=rev href=#></a>
                    <div class=text></span>
                </div>
            `});

            let rev = entry.querySelector(".rev");
            rev.innerText = "r" + update.version;

            // Link to the change list between this revision and the next revision that has release notes.
            let previousVersion = previousUpdate? ("r" + previousUpdate.version):"r1";
            rev.href = `${githubTopURL}/compare/${previousVersion}...r${update.version}`;

            entry.querySelector(".text").innerHTML = update.text;
            itemsBox.appendChild(entry);
        }
    }
}
