// Fix Pixiv's annoying link interstitials.
//
// External links on Pixiv go through a pointless extra page.  This seems like
// they're trying to mask the page the user is coming from, but that's what
// rel=noreferrer is for.  Search for these links and fix them.
//
// This also removes target=_blank, which is just obnoxious.  If I want a new
// tab I'll middle click.
(function() {
    // Ignore iframes.
    if(window.top != window.self)
        return;
    
    var observer = new window.MutationObserver(function(mutations) {
        for(var mutation of mutations) {
            if(mutation.type != 'childList')
                return;

            for(var node of mutation.addedNodes)
            {
                if(node.querySelectorAll == null)
                    continue;

                helpers.fix_pixiv_links(node);
            }
        }
    });

    window.addEventListener("DOMContentLoaded", function() {
        helpers.fix_pixiv_links(document.body);

        observer.observe(window.document.body, {
            // We could listen to attribute changes so we'll fix links that have their
            // target changed after they're added to the page, but unless there are places
            // where that's needed, let's just listen to node additions so we don't trigger
            // too often.
            attributes: false,        
            childList: true,
            subtree: true
        });
    }, true);
})();

