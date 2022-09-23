#ifndef handle_io_h
#define handle_io_h

#include "misc.h"

#include <memory>
using namespace std;

#include <windows.h>

class HandleIO {
public:
    typedef void (*handle_inputfn_t)(void *h, const void *data, size_t len, int err);
    typedef void (*handle_outputfn_t)(void *h, int error);

    // Create a HandleIO.
    //
    // Updates are handled using handle_wait.
//    static shared_ptr<HandleIO> create(shared_ptr<HandleHolder> handle, handle_inputfn_t onread, handle_outputfn_t onerror, void *privdata);

    // Create a HandleIO using the given event.
    //
    // The event must be a Windows event handle.  When the handle is signalled, call HandleIO::update().
    // update() must also be called at least once on return to begin the initial read.
    static shared_ptr<HandleIO> create(shared_ptr<HandleHolder> handle, shared_ptr<HandleHolder> event, handle_inputfn_t onread, handle_outputfn_t onerror, void *privdata);

    virtual ~HandleIO() { }

    virtual void shutdown() = 0;
    virtual size_t write(const void *data, size_t len) { return -1; };
    virtual void write_eof() = 0;
    virtual size_t handle_backlog() const = 0;
    virtual void update() = 0;
};

#endif
