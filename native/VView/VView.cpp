// This acts just like python.exe, by finding python3.dll and launching it.
// It does a couple other things:
// - Sets the CWD to the top of the installation, so running "VView -m module"
// works from anywhere.
// - If no arguments are given, runs the equivalent of "python -m vview.shell.default".
// This lets us act like a regular application if we're run directly.
//
// All arguments are passed along normally.  This means the multiprocessing module
// without having to use multiprocessing.set_executable, since it simply calls this
// instead of python.exe and everything works the same.
//
// Like pythonw.exe, we don't do anything to show exceptions to the user.  It's up
// to the application to do that.

#include <windows.h>
#include <commctrl.h>
#include <shlobj_core.h>
#include <windows.h>
#include <winreg.h>

#include <io.h>
#include <fcntl.h>
#include <string>
#include <vector>

using namespace std;
#define WIN32_LEAN_AND_MEAN // if you say so

typedef int (*PyMainT)(int argc, WCHAR **argv);

#pragma comment(lib, "comctl32.lib") // for InitCommonControls

namespace
{
    wstring GetErrorString(DWORD error)
    {
        WCHAR *message = NULL;
        FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER|FORMAT_MESSAGE_FROM_SYSTEM|FORMAT_MESSAGE_IGNORE_INSERTS,
            NULL, error, 0,(WCHAR*) &message, 0, NULL);
        wstring result = message;
        LocalFree(message);
        return result;
    }

    void ShowErrorDialog(wstring message)
    {
        wstring error = message;
        error += L"\n\n"; //L"VView couldn't be launched:\n\n";
        error += GetErrorString(GetLastError());

        MessageBoxW(NULL, error.c_str(), L"Error launching VView", MB_ICONHAND|MB_OK);
    }

    // We expect to be VView\bin\VView.exe.  Set the CWD to the parent directory
    // of bin, which should be the top of the installation.
    void SetDirectory()
    {
        WCHAR path[MAX_PATH] = L"";
        GetModuleFileNameW(NULL, path, MAX_PATH);

        // VView\bin\VView.exe
        //          ^
        WCHAR *p0 = wcsrchr(path, '\\');
        if(p0)
            *p0 = 0;

        // VView\bin\VView.exe
        //      ^
        p0 = wcsrchr(path, '\\');
        if(p0)
            *p0 = 0;

        SetCurrentDirectory(path);
    }

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

    bool GetExecutable(wstring &interpreter, wstring &error)
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

        interpreter = UTF8ToWide(s);
        Strip(interpreter);

        // Verify that the interpreter exists.
        if(GetFileAttributesW(interpreter.c_str()) == INVALID_FILE_ATTRIBUTES)
        {
            error = L"The Python interpreter doesn't exist.\n\nCan't find: " + interpreter;
            return false;
        }

        return true;
    }
}

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow)
{
    SetDirectory();

    wstring python_path;
    wstring error;
    if(!GetExecutable(python_path, error))
    {
        ShowErrorDialog(error);
        return 1;
    }

    HMODULE python = LoadLibraryExW(python_path.c_str(), NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    if(!python)
    {
        ShowErrorDialog(L"python3.dll couldn't be loaded.");
        return 1;
    }

    // Grab the commandline.
    int argc;
    WCHAR **argv = CommandLineToArgvW(GetCommandLineW(), &argc);

    // If we were given no arguments, use the default.
    if(argc == 1)
    {
        static const WCHAR *default_args[] = {
            argv[0],
            L"-m", L"vview.shell.default",
        };

        argc = 3;
        argv = (WCHAR **) default_args;
    }

    // Jump to Python.
    auto Py_Main = (PyMainT) GetProcAddress(python, "Py_Main");
    if(!Py_Main)
    {
        ShowErrorDialog(L"Error reading GetProcAddress from Python3.dll");
        return 1;
    }

    return Py_Main(argc, argv);
}

// Loosely based on https://github.com/genosse-einhorn/python-exe-stub:
// 
// Copyright © 2019 Jonas Kümmerlin <jonas@kuemmerlin.eu>
//
// This software is provided 'as-is', without any express or implied
// warranty.  In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//    claim that you wrote the original software. If you use this software
//    in a product, an acknowledgment in the product documentation would be
//    appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//    misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.
