#ifndef Helpers_h
#define Helpers_h

#include <string>
#include <vector>
#include <windows.h>

namespace Helpers
{
    std::wstring UTF8ToWide(const std::string &input);

    // Strip whitespace off of the end of value.
    void Strip(std::wstring &value);

    std::wstring GetError(DWORD error);

    // Return the commandline.
    void GetCommandline(std::vector<std::wstring> &args);

    // Convert a vector of strings to a vector of WCHAR*.  This can be pass as
    // a WCHAR** to Py_Main.  Note that the pointers in argv will be invalidated
    // if args is modified.
    void ArrayToArgs(const std::vector<std::wstring> &args, std::vector<WCHAR *> &argv);

    // Get the user's local app data directory.
    std::wstring GetLocalAppData();
}

#endif

