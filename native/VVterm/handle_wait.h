#ifndef handle_wait_h
#define handle_wait_h

#include <stdint.h>
#include <memory>
using namespace std;

typedef void (*handle_wait_callback_fn_t)(void *);

class HandleWait {
public:
    virtual ~HandleWait() { }
    virtual void shutdown() = 0;
    static void wait(DWORD timeout);

    static shared_ptr<HandleWait> create(HANDLE h, handle_wait_callback_fn_t callback, void *callback_ctx);
};

#endif
