import { helpers } from 'vview/misc/helpers.js';

let loadPromise = null;
export function load()
{
    if(loadPromise == null)
        loadPromise = loadInner();
    return loadPromise;
}

async function loadInner()
{
    // Pixiv only uses recaptcha for some users.  Only load recaptcha if it's
    // actually needed.
    if(!ppixiv.pixivInfo?.pixivTests?.recaptcha_follow_user)
        return;

    if(!ppixiv.pixivInfo?.recaptchaKey)
    {
        console.warn("Pixiv requires recaptcha for this user, but we didn't get a recaptcha key");
        return;
    }

    // Note that Pixiv may have already loaded recaptcha before we were able to stop the site
    // scripts from running.  In principle we should be able to use the instance it created, but
    // for some reason it fails and requests time out at least in Firefox.  Loading it a second
    // time seems harmless and seems to avoid this problem.
    console.log("Loading recaptcha");

    let script = document.realCreateElement("script");
    script.src = `https://www.recaptcha.net/recaptcha/enterprise.js?render=${ppixiv.pixivInfo.recaptchaKey}`;
    document.head.appendChild(script);

    // Wait for it to load.
    await helpers.other.waitForEvent(script, "load");
    script.remove();

    // Wait for recaptcha to be ready.
    console.log("Waiting for recaptcha");
    await waitForRecaptchaReady();
    console.log("Recaptcha is ready");

    // Send www/pageload on load like Pixiv does.  Don't call getRecaptchaToken here, since
    // it'll deadlock waiting for us to complete.  We don't need to wait for this to complete.
    window.grecaptcha.enterprise.execute(ppixiv.pixivInfo.recaptchaKey, { action: "www/pageload" });
}

function waitForRecaptchaReady()
{
    return new Promise((resolve) => {
        window.grecaptcha.enterprise.ready(() => resolve());
    });
}

export async function getRecaptchaToken(action)
{
    // Make sure Recaptcha has finished loading.
    await load();

    return await window.grecaptcha.enterprise.execute(ppixiv.pixivInfo.recaptchaKey, {action});
}
