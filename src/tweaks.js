// This installs some minor tweaks that aren't related to the main viewer functionality.
(function() {
    // If this is an iframe, don't do anything.  This may be a helper iframe loaded by
    // load_data_in_iframe, in which case the main page will do the work.
    if(window.top != window.self)
        return;

    window.addEventListener("DOMContentLoaded", function(e) {
        try {
            if(window.location.pathname.startsWith("/bookmark.php"))
            {
                // On the follow list, make the user links point at the works page instead
                // of the useless profile page.
                var links = document.documentElement.querySelectorAll('A');
                for(var i = 0; i < links.length; ++i)
                {
                    var a = links[i];
                    a.href = a.href.replace(/member\.php/, "member_illust.php");
                }
            };
        } catch(e) {
            // GM error logs don't make it to the console for some reason.
            console.log(e);
        }
    });
})();
