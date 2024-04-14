// I use this internally for testing and other things.  It doesn't do anything interesting
// for anyone else.

import * as MenuOption from '/vview/widgets/menu-option.js';
import * as LocalAPI from '/vview/misc/local-api.js';
import * as Helpers from '/vview/misc/helpers.js';

let Hooks = null;
export async function init()
{
    let app = ppixiv.app;
    let url = localStorage.vviewHooksUrl;
    if(!url)
        return;

    let exports = {
        MenuOption,
        LocalAPI,
        Helpers,
    };

    Hooks = await import(url);
    await Hooks?.init?.({ app, exports });
}
