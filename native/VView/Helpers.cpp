#define WIN32_LEAN_AND_MEAN

#include <shlobj_core.h>
#include <windows.h>
#include <winreg.h>

#include <string>
#include <vector>
#include <list>
using namespace std;

string ReadFileFromDisk(const wstring &path)
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

wstring GetError(DWORD error)
{
    wchar_t buffer[1024];
    int size = FormatMessage(FORMAT_MESSAGE_FROM_SYSTEM, 0, error, 0, buffer, 1024,nullptr );
    return wstring(buffer, size);
}

wstring GetLocalDataDir()
{
    wchar_t result[MAX_PATH];
    if(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, result) != S_OK)
        return wstring();

    return wstring(result) + L"\\VView";
}

bool GetExecutable(wstring &interpreter, wstring &root, wstring &error)
{
    wstring data_dir = GetLocalDataDir();
    if(data_dir.empty())
    {
        error = L"Error getting AppData/Local";
        return false;
    }

    wstring configuration = data_dir + L"\\interpreter.txt";
    string s = ReadFileFromDisk(configuration);
    if(s.empty())
    {
        error = wstring(L"Couldn't read installation path from:\n") + configuration + L"\n\nHas the application been run yet?";
        return false;
    }

    wstring data = UTF8ToWide(s);

    // The file should be two lines: the Python interpreter path, then the top directory
    // of the Python module.
    int index = data.find(L'\n');
    if(index == wstring::npos)
    {
        error = wstring(L"Error parsing ") + configuration;
        return false;
    }

    interpreter.assign(data, 0, index); 
    root.assign(data, index+1); 

    Strip(interpreter);
    Strip(root);

    // Verify that the interpreter and the installation path exist.
    if(GetFileAttributesW(interpreter.c_str()) == INVALID_FILE_ATTRIBUTES)
    {
        error = L"The Python interpreter doesn't exist.\n\nCan't find: " + interpreter;
        return false;
    }

    if(GetFileAttributesW(root.c_str()) == INVALID_FILE_ATTRIBUTES)
    {
        error = L"Can't find VView.\n\nCan't find: " + root;
        return false;
    }

    return true;
}

void OpenConsole()
{
    // If we already have an output, use what we have.  This makes output work
    // properly in Cygwin.
    if(GetStdHandle(STD_OUTPUT_HANDLE))
        return;
    AllocConsole();


    /*
    HANDLE stdin_handle = GetStdHandle(STD_INPUT_HANDLE);
    HANDLE stdout_handle = GetStdHandle(STD_OUTPUT_HANDLE);
    HANDLE stderr_handle = GetStdHandle(STD_ERROR_HANDLE);

    int stdin_fd = _open_osfhandle((intptr_t) stdin_handle, _O_TEXT);
    int stdout_fd = _open_osfhandle((intptr_t) stdout_handle, _O_TEXT);
    int stderr_fd = _open_osfhandle((intptr_t) stderr_handle, _O_TEXT);

    _dup2(stdin_fd, 0);
    _dup2(stdout_fd, 1);
    _dup2(stderr_fd, 2);
    */

    freopen( "CONIN$", "rb", stdin );
    freopen( "CONOUT$", "wb", stdout );
    freopen( "CONOUT$", "wb", stderr );
}

bool RunApplication(const wstring &args, wstring &error, bool always_show_console)
{
    if(always_show_console)
        OpenConsole();

    setvbuf(stdin, NULL, _IONBF, 0);
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);

    // Get the path to the executable to run.
    wstring interpreter, root;
    if(!GetExecutable(interpreter, root, error))
        return false;

    STARTUPINFO si = {0};
    si.cb = sizeof(si);

    // Pass along console handles if we have them.
    if(GetStdHandle(STD_OUTPUT_HANDLE))
    {
        si.dwFlags = STARTF_USESTDHANDLES;

        si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    }

    wstring command = L"\"" + interpreter + L"\" " + args;
    
    // When running in Cygwin, we need to set CREATE_NO_WINDOW for the
    // process to use our stdin/stdout and not create a console window.
    // 
    // Otherwise, we opened a console.  Don't set CREATE_NO_WINDOW, or
    // the process won't use it.
    //
    // For some reason, python.exe (the console version) will output to
    // our console, but pythonw will output to the Cygwin terminal but
    // not to our console.
    bool have_console = GetConsoleWindow() != nullptr;

    HANDLE stdin_read = 0, stdin_write = 0;
    HANDLE stdout_read = 0, stdout_write = 0;
    // HANDLE stderr_read = 0, stderr_write = 0;
    if(!GetStdHandle(STD_OUTPUT_HANDLE))
    {
        si.dwFlags = STARTF_USESTDHANDLES;

        SECURITY_ATTRIBUTES sa;
        sa.nLength = sizeof(SECURITY_ATTRIBUTES); 
        sa.bInheritHandle = TRUE; 
        sa.lpSecurityDescriptor = NULL; 

        CreatePipe(&stdin_read, &stdin_write, &sa, 0);
        CreatePipe(&stdout_read, &stdout_write, &sa, 0);
        // CreatePipe(&stderr_read, &stderr_write, &sa, 0);

        si.hStdInput = stdin_read;
        si.hStdOutput = stdout_write;
        si.hStdError = stdout_write;
        SetHandleInformation(stdin_write, HANDLE_FLAG_INHERIT, 0);
        SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
        // SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);
    }


    // in cygwin we need CREATE_NO_WINDOW and it'll inherit our stdio
    // otherwise it prevents it from accessing our handles even though we're
    // giving them explicitly (why?)
    PROCESS_INFORMATION pi;
    BOOL success = CreateProcessW(
        nullptr,
        (wchar_t *) command.c_str(),
        nullptr, // lpProcessAttributes
        nullptr, // lpThreadAttributes
        true, // bInheritHandles
        have_console? 0:CREATE_NO_WINDOW, // dwCreationFlags
        nullptr, // lpEnvironment
        root.c_str(), // lpCurrentDirectory
        &si, // lpStartupInfo,
        &pi
    );

    // If we're showing a console, we can just exit and the process will take
    // the console.  However, if it exits immediately, it might not get far enough
    // to have error handling, and exit quickly without letting the user see what
    // happened.
    // ... if this is the server process, it should create its own console
/*    exitcode = 0;
    if(always_show_console)
        return true;
        */

    if(stdin_read)
    {
        CloseHandle(stdin_read);
        CloseHandle(stdout_write);
        // CloseHandle(stderr_write);
    }

    if(!success)
    {
        error = wstring(L"Couldn't launch VView: ") + GetError(GetLastError());
        return 0;
    }

    // Read stdout until it closes.
    list<string> output_buffers;
    if(stdout_read)
    {
        char buf[1024];

        DWORD got = 0;
        ReadFile(stdout_read, buf, sizeof(buf), &got, nullptr);
        output_buffers.emplace_back(buf, got);

        // Purgebuffers from the start.
        while(output_buffers.size() > 64)
            output_buffers.pop_front();
    }

    // Now that stdout is done, wait for the process to exit.
    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exitcode = 0;
    GetExitCodeProcess(pi.hProcess, &exitcode);

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    // If the process exited with an error, open a console if we haven't already
    // and show the end of stdout.
    if(exitcode != 0)
    {
        OpenConsole();

        printf("\nExited with an error:\n\n");
        for(const string &buf: output_buffers)
            fwrite(buf.data(), 1, buf.size(), stdout);
        // MessageBoxA(NULL, output_buffer.c_str(), "Error launching VView", MB_OK );

        char c;
        fread(&c, 1, 1, stdin);
    }

    return true;
}