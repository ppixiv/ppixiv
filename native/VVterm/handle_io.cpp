// HandleIO simplifies reading and writing to Windows handles.  This
// requires handles that have been created with FILE_FLAG_OVERLAPPED.
#include <assert.h>
#include <set>

#include "internal.h"
#include "bufchain.h"
#include "callback.h"
#include "handle_io.h"
//#include "handle_wait.h"

// The real base class for our handles.  The HandleIO class itself is just a minimal
// interface to keep this stuff out of the header.
class HandleIOImpl: public HandleIO
{
public:
    HandleIOImpl(shared_ptr<HandleHolder> system_handle, shared_ptr<HandleHolder> event_handle, handle_inputfn_t onread, handle_outputfn_t onwrite, void *privdata);
    ~HandleIOImpl();

    void shutdown() override;
    size_t write(const void *data, size_t len) override;
    void write_eof() override;
    size_t handle_backlog() const override;

    static void update_stub(void *p) { ((HandleIOImpl *) p)->update(); }
    void update() override;

    static void first_update_stub(void *p) { ((HandleIOImpl *) p)->first_update(); }
    void first_update();

    void check_reads();
    void check_writes();

    // A reference to ourself:
    weak_ptr<HandleIOImpl> self;

    shared_ptr<HandleHolder> handle;

    shared_ptr<HandleHolder> overlapped_event;

    // Callbacks:
    handle_inputfn_t onread;
    handle_outputfn_t onerror;
    void *privdata;
    bool shutting_down = false;

    // Reads:
    char read_buffer[4096];
    DWORD read_len;
    int read_error;
    bool read_running = false;
    OVERLAPPED read_ovl;

    // Writes:
    bool write_running = false;
    bufchain queued_data;              // data still waiting to be written
    enum { EOF_NO, EOF_PENDING, EOF_SENT } outgoingeof;
    OVERLAPPED write_ovl;
    const char *write_buffer;
    DWORD write_len;
    DWORD lenwritten;
    int write_error;
};

HandleIOImpl::HandleIOImpl(shared_ptr<HandleHolder> system_handle, shared_ptr<HandleHolder> event_handle, handle_inputfn_t onread_, handle_outputfn_t onerror_, void *privdata_)
{
    overlapped_event = event_handle;

    handle = system_handle;
    onread = onread_;
    onerror = onerror_;
    privdata = privdata_;
    outgoingeof = HandleIOImpl::EOF_NO;

    // We need to start the first read, but we shouldn't call onread from the constructor
    // if it finishes immediately.  Queue a callback to start it.
    callback::post(first_update_stub, this);
}

void HandleIOImpl::first_update()
{
    // Kick off our first read.  Future reads will start as previous ones complete.
    update();
}

HandleIOImpl::~HandleIOImpl()
{
    shutdown();
}

void HandleIOImpl::shutdown()
{
    shutting_down = true;

    callback::delete_callbacks_for_context(this);

    // If overlapped I/O is running, cancel it.  Otherwise, it'll write to the memory
    // location of the overlapped structure when it completes.
    bool did_wait = false;
    while(true)
    {
        if(!read_running && !write_running)
            break;

        if(read_running)
        {
            CancelIoEx(handle->h, &read_ovl);
            read_running = false;
        }

        if(write_running)
        {
            CancelIoEx(handle->h, &write_ovl);
            write_running = false;
        }

        WaitForSingleObject(overlapped_event->h, INFINITE);
        update();
        did_wait = true;
    }

    // If we waited on overlapped_event at all, then we just swallowed some events and
    // caused it to be unset.  We might not be the only thing using this event, so set
    // it to signalled so anything else using it will wake up.
    if(did_wait)
        SetEvent(overlapped_event->h);
}

// This is called when event is signalled, which means one of our overlapped
// operations completed.
void HandleIOImpl::update()
{
    check_reads();
    check_writes();
}

// See if an existing read has finished, or if we need to start a new one.  This
// should be called when our event is signalled.
void HandleIOImpl::check_reads()
{
start:
    bool readret = false;
    if(!read_running && !shutting_down)
    {
        // Start a read.  This can either finish immediately with a result, or run asynchronously.
        memset(&read_ovl, 0, sizeof(OVERLAPPED));
        read_ovl.hEvent = overlapped_event->h;

        readret = ReadFile(handle->h, read_buffer, sizeof(read_buffer), &read_len, &read_ovl);
        if(!readret && GetLastError() == ERROR_IO_PENDING)
        {
            // The request is running asynchronously.
            read_running = true;
        }
    }

    if(read_running)
    {
        // An async read is already running.  See if it's finished.
        readret = GetOverlappedResult(handle->h, &read_ovl, &read_len, false);
        if(readret == 0 && GetLastError() == ERROR_IO_INCOMPLETE)
        {
            // The overlapped request isn't finished yet.
            return;
        }

        // Otherwise, the request finished and we have the result in the same way we
        // would if ReadFile completed synchronously.
        read_running = false;
    }

    // If we're in shutdown(), we're just finishing up the last operation.  Don't
    // run callbacks or start another read.
    if(shutting_down)
        return;

    // A read has finished.
    if (!readret)
    {
        read_error = GetLastError();

        // ERROR_BROKEN_PIPE just means the pipe was closed.  Treat it as EOF.
        if (read_error == ERROR_BROKEN_PIPE)
            read_error = 0;
        read_len = 0;
    }
    else
        read_error = 0;

    onread(privdata, read_buffer, read_len, read_error);

    // If we finished a read, start over to start the next read.  Don't do this on error
    // or EOF.
    if(read_error == 0 && read_len > 0)
        goto start;
}

// See if an existing write has finished, or if we need to start a new one.  This
// should be called when our event is signalled, or if we have new data to write.
void HandleIOImpl::check_writes()
{
start:
    // If no write is running, see if we have anything to do.
    if(!write_running)
    {
        if(queued_data.size())
        {
            ptrlen data = queued_data.prefix();
            write_buffer = (char *) data.ptr;
            write_len = DWORD(data.len);
        }
        else if (queued_data.size() == 0 && outgoingeof == EOF_PENDING)
        {
            // A write of size 0 means we've closed the stream.
            onerror(privdata, 0);
            handle->Close();
            handle.reset();
            outgoingeof = EOF_SENT;
        }
        else
        {
            // We don't have anything to write.
            return;
        }
    }

    bool writeret = false;
    if(!write_running && !shutting_down)
    {
        // Start a write.  This can either finish immediately with a result, or run asynchronously.
        memset(&write_ovl, 0, sizeof(OVERLAPPED));
        write_ovl.hEvent = overlapped_event->h;

        writeret = WriteFile(handle->h, write_buffer, write_len, &lenwritten, &write_ovl);

        if(!writeret && GetLastError() == ERROR_IO_PENDING)
        {
            // The request is running asynchronously.
            write_running = true;
        }
    }

    if(write_running)
    {
        // An async write is already running.  See if it's finished.
        writeret = GetOverlappedResult(handle->h, &write_ovl, &lenwritten, false);
        if(writeret == 0 && GetLastError() == ERROR_IO_INCOMPLETE)
        {
            // The overlapped request isn't finished yet.
            return;
        }
    }

    // If we're in shutdown(), we're just finishing up the last operation.  Don't
    // run callbacks or start another write.
    if(shutting_down)
        return;

    // A write has finished.
    if (!writeret)
        write_error = GetLastError();
    else
        write_error = 0;

    if(write_error) {
        onerror(privdata, write_error);
    } else {
        queued_data.consume(lenwritten);

        // Start over to start the next write.
        goto start;
    }
}

size_t HandleIOImpl::write(const void *data, size_t len)
{
    assert(outgoingeof == EOF_NO);

    queued_data.add(data, len);
    check_writes();
    return queued_data.size();
}

void HandleIOImpl::write_eof()
{
    // This function is called when we want to proactively send an
    // end-of-file notification on the handle. We can only do this by
    // actually closing the handle - so never call this on a
    // bidirectional handle if we're still interested in its incoming
    // direction.
    //
    // (Note: this isn't used, and we don't do anything to stop existing
    // overlapped reads when we do this.)
    if (outgoingeof == EOF_NO) {
        outgoingeof = EOF_PENDING;
        check_writes();
    }
}

size_t HandleIOImpl::handle_backlog() const
{
    return queued_data.size();
}
/*
shared_ptr<HandleIO> HandleIO::create(shared_ptr<HandleHolder> handle, handle_inputfn_t onread, handle_outputfn_t onerror, void *privdata)
{
    auto overlapped_event = make_shared<HandleHolder>(CreateEvent(NULL, true, false, NULL));
    auto overlapped_wait = HandleWait::create(overlapped_event->h, update_stub, this);

    return HandleIO::create(handle, overlapped_event, onread, onerror, privdata);
}
*/

shared_ptr<HandleIO> HandleIO::create(shared_ptr<HandleHolder> handle, shared_ptr<HandleHolder> event, handle_inputfn_t onread, handle_outputfn_t onwrite, void *privdata)
{
    auto h = make_shared<HandleIOImpl>(handle, event, onread, onwrite, privdata);
    h->self = h;
    return h;
}
