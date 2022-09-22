/*
 * Backend to run a Windows console session using ConPTY.
 */

#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <io.h>
#include <fcntl.h>

#include "internal.h"
#include "timing.h"

#include "backend_pty.h"
#include "handle_io.h"
#include "handle_wait.h"

#include <windows.h>
#include <consoleapi.h>

// Containers to handle releasing HPCONs.
struct PseudoConsoleHolder
{
    PseudoConsoleHolder(HANDLE h_=INVALID_HANDLE_VALUE):
        h(h_)
    {
    }

    ~PseudoConsoleHolder()
    {
        if(h != INVALID_HANDLE_VALUE)
            ClosePseudoConsole(h);
    }

    HPCON h = INVALID_HANDLE_VALUE;
};

class Backend_PTY: public Backend
{
public:
    shared_ptr<HandleHolder> stdin_read, stdin_write, stdout_read, stdout_write;
    shared_ptr<handle> in, out;
    BackendInterface *callbacks = nullptr;
    shared_ptr<const TermConfig> conf = NULL;
    int bufsize = 0;

    Backend_PTY(BackendInterface *callbacks_, shared_ptr<const TermConfig> conf_)
    {
        callbacks = callbacks_;
        conf = conf_;

        stdin_read = make_shared<HandleHolder>();
        stdin_write = make_shared<HandleHolder>();
        stdout_read = make_shared<HandleHolder>();
        stdout_write = make_shared<HandleHolder>();
    }

    string init() override
    {
        if(!CreatePipe(&stdin_read->h, &stdin_write->h, NULL, 0))
            return ssprintf("CreatePipe: %s", win_strerror(GetLastError()).c_str());

        if(!CreatePipe(&stdout_read->h, &stdout_write->h, NULL, 0))
            return ssprintf("CreatePipe: %s", win_strerror(GetLastError()).c_str());

        in = handle::create_input(stdout_read->h, conpty_gotdata_stub, this, 0);
        out = handle::create_output(stdin_write->h, conpty_sentdata_stub, this, 0);

        return "";
    }

    ~Backend_PTY()
    {
        shutdown();
    }

    void shutdown() override
    {
        if (in) {
            in->shutdown();
            in.reset();
        }

        if (out) {
            out->shutdown();
            out.reset();
        }

        stdin_read.reset();
        stdout_write.reset();
        stdout_read.reset();
        stdin_write.reset();
    }

    static void conpty_gotdata_stub(handle *h, const void *data, size_t len, int err)
    {
        Backend_PTY *pSelf = (Backend_PTY *) h->get_privdata();
        pSelf->conpty_gotdata(data, len, err);
    }

    void conpty_gotdata(const void *data, size_t len, int err)
    {
        if (!err && len != 0)
        {
            callbacks->output(data, len);
            return;
        }

        shutdown();

        string error_msg;
        if (err)
            error_msg = ssprintf("Error reading from console pty: %s", win_strerror(err).c_str());
        else
            error_msg = ssprintf("Unexpected end of file reading from console pty");

        show_fatal_error(error_msg);
    }

    // We're running as the current application's console, so we don't expect I/O errors.
    void show_fatal_error(string s)
    {
        MessageBox(NULL, s.c_str(), "Unexpected error", MB_ICONERROR | MB_OK);
    }

    static void conpty_sentdata_stub(handle *h, size_t new_backlog, int err, bool close)
    {
        Backend_PTY *pSelf = (Backend_PTY *) h->get_privdata();
        pSelf->conpty_sentdata(new_backlog, err, close);
    }

    void conpty_sentdata(size_t new_backlog, int err, bool close)
    {
        if (err) {
            shutdown();
            show_fatal_error("Error writing to conpty device");
        } else {
            bufsize = new_backlog;
        }
    }

    // A pipe-only console doesn't send the size directly.  It's queried normally as
    // a terminal.
    void size(int width, int height) override { }

    void send(const char *buf, int len) override
    {
        if (out == NULL)
            return;

        // Less than zero means null terminated special string.
        if(len < 0)
            len = strlen(buf);

        bufsize = out->handle_write(buf, len);
    }

    size_t sendbuffer() override
    {
        return bufsize;
    }

    void special(SessionSpecialCode code, int arg) override
    {
    }

    void unthrottle(size_t backlog) override
    {
        if(in)
            in->handle_unthrottle(backlog);
    }

    void get_handles(HANDLE *input, HANDLE *output) override
    {
        *input = stdin_read->h;
        *output = stdout_write->h;
    }
};

// A Backend_PTY that launches a process with the PTY.  This is only used
// for testing.
class Backend_Process: public Backend_PTY
{
public:
    shared_ptr<PseudoConsoleHolder> pseudoconsole;
    shared_ptr<HandleWait> subprocess;
    HANDLE hprocess = INVALID_HANDLE_VALUE;

    Backend_Process(BackendInterface *callbacks, shared_ptr<const TermConfig> conf):
        Backend_PTY(callbacks, conf)
    {
        pseudoconsole = make_shared<PseudoConsoleHolder>();
    }

    string init() override
    {
        string error = Backend_PTY::init();
        if(!error.empty())
            return error;

        COORD size;
        size.X = conf->width;
        size.Y = conf->height;

        // Create a PTY.
        HRESULT result = CreatePseudoConsole(size, stdin_read->h, stdout_write->h, 0, &pseudoconsole->h);
        if (FAILED(result)) {
            if (HRESULT_FACILITY(result) == FACILITY_WIN32)
                return ssprintf("CreatePseudoConsole: %s", win_strerror(HRESULT_CODE(result)).c_str());
            else
                return ssprintf("CreatePseudoConsole failed: HRESULT=0x%08x", (unsigned)result);
        }

        // Release the handles we're giving to the child.
        stdin_read.reset();
        stdout_write.reset();

        string command = "cmd.exe";

        STARTUPINFOEX si;
        memset(&si, 0, sizeof(si));
        si.StartupInfo.cb = sizeof(si);

        SIZE_T attrsize = 0;
        InitializeProcThreadAttributeList(NULL, 1, 0, &attrsize);

        string attribute_list_buf(attrsize, 0);
        si.lpAttributeList = (LPPROC_THREAD_ATTRIBUTE_LIST) attribute_list_buf.data();
        if(!InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, &attrsize))
            return ssprintf("InitializeProcThreadAttributeList: %s", win_strerror(GetLastError()).c_str());

        if(!UpdateProcThreadAttribute(si.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
            pseudoconsole->h, sizeof(pseudoconsole->h), NULL, NULL))
            return ssprintf("UpdateProcThreadAttribute: %s", win_strerror(GetLastError()).c_str());

        PROCESS_INFORMATION pi;
        memset(&pi, 0, sizeof(pi));

        bool created_ok = CreateProcess(NULL, (char *) command.c_str(), NULL, NULL,
            false, EXTENDED_STARTUPINFO_PRESENT,
            NULL, NULL, &si.StartupInfo, &pi);
        if (!created_ok)
            return ssprintf("CreateProcess: %s", win_strerror(GetLastError()).c_str());

        subprocess = HandleWait::create(pi.hProcess, conpty_process_wait_callback_stub, this);
        hprocess = pi.hProcess;
        CloseHandle(pi.hThread);

        return "";
    }

    void size(int width, int height) override
    {
        COORD size;
        size.X = width;
        size.Y = height;
        ResizePseudoConsole(pseudoconsole->h, size);
    }

    void shutdown() override
    {
        if (subprocess) {
            subprocess->shutdown();
            subprocess.reset();
        }

        if(hprocess != INVALID_HANDLE_VALUE)
        {
            TerminateProcess(hprocess, 0);
            CloseHandle(hprocess);
            hprocess = INVALID_HANDLE_VALUE;
        }

        pseudoconsole.reset();

        Backend_PTY::shutdown();
    }

    static void conpty_process_wait_callback_stub(void *vctx)
    {
        Backend_Process *pSelf = (Backend_Process *) vctx;
        pSelf->conpty_process_wait_callback();
    }

    // This is called when the subprocess exits.
    //
    // This is just a testing wrapper and the API is meant to run inside an application,
    // not shell out to one, so we don't try to clean up here.
    void conpty_process_wait_callback()
    {
    }

    // Not available:
    void get_handles(HANDLE *input, HANDLE *output) override
    {
        *input = *output = INVALID_HANDLE_VALUE;
    }
};

shared_ptr<Backend> Create_Backend_PTY(BackendInterface *callbacks, shared_ptr<const TermConfig> conf)
{
    return make_shared<Backend_PTY>(callbacks, conf);
    //return make_shared<Backend_Process>(callbacks, conf);
}
