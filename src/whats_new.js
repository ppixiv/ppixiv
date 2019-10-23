// This should be inside whats_new, but Firefox is in the dark ages and doesn't support class fields.
let _update_history = [
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
    constructor(container)
    {
        this.container = container;

        this.refresh();

        this.container.querySelector(".close-button").addEventListener("click", (e) => { this.hide(); });

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

