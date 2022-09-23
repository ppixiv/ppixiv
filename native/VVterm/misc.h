#ifndef Misc_H
#define Misc_H

#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>
#include <time.h>
#include <limits.h>
#include <assert.h>
#include <stddef.h>
#include <stdint.h>
#include <inttypes.h>

#include <string>
using namespace std;

typedef void *HANDLE; // avoiding pulling in windows.h here

#define PRINTF_LIKE(fmt_index, ellipsis_index)
#define NORETURN __declspec(noreturn)

// A small structure wrapping up a (pointer, length) pair so that it
// can be conveniently passed to or from a function.
struct ptrlen {
    ptrlen(const void *ptr_ = nullptr, size_t len_ = 0):
        ptr(ptr_), len(len_) { }

    const void *ptr = nullptr;
    size_t len = 0;
};

/*
 * A function you can put at points in the code where execution should
 * never reach in the first place. Better than assert(false), or even
 * assert(false && "some explanatory message"), because some compilers
 * don't interpret assert(false) as a declaration of unreachability,
 * so they may still warn about pointless things like some variable
 * not being initialised on the unreachable code path.
 *
 * I follow the assertion with a call to abort() just in case someone
 * compiles with -DNDEBUG, and I wrap that abort inside my own
 * function labelled NORETURN just in case some unusual kind of system
 * header wasn't foresighted enough to label abort() itself that way.
 */
static inline NORETURN void unreachable_internal() { abort(); }
#define unreachable(msg) (assert(false && msg), unreachable_internal())

string win_strerror(int error);

// ssprintf into a std::string:
string vssprintf(const char *fmt, va_list va);
string ssprintf(const char *fmt, ...);

#ifndef lenof
#define lenof(x) ( (sizeof((x))) / (sizeof(*(x))))
#endif

// A container to handle releasing handles.
struct HandleHolder
{
    HandleHolder();
    HandleHolder(HANDLE h);
    HandleHolder(const HandleHolder &rhs) = delete;
    ~HandleHolder();

    void Close();

    // Return the handle, passing ownership of it to the caller.
    HANDLE Take();

    HandleHolder &operator=(const HandleHolder &rhs) = delete;

    HANDLE h;
};

#endif
