#define WIN32_LEAN_AND_MEAN

#include <shlobj_core.h>
#include <windows.h>
#include <winreg.h>

#include <string>
#include <vector>
using namespace std;

string ReadFile(const wstring &path)
{
    FILE *config = _wfopen(path.c_str(), L"r+t");
    if(config == nullptr)
        return string();

    char buffer[1024];
    int bytes = (int) fread(buffer, 1, sizeof(buffer), config);
    fclose(config);

    if(bytes == -1)
        return string();

    return string(buffer, bytes);
}
/*
wstring GetExecutablePath()
{
    wchar_t executable[MAX_PATH];
    GetModuleFileName(NULL, executable, MAX_PATH);
    return executable;
}
*/
wstring UTF8ToWide(const string &input)
{
    int size = MultiByteToWideChar(CP_UTF8, 0, input.data(), input.size(), NULL, 0);

    wstring output;
    output.resize(size);

    MultiByteToWideChar(CP_UTF8, 0, input.data(), input.size(), (wchar_t *) output.data(), output.size());
    output.resize(size-1); // remove null terminator

    return output;
}

// Strip whitespace off of the end of value.
void Strip(wstring &value)
{
    while(value.size() > 0 && wcschr(L"\r\n\t ", value.back()) != nullptr)
        value.erase(value.end() - 1, value.end());
}

wstring GetError()
{
    wchar_t buffer[1024];
    int size = FormatMessage(FORMAT_MESSAGE_FROM_SYSTEM, 0, GetLastError(), 0, buffer, 1024,nullptr );
    return wstring(buffer, size);
}

wstring GetLocalDataDir()
{
    wchar_t result[MAX_PATH];
    if(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, result) != S_OK)
        return wstring();

    return wstring(result) + L"\\PViewer";
}

bool GetExecutable(wstring &interpreter, wstring &root)
{
    wstring data_dir = GetLocalDataDir();
    if(data_dir.empty())
        return false;

    wstring configuration = data_dir + L"\\interpreter.txt";
    string s = ReadFile(configuration);
    if(s.empty())
    {
        printf("Couldn't read installation path from:\n%ls\n\nHas the application been run yet?\n", configuration.c_str());
        return false;
    }

    wstring data = UTF8ToWide(s);

    // The file should be two lines: the Python interpreter path, then the top directory
    // of the Python module.
    int index = data.find(L'\n');
    if(index == wstring::npos)
    {
        printf("Error parsing %ls\n", configuration.c_str());
        return false;
    }

    interpreter.assign(data, 0, index); 
    root.assign(data, index+1); 

    Strip(interpreter);
    Strip(root);
    return true;
}

bool RunApplication(const wstring &args)
{
    // Get the path to the executable to run.  This is already escaped.
    wstring interpreter, root;
    if(!GetExecutable(interpreter, root))
        return false;

    STARTUPINFO si = {0};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;

    // Don't give the process stdin.  These handles are only for debugging,
    // and the process never needs to read input (if it does, we probably
    // accidentally ran Python's commandline mode).
    si.hStdInput = NULL;
    si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);

    wstring command = interpreter + L" " + args;

    PROCESS_INFORMATION pi;
    BOOL success = CreateProcessW(
        nullptr,
        (wchar_t *) command.c_str(),
        nullptr, // lpProcessAttributes
        nullptr, // lpThreadAttributes
        true, // bInheritHandles
        0, // dwCreationFlags
        nullptr, // lpEnvironment
        root.c_str(), // lpCurrentDirectory
        &si, // lpStartupInfo,
        &pi
    );

    if(!success)
    {
        printf("error %ls\n", GetError().c_str());
        return 0;
    }
    WaitForSingleObject(pi.hProcess, INFINITE);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    return true;
}