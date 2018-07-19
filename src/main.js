var debug_show_ui = false;

// This runs first and sets everything else up.
class main_controller
{
    constructor()
    {
        // Early initialization.  This happens before anything on the page is loaded, since
        // this script runs at document-start.
        //
        // If this is an iframe, don't do anything.  This may be a helper iframe loaded by
        // load_data_in_iframe, in which case the main page will do the work.
        if(window.top != window.self)
            return;

        this.dom_content_loaded = this.dom_content_loaded.bind(this);

        // Create the page manager.
        page_manager.singleton();

        this.early_setup();

        window.addEventListener("DOMContentLoaded", this.dom_content_loaded, true);
    }

    // When we're disabled, but available on the current page, add the button to enable us.
    setup_disabled_ui()
    {
        // Create the activation button.
        var disabled_ui = helpers.create_node(resources['disabled.html']);
        helpers.add_style('.ppixiv-disabled-ui > a { background-image: url("' + binary_data['activate-icon.png'] + '"); };');
        document.body.appendChild(disabled_ui);
    };

    temporarily_hide_document()
    {
        if(document.documentElement != null)
        {
            document.documentElement.hidden = true;
            return;
        }

        // At this point, none of the document has loaded, and document.body and
        // document.documentElement don't exist yet, so we can't hide it.  However,
        // we want to hide the document as soon as it's added, so we don't flash
        // the original page before we have a chance to replace it.  Use a mutationObserver
        // to detect the document being created.
        var observer = new MutationObserver(function(mutation_list) {
            if(document.documentElement == null)
                return;
            observer.disconnect();

            document.documentElement.hidden = true;
        });

        observer.observe(document, { attributes: false, childList: true, subtree: true });
    };

    // This is called when we're enabled at the start of page load.
    early_setup()
    {
        if(!page_manager.singleton().active)
            return;

        // Try to prevent site scripts from running, since we don't need any of it.
        if(navigator.userAgent.indexOf("Firefox") != -1)
            helpers.block_all_scripts();

        this.temporarily_hide_document();
        install_polyfills();
        helpers.block_network_requests();
    };

    dom_content_loaded(e)
    {
        try {
            this.setup();
        } catch(e) {
            // GM error logs don't make it to the console for some reason.
            console.log(e);
        }
    }

    // This is called on DOMContentLoaded (whether we're active or not).
    setup()
    {
        // If we're not active, stop without doing anything and leave the page alone.
        if(!page_manager.singleton().active)
        {
            // If we're disabled and can be enabled on this page, add the button.
            if(page_manager.singleton().available())
                this.setup_disabled_ui();
            
            return;
        }

        // Try to init using globalInitData if possible.
        var data = helpers.get_global_init_data(document);
        if(data != null)
        {
            // If data is available, this is a newer page with globalInitData.
            this.init_global_data(data.token, data.userData.id, data.premium && data.premium.popularSearch, data.mute);
        }
        else
        {
            // If that's not available, this should be an older page with the "pixiv" object.
            var pixiv = helpers.get_pixiv_data(document);
            if(pixiv == null)
            {
                // If we can't find either, either we're on a page we don't understand or we're
                // not logged in.  Stop and let the page run normally.
                console.log("Couldn't find context data.  Are we logged in?");
                document.documentElement.hidden = false;
                return;
            }
            this.init_global_data(pixiv.context.token, pixiv.user.id, pixiv.user.premium, pixiv.user.mutes);
        }

        console.log("Starting");

        // Remove everything from the page and move it into a dummy document.
        var html = document.createElement("document");
        helpers.move_children(document.head, html);
        helpers.move_children(document.body, html);

        // Now that we've cleared the document, we can unhide it.
        document.documentElement.hidden = false;

        // Get the data source class for this page.
        var data_source_class = page_manager.singleton().get_data_source_for_url(document.location);
        if(data_source_class == null)
        {
            console.error("Unexpected path:", document.location.pathname);
            return;
        }

        // Create the data source for this page, passing it the original page data.
        var source = new data_source_class(html);

        // Create the main UI.
        new main_ui(source);
    };

    init_global_data(csrf_token, user_id, premium, mutes)
    {
        var muted_tags = [];
        var muted_user_ids = [];
        for(var mute of mutes)
        {
            if(mute.type == 0)
                muted_tags.push(mute.value);
            else if(mute.type == 1)
                muted_user_ids.push(mute.value);
        }
        this.muted_tags = muted_tags;
        this.muted_user_ids = muted_user_ids;

        window.global_data = {
            // Store the token for XHR requests.
            csrf_token: csrf_token,
            user_id: user_id,
        };

        // Set the .premium class on body if this is a premium account, to display features
        // that only work with premium.
        //
        // It would make more sense to do this in main_ui, but user data comes in different
        // forms for different pages and it's simpler to just do it here.
        helpers.set_class(document.body, "premium", premium);
    };

    is_muted_user_id(user_id, tags)
    {
        return this.muted_user_ids.indexOf(user_id) != -1;
            return true;
        return false;
    };

    // Return true if any tag in tag_list is muted.
    any_tag_muted(tag_list)
    {
        for(var tag of tag_list)
        {
            if(tag.tag)
                tag = tag.tag;
            if(this.muted_tags.indexOf(tag) != -1)
                return tag;
        }
        return null;
    }
};

var main = new main_controller();

