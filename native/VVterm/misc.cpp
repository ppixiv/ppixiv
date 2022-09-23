// Misc stuff that should be removed or moved somewhere else eventually

#include <stdio.h>

#include "internal.h"

const char *const appname = "APPNAME";

string vssprintf(const char *fmt, va_list va)
{
	va_list tmp;
	va_copy(tmp, va);
	char ignore;
	int needed = vsnprintf(&ignore, 0, fmt, tmp);
	va_end(tmp);

    string result;
    result.resize(needed+1);
	vsnprintf(result.data(), needed+1, fmt, va);
    result.resize(needed); // remove null terminator
    return result;
}

string ssprintf(const char *fmt, ...)
{
	va_list	va;
	va_start(va, fmt);
	return vssprintf(fmt, va);
}

string win_strerror(int error)
{
    char msgtext[65536]; /* maximum size for FormatMessage is 64K */

    if (!FormatMessage((FORMAT_MESSAGE_FROM_SYSTEM |
                        FORMAT_MESSAGE_IGNORE_INSERTS), NULL, error,
                        MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
                        msgtext, lenof(msgtext)-1, NULL)) {
        sprintf(msgtext, "(unable to format: FormatMessage returned %u)", (unsigned int)GetLastError());
    } else {
        int len = strlen(msgtext);
        if (len > 0 && msgtext[len-1] == '\n')
            msgtext[len-1] = '\0';
    }

    return ssprintf("Error %d: %s", error, msgtext);
}

HandleHolder::HandleHolder(): h(INVALID_HANDLE_VALUE) { }
HandleHolder::HandleHolder(HANDLE h_): h(h_) { }

HandleHolder::~HandleHolder()
{
    Close();
}

void HandleHolder::Close()
{
    if(h != INVALID_HANDLE_VALUE)
        CloseHandle(h);
    h = INVALID_HANDLE_VALUE;
}

HANDLE HandleHolder::Take()
{
    HANDLE result = h;
    h = INVALID_HANDLE_VALUE;
    return result;
}
