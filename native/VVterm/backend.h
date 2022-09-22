#ifndef Backend_H
#define Backend_H

// This is the interface a backend receives to communicate with its owner.
class BackendInterface
{
public:
    virtual void output(const void *data, size_t len) = 0;
};

/*
 * Enumeration of 'special commands' that can be sent during a
 * session, separately from the byte stream of ordinary session data.
 */
typedef enum {
    SS_BRK,    /* serial-line break */
} SessionSpecialCode;

class Backend
{
public:
    virtual ~Backend() { }

    virtual string init() = 0;
    virtual void shutdown() = 0;
    virtual void send(const char *buf, int len) = 0;

    // Return the current amount of buffered data:
    virtual size_t sendbuffer() = 0;

    virtual void size(int width, int height) = 0;
    virtual void special(SessionSpecialCode code, int arg) = 0;

    // Tells the back end that the front end  buffer is clearing.
    virtual void unthrottle(size_t bufsize) = 0;

    // For Backend_PTY only: return the input and output handles.
    virtual void get_handles(HANDLE *input, HANDLE *output) { }
};

#endif
