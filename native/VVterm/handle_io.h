#ifndef handle_io_h
#define handle_io_h

#define HANDLE_FLAG_OVERLAPPED 1
#define HANDLE_FLAG_IGNOREEOF 2
#define HANDLE_FLAG_UNITBUFFER 4

class handle {
public:
    typedef void (*handle_inputfn_t)(handle *h, const void *data, size_t len, int err);
    typedef void (*handle_outputfn_t)(handle *h, size_t new_backlog, int err, bool close);
    static shared_ptr<handle> create_input(HANDLE handle, handle_inputfn_t gotdata, void *privdata, int flags);
    static shared_ptr<handle> create_output(HANDLE handle, handle_outputfn_t sentdata, void *privdata, int flags);

    virtual ~handle() { }
    virtual void *get_privdata() = 0;

    // Shut down the handle.
    virtual void shutdown() = 0;

    // For input handles only:
    virtual void handle_unthrottle(size_t backlog) { }

    // For output handles only:
    virtual size_t handle_write(const void *data, size_t len) { return -1; };
    virtual void handle_write_eof() { }
    virtual size_t handle_backlog() { return 0; }
};

#endif
