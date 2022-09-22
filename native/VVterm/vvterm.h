#ifndef VVTerm_H
#define VVTerm_H

// Including windows.h without it breaking everything is tricky, since it has
// ugly conflicts with C++17.  The only thing we need here is HANDLE, so just
// declare itself and let the user figure out for himself how he wants to include
// the full header.
// #include <windows.h>
typedef void *HANDLE;

enum VVTermEvent
{
    VVTermEvent_None,

    // The user clicked the window close button.  The window hasn't been closed,
    // and the application can decide whether to exit or hide the window.
    VVTermEvent_Close,

    // The window is shutting down.  No further messages will be received, and
    // the event handle won't be signalled again.
    VVTermEvent_Shutdown,
    VVTermEvent_Minimized,

    // This is used internally and never returned.
    VVTermEvent_Invalid = -1,
};

#if defined(VVTERM_DLL) // defined by the project
#define DLL __declspec(dllexport)
#else
#define DLL __declspec(dllimport)
#endif

#ifdef __cplusplus
extern "C" {
#endif

DLL void VVterm_Create();
DLL void VVterm_Shutdown();
DLL VVTermEvent VVTerm_GetNextEvent();

// The remaining functions must only be called while a window is running, between
// calls to VVterm_Create and VVterm_Shutdown.
DLL void VVterm_GetHandles(HANDLE *events, HANDLE *input, HANDLE *output);
DLL void VVterm_SetVisible(bool visible);
DLL bool VVterm_GetVisible();

#ifdef __cplusplus
}
#endif

#undef DLL

#endif
