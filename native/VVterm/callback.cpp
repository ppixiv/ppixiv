/*
 * This provides a method of queuing function calls to be run at the
 * earliest convenience from the top-level event loop. Use it if
 * you're deep in a nested chain of calls and want to trigger an
 * action which will probably lead to your function being re-entered
 * recursively if you just call the initiating function the normal
 * way.
 *
 * Most front ends run the queued callbacks by simply calling
 * run_toplevel_callbacks() after handling each event in their
 * top-level event loop. However, if a front end doesn't have control
 * over its own event loop (e.g. because it's using GTK) then it can
 * instead request notifications when a callback is available, so that
 * it knows to ask its delegate event loop to do the same thing. Also,
 * if a front end needs to know whether a callback is pending without
 * actually running it (e.g. so as to put a zero timeout on a poll()
 * call) then it can call toplevel_callback_pending(), which will
 * return true if at least one callback is in the queue.
 *
 * run_toplevel_callbacks() returns true if it ran any actual code.
 * This can be used as a means of speculatively terminating a poll
 * loop, as in PSFTP, for example - if a callback has run then perhaps
 * it might have done whatever the loop's caller was waiting for.
 */

#include <stddef.h>

#include "callback.h"

#include <list>
#include <memory>
using namespace std;

struct pending_callback {
    toplevel_callback_fn_t fn;
    void *ctx;
};

static list<shared_ptr<pending_callback>> all_callbacks;

void callback::delete_callbacks_for_context(void *ctx)
{
    auto it = all_callbacks.begin();
    while(it != all_callbacks.end())
    {
        auto next = it;
        ++next;

        if((*it)->ctx == ctx)
            all_callbacks.erase(it);

        it = next;
    }
}

void callback::post(toplevel_callback_fn_t fn, void *ctx)
{
    shared_ptr<pending_callback> cb = make_shared<pending_callback>();
    cb->fn = fn;
    cb->ctx = ctx;
    all_callbacks.push_back(cb);
}

bool callback::run_pending()
{
    if(all_callbacks.empty())
        return false;

    auto cb = all_callbacks.front();
    all_callbacks.pop_front();
    cb->fn(cb->ctx);

    return true;
}

bool callback::pending()
{
    return !all_callbacks.empty();
}
