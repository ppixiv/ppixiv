// This creates the entries for selecting a search mode.  This is shared by the
// desktop dropdown menu and the mobile popup.

import { MenuOptionButton, MenuOptionRow } from '/vview/widgets/menu-option.js';

function getMainSearchMenuOptions()
{
    if(ppixiv.native)
        return [
            { label: "Files",           icon: "search",          url: `/#/` },
            { label: "Similar Images",  icon: "search",          url: `/similar#/`, visible: false, classes: ["disable-clicks"] },
        ];

    let options = [
        // This is a dummy for when we're viewing an artist on mobile.  It can't be selected directly, it's
        // only made visible when an artist is being viewed already.
        { label: "Artist",                 icon: "face",           url: "/users/1#ppixiv", visible: false, classes: ["artist-row", "disable-clicks"] },

        // This weird URL is to work around Pixiv encoding their URLs in a silly way: we have
        // to do this to set "artworks" without setting a tag.  The content type should be a
        // query parameter, putting it in the path doesn't make any sense.
        { label: "Search works",           icon: "search",          url: `/tags//artworks#ppixiv` },
        { label: "New works by following", icon: "photo_library",   url: "/bookmark_new_illust.php#ppixiv" },
        { label: "New works by everyone",  icon: "groups",          url: "/new_illust.php#ppixiv" },
    ];

    if(ppixiv.mobile)
    {
        // On mobile, just show a single bookmarks and follows item.
        options = [
            ...options,
            { label: "Bookmarks",          icon: "favorite",        url: `/users/${ppixiv.pixivInfo.userId}/bookmarks/artworks#ppixiv` },
            { label: "Followed users",     icon: "visibility",      url: `/users/${ppixiv.pixivInfo.userId}/following#ppixiv` },
        ];
    }
    else
    {
        options = [
            ...options,
            [
                { label: "Bookmarks",          icon: "favorite",    url: `/users/${ppixiv.pixivInfo.userId}/bookmarks/artworks#ppixiv` },
                { label: "all",                                     url: `/users/${ppixiv.pixivInfo.userId}/bookmarks/artworks#ppixiv` },
                { label: "Public",                                  url: `/users/${ppixiv.pixivInfo.userId}/bookmarks/artworks#ppixiv?show-all=0` },
                { label: "Private",                                 url: `/users/${ppixiv.pixivInfo.userId}/bookmarks/artworks?rest=hide#ppixiv?show-all=0` },
            ], [
                { label: "Followed users",     icon: "visibility",  url: `/users/${ppixiv.pixivInfo.userId}/following#ppixiv` },
                { label: "Public",                                  url: `/users/${ppixiv.pixivInfo.userId}/following#ppixiv` },
                { label: "Private",                                 url: `/users/${ppixiv.pixivInfo.userId}/following?rest=hide#ppixiv` },
            ]
        ];
    }

    options = [
        ...options,

        { label: "Rankings",               icon: "auto_awesome"  /* who names this stuff? */, url: "/ranking.php#ppixiv" },
        { label: "Recommended works",      icon: "ppixiv:suggestions", url: "/discovery#ppixiv" },
        { label: "Recommended users",      icon: "ppixiv:suggestions", url: "/discovery/users#ppixiv" },
        { label: "Completed requests",     icon: "request_page",    url: "/request/complete/illust#ppixiv" },
        { label: "Users",                  icon: "search",          url: "/search_user.php#ppixiv" },
    ];

    return options;
}

export default function CreateSearchMenu(container)
{
    let options = getMainSearchMenuOptions();

    let createOption = ({classes=[], ...options}) => {
        let button = new MenuOptionButton({
            classes: [...classes, "navigation-button"],
            ...options
        })

        return button;
    };

    for(let option of options)
    {
        if(Array.isArray(option))
        {
            let row = new MenuOptionRow({
                container,
            });

            let first = true;
            for(let suboption of option)
            {
                if(suboption == null)
                    continue;

                createOption({
                    ...suboption,
                    container: row.root,
                });

                if(first)
                {
                    first = false;
                    let div = document.createElement("div");
                    div.style.flex = "1";
                    row.root.appendChild(div);
                }
            }
        }
        else
            createOption({...option, container});
    }
}
