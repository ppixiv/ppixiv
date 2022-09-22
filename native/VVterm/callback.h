#ifndef Callback_H
#define Callback_H

typedef void (*toplevel_callback_fn_t)(void *ctx);

namespace callback
{
    void post(toplevel_callback_fn_t fn, void *ctx);
    bool run_pending();
    bool pending();
    void delete_callbacks_for_context(void *ctx);
}

#endif
