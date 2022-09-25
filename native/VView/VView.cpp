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
#include <assert.h>

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

    // We expect to be VView\bin\VView.exe.  The parent of "bin" should be the
    // top of the installation.
    wstring GetTopDirectory()
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

        return path;
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
#if 0
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
#endif

    // Return the commandline.
    void GetCommandline(vector<wstring> &args)
    {
        int argc;
        WCHAR **argv = CommandLineToArgvW(GetCommandLineW(), &argc);

        args.clear();
        for(int i = 0; i < argc; ++i)
            args.push_back(argv[i]);
    }

    // Convert a vector of strings to a vector of WCHAR*.  This can be pass as
    // a WCHAR** to Py_Main.  Note that the pointers in argv will be invalidated
    // if args is modified.
    void ArrayToArgs(const vector<wstring> &args, vector<WCHAR *> &argv)
    {
        argv.clear();
        for(const wstring &arg: args)
            argv.push_back(const_cast<WCHAR *>(arg.data()));
        argv.push_back(nullptr);
    }

    // Remove all environment variables starting with PYTHON.
    void ClearPythonEnvironmentVars()
    {
        WCHAR *args = GetEnvironmentStrings();
        WCHAR *arg = args;
        while(*arg)
        {
            WCHAR *next = wcschr(arg, '\0');

            // Key=Value
            //    ^
            WCHAR *separator = wcschr(arg, '=');
            if(separator)
            {
                wstring name(arg, separator);
                if(name.size() >= 6 && name.substr(0, 6) == L"PYTHON")
                    SetEnvironmentVariable(name.c_str(), nullptr);
            }

            arg = next+1;
        }

        FreeEnvironmentStrings(args);
    }
}

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow)
{
    wstring top_dir = GetTopDirectory();

    // Set the CWD to the top of the installation.
    //
    // This isn't strictly necessary (we could set the directory in siteconfig.py),
    // but Python adds '' to sys.path, and if we're running from some other random
    // directory, we might import some random script since it's at the very start of
    // the path.  It's a pain to prevent it from doing that, so let's just make things
    // consistent before we launch Python.  We aren't normally launched with relative paths
    // anyway.
    SetCurrentDirectory(top_dir.c_str());

    // We can either use our embedded Python installation or a system one.  Using our
    // own means we know its version matches with our site-packages, and we don't
    // have to tell users that they need to install Python first to use the application.
    wstring python_path;
    python_path = top_dir + L"\\bin\\Python\\python3.dll";

    HMODULE python = LoadLibraryExW(python_path.c_str(), NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    if(!python)
    {
        ShowErrorDialog(L"python3.dll couldn't be loaded.");
        return 1;
    }

    auto Py_Main = (PyMainT) GetProcAddress(python, "Py_Main");
    if(!Py_Main)
    {
        ShowErrorDialog(L"Couldn't find Py_Main");
        return 1;
    }

    vector<wstring> args;
    GetCommandline(args);
    assert(args.size() >= 1); // always has the process name

    vector<wstring> python_args = {
        args[0],

        // Ignore the user's site-packages and just use our own.
        L"-s",

        // Enable isolated mode: (this makes loading our own directory difficult)
        // L"-I";
    };

    // Add our commandline after the above arguments, so anything after
    // -m package stays at the end.  If there were no arguments, use the default.
    if(args.size() == 1)
    {
        python_args.push_back(L"-m");
        python_args.push_back(L"vview.shell.default");
    }
    else
    {
        // Add our arguments to the end, skipping the executable.
        python_args.insert(python_args.end(), args.begin() + 1, args.end());
    }

    // Remove any environment variables that start with PYTHON.
    //
    // This is the same as the Python -E argument.  We do this instead since
    // -E prevents "" and our own PYTHONPATH from being added to sys.path, so our
    // own scripts won't run.
    ClearPythonEnvironmentVars();

    // Set PYTHONPATH to our top directory, so we're added to the start of sys.path.
    // This will cause our siteconfig.py to be run and allow everything else to be run.
    // (This isn't strictly necessary since we're in that directory and the default
    // '' at the start of sys.path would do this too.)
    SetEnvironmentVariable(L"PYTHONPATH", top_dir.c_str());

    // Jump to Python.
    vector<WCHAR *> argv;
    ArrayToArgs(python_args, argv);
    return Py_Main(argv.size()-1, argv.data());
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
