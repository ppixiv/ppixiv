// The real implementation is in window.cpp.  This file gives a simple, flat
// interface that's easy to import, and handles running the window in a separate
// thread.
#include <windows.h>
#include <assert.h>
#include "window.h"
#include "vvterm.h"

static shared_ptr<VVTerm> main_window;

extern "C" BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID reserved)
{
    return true;
}

void VVterm_Create()
{
    if(main_window)
        return;

    main_window = VVTerm::create();
}

void VVterm_Shutdown()
{
    main_window.reset();
}

void VVterm_SetVisible(bool visible)
{
    assert(main_window);
    main_window->set_visible(visible);
}

void VVterm_GetHandles(HANDLE *events, HANDLE *input, HANDLE *output)
{
    assert(main_window);
    main_window->get_handles(events, input, output);
}

bool VVterm_GetVisible()
{
    assert(main_window);
    return main_window->get_visible();
}

VVTermEvent VVTerm_GetNextEvent()
{
    // If we're being called while we're not running, just return VVTermEvent_Shutdown.
    if(main_window == nullptr)
        return VVTermEvent_Shutdown;

    return main_window->get_next_event();
}
