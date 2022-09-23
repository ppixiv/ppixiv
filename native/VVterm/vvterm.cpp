// This is the public API.  It starts the window in a thread, and handles communication
// between the application and the window.
#include <windows.h>
#include <assert.h>
#include "window.h"
#include "vvterm.h"

#include "handle_io.h"
#include "client.h"
#include "resource.h"

#include <list>
using namespace std;

static HINSTANCE hinst;

BOOL APIENTRY DllMain(HMODULE hModule, DWORD ul_reason_for_call, LPVOID lpReserved)
{
    // Store our HMODULE/HINSTANCE pointer so we can load our icon later.
    hinst = hModule;

    return TRUE;
}

// A wrapper around TermWinWindows to run it in a thread, and allow interacting
// with it from other threads.
class VVTermImpl: public VVTerm
{
public:
    // The handles we return to the application.  display_handle is terminal data, and
    // events_handle is signalled when we need to update control_io and possibly return
    // an event from event_queue.
    shared_ptr<HandleHolder> display_handle, events_handle;
    shared_ptr<HandleHolder> window_thread;
    list<VVTermEvent> event_queue;
    shared_ptr<HandleIO> control_io;

    // This only exists briefly as we send it from the main thread to window_thread.
    shared_ptr<ClientPipes> client_pipes;

    VVTermImpl()
    {
        // Create the communication pipes.
        client_pipes = ClientPipes::create();
        display_handle = client_pipes->GetDisplayConnection();

        // Create a HandleIO to handle reading and writing messages to the control connection,
        // using overlapped_event_handle to signal I/O.  This event is initially signalled, so
        // we'll start the initial read immediately.
        events_handle = make_shared<HandleHolder>(CreateEvent(NULL, false, true, NULL));
        control_io = HandleIO::create(client_pipes->GetControlConnection(), events_handle, on_control_read_stub, on_control_error_stub, this);

        // Start the window thread.  We don't need to wait for this to set up, since the only
        // way we communicate with it is through the client pipes, and that'll just buffer data
        // until it's received.
        window_thread = make_shared<HandleHolder>(CreateThread(NULL, 0, thread_main_stub, this, 0, nullptr));
    }

    // The main terminal window thread.  All we do here is run the terminal window, passing
    // it the ClientPipes to talk to it.
    static DWORD thread_main_stub(void *ptr) { VVTermImpl *self = (VVTermImpl *) ptr; self->thread_main(); return 0; }
    void thread_main()
    {
        // Load our window icon.  We need our DLL's HINSTANCE to do this, so it's easiest to do
        // this here and just give the window the HICON.
        HICON icon = LoadIcon(hinst, MAKEINTRESOURCE(IDI_WINDOW_ICON));

        RunTerminalWindow(client_pipes, icon);
    }

    void send_command_to_window(VVtermMessage message)
    {
        control_io->write(&message, sizeof(message));
    }

    // VVTerm implementation
    void get_handles(HANDLE *events, HANDLE *display) override
    {
        *events = events_handle->h;
        *display = display_handle->h;
    }

    void set_visible(bool visible) override
    {
        send_command_to_window(VVtermMessage(VVtermMessage::Command_SetVisible, visible));
    }

    // The application calls this when overlapped_event_handle is signalled.
    VVTermEvent get_next_event() override
    {
        // overlapped_event_handle is signalled, which means control_io needs to be
        // updated.  control_on_read and onerror can be called during this, which might
        // queue new events to event_queue.
        control_io->update();

        // Multiple events might have been added to events.  Return the first.
        if(event_queue.empty())
            return VVTermEvent_None;
        else
        {
            VVTermEvent event = event_queue.front();
            event_queue.pop_front();
            return event;
        }
    }

    // This is called when a packet is received on the control handle containing a
    // VvtermMessage.  Put it on the message queue to be retrieved with get_next_message.
    static void on_control_read_stub(void *ptr, const void *data, size_t len, int error) { ((VVTermImpl *) ptr)->control_on_read(data, len, error); }
    void control_on_read(const void *data, size_t len, int error)
    {
        VVTermEvent *event = (VVTermEvent *) data;
        event_queue.push_back(*event);
    }

    // XXX
    static void on_control_error_stub(void *ptr, int error){ ((VVTermImpl *) ptr)->onerror(error); }
    void onerror(int error)
    {
    }

    ~VVTermImpl()
    {
        // Ask the window to shut down.
        send_command_to_window(VVtermMessage(VVtermMessage::Command_Shutdown));

        // We need to wait for the thread to exit, so we know everything is cleaned up, but
        // while we're waiting we still need to be watching the event handle and calling
        // get_next_event so the control handle keeps being written to.  Wait for either
        // the event handle to be signalled or the thread to exit.  Note that the thread
        // might have already exited, if the user closed the display handle.
        HANDLE handles[] = {
            window_thread->h,
            events_handle->h,
        };

        while(true)
        {
            WaitForMultipleObjects(2, handles, false, INFINITE);
            get_next_event();

            // If the window thread has exited, we're done.
            if(WaitForSingleObject(window_thread->h, 0) == WAIT_OBJECT_0)
                break;
        }

        // Wait for the thread to exit in response to WindowCommand_Shutdown.
        window_thread.reset();
    }
};

shared_ptr<VVTerm> VVTerm::create()
{
    return make_shared<VVTermImpl>();
}

// This is an even simpler wrapper to make it easier to create script wrappers.
static shared_ptr<VVTerm> main_window;

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

void VVterm_GetHandles(HANDLE *events, HANDLE *display)
{
    assert(main_window);
    main_window->get_handles(events, display);
}

VVTermEvent VVTerm_GetNextEvent()
{
    // If we're being called while we're not running, just return VVTermEvent_Shutdown.
    if(main_window == nullptr)
        return VVTermEvent_Shutdown;

    return main_window->get_next_event();
}
