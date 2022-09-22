/*
 * handle-io.c: Module to give Windows front ends the general
 * ability to deal with consoles, pipes, serial ports, or any other
 * type of data stream accessed through a Windows API HANDLE rather
 * than a WinSock SOCKET.
 *
 * We do this by spawning a subthread to continuously try to read
 * from the handle. Every time a read successfully returns some
 * data, the subthread sets an event object which is picked up by
 * the main thread, and the main thread then sets an event in
 * return to instruct the subthread to resume reading.
 *
 * Output works precisely the other way round, in a second
 * subthread. The output subthread should not be attempting to
 * write all the time, because it hasn't always got data _to_
 * write; so the output thread waits for an event object notifying
 * it to _attempt_ a write, and then it sets an event in return
 * when one completes.
 *
 * (It's terribly annoying having to spawn a subthread for each
 * direction of each handle. Technically it isn't necessary for
 * serial ports, since we could use overlapped I/O within the main
 * thread and wait directly on the event objects in the OVERLAPPED
 * structures. However, we can't use this trick for some types of
 * file handle at all - for some reason Windows restricts use of
 * OVERLAPPED to files which were opened with the overlapped flag -
 * and so we must use threads for those. This being the case, it's
 * simplest just to use threads for everything rather than trying
 * to keep track of multiple completely separate mechanisms.)
 */

#include <assert.h>

#include "internal.h"
#include "handle_io.h"
#include "handle_wait.h"
#include "bufchain.h"

// The real base class for our handles.  The handle class itself is just a minimal
// interface to keep this stuff out of the header.
class handle_base: public handle
{
public:
    // A reference to ourself.  We'll keep this until we're ready to be deallocated.
    shared_ptr<handle_base> self;

    virtual ~handle_base()
    {
        CloseHandle(ev_from_main);
    }

    void shutdown() override;
    void *get_privdata() override { return privdata; }

    // Clear self, allowing ourself to be deallocated.
    void release();

    // Called when our handle becomes ready.  Returns true if the object
    // has shut down.
    virtual bool handle_ready();

    /*
     * Initial fields common to both handle_input and handle_output
     * structures.
     *
     * The three HANDLEs are set up at initialisation time and are
     * thereafter read-only to both main thread and subthread.
     * `shutting_down' is only used by the main thread; `done' is
     * written by the main thread before signalling to the
     * subthread. `defunct' and `busy' are used only by the main
     * thread.
     */
    HANDLE h;                          // the handle itself
    int flags;

    // An iterator to our entry in ready_handles, if we're in it.
    bool ready = false;
    list<shared_ptr<handle_base>>::iterator ready_handle_it;
    HANDLE ev_from_main;               // event used to signal back to us
    bool shutting_down = false;        // are we going to kill this soon?
    bool done = false;                 // request subthread to terminate
    bool defunct = false;              // has the subthread already gone?
    bool busy = false;                 // operation currently in progress?
    void *privdata;                    // for client to remember who they are
};

namespace ready_list
{
    // Linked list storing the current list of handles ready to have
    // something done to them by the main thread.
    list<shared_ptr<handle_base>> ready_handles;
    CRITICAL_SECTION ready_critsec;

    // Event object used by all subthreads to signal that they've just put
    // something on the ready list, i.e. that the ready list is non-empty.
    HANDLE ready_event = INVALID_HANDLE_VALUE;

    void add(shared_ptr<handle_base> handle)
    {
        // Stop if the handle is already on the list.
        if(handle->ready)
            return;

        // Called from subthreads, when their handle has done something
        // that they need the main thread to respond to. We append the
        // given list node to the end of the ready list, and set
        // ready_event to signal to the main thread that the ready list is
        // now non-empty.
        EnterCriticalSection(&ready_critsec);
        ready_handles.push_front(handle);
        handle->ready_handle_it = ready_handles.begin();
        handle->ready = true;
        SetEvent(ready_event);
        LeaveCriticalSection(&ready_critsec);
    }

    void remove(shared_ptr<handle_base> handle)
    {
        // Stop if the handle isn't on the list.
        if(!handle->ready)
            return;

        EnterCriticalSection(&ready_critsec);
        ready_handles.erase(handle->ready_handle_it);
        handle->ready = false;
        LeaveCriticalSection(&ready_critsec);
    }

    void handle_ready_callback(void *vctx)
    {
        // Called when the main thread detects ready_event, indicating
        // that at least one handle is on the ready list. We empty the
        // whole list and process the handles one by one.
        // 
        // Note that this is reentrant if handle_ready causes other handles to
        // be destroyed.
        EnterCriticalSection(&ready_critsec);
        while(!ready_handles.empty())
        {
            shared_ptr<handle_base> handle = ready_handles.front();
            remove(handle);
            handle->handle_ready();
        }
        LeaveCriticalSection(&ready_critsec);
    }

    void setup()
    {
        if (ready_list::ready_event == INVALID_HANDLE_VALUE) {
            InitializeCriticalSection(&ready_list::ready_critsec);
            ready_list::ready_event = CreateEvent(NULL, false, false, NULL);
            HandleWait::create(ready_list::ready_event, handle_ready_callback, NULL);
        }
    }
}

void handle_base::shutdown()
{
    assert(!shutting_down);
    if(busy) {
        /*
         * If the handle is currently busy, we cannot immediately free
         * it, because its subthread is in the middle of something.
         * (Exception: foreign handles don't have a subthread.)
         *
         * Instead we must wait until it's finished its current
         * operation, because otherwise the subthread will write to
         * invalid memory after we free its context from under it. So
         * we set the shutting_down flag, which will be noticed next time
         * an operation completes.
         */
        shutting_down = true;
    } else if (defunct) {
        // There isn't even a subthread, so we can just release the handle.
        release();
    } else {
        /*
         * The subthread is alive but not busy, so we now signal it
         * to die. Set the shutting_down flag to indicate that it will
         * want destroying after that.
         */
        shutting_down = true;
        done = true;
        busy = true;
        SetEvent(ev_from_main);
    }
}

void handle_base::release()
{
    // Remove ourself from the ready list, so it doesn't keep us alive.  This must
    // be done before clearing self.
    ready_list::remove(self);

    self.reset();
}

bool handle_base::handle_ready()
{
    if(!shutting_down)
        return false;

    // A shutting_down handle is one which we have either already
    // signalled to die, or are waiting until its current I/O op
    // completes to do so. Either way, it's treated as already
    // dead from the external user's point of view, so we ignore
    // the actual I/O result. We just signal the thread to die if
    // we haven't yet done so, or destroy the handle if not.
    if (done) {
        // This object may no longer exist when this returns, so always
        // return without accessing it further.
        release();
    } else {
        done = true;
        busy = true;
        SetEvent(ev_from_main);
    }
    return true;
}

/* ----------------------------------------------------------------------
 * Input threads.
 */

class handle_input: public handle_base {
public:
    ~handle_input() override
    {
        if (thread)
            CloseHandle(thread);
    }

    void handle_unthrottle(size_t backlog) override;
    bool handle_ready() override;
    void handle_throttle();

    void shutdown() override
    {
        CancelSynchronousIo(thread);
        handle_base::shutdown();
    }

    HANDLE thread = INVALID_HANDLE_VALUE;

    // Data set by the input thread before marking the handle ready,
    // and read by the main thread after receiving that signal.
    char buffer[4096];                 // the data read from the handle
    DWORD len;                         // how much data that was
    int readerr;                       // lets us know about read errors

    // Callback function called by this module when data arrives on
    // an input handle.
    handle_inputfn_t gotdata;
};

/*
 * The actual thread procedure for an input thread.
 */
static DWORD WINAPI handle_input_threadfunc(void *param)
{
    handle_input *ctx = (handle_input *) param;
    OVERLAPPED ovl, *povl;
    HANDLE oev = NULL;
    bool readret, finished;
    int readlen;

    if (ctx->flags & HANDLE_FLAG_OVERLAPPED) {
        povl = &ovl;
        oev = CreateEvent(NULL, true, false, NULL);
    } else {
        povl = NULL;
    }

    if (ctx->flags & HANDLE_FLAG_UNITBUFFER)
        readlen = 1;
    else
        readlen = sizeof(ctx->buffer);

    while (1) {
        // Take a strong reference to the handle, to ensure it won't be deallocated while we're
        // working with it.
        auto handle = ctx->self;

        if (povl) {
            memset(povl, 0, sizeof(OVERLAPPED));
            povl->hEvent = oev;
        }
        readret = ReadFile(ctx->h, ctx->buffer, readlen, &ctx->len, povl);
        if (!readret)
        {
            ctx->readerr = GetLastError();

            // ERROR_OPERATION_ABORTED means ReadFile was cancelled by CancelSynchronousIo
            // during shutdown.  Treat it as EOF.
            if(ctx->readerr == ERROR_OPERATION_ABORTED)
            {
                ctx->readerr = 0;
                readret = 0;
            }
        }
        else
            ctx->readerr = 0;
        if (povl && !readret && ctx->readerr == ERROR_IO_PENDING) {
            WaitForSingleObject(povl->hEvent, INFINITE);
            readret = GetOverlappedResult(ctx->h, povl, &ctx->len, false);
            if (!readret)
                ctx->readerr = GetLastError();
            else
                ctx->readerr = 0;
        }

        if (!readret) {
            /*
             * Windows apparently sends ERROR_BROKEN_PIPE when a
             * pipe we're reading from is closed normally from the
             * writing end. This is ludicrous; if that situation
             * isn't a natural EOF, _nothing_ is. So if we get that
             * particular error, we pretend it's EOF.
             */
            if (ctx->readerr == ERROR_BROKEN_PIPE)
                ctx->readerr = 0;
            ctx->len = 0;
        }

        if (readret && ctx->len == 0 &&
            (ctx->flags & HANDLE_FLAG_IGNOREEOF))
            continue;

        /*
         * If we just set ctx->len to 0, that means the read operation
         * has returned end-of-file. Telling that to the main thread
         * will cause it to set its 'defunct' flag and dispose of the
         * handle structure at the next opportunity, in which case we
         * mustn't touch ctx at all after the SetEvent. (Hence we do
         * even _this_ check before the SetEvent.)
         * XXX: no longer true since we're locking it
         */
        finished = (ctx->len == 0);

        ready_list::add(handle);

        if (finished)
            break;

        WaitForSingleObject(ctx->ev_from_main, INFINITE);
        if (ctx->done) {
            /*
             * The main thread has asked us to shut down. Send back an
             * event indicating that we've done so. Hereafter we must
             * not touch ctx at all, because the main thread might
             * have freed it.
             */
            ready_list::add(handle);
            break;
        }
    }

    if (povl)
        CloseHandle(oev);

    return 0;
}

/*
 * This is called after a successful read, or from the
 * `unthrottle' function. It decides whether or not to begin a new
 * read operation.
 */
void handle_input::handle_throttle()
{
    if(defunct)
        return;

    // If there's a read operation already in progress, do nothing:
    // when that completes, we'll come back here and be in a
    // position to make a better decision.
    if(busy)
        return;

    // Start a new read.
    SetEvent(ev_from_main);
    busy = true;
}

bool handle_input::handle_ready()
{
    // If the base class returns true, we've been released and the object may no longer exist.
    if(handle_base::handle_ready())
        return true;

    busy = false;

    // A signal on an input handle means data has arrived.
    if (len == 0) {
        // EOF, or (nearly equivalently) read error.
        defunct = true;
        gotdata(self.get(), NULL, 0, readerr);
    } else {
        gotdata(self.get(), buffer, len, 0);
        handle_throttle();
    }

    return false;
}

void handle_input::handle_unthrottle(size_t backlog)
{
    handle_throttle();
}


/* ----------------------------------------------------------------------
 * Output threads.
 */

struct handle_output: public handle_base {
    virtual ~handle_output()
    {
        CloseHandle(thread);
    }

    void shutdown() override
    {
        CancelSynchronousIo(thread);
        handle_base::shutdown();
    }

    HANDLE thread = INVALID_HANDLE_VALUE;

    bool handle_ready() override;

    size_t handle_write(const void *data, size_t len) override;
    void handle_write_eof() override;
    size_t handle_backlog() override;
    void handle_try_output();

    /*
     * Data set by the main thread before signalling ev_from_main,
     * and read by the input thread after receiving that signal.
     */
    const char *buffer;                /* the data to write */
    DWORD len;                         /* how much data there is */

    /*
     * Data set by the input thread before marking this handle as
     * ready, and read by the main thread after receiving that signal.
     */
    DWORD lenwritten;                  /* how much data we actually wrote */
    int writeerr;                      /* return value from WriteFile */

    /*
     * Data only ever read or written by the main thread.
     */
    bufchain queued_data;              /* data still waiting to be written */
    enum { EOF_NO, EOF_PENDING, EOF_SENT } outgoingeof;

    /*
     * Callback function called when the backlog in the bufchain
     * drops.
     */
    handle_outputfn_t sentdata;
    handle *sentdata_param;
};

static DWORD WINAPI handle_output_threadfunc(void *param)
{
    struct handle_output *ctx = (struct handle_output *) param;
    OVERLAPPED ovl, *povl;
    HANDLE oev = NULL;
    bool writeret;

    if (ctx->flags & HANDLE_FLAG_OVERLAPPED) {
        povl = &ovl;
        oev = CreateEvent(NULL, true, false, NULL);
    } else {
        povl = NULL;
    }

    while (1) {
        WaitForSingleObject(ctx->ev_from_main, INFINITE);
        if (ctx->done) {
            /*
             * The main thread has asked us to shut down. Send back an
             * event indicating that we've done so. Hereafter we must
             * not touch ctx at all, because the main thread might
             * have freed it.
             */
            ready_list::add(ctx->self);
            break;
        }
        if (povl) {
            memset(povl, 0, sizeof(OVERLAPPED));
            povl->hEvent = oev;
        }

        writeret = WriteFile(ctx->h, ctx->buffer, ctx->len, &ctx->lenwritten, povl);
        if (!writeret)
            ctx->writeerr = GetLastError();
        else
            ctx->writeerr = 0;
        if (povl && !writeret && GetLastError() == ERROR_IO_PENDING) {
            writeret = GetOverlappedResult(ctx->h, povl,
                                           &ctx->lenwritten, true);
            if (!writeret)
                ctx->writeerr = GetLastError();
            else
                ctx->writeerr = 0;
        }

        ready_list::add(ctx->self);
        if (!writeret) {
            /*
             * The write operation has suffered an error. Telling that
             * to the main thread will cause it to set its 'defunct'
             * flag and dispose of the handle structure at the next
             * opportunity, so we must not touch ctx at all after
             * this.
             */
            break;
        }
    }

    if (povl)
        CloseHandle(oev);

    return 0;
}

void handle_output::handle_try_output()
{
    if (!busy && queued_data.size()) {
        ptrlen data = queued_data.prefix();
        buffer = (char *) data.ptr;
        len = min(data.len, ~(DWORD)0);
        SetEvent(ev_from_main);
        busy = true;
    } else if (!busy && queued_data.size() == 0 &&
               outgoingeof == handle_output::EOF_PENDING) {
        sentdata(sentdata_param, 0, 0, true);
        h = INVALID_HANDLE_VALUE;
        outgoingeof = handle_output::EOF_SENT;
    }
}

/* ----------------------------------------------------------------------
 * Unified code handling both input and output threads.
 */

size_t handle_output::handle_write(const void *data, size_t len)
{
    assert(outgoingeof == handle_output::EOF_NO);
    queued_data.add(data, len);
    handle_try_output();
    return queued_data.size();
}

void handle_output::handle_write_eof()
{
    /*
     * This function is called when we want to proactively send an
     * end-of-file notification on the handle. We can only do this by
     * actually closing the handle - so never call this on a
     * bidirectional handle if we're still interested in its incoming
     * direction!
     */
    if (outgoingeof == handle_output::EOF_NO) {
        outgoingeof = handle_output::EOF_PENDING;
        handle_try_output();
    }
}

bool handle_output::handle_ready()
{
    // If the base class returns true, we've been released and the object may no longer exist.
    if(handle_base::handle_ready())
        return true;

    busy = false;

    // A signal on an output handle means we have completed a
    // write. Call the callback to indicate that the output
    // buffer size has decreased, or to indicate an error.
    if(writeerr) {
        // Write error. Send a negative value to the callback,
        // and mark the thread as defunct (because the output
        // thread is terminating by now).
        defunct = true;
        sentdata(self.get(), 0, writeerr, false);
    } else {
        queued_data.consume(lenwritten);
        sentdata(self.get(), queued_data.size(), 0, false);
        handle_try_output();
    }

    return false;
}

size_t handle_output::handle_backlog()
{
    return queued_data.size();
}

shared_ptr<handle> handle::create_input(HANDLE system_handle, handle_inputfn_t gotdata, void *privdata, int flags)
{
    auto h = make_shared<handle_input>();
    h->self = h;
    DWORD in_threadid; /* required for Win9x */

    h->h = system_handle;
    h->ev_from_main = CreateEvent(NULL, false, false, NULL);
    h->gotdata = gotdata;
    h->privdata = privdata;
    h->flags = flags;

    ready_list::setup();
    h->thread = CreateThread(NULL, 0, handle_input_threadfunc, h.get(), 0, &in_threadid);
    h->busy = true;

    return h;
}

shared_ptr<handle> handle::create_output(HANDLE system_handle, handle_outputfn_t sentdata, void *privdata, int flags)
{
    auto h = make_shared<handle_output>();
    h->self = h;
    DWORD out_threadid; /* required for Win9x */

    h->h = system_handle;
    h->ev_from_main = CreateEvent(NULL, false, false, NULL);
    h->privdata = privdata;
    h->outgoingeof = handle_output::EOF_NO;
    h->sentdata = sentdata;
    h->sentdata_param = h.get();
    h->flags = flags;

    ready_list::setup();
    h->thread = CreateThread(NULL, 0, handle_output_threadfunc, h.get(), 0, &out_threadid);

    return h;
}
