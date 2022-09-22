/*
 * handle-wait.c: Manage a collection of HANDLEs to wait for (in a
 * WaitForMultipleObjects sense), each with a callback to be
 * called when it's activated. Tracks the list, and provides an API to
 * event loops that let them get a list of things to wait for and a
 * way to call back to here when one of them does something.
 */

#include "internal.h"
#include "handle_wait.h"
#include <set>
#include <vector>

//#include <windows.h>

class HandleWaitImpl: public HandleWait
{
public:
    shared_ptr<HandleWaitImpl> self;

    void shutdown() override;

    HANDLE handle;
    handle_wait_callback_fn_t callback;
    void *callback_ctx;
};

static set<shared_ptr<HandleWaitImpl>> all_handle_wait_impls;

shared_ptr<HandleWait> HandleWait::create(HANDLE h, handle_wait_callback_fn_t callback, void *callback_ctx)
{
    auto hw = make_shared<HandleWaitImpl>();
    hw->self = hw;
    hw->handle = h;
    hw->callback = callback;
    hw->callback_ctx = callback_ctx;

    all_handle_wait_impls.insert(hw);

    return hw;
}

void HandleWaitImpl::shutdown()
{
    all_handle_wait_impls.erase(self);
    self.reset();
}

void HandleWait::wait(DWORD timeout)
{
    vector<shared_ptr<HandleWaitImpl>> hws;
    vector<HANDLE> handles;
    assert(all_handle_wait_impls.size() < MAXIMUM_WAIT_OBJECTS);

    for(auto hw: all_handle_wait_impls)
    {
        hws.push_back(hw);
        handles.push_back(hw->handle);
    }

    int n = MsgWaitForMultipleObjects(handles.size(), handles.data(), false, timeout, QS_ALLINPUT);
    int index = n - WAIT_OBJECT_0;
    if(index >= 0 && index < handles.size())
    {
        shared_ptr<HandleWaitImpl> hw = hws[index];
        hw->callback(hw->callback_ctx);
    }
}
