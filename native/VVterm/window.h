#ifndef window_h
#define window_h

#include <memory>
using namespace std;

#include "vvterm.h"

// The top-level public interface.
class VVTerm
{
public:
    // Create the terminal window.
    static shared_ptr<VVTerm> create();

    // The constructor will destroy the window.
    virtual ~VVTerm() { }

    // Show or hide the window.  The window is hidden by default, but can still
    // be written to.
    virtual void set_visible(bool visible) = 0;
    virtual bool get_visible() const = 0;

    // Return the event handle, and the input and output handles for the terminal.
    // The event handle is signalled when a new event is available from get_next_event.
    //
    // The caller must close these handles with CloseHandle when it's done with them.
    virtual void get_handles(HANDLE *events, HANDLE *input, HANDLE *output) = 0;

    // Return the next waiting event, or VVTermEvent_None if there are no waiting
    // events.
    virtual VVTermEvent get_next_event() = 0;
};

#endif
