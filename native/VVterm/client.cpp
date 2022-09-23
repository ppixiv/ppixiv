#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <io.h>
#include <fcntl.h>

#include "internal.h"
#include "timing.h"

#include "callback.h"
#include "client.h"
#include "handle_io.h"
#include "handle_wait.h"

#include <windows.h>
#include <consoleapi.h>
#include <assert.h>

class ClientPipesImpl: public ClientPipes
{
public:
    // The pipe handles:
    shared_ptr<HandleHolder> display_pipe, control_pipe;

    // A connection to each pipe:
    shared_ptr<HandleHolder> display_connection, control_connection;

    shared_ptr<HandleHolder> GetDisplayConnection() override { return display_connection; }
    shared_ptr<HandleHolder> GetControlConnection() override { return control_connection; }

    ClientPipesImpl()
    {
        // Create the display pipe.
        string display_pipe_name = ssprintf("\\\\.\\pipe\\vvterm-%i", GetCurrentProcessId());
        display_pipe = make_shared<HandleHolder>(
            CreateNamedPipeA(display_pipe_name.c_str(), PIPE_ACCESS_DUPLEX|FILE_FLAG_OVERLAPPED,
                PIPE_TYPE_BYTE, 1, 1024, 1024, 0, nullptr));
        if(display_pipe->h == INVALID_HANDLE_VALUE)
        {
            MessageBox(NULL,
                ssprintf("Error creating display pipe: %s", win_strerror(GetLastError()).c_str()).c_str(),
                "Unexpected error", MB_ICONERROR | MB_OK);
            return;
        }

        // Create a separate message-mode pipe for control messages.
        string control_pipe_name = string(display_pipe_name) + "-ctl";
        control_pipe = make_shared<HandleHolder>(
            CreateNamedPipeA(control_pipe_name.c_str(), PIPE_ACCESS_DUPLEX|FILE_FLAG_OVERLAPPED,
                PIPE_TYPE_MESSAGE|PIPE_READMODE_MESSAGE, 1, 1024, 1024, 0, nullptr));
        if(control_pipe->h == INVALID_HANDLE_VALUE)
        {
            MessageBox(NULL,
                ssprintf("Error creating control pipe: %s", win_strerror(GetLastError()).c_str()).c_str(),
                "Unexpected error", MB_ICONERROR | MB_OK);
            return;
        }

        // Connect to the pipes.  The display connection is blocking and is read and written
        // like a regular file.  The control connection is overlapped, since it's used by handle_io.
        display_connection = make_shared<HandleHolder>(CreateFileA(display_pipe_name.c_str(), GENERIC_READ|GENERIC_WRITE, 0, nullptr,
            OPEN_EXISTING, 0, nullptr));
        control_connection = make_shared<HandleHolder>(CreateFileA(control_pipe_name.c_str(), GENERIC_READ|GENERIC_WRITE, 0, nullptr,
            OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr));
    }
};

shared_ptr<ClientPipes> ClientPipes::create()
{
    return make_shared<ClientPipesImpl>();
}

class ClientImpl: public Client
{
public:
    shared_ptr<HandleIO> display_io, control_io;
    ClientInterface *callbacks = nullptr;
    shared_ptr<HandleWait> overlapped_wait;

    ClientImpl(shared_ptr<ClientPipesImpl> pipes, ClientInterface *callbacks_)
    {
        callbacks = callbacks_;

        // This event is used for HandleIO overlapped I/O in the window thread.  check_io
        // will be called when it's signalled to check for I/O.
        auto overlapped_event = make_shared<HandleHolder>(CreateEvent(NULL, true, true, NULL));
        overlapped_wait = HandleWait::create(overlapped_event->h, check_io_stub, this);

        // Create HandleIOs to handle reading and writing to the pipes.  Don't keep the
        // ClientPipesImpl around, since we want its handles to be released.
        display_io = HandleIO::create(pipes->display_pipe, overlapped_event, on_display_read_stub, onwrite_stub, this);
        control_io = HandleIO::create(pipes->control_pipe, overlapped_event, on_control_read_stub, onwrite_stub, this);

    }
    static void check_io_stub(void *ptr) { ((ClientImpl *)ptr)->check_io(); }

    void check_io()
    {
        display_io->update();
        control_io->update();
    }

    ~ClientImpl()
    {
        shutdown();
    }

    void shutdown() override
    {
        if(display_io)
        {
            display_io->shutdown();
            display_io.reset();
        }

        if(overlapped_wait)
        {
            overlapped_wait->shutdown();
            overlapped_wait.reset();
        }

        callback::delete_callbacks_for_context(this);
    }

    static void on_display_read_stub(void *ptr, const void *data, size_t len, int error)
    {
        ClientImpl *pSelf = (ClientImpl *) ptr;
        pSelf->display_on_read(data, len, error);
    }

    void display_on_read(const void *data, size_t len, int error)
    {
        if (!error && len != 0)
        {
            callbacks->output(data, len);
            return;
        }

        // We don't expect errors here.  Show a dialog for diagnostics, then treat
        // it as EOF.
        if (error)
            show_fatal_error(("Error reading from client pipe: %s", win_strerror(error).c_str()));

        // If we lose our connection to the display handle (probably because the
        // user closed the handle), tell the caller so we can close the window.
        //
        // Post this, since we're inside the handle_io update and we might be shut down when this
        // is called.
        callback::post(call_display_closed_stub, this);
    }

    static void call_display_closed_stub(void *ptr) { ((ClientImpl *) ptr)->call_display_closed();}
    void call_display_closed()
    {
        callbacks->display_closed();
    }

    static void on_control_read_stub(void *ptr, const void *data, size_t len, int error)
    {
        ClientImpl *self = (ClientImpl *) ptr;
        self->control_on_read(data, len, error);
    }

    void control_on_read(const void *data, size_t len, int error)
    {
        if (!error && len != 0)
        {
            callbacks->control(data, len);
            return;
        }

        shutdown();

        if (error)
            show_fatal_error(("Error reading from client control pipe: %s", win_strerror(error).c_str()));
        else
            show_fatal_error("Unexpected EOF reading from client control pipe");
    }

    static void onwrite_stub(void *ptr, int error)
    {
        ClientImpl *pSelf = (ClientImpl *) ptr;
        pSelf->onwrite(error);
    }

    // This is called if a write fails to either pipe.
    void onwrite(int error)
    {
        if (error) {
            shutdown();
            show_fatal_error(("Error writing to client pipe: %s", win_strerror(error).c_str()));
        }
    }

    // We're running as the current application's console, so we don't expect I/O errors.
    void show_fatal_error(string s)
    {
        MessageBox(NULL, s.c_str(), "Unexpected error", MB_ICONERROR | MB_OK);
    }

    // A pipe-only console doesn't send the size directly.  It's queried normally as
    // a terminal.
    void size(int width, int height) override { }

    void send(const char *buf, int len) override
    {
        // Less than zero means null terminated special string.
        if(len < 0)
            len = strlen(buf);

        display_io->write(buf, len);
    }

    void send_control(string message) override
    {
        control_io->write(message.data(), message.size());
    }
};

shared_ptr<Client> Client::create(shared_ptr<ClientPipes> pipes, ClientInterface *callbacks)
{
    auto pipes_impl = dynamic_pointer_cast<ClientPipesImpl>(pipes);
    return make_shared<ClientImpl>(pipes_impl, callbacks);
}
