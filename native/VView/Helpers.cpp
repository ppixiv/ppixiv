#include "Helpers.h"
using namespace std;

#include <shlobj_core.h> // for SHGetFolderPathW

wstring Helpers::UTF8ToWide(const string &input)
{
    int size = MultiByteToWideChar(CP_UTF8, 0, input.data(), input.size(), NULL, 0);

    wstring output;
    output.resize(size+1);

    MultiByteToWideChar(CP_UTF8, 0, input.data(), input.size(), (wchar_t *) output.data(), output.size());
    output.resize(size); // remove null terminator

    return output;
}

// Strip whitespace off of the end of value.
void Helpers::Strip(wstring &value)
{
    while(value.size() > 0 && wcschr(L"\r\n\t ", value.back()) != nullptr)
        value.erase(value.end() - 1, value.end());
}

wstring Helpers::GetError(DWORD error)
{
    wchar_t *message = NULL;
    FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER|FORMAT_MESSAGE_FROM_SYSTEM|FORMAT_MESSAGE_IGNORE_INSERTS,
        NULL, error, 0, (wchar_t *) &message, 0, NULL);
    wstring result = message;
    LocalFree(message);
    return result;
}

void Helpers::GetCommandline(vector<wstring> &args)
{
    int argc;
    WCHAR **argv = CommandLineToArgvW(GetCommandLineW(), &argc);

    args.clear();
    for(int i = 0; i < argc; ++i)
        args.push_back(argv[i]);
}

void Helpers::ArrayToArgs(const vector<wstring> &args, vector<WCHAR *> &argv)
{
    argv.clear();
    for(const wstring &arg: args)
        argv.push_back(const_cast<WCHAR *>(arg.data()));
    argv.push_back(nullptr);
}

wstring Helpers::GetLocalAppData()
{
    wchar_t result[MAX_PATH];
    if(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, result) != S_OK)
        return wstring();

    return wstring(result);
}
