#ifndef VVTerm_H
#define VVTerm_H

#include <memory>

// Including windows.h without it breaking everything is tricky, since it has
// ugly conflicts with C++17.  The only thing we need here is HANDLE, so just
// declare itself and let the user figure out for himself how he wants to include
// the full header.
// #include <windows.h>
typedef void *HANDLE;

// Events sent from the window to the application.  These are returned by get_next_event.
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
};

#if defined(VVTERM_DLL) // defined by the project
#define DLL __declspec(dllexport)
#else
#define DLL __declspec(dllimport)
#endif

// The top-level public interface.
class VVTerm
{
public:
    static std::shared_ptr<VVTerm> create();

    // The constructor will destroy the window.
    virtual ~VVTerm() { }

    // Show or hide the window.  The window is hidden by default, but can still
    // be written to.
    virtual void set_visible(bool visible) = 0;

    // Return the event handle, and the input and output handles for the terminal.
    // The event handle is signalled when a new event is available from get_next_event.
    //
    // The caller must close these handles with CloseHandle when it's done with them.
    virtual void get_handles(HANDLE *events, HANDLE *display) = 0;

    // Return the next waiting event, or VVTermEvent_None if there are no waiting
    // events.
    virtual VVTermEvent get_next_event() = 0;
};

// A thin C wrapper to make it easier to bind to Python:

#ifdef __cplusplus
extern "C" {
#endif

DLL void VVterm_Create();
DLL void VVterm_Shutdown();
DLL VVTermEvent VVTerm_GetNextEvent();

// The remaining functions must only be called while a window is running, between
// calls to VVterm_Create and VVterm_Shutdown.
DLL void VVterm_GetHandles(HANDLE *events, HANDLE *display);
DLL void VVterm_SetVisible(bool visible);

#ifdef __cplusplus
}
#endif

#undef DLL

#endif
