// This holds a bunch of small helpers that don't have a better place to be.  These
// should be small, self-contained helpers that aren't too specific to the app, and
// we shouldn't need to import anything here.

// A small blank image as a data URL.
export const blankImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
export const xmlns = "http://www.w3.org/2000/svg";

// Preload an array of images.
export function preloadImages(images)
{
    // We don't need to add the element to the document for the images to load, which means
    // we don't need to do a bunch of extra work to figure out when we can remove them.
    let preload = document.createElement("div");
    for(let i = 0; i < images.length; ++i)
    {
        let img = document.createElement("img");
        img.src = images[i];
        preload.appendChild(img);
    }
}

export function defer(func)
{
    return Promise.resolve().then(() => {
        func();
    });
}

export function sleep(ms, { signal=null }={})
{
    return new Promise((accept, reject) => {
        let timeout = null;
        let abort = () => {
            realClearTimeout(timeout);
            reject("aborted");
        };

        if(signal != null)
            signal.addEventListener("abort", abort, { once: true });

        timeout = realSetTimeout(() => {
            if(signal)
                signal.removeEventListener("abort", abort, { once: true });
            accept();
        }, ms);
    });
}

// Return a Promise with accept() and reject() available on the promise itself.
//
// This removes encapsulation, but is useful when using a promise like a one-shot
// event where that isn't important.
export function makePromise()
{
    let accept, reject;
    let promise = new Promise((a, r) => {
        accept = a;
        reject = r;
    });
    promise.accept = accept;
    promise.reject = reject;
    return promise;
}

// Like Promise.all, but takes a dictionary of {key: promise}, returning a
// dictionary of {key: result}.
export async function awaitMap(map)
{
    Promise.all(Object.values(map));

    let results = {};
    for(let [key, promise] of Object.entries(map))
        results[key] = await promise;
    return results;
}

// setInterval using an AbortSignal to remove the interval.
//
// If callImmediately is true, call callback() now, rather than waiting
// for the first interval.
export function interval(callback, ms, signal, callImmediately=true)
{
    if(signal && signal.aborted)
        return;

    let id = realSetInterval(callback, ms);

    if(signal)
    {
        // Clear the interval when the signal is aborted.
        signal.addEventListener("abort", () => {
            realClearInterval(id);
        }, { once: true });
    }

    if(callImmediately)
        callback();
}

// Return a promise that resolves when DOMContentLoaded has been received.
export function waitForContentLoaded()
{
    return new Promise((accept, reject) => {
        if(document.readyState != "loading")
        {
            accept();
            return;
        }

        window.addEventListener("DOMContentLoaded", (e) => {
            accept();
        }, {
            capture: true,
            once: true,
        });
    });
}

// Return a promise that waits for the given event on node.
export function waitForEvent(node, name, { signal=null }={})
{
    return new Promise((resolve, reject) => {
        if(signal && signal.aborted)
        {
            resolve(null);
            return;
        }

        let removeListenersSignal = new AbortController();

        node.addEventListener(name, (e) => {
            removeListenersSignal.abort();
            resolve(e);
        }, { signal: removeListenersSignal.signal });

        if(signal)
        {
            signal.addEventListener("abort",(e) => {
                removeListenersSignal.abort();
                resolve("aborted");
            }, { signal: removeListenersSignal.signal });
        }
    });
}

// Return a promise that waits for img to load.
//
// If img loads successfully, resolve with null.  If signal is aborted,
// resolve with "aborted".  Otherwise, reject with "failed".  This never
// rejects.
//
// If we're aborted, img.src will be set to blankImage.  Otherwise,
// the image will load anyway.  This is a little invasive, but it's what we
// need to do any time we have a cancellable image load, so we might as well
// do it in one place.
export function waitForImageLoad(img, signal)
{
    return new Promise((resolve, reject) => {
        let src = img.src;

        // Resolve immediately if the image is already loaded.
        if(img.complete)
        {
            resolve(null);
            return;
        }

        if(signal && signal.aborted)
        {
            img.src = blankImage;
            resolve("aborted");
            return;
        }

        // Cancelling this controller will remove all of our event listeners.
        let removeListenersSignal = new AbortController();

        img.addEventListener("error", (e) => {
            // We kept a reference to src in case in changes, so this log should
            // always point to the right URL.
            console.log("Error loading image:", src);
            removeListenersSignal.abort();
            resolve("failed");
        }, { signal: removeListenersSignal.signal });

        img.addEventListener("load", (e) => {
            removeListenersSignal.abort();
            resolve(null);
        }, { signal: removeListenersSignal.signal });

        if(signal)
        {
            signal.addEventListener("abort",(e) => {
                img.src = blankImage;
                removeListenersSignal.abort();
                resolve("aborted");
            }, { signal: removeListenersSignal.signal });
        }
    });
}

// Wait for any image in images to finish loading.  If images is empty, return
// immediately.
export async function waitForAnyImageLoad(images, signal)
{
    let promises = [];
    for(let image of images)
    {
        if(image == null)
            continue;
        promises.push(waitForImageLoad(image, signal));
    }

    if(promises.length == 0)
        return null;

    await Promise.race([...promises]);
}

// Wait until img.naturalWidth/naturalHeight are available.
//
// There's no event to tell us that img.naturalWidth/naturalHeight are
// available, so we have to jump hoops.  Loop using requestAnimationFrame,
// since this lets us check quickly at a rate that makes sense for the
// user's system, and won't be throttled as badly as setTimeout.
export async function waitForImageDimensions(img, signal)
{
    return new Promise((resolve, reject) => {
        if(signal && signal.aborted)
            resolve(false);
        if(img.naturalWidth != 0)
            resolve(true);

        let frame_id = null;

        // If signal is aborted, cancel our frame request.
        let abort = () => {
            signal.removeEventListener("aborted", abort);
            if(frame_id != null)
                realCancelAnimationFrame(frame_id);
            resolve(false);
        };
        if(signal)
            signal.addEventListener("aborted", abort);

        let check = () => {
            if(img.naturalWidth != 0)
            {
                resolve(true);
                if(signal)
                    signal.removeEventListener("aborted", abort);
                return;
            }

            frame_id = realRequestAnimationFrame(check);
        };
        check();
    });
}

// Wait up to ms for promise to complete.  If the promise completes, return its
// result, otherwise return "timed-out".
export async function awaitWithTimeout(promise, ms)
{
    let sleep = new Promise((accept, reject) => {
        realSetTimeout(() => {
            accept("timed-out");
        }, ms);
    });

    // Wait for whichever finishes first.
    return await Promise.any([promise, sleep]);
}

// Asynchronously wait for an animation frame.  Return true on success, or false if
// aborted by signal.
export function vsync({signal=null}={})
{
    return new Promise((accept, reject) => {
        // The timestamp passed to the requestAnimationFrame callback is designed
        // incorrectly.  It gives the time callbacks started being called, which is
        // meaningless.  It should give the time in the future the current frame is
        // expected to be displayed, which is what you get from things like Android's
        // choreographer to allow precise frame timing.
        let id = null;

        let abort = () => {
            if(id != null)
                realCancelAnimationFrame(id);

            accept(false);
        };

        // Stop if we're already aborted.
        if(signal?.aborted)
        {
            abort();
            return;
        }

        id = realRequestAnimationFrame((time) => {
            if(signal)
                signal.removeEventListener("abort", abort);
            accept(true);
        });

        if(signal)
            signal.addEventListener("abort", abort, { once: true });
    });
}

// Return the index (in B) of the first value in A that exists in B.
export function findFirstIdx(A, B)
{
    for(let idx = 0; idx < A.length; ++idx)
    {
        let idx2 = B.indexOf(A[idx]);
        if(idx2 != -1)
            return idx2;
    }
    return -1;
}

// Return the index (in B) of the last value in A that exists in B.
export function findLastIdx(A, B)
{
    for(let idx = A.length-1; idx >= 0; --idx)
    {
        let idx2 = B.indexOf(A[idx]);
        if(idx2 != -1)
            return idx2;
    }
    return -1;
}

// Generate a UUID.
export function createUuid()
{
    let data = new Uint8Array(32);
    crypto.getRandomValues(data);

    // variant 1
    data[8] &= 0b00111111;
    data[8] |= 0b10000000;

    // version 4
    data[6] &= 0b00001111;
    data[6] |= 4 << 4;

    let result = "";
    for(let i = 0; i < 4; ++i) result += data[i].toString(16).padStart(2, "0");
    result += "-";
    for(let i = 4; i < 6; ++i) result += data[i].toString(16).padStart(2, "0");
    result += "-";
    for(let i = 6; i < 8; ++i) result += data[i].toString(16).padStart(2, "0");
    result += "-";
    for(let i = 8; i < 10; ++i) result += data[i].toString(16).padStart(2, "0");
    result += "-";
    for(let i = 10; i < 16; ++i) result += data[i].toString(16).padStart(2, "0");
    return result;
}

export function shuffleArray(array)
{
    for(let idx = 0; idx < array.length; ++idx)
    {
        let swap_with = Math.floor(Math.random() * array.length);
        [array[idx], array[swap_with]] = [array[swap_with], array[idx]];
    }
}

// This is the same as Python's zip:
//
// for(let [a,b,c] of zip(array1, array2, array))
export function *zip(...args)
{
    let iters = [];
    for(let arg of args)
        iters.push(arg[Symbol.iterator]());
    
    while(1)
    {
        let values = [];
        for(let iter of iters)
        {
            let { value, done } = iter.next();
            if(done)
                return;
            values.push(value);
        }

        yield values;
    }
}

// Return true if the screen is small enough for us to treat this as a phone.
//
// This is used for things like switching dialogs from a floating style to a fullscreen
// style.
export function isPhone()
{
    // For now we just use an arbitrary threshold.
    return Math.min(window.innerWidth, window.innerHeight) < 500;
}

// Given a URLSearchParams, return a new URLSearchParams with keys sorted alphabetically.
export function sortQueryParameters(search)
{
    let searchKeys = Array.from(search.keys());
    searchKeys.sort();

    let result = new URLSearchParams();
    for(let key of searchKeys)
        result.set(key, search.get(key));
    return result;
}

