// I use this internally for testing and other things.  It doesn't do anything interesting
// for anyone else.

let Hooks = null;
export async function init()
{
    let app = ppixiv.app;
    let url = localStorage.vviewHooksUrl;
    if(!url)
        return;

    Hooks = await import(url);
    await Hooks?.init?.({ app });
}
